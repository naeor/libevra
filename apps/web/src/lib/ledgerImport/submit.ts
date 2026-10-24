/**
 * S14-D D2 · 把已经在浏览器里确认过的预览变成服务器导入请求。
 *
 * ⚠️ 这里是唯一构造请求的地方：来源快照、目标指纹、taxonomy 决定、重复组决定全部来自同一个
 * `ImportPreview`。页面不再另写一套“哪些记录要导入”的判断。
 */
import {
  fingerprintGuestSource,
  fingerprintTargetSnapshot,
  type DuplicateDecision,
  type GuestImportSource,
  type ImportTargetSnapshot,
  type IncrementalDecision,
  type LedgerImportRequest,
  type TaxonomyResolution,
} from "@libellum/shared";

import { t } from "../../i18n/index.js";
import type { ImportPreview } from "./types.js";
import type { TaxonomyResolutionAction, TaxonomyResolutionMap } from "./mapping.js";
import { taxonomyResolutionKey } from "./mapping.js";
import {
  isOneToOne,
  sourceHandling,
  targetHandling,
  unresolvedGroupCount,
  type GroupDecisionMap,
} from "./decisions.js";

export function guestSourceOfSource(source: ImportPreview["source"]): GuestImportSource {
  return {
    name: source.identity.name,
    ...(source.kind === "guest" ? { guestBookId: source.bookId } : {}),
    categories: source.categories.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      description: item.description,
      sortOrder: item.sortOrder,
      isArchived: item.isArchived,
      isSystem: item.isSystem,
    })),
    paymentMethods: source.paymentMethods.map((item) => ({
      id: item.id,
      name: item.name,
      sortOrder: item.sortOrder,
      isArchived: item.isArchived,
    })),
    tags: source.tags.map((item) => ({ id: item.id, name: item.name, color: item.color })),
    transactions: source.transactions.map((item) => ({
      id: item.id,
      kind: item.kind,
      amountCents: item.amountCents,
      currency: item.currency,
      categoryId: item.categoryId,
      paymentMethodId: item.paymentMethodId,
      occurredAt: item.occurredAt,
      occurredLocalDate: item.occurredLocalDate,
      occurredTz: item.occurredTz,
      note: item.note,
      tagIds: item.tags.map((tag) => tag.id),
    })),
  };
}

export function guestSourceOf(preview: ImportPreview): GuestImportSource {
  return guestSourceOfSource(preview.source);
}

export function targetSnapshotOf(preview: ImportPreview): ImportTargetSnapshot {
  const target = preview.target;
  return {
    bookId: target.bookId,
    name: target.identity.name,
    bookNumber: target.identity.bookNumber,
    categories: target.categories.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      description: item.description,
      sortOrder: item.sortOrder,
      isArchived: item.isArchived,
      isSystem: item.isSystem,
    })),
    paymentMethods: target.paymentMethods.map((item) => ({
      id: item.id,
      name: item.name,
      sortOrder: item.sortOrder,
      isArchived: item.isArchived,
    })),
    tags: target.tags.map((item) => ({ id: item.id, name: item.name, color: item.color })),
    transactions: target.transactions.map((item) => ({
      id: item.id,
      version: item.version,
      kind: item.kind,
      amountCents: item.amountCents,
      currency: item.currency,
      categoryId: item.categoryId,
      paymentMethodId: item.paymentMethodId,
      occurredAt: item.occurredAt,
      occurredLocalDate: item.occurredLocalDate,
      occurredTz: item.occurredTz,
      note: item.note,
      tagIds: item.tags.map((tag) => tag.id),
    })),
  };
}

function resolutionFor(
  preview: ImportPreview,
  type: "category" | "paymentMethod" | "tag",
  sourceId: string,
  resolutions: TaxonomyResolutionMap,
  targetIsNew: boolean,
): TaxonomyResolution {
  const chosen = resolutions.get(taxonomyResolutionKey(type, sourceId));
  if (targetIsNew) return { type, sourceId, action: "auto" };
  const mapping =
    type === "category"
      ? preview.mapping.categories.find((item) => item.source.id === sourceId)
      : type === "paymentMethod"
        ? preview.mapping.paymentMethods.find((item) => item.source.id === sourceId)
        : preview.mapping.tags.find((item) => item.source.id === sourceId);
  if (mapping === undefined) throw new Error(t("ledgerImport.submitError.noMapping"));
  if (mapping.conflict !== null && chosen === "create") {
    return {
      type,
      sourceId,
      action: "create",
      createName: mapping.createName ?? mapping.source.name,
    };
  }
  if (mapping.targetId !== null) {
    return { type, sourceId, action: "reuse", targetId: mapping.targetId };
  }
  return { type, sourceId, action: "create", createName: mapping.createName ?? mapping.source.name };
}

