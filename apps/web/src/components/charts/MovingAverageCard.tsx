import type { MovingAveragePoint, MovingAverageResult } from "@libellum/shared";

import { MovingAverageChart } from "./MovingAverageChart.js";

/** One already-formatted label/value pair shown above the moving-average chart. */
export interface MovingAverageMetricText {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

export interface MovingAverageCardProps {
  /** Trailing window in calendar days: 7 (A13) or 30 (A14). */
  readonly windowDays: number;
  readonly title: string;
  /**
   * `null` when no visible day has a confirmed amount (the adapter reports
   * `unavailableReason`): the card then shows `emptyText` instead of a fake average.
   */
  readonly result: MovingAverageResult | null;
  /** Legend labels for the raw series and the trailing average (caller i18n). */
  readonly labels: { readonly raw: string; readonly average: string };
  /** Formatted metrics, e.g. latest 7-day average / computable points. */
  readonly metrics?: readonly MovingAverageMetricText[];
  /** Exact reading for tooltips and accessible names. */
  readonly formatValue: (point: MovingAveragePoint) => string;
  readonly formatAxis: (value: number) => string;
  /** Range / window note, e.g. "7 calendar days, first 6 days use history". */
  readonly caption?: string | null;
  /** Exact sample statement, formatted by the caller (visible days / gaps). */
  readonly sampleText: string;
  /**
   * `true` when the adapter excluded an unfinished day (normally today) from every
   * window sample (B-Q20). The caller must then also pass `excludedTodayText` so the
   * exclusion is stated in the UI, never only implied by a gap.
   */
  readonly excludedInProgress?: boolean;
  /** Exact statement that the running day is excluded from the sample (caller i18n). */
  readonly excludedTodayText?: string | null;
  /** Shown instead of the chart when `result` is null. */
  readonly emptyText: string;
  readonly notice?: string | null;
  readonly height?: number;
}

/**
 * A13 / A14 card: trailing moving average (7 / 30 calendar days) over the daily
 * expense series.
 *
 * The card never computes the average itself — `MovingAverageResult.points` carries
 * the exact `numeratorMinor / denominatorDays`, and gaps stay `null` (they are never
 * filled with zero or interpolated). It also never hides the sample statement.
 */
export function MovingAverageCard({
  windowDays,
  title,
  result,
  labels,
  metrics = [],
  formatValue,
  formatAxis,
  caption = null,
  sampleText,
  excludedInProgress = false,
  excludedTodayText = null,
  emptyText,
  notice = null,
  height,
}: MovingAverageCardProps) {
  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-testid="moving-average-card"
      data-window={windowDays}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{title}</h3>
      </header>
      {caption === null ? null : (
        <p className="mt-1 text-helper text-muted" data-testid="moving-average-card-caption">
          {caption}
        </p>
      )}
      {result === null ? (
        <p className="mt-3 text-body text-muted" data-testid="moving-average-card-empty">
          {emptyText}
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2" data-testid="moving-average-metrics">
            {metrics.map((metric) => (
              <div key={metric.label} className="min-w-0">
                <dt className="text-helper text-muted">{metric.label}</dt>
                <dd
                  className="text-body font-medium tabular-nums text-ink"
                  data-metric-label={metric.label}
                >
                  {metric.value}
                </dd>
                {metric.note === undefined ? null : (
                  <dd className="text-helper text-muted">{metric.note}</dd>
                )}
              </div>
            ))}
          </dl>
          <div className="mt-2">
            <MovingAverageChart
              result={result}
              title={title}
              labels={labels}
              formatValue={formatValue}
              formatAxis={formatAxis}
              {...(height === undefined ? {} : { height })}
              {...(notice === null ? {} : { notice })}
            />
          </div>
          <p className="mt-1 text-helper text-muted" data-testid="moving-average-card-sample">
            {sampleText}
          </p>
        </>
      )}
      {excludedInProgress && excludedTodayText !== null ? (
        <p
          className="mt-1 text-helper text-muted"
          data-testid="moving-average-card-excluded-today"
          data-excluded-today="true"
        >
          {excludedTodayText}
        </p>
      ) : null}
    </section>
  );
}
