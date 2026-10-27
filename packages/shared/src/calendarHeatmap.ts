import {
  assertCalendarDate,
  bucketKeyOf,
  classifyBucket,
  daySpan,
  isSpanValid,
  isoDayOfWeek,
  monthSpan,
  parseTimeSpan,
  spanContains,
  type BucketState,
  type TimeSpan,
} from "./timeCalendar.js";

import { addDays } from "./stats.js";

/**
 * **日历热力图数据（B-2）**——I12 背后的算术与格子排布。
 *
 * 这一层只输出“每天多少钱 / 多少笔、状态如何、格子摆在哪、颜色等级是多少”，
 * 不输出颜色值，也不输出 DOM。三条不可协商的规则：
 *
 *  1. **星期一第一列**：`weeks[].days` 固定 7 格，索引 0 = 星期一。
 *  2. **零与未知不同**：确认没有花销的日期是已知的 0（`level = 0`）；
 *     覆盖不到的日期 `level = null`、金额 `null`；未来日期也是 `null`，
 *     不能看起来像“已经发生”。
 *  3. **同一比较范围同一刻度**：颜色阈值在整个结果区间上算一次分位数，
 *     不按月各自缩放（否则不同月份的颜色会被误读成可直接比较）。
 *
 * 颜色等级是“相对本区间的轻重”，不是固定金额；图例必须说明这一点。
 */

export const CALENDAR_HEATMAP_VERSION = "s17-b-calendar-heatmap-v1" as const;

/** I12 至少支持三种指标；后两者作为参数变体，不新增分析 ID。 */
export type CalendarMetric = "expense" | "income" | "count";

export const CALENDAR_HEAT_LEVELS = 4 as const;

export interface CalendarHeatmapOptions {
  readonly metric: CalendarMetric;
  /** 半开区间 `[start, end)`，业务日历日。 */
  readonly span: TimeSpan;
  readonly today: string;
  readonly coverageEnd: string | null;
}

export interface CalendarDayCell {
  readonly date: string;
  /** 精确金额（分）或交易笔数；`null` = 未知/未来，不是 0。 */
  readonly valueMinor: string | null;
  readonly transactionCount: number | null;
  readonly state: BucketState;
  /** 0–4；`null` = 不可着色（未知/未来）。 */
  readonly level: number | null;
}

/** 一行 7 格，索引 0 = 星期一；月首/月末补 `null`。 */
export interface CalendarWeek {
  readonly days: readonly (CalendarDayCell | null)[];
}

export interface CalendarMonth {
  /** `YYYY-MM` */
  readonly monthKey: string;
  readonly weeks: readonly CalendarWeek[];
}

export interface CalendarHeatmapIntensity {
  readonly kind: "quantile";
  readonly levels: number;
  /** 分位阈值（分），长度 = levels − 1；同一结果区间共用。 */
  readonly thresholdsMinor: readonly string[];
  readonly minMinor: string | null;
  readonly maxMinor: string | null;
}

