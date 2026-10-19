import { randomUUID } from "node:crypto";

import {
  DEFAULT_IMPORT_BATCH_SIZE,
  fingerprintGuestSource,
  fingerprintImportSourceRecord,
  fingerprintTargetSnapshot,
  ledgerImportResultSchema,
  type GuestImportSource,
  type ImportJobRequest,
  type ImportJobStatus,
  type ImportTargetSnapshot,
  type LedgerImportResult,
  type TaxonomyResolution,
} from "@libellum/shared";

import type { PrismaClient } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { allocateTransactionSeq } from "./transactionSeq.js";
import { diffEntry, recordEvent } from "./events.js";
import { analyzeIncremental, resolveIncrementalPlan, writeSourceState, type IncrementalOperation } from "./importIncremental.js";
import { loadFormalImportPair, loadSoloImportBook, lockFormalImportPair, lockSoloImportTarget } from "./importSolo.js";
import { loadTargetSnapshot } from "./importTarget.js";
import {
  assertSourceIsSelfConsistent,
  assertTaxonomyCoverage,
  buildDecisionPlan,
  buildTotals,
  importRefFor,
  resolveTaxonomy,
  type ResolvedTaxonomy,
} from "../routes/ledgerImport.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";

type Tx = Prisma.TransactionClient;

interface StoredTaxonomy {
  readonly categoryIds: Record<string, string>;
  readonly paymentMethodIds: Record<string, string>;
  readonly tagIds: Record<string, string>;
  readonly created: { categories: number; paymentMethods: number; tags: number };
  readonly reused: { categories: number; paymentMethods: number; tags: number };
}

interface RemovedTarget {
  readonly targetTransactionId: string;
  readonly targetVersion: number;
  readonly groupId: string;
}

interface BatchRecord {
  readonly index: number;
  readonly imported: LedgerImportResult["imported"];
  readonly updated: NonNullable<LedgerImportResult["updated"]>;
}

interface JobPayload {
  /**
   * 仅运行中的任务保存完整游客来源快照；完成后在同一最终事务里把 source 清空，
   * 避免任务回执长期保留游客的备注/分类等内容。
   */
  readonly source: GuestImportSource | null;
  readonly taxonomy: readonly TaxonomyResolution[];
  /** D5 phase 2: one operation per source record, including explicit skip/keep decisions. */
  readonly operations: readonly IncrementalOperation[];
  readonly removedTargets: readonly RemovedTarget[];
  readonly importRef: string;
  readonly expectedTotals: LedgerImportResult["totals"];
  readonly batches: readonly BatchRecord[];
  readonly taxonomyResolved: StoredTaxonomy | null;
}

function toStoredTaxonomy(resolved: ResolvedTaxonomy): StoredTaxonomy {
  return {
    categoryIds: Object.fromEntries(resolved.categoryIds),
    paymentMethodIds: Object.fromEntries(resolved.paymentMethodIds),
    tagIds: Object.fromEntries(resolved.tagIds),
    created: resolved.created,
    reused: resolved.reused,
  };
}

function fromStoredTaxonomy(stored: StoredTaxonomy): ResolvedTaxonomy {
  return {
    categoryIds: new Map(Object.entries(stored.categoryIds)),
    paymentMethodIds: new Map(Object.entries(stored.paymentMethodIds)),
    tagIds: new Map(Object.entries(stored.tagIds)),
    created: stored.created,
    reused: stored.reused,
  };
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "import_job_failed";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

function isPermanentPause(code: string): boolean {
  return (
    code === "source_changed" ||
    code === "target_changed" ||
    code === "book_has_pending_invite" ||
    code === "book_has_active_share_link" ||
    code === "book_not_solo" ||
    code === "book_not_owner" ||
    code === "book_forbidden" ||
    code === "book_read_only" ||
    code === "book_deleted" ||
    code === "book_archived" ||
    code === "already_imported" ||
    code === "account_closed" ||
    code === "account_disabled"
  );
}

/**
 * S13 的 HTTP guard 会在每次请求检查账号状态，但后台 worker 不经过 HTTP。
 * 因此每一批和最终删除前必须显式复查：注销/停用账号不能再推进任何导入写入。
 */
async function assertJobUserActive(
  client: Prisma.TransactionClient | PrismaClient,
  userId: string,
): Promise<void> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { closedAt: true, disabledAt: true },
  });
  if (user === null || user.closedAt !== null) {
    throw forbidden("account_closed", "账号已注销，导入任务已暂停。");
  }
  if (user.disabledAt !== null) {
    throw forbidden("account_disabled", "账号已停用，导入任务已暂停。");
  }
}

