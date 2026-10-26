/**
 * Period comparison core (S17 workbench, Agent B / B-3).
 *
 * One resolver answers "which period is the one we compare against?" for the
 * four owner-specified comparison analyses:
 *
 *  * A01 上期收支比较 — current period vs the clearly defined previous one.
 *  * A02 环比增长率 — adjacent comparable period, same metric.
 *  * A03 同比增长率 — same period one calendar year earlier.
 *  * A05 本月至今同期比较 — month-to-date vs the previous month's same days.
 *
 * The owner's specification (§19–§23) is explicit that these are four
 * different questions and must not all be called "上个月比较". This module
 * therefore keeps the comparison kind, the resolved spans, the observation-day
 * counts, the alignment strategy and the "was either side clipped / still
 * running" facts in the result instead of flattening them into one growth
 * number.
 *
 * Three rules shape the arithmetic:
 *
 * **Spans are half-open `[start, end)`.** Dates are `YYYY-MM-DD` business
 * dates (`occurredLocalDate`); nothing here converts through a time zone.
 *
 * **Money is exact.** Amounts are summed as integer minor units (bigint) and
 * leave this module as decimal strings; growth is a signed numerator over a
 * positive denominator, never a floating-point percentage.
 *
 * **Zero and unknown are distinct.** A previous period of zero is not "infinite
 * growth": the absolute difference is still reported while the relative rate is
 * marked unavailable with a reason. Missing data coverage makes the amount
 * unknown (`null`), never zero.
 */
import { addDays } from "./stats.js";
import {
  assertCalendarDate,
  daysInSpan,
  isSpanValid,
  monthSpan,
  spanContains,
  weekSpan,
  type TimeSpan,
} from "./timeCalendar.js";

/** Version of the comparison contract; bump on any semantic change. */
export const PERIOD_COMPARISON_VERSION = "s17-b-period-comparison-v1" as const;

/** Which comparison question is being asked. */
export type ComparisonKind =
  | "previous-period"
  | "month-over-month"
  | "year-over-year"
  | "month-to-date";

/** A05 alignment policy for months of different lengths (owner §23). */
export type MonthToDatePolicy = "same-day-index" | "equal-length-window";

/** The two flow metrics that are always compared as a pair. */
export type ComparisonMetric = "expense" | "income";

/** Minimal transaction projection needed by the comparison core. */
export interface ComparisonEntry {
  readonly occurredLocalDate: string;
  readonly kind: ComparisonMetric;
  readonly amountMinor: bigint | number;
}

/** The request handed to the resolver. */
export interface ComparisonRequest {
  readonly kind: ComparisonKind;
  /** Required for every kind except `month-to-date` (derived from `today`). */
  readonly current?: TimeSpan;
  /** The device-local calendar date, `YYYY-MM-DD`; never a server "now". */
  readonly today: string;
  /** Only meaningful for `month-to-date`; defaults to `same-day-index`. */
  readonly monthToDatePolicy?: MonthToDatePolicy;
}

/** How the previous span was derived. */
export type ComparisonMode =
  | "natural-month"
  | "natural-week"
  | "natural-day"
  | "equal-length"
  | "same-day-index"
  | "calendar-year-shift";

/** Machine-readable notes the UI must surface next to the numbers. */
export type ComparisonNote =
  | "current-period-in-progress"
  | "current-day-in-progress"
  | "previous-period-clipped"
  | "previous-period-crosses-month"
  | "length-mismatch"
  | "leap-day-fallback"
  | "no-previous-period";

/** A date that does not exist in the shifted year and the date used instead. */
export interface LeapDayFallback {
  readonly date: string;
  readonly alignedTo: string;
}

/**
 * The resolved comparison: both spans plus every fact needed to label it.
 *
 * `periodSpan` is the period the user asked about (a full natural month, a
 * custom range, …). `current` is the observation window that is actually
 * summed: when the period is still running, it is clipped to `today`. For a
 * finished period both are the same span.
 */
