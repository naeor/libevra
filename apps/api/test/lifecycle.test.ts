import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeApp, prisma, resetDatabase, signUp } from "./support.js";
import {
  approveRecoveryRequest,
  archiveBook,
  requestManualRecoveryForActiveAccount,
  restoreArchivedBook,
  runDuePurges,
} from "../src/lifecycle/book.js";

const DAY = 24 * 60 * 60 * 1000;
const BASE = new Date("2026-10-18T06:00:00.000Z");

interface Account {
  readonly cookie: string;
  readonly userId: string;
  readonly bookId: string;
  readonly accountNumber: string;
}

let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase();
  app = makeApp();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createAccount(username: string): Promise<Account> {
  const cookie = await signUp(app, username);
  const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
  const user = (me.json() as { user: { id: string; accountNumber: string } }).user;
  const books = await app.inject({ method: "GET", url: "/api/v1/books", headers: { cookie } });
  const book = (books.json() as { books: { id: string }[] }).books[0]!;
  return { cookie, userId: user.id, accountNumber: user.accountNumber, bookId: book.id };
}

async function addMember(bookId: string, userId: string, role: "editor" | "viewer" = "editor"): Promise<void> {
  await prisma.bookMember.create({ data: { bookId, userId, role } });
}

async function addEntry(cookie: string, bookId: string): Promise<void> {
  const category = await prisma.category.findFirstOrThrow({
    where: { bookId, isSystem: true },
    select: { id: true },
  });
  const id = randomUUID();
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/transactions",
    headers: { cookie, "x-libellum-book": bookId },
    payload: {
      id,
      idempotencyKey: id,
      kind: "expense",
      amountCents: 1234,
      currency: "CNY",
      categoryId: category.id,
      paymentMethodId: null,
      occurredAt: BASE.toISOString(),
      occurredLocalDate: "2026-10-18",
      occurredTz: "Asia/Shanghai",
      note: "S13-H lifecycle test entry",
      tagIds: [],
    },
  });
  expect(response.statusCode).toBe(201);
}

