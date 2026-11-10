import { useCallback, useSyncExternalStore } from "react";
import { FILTER_SYNC_KEY, LEDGER_FILTER_PREFIX } from "./deviceStorageKeys.js";
import { ALL_MONTHS, currentMonth } from "./datetime.js";
import { emptyDetailFilters, readDetailFilters, type DetailFilters } from "./detailFilters.js";

/**
 * 明细与分析的筛选（1.19.53，所有者决定）。
 *
 * - **会保留**：筛选写在本机（按账号与账本），刷新页面、切 Tab、记一笔回来、从账目返回都不会把
 *   “2026 年 8 月”打回当月。原来月份只在内存会话里，扩展条件只在地址栏，刷新或经由不带参数的地址回到
 *   明细就丢了。
 * - **默认共用**：“明细与分析使用同一筛选”打开时（默认），分析页读写的就是明细的这一份；关闭后分析
 *   有自己的一份（关闭那一刻从共用的那份复制，不跳变）。开关是设备偏好，记账偏好与两个筛选面板里都能改。
 * - 地址栏里的筛选参数只当作“打开时带来的条件”（旧链接、卡片详情的“去明细看”），读进来后从地址栏移除，
 *   之后以这里为准——Tab 记住的旧地址不会把别处改过的筛选覆盖回去。
 *
 * 只描述“看哪一部分账目”，不保存金额，也不改任何账目。
 */
export type FilterSlot = "ledger" | "analysis";

type Listener = () => void;
const listeners = new Set<Listener>();
const values = new Map<string, DetailFilters | null>();
let syncValue: boolean | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** 另一个标签页改了筛选或开关：丢掉缓存，按存储重新读。 */
function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === FILTER_SYNC_KEY) syncValue = null;
  if (event.key === null || event.key.startsWith(LEDGER_FILTER_PREFIX)) values.clear();
  notify();
}

export function ledgerFilterKey(slot: FilterSlot, owner: string, bookId: string): string {
  return `${LEDGER_FILTER_PREFIX}${slot}:${owner}:${bookId}`;
}

/** 规范化：未知字段丢弃、月份不合法回到当月；非“全部”时不带日期区间（与 readDetailFilters 同一规则）。 */
export function normalizeFilter(raw: unknown, fallbackMonth: string = currentMonth()): DetailFilters | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const month = typeof record.month === "string" && (record.month === ALL_MONTHS || /^\d{4}-(0[1-9]|1[0-2])$/.test(record.month)) ? record.month : fallbackMonth;
  const params = new URLSearchParams();
  for (const key of ["months", "categories", "branches", "tags", "payments", "currencies", "recorders"] as const) {
    const list = record[key];
    if (Array.isArray(list)) for (const item of list) if (typeof item === "string" && item !== "") params.append(`f.${key}`, item);
  }
  for (const key of ["from", "to", "attachment", "type", "minMB", "maxMB"] as const) {
    const value = record[key];
    if (typeof value === "string" && value !== "") params.set(`f.${key}`, value);
  }
  return readDetailFilters(params, month);
}

function readStored(key: string): DetailFilters | null {
  if (values.has(key)) return values.get(key) ?? null;
  let parsed: DetailFilters | null = null;
  try {
    const text = storage()?.getItem(key);
    parsed = text ? normalizeFilter(JSON.parse(text)) : null;
  } catch {
    parsed = null;
  }
  values.set(key, parsed);
  return parsed;
}

function writeStored(key: string, value: DetailFilters): void {
  values.set(key, value);
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // 无痕模式等：本次会话内仍然生效（内存缓存），只是刷新后不保留。
  }
  notify();
}

export function sameFilter(a: DetailFilters, b: DetailFilters): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// 同步开关（设备偏好，默认开）
// ---------------------------------------------------------------------------

export function filterSyncEnabled(): boolean {
  if (syncValue !== null) return syncValue;
  try {
    syncValue = storage()?.getItem(FILTER_SYNC_KEY) !== "off";
  } catch {
    syncValue = true;
  }
  return syncValue;
}

