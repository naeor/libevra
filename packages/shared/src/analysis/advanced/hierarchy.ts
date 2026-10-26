/**
 * Agent C · C-3（P05 分类层级结构）的数学权威层（DRAFT，未冻结）。
 *
 * 数据模型当前**没有分类父子关系**（`Category` 无 `parentId`，QC-03）。因此本模块
 * 的层级输入是一个显式的「分类关系表」占位 `DraftCategoryRelation[]`：它只能由未来
 * 的数据模型扩展（或上层受控投影）提供，**绝不能根据分类名称猜测层级**（owner
 * 规格 §21「如果 Libevra 暂时没有父子分类，P05 应登记为数据模型依赖」）。
 *
 * 计算规则（owner 规格 §6.5 / §21 / §46.5）：
 * - 同一笔交易只计入它自己的分类节点（direct），父节点金额 = 直接金额 + 子节点金额；
 * - 父子不重复计数：`root.subtree = Σ 所有节点 direct`；
 * - 分类可没有子分类；显示未声明分类（历史/孤立节点）并显式标记；
 * - 孤立父引用（parent 指向未声明分类）有明确处理规则：按顶层处理并登记；
 * - 循环、重复关系、自我父级 → 显式抛错（不静默修正）。
 *
 * 所有金额是「币种最小单位」的 `bigint`；只有展示层可舍入/格式化。
 */

import type {
  DraftCategoryRelation,
  DraftCompleteness,
  DraftHierarchyNode,
  DraftHierarchyResult,
} from "./draftTypes.js";
import { assertRecordShape, currenciesOf, type AdvancedRecord } from "./dimensions.js";

/** 合成根节点 ID。 */
export const HIERARCHY_ROOT_ID = "__root__";

/** 「直接金额」终端节点 ID 的后缀（P07 桑基：父级既有直接交易又有子级时使用）。 */
export const HIERARCHY_DIRECT_SUFFIX = "::direct";

/** 层级节点数上限；超过即显式拒绝（成本控制，不静默截断）。 */
export const MAX_HIERARCHY_NODES = 2000;

export type DraftHierarchyMetric = "expense" | "income";

export interface DraftHierarchyOptions {
  /** 默认 `expense`。 */
  readonly metric?: DraftHierarchyMetric;
}

interface RelationGraph {
  readonly byId: ReadonlyMap<string, DraftCategoryRelation>;
  readonly childIdsOf: ReadonlyMap<string, readonly string[]>;
  readonly roots: readonly string[];
  /** 父引用指向未声明分类的关系行（按顶层处理并登记）。 */
  readonly orphanCategoryIds: readonly string[];
}

/**
 * 校验并建立分类关系图。
 *
 * @throws {RangeError} 重复关系、自我父级、循环父级。
 */
export function buildRelationGraph(relations: readonly DraftCategoryRelation[]): RelationGraph {
  const byId = new Map<string, DraftCategoryRelation>();

  for (const relation of relations) {
    if (relation.categoryId.length === 0) {
      throw new RangeError("categoryId must not be empty");
    }
    if (byId.has(relation.categoryId)) {
      throw new RangeError(`duplicate category relation: ${relation.categoryId}`);
    }
    byId.set(relation.categoryId, relation);
  }

  for (const relation of relations) {
    if (relation.parentCategoryId === relation.categoryId) {
      throw new RangeError(`category cannot be its own parent: ${relation.categoryId}`);
    }
  }

  const orphanCategoryIds: string[] = [];
  const childIdsOf = new Map<string, string[]>();
  const roots: string[] = [];

  for (const relation of relations) {
    const parentId = relation.parentCategoryId;
    const isOrphan = parentId !== null && !byId.has(parentId);

    if (isOrphan) {
      orphanCategoryIds.push(relation.categoryId);
      roots.push(relation.categoryId);
      continue;
    }

    if (parentId === null) {
      roots.push(relation.categoryId);
      continue;
    }

    const bucket = childIdsOf.get(parentId);
    if (bucket === undefined) {
      childIdsOf.set(parentId, [relation.categoryId]);
    } else {
      bucket.push(relation.categoryId);
    }
  }

  detectCycle(byId);

  return {
    byId,
    childIdsOf,
    roots: sortIds(roots),
    orphanCategoryIds: sortIds(orphanCategoryIds),
  };
}

function detectCycle(byId: ReadonlyMap<string, DraftCategoryRelation>): void {
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  const visit = (categoryId: string): void => {
    const current = state.get(categoryId);
    if (current === "done") return;
    if (current === "visiting") {
      const start = path.indexOf(categoryId);
      const cycle = [...path.slice(start), categoryId].join(" -> ");
      throw new RangeError(`hierarchy contains a cycle: ${cycle}`);
    }

    state.set(categoryId, "visiting");
    path.push(categoryId);

    const relation = byId.get(categoryId);
    const parentId = relation?.parentCategoryId ?? null;
    if (parentId !== null && byId.has(parentId)) {
      visit(parentId);
    }

    path.pop();
    state.set(categoryId, "done");
  };

  for (const categoryId of byId.keys()) {
    visit(categoryId);
  }
}

