/**
 * Multi-month comparison core (S17 workbench, Agent B / B-3, A04).
 *
 * "多个月份比较" is not a continuous time trend: the user picks a set of
 * natural months (e.g. January, March, June, September) and the answer keeps
 * every month as an explicit natural calendar month with its own exact amount,
 * coverage state, comparability flag and source range.
 *
 * Owner §22 sets three rules this module encodes:
 *
 *  * every point is a *natural* month (`[first day, first day of next month)`),
 *    never a synthetic 30-day window;
 *  * a month whose data is incomplete must be flagged and must not silently
 *    join a normal ranking as if it were complete;
 *  * selecting the same month in different years must keep the year visible —
 *    keys are `YYYY-MM`, so `2026-01` and `2027-01` stay distinct.
 *
 * Amounts are exact integer minor units summed per month and emitted as
 * decimal strings. Unknown coverage yields `null`, never zero.
 */
import { addDays } from "./stats.js";
import {
  assertCalendarDate,
  daysInSpan,
  monthSpan,
  type TimeSpan,
} from "./timeCalendar.js";

/** Version of the multi-month contract; bump on any semantic change. */
export const MULTI_MONTH_COMPARISON_VERSION = "s17-b-multi-month-comparison-v1" as const;

/** The metric being compared across the selected months. */
export type MonthMetric = "expense" | "income";

/** Minimal transaction projection needed by this analysis. */
export interface MonthEntry {
  readonly occurredLocalDate: string;
  readonly kind: MonthMetric;
  readonly amountMinor: bigint | number;
}

/** Coverage state of one selected month. */
export type MonthPointState = "complete" | "in-progress" | "future" | "unknown" | "unavailable";

/** Why a month cannot be compared at all. */
export type MonthUnavailableReason = "invalid-month" | "future-month";

/** One natural month of the comparison. */
export interface MonthComparisonPoint {
  /** `YYYY-MM`, always carrying the year (owner §22: never hide the year). */
  readonly month: string;
  /** Half-open natural month span. */
  readonly span: TimeSpan;
  /** Exact total as decimal minor units; `null` when unknown or unavailable. */
  readonly amountMinor: string | null;
  readonly transactionCount: number | null;
  readonly state: MonthPointState;
  /** Only complete months are comparable / eligible for the ranking. */
  readonly comparable: boolean;
  readonly unavailableReason: MonthUnavailableReason | null;
}

/** The request handed to the analysis. */
export interface MonthComparisonRequest {
  /** Month keys, `YYYY-MM`. Order is preserved; duplicates are dropped. */
  readonly months: readonly string[];
  readonly metric: MonthMetric;
  /** Device-local business date, `YYYY-MM-DD`. */
  readonly today: string;
}

/** Optional data-coverage context (offline completeness). */
export interface MonthComparisonOptions {
  /** Last date whose data is known to be complete, or `null` for no constraint. */
  readonly coverageEnd?: string | null;
}

/** One entry of the strict "complete months only" ranking. */
export interface MonthRankingEntry {
  readonly month: string;
  readonly amountMinor: string;
  /** 1-based rank, descending by amount. */
  readonly rank: number;
}

/** Notes the UI must surface next to the result. */
export type MonthComparisonNote =
  | "cross-year"
  | "incomplete-months"
  | "duplicates-ignored"
  | "no-complete-months";

