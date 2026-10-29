import {
  fingerprintImportSourceRecord,
  type GuestImportSource,
  type ImportTargetSnapshot,
  type IncrementalDecision,
  type IncrementalPreviewResponse,
  type IncrementalSourceStatus,
  type IncrementalSourceStatusValue,
} from "@libellum/shared";

import type { Prisma } from "../generated/prisma/client.js";
import {categoryPath} from "@libellum/shared";
import type { PrismaClient } from "../db.js";
import { badRequest, conflict } from "../lib/errors.js";

type Client = Prisma.TransactionClient | PrismaClient;

export interface IncrementalAnalysis {
  readonly response: IncrementalPreviewResponse;
  readonly byId: ReadonlyMap<string, IncrementalSourceStatus>;
  readonly targetRows: ReadonlyMap<string, { id: string; version: number; deletedAt: Date | null }>;
}

export interface IncrementalOperation {
  readonly sourceTransactionId: string;
  readonly action: "create" | "update" | "skip";
  readonly targetTransactionId: string | null;
  readonly targetVersion: number | null;
  readonly sourceFingerprint: string;
  /** 推进到持久决策历史的状态；skip 也要记录用户已决定的结果。 */
  readonly stateDecision: "imported" | "skipped" | "kept_target" | "target_deleted";
}

export interface IncrementalPlan {
  readonly operations: readonly IncrementalOperation[];
  readonly createdIds: ReadonlySet<string>;
  readonly updatedIds: ReadonlySet<string>;
  readonly skippedIds: ReadonlySet<string>;
}

/** `target.transactions.source_namespace`: formal book id, or `guest:<guestBookId>`; legacy is "". */
export function sourceNamespaceOf(sourceBookId: string | null, guestBookId?: string | null): string {
  if (sourceBookId !== null) return sourceBookId;
  return guestBookId === undefined || guestBookId === null || guestBookId === ""
    ? ""
    : `guest:${guestBookId}`;
}

/** State table key: formal source book id, or `guest:<guestBookId>`; old rows use "guest". */
export function sourceBookKeyOf(sourceBookId: string | null, guestBookId?: string | null): string {
  if (sourceBookId !== null) return sourceBookId;
  return guestBookId === undefined || guestBookId === null || guestBookId === ""
    ? "guest"
    : `guest:${guestBookId}`;
}

function sourceKindOf(sourceBookId: string | null): "guest" | "book" {
  return sourceBookId === null ? "guest" : "book";
}

function matchesTarget(
  source: GuestImportSource,
  sourceTransactionId: string,
  targetTransactionId: string,
  target: ImportTargetSnapshot,
): boolean {
  const transaction = source.transactions.find((item) => item.id === sourceTransactionId);
  if (transaction === undefined) return false;
  const targetTransaction = target.transactions.find((item) => item.id === targetTransactionId);
  if (targetTransaction === undefined) return false;
  const sourceCategory = source.categories.find((item) => item.id === transaction.categoryId);
  const targetCategory = target.categories.find((item) => item.id === targetTransaction.categoryId);
  const sourcePayment =
    transaction.paymentMethodId === null
      ? null
      : source.paymentMethods.find((item) => item.id === transaction.paymentMethodId);
  const targetPayment =
    targetTransaction.paymentMethodId === null
      ? null
      : target.paymentMethods.find((item) => item.id === targetTransaction.paymentMethodId);
  const sourceTags = transaction.tagIds
    .map((id) => source.tags.find((item) => item.id === id)?.name)
    .filter((name): name is string => name !== undefined)
    .sort();
  const targetTags = targetTransaction.tagIds
    .map((id) => target.tags.find((item) => item.id === id)?.name)
    .filter((name): name is string => name !== undefined)
    .sort();
  return (
    sourceCategory?.name === targetCategory?.name &&
    sourceCategory?.kind === targetCategory?.kind &&
    JSON.stringify(categoryPath(source.categories,transaction.categoryId).map(n=>n.name))===JSON.stringify(categoryPath(target.categories,targetTransaction.categoryId).map(n=>n.name)) &&
    sourcePayment?.name === targetPayment?.name &&
    sourceTags.join("\u0000") === targetTags.join("\u0000") &&
    transaction.kind === targetTransaction.kind &&
    transaction.amountCents === targetTransaction.amountCents &&
    transaction.currency === targetTransaction.currency &&
    transaction.occurredAt === targetTransaction.occurredAt &&
    transaction.occurredLocalDate === targetTransaction.occurredLocalDate &&
    transaction.occurredTz === targetTransaction.occurredTz &&
    (transaction.note ?? null) === (targetTransaction.note ?? null)
  );
}

