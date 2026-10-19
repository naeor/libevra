import { randomUUID } from "node:crypto";

import {
  fingerprintGuestSource,
  fingerprintTargetSnapshot,
  importJobRequestSchema,
  type GuestImportSource,
} from "@libellum/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadTargetSnapshot } from "../src/ledger/importTarget.js";
import {
  createImportJob,
  finalizeImportJobForTest,
  processImportJob,
  runImportJobBatchForTest,
} from "../src/ledger/importJob.js";
import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

describe("batched ledger import (D5 phase 1)", () => {
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

  async function waitJob(cookie: string, jobId: string) {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/ledger-imports/jobs/${jobId}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      const job = response.json() as {
        status: string;
        importedCount: number;
        nextBatch: number;
        totalBatches: number;
        result: unknown;
        lastErrorMessage: string | null;
      };
      if (job.status === "completed") return job;
      if (job.status === "failed" || job.status === "paused") {
        throw new Error(`job stopped: ${job.status} ${job.lastErrorMessage ?? ""}`);
      }
      if (Date.now() > deadline) throw new Error("job timeout");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("imports 450 guest entries in durable batches and exposes committed progress", async () => {
    const owner = await account("d5_batch_owner");
    const ledgerResponse = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(ledgerResponse.statusCode).toBe(200);
    const ledger = ledgerResponse.json() as {
      categories: { id: string; name: string; kind: "expense" | "income"; isSystem: boolean }[];
      paymentMethods: { id: string; name: string; sortOrder: number; isArchived: boolean }[];
    };
    const targetFood = ledger.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const sourceCategoryId = randomUUID();
    const source: GuestImportSource = {
      name: "D5大账本",
      categories: [
        {
          id: sourceCategoryId,
          name: targetFood.name,
          kind: targetFood.kind,
          description: null,
          sortOrder: 0,
          isArchived: false,
          isSystem: false,
        },
      ],
      paymentMethods: [],
      tags: [],
      transactions: Array.from({ length: 450 }, (_, index) => ({
        id: randomUUID(),
        kind: "expense" as const,
        amountCents: 100 + index,
        currency: "CNY" as const,
        categoryId: sourceCategoryId,
        paymentMethodId: null,
        occurredAt: new Date(Date.UTC(2026, 9, 18, 0, index % 60, 0)).toISOString(),
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: `批量来源${String(index)}`,
        tagIds: [],
      })),
    };
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const request = importJobRequestSchema.parse({
      importId: randomUUID(),
      target: {
        kind: "existing",
        bookId: owner.bookId,
        expectedTargetFingerprint: await fingerprintTargetSnapshot(target),
      },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [
        {
          type: "category",
          sourceId: sourceCategoryId,
          action: "reuse",
          targetId: targetFood.id,
        },
      ],
      duplicateGroups: [],
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/jobs",
      headers: { cookie: owner.cookie },
      payload: { ...request, batchSize: 200 },
    });
    expect(created.statusCode).toBe(202);
    const job = created.json() as { id: string; status: string; totalBatches: number };
    expect(job).toMatchObject({ status: "queued", totalBatches: 3 });
    const done = await waitJob(owner.cookie, job.id);
    expect(done.importedCount).toBe(450);
    expect(done.nextBatch).toBe(3);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(450);
    const receipt = await prisma.ledgerImport.findUniqueOrThrow({ where: { id: job.id } });
    expect(receipt.importedCount).toBe(450);
    expect(receipt.result).toMatchObject({ importedCount: 450, sourceCount: 450, reconciled: true });

    const retry = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/jobs",
      headers: { cookie: owner.cookie },
      payload: { ...request, batchSize: 200 },
    });
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({ id: job.id, importedCount: 450 });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(450);
  }, 40_000);
  it("imports in batches and only soft-deletes removed A records after global reconciliation", async () => {
    const owner = await account("d5_batch_delete");
    const ledgerResponse = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    const ledger = ledgerResponse.json() as {
      categories: { id: string; name: string; kind: "expense" | "income" }[];
    };
    const food = ledger.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
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
        categoryId: food.id,
        paymentMethodId: null,
        occurredAt: "2026-10-18T00:00:30.000Z",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "目标待移除",
        tagIds: [],
      },
    });
    expect(targetTransaction.statusCode).toBe(201);
    const targetRow = targetTransaction.json() as { id: string; version: number };

    const sourceCategoryId = randomUUID();
    const source: GuestImportSource = {
      name: "D5删除批次",
      categories: [
        {
          id: sourceCategoryId,
          name: food.name,
          kind: food.kind,
          description: null,
          sortOrder: 0,
          isArchived: false,
          isSystem: false,
        },
      ],
      paymentMethods: [],
      tags: [],
      transactions: Array.from({ length: 450 }, (_, index) => ({
        id: randomUUID(),
        kind: "expense" as const,
        amountCents: 100 + index,
        currency: "CNY" as const,
        categoryId: sourceCategoryId,
        paymentMethodId: null,
        occurredAt: new Date(Date.UTC(2026, 9, 18, 0, index % 60, 0)).toISOString(),
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: `删除批次来源${String(index)}`,
        tagIds: [],
      })),
    };
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const request = importJobRequestSchema.parse({
      importId: randomUUID(),
      target: {
        kind: "existing",
        bookId: owner.bookId,
        expectedTargetFingerprint: await fingerprintTargetSnapshot(target),
      },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [{ type: "category", sourceId: sourceCategoryId, action: "reuse", targetId: food.id }],
      duplicateGroups: [
        {
          groupId: "d5-remove-group",
          action: "keep_b",
          sourceIds: [source.transactions[0]!.id],
          targetIds: [targetRow.id],
        },
      ],
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/jobs",
      headers: { cookie: owner.cookie },
      payload: { ...request, batchSize: 200 },
    });
    expect(created.statusCode).toBe(202);
    const job = created.json() as { id: string; totalBatches: number };
    expect(job.totalBatches).toBe(3);
    const done = await waitJob(owner.cookie, job.id) as unknown as {
      importedCount: number;
      removedCount: number;
      result: { removedTargets: { targetTransactionId: string }[] };
    };
    expect(done.importedCount).toBe(450);
    expect(done.removedCount).toBe(1);
    expect(done.result.removedTargets[0]?.targetTransactionId).toBe(targetRow.id);
    const deleted = await prisma.transaction.findUniqueOrThrow({
      where: { id: targetRow.id },
      select: { deletedAt: true, version: true },
    });
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.version).toBe(targetRow.version + 1);
    const event = await prisma.transactionEvent.findFirstOrThrow({
      where: { transactionId: targetRow.id, kind: "deleted" },
      orderBy: { occurredAt: "desc" },
    });
    expect(event.changes).toMatchObject({ importId: { to: job.id }, importSource: { to: "guest" } });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(450);
  }, 40_000);

  it("runs the same durable batch path for a formal source", async () => {
    const owner = await account("d5_formal_owner");
    const createBook = await app.inject({
      method: "POST",
      url: "/api/v1/books",
      headers: { cookie: owner.cookie },
      payload: { name: "D5正式来源" },
    });
    expect(createBook.statusCode).toBe(201);
    const sourceBookId = (createBook.json() as { id: string }).id;
    const sourceLedgerResponse = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie: owner.cookie, "x-libellum-book": sourceBookId },
    });
    const sourceLedger = sourceLedgerResponse.json() as {
      categories: { id: string; name: string; kind: "expense" | "income" }[];
    };
    const sourceFood = sourceLedger.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    for (let index = 0; index < 5; index += 1) {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/transactions",
        headers: { cookie: owner.cookie, "x-libellum-book": sourceBookId },
        payload: {
          id: randomUUID(),
          idempotencyKey: randomUUID(),
          kind: "expense",
          amountCents: 1000 + index,
          currency: "CNY",
          categoryId: sourceFood.id,
          paymentMethodId: null,
          occurredAt: new Date(Date.UTC(2026, 9, 18, 0, index, 0)).toISOString(),
          occurredLocalDate: "2026-10-18",
          occurredTz: "Asia/Shanghai",
          note: `正式批量来源${String(index)}`,
          tagIds: [],
        },
      });
      expect(created.statusCode).toBe(201);
    }

    const { loadFormalImportPair } = await import("../src/ledger/importSolo.js");
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(ownerUser.id).toBe(owner.userId);
    const pair = await loadFormalImportPair(prisma, owner.userId, sourceBookId, owner.bookId);
    const request = importJobRequestSchema.parse({
      importId: randomUUID(),
      target: {
        kind: "existing",
        bookId: owner.bookId,
        expectedTargetFingerprint: pair.targetFingerprint,
      },
      sourceBookId,
      sourceFingerprint: pair.sourceFingerprint,
      taxonomy: [
        ...pair.source.categories.map((sourceCategory) => {
          const targetCategory = pair.target.categories.find(
            (item) => item.kind === sourceCategory.kind && item.name === sourceCategory.name,
          );
          return targetCategory === undefined
            ? {
                type: "category" as const,
                sourceId: sourceCategory.id,
                action: "create" as const,
                createName: sourceCategory.name,
              }
            : {
                type: "category" as const,
                sourceId: sourceCategory.id,
                action: "reuse" as const,
                targetId: targetCategory.id,
              };
        }),
        ...pair.source.paymentMethods.map((sourcePayment) => {
          const targetPayment = pair.target.paymentMethods.find((item) => item.name === sourcePayment.name);
          return targetPayment === undefined
            ? {
                type: "paymentMethod" as const,
                sourceId: sourcePayment.id,
                action: "create" as const,
                createName: sourcePayment.name,
              }
            : {
                type: "paymentMethod" as const,
                sourceId: sourcePayment.id,
                action: "reuse" as const,
                targetId: targetPayment.id,
              };
        }),
        ...pair.source.tags.map((sourceTag) => {
          const targetTag = pair.target.tags.find((item) => item.name === sourceTag.name);
          return targetTag === undefined
            ? {
                type: "tag" as const,
                sourceId: sourceTag.id,
                action: "create" as const,
                createName: sourceTag.name,
              }
            : {
                type: "tag" as const,
                sourceId: sourceTag.id,
                action: "reuse" as const,
                targetId: targetTag.id,
              };
        }),
      ],
      duplicateGroups: [],
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/jobs",
      headers: { cookie: owner.cookie },
      payload: { ...request, batchSize: 2 },
    });
    expect(created.statusCode).toBe(202);
    const job = created.json() as { id: string; totalBatches: number; sourceKind: string };
    expect(job).toMatchObject({ totalBatches: 3, sourceKind: "book" });
    const done = await waitJob(owner.cookie, job.id);
    expect(done.importedCount).toBe(5);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(5);
    expect(await prisma.transaction.count({ where: { bookId: sourceBookId, deletedAt: null } })).toBe(5);
    const receipt = await prisma.ledgerImport.findUniqueOrThrow({ where: { id: job.id } });
    expect(receipt.result).toMatchObject({ sourceBookId, importedCount: 5, reconciled: true });
  }, 40_000);

  it("pauses after committed batches when the target changes concurrently", async () => {
    const owner = await account("d5_fault_target");
    const ledgerResponse = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    const ledger = ledgerResponse.json() as {
      categories: { id: string; name: string; kind: "expense" | "income" }[];
    };
    const food = ledger.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const sourceCategoryId = randomUUID();
    const source: GuestImportSource = {
      name: "D5故障目标变化",
      categories: [
        {
          id: sourceCategoryId,
          name: food.name,
          kind: food.kind,
          description: null,
          sortOrder: 0,
          isArchived: false,
          isSystem: false,
        },
      ],
      paymentMethods: [],
      tags: [],
      transactions: Array.from({ length: 5 }, (_, index) => ({
        id: randomUUID(),
        kind: "expense" as const,
        amountCents: 500 + index,
        currency: "CNY" as const,
        categoryId: sourceCategoryId,
        paymentMethodId: null,
        occurredAt: new Date(Date.UTC(2026, 9, 18, 0, index, 0)).toISOString(),
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: `故障来源${String(index)}`,
        tagIds: [],
      })),
    };
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const request = importJobRequestSchema.parse({
      importId: randomUUID(),
      target: { kind: "existing", bookId: owner.bookId, expectedTargetFingerprint: await fingerprintTargetSnapshot(target) },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [{ type: "category", sourceId: sourceCategoryId, action: "reuse", targetId: food.id }],
      duplicateGroups: [],
      batchSize: 2,
    });
    const created = await createImportJob(prisma, owner.userId, request, { startImmediately: false });

    await runImportJobBatchForTest(prisma, created.id);
    const afterFirst = await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterFirst.importedCount).toBe(2);
    expect(afterFirst.nextBatch).toBe(1);

    const concurrent = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        kind: "expense",
        amountCents: 9999,
        currency: "CNY",
        categoryId: food.id,
        paymentMethodId: null,
        occurredAt: "2026-10-18T01:00:00.000Z",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "并发新增目标账目",
        tagIds: [],
      },
    });
    expect(concurrent.statusCode).toBe(201);

    await processImportJob(prisma, created.id);
    const paused = await app.inject({
      method: "GET",
      url: `/api/v1/ledger-imports/jobs/${created.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json()).toMatchObject({
      status: "paused",
      lastErrorCode: "target_changed",
      importedCount: 2,
      nextBatch: 1,
    });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(3);
    expect(await prisma.ledgerImport.findUnique({ where: { id: created.id } })).toBeNull();
  }, 30_000);

  it("fails the final A deletion safely when an A row changed, then retries after reconciliation", async () => {
    const owner = await account("d5_fault_final");
    const ledgerResponse = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    const ledger = ledgerResponse.json() as {
      categories: { id: string; name: string; kind: "expense" | "income" }[];
    };
    const food = ledger.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const targetResponse = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        kind: "expense",
        amountCents: 7000,
        currency: "CNY",
        categoryId: food.id,
        paymentMethodId: null,
        occurredAt: "2026-10-18T00:00:30.000Z",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "最终删除故障目标",
        tagIds: [],
      },
    });
    const targetRow = targetResponse.json() as { id: string; version: number };
    const sourceCategoryId = randomUUID();
    const source: GuestImportSource = {
      name: "D5最终删除故障",
      categories: [
        {
          id: sourceCategoryId,
          name: food.name,
          kind: food.kind,
          description: null,
          sortOrder: 0,
          isArchived: false,
          isSystem: false,
        },
      ],
      paymentMethods: [],
      tags: [],
      transactions: Array.from({ length: 3 }, (_, index) => ({
        id: randomUUID(),
        kind: "expense" as const,
        amountCents: 7000,
        currency: "CNY" as const,
        categoryId: sourceCategoryId,
        paymentMethodId: null,
        occurredAt: new Date(Date.UTC(2026, 9, 18, 0, index % 30, 0)).toISOString(),
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: `最终故障来源${String(index)}`,
        tagIds: [],
      })),
    };
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const request = importJobRequestSchema.parse({
      importId: randomUUID(),
      target: { kind: "existing", bookId: owner.bookId, expectedTargetFingerprint: await fingerprintTargetSnapshot(target) },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [{ type: "category", sourceId: sourceCategoryId, action: "reuse", targetId: food.id }],
      duplicateGroups: [
        {
          groupId: "d5-final-failure-group",
          action: "keep_b",
          sourceIds: [source.transactions[0]!.id],
          targetIds: [targetRow.id],
        },
      ],
    });
    const created = await createImportJob(prisma, owner.userId, request, { startImmediately: false });
    await runImportJobBatchForTest(prisma, created.id);
    const afterBatch = await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterBatch.nextBatch).toBe(1);
    expect(afterBatch.importedCount).toBe(3);

    // Simulate another device changing/restoring the A row version between batches and finalization.
    await prisma.transaction.update({
      where: { id: targetRow.id },
      data: { version: targetRow.version + 1 },
    });
    await expect(finalizeImportJobForTest(prisma, created.id)).rejects.toThrow();
    expect(await prisma.transaction.findUnique({ where: { id: targetRow.id }, select: { deletedAt: true } })).toMatchObject({ deletedAt: null });
    expect(await prisma.ledgerImport.findUnique({ where: { id: created.id } })).toBeNull();

    await prisma.transaction.update({
      where: { id: targetRow.id },
      data: { version: targetRow.version },
    });
    await finalizeImportJobForTest(prisma, created.id);
    const completed = await app.inject({
      method: "GET",
      url: `/api/v1/ledger-imports/jobs/${created.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(completed.json()).toMatchObject({
      status: "completed",
      importedCount: 3,
      removedCount: 1,
      result: { importedCount: 3, removedCount: 1, reconciled: true },
    });
    expect(await prisma.transaction.findUnique({ where: { id: targetRow.id }, select: { deletedAt: true } })).not.toMatchObject({ deletedAt: null });
  }, 30_000);

  it("stops background writes when the owning account is disabled", async () => {
    const owner = await account("d5_fault_disabled");
    const ledgerResponse = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    const ledger = ledgerResponse.json() as {
      categories: { id: string; name: string; kind: "expense" | "income" }[];
    };
    const food = ledger.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const sourceCategoryId = randomUUID();
    const source: GuestImportSource = {
      name: "D5停用账号",
      categories: [
        {
          id: sourceCategoryId,
          name: food.name,
          kind: food.kind,
          description: null,
          sortOrder: 0,
          isArchived: false,
          isSystem: false,
        },
      ],
      paymentMethods: [],
      tags: [],
      transactions: [
        {
          id: randomUUID(),
          kind: "expense",
          amountCents: 800,
          currency: "CNY",
          categoryId: sourceCategoryId,
          paymentMethodId: null,
          occurredAt: "2026-10-18T00:00:00.000Z",
          occurredLocalDate: "2026-10-18",
          occurredTz: "Asia/Shanghai",
          note: "停用账号来源",
          tagIds: [],
        },
      ],
    };
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const request = importJobRequestSchema.parse({
      importId: randomUUID(),
      target: { kind: "existing", bookId: owner.bookId, expectedTargetFingerprint: await fingerprintTargetSnapshot(target) },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [{ type: "category", sourceId: sourceCategoryId, action: "reuse", targetId: food.id }],
      duplicateGroups: [],
    });
    const created = await createImportJob(prisma, owner.userId, request, { startImmediately: false });
    await prisma.user.update({ where: { id: owner.userId }, data: { disabledAt: new Date() } });
    await processImportJob(prisma, created.id);
    const status = await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: created.id } });
    expect(status.status).toBe("paused");
    expect(status.lastErrorCode).toBe("account_disabled");
    expect(status.importedCount).toBe(0);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(0);
  }, 30_000);

  it("does not bypass S13 book lifecycle: an archived target pauses the job", async () => {
    const owner = await account("d5_fault_archived");
    const ledgerResponse = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    const ledger = ledgerResponse.json() as {
      categories: { id: string; name: string; kind: "expense" | "income" }[];
    };
    const food = ledger.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const sourceCategoryId = randomUUID();
    const source: GuestImportSource = {
      name: "D5归档目标",
      categories: [
        {
          id: sourceCategoryId,
          name: food.name,
          kind: food.kind,
          description: null,
          sortOrder: 0,
          isArchived: false,
          isSystem: false,
        },
      ],
      paymentMethods: [],
      tags: [],
      transactions: [
        {
          id: randomUUID(),
          kind: "expense",
          amountCents: 900,
          currency: "CNY",
          categoryId: sourceCategoryId,
          paymentMethodId: null,
          occurredAt: "2026-10-18T00:00:00.000Z",
          occurredLocalDate: "2026-10-18",
          occurredTz: "Asia/Shanghai",
          note: "归档目标来源",
          tagIds: [],
        },
      ],
    };
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const request = importJobRequestSchema.parse({
      importId: randomUUID(),
      target: { kind: "existing", bookId: owner.bookId, expectedTargetFingerprint: await fingerprintTargetSnapshot(target) },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [{ type: "category", sourceId: sourceCategoryId, action: "reuse", targetId: food.id }],
      duplicateGroups: [],
    });
    const created = await createImportJob(prisma, owner.userId, request, { startImmediately: false });
    await prisma.book.update({ where: { id: owner.bookId }, data: { archivedAt: new Date() } });
    await processImportJob(prisma, created.id);
    const status = await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: created.id } });
    expect(status.status).toBe("paused");
    expect(status.lastErrorCode).toBe("book_archived");
    expect(status.importedCount).toBe(0);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(0);
  }, 30_000);

  it("resumes a paused partial job without duplicating already committed batches", async () => {
    const owner = await account("d5_resume_partial");
    const ledgerResponse = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    const ledger = ledgerResponse.json() as {
      categories: { id: string; name: string; kind: "expense" | "income" }[];
    };
    const food = ledger.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const sourceCategoryId = randomUUID();
    const source: GuestImportSource = {
      name: "D5暂停恢复",
      categories: [
        {
          id: sourceCategoryId,
          name: food.name,
          kind: food.kind,
          description: null,
          sortOrder: 0,
          isArchived: false,
          isSystem: false,
        },
      ],
      paymentMethods: [],
      tags: [],
      transactions: Array.from({ length: 5 }, (_, index) => ({
        id: randomUUID(),
        kind: "expense" as const,
        amountCents: 600 + index,
        currency: "CNY" as const,
        categoryId: sourceCategoryId,
        paymentMethodId: null,
        occurredAt: new Date(Date.UTC(2026, 9, 18, 0, index, 0)).toISOString(),
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: `暂停恢复来源${String(index)}`,
        tagIds: [],
      })),
    };
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const request = importJobRequestSchema.parse({
      importId: randomUUID(),
      target: { kind: "existing", bookId: owner.bookId, expectedTargetFingerprint: await fingerprintTargetSnapshot(target) },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [{ type: "category", sourceId: sourceCategoryId, action: "reuse", targetId: food.id }],
      duplicateGroups: [],
      batchSize: 2,
    });
    const created = await createImportJob(prisma, owner.userId, request, { startImmediately: false });
    await runImportJobBatchForTest(prisma, created.id);
    const afterFirst = await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterFirst.importedCount).toBe(2);

    const concurrent = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        kind: "expense",
        amountCents: 8888,
        currency: "CNY",
        categoryId: food.id,
        paymentMethodId: null,
        occurredAt: "2026-10-18T02:00:00.000Z",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "暂停时目标变化",
        tagIds: [],
      },
    });
    expect(concurrent.statusCode).toBe(201);
    await processImportJob(prisma, created.id);
    expect(await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: created.id }, select: { status: true } })).toMatchObject({ status: "paused" });

    // The test removes its own concurrent target row again; this restores the live target
    // fingerprint while the already committed batches stay untouched.
    await prisma.transaction.update({
      where: { id: (concurrent.json() as { id: string }).id },
      data: { deletedAt: new Date(), version: 2 },
    });
    await prisma.ledgerImportJob.update({
      where: { id: created.id },
      data: { status: "queued", lastErrorCode: null, lastErrorMessage: null },
    });
    const resumed = await app.inject({
      method: "POST",
      url: `/api/v1/ledger-imports/jobs/${created.id}/resume`,
      headers: { cookie: owner.cookie },
    });
    expect(resumed.statusCode).toBe(200);
    const done = await waitJob(owner.cookie, created.id);
    expect(done.importedCount).toBe(5);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(5);
    expect(await prisma.ledgerImport.findUnique({ where: { id: created.id } })).not.toBeNull();
  }, 40_000);

});
