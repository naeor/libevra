import { describe, expect, it } from "vitest";

import {
  computeBoxplotGroupLayout,
  computeCalendarCells,
  computeSmallMultiplesLayout,
} from "./geometry.js";
import type { BoxplotGroupFractions } from "./geometry.js";

const groups: BoxplotGroupFractions[] = [
  { min: 0, q1: 0.2, median: 0.5, q3: 0.8, max: 1, lowerFence: 0.1, upperFence: 0.9, outliers: [0.95] },
  { min: 0.4, q1: 0.45, median: 0.5, q3: 0.55, max: 0.6, lowerFence: 0.42, upperFence: 0.58, outliers: [] },
];

describe("computeBoxplotGroupLayout（P12 横向箱线几何）", () => {
  it("共同 domain 的 0..1 位置映射为 x，箱体高度按 rowRatio，行高按组数均分", () => {
    const layout = computeBoxplotGroupLayout(groups, { width: 400, height: 200, padding: 20 });

    expect(layout).toHaveLength(2);
    expect(layout[0]?.index).toBe(0);
    expect(layout[0]?.centerY).toBeCloseTo(60, 9);
    expect(layout[0]?.boxHeight).toBeCloseTo(44, 9);
    expect(layout[0]?.minX).toBeCloseTo(20, 9);
    expect(layout[0]?.q1X).toBeCloseTo(92, 9);
    expect(layout[0]?.medianX).toBeCloseTo(200, 9);
    expect(layout[0]?.q3X).toBeCloseTo(308, 9);
    expect(layout[0]?.maxX).toBeCloseTo(380, 9);
    expect(layout[0]?.lowerWhiskerX).toBeCloseTo(56, 9);
    expect(layout[0]?.upperWhiskerX).toBeCloseTo(344, 9);
    expect(layout[0]?.outlierXs).toHaveLength(1);
    expect(layout[0]?.outlierXs[0]).toBeCloseTo(362, 9);

    expect(layout[1]?.index).toBe(1);
    expect(layout[1]?.centerY).toBeCloseTo(140, 9);
    expect(layout[1]?.boxHeight).toBeCloseTo(44, 9);
    expect(layout[1]?.outlierXs).toEqual([]);
  });

  it("超出 0..1 的 fraction 被夹取到画布内（几何层不做业务判断，只夹坐标）", () => {
    const clamped: BoxplotGroupFractions[] = [
      { min: -0.5, q1: -0.1, median: 0.5, q3: 1.2, max: 1.5, lowerFence: -2, upperFence: 3, outliers: [-1, 2] },
    ];
    const layout = computeBoxplotGroupLayout(clamped, { width: 400, height: 100, padding: 20 });

    expect(layout[0]?.minX).toBe(20);
    expect(layout[0]?.q1X).toBe(20);
    expect(layout[0]?.q3X).toBeCloseTo(380, 9);
    expect(layout[0]?.maxX).toBeCloseTo(380, 9);
    expect(layout[0]?.lowerWhiskerX).toBe(20);
    expect(layout[0]?.upperWhiskerX).toBeCloseTo(380, 9);
    expect(layout[0]?.outlierXs).toEqual([20, 380]);
  });

  it("空结果返回空布局；rowRatio 可用 0..1 调整箱体粗细", () => {
    expect(computeBoxplotGroupLayout([], { width: 200, height: 100 })).toEqual([]);

    const thin = computeBoxplotGroupLayout(groups, { width: 400, height: 200, padding: 20, rowRatio: 0.2 });
    expect(thin[0]?.boxHeight).toBeCloseTo(80 * 0.2, 9);
  });

  it("非法尺寸与 rowRatio 直接抛错，避免生成不可见或越界图形", () => {
    expect(() => computeBoxplotGroupLayout(groups, { width: 0, height: 200 })).toThrow(/width/);
    expect(() => computeBoxplotGroupLayout(groups, { width: 400, height: 0 })).toThrow(/height/);
    expect(() => computeBoxplotGroupLayout(groups, { width: 400, height: 200, rowRatio: 0 })).toThrow(/rowRatio/);
    expect(() => computeBoxplotGroupLayout(groups, { width: 400, height: 200, rowRatio: 1.5 })).toThrow(/rowRatio/);
  });
});

