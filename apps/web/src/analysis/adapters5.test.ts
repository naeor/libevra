/**
 * C-4 适配器测试（P16–P20，DRAFT）：只验证「shared 结果 → 图表输入」的投影
 * 是否保留了权威值、缺失标记和计算依据；不验证几何，也不重算财务结论。
 */

import { describe, expect, it } from "vitest";

import type { SharedCurrencyCompositionResult } from "./sharedTypes.js";
import type {
  SharedFxContributionResult,
  SharedFxCoverageResult,
  SharedFxFallbackResult,
  SharedFxRateTrendResult,
} from "./sharedTypes.js";
import {
  COVERAGE_BASIS_NOTE,
  COMPOSITION_BASIS_NOTE,
  CONTRIBUTION_BASIS_NOTE,
  FALLBACK_BASIS_NOTE,
  RATE_TREND_BASIS_NOTE,
  toCurrencyCompositionInput,
  toFxContributionChartInput,
  toFxCoverageMatrixInput,
  toFxFallbackUsageInput,
  toFxRateTrendInput,
} from "./adapters5.js";

const OPTIONS = {
  analysisId: "AN-P16",
  title: "币种交易构成",
  currency: "CNY",
  decimals: 2,
} as const;

function compositionResult(): SharedCurrencyCompositionResult {
  return {
    rows: [
      {
        currency: "CNY",
        recordCount: 2,
        incomeCount: 1,
        expenseCount: 1,
        incomeAmountMinor: 2000n,
        expenseAmountMinor: 1000n,
        recordShare: { numerator: 2n, denominator: 3n },
      },
      {
        currency: "USD",
        recordCount: 1,
        incomeCount: 0,
        expenseCount: 1,
        incomeAmountMinor: 0n,
        expenseAmountMinor: 1500n,
        recordShare: { numerator: 1n, denominator: 3n },
      },
    ],
    totalRecordCount: 3,
    currencyCount: 2,
    completeness: "complete",
  };
}

function contributionResult(): SharedFxContributionResult {
  return {
    targetCurrency: "CNY",
    rows: [
      {
        currency: "USD",
        originalSumMinor: 1500n,
        convertedMinor: 10800n,
        convertedCount: 1,
        missingCount: 1,
        fallbackCount: 0,
        shareOfConverted: { numerator: 1n, denominator: 1n },
      },
    ],
    totalConvertedMinor: 10800n,
    convertedCount: 1,
    identityCount: 0,
    fallbackCount: 0,
    missingCount: 1,
    sharesOverConvertedOnly: true,
    missingRecords: [{ id: "t2", currency: "USD", occurredLocalDate: "2026-10-05" }],
    missingRecordsTruncated: false,
    completeness: "partial",
  };
}

function trendResult(): SharedFxRateTrendResult {
  return {
    currency: "USD",
    targetCurrency: "CNY",
    points: [
      {
        currency: "USD",
        targetCurrency: "CNY",
        rateDate: "2026-10-01",
        provider: "fx-snapshot",
        rateNumerator: 72n,
        rateDenominator: 10n,
        rateScaled: { scaled: 7_200_000n, decimals: 6 },
      },
      {
        currency: "USD",
        targetCurrency: "CNY",
        rateDate: "2026-10-03",
        provider: "fx-snapshot",
        rateNumerator: 75n,
        rateDenominator: 10n,
        rateScaled: { scaled: 7_500_000n, decimals: 6 },
      },
    ],
    from: "2026-10-01",
    to: "2026-10-04",
    observationCount: 2,
    missingDateCount: 2,
    missingDates: ["2026-10-02", "2026-10-04"],
    interpolation: "none",
    change: { numerator: 1n, denominator: 24n },
    minPoint: null,
    maxPoint: null,
    completeness: "complete",
  };
}

