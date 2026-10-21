/**
 * S14-D D1 · 可能重复的账目检测。
 *
 * **S15-E2 起，判定规则不再写在这里。** 金额、币种、收支方向、时间窗口、分类与
 * 支付方式全部交给共享核心 `@libellum/shared` 的 `evaluateDuplicatePair`；本文件是
 * **账本导入入口的适配层**，只保留跨账本导入特有的三件事：
 *
 *  1. **只在来源 B 与目标 A 之间比较**；A-A、B-B 永远不构成冲突；
 *  2. 把来源分类/支付方式翻译成**目标账本的语义键**（`target:<id>` / `new:<id>`），
 *     绝不比较两个账本碰巧同名的显示名称；
 *  3. 把匹配图拆成连通分量，一个分量就是一组冲突。
 *
 * ⚠️ **来源快照的账本键统一填目标账本。** 导入的问题始终是“这笔来源记录写进目标账本
 * 后，会不会与目标已有记录重复”；核心的“同一账本”规则在适配层被解释为“同一目标账本”。
 *
 * ⚠️ **与旧实现的有意差异**（详见 `docs/specs/features/S15-E2-统一重复检测规则-设计决定.md`）：
 *  - 不再要求标签集合相同（统一规则不比较标签）；
 *  - 默认要求支付方式相同（双方都有映射后的支付方式时）；
 *  - 时间窗口来自用户设置（默认仍是 60 秒），不再是模块常量；
 *  - 时间按真实时间戳比较；旧实现本来就是这样，未改变。
 *
 * ⚠️ **只提醒，不自动删除。** 这里不产生任何写入决定；没有命中重复的来源记录默认进入待导入列表。
 */

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  evaluateDuplicatePair,
  notDuplicatePairKey,
  type DuplicateCandidateFields,
  type DuplicateDetectionSettings,
  type Transaction,
} from "@libellum/shared";

import type {
  DuplicateGroup,
  DuplicateRecord,
  ImportSource,
  ImportTarget,
  TaxonomyMappingPlan,
} from "./types.js";

export interface DuplicateDetectionResult {
  readonly groups: readonly DuplicateGroup[];
  readonly duplicateSourceIds: ReadonlySet<string>;
  readonly duplicateTargetIds: ReadonlySet<string>;
}

interface CandidateRecord {
  readonly transaction: Transaction;
  /** 目标账本语义键：复用时 `target:<id>`，新建时 `new:<sourceId>`。 */
  readonly categoryKey: string;
  /** 同上；来源没有支付方式时为 `null`。 */
  readonly paymentKey: string | null;
  readonly categoryLabel: string;
  readonly tagLabels: readonly string[];
}

interface GroupEdge {
  readonly sourceId: string;
  readonly targetId: string;
}

