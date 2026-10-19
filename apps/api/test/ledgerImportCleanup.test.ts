import { randomUUID } from "node:crypto";

import {
  fingerprintGuestSource,
  fingerprintTargetSnapshot,
  importJobRequestSchema,
  incrementalPreviewResponseSchema,
  type GuestImportSource,
} from "@libellum/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadTargetSnapshot } from "../src/ledger/importTarget.js";
import { loadFormalImportPair } from "../src/ledger/importSolo.js";
import {
  createImportJob,
  expireStaleImportJobs,
  runImportJobBatchForTest,
} from "../src/ledger/importJob.js";
import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

describe("source cleanup, disposition and job lifecycle (D5 phase 3)", () => {
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
    const ledger = response.json() as {
      categories: { id: string; name: string; kind: "expense" | "income" }[];
    };
    return ledger.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
  }

  async function importGuest(
    cookie: string,
    bookId: string,
    source: GuestImportSource,
    categoryId: string,
    targetCategoryId: string,
    duplicateGroups: unknown[] = [],
  ) {
    const target = await loadTargetSnapshot(prisma, bookId);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie },
      payload: {
        importId: randomUUID(),
        target: {
          kind: "existing",
          bookId,
          expectedTargetFingerprint: await fingerprintTargetSnapshot(target),
        },
        source,
        sourceFingerprint: await fingerprintGuestSource(source),
        taxonomy: [{ type: "category", sourceId: categoryId, action: "reuse", targetId: targetCategoryId }],
        duplicateGroups,
        incrementalDecisions: [],
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { importId: string; skippedCount: number; importedCount: number };
  }

  function sourceOf(categoryId: string, name: string, guestBookId: string, ids: { id: string; amountCents: number; note: string }[]) {
    return {
      name,
      guestBookId,
      categories: [
        {
          id: categoryId,
          name: "餐饮",
          kind: "expense" as const,
          description: null,
          sortOrder: 0,
          isArchived: false,
          isSystem: false,
        },
      ],
      paymentMethods: [],
      tags: [],
      transactions: ids.map((item, index) => ({
        id: item.id,
        kind: "expense" as const,
        amountCents: item.amountCents,
        currency: "CNY" as const,
        categoryId,
        paymentMethodId: null,
        occurredAt: new Date(Date.UTC(2026, 9, 18, 0, index, 0)).toISOString(),
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: item.note,
        tagIds: [],
      })),
    };
  }

  it("reports only safely migrated guest records and retains skipped records", async () => {
    const owner = await account("p3_guest_cleanup");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const guestBookId = "guest-book-cleanup-alpha";
    const targetTransaction = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        kind: "expense",
        amountCents: 100,
        currency: "CNY",
        categoryId: category.id,
        paymentMethodId: null,
        occurredAt: "2026-10-18T00:00:00.000Z",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "目标A",
        tagIds: [],
      },
    });
    const targetId = (targetTransaction.json() as { id: string }).id;
    const imported = { id: randomUUID(), amountCents: 200, note: "已迁入" };
    const skipped = { id: randomUUID(), amountCents: 100, note: "跳过" };
    const source = sourceOf(sourceCategoryId, "游客清理来源", guestBookId, [imported, skipped]);
    const result = await importGuest(
      owner.cookie,
      owner.bookId,
      source,
      sourceCategoryId,
      category.id,
      [{ groupId: "p3-cleanup-group", action: "keep_a", sourceIds: [skipped.id], targetIds: [targetId] }],
    );
    expect(result).toMatchObject({ importedCount: 1, skippedCount: 1 });

    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/guest-cleanup-preview",
      headers: { cookie: owner.cookie },
      payload: {
        targetBookId: owner.bookId,
        guestBookId,
        receiptId: result.importId,
        source,
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      cleanableCount: 1,
      retainedCount: 1,
      sourceCount: 2,
      cleanableSourceIds: [imported.id],
    });
    // Target row version drift makes the record unsafe to clean.
    await prisma.transaction.update({ where: { id: (await prisma.transaction.findFirstOrThrow({ where: { bookId: owner.bookId, sourceRef: imported.id } })).id }, data: { version: 2 } });
    const afterDrift = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/guest-cleanup-preview",
      headers: { cookie: owner.cookie },
      payload: { targetBookId: owner.bookId, guestBookId, receiptId: result.importId, source },
    });
    expect(afterDrift.json()).toMatchObject({ cleanableCount: 0, retainedCount: 2 });
  }, 40_000);

  it("reports formal source migration and unmigrated records without archiving anything", async () => {
    const owner = await account("p3_formal_disp");
    const sourceBookResponse = await app.inject({
      method: "POST",
      url: "/api/v1/books",
      headers: { cookie: owner.cookie },
      payload: { name: "阶段三来源B" },
    });
    const sourceBookId = (sourceBookResponse.json() as { id: string }).id;
    const sourceLedger = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie: owner.cookie, "x-libellum-book": sourceBookId },
    });
    const sourceCategory = (sourceLedger.json() as { categories: { id: string; name: string; kind: "expense" }[] }).categories.find(
      (item) => item.name === "餐饮" && item.kind === "expense",
    )!;
    for (let index = 0; index < 2; index += 1) {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/transactions",
        headers: { cookie: owner.cookie, "x-libellum-book": sourceBookId },
        payload: {
          id: randomUUID(),
          idempotencyKey: randomUUID(),
          kind: "expense",
          amountCents: 300 + index,
          currency: "CNY",
          categoryId: sourceCategory.id,
          paymentMethodId: null,
          occurredAt: new Date(Date.UTC(2026, 9, 18, 0, index, 0)).toISOString(),
          occurredLocalDate: "2026-10-18",
          occurredTz: "Asia/Shanghai",
          note: `正式来源${String(index)}`,
          tagIds: [],
        },
      });
      expect(created.statusCode).toBe(201);
    }
    const pair = await loadFormalImportPair(prisma, owner.userId, sourceBookId, owner.bookId);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: {
        importId: randomUUID(),
        target: { kind: "existing", bookId: owner.bookId, expectedTargetFingerprint: pair.targetFingerprint },
        sourceBookId,
        sourceFingerprint: pair.sourceFingerprint,
        taxonomy: [
          ...pair.source.categories.map((item) => {
            const target = pair.target.categories.find((row) => row.name === item.name && row.kind === item.kind);
            return target === undefined
              ? { type: "category", sourceId: item.id, action: "create", createName: item.name }
              : { type: "category", sourceId: item.id, action: "reuse", targetId: target.id };
          }),
          ...pair.source.paymentMethods.map((item) => {
            const target = pair.target.paymentMethods.find((row) => row.name === item.name);
            return target === undefined
              ? { type: "paymentMethod", sourceId: item.id, action: "create", createName: item.name }
              : { type: "paymentMethod", sourceId: item.id, action: "reuse", targetId: target.id };
          }),
          ...pair.source.tags.map((item) => {
            const target = pair.target.tags.find((row) => row.name === item.name);
            return target === undefined
              ? { type: "tag", sourceId: item.id, action: "create", createName: item.name }
              : { type: "tag", sourceId: item.id, action: "reuse", targetId: target.id };
          }),
        ],
        duplicateGroups: [],
        incrementalDecisions: [],
      },
    });
    expect(response.statusCode).toBe(200);
    const receiptId = (response.json() as { importId: string }).importId;
    const disposition = await app.inject({
      method: "GET",
      url: `/api/v1/ledger-imports/${receiptId}/source-disposition`,
      headers: { cookie: owner.cookie },
    });
    expect(disposition.statusCode).toBe(200);
    expect(disposition.json()).toMatchObject({
      sourceBookId,
      sourceCount: 2,
      migratedCount: 2,
      unmigratedCount: 0,
    });

    // A source row added after import is visibly unmigrated; the endpoint does not archive.
    await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": sourceBookId },
      payload: {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        kind: "expense",
        amountCents: 999,
        currency: "CNY",
        categoryId: sourceCategory.id,
        paymentMethodId: null,
        occurredAt: "2026-10-18T03:00:00.000Z",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "导入后新增来源",
        tagIds: [],
      },
    });
    const after = await app.inject({
      method: "GET",
      url: `/api/v1/ledger-imports/${receiptId}/source-disposition`,
      headers: { cookie: owner.cookie },
    });
    expect(after.json()).toMatchObject({ sourceCount: 3, migratedCount: 2, unmigratedCount: 1 });
    expect((await prisma.book.findUniqueOrThrow({ where: { id: sourceBookId }, select: { archivedAt: true } })).archivedAt).toBeNull();

    const archive = await app.inject({
      method: "POST",
      url: `/api/v1/books/${sourceBookId}/lifecycle`,
      headers: { cookie: owner.cookie },
      payload: { action: "archive" },
    });
    expect(archive.statusCode).toBe(200);
    const archivedBook = await prisma.book.findUniqueOrThrow({
      where: { id: sourceBookId },
      select: { archivedAt: true, disposedAt: true },
    });
    expect(archivedBook.archivedAt).not.toBeNull();
    expect(archivedBook.disposedAt).toBeNull();
    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/account/archives/${sourceBookId}/restore`,
      headers: { cookie: owner.cookie },
    });
    expect(restore.statusCode).toBe(200);
    expect(
      (await prisma.book.findUniqueOrThrow({ where: { id: sourceBookId }, select: { archivedAt: true } })).archivedAt,
    ).toBeNull();
  }, 40_000);

  it("cancels a phase-4 job through the safe undo path and removes its committed batch", async () => {
    const owner = await account("p3_cancel");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const source = sourceOf(sourceCategoryId, "取消来源", "guest-book-cancel", [
      { id: randomUUID(), amountCents: 100, note: "取消1" },
      { id: randomUUID(), amountCents: 200, note: "取消2" },
      { id: randomUUID(), amountCents: 300, note: "取消3" },
    ]);
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const request = importJobRequestSchema.parse({
      importId: randomUUID(),
      target: { kind: "existing", bookId: owner.bookId, expectedTargetFingerprint: await fingerprintTargetSnapshot(target) },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [{ type: "category", sourceId: sourceCategoryId, action: "reuse", targetId: category.id }],
      duplicateGroups: [],
      batchSize: 1,
    });
    const created = await createImportJob(prisma, owner.userId, request, { startImmediately: false });
    await runImportJobBatchForTest(prisma, created.id);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(1);
    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/ledger-imports/jobs/${created.id}/cancel`,
      headers: { cookie: owner.cookie },
    });
    expect(cancel.statusCode).toBe(200);
    const deadline = Date.now() + 15_000;
    let status = "";
    for (;;) {
      const current = await app.inject({
        method: "GET",
        url: `/api/v1/ledger-imports/jobs/${created.id}`,
        headers: { cookie: owner.cookie },
      });
      status = (current.json() as { status: string }).status;
      if (status === "undone" || status === "undo_failed") break;
      if (Date.now() > deadline) throw new Error(`undo timeout: ${status}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(status).toBe("undone");
    const row = await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: created.id } });
    expect((row.payload as { source?: unknown }).source).toBeNull();
    const resume = await app.inject({
      method: "POST",
      url: `/api/v1/ledger-imports/jobs/${created.id}/resume`,
      headers: { cookie: owner.cookie },
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toMatchObject({ status: "undone" });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(0);
  }, 40_000);

  it("expires stale paused jobs without touching committed records", async () => {
    const owner = await account("p3_ttl");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const source = sourceOf(sourceCategoryId, "TTL来源", "guest-book-ttl", [
      { id: randomUUID(), amountCents: 500, note: "TTL记录" },
    ]);
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const request = importJobRequestSchema.parse({
      importId: randomUUID(),
      target: { kind: "existing", bookId: owner.bookId, expectedTargetFingerprint: await fingerprintTargetSnapshot(target) },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [{ type: "category", sourceId: sourceCategoryId, action: "reuse", targetId: category.id }],
      duplicateGroups: [],
    });
    const created = await createImportJob(prisma, owner.userId, request, { startImmediately: false });
    await prisma.ledgerImportJob.update({
      where: { id: created.id },
      data: { status: "paused", phase: 3, updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });
    const expired = await expireStaleImportJobs(prisma, new Date(), 7);
    expect(expired).toBeGreaterThanOrEqual(1);
    const row = await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe("expired");
    expect((row.payload as { source?: unknown }).source).toBeNull();
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(0);
  }, 30_000);
});
