import { describe, expect, it } from "vitest";

import {
  TIME_SERIES_VERSION,
  accumulateSeries,
  computeTimeSeries,
  type TimeSeriesEntry,
  type TimeSeriesOptions,
} from "./timeSeries.js";
import { spanFromInclusiveDates } from "./timeCalendar.js";

const OCTOBER: TimeSeriesOptions = {
  metric: "expense",
  granularity: "day",
  span: spanFromInclusiveDates("2026-10-01", "2026-10-31"),
  today: "2026-10-27",
  coverageEnd: "2026-10-31",
};

function expense(date: string, amountMinor: bigint | number): TimeSeriesEntry {
  return { occurredLocalDate: date, kind: "expense", amountMinor };
}

function income(date: string, amountMinor: bigint | number): TimeSeriesEntry {
  return { occurredLocalDate: date, kind: "income", amountMinor };
}

describe("daily series (I06/KPI basics)", () => {
  it("sums each business date and keeps confirmed zero days as zero", () => {
    const result = computeTimeSeries(
      [expense("2026-10-01", 1_000), expense("2026-10-01", 500), expense("2026-10-03", 2_000)],
      OCTOBER,
    );

    expect(result.version).toBe(TIME_SERIES_VERSION);
    expect(result.buckets).toHaveLength(31);
    expect(result.buckets[0]).toMatchObject({
      amountMinor: "1500",
      transactionCount: 2,
      unknownReason: null,
    });
    expect(result.buckets[0]?.bucket).toMatchObject({
      key: "2026-10-01",
      state: "complete",
      clippedStart: false,
      clippedEnd: false,
    });
    // A day with no entries inside covered data is a confirmed zero.
    expect(result.buckets[1]).toMatchObject({ amountMinor: "0", transactionCount: 0 });
    expect(result.buckets[2]).toMatchObject({ amountMinor: "2000", transactionCount: 1 });
  });

  it("marks the current day in progress and later days future, never zero", () => {
    const result = computeTimeSeries([], OCTOBER);

    expect(result.buckets[26]?.bucket.state).toBe("in-progress");
    expect(result.buckets[26]?.amountMinor).toBe("0");

    for (const index of [27, 28, 29, 30]) {
      expect(result.buckets[index]?.bucket.state).toBe("future");
      expect(result.buckets[index]?.amountMinor).toBeNull();
      expect(result.buckets[index]?.transactionCount).toBeNull();
      expect(result.buckets[index]?.unknownReason).toBe("not-yet-happened");
    }

    expect(result.inProgressBucketCount).toBe(1);
    expect(result.futureBucketCount).toBe(4);
    expect(result.unknownBucketCount).toBe(0);
    // A month that has not finished is not "complete", even with no missing data.
    expect(result.complete).toBe(false);
    expect(result.totalMinor).toBe("0");
  });

  it("returns an unknown total instead of a partial one when data is missing", () => {
    const result = computeTimeSeries([expense("2026-10-01", 1_000)], {
      ...OCTOBER,
      coverageEnd: "2026-10-20",
    });

    const unknownDays = result.buckets.slice(20, 26);
    for (const day of unknownDays) {
      expect(day.unknownReason).toBe("coverage-missing");
      expect(day.amountMinor).toBeNull();
      expect(day.transactionCount).toBeNull();
    }

    expect(result.unknownBucketCount).toBe(6);
    expect(result.complete).toBe(false);
    // The known part is not offered as a total: it would be a lie by omission.
    expect(result.totalMinor).toBeNull();
    expect(result.totalCount).toBeNull();
  });

  it("never requires a currency of its own and keeps exact big integers", () => {
    const big = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER
    const result = computeTimeSeries(
      [expense("2026-10-02", big), expense("2026-10-02", 7n)],
      { ...OCTOBER, granularity: "day" },
    );

    expect(result.buckets[1]?.amountMinor).toBe("9007199254741000");
    expect(result.totalMinor).toBe("9007199254741000");
  });
});

