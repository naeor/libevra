/**
 * S14-D D1 · 可能重复的账目检测。
 *
 * 规则（所有者 2026-10-19 定）：
 *  - 只在来源 B 与目标 A 之间比较；A-A、B-B 永远不构成冲突；
 *  - 发生时间相差 <= 60 秒；
 *  - 收支类型、金额、币种完全一致；
 *  - 分类按**映射后的目标分类**比较；
 *  - 标签集合完全相同（顺序无关）。
 *
 * ⚠️ 多候选不能随便取第一条。这里把“来源-目标”匹配图拆成连通分量，一个分量就是一组冲突；
 * 同一笔记录只会出现在一个组里，D3 的组级决定因此不会互相矛盾。
 *
 * ⚠️ **只提醒，不自动删除。** 这里不产生任何写入决定；没有命中重复的来源记录默认进入待导入列表。
 */
import type { Transaction } from "@libellum/shared";

import type {
  DuplicateGroup,
  DuplicateRecord,
  ImportSource,
  ImportTarget,
  TaxonomyMappingPlan,
} from "./types.js";

export const DUPLICATE_TIME_WINDOW_MS = 60_000;

export interface DuplicateDetectionResult {
  readonly groups: readonly DuplicateGroup[];
  readonly duplicateSourceIds: ReadonlySet<string>;
  readonly duplicateTargetIds: ReadonlySet<string>;
}

interface CandidateRecord {
  readonly transaction: Transaction;
  readonly categoryKey: string;
  readonly tagKey: string;
  readonly categoryLabel: string;
  readonly tagLabels: readonly string[];
}

interface GroupEdge {
  readonly sourceId: string;
  readonly targetId: string;
}

function tagKey(ids: readonly string[]): string {
  return [...ids].sort().join("\u0001");
}

