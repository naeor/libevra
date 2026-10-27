/**
 * C-3（P05/P06/P07 分类层级）shared 数学层测试（DRAFT）。
 *
 * 覆盖 owner 规格 §46.5 层级结构测试项与 §46.8 层级守恒：
 * - 无分类层级 / 单层 / 多层；
 * - 节点只有直接交易；节点既有直接交易又有子分类；
 * - 分类循环异常、重复关系、自我父级（必须显式报错，不静默修正）；
 * - 历史孤立节点、孤立父引用（显式处理并标记，不猜测层级）；
 * - 真实金额守恒（父子不重复计数）、桑基流入流出守恒、无零/负连线。
 */

import { describe, expect, it } from "vitest";

import type { DraftCategoryRelation } from "./draftTypes.js";
import type { AdvancedRecord } from "./dimensions.js";
import {
  HIERARCHY_ROOT_ID,
  buildHierarchy,
  hierarchyIsConserved,
  hierarchyIsUsable,
  hierarchyNodeOf,
} from "./hierarchy.js";
import { buildHierarchySankey, sankeyIsConserved } from "./sankey.js";

function relation(
  categoryId: string,
  parentCategoryId: string | null,
  label?: string,
): DraftCategoryRelation {
  return { categoryId, categoryLabel: label ?? `分类-${categoryId}`, parentCategoryId };
}

function makeRecord(input: {
  readonly id: string;
  readonly categoryId: string;
  readonly amountMinor: bigint;
  readonly kind?: "expense" | "income";
  readonly label?: string;
  readonly currency?: string;
  readonly date?: string;
}): AdvancedRecord {
  return {
    id: input.id,
    kind: input.kind ?? "expense",
    amountMinor: input.amountMinor,
    currency: input.currency ?? "CNY",
    occurredLocalDate: input.date ?? "2026-10-01",
    categoryId: input.categoryId,
    categoryLabel: input.label ?? `分类-${input.categoryId}`,
    paymentMethodId: null,
    paymentMethodLabel: null,
  };
}

