import { describe, expect, it } from "vitest";
import { addDays } from "./stats.js";
import { computeTimeSeries, type TimeSeriesEntry } from "./timeSeries.js";
import {
  DEFAULT_EXTREME_SIGMA,
  EXTREME_SIGMA_SCALE,
  VARIABILITY_VERSION,
  computeDailyExpenseVariability,
  computeIncomeStability,
} from "./variability.js";

const TODAY = "2026-01-31";

function dailyEntries(from: string, amounts: readonly number[]): TimeSeriesEntry[] {
  return amounts.map((amount, index) => ({
    occurredLocalDate: addDays(from, index),
    kind: "expense",
    amountMinor: BigInt(amount),
  }));
}

function dailySeries(from: string, amounts: readonly number[], coverageEnd?: string) {
  return computeTimeSeries(dailyEntries(from, amounts), {
    metric: "expense",
    granularity: "day",
    span: { start: from, end: addDays(from, amounts.length) },
    today: TODAY,
    coverageEnd: coverageEnd ?? addDays(from, amounts.length - 1),
  }).buckets;
}

describe("computeDailyExpenseVariability (A12)", () => {
  it("computes exact mean and zero standard deviation for flat spending", () => {
    const daily = dailySeries("2026-01-01", [100, 100, 100, 100, 100]);
    const result = computeDailyExpenseVariability(daily, { minSampleDays: 5 });
    expect(result.version).toBe(VARIABILITY_VERSION);
    expect(result.observedCount).toBe(5);
    expect(result.mean).toEqual({ numeratorMinor: "500", denominatorCount: 5 });
    expect(result.meanScaledMinor).toBe("100000000");
    expect(result.stdDevScaledMinor).toBe("0");
    expect(result.coefficientOfVariationScaled).toBe("0");
    expect(result.band).toEqual({ lowerScaledMinor: "100000000", upperScaledMinor: "100000000", scale: 6 });
    expect(result.sufficientSample).toBe(true);
  });

  it("uses the population standard deviation identity N·Σx² − (Σx)²", () => {
    const daily = dailySeries("2026-01-01", [100, 200]);
    const result = computeDailyExpenseVariability(daily);
    expect(result.meanScaledMinor).toBe("150000000");
    expect(result.stdDevScaledMinor).toBe("50000000");
    expect(result.minMinor).toBe("100");
    expect(result.maxMinor).toBe("200");
    expect(result.rangeMinor).toBe("100");
  });

  it("reports mean zero instead of an infinite coefficient of variation", () => {
    const daily = dailySeries("2026-01-01", [0, 0, 0]);
    const result = computeDailyExpenseVariability(daily, { minSampleDays: 3 });
    expect(result.meanScaledMinor).toBe("0");
    expect(result.coefficientOfVariationScaled).toBeNull();
    expect(result.cvUnavailableReason).toBe("mean-zero");
    expect(result.band.lowerScaledMinor).toBe("0");
  });

  it("flags days more than two standard deviations from the mean", () => {
    const daily = dailySeries("2026-01-01", [0, 0, 0, 0, 0, 0, 1000]);
    const result = computeDailyExpenseVariability(daily, { minSampleDays: 3 });
    expect(result.extremeDays).toEqual([{ date: "2026-01-07", amountMinor: "1000" }]);
  });

  it("records the default 2σ threshold as an explicit parameter (B-16)", () => {
    const daily = dailySeries("2026-01-01", [0, 0, 0, 0, 0, 0, 1000]);
    const result = computeDailyExpenseVariability(daily, { minSampleDays: 3 });
    expect(DEFAULT_EXTREME_SIGMA).toBe(2);
    expect(EXTREME_SIGMA_SCALE).toBe(1000);
    expect(result.extremeSigmaScaled).toBe(2000);
    expect(result.extremeThresholdFormula).toBe("abs-deviation-gt-sigma-multiple-v1");
  });

  it("lets the caller tighten or widen the extreme-day threshold", () => {
    // 7 天：[100×6, 1000] → 均值 ≈ 228.57，总体 σ ≈ 314.9；1000 偏离约 2.45σ。
    const daily = dailySeries("2026-01-01", [100, 100, 100, 100, 100, 100, 1000]);
    const strict = computeDailyExpenseVariability(daily, { minSampleDays: 3, extremeSigma: 3 });
    const loose = computeDailyExpenseVariability(daily, { minSampleDays: 3, extremeSigma: 2.5 });
    const defaulted = computeDailyExpenseVariability(daily, { minSampleDays: 3 });
    expect(strict.extremeDays).toEqual([]);
    expect(loose.extremeDays).toEqual([]);
    expect(defaulted.extremeDays).toEqual([{ date: "2026-01-07", amountMinor: "1000" }]);
    expect(defaulted.extremeSigmaScaled).toBe(2000);
    expect(loose.extremeSigmaScaled).toBe(2500);
  });

  it("rejects invalid extreme-day thresholds instead of silently falling back", () => {
    const daily = dailySeries("2026-01-01", [100, 100, 100, 100, 100, 100, 1000]);
    expect(() => computeDailyExpenseVariability(daily, { extremeSigma: 0 })).toThrow(RangeError);
    expect(() => computeDailyExpenseVariability(daily, { extremeSigma: -1 })).toThrow(RangeError);
    expect(() => computeDailyExpenseVariability(daily, { extremeSigma: Number.NaN })).toThrow(RangeError);
    expect(() => computeDailyExpenseVariability(daily, { extremeSigma: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it("excludes today's unfinished day and future days from the statistics", () => {
    const span = { start: "2026-01-10", end: "2026-01-14" };
    const entries: TimeSeriesEntry[] = [
      { occurredLocalDate: "2026-01-10", kind: "expense", amountMinor: 100n },
      { occurredLocalDate: "2026-01-11", kind: "expense", amountMinor: 100n },
      { occurredLocalDate: "2026-01-12", kind: "expense", amountMinor: 900n },
    ];
    const daily = computeTimeSeries(entries, {
      metric: "expense",
      granularity: "day",
      span,
      today: "2026-01-12",
      coverageEnd: "2026-01-11",
    }).buckets;
    const result = computeDailyExpenseVariability(daily, { minSampleDays: 2 });
    expect(result.observedCount).toBe(2);
    expect(result.excludedInProgressCount).toBe(1);
    expect(result.sampleRange).toEqual({ start: "2026-01-10", end: "2026-01-14" });
  });

  it("marks small samples as insufficient but still reports the values", () => {
    const daily = dailySeries("2026-01-01", [10, 20, 30]);
    const result = computeDailyExpenseVariability(daily);
    expect(result.sufficientSample).toBe(false);
    expect(result.observedCount).toBe(3);
    expect(result.meanScaledMinor).toBe("20000000");
  });
});

describe("computeIncomeStability (A20)", () => {
  function monthlyEntries(values: readonly (string | null)[]): TimeSeriesEntry[] {
    return values.flatMap((value, index): TimeSeriesEntry[] => {
      if (value === null) return [];
      const month = String(index + 1).padStart(2, "0");
      return [{ occurredLocalDate: `2025-${month}-15`, kind: "income", amountMinor: BigInt(value) }];
    });
  }

  function monthlySeries(values: readonly (string | null)[], coverageEnd = "2025-04-30") {
    return computeTimeSeries(monthlyEntries(values), {
      metric: "income",
      granularity: "month",
      span: { start: "2025-01-01", end: "2026-01-01" },
      today: "2026-01-31",
      coverageEnd,
    }).buckets;
  }

  it("summarises stable monthly income and counts the judged months", () => {
    const monthly = monthlySeries(["1000", "1000", "1000", "1000"]);
    const result = computeIncomeStability(monthly);
    expect(result.version).toBe(VARIABILITY_VERSION);
    expect(result.observedCount).toBe(4);
    expect(result.zeroMonths).toBe(0);
    expect(result.positiveMonths).toBe(4);
    expect(result.judgedState).toBe("computed");
    expect(result.stdDevScaledMinor).toBe("0");
  });

  it("counts zero-income months and flags an insufficient sample", () => {
    const monthly = monthlySeries(["1000", null, null, "0"]);
    const result = computeIncomeStability(monthly, { minSampleMonths: 6 });
    expect(result.observedCount).toBe(4);
    expect(result.zeroMonths).toBe(3);
    expect(result.judgedState).toBe("insufficient-sample");
  });
});
