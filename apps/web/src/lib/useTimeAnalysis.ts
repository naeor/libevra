/**
 * S0 — 账本条目 → 时间序列结果（原币）的 React 入口。
 *
 * The analysis screen already has a proven way to read the ledger on the device:
 * the ledger store (`subscribeLedger`/`ledgerSnapshotValue`) plus
 * `readLocalTransactions()`. `useStats` uses exactly that pair, and the comments
 * there explain why a second store was tried and failed; this hook reuses the
 * proven one instead of inventing another.
 *
 * Computation happens **during render** (pure and cheap: one pass over the entries
 * in range), so there is no async state and nothing to drop — the value is read
 * synchronously from a store that is already filled.
 *
 * The pure part (`deriveTimeAnalysis`) lives in `analysisData.ts` so tests can
 * exercise the real derivation without a React store; this file only wires the
 * store into it.
 *
 * Boundary: this is the W1 原币 path only. Combined currency (FX) mode needs the
 * per-entry conversions from G-17 and is a separate, later decision.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  deriveCumulativeAnalysis,
  deriveDailyExpenseVariability,
  deriveFlowAnalysis,
  deriveIncomeStability,
  deriveMultiMonthComparison,
  deriveMovingAverage,
  derivePeriodComparison,
  deriveSeasonalComparison,
  deriveAnomalyAnalysis,
  deriveTimeAnalysis,
  deriveWeekdayAnalysis,
  type AnomalyAnalysisQuery,
  type AnomalyAnalysisView,
  type CumulativeAnalysisView,
  type FlowAnalysisQuery,
  type FlowAnalysisView,
  type IncomeStabilityQuery,
  type IncomeStabilityView,
  type MovingAverageAnalysisQuery,
  type MovingAverageAnalysisView,
  type MultiMonthComparisonQuery,
  type MultiMonthComparisonView,
  type PeriodComparisonQuery,
  type PeriodComparisonView,
  type SeasonalAnalysisQuery,
  type SeasonalAnalysisView,
  type TimeAnalysisQuery,
  type TimeAnalysisView,
  type VariabilityAnalysisQuery,
  type VariabilityAnalysisView,
  type WeekdayAnalysisQuery,
  type WeekdayAnalysisView,
} from "./analysisData.js";
import {
  ledgerSnapshotValue,
  readLocalTransactions,
  subscribeLedger,
} from "./offline/localLedger.js";

export type { TimeAnalysisQuery, TimeAnalysisView };
export type { CumulativeAnalysisView, FlowAnalysisQuery, FlowAnalysisView };
export type { PeriodComparisonQuery, PeriodComparisonView };
export type { MultiMonthComparisonQuery, MultiMonthComparisonView };
export type { VariabilityAnalysisQuery, VariabilityAnalysisView };
export type { IncomeStabilityQuery, IncomeStabilityView };
export type { WeekdayAnalysisQuery, WeekdayAnalysisView };
export type { MovingAverageAnalysisQuery, MovingAverageAnalysisView };
export type { SeasonalAnalysisQuery, SeasonalAnalysisView };
export type { AnomalyAnalysisQuery, AnomalyAnalysisView };
export { deriveTimeAnalysis };

/**
 * The proven ledger read, shared by every W1 原币 hook below.
 *
 * Same store pair as `useStats` (see the note at the top of this file): the store
 * is filled by the reader, so the effect keeps a screen with a never-run queryFn
 * populated.
 */
function useLedgerStore(): Parameters<typeof deriveTimeAnalysis>[0] {
  const all = useSyncExternalStore(subscribeLedger, ledgerSnapshotValue, ledgerSnapshotValue);
  useEffect(() => {
    void readLocalTransactions();
  }, []);
  return all;
}

/**
 * Read the device's entries and derive a time series, re-rendering when the ledger
 * changes (a new entry, an edit, a delete all publish to the same store).
 */
export function useTimeAnalysis(query: TimeAnalysisQuery): TimeAnalysisView {
  const all = useLedgerStore();

  const { metric, granularity, span, today, countKind, maxDays, coverage } = query;

  return useMemo(
    () =>
      deriveTimeAnalysis(all, {
        metric,
        granularity,
        span,
        today,
        ...(countKind === undefined ? {} : { countKind }),
        ...(maxDays === undefined ? {} : { maxDays }),
        ...(coverage === undefined ? {} : { coverage }),
      }),
    [all, metric, granularity, span.start, span.end, today, countKind, maxDays, coverage],
  );
}

/** Cumulative expense trend (I20): the same series, accumulated from the range start. */
export function useCumulativeAnalysis(query: TimeAnalysisQuery): CumulativeAnalysisView {
  const all = useLedgerStore();

  const { metric, granularity, span, today, countKind, maxDays, coverage } = query;

  return useMemo(
    () =>
      deriveCumulativeAnalysis(all, {
        metric,
        granularity,
        span,
        today,
        ...(countKind === undefined ? {} : { countKind }),
        ...(maxDays === undefined ? {} : { maxDays }),
        ...(coverage === undefined ? {} : { coverage }),
      }),
    [all, metric, granularity, span.start, span.end, today, countKind, maxDays, coverage],
  );
}

/** Income vs expense on one shared time axis (I11). */
export function useFlowAnalysis(query: FlowAnalysisQuery): FlowAnalysisView {
  const all = useLedgerStore();

  const { granularity, span, today, maxDays, coverage } = query;

  return useMemo(
    () =>
      deriveFlowAnalysis(all, {
        granularity,
        span,
        today,
        ...(maxDays === undefined ? {} : { maxDays }),
        ...(coverage === undefined ? {} : { coverage }),
      }),
    [all, granularity, span.start, span.end, today, maxDays, coverage],
  );
}