describe("weekly series (I08)", () => {
  it("starts weeks on Monday and clips the first and last week to the range", () => {
    const result = computeTimeSeries([expense("2026-10-14", 100), expense("2026-10-20", 200)], {
      metric: "expense",
      granularity: "week",
      span: spanFromInclusiveDates("2026-10-14", "2026-10-30"),
      today: "2026-10-27",
      coverageEnd: "2026-10-30",
    });

    expect(result.buckets.map((point) => point.bucket.key)).toEqual([
      "2026-W42",
      "2026-W43",
      "2026-W44",
    ]);

    const [first, middle, last] = result.buckets;
    expect(first?.bucket.span).toEqual({ start: "2026-10-14", end: "2026-10-19" });
    expect(first?.bucket.clippedStart).toBe(true);
    expect(first?.bucket.state).toBe("complete");
    expect(first?.amountMinor).toBe("100");

    expect(middle?.bucket.span).toEqual({ start: "2026-10-19", end: "2026-10-26" });
    expect(middle?.amountMinor).toBe("200");

    // The analysed range ends on Friday, so the last week is a partial week.
    expect(last?.bucket.span).toEqual({ start: "2026-10-26", end: "2026-10-31" });
    expect(last?.bucket.clippedEnd).toBe(true);
    expect(last?.bucket.state).toBe("in-progress");
  });

  it("ignores entries outside the analysed span", () => {
    const result = computeTimeSeries([expense("2026-10-13", 100), expense("2026-10-31", 999)], {
      metric: "expense",
      granularity: "week",
      span: spanFromInclusiveDates("2026-10-14", "2026-10-30"),
      today: "2026-10-27",
      coverageEnd: "2026-10-30",
    });

    expect(result.buckets.map((point) => point.amountMinor)).toEqual(["0", "0", "0"]);
    expect(result.totalMinor).toBe("0");
  });

  it("keeps ISO week keys coherent across the calendar new year", () => {
    const result = computeTimeSeries([], {
      metric: "income",
      granularity: "week",
      span: spanFromInclusiveDates("2026-12-28", "2027-01-10"),
      today: "2027-02-01",
      coverageEnd: "2027-01-10",
    });

    expect(result.buckets.map((point) => point.bucket.key)).toEqual(["2026-W53", "2027-W01"]);
  });
});

describe("monthly series (I09/I10)", () => {
  it("uses real calendar months, including a leap February", () => {
    const result = computeTimeSeries([expense("2028-02-29", 500)], {
      metric: "expense",
      granularity: "month",
      span: spanFromInclusiveDates("2028-01-01", "2028-03-31"),
      today: "2028-06-01",
      coverageEnd: "2028-03-31",
    });

    expect(result.buckets.map((point) => point.bucket.key)).toEqual([
      "2028-01",
      "2028-02",
      "2028-03",
    ]);
    expect(result.buckets[1]?.bucket.naturalSpan).toEqual({
      start: "2028-02-01",
      end: "2028-03-01",
    });
    expect(result.buckets[1]?.amountMinor).toBe("500");
    expect(result.complete).toBe(true);
    expect(result.totalMinor).toBe("500");
  });

  it("supports a multi-year span without dropping months", () => {
    const result = computeTimeSeries([], {
      metric: "expense",
      granularity: "month",
      span: spanFromInclusiveDates("2024-11-01", "2026-02-28"),
      today: "2026-10-27",
      coverageEnd: "2026-02-28",
    });

    expect(result.buckets).toHaveLength(16);
    expect(result.buckets[0]?.bucket.key).toBe("2024-11");
    expect(result.buckets.at(-1)?.bucket.key).toBe("2026-02");
  });

  it("marks a partial month as clipped and still running (month-to-date slice)", () => {
    const result = computeTimeSeries([expense("2026-10-05", 300)], {
      metric: "expense",
      granularity: "month",
      span: spanFromInclusiveDates("2026-10-01", "2026-10-10"),
      today: "2026-10-27",
      coverageEnd: "2026-10-10",
    });

    const [bucket] = result.buckets;
    expect(bucket?.bucket).toMatchObject({
      key: "2026-10",
      clippedStart: false,
      clippedEnd: true,
      state: "in-progress",
    });
    expect(bucket?.amountMinor).toBe("300");
    // The value is a partial month and the flags say so; the total is not "a month".
    expect(result.complete).toBe(false);
  });

  it("does not fake data coverage when coverage is unknown", () => {
    const result = computeTimeSeries([expense("2026-09-15", 100)], {
      metric: "expense",
      granularity: "month",
      span: spanFromInclusiveDates("2026-09-01", "2026-10-31"),
      today: "2026-10-27",
      coverageEnd: null,
    });

    expect(result.buckets[0]?.bucket.state).toBe("unknown");
    expect(result.buckets[0]?.amountMinor).toBeNull();
    expect(result.buckets[1]?.bucket.state).toBe("in-progress");
    expect(result.totalMinor).toBeNull();
    expect(result.complete).toBe(false);
  });
});

