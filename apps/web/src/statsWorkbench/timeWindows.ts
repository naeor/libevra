/**
 * 卡片的**相对时间窗口**（1.17.12）：「最近 7 个完整自然日」「本月至今」「最近 6 个完整自然月」……
 *
 * 为什么需要：布局预设（新手 / 进阶 / 专业）里同一个工作台要同时看「本周」与「本月」；固定日期区间
 * （`rangePolicy: "pinned"`）会随时间过期，跟随顶部筛选又只有一个范围。相对窗口按**今天**解析成真实
 * 日期，再走与固定区间完全相同的读取路径（`useCardScope`），不另写计算。
 *
 * 保存在哪里：`card.chart.options.window`（D 的 `chart.options` 是自由对象，组合配置也存在那里），
 * **不改 D 的布局 schema、不需要迁移**。旧版本不认识这个键，按「跟随顶部筛选」显示（安全降级）；
 * 卡片副标题写明窗口与实际日期，用户不会把它误读成顶部的时间。
 */
import { addDays, endOfMonth, startOfMonth, type DateRange } from "@libellum/shared";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

export const RELATIVE_WINDOWS = ["last-7-days", "month-to-date", "previous-month", "last-4-weeks", "last-6-months", "last-12-months"] as const;

export type RelativeWindow = (typeof RELATIVE_WINDOWS)[number];

const WINDOW_SET: ReadonlySet<string> = new Set(RELATIVE_WINDOWS);

export function isRelativeWindow(value: unknown): value is RelativeWindow {
  return typeof value === "string" && WINDOW_SET.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 卡片设置的相对窗口；没有（或来自更新版本、不认识）时为 `null`，按其它规则取时间。 */
export function cardWindow(card: AnalysisCardNode): RelativeWindow | null {
  const options = card.chart.options;
  if (!isRecord(options)) return null;
  const value = options["window"];
  return isRelativeWindow(value) ? value : null;
}

/** 写入或去掉相对窗口；`chart.options` 里的其它键（组合配置等）原样保留。设置窗口时同时取消固定区间。 */
export function withWindow(card: AnalysisCardNode, window: RelativeWindow | null): AnalysisCardNode {
  const options: Record<string, unknown> = isRecord(card.chart.options) ? { ...card.chart.options } : {};
  if (window === null) delete options["window"];
  else options["window"] = window;
  const chart = Object.keys(options).length === 0 ? { chartFamily: card.chart.chartFamily } : { chartFamily: card.chart.chartFamily, options };
  if (window === null) return { ...card, chart };
  const { pinnedRange: _pinned, ...rest } = card;
  return { ...rest, chart, rangePolicy: "inherit" };
}

/** 只带窗口的展示配置（展示别名、组合槽位生成虚拟卡片时用）：不复制组合配置等其它键。 */
export function windowOptions(card: AnalysisCardNode): { readonly options?: Readonly<Record<string, unknown>> } {
  const window = cardWindow(card);
  return window === null ? {} : { options: { window } };
}

/** ISO 星期：周一 1 … 周日 7。 */
function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function monthsBefore(monthStart: string, count: number): string {
  let cursor = monthStart;
  for (let index = 0; index < count; index += 1) cursor = startOfMonth(addDays(cursor, -1));
  return cursor;
}

/**
 * 按「今天」解析成闭区间：
 * - `last-7-days`：最近 7 个**完整**自然日（不含今天）；
 * - `month-to-date`：本月 1 日至今天；
 * - `previous-month`：上一个完整自然月；
 * - `last-4-weeks`：最近 4 个完整自然周（周一至周日，止于今天之前最近的周日）；
 * - `last-6-months` / `last-12-months`：最近 6 / 12 个完整自然月（不含本月）。
 */
export function resolveWindow(window: RelativeWindow, today: string): DateRange {
  switch (window) {
    case "last-7-days":
      return { from: addDays(today, -7), to: addDays(today, -1) };
    case "month-to-date":
      return { from: startOfMonth(today), to: today };
    case "previous-month": {
      const end = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(end), to: end };
    }
    case "last-4-weeks": {
      const end = addDays(today, -isoWeekday(today));
      return { from: addDays(end, -27), to: end };
    }
    case "last-6-months":
    case "last-12-months": {
      const months = window === "last-6-months" ? 6 : 12;
      const thisMonth = startOfMonth(today);
      return { from: monthsBefore(thisMonth, months), to: endOfMonth(addDays(thisMonth, -1)) };
    }
  }
}
