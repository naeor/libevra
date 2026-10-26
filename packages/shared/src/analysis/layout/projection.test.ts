import { describe, expect, it } from "vitest";

import {
  projectLayout,
  projectionToGeometry,
} from "./projection.js";
import type {
  AnalysisCardNode,
  CarouselNode,
  GridSplitNode,
  LayoutGeometry,
  ObjectGeometry,
  ObjectSizeContract,
  WorkbenchContentDocumentV1,
} from "./types.js";

/**
 * 投影/迁移用例直接来自所有者规格 §6 的示例与布局格式模板规格 §19 的
 * 夹具（TC-02/03/05/06/17/26 等）。未决口径（OQ-LM-01 等）用注释标明
 * 当前采用哪个候选，避免把临时口径误当已确认。
 */

function card(objectId: string): AnalysisCardNode {
  return {
    objectId,
    type: "analysis-card",
    analysis: { analysisId: "an-b01", params: {} },
    chart: { chartFamily: "cf-01" },
    rangePolicy: "inherit",
  };
}

function gridSplit(objectId: string, children: readonly string[] = []): GridSplitNode {
  return {
    objectId,
    type: "grid-split",
    children,
    split: { columnSplitPermille: 500, rowSplitPermille: 0 },
  };
}

function carousel(objectId: string, children: readonly string[] = []): CarouselNode {
  return { objectId, type: "carousel", children };
}

function contentOf(cards: readonly string[], containers: readonly (GridSplitNode | CarouselNode)[] = []): WorkbenchContentDocumentV1 {
  return {
    schemaVersion: 1,
    cards: cards.map(card),
    containers,
  };
}

function object(
  objectId: string,
  objectType: ObjectGeometry["objectType"],
  anchor: number,
  colSpan: number,
  rowSpan: number,
  extra: Pick<ObjectGeometry, "presentation" | "expandedSize"> = {},
): ObjectGeometry {
  return { objectId, objectType, anchor, colSpan, rowSpan, ...extra };
}

function geometryOf(baseCols: number, objects: readonly ObjectGeometry[]): LayoutGeometry {
  return { baseCols, objects };
}

function contract(objectId: string, partial: Partial<ObjectSizeContract> = {}): ObjectSizeContract {
  return {
    objectId,
    minSize: { colSpan: 1, rowSpan: 1 },
    sizeLadder: [],
    ...partial,
  };
}

function contractsOf(...list: readonly ObjectSizeContract[]): Readonly<Record<string, ObjectSizeContract>> {
  return Object.fromEntries(list.map((item) => [item.objectId, item]));
}

function anchorsOf(result: ReturnType<typeof projectLayout>): Readonly<Record<string, number>> {
  return Object.fromEntries(result.objects.map((item) => [item.objectId, item.anchor]));
}

describe("projectLayout：所有者示例（3→4、4→3、3→6）", () => {
  // 所有者规格 §6 示例：3 列 A@1(2×2) B@3 C@6 → 4 列时 C 回填 4。
  const threeColumns = geometryOf(3, [
    object("A", "analysis-card", 1, 2, 2),
    object("B", "analysis-card", 3, 1, 1),
    object("C", "analysis-card", 6, 1, 1),
  ]);
  const content = contentOf(["A", "B", "C"]);

  it("3→4 列：靠前对象保位，C 回填到 4", () => {
    const result = projectLayout(threeColumns, content, { targetColumns: 4 });
    expect(anchorsOf(result)).toEqual({ A: 1, B: 3, C: 4 });
    expect(result.columns).toBe(4);
    expect(result.issues).toEqual([]);
  });

  it("3→6 列：全部保位（不因新增列而漂移）", () => {
    const result = projectLayout(threeColumns, content, { targetColumns: 6 });
    expect(anchorsOf(result)).toEqual({ A: 1, B: 3, C: 6 });
  });

  it("4→3 列：C@4 被占后顺延到 6", () => {
    const fourColumns = geometryOf(4, [
      object("A", "analysis-card", 1, 2, 2),
      object("B", "analysis-card", 3, 1, 1),
      object("C", "analysis-card", 4, 1, 1),
    ]);
    const result = projectLayout(fourColumns, content, { targetColumns: 3 });
    expect(anchorsOf(result)).toEqual({ A: 1, B: 3, C: 6 });
  });
});

