import type { SeasonalComparisonResult, SeasonalMonthCell } from "@libellum/shared";

import { SeasonalComparisonChart } from "./SeasonalComparisonChart.js";

/**
 * A18 card view type: the shared engine also supports quarter grouping, but the W1
 * card plots the month matrix (`SeasonalComparisonChart`). Narrowing here keeps a
 * quarter result from being drawn as if it had months; callers either narrow or use
 * the quarter adapter result directly.
 */
export type SeasonalMonthComparisonResult = SeasonalComparisonResult & {
  readonly granularity: "month";
};

export interface SeasonalComparisonCardProps {
  readonly result: SeasonalMonthComparisonResult;
  readonly title: string;
  /** 12 short month labels, formatted by the caller. */
  readonly monthLabels: readonly string[];
  /** One legend entry per year (label + palette index). */
  readonly legend: readonly { readonly label: string; readonly colorIndex: number }[];
  readonly formatValue: (cell: SeasonalMonthCell) => string;
  readonly formatAxis: (value: number) => string;
  readonly caption?: string | null;
  /** Exact sample statement: years compared / months with data, formatted by caller. */
  readonly sampleText: string;
  /**
   * Shown when the comparison is descriptive only (fewer than two complete years or
   * a running period). A18 is never presented as statistical seasonality (spec §27).
   */
  readonly descriptiveText?: string | null;
  readonly notice?: string | null;
  readonly height?: number;
}

/**
 * A18 card: cross-year same-month comparison.
 *
 * The card computes nothing: years, cells, comparability and the descriptive-only
 * flag all come from `SeasonalComparisonResult`. It keeps the "descriptive, not
 * statistical seasonality" statement visible instead of hiding it in the chart.
 */
export function SeasonalComparisonCard({
  result,
  title,
  monthLabels,
  legend,
  formatValue,
  formatAxis,
  caption = null,
  sampleText,
  descriptiveText = null,
  notice = null,
  height,
}: SeasonalComparisonCardProps) {
  const showDescriptiveNote = result.descriptiveOnly && descriptiveText !== null;
  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-descriptive-only={result.descriptiveOnly ? "true" : "false"}
      data-testid="seasonal-comparison-card"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{title}</h3>
      </header>
      {caption === null ? null : (
        <p className="mt-1 text-helper text-muted" data-testid="seasonal-card-caption">
          {caption}
        </p>
      )}
      {showDescriptiveNote ? (
        <p className="mt-1 text-helper text-muted" data-testid="seasonal-card-descriptive">
          {descriptiveText}
        </p>
      ) : null}
      <div className="mt-2">
        <SeasonalComparisonChart
          result={result}
          title={title}
          monthLabels={monthLabels}
          legend={legend}
          formatValue={formatValue}
          formatAxis={formatAxis}
          {...(height === undefined ? {} : { height })}
          {...(notice === null ? {} : { notice })}
        />
      </div>
      <p className="mt-1 text-helper text-muted" data-testid="seasonal-card-sample">
        {sampleText}
      </p>
    </section>
  );
}
