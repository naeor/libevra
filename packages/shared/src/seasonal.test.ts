import { describe, expect, it } from "vitest";
import { computeTimeSeries, type TimeSeriesEntry } from "./timeSeries.js";
import { SEASONAL_COMPARISON_VERSION, computeSeasonalComparison } from "./seasonal.js";

const TODAY = "2026-01-15";

function entry(date: string, amount: number, kind: "expense" | "income" = "expense"): TimeSeriesEntry {
  return { occurredLocalDate: date, kind, amountMinor: BigInt(amount) };
}

const ENTRIES: TimeSeriesEntry[] = [
  entry("2025-01-10", 100),
  entry("2025-02-10", 200),
  entry("2025-03-10", 300),
  entry("2025-07-10", 700),
  entry("2026-01-05", 150),
  entry("2026-01-10", 250),
];

describe("computeSeasonalComparison (A18)", () => {
  it("aligns the same natural month across years", () => {
    const result = computeSeasonalComparison(ENTRIES, {
      metric: "expense",
      span: { start: "2025-01-01", end: "2026-02-01" },
      today: TODAY,
      coverageEnd: "2026-01-14",
    });
    expect(result.version).toBe(SEASONAL_COMPARISON_VERSION);
    expect(result.years.map((year) => year.year)).toEqual([2025, 2026]);
    const january2025 = result.years[0]!.months[0]!;
    expect(january2025.amountMinor).toBe("100");
    expect(january2025.comparable).toBe(true);
    const january2026 = result.years[1]!.months[0]!;
    expect(january2026.amountMinor).toBe("400");
    expect(january2026.comparable).toBe(false);
    expect(january2026.state).toBe("in-progress");
    expect(result.hasInProgressCells).toBe(true);
    expect(result.comparableYears).toEqual([2025]);
    expect(result.descriptiveOnly).toBe(true);
  });

  it("keeps months outside the analysis span explicitly outside", () => {
    const result = computeSeasonalComparison(ENTRIES, {
      metric: "expense",
      span: { start: "2025-03-01", end: "2025-08-01" },
      today: TODAY,
      coverageEnd: "2025-07-31",
    });
    const months = result.years[0]!.months;
    expect(months[0]!.outsideSpan).toBe(true);
    expect(months[0]!.amountMinor).toBeNull();
    expect(months[0]!.state).toBe("outside-span");
    expect(months[2]!.amountMinor).toBe("300");
    expect(months[2]!.outsideSpan).toBe(false);
    expect(months[8]!.outsideSpan).toBe(true);
  });

  it("aggregates natural quarters when asked", () => {
    const result = computeSeasonalComparison(ENTRIES, {
      metric: "expense",
      span: { start: "2025-01-01", end: "2026-01-01" },
      today: TODAY,
      coverageEnd: "2025-12-31",
      granularity: "quarter",
    });
    const quarters2025 = result.years[0]!.quarters;
    expect(quarters2025[0]!.amountMinor).toBe("600");
    expect(quarters2025[0]!.comparable).toBe(true);
    expect(quarters2025[1]!.amountMinor).toBe("0");
    expect(quarters2025[1]!.comparable).toBe(true);
  });

  it("marks a clipped first month as not directly comparable", () => {
    const result = computeSeasonalComparison(ENTRIES, {
      metric: "expense",
      span: { start: "2025-01-15", end: "2025-03-01" },
      today: TODAY,
      coverageEnd: "2025-02-28",
    });
    const january = result.years[0]!.months[0]!;
    expect(january.clipped).toBe(true);
    expect(january.comparable).toBe(false);
  });

  it("reports insufficient coverage as unknown, not zero", () => {
    const result = computeSeasonalComparison(ENTRIES, {
      metric: "expense",
      span: { start: "2025-01-01", end: "2025-03-01" },
      today: TODAY,
      coverageEnd: "2025-01-31",
    });
    const february = result.years[0]!.months[1]!;
    expect(february.state).toBe("unknown");
    expect(february.amountMinor).toBeNull();
    expect(february.comparable).toBe(false);
  });

  it("supports income as the compared metric", () => {
    const result = computeSeasonalComparison([entry("2025-04-01", 500, "income")], {
      metric: "income",
      span: { start: "2025-01-01", end: "2026-01-01" },
      today: TODAY,
      coverageEnd: "2025-12-31",
    });
    expect(result.metric).toBe("income");
    expect(result.years[0]!.months[3]!.amountMinor).toBe("500");
    expect(result.years[0]!.months[0]!.amountMinor).toBe("0");
  });

  it("rejects spans beyond the month cap instead of truncating", () => {
    expect(() =>
      computeSeasonalComparison(ENTRIES, {
        metric: "expense",
        span: { start: "2023-01-01", end: "2026-06-01" },
        today: TODAY,
        coverageEnd: null,
      }),
    ).toThrow(/36 months/);
  });

  it("keeps a single-year result descriptive only", () => {
    const result = computeSeasonalComparison(ENTRIES, {
      metric: "expense",
      span: { start: "2025-01-01", end: "2026-01-01" },
      today: TODAY,
      coverageEnd: "2025-12-31",
    });
    expect(result.descriptiveOnly).toBe(true);
    expect(result.descriptiveReason).toBe("fewer-than-two-years");
  });
});

describe("seasonal series reuse", () => {
  it("does not mutate the shared time series computation", () => {
    const before = computeTimeSeries(ENTRIES, {
      metric: "expense",
      granularity: "month",
      span: { start: "2025-01-01", end: "2026-01-01" },
      today: TODAY,
      coverageEnd: "2025-12-31",
    }).buckets.length;
    computeSeasonalComparison(ENTRIES, {
      metric: "expense",
      span: { start: "2025-01-01", end: "2026-01-01" },
      today: TODAY,
      coverageEnd: "2025-12-31",
    });
    const after = computeTimeSeries(ENTRIES, {
      metric: "expense",
      granularity: "month",
      span: { start: "2025-01-01", end: "2026-01-01" },
      today: TODAY,
      coverageEnd: "2025-12-31",
    }).buckets.length;
    expect(after).toBe(before);
  });
});