describe("projectLayout：优先级与损坏数据（TC-06）", () => {
  it("同锚点按 (行, 列, objectId) 单遍贪心，先到者占位", () => {
    const layout = geometryOf(3, [
      object("c", "analysis-card", 2, 1, 1),
      object("b", "analysis-card", 1, 1, 1),
      object("a", "analysis-card", 1, 1, 1),
    ]);
    const result = projectLayout(layout, contentOf(["a", "b", "c"]), { targetColumns: 3 });
    expect(anchorsOf(result)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("对象数组顺序不影响结果（确定性）", () => {
    const objects = [
      object("A", "analysis-card", 1, 2, 2),
      object("B", "analysis-card", 3, 1, 1),
      object("C", "analysis-card", 4, 1, 1),
    ];
    const content = contentOf(["A", "B", "C"]);
    const forward = projectLayout(geometryOf(4, objects), content, { targetColumns: 3 });
    const reversed = projectLayout(geometryOf(4, [...objects].reverse()), content, { targetColumns: 3 });
    expect(reversed).toEqual(forward);
  });

  it("孤儿对象（内容文档中不存在）被忽略并记录", () => {
    const layout = geometryOf(2, [
      object("A", "analysis-card", 1, 1, 1),
      object("ghost", "analysis-card", 2, 1, 1),
    ]);
    const result = projectLayout(layout, contentOf(["A"]), { targetColumns: 2 });
    expect(anchorsOf(result)).toEqual({ A: 1 });
    expect(result.issues.some((issue) => issue.reason === "orphan-dropped")).toBe(true);
  });

  it("锚点缺失的对象排最后按 objectId 补位", () => {
    const layout = geometryOf(2, [
      object("b", "analysis-card", 0, 1, 1),
      object("a", "analysis-card", 1, 1, 1),
    ]);
    const result = projectLayout(layout, contentOf(["a", "b"]), { targetColumns: 2 });
    expect(anchorsOf(result)).toEqual({ a: 1, b: 2 });
    expect(result.objects.find((item) => item.objectId === "b")?.degradedReasons).toContain("source-invalid");
  });
});

describe("projectLayout：宽度降级（4→2，OQ-LM-01 暂用 S）", () => {
  it("3×1 卡片在 2 列下按 sizeLadder 降到 2×1，不丢弃", () => {
    const layout = geometryOf(4, [object("W", "analysis-card", 1, 3, 1)]);
    const contracts = contractsOf(contract("W", { sizeLadder: [{ colSpan: 2, rowSpan: 1 }] }));
    const result = projectLayout(layout, contentOf(["W"]), { targetColumns: 2, contracts });
    const placed = result.objects[0];
    expect(placed).toMatchObject({ anchor: 1, colSpan: 2, rowSpan: 1, form: "compact" });
    expect(placed?.degradedReasons).toContain("width-overflow");
  });

  it("无尺寸契约的卡片退到 1×1 兼容入口并记录 missing-contract", () => {
    const layout = geometryOf(3, [object("W", "analysis-card", 1, 3, 1)]);
    const result = projectLayout(layout, contentOf(["W"]), { targetColumns: 2 });
    expect(result.objects[0]).toMatchObject({ anchor: 1, colSpan: 1, rowSpan: 1, form: "compat" });
    expect(result.objects[0]?.degradedReasons).toContain("missing-contract");
  });
});

describe("projectLayout：容器收缩（1×1 保底）", () => {
  it("目标列数小于 minFullCols 时收缩为 1×1 入口", () => {
    const layout = geometryOf(4, [object("CT", "grid-split", 1, 2, 2)]);
    const contracts = contractsOf(
      contract("CT", {
        minFullCols: 2,
        collapsedSize: { colSpan: 1, rowSpan: 1 },
        sizeLadder: [],
      }),
    );
    const result = projectLayout(layout, contentOf([], [gridSplit("CT", ["A", "B"])]), {
      targetColumns: 1,
      contracts,
    });
    expect(result.objects[0]).toMatchObject({ anchor: 1, colSpan: 1, rowSpan: 1, form: "collapsed" });
    expect(result.objects[0]?.degradedReasons).toContain("container-narrow");
  });

  it("用户主动收缩（presentation=collapsed）优先于自动规则，且保留 expandedSize 语义", () => {
    const layout = geometryOf(4, [
      object("CT", "carousel", 1, 2, 2, {
        presentation: "collapsed",
        expandedSize: { colSpan: 2, rowSpan: 2 },
      }),
    ]);
    const contracts = contractsOf(
      contract("CT", { minFullCols: 2, collapsedSize: { colSpan: 1, rowSpan: 1 } }),
    );
    const result = projectLayout(layout, contentOf([], [carousel("CT", ["A", "B"])]), {
      targetColumns: 4,
      contracts,
    });
    expect(result.objects[0]).toMatchObject({ form: "collapsed", colSpan: 1, rowSpan: 1 });
    expect(result.objects[0]?.degradedReasons).toContain("user-collapsed");
  });
});

describe("projectLayout：Spacer（OQ-LM-04 暂用夹宽）", () => {
  it("Spacer 超宽时夹到目标列数并保留高度", () => {
    const layout = geometryOf(3, [object("S1", "spacer", 1, 3, 1)]);
    const result = projectLayout(layout, contentOf([]), { targetColumns: 2 });
    expect(result.objects[0]).toMatchObject({ anchor: 1, colSpan: 2, rowSpan: 1, form: "full" });
    expect(result.objects[0]?.degradedReasons).toContain("width-overflow");
  });
});

describe("projectLayout：策略对照（OQ-LM-01 的 S 与 P 候选）", () => {
  // 目标 4 列：b@4 宽 2 在锚点处越界，但 1×1 在锚点合法。
  // size-first（S，默认）保住原尺寸、换位置 → b@3(2×1)；
  // position-first（P 候选）保住锚点、降尺寸 → b@4(1×1)。
  const layout = geometryOf(4, [
    object("a", "analysis-card", 1, 2, 1),
    object("b", "analysis-card", 4, 2, 1),
  ]);
  const content = contentOf(["a", "b"]);
  const contracts = contractsOf(
    contract("a"),
    contract("b", { sizeLadder: [{ colSpan: 1, rowSpan: 1 }] }),
  );

  it("size-first 保尺寸换位置", () => {
    const result = projectLayout(layout, content, { targetColumns: 4, contracts, strategy: "size-first" });
    expect(result.objects.find((item) => item.objectId === "b")).toMatchObject({
      anchor: 3,
      colSpan: 2,
      form: "full",
    });
  });

  it("position-first 保位置降尺寸", () => {
    const result = projectLayout(layout, content, { targetColumns: 4, contracts, strategy: "position-first" });
    expect(result.objects.find((item) => item.objectId === "b")).toMatchObject({
      anchor: 4,
      colSpan: 1,
      form: "compact",
    });
  });
});

describe("projectLayout：确定性与无累计漂移（TC-17/TC-26）", () => {
  const layout = geometryOf(3, [
    object("A", "analysis-card", 1, 2, 2),
    object("B", "analysis-card", 3, 1, 1),
    object("C", "analysis-card", 6, 1, 1),
    object("S1", "spacer", 5, 1, 1),
  ]);
  const content = contentOf(["A", "B", "C"]);

  it("同一输入多次投影结果逐字节相同", () => {
    const first = projectLayout(layout, content, { targetColumns: 4 });
    const second = projectLayout(layout, content, { targetColumns: 4 });
    expect(second).toEqual(first);
  });

  it("同列数二次投影幂等（投影结果不写回权威布局，但重复投影不漂移）", () => {
    const first = projectLayout(layout, content, { targetColumns: 4 });
    const replay = projectLayout(projectionToGeometry(first), content, { targetColumns: 4 });
    const geometryOfResult = (result: typeof first): readonly unknown[] =>
      result.objects.map((item) => ({
        objectId: item.objectId,
        anchor: item.anchor,
        colSpan: item.colSpan,
        rowSpan: item.rowSpan,
      }));
    expect(geometryOfResult(replay)).toEqual(geometryOfResult(first));
  });
});
