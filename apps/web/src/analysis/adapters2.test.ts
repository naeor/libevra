import { describe, expect, it } from "vitest";

import {
  toBubbleInput,
  toHeatmapInput,
  toRankMigrationInput,
  toScatterInput,
  toStackedBarsInput,
} from "./adapters.js";
import type {
  SharedBubbleResult,
  SharedMatrixResult,
  SharedRankMigrationResult,
  SharedScatterResult,
} from "./sharedTypes.js";

const options = {
  analysisId: "AN-C2-TEST",
  title: "测试分析",
  currency: "CNY",
  decimals: 2,
} as const;

const matrix: SharedMatrixResult = {
  rowIds: ["2026-07", "2026-08"],
  colIds: ["cash", "card"],
  cells: [
    { rowId: "2026-07", colId: "cash", amountMinor: 6000n, count: 2 },
    { rowId: "2026-07", colId: "card", amountMinor: 4000n, count: 1 },
    { rowId: "2026-08", colId: "cash", amountMinor: 2000n, count: 1 },
  ],
  rowTotals: new Map([
    ["2026-07", 10000n],
    ["2026-08", 2000n],
  ]),
  colTotals: new Map([
    ["cash", 8000n],
    ["card", 4000n],
  ]),
  grandTotalMinor: 12000n,
  grandTotalCount: 4,
  filledCellCount: 3,
};

describe("toHeatmapInput（P01–P03 热力矩阵）", () => {
  it("把矩阵原样映射为行列与单元格，占比/强度只做展示派生", () => {
    const input = toHeatmapInput(matrix, { row: { "2026-07": "7 月" }, col: { card: "信用卡" } }, options);

    expect(input.rows.map((row) => row.label)).toEqual(["7 月", "2026-08"]);
    expect(input.rows[0]?.totalText).toBe("100.00");
    expect(input.cols.map((col) => col.label)).toEqual(["cash", "信用卡"]);
    expect(input.cells).toHaveLength(3);
    expect(input.cells[0]?.amountText).toBe("60.00");
    expect(input.cells[0]?.shareOfRow).toBeCloseTo(0.6, 10);
    expect(input.cells[0]?.intensity).toBeCloseTo(1, 10);
    expect(input.cells[1]?.intensity).toBeCloseTo(4000 / 6000, 10);
    expect(input.cells[1]?.isNegative).toBe(false);
    expect(input.maxText).toBe("60.00");
    expect(input.totalText).toBe("120.00");
    expect(input.filledCellCount).toBe(3);
    expect(input.emptyCellText).toBe("—");
    expect(input.source.complete).toBe(true);
  });

  it("行合计为 0 时 shareOfRow=null；负金额强度取绝对值", () => {
    const negativeMatrix: SharedMatrixResult = {
      rowIds: ["A", "B"],
      colIds: ["x"],
      cells: [{ rowId: "A", colId: "x", amountMinor: -500n, count: 1 }],
      rowTotals: new Map([
        ["A", -500n],
        ["B", 0n],
      ]),
      colTotals: new Map([["x", -500n]]),
      grandTotalMinor: -500n,
      grandTotalCount: 1,
      filledCellCount: 1,
    };

    const input = toHeatmapInput(negativeMatrix, {}, options);
    expect(input.cells[0]?.isNegative).toBe(true);
    expect(input.cells[0]?.intensity).toBeCloseTo(1, 10);
    expect(input.cells[0]?.shareOfRow).toBeCloseTo(1, 10);
    expect(input.rows[1]?.totalText).toBe("0.00");
  });
});

describe("toStackedBarsInput（P04 时间×支付方式）", () => {
  it("按列展开为系列，段占比与累计偏移由行合计推出", () => {
    const input = toStackedBarsInput(matrix, {}, options);

    expect(input.rows.map((row) => row.totalText)).toEqual(["100.00", "20.00"]);
    expect(input.series.map((series) => series.id)).toEqual(["cash", "card"]);
    expect(input.unitText).toBe("CNY");

    const cash = input.series[0]?.segments ?? [];
    expect(cash).toHaveLength(2);
    expect(cash[0]?.fraction).toBeCloseTo(0.6, 10);
    expect(cash[0]?.offsetFraction).toBe(0);
    expect(cash[1]?.fraction).toBeCloseTo(1, 10);
    expect(cash[1]?.offsetFraction).toBe(0);

    const card = input.series[1]?.segments ?? [];
    expect(card[0]?.fraction).toBeCloseTo(0.4, 10);
    expect(card[0]?.offsetFraction).toBeCloseTo(0.6, 10);
    expect(card[1]?.fraction).toBe(0);
    expect(card[1]?.offsetFraction).toBe(1);
  });
});

