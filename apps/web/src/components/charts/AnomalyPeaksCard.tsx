import type { AnomalyMark, AnomalyResult, TimeSeriesBucketPoint } from "@libellum/shared";

import { AnomalyMarkerChart } from "./AnomalyMarkerChart.js";

/** One already-formatted row in the peak list. */
export interface AnomalyPeakText {
  readonly date: string;
  readonly amount: string;
  readonly note?: string;
}

export interface AnomalyPeaksCardProps {
  readonly result: AnomalyResult;
  /** The daily points the marker chart plots. */
  readonly points: readonly TimeSeriesBucketPoint[];
  readonly title: string;
  readonly label: string;
  readonly formatValue: (point: TimeSeriesBucketPoint) => string;
  readonly formatAxis: (value: number) => string;
  readonly formatMark: (mark: AnomalyMark) => AnomalyPeakText;
  readonly description?: string | null;
  readonly caption?: string | null;
  /** Exact sample statement (days sampled / minimum / parameters), formatted by caller. */
  readonly sampleText: string;
  /** Shown instead of the chart when no complete day could form a baseline. */
  readonly emptyText: string;
  /** Shown when a baseline exists but no day was flagged. */
  readonly noneText: string;
  readonly notice?: string | null;
  readonly height?: number;
}

/**
 * A19 card: daily expense trend with marked unusual days and a ranked list.
 *
 * The card is descriptive only: every mark, rank and threshold is produced by the
 * shared detector, and the caller's I18n text is what explains the method. It never
 * calls a day "suspicious" or "fraudulent" on its own; wording lives in the caller
 * strings (spec §28).
 */
export function AnomalyPeaksCard({
  result,
  points,
  title,
  label,
  formatValue,
  formatAxis,
  formatMark,
  description = null,
  caption = null,
  sampleText,
  emptyText,
  noneText,
  notice = null,
  height,
}: AnomalyPeaksCardProps) {
  const hasBaseline = result.baseline !== null;
  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-state={hasBaseline ? "ready" : "empty"}
      data-testid="anomaly-peaks-card"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{title}</h3>
      </header>
      {caption === null ? null : (
        <p className="mt-1 text-helper text-muted" data-testid="anomaly-card-caption">
          {caption}
        </p>
      )}
      {hasBaseline ? (
        <>
          <div className="mt-2">
            <AnomalyMarkerChart
              points={points}
              anomaly={result}
              title={title}
              label={label}
              formatValue={formatValue}
              formatAxis={formatAxis}
              {...(description === null ? {} : { description })}
              {...(height === undefined ? {} : { height })}
              {...(notice === null ? {} : { notice })}
            />
          </div>
          {result.marks.length === 0 ? (
            <p className="mt-2 text-body text-muted" data-testid="anomaly-peaks-none">
              {noneText}
            </p>
          ) : (
            <ol className="mt-2 space-y-1" data-testid="anomaly-peaks-list">
              {result.marks.map((mark) => {
                const text = formatMark(mark);
                return (
                  <li
                    className="flex items-baseline justify-between gap-3 text-body"
                    data-date={mark.date}
                    data-rank={mark.rank}
                    data-testid="anomaly-peak-item"
                    key={mark.date}
                  >
                    <span className="min-w-0">
                      <span aria-hidden="true" className="mr-2 tabular-nums text-muted">
                        {mark.rank}
                      </span>
                      <span className="text-ink">{text.date}</span>
                      {text.note === undefined ? null : (
                        <span className="ml-2 text-helper text-muted">{text.note}</span>
                      )}
                    </span>
                    <span className="tabular-nums text-ink">{text.amount}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      ) : (
        <p className="mt-3 text-body text-muted" data-testid="anomaly-peaks-empty">
          {emptyText}
        </p>
      )}
      <p className="mt-1 text-helper text-muted" data-testid="anomaly-card-sample">
        {sampleText}
      </p>
    </section>
  );
}