function coverageResult(): SharedFxCoverageResult {
  return {
    targetCurrency: "CNY",
    currencies: ["USD"],
    dates: ["2026-10-01", "2026-10-02"],
    cells: [
      { currency: "USD", date: "2026-10-01", status: "exact", recordCount: 1 },
      { currency: "USD", date: "2026-10-02", status: "missing", recordCount: 1 },
    ],
    needsConversionCount: 2,
    convertedCount: 1,
    missingCount: 1,
    exactCount: 1,
    fallbackCount: 0,
    notNeededCount: 0,
    coverageRatio: { numerator: 1n, denominator: 2n },
    amountCoverageAvailable: false,
    amountCoverageReason: "首版只统计记录覆盖率。",
    missingCombinations: [{ currency: "USD", date: "2026-10-02", recordCount: 1 }],
    rows: [
      {
        currency: "USD",
        recordCount: 2,
        convertedCount: 1,
        missingCount: 1,
        exactCount: 1,
        fallbackCount: 0,
        coverage: { numerator: 1n, denominator: 2n },
      },
    ],
    completeness: "partial",
  };
}

function fallbackResult(): SharedFxFallbackResult {
  return {
    targetCurrency: "CNY",
    fallbackRecordCount: 2,
    needsConversionCount: 3,
    maxFallbackDays: 2,
    fallbackDaysDistribution: [
      { fallbackDays: 1, count: 1 },
      { fallbackDays: 2, count: 1 },
    ],
    rows: [
      {
        currency: "USD",
        directCount: 0,
        fallbackCount: 2,
        missingCount: 1,
        fallbackDays: [{ fallbackDays: 2, count: 1 }],
      },
    ],
    providers: [{ provider: "fx-snapshot", count: 2 }],
    dates: [{ date: "2026-10-05", count: 2 }],
    missingRateCount: 1,
    completeness: "partial",
  };
}

describe("toCurrencyCompositionInput（P16）", () => {
  it("保留笔数份额与分币种原币金额文本，不折算", () => {
    const input = toCurrencyCompositionInput(compositionResult(), OPTIONS);
    expect(input.available).toBe(true);
    expect(input.unavailableReason).toBeNull();
    expect(input.rows).toHaveLength(2);
    expect(input.rows[0]?.incomeText).toBe("20.00 CNY");
    expect(input.rows[0]?.expenseText).toBe("10.00 CNY");
    expect(input.rows[1]?.expenseText).toBe("15.00 USD");
    expect(input.rows[0]?.shareText).toContain("66.7");
    expect(input.totalText).toContain("3");
    expect(input.basisNote).toBe(COMPOSITION_BASIS_NOTE);
  });

  it("空范围显式不可用并给原因", () => {
    const input = toCurrencyCompositionInput(
      { rows: [], totalRecordCount: 0, currencyCount: 0, completeness: "no-transactions" },
      OPTIONS,
    );
    expect(input.available).toBe(false);
    expect(input.unavailableReason).not.toBeNull();
    expect(input.source.complete).toBe(false);
  });
});

describe("toFxContributionChartInput（P17）", () => {
  it("折算金额用目标币文本，缺汇率显式提示且不隐藏", () => {
    const input = toFxContributionChartInput(contributionResult(), OPTIONS);
    expect(input.available).toBe(true);
    expect(input.targetCurrency).toBe("CNY");
    expect(input.rows[0]?.convertedText).toBe("108.00 CNY");
    expect(input.rows[0]?.originalText).toBe("15.00 USD");
    expect(input.missingText).toContain("1");
    expect(input.missingCount).toBe(1);
    expect(input.sharesOverConvertedOnly).toBe(true);
    expect(input.basisNote).toBe(CONTRIBUTION_BASIS_NOTE);
  });

  it("无缺失时 missingText 为空串", () => {
    const result = contributionResult();
    const input = toFxContributionChartInput(
      {
        ...result,
        missingCount: 0,
        rows: result.rows.map((row) => ({ ...row, missingCount: 0 })),
        completeness: "complete",
      },
      OPTIONS,
    );
    expect(input.missingText).toBe("");
    expect(input.source.complete).toBe(true);
  });

  it("空范围显式不可用", () => {
    const input = toFxContributionChartInput(
      {
        ...contributionResult(),
        rows: [],
        totalConvertedMinor: 0n,
        completeness: "no-transactions",
      },
      OPTIONS,
    );
    expect(input.available).toBe(false);
    expect(input.unavailableReason).not.toBeNull();
  });
});

