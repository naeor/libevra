import { MAX_STATS_DAYS, addDays } from "@libellum/shared";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { ALL_MONTHS, currentMonth, isAllMonths, toLocalDate } from "../lib/datetime.js";
import { emptyDetailFilters, type DetailFilters } from "../lib/detailFilters.js";
import { usePageFilter } from "../lib/usePageFilter.js";
import { customRangeProblem, readFilters, resolveRange, type TimeChoice, type WorkbenchFilters } from "./filters.js";

/**
 * 分析页与明细共用的筛选（1.19.53）。
 *
 * 筛选本身是明细的那一份（`DetailFilters`，见 `lib/ledgerFilter.ts`）；这里把它换算成工作台的
 * `WorkbenchFilters`。“统计方式与币种”（综合折算 / 原币、查看哪个币种）仍是分析自己的显示设置，留在地址栏。
 *
 * - 月份 → 那个月；当月 → “本月”（到今天为止，与原来的默认一致）。
 * - “全部时间”与超过 400 天的日期范围：分析的统计口径最多 400 天（`MAX_STATS_DAYS`），按截至今天 / 截至结束日的
 *   最近 400 天计算，并在页面上说明（`capped`），不悄悄少算也不报错。
 * - 分类（含子分类）、支付方式（含“未指定”）、标签、币种、附件：逐项对应，分析统计的就是明细筛出来的账目。
 */
export function workbenchFromLedgerFilter(value: DetailFilters, display: { readonly currency: WorkbenchFilters["currency"]; readonly combined: boolean }, today: string): { readonly filters: WorkbenchFilters; readonly capped: boolean } {
  let time: TimeChoice;
  let capped = false;
  if (!isAllMonths(value.month)) {
    time = value.month === today.slice(0, 7) ? { kind: "this-month" } : { kind: "month", month: value.month };
  } else if (value.from && value.to && value.from <= value.to) {
    let from = value.from;
    if (customRangeProblem(from, value.to) === "too-long") { from = addDays(value.to, -(MAX_STATS_DAYS - 1)); capped = true; }
    time = { kind: "custom", from, to: value.to };
  } else {
    time = { kind: "custom", from: addDays(today, -(MAX_STATS_DAYS - 1)), to: today };
    capped = true;
  }
  const filters: WorkbenchFilters = {
    time,
    currency: display.currency,
    combined: display.combined,
    categoryIds: value.categories.length > 0 ? value.categories : null,
    ...(value.branches.length > 0 ? { categoryBranchIds: value.branches } : {}),
    paymentMethodIds: value.payments.length > 0 ? value.payments : null,
    tagIds: value.tags.length > 0 ? value.tags : null,
    currencies: value.currencies.length > 0 ? value.currencies : null,
    attachment: { attachment: value.attachment, type: value.type, minMB: value.minMB, maxMB: value.maxMB },
  };
  return { filters, capped };
}

/** 旧链接、布局预设里的工作台条件 → 明细的筛选（反向换算；“近 N 天”变成具体的起止日期）。 */
export function ledgerFilterFromWorkbench(filters: WorkbenchFilters, today: string): DetailFilters {
  const value = emptyDetailFilters(currentMonth());
  const { time } = filters;
  if (time.kind === "month") value.month = time.month;
  else if (time.kind === "this-month") value.month = today.slice(0, 7);
  else {
    const range = resolveRange(time, today);
    value.month = ALL_MONTHS; value.from = range.from; value.to = range.to;
  }
  const branches = filters.categoryBranchIds ?? [];
  value.categories = [...new Set([...(filters.categoryIds ?? []), ...branches])];
  value.branches = [...branches];
  value.payments = [...(filters.paymentMethodIds ?? [])];
  value.tags = [...(filters.tagIds ?? [])];
  return value;
}

/** 地址栏里描述“看哪段时间、哪些分类”的旧参数（统计方式与币种 `currency` / `analysis` 不在其中）。 */
const LEGACY_KEYS = ["range", "month", "from", "to", "category", "categoryBranch", "payment", "tag"];

export function takeAnalysisParams(params: URLSearchParams, today: string): { readonly value: DetailFilters; readonly rest: URLSearchParams } | null {
  if (!LEGACY_KEYS.some(key => params.has(key))) return null;
  const value = ledgerFilterFromWorkbench(readFilters(params), today);
  const rest = new URLSearchParams(params);
  for (const key of LEGACY_KEYS) rest.delete(key);
  return { value, rest };
}

/** 布局预设附带的筛选字符串（工作台参数）→ 明细的筛选。 */
export function ledgerFilterFromPreset(presetFilters: string, today: string): DetailFilters {
  return ledgerFilterFromWorkbench(readFilters(new URLSearchParams(presetFilters)), today);
}

/** 分析页（与卡片详情页）实际使用的筛选。 */
export function useAnalysisFilters(): {
  readonly filters: WorkbenchFilters;
  readonly ledger: DetailFilters;
  readonly set: (next: DetailFilters) => void;
  readonly capped: boolean;
  readonly shared: boolean;
} {
  const [params] = useSearchParams();
  const today = useMemo(() => toLocalDate(new Date()), []);
  const page = usePageFilter("analysis", { readParams: (p) => takeAnalysisParams(p, today) });
  const display = readFilters(params);
  const { filters, capped } = useMemo(
    () => workbenchFromLedgerFilter(page.value, { currency: display.currency, combined: display.combined }, today),
    [page.value, display.currency, display.combined, today],
  );
  return { filters, ledger: page.value, set: page.set, capped, shared: page.slot === "ledger" };
}

