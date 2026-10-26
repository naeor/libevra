import { describe, expect, it } from "vitest";
import { addDays } from "./stats.js";
import { computeTimeSeries, type TimeSeriesEntry } from "./timeSeries.js";
import { ANOMALY_VERSION, anomalyThresholdReference, detectDailyExpenseAnomalies } from "./anomaly.js";

const TODAY = "2026-03-31";

function series(amounts: readonly number[], opts: { from?: string; coverageEnd?: string; today?: string } = {}) {
  const from = opts.from ?? "2026-03-01";
  const entries: TimeSeriesEntry[] = amounts.map((amount, index) => ({
    occurredLocalDate: addDays(from, index),
    kind: "expense",
    amountMinor: BigInt(amount),
  }));
  return computeTimeSeries(entries, {
    metric: "expense",
    granularity: "day",
    span: { start: from, end: addDays(from, amounts.length) },
    today: opts.today ?? TODAY,
    coverageEnd: opts.coverageEnd ?? addDays(from, amounts.length - 1),
  }).buckets;
}

describe("detectDailyExpenseAnomalies (A19)", () => {
  it("flags a spike with the robust MAD method when dispersion exists", () => {
    const amounts = [...Array.from({ length: 15 }, (_, index) => (index % 2 === 0 ? 100 : 200)), 50000];
    const result = detectDailyExpenseAnomalies(series(amounts), { minimumSampleDays: 10 });
    expect(result.version).toBe(ANOMALY_VERSION);
    expect(result.method).toBe("mad");
    expect(result.sampleDays).toBe(16);
    expect(result.sufficientSample).toBe(true);
    expect(result.marks).toHaveLength(1);
    expect(result.marks[0]!.amountMinor).toBe("50000");
    expect(result.marks[0]!.date).toBe("2026-03-16");
  });

  it("falls back to the IQR fence when the median absolute deviation is zero", () => {
    const amounts = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 900];
    const result = detectDailyExpenseAnomalies(series(amounts));
    expect(["iqr", "zero-dispersion-quantile"]).toContain(result.method);
    expect(result.marks.map((mark) => mark.amountMinor)).toEqual(["900"]);
  });

  it("uses the quantile fallback for sparse data and never flags zero days", () => {
    const amounts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 500];
    const result = detectDailyExpenseAnomalies(series(amounts));
    expect(result.method).toBe("zero-dispersion-quantile");
    expect(result.marks.map((mark) => mark.amountMinor)).toEqual(["500"]);
  });

  it("refuses to mark anything on insufficient samples", () => {
    const result = detectDailyExpenseAnomalies(series([100, 200, 300, 400, 500]));
    expect(result.sufficientSample).toBe(false);
    expect(result.marks).toEqual([]);
    expect(result.sampleDays).toBe(5);
    expect(result.baseline).not.toBeNull();
  });

  it("excludes today's in-progress day from the baseline and marks", () => {
    const amounts = Array.from({ length: 30 }, () => 100);
    amounts.push(99999);
    const result = detectDailyExpenseAnomalies(
      series(amounts, { from: "2026-03-01", coverageEnd: "2026-03-30", today: "2026-03-31" }),
    );
    expect(result.todayExcluded).toBe(true);
    expect(result.sampleDays).toBe(30);
    expect(result.marks).toEqual([]);
  });

  it("returns a null baseline when no day is complete", () => {
    const buckets = computeTimeSeries([], {
      metric: "expense",
      granularity: "day",
      span: { start: "2026-03-30", end: "2026-04-02" },
      today: "2026-03-31",
      coverageEnd: null,
    }).buckets;
    const result = detectDailyExpenseAnomalies(buckets);
    expect(result.baseline).toBeNull();
    expect(result.marks).toEqual([]);
    expect(result.sufficientSample).toBe(false);
  });

  it("documents its method and parameters for the UI explanation", () => {
    const amounts = Array.from({ length: 40 }, (_, index) => 100 + (index % 5) * 20);
    const result = detectDailyExpenseAnomalies(series(amounts), { minimumSampleDays: 10 });
    expect(result.sufficientSample).toBe(true);
    expect(result.parameters.method).toBe(result.method);
    const reference = anomalyThresholdReference(result);
    expect(reference.method).toBe(result.method);
    expect(["3.5", "1.5", "0.95"]).toContain(reference.multiplier);
  });
});