describe("toRankMigrationInput（P09 排名迁移）", () => {
  const result: SharedRankMigrationResult = {
    previousEntryCount: 3,
    currentEntryCount: 3,
    rows: [
      {
        id: "a",
        label: "餐饮",
        previousRank: 1,
        currentRank: 1,
        rankDelta: 0,
        previousMinor: 10000n,
        currentMinor: 9000n,
        amountDeltaMinor: -1000n,
        isNew: false,
        isRemoved: false,
      },
      {
        id: "b",
        label: "交通",
        previousRank: 3,
        currentRank: 2,
        rankDelta: 1,
        previousMinor: 2000n,
        currentMinor: 3000n,
        amountDeltaMinor: 1000n,
        isNew: false,
        isRemoved: false,
      },
      {
        id: "c",
        label: "已消失分类",
        previousRank: 2,
        currentRank: null,
        rankDelta: null,
        previousMinor: 3000n,
        currentMinor: 0n,
        amountDeltaMinor: -3000n,
        isNew: false,
        isRemoved: true,
      },
      {
        id: "d",
        label: "新分类",
        previousRank: null,
        currentRank: 3,
        rankDelta: null,
        previousMinor: 0n,
        currentMinor: 500n,
        amountDeltaMinor: 500n,
        isNew: true,
        isRemoved: false,
      },
    ],
    movedCount: 1,
    newCount: 1,
    removedCount: 1,
  };

  it("名次映射为纵向比例，新/消失分类只保留一端", () => {
    const input = toRankMigrationInput(result, options);

    expect(input.maxRank).toBe(3);
    expect(input.rows[0]?.movement).toBe("flat");
    expect(input.rows[1]?.movement).toBe("up");
    expect(input.rows[2]?.movement).toBe("removed");
    expect(input.rows[3]?.movement).toBe("new");

    expect(input.rows[0]?.previousFraction).toBeCloseTo(1, 10);
    expect(input.rows[1]?.previousFraction).toBeCloseTo(0, 10);
    expect(input.rows[1]?.currentFraction).toBeCloseTo(0.5, 10);
    expect(input.rows[2]?.currentFraction).toBeNull();
    expect(input.rows[2]?.previousFraction).toBeCloseTo(0.5, 10);
    expect(input.rows[3]?.previousFraction).toBeNull();
    expect(input.rows[3]?.currentFraction).toBeCloseTo(0, 10);

    expect(input.rows[1]?.deltaText).toBe("+10.00");
    expect(input.rows[2]?.amountText).toBe("30.00");
    expect(input.newCount).toBe(1);
    expect(input.removedCount).toBe(1);
    expect(input.movedCount).toBe(1);
  });
});

describe("toScatterInput（P10 散点）", () => {
  const result: SharedScatterResult = {
    points: [
      { id: "t1", occurredLocalDate: "2026-07-01", amountMinor: 1000n, categoryId: "c1" },
      { id: "t2", occurredLocalDate: "2026-07-01", amountMinor: 3000n, categoryId: "c2" },
      { id: "t3", occurredLocalDate: "2026-07-02", amountMinor: 2000n, categoryId: "c1" },
    ],
    sampleCount: 3,
    plottedCount: 3,
    omittedCount: 0,
    strategy: "none",
    complete: true,
    completeness: "complete",
  };

  it("同一业务日期共享 x 序数，y 为相对最大金额的比例", () => {
    const input = toScatterInput(result, options);

    expect(input.xLabels).toEqual(["2026-07-01", "2026-07-02"]);
    expect(input.points.map((point) => point.dateIndex)).toEqual([0, 0, 1]);
    expect(input.points[1]?.yFraction).toBeCloseTo(1, 10);
    expect(input.points[0]?.yFraction).toBeCloseTo(1 / 3, 10);
    expect(input.points[2]?.yFraction).toBeCloseTo(2 / 3, 10);
    expect(input.minText).toBe("10.00");
    expect(input.maxText).toBe("30.00");
    expect(input.source.complete).toBe(true);
  });

  it("空结果不伪造金额文本", () => {
    const empty = toScatterInput(
      {
        points: [],
        sampleCount: 0,
        plottedCount: 0,
        omittedCount: 0,
        strategy: "none",
        complete: false,
        completeness: "no-transactions",
      },
      options,
    );

    expect(empty.points).toEqual([]);
    expect(empty.xLabels).toEqual([]);
    expect(empty.minText).toBeNull();
    expect(empty.maxText).toBeNull();
  });
});

describe("toBubbleInput（P11 气泡）", () => {
  const result: SharedBubbleResult = {
    bubbles: [
      {
        categoryId: "c1",
        categoryLabel: "餐饮",
        count: 3,
        sumMinor: 6000n,
        meanMinor: { numerator: 6000n, denominator: 3n },
        shareOfTotal: { numerator: 6000n, denominator: 10000n },
      },
      {
        categoryId: "c2",
        categoryLabel: "交通",
        count: 2,
        sumMinor: 4000n,
        meanMinor: { numerator: 4000n, denominator: 2n },
        shareOfTotal: { numerator: 4000n, denominator: 10000n },
      },
      {
        categoryId: "c3",
        categoryLabel: "无笔数",
        count: 0,
        sumMinor: 0n,
        meanMinor: null,
        shareOfTotal: null,
      },
    ],
    totalMinor: 10000n,
    totalCount: 5,
    completeness: "complete",
  };

  it("半径按 sqrt(金额占比) 缩放，x/y 为笔数与均值占比", () => {
    const input = toBubbleInput(result, options);

    expect(input.totalText).toBe("100.00");
    expect(input.totalCount).toBe(5);
    expect(input.bubbles[0]?.radiusFraction).toBeCloseTo(Math.sqrt(0.6), 10);
    expect(input.bubbles[0]?.xFraction).toBeCloseTo(1, 10);
    expect(input.bubbles[1]?.xFraction).toBeCloseTo(2 / 3, 10);
    expect(input.bubbles[0]?.yFraction).toBeCloseTo(1, 10);
    expect(input.bubbles[1]?.yFraction).toBeCloseTo(1, 10);
    expect(input.bubbles[0]?.meanText).toBe("20.00");
    expect(input.bubbles[0]?.shareText).toBe("60.0%");
  });

  it("无笔数的分类 mean/share 为 null，不显示为 0 均值", () => {
    const input = toBubbleInput(result, options);
    const empty = input.bubbles[2];

    expect(empty?.meanText).toBeNull();
    expect(empty?.shareText).toBeNull();
    expect(empty?.radiusFraction).toBe(0);
    expect(empty?.xFraction).toBe(0);
    expect(empty?.yFraction).toBe(0);
  });
});
