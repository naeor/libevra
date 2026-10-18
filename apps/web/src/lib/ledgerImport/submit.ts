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
  type LedgerImportRequest,
  type TaxonomyResolution,
} from "@libellum/shared";

import type { ImportPreview } from "./types.js";
import type { TaxonomyResolutionAction, TaxonomyResolutionMap } from "./mapping.js";
import { taxonomyResolutionKey } from "./mapping.js";

export type DuplicateAction = "keep_a" | "keep_both";
export type DuplicateDecisionMap = ReadonlyMap<string, DuplicateAction>;

export function guestSourceOf(preview: ImportPreview): GuestImportSource {
  const source = preview.source;
  return {
    name: source.identity.name,
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
  if (mapping === undefined) throw new Error("来源对象没有映射方案。");
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
  readonly decisions: DuplicateDecisionMap;
}): Promise<LedgerImportRequest> {
  const { preview, targetIsNew, resolutions, decisions } = input;
  const source = guestSourceOf(preview);
  const sourceFingerprint = await fingerprintGuestSource(source);

  const taxonomy: TaxonomyResolution[] = [
    ...source.categories.map((item) => resolutionFor(preview, "category", item.id, resolutions, targetIsNew)),
    ...source.paymentMethods.map((item) =>
      resolutionFor(preview, "paymentMethod", item.id, resolutions, targetIsNew),
    ),
    ...source.tags.map((item) => resolutionFor(preview, "tag", item.id, resolutions, targetIsNew)),
  ];

  const duplicateGroups: DuplicateDecision[] = preview.duplicateGroups.map((group) => {
    const action = decisions.get(group.id);
    if (action === undefined) throw new Error("还有重复组没有处理。");
    return {
      groupId: group.id,
      action,
      sourceIds: group.records.filter((record) => record.side === "source").map((record) => record.transaction.id),
      targetIds: group.records.filter((record) => record.side === "target").map((record) => record.transaction.id),
    };
  });

  if (preview.source.kind !== "guest") throw new Error("D2 只支持游客账本作为来源。");

  if (targetIsNew) {
    return {
      importId: input.importId,
      target: { kind: "new", name: preview.target.identity.name },
      source,
      sourceFingerprint,
      taxonomy,
      duplicateGroups: [],
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
  };
}

export function unresolvedConflicts(preview: ImportPreview, resolutions: TaxonomyResolutionMap): number {
  return preview.mapping.conflicts.filter(
    (conflict) => !resolutions.has(taxonomyResolutionKey(conflict.type, conflict.sourceId)),
  ).length;
}

export function unresolvedDuplicateGroups(preview: ImportPreview, decisions: DuplicateDecisionMap): number {
  return preview.duplicateGroups.filter((group) => !decisions.has(group.id)).length;
}

export type { TaxonomyResolutionAction };
