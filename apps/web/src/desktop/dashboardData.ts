/**
 * 总览卡片用到的金额汇总（纯函数，便于测试）。数据来自各账本的工作台作用域（与分析页同一份读取）：
 *
 * - 原币：按币种分别相加，不折算；同一笔交易记在几本账里就分别计入（与 1.18.12 起的多账本收支卡片一致）。
 * - 综合折算：用各账本已经折算好的结果（S16-D 的逐笔历史汇率），缺汇率的笔数照实说明，不拿原币数字冒充。
 * - 只统计作用域时间范围内、未删除的账目（作用域里游客的本机账目可能比范围多，这里再按日期过滤一次）。
 */
import { addDays, daysBetween, type DateRange, type Transaction } from "@libellum/shared";

import type { WorkbenchScope } from "../statsWorkbench/scope.js";

export interface CurrencyTotals {
  readonly currency: string;
  readonly expense: number;
  readonly income: number;
  readonly balance: number;
  readonly count: number;
}

export function inRange(entry: Transaction, range: DateRange): boolean {
  return entry.occurredLocalDate >= range.from && entry.occurredLocalDate <= range.to;
}

/** 按币种汇总；`preferred` 排在最前，其余按支出从多到少。 */
export function totalsByCurrency(entries: readonly Transaction[], range: DateRange, preferred: string): readonly CurrencyTotals[] {
  const map = new Map<string, { expense: number; income: number; count: number }>();
  for (const entry of entries) {
    if (!inRange(entry, range)) continue;
    const item = map.get(entry.currency) ?? { expense: 0, income: 0, count: 0 };
    if (entry.kind === "expense") item.expense += entry.amountCents;
    else item.income += entry.amountCents;
    item.count += 1;
    map.set(entry.currency, item);
  }
  return [...map.entries()]
    .map(([currency, item]) => ({ currency, expense: item.expense, income: item.income, balance: item.income - item.expense, count: item.count }))
    .sort((a, b) => (a.currency === preferred ? -1 : b.currency === preferred ? 1 : b.expense - a.expense || a.currency.localeCompare(b.currency)));
}

/** 几本账按币种合计（原币，不折算）。 */
export function mergeTotals(lists: readonly (readonly CurrencyTotals[])[], preferred: string): readonly CurrencyTotals[] {
  const map = new Map<string, { expense: number; income: number; count: number }>();
  for (const list of lists) {
    for (const item of list) {
      const sum = map.get(item.currency) ?? { expense: 0, income: 0, count: 0 };
      sum.expense += item.expense;
      sum.income += item.income;
      sum.count += item.count;
      map.set(item.currency, sum);
    }
  }
  return [...map.entries()]
    .map(([currency, item]) => ({ currency, expense: item.expense, income: item.income, balance: item.income - item.expense, count: item.count }))
    .sort((a, b) => (a.currency === preferred ? -1 : b.currency === preferred ? 1 : b.expense - a.expense || a.currency.localeCompare(b.currency)));
}

/** 范围内每天的支出（或收入）合计，只看一个币种；最长 400 天。 */
export function dailySeries(entries: readonly Transaction[], range: DateRange, currency: string, kind: "expense" | "income" = "expense"): readonly { readonly date: string; readonly value: number }[] {
  // `daysBetween` 已包含首尾两天。
  const days = Math.min(400, daysBetween(range.from, range.to));
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== kind || entry.currency !== currency || !inRange(entry, range)) continue;
    totals.set(entry.occurredLocalDate, (totals.get(entry.occurredLocalDate) ?? 0) + entry.amountCents);
  }
  return Array.from({ length: Math.max(0, days) }, (_, index) => {
    const date = addDays(range.from, index);
    return { date, value: totals.get(date) ?? 0 };
  });
}

/** 一本账在总览上的金额：原币按币种，综合折算给一行目标币种的合计。 */
export interface BookFigures {
  readonly state: "loading" | "failed" | "denied" | "ready";
  readonly totals: readonly CurrencyTotals[];
  /** 综合折算：缺汇率、未计入的笔数（原币时为 0）。 */
  readonly missing: number;
  readonly combined: boolean;
}

function minorToNumber(value: string | undefined): number {
  if (value === undefined || !/^-?\d+$/.test(value)) return 0;
  return Number(value);
}

export function bookFigures(scope: WorkbenchScope | undefined, preferred: string): BookFigures {
  if (scope === undefined) return { state: "loading", totals: [], missing: 0, combined: false };
  if (scope.rangeReadState === "no-permission") return { state: "denied", totals: [], missing: 0, combined: scope.combined };
  if (scope.rangeReadState === "request-failed") return { state: "failed", totals: [], missing: 0, combined: scope.combined };
  if (!scope.loaded) return { state: "loading", totals: [], missing: 0, combined: scope.combined };
  if (scope.combined) {
    const fx = scope.fx;
    if (fx === null || fx.loading === true) return { state: "loading", totals: [], missing: 0, combined: true };
    if (fx.error === true || fx.result === undefined) return { state: "failed", totals: [], missing: 0, combined: true };
    const totals = fx.result.totals;
    const expense = minorToNumber(totals.expenseMinor);
    const income = minorToNumber(totals.incomeMinor);
    return {
      state: "ready",
      totals: [{ currency: fx.result.targetCurrency, expense, income, balance: income - expense, count: fx.result.convertedCount }],
      missing: fx.result.missingCount,
      combined: true,
    };
  }
  return { state: "ready", totals: totalsByCurrency(scope.entries, scope.range, preferred), missing: 0, combined: false };
}

/** 综合折算时某天的支出（目标币种）；没有逐日结果时返回 `null`。 */
export function combinedDaily(scope: WorkbenchScope, kind: "expense" | "income" = "expense"): readonly { readonly date: string; readonly value: number }[] | null {
  const daily = scope.fx?.detail?.daily;
  if (daily === undefined) return null;
  const days = Math.min(400, daysBetween(scope.range.from, scope.range.to));
  return Array.from({ length: Math.max(0, days) }, (_, index) => {
    const date = addDays(scope.range.from, index);
    const totals = daily[date];
    return { date, value: totals === undefined ? 0 : minorToNumber(kind === "expense" ? totals.expenseMinor : totals.incomeMinor) };
  });
}