describe("buildHierarchy", () => {
  it("无分类层级（全部顶层）：不是真实层级，展示层必须降级", () => {
    const relations = [relation("food", null), relation("travel", null)];
    const records = [
      makeRecord({ id: "t1", categoryId: "food", amountMinor: 1_000n }),
      makeRecord({ id: "t2", categoryId: "travel", amountMinor: 500n }),
    ];

    const result = buildHierarchy(records, relations);

    expect(result.isRealHierarchy).toBe(false);
    expect(result.hasUnknownCategories).toBe(false);
    expect(result.orphanRelationCategoryIds).toEqual([]);
    expect(hierarchyIsUsable(result)).toBe(false);
    expect(result.nodes).toHaveLength(3);
    expect(result.totalAmountMinor).toBe(1_500n);
    expect(result.totalCount).toBe(2);
    expect(hierarchyIsConserved(result)).toBe(true);
    expect(result.conservation.edgesConserved).toBe(true);
  });

  it("多层分类：父级金额 = 直接金额 + 子级金额，且不重复计数", () => {
    const relations = [
      relation("dining", null, "餐饮"),
      relation("meal", "dining", "正餐"),
      relation("drink", "dining", "饮料"),
      relation("snack", "dining", "零食"),
    ];
    const records = [
      makeRecord({ id: "t1", categoryId: "meal", amountMinor: 300n }),
      makeRecord({ id: "t2", categoryId: "meal", amountMinor: 200n }),
      makeRecord({ id: "t3", categoryId: "drink", amountMinor: 50n }),
      makeRecord({ id: "t4", categoryId: "snack", amountMinor: 20n }),
      makeRecord({ id: "t5", categoryId: "dining", amountMinor: 30n }),
    ];

    const result = buildHierarchy(records, relations);

    expect(result.isRealHierarchy).toBe(true);
    expect(result.maxDepth).toBe(2);
    expect(result.totalAmountMinor).toBe(600n);
    expect(result.conservation.noDoubleCounting).toBe(true);
    expect(result.conservation.nodesConserved).toBe(true);
    expect(hierarchyIsConserved(result)).toBe(true);
    expect(hierarchyIsUsable(result)).toBe(true);

    expect(hierarchyNodeOf(result, "meal")?.subtreeAmountMinor).toBe(500n);
    expect(hierarchyNodeOf(result, "meal")?.directAmountMinor).toBe(500n);
    expect(hierarchyNodeOf(result, "dining")?.directAmountMinor).toBe(30n);
    expect(hierarchyNodeOf(result, "dining")?.subtreeAmountMinor).toBe(600n);
    expect(hierarchyNodeOf(result, "dining")?.childCount).toBe(3);
    expect(hierarchyNodeOf(result, HIERARCHY_ROOT_ID)?.subtreeAmountMinor).toBe(600n);
  });

  it("节点只有直接交易：叶子节点子树等于直接金额", () => {
    const result = buildHierarchy(
      [makeRecord({ id: "t1", categoryId: "food", amountMinor: 250n })],
      [relation("food", null)],
    );

    const node = hierarchyNodeOf(result, "food");
    expect(node?.isLeaf).toBe(true);
    expect(node?.childCount).toBe(0);
    expect(node?.directAmountMinor).toBe(250n);
    expect(node?.subtreeAmountMinor).toBe(250n);
  });

  it("节点既有直接交易又有子分类：直接金额单独可辨", () => {
    const relations = [relation("dining", null), relation("meal", "dining")];
    const result = buildHierarchy(
      [
        makeRecord({ id: "t1", categoryId: "dining", amountMinor: 30n }),
        makeRecord({ id: "t2", categoryId: "meal", amountMinor: 70n }),
      ],
      relations,
    );

    const dining = hierarchyNodeOf(result, "dining");
    expect(dining?.isLeaf).toBe(false);
    expect(dining?.directAmountMinor).toBe(30n);
    expect(dining?.subtreeAmountMinor).toBe(100n);
  });

  it("收入指标只统计收入记录（支出不混入）", () => {
    const relations = [relation("food", null), relation("salary", null)];
    const records = [
      makeRecord({ id: "t1", categoryId: "food", amountMinor: 100n, kind: "expense" }),
      makeRecord({ id: "t2", categoryId: "salary", amountMinor: 900n, kind: "income" }),
    ];

    const expense = buildHierarchy(records, relations);
    expect(expense.totalAmountMinor).toBe(100n);
    expect(hierarchyNodeOf(expense, "salary")).toBeUndefined();

    const income = buildHierarchy(records, relations, { metric: "income" });
    expect(income.totalAmountMinor).toBe(900n);
    expect(hierarchyNodeOf(income, "food")).toBeUndefined();
  });

  it("分类循环异常：显式抛错（不静默修正）", () => {
    const relations = [
      relation("a", "b"),
      relation("b", "c"),
      relation("c", "a"),
    ];

    expect(() => buildHierarchy([], relations)).toThrow(/cycle/);
  });

  it("自我父级与重复关系：显式抛错", () => {
    expect(() =>
      buildHierarchy([], [relation("a", "a")]),
    ).toThrow(/own parent/);

    expect(() =>
      buildHierarchy([], [relation("a", null), relation("a", null)]),
    ).toThrow(/duplicate category relation/);
  });

  it("历史孤立节点：未声明分类按顶层处理并显式标记，不得声称真实层级", () => {
    const relations = [relation("food", null)];
    const records = [
      makeRecord({ id: "t1", categoryId: "food", amountMinor: 100n }),
      makeRecord({ id: "t2", categoryId: "legacy", amountMinor: 200n }),
    ];

    const result = buildHierarchy(records, relations);

    expect(result.hasUnknownCategories).toBe(true);
    expect(result.isRealHierarchy).toBe(false);
    expect(hierarchyIsUsable(result)).toBe(false);
    expect(result.totalAmountMinor).toBe(300n);
    expect(hierarchyNodeOf(result, "legacy")?.hasMissingRelation).toBe(true);
    expect(hierarchyNodeOf(result, "legacy")?.parentId).toBe(HIERARCHY_ROOT_ID);
    expect(hierarchyIsConserved(result)).toBe(true);
  });

  it("孤立父引用：按顶层处理并登记，不得伪造父子关系", () => {
    const relations = [relation("a", null), relation("b", "ghost")];
    const records = [
      makeRecord({ id: "t1", categoryId: "a", amountMinor: 100n }),
      makeRecord({ id: "t2", categoryId: "b", amountMinor: 50n }),
    ];

    const result = buildHierarchy(records, relations);

    expect(result.orphanRelationCategoryIds).toEqual(["b"]);
    expect(result.isRealHierarchy).toBe(false);
    expect(hierarchyNodeOf(result, "b")?.parentId).toBe(HIERARCHY_ROOT_ID);
    expect(hierarchyNodeOf(result, "b")?.depth).toBe(1);
    expect(hierarchyIsConserved(result)).toBe(true);
  });

  it("空记录：no-transactions，根节点金额为 0，不给虚假层级", () => {
    const result = buildHierarchy([], [relation("a", null), relation("b", "a")]);

    expect(result.completeness).toBe("no-transactions");
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.nodeId).toBe(HIERARCHY_ROOT_ID);
    expect(result.totalAmountMinor).toBe(0n);
    expect(hierarchyIsUsable(result)).toBe(false);
    expect(hierarchyIsConserved(result)).toBe(true);
  });

  it("混合原币：显式拒绝（不得先加再说明）", () => {
    const relations = [relation("food", null)];
    const records = [
      makeRecord({ id: "t1", categoryId: "food", amountMinor: 100n, currency: "CNY" }),
      makeRecord({ id: "t2", categoryId: "food", amountMinor: 200n, currency: "USD" }),
    ];

    expect(() => buildHierarchy(records, relations)).toThrow(/mixed original currencies/);
  });

  it("负金额记录：显式拒绝（方向由 kind 表达）", () => {
    expect(() =>
      buildHierarchy(
        [makeRecord({ id: "t1", categoryId: "food", amountMinor: -5n })],
        [relation("food", null)],
      ),
    ).toThrow(/non-negative/);
  });
});

