/**
 * C-3 适配器测试（web 侧草案）：P05 层级表/旭日、P06 矩形树、P07 桑基。
 *
 * 断言重点是「口径与门控」而不是像素：
 * - 无真实层级时不得画旭日/桑基，矩形树退化为平面并显式标注；
 * - 金额与占比来自 shared 结果，适配器只格式化、不重算；
 * - 未声明分类、空范围、零总额等边界必须给可展示原因。
 */

import { describe, expect, it } from "vitest";

import type { AdapterOptions } from "./adapters.js";
import {
  HIERARCHY_TABLE_MAX_ROWS,
  toHierarchyTableInput,
  toSankeyInput,
  toSunburstInput,
  toTreemapInput,
} from "./adapters4.js";
import type {
  SharedHierarchyNode,
  SharedHierarchyResult,
  SharedSankeyResult,
} from "./sharedTypes.js";

const OPTIONS: AdapterOptions = {
  analysisId: "P05-category-hierarchy",
  title: "分类层级",
  currency: "CNY",
  decimals: 2,
};

const ROOT_ID = "__root__";

function node(overrides: Partial<SharedHierarchyNode> & { nodeId: string }): SharedHierarchyNode {
  return {
    parentId: ROOT_ID,
    depth: 1,
    kind: "category",
    label: overrides.nodeId,
    directAmountMinor: 0n,
    directCount: 0,
    subtreeAmountMinor: 0n,
    subtreeCount: 0,
    childCount: 0,
    isLeaf: true,
    hasMissingRelation: false,
    ...overrides,
  };
}

/** 真实层级：食品（父，直接 200 + 子 800）→ 早餐 500 / 午餐 300；交通 1000（叶子）。 */
function realHierarchy(overrides: Partial<SharedHierarchyResult> = {}): SharedHierarchyResult {
  const nodes: SharedHierarchyNode[] = [
    {
      nodeId: ROOT_ID,
      parentId: null,
      depth: 0,
      kind: "root",
      label: "",
      directAmountMinor: 0n,
      directCount: 0,
      subtreeAmountMinor: 2000n,
      subtreeCount: 4,
      childCount: 2,
      isLeaf: false,
      hasMissingRelation: false,
    },
    node({
      nodeId: "c-food",
      label: "食品",
      depth: 1,
      directAmountMinor: 200n,
      directCount: 1,
      subtreeAmountMinor: 1000n,
      subtreeCount: 3,
      childCount: 2,
      isLeaf: false,
    }),
    node({
      nodeId: "c-food-breakfast",
      parentId: "c-food",
      label: "早餐",
      depth: 2,
      directAmountMinor: 500n,
      directCount: 1,
      subtreeAmountMinor: 500n,
      subtreeCount: 1,
    }),
    node({
      nodeId: "c-food-lunch",
      parentId: "c-food",
      label: "午餐",
      depth: 2,
      directAmountMinor: 300n,
      directCount: 1,
      subtreeAmountMinor: 300n,
      subtreeCount: 1,
    }),
    node({
      nodeId: "c-transport",
      label: "交通",
      depth: 1,
      directAmountMinor: 1000n,
      directCount: 1,
      subtreeAmountMinor: 1000n,
      subtreeCount: 1,
    }),
  ];

  return {
    rootId: ROOT_ID,
    metric: "expense",
    currency: "CNY",
    nodes,
    maxDepth: 2,
    isRealHierarchy: true,
    hasUnknownCategories: false,
    orphanRelationCategoryIds: [],
    totalAmountMinor: 2000n,
    totalCount: 4,
    conservation: {
      rootSubtreeAmountMinor: 2000n,
      nodesConserved: true,
      noDoubleCounting: true,
      edgesConserved: true,
    },
    completeness: "complete",
    ...overrides,
  };
}

