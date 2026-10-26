/**
 * C-3 几何测试（web 侧草案）：旭日弧 / 矩形树 / 桑基布局。
 *
 * 几何只接收归一化 number；测试断言「位置与面积的比例关系」，不涉及金额权威。
 */

import { describe, expect, it } from "vitest";

import {
  computeSankeyLayout,
  computeSunburstArcs,
  computeTreemapBoxes,
  type SankeyLayoutLinkInput,
  type SankeyLayoutNodeInput,
  type SunburstArcNode,
} from "./geometry4.js";

describe("旭日图 computeSunburstArcs", () => {
  const nodes: SunburstArcNode[] = [
    { nodeId: "root", parentId: null, depth: 0, fractionOfParent: null },
    { nodeId: "a", parentId: "root", depth: 1, fractionOfParent: 0.6 },
    { nodeId: "b", parentId: "root", depth: 1, fractionOfParent: 0.4 },
    { nodeId: "a1", parentId: "a", depth: 2, fractionOfParent: 1 },
  ];

  it("子扇区跨度 = 父跨度 × 份额，且同一环合计 360°", () => {
    const arcs = computeSunburstArcs(nodes, { width: 200, height: 200 });

    const root = arcs.find((arc) => arc.nodeId === "root");
    expect(root?.startAngle).toBe(0);
    expect(root?.endAngle).toBeCloseTo(360, 6);

    const a = arcs.find((arc) => arc.nodeId === "a");
    const b = arcs.find((arc) => arc.nodeId === "b");
    expect(a?.startAngle).toBeCloseTo(0, 6);
    expect(a?.endAngle).toBeCloseTo(216, 6);
    expect(b?.startAngle).toBeCloseTo(216, 6);
    expect(b?.endAngle).toBeCloseTo(360, 6);

    const a1 = arcs.find((arc) => arc.nodeId === "a1");
    expect(a1?.startAngle).toBeCloseTo(0, 6);
    expect(a1?.endAngle).toBeCloseTo(216, 6);

    const ringSpans = new Map<number, number>();
    for (const arc of arcs) {
      ringSpans.set(arc.ringIndex, (ringSpans.get(arc.ringIndex) ?? 0) + (arc.endAngle - arc.startAngle));
    }
    expect(ringSpans.get(1)).toBeCloseTo(360, 6);
  });

  it("环半径逐层增大，外环不超过外半径", () => {
    const arcs = computeSunburstArcs(nodes, { width: 200, height: 200 });

    const root = arcs.find((arc) => arc.nodeId === "root");
    const a = arcs.find((arc) => arc.nodeId === "a");
    const a1 = arcs.find((arc) => arc.nodeId === "a1");

    expect(root?.innerRadius).toBeGreaterThan(0);
    expect(a?.innerRadius).toBeCloseTo(root?.outerRadius ?? 0, 6);
    expect(a1?.innerRadius).toBeCloseTo(a?.outerRadius ?? 0, 6);
    expect(Math.max(...arcs.map((arc) => arc.outerRadius))).toBeCloseTo(100, 6);
  });

  it("兄弟按份额降序排列（大份额在角度顺序前面）", () => {
    const arcs = computeSunburstArcs(nodes, { width: 200, height: 200 });

    const order = arcs
      .filter((arc) => arc.ringIndex === 1)
      .map((arc) => arc.nodeId);
    expect(order).toEqual(["a", "b"]);
  });

  it("gapFraction 收缩每条弧但不改变相邻关系", () => {
    const arcs = computeSunburstArcs(nodes, { width: 200, height: 200, gapFraction: 0.1 });

    const a = arcs.find((arc) => arc.nodeId === "a");
    expect(a?.startAngle).toBeCloseTo(216 * 0.05, 6);
    expect(a?.endAngle).toBeCloseTo(216 - 216 * 0.05, 6);
  });

  it("空输入返回空数组，尺寸非法抛 RangeError", () => {
    expect(computeSunburstArcs([], { width: 200, height: 200 })).toEqual([]);
    expect(() => computeSunburstArcs(nodes, { width: 0, height: 200 })).toThrow(RangeError);
  });
});

describe("矩形树图 computeTreemapBoxes", () => {
  it("面积与份额成比例且全部落在画布内", () => {
    const items = [
      { nodeId: "a", fractionOfTotal: 0.5 },
      { nodeId: "b", fractionOfTotal: 0.3 },
      { nodeId: "c", fractionOfTotal: 0.2 },
    ];
    const boxes = computeTreemapBoxes(items, { width: 400, height: 300 });
    const totalArea = 400 * 300;

    expect(boxes).toHaveLength(3);
    for (const entry of boxes) {
      expect(entry.box.x).toBeGreaterThanOrEqual(0);
      expect(entry.box.y).toBeGreaterThanOrEqual(0);
      expect(entry.box.x + entry.box.width).toBeLessThanOrEqual(400 + 1e-6);
      expect(entry.box.y + entry.box.height).toBeLessThanOrEqual(300 + 1e-6);
    }

    const areaOf = (nodeId: string): number => {
      const box = boxes.find((entry) => entry.nodeId === nodeId)?.box;
      return box === undefined ? 0 : box.width * box.height;
    };
    expect(areaOf("a") / totalArea).toBeCloseTo(0.5, 2);
    expect(areaOf("b") / totalArea).toBeCloseTo(0.3, 2);
    expect(areaOf("c") / totalArea).toBeCloseTo(0.2, 2);
    expect(areaOf("a") + areaOf("b") + areaOf("c")).toBeCloseTo(totalArea, 0);
  });

  it("同输入顺序不同也输出稳定布局（份额降序 + id 升序）", () => {
    const first = computeTreemapBoxes(
      [
        { nodeId: "a", fractionOfTotal: 0.5 },
        { nodeId: "b", fractionOfTotal: 0.5 },
      ],
      { width: 400, height: 300 },
    );
    const second = computeTreemapBoxes(
      [
        { nodeId: "b", fractionOfTotal: 0.5 },
        { nodeId: "a", fractionOfTotal: 0.5 },
      ],
      { width: 400, height: 300 },
    );

    expect(first).toEqual(second);
  });

  it("gap 让每个矩形向内收缩且仍落在画布内", () => {
    const boxes = computeTreemapBoxes(
      [
        { nodeId: "a", fractionOfTotal: 0.6 },
        { nodeId: "b", fractionOfTotal: 0.4 },
      ],
      { width: 400, height: 300, gap: 8 },
    );

    for (const entry of boxes) {
      expect(entry.box.x).toBeGreaterThanOrEqual(4);
      expect(entry.box.y).toBeGreaterThanOrEqual(4);
      expect(entry.box.width).toBeLessThan(400);
      expect(entry.box.height).toBeLessThan(300);
    }
  });

  it("非正份额被忽略；全空或无正份额时返回空数组", () => {
    const boxes = computeTreemapBoxes(
      [
        { nodeId: "a", fractionOfTotal: 0 },
        { nodeId: "b", fractionOfTotal: -1 },
      ],
      { width: 400, height: 300 },
    );

    expect(boxes).toEqual([]);
  });
});