/** The full A04 result. */
export interface MultiMonthComparisonResult {
  readonly version: typeof MULTI_MONTH_COMPARISON_VERSION;
  readonly metric: MonthMetric;
  readonly months: readonly MonthComparisonPoint[];
  /** Sum of the months whose amount is known; `null` if any month is unknown. */
  readonly totalMinor: string | null;
  /** True only when every selected month is a complete natural month. */
  readonly complete: boolean;
  readonly completeMonths: number;
  readonly inProgressMonths: number;
  readonly unknownMonths: number;
  readonly futureMonths: number;
  /** Strict ranking of complete months only; `null` when none is complete. */
  readonly ranking: readonly MonthRankingEntry[] | null;
  readonly maxMonth: string | null;
  readonly minMonth: string | null;
  readonly crossYear: boolean;
  readonly notes: readonly MonthComparisonNote[];
  /** Union of the selected natural months; `null` when no valid month remains. */
  readonly source: TimeSpan | null;
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True when `value` is a `YYYY-MM` month key. */
export function isMonthKey(value: string): boolean {
  return MONTH_KEY.test(value);
}

/**
 * Keep the first occurrence of each valid month key and drop duplicates.
 * Invalid strings are kept (they are reported as `unavailable` points instead
 * of being silently discarded — an invalid input must stay visible).
 */
export function normalizeMonthKeys(months: readonly string[]): {
  readonly months: readonly string[];
  readonly duplicatesRemoved: number;
} {
  const seen = new Set<string>();
  const kept: string[] = [];
  let duplicatesRemoved = 0;
  for (const month of months) {
    if (seen.has(month)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(month);
    kept.push(month);
  }
  return { months: kept, duplicatesRemoved };
}

/** Validate a request without throwing. */
export function isMultiMonthComparisonValid(request: MonthComparisonRequest): boolean {
  try {
    assertCalendarDate(request.today);
    if (request.metric !== "expense" && request.metric !== "income") return false;
    if (!Array.isArray(request.months) || request.months.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

function toMinor(amount: bigint | number): bigint {
  if (typeof amount === "bigint") return amount;
  if (!Number.isInteger(amount)) {
    throw new RangeError("金额必须是整数（以分为单位）");
  }
  return BigInt(amount);
}

function compareDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function lastInclusive(span: TimeSpan): string {
  return addDays(span.end, -1);
}

interface MonthSum {
  readonly minor: bigint;
  readonly count: number;
}

function sumMonth(entries: readonly MonthEntry[], span: TimeSpan, metric: MonthMetric): MonthSum {
  let minor = 0n;
  let count = 0;
  for (const entry of entries) {
    if (entry.kind !== metric) continue;
    if (entry.occurredLocalDate < span.start || entry.occurredLocalDate >= span.end) continue;
    minor += toMinor(entry.amountMinor);
    count += 1;
  }
  return { minor, count };
}

/**
 * Compare the selected natural months.
 *
 * - invalid key → `unavailable` (visible, not dropped);
 * - month starting after the current month → `future`, `amountMinor = null`;
 * - current month → `in-progress`, amount of the elapsed part is reported but
 *   the month is not comparable and never enters the strict ranking;
 * - coverage ends before the month's last day → `unknown`, `amountMinor = null`;
 * - otherwise complete.
 */
export function computeMultiMonthComparison(
  entries: readonly MonthEntry[],
  request: MonthComparisonRequest,
  options: MonthComparisonOptions = {},
): MultiMonthComparisonResult {
  const today = assertCalendarDate(request.today);
  const coverageEnd =
    options.coverageEnd === undefined || options.coverageEnd === null
      ? null
      : assertCalendarDate(options.coverageEnd);
  const currentMonthStart = monthSpan(today).start;
  const { months: keys, duplicatesRemoved } = normalizeMonthKeys(request.months);

  const points: MonthComparisonPoint[] = [];
  let completeMonths = 0;
  let inProgressMonths = 0;
  let unknownMonths = 0;
  let futureMonths = 0;
  let totalMinor = 0n;
  let totalKnown = true;

  for (const key of keys) {
    if (!isMonthKey(key)) {
      points.push({
        month: key,
        span: { start: key, end: key },
        amountMinor: null,
        transactionCount: null,
        state: "unavailable",
        comparable: false,
        unavailableReason: "invalid-month",
      });
      totalKnown = false;
      continue;
    }
    const span = monthSpan(`${key}-01`);
    if (compareDates(span.start, currentMonthStart) > 0) {
      points.push({
        month: key,
        span,
        amountMinor: null,
        transactionCount: null,
        state: "future",
        comparable: false,
        unavailableReason: "future-month",
      });
      futureMonths += 1;
      totalKnown = false;
      continue;
    }
    const isCurrentMonth = span.start === currentMonthStart;
    const coverageOk = coverageEnd === null || compareDates(coverageEnd, lastInclusive(span)) >= 0;
    if (!coverageOk) {
      points.push({
        month: key,
        span,
        amountMinor: null,
        transactionCount: null,
        state: "unknown",
        comparable: false,
        unavailableReason: null,
      });
      unknownMonths += 1;
      totalKnown = false;
      continue;
    }
    const sum = sumMonth(entries, span, request.metric);
    const state: MonthPointState = isCurrentMonth ? "in-progress" : "complete";
    if (isCurrentMonth) inProgressMonths += 1;
    else completeMonths += 1;
    totalMinor += sum.minor;
    points.push({
      month: key,
      span,
      amountMinor: sum.minor.toString(),
      transactionCount: sum.count,
      state,
      comparable: state === "complete",
      unavailableReason: null,
    });
  }

  const years = new Set(points.filter((point) => isMonthKey(point.month)).map((point) => point.month.slice(0, 4)));
  const crossYear = years.size > 1;

  const completePoints = points.filter((point) => point.state === "complete");
  const ranking: MonthRankingEntry[] | null =
    completePoints.length === 0
      ? null
      : [...completePoints]
          .sort((a, b) => {
            const left = BigInt(a.amountMinor ?? "0");
            const right = BigInt(b.amountMinor ?? "0");
            if (left === right) return 0;
            return left > right ? -1 : 1;
          })
          .map((point, index) => ({
            month: point.month,
            amountMinor: point.amountMinor ?? "0",
            rank: index + 1,
          }));

  const notes: MonthComparisonNote[] = [];
  if (crossYear) notes.push("cross-year");
  if (duplicatesRemoved > 0) notes.push("duplicates-ignored");
  if (unknownMonths + futureMonths > 0 || inProgressMonths > 0) notes.push("incomplete-months");
  if (completePoints.length === 0) notes.push("no-complete-months");

  const validSpans = points
    .filter((point) => isMonthKey(point.month))
    .map((point) => point.span)
    .sort((a, b) => compareDates(a.start, b.start));
  const source: TimeSpan | null =
    validSpans.length === 0
      ? null
      : { start: validSpans[0]!.start, end: validSpans[validSpans.length - 1]!.end };

  const maxPoint = completePoints.reduce<MonthComparisonPoint | null>((best, point) => {
    if (best === null) return point;
    return BigInt(point.amountMinor ?? "0") > BigInt(best.amountMinor ?? "0") ? point : best;
  }, null);
  const minPoint = completePoints.reduce<MonthComparisonPoint | null>((best, point) => {
    if (best === null) return point;
    return BigInt(point.amountMinor ?? "0") < BigInt(best.amountMinor ?? "0") ? point : best;
  }, null);

  return {
    version: MULTI_MONTH_COMPARISON_VERSION,
    metric: request.metric,
    months: points,
    totalMinor: totalKnown ? totalMinor.toString() : null,
    complete: completeMonths === points.length && points.length > 0,
    completeMonths,
    inProgressMonths,
    unknownMonths,
    futureMonths,
    ranking,
    maxMonth: maxPoint === null ? null : maxPoint.month,
    minMonth: minPoint === null ? null : minPoint.month,
    crossYear,
    notes,
    source,
  };
}

/** Days in a month key; `null` for invalid keys. */
export function daysInMonth(month: string): number | null {
  if (!isMonthKey(month)) return null;
  return daysInSpan(monthSpan(`${month}-01`));
}
