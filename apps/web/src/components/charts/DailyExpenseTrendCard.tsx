/**
 * S0 — 「每日支出趋势」卡片（W1 第一张真实数据卡片）。
 *
 * This is the first card of the W1 原币 chain and it deliberately stays thin:
 *
 *  真实账目（ledger store） → analysisData / useTimeAnalysis → `computeTimeSeries`
 *  → `SeriesTrendChart` → this card → 工作台（集成阶段由 Lead 接线）
 *
 * The card renders **only** what the authoritative result says. It never
 * re-buckets, never fills zeros, never converts currency, and it does not own the
 * numbers: `totalText`, `caption` and the formatters are produced by the page from
 * the same `TimeSeriesResult`, so a wrong number has exactly one place to be wrong.
 *
 * Sizing follows the existing card language (`rounded-field` surface + quiet
 * border) so integration does not need a new visual token.
 */

import type { TimeSeriesBucketPoint, TimeSeriesResult } from "@libellum/shared";

import { SeriesTrendChart } from "./SeriesTrendChart.js";

export interface DailyExpenseTrendCardProps {
  readonly title: string;
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
}

export function DailyExpenseTrendCard({
  title,
  totalText,
  caption,
  result,
  formatAxis,
  formatPoint,
  chartKind = "line",
  height = 200,
}: DailyExpenseTrendCardProps): React.JSX.Element {
  const hasBuckets = result.buckets.length > 0;

  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-testid="daily-expense-trend-card"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{title}</h3>
        {totalText === null ? null : (
          <p className="text-base font-semibold tabular-nums text-ink" data-testid="daily-expense-trend-total">
            {totalText}
          </p>
        )}
      </header>
      {caption === null ? null : (
        <p className="mt-1 text-helper text-muted" data-testid="daily-expense-trend-caption">
          {caption}
        </p>
      )}
      {hasBuckets ? (
        <SeriesTrendChart
          points={result.buckets}
          metric="expense"
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