/**
 * 只读分析来源 × 目标账本的增量状态。身份优先用 `sourceRef`/状态表；
 * 旧版本没有状态行时，用来源/目标内容比对推断，且 `legacy=true` 时禁止覆盖目标。
 */
export async function analyzeIncremental(
  client: Client,
  targetBookId: string,
  source: GuestImportSource,
  sourceBookId: string | null,
  target: ImportTargetSnapshot,
  guestBookId?: string | null,
): Promise<IncrementalAnalysis> {
  const sourceIds = source.transactions.map((item) => item.id);
  const key = sourceBookKeyOf(sourceBookId, guestBookId);
  const namespace = sourceNamespaceOf(sourceBookId, guestBookId);
  const stateKeys = key === "guest" ? [key] : [key, "guest"];
  const states =
    sourceIds.length === 0
      ? []
      : await client.ledgerImportSourceState.findMany({
          where: {
            targetBookId,
            sourceBookKey: { in: stateKeys },
            sourceTransactionId: { in: sourceIds },
          },
        });
  const currentStateById = new Map(
    states.filter((state) => state.sourceBookKey === key).map((state) => [state.sourceTransactionId, state]),
  );
  const legacyStateById = new Map(
    states.filter((state) => state.sourceBookKey !== key).map((state) => [state.sourceTransactionId, state]),
  );
  const targetRows =
    sourceIds.length === 0
      ? []
      : await client.transaction.findMany({
          where: {
            bookId: targetBookId,
            sourceRef: { in: sourceIds },
            sourceNamespace: { in: namespace === "" ? [""] : [namespace, ""] },
          },
          select: { id: true, version: true, sourceRef: true, sourceNamespace: true, deletedAt: true },
        });
  const exactRowByIdentity = new Map(
    targetRows
      .filter((row) => row.sourceNamespace === namespace)
      .map((row) => [row.sourceRef ?? "", row]),
  );
  const legacyRowByIdentity = new Map(
    targetRows
      .filter((row) => row.sourceNamespace === "")
      .map((row) => [row.sourceRef ?? "", row]),
  );
  const targetById = new Map(target.transactions.map((row) => [row.id, row]));
  const statesForTarget = await client.ledgerImportSourceState.count({
    where: { targetBookId, sourceBookKey: key },
  });
  const targetLive = target.transactions.length;

  const statuses: IncrementalSourceStatus[] = [];
  const hasStableGuestIdentity = sourceBookId === null && guestBookId !== undefined && guestBookId !== null;
  for (const sourceTransaction of source.transactions) {
    const currentState = currentStateById.get(sourceTransaction.id);
    const legacyState = legacyStateById.get(sourceTransaction.id);
    const state = currentState ?? legacyState;
    const exactRow = exactRowByIdentity.get(sourceTransaction.id);
    const legacyRow = legacyRowByIdentity.get(sourceTransaction.id);
    const row = exactRow ?? legacyRow;
    const legacy =
      currentState === undefined ||
      (hasStableGuestIdentity && row !== undefined && row.sourceNamespace === "");
    const targetChanged =
      row !== undefined && state?.targetVersion !== null && state?.targetVersion !== undefined
        ? row.version !== state.targetVersion
        : false;
    const fingerprint = await fingerprintImportSourceRecord(source, sourceTransaction.id);
    let status: IncrementalSourceStatusValue;
    if (row !== undefined && row.deletedAt !== null) {
      status = "target_deleted";
    } else if (state !== undefined) {
      if (state.decision === "skipped") {
        status = state.sourceFingerprint === fingerprint ? "previously_skipped" : "previously_skipped_modified";
      } else if (row === undefined) {
        status = "target_deleted";
      } else if (state.sourceFingerprint !== fingerprint) {
        status = "modified";
      } else if (targetChanged) {
        status = "target_changed";
      } else {
        status = "unchanged";
      }
    } else if (row !== undefined) {
      const targetTransaction = targetById.get(row.id);
      status =
        targetTransaction !== undefined && matchesTarget(source, sourceTransaction.id, row.id, target)
          ? "unchanged"
          : "modified";
    } else if (legacyState !== undefined || (statesForTarget === 0 && targetRows.length > 0)) {
      // An old state row or target row has no stable guest book identity. We cannot silently
      // assign it to this guest book; require an explicit user decision.
      status = "needs_review";
    } else {
      status = "new";
    }
    statuses.push({
      sourceTransactionId: sourceTransaction.id,
      status,
      previousDecision:
        state === undefined
          ? null
          : (state.decision as "imported" | "skipped" | "kept_target" | "target_deleted"),
      targetTransactionId: row?.id ?? null,
      targetVersion: row !== undefined && row !== null && row.deletedAt === null ? row.version : null,
      targetChanged,
      legacy,
      sourceFingerprint: fingerprint,
      previousSourceFingerprint: state?.sourceFingerprint ?? null,
    });
  }

  const count = (status: IncrementalSourceStatusValue) =>
    statuses.filter((item) => item.status === status).length;
  return {
    response: {
      statuses,
      summary: {
        newCount: count("new"),
        unchangedCount: count("unchanged"),
        modifiedCount: count("modified"),
        targetChangedCount: count("target_changed"),
        targetDeletedCount: count("target_deleted"),
        previouslySkippedCount: count("previously_skipped") + count("previously_skipped_modified"),
        needsReviewCount: count("needs_review"),
      },
    },
    byId: new Map(statuses.map((item) => [item.sourceTransactionId, item])),
    targetRows: new Map(
      targetRows.map((row) => [
        row.sourceRef ?? "",
        { id: row.id, version: row.version, deletedAt: row.deletedAt },
      ]),
    ),
  };
}

