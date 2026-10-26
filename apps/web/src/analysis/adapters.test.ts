import { describe, expect, it } from "vitest";

import {
  formatCountText,
  formatMinorText,
  formatRatioMinorText,
  formatRatioPercent,
  formatScaledDecimalText,
  formatSignedMinorText,
  ratioToDisplayNumber,
  roundRatioToInteger,
} from "./format.js";
import {
  toBoxplotInput,
  toDivergingBarsInput,
  toHistogramInput,
  toParetoInput,
  toRankingTableInput,
  toWaterfallInput,
} from "./adapters.js";
import type {
  SharedConcentration,
  SharedContributionResult,
  SharedDistributionSummary,
  SharedFenceResult,
  SharedHistogram,
  SharedRankingResult,
} from "./sharedTypes.js";

const options = {
  analysisId: "AN-C1-TEST",
  title: "测试分析",
  currency: "CNY",
  decimals: 2,
} as const;

describe("format（展示层文本，不经过 number）", () => {
  it("金额文本保留符号与固定小数位", () => {
    expect(formatMinorText(12345n, 2)).toBe("123.45");
    expect(formatMinorText(-5n, 2)).toBe("-0.05");
    expect(formatMinorText(7n, 0)).toBe("7");
    expect(formatSignedMinorText(100n, 2)).toBe("+1.00");
    expect(formatSignedMinorText(-100n, 2)).toBe("-1.00");
    expect(formatSignedMinorText(0n, 2)).toBe("0.00");
  });

  it("百分比与有理数舍入", () => {
    expect(formatRatioPercent({ numerator: 1n, denominator: 3n }, 1)).toBe("33.3%");
    expect(formatRatioPercent({ numerator: 1n, denominator: 2n }, 0)).toBe("50%");
    expect(roundRatioToInteger({ numerator: 5n, denominator: 2n })).toBe(3n);
    expect(roundRatioToInteger({ numerator: -5n, denominator: 2n })).toBe(-3n);
    expect(formatRatioMinorText({ numerator: 7n, denominator: 4n }, 2)).toBe("0.02");
    expect(formatScaledDecimalText({ scaled: 500000n, decimals: 6 })).toBe("0.500000");
    expect(ratioToDisplayNumber({ numerator: 1n, denominator: 4n })).toBe(0.25);
  });

  it("非法输入报错，分母为 0 时 display number 退化为 0", () => {
    expect(() => formatMinorText(1n, -1)).toThrow(RangeError);
    expect(() => formatRatioPercent({ numerator: 1n, denominator: 0n })).toThrow(RangeError);
    expect(ratioToDisplayNumber({ numerator: 1n, denominator: 0n })).toBe(0);
    expect(formatCountText(Number.NaN)).toBe("—");
  });
});

const rankingResult: SharedRankingResult = {
  items: [
    {
      id: "r1",
      amountMinor: 500n,
      kind: "expense",
      occurredLocalDate: "2026-10-01",
      categoryId: "food",
      categoryLabel: "餐饮",
      paymentMethodId: null,
      paymentMethodLabel: null,
      rank: 1,
      tieCount: 2,
      share: { numerator: 1n, denominator: 2n },
    },
  ],
  totalMinor: 1000n,
  truncated: true,
  sampleComplete: false,
};

describe("toRankingTableInput（I18 精确排行表）", () => {
  it("金额/占比文本来自 shared 结果，截断标记不被吞掉", () => {
    const input = toRankingTableInput(rankingResult, options);

    expect(input.rows).toHaveLength(1);
    expect(input.rows[0]?.amountText).toBe("5.00");
    expect(input.rows[0]?.shareText).toBe("50.0%");
    expect(input.rows[0]?.tieCount).toBe(2);
    expect(input.totalText).toBe("10.00");
    expect(input.truncated).toBe(true);
    expect(input.sampleComplete).toBe(false);
    expect(input.source.complete).toBe(false);
  });

  it("分母未知时占比为 null 且不写 0", () => {
    const input = toRankingTableInput(
      {
        ...rankingResult,
        totalMinor: null,
        items: [{ ...(rankingResult.items[0] as SharedRankingResult["items"][number]), share: null }],
      },
      options,
    );

    expect(input.rows[0]?.shareText).toBeNull();
    expect(input.totalText).toBeNull();
  });
});