/** 正在由本进程处理的任务；DB 行锁仍是跨进程/重启的最终防线。 */
const activeJobs = new Set<string>();

function readPayload(job: { payload: unknown }): JobPayload {
  return job.payload as JobPayload;
}

async function jobStatus(prisma: PrismaClient, jobId: string): Promise<ImportJobStatus | null> {
  const job = await prisma.ledgerImportJob.findUnique({ where: { id: jobId } });
  if (job === null) return null;
  return {
    id: job.id,
    status: job.status as ImportJobStatus["status"],
    sourceKind: job.sourceKind as "guest" | "book",
    sourceBookId: job.sourceBookId,
    targetBookId: job.targetBookId,
    batchSize: job.batchSize,
    nextBatch: job.nextBatch,
    totalBatches: job.totalBatches,
    sourceCount: job.sourceCount,
    importedCount: job.importedCount,
    updatedCount: job.updatedCount,
    skippedCount: job.skippedCount,
    removedCount: job.removedCount,
    batches: readPayload(job).batches.map((batch) => ({
      index: batch.index,
      importedCount: batch.imported.length,
    })),
    targetBaselineCount: job.targetBaselineCount,
    targetExpectedCount: job.targetExpectedCount,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    lastErrorCode: job.lastErrorCode,
    lastErrorMessage: job.lastErrorMessage,
    result: job.result === null ? null : ledgerImportResultSchema.parse(job.result),
  };
}

export async function getImportJob(
  prisma: PrismaClient,
  userId: string,
  jobId: string,
): Promise<ImportJobStatus> {
  const job = await prisma.ledgerImportJob.findUnique({ where: { id: jobId } });
  if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
  if (job.userId !== userId) throw forbidden("import_forbidden", "这个导入任务不属于当前账号。");
  const status = await jobStatus(prisma, jobId);
  if (status === null) throw notFound("import_job_missing", "找不到这个导入任务。");
  return status;
}

