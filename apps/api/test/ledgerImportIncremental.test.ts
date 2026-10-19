import { randomUUID } from "node:crypto";

import {
  fingerprintGuestSource,
  fingerprintTargetSnapshot,
  incrementalPreviewResponseSchema,
  ledgerImportResultSchema,
  type GuestImportSource,
} from "@libellum/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadTargetSnapshot } from "../src/ledger/importTarget.js";
import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

describe("incremental ledger import (D5 phase 2)", () => {
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
    expect(response.statusCode).toBe(200);
    const ledger = response.json() as {
      categories: { id: string; name: string; kind: "expense" | "income" }[];
    };
    return ledger.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
  }

  function sourceWith(
    name: string,
    categoryId: string,
    categoryName: string,
    transactions: { id: string; amountCents: number; note: string }[],
  ): GuestImportSource {
    return {
      name,
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
      transactions: transactions.map((item, index) => ({
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

  async function importSmall(
    cookie: string,
    userId: string,
    bookId: string,
    source: GuestImportSource,
    categoryId: string,
    targetCategoryId: string,
    duplicateGroups: unknown[] = [],
    sourceIds: string[] = [],
  ) {
    const target = await loadTargetSnapshot(prisma, bookId);
    const request = {
      importId: randomUUID(),
      target: {
        kind: "existing" as const,
        bookId,
        expectedTargetFingerprint: await fingerprintTargetSnapshot(target),
      },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [{ type: "category", sourceId: categoryId, action: "reuse", targetId: targetCategoryId }],
      duplicateGroups,
      incrementalDecisions: sourceIds.map((sourceTransactionId) => ({
        sourceTransactionId,
        action: "import" as const,
      })),
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie },
      payload: request,
    });
    expect(response.statusCode).toBe(200);
    void userId;
    return ledgerImportResultSchema.parse(response.json());
  }

  async function incrementalPreview(cookie: string, targetBookId: string, source: GuestImportSource) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/incremental-preview",
      headers: { cookie },
      payload: { targetBookId, source },
    });
    expect(response.statusCode).toBe(200);
    return incrementalPreviewResponseSchema.parse(response.json());
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
        updatedCount: number;
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

  async function createIncrementalJob(
    cookie: string,
    targetBookId: string,
    source: GuestImportSource,
    categoryId: string,
    targetCategoryId: string,
    decisions: { sourceTransactionId: string; action: "keep_target" | "update_target" | "import" | "skip" }[],
    duplicateGroups: unknown[] = [],
  ) {
    const target = await loadTargetSnapshot(prisma, targetBookId);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/jobs",
      headers: { cookie },
      payload: {
        importId: randomUUID(),
        target: {
          kind: "existing",
          bookId: targetBookId,
          expectedTargetFingerprint: await fingerprintTargetSnapshot(target),
        },
        source,
        sourceFingerprint: await fingerprintGuestSource(source),
        taxonomy: [{ type: "category", sourceId: categoryId, action: "reuse", targetId: targetCategoryId }],
        duplicateGroups,
        incrementalDecisions: decisions,
      },
    });
    expect(response.statusCode).toBe(202);
    return response.json() as { id: string };
  }

  it("recognizes unchanged/new/modified records, updates only the explicitly chosen target, and never deletes a source-removed target", async () => {
    const owner = await account("inc_modified");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const first = [
      { id: randomUUID(), amountCents: 1000, note: "保持不变" },
      { id: randomUUID(), amountCents: 2000, note: "将被更新" },
      { id: randomUUID(), amountCents: 3000, note: "将从来源移除" },
    ];
    const source = sourceWith("增量来源", sourceCategoryId, category.name, first);
    const initial = await importSmall(owner.cookie, owner.userId, owner.bookId, source, sourceCategoryId, category.id);
    expect(initial.importedCount).toBe(3);
    expect(await prisma.ledgerImportSourceState.count({ where: { targetBookId: owner.bookId } })).toBe(3);

    const newRecord = { id: randomUUID(), amountCents: 4000, note: "新增记录" };
    const modifiedSource = sourceWith("增量来源", sourceCategoryId, category.name, [
      first[0]!,
      { ...first[1]!, amountCents: 2500, note: "来源已修改" },
      newRecord,
    ]);
    const preview = await incrementalPreview(owner.cookie, owner.bookId, modifiedSource);
    const byId = new Map(preview.statuses.map((status) => [status.sourceTransactionId, status]));
    expect(byId.get(first[0]!.id)?.status).toBe("unchanged");
    expect(byId.get(first[1]!.id)?.status).toBe("modified");
    expect(byId.get(newRecord.id)?.status).toBe("new");
    // The omitted source record remains in the target; it is not part of this preview and is never deleted.
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, note: "将从来源移除", deletedAt: null } })).toBe(1);

    const job = await createIncrementalJob(
      owner.cookie,
      owner.bookId,
      modifiedSource,
      sourceCategoryId,
      category.id,
      [
        { sourceTransactionId: first[1]!.id, action: "update_target" },
        { sourceTransactionId: newRecord.id, action: "import" },
      ],
    );
    const done = await waitJob(owner.cookie, job.id);
    expect(done).toMatchObject({ importedCount: 1, updatedCount: 1, status: "completed" });
    const updatedTarget = await prisma.transaction.findFirstOrThrow({
      where: { bookId: owner.bookId, note: "来源已修改", deletedAt: null },
      select: { amountCents: true, version: true },
    });
    expect(Number(updatedTarget.amountCents)).toBe(2500);
    expect(updatedTarget.version).toBe(2);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(4);
    const updatedState = await prisma.ledgerImportSourceState.findUniqueOrThrow({
      where: {
        targetBookId_sourceBookKey_sourceTransactionId: {
          targetBookId: owner.bookId,
          sourceBookKey: "guest",
          sourceTransactionId: first[1]!.id,
        },
      },
    });
    expect(updatedState.decision).toBe("imported");
    expect(updatedState.targetVersion).toBe(2);
    const completedJob = await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect((completedJob.payload as { source?: unknown }).source).toBeNull();
  }, 40_000);

  it("keeps a previously skipped source record skipped until the user explicitly imports it", async () => {
    const owner = await account("inc_skipped");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const targetTransaction = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        kind: "expense",
        amountCents: 1000,
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
    const sourceTx = { id: randomUUID(), amountCents: 1000, note: "来源B重复" };
    const source = sourceWith("跳过来源", sourceCategoryId, category.name, [sourceTx]);
    const result = await importSmall(
      owner.cookie,
      owner.userId,
      owner.bookId,
      source,
      sourceCategoryId,
      category.id,
      [{ groupId: "skip-group", action: "keep_a", sourceIds: [sourceTx.id], targetIds: [targetId] }],
    );
    expect(result.skippedCount).toBe(1);
    expect(await prisma.ledgerImportSourceState.count({ where: { targetBookId: owner.bookId, decision: "skipped" } })).toBe(1);

    const preview = await incrementalPreview(owner.cookie, owner.bookId, source);
    expect(preview.statuses[0]?.status).toBe("previously_skipped");
    const noOpJob = await createIncrementalJob(
      owner.cookie,
      owner.bookId,
      source,
      sourceCategoryId,
      category.id,
      [{ sourceTransactionId: sourceTx.id, action: "skip" }],
    );
    await waitJob(owner.cookie, noOpJob.id);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(1);

    const importJob = await createIncrementalJob(
      owner.cookie,
      owner.bookId,
      source,
      sourceCategoryId,
      category.id,
      [{ sourceTransactionId: sourceTx.id, action: "import" }],
    );
    await waitJob(owner.cookie, importJob.id);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(2);
  }, 40_000);

  it("treats keep-both as an imported decision and does not prompt again for unchanged content", async () => {
    const owner = await account("inc_keep_both");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const targetTransaction = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        kind: "expense",
        amountCents: 1200,
        currency: "CNY",
        categoryId: category.id,
        paymentMethodId: null,
        occurredAt: "2026-10-18T00:00:00.000Z",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "保留两边A",
        tagIds: [],
      },
    });
    const targetId = (targetTransaction.json() as { id: string }).id;
    const sourceTx = { id: randomUUID(), amountCents: 1200, note: "保留两边B" };
    const source = sourceWith("keep-both来源", sourceCategoryId, category.name, [sourceTx]);
    const result = await importSmall(
      owner.cookie,
      owner.userId,
      owner.bookId,
      source,
      sourceCategoryId,
      category.id,
      [{ groupId: "both-group", action: "keep_both", sourceIds: [sourceTx.id], targetIds: [targetId] }],
    );
    expect(result.importedCount).toBe(1);
    const preview = await incrementalPreview(owner.cookie, owner.bookId, source);
    expect(preview.statuses[0]).toMatchObject({ status: "unchanged", previousDecision: "imported" });
    const targetCount = await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } });
    const job = await createIncrementalJob(owner.cookie, owner.bookId, source, sourceCategoryId, category.id, []);
    await waitJob(owner.cookie, job.id);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(targetCount);
  }, 40_000);
  it("returns an existing paused job for the same source/target instead of creating a duplicate task", async () => {
    const owner = await account("inc_resume_existing");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const source = sourceWith("旧任务来源", sourceCategoryId, category.name, [
      { id: randomUUID(), amountCents: 500, note: "旧任务记录" },
    ]);
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const baseRequest = {
      importId: randomUUID(),
      target: {
        kind: "existing" as const,
        bookId: owner.bookId,
        expectedTargetFingerprint: await fingerprintTargetSnapshot(target),
      },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [{ type: "category" as const, sourceId: sourceCategoryId, action: "reuse" as const, targetId: category.id }],
      duplicateGroups: [],
      incrementalDecisions: [],
    };
    const { createImportJob } = await import("../src/ledger/importJob.js");
    const created = await createImportJob(prisma, owner.userId, baseRequest, { startImmediately: false });
    await prisma.ledgerImportJob.update({ where: { id: created.id }, data: { status: "paused" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/jobs",
      headers: { cookie: owner.cookie },
      payload: { ...baseRequest, importId: randomUUID() },
    });
    expect(response.statusCode).toBe(202);
    expect((response.json() as { id: string }).id).toBe(created.id);
  }, 30_000);

  it("prevents two concurrent incremental jobs from creating the same source record twice", async () => {
    const owner = await account("inc_concurrent");
    const category = await categoryOf(owner.cookie, owner.bookId);
    const sourceCategoryId = randomUUID();
    const source = sourceWith("并发来源", sourceCategoryId, category.name, [
      { id: randomUUID(), amountCents: 700, note: "并发记录" },
    ]);
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const baseRequest = {
      importId: randomUUID(),
      target: {
        kind: "existing" as const,
        bookId: owner.bookId,
        expectedTargetFingerprint: await fingerprintTargetSnapshot(target),
      },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [{ type: "category" as const, sourceId: sourceCategoryId, action: "reuse" as const, targetId: category.id }],
      duplicateGroups: [],
      incrementalDecisions: [],
    };
    const { createImportJob, processImportJob, runImportJobBatchForTest } = await import("../src/ledger/importJob.js");
    const first = await createImportJob(prisma, owner.userId, baseRequest, { startImmediately: false });
    const second = await createImportJob(prisma, owner.userId, { ...baseRequest, importId: randomUUID() }, {
      startImmediately: false,
    });
    // The second create returns the same durable task instead of starting a parallel import.
    expect(second.id).toBe(first.id);
    await runImportJobBatchForTest(prisma, first.id);
    await processImportJob(prisma, first.id);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(1);
  }, 30_000);

});