function tagLabelsFor(ids: readonly string[], namesById: ReadonlyMap<string, string>): readonly string[] {
  return ids
    .map((id) => namesById.get(id) ?? "（未知标签）")
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

/**
 * 来源分类/支付方式/标签到目标语义键的索引。
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
  paymentKeyById: Map<string, string>;
  tagLabelById: Map<string, string>;
} {
  const categoryKeyById = new Map<string, string>();
  const categoryLabelById = new Map<string, string>();
  const paymentKeyById = new Map<string, string>();
  const tagLabelById = new Map<string, string>();

  for (const item of mapping.categories) {
    categoryKeyById.set(item.source.id, item.matchKey);
  }
  for (const item of mapping.paymentMethods) {
    paymentKeyById.set(item.source.id, item.matchKey);
  }
  for (const item of mapping.tags) {
    tagLabelById.set(item.source.id, item.source.name);
  }
  // Labels are for display only; missing taxonomy (corrupt local data) must not crash a preview.
  for (const category of source.categories) {
    categoryLabelById.set(category.id, category.name);
  }
  for (const tag of source.tags) {
    tagLabelById.set(tag.id, tag.name);
  }

  return { categoryKeyById, categoryLabelById, paymentKeyById, tagLabelById };
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
    sourceRecords.set(transaction.id, {
      transaction,
      categoryKey,
      paymentKey:
        transaction.paymentMethodId === null
          ? null
          : (sourceIndexes.paymentKeyById.get(transaction.paymentMethodId) ?? null),
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
    targetRecords.set(transaction.id, {
      transaction,
      categoryKey: `target:${transaction.categoryId}`,
      paymentKey:
        transaction.paymentMethodId === null ? null : `target:${transaction.paymentMethodId}`,
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

/**
 * 候选分桶键：只包含任何设置下都必须相同的维度（方向、金额、币种）。
 *
 * 分类/支付方式可能被用户关闭，不能放进桶键；时间窗口也不能（窗口可配置）。
 * 桶内再走核心的完整规则。
 */
function candidateKey(record: CandidateRecord): string {
  return `${record.transaction.kind}\u0000${String(record.transaction.amountCents)}\u0000${record.transaction.currency.toUpperCase()}`;
}

/** 把一条导入候选翻译成统一核心的字段；账本键统一用目标账本（见文件头）。 */
function coreCandidate(record: CandidateRecord, targetBookId: string): DuplicateCandidateFields {
  return {
    id: record.transaction.id,
    bookId: targetBookId,
    kind: record.transaction.kind,
    amountCents: record.transaction.amountCents,
    currency: record.transaction.currency,
    occurredAt: record.transaction.occurredAt,
    occurredAtPrecision: "second",
    occurredLocalDate: record.transaction.occurredLocalDate,
    categoryId: record.categoryKey,
    paymentMethodId: record.paymentKey,
  };
}

function emptyResult(): DuplicateDetectionResult {
  return {
    groups: [],
    duplicateSourceIds: new Set(),
    duplicateTargetIds: new Set(),
  };
}

/**
 * 检测跨来源/目标的可能重复账目。
 *
 * 输出顺序稳定：组按组内最早来源账目时间、再按来源 id 排序；组内来源记录在前、目标记录在后，
 * 各自按时间和 id 排序。界面据此逐组展示时不会因为 Map/Set 顺序而跳来跳去。
 *
 * `settings` 缺省时使用统一默认规则（开启提醒、60 秒、比较分类与支付方式）。用户关闭提醒后
 * 本函数返回空结果——**导入本身与来源身份去重不受影响**。
 */
export function detectDuplicateGroups(
  source: ImportSource,
  target: ImportTarget,
  mapping: TaxonomyMappingPlan,
  excludeSourceIds: ReadonlySet<string> = new Set<string>(),
  excludeTargetIds: ReadonlySet<string> = new Set<string>(),
  settings: DuplicateDetectionSettings = DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  /**
   * S15-E3：用户已确认「不是同一笔」的配对键（`notDuplicatePairKey` 生成）。
   *
   * 账本导入是**跨账本**比较，而关系按账本保存，所以当前产品路径通常传空集合；
   * 这个参数是给 E4/E5 复用的**唯一抑制点**——过滤只在适配层发生，
   * E2 的检测规则与用户设置语义不变。
   *
   * ⚠️ 不具传递性：只跳过键里明确出现的那一对。
   */
  suppressedPairKeys: ReadonlySet<string> = new Set<string>(),
): DuplicateDetectionResult {
  if (!settings.enabled) return emptyResult();

  const { sourceRecords, targetRecords, targetIndex } = sourceCandidates(
    source,
    target,
    mapping,
    excludeSourceIds,
    excludeTargetIds,
  );

  const edges: GroupEdge[] = [];

  for (const [sourceId, sourceRecord] of sourceRecords) {
    const candidates = targetIndex.get(candidateKey(sourceRecord)) ?? [];
    for (const targetRecord of candidates) {
      if (suppressedPairKeys.size > 0 &&
          suppressedPairKeys.has(notDuplicatePairKey(sourceId, targetRecord.transaction.id))) {
        continue;
      }

      const result = evaluateDuplicatePair(
        coreCandidate(sourceRecord, target.bookId),
        coreCandidate(targetRecord, target.bookId),
        settings,
      );
      if (!result.matched) continue;
      edges.push({ sourceId, targetId: targetRecord.transaction.id });
    }
  }

  if (edges.length === 0) return emptyResult();

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
      .map((id) => sourceRecords.get(id))
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
