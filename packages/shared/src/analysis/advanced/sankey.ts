/**
 * Agent C · C-3（P07 分类层级关系桑基图）的数学权威层，W7 接入真实分类关系。
 *
 * 桑基图**只表示真实分类层级之间的金额归属关系**（owner 规格 §23）：
 * 支出总额 → 分类大类 → 分类子类；不允许把「收入来源 → 支付方式 → 消费分类」
 * 随意连起来冒充资金流向。本模块的输入只能是 `buildHierarchy()` 的结果，
 * 因此结构与金额口径与 P05 完全一致，不另算一套。
 *
 * 守恒关系（owner 规格 §6.5 / §42.2 / §46.8）：
 * - 根节点流出 = 统计总额；
 * - 每个分类节点：流入 = 自己的子树金额；有子级时流出 = 子树金额；
 * - 「直接金额终端」（节点自身有交易且有子级时）保证 `流入 = 流出` 不破；
 * - 不允许零/负连线。
 */

import type {
  DraftHierarchyNode,
  DraftHierarchyResult,
  DraftSankeyLink,
  DraftSankeyNode,
  DraftSankeyResult,
} from "./draftTypes.js";
import { HIERARCHY_DIRECT_SUFFIX, HIERARCHY_ROOT_ID } from "./hierarchy.js";
import { makeRational } from "./rational.js";

/** 桑基连线数上限；超过即显式拒绝（成本控制，不静默截断）。 */
export const MAX_SANKEY_LINKS = 4000;

/**
 * 从层级结果构建桑基节点/连线。
 *
 * @throws {RangeError} 连线数超过 `MAX_SANKEY_LINKS`。
 */