/**
 * 改开关。关闭时把共用的那份复制给分析（分析从当前看到的条件继续，不跳回默认）；
 * 重新打开时分析回到共用的那份——也就是明细正在看的。
 */
export function setFilterSync(enabled: boolean, scope: { readonly owner: string; readonly bookId: string } | null): boolean {
  try {
    if (!enabled && scope !== null) {
      const shared = readStored(ledgerFilterKey("ledger", scope.owner, scope.bookId));
      if (shared !== null) writeStored(ledgerFilterKey("analysis", scope.owner, scope.bookId), shared);
    }
    storage()?.setItem(FILTER_SYNC_KEY, enabled ? "on" : "off");
    syncValue = enabled;
    notify();
    return true;
  } catch {
    return false;
  }
}

export function useFilterSync(): boolean {
  return useSyncExternalStore(subscribe, filterSyncEnabled, () => true);
}

// ---------------------------------------------------------------------------
// 筛选本身
// ---------------------------------------------------------------------------

/**
 * 某一页使用的筛选。`page` 是明细时总是共用的那份；是分析时按开关决定用共用的还是分析自己的。
 * `owner` / `bookId` 还不知道（账本信息尚未就绪）时退回内存里的默认值，不写存储。
 */
export function useLedgerFilter(page: FilterSlot, owner: string | null, bookId: string | null): {
  readonly value: DetailFilters;
  readonly set: (next: DetailFilters) => void;
  readonly slot: FilterSlot;
  readonly ready: boolean;
} {
  const sync = useFilterSync();
  const slot: FilterSlot = page === "ledger" || sync ? "ledger" : "analysis";
  const key = owner !== null && bookId !== null ? ledgerFilterKey(slot, owner, bookId) : null;
  const read = useCallback((): DetailFilters | null => {
    if (key === null) return null;
    const own = readStored(key);
    // 分析自己的那份还没有：从共用的那份开始（例如在别的设备上关了开关）。
    if (own === null && slot === "analysis" && owner !== null && bookId !== null) return readStored(ledgerFilterKey("ledger", owner, bookId));
    return own;
  }, [key, slot, owner, bookId]);
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const value = stored ?? defaultFilter();
  const set = useCallback((next: DetailFilters) => {
    if (key === null) return;
    const normalized = normalizeFilter(next) ?? next;
    if (sameFilter(normalized, read() ?? defaultFilter())) return;
    writeStored(key, normalized);
  }, [key, read]);
  return { value, set, slot, ready: key !== null };
}

let defaultCache: { month: string; value: DetailFilters } | null = null;
/** 没有保存过筛选：当月、无其它条件（与原来的明细默认相同）。同一个月返回同一个对象，避免无谓重算。 */
export function defaultFilter(): DetailFilters {
  const month = currentMonth();
  if (defaultCache?.month !== month) defaultCache = { month, value: emptyDetailFilters(month) };
  return defaultCache.value;
}

/** 地址栏里有没有筛选参数（旧链接、卡片详情的“去明细看”）。 */
export function hasFilterParams(params: URLSearchParams): boolean {
  for (const key of params.keys()) if (key === "month" || key === "categoryId" || key.startsWith("f.")) return true;
  return false;
}

/** 读入地址栏带来的筛选，返回去掉这些参数后的地址参数。 */
export function takeFilterParams(params: URLSearchParams, current: DetailFilters): { readonly value: DetailFilters; readonly rest: URLSearchParams } {
  const monthParam = params.get("month");
  const month = monthParam !== null && (monthParam === ALL_MONTHS || /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) ? monthParam : current.month;
  const value = readDetailFilters(params, month);
  const rest = new URLSearchParams(params);
  for (const key of [...rest.keys()]) if (key === "month" || key === "categoryId" || key === "categoryScope" || key.startsWith("f.")) rest.delete(key);
  return { value, rest };
}
