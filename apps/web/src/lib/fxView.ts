import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { aggregateFxAsync, aggregateFxDetailedAsync, convertFx, decimalsFor, FxError, FxHistoryService, FxResultCache, fxHistoryOptionsFromEnv, fxRangeMonths, FX_MAX_DETAIL_ENTRIES, FX_MAX_RANGE_MONTHS, type FxAggregate, type FxAggregateDetail, type FxLookup, type Transaction } from "@libellum/shared";
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
/**
 * 工作台可独立选择综合统计；不修改明细金额的设备显示偏好。
 *
 * ⚠️ **W5 维度筛选**：`filter` 在折算之前作用于本次读取的账目（`sourceEntries`），
 * 因此「缺汇率」的影响范围只统计筛选后仍保留的账目（任务 §7.2）；`filterKey` 是筛选条件的
 * 稳定序列化，必须随 `filter` 一起传入，才能让缓存与重算识别条件变化。
 */
export function useFxRange(
  from: string,
  to: string,
  active = true,
  options?: {
    readonly enabled?: boolean;
    readonly filter?: (entry: Transaction & { readonly bookId: string }) => boolean;
    readonly filterKey?: string;
  },
) {
  const mode = useFxMode(), bookId = useCurrentBookId(), { offline } = useAccountOffline();
  const enabled = options?.enabled ?? mode.enabled;
  const source = useAnalysisRange({ from, to }, enabled && active);
  const sourceVersion = useMemo(() => source.data?.entries.map(row => `${row.id}:${row.version}`).sort().join("|") ?? "", [source.data]);
  const filterSignature = options?.filterKey ?? "";
  const key = JSON.stringify([mode.userId, bookId, mode.target, from, to, enabled, active, offline, sourceVersion, source.data?.sourceComplete, source.data?.offline, filterSignature]);
  const [state, setState] = useState<{
    key: string; result?: FxAggregate; sourceComplete?: boolean; offline?: boolean; error?: boolean; reason?: "capacity" | "read" | "permission";
    /** 逐日/逐笔折算投影（S-01 v2 §4.8-8 / §13）；超过 `FX_MAX_DETAIL_ENTRIES` 时为 `undefined`，聚合结果仍可用。 */
    detail?: FxAggregateDetail;
    /** 本次折算的全部原币账目（已确认属于当前账本）：投影按 id 回连它取得分类/支付方式等元数据，不重新读取。 */
    sourceEntries?: readonly (Transaction & { readonly bookId: string })[];
    /**
     * 本次折算**实际使用**的逐日汇率查询结果（键 = 交易日期；快照日期不同即发生了回退）。
     * 只读地交给 S17-C 的汇率诊断卡片（P18–P20），不重新查询、不另建汇率来源（1.17.10，additive）。
     */
    lookups?: ReadonlyMap<string, FxLookup>;
    /** 逐笔条数超出保护上限：不截断、不拿前 N 笔冒充完整，聚合金额之外的逐笔分析必须显示「无法计算」。 */
    entryLimitExceeded?: boolean;
  }>({ key: "" });
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
      const filter = options?.filter;
      const filtered = entries
        .map(row => ({ ...row, bookId }))
        .filter(row => (filter === undefined ? true : filter(row)));
      const lookups = new Map<string, FxLookup>();
      for (const date of new Set(filtered.filter(row => row.currency !== mode.target).map(row => row.occurredLocalDate))) {
        check(); lookups.set(date, await rates.lookup(date, { offline: local }));
      }
      // 逐笔投影是综合分析卡片的统一输入；超过保护上限时不截断、不提高上限，退回仅聚合并明确标记。
      let result: FxAggregate, detail: FxAggregateDetail | undefined, entryLimitExceeded = false;
      try {
        const detailed = await aggregateFxDetailedAsync(mode.userId, bookId, filtered, mode.target, lookups, { signal: controller.signal }, { includeEntries: true, maxEntries: FX_MAX_DETAIL_ENTRIES });
        const { detail: projected, ...aggregate } = detailed;
        result = aggregate; detail = projected;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "fx_detail_limit") throw error;
        entryLimitExceeded = true;
        result = await aggregateFxAsync(mode.userId, bookId, filtered, mode.target, lookups, { signal: controller.signal });
      }
      check(); setState({ key, result, sourceComplete, offline: local, sourceEntries: filtered, lookups, ...(detail === undefined ? {} : { detail }), ...(entryLimitExceeded ? { entryLimitExceeded } : {}) });
    })().catch(() => { if (!controller.signal.aborted && offlineScope() === scope) setState({ key, error: true, reason: "read" }); });
    return () => controller.abort();
  // 原件变化会触发重算；写入现有月份副本不改变原始财务事实。
  }, [key, source.data, source.error, retry]);
  const sourceFailure = source.error ? { error: true, reason: source.permissionDenied ? "permission" as const : source.capacityExceeded ? "capacity" as const : "read" as const } : {};
  return { ...mode, enabled, ...(state.key === key && !source.error ? state : {}), ...sourceFailure, loading: enabled && active && !source.error && (source.loading || state.key !== key || (!state.result && !state.error)),
    refresh: () => { source.refresh(); setRetry(value => value + 1); } };
}
