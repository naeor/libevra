import { describe, expect, it } from "vitest";

import {
  computeBubbleLayout,
  computeBumpLines,
  computeHeatmapCells,
  computeScatterLayout,
  computeStackedBarBoxes,
} from "./geometry.js";

describe("computeHeatmapCells（矩阵热力）", () => {
  it("按行列均分画布，gapRatio=0 时单元格贴边", () => {
    const rows = computeHeatmapCells(2, 3, { width: 300, height: 200, gapRatio: 0 });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(3);
    expect(rows[0]?.[0]?.box).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(rows[1]?.[2]?.box).toEqual({ x: 200, y: 100, width: 100, height: 100 });
    expect(rows[0]?.[0]?.rowIndex).toBe(0);
    expect(rows[1]?.[2]?.colIndex).toBe(2);
  });

  it("默认留白按单格比例居中收缩；空矩阵返回空", () => {
    const rows = computeHeatmapCells(1, 1, { width: 100, height: 100 });
    expect(rows[0]?.[0]?.box).toEqual({ x: 2, y: 2, width: 96, height: 96 });

    expect(computeHeatmapCells(0, 3, { width: 100, height: 100 })).toEqual([]);
    expect(computeHeatmapCells(3, 0, { width: 100, height: 100 })).toEqual([]);
  });

  it("非法画布尺寸报错", () => {
    expect(() => computeHeatmapCells(1, 1, { width: 0, height: 100 })).toThrow(RangeError);
  });
});

describe("computeStackedBarBoxes（堆叠柱）", () => {
  it("每个时间桶一根柱，段自底向上堆叠", () => {
    const layout = computeStackedBarBoxes(
      [
        [
          { fraction: 0.5, offsetFraction: 0 },
          { fraction: 0.5, offsetFraction: 0.5 },
        ],
        [{ fraction: 1, offsetFraction: 0 }],
      ],
      { width: 100, height: 100, gapRatio: 0 },
    );

    expect(layout[0]?.[0]?.box).toEqual({ x: 0, y: 50, width: 50, height: 50 });
    expect(layout[0]?.[1]?.box).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    expect(layout[1]?.[0]?.box).toEqual({ x: 50, y: 0, width: 50, height: 100 });
  });

  it("超过 100% 的累计被截断在柱内", () => {
    const layout = computeStackedBarBoxes([[{ fraction: 2, offsetFraction: 0.5 }]], {
      width: 10,
      height: 100,
      gapRatio: 0,
    });

    expect(layout[0]?.[0]?.box).toEqual({ x: 0, y: 0, width: 10, height: 50 });
  });

  it("空行返回空数组", () => {
    expect(computeStackedBarBoxes([], { width: 10, height: 10 })).toEqual([]);
  });
});

describe("computeScatterLayout（散点）", () => {
  it("x 左→右、y 自底向上，padding 内缩", () => {
    expect(computeScatterLayout([{ xFraction: 0, yFraction: 1 }], { width: 100, height: 100, padding: 10 })).toEqual([
      { x: 10, y: 10 },
    ]);
    expect(computeScatterLayout([{ xFraction: 1, yFraction: 0 }], { width: 100, height: 100, padding: 10 })).toEqual([
      { x: 90, y: 90 },
    ]);
    expect(computeScatterLayout([{ xFraction: 0.5, yFraction: 0.5 }], { width: 100, height: 100, padding: 10 })).toEqual([
      { x: 50, y: 50 },
    ]);
  });

  it("越界比例被夹到 0..1，非有限数按 0 处理", () => {
    const points = computeScatterLayout(
      [
        { xFraction: -3, yFraction: 2 },
        { xFraction: Number.NaN, yFraction: Number.POSITIVE_INFINITY },
      ],
      { width: 100, height: 100, padding: 10 },
    );

    expect(points[0]).toEqual({ x: 10, y: 10 });
    expect(points[1]).toEqual({ x: 10, y: 90 });
  });

  it("默认 padding=12；空点集返回空", () => {
    expect(computeScatterLayout([{ xFraction: 0, yFraction: 0 }], { width: 100, height: 100 })).toEqual([
      { x: 12, y: 88 },
    ]);
    expect(computeScatterLayout([], { width: 100, height: 100 })).toEqual([]);
  });
});

describe("computeBubbleLayout（气泡）", () => {
  it("圆心同散点，半径 = radiusFraction × maxRadius", () => {
    const layout = computeBubbleLayout(
      [{ xFraction: 0.5, yFraction: 0.5, radiusFraction: 0.25 }],
      { width: 100, height: 100, padding: 0, maxRadius: 10 },
    );

    expect(layout[0]?.cx).toBe(50);
    expect(layout[0]?.cy).toBe(50);
    expect(layout[0]?.r).toBeCloseTo(2.5, 10);
  });

  it("半径比例被夹到 0..1，默认上限取短边 12%", () => {
    const layout = computeBubbleLayout(
      [
        { xFraction: 0.5, yFraction: 0.5, radiusFraction: 2 },
        { xFraction: 0.5, yFraction: 0.5, radiusFraction: -1 },
      ],
      { width: 100, height: 100, padding: 0 },
    );

    expect(layout[0]?.r).toBeCloseTo(12, 10);
    expect(layout[1]?.r).toBe(0);
  });
});

describe("computeBumpLines（排名迁移）", () => {
  it("两端都有值时给出左→右连线；只有一端时只给端点", () => {
    const layout = computeBumpLines(
      [
        { previousFraction: 1, currentFraction: 0.5 },
        { previousFraction: null, currentFraction: 1 },
        { previousFraction: 0.5, currentFraction: null },
      ],
      { width: 100, height: 100, padding: 10 },
    );

    expect(layout[0]?.from).toEqual({ x: 10, y: 10 });
    expect(layout[0]?.to).toEqual({ x: 90, y: 50 });
    expect(layout[0]?.points).toHaveLength(2);

    expect(layout[1]?.from).toBeNull();
    expect(layout[1]?.points).toHaveLength(1);
    expect(layout[1]?.points[0]).toEqual({ x: 90, y: 10 });

    expect(layout[2]?.to).toBeNull();
    expect(layout[2]?.points[0]).toEqual({ x: 10, y: 50 });
  });

  it("名次比例越界被夹到 0..1；空行集返回空", () => {
    const layout = computeBumpLines([{ previousFraction: 5, currentFraction: -2 }], {
      width: 100,
      height: 100,
      padding: 10,
    });

    expect(layout[0]?.from).toEqual({ x: 10, y: 10 });
    expect(layout[0]?.to).toEqual({ x: 90, y: 90 });
    expect(computeBumpLines([], { width: 100, height: 100 })).toEqual([]);
  });
});