export interface CalendarHeatmapResult {
  readonly version: typeof CALENDAR_HEATMAP_VERSION;
  readonly metric: CalendarMetric;
  readonly span: TimeSpan;
  /** 区间内所有日格子（含未知/未来），按日期升序。 */
  readonly cells: readonly CalendarDayCell[];
  /** 按自然月分组、周一起始的日历格子；支持单月与多月连续布局。 */
  readonly months: readonly CalendarMonth[];
  readonly intensity: CalendarHeatmapIntensity;
  readonly complete: boolean;
  readonly unknownDayCount: number;
  readonly futureDayCount: number;
  /** 当前未结束的今天；它的金额只是截至此刻，不能被当成完整一天。 */
  readonly inProgressDayCount: number;
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

/** 显示用分位数：阈值只影响颜色等级，不影响任何权威金额。 */
function quantileThresholds(values: readonly bigint[], levels: number): bigint[] {
  if (values.length === 0 || levels < 2) return [];
  const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const thresholds: bigint[] = [];
  for (let index = 1; index < levels; index += 1) {
    const position = Math.round(((sorted.length - 1) * index) / levels);
    thresholds.push(sorted[Math.min(sorted.length - 1, Math.max(0, position))] ?? 0n);
  }

  return thresholds;
}

function levelOf(value: bigint, thresholds: readonly bigint[]): number {
  if (value <= 0n) return 0;
  let level = 1;
  for (const threshold of thresholds) {
    if (value > threshold) level += 1;
  }

  return Math.min(CALENDAR_HEAT_LEVELS, level);
}

/**
 * 按天聚合，生成 I12 的日历数据。
 *
 * 金额口径与 `timeSeries.ts` 完全一致：调用方负责币种（原币或已权威折算）。
 * `metric: "count"` 统计全部交易笔数（不区分收入/支出）。
 */
export function computeCalendarHeatmap(
  entries: readonly {
    readonly occurredLocalDate: string;
    readonly kind: "expense" | "income";
    readonly amountMinor: bigint | number;
  }[],
  options: CalendarHeatmapOptions,
): CalendarHeatmapResult {
  const span = parseTimeSpan(options.span);
  const today = assertCalendarDate(options.today);
  const coverageEnd = options.coverageEnd === null ? null : assertCalendarDate(options.coverageEnd);

  const amountByDate = new Map<string, bigint>();
  const countByDate = new Map<string, number>();

  for (const entry of entries) {
    const date = assertCalendarDate(entry.occurredLocalDate);
    if (!spanContains(span, date)) continue;
    if (options.metric === "expense" && entry.kind !== "expense") continue;
    if (options.metric === "income" && entry.kind !== "income") continue;

    countByDate.set(date, (countByDate.get(date) ?? 0) + 1);
    if (options.metric !== "count") {
      amountByDate.set(date, (amountByDate.get(date) ?? 0n) + toMinor(entry.amountMinor));
    }
  }

  const knownValues: bigint[] = [];
  const cells: CalendarDayCell[] = [];
  let cursor = span.start;
  while (cursor < span.end) {
    const date = cursor;
    // 单个日期就是它自己的桶：覆盖判定只关心这一天是否被数据覆盖。
    const day = daySpan(date);
    const state = classifyBucket({ naturalSpan: day, span: day }, { today, coverageEnd });
    const count = countByDate.get(date) ?? 0;
    const amount = amountByDate.get(date) ?? 0n;
    const known = state !== "unknown" && state !== "unavailable" && state !== "future";
    if (known && options.metric !== "count") knownValues.push(amount);

    cells.push({
      date,
      valueMinor: known ? (options.metric === "count" ? String(count) : amount.toString()) : null,
      transactionCount: known ? count : null,
      state,
      level: null, // 先占位，阈值算完后统一回填。
    });

    cursor = addDays(cursor, 1);
  }

  const thresholds = quantileThresholds(knownValues, CALENDAR_HEAT_LEVELS);
  let minMinor: bigint | null = null;
  let maxMinor: bigint | null = null;
  for (const value of knownValues) {
    if (minMinor === null || value < minMinor) minMinor = value;
    if (maxMinor === null || value > maxMinor) maxMinor = value;
  }

  const filled = cells.map((cell) => {
    if (cell.valueMinor === null) return cell;
    const numeric = BigInt(cell.valueMinor);
    return { ...cell, level: levelOf(numeric, thresholds) };
  });

  const monthKeys: string[] = [];
  let monthCursor = monthSpan(span.start).start;
  while (monthCursor < span.end) {
    const key = bucketKeyOf("month", monthCursor);
    if (!monthKeys.includes(key)) monthKeys.push(key);
    monthCursor = monthSpan(monthCursor).end;
  }

  const cellsByDate = new Map(filled.map((cell) => [cell.date, cell]));
  const months: CalendarMonth[] = monthKeys.map((monthKey) => {
    const firstDay = `${monthKey}-01`;
    const leading = isoDayOfWeek(firstDay) - 1;
    const month = monthSpan(firstDay);
    const slots: (CalendarDayCell | null)[] = [];
    for (let index = 0; index < leading; index += 1) slots.push(null);
    for (let date = month.start; date < month.end; date = addDays(date, 1)) {
      slots.push(cellsByDate.get(date) ?? null);
    }
    while (slots.length % 7 !== 0) slots.push(null);

    const weeks: CalendarWeek[] = [];
    for (let index = 0; index < slots.length; index += 7) {
      weeks.push({ days: slots.slice(index, index + 7) });
    }

    return { monthKey, weeks };
  });

  const unknownDayCount = filled.filter(
    (cell) => cell.state === "unknown" || cell.state === "unavailable",
  ).length;
  const futureDayCount = filled.filter((cell) => cell.state === "future").length;
  const inProgressDayCount = filled.filter((cell) => cell.state === "in-progress").length;

  return {
    version: CALENDAR_HEATMAP_VERSION,
    metric: options.metric,
    span,
    cells: filled,
    months,
    intensity: {
      kind: "quantile",
      levels: CALENDAR_HEAT_LEVELS,
      thresholdsMinor: thresholds.map((value) => value.toString()),
      minMinor: minMinor === null ? null : minMinor.toString(),
      maxMinor: maxMinor === null ? null : maxMinor.toString(),
    },
    complete: unknownDayCount === 0 && futureDayCount === 0 && inProgressDayCount === 0,
    unknownDayCount,
    futureDayCount,
    inProgressDayCount,
  };
}

/** 校验一组选项是否合法（给上层入口检查用）。 */
export function isCalendarHeatmapOptionsValid(options: CalendarHeatmapOptions): boolean {
  return isSpanValid(options.span);
}