const contributionResult: SharedContributionResult = {
  previousTotalMinor: 150n,
  currentTotalMinor: 200n,
  totalDeltaMinor: 50n,
  rows: [
    {
      categoryId: "food",
      categoryLabel: "餐饮",
      previousMinor: 100n,
      currentMinor: 200n,
      deltaMinor: 100n,
      deltaShare: { numerator: 2n, denominator: 1n },
      growth: { numerator: 1n, denominator: 1n },
      growthUnavailableReason: null,
      isNew: false,
      isRemoved: false,
    },
    {
      categoryId: "transport",
      categoryLabel: "交通",
      previousMinor: 50n,
      currentMinor: 0n,
      deltaMinor: -50n,
      deltaShare: { numerator: -1n, denominator: 1n },
      growth: { numerator: -1n, denominator: 1n },
      growthUnavailableReason: null,
      isNew: false,
      isRemoved: true,
    },
  ],
  conservation: { rowsDeltaMinor: 50n, matchesTotal: true, matchedBy: "categoryId" },
};

describe("toDivergingBarsInput（A06 发散条）", () => {
  it("方向与归一化比例来自权威 delta", () => {
    const input = toDivergingBarsInput(contributionResult, options);

    expect(input.rows[0]?.direction).toBe("increase");
    expect(input.rows[0]?.deltaText).toBe("+1.00");
    expect(input.rows[0]?.fractionOfMax).toBe(1);
    expect(input.rows[1]?.direction).toBe("decrease");
    expect(input.rows[1]?.fractionOfMax).toBe(-0.5);
    expect(input.rows[1]?.isRemoved).toBe(true);
    expect(input.totalDeltaText).toBe("+0.50");
    expect(input.previousTotalText).toBe("1.50");
    expect(input.currentTotalText).toBe("2.00");
  });
});

describe("toWaterfallInput（A06 瀑布）", () => {
  it("期初/分类变化/期末步骤齐全，累计文本正确", () => {
    const input = toWaterfallInput(contributionResult, options);
    const ids = input.steps.map((step) => step.id);

    expect(ids).toEqual(["start", "food", "transport", "total"]);
    expect(input.steps[0]?.startFraction).toBe(0);
    expect(input.steps[0]?.endFraction).toBeCloseTo(0.75, 6);
    expect(input.steps[1]?.endFraction).toBeCloseTo(0.5, 6);
    expect(input.steps[2]?.endFraction).toBeCloseTo(0.25, 6);
    expect(input.steps[2]?.direction).toBe("decrease");
    expect(input.steps[3]?.endFraction).toBeCloseTo(1, 6);
    expect(input.steps[1]?.cumulativeText).toBe("1.00");
    expect(input.steps[3]?.cumulativeText).toBe("2.00");
    expect(input.unitText).toBe("CNY");
  });
});

const histogram: SharedHistogram = {
  binWidthMinor: 100n,
  bins: [
    { index: 0, lowerMinor: 0n, upperMinor: 100n, count: 3, isLast: false },
    { index: 1, lowerMinor: 100n, upperMinor: 200n, count: 1, isLast: true },
  ],
  sampleCount: 4,
  zeroCount: 1,
  minMinor: 0n,
  maxMinor: 150n,
};

describe("toHistogramInput（A09 直方图）", () => {
  it("柱高比例来自 count，0 金额单列可见", () => {
    const input = toHistogramInput(histogram, options);

    expect(input.bars).toHaveLength(2);
    expect(input.bars[0]?.fractionOfMax).toBe(1);
    expect(input.bars[1]?.fractionOfMax).toBeCloseTo(1 / 3, 6);
    expect(input.bars[0]?.containsZero).toBe(true);
    expect(input.bars[1]?.isLast).toBe(true);
    expect(input.bars[0]?.label).toBe("0.00–1.00");
    expect(input.sampleCount).toBe(4);
    expect(input.zeroCount).toBe(1);
    expect(input.binWidthText).toBe("1.00");
  });

  it("无直方图时为空态，不伪造 0", () => {
    const input = toHistogramInput(null, options);
    expect(input.bars).toEqual([]);
    expect(input.sampleCount).toBe(0);
    expect(input.source.complete).toBe(false);
  });
});

