/**
 * S1 — 「时间趋势」通用卡片（I07/I08/I09/I10/I19）。
 *
 * One card covers every single-series time analysis the W1 原币 path produces:
 * daily/weekly/monthly income or expense, and the daily transaction count. The
 * analysis identity lives in the page (title/caption/formatters), not here — the
 * card renders exactly the authoritative `TimeSeriesResult` it is given.
 *
 * The chart below is the existing `SeriesTrendChart` (line/area/bars), so the card
 * inherits the same unknown-gap, in-progress and exact-readout behaviour as S0.
 * Switching a chart or a size never changes the numbers: the result is computed
 * before the card and never re-bucketed here.
 */

import type { TimeSeriesBucketPoint, TimeSeriesMetric, TimeSeriesResult } from "@libellum/shared";

import { SeriesTrendChart } from "./SeriesTrendChart.js";

export interface TimeSeriesCardProps {
  readonly title: string;
  /** Series identity forwarded to the chart (expense / income / count). */
  readonly metric: TimeSeriesMetric;
  /** Exact total of the counted buckets (complete + in-progress); `null` = unknown. */
  readonly totalText: string | null;
  /** Unknown-coverage / in-progress / all-zero explanation; `null` = none. */
  readonly caption: string | null;
  readonly result: TimeSeriesResult;
  /** Short axis formatter (may abbreviate, same order of magnitude). */
  readonly formatAxis: (value: number) => string;
  /** Exact tooltip text per bucket, formatted by the caller. */
  readonly formatPoint: (point: TimeSeriesBucketPoint) => string;
  readonly chartKind?: "line" | "area" | "bar";
  readonly height?: number;
  /** Test hook; defaults to `time-series-card`. */
  readonly testId?: string;
}

export function TimeSeriesCard({
  title,
  metric,
  totalText,
  caption,
  result,
  formatAxis,
  formatPoint,
  chartKind = "line",
  height = 200,
  testId = "time-series-card",
}: TimeSeriesCardProps): React.JSX.Element {
  const hasBuckets = result.buckets.length > 0;

  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-testid={testId}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{title}</h3>
        {totalText === null ? null : (
          <p
            className="text-base font-semibold tabular-nums text-ink"
            data-testid={`${testId}-total`}
          >
            {totalText}
          </p>
        )}
      </header>
      {caption === null ? null : (
        <p className="mt-1 text-helper text-muted" data-testid={`${testId}-caption`}>
          {caption}
        </p>
      )}
      {hasBuckets ? (
        <SeriesTrendChart
          points={result.buckets}
          metric={metric}
          granularity={result.granularity}
          chartKind={chartKind}
          title={title}
          valueText={formatPoint}
          formatAxis={formatAxis}
          height={height}
        />
      ) : null}
    </section>
  );
}
