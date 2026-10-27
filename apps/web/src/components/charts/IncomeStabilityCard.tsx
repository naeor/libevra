import type { ReactNode } from "react";

import type { IncomeStability } from "@libellum/shared";

/** One already-formatted label/value pair shown above the optional chart. */
export interface IncomeStabilityMetricText {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

export interface IncomeStabilityCardProps {
  /** `null` when no natural month is confirmed — the card then shows `emptyText`. */
  readonly result: IncomeStability | null;
  readonly title: string;
  /** Formatted mean / median / min / max / CV metrics. */
  readonly metrics?: readonly IncomeStabilityMetricText[];
  /**
   * The judged-state sentence (A20): whether a stability conclusion may be drawn
   * and why. Required so a small sample is never described as merely "stable".
   */
  readonly stateText: string;
  /** Exact sample statement, e.g. "完整自然月 3 个，进行中月份未计入". */
  readonly sampleText: string;
  /** Shown instead of the numbers when `result` is null. */
  readonly emptyText: string;
  readonly caption?: string | null;
  readonly notice?: string | null;
  /** Optional chart area supplied by the caller (e.g. an A20 mini trend). */
  readonly children?: ReactNode;
}

/**
 * A20 card: income stability. Every number is formatted by the caller from the
 * shared result; the card never recomputes an average or invents a verdict. The
 * judged state is shown verbatim, including the "insufficient sample" case, and an
 * unconfirmed range shows `emptyText` instead of fabricated zeros.
 */
export function IncomeStabilityCard({
  result,
  title,
  metrics = [],
  stateText,
  sampleText,
  emptyText,
  caption = null,
  notice = null,
  children,
}: IncomeStabilityCardProps) {
  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-testid="income-stability-card"
      {...(result === null ? {} : { "data-judged-state": result.judgedState })}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{title}</h3>
      </header>
      {caption === null ? null : (
        <p className="mt-1 text-helper text-muted" data-testid="income-stability-caption">
          {caption}
        </p>
      )}
      {result === null ? (
        <p className="mt-3 text-body text-muted" data-testid="income-stability-empty">
          {emptyText}
        </p>
      ) : (
        <>
          <dl
            className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2"
            data-testid="income-stability-metrics"
          >
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
          <p className="mt-2 text-helper text-muted" data-testid="income-stability-state">
            {stateText}
          </p>
          <p className="mt-1 text-helper text-muted" data-testid="income-stability-sample">
            {sampleText}
          </p>
          {notice === null ? null : (
            <p className="mt-1 text-helper text-muted" data-testid="income-stability-notice">
              {notice}
            </p>
          )}
          {children === undefined ? null : <div className="mt-2">{children}</div>}
        </>
      )}
    </section>
  );
}