function sortIds(ids: readonly string[]): string[] {
  const sorted = [...ids];
  sorted.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return sorted;
}

/**
 * 根据「记录 + 显式关系表」构建层级结果。
 *
 * 未出现在关系表中的记录分类按顶层分类处理，并设置 `hasMissingRelation=true`；
 * 因此只要存在这类分类，`isRealHierarchy` 为 `false`（不得声称真实业务层级）。
 *
 * @throws {RangeError} 关系表非法（重复/自我父级/循环）、记录金额为负、
 *   混合原币、节点数超上限。
 */
export function buildHierarchy(
  records: readonly AdvancedRecord[],
  relations: readonly DraftCategoryRelation[],
  options: DraftHierarchyOptions = {},
): DraftHierarchyResult {
  const metric = options.metric ?? "expense";
  const graph = buildRelationGraph(relations);

  const eligible = records.filter((record) => record.kind === metric);
  for (const record of eligible) {
    assertRecordShape(record);
  }

  const currencies = currenciesOf(eligible);
  if (currencies.length > 1) {
    throw new RangeError(
      `mixed original currencies (${currencies.join(", ")}) cannot be summed; filter to one currency first`,
    );
  }
  const currency = currencies[0] ?? "";

  const directAmounts = new Map<string, bigint>();
  const directCounts = new Map<string, number>();
  const labels = new Map<string, string>();
  const missingRelationIds = new Set<string>();

  for (const relation of relations) {
    labels.set(relation.categoryId, relation.categoryLabel);
  }

  for (const record of eligible) {
    const existing = directAmounts.get(record.categoryId) ?? 0n;
    directAmounts.set(record.categoryId, existing + record.amountMinor);
    directCounts.set(record.categoryId, (directCounts.get(record.categoryId) ?? 0) + 1);
    if (!graph.byId.has(record.categoryId)) {
      missingRelationIds.add(record.categoryId);
      if (!labels.has(record.categoryId)) {
        labels.set(record.categoryId, record.categoryLabel);
      }
    }
  }

  const parentOf = new Map<string, string | null>();
  const childIdsOf = new Map<string, string[]>();

  const registerNode = (categoryId: string): void => {
    if (parentOf.has(categoryId)) return;
    const relation = graph.byId.get(categoryId);
    if (relation === undefined) {
      parentOf.set(categoryId, null);
      return;
    }
    const parentId = relation.parentCategoryId;
    if (parentId !== null && graph.byId.has(parentId)) {
      parentOf.set(categoryId, parentId);
      const bucket = childIdsOf.get(parentId) ?? [];
      bucket.push(categoryId);
      childIdsOf.set(parentId, bucket);
    } else {
      parentOf.set(categoryId, null);
    }
  };

  for (const relation of relations) registerNode(relation.categoryId);
  for (const categoryId of directAmounts.keys()) registerNode(categoryId);

  for (const [, bucket] of childIdsOf) {
    bucket.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  }

  const depthOf = new Map<string, number>();
  const topLevelIds: string[] = [];
  for (const categoryId of parentOf.keys()) {
    if (parentOf.get(categoryId) === null) topLevelIds.push(categoryId);
  }
  topLevelIds.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const computeDepth = (categoryId: string): number => {
    const known = depthOf.get(categoryId);
    if (known !== undefined) return known;
    const parentId = parentOf.get(categoryId) ?? null;
    const depth = parentId === null ? 1 : computeDepth(parentId) + 1;
    depthOf.set(categoryId, depth);
    return depth;
  };

  for (const categoryId of parentOf.keys()) {
    computeDepth(categoryId);
  }

  const subtreeAmounts = new Map<string, bigint>();
  const subtreeCounts = new Map<string, number>();

  const collectSubtree = (categoryId: string): { amount: bigint; count: number } => {
    const knownAmount = subtreeAmounts.get(categoryId);
    if (knownAmount !== undefined) {
      return { amount: knownAmount, count: subtreeCounts.get(categoryId) ?? 0 };
    }

    let amount = directAmounts.get(categoryId) ?? 0n;
    let count = directCounts.get(categoryId) ?? 0;
    for (const childId of childIdsOf.get(categoryId) ?? []) {
      const child = collectSubtree(childId);
      amount += child.amount;
      count += child.count;
    }

    subtreeAmounts.set(categoryId, amount);
    subtreeCounts.set(categoryId, count);
    return { amount, count };
  };

  for (const categoryId of topLevelIds) {
    collectSubtree(categoryId);
  }

  const nodes: DraftHierarchyNode[] = [];
  const rootSubtree = topLevelIds.reduce((sum, id) => sum + (subtreeAmounts.get(id) ?? 0n), 0n);
  const rootCount = topLevelIds.reduce((sum, id) => sum + (subtreeCounts.get(id) ?? 0), 0);

  if (topLevelIds.length > 0 || eligible.length > 0) {
    nodes.push({
      nodeId: HIERARCHY_ROOT_ID,
      parentId: null,
      depth: 0,
      kind: "root",
      label: "",
      directAmountMinor: 0n,
      directCount: 0,
      subtreeAmountMinor: rootSubtree,
      subtreeCount: rootCount,
      childCount: topLevelIds.length,
      isLeaf: topLevelIds.length === 0,
      hasMissingRelation: false,
    });
  }

  for (const categoryId of parentOf.keys()) {
    const subtree = subtreeAmounts.get(categoryId) ?? 0n;
    const direct = directAmounts.get(categoryId) ?? 0n;
    const children = childIdsOf.get(categoryId) ?? [];

    // 无交易的分类节点不输出（整棵零金额子树在空数据里只会制造「0 分类」假象）；
    // 有数据的祖先由 subtree > 0 保留。
    if (subtree === 0n) continue;

    nodes.push({
      nodeId: categoryId,
      parentId: parentOf.get(categoryId) ?? HIERARCHY_ROOT_ID,
      depth: depthOf.get(categoryId) ?? 1,
      kind: "category",
      label: labels.get(categoryId) ?? categoryId,
      directAmountMinor: direct,
      directCount: directCounts.get(categoryId) ?? 0,
      subtreeAmountMinor: subtree,
      subtreeCount: subtreeCounts.get(categoryId) ?? 0,
      childCount: children.length,
      isLeaf: children.length === 0,
      hasMissingRelation: missingRelationIds.has(categoryId),
    });
  }

  if (nodes.length > MAX_HIERARCHY_NODES) {
    throw new RangeError(
      `hierarchy has ${String(nodes.length)} nodes, above MAX_HIERARCHY_NODES=${String(MAX_HIERARCHY_NODES)}`,
    );
  }

  nodes.sort((left, right) => {
    if (left.depth !== right.depth) return left.depth - right.depth;
    if (left.subtreeAmountMinor !== right.subtreeAmountMinor) {
      return left.subtreeAmountMinor > right.subtreeAmountMinor ? -1 : 1;
    }
    return left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0;
  });

  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));

  let nodesConserved = true;
  for (const node of nodes) {
    if (node.kind !== "category") continue;
    let childrenSum = 0n;
    for (const childId of childIdsOf.get(node.nodeId) ?? []) {
      const child = nodeById.get(childId);
      if (child === undefined) {
        nodesConserved = false;
        continue;
      }
      childrenSum += child.subtreeAmountMinor;
    }
    if (node.directAmountMinor + childrenSum !== node.subtreeAmountMinor) {
      nodesConserved = false;
    }
  }

  const directTotal = [...directAmounts.values()].reduce((sum, amount) => sum + amount, 0n);
  const noDoubleCounting = directTotal === rootSubtree;

  const maxDepth = nodes.reduce((max, node) => (node.depth > max ? node.depth : max), 0);
  const hasParentEdge = relations.some(
    (relation) => relation.parentCategoryId !== null && graph.byId.has(relation.parentCategoryId),
  );
  const hasUnknownCategories = missingRelationIds.size > 0;
  const isRealHierarchy =
    hasParentEdge && graph.orphanCategoryIds.length === 0 && !hasUnknownCategories;

  const completeness: DraftCompleteness =
    eligible.length === 0 ? "no-transactions" : "complete";

  return {
    rootId: HIERARCHY_ROOT_ID,
    metric,
    currency,
    nodes,
    maxDepth,
    isRealHierarchy,
    hasUnknownCategories,
    orphanRelationCategoryIds: graph.orphanCategoryIds,
    totalAmountMinor: rootSubtree,
    totalCount: rootCount,
    conservation: {
      rootSubtreeAmountMinor: rootSubtree,
      nodesConserved,
      noDoubleCounting,
      edgesConserved: nodesConserved && nodes.every((node) => {
        if (node.kind === "root") return node.childCount >= 0;
        const children = childIdsOf.get(node.nodeId) ?? [];
        if (children.length === 0) return node.directAmountMinor === node.subtreeAmountMinor;
        return node.directAmountMinor + children.reduce((sum, id) => sum + (nodeById.get(id)?.subtreeAmountMinor ?? 0n), 0n) === node.subtreeAmountMinor;
      }),
    },
    completeness,
  };
}

/** 从结果中取出节点（未知 id 返回 undefined，不抛错）。 */
export function hierarchyNodeOf(
  result: DraftHierarchyResult,
  nodeId: string,
): DraftHierarchyNode | undefined {
  return result.nodes.find((node) => node.nodeId === nodeId);
}

/** 守恒自检的便捷封装：四项全部为 true 才算守恒。 */
export function hierarchyIsConserved(result: DraftHierarchyResult): boolean {
  const { conservation } = result;
  return (
    conservation.nodesConserved &&
    conservation.noDoubleCounting &&
    conservation.edgesConserved
  );
}

/** 供展示层判断「是否可正式启用 P05/P07」（owner 规格 §21/§23：无真实层级不得启用）。 */
export function hierarchyIsUsable(result: DraftHierarchyResult): boolean {
  return result.isRealHierarchy && !result.hasUnknownCategories && result.completeness === "complete";
}