export function buildHierarchySankey(result: DraftHierarchyResult): DraftSankeyResult {
  const rootNode = result.nodes.find((node) => node.nodeId === HIERARCHY_ROOT_ID);

  if (rootNode === undefined) {
    return {
      rootId: HIERARCHY_ROOT_ID,
      metric: result.metric,
      currency: result.currency,
      totalMinor: 0n,
      nodes: [],
      links: [],
      isRealHierarchy: result.isRealHierarchy,
      hasUnknownCategories: result.hasUnknownCategories,
      conservation: {
        rootOutflowMatchesTotal: true,
        allInflowsMatch: true,
        outflowConserved: true,
        noNegativeLinks: true,
      },
      completeness: result.completeness,
    };
  }

  const links: DraftSankeyLink[] = [];
  const inflowByNode = new Map<string, bigint>();
  const directNodes: DraftSankeyNode[] = [];

  const pushLink = (
    fromId: string,
    toId: string,
    amountMinor: bigint,
    sourceSubtreeMinor: bigint,
  ): void => {
    const share =
      sourceSubtreeMinor > 0n ? makeRational(amountMinor, sourceSubtreeMinor) : null;
    links.push({ fromId, toId, amountMinor, shareOfSource: share });
    const existing = inflowByNode.get(toId) ?? 0n;
    inflowByNode.set(toId, existing + amountMinor);
  };

  for (const node of result.nodes) {
    if (node.kind !== "category") continue;
    if (node.parentId === HIERARCHY_ROOT_ID) {
      pushLink(HIERARCHY_ROOT_ID, node.nodeId, node.subtreeAmountMinor, result.totalAmountMinor);
    }
  }

  for (const node of result.nodes) {
    if (node.kind !== "category") continue;

    const children = result.nodes.filter(
      (candidate) => candidate.kind === "category" && candidate.parentId === node.nodeId,
    );

    for (const child of children) {
      pushLink(node.nodeId, child.nodeId, child.subtreeAmountMinor, node.subtreeAmountMinor);
    }

    // 零金额子树在 hierarchy 中省略，但结构上的父节点仍须有直接金额终端。
    if (node.childCount > 0 && node.directAmountMinor > 0n) {
      const directId = `${node.nodeId}${HIERARCHY_DIRECT_SUFFIX}`;
      directNodes.push({
        nodeId: directId,
        label: `${node.label} · 直接`,
        depth: node.depth + 1,
        kind: "direct",
        inflowMinor: node.directAmountMinor,
        outflowMinor: 0n,
        isTerminal: true,
      });
      pushLink(node.nodeId, directId, node.directAmountMinor, node.subtreeAmountMinor);
    }
  }

  if (links.length > MAX_SANKEY_LINKS) {
    throw new RangeError(
      `sankey has ${String(links.length)} links, above MAX_SANKEY_LINKS=${String(MAX_SANKEY_LINKS)}`,
    );
  }

  links.sort((left, right) => {
    if (left.fromId !== right.fromId) return left.fromId < right.fromId ? -1 : 1;
    return left.toId < right.toId ? -1 : left.toId > right.toId ? 1 : 0;
  });

  const outflowByNode = new Map<string, bigint>();
  for (const link of links) {
    const existing = outflowByNode.get(link.fromId) ?? 0n;
    outflowByNode.set(link.fromId, existing + link.amountMinor);
  }

  const sankeyNodes: DraftSankeyNode[] = [];

  for (const node of result.nodes) {
    if (node.kind === "root") {
      sankeyNodes.push({
        nodeId: node.nodeId,
        label: "总额",
        depth: 0,
        kind: "root",
        inflowMinor: 0n,
        outflowMinor: outflowByNode.get(node.nodeId) ?? 0n,
        isTerminal: (outflowByNode.get(node.nodeId) ?? 0n) === 0n,
      });
      continue;
    }

    if (node.kind !== "category") continue;

    const hasChildren = node.childCount > 0;
    sankeyNodes.push({
      nodeId: node.nodeId,
      label: node.label,
      depth: node.depth,
      kind: "category",
      inflowMinor: inflowByNode.get(node.nodeId) ?? 0n,
      outflowMinor: outflowByNode.get(node.nodeId) ?? 0n,
      isTerminal: !hasChildren,
    });
  }

  sankeyNodes.push(...directNodes);

  sankeyNodes.sort((left, right) => {
    if (left.depth !== right.depth) return left.depth - right.depth;
    const order = (kind: DraftSankeyNode["kind"]): number =>
      kind === "root" ? 0 : kind === "category" ? 1 : 2;
    const kindOrder = order(left.kind) - order(right.kind);
    if (kindOrder !== 0) return kindOrder;
    return left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0;
  });

  let allInflowsMatch = true;
  let outflowConserved = true;

  const categoryIdsWithChildren = new Set<string>();
  for (const node of result.nodes) {
    if (node.kind === "category" && node.childCount > 0) categoryIdsWithChildren.add(node.nodeId);
  }

  for (const node of sankeyNodes) {
    if (node.kind === "category") {
      const source = result.nodes.find((candidate) => candidate.nodeId === node.nodeId);
      const expectedInflow = source?.subtreeAmountMinor ?? 0n;
      if (node.inflowMinor !== expectedInflow) allInflowsMatch = false;

      if (categoryIdsWithChildren.has(node.nodeId)) {
        if (node.outflowMinor !== node.inflowMinor) outflowConserved = false;
      } else if (node.outflowMinor !== 0n) {
        outflowConserved = false;
      }
      continue;
    }

    if (node.kind === "direct") {
      if (node.outflowMinor !== 0n) outflowConserved = false;
      continue;
    }
  }

  const rootOutflow = outflowByNode.get(HIERARCHY_ROOT_ID) ?? 0n;
  const rootOutflowMatchesTotal = rootOutflow === result.totalAmountMinor;
  const noNegativeLinks = links.every((link) => link.amountMinor > 0n);

  return {
    rootId: HIERARCHY_ROOT_ID,
    metric: result.metric,
    currency: result.currency,
    totalMinor: result.totalAmountMinor,
    nodes: sankeyNodes,
    links,
    isRealHierarchy: result.isRealHierarchy,
    hasUnknownCategories: result.hasUnknownCategories,
    conservation: {
      rootOutflowMatchesTotal,
      allInflowsMatch,
      outflowConserved,
      noNegativeLinks,
    },
    completeness: result.completeness,
  };
}

/** 桑基守恒自检：四项全部为 true 才算守恒。 */
export function sankeyIsConserved(result: DraftSankeyResult): boolean {
  const { conservation } = result;
  return (
    conservation.rootOutflowMatchesTotal &&
    conservation.allInflowsMatch &&
    conservation.outflowConserved &&
    conservation.noNegativeLinks
  );
}

export type { DraftHierarchyNode };
