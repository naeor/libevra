import { describe, expect, it } from "vitest";

import {
  TIME_CONTRACT_VERSION,
  WEEK_START_DAY,
  bucketKeyOf,
  bucketSpanOf,
  classifyBucket,
  dayKey,
  daySpan,
  daysInSpan,
  enumerateBuckets,
  isoDayOfWeek,
  isoWeekKey,
  isoWeekOf,
  isCalendarDate,
  isSpanValid,
  monthKey,
  monthSpan,
  nextBucketStart,
  parseTimeSpan,
  spanContains,
  spanFromInclusiveDates,
  spanToInclusive,
  weekSpan,
} from "./timeCalendar.js";

const context = { today: "2026-10-27", coverageEnd: "2026-10-26" } as const;

describe("calendar date validation", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isCalendarDate("2026-10-27")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-1-1")).toBe(false);
    expect(isCalendarDate("20261027")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("spans are half-open", () => {
  it("converts the legacy inclusive pair without losing a day", () => {
    expect(spanFromInclusiveDates("2026-10-01", "2026-10-01")).toEqual({
      start: "2026-10-01",
      end: "2026-10-02",
    });
    expect(spanFromInclusiveDates("2026-10-01", "2026-10-31")).toEqual({
      start: "2026-10-01",
      end: "2026-11-01",
    });
    expect(spanToInclusive({ start: "2026-10-01", end: "2026-11-01" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("contains the start but not the end", () => {
    const span = daySpan("2026-10-27");

    expect(spanContains(span, "2026-10-27")).toBe(true);
    expect(spanContains(span, "2026-10-28")).toBe(false);
  });

  it("rejects reversed, empty and malformed spans", () => {
    expect(() => parseTimeSpan({ start: "2026-10-10", end: "2026-10-01" })).toThrow(RangeError);
    expect(() => parseTimeSpan({ start: "2026-10-01", end: "2026-10-01" })).toThrow(RangeError);
    expect(() => parseTimeSpan({ start: "2026-02-30", end: "2026-03-01" })).toThrow(RangeError);
    expect(() => spanFromInclusiveDates("2026-10-10", "2026-10-01")).toThrow(RangeError);
    expect(isSpanValid({ start: "2026-10-01", end: "2026-10-02" })).toBe(true);
    expect(isSpanValid({ start: "2026-10-02", end: "2026-10-01" })).toBe(false);
  });
});

describe("natural periods", () => {
  it("counts days by the calendar, not by 30-day assumptions", () => {
    expect(daysInSpan(daySpan("2026-10-27"))).toBe(1);
    expect(daysInSpan(monthSpan("2026-10-15"))).toBe(31);
    expect(daysInSpan(monthSpan("2026-02-15"))).toBe(28);
    expect(daysInSpan(monthSpan("2028-02-15"))).toBe(29);
    expect(daysInSpan(weekSpan("2026-10-27"))).toBe(7);
  });

  it("starts weeks on Monday, including across month and year ends", () => {
    expect(WEEK_START_DAY).toBe("monday");
    expect(isoDayOfWeek("2026-10-26")).toBe(1);
    expect(isoDayOfWeek("2026-10-27")).toBe(2);
    expect(isoDayOfWeek("2026-11-01")).toBe(7);

    const tuesday = weekSpan("2026-10-27");

    expect(tuesday).toEqual({ start: "2026-10-26", end: "2026-11-02" });
    expect(weekSpan("2026-10-26")).toEqual(tuesday);
    expect(weekSpan("2026-11-01")).toEqual(tuesday);
    expect(weekSpan("2026-11-02").start).toBe("2026-11-02");

    expect(weekSpan("2026-12-31")).toEqual({ start: "2026-12-28", end: "2027-01-04" });
    expect(weekSpan("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-04" });
  });

  it("uses ISO week numbering, where the week-year can differ from the year", () => {
    expect(isoWeekOf("2026-01-01")).toEqual({ weekYear: 2026, week: 1 });
    expect(isoWeekOf("2025-12-29")).toEqual({ weekYear: 2026, week: 1 });
    expect(isoWeekOf("2026-10-26")).toEqual({ weekYear: 2026, week: 44 });
    expect(isoWeekOf("2026-12-28")).toEqual({ weekYear: 2026, week: 53 });
    expect(isoWeekOf("2027-01-01")).toEqual({ weekYear: 2026, week: 53 });
    expect(isoWeekOf("2024-12-30")).toEqual({ weekYear: 2025, week: 1 });
    expect(isoWeekOf("2021-01-01")).toEqual({ weekYear: 2020, week: 53 });
  });

  it("returns stable bucket keys", () => {
    expect(dayKey("2026-10-27")).toBe("2026-10-27");
    expect(monthKey("2026-10-27")).toBe("2026-10");
    expect(isoWeekKey("2026-10-27")).toBe("2026-W44");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(bucketKeyOf("month", "2027-01-01")).toBe("2027-01");
    expect(bucketSpanOf("month", "2026-10-27")).toEqual({
      start: "2026-10-01",
      end: "2026-11-01",
    });
  });

  it("advances to the next natural period", () => {
    expect(nextBucketStart("day", "2026-10-27")).toBe("2026-10-28");
    expect(nextBucketStart("week", "2026-10-26")).toBe("2026-11-02");
    expect(nextBucketStart("month", "2026-10-01")).toBe("2026-11-01");
    expect(nextBucketStart("month", "2026-12-01")).toBe("2027-01-01");
    expect(() => nextBucketStart("month", "2026-10-15")).toThrow(RangeError);
  });
});

describe("bucket enumeration", () => {
  it("does not fill a bucket with a zero it cannot know", () => {
    expect(TIME_CONTRACT_VERSION).toBe("s17-b-time-v1");

    const buckets = enumerateBuckets(
      "day",
      spanFromInclusiveDates("2026-10-25", "2026-10-28"),
      context,
    );

    expect(buckets.map((bucket) => [bucket.key, bucket.state])).toEqual([
      ["2026-10-25", "complete"],
      ["2026-10-26", "complete"],
      ["2026-10-27", "in-progress"],
      ["2026-10-28", "future"],
    ]);
  });

  it("marks finished buckets unknown when coverage is not tracked", () => {
    const buckets = enumerateBuckets(
      "day",
      spanFromInclusiveDates("2026-10-25", "2026-10-26"),
      { today: "2026-10-27", coverageEnd: null },
    );

    expect(buckets.map((bucket) => bucket.state)).toEqual(["unknown", "unknown"]);
  });

  it("clips month buckets to the analysis span exactly once", () => {
    const buckets = enumerateBuckets(
      "month",
      spanFromInclusiveDates("2026-10-15", "2026-12-10"),
      context,
    );

    expect(buckets.map((bucket) => bucket.key)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(buckets[0]).toMatchObject({
      span: { start: "2026-10-15", end: "2026-11-01" },
      naturalSpan: { start: "2026-10-01", end: "2026-11-01" },
      clippedStart: true,
      clippedEnd: false,
      state: "in-progress",
    });
    expect(buckets[1]).toMatchObject({
      span: { start: "2026-11-01", end: "2026-12-01" },
      clippedStart: false,
      clippedEnd: false,
      state: "future",
    });
    expect(buckets[2]).toMatchObject({
      span: { start: "2026-12-01", end: "2026-12-11" },
      clippedStart: false,
      clippedEnd: true,
      state: "future",
    });
  });

  it("aligns weeks to Monday even when the range starts mid-week", () => {
    const buckets = enumerateBuckets(
      "week",
      spanFromInclusiveDates("2026-10-28", "2026-11-10"),
      context,
    );

    expect(buckets.map((bucket) => bucket.key)).toEqual(["2026-W44", "2026-W45", "2026-W46"]);
    expect(buckets[0]).toMatchObject({
      span: { start: "2026-10-28", end: "2026-11-02" },
      naturalSpan: { start: "2026-10-26", end: "2026-11-02" },
      clippedStart: true,
    });
    expect(buckets[2]).toMatchObject({
      span: { start: "2026-11-09", end: "2026-11-11" },
      clippedEnd: true,
    });
  });

  it("keeps every bucket inside the analysed span and contiguous", () => {
    const span = spanFromInclusiveDates("2026-01-15", "2026-12-31");
    const buckets = enumerateBuckets("month", span, context);

    expect(buckets[0]?.span.start).toBe(span.start);
    expect(buckets[buckets.length - 1]?.span.end).toBe(span.end);

    for (let index = 1; index < buckets.length; index += 1) {
      expect(buckets[index]?.span.start).toBe(buckets[index - 1]?.span.end);
    }

    for (const bucket of buckets) {
      expect(bucket.span.start >= span.start).toBe(true);
      expect(bucket.span.end <= span.end).toBe(true);
      expect(bucket.span.start < bucket.span.end).toBe(true);
    }

    expect(buckets).toHaveLength(12);
  });

  it("marks a clipped bucket of an unfinished month as in-progress", () => {
    const [bucket] = enumerateBuckets(
      "month",
      spanFromInclusiveDates("2026-10-01", "2026-10-10"),
      context,
    );

    expect(bucket).toMatchObject({
      key: "2026-10",
      clippedStart: false,
      clippedEnd: true,
      state: "in-progress",
    });
  });

  it("judges completeness on the analysed slice, not the natural period", () => {
    const buckets = enumerateBuckets(
      "month",
      spanFromInclusiveDates("2026-09-10", "2026-10-05"),
      { today: "2026-10-27", coverageEnd: "2026-09-29" },
    );

    expect(buckets.map((bucket) => bucket.state)).toEqual(["unknown", "in-progress"]);
  });

  it("never invents buckets for an empty span", () => {
    expect(() => enumerateBuckets("day", { start: "2026-10-27", end: "2026-10-27" }, context)).toThrow(
      RangeError,
    );
  });
});

describe("classifyBucket", () => {
  it("uses coverage only after future and in-progress are ruled out", () => {
    const today = "2026-10-27";
    const natural = monthSpan("2026-10-15");
    const clipped = { start: "2026-10-01", end: "2026-11-01" };

    expect(classifyBucket({ naturalSpan: natural, span: clipped }, { today, coverageEnd: null })).toBe(
      "in-progress",
    );
    expect(
      classifyBucket(
        { naturalSpan: natural, span: clipped },
        { today: "2026-11-05", coverageEnd: null },
      ),
    ).toBe("unknown");
    expect(
      classifyBucket(
        { naturalSpan: natural, span: clipped },
        { today: "2026-11-05", coverageEnd: "2026-10-31" },
      ),
    ).toBe("complete");
    expect(
      classifyBucket(
        { naturalSpan: natural, span: clipped },
        { today: "2026-11-05", coverageEnd: "2026-10-30" },
      ),
    ).toBe("unknown");
  });
});
