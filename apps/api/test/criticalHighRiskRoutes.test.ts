import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applySafeRestore } from "../src/critical/apply.js";
import { createCheckpointedBackup, verifyRestoredCheckpoint } from "../src/critical/checkpoint.js";
import { recordCriticalEvent } from "../src/critical/store.js";
import { flushPendingCriticalEvents } from "../src/critical/runtime.js";
import { verifyRemoteLedger } from "../src/critical/remote.js";
import { previewSafeRestore } from "../src/critical/preview.js";
import { createPrismaClient } from "../src/db.js";
import { makeApp, prisma, resetDatabase, signUp, testCriticalRuntime } from "./support.js";

const PASSWORD = "correct-horse-battery";
const PG_BIN = process.env["S13I_PG_BIN"] ?? "C:\\Program Files\\PostgreSQL\\17\\bin";
const pgDump = join(PG_BIN, "pg_dump.exe");
const pgRestore = join(PG_BIN, "pg_restore.exe");
const createDb = join(PG_BIN, "createdb.exe");
const dropDb = join(PG_BIN, "dropdb.exe");
const available = [pgDump, pgRestore, createDb, dropDb].every((path) => existsSync(path));

function dbParts(): { url: URL; host: string; port: string; user: string; password: string } {
  const url = new URL(process.env["DATABASE_URL"]!);
  return {
    url,
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function cli(command: string, args: string[]): void {
  const parts = dbParts();
  execFileSync(command, args, {
    env: { ...process.env, PGPASSWORD: parts.password },
    stdio: "pipe",
    windowsHide: true,
  });
}

async function createBook(
  app: ReturnType<typeof makeApp>,
  cookie: string,
  name: string,
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/books",
    headers: { cookie },
    payload: { name },
  });
  expect(created.statusCode).toBe(201);
  return (created.json() as { id: string }).id;
}

