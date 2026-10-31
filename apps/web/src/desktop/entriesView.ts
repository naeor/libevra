/**
 * 电脑版明细的纯计算：搜索匹配、按日分组、每日趋势。只读已经载入的账目，不做新的财务口径。
 */
import { UNCATEGORISED_NAME, type Transaction } from "@libellum/shared";

import { displayCategoryName, displayPaymentMethodName } from "../lib/presetNames.js";

export type EntryKindFilter = "all" | "expense" | "income";

/** 搜索：备注、分类、支付方式、标签、编号与金额（按显示形式，如 `38.5`）。大小写与空格不敏感，多个词都要命中。 */
export function entryMatches(entry: Transaction, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return true;
  const amount = (entry.amountCents / 100).toFixed(2);
  const haystack = [
    entry.note ?? "",
    displayCategoryName(entry.categoryIsSystem ? UNCATEGORISED_NAME : entry.categoryName),
    entry.categoryName,
    entry.paymentMethodName === null ? "" : `${entry.paymentMethodName} ${displayPaymentMethodName(entry.paymentMethodName)}`,
    entry.tags.map((tag) => tag.name).join(" "),
    entry.seq === undefined ? "" : `#${String(entry.seq)}`,
    amount,
    amount.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

export interface DayGroup {
  readonly date: string;
  readonly entries: readonly Transaction[];
}

/** 已按时间排好的账目按本地日期分组，组的顺序与账目顺序一致。 */
export function groupByDay(entries: readonly Transaction[]): readonly DayGroup[] {
  const groups = new Map<string, Transaction[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.occurredLocalDate) ?? [];
    bucket.push(entry);
    groups.set(entry.occurredLocalDate, bucket);
  }
  return [...groups.entries()].map(([date, items]) => ({ date, entries: items }));
}

/** 一个月里每一天某币种的支出合计（分），下标 0 是 1 号。只算这一币种，不做折算。 */
export function dailyTotals(entries: readonly Transaction[], month: string, currency: string): readonly number[] {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 1 || monthIndex > 12) return [];
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const totals = new Array<number>(days).fill(0);
  for (const entry of entries) {
    if (entry.kind !== "expense" || entry.currency !== currency || !entry.occurredLocalDate.startsWith(month)) continue;
    const day = Number(entry.occurredLocalDate.slice(8, 10));
    if (day >= 1 && day <= days) totals[day - 1] = (totals[day - 1] ?? 0) + entry.amountCents;
  }
  return totals;
}