export interface ComparisonResolution {
  readonly version: typeof PERIOD_COMPARISON_VERSION;
  readonly kind: ComparisonKind;
  readonly periodSpan: TimeSpan;
  readonly current: TimeSpan;
  readonly previous: TimeSpan | null;
  /** Days in `periodSpan` (the requested period, before clipping to today). */
  readonly periodDays: number;
  /** Days actually summed on the current side (`current`). */
  readonly currentDays: number;
  readonly previousDays: number;
  readonly sameLength: boolean;
  readonly currentInProgress: boolean;
  readonly currentDayInProgress: boolean;
  readonly previousClipped: boolean;
  readonly mode: ComparisonMode;
  readonly policyId: string;
  readonly notes: readonly ComparisonNote[];
  readonly leapDayFallbacks: readonly LeapDayFallback[];
}

/** Why a relative growth rate cannot be stated. */
export type GrowthUnavailableReason =
  | "previous-zero"
  | "both-zero"
  | "previous-negative"
  | "previous-unknown"
  | "current-unknown";

/**
 * A relative growth rate: (current - previous) / previous, exactly.
 * No percentage is ever produced here — the caller formats the fraction.
 */
export type GrowthResult =
  | {
      readonly state: "computed";
      /** Signed numerator `current - previous`, in minor units. */
      readonly numeratorMinor: string;
      /** Positive denominator `previous`, in minor units. */
      readonly denominatorMinor: string;
    }
  | { readonly state: "unavailable"; readonly reason: GrowthUnavailableReason };

/** One metric of the comparison. */
export interface SideComparison {
  readonly metric: ComparisonMetric;
  /** Exact total as decimal minor units; `null` when data coverage is unknown. */
  readonly currentMinor: string | null;
  readonly previousMinor: string | null;
  /** `current - previous`; `null` unless both sides are known. */
  readonly differenceMinor: string | null;
  readonly transactionCountCurrent: number | null;
  readonly transactionCountPrevious: number | null;
  /** True when both observation windows are fully covered by known data. */
  readonly complete: boolean;
  readonly growth: GrowthResult;
}

/** The full A01/A02/A03/A05 result. */
export interface ComparisonResult {
  readonly version: typeof PERIOD_COMPARISON_VERSION;
  readonly kind: ComparisonKind;
  readonly resolution: ComparisonResolution;
  readonly income: SideComparison;
  readonly expense: SideComparison;
}

/** Optional data-coverage context (offline completeness). */
export interface ComparisonOptions {
  /**
   * Last date whose data is known to be complete, or `null` when the data
   * layer cannot say. `null` means "no coverage constraint", never "unknown".
   */
  readonly coverageEnd?: string | null;
}

// ---------------------------------------------------------------------------
// Small calendar helpers (local, so the module only depends on the contract)
// ---------------------------------------------------------------------------

/** Compare two `YYYY-MM-DD` strings without constructing instants. */
function compareDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function lastInclusive(span: TimeSpan): string {
  return addDays(span.end, -1);
}

function shiftYearDate(date: string, years: number): {
  readonly date: string;
  readonly fallback: LeapDayFallback | null;
} {
  const value = assertCalendarDate(date);
  const year = Number(value.slice(0, 4)) + years;
  const month = value.slice(5, 7);
  const day = Number(value.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, Number(month), 0)).getUTCDate();
  const alignedDay = Math.min(day, lastDay);
  const alignedTo = `${String(year).padStart(4, "0")}-${month}-${String(alignedDay).padStart(2, "0")}`;
  return {
    date: alignedTo,
    fallback: alignedDay === day ? null : { date: value, alignedTo },
  };
}

function shiftSpanYear(span: TimeSpan): {
  readonly previous: TimeSpan;
  readonly fallbacks: readonly LeapDayFallback[];
} {
  const start = shiftYearDate(span.start, -1);
  const end = shiftYearDate(span.end, -1);
  const fallbacks: LeapDayFallback[] = [];
  if (start.fallback !== null) fallbacks.push(start.fallback);
  if (end.fallback !== null) fallbacks.push(end.fallback);
  return { previous: { start: start.date, end: end.date }, fallbacks };
}