describe("toFxRateTrendInput（P18）", () => {
  it("离散观测归一化到 x/y，缺失日期只计数不补点", () => {
    const input = toFxRateTrendInput(trendResult(), OPTIONS);
    expect(input.available).toBe(true);
    expect(input.interpolation).toBe("none");
    expect(input.points).toHaveLength(2);
    expect(input.points[0]?.yFraction).toBe(0);
    expect(input.points[1]?.yFraction).toBe(1);
    expect(input.points[0]?.xFraction).toBe(0);
    expect(input.points[1]?.xFraction).toBeCloseTo(2 / 3, 6);
    expect(input.missingDateCount).toBe(2);
    expect(input.missingDatesText).toContain("2 天");
    expect(input.changeText).toContain("4.2");
    expect(input.basisNote).toBe(RATE_TREND_BASIS_NOTE);
  });

  it("单点观测 yFraction 为 1，不因除零产生 NaN", () => {
    const result = trendResult();
    const single = { ...result, points: result.points.slice(0, 1), observationCount: 1 };
    const input = toFxRateTrendInput(single, OPTIONS);
    expect(input.points[0]?.yFraction).toBe(1);
    expect(Number.isNaN(input.points[0]?.xFraction)).toBe(false);
  });

  it("无观测显式不可用并给原因", () => {
    const input = toFxRateTrendInput(
      { ...trendResult(), points: [], observationCount: 0, completeness: "unavailable" },
      OPTIONS,
    );
    expect(input.available).toBe(false);
    expect(input.unavailableReason).not.toBeNull();
    expect(input.missingDatesText).toContain("2 天");
  });
});

describe("toFxCoverageMatrixInput（P19）", () => {
  it("覆盖率是记录覆盖率，金额覆盖率显式不可用并带原因", () => {
    const input = toFxCoverageMatrixInput(coverageResult(), OPTIONS);
    expect(input.available).toBe(true);
    expect(input.coverageText).toContain("50.0");
    expect(input.amountCoverageAvailable).toBe(false);
    expect(input.amountCoverageReason.length).toBeGreaterThan(0);
    expect(input.cells).toHaveLength(2);
    expect(input.cells[1]?.statusLabel).toBe("缺失");
    expect(input.cells[0]?.statusLabel).toBe("命中");
    expect(input.missingCombinationsText).toHaveLength(1);
    expect(input.missingCombinationsText[0]).toContain("USD");
    expect(input.missingCombinationsText[0]).toContain("2026-10-02");
    expect(input.basisNote).toBe(COVERAGE_BASIS_NOTE);
  });

  it("无记录显式不可用", () => {
    const input = toFxCoverageMatrixInput(
      {
        ...coverageResult(),
        cells: [],
        rows: [],
        dates: [],
        missingCombinations: [],
        needsConversionCount: 0,
        convertedCount: 0,
        missingCount: 0,
        coverageRatio: null,
        completeness: "no-transactions",
      },
      OPTIONS,
    );
    expect(input.available).toBe(false);
    expect(input.coverageText).toBe("—");
  });
});

describe("toFxFallbackUsageInput（P20）", () => {
  it("回退分布与来源/日期文本来自权威元数据", () => {
    const input = toFxFallbackUsageInput(fallbackResult(), OPTIONS);
    expect(input.available).toBe(true);
    expect(input.rows[0]?.fallbackText).toContain("2");
    expect(input.distribution).toHaveLength(2);
    expect(input.distribution[0]?.fraction).toBeCloseTo(0.5, 6);
    expect(input.providersText).toContain("fx-snapshot");
    expect(input.datesText).toContain("2026-10-05");
    expect(input.maxFallbackDays).toBe(2);
    expect(input.basisNote).toBe(FALLBACK_BASIS_NOTE);
  });

  it("无折算需求时不可用：不得显示「0 次回退」的可靠结论", () => {
    const input = toFxFallbackUsageInput(
      {
        ...fallbackResult(),
        rows: [],
        fallbackDaysDistribution: [],
        providers: [],
        dates: [],
        fallbackRecordCount: 0,
        needsConversionCount: 0,
        maxFallbackDays: 0,
        missingRateCount: 0,
        completeness: "no-transactions",
      },
      OPTIONS,
    );
    expect(input.available).toBe(false);
    expect(input.unavailableReason).not.toBeNull();
  });
});
