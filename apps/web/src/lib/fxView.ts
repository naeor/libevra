import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { aggregateFxAsync, convertFx, decimalsFor, FxError, FxHistoryService, FxResultCache, fxHistoryOptionsFromEnv, fxRangeMonths, FX_MAX_RANGE_MONTHS, type FxAggregate, type FxLookup, type Transaction } from "@libellum/shared";
import { useAuthOptional } from "../auth/AuthProvider.js";
import { apiFetch } from "./api.js";
import { useCurrentBookId } from "./queries.js";
import { useAccountOffline } from "./offline/connectivity.js";
import { OfflineFxRepository } from "./offline/fx.js";
import { offlineScope } from "./offline/scope.js";
import { fxModeKey } from "./deviceStorageKeys.js";
import { useAnalysisRange } from "./analysisRange.js";
export { analysisMonthStored as fxMonthStored, analysisMonthCovered as fxMonthCovered, mergeAnalysisOriginals as mergeFxOriginals } from "./analysisRange.js";

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
/** 工作台可独立选择综合统计；不修改明细金额的设备显示偏好。 */
export function useFxRange(from: string, to: string, active = true, options?: { readonly enabled?: boolean }) {
  const mode = useFxMode(), bookId = useCurrentBookId(), { offline } = useAccountOffline();
  const enabled = options?.enabled ?? mode.enabled;
  const source = useAnalysisRange({ from, to }, enabled && active);
  const sourceVersion = useMemo(() => source.data?.entries.map(row => `${row.id}:${row.version}`).sort().join("|") ?? "", [source.data]);
  const key = JSON.stringify([mode.userId, bookId, mode.target, from, to, enabled, active, offline, sourceVersion, source.data?.sourceComplete, source.data?.offline]);
  const [state, setState] = useState<{ key: string; result?: FxAggregate; sourceComplete?: boolean; offline?: boolean; error?: boolean; reason?: "capacity" | "read" | "permission" }>({ key: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !active || !mode.userId || !bookId || source.data === undefined || source.error) return;
    const controller = new AbortController(), scope = `${mode.userId}:${bookId}`;
    const check = () => { controller.signal.throwIfAborted(); if (offlineScope() !== scope) throw new Error("fx_scope_changed"); };
    setState({ key });
    void (async () => {
      check();
      // 现有 DTO 不含 bookId；归属来自已鉴权请求与捕获的离线作用域，不由流水自行声明。
      const { entries, sourceComplete, offline: local } = source.data!;
      const filtered = entries.map(row => ({ ...row, bookId }));
      const lookups = new Map<string, FxLookup>();
      for (const date of new Set(filtered.filter(row => row.currency !== mode.target).map(row => row.occurredLocalDate))) {
        check(); lookups.set(date, await rates.lookup(date, { offline: local }));
      }
      check(); const result = await aggregateFxAsync(mode.userId, bookId, filtered, mode.target, lookups, { signal: controller.signal });
      check(); setState({ key, result, sourceComplete, offline: local });
    })().catch(() => { if (!controller.signal.aborted && offlineScope() === scope) setState({ key, error: true, reason: "read" }); });
    return () => controller.abort();
  // 原件变化会触发重算；写入现有月份副本不改变原始财务事实。
  }, [key, source.data, source.error, retry]);
  const sourceFailure = source.error ? { error: true, reason: source.permissionDenied ? "permission" as const : source.capacityExceeded ? "capacity" as const : "read" as const } : {};
  return { ...mode, enabled, ...(state.key === key && !source.error ? state : {}), ...sourceFailure, loading: enabled && active && !source.error && (source.loading || state.key !== key || (!state.result && !state.error)),
    refresh: () => { source.refresh(); setRetry(value => value + 1); } };
}