export async function buildLedgerImportRequest(input: {
  readonly importId: string;
  readonly preview: ImportPreview;
  readonly targetIsNew: boolean;
  readonly resolutions: TaxonomyResolutionMap;
  readonly decisions: GroupDecisionMap;
  /** D4：服务器预览返回的来源/目标指纹；正式来源必须使用服务器指纹。 */
  readonly serverSourceFingerprint?: string | undefined;
  readonly serverTargetFingerprint?: string | undefined;
  /** D5 phase 2：用户在增量核对中显式选择的动作。 */
  readonly incrementalDecisions?: readonly IncrementalDecision[];
}): Promise<LedgerImportRequest> {
  const { preview, targetIsNew, resolutions, decisions } = input;
  const source = preview.source.kind === "guest" ? guestSourceOf(preview) : null;
  const sourceFingerprint =
    source === null ? input.serverSourceFingerprint : await fingerprintGuestSource(source);
  if (sourceFingerprint === undefined) throw new Error(t("ledgerImport.submitError.missingSourceFingerprint"));

  const taxonomy: TaxonomyResolution[] = [
    ...preview.source.categories.map((item) => resolutionFor(preview, "category", item.id, resolutions, targetIsNew)),
    ...preview.source.paymentMethods.map((item) =>
      resolutionFor(preview, "paymentMethod", item.id, resolutions, targetIsNew),
    ),
    ...preview.source.tags.map((item) => resolutionFor(preview, "tag", item.id, resolutions, targetIsNew)),
  ];

  const duplicateGroups: DuplicateDecision[] = preview.duplicateGroups.map((group) => {
    const decision = decisions.get(group.id);
    if (decision === undefined) throw new Error(t("ledgerImport.submitError.unresolvedGroups"));
    const sourceIds = group.records
      .filter((record) => record.side === "source")
      .map((record) => record.transaction.id);
    const targetIds = group.records
      .filter((record) => record.side === "target")
      .map((record) => record.transaction.id);

    /**
     * 一对一允许四个快捷动作；多对多必须把每一笔 B/A 的逐条决定发给服务端，
     * 这样服务端能验证删除范围严格等于用户看到的清单。
     */
    if (isOneToOne(group) && decision.action !== "custom") {
      return { groupId: group.id, action: decision.action, sourceIds, targetIds };
    }
    return {
      groupId: group.id,
      action: "custom",
      sourceIds,
      targetIds,
      sourceActions: sourceIds.map((sourceTransactionId) => ({
        sourceTransactionId,
        action: sourceHandling(decision, sourceTransactionId),
      })),
      targetActions: targetIds.map((targetTransactionId) => ({
        targetTransactionId,
        action: targetHandling(decision, targetTransactionId),
      })),
    };
  });

  const incrementalDecisions = [...(input.incrementalDecisions ?? [])];

  if (preview.source.kind === "book") {
    if (targetIsNew) throw new Error(t("ledgerImport.submitError.formalToNew"));
    if (input.serverTargetFingerprint === undefined) throw new Error(t("ledgerImport.submitError.missingTargetFingerprint"));
    return {
      importId: input.importId,
      target: {
        kind: "existing",
        bookId: preview.target.bookId,
        expectedTargetFingerprint: input.serverTargetFingerprint,
      },
      sourceBookId: preview.source.bookId,
      sourceFingerprint,
      taxonomy,
      duplicateGroups,
      incrementalDecisions,
    };
  }

  if (source === null) throw new Error(t("ledgerImport.submitError.missingGuestSource"));

  if (targetIsNew) {
    return {
      importId: input.importId,
      target: { kind: "new", name: preview.target.identity.name },
      source,
      sourceFingerprint,
      taxonomy,
      duplicateGroups: [],
      incrementalDecisions: [],
    };
  }

  const target = targetSnapshotOf(preview);
  return {
    importId: input.importId,
    target: {
      kind: "existing",
      bookId: preview.target.bookId,
      expectedTargetFingerprint: await fingerprintTargetSnapshot(target),
    },
    source,
    sourceFingerprint,
    taxonomy,
    duplicateGroups,
    incrementalDecisions,
  };
}

export function unresolvedConflicts(preview: ImportPreview, resolutions: TaxonomyResolutionMap): number {
  return preview.mapping.conflicts.filter(
    (conflict) => !resolutions.has(taxonomyResolutionKey(conflict.type, conflict.sourceId)),
  ).length;
}

export function unresolvedDuplicateGroups(preview: ImportPreview, decisions: GroupDecisionMap): number {
  return unresolvedGroupCount(preview, decisions);
}

export type { TaxonomyResolutionAction };
