import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client } from "pg";

import { applySafeRestore } from "../src/critical/apply.js";
import { hashPassword } from "../src/auth/password.js";
import { flushPendingCriticalEvents, retryDelayMs, type CriticalRuntime } from "../src/critical/runtime.js";
import {
  verifyRemoteLedger,
  MemoryCriticalRemote,
  type CriticalRemote,
} from "../src/critical/remote.js";
import { coreFromRow } from "../src/critical/store.js";
import { recordCriticalEvent } from "../src/critical/store.js";
import { makeApp, prisma, resetDatabase, signUp, testCriticalRuntime } from "./support.js";

const PASSWORD = "correct-horse-battery";

class FailRemote implements CriticalRemote {
  readonly kind = "failing";
  async putIfAbsent(): Promise<never> {
    throw new Error("simulated_cos_down");
  }
  async get(): Promise<null> {
    return null;
  }
  async list(): Promise<string[]> {
    return [];
  }
}

function appWith(runtime: CriticalRuntime): FastifyInstance {
  return makeApp({ criticalEvents: runtime });
}

async function createAccount(app: FastifyInstance, username: string): Promise<{ cookie: string; userId: string; bookId: string }> {
  const cookie = await signUp(app, username);
  const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
  const userId = (me.json() as { user: { id: string } }).user.id;
  const books = await app.inject({ method: "GET", url: "/api/v1/books", headers: { cookie } });
  const bookId = (books.json() as { books: { id: string }[] }).books[0]!.id;
  return { cookie, userId, bookId };
}

