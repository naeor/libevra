/**
 * 综合折算测试夹具（仅测试使用，生产代码不得引用）。
 *
 * 用真实的 `aggregateFxDetailed` 生成与 `useFxRange` 完全同形的折算状态（聚合 + 逐笔 + 失败清单），
 * 使卡片测试走的是和生产相同的数据路径，而不是手写的半截模拟对象。
 *
 * 汇率取整数友好的数值，便于**手算期望值**（测试里的期望金额都是手算的字面量，而不是再调用一次被测函数）：
 *   1 EUR = 8 CNY = 1.25 USD = 10 HKD = 160 JPY
 *   ⇒ 1 USD = 6.4 CNY，1 HKD = 0.8 CNY，1 JPY = 0.05 CNY
 */
import {
  aggregateFx,
  aggregateFxDetailed,
  FxResultCache,
  type FxLookup,
  type FxSnapshot,
  type Transaction,
} from "@libellum/shared";

import type { FxRangeView } from "./scope.js";

export const FX_TEST_RATES: Readonly<Record<string, string>> = { EUR: "1", CNY: "8", USD: "1.25", HKD: "10", JPY: "160" };

export function lookupFor(date: string, rates: Readonly<Record<string, string>> = FX_TEST_RATES): FxLookup {
  const snapshot: FxSnapshot = {
    base: "EUR",
    date,
    provider: "fixture",
    revision: "r1",
    fetchedAt: `${date}T12:00:00.000Z`,
    rates: { ...rates },
  };
  return { status: "available", snapshot, cached: false };
}

export interface FxViewOptions {
  readonly entries: readonly Transaction[];
  readonly target?: string;
  /** 这些日期没有汇率可用（缺汇率）；默认每个日期都有。 */
  readonly missingDates?: readonly string[];
  /** 这些币种在任何日期都没有汇率。 */
  readonly missingCurrencies?: readonly string[];
  readonly sourceComplete?: boolean;
  /** 模拟逐笔条数上限（生产是 50_000）。 */
  readonly maxEntries?: number;
  readonly loading?: boolean;
  readonly error?: { readonly reason: "capacity" | "read" | "permission" };
  readonly rates?: Readonly<Record<string, string>>;
}

export function buildFxView(options: FxViewOptions): FxRangeView {
  const target = options.target ?? "CNY";
  const bookId = "fixture-book";
  const rows = options.entries.map((row) => ({ ...row, bookId }));
  const lookups = new Map<string, FxLookup>();
  const blockedDates = new Set(options.missingDates ?? []);
  const blockedCurrencies = new Set(options.missingCurrencies ?? []);
  for (const row of rows) {
    if (row.currency === target) continue;
    if (blockedDates.has(row.occurredLocalDate) || blockedCurrencies.has(row.currency)) continue;
    lookups.set(row.occurredLocalDate, lookupFor(row.occurredLocalDate, options.rates));
  }
  const base = {
    enabled: true,
    userId: "fixture-account",
    target,
    setEnabled: () => true,
    refresh: () => undefined,
  };
  if (options.loading === true) return { ...base, loading: true } as unknown as FxRangeView;
  if (options.error !== undefined) {
    return { ...base, loading: false, error: true, reason: options.error.reason } as unknown as FxRangeView;
  }
  let result;
  let detail;
  let entryLimitExceeded = false;
  try {
    const detailed = aggregateFxDetailed("fixture-account", bookId, rows, target, lookups, new FxResultCache(), {
      includeEntries: true,
      maxEntries: options.maxEntries ?? 50_000,
    });
    const { detail: projected, ...aggregate } = detailed;
    result = aggregate;
    detail = projected;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "fx_detail_limit") throw error;
    entryLimitExceeded = true;
    result = aggregateFx("fixture-account", bookId, rows, target, lookups, new FxResultCache());
  }
  return {
    ...base,
    loading: false,
    result,
    sourceComplete: options.sourceComplete ?? true,
    offline: false,
    sourceEntries: rows,
    lookups,
    ...(detail === undefined ? {} : { detail }),
    ...(entryLimitExceeded ? { entryLimitExceeded } : {}),
  } as unknown as FxRangeView;
}

/** 一笔账目，字段齐全；测试只关心的字段通过 `overrides` 给出。 */
export function tx(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    kind: "expense",
    amountCents: 1000,
    currency: "CNY",
    categoryId: "c-food",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: null,
    paymentMethodName: null,
    occurredAt: "2026-10-02T04:00:00.000Z",
    occurredLocalDate: "2026-10-02",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    ...overrides,
  };
}
