import type { DailyExpenseVariability, TimeSeriesBucketPoint } from "@libellum/shared";

import { VolatilityBandChart } from "./VolatilityBandChart.js";

/** One already-formatted label/value pair shown above the band chart. */
export interface VariabilityMetricText {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

export interface VariabilityCardProps {
  /**
   * `null` when no day in the range is confirmed (the adapter reports
   * `unavailableReason`): the card then shows `emptyText` instead of a fake zero row.
   */
  readonly result: DailyExpenseVariability | null;
  /** The daily series the result summarizes (same points the chart plots). */
  readonly points: readonly TimeSeriesBucketPoint[];
  readonly title: string;
  /** Formatted mean / std-dev / CV / range / extreme-day metrics. */
  readonly metrics?: readonly VariabilityMetricText[];
  /** Legend labels for the mean line and the ±1σ band. */
  readonly chartLabels: { readonly mean: string; readonly band: string };
  readonly formatValue: (point: TimeSeriesBucketPoint) => string;
  readonly formatAxis: (value: number) => string;
  /** True range / sample note, e.g. "按设备账本口径统计 30 天，2 天未结束不计入". */
  readonly caption?: string | null;
  /** Exact sample statement (observed / excluded counts), formatted by the caller. */
  readonly sampleText: string;
  /** Shown instead of the numbers when `result` is null. */
  readonly emptyText: string;
  readonly notice?: string | null;
  readonly height?: number;
}

/**
 * I12 / A12 card: summary numbers + the day-by-day band chart.
 *
 * The card never computes a statistic itself — every number comes from
 * `DailyExpenseVariability` (exact mean, population std dev, CV, band, extreme
 * days). It also never hides the sample statement, and when nothing is confirmed it
 * shows `emptyText` rather than zeros.
 */
export function VariabilityCard({
  result,
  points,
  title,
  metrics = [],
  chartLabels,
  formatValue,
  formatAxis,
  caption = null,
  sampleText,
  emptyText,
  notice = null,
  height,
}: VariabilityCardProps) {
  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-testid="variability-card"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{title}</h3>
      </header>
      {caption === null ? null : (
        <p className="mt-1 text-helper text-muted" data-testid="variability-card-caption">
          {caption}
        </p>
      )}
      {result === null ? (
        <p className="mt-3 text-body text-muted" data-testid="variability-card-empty">
          {emptyText}
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2" data-testid="variability-metrics">
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
            <VolatilityBandChart
              points={points}
              variability={result}
              title={title}
              labels={chartLabels}
              formatValue={formatValue}
              formatAxis={formatAxis}
              {...(height === undefined ? {} : { height })}
              {...(notice === null ? {} : { notice })}
            />
          </div>
          <p className="mt-1 text-helper text-muted" data-testid="variability-card-sample">
            {sampleText}
          </p>
        </>
      )}
    </section>
  );
}
