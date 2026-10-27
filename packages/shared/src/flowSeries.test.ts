import { describe, expect, it } from "vitest";

import { spanFromInclusiveDates } from "./timeCalendar.js";
import { FLOW_SERIES_VERSION, computeFlowSeries, type FlowSeriesOptions } from "./timeSeries.js";
import type { TimeSeriesEntry } from "./timeSeries.js";

const OCTOBER: FlowSeriesOptions = {
  granularity: "month",
  span: spanFromInclusiveDates("2026-07-01", "2026-10-31"),
  today: "2026-10-27",
  coverageEnd: "2026-10-31",
};

function entry(
  occurredLocalDate: string,
  kind: "expense" | "income",
  amountMinor: bigint | number,
): TimeSeriesEntry {
  return { occurredLocalDate, kind, amountMinor };
}

describe("income/expense comparison (I11)", () => {
  it("aligns income and expense on one bucket list and computes the difference", () => {
    const result = computeFlowSeries(
      [
        entry("2026-07-10", "income", 500_000),
        entry("2026-07-10", "expense", 320_000),
        entry("2026-08-10", "income", 480_000),
        entry("2026-08-10", "expense", 350_000),
      ],
      OCTOBER,
    );

    expect(result.version).toBe(FLOW_SERIES_VERSION);
    expect(result.buckets).toHaveLength(4);
    expect(result.buckets[0]).toMatchObject({
      incomeMinor: "500000",
      expenseMinor: "320000",
      differenceMinor: "180000",
      incomeCount: 1,
      expenseCount: 1,
    });
    expect(result.totalIncomeMinor).toBe("980000");
    expect(result.totalExpenseMinor).toBe("670000");
    expect(result.totalDifferenceMinor).toBe("310000");
  });

  it("keeps the two kinds independent: a month with no income still has expenses", () => {
    const result = computeFlowSeries(
      [entry("2026-09-05", "expense", 1_000)],
      OCTOBER,
    );

    expect(result.buckets[2]).toMatchObject({
      incomeMinor: "0",
      expenseMinor: "1000",
      differenceMinor: "-1000",
    });
  });

  it("never invents a difference when one side is unknown", () => {
    const result = computeFlowSeries(
      [entry("2026-07-10", "income", 500_000)],
      { ...OCTOBER, coverageEnd: "2026-09-15" },
    );

    expect(result.buckets[0]?.incomeMinor).toBe("500000");
    // July has income entries but no expense entries: expense is a confirmed 0.
    expect(result.buckets[0]?.expenseMinor).toBe("0");
    // July is covered, September is not; September's difference must be null.
    expect(result.buckets[2]?.differenceMinor).toBeNull();
    expect(result.buckets[2]?.incomeMinor).toBeNull();
    expect(result.totalIncomeMinor).toBeNull();
    expect(result.totalDifferenceMinor).toBeNull();
    expect(result.complete).toBe(false);
  });

  it("marks an unfinished last month as in progress, not complete", () => {
    const result = computeFlowSeries([], OCTOBER);

    expect(result.buckets[3]?.bucket.state).toBe("in-progress");
    expect(result.complete).toBe(false);
    expect(result.inProgressBucketCount).toBe(1);
  });

  it("uses the same bucket boundaries for both sides", () => {
    const result = computeFlowSeries(
      [
        entry("2026-07-01", "income", 100),
        entry("2026-07-31", "expense", 200),
      ],
      OCTOBER,
    );

    expect(result.buckets.map((bucket) => bucket.bucket.key)).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(result.buckets[0]?.differenceMinor).toBe("-100");
  });
});