/**
 * S3 — A01/A02/A03/A05: one resolved period comparison per render.
 *
 * The card decides how to word it (`kind`); the hook never re-derives a "previous
 * period" on its own, so a label can never drift away from the numbers.
 */
export function usePeriodComparison(query: PeriodComparisonQuery): PeriodComparisonView {
  const all = useLedgerStore();

  const { kind, current, today, monthToDatePolicy, maxDays, coverage } = query;

  return useMemo(
    () =>
      derivePeriodComparison(all, {
        kind,
        today,
        ...(current === undefined ? {} : { current }),
        ...(monthToDatePolicy === undefined ? {} : { monthToDatePolicy }),
        ...(maxDays === undefined ? {} : { maxDays }),
        ...(coverage === undefined ? {} : { coverage }),
      }),
    [all, kind, current?.start, current?.end, today, monthToDatePolicy, maxDays, coverage],
  );
}

/** S3 — A04: month-key comparison; the selection is compared by content, not identity. */
export function useMultiMonthComparison(
  query: MultiMonthComparisonQuery,
): MultiMonthComparisonView {
  const all = useLedgerStore();

  const { months, metric, today, coverage } = query;
  const selection = months.join("|");

  return useMemo(
    () =>
      deriveMultiMonthComparison(all, {
        months,
        metric,
        today,
        ...(coverage === undefined ? {} : { coverage }),
      }),
    // `selection` is the content of `months`; the array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, selection, metric, today, coverage],
  );
}

/** S4a — I12/A12: daily expense variability on the device ledger. */
export function useDailyExpenseVariability(
  query: VariabilityAnalysisQuery,
): VariabilityAnalysisView {
  const all = useLedgerStore();

  const { span, today, maxDays, coverage, extremeSigma } = query;

  return useMemo(
    () =>
      deriveDailyExpenseVariability(all, {
        span,
        today,
        ...(maxDays === undefined ? {} : { maxDays }),
        ...(coverage === undefined ? {} : { coverage }),
        ...(extremeSigma === undefined ? {} : { extremeSigma }),
      }),
    [all, span.start, span.end, today, maxDays, coverage, extremeSigma],
  );
}

/** S4a — A20: income stability over complete natural months. */
export function useIncomeStability(query: IncomeStabilityQuery): IncomeStabilityView {
  const all = useLedgerStore();

  const { span, today, maxDays, coverage, minSampleMonths } = query;

  return useMemo(
    () =>
      deriveIncomeStability(all, {
        span,
        today,
        ...(maxDays === undefined ? {} : { maxDays }),
        ...(coverage === undefined ? {} : { coverage }),
        ...(minSampleMonths === undefined ? {} : { minSampleMonths }),
      }),
    [all, span.start, span.end, today, maxDays, coverage, minSampleMonths],
  );
}

/** S4a — I13: weekday distribution for one kind. */
export function useWeekdayAnalysis(query: WeekdayAnalysisQuery): WeekdayAnalysisView {
  const all = useLedgerStore();

  const { kind, span, today, maxDays, coverage } = query;

  return useMemo(
    () =>
      deriveWeekdayAnalysis(all, {
        kind,
        span,
        today,
        ...(maxDays === undefined ? {} : { maxDays }),
        ...(coverage === undefined ? {} : { coverage }),
      }),
    [all, kind, span.start, span.end, today, maxDays, coverage],
  );
}

/** S4b — A13/A14: trailing moving average over the visible span (7 / 30 days). */
export function useMovingAverage(query: MovingAverageAnalysisQuery): MovingAverageAnalysisView {
  const all = useLedgerStore();

  const { span, today, windowDays, maxDays, coverage, scale } = query;

  return useMemo(
    () =>
      deriveMovingAverage(all, {
        span,
        today,
        windowDays,
        ...(maxDays === undefined ? {} : { maxDays }),
        ...(coverage === undefined ? {} : { coverage }),
        ...(scale === undefined ? {} : { scale }),
      }),
    [all, span.start, span.end, today, windowDays, maxDays, coverage, scale],
  );
}

/** S4c — A18: cross-year same-month/quarter comparison (descriptive, expense only). */
export function useSeasonalAnalysis(query: SeasonalAnalysisQuery): SeasonalAnalysisView {
  const all = useLedgerStore();

  const { span, today, coverage, granularity, maxMonths } = query;

  return useMemo(
    () =>
      deriveSeasonalComparison(all, {
        span,
        today,
        ...(coverage === undefined ? {} : { coverage }),
        ...(granularity === undefined ? {} : { granularity }),
        ...(maxMonths === undefined ? {} : { maxMonths }),
      }),
    [all, span.start, span.end, today, coverage, granularity, maxMonths],
  );
}

/** S4c — A19: descriptive daily-expense spike detection (never an accusation). */
export function useAnomalyAnalysis(query: AnomalyAnalysisQuery): AnomalyAnalysisView {
  const all = useLedgerStore();

  const { span, today, maxDays, coverage, options } = query;

  return useMemo(
    () =>
      deriveAnomalyAnalysis(all, {
        span,
        today,
        ...(maxDays === undefined ? {} : { maxDays }),
        ...(coverage === undefined ? {} : { coverage }),
        ...(options === undefined ? {} : { options }),
      }),
    [all, span.start, span.end, today, maxDays, coverage, options],
  );
}
