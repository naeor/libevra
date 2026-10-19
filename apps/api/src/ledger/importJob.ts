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
import { Prisma } from "../generated/prisma/client.js";
import { allocateTransactionSeq } from "./transactionSeq.js";
import { diffEntry, recordEvent } from "./events.js";
import { analyzeIncremental, resolveIncrementalPlan, sourceBookKeyOf, sourceNamespaceOf, writeSourceState, type IncrementalOperation } from "./importIncremental.js";
import { loadFormalImportPair, loadSoloImportBook, lockFormalImportPair, lockSoloImportTarget } from "./importSolo.js";
import {
  acquireLedgerLocks,
  assertJobLocks,
  confirmTimeoutSeconds,
  releaseJobLocks,
  setLedgerLockOwner,
} from "./ledgerLocks.js";
import {
  applyUndoOps,
  getSourceStateBefore,
  readTransactionBefore,
  readUndoBatch,
  writeUndoBatch,
  type UndoOp,
} from "./importUndo.js";
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
  readonly createdIds?: {
    readonly categories: readonly string[];
    readonly paymentMethods: readonly string[];
    readonly tags: readonly string[];
  };
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
    createdIds: resolved.createdIds,
    reused: resolved.reused,
  };
}

function fromStoredTaxonomy(stored: StoredTaxonomy): ResolvedTaxonomy {
  return {
    categoryIds: new Map(Object.entries(stored.categoryIds)),
    paymentMethodIds: new Map(Object.entries(stored.paymentMethodIds)),
    tagIds: new Map(Object.entries(stored.tagIds)),
    created: stored.created,
    createdIds: stored.createdIds ?? { categories: [], paymentMethods: [], tags: [] },
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

async function recordJobEvent(
  tx: Tx,
  input: {
    readonly jobId: string;
    readonly kind: string;
    readonly actorUserId: string | null;
    readonly detail?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.ledgerImportJobEvent.create({
    data: {
      jobId: input.jobId,
      kind: input.kind,
      actorUserId: input.actorUserId,
      detail: (input.detail ?? {}) as unknown as Prisma.InputJsonValue,
    },
  });
}

async function jobStatus(prisma: PrismaClient, jobId: string): Promise<ImportJobStatus | null> {
  const job = await prisma.ledgerImportJob.findUnique({ where: { id: jobId } });
  if (job === null) return null;
  return {
    id: job.id,
    status: job.status as ImportJobStatus["status"],
    phase: job.phase,
    timeoutSeconds: job.timeoutSeconds,
    activityAt: job.activityAt?.toISOString() ?? null,
    confirmationDeadline: job.confirmationDeadline?.toISOString() ?? null,
    undoAttempts: job.undoAttempts,
    canConfirm: job.status === "awaiting_confirmation",
    canUndo:
      job.phase >= 4 &&
      (job.status === "queued" ||
        job.status === "running" ||
        job.status === "paused" ||
        job.status === "awaiting_confirmation" ||
        job.status === "undo_failed"),
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
  options?: { readonly startImmediately?: boolean; readonly timeoutSeconds?: number },
): Promise<ImportJobStatus> {
  if (body.target.kind !== "existing") {
    throw badRequest("batch_target_required", "分批导入只能导入现有正式账本；请先创建目标账本。");
  }
  const targetBookId = body.target.bookId;

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
      status: {
        in: [
          "queued",
          "running",
          "paused",
          "finalizing",
          "awaiting_confirmation",
          "confirming",
          "undoing",
          "undo_failed",
        ],
      },
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
  const analysis = await analyzeIncremental(
    prisma,
    body.target.bookId,
    source,
    sourceBookId,
    targetSnapshot,
    source.guestBookId ?? null,
  );
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

  const timeoutSeconds = options?.timeoutSeconds ?? confirmTimeoutSeconds();
  const lockedBooks = sourceBookId === null ? [body.target.bookId] : [body.target.bookId, sourceBookId];
  await prisma.$transaction(
    async (tx) => {
      await acquireLedgerLocks(tx, body.importId, lockedBooks);
      await tx.ledgerImportJob.create({
        data: {
          id: body.importId,
          userId,
          sourceKind: sourceBookId === null ? "guest" : "book",
          sourceBookId,
          targetBookId,
          status: "queued",
          phase: 4,
          timeoutSeconds,
          activityAt: new Date(),
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
      await recordJobEvent(tx, {
        jobId: body.importId,
        kind: "queued",
        actorUserId: userId,
        detail: { sourceKind: sourceBookId === null ? "guest" : "book", timeoutSeconds },
      });
    },
    { maxWait: 10_000, timeout: 60_000 },
  );

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
      await assertJobUserActive(tx, job.userId);
      if (job.phase >= 4) {
        await setLedgerLockOwner(tx, jobId);
        await assertJobLocks(
          tx,
          jobId,
          job.sourceBookId === null ? [job.targetBookId] : [job.targetBookId, job.sourceBookId],
        );
      }
      const payload = readPayload(job);
      if (job.nextBatch >= job.totalBatches) return;
      const undoOps: UndoOp[] = [];

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
      const guestBookId = source.guestBookId ?? null;
      const sourceNamespace = sourceNamespaceOf(job.sourceBookId, guestBookId);
      let taxonomy = payload.taxonomyResolved === null ? null : fromStoredTaxonomy(payload.taxonomyResolved);
      const newlyCreatedTaxonomy = payload.taxonomyResolved === null;
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
          where: {
            bookId: job.targetBookId,
            deletedAt: null,
            sourceRef: { in: createIds },
            sourceNamespace: { in: sourceNamespace === "" ? [""] : [sourceNamespace, ""] },
          },
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
        const sourceStateKey = sourceBookKeyOf(job.sourceBookId, guestBookId);
        const sourceStateBefore = await getSourceStateBefore(
          tx,
          job.targetBookId,
          sourceStateKey,
          item.id,
        );

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
              sourceNamespace,
              importRef: payload.importRef,
              tags: { create: tagIds.map((tagId) => ({ tagId })) },
            },
          });
          imported.push({ sourceTransactionId: item.id, targetTransactionId, targetSeq: seq });
          undoOps.push({ kind: "delete_created_transaction", transactionId: targetTransactionId });
          await writeSourceState(tx, {
            targetBookId: job.targetBookId,
            sourceKind: job.sourceKind as "guest" | "book",
            sourceBookId: job.sourceBookId,
            guestBookId,
            operation,
            targetTransactionId,
            targetVersion: 1,
            jobId: jobId,
          });
          undoOps.push({
            kind: "restore_source_state",
            targetBookId: job.targetBookId,
            sourceBookKey: sourceStateKey,
            sourceTransactionId: item.id,
            before: sourceStateBefore,
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
          const transactionBefore = await readTransactionBefore(tx, row.id);
          if (transactionBefore === null) {
            throw conflict("target_changed", "目标账目缺少可撤销快照，不能覆盖。");
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
              sourceNamespace,
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
            guestBookId,
            operation,
            targetTransactionId: row.id,
            targetVersion: row.version + 1,
            jobId: jobId,
          });
          undoOps.push({
            kind: "restore_transaction",
            transactionId: row.id,
            expectedVersion: row.version + 1,
            before: transactionBefore,
          });
          undoOps.push({
            kind: "restore_source_state",
            targetBookId: job.targetBookId,
            sourceBookKey: sourceStateKey,
            sourceTransactionId: item.id,
            before: sourceStateBefore,
          });
        } else {
          await writeSourceState(tx, {
            targetBookId: job.targetBookId,
            sourceKind: job.sourceKind as "guest" | "book",
            sourceBookId: job.sourceBookId,
            guestBookId,
            operation,
            targetTransactionId: operation.targetTransactionId,
            targetVersion: operation.targetVersion,
            jobId: jobId,
          });
          undoOps.push({
            kind: "restore_source_state",
            targetBookId: job.targetBookId,
            sourceBookKey: sourceStateKey,
            sourceTransactionId: item.id,
            before: sourceStateBefore,
          });
        }
      }

      if (taxonomy === null) throw new Error("taxonomy resolution missing");
      if (newlyCreatedTaxonomy) {
        for (const id of taxonomy.createdIds.categories) {
          undoOps.push({ kind: "delete_created_taxonomy", entity: "category", id });
        }
        for (const id of taxonomy.createdIds.paymentMethods) {
          undoOps.push({ kind: "delete_created_taxonomy", entity: "paymentMethod", id });
        }
        for (const id of taxonomy.createdIds.tags) {
          undoOps.push({ kind: "delete_created_taxonomy", entity: "tag", id });
        }
      }
      await writeUndoBatch(tx, jobId, job.nextBatch, undoOps);
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

async function prepareAwaitingConfirmation(prisma: PrismaClient, jobId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ledger_import_jobs" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
      const job = await tx.ledgerImportJob.findUnique({ where: { id: jobId } });
      if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
      if (job.status === "awaiting_confirmation" || job.status === "confirmed" || job.status === "completed") return;
      if (job.status !== "queued" && job.status !== "running" && job.status !== "finalizing") return;
      await assertJobUserActive(tx, job.userId);
      await setLedgerLockOwner(tx, jobId);
      await assertJobLocks(
        tx,
        jobId,
        job.sourceBookId === null ? [job.targetBookId] : [job.targetBookId, job.sourceBookId],
      );
      const payload = readPayload(job);

      if (job.sourceKind === "book") {
        if (job.sourceBookId === null) throw badRequest("source_required", "来源账本缺失。");
        await lockFormalImportPair(tx, job.sourceBookId, job.targetBookId);
        const pair = await loadFormalImportPair(tx, job.userId, job.sourceBookId, job.targetBookId);
        if (pair.sourceFingerprint !== job.sourceFingerprint) {
          throw conflict("source_changed", "来源账本在等待确认前发生了变化，任务已暂停。");
        }
        if (pair.targetFingerprint !== job.targetFingerprint) {
          throw conflict("target_changed", "目标账本在等待确认前发生了变化，任务已暂停。");
        }
      } else {
        await lockSoloImportTarget(tx, job.targetBookId);
        const target = await loadSoloImportBook(tx, job.userId, job.targetBookId, "目标");
        const currentFingerprint = await fingerprintTargetSnapshot(target.snapshot);
        if (currentFingerprint !== job.targetFingerprint) {
          throw conflict("target_changed", "目标账本在等待确认前发生了变化，任务已暂停。");
        }
      }

      const liveCount = await tx.transaction.count({ where: { bookId: job.targetBookId, deletedAt: null } });
      if (liveCount !== job.targetExpectedCount) {
        throw conflict("target_changed", "目标账本账目数量与分批记录不一致，任务已暂停。");
      }

      const now = new Date();
      const deadline = new Date(now.getTime() + job.timeoutSeconds * 1_000);
      await tx.ledgerImportJob.update({
        where: { id: jobId },
        data: {
          status: "awaiting_confirmation",
          activityAt: now,
          confirmationDeadline: deadline,
          // The inverse journal is sufficient to undo committed batches; the guest snapshot is
          // no longer needed for confirmation and should not be retained while waiting 10 minutes.
          payload: { ...payload, source: null, operations: [] } as unknown as Prisma.InputJsonValue,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      await recordJobEvent(tx, {
        jobId,
        kind: "awaiting_confirmation",
        actorUserId: job.userId,
        detail: { timeoutSeconds: job.timeoutSeconds, deadline: deadline.toISOString() },
      });
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

async function confirmJobTransaction(prisma: PrismaClient, jobId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ledger_import_jobs" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
      const job = await tx.ledgerImportJob.findUnique({ where: { id: jobId } });
      if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
      if (job.status === "confirmed" || job.status === "completed") return;
      if (job.status !== "confirming") return;
      await assertJobUserActive(tx, job.userId);
      await setLedgerLockOwner(tx, jobId);
      await assertJobLocks(
        tx,
        jobId,
        job.sourceBookId === null ? [job.targetBookId] : [job.targetBookId, job.sourceBookId],
      );
      const payload = readPayload(job);

      if (job.sourceKind === "book") {
        if (job.sourceBookId === null) throw badRequest("source_required", "来源账本缺失。");
        await lockFormalImportPair(tx, job.sourceBookId, job.targetBookId);
        const pair = await loadFormalImportPair(tx, job.userId, job.sourceBookId, job.targetBookId);
        if (pair.sourceFingerprint !== job.sourceFingerprint) {
          throw conflict("source_changed", "来源账本在确认前发生了变化，任务已暂停。");
        }
        if (pair.targetFingerprint !== job.targetFingerprint) {
          throw conflict("target_changed", "目标账本在确认前发生了变化，任务已暂停。");
        }
      } else {
        await lockSoloImportTarget(tx, job.targetBookId);
        const target = await loadSoloImportBook(tx, job.userId, job.targetBookId, "目标");
        const currentFingerprint = await fingerprintTargetSnapshot(target.snapshot);
        if (currentFingerprint !== job.targetFingerprint) {
          throw conflict("target_changed", "目标账本在确认前发生了变化，任务已暂停。");
        }
      }

      const liveCount = await tx.transaction.count({ where: { bookId: job.targetBookId, deletedAt: null } });
      if (liveCount !== job.targetExpectedCount) {
        throw conflict("target_changed", "目标账本账目数量与分批记录不一致，任务已暂停。");
      }

      // Target A soft deletions are deliberately deferred until the user's final confirmation.
      // Undo before this point therefore never has to resurrect a soft-deleted A row.
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
          status: "confirmed",
          removedCount: removedTargets.length,
          updatedCount: job.updatedCount,
          targetFingerprint: finalTargetFingerprint,
          targetExpectedCount: targetCountAfter,
          result: receipt,
          confirmationDeadline: null,
          payload: { ...payload, source: null, operations: [] } as unknown as Prisma.InputJsonValue,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      await releaseJobLocks(tx, jobId);
      // Once confirmed, inverse before-values can never be used again; retain event history only.
      await tx.ledgerImportUndoBatch.updateMany({
        where: { jobId },
        data: { payload: { version: 1, ops: [] } as unknown as Prisma.InputJsonValue },
      });
      await recordJobEvent(tx, {
        jobId,
        kind: "confirmed",
        actorUserId: job.userId,
        detail: { removedCount: removedTargets.length, targetCountAfter },
      });
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

/** Legacy name kept for test helpers; phase 4 stops at awaiting_confirmation instead of auto-completing. */
async function finalizeJob(prisma: PrismaClient, jobId: string): Promise<void> {
  await prepareAwaitingConfirmation(prisma, jobId);
}

async function markJobError(prisma: PrismaClient, jobId: string, error: unknown): Promise<void> {
  const code = errorCode(error);
  const message = errorMessage(error);
  const job = await prisma.ledgerImportJob.findUnique({ where: { id: jobId } });
  if (job === null) return;
  if (job.phase >= 4) {
    const now = new Date();
    const deadline = new Date(now.getTime() + job.timeoutSeconds * 1_000);
    await prisma.$transaction(async (tx) => {
      await tx.ledgerImportJob.update({
        where: { id: jobId },
        data: {
          status: "paused",
          activityAt: now,
          confirmationDeadline: deadline,
          lastErrorCode: code,
          lastErrorMessage: message,
        },
      });
      await recordJobEvent(tx, {
        jobId,
        kind: "paused",
        actorUserId: null,
        detail: { code, deadline: deadline.toISOString() },
      });
    });
    return;
  }
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
      if (job.phase < 4) {
        // Phase-4 code must not drive a legacy lockless job through the new confirmation flow.
        // Surface a clear re-preview requirement rather than silently writing or holding no lock.
        await prisma.ledgerImportJob.updateMany({
          where: { id: jobId, phase: { lt: 4 }, status: { in: ["queued", "running", "finalizing"] } },
          data: {
            status: "failed",
            lastErrorCode: "legacy_import_requires_repreview",
            lastErrorMessage: "这是旧版分批导入任务，升级后请重新预览并创建新的可撤销任务。",
          },
        });
        return;
      }
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

const activeConfirmJobs = new Set<string>();
const activeUndoJobs = new Set<string>();

export async function confirmImportJob(
  prisma: PrismaClient,
  userId: string,
  jobId: string,
): Promise<ImportJobStatus> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ledger_import_jobs" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
    const job = await tx.ledgerImportJob.findUnique({ where: { id: jobId } });
    if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
    if (job.userId !== userId) throw forbidden("import_forbidden", "这个导入任务不属于当前账号。");
    if (job.status === "confirmed" || job.status === "completed") return;
    if (job.status === "confirming") return;
    if (job.status !== "awaiting_confirmation") {
      throw badRequest("import_not_awaiting_confirmation", "任务还没有进入等待确认状态。");
    }
    await tx.ledgerImportJob.update({
      where: { id: jobId },
      data: {
        status: "confirming",
        confirmationDeadline: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    await recordJobEvent(tx, {
      jobId,
      kind: "confirming",
      actorUserId: userId,
      detail: {},
    });
  });
  setImmediate(() => {
    void processConfirmJob(prisma, jobId).catch(() => undefined);
  });
  return getImportJob(prisma, userId, jobId);
}

async function processConfirmJob(prisma: PrismaClient, jobId: string): Promise<void> {
  if (activeConfirmJobs.has(jobId)) return;
  activeConfirmJobs.add(jobId);
  try {
    await confirmJobTransaction(prisma, jobId);
  } catch (error) {
    const code = errorCode(error);
    const message = errorMessage(error);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ledger_import_jobs" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
      const job = await tx.ledgerImportJob.findUnique({ where: { id: jobId } });
      if (job === null || job.status !== "confirming") return;
      const now = new Date();
      await tx.ledgerImportJob.update({
        where: { id: jobId },
        data: {
          status: "awaiting_confirmation",
          lastErrorCode: code,
          lastErrorMessage: message,
          confirmationDeadline: new Date(now.getTime() + job.timeoutSeconds * 1_000),
          activityAt: now,
        },
      });
      await recordJobEvent(tx, {
        jobId,
        kind: "confirm_failed",
        actorUserId: null,
        detail: { code },
      });
    });
  } finally {
    activeConfirmJobs.delete(jobId);
  }
}

async function startUndoTransaction(
  prisma: PrismaClient,
  jobId: string,
  userId: string | null,
): Promise<"nothing" | "started"> {
  const started = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ledger_import_jobs" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
    const job = await tx.ledgerImportJob.findUnique({ where: { id: jobId } });
    if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
    if (userId !== null && job.userId !== userId) {
      throw forbidden("import_forbidden", "这个导入任务不属于当前账号。");
    }
    if (job.phase < 4) {
      throw conflict(
        "legacy_import_not_undoable",
        "这是旧版导入任务，没有可按批次恢复的反向日志，不能安全撤销；请使用旧版停止接口或等待其完成。",
      );
    }
    if (job.status === "undone" || job.status === "cancelled" || job.status === "expired") return false;
    if (job.status === "undoing") return false;
    if (job.status === "confirming" || job.status === "confirmed" || job.status === "completed") {
      throw conflict("import_already_confirmed", "任务已经确认，不能再撤销。");
    }
    if (job.status === "undo_failed") {
      // Explicit retry / background recovery: keep the lock and continue from the pending batches.
    } else if (
      job.status !== "queued" &&
      job.status !== "running" &&
      job.status !== "paused" &&
      job.status !== "awaiting_confirmation" &&
      job.status !== "finalizing"
    ) {
      throw badRequest("import_job_not_undoable", "当前任务状态不能撤销。");
    }
    await tx.ledgerImportJob.update({
      where: { id: jobId },
      data: {
        status: "undoing",
        undoAttempts: job.undoAttempts + 1,
        confirmationDeadline: null,
        activityAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    await recordJobEvent(tx, {
      jobId,
      kind: "undoing",
      actorUserId: userId,
      detail: { attempt: job.undoAttempts + 1, previousStatus: job.status },
    });
    return true;
  });
  return started ? "started" : "nothing";
}

export async function undoImportJob(
  prisma: PrismaClient,
  userId: string,
  jobId: string,
): Promise<ImportJobStatus> {
  const result = await startUndoTransaction(prisma, jobId, userId);
  setImmediate(() => {
    void processUndoJob(prisma, jobId).catch(() => undefined);
  });
  return result === "nothing" ? getImportJob(prisma, userId, jobId) : getImportJob(prisma, userId, jobId);
}

async function processUndoJob(prisma: PrismaClient, jobId: string): Promise<void> {
  if (activeUndoJobs.has(jobId)) return;
  activeUndoJobs.add(jobId);
  try {
    for (;;) {
      const job = await prisma.ledgerImportJob.findUnique({ where: { id: jobId } });
      if (job === null) return;
      if (job.status !== "undoing") return;
      const pending = await prisma.ledgerImportUndoBatch.findFirst({
        where: { jobId, undoneAt: null },
        orderBy: { batchIndex: "desc" },
        select: { id: true },
      });
      if (pending !== null) {
        await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "ledger_import_jobs" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
            const current = await tx.ledgerImportJob.findUnique({ where: { id: jobId } });
            if (current === null || current.status !== "undoing") return;
            await setLedgerLockOwner(tx, jobId);
            await assertJobLocks(
              tx,
              jobId,
              current.sourceBookId === null
                ? [current.targetBookId]
                : [current.targetBookId, current.sourceBookId],
            );
            const row = await tx.ledgerImportUndoBatch.findFirst({
              where: { jobId, undoneAt: null },
              orderBy: { batchIndex: "desc" },
            });
            if (row === null) return;
            const payload = readPayload(current);
            await applyUndoOps(
              tx,
              {
                id: jobId,
                targetBookId: current.targetBookId,
                userId: current.userId,
                importRef: payload.importRef,
              },
              readUndoBatch(row.payload).ops,
            );
            await tx.ledgerImportUndoBatch.update({
              where: { id: row.id },
              data: { undoneAt: new Date() },
            });
            await recordJobEvent(tx, {
              jobId,
              kind: "undo_batch",
              actorUserId: null,
              detail: { batchIndex: row.batchIndex },
            });
          },
          { maxWait: 10_000, timeout: 60_000 },
        );
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ledger_import_jobs" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
        const current = await tx.ledgerImportJob.findUnique({ where: { id: jobId } });
        if (current === null || current.status !== "undoing") return;
        const remaining = await tx.ledgerImportUndoBatch.count({ where: { jobId, undoneAt: null } });
        if (remaining > 0) throw new Error("撤销仍有未完成批次。");
        await releaseJobLocks(tx, jobId);
        await tx.ledgerImportUndoBatch.updateMany({
          where: { jobId },
          data: { payload: { version: 1, ops: [] } as unknown as Prisma.InputJsonValue },
        });
        await tx.ledgerImportJob.update({
          where: { id: jobId },
          data: {
            status: "undone",
            result: Prisma.DbNull,
            confirmationDeadline: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            // Data minimization: the inverse journal has served its purpose; retain counts/history.
            payload: {
              ...readPayload(current),
              source: null,
              operations: [],
            } as unknown as Prisma.InputJsonValue,
          },
        });
        await recordJobEvent(tx, {
          jobId,
          kind: "undone",
          actorUserId: null,
          detail: { attempts: current.undoAttempts },
        });
      });
      return;
    }
  } catch (error) {
    const code = errorCode(error);
    const message = errorMessage(error);
    await prisma.ledgerImportJob.update({
      where: { id: jobId },
      data: { status: "undo_failed", lastErrorCode: code, lastErrorMessage: message },
    });
  } finally {
    activeUndoJobs.delete(jobId);
  }
}

export async function refreshImportJobActivity(
  prisma: PrismaClient,
  userId: string,
  jobId: string,
): Promise<ImportJobStatus> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ledger_import_jobs" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
    const job = await tx.ledgerImportJob.findUnique({ where: { id: jobId } });
    if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
    if (job.userId !== userId) throw forbidden("import_forbidden", "这个导入任务不属于当前账号。");
    if (job.status !== "awaiting_confirmation" && job.status !== "paused") {
      throw badRequest("import_not_waiting", "任务当前不在等待确认或暂停状态。");
    }
    const now = new Date();
    await tx.ledgerImportJob.update({
      where: { id: jobId },
      data: {
        activityAt: now,
        confirmationDeadline: new Date(now.getTime() + job.timeoutSeconds * 1_000),
      },
    });
  });
  return getImportJob(prisma, userId, jobId);
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
    where: {
      OR: [
        { status: { in: ["queued", "running", "finalizing"] } },
        { status: "confirming" },
        { status: "undoing" },
      ],
    },
    select: { id: true, status: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const job of jobs) {
    if (job.status === "confirming") {
      void processConfirmJob(prisma, job.id).catch(() => undefined);
    } else if (job.status === "undoing") {
      void processUndoJob(prisma, job.id).catch(() => undefined);
    } else {
      kickImportJob(prisma, job.id);
    }
  }
}

export async function resumeImportJob(
  prisma: PrismaClient,
  userId: string,
  jobId: string,
): Promise<ImportJobStatus> {
  const job = await prisma.ledgerImportJob.findUnique({ where: { id: jobId } });
  if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
  if (job.userId !== userId) throw forbidden("import_forbidden", "这个导入任务不属于当前账号。");
  if (job.status === "completed" || job.status === "confirmed" || job.status === "undone") {
    return getImportJob(prisma, userId, jobId);
  }
  if (job.status === "cancelled" || job.status === "expired") {
    throw badRequest("import_job_cancelled", "这个导入任务已取消或恢复快照已过期，不能继续。");
  }
  if (job.status === "awaiting_confirmation") {
    throw badRequest("import_awaiting_confirmation", "任务已经处理完批次，请确认完成或撤销，不能继续执行。");
  }
  if (job.status !== "paused" && job.status !== "queued" && job.status !== "failed") {
    throw badRequest("import_job_not_resumable", "当前任务状态不能继续。");
  }
  await prisma.$transaction(async (tx) => {
    await tx.ledgerImportJob.update({
      where: { id: jobId },
      data: {
        status: "queued",
        activityAt: new Date(),
        confirmationDeadline: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    await recordJobEvent(tx, { jobId, kind: "resumed", actorUserId: userId });
  });
  kickImportJob(prisma, jobId);
  return getImportJob(prisma, userId, jobId);
}

/**
 * Phase 4 deliberately replaces the old "stop but keep partial batches" cancel semantics.
 * For phase-4 jobs `cancel` is an alias of the safe undo, so a client calling the old route
 * cannot leave a half-imported ledger under a held lock. Legacy phase-3 jobs keep the old
 * stop-only behaviour because they have no inverse journal.
 */
export async function cancelImportJob(
  prisma: PrismaClient,
  userId: string,
  jobId: string,
): Promise<ImportJobStatus> {
  const existing = await prisma.ledgerImportJob.findUnique({ where: { id: jobId } });
  if (existing === null) throw notFound("import_job_missing", "找不到这个导入任务。");
  if (existing.userId !== userId) throw forbidden("import_forbidden", "这个导入任务不属于当前账号。");
  if (existing.phase >= 4) return undoImportJob(prisma, userId, jobId);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ledger_import_jobs" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
    const job = await tx.ledgerImportJob.findUnique({ where: { id: jobId } });
    if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
    if (job.status === "completed") throw conflict("import_job_completed", "任务已经完成，不能取消。");
    if (job.status === "cancelled" || job.status === "expired") return;
    if (job.status !== "queued" && job.status !== "running" && job.status !== "paused" && job.status !== "finalizing") {
      throw badRequest("import_job_not_cancellable", "当前任务状态不能取消。");
    }
    const payload = readPayload(job);
    await tx.ledgerImportJob.update({
      where: { id: jobId },
      data: {
        status: "cancelled",
        payload: { ...payload, source: null, operations: [] } as unknown as Prisma.InputJsonValue,
        lastErrorCode: "job_cancelled_legacy",
        lastErrorMessage: "旧版任务已取消；已经提交的批次保留，未提交的记录没有写入。",
      },
    });
  });
  return getImportJob(prisma, userId, jobId);
}

/**
 * Phase-4 timeout/recovery sweep. Legacy phase-3 TTL remains in `expireStaleImportJobs`; a
 * phase-4 job must never be TTL-expired while it still holds a business lock.
 */
export async function sweepStaleImportJobs(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<void> {
  const staleCutoffFor = (timeoutSeconds: number) =>
    new Date(now.getTime() - timeoutSeconds * 1_000);

  const active = await prisma.ledgerImportJob.findMany({
    where: { phase: { gte: 4 }, status: { in: ["queued", "running", "finalizing"] } },
    select: { id: true, status: true, timeoutSeconds: true, updatedAt: true },
    take: 100,
  });
  for (const job of active) {
    if (job.updatedAt >= staleCutoffFor(job.timeoutSeconds)) continue;
    const deadline = new Date(now.getTime() + job.timeoutSeconds * 1_000);
    await prisma.$transaction(async (tx) => {
      await tx.ledgerImportJob.updateMany({
        where: { id: job.id, status: { in: ["queued", "running", "finalizing"] } },
        data: {
          status: "paused",
          activityAt: now,
          confirmationDeadline: deadline,
          lastErrorCode: "import_stalled",
          lastErrorMessage: "导入长时间没有进展，已暂停；超时后会自动安全撤销。",
        },
      });
      await recordJobEvent(tx, {
        jobId: job.id,
        kind: "stalled_paused",
        actorUserId: null,
        detail: { deadline: deadline.toISOString() },
      });
    });
  }

  const timedOut = await prisma.ledgerImportJob.findMany({
    where: {
      phase: { gte: 4 },
      status: { in: ["awaiting_confirmation", "paused"] },
      confirmationDeadline: { lt: now },
    },
    select: { id: true },
    take: 100,
  });
  for (const job of timedOut) {
    try {
      await startUndoTransaction(prisma, job.id, null);
    } catch {
      // A concurrent confirm/undo may have moved the job; the next sweep re-evaluates it.
    }
    setImmediate(() => {
      void processUndoJob(prisma, job.id).catch(() => undefined);
    });
  }

  const stuckConfirming = await prisma.ledgerImportJob.findMany({
    where: { phase: { gte: 4 }, status: "confirming" },
    select: { id: true, timeoutSeconds: true, updatedAt: true },
    take: 50,
  });
  for (const job of stuckConfirming) {
    if (job.updatedAt >= staleCutoffFor(job.timeoutSeconds)) continue;
    const nowDate = new Date();
    await prisma.ledgerImportJob.updateMany({
      where: { id: job.id, status: "confirming" },
      data: {
        status: "awaiting_confirmation",
        activityAt: nowDate,
        confirmationDeadline: new Date(nowDate.getTime() + job.timeoutSeconds * 1_000),
        lastErrorCode: "confirm_stalled",
        lastErrorMessage: "最终确认超时，已回到等待确认；可以重试确认或撤销。",
      },
    });
  }

  const stuckUndoing = await prisma.ledgerImportJob.findMany({
    where: { phase: { gte: 4 }, status: { in: ["undoing", "undo_failed"] } },
    select: { id: true, status: true, updatedAt: true },
    take: 50,
  });
  for (const job of stuckUndoing) {
    if (job.updatedAt >= new Date(now.getTime() - 30_000)) continue;
    if (job.status === "undo_failed") {
      // Only automatic retries before the safe ceiling; after that a human must inspect the lock.
      const full = await prisma.ledgerImportJob.findUnique({ where: { id: job.id }, select: { undoAttempts: true } });
      if (full !== null && full.undoAttempts >= 3) continue;
      try {
        await startUndoTransaction(prisma, job.id, null);
      } catch {
        continue;
      }
    }
    setImmediate(() => {
      void processUndoJob(prisma, job.id).catch(() => undefined);
    });
  }
}

/**
 * Pauses/failed tasks retain their guest snapshot so they can be resumed. After the TTL,
 * remove only that snapshot and mark the job expired; imported rows and receipts are untouched.
 */
export async function expireStaleImportJobs(
  prisma: PrismaClient,
  now: Date = new Date(),
  ttlDays = Number(process.env["IMPORT_JOB_TTL_DAYS"] ?? "7"),
): Promise<number> {
  const days = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 7;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const jobs = await prisma.ledgerImportJob.findMany({
    where: {
      phase: { lt: 4 },
      status: { in: ["paused", "failed"] },
      updatedAt: { lt: cutoff },
    },
    select: { id: true, payload: true },
  });
  let expired = 0;
  for (const job of jobs) {
    const payload = readPayload(job);
    if (payload.source === null && payload.operations.length === 0) {
      // Still mark it expired so the UI stops offering resume.
      await prisma.ledgerImportJob.update({
        where: { id: job.id },
        data: {
          status: "expired",
          lastErrorCode: "job_expired",
          lastErrorMessage: "任务暂停超过可恢复期限，来源快照已清理；已导入账目不会删除。",
        },
      });
      expired += 1;
      continue;
    }
    await prisma.ledgerImportJob.update({
      where: { id: job.id },
      data: {
        status: "expired",
        payload: { ...payload, source: null, operations: [] } as unknown as Prisma.InputJsonValue,
        lastErrorCode: "job_expired",
        lastErrorMessage: "任务暂停超过可恢复期限，来源快照已清理；已导入账目不会删除，但无法继续该任务。",
      },
    });
    expired += 1;
  }
  return expired;
}

/** 注册到 app.onReady：把 prisma 放进 kick 使用的全局槽，并恢复中断任务。 */
export function prepareImportJobWorker(prisma: PrismaClient): () => void {
  let stopped = false;
  let ticks = 0;
  const timer = setInterval(() => {
    if (stopped) return;
    ticks += 1;
    void sweepStaleImportJobs(prisma).catch(() => undefined);
    if (ticks % 12 === 0) void expireStaleImportJobs(prisma).catch(() => undefined);
  }, 5_000);
  timer.unref?.();
  void recoverImportJobs(prisma).catch(() => undefined);
  void sweepStaleImportJobs(prisma).catch(() => undefined);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
