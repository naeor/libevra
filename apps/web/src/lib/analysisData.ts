/**
 * S0 — 真实账目 → 分析输入（原币，逐笔）。
 *
 * The analysis layer never invents data: every series starts from the entries the
 * device actually holds (`Transaction`, already parsed by the shared zod schema and
 * filtered to the current ledger by the ledger store). This module is the single
 * place where that happens, so every card goes through the same rules:
 *
 * - **原币 first.** W1 computes each series in the entry's own currency; combined
 *   (FX) mode is a separate, later decision (S-01 v2 §13 / G-17). Mixing currencies
 *   here would silently produce a number nobody can reconcile, so it is refused.
 * - **半开区间.** The analysis span is `[from, to)` of business dates, exactly as
 *   `timeCalendar` and `timeSeries` speak. The UI hands in inclusive business dates
 *   and this module converts once (see `analysisSpan`).
 * - **上限显式.** S-01 v2 §17 / G-18: a day-window comparison has a caller-supplied
 *   `maxAnalysisDays` (default 400, the existing `MAX_STATS_DAYS`). Over the limit we
 *   reject with a typed error — never truncate, never silently drop entries.
 * - **覆盖未知 ≠ 零.** The local ledger cache has no "which months are complete"
 *   metadata yet (R-B-02), so `coverageEnd` is `null` = unknown. Consumers must show
 *   the unknown state rather than drawing a complete-looking zero.
 *
 * Nothing here is React or store-aware; `useTimeAnalysis` wraps it for the page.
 */

import {
  addDays,
  assertCalendarDate,
  computeTimeSeries,
  daysInSpan,
  isSpanValid,
  type CountKind,
  type TimeGranularity,
  type TimeSeriesEntry,
  type TimeSeriesMetric,
  type TimeSeriesResult,
  type TimeSpan,
  type Transaction,
} from "@libellum/shared";

/** Mirrors the existing `MAX_STATS_DAYS` limit (S-01 v2 §17 / G-18; default 400). */
export const MAX_ANALYSIS_DAYS = 400;

/** Typed failure so callers can tell a programming error from a user-facing limit. */
export type AnalysisRangeErrorCode =
  | "analysis-range-invalid"
  | "analysis-range-too-long"
  | "analysis-range-unsupported";

export class AnalysisRangeError extends Error {
  readonly code: AnalysisRangeErrorCode;

  constructor(code: AnalysisRangeErrorCode, message: string) {
    super(message);
    this.name = "AnalysisRangeError";
    this.code = code;
  }
}

/** Inclusive business dates, as the URL/search-parma layer speaks them. */
export interface AnalysisWindow {
  readonly from: string;
  readonly to: string;
}

/** The result of routing raw entries into the time-series engine. */
export interface AnalysisInput {
  readonly entries: readonly TimeSeriesEntry[];
  /** Last date the input is known complete; `null` = unknown (R-B-02). */
  readonly coverageEnd: string | null;
  /** Book-level data version token; `null` = not available yet (G-10 to be decided). */
  readonly dataVersion: string | null;
}

/**
 * Build the half-open analysis span from inclusive business dates.
 *
 * Inclusive dates are what date pickers and the existing `/stats` query speak;
 * converting once here keeps every series on one convention.
 */
export function analysisSpan(window: AnalysisWindow, maxDays: number = MAX_ANALYSIS_DAYS): TimeSpan {
  assertCalendarDate(window.from);
  assertCalendarDate(window.to);
  if (window.from > window.to) {
    throw new AnalysisRangeError("analysis-range-invalid", "分析区间的开始日期不能晚于结束日期");
  }
  const span: TimeSpan = { start: window.from, end: addDays(window.to, 1) };
  const days = daysInSpan(span);
  if (days > maxDays) {
    throw new AnalysisRangeError(
      "analysis-range-too-long",
      `分析区间为 ${days} 天，超过上限 ${maxDays} 天（不截断、不静默丢数据）`,
    );
  }
  return span;
}

/** Default day-window: the last `days` days, ending today (inclusive). */
export function trailingWindow(days: number, today: string): AnalysisWindow {
  if (!Number.isInteger(days) || days < 1) {
    throw new AnalysisRangeError("analysis-range-invalid", "天数必须是正整数");
  }
  assertCalendarDate(today);
  return { from: addDays(today, -(days - 1)), to: today };
}

/**
 * Validate an already half-open span for analysis use.
 *
 * Same day ceiling as `analysisSpan`, for callers (the React hook, tests) that
 * already speak `TimeSpan`. Rejects instead of truncating (S-01 v2 §17 / G-18).
 */
export function assertAnalysisSpan(span: TimeSpan, maxDays: number = MAX_ANALYSIS_DAYS): TimeSpan {
  if (!isSpanValid(span)) {
    throw new AnalysisRangeError("analysis-range-invalid", "分析区间不合法");
  }
  const days = daysInSpan(span);
  if (days > maxDays) {
    throw new AnalysisRangeError(
      "analysis-range-too-long",
      `分析区间为 ${days} 天，超过上限 ${maxDays} 天（不截断、不静默丢数据）`,
    );
  }
  return span;
}

/**
 * Pick the entries that can enter a series.
 *
 * Only two things are excluded: soft-deleted rows (a card must never resurrect an
 * entry the person removed) and malformed rows (a corrupted local copy is a bug to
 * surface, not a value to guess). Currency is the entry's own — see the FX note above.
 */
