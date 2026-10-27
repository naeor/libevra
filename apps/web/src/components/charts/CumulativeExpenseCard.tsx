/**
 * S1 — 「累计支出趋势」卡片（I20）。
 *
 * The cumulative line is not "a trend smoothed differently": it is
 * `Σ expense from the range start to that bucket`, produced once by
 * `accumulateSeries` (shared, exact minor units) and only drawn here. Once a
 * bucket is unknown, every later point is `null` and the chart shows the break —
 * the card never bridges a gap with a straight confident line.
 *
 * A plateau is a real thing (no expense those days) and is drawn as-is; the card
 * does not add smoothing, rolling windows or baselines.
 */

import type { CumulativeBucketPoint, CumulativeResult } from "@libellum/shared";

import { CumulativeTrendChart } from "./CumulativeTrendChart.js";

export interface CumulativeExpenseCardProps {
  readonly title: string;
  /** Exact cumulative amount at the range end; `null` = unknown. */
  readonly totalText: string | null;
  /** Unknown-coverage / in-progress / baseline explanation; `null` = none. */
  readonly caption: string | null;
  readonly result: CumulativeResult;
  /** Short axis formatter (may abbreviate, same order of magnitude). */
  readonly formatAxis: (value: number) => string;
  /** Exact tooltip text per bucket, formatted by the caller. */
  readonly formatPoint: (point: CumulativeBucketPoint) => string;
  readonly height?: number;
  /** Test hook; defaults to `cumulative-expense-card`. */
  readonly testId?: string;
}

export function CumulativeExpenseCard({
  title,
  totalText,
  caption,
  result,
  formatAxis,
  formatPoint,
  height = 200,
  testId = "cumulative-expense-card",
}: CumulativeExpenseCardProps): React.JSX.Element {
  const hasPoints = result.points.length > 0;

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
      {hasPoints ? (
        <CumulativeTrendChart
          points={result.points}
          title={title}
          valueText={formatPoint}
          formatAxis={formatAxis}
          height={height}
        />
      ) : null}
    </section>
  );
}