describe("P05 层级表 toHierarchyTableInput", () => {
  it("真实层级：逐行金额来自 shared，父级占比对父总额、顶层占比对总额", () => {
    const input = toHierarchyTableInput(realHierarchy(), OPTIONS);

    expect(input.available).toBe(true);
    expect(input.unavailableReason).toBeNull();
    expect(input.rows).toHaveLength(4);
    expect(input.rowsTruncated).toBe(false);
    expect(input.totalText).toBe("20.00");

    const food = input.rows.find((row) => row.nodeId === "c-food");
    expect(food?.subtreeAmountText).toBe("10.00");
    expect(food?.directAmountText).toBe("2.00");
    expect(food?.countText).toBe("3 笔");
    // 1000 / 2000 = 50.0%
    expect(food?.shareOfTotalText).toBe("50.0%");
    // 1000 / 2000（父为根）= 50.0%
    expect(food?.shareOfParentText).toBe("50.0%");

    const breakfast = input.rows.find((row) => row.nodeId === "c-food-breakfast");
    expect(breakfast?.depth).toBe(2);
    // 500 / 1000 = 50.0%
    expect(breakfast?.shareOfParentText).toBe("50.0%");
    // 500 / 2000 = 25.0%
    expect(breakfast?.shareOfTotalText).toBe("25.0%");
  });

  it("无真实层级：照实显示平面分类，nestingText 明确说明数据模型依赖", () => {
    const input = toHierarchyTableInput(
      realHierarchy({ isRealHierarchy: false, maxDepth: 1 }),
      OPTIONS,
    );

    expect(input.available).toBe(true);
    expect(input.nestingText).toContain("无真实分类层级");
    expect(input.rows.length).toBeGreaterThan(0);
  });

  it("未声明分类：行上带 hasMissingRelation 标记，说明文本不掩盖不完整", () => {
    const base = realHierarchy({ hasUnknownCategories: true });
    const withMissing = {
      ...base,
      nodes: base.nodes.map((candidate) =>
        candidate.nodeId === "c-transport"
          ? { ...candidate, hasMissingRelation: true }
          : candidate,
      ),
    };

    const input = toHierarchyTableInput(withMissing, OPTIONS);

    expect(input.rows.find((row) => row.nodeId === "c-transport")?.hasMissingRelation).toBe(true);
    expect(input.nestingText).toContain("未声明分类");
  });

  it("空范围：available=false 并给原因，不画 0 行表格冒充结果", () => {
    const input = toHierarchyTableInput(
      realHierarchy({ completeness: "no-transactions", totalAmountMinor: 0n }),
      OPTIONS,
    );

    expect(input.available).toBe(false);
    expect(input.unavailableReason).toContain("没有交易");
  });

  it("行数超过上限时显式标记 rowsTruncated", () => {
    const nodes: SharedHierarchyNode[] = [realHierarchy().nodes[0]!];
    for (let index = 0; index < HIERARCHY_TABLE_MAX_ROWS + 5; index += 1) {
      nodes.push(
        node({
          nodeId: `c-${String(index).padStart(4, "0")}`,
          subtreeAmountMinor: 1n,
          subtreeCount: 1,
        }),
      );
    }

    const input = toHierarchyTableInput(realHierarchy({ nodes }), OPTIONS);

    expect(input.rows).toHaveLength(HIERARCHY_TABLE_MAX_ROWS);
    expect(input.rowsTruncated).toBe(true);
  });
});

describe("P05 旭日图 toSunburstInput", () => {
  it("真实层级：含根与「· 直接」终端，子份额相对父级子树金额", () => {
    const outcome = toSunburstInput(realHierarchy(), OPTIONS);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const nodes = outcome.input.nodes;
    const rootArc = nodes.find((datum) => datum.kind === "root");
    expect(rootArc?.fractionOfParent).toBeNull();
    expect(rootArc?.subtreeAmountMinor).toBe(2000n);

    const food = nodes.find((datum) => datum.nodeId === "c-food");
    expect(food?.fractionOfParent).toBe(0.5);

    const direct = nodes.find((datum) => datum.kind === "direct");
    expect(direct?.parentId).toBe("c-food");
    // 200 / 1000 = 0.2
    expect(direct?.fractionOfParent).toBeCloseTo(0.2, 6);
    // 最深是「食品 · 直接」终端：父食品 depth 1 → 直接节点 depth 2。
    expect(outcome.input.maxDepth).toBe(2);
  });

  it("无真实层级：拒绝画图并给可展示原因（不得画假层级）", () => {
    const outcome = toSunburstInput(realHierarchy({ isRealHierarchy: false }), OPTIONS);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("no-real-hierarchy");
    expect(outcome.reasonText).toContain("数据模型依赖");
  });

  it("有未声明分类：拒绝（层级不完整）", () => {
    const outcome = toSunburstInput(realHierarchy({ hasUnknownCategories: true }), OPTIONS);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("unknown-categories");
  });

  it("空范围：拒绝并给 no-transactions", () => {
    const outcome = toSunburstInput(
      realHierarchy({ completeness: "no-transactions", totalAmountMinor: 0n }),
      OPTIONS,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("no-transactions");
  });
});

describe("P06 矩形树图 toTreemapInput", () => {
  it("无真实层级：平面矩形树，只含顶层分类且显式 flattened", () => {
    const outcome = toTreemapInput(realHierarchy({ isRealHierarchy: false }), OPTIONS);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.input.flattened).toBe(true);
    expect(outcome.input.nodes.map((datum) => datum.nodeId)).toEqual([
      "c-food",
      "c-transport",
    ]);
    expect(outcome.input.nodes[0]?.fractionOfTotal).toBe(0.5);
    expect(outcome.input.nestingText).toContain("无真实分类层级");
  });

  it("真实层级：返回全部分类节点（嵌套关系保留）", () => {
    const outcome = toTreemapInput(realHierarchy(), OPTIONS);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.input.flattened).toBe(false);
    expect(outcome.input.nodes).toHaveLength(4);
    expect(outcome.input.nodes.find((datum) => datum.nodeId === "c-food-breakfast"))
      .toMatchObject({ parentId: "c-food", depth: 2 });
  });

  it("总额为 0：拒绝渲染虚假完整图", () => {
    const outcome = toTreemapInput(
      realHierarchy({ totalAmountMinor: 0n, totalCount: 0 }),
      OPTIONS,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("zero-total");
  });

  it("空范围：拒绝并给原因", () => {
    const outcome = toTreemapInput(
      realHierarchy({ completeness: "no-transactions", totalAmountMinor: 0n }),
      OPTIONS,
    );

    expect(outcome.ok).toBe(false);
  });
});

