/**
 * S1 — 「收入与支出」卡片（I11）。
 *
 * Income and expense share one time axis (one `FlowSeriesResult`): the same span,
 * the same bucket boundaries, no separate series that could silently disagree.
 * The card shows both totals on their own side of the header — it does not collapse
 * them into "balance" (that is a different analysis) — and the bars are the
 * existing `IncomeExpenseBars`.
 *
 * An unknown bucket shows the gap for both series at once; an in-progress bucket is
 * drawn with the shared in-progress treatment by the chart component.
 */

import type { FlowSeriesBucketPoint, FlowSeriesResult, TimeBucket } from "@libellum/shared";

import { IncomeExpenseBars } from "./IncomeExpenseBars.js";

export interface IncomeExpenseCardProps {
  readonly title: string;
  /** Locale label for the income series (legend). */
  readonly incomeLabel: string;
  /** Locale label for the expense series (legend). */
  readonly expenseLabel: string;
  /** Exact income total; `null` = unknown. */
  readonly incomeText: string | null;
  /** Exact expense total; `null` = unknown. */
  readonly expenseText: string | null;
  /** Unknown-coverage / in-progress explanation; `null` = none. */
  readonly caption: string | null;
  readonly result: FlowSeriesResult;
  /** Short axis formatter (may abbreviate, same order of magnitude). */
  readonly formatAxis: (value: number) => string;
  /** Category-axis label per bucket, formatted by the caller. */
  readonly labelFor: (bucket: TimeBucket) => string;
  readonly height?: number;
  /** Test hook; defaults to `income-expense-card`. */
  readonly testId?: string;
}

export function IncomeExpenseCard({
  title,
  incomeLabel,
  expenseLabel,
  incomeText,
  expenseText,
  caption,
  result,
  formatAxis,
  labelFor,
  height = 220,
  testId = "income-expense-card",
}: IncomeExpenseCardProps): React.JSX.Element {
  const hasBuckets = result.buckets.length > 0;
  const total = (text: string, tone: "income" | "expense"): React.JSX.Element => (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-helper text-muted">{tone === "income" ? incomeLabel : expenseLabel}</span>
      <span className="text-base font-semibold tabular-nums text-ink">{text}</span>
    </span>
  );

  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-testid={testId}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-body font-medium text-ink">{title}</h3>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {incomeText === null ? null : (
            <span data-testid={`${testId}-income`}>{total(incomeText, "income")}</span>
          )}
          {expenseText === null ? null : (
            <span data-testid={`${testId}-expense`}>{total(expenseText, "expense")}</span>
          )}
        </div>
      </header>
      {caption === null ? null : (
        <p className="mt-1 text-helper text-muted" data-testid={`${testId}-caption`}>
          {caption}
        </p>
      )}
      {hasBuckets ? (
        <IncomeExpenseBars
          buckets={result.buckets}
          title={title}
          incomeLabel={incomeLabel}
          expenseLabel={expenseLabel}
          formatAxis={formatAxis}
          labelFor={labelFor}
          height={height}
        />
      ) : null}
    </section>
  );
}
