/**
 * S14-D D4 · 预览失效后的安全草稿恢复。
 *
 * ⚠️ 恢复的是**操作草稿**（用户已经做过的 taxonomy 冲突选择和逐组去留决定），不是账目、不是软删除。
 * 只有记录 id、内容字段、映射键、冲突组成员都完全相同且仍存在时才恢复；绝不按金额、日期或列表位置猜。
 * 涉及 A 软删除的选择也按同一签名恢复，目标 A 的 id/version/内容任一变化都会使该组重新核对。
 */
import type { Category, PaymentMethod, Tag, Transaction } from "@libellum/shared";

import type { GroupDecisionDraft } from "./decisions.js";
import type { TaxonomyResolutionMap } from "./mapping.js";
import type { TaxonomyConflict, TaxonomyObjectKind } from "./types.js";
import type { ImportPreview } from "./types.js";

function canonicalTransaction(transaction: Transaction): string {
  return JSON.stringify({
    id: transaction.id,
    version: transaction.version ?? 1,
    kind: transaction.kind,
    amountCents: transaction.amountCents,
    currency: transaction.currency,
    categoryId: transaction.categoryId,
    paymentMethodId: transaction.paymentMethodId,
    occurredAt: transaction.occurredAt,
    occurredLocalDate: transaction.occurredLocalDate,
    occurredTz: transaction.occurredTz,
    note: transaction.note,
    tagIds: transaction.tags.map((tag) => tag.id).sort((left, right) => left.localeCompare(right, "en")),
  });
}

function mappingKeyFor(
  preview: ImportPreview,
  type: TaxonomyObjectKind,
  sourceId: string,
): string {
  if (type === "category") {
    return preview.mapping.categories.find((item) => item.source.id === sourceId)?.matchKey ?? "";
  }
  if (type === "paymentMethod") {
    return preview.mapping.paymentMethods.find((item) => item.source.id === sourceId)?.matchKey ?? "";
  }
  return preview.mapping.tags.find((item) => item.source.id === sourceId)?.matchKey ?? "";
}

function sourceTransactionMappingSignature(preview: ImportPreview, transaction: Transaction): string {
  const categoryKey = mappingKeyFor(preview, "category", transaction.categoryId);
  const tagKeys = transaction.tags
    .map((tag) => mappingKeyFor(preview, "tag", tag.id))
    .sort((left, right) => left.localeCompare(right, "en"));
  return JSON.stringify({ categoryKey, tagKeys });
}

function targetTransactionMappingSignature(preview: ImportPreview, transaction: Transaction): string {
  return JSON.stringify({
    categoryId: transaction.categoryId,
    tagIds: transaction.tags.map((tag) => tag.id).sort((left, right) => left.localeCompare(right, "en")),
  });
}

/** 冲突组签名：成员 id + 内容 + 映射后的键。组 id 变化但签名相同可以恢复。 */
export function duplicateGroupSignature(preview: ImportPreview, groupId: string): string | null {
  const group = preview.duplicateGroups.find((item) => item.id === groupId);
  if (group === undefined) return null;
  return JSON.stringify(
    group.records
      .map((record) => ({
        side: record.side,
        id: record.transaction.id,
        content: canonicalTransaction(record.transaction),
        mapping:
          record.side === "source"
            ? sourceTransactionMappingSignature(preview, record.transaction)
            : targetTransactionMappingSignature(preview, record.transaction),
      }))
      .sort((left, right) => `${left.side}:${left.id}`.localeCompare(`${right.side}:${right.id}`, "en")),
  );
}

function objectSignature(
  value: Category | PaymentMethod | Tag | undefined,
): string {
  if (value === undefined) return "missing";
  return JSON.stringify(value);
}

function conflictSignature(preview: ImportPreview, conflict: TaxonomyConflict): string {
  const source =
    conflict.type === "category"
      ? preview.source.categories.find((item) => item.id === conflict.sourceId)
      : conflict.type === "paymentMethod"
        ? preview.source.paymentMethods.find((item) => item.id === conflict.sourceId)
        : preview.source.tags.find((item) => item.id === conflict.sourceId);
  const target =
    conflict.type === "category"
      ? preview.target.categories.find((item) => item.id === conflict.targetId)
      : conflict.type === "paymentMethod"
        ? preview.target.paymentMethods.find((item) => item.id === conflict.targetId)
        : preview.target.tags.find((item) => item.id === conflict.targetId);
  return JSON.stringify({
    type: conflict.type,
    sourceId: conflict.sourceId,
    targetId: conflict.targetId,
    reason: conflict.reason,
    source: objectSignature(source),
    target: objectSignature(target),
  });
}