describe("computeSmallMultiplesLayout（P14 小多图网格）", () => {
  it("默认按 sqrt(panelCount) 自适应列数（上限 4），行优先排列等宽面板", () => {
    const layout = computeSmallMultiplesLayout(5, { width: 500, height: 300 });
    const panelWidth = (500 - 8 * 2) / 3;
    const panelHeight = (300 - 8) / 2;

    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(2);
    expect(layout.panelWidth).toBeCloseTo(panelWidth, 9);
    expect(layout.panelHeight).toBeCloseTo(panelHeight, 9);
    expect(layout.panels).toHaveLength(5);

    expect(layout.panels[0]).toEqual({ index: 0, x: 0, y: 0, width: panelWidth, height: panelHeight });
    expect(layout.panels[1]?.x).toBeCloseTo(panelWidth + 8, 9);
    expect(layout.panels[2]?.x).toBeCloseTo((panelWidth + 8) * 2, 9);
    expect(layout.panels[3]?.x).toBe(0);
    expect(layout.panels[3]?.y).toBeCloseTo(panelHeight + 8, 9);
    expect(layout.panels[4]?.x).toBeCloseTo(panelWidth + 8, 9);
    expect(layout.panels[4]?.y).toBeCloseTo(panelHeight + 8, 9);
  });

  it("固定 columns 与自定义 gap 生效，单面板铺满画布", () => {
    const fixed = computeSmallMultiplesLayout(5, { width: 500, height: 300, columns: 2, gap: 0 });
    expect(fixed.columns).toBe(2);
    expect(fixed.rows).toBe(3);
    expect(fixed.panelWidth).toBeCloseTo(250, 9);
    expect(fixed.panelHeight).toBeCloseTo(100, 9);

    const single = computeSmallMultiplesLayout(1, { width: 320, height: 180 });
    expect(single).toMatchObject({ columns: 1, rows: 1, panelWidth: 320, panelHeight: 180 });
    expect(single.panels[0]).toEqual({ index: 0, x: 0, y: 0, width: 320, height: 180 });
  });

  it("非法输入抛错：面板数为 0/非整数、columns 非正、gap 过大", () => {
    expect(() => computeSmallMultiplesLayout(0, { width: 300, height: 200 })).toThrow(/panelCount/);
    expect(() => computeSmallMultiplesLayout(2.5, { width: 300, height: 200 })).toThrow(/panelCount/);
    expect(() => computeSmallMultiplesLayout(3, { width: 300, height: 200, columns: 0 })).toThrow(/columns/);
    expect(() => computeSmallMultiplesLayout(3, { width: 300, height: 200, gap: -1 })).toThrow(/gap/);
    expect(() => computeSmallMultiplesLayout(3, { width: 10, height: 200, gap: 10 })).toThrow(/gap is too large/);
    expect(() => computeSmallMultiplesLayout(3, { width: 0, height: 200 })).toThrow(/width/);
  });
});

describe("computeCalendarCells（P15 年度日历网格）", () => {
  it("7 行（周一到周日）× weekCount 列，格子等宽等高且不越出画布", () => {
    const weekCount = 53;
    const cells = computeCalendarCells({ weekCount, width: 800, height: 400 });
    const cellWidth = (800 - 16 - 2 * 52) / weekCount;
    const cellHeight = (400 - 16 - 2 * 6) / 7;

    expect(cells).toHaveLength(7 * weekCount);
    expect(cells[0]).toEqual({
      column: 0,
      row: 0,
      x: 8,
      y: 8,
      width: cellWidth,
      height: cellHeight,
    });
    expect(cells[52]?.column).toBe(52);
    expect(cells[52]?.row).toBe(0);
    expect(cells[52]?.x).toBeCloseTo(8 + 52 * (cellWidth + 2), 9);
    expect(cells[7 * weekCount - 1]?.row).toBe(6);
    expect(cells[7 * weekCount - 1]?.column).toBe(52);
    expect(cells[7 * weekCount - 1]?.y).toBeCloseTo(8 + 6 * (cellHeight + 2), 9);

    const last = cells[7 * weekCount - 1];
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(800 - 8 + 1e-9);
    expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(400 - 8 + 1e-9);
  });

  it("平年 52 列、闰年 53 列都受支持；gap/padding 为 0 时从画布原点开始", () => {
    expect(computeCalendarCells({ weekCount: 52, width: 800, height: 400 })).toHaveLength(7 * 52);

    const flush = computeCalendarCells({ weekCount: 53, width: 800, height: 400, gap: 0, padding: 0 });
    expect(flush).toHaveLength(7 * 53);
    expect(flush[0]).toEqual({ column: 0, row: 0, x: 0, y: 0, width: 800 / 53, height: 400 / 7 });
  });

  it("非法输入抛错：weekCount 为 0/非整数、尺寸非正", () => {
    expect(() => computeCalendarCells({ weekCount: 0, width: 800, height: 400 })).toThrow(/weekCount/);
    expect(() => computeCalendarCells({ weekCount: 1.5, width: 800, height: 400 })).toThrow(/weekCount/);
    expect(() => computeCalendarCells({ weekCount: 52, width: 0, height: 400 })).toThrow(/width/);
    expect(() => computeCalendarCells({ weekCount: 52, width: 800, height: -1 })).toThrow(/height/);
  });
});
