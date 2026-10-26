import {
  assertCalendarDate,
  classifyBucket,
  daySpan,
  isSpanValid,
  isoDayOfWeek,
  parseTimeSpan,
  type TimeSpan,
} from "./timeCalendar.js";

import { addDays } from "./stats.js";

/**
 * **星期分布（B-2）**——I13 背后的算术。
 *
 * 这一层同时给出两种口径，绝不把它们混成一个数字：
 *
 *  * **总金额** `WeekdayTotal(k)`：真实支出分布。
 *  * **平均** `WeekdayAverage(k) = WeekdayTotal(k) / ObservedCountOfWeekday(k)`：
 *    观察“星期习惯”时才该用它。
 *
 * 为什么不能只给总金额：一个 31 天的月份里，星期一可能出现 5 次、星期二只有
 * 4 次；只比总金额的话，出现次数多的星期天生多一次“花钱机会”。
 *
 * 平均以精确分数保存（`numeratorMinor / denominatorDays`），显示用的
 * 两位小数只是格式化结果，不参与任何后续计算。
 */

export const WEEKDAY_PATTERN_VERSION = "s17-b-weekday-pattern-v1" as const;

/** 样本不足提示的阈值：至少 4 个整周的观察日。仅用于提示，不改变计算。 */
export const WEEKDAY_MIN_SAMPLE_DAYS = 28;

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WeekdayPatternOptions {
  readonly kind: "expense" | "income";
  /** 半开区间 `[start, end)`，业务日历日。 */
  readonly span: TimeSpan;
  readonly today: string;
  readonly coverageEnd: string | null;
}

/** 平均每个星期几的支出：精确分数 + 仅供显示的两位小数字符串。 */
export interface WeekdayAverage {
  readonly numeratorMinor: string;
  readonly denominatorDays: number;
  /** 显示用（截断到两位小数），不参与计算。 */
  readonly text: string;
}

export interface WeekdayPoint {
  readonly weekday: Weekday;
  /** 该星期几的金额合计（分）；分析区间未被完整观察时为 `null`。 */
  readonly totalMinor: string | null;
  /** 数据覆盖内、非未来的该星期日期数（平均值的分母）。 */
  readonly observedDays: number;
  readonly average: WeekdayAverage | null;
}

export interface WeekdayPatternResult {
  readonly version: typeof WEEKDAY_PATTERN_VERSION;
  readonly kind: "expense" | "income";
  readonly span: TimeSpan;
  /** 固定星期一 → 星期日（ISO 1..7）的七个桶，不按语言重排。 */
  readonly weekdays: readonly WeekdayPoint[];
  readonly observedDayCount: number;
  readonly unknownDayCount: number;
  readonly futureDayCount: number;
  /** 至少 `WEEKDAY_MIN_SAMPLE_DAYS` 个观察日；不足时 UI 应显示样本提示。 */
  readonly sufficientSample: boolean;
  readonly complete: boolean;
}

function toMinor(value: bigint | number): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isInteger(value)) {
    throw new RangeError("金额必须是整数（以分为单位）");
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("金额超出可安全表示的整数范围");
  }

  return BigInt(value);
}

/**
 * 精确分数 → 两位小数文本（截断）。
 *
 * 只用于显示。平均值本身不允许用浮点保存：除以天数往往不是有限小数，
 * 累加或比较时应该回到 `numeratorMinor / denominatorDays`。
 */
function averageText(numeratorMinor: bigint, denominatorDays: number): string {
  if (denominatorDays <= 0) return "—";
  const scaled = (numeratorMinor * 100n) / BigInt(denominatorDays);
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;

  return `${negative ? "-" : ""}${(absolute / 100n).toString()}.${(absolute % 100n)
    .toString()
    .padStart(2, "0")}`;
}

/**
 * 按星期一至星期日聚合支出/收入（I13）。
 *
 * 观察日 = 区间内、不晚于 `today`、且被数据覆盖（`coverageEnd`）的日期。
 * 未来日期不计入观察；覆盖不到的日子计入 `unknownDayCount` 而不是当成零。
 */
export function computeWeekdayPattern(
  entries: readonly { readonly occurredLocalDate: string; readonly kind: "expense" | "income"; readonly amountMinor: bigint | number }[],
  options: WeekdayPatternOptions,
): WeekdayPatternResult {
  const span = parseTimeSpan(options.span);
  const today = assertCalendarDate(options.today);
  const coverageEnd = options.coverageEnd === null ? null : assertCalendarDate(options.coverageEnd);

  const totals: bigint[] = [0n, 0n, 0n, 0n, 0n, 0n, 0n];
  const observedDays: number[] = [0, 0, 0, 0, 0, 0, 0];
  let unknownDayCount = 0;
  let futureDayCount = 0;

  let cursor = span.start;
  while (cursor < span.end) {
    const date = cursor;
    // 单日是它自己的桶：覆盖判定必须对着“这一天”，不能对着整个区间。
    const day = daySpan(date);
    const state = classifyBucket({ naturalSpan: day, span: day }, { today, coverageEnd });
    const weekday = isoDayOfWeek(date) as Weekday;

    if (state === "future") {
      futureDayCount += 1;
    } else if (state === "unknown" || state === "unavailable") {
      unknownDayCount += 1;
    } else {
      observedDays[weekday - 1] = (observedDays[weekday - 1] ?? 0) + 1;
    }

    cursor = addDays(cursor, 1);
  }

  for (const entry of entries) {
    if (entry.kind !== options.kind) continue;
    const date = assertCalendarDate(entry.occurredLocalDate);
    if (date < span.start || date >= span.end) continue;
    const weekday = isoDayOfWeek(date) as Weekday;
    totals[weekday - 1] = (totals[weekday - 1] ?? 0n) + toMinor(entry.amountMinor);
  }

  const observedDayCount = observedDays.reduce((sum, count) => sum + count, 0);
  const computable = unknownDayCount === 0 && futureDayCount === 0;

  const weekdays: WeekdayPoint[] = [1, 2, 3, 4, 5, 6, 7].map((weekdayValue) => {
    const index = weekdayValue - 1;
    const days = observedDays[index] ?? 0;
    const total = totals[index] ?? 0n;
    const average: WeekdayAverage | null =
      computable && days > 0
        ? {
            numeratorMinor: total.toString(),
            denominatorDays: days,
            text: averageText(total, days),
          }
        : null;

    return {
      weekday: weekdayValue as Weekday,
      totalMinor: computable ? total.toString() : null,
      observedDays: days,
      average,
    };
  });

  return {
    version: WEEKDAY_PATTERN_VERSION,
    kind: options.kind,
    span,
    weekdays,
    observedDayCount,
    unknownDayCount,
    futureDayCount,
    sufficientSample: observedDayCount >= WEEKDAY_MIN_SAMPLE_DAYS,
    complete: computable,
  };
}

/** 校验一组选项是否合法（给上层入口检查用）。 */
export function isWeekdayPatternOptionsValid(options: WeekdayPatternOptions): boolean {
  return isSpanValid(options.span);
}
