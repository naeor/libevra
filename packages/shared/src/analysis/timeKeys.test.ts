import { describe, expect, it } from "vitest";

import {
  MAX_ANALYSIS_DAYS,
  alignDateToYear,
  alignLeapDay,
  assertWithinAnalysisLimit,
  bucketOf,
  bucketToInclusive,
  compareDate,
  daySpan,
  daysInMonth,
  enumerateBuckets,
  inclusiveSpan,
  isCalendarDate,
  isLeapYear,
  isMonthKey,
  isoWeekKey,
  isoWeekSpan,
  isoWeekStart,
  isValidIsoWeekKey,
  lastDayOfMonth,
  monthKey,
  monthSpan,
  requireCalendarDate,
  requireHalfOpenSpan,
  requireInclusiveRange,
} from "./timeKeys.js";
import type { TimeKeyGranularity } from "./timeKeys.js";
import {
  TIMEKEY_FOUR_HUNDRED_DAYS,
  TIMEKEY_FOUR_HUNDRED_ONE_DAYS,
  TIMEKEY_ISO_WEEK_FACTS,
  TIMEKEY_LEAP_FEBRUARY_2028,
  TIMEKEY_MONTH_END_DATES,
  TIMEKEY_OCTOBER_2026,
  TIMEKEY_PARTIAL_MONTHS,
  TIMEKEY_RANGES,
  TIMEKEY_SINGLE_DAY,
  TIMEKEY_YEAR_BOUNDARY,
} from "./timeKeys.fixtures.js";

describe("calendar date basics", () => {
  it("parses valid dates and rejects impossible ones", () => {
    expect(requireCalendarDate("2026-10-01")).toEqual({ year: 2026, month: 10, day: 1 });
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
    expect(isCalendarDate("2026-1-01")).toBe(false);
    expect(isCalendarDate("2026/01/01")).toBe(false);
  });

  it("throws a structured RangeError for invalid dates", () => {
    expect(() => requireCalendarDate("2026-02-31")).toThrow(/time_keys_invalid:calendar_date/);
  });

  it("computes leap years including century rules", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
  });

  it("computes month lengths and month ends", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(lastDayOfMonth(2026, 2)).toBe("2026-02-28");
    expect(lastDayOfMonth(2028, 2)).toBe("2028-02-29");
    expect(lastDayOfMonth(2026, 4)).toBe("2026-04-30");
    expect(() => daysInMonth(2026, 13)).toThrow(/time_keys_invalid:month/);
  });

  it("compares dates lexicographically", () => {
    expect(compareDate("2026-10-01", "2026-10-01")).toBe(0);
    expect(compareDate("2026-09-30", "2026-10-01")).toBe(-1);
    expect(compareDate("2027-01-01", "2026-12-31")).toBe(1);
  });
});

