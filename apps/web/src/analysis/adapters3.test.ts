import { describe, expect, it } from "vitest";

import {
  toBoxplotByCategoryInput,
  toCalendarHeatmapInput,
  toCrossCubeTableInput,
  toPivotTableInput,
  toSmallMultiplesInput,
} from "./adapters3.js";
import type { PivotLabels } from "./adapters3.js";
import { formatCountText, formatMinorText, formatRatioMinorText, formatRatioPercent } from "./format.js";
import type {
  SharedBoxplotResult,
  SharedCalendarResult,
  SharedCrossCubeOutcome,
  SharedPivotResult,
  SharedSmallMultiplesResult,
} from "./sharedTypes.js";

const options = {
  analysisId: "AN-C2B-TEST",
  title: "测试分析",
  currency: "CNY",
  decimals: 2,
} as const;

const pivotLabels: PivotLabels = {
  rowDimensionText: "分类",
  colDimensionText: "月份",
  metricText: "金额",
};

const pivotAmount: SharedPivotResult = {
  rowDimension: "category",
  colDimension: "month",
  metric: "amount",
  rowIds: ["c-food", "c-fun"],
  colIds: ["2026-01", "2026-02"],
  rowLabels: new Map([
    ["c-food", "餐饮"],
    ["c-fun", "娱乐"],
  ]),
  colLabels: new Map([
    ["2026-01", "1月"],
    ["2026-02", "2月"],
  ]),
  cells: [
    { rowId: "c-food", colId: "2026-01", amountMinor: 1200n, count: 2, metricValue: null },
    { rowId: "c-food", colId: "2026-02", amountMinor: 800n, count: 1, metricValue: null },
    { rowId: "c-fun", colId: "2026-01", amountMinor: 300n, count: 1, metricValue: null },
    { rowId: "c-fun", colId: "2026-02", amountMinor: -100n, count: 1, metricValue: null },
  ],
  rowTotals: new Map([
    ["c-food", { amountMinor: 2000n, count: 3, metricValue: null }],
    ["c-fun", { amountMinor: 200n, count: 2, metricValue: null }],
  ]),
  colTotals: new Map([
    ["2026-01", { amountMinor: 1500n, count: 3, metricValue: null }],
    ["2026-02", { amountMinor: 700n, count: 2, metricValue: null }],
  ]),
  grandTotal: { amountMinor: 2200n, count: 5, metricValue: null },
  sampleCount: 5,
  completeness: "complete",
  conservation: { amountsMatch: true, countsMatch: true },
};

