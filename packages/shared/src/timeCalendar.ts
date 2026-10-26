import { addDays, endOfMonth, startOfMonth } from "./stats.js";

/**
 * Time calendar contract (S17 workbench, Agent B / B-0).
 *
 * This module is the one place that answers "what is a day, a week and a
 * month" for time-based analysis. It exists because the owner's specification
 * treats calendar meaning as part of the statistics: a week starts on Monday,
 * a month is a natural month (28–31 days, February varies, leap years exist),
 * and a bucket boundary is a calendar fact, not "30 days counted backwards".
 *
 * Three rules shape this file.
 *
 * **Business dates are calendar dates, never instants.** Everything here is a
 * `YYYY-MM-DD` string anchored on `occurredLocalDate` — the calendar date on
 * the phone that recorded the entry. No conversion through UTC, the server's
 * zone, or the browser's zone is allowed to change a date. `addDays` and
 * friends use UTC only as a civil-calendar calculator.
 *
 * **Spans are half-open, `[start, end)`.** `end` is the first instant that is
 * *not* in the span. The legacy `DateRange` in `stats.ts` is inclusive
 * (`from`/`to` both count); this module converts deliberately at the edges so
 * the two can never be confused: `spanToInclusive` / `spanFromInclusiveDates`.
 * Half-open is what makes week and month enumeration clip cleanly without
 * off-by-one bugs.
 *
 * **"Zero" and "unknown" are different.** A bucket marked `complete` with value
 * zero means "nothing was recorded"; a bucket marked `unknown` means "we do not
 * have the data to know". Charts must not render them the same way (owner
 * specification §3.7/§3.8, ACC-04).
 */

/** Version of this contract. Bump when a semantic changes, not for additions. */
export const TIME_CONTRACT_VERSION = "s17-b-time-v1" as const;

/** Weeks start on Monday everywhere in S17 time analysis (owner decision Q-07). */
export const WEEK_START_DAY = "monday" as const;

/** The granularities time-series analyses may be bucketed by. */
export type TimeGranularity = "day" | "week" | "month";

/**
 * A half-open calendar span `[start, end)` over business dates.
 *
 * `end` is exclusive — the first date *after* the span. A single day is
 * `{ start: "2026-10-27", end: "2026-10-28" }`.
 */
export interface TimeSpan {
  /** Inclusive first business date, `YYYY-MM-DD`. */
  readonly start: string;
  /** Exclusive last business date, `YYYY-MM-DD`. */
  readonly end: string;
}

/**
 * Data state of one bucket.
 *
 *  * `complete` — data coverage reaches the end of the analysed slice; a zero
 *    value is a real zero.
 *  * `in-progress` — the natural bucket contains "today", so it has not
 *    finished yet (owner specification §3.10: never present it as a closed
 *    period, and never silently accept it as long as a full period).
 *  * `future` — the bucket starts after today and cannot hold records yet.
 *  * `unknown` — coverage is not known to reach the end of the slice (offline
 *    cache incomplete, download not finished, …): the value is *not* zero.
 *  * `unavailable` — the analysis itself could not run for this bucket
 *    (FX rate missing, permission lost, request failed). Consumers set this
 *    explicitly; enumeration never invents it.
 */
export type BucketState = "complete" | "in-progress" | "future" | "unknown" | "unavailable";

/**
 * One time bucket, already clipped to the analysed span.
 *
 * `span` is the part of the bucket inside the analysis range; `naturalSpan` is
 * the whole calendar period it belongs to. When `clippedStart`/`clippedEnd` is
 * true the bucket is partial by construction (for example the first week of a
 * range that starts on a Wednesday), which is a different statement from
 * "data is missing".
 */
export interface TimeBucket {
  /** Stable identity across reloads: `YYYY-MM-DD`, ISO `YYYY-Www`, or `YYYY-MM`. */
  readonly key: string;
  readonly granularity: TimeGranularity;
  /** Analysed slice of the bucket, half-open and clipped to the analysis span. */
  readonly span: TimeSpan;
  /** Whole natural calendar period the bucket belongs to, half-open. */
  readonly naturalSpan: TimeSpan;
  /** True when the analysis starts after the natural period starts. */
  readonly clippedStart: boolean;
  /** True when the analysis ends before the natural period ends. */
  readonly clippedEnd: boolean;
  readonly state: BucketState;
}

/**
 * Context needed to classify bucket completeness.
 *
 * `today` is the **device calendar date** ("what day is it for the user"),
 * passed in rather than read from a clock, matching `rangeForPreset` in
 * `stats.ts`. `coverageEnd` is the last business date for which the data set is
 * known to be complete: `null` means "coverage is not tracked here", which
 * makes every finished bucket `unknown` instead of pretending it is zero.
 */
