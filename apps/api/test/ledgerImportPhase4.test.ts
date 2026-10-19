import { randomUUID } from "node:crypto";

import {
  fingerprintGuestSource,
  fingerprintTargetSnapshot,
  importJobRequestSchema,
  type GuestImportSource,
} from "@libellum/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createImportJob,
  finalizeImportJobForTest,
  recoverImportJobs,
  runImportJobBatchForTest,
  sweepStaleImportJobs,
} from "../src/ledger/importJob.js";
import { loadTargetSnapshot } from "../src/ledger/importTarget.js";
import { asImportLockOwner, makeApp, prisma, resetDatabase, signUp } from "./support.js";

describe("reversible import and business locks (D5 phase 4)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = makeApp();
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function account(username: string) {
    const cookie = await signUp(app, username);
    const user = await prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true } });
    const book = await prisma.book.findFirstOrThrow({
      where: { createdBy: user.id, disposedAt: null },
      select: { id: true },
    });
    return { cookie, userId: user.id, bookId: book.id };
  }

  async function categoryOf(cookie: string, bookId: string) {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie, "x-libellum-book": bookId },
    });
    const ledger = response.json() as { categories: { id: string; name: string; kind: "expense" }[] };
    return ledger.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
  }

  function sourceOf(categoryId: string, categoryName: string, count = 3): GuestImportSource {
    return {
      name: `可撤销来源 ${randomUUID().slice(0, 6)}`,
      guestBookId: `guest-book-${randomUUID().slice(0, 8)}`,
      categories: [
        {
          id: categoryId,
          name: categoryName,
          kind: "expense",
          description: null,
          sortOrder: 0,
          isArchived: false,
          isSystem: false,
        },
      ],
      paymentMethods: [],
      tags: [],
      transactions: Array.from({ length: count }, (_, index) => ({
        id: randomUUID(),
        kind: "expense" as const,
        amountCents: 1_000 + index,
        currency: "CNY" as const,
        categoryId,
        paymentMethodId: null,
        occurredAt: new Date(Date.UTC(2026, 9, 18, 0, index, 0)).toISOString(),
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: `可撤销记录${String(index)}`,
        tagIds: [],
      })),
    };
  }

  async function jobRequest(
    bookId: string,
    source: GuestImportSource,
    categoryId: string,
    targetCategoryId: string | null,
    options: {
      batchSize?: number;
      incrementalDecisions?: { sourceTransactionId: string; action: "keep_target" | "update_target" | "import" | "skip" }[];
    } = {},
  ) {
    const target = await loadTargetSnapshot(prisma, bookId);
    return importJobRequestSchema.parse({
      importId: randomUUID(),
      target: { kind: "existing", bookId, expectedTargetFingerprint: await fingerprintTargetSnapshot(target) },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [
        {
          type: "category",
          sourceId: categoryId,
          action: targetCategoryId === null ? "create" : "reuse",
          ...(targetCategoryId === null ? { createName: "撤销测试分类" } : { targetId: targetCategoryId }),
        },
      ],
      duplicateGroups: [],
      batchSize: options.batchSize ?? 2,
      incrementalDecisions: options.incrementalDecisions ?? [],
    });
  }

  async function awaitStatus(cookie: string, jobId: string, wanted: readonly string[]): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/ledger-imports/jobs/${jobId}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      const job = response.json() as Record<string, unknown>;
      if (wanted.includes(job["status"] as string)) return job;
      if (Date.now() > deadline) throw new Error(`status timeout: ${String(job["status"])}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("undoes created transactions, taxonomy, source states and releases the lock", async () => {
    const owner = await account("p4_undo_create");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const source = sourceOf(sourceCategoryId, "撤销新建分类", 3);
    const request = await jobRequest(owner.bookId, source, sourceCategoryId, null);
    const job = await createImportJob(prisma, owner.userId, request, {
      startImmediately: false,
      timeoutSeconds: 2,
    });
    while ((await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: job.id } })).nextBatch < 2) {
      await runImportJobBatchForTest(prisma, job.id);
    }
    await finalizeImportJobForTest(prisma, job.id);
    const awaiting = await awaitStatus(owner.cookie, job.id, ["awaiting_confirmation"]);
    expect(awaiting).toMatchObject({ canConfirm: true, canUndo: true });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(3);
    expect(await prisma.ledgerImport.findUnique({ where: { id: job.id } })).toBeNull();
    expect(await prisma.category.count({ where: { bookId: owner.bookId, name: "撤销测试分类" } })).toBe(1);

    const undo = await app.inject({
      method: "POST",
      url: `/api/v1/ledger-imports/jobs/${job.id}/undo`,
      headers: { cookie: owner.cookie },
    });
    expect(undo.statusCode).toBe(200);
    const undone = await awaitStatus(owner.cookie, job.id, ["undone", "undo_failed"]);
    expect(undone["status"]).toBe("undone");
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(0);
    expect(await prisma.ledgerImportSourceState.count({ where: { targetBookId: owner.bookId } })).toBe(0);
    expect(await prisma.category.count({ where: { bookId: owner.bookId, name: "撤销测试分类" } })).toBe(0);
    expect(await prisma.ledgerWriteLock.count({ where: { bookId: owner.bookId, releasedAt: null } })).toBe(0);
    // The ledger is usable again after the safe undo.
    const writable = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        kind: "expense",
        amountCents: 123,
        currency: "CNY",
        categoryId: category.id,
        paymentMethodId: null,
        occurredAt: "2026-10-18T03:00:00.000Z",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "撤销后写入",
        tagIds: [],
      },
    });
    expect(writable.statusCode).toBe(201);
  }, 40_000);

  it("restores an updated target row and confirms before exposing the receipt/cleanup", async () => {
    const owner = await account("p4_undo_update");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const first = sourceOf(sourceCategoryId, category.name, 1);
    const smallResponse = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: {
        importId: randomUUID(),
        target: { kind: "existing", bookId: owner.bookId, expectedTargetFingerprint: await fingerprintTargetSnapshot(await loadTargetSnapshot(prisma, owner.bookId)) },
        source: first,
        sourceFingerprint: await fingerprintGuestSource(first),
        taxonomy: [{ type: "category", sourceId: sourceCategoryId, action: "reuse", targetId: category.id }],
        duplicateGroups: [],
        incrementalDecisions: [],
      },
    });
    expect(smallResponse.statusCode).toBe(200);
    const targetRow = await prisma.transaction.findFirstOrThrow({ where: { bookId: owner.bookId } });
    const changedSource: GuestImportSource = {
      ...first,
      transactions: [{ ...first.transactions[0]!, amountCents: 9_999, note: "撤销前的新内容" }],
    };
    const request = await jobRequest(owner.bookId, changedSource, sourceCategoryId, category.id, {
      incrementalDecisions: [
        { sourceTransactionId: changedSource.transactions[0]!.id, action: "update_target" },
      ],
    });
    const job = await createImportJob(prisma, owner.userId, request, {
      startImmediately: false,
      timeoutSeconds: 2,
    });
    while ((await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: job.id } })).nextBatch < 1) {
      await runImportJobBatchForTest(prisma, job.id);
    }
    await finalizeImportJobForTest(prisma, job.id);
    await awaitStatus(owner.cookie, job.id, ["awaiting_confirmation"]);
    // Waiting cannot expose a cleanup receipt.
    const blockedCleanup = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/guest-cleanup-preview",
      headers: { cookie: owner.cookie },
      payload: {
        targetBookId: owner.bookId,
        guestBookId: first.guestBookId,
        receiptId: job.id,
        source: changedSource,
      },
    });
    expect(blockedCleanup.statusCode).toBe(404);

    // Fault injection: force a target version drift underneath the lock (a real device cannot do
    // this). Undo must fail safely, keep the lock, and only succeed after reconciliation.
    await asImportLockOwner(job.id, (tx) =>
      tx.transaction.update({
        where: { id: targetRow.id },
        data: { version: targetRow.version + 2 },
      }),
    );
    const firstUndo = await app.inject({
      method: "POST",
      url: `/api/v1/ledger-imports/jobs/${job.id}/undo`,
      headers: { cookie: owner.cookie },
    });
    expect(firstUndo.statusCode, firstUndo.body).toBe(200);
    const failed = await awaitStatus(owner.cookie, job.id, ["undo_failed"]);
    expect(failed["status"]).toBe("undo_failed");
    expect(await prisma.ledgerWriteLock.count({ where: { bookId: owner.bookId, releasedAt: null } })).toBe(1);
    await asImportLockOwner(job.id, (tx) =>
      tx.transaction.update({
        where: { id: targetRow.id },
        data: { version: targetRow.version + 1 },
      }),
    );

    await app.inject({
      method: "POST",
      url: `/api/v1/ledger-imports/jobs/${job.id}/undo`,
      headers: { cookie: owner.cookie },
    });
    const undone = await awaitStatus(owner.cookie, job.id, ["undone", "undo_failed"]);
    expect(undone["status"]).toBe("undone");
    const restored = await prisma.transaction.findUniqueOrThrow({ where: { id: targetRow.id } });
    expect(restored.amountCents).toBe(targetRow.amountCents);
    expect(restored.note).toBe(targetRow.note);
    expect(await prisma.ledgerImport.findUnique({ where: { id: job.id } })).toBeNull();
    expect(await prisma.ledgerWriteLock.count({ where: { bookId: owner.bookId, releasedAt: null } })).toBe(0);
  }, 40_000);

  it("auto-undoes an awaiting job after the server-side deadline and recovers the baseline", async () => {
    const owner = await account("p4_timeout");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const source = sourceOf(sourceCategoryId, category.name, 2);
    const request = await jobRequest(owner.bookId, source, sourceCategoryId, category.id);
    const job = await createImportJob(prisma, owner.userId, request, {
      startImmediately: false,
      timeoutSeconds: 2,
    });
    while ((await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: job.id } })).nextBatch < 1) {
      await runImportJobBatchForTest(prisma, job.id);
    }
    await finalizeImportJobForTest(prisma, job.id);
    await awaitStatus(owner.cookie, job.id, ["awaiting_confirmation"]);
    await prisma.ledgerImportJob.update({
      where: { id: job.id },
      data: { confirmationDeadline: new Date(Date.now() - 1_000) },
    });
    await sweepStaleImportJobs(prisma, new Date());
    const undone = await awaitStatus(owner.cookie, job.id, ["undone", "undo_failed"]);
    expect(undone["status"]).toBe("undone");
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(0);
    expect(await prisma.ledgerWriteLock.count({ where: { bookId: owner.bookId, releasedAt: null } })).toBe(0);
  }, 40_000);

  it("blocks only the locked ledger and refuses a second importer", async () => {
    const owner = await account("p4_locks");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const source = sourceOf(sourceCategoryId, category.name, 1);
    const request = await jobRequest(owner.bookId, source, sourceCategoryId, category.id);
    const job = await createImportJob(prisma, owner.userId, request, { startImmediately: false });

    const targetWrite = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        kind: "expense",
        amountCents: 1,
        currency: "CNY",
        categoryId: category.id,
        paymentMethodId: null,
        occurredAt: "2026-10-18T04:00:00.000Z",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "被锁目标写入",
        tagIds: [],
      },
    });
    expect(targetWrite.statusCode).toBe(409);
    expect(targetWrite.json()).toMatchObject({ code: "ledger_locked" });

    const exportBlocked = await app.inject({
      method: "GET",
      url: "/api/v1/export",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(exportBlocked.statusCode).toBe(409);
    expect(exportBlocked.json()).toMatchObject({ code: "ledger_locked" });

    const secondBook = await app.inject({
      method: "POST",
      url: "/api/v1/books",
      headers: { cookie: owner.cookie },
      payload: { name: "未锁定的另一本账" },
    });
    const otherBookId = (secondBook.json() as { id: string }).id;
    const otherLedger = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie: owner.cookie, "x-libellum-book": otherBookId },
    });
    const otherCategory = (otherLedger.json() as { categories: { id: string; name: string; kind: string }[] }).categories.find(
      (item) => item.name === "餐饮",
    )!;
    const otherWrite = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": otherBookId },
      payload: {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        kind: "expense",
        amountCents: 2,
        currency: "CNY",
        categoryId: otherCategory.id,
        paymentMethodId: null,
        occurredAt: "2026-10-18T04:00:00.000Z",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "其他账本正常写入",
        tagIds: [],
      },
    });
    expect(otherWrite.statusCode).toBe(201);

    const secondSource = sourceOf(sourceCategoryId, category.name, 2);
    const secondRequest = await jobRequest(owner.bookId, secondSource, sourceCategoryId, category.id);
    await expect(
      createImportJob(prisma, owner.userId, secondRequest, { startImmediately: false }),
    ).rejects.toMatchObject({ code: "book_locked" });
    // The original job still owns exactly one lock on the target.
    expect(await prisma.ledgerWriteLock.count({ where: { bookId: owner.bookId, releasedAt: null } })).toBe(1);
    void job;
  }, 40_000);

  it("does not extend the deadline from polling, but explicit user activity does", async () => {
    const owner = await account("p4_activity");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const source = sourceOf(sourceCategoryId, category.name, 1);
    const request = await jobRequest(owner.bookId, source, sourceCategoryId, category.id);
    const job = await createImportJob(prisma, owner.userId, request, {
      startImmediately: false,
      timeoutSeconds: 60,
    });
    while ((await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: job.id } })).nextBatch < 1) {
      await runImportJobBatchForTest(prisma, job.id);
    }
    await finalizeImportJobForTest(prisma, job.id);
    const awaiting = await awaitStatus(owner.cookie, job.id, ["awaiting_confirmation"]);
    const firstDeadline = awaiting["confirmationDeadline"];
    for (let index = 0; index < 3; index += 1) {
      await app.inject({
        method: "GET",
        url: `/api/v1/ledger-imports/jobs/${job.id}`,
        headers: { cookie: owner.cookie },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const polled = await awaitStatus(owner.cookie, job.id, ["awaiting_confirmation"]);
    expect(polled["confirmationDeadline"]).toBe(firstDeadline);
    const keepalive = await app.inject({
      method: "POST",
      url: `/api/v1/ledger-imports/jobs/${job.id}/activity`,
      headers: { cookie: owner.cookie },
    });
    expect(keepalive.statusCode).toBe(200);
    const extended = keepalive.json() as { confirmationDeadline: string };
    expect(Date.parse(extended.confirmationDeadline)).toBeGreaterThan(Date.parse(firstDeadline as string));
  }, 40_000);

  it("auto-undoes a paused partial job when its paused deadline expires", async () => {
    const owner = await account("p4_paused_timeout");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const source = sourceOf(sourceCategoryId, category.name, 3);
    const request = await jobRequest(owner.bookId, source, sourceCategoryId, category.id, { batchSize: 1 });
    const job = await createImportJob(prisma, owner.userId, request, {
      startImmediately: false,
      timeoutSeconds: 2,
    });
    await runImportJobBatchForTest(prisma, job.id);
    await prisma.ledgerImportJob.update({
      where: { id: job.id },
      data: {
        status: "paused",
        confirmationDeadline: new Date(Date.now() - 1_000),
        lastErrorCode: "synthetic_pause",
        lastErrorMessage: "test pause",
      },
    });
    await sweepStaleImportJobs(prisma, new Date());
    const undone = await awaitStatus(owner.cookie, job.id, ["undone", "undo_failed"]);
    expect(undone["status"]).toBe("undone");
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(0);
    expect(await prisma.ledgerWriteLock.count({ where: { bookId: owner.bookId, releasedAt: null } })).toBe(0);
  }, 40_000);

  it("recovers an interrupted undo after a server restart", async () => {
    const owner = await account("p4_restart_undo");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const source = sourceOf(sourceCategoryId, category.name, 2);
    const request = await jobRequest(owner.bookId, source, sourceCategoryId, category.id, { batchSize: 1 });
    const job = await createImportJob(prisma, owner.userId, request, {
      startImmediately: false,
      timeoutSeconds: 60,
    });
    while ((await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: job.id } })).nextBatch < 2) {
      await runImportJobBatchForTest(prisma, job.id);
    }
    await finalizeImportJobForTest(prisma, job.id);
    await awaitStatus(owner.cookie, job.id, ["awaiting_confirmation"]);
    // Simulate a process crash after the undoing state was persisted but before batches were undone.
    await prisma.ledgerImportJob.update({
      where: { id: job.id },
      data: { status: "undoing", undoAttempts: 1, confirmationDeadline: null },
    });
    await recoverImportJobs(prisma);
    const undone = await awaitStatus(owner.cookie, job.id, ["undone", "undo_failed"]);
    expect(undone["status"]).toBe("undone");
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(0);
    expect(await prisma.ledgerWriteLock.count({ where: { bookId: owner.bookId, releasedAt: null } })).toBe(0);
  }, 40_000);

  it("releases only after a confirmed job and keeps the receipt open for source cleanup", async () => {
    const owner = await account("p4_confirm");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const source = sourceOf(sourceCategoryId, category.name, 2);
    const request = await jobRequest(owner.bookId, source, sourceCategoryId, category.id);
    const job = await createImportJob(prisma, owner.userId, request, { startImmediately: false });
    while ((await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: job.id } })).nextBatch < 1) {
      await runImportJobBatchForTest(prisma, job.id);
    }
    await finalizeImportJobForTest(prisma, job.id);
    await awaitStatus(owner.cookie, job.id, ["awaiting_confirmation"]);
    const second = await createImportJob(
      prisma,
      owner.userId,
      await jobRequest(owner.bookId, sourceOf(sourceCategoryId, category.name, 1), sourceCategoryId, category.id),
      { startImmediately: false },
    ).catch((error: unknown) => error as { code?: string });
    // The resumable lookup returns the same task rather than creating a duplicate; either way the
    // active row keeps the lock and no second job can be created.
    expect(await prisma.ledgerWriteLock.count({ where: { bookId: owner.bookId, releasedAt: null } })).toBe(1);
    void second;

    const confirm = await app.inject({
      method: "POST",
      url: `/api/v1/ledger-imports/jobs/${job.id}/confirm`,
      headers: { cookie: owner.cookie },
    });
    expect(confirm.statusCode).toBe(200);
    const confirmed = await awaitStatus(owner.cookie, job.id, ["confirmed"]);
    expect(confirmed).toMatchObject({ status: "confirmed", canConfirm: false, canUndo: false });
    expect(await prisma.ledgerImport.findUnique({ where: { id: job.id } })).not.toBeNull();
    expect(await prisma.ledgerWriteLock.count({ where: { bookId: owner.bookId, releasedAt: null } })).toBe(0);
    const cleanupAllowed = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/guest-cleanup-preview",
      headers: { cookie: owner.cookie },
      payload: {
        targetBookId: owner.bookId,
        guestBookId: source.guestBookId,
        receiptId: job.id,
        source,
      },
    });
    expect(cleanupAllowed.statusCode).toBe(200);
    expect(cleanupAllowed.json()).toMatchObject({ cleanableCount: 2 });
  }, 40_000);
});