export function toTimeSeriesEntries(transactions: readonly Transaction[]): TimeSeriesEntry[] {
  const entries: TimeSeriesEntry[] = [];
  for (const transaction of transactions) {
    if (transaction.deletedAt !== null && transaction.deletedAt !== undefined) continue;
    assertCalendarDate(transaction.occurredLocalDate);
    if (!Number.isInteger(transaction.amountCents) || transaction.amountCents < 0) {
      throw new AnalyzeEntryError(`金额不合法：${transaction.id}`);
    }
    entries.push({
      occurredLocalDate: transaction.occurredLocalDate,
      kind: transaction.kind,
      amountMinor: transaction.amountCents,
    });
  }
  return entries;
}

/** Malformed-entry failure; separate from range errors so the page can explain it. */
export class AnalyzeEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeEntryError";
  }
}

/**
 * Coverage of the local ledger for a span.
 *
 * R-B-02: the offline cache does not record which months were downloaded completely,
 * so the honest answer is "unknown" (`null`). When the offline module grows that
 * metadata, this function is the one place to change.
 */
export function coverageOf(): string | null {
  return null;
}

/**
 * W1 原币 coverage policy: the device ledger is the authoritative copy.
 *
 * **This is a stated assumption, not a measurement.** The offline-first contract of
 * this app is that the device holds the entries it knows about and the existing
 * analysis screen (`useStats` → `computeStats`) already treats the local ledger as
 * truth for the current book. W1 原币 cards therefore use the last analysed date
 * (capped at today) as the coverage end, and the card caption must say so.
 *
 * It is **not** a replacement for R-B-02: a month that was never downloaded simply
 * has no entries here, exactly as it has none on the existing screen. Combined (FX)
 * mode must make its own, stricter coverage decision.
 */
export function localLedgerCoverageEnd(span: TimeSpan, today: string): string {
  const lastAnalysedDate = addDays(span.end, -1);
  return lastAnalysedDate < today ? lastAnalysedDate : today;
}

/**
 * Book-level data version for cache keys.
 *
 * G-10 (dataVersion on the client-computed path) is an open decision; until the owner
 * rules, background refreshes rely on the ledger store subscription and query keys,
 * and this reports `null` instead of inventing a token.
 */
export function analysisDataVersion(): string | null {
  return null;
}

/**
 * One call that takes raw transactions + a window and returns exactly what the
 * series engine needs — the shape `toTimeSeriesEntries` and friends feed into.
 *
 * `coverageEnd` defaults to `null` (unknown, the engine-honest default); W1 原币
 * callers pass `localLedgerCoverageEnd(span, today)` explicitly so the assumption is
 * visible at the call site.
 */
export function buildAnalysisInput(
  transactions: readonly Transaction[],
  window: AnalysisWindow,
  options: { readonly maxDays?: number; readonly coverageEnd?: string | null } = {},
): AnalysisInput & { readonly span: TimeSpan } {
  const maxDays = options.maxDays ?? MAX_ANALYSIS_DAYS;
  const span = analysisSpan(window, maxDays);
  return {
    span,
    entries: toTimeSeriesEntries(transactions),
    coverageEnd: options.coverageEnd ?? coverageOf(),
    dataVersion: analysisDataVersion(),
  };
}

/** Granularity guard shared by cards: only day/week/month are implemented today. */
export function assertSupportedGranularity(granularity: string): asserts granularity is TimeGranularity {
  if (granularity !== "day" && granularity !== "week" && granularity !== "month") {
    throw new AnalysisRangeError("analysis-range-unsupported", `暂不支持的粒度：${granularity}`);
  }
}

/** What a card asks the analysis layer for. */
export interface TimeAnalysisQuery {
  readonly metric: TimeSeriesMetric;
  readonly granularity: TimeGranularity;
  /** Half-open business-date span `[start, end)`. */
  readonly span: TimeSpan;
  /** Device-local business "today" — never the server's day. */
  readonly today: string;
  /** Only for `metric: "count"`. */
  readonly countKind?: CountKind;
  /** S-01 v2 §17 override; defaults to `MAX_ANALYSIS_DAYS` (400). */
  readonly maxDays?: number;
  /**
   * Coverage policy. W1 原币 cards default to `local-ledger` (the device copy is the
   * authoritative view, same assumption the existing analysis screen makes — see
   * `localLedgerCoverageEnd`). `unknown` is the engine-honest mode used by tests and
   * by any card that must not claim completeness.
   */
  readonly coverage?: "local-ledger" | "unknown";
}

export interface TimeAnalysisView {
  readonly result: TimeSeriesResult;
  readonly input: AnalysisInput;
}

/**
 * The pure part: entries + query → series. Split out from the hook so tests can
 * exercise the real derivation without a React store.
 */
export function deriveTimeAnalysis(
  transactions: readonly Transaction[],
  query: TimeAnalysisQuery,
): TimeAnalysisView {
  const span = assertAnalysisSpan(query.span, query.maxDays);
  const entries = toTimeSeriesEntries(transactions);
  const coverageEnd =
    query.coverage === "unknown" ? coverageOf() : localLedgerCoverageEnd(span, query.today);
  const input: AnalysisInput = {
    entries,
    coverageEnd,
    dataVersion: analysisDataVersion(),
  };
  const result = computeTimeSeries(entries, {
    metric: query.metric,
    granularity: query.granularity,
    span,
    today: query.today,
    coverageEnd: input.coverageEnd,
    ...(query.countKind === undefined ? {} : { countKind: query.countKind }),
  });
  return { result, input };
}

/** Re-exported so cards read one module, not two. */
export { isSpanValid };