export interface BucketContext {
  /** Device calendar date, `YYYY-MM-DD`. */
  readonly today: string;
  /** Inclusive last date with confirmed complete data, or `null` when unknown. */
  readonly coverageEnd: string | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

function utcOf(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

function dateOf(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}

/** Whether `value` is a real calendar date in `YYYY-MM-DD` form. */
export function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;

  const utc = utcOf(value);

  return !Number.isNaN(utc) && dateOf(utc) === value;
}

/**
 * Throws a `RangeError` unless `value` is a real calendar date.
 *
 * These messages are developer-facing invariants: the interface validates its
 * date picker before it gets here, so a throw means a bug. They are still
 * plain translatable sentences, so an unexpected crash never shows Chinese
 * copy in an English UI.
 */
export function assertCalendarDate(value: string): string {
  if (!DATE_PATTERN.test(value)) throw new RangeError("日期格式应为 YYYY-MM-DD");
  if (!isCalendarDate(value)) throw new RangeError("日期不存在");

  return value;
}

/** Whether the span is well-formed and non-empty (`start < end`). */
export function isSpanValid(span: TimeSpan): boolean {
  return (
    isCalendarDate(span.start) && isCalendarDate(span.end) && span.start < span.end
  );
}

/**
 * Validate an externally provided span.
 *
 * Rejects reversed or empty spans rather than repairing them: a caller that
 * asks for `2026-10-20 … 2026-10-10` has a bug upstream, and silently swapping
 * the ends would hide it.
 */
export function parseTimeSpan(input: TimeSpan): TimeSpan {
  const start = assertCalendarDate(input.start);
  const end = assertCalendarDate(input.end);

  if (start >= end) {
    throw new RangeError("时间区间不能为空");
  }

  return { start, end };
}

/** Turn the legacy inclusive `{from, to}` pair into a half-open span. */
export function spanFromInclusiveDates(from: string, to: string): TimeSpan {
  const start = assertCalendarDate(from);
  const endDate = assertCalendarDate(to);

  if (start > endDate) {
    throw new RangeError("开始日期不能晚于结束日期");
  }

  return { start, end: addDays(endDate, 1) };
}

/** Turn a half-open span back into the legacy inclusive `{from, to}` pair. */
export function spanToInclusive(span: TimeSpan): { readonly from: string; readonly to: string } {
  const checked = parseTimeSpan(span);

  return { from: checked.start, to: addDays(checked.end, -1) };
}

/** Number of calendar dates inside a span. */
export function daysInSpan(span: TimeSpan): number {
  const checked = parseTimeSpan(span);

  return Math.round((utcOf(checked.end) - utcOf(checked.start)) / MILLISECONDS_PER_DAY);
}

/** Whether the span contains `date` under half-open semantics. */
export function spanContains(span: TimeSpan, date: string): boolean {
  assertCalendarDate(date);

  return span.start <= date && date < span.end;
}

/**
 * ISO-8601 day of week: Monday is 1, Sunday is 7.
 *
 * Week-numbering in ISO is tied to Thursday: a week belongs to the year that
 * contains its Thursday, which is why 2027-01-01 is still week 53 of 2026.
 */
export function isoDayOfWeek(date: string): number {
  const day = new Date(utcOf(assertCalendarDate(date))).getUTCDay();

  return day === 0 ? 7 : day;
}

/** The natural day containing `date`, half-open. */
export function daySpan(date: string): TimeSpan {
  const start = assertCalendarDate(date);

  return { start, end: addDays(start, 1) };
}

/** The natural Monday-start week containing `date`, half-open. */
export function weekSpan(date: string): TimeSpan {
  const start = addDays(assertCalendarDate(date), -(isoDayOfWeek(date) - 1));

  return { start, end: addDays(start, 7) };
}

/** The natural calendar month containing `date`, half-open. */
export function monthSpan(date: string): TimeSpan {
  const checked = assertCalendarDate(date);

  return { start: startOfMonth(checked), end: addDays(endOfMonth(checked), 1) };
}

/** The natural span of `granularity` containing `date`. */
export function bucketSpanOf(granularity: TimeGranularity, date: string): TimeSpan {
  switch (granularity) {
    case "day":
      return daySpan(date);
    case "week":
      return weekSpan(date);
    case "month":
      return monthSpan(date);
  }
}

/** Start date of the next natural span of the same granularity. */
export function nextBucketStart(granularity: TimeGranularity, start: string): string {
  const checked = assertCalendarDate(start);
  const span = bucketSpanOf(granularity, checked);

  if (span.start !== checked) {
    throw new RangeError("不是该时间桶的起点");
  }

  return span.end;
}

/** Alignment: the start date of the natural bucket of `granularity` holding `date`. */
export function bucketStartOf(granularity: TimeGranularity, date: string): string {
  return bucketSpanOf(granularity, date).start;
}

/** `YYYY-MM-DD` — the canonical bucket key for days. */
export function dayKey(date: string): string {
  return assertCalendarDate(date);
}

/** `YYYY-MM` — the canonical bucket key for months. */
export function monthKey(date: string): string {
  return assertCalendarDate(date).slice(0, 7);
}

/**
 * ISO week-year and week number of a date.
 *
 * The week-year can differ from the calendar year around New Year: 2025-12-29
 * belongs to 2026-W01, and 2027-01-01 belongs to 2026-W53.
 */
export function isoWeekOf(date: string): { readonly weekYear: number; readonly week: number } {
  const checked = assertCalendarDate(date);
  const thursday = addDays(checked, 4 - isoDayOfWeek(checked));
  const weekYear = Number(thursday.slice(0, 4));
  const januaryFirst = `${String(weekYear)}-01-01`;
  const daysFromJanuaryFirst = Math.round(
    (utcOf(thursday) - utcOf(januaryFirst)) / MILLISECONDS_PER_DAY,
  );

  return { weekYear, week: Math.floor(daysFromJanuaryFirst / 7) + 1 };
}

/** ISO week key: `YYYY-Www`, e.g. `2026-W44`. */
export function isoWeekKey(date: string): string {
  const { weekYear, week } = isoWeekOf(date);

  return `${String(weekYear)}-W${String(week).padStart(2, "0")}`;
}

/** The canonical bucket key for a date at the given granularity. */
export function bucketKeyOf(granularity: TimeGranularity, date: string): string {
  switch (granularity) {
    case "day":
      return dayKey(date);
    case "week":
      return isoWeekKey(date);
    case "month":
      return monthKey(date);
  }
}

/**
 * Classify one bucket.
 *
 * Precedence matters and is deliberate:
 *
 *  1. `future` — the bucket starts after today, nothing can be recorded yet.
 *  2. `in-progress` — the bucket contains today, so the natural period has not
 *     finished; this is true even when the analysis span itself ends before
 *     today (a "month so far" trend still carries an unfinished bucket).
 *  3. `unknown` — coverage is not tracked (`coverageEnd === null`) or does not
 *     reach the last analysed date of the bucket.
 *  4. `complete` — coverage reaches the end of the analysed slice.
 *
 * The state describes *data coverage of the analysed slice*, not whether the
 * natural calendar period finished. `clippedStart`/`clippedEnd` already say
 * that the slice is partial; `complete` on a clipped bucket means "the days
 * we were asked about are fully covered".
 */
export function classifyBucket(
  bucket: { readonly naturalSpan: TimeSpan; readonly span: TimeSpan },
  context: BucketContext,
): BucketState {
  const today = assertCalendarDate(context.today);
  const natural = parseTimeSpan(bucket.naturalSpan);
  const clipped = parseTimeSpan(bucket.span);

  if (natural.start > today) return "future";
  if (natural.start <= today && today < natural.end) return "in-progress";

  if (context.coverageEnd === null) return "unknown";

  const coverageEnd = assertCalendarDate(context.coverageEnd);
  const lastAnalysedDate = addDays(clipped.end, -1);

  if (coverageEnd < lastAnalysedDate) return "unknown";

  return "complete";
}

/**
 * Enumerate every bucket of `granularity` that intersects `span`.
 *
 * Buckets are naturally aligned — the first week starts on the Monday on or
 * before the range start, the first month on the 1st — because a week that
 * starts on a Wednesday is not a week. The first and last buckets are clipped
 * to the analysis span so their sums match the range total exactly.
 */
export function enumerateBuckets(
  granularity: TimeGranularity,
  span: TimeSpan,
  context: BucketContext,
): TimeBucket[] {
  const checked = parseTimeSpan(span);
  const buckets: TimeBucket[] = [];
  let cursor = bucketStartOf(granularity, checked.start);

  while (cursor < checked.end) {
    const naturalSpan = bucketSpanOf(granularity, cursor);
    const clippedSpan: TimeSpan = {
      start: naturalSpan.start < checked.start ? checked.start : naturalSpan.start,
      end: naturalSpan.end > checked.end ? checked.end : naturalSpan.end,
    };

    buckets.push({
      key: bucketKeyOf(granularity, naturalSpan.start),
      granularity,
      span: clippedSpan,
      naturalSpan,
      clippedStart: clippedSpan.start !== naturalSpan.start,
      clippedEnd: clippedSpan.end !== naturalSpan.end,
      state: classifyBucket({ naturalSpan, span: clippedSpan }, context),
    });

    cursor = naturalSpan.end;
  }

  return buckets;
}
