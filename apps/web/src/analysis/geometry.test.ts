import { describe, expect, it } from "vitest";

import {
  computeBarLayout,
  computeBoxplotLayout,
  computeDivergingLayout,
  computeHistogramLayout,
  computeParetoPoints,
  computeWaterfallLayout,
} from "./geometry.js";

describe("computeBarLayout", () => {
  it("按比例给出柱高与位置", () => {
    const segments = computeBarLayout([0.5, 1, 0], { width: 300, height: 100 });

    expect(segments).toHaveLength(3);
    // slot=100，gap=20，barWidth=80
    expect(segments[0]?.box).toEqual({ x: 10, y: 50, width: 80, height: 50 });
    expect(segments[1]?.box).toEqual({ x: 110, y: 0, width: 80, height: 100 });
    expect(segments[2]?.box).toEqual({ x: 210, y: 100, width: 80, height: 0 });
  });

  it("越界比例被夹到 0..1，空数组返回空布局", () => {
    const segments = computeBarLayout([1.5, -0.2], { width: 100, height: 50, gapRatio: 0 });

    expect(segments[0]?.box.height).toBe(50);
    expect(segments[1]?.box.height).toBe(0);
    expect(computeBarLayout([], { width: 100, height: 50 })).toEqual([]);
  });

  it("非法尺寸报错", () => {
    expect(() => computeBarLayout([0.5], { width: 0, height: 10 })).toThrow(RangeError);
    expect(() => computeBarLayout([0.5], { width: 10, height: -1 })).toThrow(RangeError);
  });
});

describe("computeDivergingLayout", () => {
  it("零轴居中，正数向右、负数向左", () => {
    const segments = computeDivergingLayout([1, -0.5, 0], { width: 200, height: 60 });

    // pivot=100，slot=20，gap=4，barHeight=16
    expect(segments[0]?.box).toEqual({ x: 100, y: 2, width: 100, height: 16 });
    expect(segments[1]?.box).toEqual({ x: 50, y: 22, width: 50, height: 16 });
    expect(segments[2]?.box).toEqual({ x: 100, y: 42, width: 0, height: 16 });
  });

  it("pivotRatio 越界报错", () => {
    expect(() =>
      computeDivergingLayout([0.5], { width: 100, height: 100, pivotRatio: 1 }),
    ).toThrow(RangeError);
  });
});

describe("computeWaterfallLayout", () => {
  it("每步从累计位置画到下一步累计位置", () => {
    const steps = computeWaterfallLayout(
      [
        { startFraction: 0, endFraction: 0.5, direction: "increase" as const },
        { startFraction: 0.5, endFraction: 0.75, direction: "increase" as const },
      ],
      { width: 200, height: 100 },
    );

    // slot=100，gap=24，barWidth=76
    expect(steps).toHaveLength(2);
    expect(steps[0]?.box).toEqual({ x: 12, y: 50, width: 76, height: 50 });
    expect(steps[0]?.direction).toBe("increase");
    expect(steps[1]?.box.y).toBe(25);
    expect(steps[1]?.box.height).toBe(25);
  });

  it("负向步骤同样按 start/end 画（方向由调用方权威传入）", () => {
    const steps = computeWaterfallLayout(
      [{ startFraction: 0.8, endFraction: 0.3, direction: "decrease" as const }],
      { width: 100, height: 100, gapRatio: 0 },
    );

    expect(steps[0]?.box.y).toBeCloseTo(20, 6);
    expect(steps[0]?.box.height).toBeCloseTo(50, 6);
    expect(steps[0]?.direction).toBe("decrease");
  });
});

describe("computeHistogramLayout", () => {
  it("复用柱状布局，无间隙默认较小", () => {
    const segments = computeHistogramLayout([1, 0.5], { width: 200, height: 100 });
    expect(segments[0]?.box.height).toBe(100);
    expect(segments[1]?.box.height).toBe(50);
    expect(segments[0]?.box.width).toBeGreaterThan(90);
  });
});

describe("computeParetoPoints", () => {
  it("累计占比映射到折线点，单点退化为水平线段", () => {
    expect(computeParetoPoints([0.5, 1], { width: 100, height: 100 })).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 0 },
    ]);

    const single = computeParetoPoints([0.7], { width: 100, height: 100 });
    expect(single).toHaveLength(2);
    expect(single[0]?.x).toBe(0);
    expect(single[0]?.y).toBeCloseTo(30, 6);
    expect(single[1]?.x).toBe(100);
    expect(single[1]?.y).toBeCloseTo(30, 6);

    expect(computeParetoPoints([], { width: 100, height: 100 })).toEqual([]);
  });
});

describe("computeBoxplotLayout", () => {
  it("domain 覆盖围栏与异常值，箱体居中", () => {
    const layout = computeBoxplotLayout(
      {
        min: 10,
        q1: 20,
        median: 30,
        q3: 40,
        max: 50,
        lowerFence: 10,
        upperFence: 50,
        outliers: [100],
      },
      { width: 200, height: 200, padding: 0 },
    );

    expect(layout.domainMin).toBe(10);
    expect(layout.domainMax).toBe(100);
    expect(layout.bodyX).toBe(50);
    expect(layout.bodyWidth).toBe(100);
    expect(layout.centerX).toBe(100);
    expect(layout.axis.minY).toBeCloseTo(200, 6);
    expect(layout.axis.maxY).toBeCloseTo(200 * (1 - 40 / 90), 6);
    expect(layout.outlierYs[0]).toBeCloseTo(0, 6);
  });

  it("所有值相同时落在画布中心，非法 bodyRatio 报错", () => {
    const layout = computeBoxplotLayout(
      {
        min: 5,
        q1: 5,
        median: 5,
        q3: 5,
        max: 5,
        lowerFence: 5,
        upperFence: 5,
        outliers: [],
      },
      { width: 100, height: 100 },
    );
    expect(layout.axis.medianY).toBe(50);

    expect(() =>
      computeBoxplotLayout(
        { min: 1, q1: 2, median: 3, q3: 4, max: 5, lowerFence: 1, upperFence: 5, outliers: [] },
        { width: 100, height: 100, bodyRatio: 0 },
      ),
    ).toThrow(RangeError);
  });
});
