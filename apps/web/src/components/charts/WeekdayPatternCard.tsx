import type { WeekdayPatternResult } from "@libellum/shared";

import type { WeekdayMode } from "../../lib/chart/categoryChart.js";
import { WeekdayBars } from "./WeekdayBars.js";

/** One already-formatted label/value pair, e.g. "支出合计" / "¥731.13". */
export interface WeekdayPatternMetricText {
  readonly label: string;
  readonly value: string;
}

export interface WeekdayPatternCardProps {
  readonly result: WeekdayPatternResult;
  readonly title: string;
  /** Aggregate vs per-day average; the same axis is used for both (I13). */
  readonly mode: WeekdayMode;
  readonly weekdayLabels: readonly string[];
  /** Formatted summary metrics (total / count / busiest day ...). */
  readonly metrics: readonly WeekdayPatternMetricText[];
  readonly formatAxis: (value: number) => string;
  readonly formatValue: (minor: string) => string;
  /** Exact sample statement — e.g. "统计 30 天，其中 4 天无支出". */
  readonly sampleText: string;
  readonly caption?: string | null;
  readonly notice?: string | null;
  readonly height?: number;
}

/**
 * I13 card: weekday distribution of one kind (expense / income / count).
 *
 * The bars come from `WeekdayBars` (shared `WeekdayPatternResult`, so the same
 * seven buckets and the same sample accounting); the card only adds the summary
 * row. `mode` is passed through untouched — "total" and "average" are different
 * questions and must never be blended into one number.
 */
export function WeekdayPatternCard({
  result,
  title,
  mode,
  weekdayLabels,
  metrics,
  formatAxis,
  formatValue,
  sampleText,
  caption = null,
  notice = null,
  height,
}: WeekdayPatternCardProps) {
  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-testid="weekday-pattern-card"
      data-mode={mode}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{title}</h3>
      </header>
      {caption === null ? null : (
        <p className="mt-1 text-helper text-muted" data-testid="weekday-pattern-caption">
          {caption}
        </p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2" data-testid="weekday-pattern-metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className="min-w-0">
            <dt className="text-helper text-muted">{metric.label}</dt>
            <dd className="text-body font-medium tabular-nums text-ink">{metric.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2">
        <WeekdayBars
          pattern={result}
          mode={mode}
          weekdayLabels={weekdayLabels}
          title={title}
          formatAxis={formatAxis}
          formatValue={formatValue}
          {...(height === undefined ? {} : { height })}
          {...(notice === null ? {} : { notice })}
        />
      </div>
      <p className="mt-1 text-helper text-muted" data-testid="weekday-pattern-sample">
        {sampleText}
      </p>
    </section>
  );
}