async function lifecycle(cookie: string, bookId: string): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/books/${bookId}/lifecycle`,
    headers: { cookie },
  });
  return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
}

describe("S13-H ledger lifecycle", () => {
  it("lets a creator leave a shared ledger by transferring management", async () => {
    const owner = await createAccount("lifecycle_owner");
    const guest = await createAccount("lifecycle_guest");
    await addMember(owner.bookId, guest.userId, "editor");

    const left = await app.inject({
      method: "POST",
      url: `/api/v1/books/${owner.bookId}/lifecycle`,
      headers: { cookie: owner.cookie },
      payload: { action: "leave" },
    });
    expect(left.statusCode).toBe(200);
    const book = await prisma.book.findUniqueOrThrow({ where: { id: owner.bookId } });
    expect(book.managedByUserId).toBe(guest.userId);
    const membership = await prisma.bookMember.findUniqueOrThrow({
      where: { bookId_userId: { bookId: owner.bookId, userId: owner.userId } },
      select: { leftAt: true },
    });
    expect(membership.leftAt).not.toBeNull();
  });

  it("refuses a last member's leave; one of two concurrent leaves wins", async () => {
    const owner = await createAccount("lifecycle_last_owner");
    const guest = await createAccount("lifecycle_last_guest");
    await addMember(owner.bookId, guest.userId, "editor");

    const [ownerResponse, guestResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/books/${owner.bookId}/lifecycle`,
        headers: { cookie: owner.cookie },
        payload: { action: "leave" },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/books/${owner.bookId}/lifecycle`,
        headers: { cookie: guest.cookie },
        payload: { action: "leave" },
      }),
    ]);
    expect([ownerResponse.statusCode, guestResponse.statusCode].sort()).toEqual([200, 409]);
    const active = await prisma.bookMember.count({ where: { bookId: owner.bookId, leftAt: null } });
    expect(active).toBe(1);
    const book = await prisma.book.findUniqueOrThrow({ where: { id: owner.bookId } });
    const manager = await prisma.bookMember.findUniqueOrThrow({
      where: { bookId_userId: { bookId: owner.bookId, userId: book.managedByUserId! } },
      select: { leftAt: true },
    });
    expect(manager.leftAt).toBeNull();
  });

  it("archives, blocks ordinary access, and restores within 60 days", async () => {
    const user = await createAccount("lifecycle_archive");
    await addEntry(user.cookie, user.bookId);

    const archived = await app.inject({
      method: "POST",
      url: `/api/v1/books/${user.bookId}/lifecycle`,
      headers: { cookie: user.cookie },
      payload: { action: "archive" },
    });
    expect(archived.statusCode).toBe(200);
    const state = await lifecycle(user.cookie, user.bookId);
    expect(state.statusCode).toBe(200);
    expect(state.body.archivedAt).not.toBeNull();
    expect(state.body.canSelfRestore).toBe(true);

    const blocked = await app.inject({
      method: "GET",
      url: "/api/v1/stats?from=2026-10-01&to=2026-10-31&currency=CNY",
      headers: { cookie: user.cookie, "x-libellum-book": user.bookId },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: "book_archived" });

    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/account/archives/${user.bookId}/restore`,
      headers: { cookie: user.cookie },
    });
    expect(restore.statusCode).toBe(200);
    const after = await app.inject({
      method: "GET",
      url: "/api/v1/stats?from=2026-10-01&to=2026-10-31&currency=CNY",
      headers: { cookie: user.cookie, "x-libellum-book": user.bookId },
    });
    expect(after.statusCode).toBe(200);
  });

  it("permanently deletes a single ledger, writes a tombstone and refuses replay", async () => {
    const user = await createAccount("lifecycle_delete");
    await addEntry(user.cookie, user.bookId);

    const deleted = await app.inject({
      method: "POST",
      url: `/api/v1/books/${user.bookId}/lifecycle`,
      headers: { cookie: user.cookie },
      payload: { action: "delete" },
    });
    expect(deleted.statusCode).toBe(200);
    expect(await prisma.book.findUnique({ where: { id: user.bookId } })).toBeNull();
    expect(await prisma.transaction.count({ where: { bookId: user.bookId } })).toBe(0);
    const tombstone = await prisma.bookTombstone.findUniqueOrThrow({ where: { bookId: user.bookId } });
    expect(tombstone.transactionCount).toBe(1);
    expect(tombstone.deletionMethod).toBe("self_delete");

    const replay = await app.inject({
      method: "GET",
      url: "/api/v1/stats?from=2026-10-01&to=2026-10-31&currency=CNY",
      headers: { cookie: user.cookie, "x-libellum-book": user.bookId },
    });
    expect(replay.statusCode).toBe(410);
    expect(replay.json()).toMatchObject({ code: "book_deleted" });
  });

  it("is atomic when a close request is incomplete", async () => {
    const owner = await createAccount("lifecycle_atomic");
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/books",
      headers: { cookie: owner.cookie },
      payload: { name: "第二本" },
    });
    const secondBookId = (second.json() as { id: string }).id;

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/account/close",
      headers: { cookie: owner.cookie },
      payload: {
        password: "correct-horse-battery",
        confirmation: "注销账号",
        method: "close_account",
        decisions: [{ bookId: owner.bookId, action: "archive" }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "book_decisions_incomplete" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(user.closedAt).toBeNull();
    expect(await prisma.book.findUnique({ where: { id: secondBookId } })).not.toBeNull();
  });

  it("closes an account atomically, leaves shared books and keeps archived books recoverable", async () => {
    const owner = await createAccount("close_owner");
    const guest = await createAccount("close_guest");
    await addMember(owner.bookId, guest.userId, "editor");
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/books",
      headers: { cookie: owner.cookie },
      payload: { name: "归档本" },
    });
    const archiveBookId = (second.json() as { id: string }).id;
    await addEntry(owner.cookie, archiveBookId);

    const closed = await app.inject({
      method: "POST",
      url: "/api/v1/account/close",
      headers: { cookie: owner.cookie },
      payload: {
        password: "correct-horse-battery",
        confirmation: "注销账号",
        method: "close_account",
        decisions: [
          { bookId: owner.bookId, action: "leave" },
          { bookId: archiveBookId, action: "archive" },
        ],
      },
    });
    expect(closed.statusCode).toBe(200);
    const result = closed.json() as { recoveryCredential: string; archivedBookIds: string[] };
    expect(result.recoveryCredential).toMatch(/^[A-F0-9]{32}$/);
    expect(result.archivedBookIds).toEqual([archiveBookId]);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(user.closedAt).not.toBeNull();
    expect(user.username.startsWith("closed_")).toBe(true);
    expect(
      await prisma.session.count({ where: { userId: owner.userId, revokedAt: null } }),
    ).toBe(0);
    expect(await prisma.accountTombstone.findFirst({ where: { accountNumber: user.accountNumber } })).not.toBeNull();
    expect(
      await prisma.bookMember.findUniqueOrThrow({
        where: { bookId_userId: { bookId: owner.bookId, userId: owner.userId } },
        select: { leftAt: true },
      }),
    ).toMatchObject({ leftAt: expect.any(Date) });

    const archive = await prisma.book.findUniqueOrThrow({ where: { id: archiveBookId } });
    expect(archive.archivedAt).not.toBeNull();
    expect(archive.archivedByUserId).toBe(owner.userId);

    const oldCookie = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: owner.cookie } });
    expect(oldCookie.statusCode).toBe(401);
    expect(oldCookie.json()).toMatchObject({ code: "account_closed" });
  });

  it("delete-data removes private ledgers and records no recovery credential", async () => {
    const owner = await createAccount("data_owner");
    const guest = await createAccount("data_guest");
    await addMember(owner.bookId, guest.userId, "editor");
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/books",
      headers: { cookie: owner.cookie },
      payload: { name: "删除本" },
    });
    const privateBookId = (second.json() as { id: string }).id;
    await addEntry(owner.cookie, privateBookId);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/account/delete-data",
      headers: { cookie: owner.cookie },
      payload: { password: "correct-horse-battery", confirmation: "删除服务器数据" },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { recoveryCredential: string | null }).recoveryCredential).toBeNull();
    expect(await prisma.book.findUnique({ where: { id: privateBookId } })).toBeNull();
    expect(await prisma.bookTombstone.findUnique({ where: { bookId: privateBookId } })).not.toBeNull();
    expect(
      await prisma.bookMember.findUniqueOrThrow({
        where: { bookId_userId: { bookId: owner.bookId, userId: owner.userId } },
        select: { leftAt: true },
      }),
    ).toMatchObject({ leftAt: expect.any(Date) });
  });

  it("purges exactly at 365 days and expires a pending request rather than holding forever", async () => {
    const user = await createAccount("lifecycle_purge");
    await archiveBook(prisma, { bookId: user.bookId, userId: user.userId, now: BASE });
    const request = await requestManualRecoveryForActiveAccount(
      prisma,
      user.bookId,
      user.userId,
      new Date(BASE.getTime() + 360 * DAY),
    );
    const early = await runDuePurges(prisma, new Date(BASE.getTime() + 364 * DAY + 23 * 60 * 60 * 1000));
    expect(early.purged).toBe(0);
    expect(await prisma.book.findUnique({ where: { id: user.bookId } })).not.toBeNull();

    const due = await runDuePurges(prisma, new Date(BASE.getTime() + 365 * DAY + 60 * 60 * 1000));
    expect(due.purged).toBe(1);
    expect(await prisma.book.findUnique({ where: { id: user.bookId } })).toBeNull();
    expect(await prisma.bookTombstone.findUnique({ where: { bookId: user.bookId } })).not.toBeNull();
    const expired = await prisma.bookRecoveryRequest.findUniqueOrThrow({ where: { id: request.requestId } });
    expect(expired.status).toBe("expired");
  });

  it("restores through an administrator-approved recovery request", async () => {
    const user = await createAccount("recovery_user");
    await addEntry(user.cookie, user.bookId);
    await archiveBook(prisma, { bookId: user.bookId, userId: user.userId, now: BASE });

    const request = await requestManualRecoveryForActiveAccount(
      prisma,
      user.bookId,
      user.userId,
      new Date(BASE.getTime() + 61 * DAY),
    );
    const approved = await approveRecoveryRequest(prisma, {
      requestId: request.requestId,
      adminUserId: user.userId,
      adminName: "test-admin",
    });
    expect(approved.bookId).toBe(user.bookId);
    const restored = await prisma.book.findUniqueOrThrow({ where: { id: user.bookId } });
    expect(restored.archivedAt).toBeNull();
    expect(restored.managedByUserId).toBe(user.userId);
  });

  it("keeps a closed account's archived book claimable only with its recovery credential", async () => {
    const owner = await createAccount("claim_owner");
    const target = await createAccount("claim_target");
    const archivedId = owner.bookId;
    await addEntry(owner.cookie, archivedId);
    const closed = await app.inject({
      method: "POST",
      url: "/api/v1/account/close",
      headers: { cookie: owner.cookie },
      payload: {
        password: "correct-horse-battery",
        confirmation: "注销账号",
        method: "close_account",
        decisions: [{ bookId: archivedId, action: "archive" }],
      },
    });
    expect(closed.statusCode).toBe(200);
    const result = closed.json() as { recoveryCredential: string };
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
    const book = await prisma.book.findUniqueOrThrow({ where: { id: archivedId } });

    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/account-recovery/request",
      payload: {
        accountNumber: user.accountNumber,
        recoveryCredential: "WRONG-WRONG-WRONG-WRONG",
        bookNumber: book.bookNumber,
      },
    });
    expect(wrong.statusCode).toBe(400);

    const valid = await app.inject({
      method: "POST",
      url: "/api/v1/account-recovery/request",
      payload: {
        accountNumber: user.accountNumber,
        recoveryCredential: result.recoveryCredential,
        bookNumber: book.bookNumber,
        targetAccountNumber: target.accountNumber,
      },
    });
    expect(valid.statusCode).toBe(201);
    const request = valid.json() as { requestId: string };

    const approved = await approveRecoveryRequest(prisma, {
      requestId: request.requestId,
      adminUserId: target.userId,
      adminName: "test-admin",
      targetAccountNumber: target.accountNumber,
    });
    expect(approved.bookId).toBe(archivedId);
    expect(await prisma.bookMember.findUniqueOrThrow({
      where: { bookId_userId: { bookId: archivedId, userId: target.userId } },
      select: { role: true, leftAt: true },
    })).toMatchObject({ role: "editor", leftAt: null });
  });

  it("allows export, ledger lifecycle and account closure while an agreement is missing", async () => {
    const user = await createAccount("no_consent_lifecycle");
    await prisma.agreementAcceptance.deleteMany({ where: { userId: user.userId } });

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/account/lifecycle",
      headers: { cookie: user.cookie },
    });
    expect(overview.statusCode).toBe(200);

    const archived = await app.inject({
      method: "POST",
      url: `/api/v1/books/${user.bookId}/lifecycle`,
      headers: { cookie: user.cookie },
      payload: { action: "archive" },
    });
    expect(archived.statusCode).toBe(200);

    const closed = await app.inject({
      method: "POST",
      url: "/api/v1/account/close",
      headers: { cookie: user.cookie },
      payload: {
        password: "correct-horse-battery",
        confirmation: "注销账号",
        method: "close_account",
        decisions: [{ bookId: user.bookId, action: "keep_archived" }],
      },
    });
    expect(closed.statusCode).toBe(200);
    expect((closed.json() as { recoveryCredential: string | null }).recoveryCredential).not.toBeNull();
  });

  it("lets an administrator approve a recovery request without exposing ledger content", async () => {
    const owner = await createAccount("admin_recovery_owner");
    const admin = await createAccount("admin_recovery_admin");
    await prisma.user.update({ where: { id: admin.userId }, data: { accountNumber: "10000042", isAdmin: true } });
    await prisma.adminGrant.create({ data: { userId: admin.userId, grantedBy: "test" } });
    await prisma.adminAllowEntry.create({ data: { userId: admin.userId, listedBy: "test" } });

    await addEntry(owner.cookie, owner.bookId);
    await archiveBook(prisma, { bookId: owner.bookId, userId: owner.userId, now: BASE });
    const request = await requestManualRecoveryForActiveAccount(
      prisma,
      owner.bookId,
      owner.userId,
      new Date(BASE.getTime() + 61 * DAY),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/lifecycle/requests/${request.requestId}/decide`,
      headers: { cookie: admin.cookie },
      payload: {
        password: "correct-horse-battery",
        action: "approve",
        note: "test approval",
      },
    });
    expect(response.statusCode).toBe(200);
    const restored = await prisma.book.findUniqueOrThrow({ where: { id: owner.bookId } });
    expect(restored.archivedAt).toBeNull();
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { action: "book.recovery.approve" },
    });
    expect(audit.outcome).toBe("success");
    expect(audit.target).toContain(owner.bookId);
  });

  it("rolls back every book decision when one purge is blocked", async () => {
    const owner = await createAccount("atomic_owner");
    const guest = await createAccount("atomic_guest");
    await addMember(owner.bookId, guest.userId, "editor");
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/books",
      headers: { cookie: owner.cookie },
      payload: { name: "有申请的归档本" },
    });
    const archivedBookId = (second.json() as { id: string }).id;
    await archiveBook(prisma, { bookId: archivedBookId, userId: owner.userId, now: BASE });
    await requestManualRecoveryForActiveAccount(
      prisma,
      archivedBookId,
      owner.userId,
      new Date(BASE.getTime() + 61 * DAY),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/account/close",
      headers: { cookie: owner.cookie },
      payload: {
        password: "correct-horse-battery",
        confirmation: "注销账号",
        method: "close_account",
        decisions: [
          { bookId: owner.bookId, action: "leave" },
          { bookId: archivedBookId, action: "delete" },
        ],
      },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(user.closedAt).toBeNull();
    const sharedMembership = await prisma.bookMember.findUniqueOrThrow({
      where: { bookId_userId: { bookId: owner.bookId, userId: owner.userId } },
      select: { leftAt: true },
    });
    expect(sharedMembership.leftAt).toBeNull();
    expect(await prisma.book.findUnique({ where: { id: archivedBookId } })).not.toBeNull();
  });

  it("keeps purge and restore mutually exclusive", async () => {
    const user = await createAccount("race_user");
    await archiveBook(prisma, { bookId: user.bookId, userId: user.userId, now: BASE });
    const due = new Date(BASE.getTime() + 366 * DAY);
    const [purgeResult, restoreResult] = await Promise.allSettled([
      runDuePurges(prisma, due),
      restoreArchivedBook(prisma, user.bookId, user.userId, due),
    ]);
    expect(purgeResult.status).toBe("fulfilled");
    const book = await prisma.book.findUnique({ where: { id: user.bookId } });
    if (book === null) {
      expect(restoreResult.status).toBe("rejected");
      expect(await prisma.bookTombstone.findUnique({ where: { bookId: user.bookId } })).not.toBeNull();
    } else {
      expect(book.archivedAt).toBeNull();
      expect(restoreResult.status).toBe("fulfilled");
    }
  });

  it("creates no unrecoverable account: a managed shared ledger without a successor blocks closure", async () => {
    const owner = await createAccount("block_owner");
    const viewer = await createAccount("block_viewer");
    await addMember(owner.bookId, viewer.userId, "viewer");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/account/close",
      headers: { cookie: owner.cookie },
      payload: {
        password: "correct-horse-battery",
        confirmation: "注销账号",
        method: "close_account",
        decisions: [{ bookId: owner.bookId, action: "leave" }],
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "account_close_blocked" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } })).closedAt).toBeNull();
  });
});
