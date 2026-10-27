/**
 * 分析工作台的全局筛选（S17 状态 B：筛选展开态）。
 *
 * ⚠️ **只描述「看哪段时间、用哪个币种」，不保存任何金额。** 生效条件写在地址栏（与旧分析页同一组
 * 参数 `range` / `month` / `currency` / `analysis`，旧链接继续有效），所以从卡片详情返回、刷新页面
 * 都能恢复同一份条件；面板里尚未「应用」的草稿只存在于组件状态，绝不冒充生效条件。
 *
 * ⚠️ **时间上限沿用 `MAX_STATS_DAYS`（400 天）**：与既有统计口径、S-01 v2 §17 一致，超出的自定义
 * 区间在应用前就被拒绝，而不是截断后悄悄少算。
 */
import {
  CURRENCIES,
  MAX_STATS_DAYS,
  STATS_RANGES,
  addDays,
  daysBetween,
  endOfMonth,
  rangeForPreset,
  startOfMonth,
  type Currency,
  type DateRange,
  type StatsBucket,
  type StatsRangeKey,
} from "@libellum/shared";

export type TimeChoice =
  | { readonly kind: "preset"; readonly preset: StatsRangeKey }
  | { readonly kind: "this-month" }
  | { readonly kind: "month"; readonly month: string }
  | { readonly kind: "custom"; readonly from: string; readonly to: string };

export interface WorkbenchFilters {
  readonly time: TimeChoice;
  /** 原币模式下查看的币种；`null` = 跟随账号默认币种。 */
  readonly currency: Currency | null;
  /**
   * 是否综合折算。**只有用户在设置里开启了汇率折算（设备偏好）才有意义**；未开启时一律按原币。
   * 缺省值沿用 1.16.23 的分析页：开启折算后默认看综合（`analysis=currency` 才是原币）。
   */
  readonly combined: boolean;
}

export const DEFAULT_TIME: TimeChoice = { kind: "preset", preset: "30d" };

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isCalendarDate(value: string): boolean {
  if (!DATE.test(value) || value.startsWith("0000")) return false;
  // 2 月 30 日之类的日期：交给日历自己回答，而不是只看格式。
  return endOfMonth(value) >= value;
}

/** 自定义区间能否生效；不能时返回原因 id（文案在界面层）。 */
export function customRangeProblem(from: string, to: string): "invalid" | "order" | "too-long" | null {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return "invalid";
  if (from > to) return "order";
  if (daysBetween(from, to) > MAX_STATS_DAYS) return "too-long";
  return null;
}

/** 从地址栏读出生效条件；无法识别的值退回默认，而不是报错白屏。 */
export function readFilters(params: URLSearchParams): WorkbenchFilters {
  const range = params.get("range");
  const month = params.get("month") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const currency = params.get("currency");

  let time: TimeChoice = DEFAULT_TIME;
  if (range === "custom" && customRangeProblem(from, to) === null) time = { kind: "custom", from, to };
  else if (MONTH.test(month) && !month.startsWith("0000")) time = { kind: "month", month };
  else if (range === "this-month") time = { kind: "this-month" };
  else if (STATS_RANGES.includes(range as StatsRangeKey)) time = { kind: "preset", preset: range as StatsRangeKey };

  return {
    time,
    currency: CURRENCIES.includes(currency as Currency) ? (currency as Currency) : null,
    combined: params.get("analysis") !== "currency",
  };
}

/** 把生效条件写回地址栏；不认识的其它参数原样保留。 */
export function writeFilters(previous: URLSearchParams, filters: WorkbenchFilters): URLSearchParams {
  const next = new URLSearchParams(previous);
  for (const key of ["range", "month", "from", "to", "currency", "analysis"]) next.delete(key);

  const { time } = filters;
  if (time.kind === "preset") {
    // 默认的近 30 天不写进地址，旧链接与新链接指向同一状态。
    if (time.preset !== "30d") next.set("range", time.preset);
  } else if (time.kind === "this-month") {
    next.set("range", "this-month");
  } else if (time.kind === "month") {
    next.set("month", time.month);
  } else {
    next.set("range", "custom");
    next.set("from", time.from);
    next.set("to", time.to);
  }
  if (filters.currency !== null) next.set("currency", filters.currency);
  if (!filters.combined) next.set("analysis", "currency");
  return next;
}

/** 时间选择 → 含两端的业务日期区间（设备当地的「今天」）。 */
export function resolveRange(time: TimeChoice, today: string): DateRange {
  switch (time.kind) {
    case "preset":
      return rangeForPreset(time.preset, today);
    case "this-month":
      return { from: startOfMonth(today), to: today };
    case "month":
      return { from: `${time.month}-01`, to: endOfMonth(`${time.month}-01`) };
    case "custom":
      return { from: time.from, to: time.to };
  }
}

/** 与旧分析页一致：超过 120 天按月分桶，否则按日。 */
export function bucketFor(range: DateRange): StatsBucket {
  return daysBetween(range.from, range.to) > 120 ? "month" : "day";
}

export function sameTime(a: TimeChoice, b: TimeChoice): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sameFilters(a: WorkbenchFilters, b: WorkbenchFilters): boolean {
  return sameTime(a.time, b.time) && a.currency === b.currency && a.combined === b.combined;
}

/**
 * 生效条件被外部改变（返回、刷新、卡片上的「改用原币查看」）时，草稿怎么办：
 * **没改动过的草稿跟着新条件走；改动过的草稿原样保留**（收起面板不丢草稿，见交互补充 §3）。
 */
export function followDraft(draft: WorkbenchFilters, previousEffective: WorkbenchFilters, nextEffective: WorkbenchFilters): WorkbenchFilters {
  return sameFilters(draft, previousEffective) ? nextEffective : draft;
}

/** 本月的前一个月（「上月」快捷项）。 */
export function previousMonth(today: string): string {
  return startOfMonth(addDays(startOfMonth(today), -1)).slice(0, 7);
}