describe("toPivotTableInput（P13 多指标交叉表）", () => {
  it("金额指标：行列头与单元格按 result 映射，合计消费 shared 值", () => {
    const input = toPivotTableInput(pivotAmount, options, pivotLabels);

    expect(input.source).toEqual({
      analysisId: "AN-C2B-TEST",
      title: "测试分析",
      currency: "CNY",
      complete: true,
    });
    expect(input.rowDimensionText).toBe("分类");
    expect(input.colDimensionText).toBe("月份");
    expect(input.metricText).toBe("金额");
    expect(input.rowHeaders.map((header) => header.label)).toEqual(["餐饮", "娱乐"]);
    expect(input.rowHeaders[0]?.totalText).toBe("20.00");
    expect(input.rowHeaders[1]?.totalText).toBe("2.00");
    expect(input.colHeaders[0]?.totalText).toBe("15.00");
    expect(input.colHeaders[1]?.totalText).toBe("7.00");
    expect(input.cells).toHaveLength(4);
    expect(input.cells[0]).toEqual({
      rowIndex: 0,
      colIndex: 0,
      valueText: "12.00",
      shareText: null,
      isNegative: false,
    });
    expect(input.cells[1]?.valueText).toBe("8.00");
    expect(input.cells[3]).toEqual({
      rowIndex: 1,
      colIndex: 1,
      valueText: "-1.00",
      shareText: null,
      isNegative: true,
    });
    expect(input.grandTotalText).toBe("22.00");
    expect(input.emptyCellText).toBe("—");
    expect(input.filledCellCount).toBe(4);
    expect(input.conservationText).toBeNull();
  });

  it("守恒校验失败时必须给出显式提示而不是静默展示", () => {
    const broken: SharedPivotResult = {
      ...pivotAmount,
      conservation: { amountsMatch: false, countsMatch: true },
    };
    const input = toPivotTableInput(broken, options, pivotLabels);

    expect(input.conservationText).toBe("合计校验失败：单元格合计与总计不一致，请勿据此下结论");
  });

  it("平均与占比指标：文本来自 shared 的 metricValue；缺失给破折号", () => {
    const average: SharedPivotResult = {
      ...pivotAmount,
      metric: "average",
      grandTotal: { amountMinor: 2200n, count: 5, metricValue: { numerator: 1500n, denominator: 1n } },
    };
    const averageInput = toPivotTableInput(average, options, pivotLabels);
    expect(averageInput.grandTotalText).toBe("15.00");

    const averageCell: SharedPivotResult = {
      ...pivotAmount,
      metric: "average",
      cells: [
        { rowId: "c-food", colId: "2026-01", amountMinor: 1200n, count: 2, metricValue: { numerator: 1000n, denominator: 3n } },
        { rowId: "c-food", colId: "2026-02", amountMinor: 0n, count: 0, metricValue: null },
      ],
      grandTotal: { amountMinor: 1200n, count: 2, metricValue: null },
    };
    const averageCellInput = toPivotTableInput(averageCell, options, pivotLabels);
    expect(averageCellInput.cells[0]?.valueText).toBe("3.33");
    expect(averageCellInput.cells[1]?.valueText).toBe("—");
    expect(averageCellInput.grandTotalText).toBe("—");

    const shareCell: SharedPivotResult = {
      ...pivotAmount,
      metric: "share",
      cells: [
        { rowId: "c-food", colId: "2026-01", amountMinor: 1200n, count: 2, metricValue: { numerator: 1n, denominator: 4n } },
        { rowId: "c-food", colId: "2026-02", amountMinor: 0n, count: 0, metricValue: null },
      ],
      grandTotal: { amountMinor: 1200n, count: 2, metricValue: { numerator: 1n, denominator: 2n } },
    };
    const shareInput = toPivotTableInput(shareCell, options, pivotLabels);
    expect(shareInput.cells[0]?.valueText).toBe("25.0%");
    expect(shareInput.cells[1]?.valueText).toBe("—");
    expect(shareInput.grandTotalText).toBe("50.0%");
  });

  it("笔数指标：单元格与合计都是笔数文本，不是金额", () => {
    const count: SharedPivotResult = {
      ...pivotAmount,
      metric: "count",
      cells: [{ rowId: "c-food", colId: "2026-01", amountMinor: 0n, count: 3, metricValue: null }],
      grandTotal: { amountMinor: 0n, count: 3, metricValue: null },
    };
    const input = toPivotTableInput(count, options, { ...pivotLabels, metricText: "笔数" });

    expect(input.metricText).toBe("笔数");
    expect(input.cells[0]?.valueText).toBe(formatCountText(3));
    expect(input.grandTotalText).toBe(formatCountText(3));
  });
});

const boxplot: SharedBoxplotResult = {
  groups: [
    {
      categoryId: "c-a",
      categoryLabel: "餐饮",
      sampleCount: 10,
      minMinor: 1000n,
      maxMinor: 5000n,
      q1: { numerator: 1500n, denominator: 1n },
      median: { numerator: 2000n, denominator: 1n },
      q3: { numerator: 3000n, denominator: 1n },
      iqr: { numerator: 1500n, denominator: 1n },
      lowerFence: { numerator: 0n, denominator: 1n },
      upperFence: { numerator: 6000n, denominator: 1n },
      outlierCount: 1,
      outlierMinors: [7000n],
      reliable: true,
    },
    {
      categoryId: "c-b",
      categoryLabel: "娱乐",
      sampleCount: 3,
      minMinor: 2000n,
      maxMinor: 9000n,
      q1: { numerator: 2500n, denominator: 1n },
      median: { numerator: 4000n, denominator: 1n },
      q3: { numerator: 6000n, denominator: 1n },
      iqr: { numerator: 3500n, denominator: 1n },
      lowerFence: { numerator: -1000n, denominator: 1n },
      upperFence: { numerator: 10000n, denominator: 1n },
      outlierCount: 0,
      outlierMinors: [],
      reliable: false,
    },
  ],
  minReliableSample: 5,
  quantileMethod: "type7-linear",
  completeness: "complete",
};