/**
 * 把用户决定转换为批次级操作。调用方必须已用同一份 analysis 做过预览；
 * 服务端不信任“客户端说这是修改/新增”，而是按 analysis 的状态逐条验证动作。
 */
export function resolveIncrementalPlan(
  analysis: IncrementalAnalysis,
  decisions: readonly IncrementalDecision[],
  duplicateSkippedIds: ReadonlySet<string>,
): IncrementalPlan {
  const decisionById = new Map<string, IncrementalDecision>();
  for (const decision of decisions) {
    if (!analysis.byId.has(decision.sourceTransactionId)) {
      throw badRequest("incremental_source_missing", "增量决定引用了不存在的来源账目，请重新预览。");
    }
    if (decisionById.has(decision.sourceTransactionId)) {
      throw badRequest("incremental_duplicate_decision", "同一来源账目的增量决定被重复提交。");
    }
    decisionById.set(decision.sourceTransactionId, decision);
  }

  const operations: IncrementalOperation[] = [];
  for (const status of analysis.byId.values()) {
    const decision = decisionById.get(status.sourceTransactionId);
    const targetExists = status.targetTransactionId !== null && status.status !== "target_deleted";
    let action: IncrementalOperation["action"];
    let stateDecision: IncrementalOperation["stateDecision"];
    if (duplicateSkippedIds.has(status.sourceTransactionId)) {
      action = "skip";
      stateDecision = status.previousDecision === "imported" ? "kept_target" : "skipped";
    } else if (status.status === "unchanged") {
      action = "skip";
      stateDecision = "imported";
    } else if (status.status === "new" || status.status === "needs_review") {
      if (status.status === "needs_review" && decision === undefined) {
        action = "skip";
        stateDecision = "skipped";
      } else if (decision?.action === "import" || (status.status === "new" && decision === undefined)) {
        action = "create";
        stateDecision = "imported";
      } else if (decision?.action === "skip" || decision === undefined) {
        action = "skip";
        stateDecision = "skipped";
      } else {
        throw badRequest("incremental_invalid_action", "新增来源记录只能选择导入或跳过。");
      }
    } else if (
      status.status === "previously_skipped" ||
      status.status === "previously_skipped_modified"
    ) {
      if (decision?.action === "import") {
        action = "create";
        stateDecision = "imported";
      } else {
        action = "skip";
        stateDecision = "skipped";
      }
    } else if (status.status === "modified") {
      if (decision?.action === "update_target") {
        if (status.targetChanged || status.legacy || status.targetVersion === null || status.targetTransactionId === null) {
          throw conflict("target_changed", "目标账目已经变化或没有可验证的版本，不能直接用来源覆盖。");
        }
        action = "update";
        stateDecision = "imported";
      } else if (decision?.action === "import") {
        throw badRequest("incremental_update_required", "已有目标账目的来源变化不能作为新记录导入。");
      } else {
        action = "skip";
        stateDecision = "kept_target";
      }
    } else if (status.status === "target_changed") {
      action = "skip";
      stateDecision = "kept_target";
    } else if (status.status === "target_deleted") {
      action = "skip";
      stateDecision = "target_deleted";
    } else {
      action = "skip";
      stateDecision = "skipped";
    }

    // A target that no longer exists cannot be "kept" by updating it.
    if (action === "update" && (!targetExists || status.targetVersion === null)) {
      throw conflict("target_changed", "目标账目已经变化，不能覆盖。");
    }
    operations.push({
      sourceTransactionId: status.sourceTransactionId,
      action,
      targetTransactionId: action === "create" ? null : status.targetTransactionId,
      targetVersion: status.targetVersion,
      sourceFingerprint: status.sourceFingerprint,
      stateDecision,
    });
  }

  return {
    operations,
    createdIds: new Set(operations.filter((item) => item.action === "create").map((item) => item.sourceTransactionId)),
    updatedIds: new Set(operations.filter((item) => item.action === "update").map((item) => item.sourceTransactionId)),
    skippedIds: new Set(operations.filter((item) => item.action === "skip").map((item) => item.sourceTransactionId)),
  };
}

