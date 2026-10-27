import { useQuery } from "@tanstack/react-query";
import type { MovingAveragePoint, Transaction, TransactionListResponse } from "@libellum/shared";
import { useMemo } from "react";

import { MovingAverageCard } from "../components/charts/MovingAverageCard.js";
import { analysisSpan, deriveMovingAverage, trailingWindow } from "../lib/analysisData.js";
import { apiFetch } from "../lib/api.js";
import { formatAxisAmount } from "../lib/chart/format.js";
import { toLocalDate } from "../lib/datetime.js";
import { formatMoney } from "../lib/format.js";

/**
 * S17 K3 — development-only preview that proves one real, data-driven analysis card
 * runs end to end on the integration branch.
 *
 * It is deliberately NOT wired into the stats page: the final workbench UI is Claude's
 * page, and this preview exists so the data path (real API transactions → B adapter →
 * A/B card) can be verified before that page lands. Remove it when Claude's page is
 * merged (integration gate K4).
 */

const PREVIEW_WINDOWS = [7, 30] as const;
const PREVIEW_VISIBLE_DAYS = 30;
const PREVIEW_PAGE_SIZE = "100";
const PREVIEW_MAX_PAGES = 20;

/**
 * K3 fix: the preview must see the whole read window, not a fixed "latest 100".
 * B's audit showed that a 100-row cut makes the early days of the 30-day window
 * look like confirmed zero (the 30-day card read ¥201.10 instead of ¥246.43).
 * Cursor paging keeps the loaded slice covering the ledger's earliest entry.
 */
async function fetchAllPreviewTransactions(): Promise<TransactionListResponse> {
  const items: Transaction[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < PREVIEW_MAX_PAGES; page += 1) {
    const response: TransactionListResponse = await apiFetch<TransactionListResponse>("/transactions", {
      query: cursor === null ? { limit: PREVIEW_PAGE_SIZE } : { limit: PREVIEW_PAGE_SIZE, cursor },
    });
    items.push(...response.items);
    cursor = response.nextCursor;
    if (cursor === null) break;
  }
  return { items, nextCursor: null };
}

function usePreviewTransactions() {
  return useQuery({
    queryKey: ["analysis-preview-transactions"],
    queryFn: fetchAllPreviewTransactions,
    staleTime: 60_000,
  });
}

function averageMinor(point: MovingAveragePoint): number | null {
  if (point.average === null) return null;
  return Math.round(Number(point.average.numeratorMinor) / point.average.denominatorDays);
}

export function AnalysisPreviewPage() {
  const query = usePreviewTransactions();
  const allTransactions: readonly Transaction[] = query.data?.items ?? [];
  /**
   * W1 computes the 原币 path: one series per currency, never a mixed sum. The preview
   * picks the series with the most entries and states it on the page.
   */
  const currency = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of allTransactions) counts.set(row.currency, (counts.get(row.currency) ?? 0) + 1);
    let best = "CNY";
    let bestCount = -1;
    for (const [code, count] of counts) {
      if (count > bestCount) {
        best = code;
        bestCount = count;
      }
    }
    return best;
  }, [allTransactions]);
  const transactions = useMemo(
    () => allTransactions.filter((row) => row.currency === currency),
    [allTransactions, currency],
  );
  /** Integrity check for the preview: the loaded slice must start at or before the read window. */
  const loadedRange = useMemo(() => {
    let earliest: string | null = null;
    let latest: string | null = null;
    for (const row of allTransactions) {
      if (earliest === null || row.occurredLocalDate < earliest) earliest = row.occurredLocalDate;
      if (latest === null || row.occurredLocalDate > latest) latest = row.occurredLocalDate;
    }
    return { earliest, latest };
  }, [allTransactions]);
  const today = useMemo(() => toLocalDate(new Date()), []);
  const span = useMemo(() => analysisSpan(trailingWindow(PREVIEW_VISIBLE_DAYS, today)), [today]);
  const views = useMemo(
    () =>
      PREVIEW_WINDOWS.map((windowDays) => ({
        windowDays,
        view: deriveMovingAverage(transactions, { span, today, windowDays }),
      })),
    [transactions, span, today],
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-heading font-semibold text-ink">Analysis card preview (K3)</h1>
      <p className="mt-1 text-helper text-muted">
        Development-only page: real transactions from this ledger feed the S-01 data adapter,
        then B&apos;s moving-average cards render. The final workbench UI is Claude&apos;s page.
      </p>
      <p className="mt-1 text-helper text-muted" data-testid="analysis-preview-currency">
        Single-currency (原币) series: {currency} · {String(transactions.length)} of{" "}
        {String(allTransactions.length)} loaded transactions · loaded {loadedRange.earliest ?? "none"} to{" "}
        {loadedRange.latest ?? "none"} · read window starts {span.start}
      </p>
      {loadedRange.earliest !== null && loadedRange.earliest > span.start ? (
        <p className="mt-1 text-helper text-danger" data-testid="analysis-preview-truncated">
          ⚠ Loaded transactions start after the read window start; early days may read as confirmed zero.
        </p>
      ) : null}

      {query.isLoading ? <p className="mt-6 text-body text-muted">Loading transactions…</p> : null}
      {query.isError ? (
        <p className="mt-6 text-body text-danger" data-testid="analysis-preview-error">
          Could not load transactions: {query.error instanceof Error ? query.error.message : "unknown error"}
        </p>
      ) : null}

      {!query.isLoading && !query.isError ? (
        <div className="mt-6 grid gap-4" data-testid="analysis-preview-cards">
          {views.map(({ windowDays, view }) => {
            const latest = [...view.points].reverse().find((point) => point.average !== null) ?? null;
            const latestMinor = latest === null ? null : averageMinor(latest);
            return (
              <MovingAverageCard
                key={windowDays}
                windowDays={windowDays}
                title={`${String(windowDays)}-day moving average`}
                result={view.unavailableReason === null ? view.result : null}
                labels={{ raw: "Daily expense", average: `${String(windowDays)}-day average` }}
                metrics={
                  latestMinor === null
                    ? []
                    : [
                        {
                          label: "Latest average",
                          value: formatMoney(latestMinor, currency),
                          note: latest === null ? "" : `window ending ${latest.bucket.key}`,
                        },
                      ]
                }
                formatValue={(point) => {
                  const raw = point.rawMinor === null ? "unknown" : formatMoney(Number(point.rawMinor), currency);
                  const average = averageMinor(point);
                  return `${point.bucket.key}: raw ${raw} · average ${
                    average === null ? "not computable" : formatMoney(average, currency)
                  }`;
                }}
                formatAxis={(value) => formatAxisAmount(value, currency)}
                caption={`${String(view.historyDays)} days of history read before ${view.visibleFrom}`}
                sampleText={`${String(view.result.computablePoints)} of ${String(
                  view.result.points.length,
                )} visible days computable · ${String(view.result.missingHistoryPoints)} lack history · ${String(
                  view.result.unknownWindowPoints,
                )} contain unknown days`}
                excludedInProgress={view.todayExcluded}
                excludedTodayText={
                  view.todayExcluded ? "The unfinished day is excluded from every window sample." : null
                }
                emptyText="No complete observations in this range, so no average is shown."
              />
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