describe("toBoxplotByCategoryInput（P12 分类箱线图）", () => {
  it("所有组共用一个 domain（含围栏与离群点），因此箱体长度可跨组比较", () => {
    const input = toBoxplotByCategoryInput(boxplot, options);
    const span = 11000; // domainMax 10000 - domainMin -1000

    expect(input.domainMinText).toBe(formatMinorText(-1000n, 2));
    expect(input.domainMaxText).toBe(formatMinorText(10000n, 2));
    expect(input.minReliableSample).toBe(5);
    expect(input.quantileMethodText).toBe("Type 7 线性插值");

    const first = input.groups[0];
    expect(first?.label).toBe("餐饮");
    expect(first?.reliable).toBe(true);
    expect(first?.minFraction).toBeCloseTo(2000 / span, 12);
    expect(first?.q1Fraction).toBeCloseTo(2500 / span, 12);
    expect(first?.medianFraction).toBeCloseTo(3000 / span, 12);
    expect(first?.q3Fraction).toBeCloseTo(4000 / span, 12);
    expect(first?.maxFraction).toBeCloseTo(6000 / span, 12);
    expect(first?.outlierFractions[0]).toBeCloseTo(8000 / span, 12);

    const positions = [
      first?.minFraction,
      first?.q1Fraction,
      first?.medianFraction,
      first?.q3Fraction,
      first?.maxFraction,
    ];
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index] ?? Number.NaN).toBeGreaterThanOrEqual(positions[index - 1] ?? Number.NaN);
    }
  });

  it("样本不足的组标记 reliable=false，且精确文本是舍入后的金额", () => {
    const input = toBoxplotByCategoryInput(boxplot, options);
    const second = input.groups[1];

    expect(second?.reliable).toBe(false);
    expect(second?.lowerFenceText).toBe("-10.00");
    expect(second?.q1Text).toBe("25.00");
    expect(second?.upperFenceText).toBe("100.00");
    expect(second?.medianFraction).toBeCloseTo(5000 / 11000, 12);
    expect(input.groups[0]?.q1Text).toBe(formatRatioMinorText({ numerator: 1500n, denominator: 1n }, 2));
  });
});

const smallMultiples: SharedSmallMultiplesResult = {
  panels: [
    {
      categoryId: "c-a",
      categoryLabel: "餐饮",
      points: [
        { bucketKey: "2026-01-01", valueMinor: 3000n, count: 3 },
        { bucketKey: "2026-02-01", valueMinor: 1000n, count: 1 },
      ],
      totalMinor: 4000n,
      maxMinor: 3000n,
    },
    {
      categoryId: "c-b",
      categoryLabel: "娱乐",
      points: [
        { bucketKey: "2026-01-01", valueMinor: 5000n, count: 2 },
        { bucketKey: "2026-02-01", valueMinor: 0n, count: 0 },
      ],
      totalMinor: 5000n,
      maxMinor: 5000n,
    },
  ],
  bucketKeys: ["2026-01-01", "2026-02-01"],
  bucketLabels: ["1月", "2月"],
  sharedMaxMinor: 5000n,
  panelMaxMinor: new Map([
    ["c-a", 3000n],
    ["c-b", 5000n],
  ]),
  scaleMode: "shared",
  topN: 2,
  truncated: true,
  omittedCategoryCount: 4,
  completeness: "complete",
};