export async function writeSourceState(
  tx: Prisma.TransactionClient,
  input: {
    readonly targetBookId: string;
    readonly sourceKind: "guest" | "book";
    readonly sourceBookId: string | null;
    readonly guestBookId: string | null;
    readonly operation: IncrementalOperation;
    readonly targetTransactionId: string | null;
    readonly targetVersion: number | null;
    readonly jobId: string | null;
  },
): Promise<void> {
  const key = sourceBookKeyOf(input.sourceBookId, input.guestBookId);
  await tx.ledgerImportSourceState.upsert({
    where: {
      targetBookId_sourceBookKey_sourceTransactionId: {
        targetBookId: input.targetBookId,
        sourceBookKey: key,
        sourceTransactionId: input.operation.sourceTransactionId,
      },
    },
    create: {
      targetBookId: input.targetBookId,
      sourceKind: input.sourceKind,
      sourceBookId: input.sourceBookId,
      sourceBookKey: key,
      sourceTransactionId: input.operation.sourceTransactionId,
      sourceFingerprint: input.operation.sourceFingerprint,
      decision: input.operation.stateDecision,
      targetTransactionId: input.targetTransactionId,
      targetVersion: input.targetVersion,
      lastImportJobId: input.jobId,
    },
    update: {
      sourceKind: input.sourceKind,
      sourceBookId: input.sourceBookId,
      sourceFingerprint: input.operation.sourceFingerprint,
      decision: input.operation.stateDecision,
      targetTransactionId: input.targetTransactionId,
      targetVersion: input.targetVersion,
      lastImportJobId: input.jobId,
    },
  });
}