describe("层级桑基 computeSankeyLayout", () => {
  const nodes: SankeyLayoutNodeInput[] = [
    { nodeId: "root", depth: 0, valueFraction: 1 },
    { nodeId: "a", depth: 1, valueFraction: 0.6 },
    { nodeId: "b", depth: 1, valueFraction: 0.4 },
    { nodeId: "a1", depth: 2, valueFraction: 0.6 },
  ];
  const links: SankeyLayoutLinkInput[] = [
    { fromId: "root", toId: "a", fractionOfTotal: 0.6 },
    { fromId: "root", toId: "b", fractionOfTotal: 0.4 },
    { fromId: "a", toId: "a1", fractionOfTotal: 0.6 },
  ];

  it("节点高度与份额成比例，列 x 单调增大", () => {
    const layout = computeSankeyLayout(nodes, links, { width: 600, height: 100, rowGap: 0 });

    expect(layout.columnX).toHaveLength(3);
    expect(layout.columnX[0]).toBe(0);
    expect(layout.columnX[1]).toBeGreaterThan(layout.columnX[0] ?? 0);
    expect(layout.columnX[2]).toBeGreaterThan(layout.columnX[1] ?? 0);

    const boxOf = (nodeId: string) => layout.nodes.find((entry) => entry.nodeId === nodeId)?.box;
    expect(boxOf("root")?.height).toBeCloseTo(100, 6);
    expect(boxOf("a")?.height).toBeCloseTo(60, 6);
    expect(boxOf("b")?.height).toBeCloseTo(40, 6);
    expect(boxOf("a1")?.height).toBeCloseTo(60, 6);
    expect(boxOf("b")?.y).toBeCloseTo(60, 6);
  });

  it("同一节点的流出/流入厚度之和等于节点高度（守恒的可视化条件）", () => {
    const layout = computeSankeyLayout(nodes, links, { width: 600, height: 100, rowGap: 0 });

    const outflowRoot = layout.links
      .filter((link) => link.fromId === "root")
      .reduce((sum, link) => sum + link.thickness, 0);
    const outflowA = layout.links
      .filter((link) => link.fromId === "a")
      .reduce((sum, link) => sum + link.thickness, 0);

    expect(outflowRoot).toBeCloseTo(100, 6);
    expect(outflowA).toBeCloseTo(60, 6);
    expect(outflowA).toBeCloseTo(
      layout.nodes.find((entry) => entry.nodeId === "a")?.box.height ?? 0,
      6,
    );
  });

  it("连线端点跨列：源在左节点右缘、目标在右节点左缘", () => {
    const layout = computeSankeyLayout(nodes, links, { width: 600, height: 100, rowGap: 0 });
    const rootBox = layout.nodes.find((entry) => entry.nodeId === "root")?.box;
    const aBox = layout.nodes.find((entry) => entry.nodeId === "a")?.box;
    const link = layout.links.find((entry) => entry.toId === "a");

    expect(link?.sourceX).toBeCloseTo((rootBox?.x ?? 0) + (rootBox?.width ?? 0), 6);
    expect(link?.targetX).toBeCloseTo(aBox?.x ?? 0, 6);
  });

  it("未知节点连线被跳过；空节点返回空布局", () => {
    const layout = computeSankeyLayout(nodes, [
      { fromId: "missing", toId: "a", fractionOfTotal: 0.1 },
    ], { width: 600, height: 100 });
    expect(layout.links).toEqual([]);

    expect(computeSankeyLayout([], [], { width: 600, height: 100 })).toEqual({
      nodes: [],
      links: [],
      nodeWidth: 0,
      columnX: [],
      columnScale: [],
    });
  });

  it("rowGap 缩小可用高度时同列节点仍不重叠", () => {
    const layout = computeSankeyLayout(nodes, links, { width: 600, height: 100, rowGap: 10 });
    const columnNodes = layout.nodes.filter((entry) => entry.depth === 1);
    const sorted = [...columnNodes].sort(
      (left, right) => left.box.y - right.box.y,
    );
    const first = sorted[0];
    const second = sorted[1];
    expect(first && second).toBeTruthy();
    if (first === undefined || second === undefined) return;
    expect(second.box.y).toBeGreaterThanOrEqual(first.box.y + first.box.height + 10 - 1e-6);
  });
});