describe("toSmallMultiplesInput（P14 分类周期小多图）", () => {
  it("共享尺度：所有面板用同一个纵轴最大值（sharedMaxMinor）", () => {
    const input = toSmallMultiplesInput(smallMultiples, options);

    expect(input.scaleMode).toBe("shared");
    expect(input.bucketLabels).toEqual(["1月", "2月"]);
    expect(input.sharedMaxText).toBe("50.00");
    expect(input.panels).toHaveLength(2);
    expect(input.panels[0]?.label).toBe("餐饮");
    expect(input.panels[0]?.totalText).toBe("40.00");
    expect(input.panels[0]?.points[0]).toEqual({
      bucketLabel: "1月",
      valueText: "30.00",
      fractionOfMax: 0.6,
    });
    expect(input.panels[1]?.points[0]?.fractionOfMax).toBeCloseTo(1, 12);
    expect(input.panels[1]?.points[1]?.valueText).toBe("0.00");
  });

  it("独立尺度：每面板用自己的 maxMinor，并保留共享最大值文本供提示", () => {
    const independent: SharedSmallMultiplesResult = { ...smallMultiples, scaleMode: "independent" };
    const input = toSmallMultiplesInput(independent, options);

    expect(input.scaleMode).toBe("independent");
    expect(input.panels[0]?.points[0]?.fractionOfMax).toBeCloseTo(1, 12);
    expect(input.panels[1]?.points[0]?.fractionOfMax).toBeCloseTo(1, 12);
    expect(input.sharedMaxText).toBe("50.00");
  });

  it("截断时必须显示「另有 N 个未显示」的说明", () => {
    const input = toSmallMultiplesInput(smallMultiples, options);

    expect(input.truncated).toBe(true);
    expect(input.omittedCategoryCount).toBe(4);
    expect(input.noteText).toBe("仅显示前 2 个分类（另有 4 个未显示）");
  });
});

const calendar: SharedCalendarResult = {
  year: 2026,
  metric: "expense",
  leapYear: false,
  dayCount: 365,
  weekCount: 53,
  days: [
    { date: "2026-01-05", weekday: 1, month: 1, weekIndex: 0, valueMinor: 500n, count: 2, state: "complete" },
    { date: "2026-01-06", weekday: 2, month: 1, weekIndex: 0, valueMinor: 0n, count: 0, state: "no-data" },
    { date: "2026-01-07", weekday: 3, month: 1, weekIndex: 0, valueMinor: 0n, count: 0, state: "unknown" },
    { date: "2026-12-31", weekday: 4, month: 12, weekIndex: 52, valueMinor: 0n, count: 0, state: "future" },
  ],
  monthStartWeekIndex: [0, 4, 8, 13, 17, 21, 26, 30, 35, 39, 43, 48],
  totalMinor: 500n,
  totalCount: 2,
  recordCount: 1,
  noDataDayCount: 0,
  unknownDayCount: 1,
  futureDayCount: 1,
  inProgressDayCount: 0,
  intensityMinMinor: 0n,
  intensityMaxMinor: 1000n,
  completeness: "complete",
};

describe("toCalendarHeatmapInput（P15 全年日历）", () => {
  it("真实零、未知与未来是三种不同事实，文本与强度都不得混同", () => {
    const input = toCalendarHeatmapInput(calendar, options);

    expect(input.year).toBe(2026);
    expect(input.leapYear).toBe(false);
    expect(input.weekCount).toBe(53);
    expect(input.monthLabels).toHaveLength(12);
    expect(input.monthLabels[0]).toBe("1月");
    expect(input.monthStartWeekIndex).toEqual([0, 4, 8, 13, 17, 21, 26, 30, 35, 39, 43, 48]);
    expect(input.days).toHaveLength(4);

    expect(input.days[0]).toEqual({
      date: "2026-01-05",
      weekday: 1,
      weekIndex: 0,
      month: 1,
      state: "complete",
      valueText: "5.00",
      countText: "2",
      intensity: 0.5,
    });
    expect(input.days[1]?.state).toBe("no-data");
    expect(input.days[1]?.valueText).toBe("0.00");
    expect(input.days[1]?.intensity).toBe(0);
    expect(input.days[2]?.state).toBe("unknown");
    expect(input.days[2]?.valueText).toBe("—");
    expect(input.days[2]?.intensity).toBe(0);
    expect(input.days[3]?.state).toBe("future");
    expect(input.days[3]?.valueText).toBe("—");

    expect(input.totalText).toBe("5.00");
    expect(input.maxText).toBe("10.00");
    expect(input.noDataText).toBe("无记录");
    expect(input.unknownText).toBe("覆盖未知");
    expect(input.futureText).toBe("未来");
  });

  it("count 指标按笔数文本，强度仍来自 shared 的 intensity 边界", () => {
    const byCount: SharedCalendarResult = {
      ...calendar,
      metric: "count",
      intensityMinMinor: 0n,
      intensityMaxMinor: 3n,
      days: [{ date: "2026-01-05", weekday: 1, month: 1, weekIndex: 0, valueMinor: 2n, count: 2, state: "complete" }],
      totalMinor: 0n,
      totalCount: 2,
    };
    const input = toCalendarHeatmapInput(byCount, options);

    expect(input.days[0]?.valueText).toBe(formatCountText(2));
    expect(input.days[0]?.intensity).toBeCloseTo(2 / 3, 12);
    expect(input.totalText).toBe(formatCountText(2));
    expect(input.maxText).toBe(formatCountText(3));
  });
});

