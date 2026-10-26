/**
 * D-3 跨列数确定性迁移：固定案例矩阵 + 不丢对象/内容不变/多跳无漂移。
 *
 * 口径来自所有者规格 §4–§7 与布局规格 §12–§15；OQ-LM-01 已由 Lead 锁定
 * size-first（本文件只测默认策略，P 对照在 fixtures.test.ts）。
 */

import { describe, expect, it } from "vitest";
import { validateGeometry } from "./grid.js";
import { projectLayout, projectionToGeometry } from "./projection.js";
import {
  analysisCard,
  anchorsOf,
  carousel,
  contentOf,
  contract,
  contractsOf,
  geometry,
  gridSplit,
  object,
  projectedOf,
  reasonsOf,
  spacer,
} from "./test-support.js";
import type { LayoutGeometry, ProjectedObject, ProjectionResult } from "./types.js";

function projectedGeometry(objects: readonly ProjectedObject[]): readonly {
  objectId: string;
  objectType: ProjectedObject["objectType"];
  anchor: number;
  colSpan: number;
  rowSpan: number;
}[] {
  return objects.map((object) => ({
    objectId: object.objectId,
    objectType: object.objectType,
    anchor: object.anchor,
    colSpan: object.colSpan,
    rowSpan: object.rowSpan,
  }));
}

function expectValidAndComplete(result: ProjectionResult, expectedCount: number): void {
  expect(result.objects).toHaveLength(expectedCount);
  expect(validateGeometry(projectedGeometry(result.objects), result.columns)).toEqual([]);
}

const CONTENT_ABC = contentOf([analysisCard("a"), analysisCard("b"), analysisCard("c")]);
const CONTENT_ABCD = contentOf([
  analysisCard("a"),
  analysisCard("b"),
  analysisCard("c"),
  analysisCard("d"),
]);

describe("所有者示例：3→4 与 4→3", () => {
  const layout3 = geometry(3, [
    object("a", "analysis-card", 1, 2, 2),
    object("b", "analysis-card", 3, 1, 1),
    object("c", "analysis-card", 6, 1, 1),
  ]);

  it("3→4：C 回填到锚点 4，A/B 保持", () => {
    const result = projectLayout(layout3, CONTENT_ABC, { targetColumns: 4 });
    expect(anchorsOf(result)).toEqual({ a: 1, b: 3, c: 4 });
    expectValidAndComplete(result, 3);
  });

  it("4→3：C 回到锚点 6，A/B 保持", () => {
    const layout4 = geometry(4, [
      object("a", "analysis-card", 1, 2, 2),
      object("b", "analysis-card", 3, 1, 1),
      object("c", "analysis-card", 4, 1, 1),
    ]);
    const result = projectLayout(layout4, CONTENT_ABC, { targetColumns: 3 });
    expect(anchorsOf(result)).toEqual({ a: 1, b: 3, c: 6 });
    expectValidAndComplete(result, 3);
  });
});

describe("列数矩阵：1–6 基准列 × 1–12 目标列均不丢对象且几何合法", () => {
  const baseColumns = [1, 2, 3, 4, 5, 6] as const;
  const targetColumns = [1, 2, 3, 4, 5, 6, 8, 10, 12] as const;

  it.each(baseColumns)("baseCols=%i 时对所有目标列数保持 4 个对象", (baseCols) => {
    const layout = geometry(baseCols, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 2, 1, 1),
      object("c", "analysis-card", 3, 1, 1),
      object("d", "analysis-card", 4, 1, 1),
    ]);
    for (const target of targetColumns) {
      const result = projectLayout(layout, CONTENT_ABCD, { targetColumns: target });
      expectValidAndComplete(result, 4);
      expect(result.columns).toBe(target);
      const ids = result.objects.map((projected) => projected.objectId).sort();
      expect(ids).toEqual(["a", "b", "c", "d"]);
    }
  });
});

describe("容器整体迁移（GridSplit / Carousel）", () => {
  const content = contentOf(
    [analysisCard("c1"), analysisCard("c2")],
    [gridSplit("g", ["c1", "c2"]), carousel("q", ["c1", "c2"])],
  );
  const contracts = contractsOf(
    contract("g", { minFullCols: 2, collapsedSize: { colSpan: 1, rowSpan: 1 } }),
    contract("q", { minFullCols: 2, collapsedSize: { colSpan: 1, rowSpan: 1 } }),
  );

  it("宽布局保持完整形态，列数不足时收缩为 1×1 且内容文档不变", () => {
    const layout = geometry(4, [
      object("g", "grid-split", 1, 2, 2),
      object("q", "carousel", 3, 2, 1),
    ]);
    const before = JSON.stringify(content);

    const wide = projectLayout(layout, content, { targetColumns: 3, contracts });
    expect(projectedOf(wide, "g").form).toBe("full");
    expect(projectedOf(wide, "g").colSpan).toBe(2);
    expect(projectedOf(wide, "q").form).toBe("full");

    const narrow = projectLayout(layout, content, { targetColumns: 1, contracts });
    expect(projectedOf(narrow, "g").form).toBe("collapsed");
    expect(projectedOf(narrow, "g").colSpan).toBe(1);
    expect(projectedOf(narrow, "g").rowSpan).toBe(1);
    expect(reasonsOf(narrow, "g")).toContain("container-narrow");
    expect(projectedOf(narrow, "q").form).toBe("collapsed");
    expect(reasonsOf(narrow, "q")).toContain("container-narrow");
    expectValidAndComplete(narrow, 2);

    expect(JSON.stringify(content)).toBe(before);
  });

  it("用户主动收缩优先于列数足够（presentation=collapsed）", () => {
    const layout = geometry(4, [
      object("g", "grid-split", 1, 2, 2, { presentation: "collapsed", expandedSize: { colSpan: 2, rowSpan: 2 } }),
    ]);
    const result = projectLayout(layout, content, { targetColumns: 4, contracts });
    expect(projectedOf(result, "g").form).toBe("collapsed");
    expect(projectedOf(result, "g").colSpan).toBe(1);
    expect(reasonsOf(result, "g")).toContain("user-collapsed");
  });
});

