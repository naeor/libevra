import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { aggregateFxAsync, convertFx, decimalsFor, FxError, FxHistoryService, FxResultCache, fxHistoryOptionsFromEnv, fxRangeMonths, FX_MAX_RANGE_MONTHS, type FxAggregate, type FxLookup, type Transaction, type TransactionListResponse } from "@libellum/shared";
import { useAuthOptional } from "../auth/AuthProvider.js";
import { apiFetch, ApiRequestError } from "./api.js";
import { useCurrentBookId } from "./queries.js";
import { useAccountOffline } from "./offline/connectivity.js";
import { OfflineFxRepository } from "./offline/fx.js";
import { offlineScope } from "./offline/scope.js";
import { readLocalTransactions, readStoredMonths, readMarks, storeMonth, subscribeLedger, ledgerSnapshotValue } from "./offline/localLedger.js";
import { mergeLedgerEntries } from "./ledgerView.js";
import { readValue, writeValue } from "./offline/storage.js";
import { withDeadline } from "./offline/deadline.js";
import { fxModeKey } from "./deviceStorageKeys.js";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());
if (typeof window !== "undefined") window.addEventListener("storage", notify);
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function readFxMode(id: string): boolean {
  try { return !!id && localStorage.getItem(fxModeKey(id)) === "on"; } catch { return false; }
}
export function saveFxMode(id: string, enabled: boolean): boolean {
  if (!id) return false;
  try { localStorage.setItem(fxModeKey(id), enabled ? "on" : "off"); notify(); return true; } catch { return false; }
}
export function useFxMode() {
  const user = useAuthOptional()?.user;
  const id = user?.id ?? "";
  const enabled = useSyncExternalStore(subscribe, () => readFxMode(id), () => false);
  return { enabled, userId: id, target: user?.defaultCurrency ?? "CNY", setEnabled: (value: boolean) => saveFxMode(id, value) };
}
const rates = new FxHistoryService(new OfflineFxRepository(), {
  id: "ecb-via-frankfurter-v2",
  async fetch(date) {
    const answer = await apiFetch<FxLookup>("/fx/rates", { query: { date } });
    if (answer.status !== "available") throw new FxError(answer.reason);
    return answer.snapshot;
  },
}, fxHistoryOptionsFromEnv(import.meta.env ?? {}, "VITE_"));
export function useFxEntry(entry: Transaction) {
  const mode = useFxMode(), { offline } = useAccountOffline();
  const bookId = useCurrentBookId();
  const cache = useMemo(() => new FxResultCache(1), [mode.userId, bookId]);
  const query = useQuery({ queryKey: ["fx-public-rate", entry.occurredLocalDate, offline],
    queryFn: () => rates.lookup(entry.occurredLocalDate, { offline }), staleTime: 60000,
    enabled: mode.enabled && entry.currency !== mode.target, networkMode: "always", retry: false,
    meta: { volatile: true },
  });
  return { ...mode, offline, loading: mode.enabled && entry.currency !== mode.target && query.isPending,
    result: bookId && mode.userId ? cache.convert(mode.userId, bookId, { ...entry, bookId }, mode.target, query.data)
      : convertFx({ ...entry, bookId: "" }, mode.target, { status: "unavailable", reason: "missing_rate" }), error: query.isError };
}
/** 安全整数之外仍准确格式化；不把派生字符串转回 number。 */
export function fxMoney(minor: string, currency: string): string {
  const digits = decimalsFor(currency), n = BigInt(minor), negative = n < 0n, absolute = negative ? -n : n;
  const text = absolute.toString().padStart(digits + 1, "0");
  const whole = digits ? text.slice(0, -digits) : text;
  return `${negative ? "−" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${digits ? "." + text.slice(-digits) : ""} ${currency}`;
}
/** 月键枚举（S-01 v2 draft，B-S01v2-02）：默认上限 36（对齐 S-01 §17.1(a)），按月拆分请求。 */
export function rangeMonths(from: string, to: string, maxMonths: number = FX_MAX_RANGE_MONTHS): string[] {
  return fxRangeMonths(from, to, maxMonths);
}
/** 线性核对，避免数万笔时 receipt × 原件的双重扫描。 */
export function fxMonthStored(rows: readonly Transaction[], stored: readonly Transaction[]): boolean {
  const versions = new Map(stored.map(row => [row.id, row.version]));
  return rows.every(row => (versions.get(row.id) ?? -1) >= row.version);
}
export function fxMonthCovered(ids: readonly string[] | undefined, stored: readonly Transaction[] | undefined): boolean {
  if (!ids || !stored) return false;
  const present = new Set(stored.map(row => row.id));
  return ids.every(id => present.has(id));
}
export function mergeFxOriginals(remote: readonly Transaction[], local: readonly Transaction[], marks: Readonly<Record<string, { pending?: boolean; deleted?: boolean }>>): readonly Transaction[] {
  const pending = new Set(Object.keys(marks).filter(id => marks[id]?.pending)), deleted = new Set(Object.keys(marks).filter(id => marks[id]?.deleted));
  const remoteIds = new Set(remote.map(row => row.id));
  return mergeLedgerEntries(local.filter(row => pending.has(row.id) || remoteIds.has(row.id)), remote, pending, {}, deleted);
}
export function useFxRange(from: string, to: string, active = true) {
  const mode = useFxMode(), bookId = useCurrentBookId(), { offline } = useAccountOffline();
  const snapshot = useSyncExternalStore(subscribeLedger, ledgerSnapshotValue, ledgerSnapshotValue);
  const revision = useMemo(() => mode.enabled && active
    ? snapshot.filter(row => row.occurredLocalDate >= from && row.occurredLocalDate <= to).map(row => `${row.id}:${row.version}`).sort().join("|") : "",
  [snapshot, from, to, mode.enabled, active]);
  const key = JSON.stringify([mode.userId, bookId, mode.target, from, to, mode.enabled, active, offline]);
  const [state, setState] = useState<{ key: string; result?: FxAggregate; sourceComplete?: boolean; offline?: boolean; error?: boolean; reason?: "capacity" | "read" }>({ key: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!mode.enabled || !active || !mode.userId || !bookId) return;
    const controller = new AbortController(), scope = `${mode.userId}:${bookId}`;
    const check = () => { controller.signal.throwIfAborted(); if (offlineScope() !== scope) throw new Error("fx_scope_changed"); };
    const coverageKey = `fx-month-coverage:${scope}`;
    setState({ key });
    void (async () => {
      check();
      const months = rangeMonths(from, to);
      let entries: readonly Transaction[], sourceComplete = true, local = offline;
      const remote = new Map<string, Transaction>();
      try {
        if (offline) throw new TypeError("offline");
        for (const month of months) {
          const rows: Transaction[] = []; let cursor: string | undefined;
          do {
            check();
            const page = await apiFetch<TransactionListResponse>("/transactions", { query: { month, cursor }, bookId });
            rows.push(...page.items); cursor = page.nextCursor ?? undefined;
            for (const row of page.items) remote.set(row.id, row);
            if (remote.size > 100000) throw new Error("fx_range_capacity");
          } while (cursor);
          check(); await withDeadline(storeMonth(month, rows)); check();
          const saved = await withDeadline(readStoredMonths()); check();
          if (saved.value && fxMonthStored(rows, saved.value[month] ?? [])) {
            const prior = await withDeadline(readValue<Record<string, string[]>>(coverageKey)); check();
            if (!prior.timedOut) await withDeadline(writeValue(coverageKey, { ...prior.value, [month]: rows.map(row => row.id) }));
          }
        }
        const device = await withDeadline(Promise.all([readLocalTransactions(), readMarks()])); check();
        entries = device.value ? mergeFxOriginals([...remote.values()], device.value[0], device.value[1]) : [...remote.values()];
        if (device.timedOut) sourceComplete = false;
      } catch (error) {
        check();
        if ((error instanceof ApiRequestError && error.status !== 0) || (error instanceof Error && error.message === "fx_range_capacity")) throw error;
        local = true;
        const saved = await withDeadline(Promise.all([readStoredMonths(), readValue<Record<string, string[]>>(coverageKey), readLocalTransactions()]));
        check(); if (!saved.value) throw new Error("fx_storage_timeout");
        const [stored, receipts, rows] = saved.value;
        sourceComplete = months.every(month => fxMonthCovered(receipts?.[month], stored[month]));
        entries = rows;
      }
      // 现有 DTO 不含 bookId；归属来自已鉴权请求与捕获的离线作用域，不由流水自行声明。
      const filtered = entries.filter(row => row.occurredLocalDate >= from && row.occurredLocalDate <= to && !row.deletedAt).map(row => ({ ...row, bookId }));
      const lookups = new Map<string, FxLookup>();
      for (const date of new Set(filtered.filter(row => row.currency !== mode.target).map(row => row.occurredLocalDate))) {
        check(); lookups.set(date, await rates.lookup(date, { offline: local }));
      }
      check(); const result = await aggregateFxAsync(mode.userId, bookId, filtered, mode.target, lookups, { signal: controller.signal });
      check(); setState({ key, result, sourceComplete, offline: local });
    })().catch(error => { if (!controller.signal.aborted && offlineScope() === scope) setState({ key, error: true, reason: error instanceof Error && error.message === "fx_range_capacity" ? "capacity" : "read" }); });
    return () => controller.abort();
  // 原件变化会触发重算；写入现有月份副本不改变原始财务事实。
  }, [key, revision, retry]);
  return { ...mode, ...(state.key === key ? state : {}), loading: state.key !== key || (!state.result && !state.error),
    refresh: () => setRetry(value => value + 1) };
}
