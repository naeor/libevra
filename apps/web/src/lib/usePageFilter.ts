import { useCallback, useLayoutEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { useAuthOptional } from "../auth/AuthProvider.js";
import { ALL_MONTHS } from "./datetime.js";
import type { DetailFilters } from "./detailFilters.js";
import { useGuestIdentity } from "./guest/session.js";
import { hasFilterParams, takeFilterParams, useLedgerFilter, type FilterSlot } from "./ledgerFilter.js";
import { useViewBookId } from "./workspaceLedger.js";

/** 本机筛选按谁存：正式账号或游客身份。 */
export function useFilterOwner(): string | null {
  const user = useAuthOptional()?.user ?? null;
  const guest = useGuestIdentity();
  return user !== null ? `user:${user.id}` : guest !== null ? `guest:${guest.id}` : null;
}

/**
 * 明细（`ledger`）或分析（`analysis`）这一页的筛选（1.19.53，见 `ledgerFilter.ts`）。
 *
 * 地址栏带着筛选参数打开时（旧链接、卡片详情的“去明细看”），先把它们读进来、再从地址栏移除；
 * `incoming` 在移除之前就用于第一次渲染，所以不会先闪一下旧条件。
 */
export function usePageFilter(page: FilterSlot, options: { readonly readParams?: (params: URLSearchParams, current: DetailFilters) => { readonly value: DetailFilters; readonly rest: URLSearchParams } | null } = {}): {
  readonly value: DetailFilters;
  readonly set: (next: DetailFilters) => void;
  readonly setMonth: (month: string) => void;
  readonly slot: FilterSlot;
  readonly owner: string | null;
  readonly bookId: string | null;
} {
  const owner = useFilterOwner();
  const bookId = useViewBookId();
  const filter = useLedgerFilter(page, owner, bookId);
  const [params, setParams] = useSearchParams();
  const take = options.readParams ?? ((p: URLSearchParams, current: DetailFilters) => (hasFilterParams(p) ? takeFilterParams(p, current) : null));
  const incoming = useRef<{ readonly value: DetailFilters; readonly rest: URLSearchParams } | null | undefined>(undefined);
  if (incoming.current === undefined) incoming.current = take(params, filter.value);
  useLayoutEffect(() => {
    const pending = incoming.current;
    if (!pending || !filter.ready) return;
    incoming.current = null;
    filter.set(pending.value);
    setParams(pending.rest, { replace: true });
  }, [filter, setParams]);
  // 之后再从站内链接带着参数回到这一页（同一实例）：同样读进来。
  const key = params.toString();
  const lastKey = useRef(key);
  useLayoutEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    const next = take(new URLSearchParams(key), filter.value);
    if (next === null || !filter.ready) return;
    filter.set(next.value);
    setParams(next.rest, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在地址参数变化时读入一次
  }, [key]);
  const value = incoming.current?.value ?? filter.value;
  const { set } = filter;
  const setMonth = useCallback((month: string) => {
    set({ ...value, month, months: [], ...(month === ALL_MONTHS ? {} : { from: "", to: "" }) });
  }, [set, value]);
  return { value, set, setMonth, slot: filter.slot, owner, bookId };
}