function isNaturalMonth(span: TimeSpan): boolean {
  const month = monthSpan(span.start);
  return month.start === span.start && month.end === span.end;
}

function isNaturalWeek(span: TimeSpan): boolean {
  const week = weekSpan(span.start);
  return week.start === span.start && week.end === span.end;
}

function isNaturalDay(span: TimeSpan): boolean {
  return span.end === addDays(span.start, 1);
}

/** Days elapsed from `start` through `today`, both inclusive. */
function elapsedDays(start: string, today: string): number {
  return daysInSpan({ start, end: addDays(today, 1) });
}

/**
 * The previous unit's first `days` days, clipped to that unit when it is
 * shorter (February, a short month, …), recording whether anything was clipped.
 */
function sameDayIndexWindow(
  unitStart: string,
  days: number,
  unitEnd: string,
): { readonly span: TimeSpan; readonly clipped: boolean } {
  const wantedEnd = addDays(unitStart, days);
  if (compareDates(wantedEnd, unitEnd) > 0) {
    return { span: { start: unitStart, end: unitEnd }, clipped: true };
  }
  return { span: { start: unitStart, end: wantedEnd }, clipped: false };
}

interface ResolvedShape {
  readonly periodSpan: TimeSpan;
  readonly current: TimeSpan;
  readonly previous: TimeSpan | null;
  readonly currentDays: number;
  readonly previousDays: number;
  readonly mode: ComparisonMode;
  readonly policyId: string;
  readonly notes: ComparisonNote[];
  readonly leapDayFallbacks: readonly LeapDayFallback[];
  readonly currentInProgress: boolean;
  readonly currentDayInProgress: boolean;
  readonly previousClipped: boolean;
}

function shapeOf(
  periodSpan: TimeSpan,
  current: TimeSpan,
  previous: TimeSpan | null,
  mode: ComparisonMode,
  policyId: string,
  notes: ComparisonNote[],
  extras: {
    readonly currentInProgress: boolean;
    readonly currentDayInProgress: boolean;
    readonly previousClipped: boolean;
    readonly leapDayFallbacks?: readonly LeapDayFallback[];
  },
): ResolvedShape {
  const currentDays = daysInSpan(current);
  const previousDays = previous === null ? 0 : daysInSpan(previous);
  if (previous !== null && previousDays !== currentDays) notes.push("length-mismatch");
  return {
    periodSpan,
    current,
    previous,
    currentDays,
    previousDays,
    mode,
    policyId,
    notes,
    leapDayFallbacks: extras.leapDayFallbacks ?? [],
    currentInProgress: extras.currentInProgress,
    currentDayInProgress: extras.currentDayInProgress,
    previousClipped: extras.previousClipped,
  };
}

/** Finished natural month → previous natural month. */
function finishedNaturalMonth(current: TimeSpan, kind: ComparisonKind): ResolvedShape {
  const previous = monthSpan(addDays(current.start, -1));
  return shapeOf(current, current, previous, "natural-month", "s17-b-natural-month-v1", [], {
    currentInProgress: false,
    currentDayInProgress: false,
    previousClipped: false,
  });
}

/** Running natural month → previous month's same-day-index window. */
function runningNaturalMonth(
  current: TimeSpan,
  today: string,
  kind: ComparisonKind,
): ResolvedShape {
  const days = elapsedDays(current.start, today);
  const previousMonth = monthSpan(addDays(current.start, -1));
  const window = sameDayIndexWindow(previousMonth.start, days, previousMonth.end);
  const notes: ComparisonNote[] = ["current-period-in-progress", "current-day-in-progress"];
  if (window.clipped) notes.push("previous-period-clipped");
  return shapeOf(
    current,
    { start: current.start, end: addDays(today, 1) },
    window.span,
    "same-day-index",
    "s17-b-prev-same-day-index-v1",
    notes,
    {
      currentInProgress: true,
      currentDayInProgress: true,
      previousClipped: window.clipped,
    },
  );
}