const summary: SharedDistributionSummary = {
  sampleCount: 4,
  completeness: "complete",
  minMinor: 1n,
  maxMinor: 4n,
  sumMinor: 10n,
  mean: { numerator: 5n, denominator: 2n },
  median: { numerator: 5n, denominator: 2n },
  quantiles: [
    { p: { numerator: 1n, denominator: 4n }, valueMinor: { numerator: 7n, denominator: 4n } },
    { p: { numerator: 1n, denominator: 2n }, valueMinor: { numerator: 5n, denominator: 2n } },
    { p: { numerator: 3n, denominator: 4n }, valueMinor: { numerator: 13n, denominator: 4n } },
  ],
  variance: { numerator: 5n, denominator: 4n },
  standardDeviation: { scaled: 1118033n, decimals: 6 },
  coefficientOfVariation: null,
  iqr: { numerator: 3n, denominator: 2n },
  histogram,
};

const fences: SharedFenceResult = {
  q1: { numerator: 7n, denominator: 4n },
  q3: { numerator: 13n, denominator: 4n },
  iqr: { numerator: 3n, denominator: 2n },
  lowerFence: { numerator: -1n, denominator: 1n },
  upperFence: { numerator: 7n, denominator: 1n },
  outliers: [],
  withinCount: 4,
};

describe("toBoxplotInput（A10 四分位箱线）", () => {
  it("文本与归一化位置来自 shared 分位/围栏", () => {
    const input = toBoxplotInput(summary, fences, options);
    expect(input).not.toBeNull();
    expect(input?.sampleCount).toBe(4);
    expect(input?.medianText).toBe("0.03");
    expect(input?.lowerFenceText).toBe("-0.01");
    expect(input?.upperFenceText).toBe("0.07");
    expect(input?.outlierTexts).toEqual([]);
  });

  it("无样本返回 null，调用方必须显示空态", () => {
    const empty: SharedDistributionSummary = {
      ...summary,
      sampleCount: 0,
      completeness: "no-transactions",
      minMinor: null,
      maxMinor: null,
      median: null,
      quantiles: [],
      histogram: null,
    };

    expect(toBoxplotInput(empty, null, options)).toBeNull();
  });
});

const concentration: SharedConcentration = {
  totalMinor: 200n,
  rows: [
    {
      id: "A",
      label: "A",
      amountMinor: 100n,
      share: { numerator: 1n, denominator: 2n },
      cumulativeMinor: 100n,
      cumulativeShare: { numerator: 1n, denominator: 2n },
    },
    {
      id: "B",
      label: "B",
      amountMinor: 100n,
      share: { numerator: 1n, denominator: 2n },
      cumulativeMinor: 200n,
      cumulativeShare: { numerator: 1n, denominator: 1n },
    },
  ],
  ratios: [
    { topN: 1, share: { numerator: 1n, denominator: 2n }, coveredMinor: 100n },
    { topN: 3, share: { numerator: 1n, denominator: 1n }, coveredMinor: 200n },
  ],
};

describe("toParetoInput（A08 集中度 / P08 累计曲线）", () => {
  it("累计占比与 TopN 文本正确", () => {
    const input = toParetoInput(concentration, options);

    expect(input.rows).toHaveLength(2);
    expect(input.rows[0]?.cumulativeFraction).toBe(0.5);
    expect(input.rows[1]?.cumulativeFraction).toBe(1);
    expect(input.top1Text).toBe("50.0%");
    expect(input.top3Text).toBe("100.0%");
    expect(input.top5Text).toBeNull();
    expect(input.totalText).toBe("2.00");
  });
});