function tagLabelsFor(ids: readonly string[], namesById: ReadonlyMap<string, string>): readonly string[] {
  return ids
    .map((id) => namesById.get(id) ?? "（未知标签）")
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function componentKey(node: string): string {
  return node;
}

/**
 * 来源分类/标签到目标语义键的索引。
 *
 * 计划里 `targetId` 为 null 的是要新建的对象：`matchKey` 是 `new:<sourceId>`，不可能等于目标账本
 * 已有对象的键，因此不会产生“假重复”——除非冲突处理最终决定复用目标对象，D3 必须重新运行本检测。
 */
function buildSourceIndexes(
  source: ImportSource,
  mapping: TaxonomyMappingPlan,
): {
  categoryKeyById: Map<string, string>;
  categoryLabelById: Map<string, string>;
  tagKeyById: Map<string, string>;
  tagLabelById: Map<string, string>;
} {
  const categoryKeyById = new Map<string, string>();
  const categoryLabelById = new Map<string, string>();
  const tagKeyById = new Map<string, string>();
  const tagLabelById = new Map<string, string>();

  for (const item of mapping.categories) {
    categoryKeyById.set(item.source.id, item.matchKey);
  }
  for (const item of mapping.tags) {
    tagKeyById.set(item.source.id, item.matchKey);
  }
  // Labels are for display only; missing taxonomy (corrupt local data) must not crash a preview.
  for (const category of source.categories) {
    categoryLabelById.set(category.id, category.name);
  }
  for (const tag of source.tags) {
    tagLabelById.set(tag.id, tag.name);
  }

  return { categoryKeyById, categoryLabelById, tagKeyById, tagLabelById };
}

function sourceCandidates(
  source: ImportSource,
  target: ImportTarget,
  mapping: TaxonomyMappingPlan,
  excludeSourceIds: ReadonlySet<string>,
  excludeTargetIds: ReadonlySet<string>,
): {
  sourceRecords: Map<string, CandidateRecord>;
  targetRecords: Map<string, CandidateRecord>;
  targetIndex: Map<string, CandidateRecord[]>;
} {
  const sourceIndexes = buildSourceIndexes(source, mapping);

  const sourceRecords = new Map<string, CandidateRecord>();
  for (const transaction of source.transactions) {
    if (excludeSourceIds.has(transaction.id)) continue;
    const categoryKey = sourceIndexes.categoryKeyById.get(transaction.categoryId);
    const categoryLabel = sourceIndexes.categoryLabelById.get(transaction.categoryId) ?? transaction.categoryName;
    if (categoryKey === undefined) {
      // A source entry that refers to a category missing from its own ledger cannot be matched
      // semantically; it must be repaired before import, not silently treated as "no duplicate".
      continue;
    }
    const tagKeys = transaction.tags
      .map((tag) => sourceIndexes.tagKeyById.get(tag.id))
      .filter((key): key is string => key !== undefined);
    sourceRecords.set(transaction.id, {
      transaction,
      categoryKey,
      tagKey: tagKey([...tagKeys].sort()),
      categoryLabel,
      tagLabels: tagLabelsFor(
        transaction.tags.map((tag) => tag.id),
        sourceIndexes.tagLabelById,
      ),
    });
  }

  const targetRecords = new Map<string, CandidateRecord>();
  for (const transaction of target.transactions) {
    if (excludeTargetIds.has(transaction.id)) continue;
    const categoryKey = `target:${transaction.categoryId}`;
    targetRecords.set(transaction.id, {
      transaction,
      categoryKey,
      tagKey: tagKey(transaction.tags.map((tag) => `target:${tag.id}`)),
      categoryLabel: transaction.categoryName,
      tagLabels: tagLabelsFor(
        transaction.tags.map((tag) => tag.id),
        new Map(transaction.tags.map((tag) => [tag.id, tag.name] as const)),
      ),
    });
  }

  const targetIndex = new Map<string, CandidateRecord[]>();
  for (const record of targetRecords.values()) {
    const key = candidateKey(record);
    const list = targetIndex.get(key);
    if (list === undefined) targetIndex.set(key, [record]);
    else list.push(record);
  }

  return { sourceRecords, targetRecords, targetIndex };
}

function candidateKey(record: CandidateRecord): string {
  return `${record.transaction.kind}\u0000${String(record.transaction.amountCents)}\u0000${record.transaction.currency}\u0000${record.categoryKey}`;
}

function withinWindow(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return false;
  return Math.abs(leftTime - rightTime) <= DUPLICATE_TIME_WINDOW_MS;
}

/**
 * 检测跨来源/目标的可能重复账目。
 *
 * 输出顺序稳定：组按组内最早来源账目时间、再按来源 id 排序；组内来源记录在前、目标记录在后，
 * 各自按时间和 id 排序。界面据此逐组展示时不会因为 Map/Set 顺序而跳来跳去。
 */
export function detectDuplicateGroups(
  source: ImportSource,
  target: ImportTarget,
  mapping: TaxonomyMappingPlan,
  excludeSourceIds: ReadonlySet<string> = new Set<string>(),
  excludeTargetIds: ReadonlySet<string> = new Set<string>(),
): DuplicateDetectionResult {
  const { sourceRecords, targetRecords, targetIndex } = sourceCandidates(
    source,
    target,
    mapping,
    excludeSourceIds,
    excludeTargetIds,
  );

  const edges: GroupEdge[] = [];
  const sourceById = new Map<string, CandidateRecord>();
  for (const [id, record] of sourceRecords) sourceById.set(id, record);

  for (const [sourceId, sourceRecord] of sourceRecords) {
    const candidates = targetIndex.get(candidateKey(sourceRecord)) ?? [];
    for (const targetRecord of candidates) {
      if (!withinWindow(sourceRecord.transaction.occurredAt, targetRecord.transaction.occurredAt)) continue;
      if (sourceRecord.tagKey !== targetRecord.tagKey) continue;
      edges.push({ sourceId, targetId: targetRecord.transaction.id });
    }
  }

  if (edges.length === 0) {
    return {
      groups: [],
      duplicateSourceIds: new Set(),
      duplicateTargetIds: new Set(),
    };
  }

  // Adjacency over only the nodes that have at least one edge. Components are formed from
  // cross-source edges; no A-A or B-B edge is ever added.
  const adjacency = new Map<string, Set<string>>();
  const nodeKind = new Map<string, "source" | "target">();
  const addNode = (node: string, kind: "source" | "target"): void => {
    if (!adjacency.has(node)) adjacency.set(node, new Set());
    nodeKind.set(node, kind);
  };
  for (const edge of edges) {
    const sourceNode = `s:${edge.sourceId}`;
    const targetNode = `t:${edge.targetId}`;
    addNode(sourceNode, "source");
    addNode(targetNode, "target");
    adjacency.get(sourceNode)!.add(targetNode);
    adjacency.get(targetNode)!.add(sourceNode);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const start of [...adjacency.keys()].sort()) {
    if (visited.has(start)) continue;
    const stack = [start];
    const component: string[] = [];
    visited.add(start);
    while (stack.length > 0) {
      const node = stack.pop()!;
      component.push(node);
      for (const next of adjacency.get(node) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    components.push(component);
  }

  const groups: DuplicateGroup[] = [];
  for (const component of components) {
    const sourceIds = component
      .filter((node) => nodeKind.get(node) === "source")
      .map((node) => node.slice(2))
      .sort();
    const targetIds = component
      .filter((node) => nodeKind.get(node) === "target")
      .map((node) => node.slice(2))
      .sort();

    // A component must contain both sides by construction, but keep the guard explicit.
    if (sourceIds.length === 0 || targetIds.length === 0) continue;

    const sourceRecordsInGroup = sourceIds
      .map((id) => sourceById.get(id))
      .filter((record): record is CandidateRecord => record !== undefined);
    const targetRecordsInGroup = targetIds
      .map((id) => targetRecords.get(id))
      .filter((record): record is CandidateRecord => record !== undefined);

    const sortedSource = [...sourceRecordsInGroup].sort(compareRecords);
    const sortedTarget = [...targetRecordsInGroup].sort(compareRecords);
    const records: DuplicateRecord[] = [
      ...sortedSource.map((record) => ({
        side: "source" as const,
        transaction: record.transaction,
        categoryLabel: record.categoryLabel,
        tagLabels: record.tagLabels,
      })),
      ...sortedTarget.map((record) => ({
        side: "target" as const,
        transaction: record.transaction,
        categoryLabel: record.categoryLabel,
        tagLabels: record.tagLabels,
      })),
    ];

    groups.push({
      id: `group:${sourceIds.join(",")}:${targetIds.join(",")}`,
      records,
      sourceCount: sortedSource.length,
      targetCount: sortedTarget.length,
    });
  }

  groups.sort((left, right) => {
    const leftFirst = left.records.find((record) => record.side === "source");
    const rightFirst = right.records.find((record) => record.side === "source");
    const byTime = compareTransactionTime(leftFirst?.transaction, rightFirst?.transaction);
    if (byTime !== 0) return byTime;
    return left.id.localeCompare(right.id, "zh-Hans-CN");
  });

  return {
    groups,
    duplicateSourceIds: new Set(groups.flatMap((group) =>
      group.records.filter((record) => record.side === "source").map((record) => record.transaction.id),
    )),
    duplicateTargetIds: new Set(groups.flatMap((group) =>
      group.records.filter((record) => record.side === "target").map((record) => record.transaction.id),
    )),
  };
}

function compareTransactionTime(left: Transaction | undefined, right: Transaction | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  const leftTime = Date.parse(left.occurredAt);
  const rightTime = Date.parse(right.occurredAt);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.id.localeCompare(right.id);
}

function compareRecords(left: CandidateRecord, right: CandidateRecord): number {
  return compareTransactionTime(left.transaction, right.transaction);
}