async function lifecycle(
  app: ReturnType<typeof makeApp>,
  cookie: string,
  bookId: string,
  action: "archive" | "restore" | "delete",
): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/books/${bookId}/lifecycle`,
    headers: { cookie },
    payload: { action },
  });
  expect(response.statusCode).toBe(200);
}

describe.skipIf(!available)("S13-I high-risk routes → old checkpoint → safe restore", () => {
  const parts = dbParts();
  const restoreName = `ledger_test_highrisk_${process.pid}`;
  const restoreUrl = new URL(parts.url.toString());
  restoreUrl.pathname = `/${restoreName}`;
  const dir = mkdtempSync(join(tmpdir(), "libevra-s13i-highrisk-"));
  const dumpFile = join(dir, "old.dump");
  let restored: ReturnType<typeof createPrismaClient> | null = null;

  beforeAll(async () => {
    await resetDatabase();
    cli(createDb, ["-h", parts.host, "-p", parts.port, "-U", parts.user, restoreName]);
  });

  afterAll(async () => {
    await restored?.$disconnect();
    try {
      cli(dropDb, ["-h", parts.host, "-p", parts.port, "-U", parts.user, "--if-exists", restoreName]);
    } catch {
      // Keep the assertion failure visible if cleanup itself fails.
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("replays archival, disposal, recovery, admin/invite/share revocation and member removal", async () => {
    const test = testCriticalRuntime();
    const app = makeApp({ criticalEvents: test.runtime });
    try {
      const owner = await signUp(app, "high_owner");
      const ownerMe = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: owner } });
      const ownerId = (ownerMe.json() as { user: { id: string } }).user.id;
      const ownerBooks = await app.inject({ method: "GET", url: "/api/v1/books", headers: { cookie: owner } });
      const sharedBookId = (ownerBooks.json() as { books: { id: string }[] }).books[0]!.id;

      const guest = await signUp(app, "high_guest");
      const guestMe = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: guest } });
      const guestId = (guestMe.json() as { user: { id: string } }).user.id;
      await prisma.bookMember.create({ data: { bookId: sharedBookId, userId: guestId, role: "editor" } });

      const archiveBookId = await createBook(app, owner, "归档后应保持归档");
      const restoreBookId = await createBook(app, owner, "恢复后应重新可用");
      const disposeBookId = await createBook(app, owner, "弃置后应保持弃置");
      const deleteBookId = await createBook(app, owner, "永久删除后不得复活");
      const recoveryBookId = await createBook(app, owner, "审批恢复的账本");
      const untouchedBookId = await createBook(app, owner, "无关账本不得受影响");

      // Both of these are old-snapshot states before the checkpoint.
      await lifecycle(app, owner, restoreBookId, "archive");
      await lifecycle(app, owner, recoveryBookId, "archive");
      // Move the recovery book out of the 60-day self-restore window so the administrator path is
      // the only way back. These dates are part of the pre-checkpoint snapshot.
      const oldArchive = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
      await prisma.book.update({
        where: { id: recoveryBookId },
        data: {
          archivedAt: oldArchive,
          selfRestoreUntil: new Date(Date.now() - 24 * 60 * 60 * 1000),
          scheduledPurgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      const recoveryRequest = await app.inject({
        method: "POST",
        url: `/api/v1/account/archives/${recoveryBookId}/recovery-request`,
        headers: { cookie: owner },
      });
      expect(recoveryRequest.statusCode, recoveryRequest.body).toBe(200);
      const recoveryRequestId = (recoveryRequest.json() as { requestId: string }).requestId;

      // Administration is deliberately CLI-only; this direct setup represents the live state before
      // the checkpoint. The revoke below is recorded exactly as the trusted terminal command does.
      const admin = await signUp(app, "high_admin");
      const adminMe = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: admin } });
      const adminId = (adminMe.json() as { user: { id: string } }).user.id;
      await prisma.user.update({
        where: { id: adminId },
        data: { accountNumber: "10000042", isAdmin: true },
      });
      await prisma.adminGrant.create({ data: { userId: adminId, grantedBy: "test" } });
      await prisma.adminAllowEntry.create({ data: { userId: adminId, listedBy: "test" } });

      const inviteCreated = await app.inject({
        method: "POST",
        url: "/api/v1/admin/invites",
        headers: { cookie: admin },
        payload: { shape: "ordinary", note: "high-risk route test" },
      });
      expect(inviteCreated.statusCode).toBe(200);
      const inviteId = (inviteCreated.json() as { invite: { id: string } }).invite.id;

      const shareCreated = await app.inject({
        method: "POST",
        url: "/api/v1/share/links",
        headers: { cookie: owner, "x-libellum-book": sharedBookId },
        payload: { role: "viewer", days: 7, maxUses: 2 },
      });
      expect(shareCreated.statusCode).toBe(201);
      const shareId = (shareCreated.json() as { id: string }).id;

      const checkpointed = await createCheckpointedBackup({
        databaseUrl: process.env["DATABASE_URL"]!,
        dumpPath: dumpFile,
        pgDumpPath: pgDump,
        eventKey: test.key,
        label: "s13i-high-risk-routes",
      });

      // Everything below happened after the old full snapshot was taken.
      await lifecycle(app, owner, archiveBookId, "archive");
      const restoredBook = await app.inject({
        method: "POST",
        url: `/api/v1/account/archives/${restoreBookId}/restore`,
        headers: { cookie: owner },
      });
      expect(restoredBook.statusCode, restoredBook.body).toBe(200);
      await app.inject({
        method: "POST",
        url: `/api/v1/books/${disposeBookId}/dispose`,
        headers: { cookie: owner },
      });
      await lifecycle(app, owner, deleteBookId, "delete");
      await app.inject({
        method: "DELETE",
        url: `/api/v1/books/members/${guestId}`,
        headers: { cookie: owner, "x-libellum-book": sharedBookId },
      });
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/invites/" + inviteId + "/revoke",
        headers: { cookie: admin },
        payload: { reason: "route-level restoration test", password: PASSWORD },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/share/links/${shareId}/revoke`,
        headers: { cookie: owner, "x-libellum-book": sharedBookId },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/lifecycle/requests/${recoveryRequestId}/decide`,
        headers: { cookie: admin },
        payload: { password: PASSWORD, action: "approve" },
      });

      // This is the CLI-equivalent event shape; there is no HTTP route by design for granting or
      // revoking administration.
      await prisma.$transaction(async (tx) => {
        await tx.adminGrant.update({ where: { userId: adminId }, data: { revokedAt: new Date(), revokedBy: "test" } });
        await tx.user.update({ where: { id: adminId }, data: { isAdmin: false } });
        await recordCriticalEvent(tx, {
          type: "admin.revoked",
          actor: { userId: null },
          subjectType: "admin_grant",
          subjectId: adminId,
          beforeState: { isAdmin: true, revokedAt: null },
          afterState: { isAdmin: false, revokedAt: new Date().toISOString(), revokedBy: "test" },
        });
      });

      await flushPendingCriticalEvents(prisma, test.remote, test.key);
      const verified = await verifyRemoteLedger(test.remote, test.key);

      cli(pgRestore, [
        "-h", parts.host, "-p", parts.port, "-U", parts.user,
        "-d", restoreName, "--exit-on-error", dumpFile,
      ]);
      restored = createPrismaClient(restoreUrl.toString());
      const verifiedCheckpoint = await verifyRestoredCheckpoint(
        restored,
        checkpointed.checkpointFile,
        dumpFile,
        test.key,
      );
      const preview = await previewSafeRestore(restored, verified.events.map((entry) => entry.core));
      expect(preview.checkpoint.chainSeq).toBe(verifiedCheckpoint.chainSeq);
      // The old snapshot still contains every object below; that is the hazard being tested.
      expect(await restored.book.findUnique({ where: { id: archiveBookId } })).not.toBeNull();
      expect(await restored.book.findUnique({ where: { id: deleteBookId } })).not.toBeNull();

      const report = await applySafeRestore(
        restored,
        verified.events.map((entry) => entry.core),
        { afterSeq: verifiedCheckpoint.chainSeq },
      );
      expect(report.manualReview, JSON.stringify(report.manualReview)).toEqual([]);

      expect((await restored.book.findUniqueOrThrow({ where: { id: archiveBookId } })).archivedAt).not.toBeNull();
      expect((await restored.book.findUniqueOrThrow({ where: { id: restoreBookId } })).archivedAt).toBeNull();
      expect((await restored.book.findUniqueOrThrow({ where: { id: disposeBookId } })).disposedAt).not.toBeNull();
      expect(await restored.book.findUnique({ where: { id: deleteBookId } })).toBeNull();
      expect((await restored.book.findUniqueOrThrow({ where: { id: recoveryBookId } })).archivedAt).toBeNull();
      expect(await restored.book.findUnique({ where: { id: untouchedBookId } })).not.toBeNull();

      const membership = await restored.bookMember.findUniqueOrThrow({
        where: { bookId_userId: { bookId: sharedBookId, userId: guestId } },
      });
      expect(membership.leftAt).not.toBeNull();
      expect((await restored.adminGrant.findUnique({ where: { userId: adminId } }))).toBeNull();
      expect((await restored.adminAllowEntry.findUnique({ where: { userId: adminId } }))).toBeNull();
      expect((await restored.user.findUniqueOrThrow({ where: { id: adminId } })).isAdmin).toBe(false);
      expect((await restored.registrationInvite.findUniqueOrThrow({ where: { id: inviteId } })).revokedAt).not.toBeNull();
      expect((await restored.bookShareLink.findUniqueOrThrow({ where: { id: shareId } })).revokedAt).not.toBeNull();
      expect(await restored.session.count()).toBe(0);

      // The old snapshot's owner/guest rows are retained, but neither session nor admin privilege
      // is restored.
      expect(await restored.user.findUnique({ where: { id: ownerId } })).not.toBeNull();
    } finally {
      await app.close();
    }
  }, 240_000);
});
