/**
 * S0 — 账本条目 → 时间序列结果（原币）的 React 入口。
 *
 * The analysis screen already has a proven way to read the ledger on the device:
 * the ledger store (`subscribeLedger`/`ledgerSnapshotValue`) plus
 * `readLocalTransactions()`. `useStats` uses exactly that pair, and the comments
 * there explain why a second store was tried and failed; this hook reuses the
 * proven one instead of inventing another.
 *
 * Computation happens **during render** (pure and cheap: one pass over the entries
 * in range), so there is no async state and nothing to drop — the value is read
 * synchronously from a store that is already filled.
 *
 * The pure part (`deriveTimeAnalysis`) lives in `analysisData.ts` so tests can
 * exercise the real derivation without a React store; this file only wires the
 * store into it.
 *
 * Boundary: this is the W1 原币 path only. Combined currency (FX) mode needs the
 * per-entry conversions from G-17 and is a separate, later decision.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  deriveTimeAnalysis,
  type TimeAnalysisQuery,
  type TimeAnalysisView,
} from "./analysisData.js";
import {
  ledgerSnapshotValue,
  readLocalTransactions,
  subscribeLedger,
} from "./offline/localLedger.js";

export type { TimeAnalysisQuery, TimeAnalysisView };
export { deriveTimeAnalysis };

/**
 * Read the device's entries and derive a time series, re-rendering when the ledger
 * changes (a new entry, an edit, a delete all publish to the same store).
 */
export function useTimeAnalysis(query: TimeAnalysisQuery): TimeAnalysisView {
  const all = useSyncExternalStore(subscribeLedger, ledgerSnapshotValue, ledgerSnapshotValue);

  // See `useStats`: the store is filled by the reader, not by a queryFn, so a
  // screen whose query never runs still gets data.
  useEffect(() => {
    void readLocalTransactions();
  }, []);

  const { metric, granularity, span, today, countKind, maxDays, coverage } = query;

  return useMemo(
    () =>
      deriveTimeAnalysis(all, {
        metric,
        granularity,
        span,
        today,
        ...(countKind === undefined ? {} : { countKind }),
        ...(maxDays === undefined ? {} : { maxDays }),
        ...(coverage === undefined ? {} : { coverage }),
      }),
    [all, metric, granularity, span.start, span.end, today, countKind, maxDays, coverage],
  );
}