function sankeyResult(overrides: Partial<SharedSankeyResult> = {}): SharedSankeyResult {
  return {
    rootId: ROOT_ID,
    metric: "expense",
    currency: "CNY",
    totalMinor: 2000n,
    nodes: [
      {
        nodeId: ROOT_ID,
        label: "总额",
        depth: 0,
        kind: "root",
        inflowMinor: 0n,
        outflowMinor: 2000n,
        isTerminal: false,
      },
      {
        nodeId: "c-food",
        label: "食品",
        depth: 1,
        kind: "category",
        inflowMinor: 1000n,
        outflowMinor: 1000n,
        isTerminal: false,
      },
      {
        nodeId: "c-transport",
        label: "交通",
        depth: 1,
        kind: "category",
        inflowMinor: 1000n,
        outflowMinor: 0n,
        isTerminal: true,
      },
    ],
    links: [
      { fromId: ROOT_ID, toId: "c-food", amountMinor: 1000n, shareOfSource: { numerator: 1n, denominator: 2n } },
      { fromId: ROOT_ID, toId: "c-transport", amountMinor: 1000n, shareOfSource: { numerator: 1n, denominator: 2n } },
    ],
    isRealHierarchy: true,
    hasUnknownCategories: false,
    conservation: {
      rootOutflowMatchesTotal: true,
      allInflowsMatch: true,
      outflowConserved: true,
      noNegativeLinks: true,
    },
    completeness: "complete",
    ...overrides,
  };
}

describe("P07 层级桑基 toSankeyInput", () => {
  it("真实层级：节点高度份额与连线份额来自 shared 金额", () => {
    const outcome = toSankeyInput(sankeyResult(), OPTIONS);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const food = outcome.input.nodes.find((datum) => datum.nodeId === "c-food");
    // max(inflow, outflow) / total = 1000 / 2000
    expect(food?.valueFraction).toBe(0.5);
    expect(food?.inflowText).toBe("10.00");
    expect(food?.outflowText).toBe("10.00");

    const link = outcome.input.links.find((candidate) => candidate.toId === "c-food");
    expect(link?.amountText).toBe("10.00");
    expect(link?.fractionOfTotal).toBe(0.5);
    expect(link?.shareOfSource).toBe(0.5);
    expect(outcome.input.totalText).toBe("20.00");
  });

  it("无真实层级：拒绝启用（不允许冒充资金流）", () => {
    const outcome = toSankeyInput(sankeyResult({ isRealHierarchy: false }), OPTIONS);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("no-real-hierarchy");
    expect(outcome.reasonText).toContain("§23");
  });

  it("未声明分类：拒绝启用", () => {
    const outcome = toSankeyInput(sankeyResult({ hasUnknownCategories: true }), OPTIONS);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("unknown-categories");
  });

  it("空范围：拒绝启用", () => {
    const outcome = toSankeyInput(
      sankeyResult({ completeness: "no-transactions", totalMinor: 0n, nodes: [], links: [] }),
      OPTIONS,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("no-transactions");
  });
});