const cubeRejected: SharedCrossCubeOutcome = {
  ok: false,
  reason: "too-many-dimensions",
  detail: "received 4 dimensions",
};

const cubeOk: SharedCrossCubeOutcome = {
  ok: true,
  result: {
    metric: "amount",
    dimensions: ["month", "category"],
    axes: [
      { dimension: "month", values: ["2026-01"], labels: new Map([["2026-01", "1月"]]) },
      { dimension: "category", values: ["c-food"], labels: new Map([["c-food", "餐饮"]]) },
    ],
    cells: [{ coords: ["2026-01", "c-food"], amountMinor: 1200n, count: 2 }],
    totalMinor: 1200n,
    totalCount: 2,
    scaleNodeCount: [1, 1],
    combinations: 1,
    filledCellCount: 1,
    completeness: "complete",
    supportedDimensions: ["year", "month", "week", "weekday", "category", "paymentMethod", "currency", "kind"],
    dimensionPositions: new Map([
      ["month", 0],
      ["category", 1],
    ]),
  },
};

describe("toCrossCubeTableInput（P21 自定义多维长表）", () => {
  it("能力检查失败时返回可展示原因，不抛异常也不造图", () => {
    const rejected = toCrossCubeTableInput(cubeRejected, options);

    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected rejected outcome");
    expect(rejected.reason).toBe("too-many-dimensions");
    expect(rejected.reasonText).toBe("最多支持 3 个维度");
  });

  it("未知拒绝原因回落到 shared 的 detail 文本", () => {
    const unknownReason = toCrossCubeTableInput(
      { ok: false, reason: "some-new-reason", detail: "自定义原因说明" },
      options,
    );

    expect(unknownReason.ok).toBe(false);
    if (unknownReason.ok) throw new Error("expected rejected outcome");
    expect(unknownReason.reasonText).toBe("自定义原因说明");
  });

  it("成功时输出长表：维度标签、路径、金额/占比文本与总计", () => {
    const mapped = toCrossCubeTableInput(cubeOk, options);

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error("expected accepted outcome");

    expect(mapped.input.dimensionTexts).toEqual(["月份", "分类"]);
    expect(mapped.input.metricText).toBe("金额");
    expect(mapped.input.rows).toHaveLength(1);
    expect(mapped.input.rows[0]?.key).toBe("2026-01|c-food");
    expect(mapped.input.rows[0]?.path).toEqual([
      { dimensionText: "月份", label: "1月" },
      { dimensionText: "分类", label: "餐饮" },
    ]);
    expect(mapped.input.rows[0]?.valueText).toBe("12.00");
    expect(mapped.input.rows[0]?.shareText).toBe(formatRatioPercent({ numerator: 1200n, denominator: 1200n }, 1));
    expect(mapped.input.rows[0]?.countText).toBe(formatCountText(2));
    expect(mapped.input.totalText).toBe("12.00");
    expect(mapped.input.source.complete).toBe(true);
  });

  it("count 指标输出笔数与其他笔数占比", () => {
    const byCount = toCrossCubeTableInput(
      {
        ok: true,
        result: {
          ...(cubeOk.ok ? cubeOk.result : ({} as never)),
          metric: "count",
          totalMinor: 0n,
          totalCount: 2,
          cells: [{ coords: ["2026-01", "c-food"], amountMinor: 0n, count: 2 }],
        },
      },
      options,
    );

    expect(byCount.ok).toBe(true);
    if (!byCount.ok) throw new Error("expected accepted outcome");
    expect(byCount.input.metricText).toBe("笔数");
    expect(byCount.input.rows[0]?.valueText).toBe(formatCountText(2));
    expect(byCount.input.rows[0]?.shareText).toBe("100.0%");
    expect(byCount.input.totalText).toBe(formatCountText(2));
  });
});
