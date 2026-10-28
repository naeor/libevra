/**
 * Agent C · A15 连续无支出记录天数（1.17.10 接入工作台）。
 *
 * 口径（owner 规格 §14）：
 * - 只有「**确认**无支出记录」的日期参与连续段；有支出、数据未知、未来的日期都会中断连续段；
 * - 未知不是零：本机覆盖不完整、或综合折算下这一天缺汇率而无法确认时，这一天是 `unknown`；
 * - 命名是「无支出**记录**」，不代表现实中没有消费（展示层负责措辞）。
 *
 * 纯函数、只做日期计数，不涉及金额。
 */

export type NoExpenseDayState = "spent" | "none" | "unknown" | "future";

export interface NoExpenseDay {
  readonly date: string;
  readonly state: NoExpenseDayState;
}

export interface NoExpenseStreak {
  readonly from: string;
  readonly to: string;
  readonly days: number;
}

export interface NoExpenseStreakResult {
  /** 最长的确认无支出记录连续段；没有任何确认的无支出日时为 null。 */
  readonly longest: NoExpenseStreak | null;
  /** 截至最后一个已发生日期仍在持续的连续段（最后一天确认无支出时）；否则 null。 */
  readonly current: NoExpenseStreak | null;
  /** 按天数降序的连续段（同天数按开始日期升序），最多 `limit` 段。 */
  readonly streaks: readonly NoExpenseStreak[];
  readonly confirmedNoneDays: number;
  readonly spentDays: number;
  readonly unknownDays: number;
  readonly futureDays: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param days 按日期**升序**、无重复的日期状态（通常是分析区间内的每一天）。
 * @param limit 返回的连续段条数上限（默认 5）。
 * @throws {RangeError} 日期格式非法、未排序或重复。
 */
export function noExpenseStreaksOf(days: readonly NoExpenseDay[], limit = 5): NoExpenseStreakResult {
  let previous = "";
  for (const day of days) {
    if (!DATE.test(day.date)) throw new RangeError(`invalid date: ${day.date}`);
    if (day.date <= previous) throw new RangeError(`days must be strictly ascending: ${day.date}`);
    previous = day.date;
  }
  const streaks: NoExpenseStreak[] = [];
  let open: { from: string; to: string; days: number } | null = null;
  let confirmedNoneDays = 0;
  let spentDays = 0;
  let unknownDays = 0;
  let futureDays = 0;
  for (const day of days) {
    if (day.state === "none") {
      confirmedNoneDays += 1;
      open = open === null ? { from: day.date, to: day.date, days: 1 } : { from: open.from, to: day.date, days: open.days + 1 };
      continue;
    }
    if (day.state === "spent") spentDays += 1;
    else if (day.state === "unknown") unknownDays += 1;
    else futureDays += 1;
    if (open !== null) streaks.push(open);
    open = null;
  }
  if (open !== null) streaks.push(open);
  // 最后一个已发生的日期仍在连续段里，才算「当前」连续段（未来日期不延长它）。
  const lastOccurred = [...days].reverse().find((day) => day.state !== "future");
  const current = lastOccurred?.state === "none" ? (streaks.find((streak) => streak.to === lastOccurred.date) ?? null) : null;
  const ranked = [...streaks].sort((a, b) => b.days - a.days || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return {
    longest: ranked[0] ?? null,
    current,
    streaks: ranked.slice(0, Math.max(0, limit)),
    confirmedNoneDays,
    spentDays,
    unknownDays,
    futureDays,
  };
}