describe("Spacer 参与迁移：存在性保留、按目标列数夹宽", () => {
  const content = contentOf([analysisCard("a"), analysisCard("b")]);
  const layout = geometry(3, [
    object("a", "analysis-card", 1, 1, 1),
    object("s", "spacer", 2, 1, 1),
    object("b", "analysis-card", 3, 1, 1),
  ]);

  it("3→2 三个对象都在且几何合法", () => {
    const result = projectLayout(layout, content, { targetColumns: 2 });
    expect(result.objects.map((projected) => projected.objectId).sort()).toEqual(["a", "b", "s"]);
    expect(projectedOf(result, "s").anchor).toBe(2);
    expectValidAndComplete(result, 3);
  });

  it("1 列时 Spacer 仍存在（不被自动删除）", () => {
    const result = projectLayout(layout, content, { targetColumns: 1 });
    expect(projectedOf(result, "s").anchor).toBe(2);
    expectValidAndComplete(result, 3);
  });

  it("Spacer 超宽时夹到目标列数并记录 width-overflow", () => {
    const wideSpacer = geometry(3, [object("s", "spacer", 1, 3, 1)]);
    const result = projectLayout(wideSpacer, contentOf([]), { targetColumns: 2 });
    expect(projectedOf(result, "s").colSpan).toBe(2);
    expect(reasonsOf(result, "s")).toContain("width-overflow");
  });
});

describe("多跳转换无累计漂移：每次从权威布局重推", () => {
  it("3→4→2→3 与直接 3 列投影一致，且权威布局字节不变", () => {
    const layout3: LayoutGeometry = geometry(3, [
      object("a", "analysis-card", 1, 2, 2),
      object("b", "analysis-card", 3, 1, 1),
      object("c", "analysis-card", 6, 1, 1),
      object("s", "spacer", 7, 1, 1),
    ]);
    const before = JSON.stringify(layout3);
    const direct = projectLayout(layout3, CONTENT_ABC, { targetColumns: 3 });

    let current: LayoutGeometry = layout3;
    for (const target of [4, 2, 3]) {
      const projected = projectLayout(current, CONTENT_ABC, { targetColumns: target });
      current = projectionToGeometry(projected);
    }

    expect(anchorsOf(projectLayout(current, CONTENT_ABC, { targetColumns: 3 }))).toEqual(
      anchorsOf(direct),
    );
    expect(JSON.stringify(layout3)).toBe(before);
  });
});

describe("冲突与非法跨度的确定性修复（投影层）", () => {
  it("同锚点按 (行, 列, objectId) 优先级贪心，后到者顺延并记录 anchor-occupied", () => {
    const layout = geometry(3, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 1, 1, 1),
      object("c", "analysis-card", 2, 1, 1),
    ]);
    const result = projectLayout(layout, CONTENT_ABC, { targetColumns: 3 });
    expect(anchorsOf(result)).toEqual({ a: 1, b: 2, c: 3 });
    expect(reasonsOf(result, "a")).not.toContain("anchor-occupied");
    expect(reasonsOf(result, "b")).toContain("anchor-occupied");
  });

  it("锚点越界/非法跨度：确定性夹取并给出失败码", () => {
    const layout = geometry(3, [object("d", "analysis-card", 0, 0, 99)]);
    const result = projectLayout(layout, contentOf([analysisCard("d")]), { targetColumns: 3 });
    const projected = projectedOf(result, "d");
    expect(projected.sourceAnchor).toBeNull();
    expect({ colSpan: projected.colSpan, rowSpan: projected.rowSpan }).toEqual({ colSpan: 1, rowSpan: 8 });
    expect(projected.degradedReasons).toContain("source-invalid");
    expect(projected.degradedReasons).toContain("size-clamped");
    expectValidAndComplete(result, 1);
  });

  it("同一输入多次投影输出逐字节相同（确定性）", () => {
    const layout = geometry(2, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 1, 2, 1),
    ]);
    const first = projectLayout(layout, CONTENT_ABC, { targetColumns: 2 });
    const second = projectLayout(layout, CONTENT_ABC, { targetColumns: 2 });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("内容/布局分离：投影不修改内容文档与布局对象", () => {
  it("投影前后内容文档、布局文档、对象数组均不变", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b")], [gridSplit("g", ["a", "b"])]);
    const layout = geometry(3, [
      object("a", "analysis-card", 1, 1, 1),
      object("g", "grid-split", 2, 2, 1),
      object("b", "analysis-card", 4, 1, 1),
    ]);
    const contentBefore = JSON.stringify(content);
    const layoutBefore = JSON.stringify(layout);
    const objectsBefore = layout.objects.map((item) => ({ ...item }));

    projectLayout(layout, content, { targetColumns: 2, contracts: contractsOf(contract("g")) });

    expect(JSON.stringify(content)).toBe(contentBefore);
    expect(JSON.stringify(layout)).toBe(layoutBefore);
    expect(layout.objects).toEqual(objectsBefore);
  });
});