export async function createImportJob(
  prisma: PrismaClient,
  userId: string,
  body: ImportJobRequest,
  options?: { readonly startImmediately?: boolean },
): Promise<ImportJobStatus> {
  if (body.target.kind !== "existing") {
    throw badRequest("batch_target_required", "分批导入只能导入现有正式账本；请先创建目标账本。");
  }

  const existing = await prisma.ledgerImportJob.findUnique({ where: { id: body.importId } });
  if (existing !== null) {
    if (existing.userId !== userId) throw forbidden("import_forbidden", "这个导入任务不属于当前账号。");
    const status = await jobStatus(prisma, body.importId);
    if (status === null) throw notFound("import_job_missing", "找不到这个导入任务。");
    return status;
  }

  /**
   * 同一来源/目标已有暂停或运行中的任务时，优先返回旧任务，让用户继续而不是新建一个
   * 可能重复写入的任务。来源快照变化（新指纹）才允许创建新任务。
   */
  const resumable = await prisma.ledgerImportJob.findFirst({
    where: {
      userId,
      targetBookId: body.target.bookId,
      sourceKind: body.sourceBookId === undefined ? "guest" : "book",
      sourceBookId: body.sourceBookId ?? null,
      sourceFingerprint: body.sourceFingerprint,
      status: { in: ["queued", "running", "paused", "finalizing"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (resumable !== null) {
    const status = await jobStatus(prisma, resumable.id);
    if (status === null) throw notFound("import_job_missing", "找不到这个导入任务。");
    return status;
  }

  let source: GuestImportSource;
  let sourceFingerprint: string;
  let targetSnapshot: ImportTargetSnapshot;
  let targetFingerprint: string;
  let sourceBookId: string | null = null;

  if (body.sourceBookId !== undefined) {
    const pair = await loadFormalImportPair(prisma, userId, body.sourceBookId, body.target.bookId);
    if (pair.sourceFingerprint !== body.sourceFingerprint) {
      throw conflict("source_changed", "来源账本在预览后发生了变化，请重新预览并确认。");
    }
    if (pair.targetFingerprint !== body.target.expectedTargetFingerprint) {
      throw conflict("target_changed", "目标账本在预览后发生了变化，请重新预览并确认。");
    }
    source = pair.source;
    sourceFingerprint = pair.sourceFingerprint;
    targetSnapshot = pair.target;
    targetFingerprint = pair.targetFingerprint;
    sourceBookId = pair.sourceBookId;
  } else {
    if (body.source === undefined) throw badRequest("source_required", "缺少来源账本或游客快照。");
    assertSourceIsSelfConsistent(body.source);
    source = body.source;
    sourceFingerprint = await fingerprintGuestSource(source);
    if (sourceFingerprint !== body.sourceFingerprint) {
      throw conflict("source_changed", "游客账本在预览后发生了变化，请重新预览并确认。");
    }
    const target = await loadSoloImportBook(prisma, userId, body.target.bookId, "目标");
    targetSnapshot = target.snapshot;
    targetFingerprint = await fingerprintTargetSnapshot(targetSnapshot);
    if (targetFingerprint !== body.target.expectedTargetFingerprint) {
      throw conflict("target_changed", "目标账本在预览后发生了变化，请重新预览并确认。");
    }
  }

  assertTaxonomyCoverage(source, body.taxonomy);
  const plan = buildDecisionPlan(body, source, targetSnapshot, false);
  const analysis = await analyzeIncremental(prisma, body.target.bookId, source, sourceBookId, targetSnapshot);
  const incremental = resolveIncrementalPlan(analysis, body.incrementalDecisions, plan.skippedSourceIds);
  const operationOrder = new Map(
    [...source.transactions]
      .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.id.localeCompare(right.id))
      .map((item, index) => [item.id, index]),
  );
  const operations = [...incremental.operations].sort(
    (left, right) =>
      (operationOrder.get(left.sourceTransactionId) ?? 0) - (operationOrder.get(right.sourceTransactionId) ?? 0),
  );
  const removedTargets: RemovedTarget[] = [...plan.removedTargetIds].map((targetId) => {
    const row = targetSnapshot.transactions.find((item) => item.id === targetId);
    if (row === undefined) throw badRequest("decision_target_missing", "要移除的目标账目不在预览快照中。");
    return {
      targetTransactionId: targetId,
      targetVersion: row.version,
      groupId: plan.groupOfTarget.get(targetId) ?? "",
    };
  });
  const batchSize = body.batchSize ?? DEFAULT_IMPORT_BATCH_SIZE;
  const totalBatches = Math.ceil(operations.length / batchSize);
  const payload: JobPayload = {
    source,
    taxonomy: body.taxonomy,
    operations,
    removedTargets,
    importRef: importRefFor(body.importId),
    expectedTotals: buildTotals(
      source.transactions.filter(
        (item) => incremental.createdIds.has(item.id) || incremental.updatedIds.has(item.id),
      ),
    ),
    batches: [],
    taxonomyResolved: null,
  };

  await prisma.ledgerImportJob.create({
    data: {
      id: body.importId,
      userId,
      sourceKind: sourceBookId === null ? "guest" : "book",
      sourceBookId,
      targetBookId: body.target.bookId,
      status: "queued",
      batchSize,
      nextBatch: 0,
      totalBatches,
      sourceCount: source.transactions.length,
      importedCount: 0,
      updatedCount: 0,
      skippedCount: incremental.skippedIds.size,
      removedCount: 0,
      targetBaselineCount: targetSnapshot.transactions.length,
      targetExpectedCount: targetSnapshot.transactions.length + incremental.createdIds.size,
      sourceFingerprint,
      targetFingerprint,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });

  if (options?.startImmediately === false) {
    // test-only control: caller will drive batches itself to inject failures.
  } else {
    kickImportJob(prisma, body.importId);
  }
  const status = await jobStatus(prisma, body.importId);
  if (status === null) throw notFound("import_job_missing", "找不到这个导入任务。");
  return status;
}

async function runBatch(prisma: PrismaClient, jobId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ledger_import_jobs" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
      const job = await tx.ledgerImportJob.findUnique({ where: { id: jobId } });
      if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
      if (job.status !== "queued" && job.status !== "running") return;
      const payload = readPayload(job);
      if (job.nextBatch >= job.totalBatches) return;
      await assertJobUserActive(tx, job.userId);

      let targetSnapshot: ImportTargetSnapshot;
      if (job.sourceKind === "book") {
        if (job.sourceBookId === null) throw badRequest("source_required", "来源账本缺失。");
        await lockFormalImportPair(tx, job.sourceBookId, job.targetBookId);
        const pair = await loadFormalImportPair(tx, job.userId, job.sourceBookId, job.targetBookId);
        if (pair.sourceFingerprint !== job.sourceFingerprint) {
          throw conflict("source_changed", "来源账本在分批导入期间发生了变化，任务已暂停。");
        }
        if (pair.targetFingerprint !== job.targetFingerprint) {
          throw conflict("target_changed", "目标账本在分批导入期间发生了变化，任务已暂停。");
        }
        targetSnapshot = pair.target;
      } else {
        await lockSoloImportTarget(tx, job.targetBookId);
        const target = await loadSoloImportBook(tx, job.userId, job.targetBookId, "目标");
        const currentFingerprint = await fingerprintTargetSnapshot(target.snapshot);
        if (currentFingerprint !== job.targetFingerprint) {
          throw conflict("target_changed", "目标账本在分批导入期间发生了变化，任务已暂停。");
        }
        targetSnapshot = target.snapshot;
      }

      const source = payload.source;
      if (source === null) throw badRequest("source_missing", "任务来源快照已被清理，不能继续执行。");
      let taxonomy = payload.taxonomyResolved === null ? null : fromStoredTaxonomy(payload.taxonomyResolved);
      if (taxonomy === null) {
        taxonomy = await resolveTaxonomy(tx, job.targetBookId, source, targetSnapshot, payload.taxonomy, false);
      }

      const start = job.nextBatch * job.batchSize;
      const operations = payload.operations.slice(start, start + job.batchSize);
      if (operations.length === 0) return;
      const sourceById = new Map(source.transactions.map((item) => [item.id, item]));
      const sourceCategoryById = new Map(source.categories.map((item) => [item.id, item]));
      const sourcePaymentById = new Map(source.paymentMethods.map((item) => [item.id, item]));

      const createIds = operations
        .filter((operation) => operation.action === "create")
        .map((operation) => operation.sourceTransactionId);
      if (createIds.length > 0) {
        const existingRefs = await tx.transaction.findMany({
          where: { bookId: job.targetBookId, deletedAt: null, sourceRef: { in: createIds } },
          select: { sourceRef: true },
        });
        if (existingRefs.length > 0) {
          throw conflict("already_imported", "部分来源账目已经导入过这本账本，任务已暂停。");
        }
      }

      const imported: LedgerImportResult["imported"] = [];
      const updated: NonNullable<LedgerImportResult["updated"]> = [];
      for (const operation of operations) {
        const item = sourceById.get(operation.sourceTransactionId);
        if (item === undefined) throw badRequest("source_missing", "来源账目缺失。");
        const categoryId = taxonomy.categoryIds.get(item.categoryId);
        const paymentMethodId =
          item.paymentMethodId === null ? null : taxonomy.paymentMethodIds.get(item.paymentMethodId);
        if (
          operation.action !== "skip" &&
          (categoryId === undefined || (item.paymentMethodId !== null && paymentMethodId === undefined))
        ) {
          throw badRequest("taxonomy_missing", "账目的分类或支付方式没有映射。");
        }
        if (!sourceCategoryById.has(item.categoryId)) throw badRequest("source_category_missing", "来源分类不存在。");
        if (item.paymentMethodId !== null && !sourcePaymentById.has(item.paymentMethodId)) {
          throw badRequest("source_payment_missing", "来源支付方式不存在。");
        }
        const tagIds = item.tagIds
          .map((sourceTagId) => taxonomy.tagIds.get(sourceTagId))
          .filter((tagId): tagId is string => tagId !== undefined);

        if (operation.action === "create") {
          const seq = await allocateTransactionSeq(tx, job.targetBookId);
          const targetTransactionId = randomUUID();
          await tx.transaction.create({
            data: {
              id: targetTransactionId,
              seq,
              bookId: job.targetBookId,
              userId: job.userId,
              categoryId: categoryId!,
              paymentMethodId: paymentMethodId ?? null,
              kind: item.kind,
              amountCents: BigInt(item.amountCents),
              currency: item.currency,
              occurredAt: new Date(item.occurredAt),
              occurredLocalDate: new Date(`${item.occurredLocalDate}T00:00:00.000Z`),
              occurredTz: item.occurredTz,
              note: item.note,
              idempotencyKey: randomUUID(),
              sourceRef: item.id,
              importRef: payload.importRef,
              tags: { create: tagIds.map((tagId) => ({ tagId })) },
            },
          });
          imported.push({ sourceTransactionId: item.id, targetTransactionId, targetSeq: seq });
          await writeSourceState(tx, {
            targetBookId: job.targetBookId,
            sourceKind: job.sourceKind as "guest" | "book",
            sourceBookId: job.sourceBookId,
            operation,
            targetTransactionId,
            targetVersion: 1,
            jobId: jobId,
          });
        } else if (operation.action === "update") {
          if (operation.targetTransactionId === null || operation.targetVersion === null) {
            throw conflict("target_changed", "更新目标缺少可验证的版本。");
          }
          const row = await tx.transaction.findFirst({
            where: {
              id: operation.targetTransactionId,
              bookId: job.targetBookId,
              deletedAt: null,
            },
            select: {
              id: true,
              seq: true,
              version: true,
              sourceRef: true,
              kind: true,
              amountCents: true,
              currency: true,
              categoryId: true,
              paymentMethodId: true,
              occurredAt: true,
              occurredLocalDate: true,
              occurredTz: true,
              note: true,
              tags: { select: { tagId: true } },
            },
          });
          if (row === null || row.version !== operation.targetVersion || row.sourceRef !== item.id) {
            throw conflict("target_changed", "目标账目已被其他操作修改，不能覆盖。");
          }
          const changed = await tx.transaction.update({
            where: { id: row.id },
            data: {
              categoryId: categoryId!,
              paymentMethodId: paymentMethodId ?? null,
              kind: item.kind,
              amountCents: BigInt(item.amountCents),
              currency: item.currency,
              occurredAt: new Date(item.occurredAt),
              occurredLocalDate: new Date(`${item.occurredLocalDate}T00:00:00.000Z`),
              occurredTz: item.occurredTz,
              note: item.note,
              version: row.version + 1,
              tags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) },
            },
            select: {
              id: true,
              seq: true,
              version: true,
              kind: true,
              amountCents: true,
              currency: true,
              categoryId: true,
              paymentMethodId: true,
              occurredAt: true,
              occurredLocalDate: true,
              occurredTz: true,
              note: true,
              tags: { select: { tagId: true } },
            },
          });
          const changes = diffEntry(
            {
              kind: row.kind,
              amountCents: row.amountCents,
              currency: row.currency,
              categoryId: row.categoryId,
              paymentMethodId: row.paymentMethodId,
              occurredAt: row.occurredAt,
              occurredLocalDate: row.occurredLocalDate,
              occurredTz: row.occurredTz,
              note: row.note,
              tagIds: row.tags.map((tag) => tag.tagId).sort(),
            },
            {
              kind: changed.kind,
              amountCents: changed.amountCents,
              currency: changed.currency,
              categoryId: changed.categoryId,
              paymentMethodId: changed.paymentMethodId,
              occurredAt: changed.occurredAt,
              occurredLocalDate: changed.occurredLocalDate,
              occurredTz: changed.occurredTz,
              note: changed.note,
              tagIds: changed.tags.map((tag) => tag.tagId).sort(),
            },
          );
          await recordEvent(tx, {
            bookId: job.targetBookId,
            transactionId: row.id,
            transactionSeq: row.seq,
            actorId: job.userId,
            actorName: null,
            kind: "updated",
            changes: {
              ...changes,
              importId: { from: null, to: jobId },
              importSource: { from: null, to: job.sourceKind },
            },
          });
          updated.push({ sourceTransactionId: item.id, targetTransactionId: row.id, targetSeq: row.seq });
          await writeSourceState(tx, {
            targetBookId: job.targetBookId,
            sourceKind: job.sourceKind as "guest" | "book",
            sourceBookId: job.sourceBookId,
            operation,
            targetTransactionId: row.id,
            targetVersion: row.version + 1,
            jobId: jobId,
          });
        } else {
          await writeSourceState(tx, {
            targetBookId: job.targetBookId,
            sourceKind: job.sourceKind as "guest" | "book",
            sourceBookId: job.sourceBookId,
            operation,
            targetTransactionId: operation.targetTransactionId,
            targetVersion: operation.targetVersion,
            jobId: jobId,
          });
        }
      }

      if (taxonomy === null) throw new Error("taxonomy resolution missing");
      const newTargetSnapshot = await loadTargetSnapshot(tx, job.targetBookId);
      const newTargetFingerprint = await fingerprintTargetSnapshot(newTargetSnapshot);
      const nextPayload: JobPayload = {
        ...payload,
        batches: [...payload.batches, { index: job.nextBatch, imported, updated }],
        taxonomyResolved: toStoredTaxonomy(taxonomy),
      };
      await tx.ledgerImportJob.update({
        where: { id: jobId },
        data: {
          status: "running",
          nextBatch: job.nextBatch + 1,
          importedCount: job.importedCount + imported.length,
          updatedCount: job.updatedCount + updated.length,
          targetFingerprint: newTargetFingerprint,
          targetExpectedCount: job.targetBaselineCount + job.importedCount + imported.length,
          payload: nextPayload as unknown as Prisma.InputJsonValue,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });

    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

async function finalizeJob(prisma: PrismaClient, jobId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ledger_import_jobs" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
      const job = await tx.ledgerImportJob.findUnique({ where: { id: jobId } });
      if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
      if (job.status === "completed") return;
      if (job.status !== "queued" && job.status !== "running" && job.status !== "finalizing") return;
      const payload = readPayload(job);
      await assertJobUserActive(tx, job.userId);

      let targetSnapshot: ImportTargetSnapshot;
      if (job.sourceKind === "book") {
        if (job.sourceBookId === null) throw badRequest("source_required", "来源账本缺失。");
        await lockFormalImportPair(tx, job.sourceBookId, job.targetBookId);
        const pair = await loadFormalImportPair(tx, job.userId, job.sourceBookId, job.targetBookId);
        if (pair.sourceFingerprint !== job.sourceFingerprint) {
          throw conflict("source_changed", "来源账本在最终确认前发生了变化，任务已暂停。");
        }
        if (pair.targetFingerprint !== job.targetFingerprint) {
          throw conflict("target_changed", "目标账本在最终确认前发生了变化，任务已暂停。");
        }
        targetSnapshot = pair.target;
      } else {
        await lockSoloImportTarget(tx, job.targetBookId);
        const target = await loadSoloImportBook(tx, job.userId, job.targetBookId, "目标");
        const currentFingerprint = await fingerprintTargetSnapshot(target.snapshot);
        if (currentFingerprint !== job.targetFingerprint) {
          throw conflict("target_changed", "目标账本在最终确认前发生了变化，任务已暂停。");
        }
        targetSnapshot = target.snapshot;
      }

      const liveCount = await tx.transaction.count({ where: { bookId: job.targetBookId, deletedAt: null } });
      if (liveCount !== job.targetExpectedCount) {
        throw conflict("target_changed", "目标账本账目数量与分批记录不一致，任务已暂停。");
      }

      const removedTargets: NonNullable<LedgerImportResult["removedTargets"]> = [];
      if (payload.removedTargets.length > 0) {
        const deletedAt = new Date();
        for (const target of payload.removedTargets) {
          const row = await tx.transaction.findFirst({
            where: { id: target.targetTransactionId, bookId: job.targetBookId, deletedAt: null },
            select: { id: true, seq: true, version: true },
          });
          if (row === null || row.version !== target.targetVersion) {
            throw conflict("target_changed", "要移除的目标账目已被修改或删除，任务已暂停。");
          }
          await tx.transaction.update({
            where: { id: row.id },
            data: { deletedAt, version: row.version + 1 },
          });
          await recordEvent(tx, {
            bookId: job.targetBookId,
            transactionId: row.id,
            transactionSeq: row.seq,
            actorId: job.userId,
            actorName: null,
            kind: "deleted",
            changes: {
              importId: { from: null, to: jobId },
              importSource: { from: null, to: job.sourceKind },
              importGroupId: { from: null, to: target.groupId },
            },
          });
          removedTargets.push({ targetTransactionId: row.id, targetSeq: row.seq, groupId: target.groupId });
        }
      }

      const targetCountAfter = await tx.transaction.count({ where: { bookId: job.targetBookId, deletedAt: null } });
      const expectedAfter = job.targetExpectedCount - removedTargets.length;
      if (targetCountAfter !== expectedAfter) {
        throw new Error("最终对账失败：目标账目数量不一致，已回滚最终处理。");
      }
      const finalTargetSnapshot = await loadTargetSnapshot(tx, job.targetBookId);
      const finalTargetFingerprint = await fingerprintTargetSnapshot(finalTargetSnapshot);

      const imported = payload.batches.flatMap((batch) => batch.imported);
      const updated = payload.batches.flatMap((batch) => batch.updated ?? []);
      const taxonomy = payload.taxonomyResolved;
      const targetRow = await tx.book.findUnique({
        where: { id: job.targetBookId },
        select: { name: true, bookNumber: true },
      });
      if (targetRow === null) throw notFound("book_missing", "目标账本不存在。");
      const receipt = ledgerImportResultSchema.parse({
        importId: jobId,
        ...(job.sourceBookId === null ? {} : { sourceBookId: job.sourceBookId }),
        targetBook: {
          id: job.targetBookId,
          name: targetRow.name,
          bookNumber: targetRow.bookNumber,
          created: false,
        },
        sourceCount: job.sourceCount,
        importedCount: job.importedCount,
        updatedCount: job.updatedCount,
        skippedCount: job.skippedCount,
        removedCount: removedTargets.length,
        targetExistingBefore: job.targetBaselineCount,
        targetCountAfter,
        removedTargets,
        totals: payload.expectedTotals,
        imported,
        updated,
        taxonomy: {
          categoriesCreated: taxonomy?.created.categories ?? 0,
          paymentMethodsCreated: taxonomy?.created.paymentMethods ?? 0,
          tagsCreated: taxonomy?.created.tags ?? 0,
          categoriesReused: taxonomy?.reused.categories ?? 0,
          paymentMethodsReused: taxonomy?.reused.paymentMethods ?? 0,
          tagsReused: taxonomy?.reused.tags ?? 0,
        },
        reconciled: true,
      });

      const existingReceipt = await tx.ledgerImport.findUnique({ where: { id: jobId } });
      if (existingReceipt === null) {
        await tx.ledgerImport.create({
          data: {
            id: jobId,
            userId: job.userId,
            targetBookId: job.targetBookId,
            targetCreated: false,
            sourceFingerprint: job.sourceFingerprint,
            targetFingerprint: finalTargetFingerprint,
            importedCount: job.importedCount,
            skippedCount: job.skippedCount,
            result: receipt,
          },
        });
      }

      await tx.ledgerImportJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          removedCount: removedTargets.length,
          updatedCount: job.updatedCount,
          targetFingerprint: finalTargetFingerprint,
          targetExpectedCount: targetCountAfter,
          result: receipt,
          // Data minimization: completed jobs no longer need the guest snapshot.
          payload: { ...payload, source: null, operations: [] } as unknown as Prisma.InputJsonValue,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

async function markJobError(prisma: PrismaClient, jobId: string, error: unknown): Promise<void> {
  const code = errorCode(error);
  const message = errorMessage(error);
  await prisma.ledgerImportJob.update({
    where: { id: jobId },
    data: {
      status: isPermanentPause(code) ? "paused" : "failed",
      lastErrorCode: code,
      lastErrorMessage: message,
    },
  });
}

export async function processImportJob(prisma: PrismaClient, jobId: string): Promise<void> {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  try {
    for (;;) {
      const job = await prisma.ledgerImportJob.findUnique({ where: { id: jobId } });
      if (job === null) return;
      if (
        job.status !== "queued" &&
        job.status !== "running" &&
        job.status !== "finalizing"
      ) {
        return;
      }
      if (job.nextBatch < job.totalBatches) {
        await runBatch(prisma, jobId);
        continue;
      }
      await finalizeJob(prisma, jobId);
      return;
    }
  } catch (error) {
    await markJobError(prisma, jobId, error);
  } finally {
    activeJobs.delete(jobId);
  }
}

export function kickImportJob(prisma: PrismaClient, jobId: string): void {
  setImmediate(() => {
    void processImportJob(prisma, jobId).catch(() => undefined);
  });
}

/** Test-only entry points for deterministic fault injection; production uses `processImportJob`. */
export async function runImportJobBatchForTest(prisma: PrismaClient, jobId: string): Promise<void> {
  await runBatch(prisma, jobId);
}

export async function finalizeImportJobForTest(prisma: PrismaClient, jobId: string): Promise<void> {
  await finalizeJob(prisma, jobId);
}

/**
 * 进程启动后恢复排队/中断的任务。
 *
 * 只有在存在全局 Prisma client 时才恢复；路由注册时会把 client 放进全局槽，
 * 避免模块级 import 循环。
 */
export async function recoverImportJobs(prisma: PrismaClient): Promise<void> {
  const jobs = await prisma.ledgerImportJob.findMany({
    where: { status: { in: ["queued", "running", "finalizing"] } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const job of jobs) kickImportJob(prisma, job.id);
}

export async function resumeImportJob(
  prisma: PrismaClient,
  userId: string,
  jobId: string,
): Promise<ImportJobStatus> {
  const job = await prisma.ledgerImportJob.findUnique({ where: { id: jobId } });
  if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
  if (job.userId !== userId) throw forbidden("import_forbidden", "这个导入任务不属于当前账号。");
  if (job.status === "completed") return getImportJob(prisma, userId, jobId);
  if (job.status === "cancelled") throw badRequest("import_job_cancelled", "这个导入任务已取消。");
  await prisma.ledgerImportJob.update({
    where: { id: jobId },
    data: { status: "queued", lastErrorCode: null, lastErrorMessage: null },
  });
  kickImportJob(prisma, jobId);
  return getImportJob(prisma, userId, jobId);
}

/** 注册到 app.onReady：把 prisma 放进 kick 使用的全局槽，并恢复中断任务。 */
export function prepareImportJobWorker(prisma: PrismaClient): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    void recoverImportJobs(prisma).catch(() => undefined);
  }, 5_000);
  timer.unref?.();
  void recoverImportJobs(prisma).catch(() => undefined);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