/** Finished natural week → previous natural week. */
function finishedNaturalWeek(current: TimeSpan, kind: ComparisonKind): ResolvedShape {
  const previous = weekSpan(addDays(current.start, -7));
  return shapeOf(current, current, previous, "natural-week", "s17-b-natural-week-v1", [], {
    currentInProgress: false,
    currentDayInProgress: false,
    previousClipped: false,
  });
}

/** Running natural week → previous week's same-day-index window. */
function runningNaturalWeek(current: TimeSpan, today: string, kind: ComparisonKind): ResolvedShape {
  const days = elapsedDays(current.start, today);
  const previousWeek = weekSpan(addDays(current.start, -7));
  const window = sameDayIndexWindow(previousWeek.start, days, previousWeek.end);
  const notes: ComparisonNote[] = ["current-period-in-progress", "current-day-in-progress"];
  if (window.clipped) notes.push("previous-period-clipped");
  return shapeOf(
    current,
    { start: current.start, end: addDays(today, 1) },
    window.span,
    "same-day-index",
    "s17-b-prev-same-day-index-v1",
    notes,
    { currentInProgress: true, currentDayInProgress: true, previousClipped: window.clipped },
  );
}

/** Same calendar dates one year earlier, Feb 29 clamped to Feb 28. */
function yearShifted(current: TimeSpan, periodSpan: TimeSpan, inProgressNote: boolean): ResolvedShape {
  const shift = shiftSpanYear(current);
  const notes: ComparisonNote[] = [];
  if (inProgressNote) notes.push("current-period-in-progress", "current-day-in-progress");
  if (shift.fallbacks.length > 0) notes.push("leap-day-fallback");
  return shapeOf(periodSpan, current, shift.previous, "calendar-year-shift", "s17-b-yoy-calendar-shift-v1", notes, {
    currentInProgress: inProgressNote,
    currentDayInProgress: inProgressNote,
    previousClipped: false,
    leapDayFallbacks: shift.fallbacks,
  });
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve which span is compared against the request.
 *
 * Rules follow owner §19 "比较期选择" and §23 "月份长度不同":
 *
 *  * finished natural month → previous natural month;
 *  * running natural month/week → previous unit's same-day-index window
 *    (clipped when that month is shorter; never invent February 30th);
 *  * finished natural week → previous natural week;
 *  * single day → previous day;
 *  * year-over-year → same dates one year earlier; a running current period is
 *    first clipped to its observation window so 27 days are never compared
 *    with a finished 31-day month;
 *  * anything else → the adjacent equal-length span.
 */
export function resolveComparison(request: ComparisonRequest): ComparisonResolution {
  const today = assertCalendarDate(request.today);
  if (!isComparisonKind(request.kind)) {
    throw new RangeError(`unknown comparison kind: ${String(request.kind)}`);
  }

  const current: TimeSpan | undefined = request.current;
  const baseNotes: ComparisonNote[] = [];

  if (request.kind === "month-to-date") {
    const month = monthSpan(today);
    const periodSpan: TimeSpan = month;
    const current: TimeSpan = { start: month.start, end: addDays(today, 1) };
    const days = daysInSpan(current);
    const previousMonth = monthSpan(addDays(month.start, -1));
    const policy = request.monthToDatePolicy ?? "same-day-index";
    const notes: ComparisonNote[] = ["current-period-in-progress", "current-day-in-progress"];
    let previous: TimeSpan;
    let previousClipped = false;
    let mode: ComparisonMode;

    if (policy === "same-day-index") {
      const window = sameDayIndexWindow(previousMonth.start, days, previousMonth.end);
      previous = window.span;
      previousClipped = window.clipped;
      mode = "same-day-index";
      if (window.clipped) notes.push("previous-period-clipped");
    } else {
      previous = { start: previousMonth.start, end: addDays(previousMonth.start, days) };
      mode = "equal-length";
      if (compareDates(previous.end, previousMonth.end) > 0) {
        notes.push("previous-period-crosses-month");
      }
    }

    const shape = shapeOf(periodSpan, current, previous, mode, `s17-b-mdtd-${policy}-v1`, notes, {
      currentInProgress: true,
      currentDayInProgress: true,
      previousClipped,
    });
    return toResolution(request.kind, periodSpan, shape);
  }

  if (current === undefined || !isSpanValid(current)) {
    throw new RangeError("current span is required and must be a valid half-open span");
  }

  // The observation window: a period containing `today` is still running and is
  // clipped to the days that have actually elapsed.
  const running = spanContains(current, today) || compareDates(current.start, today) === 0;
  const observed: TimeSpan = running
    ? { start: current.start, end: addDays(today, 1) }
    : current;

  if (request.kind === "year-over-year") {
    const shape = yearShifted(observed, current, running);
    return toResolution(request.kind, current, shape);
  }

  if (isNaturalMonth(current)) {
    const shape = running
      ? runningNaturalMonth(current, today, request.kind)
      : finishedNaturalMonth(current, request.kind);
    return toResolution(request.kind, current, shape);
  }

  if (isNaturalWeek(current)) {
    const shape = running
      ? runningNaturalWeek(current, today, request.kind)
      : finishedNaturalWeek(current, request.kind);
    return toResolution(request.kind, current, shape);
  }

  if (isNaturalDay(current)) {
    const previous = { start: addDays(current.start, -1), end: current.start };
    const notes: ComparisonNote[] = running
      ? ["current-period-in-progress", "current-day-in-progress"]
      : [];
    const shape = shapeOf(current, observed, previous, "natural-day", "s17-b-natural-day-v1", notes, {
      currentInProgress: running,
      currentDayInProgress: running,
      previousClipped: false,
    });
    return toResolution(request.kind, current, shape);
  }

  // Arbitrary range: the adjacent equally long span immediately before it.
  // A running range is compared on its observation window, so the previous
  // side is the same number of elapsed days immediately before it — never 8
  // elapsed days against a finished 21-day window.
  const days = daysInSpan(observed);
  const previous = { start: addDays(observed.start, -days), end: observed.start };
  const notes: ComparisonNote[] = running
    ? ["current-period-in-progress", "current-day-in-progress"]
    : [];
  const shape = shapeOf(current, observed, previous, "equal-length", "s17-b-equal-length-v1", notes, {
    currentInProgress: running,
    currentDayInProgress: running,
    previousClipped: false,
  });
  return toResolution(request.kind, current, shape);
}

function toResolution(
  kind: ComparisonKind,
  periodSpan: TimeSpan,
  shape: ResolvedShape,
): ComparisonResolution {
  return {
    version: PERIOD_COMPARISON_VERSION,
    kind,
    periodSpan,
    current: shape.current,
    previous: shape.previous,
    periodDays: daysInSpan(periodSpan),
    currentDays: shape.currentDays,
    previousDays: shape.previousDays,
    sameLength: shape.previous !== null && shape.previousDays === shape.currentDays,
    currentInProgress: shape.currentInProgress,
    currentDayInProgress: shape.currentDayInProgress,
    previousClipped: shape.previousClipped,
    mode: shape.mode,
    policyId: shape.policyId,
    notes: shape.notes,
    leapDayFallbacks: shape.leapDayFallbacks,
  };
}

/** Validate a request without throwing; useful for UI/API guards. */
export function isComparisonRequestValid(request: ComparisonRequest): boolean {
  try {
    if (!isComparisonKind(request.kind)) return false;
    assertCalendarDate(request.today);
    if (request.kind !== "month-to-date") {
      const span = request.current;
      if (span === undefined || !isSpanValid(span) || span.start >= span.end) return false;
    }
    if (
      request.monthToDatePolicy !== undefined &&
      request.monthToDatePolicy !== "same-day-index" &&
      request.monthToDatePolicy !== "equal-length-window"
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isComparisonKind(value: string): value is ComparisonKind {
  return (
    value === "previous-period" ||
    value === "month-over-month" ||
    value === "year-over-year" ||
    value === "month-to-date"
  );
}

// ---------------------------------------------------------------------------
// Sums and comparison
// ---------------------------------------------------------------------------

function toMinor(amount: bigint | number): bigint {
  if (typeof amount === "bigint") return amount;
  if (!Number.isInteger(amount)) {
    throw new RangeError("金额必须是整数（以分为单位）");
  }
  return BigInt(amount);
}

interface SpanSum {
  readonly minor: bigint;
  readonly count: number;
}

function sumSpan(
  entries: readonly ComparisonEntry[],
  span: TimeSpan,
  metric: ComparisonMetric,
): SpanSum {
  let minor = 0n;
  let count = 0;
  for (const entry of entries) {
    if (entry.kind !== metric) continue;
    if (!spanContains(span, entry.occurredLocalDate)) continue;
    minor += toMinor(entry.amountMinor);
    count += 1;
  }
  return { minor, count };
}

function coverageComplete(span: TimeSpan, coverageEnd: string | null): boolean {
  if (coverageEnd === null) return true;
  return compareDates(coverageEnd, lastInclusive(span)) >= 0;
}

function growthOf(current: bigint | null, previous: bigint | null): GrowthResult {
  if (current === null) return { state: "unavailable", reason: "current-unknown" };
  if (previous === null) return { state: "unavailable", reason: "previous-unknown" };
  if (previous === 0n) {
    return {
      state: "unavailable",
      reason: current === 0n ? "both-zero" : "previous-zero",
    };
  }
  if (previous < 0n) return { state: "unavailable", reason: "previous-negative" };
  return {
    state: "computed",
    numeratorMinor: (current - previous).toString(),
    denominatorMinor: previous.toString(),
  };
}

function sideOf(
  entries: readonly ComparisonEntry[],
  resolution: ComparisonResolution,
  metric: ComparisonMetric,
  coverageEnd: string | null,
): SideComparison {
  const currentComplete = coverageComplete(resolution.current, coverageEnd);
  const previousComplete =
    resolution.previous === null ? false : coverageComplete(resolution.previous, coverageEnd);
  const current = currentComplete ? sumSpan(entries, resolution.current, metric) : null;
  const previous =
    resolution.previous !== null && previousComplete
      ? sumSpan(entries, resolution.previous, metric)
      : null;
  const currentMinor = current === null ? null : current.minor.toString();
  const previousMinor = previous === null ? null : previous.minor.toString();
  const differenceMinor =
    current !== null && previous !== null ? (current.minor - previous.minor).toString() : null;
  return {
    metric,
    currentMinor,
    previousMinor,
    differenceMinor,
    transactionCountCurrent: current === null ? null : current.count,
    transactionCountPrevious: previous === null ? null : previous.count,
    complete: currentComplete && previousComplete,
    growth: growthOf(
      current === null ? null : current.minor,
      previous === null ? null : previous.minor,
    ),
  };
}

/**
 * Compute the A01/A02/A03/A05 comparison. Both income and expense are always
 * produced: the caller chooses which side(s) to show, and the absolute values
 * stay exact decimal strings.
 */
export function computePeriodComparison(
  entries: readonly ComparisonEntry[],
  request: ComparisonRequest,
  options: ComparisonOptions = {},
): ComparisonResult {
  const resolution = resolveComparison(request);
  const coverageEnd =
    options.coverageEnd === undefined || options.coverageEnd === null
      ? null
      : assertCalendarDate(options.coverageEnd);
  return {
    version: PERIOD_COMPARISON_VERSION,
    kind: request.kind,
    resolution,
    income: sideOf(entries, resolution, "income", coverageEnd),
    expense: sideOf(entries, resolution, "expense", coverageEnd),
  };
}