describe("transaction count series (I19)", () => {
  it("counts entries without pretending the count is an amount", () => {
    const entries: TimeSeriesEntry[] = [
      expense("2026-10-01", 1_000),
      income("2026-10-01", 2_000),
      income("2026-10-01", 3_000),
    ];

    const all = computeTimeSeries(entries, { ...OCTOBER, metric: "count" });
    expect(all.buckets[0]?.transactionCount).toBe(3);
    expect(all.buckets[0]?.amountMinor).toBeNull();
    expect(all.totalMinor).toBeNull();
    expect(all.totalCount).toBe(3);

    const incomeOnly = computeTimeSeries(entries, {
      ...OCTOBER,
      metric: "count",
      countKind: "income",
    });
    expect(incomeOnly.buckets[0]?.transactionCount).toBe(2);

    const expenseOnly = computeTimeSeries(entries, {
      ...OCTOBER,
      metric: "count",
      countKind: "expense",
    });
    expect(expenseOnly.buckets[0]?.transactionCount).toBe(1);
  });

  it("does not let missing exchange rates or amounts remove existing transactions", () => {
    // 笔数统计不看金额；金额字段即使是小数也不应让真实交易消失（见 I19 注意）。
    const entries: TimeSeriesEntry[] = [
      { occurredLocalDate: "2026-10-02", kind: "expense", amountMinor: 1.5 },
      { occurredLocalDate: "2026-10-02", kind: "income", amountMinor: 0 },
    ];

    const result = computeTimeSeries(entries, { ...OCTOBER, metric: "count" });
    expect(result.buckets[1]?.transactionCount).toBe(2);
  });

  it("only counts the requested kind for amount metrics", () => {
    const entries = [expense("2026-10-03", 100), income("2026-10-03", 900)];

    const expenses = computeTimeSeries(entries, { ...OCTOBER, metric: "expense" });
    expect(expenses.buckets[2]?.amountMinor).toBe("100");
    expect(expenses.buckets[2]?.transactionCount).toBe(1);

    const incomes = computeTimeSeries(entries, { ...OCTOBER, metric: "income" });
    expect(incomes.buckets[2]?.amountMinor).toBe("900");
  });
});

describe("cumulative series (I20)", () => {
  function dailyResult(coverageEnd: string | null): ReturnType<typeof computeTimeSeries> {
    return computeTimeSeries(
      [expense("2026-10-01", 100), expense("2026-10-03", 50), expense("2026-10-04", 80)],
      { ...OCTOBER, coverageEnd },
    );
  }

  it("accumulates from the start of the range and keeps zero-change plateaus", () => {
    const cumulative = accumulateSeries(dailyResult("2026-10-31"));

    expect(cumulative.points[0]?.cumulativeMinor).toBe("100");
    expect(cumulative.points[1]?.cumulativeMinor).toBe("100"); // zero day is a plateau
    expect(cumulative.points[2]?.cumulativeMinor).toBe("150");
    expect(cumulative.points[3]?.cumulativeMinor).toBe("230");
    expect(cumulative.complete).toBe(false); // future days remain in the span
    expect(cumulative.firstUnknownKey).toBeNull();
  });

  it("propagates one unknown day to every later cumulative value", () => {
    const cumulative = accumulateSeries(dailyResult("2026-10-02"));

    expect(cumulative.points[0]?.cumulativeMinor).toBe("100");
    expect(cumulative.points[1]?.cumulativeMinor).toBe("100");
    // 10-03 has no coverage, so 10-03 and everything after it is unknown.
    expect(cumulative.points[2]?.cumulativeMinor).toBeNull();
    expect(cumulative.points[2]?.unknownReason).toBe("coverage-missing");
    expect(cumulative.points[3]?.cumulativeMinor).toBeNull();
    expect(cumulative.points[3]?.unknownReason).toBe("propagated");
    expect(cumulative.firstUnknownKey).toBe("2026-10-03");
    expect(cumulative.totalMinor).toBeNull();
  });

  it("keeps negative deltas instead of forcing a monotonic line", () => {
    const cumulative = accumulateSeries(
      computeTimeSeries([expense("2026-10-01", 100), expense("2026-10-02", -30)], {
        ...OCTOBER,
        coverageEnd: "2026-10-31",
      }),
    );

    expect(cumulative.points[0]?.cumulativeMinor).toBe("100");
    expect(cumulative.points[1]?.deltaMinor).toBe("-30");
    expect(cumulative.points[1]?.cumulativeMinor).toBe("70");
  });
});

describe("input validation", () => {
  it("rejects impossible dates, reversed spans and non-integer amounts", () => {
    expect(() =>
      computeTimeSeries([], { ...OCTOBER, span: { start: "2026-10-31", end: "2026-10-01" } }),
    ).toThrow(RangeError);

    expect(() => computeTimeSeries([], { ...OCTOBER, today: "2026-02-30" })).toThrow(RangeError);

    expect(() => computeTimeSeries([expense("2026-13-01", 1)], OCTOBER)).toThrow(RangeError);

    expect(() => computeTimeSeries([expense("2026-10-01", 1.5)], OCTOBER)).toThrow(RangeError);
  });
});