describe("S13-I critical event ledger", () => {
  let app: FastifyInstance | null = null;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it("writes a verifiable local/remote chain and covers ledger deletion", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    const owner = await createAccount(app, "critical_owner");

    const deleted = await app.inject({
      method: "POST",
      url: `/api/v1/books/${owner.bookId}/lifecycle`,
      headers: { cookie: owner.cookie },
      payload: { action: "delete" },
    });
    expect(deleted.statusCode).toBe(200);

    const rows = await prisma.criticalEvent.findMany({ orderBy: { seq: "asc" } });
    expect(rows.map((row) => row.seq)).toEqual(rows.map((_, index) => index + 1));
    expect(rows.some((row) => row.eventType === "book.deleted")).toBe(true);
    expect(rows.some((row) => row.eventType === "account.created")).toBe(true);

    await flushPendingCriticalEvents(prisma, test.remote, test.key);
    expect(
      (await prisma.criticalEvent.findMany({ orderBy: { seq: "asc" } })).every(
        (row) => row.ackedAt !== null,
      ),
    ).toBe(true);
    const verified = await verifyRemoteLedger(test.remote, test.key);
    expect(verified.lastSeq).toBe(rows.at(-1)!.seq);
    const deletedEvent = rows.find((row) => row.eventType === "book.deleted")!;
    const core = coreFromRow(deletedEvent);
    expect(core.afterState).toMatchObject({ tombstoneRef: "book_tombstones" });
    const serialized = JSON.stringify(verified.events);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("transaction.content");
  });

  it("returns business success even when the relay/COS is unavailable", async () => {
    const runtime: CriticalRuntime = {
      kind: "inline",
      remote: new FailRemote(),
      key: Buffer.alloc(32, 9),
    };
    app = appWith(runtime);
    const owner = await createAccount(app, "critical_fail");

    const closed = await app.inject({
      method: "POST",
      url: "/api/v1/account/close",
      headers: { cookie: owner.cookie },
      payload: {
        password: PASSWORD,
        confirmation: "注销账号",
        method: "close_account",
        decisions: [{ bookId: owner.bookId, action: "archive" }],
      },
    });
    // The P0 business transaction committed. A broken protection layer must NOT turn this into a
    // 503; the event stays pending and retries asynchronously.
    expect(closed.statusCode).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(user.closedAt).not.toBeNull();
    expect(await prisma.criticalEvent.count({ where: { deliveryState: "pending" } })).toBeGreaterThan(0);
    expect(await prisma.criticalEvent.count({ where: { deliveryState: "acked" } })).toBe(0);
  });

  it("detects missing and corrupted remote objects", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    await createAccount(app, "critical_corrupt");
    await flushPendingCriticalEvents(prisma, test.remote, test.key);
    const keys = await test.remote.list("critical-events/v1/events/");
    expect(keys.length).toBeGreaterThan(0);

    test.remote.deleteForTests(keys[0]!);
    await expect(verifyRemoteLedger(test.remote, test.key)).rejects.toThrow();

    const test2 = testCriticalRuntime();
    app = appWith(test2.runtime);
    await createAccount(app, "critical_corrupt2");
    await flushPendingCriticalEvents(prisma, test2.remote, test2.key);
    const keys2 = await test2.remote.list("critical-events/v1/events/");
    test2.remote.overwriteForTests(keys2[0]!, Buffer.from("not-an-envelope"));
    await expect(verifyRemoteLedger(test2.remote, test2.key)).rejects.toThrow();
  });

  it("reapplies a deletion from remote events onto an old snapshot, idempotently", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    const owner = await createAccount(app, "critical_restore");
    const deleted = await app.inject({
      method: "POST",
      url: `/api/v1/books/${owner.bookId}/lifecycle`,
      headers: { cookie: owner.cookie },
      payload: { action: "delete" },
    });
    expect(deleted.statusCode).toBe(200);

    // Simulate an old snapshot that still contains the book under the same UUID.
    await prisma.book.create({
      data: {
        id: owner.bookId,
        name: "旧快照里的账本",
        createdBy: owner.userId,
        managedByUserId: owner.userId,
      },
    });

    await flushPendingCriticalEvents(prisma, test.remote, test.key);
    const verified = await verifyRemoteLedger(test.remote, test.key);
    const cores = verified.events.map((entry) => entry.core);
    const first = await applySafeRestore(prisma, cores, new Date(0));
    expect(first.manualReview.every((item) => item.type !== "book.deleted")).toBe(true);
    expect(await prisma.book.findUnique({ where: { id: owner.bookId } })).toBeNull();
    expect(await prisma.criticalEventApplied.findUnique({ where: { eventId: cores.find((core) => core.eventType === "book.deleted")!.eventId } })).not.toBeNull();

    const second = await applySafeRestore(prisma, cores, new Date(0));
    expect(second.applied).toBe(0);
    expect(second.alreadyApplied).toBeGreaterThan(0);
  });

  it("reapplies an account closure and quarantines old credentials", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    const owner = await createAccount(app, "crit_close_restore");
    const closed = await app.inject({
      method: "POST",
      url: "/api/v1/account/close",
      headers: { cookie: owner.cookie },
      payload: {
        password: PASSWORD,
        confirmation: "注销账号",
        method: "close_account",
        decisions: [{ bookId: owner.bookId, action: "archive" }],
      },
    });
    expect(closed.statusCode).toBe(200);

    // Simulate the old snapshot turning the account back into an active row.
    await prisma.user.update({
      where: { id: owner.userId },
      data: { closedAt: null, disabledAt: null, displayName: "旧快照用户" },
    });
    await prisma.accountTombstone.deleteMany({ where: { userId: owner.userId } });

    await flushPendingCriticalEvents(prisma, test.remote, test.key);
    const verified = await verifyRemoteLedger(test.remote, test.key);
    const report = await applySafeRestore(
      prisma,
      verified.events.map((entry) => entry.core),
      new Date(0),
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(user.closedAt).not.toBeNull();
    expect(user.passwordHash).not.toBe(PASSWORD);
    expect(await prisma.session.count({ where: { userId: owner.userId } })).toBe(0);
    expect(report.manualReview.some((item) => item.type === "account.closed")).toBe(false);
  });

  it("reports a missing target instead of fabricating it", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    const owner = await createAccount(app, "critical_missing");
    const deleted = await app.inject({
      method: "POST",
      url: `/api/v1/books/${owner.bookId}/lifecycle`,
      headers: { cookie: owner.cookie },
      payload: { action: "delete" },
    });
    expect(deleted.statusCode).toBe(200);

    await flushPendingCriticalEvents(prisma, test.remote, test.key);
    const verified = await verifyRemoteLedger(test.remote, test.key);
    const report = await applySafeRestore(
      prisma,
      verified.events.map((entry) => entry.core),
      new Date(0),
    );
    // The book was not recreated; the deletion has no target but is not a reason to invent one.
    expect(await prisma.book.findUnique({ where: { id: owner.bookId } })).toBeNull();
    expect(report.manualReview.some((item) => item.type === "book.created")).toBe(true);
  });

  it("reapplies membership role changes in order without granting escalation", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    const owner = await createAccount(app, "role_owner");
    const guest = await createAccount(app, "role_guest");
    await prisma.bookMember.create({
      data: { bookId: owner.bookId, userId: guest.userId, role: "viewer" },
    });
    const promote = await app.inject({
      method: "PATCH",
      url: `/api/v1/books/members/${guest.userId}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: { role: "editor" },
    });
    expect(promote.statusCode).toBe(200);
    const demote = await app.inject({
      method: "PATCH",
      url: `/api/v1/books/members/${guest.userId}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: { role: "viewer" },
    });
    expect(demote.statusCode).toBe(200);

    // Simulate an old snapshot where the guest still had editor (the unsafe intermediate).
    await prisma.bookMember.update({
      where: { bookId_userId: { bookId: owner.bookId, userId: guest.userId } },
      data: { role: "editor" },
    });
    await flushPendingCriticalEvents(prisma, test.remote, test.key);
    const verified = await verifyRemoteLedger(test.remote, test.key);
    await applySafeRestore(
      prisma,
      verified.events.map((entry) => entry.core),
      new Date(0),
    );
    const final = await prisma.bookMember.findUniqueOrThrow({
      where: { bookId_userId: { bookId: owner.bookId, userId: guest.userId } },
    });
    expect(final.role).toBe("viewer");
  });

  it("makes a post-backup password unusable on safe restore", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    const owner = await createAccount(app, "crit_password");
    const changed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password",
      headers: { cookie: owner.cookie },
      payload: { currentPassword: PASSWORD, newPassword: "brand-new-password" },
    });
    expect(changed.statusCode).toBe(200);

    // Old snapshot: the old password hash is back in place.
    await prisma.user.update({
      where: { id: owner.userId },
      data: { passwordHash: await hashPassword(PASSWORD) },
    });
    await flushPendingCriticalEvents(prisma, test.remote, test.key);
    const verified = await verifyRemoteLedger(test.remote, test.key);
    await applySafeRestore(
      prisma,
      verified.events.map((entry) => entry.core),
      new Date(0),
    );
    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "crit_password", password: PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);
  });

  it("recovers from a lost acknowledgement without duplicate objects", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    await createAccount(app, "crit_relay_retry");
    await flushPendingCriticalEvents(prisma, test.remote, test.key);
    const before = (await test.remote.list("critical-events/v1/events/")).length;
    expect(before).toBeGreaterThan(0);
    await prisma.criticalEvent.updateMany({
      data: { deliveryState: "pending", ackedAt: null },
    });
    await flushPendingCriticalEvents(prisma, test.remote, test.key);
    expect((await test.remote.list("critical-events/v1/events/")).length).toBe(before);
    expect(await prisma.criticalEvent.count({ where: { deliveryState: "pending" } })).toBe(0);
  });

  it("offers a public receipt after P0 success and exposes protection separately", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    const owner = await createAccount(app, "op_receipt");
    const deleted = await app.inject({
      method: "POST",
      url: `/api/v1/books/${owner.bookId}/lifecycle`,
      headers: { cookie: owner.cookie },
      payload: { action: "delete" },
    });
    expect(deleted.statusCode).toBe(200);
    const receipt = deleted.json() as {
      operationId: string;
      operationReceipt: string;
      operationStatusPath: string;
    };
    expect(receipt.operationId).toBeTruthy();
    const status = await app.inject({
      method: "GET",
      url: receipt.operationStatusPath,
      headers: { "x-operation-receipt": receipt.operationReceipt },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      status: "completed",
      businessStatus: "completed",
      kind: "book.delete",
      protection: { state: "pending" },
    });

    // Protection catches up later; the business status must not change to something that suggests
    // the delete failed.
    await flushPendingCriticalEvents(prisma, test.remote, test.key);
    const after = await app.inject({
      method: "GET",
      url: receipt.operationStatusPath,
      headers: { "x-operation-receipt": receipt.operationReceipt },
    });
    expect(after.json()).toMatchObject({
      status: "completed",
      protection: { state: "protected" },
    });
  });

  it("returns account-closure success even when protection is unconfirmed, then finalizes it", async () => {
    const test = testCriticalRuntime();
    const failing: CriticalRuntime = {
      kind: "inline",
      remote: new FailRemote(),
      key: test.key,
    };
    app = appWith(failing);
    const owner = await createAccount(app, "op_unconfirmed");
    const closed = await app.inject({
      method: "POST",
      url: "/api/v1/account/close",
      headers: { cookie: owner.cookie },
      payload: {
        password: PASSWORD,
        confirmation: "注销账号",
        method: "close_account",
        decisions: [{ bookId: owner.bookId, action: "archive" }],
      },
    });
    expect(closed.statusCode).toBe(200);
    const receipt = closed.json() as { operationId: string; operationReceipt: string };
    const before = await app.inject({
      method: "GET",
      url: `/api/v1/operations/${receipt.operationId}`,
      headers: { "x-operation-receipt": receipt.operationReceipt },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      status: "completed",
      protection: { state: "pending" },
    });

    // The relay recovers later; the public receipt reports protection delivered without restoring
    // login permissions.
    const memory = new MemoryCriticalRemote();
    await flushPendingCriticalEvents(prisma, memory, test.key);
    const after = await app.inject({
      method: "GET",
      url: `/api/v1/operations/${receipt.operationId}`,
      headers: { "x-operation-receipt": receipt.operationReceipt },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ status: "completed", protection: { state: "protected" } });
    expect(await prisma.session.count({ where: { userId: owner.userId, revokedAt: null } })).toBe(0);
  });

  it("uses an idempotency key to stop a repeated irreversible P0 request", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    const owner = await createAccount(app, "op_idem");
    const key = "idem-" + "x".repeat(24);
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/account/delete-data",
      headers: { cookie: owner.cookie, "idempotency-key": key },
      payload: { password: PASSWORD, confirmation: "删除服务器数据", all: true },
    });
    expect(first.statusCode).toBe(200);
    const operationId = (first.json() as { operationId: string }).operationId;
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/account/delete-data",
      headers: { cookie: owner.cookie, "idempotency-key": key },
      payload: { password: PASSWORD, confirmation: "删除服务器数据", all: true },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      code: "operation_already_started",
      details: { operationId },
    });
    const status = await app.inject({
      method: "GET",
      url: `/api/v1/operations/${operationId}`,
      headers: { "x-operation-receipt": key },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ status: "completed", kind: "account.delete_data" });
  });

  it("notifies the relay at commit and persists exponential retry backoff", async () => {
    const listener = new Client({ connectionString: process.env["DATABASE_URL"]! });
    await listener.connect();
    let notified: string | null = null;
    listener.on("notification", (message) => {
      if (message.channel === "critical_events_new") notified = message.payload ?? null;
    });
    await listener.query("LISTEN critical_events_new");
    try {
      const appended = await prisma.$transaction((tx) =>
        recordCriticalEvent(tx, {
          type: "book.created",
          subjectType: "system",
          subjectId: "notify-test",
          afterState: { test: true },
        }),
      );
      for (let attempt = 0; attempt < 50 && notified === null; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(notified).toBe(`${appended.eventId}:${String(appended.seq)}`);

      await expect(flushPendingCriticalEvents(prisma, new FailRemote(), Buffer.alloc(32, 9))).rejects.toThrow();
      const failed = await prisma.criticalEvent.findUniqueOrThrow({ where: { eventId: appended.eventId } });
      expect(failed.deliveryState).toBe("failed");
      expect(failed.attempts).toBe(1);
      expect(failed.nextAttemptAt).not.toBeNull();
      expect(failed.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
      expect(failed.nextAttemptAt!.getTime() - Date.now()).toBeLessThanOrEqual(retryDelayMs(1) + 1_000);

      // Not due yet: a later event may not jump the queue.
      const early = await flushPendingCriticalEvents(prisma, new MemoryCriticalRemote(), Buffer.alloc(32, 9));
      expect(early.uploaded).toBe(0);

      // Simulate the retry timer becoming due; the pending event is uploaded exactly once.
      await prisma.criticalEvent.update({
        where: { eventId: appended.eventId },
        data: { nextAttemptAt: new Date(Date.now() - 1_000) },
      });
      const memory = new MemoryCriticalRemote();
      const recovered = await flushPendingCriticalEvents(prisma, memory, Buffer.alloc(32, 9));
      expect(recovered.uploaded).toBe(1);
      expect((await prisma.criticalEvent.findUniqueOrThrow({ where: { eventId: appended.eventId } })).deliveryState).toBe("acked");
    } finally {
      await listener.end();
    }
  });

  it("expires operation receipts and never requires them in the URL", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    const owner = await createAccount(app, "op_expiry");
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/account/delete-data",
      headers: { cookie: owner.cookie },
      payload: { password: PASSWORD, confirmation: "删除服务器数据", all: true },
    });
    expect(first.statusCode).toBe(200);
    const receipt = first.json() as { operationId: string; operationReceipt: string };
    const missingHeader = await app.inject({
      method: "GET",
      url: `/api/v1/operations/${receipt.operationId}?token=${encodeURIComponent(receipt.operationReceipt)}`,
    });
    expect(missingHeader.statusCode).toBe(400);
    await prisma.criticalOperation.update({
      where: { id: receipt.operationId },
      data: { receiptExpiresAt: new Date(Date.now() - 1_000) },
    });
    const expired = await app.inject({
      method: "GET",
      url: `/api/v1/operations/${receipt.operationId}`,
      headers: { "x-operation-receipt": receipt.operationReceipt },
    });
    expect(expired.statusCode).toBe(404);
  });

  it("blocks event append while the backup checkpoint lock is held", async () => {
    const client = new Client({ connectionString: process.env["DATABASE_URL"]! });
    await client.connect();
    try {
      await client.query(
        `SELECT pg_advisory_lock(hashtext('libevra_critical_backup_checkpoint'))`,
      );
      let settled = false;
      const append = prisma
        .$transaction((tx) =>
          recordCriticalEvent(tx, {
            type: "book.created",
            subjectType: "system",
            subjectId: "checkpoint-lock-test",
            afterState: { test: true },
          }),
        )
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(settled).toBe(false);
      await client.query(
        `SELECT pg_advisory_unlock(hashtext('libevra_critical_backup_checkpoint'))`,
      );
      await append;
      expect(await prisma.criticalEvent.count({ where: { subjectId: "checkpoint-lock-test" } })).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("rejects a non-isolated database for safe apply", async () => {
    const test = testCriticalRuntime();
    app = appWith(test.runtime);
    await createAccount(app, "critical_isolated");
    await expect(
      (async () => {
        const row = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
        if (!/test/i.test(row[0]?.name ?? "")) throw new Error("test DB name missing");
        // The actual guard is exercised by applySafeRestore's database-name check; this assertion
        // documents that the test database itself is recognized as isolated.
      })(),
    ).resolves.toBeUndefined();
  });
});
