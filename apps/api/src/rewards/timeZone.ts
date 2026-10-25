/**
 * **账户时区与纪念日日期换算（S16 头像奖励系统）。**
 *
 * 这里的函数全部是纯函数：不读数据库、不读系统时间、不读环境变量。
 * 调用方传入 `now` 与 IANA 时区名，因此测试可以固定任意时刻/时区，
 * 不需要真的等到某个星期四。
 *
 * ⚠️ **服务器时间是唯一可信的“现在”。** 客户端只提供“我在哪个时区”，
 * 不提供“现在几点”；把客户端时钟当成判定依据会让改手机时间就能提前领奖。
 *
 * ⚠️ **判定必须用账户时区里的“当地日期”。** 世界哲学日（11 月第三个星期四）
 * 在东八区已经入夜时，UTC 可能还停在星期三；按 UTC 发奖会让一部分人早一天
 * 看到。反过来，在 UTC-8 也是如此。所以“今天是不是纪念日”永远问
 * `Intl.DateTimeFormat`，而不是 `Date#getUTCDay()`。
 */

/** 账户没有时区数据时的回退值。明确写出来，而不是隐式使用服务器本地时区。 */
export const FALLBACK_TIME_ZONE = "UTC";

const MAX_TIME_ZONE_LENGTH = 64;

/**
 * 校验并规范化一个 IANA 时区名。
 *
 * 返回 `null` 表示“这不是一个可用的时区”；调用方应回退到已保存的时区或
 * `FALLBACK_TIME_ZONE`，**不要抛错**——客户端发来的时区头坏了，不应该让
 * 整个登录/刷新请求失败。
 */
export function normalizeTimeZone(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TIME_ZONE_LENGTH) return null;
  try {
    // 构造成功即说明运行环境（Node 22 自带 ICU）认得这个时区。
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return null;
  }
}

export interface LocalDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  /** ISO 星期：1=周一 … 7=周日。 */
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
}

const WEEKDAY_BY_NAME: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 把“现在”换算成某个时区里的当地日期时间。 */
export function localDateTime(now: Date, timeZone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = formatter.formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? "";
  const weekdayName = read("weekday");
  const weekday = WEEKDAY_BY_NAME[weekdayName];
  if (weekday === undefined) throw new Error(`无法解析星期：${weekdayName}`);
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    weekday,
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

/** 某个时区里的当地日期，格式 `YYYY-MM-DD`；用于与规则日期做字符串比较。 */
export function localDateString(now: Date, timeZone: string): string {
  return localDate(now, timeZone);
}

export function localDate(now: Date, timeZone: string): string {
  const parts = localDateTime(now, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** 把时间点换算成某个时区里的当地日期字符串。 */
export function instantToLocalDate(instant: Date, timeZone: string): string {
  return localDate(instant, timeZone);
}

/**
 * 某年某月的“第 N 个星期 X”是哪一天（`YYYY-MM-DD`）。
 *
 * `weekday`：ISO 星期，1=周一 … 7=周日。纯日历计算，与时区无关——
 * 时区只决定“今天在当地是哪一天”。
 */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): string {
  if (!Number.isInteger(year) || month < 1 || month > 12 || weekday < 1 || weekday > 7 || nth < 1 || nth > 5) {
    throw new Error(`无效的日期规则：${year}-${month} 第 ${nth} 个星期 ${weekday}`);
  }
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const firstIso = firstOfMonth.getUTCDay() === 0 ? 7 : firstOfMonth.getUTCDay();
  const offset = (weekday - firstIso + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) throw new Error(`日期规则超出月份天数：${year}-${month}`);
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

export type YearlyNthWeekdayRule = {
  readonly kind: "yearly_nth_weekday";
  readonly month: number;
  readonly weekday: number;
  readonly nth: number;
};

/** “此刻”在当地是否正好落在该年度规则日上。 */
export function isYearlyRuleDate(now: Date, timeZone: string, rule: YearlyNthWeekdayRule): boolean {
  const parts = localDateTime(now, timeZone);
  return nthWeekdayOfMonth(parts.year, rule.month, rule.weekday, rule.nth) === localDate(now, timeZone);
}

/**
 * 该年度规则最近一次“已经过去”的日期。
 *
 * 用于补领：只在账户存在之后发生过的那一次才算数（`notBefore` 之后）。
 * 返回 `null` 表示没有可补领的历史日期。
 */
export function latestPastYearlyRuleDate(
  now: Date,
  timeZone: string,
  rule: YearlyNthWeekdayRule,
  notBefore?: string | null,
): string | null {
  const parts = localDateTime(now, timeZone);
  const today = localDate(now, timeZone);
  // 20 年足够覆盖任何账户的历史；限制循环次数也让函数保持可预测。
  for (let year = parts.year; year >= parts.year - 20; year -= 1) {
    const date = nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.nth);
    if (date >= today) continue;
    // ⚠️ 严格用“建号日之后”：账户建立当天还不算“经历过那个纪念日”，
    // 否则 11-19 注册的新账号当天就能用补领领到 11-19 的奖励。
    if (notBefore !== undefined && notBefore !== null && date <= notBefore) return null;
    return date;
  }
  return null;
}