describe("inclusive / half-open conversion", () => {
  it("converts inclusive range to half-open span", () => {
    expect(inclusiveSpan({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      start: "2026-10-01",
      end: "2026-11-01",
    });
  });

  it("converts half-open span to inclusive range", () => {
    expect(bucketToInclusive({ start: "2026-10-01", end: "2026-11-01" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("round-trips inclusive ⇄ half-open", () => {
    for (const { range } of TIMEKEY_RANGES) {
      expect(bucketToInclusive(inclusiveSpan(range))).toEqual(range);
    }
  });

  it("rejects reversed inclusive ranges and non-ascending spans", () => {
    expect(() => requireInclusiveRange({ from: "2026-10-31", to: "2026-10-01" })).toThrow(
      /time_keys_invalid:range_reversed/,
    );
    expect(() => bucketToInclusive({ start: "2026-10-05", end: "2026-10-05" })).toThrow(
      /time_keys_invalid:span_not_ascending/,
    );
    expect(() => requireHalfOpenSpan({ start: "2026-10-05", end: "2026-10-01" })).toThrow(
      /time_keys_invalid:span_not_ascending/,
    );
  });

  it("uses 400 days as the analysis day-window limit", () => {
    expect(MAX_ANALYSIS_DAYS).toBe(400);
    expect(assertWithinAnalysisLimit(TIMEKEY_FOUR_HUNDRED_DAYS)).toBe(400);
    expect(() => assertWithinAnalysisLimit(TIMEKEY_FOUR_HUNDRED_ONE_DAYS)).toThrow(
      /time_keys_invalid:analysis_days_limit/,
    );
    expect(assertWithinAnalysisLimit(TIMEKEY_SINGLE_DAY)).toBe(1);
  });
});

describe("day / month keys", () => {
  it("produces day spans", () => {
    expect(daySpan("2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-10-02" });
    expect(daySpan("2026-12-31")).toEqual({ start: "2026-12-31", end: "2027-01-01" });
  });

  it("produces month keys and natural month spans", () => {
    expect(monthKey("2026-12-15")).toBe("2026-12");
    expect(monthSpan("2026-12-15")).toEqual({ start: "2026-12-01", end: "2027-01-01" });
    expect(monthSpan("2026-01-01")).toEqual({ start: "2026-01-01", end: "2026-02-01" });
    expect(monthSpan("2028-02-29")).toEqual({ start: "2028-02-01", end: "2028-03-01" });
  });

  it("validates month keys", () => {
    expect(isMonthKey("2026-10")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-1")).toBe(false);
    expect(isMonthKey("2026-1x")).toBe(false);
  });

  it("bucketOf returns matching key and natural span for each granularity", () => {
    expect(bucketOf("2026-10-01", "day")).toEqual({ key: "2026-10-01", naturalSpan: { start: "2026-10-01", end: "2026-10-02" } });
    expect(bucketOf("2026-10-01", "week").key).toBe("2026-W40");
    expect(bucketOf("2026-10-01", "month").key).toBe("2026-10");
    expect(() => bucketOf("2026-10-01", "quarter" as unknown as TimeKeyGranularity)).toThrow(
      /time_keys_invalid:granularity/,
    );
  });
});

describe("ISO week keys (monday start)", () => {
  it("computes monday of each date", () => {
    // 2026-10-01 是周四 → 2026-09-28（周一）
    expect(isoWeekSpan("2026-10-01")).toEqual({ start: "2026-09-28", end: "2026-10-05" });
    // 周日属于其所在 ISO 周
    expect(isoWeekSpan("2026-10-04")).toEqual({ start: "2026-09-28", end: "2026-10-05" });
    expect(isoWeekSpan("2026-10-05")).toEqual({ start: "2026-10-05", end: "2026-10-12" });
  });

  it("matches known ISO week facts", () => {
    for (const fact of Object.values(TIMEKEY_ISO_WEEK_FACTS)) {
      expect(isoWeekKey(fact.date)).toBe(fact.key);
    }
  });

  it("computes iso week start and rejects invalid weeks", () => {
    expect(isoWeekStart("2026-W01")).toBe("2025-12-29");
    expect(isoWeekStart("2026-W53")).toBe("2026-12-28");
    expect(isoWeekStart("2027-W01")).toBe("2027-01-04");
    // 2025 年只有 52 周
    expect(isoWeekStart("2025-W53")).toBeNull();
    expect(isoWeekStart("2026-W54")).toBeNull();
    expect(isoWeekStart("2026-W00")).toBeNull();
    expect(isoWeekStart("2026-W1")).toBeNull();
    expect(isoWeekStart("2026-10-01")).toBeNull();
  });

  it("validates iso week keys", () => {
    expect(isValidIsoWeekKey("2026-W01")).toBe(true);
    expect(isValidIsoWeekKey("2026-W53")).toBe(true);
    expect(isValidIsoWeekKey("2025-W53")).toBe(false);
  });
});

describe("bucket enumeration with clipping", () => {
  it("returns one unclipped day bucket per day for a full month", () => {
    const buckets = enumerateBuckets(TIMEKEY_OCTOBER_2026, "day");
    expect(buckets).toHaveLength(31);
    expect(buckets[0]).toMatchObject({
      key: "2026-10-01",
      from: "2026-10-01",
      to: "2026-10-01",
      clippedStart: false,
      clippedEnd: false,
    });
    expect(buckets[30]).toMatchObject({ key: "2026-10-31", from: "2026-10-31", to: "2026-10-31" });
  });

  it("clips week buckets at both edges of a partial-month period", () => {
    const buckets = enumerateBuckets(TIMEKEY_OCTOBER_2026, "week");
    expect(buckets.map((bucket) => bucket.key)).toEqual(["2026-W40", "2026-W41", "2026-W42", "2026-W43", "2026-W44"]);
    expect(buckets[0]).toMatchObject({
      naturalSpan: { start: "2026-09-28", end: "2026-10-05" },
      span: { start: "2026-10-01", end: "2026-10-05" },
      from: "2026-10-01",
      to: "2026-10-04",
      clippedStart: true,
      clippedEnd: false,
    });
    expect(buckets[1]?.clippedStart).toBe(false);
    expect(buckets[4]).toMatchObject({
      naturalSpan: { start: "2026-10-26", end: "2026-11-02" },
      span: { start: "2026-10-26", end: "2026-11-01" },
      from: "2026-10-26",
      to: "2026-10-31",
      clippedStart: false,
      clippedEnd: true,
    });
  });

  it("clips month buckets for partial months", () => {
    const buckets = enumerateBuckets(TIMEKEY_PARTIAL_MONTHS, "month");
    expect(buckets.map((bucket) => bucket.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(buckets[0]).toMatchObject({ from: "2026-01-25", to: "2026-01-31", clippedStart: true, clippedEnd: false });
    expect(buckets[1]).toMatchObject({ from: "2026-02-01", to: "2026-02-28", clippedStart: false, clippedEnd: false });
    expect(buckets[2]).toMatchObject({ from: "2026-03-01", to: "2026-03-05", clippedStart: false, clippedEnd: true });
  });

  it("keeps a single leap-day month bucket unclipped", () => {
    const buckets = enumerateBuckets(TIMEKEY_LEAP_FEBRUARY_2028, "month");
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      key: "2028-02",
      from: "2028-02-01",
      to: "2028-02-29",
      clippedStart: false,
      clippedEnd: false,
    });
  });

  it("crosses the year boundary with ISO week buckets", () => {
    const buckets = enumerateBuckets(TIMEKEY_YEAR_BOUNDARY, "week");
    expect(buckets.map((bucket) => bucket.key)).toEqual([
      "2026-W51",
      "2026-W52",
      "2026-W53",
      "2027-W01",
    ]);
    expect(buckets[0]).toMatchObject({ from: "2026-12-20", to: "2026-12-20", clippedStart: true });
    expect(buckets[2]).toMatchObject({
      span: { start: "2026-12-28", end: "2027-01-04" },
      from: "2026-12-28",
      to: "2027-01-03",
    });
    expect(buckets[3]).toMatchObject({ from: "2027-01-04", to: "2027-01-10", clippedEnd: false });
  });

  it("covers 400 days with 14 month buckets and rejects 401 days", () => {
    const buckets = enumerateBuckets(TIMEKEY_FOUR_HUNDRED_DAYS, "month");
    expect(buckets).toHaveLength(14);
    expect(buckets[0]?.key).toBe("2026-01");
    expect(buckets[13]).toMatchObject({ key: "2027-02", from: "2027-02-01", to: "2027-02-04", clippedEnd: true });
    expect(() => enumerateBuckets(TIMEKEY_FOUR_HUNDRED_ONE_DAYS, "day")).toThrow(
      /time_keys_invalid:analysis_days_limit/,
    );
  });

  it("returns a single bucket for a single-day period with correct clipping flags", () => {
    const day = enumerateBuckets(TIMEKEY_SINGLE_DAY, "day")[0];
    expect(day).toMatchObject({ from: "2026-10-01", to: "2026-10-01", clippedStart: false, clippedEnd: false });

    const week = enumerateBuckets(TIMEKEY_SINGLE_DAY, "week")[0];
    expect(week).toMatchObject({
      key: "2026-W40",
      from: "2026-10-01",
      to: "2026-10-01",
      clippedStart: true, // 自然周从 2026-09-28 开始
      clippedEnd: true, // 自然周到 2026-10-04 结束
    });

    const month = enumerateBuckets(TIMEKEY_SINGLE_DAY, "month")[0];
    expect(month).toMatchObject({ from: "2026-10-01", to: "2026-10-01", clippedStart: false, clippedEnd: true });
  });

  it("produces contiguous buckets that cover the period exactly", () => {
    for (const { name, range } of TIMEKEY_RANGES) {
      for (const granularity of ["day", "week", "month"] as const) {
        const buckets = enumerateBuckets(range, granularity);
        expect(buckets.length, `${name}/${granularity}`).toBeGreaterThan(0);
        expect(buckets[0]?.from, `${name}/${granularity}`).toBe(range.from);
        expect(buckets[buckets.length - 1]?.to, `${name}/${granularity}`).toBe(range.to);
        for (let index = 1; index < buckets.length; index += 1) {
          expect(buckets[index]?.span.start).toBe(buckets[index - 1]?.span.end);
        }
        for (const bucket of buckets) {
          expect(compareDate(bucket.span.start, bucket.span.end)).toBe(-1);
          expect(bucket.span.start <= bucket.from).toBe(true);
          expect(bucket.from <= bucket.to).toBe(true);
        }
      }
    }
  });
});

describe("leap-day / month-end alignment", () => {
  it("clamps Feb 29 to month end of a non-leap target year", () => {
    expect(alignLeapDay(TIMEKEY_MONTH_END_DATES.leapDay, 2027)).toEqual({
      date: "2027-02-28",
      clamped: true,
    });
    expect(alignLeapDay(TIMEKEY_MONTH_END_DATES.leapDay, 2026)).toEqual({
      date: "2026-02-28",
      clamped: true,
    });
  });

  it("keeps Feb 29 in a leap target year", () => {
    expect(alignLeapDay(TIMEKEY_MONTH_END_DATES.leapDay, 2032)).toEqual({
      date: "2032-02-29",
      clamped: false,
    });
  });

  it("rejects non-leap-day input for leap-day alignment", () => {
    expect(() => alignLeapDay(TIMEKEY_MONTH_END_DATES.feb28, 2027)).toThrow(/time_keys_invalid:not_leap_day/);
  });

  it("clamps only when the target month is shorter", () => {
    expect(alignDateToYear(TIMEKEY_MONTH_END_DATES.jan31, 2027)).toEqual({ date: "2027-01-31", clamped: false });
    expect(alignDateToYear(TIMEKEY_MONTH_END_DATES.mar31, 2027)).toEqual({ date: "2027-03-31", clamped: false });
    expect(alignDateToYear(TIMEKEY_MONTH_END_DATES.apr30, 2027)).toEqual({ date: "2027-04-30", clamped: false });
    expect(alignDateToYear(TIMEKEY_MONTH_END_DATES.leapDay, 2027)).toEqual({ date: "2027-02-28", clamped: true });
  });

  it("rejects invalid target years", () => {
    expect(() => alignDateToYear(TIMEKEY_MONTH_END_DATES.feb28, 0)).toThrow(/time_keys_invalid:target_year/);
  });
});