describe("buildHierarchySankey", () => {
  const relations = [
    relation("dining", null, "餐饮"),
    relation("meal", "dining", "正餐"),
    relation("drink", "dining", "饮料"),
    relation("snack", "dining", "零食"),
  ];
  const records = [
    makeRecord({ id: "t1", categoryId: "meal", amountMinor: 300n }),
    makeRecord({ id: "t2", categoryId: "meal", amountMinor: 200n }),
    makeRecord({ id: "t3", categoryId: "drink", amountMinor: 50n }),
    makeRecord({ id: "t4", categoryId: "snack", amountMinor: 20n }),
    makeRecord({ id: "t5", categoryId: "dining", amountMinor: 30n }),
  ];

  it("真实层级：根→大类→子类，直接金额有终端节点，流入流出守恒", () => {
    const hierarchy = buildHierarchy(records, relations);
    const sankey = buildHierarchySankey(hierarchy);

    expect(sankey.isRealHierarchy).toBe(true);
    expect(sankey.totalMinor).toBe(600n);
    expect(sankeyIsConserved(sankey)).toBe(true);

    const rootLink = sankey.links.find((link) => link.fromId === HIERARCHY_ROOT_ID);
    expect(rootLink?.toId).toBe("dining");
    expect(rootLink?.amountMinor).toBe(600n);

    const toMeal = sankey.links.find(
      (link) => link.fromId === "dining" && link.toId === "meal",
    );
    expect(toMeal?.amountMinor).toBe(500n);
    expect(toMeal?.shareOfSource).toEqual({ numerator: 5n, denominator: 6n });

    const directLink = sankey.links.find((link) => link.toId === "dining::direct");
    expect(directLink?.amountMinor).toBe(30n);

    const diningNode = sankey.nodes.find((node) => node.nodeId === "dining");
    expect(diningNode?.inflowMinor).toBe(600n);
    expect(diningNode?.outflowMinor).toBe(600n);
    expect(diningNode?.isTerminal).toBe(false);

    const mealNode = sankey.nodes.find((node) => node.nodeId === "meal");
    expect(mealNode?.inflowMinor).toBe(500n);
    expect(mealNode?.outflowMinor).toBe(0n);
    expect(mealNode?.isTerminal).toBe(true);
  });

  it("无真实层级：结构可算但 isRealHierarchy=false，展示层不得启用", () => {
    const hierarchy = buildHierarchy(
      [
        makeRecord({ id: "t1", categoryId: "food", amountMinor: 100n }),
        makeRecord({ id: "t2", categoryId: "travel", amountMinor: 50n }),
      ],
      [relation("food", null), relation("travel", null)],
    );
    const sankey = buildHierarchySankey(hierarchy);

    expect(sankey.isRealHierarchy).toBe(false);
    expect(sankey.links.filter((link) => link.fromId === HIERARCHY_ROOT_ID)).toHaveLength(2);
    expect(sankeyIsConserved(sankey)).toBe(true);
  });

  it("空层级：无节点无连线，守恒自检全部通过", () => {
    const sankey = buildHierarchySankey(buildHierarchy([], []));

    expect(sankey.nodes).toHaveLength(0);
    expect(sankey.links).toHaveLength(0);
    expect(sankey.totalMinor).toBe(0n);
    expect(sankeyIsConserved(sankey)).toBe(true);
  });
});