/**
 * 只保留仍然完全相同的冲突解决方案。任何映射对象内容、目标对象、冲突原因变化都清空。
 */
export function recoverTaxonomyResolutions(
  previous: ImportPreview,
  next: ImportPreview,
  previousResolutions: TaxonomyResolutionMap,
): TaxonomyResolutionMap {
  const nextConflicts = new Map<string, TaxonomyConflict>(
    next.mapping.conflicts.map((conflict) => [`${conflict.type}:${conflict.sourceId}`, conflict] as const),
  );
  const recovered = new Map<string, "reuse" | "create">();

  for (const [key, action] of previousResolutions) {
    const separator = key.indexOf(":");
    if (separator < 0) continue;
    const type = key.slice(0, separator) as TaxonomyObjectKind;
    const sourceId = key.slice(separator + 1);
    const previousConflict = previous.mapping.conflicts.find(
      (conflict) => conflict.type === type && conflict.sourceId === sourceId,
    );
    const nextConflict = nextConflicts.get(key);
    if (previousConflict === undefined || nextConflict === undefined) continue;
    if (conflictSignature(previous, previousConflict) !== conflictSignature(next, nextConflict)) continue;
    recovered.set(key, action);
  }

  return recovered;
}

export interface GroupDecisionRecovery {
  readonly decisions: Map<string, GroupDecisionDraft>;
  readonly restoredGroupIds: readonly string[];
  readonly changedGroupIds: readonly string[];
}

/**
 * 按组签名恢复逐条决定。组签名完全相同的旧决定替换到新 groupId；其余组保持未确认，
 * 由 UI 标记“需要重新核对”。不会因为组内某一笔金额/日期/映射变化而部分套用旧决定。
 */
export function recoverGroupDecisions(
  previous: ImportPreview,
  next: ImportPreview,
  previousDecisions: ReadonlyMap<string, GroupDecisionDraft>,
): GroupDecisionRecovery {
  const nextBySignature = new Map<string, string>();
  for (const group of next.duplicateGroups) {
    const signature = duplicateGroupSignature(next, group.id);
    if (signature !== null && !nextBySignature.has(signature)) nextBySignature.set(signature, group.id);
  }

  const decisions = new Map<string, GroupDecisionDraft>();
  const restoredGroupIds: string[] = [];
  const restoredSignatures = new Set<string>();
  for (const [oldGroupId, decision] of previousDecisions) {
    const signature = duplicateGroupSignature(previous, oldGroupId);
    if (signature === null) continue;
    const newGroupId = nextBySignature.get(signature);
    if (newGroupId === undefined || decisions.has(newGroupId)) continue;
    decisions.set(newGroupId, decision);
    restoredGroupIds.push(newGroupId);
    restoredSignatures.add(signature);
  }

  const changedGroupIds = next.duplicateGroups
    .map((group) => group.id)
    .filter((groupId) => !restoredGroupIds.includes(groupId));

  return { decisions, restoredGroupIds, changedGroupIds };
}

export interface DraftRecoverySummary {
  readonly restoredGroups: number;
  readonly resetGroups: number;
  readonly restoredConflicts: number;
  readonly resetConflicts: number;
  readonly needsReviewGroupIds: readonly string[];
  readonly message: string | null;
}

export function summarizeDraftRecovery(
  previousDecisions: ReadonlyMap<string, GroupDecisionDraft>,
  previousResolutions: TaxonomyResolutionMap,
  recovery: GroupDecisionRecovery,
  recoveredResolutions: TaxonomyResolutionMap,
): DraftRecoverySummary {
  const restoredGroups = recovery.restoredGroupIds.length;
  const resetGroups = Math.max(0, previousDecisions.size - restoredGroups);
  const restoredConflicts = recoveredResolutions.size;
  const resetConflicts = Math.max(0, previousResolutions.size - restoredConflicts);
  const affected = resetGroups > 0 || resetConflicts > 0;

  let message: string | null = null;
  if (previousDecisions.size > 0 || previousResolutions.size > 0) {
    message = affected
      ? "部分选择已恢复，变化的记录需要重新核对。"
      : "已恢复之前的选择，请重新检查完整确认页。";
  }
  if (affected && resetGroups === 0 && resetConflicts > 0) {
    message = "部分映射选择无法安全恢复，变化的记录需要重新核对。";
  }

  return {
    restoredGroups,
    resetGroups,
    restoredConflicts,
    resetConflicts,
    needsReviewGroupIds: recovery.changedGroupIds,
    message,
  };
}
