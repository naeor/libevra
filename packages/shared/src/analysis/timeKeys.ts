/**
 * S17 Agent A · A-4 前置 scaffolding：分析区间键适配（纯函数，draft，未冻结）。
 *
 * 背景：S-01 v2 冻结前，A-4 需要「日期 / ISO 周 / 月」三种区间键的统一输入适配：
 * - 对外语义（`ResolvedPeriod`）是包含两端的闭区间 `[from, to]`；
 * - 时间桶内部语义是半开区间 `[start, end)`；
 * - 唯一换算函数 `bucketToInclusive` / `inclusiveSpan`；
 * - 周键为 ISO `YYYY-Www`（周一起始）；月键为 `YYYY-MM`；
 * - 分析区间上限 `MAX_ANALYSIS_DAYS = 400`（与 `MAX_STATS_DAYS` 对齐，超限拒绝不截断）。
 *
 * 约束：本文件仅新增纯函数与类型，不改既有契约/既有导出；不接页面、不查询数据、
 * 不做财务计算。S-01 v2 冻结后若键语义变化，以冻结稿为准（本文件标 draft）。
 *
 * 来源：Lead m03046 批准的最小 scaffold 范围；`S17-Agent-A-A4准备报告.md` §2/§5。
 */

import { MAX_STATS_DAYS } from "../stats.js";
import { addDays, daysBetween } from "../stats.js";

/** 分析区间日窗口上限（与 `/stats` 的 `MAX_STATS_DAYS` 对齐，超限拒绝不截断）。 */
export const MAX_ANALYSIS_DAYS: number = MAX_STATS_DAYS;

/** 桶粒度：日 / ISO 周 / 月。 */
export type TimeKeyGranularity = "day" | "week" | "month";

/** 业务日期 `YYYY-MM-DD`（闭区间端点）。 */
export type CalendarDate = string;

/** 日期日历键。 */
export interface CalendarDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** 半开区间 `[start, end)`。 */
export interface HalfOpenSpan {
  readonly start: CalendarDate;
  readonly end: CalendarDate;
}

/** 闭区间 `[from, to]`。 */
export interface InclusiveRange {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

/** 一个区间键桶（自然桶 + 裁剪到分析区间后的 span + 闭区间端点）。 */
export interface AdaptedBucket {
  /** 桶键：日=`YYYY-MM-DD`；周=`YYYY-Www`；月=`YYYY-MM`。 */
  readonly key: string;
  readonly granularity: TimeKeyGranularity;
  /** 自然桶边界（不受分析区间影响），半开。 */
  readonly naturalSpan: HalfOpenSpan;
  /** 裁剪到分析区间后的半开 span。 */
  readonly span: HalfOpenSpan;
  /** 闭区间端点（来源筛选/下钻用）。 */
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  /** 是否被分析区间起点裁剪。 */
  readonly clippedStart: boolean;
  /** 是否被分析区间终点裁剪。 */
  readonly clippedEnd: boolean;
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
const WEEK_KEY_PATTERN = /^(\d{4})-W(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function invalid(message: string): never {
  throw new RangeError(`time_keys_invalid:${message}`);
}

function daysInMonthOf(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 是否闰年（整年：4 年一闰、百年不闰、400 年再闰）。 */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** 某年某月的天数（month 为 1–12）。 */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    invalid(`month:${year}-${month}`);
  }
  return daysInMonthOf(year, month);
}

/** 某年某月最后一天（`YYYY-MM-DD`）。 */
export function lastDayOfMonth(year: number, month: number): CalendarDate {
  const day = daysInMonth(year, month);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 解析 `YYYY-MM-DD`；非法日期（含 2026-02-30）返回 null。 */
export function parseCalendarDate(value: string): CalendarDateParts | null {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonthOf(year, month)) {
    return null;
  }
  return { year, month, day };
}

/** 是否为合法业务日期。 */
export function isCalendarDate(value: string): boolean {
  return parseCalendarDate(value) !== null;
}

/** 解析并校验 `YYYY-MM-DD`，非法则抛 RangeError。 */
export function requireCalendarDate(value: string): CalendarDateParts {
  const parts = parseCalendarDate(value);
  if (parts === null) {
    invalid(`calendar_date:${value}`);
  }
  return parts;
}

/** 校验闭区间 `[from, to]` 并返回规范化端点（from <= to）。 */
export function requireInclusiveRange(range: InclusiveRange): InclusiveRange {
  const from = requireCalendarDate(range.from);
  const to = requireCalendarDate(range.to);
  if (compareDate(range.from, range.to) > 0) {
    invalid(`range_reversed:${range.from}..${range.to}`);
  }
  void from;
  void to;
  return { from: range.from, to: range.to };
}

/** 校验半开区间 `[start, end)`（start < end）。 */
export function requireHalfOpenSpan(span: HalfOpenSpan): HalfOpenSpan {
  requireCalendarDate(span.start);
  requireCalendarDate(span.end);
  if (compareDate(span.start, span.end) >= 0) {
    invalid(`span_not_ascending:${span.start}..${span.end}`);
  }
  return { start: span.start, end: span.end };
}

/** 日期比较（升序 = 负数）。 */
export function compareDate(left: CalendarDate, right: CalendarDate): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 闭区间 → 半开区间：`[from, to] → [from, to+1)`。 */
export function inclusiveSpan(range: InclusiveRange): HalfOpenSpan {
  const checked = requireInclusiveRange(range);
  return { start: checked.from, end: addDays(checked.to, 1) };
}

/** 半开区间 → 闭区间：`[start, end) → [start, end-1]`。 */
export function bucketToInclusive(span: HalfOpenSpan): InclusiveRange {
  const checked = requireHalfOpenSpan(span);
  return { from: checked.start, to: addDays(checked.end, -1) };
}

/** 区间是否落在 `MAX_ANALYSIS_DAYS` 内；越界抛 RangeError（不截断）。 */
export function assertWithinAnalysisLimit(range: InclusiveRange): number {
  const checked = requireInclusiveRange(range);
  const days = daysBetween(checked.from, checked.to);
  if (days > MAX_ANALYSIS_DAYS) {
    invalid(`analysis_days_limit:${days}>${MAX_ANALYSIS_DAYS}`);
  }
  return days;
}

function toUtcMidnight(parts: CalendarDateParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function fromUtcMidnight(ms: number): CalendarDate {
  const date = new Date(ms);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 周日=0…周六=6 → 周一=0…周日=6。 */
function mondayIndex(parts: CalendarDateParts): number {
  return (new Date(toUtcMidnight(parts)).getUTCDay() + 6) % 7;
}

/** 该日期所在 ISO 周的周一。 */
export function mondayOf(date: CalendarDate): CalendarDate {
  const parts = requireCalendarDate(date);
  return fromUtcMidnight(toUtcMidnight(parts) - mondayIndex(parts) * MS_PER_DAY);
}

/** ISO 周 `YYYY-Www`（周一起始；跨年周按 ISO 周所属年）。 */
export function isoWeekKey(date: CalendarDate): string {
  const parts = requireCalendarDate(date);
  const monday = mondayOf(date);
  const mondayParts = requireCalendarDate(monday);
  const thursday = addDays(monday, 3);
  const isoYear = requireCalendarDate(thursday).year;
  const jan4 = `${String(isoYear).padStart(4, "0")}-01-04`;
  const week1Monday = mondayOf(jan4);
  const week = Math.round((toUtcMidnight(mondayParts) - toUtcMidnight(requireCalendarDate(week1Monday))) / (7 * MS_PER_DAY)) + 1;
  return `${String(isoYear).padStart(4, "0")}-W${String(week).padStart(2, "0")}`;
}

/** 解析 ISO 周键并返回该周周一；非法返回 null。 */
export function isoWeekStart(key: string): CalendarDate | null {
  const match = WEEK_KEY_PATTERN.exec(key);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) {
    return null;
  }
  const jan4 = `${String(year).padStart(4, "0")}-01-04`;
  const week1Monday = mondayOf(jan4);
  const start = addDays(week1Monday, (week - 1) * 7);
  const startParts = requireCalendarDate(start);
  if (isoWeekKey(start) !== key) {
    // 该年没有第 53 周（例如 2025-W53 实际属于 2026-W01）
    return null;
  }
  void startParts;
  return start;
}

/** 该日期所在 ISO 周的自然半开 span。 */
export function isoWeekSpan(date: CalendarDate): HalfOpenSpan {
  const monday = mondayOf(date);
  return { start: monday, end: addDays(monday, 7) };
}

/** 月键 `YYYY-MM`。 */
export function monthKey(date: CalendarDate): string {
  const parts = requireCalendarDate(date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}`;
}

/** 该日期所在月的自然半开 span。 */
export function monthSpan(date: CalendarDate): HalfOpenSpan {
  const parts = requireCalendarDate(date);
  const start = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-01`;
  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
  const end = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, end };
}

/** 该日期所在「日」的自然半开 span。 */
export function daySpan(date: CalendarDate): HalfOpenSpan {
  requireCalendarDate(date);
  return { start: date, end: addDays(date, 1) };
}

/** 该日期在其粒度下的自然 span 与键。 */
export function bucketOf(
  date: CalendarDate,
  granularity: TimeKeyGranularity,
): { readonly key: string; readonly naturalSpan: HalfOpenSpan } {
  switch (granularity) {
    case "day":
      return { key: date, naturalSpan: daySpan(date) };
    case "week":
      return { key: isoWeekKey(date), naturalSpan: isoWeekSpan(date) };
    case "month":
      return { key: monthKey(date), naturalSpan: monthSpan(date) };
    default:
      return invalid(`granularity:${String(granularity)}`);
  }
}

/**
 * 枚举覆盖分析区间 `[from, to]` 的全部桶（裁剪到区间）。
 * 顺序按桶自然起点升序；每个桶给出自然 span、裁剪 span、闭区间端点与裁剪标记。
 */
export function enumerateBuckets(range: InclusiveRange, granularity: TimeKeyGranularity): AdaptedBucket[] {
  const checked = requireInclusiveRange(range);
  assertWithinAnalysisLimit(checked);
  const buckets: AdaptedBucket[] = [];
  let cursor = checked.from;
  while (compareDate(cursor, checked.to) <= 0) {
    const bucket = bucketOf(cursor, granularity);
    const spanStart = compareDate(bucket.naturalSpan.start, checked.from) < 0 ? checked.from : bucket.naturalSpan.start;
    const rangeEnd = addDays(checked.to, 1);
    const spanEnd = compareDate(bucket.naturalSpan.end, rangeEnd) > 0 ? rangeEnd : bucket.naturalSpan.end;
    const clippedStart = compareDate(spanStart, bucket.naturalSpan.start) > 0;
    const clippedEnd = compareDate(spanEnd, bucket.naturalSpan.end) < 0;
    buckets.push({
      key: bucket.key,
      granularity,
      naturalSpan: bucket.naturalSpan,
      span: { start: spanStart, end: spanEnd },
      from: spanStart,
      to: addDays(spanEnd, -1),
      clippedStart,
      clippedEnd,
    });
    cursor = bucket.naturalSpan.end;
  }
  return buckets;
}

/**
 * 把日期对齐到目标年的同月同日；目标年没有该日时裁剪到该月最后一天。
 * 例：2028-02-29 → 2027-02-28（clamped）；2026-01-31 → 2027-01-31（不裁剪）。
 */
export function alignDateToYear(date: CalendarDate, targetYear: number): {
  readonly date: CalendarDate;
  readonly clamped: boolean;
} {
  const parts = requireCalendarDate(date);
  if (!Number.isInteger(targetYear) || targetYear < 1) {
    invalid(`target_year:${targetYear}`);
  }
  const day = Math.min(parts.day, daysInMonthOf(targetYear, parts.month));
  const clamped = day !== parts.day;
  const year = String(targetYear).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  return {
    date: `${year}-${month}-${String(day).padStart(2, "0")}`,
    clamped,
  };
}

/** 闰日对齐：2/29 在目标年不存在时取该年 2 月末（由 `alignDateToYear` 实现）。 */
export function alignLeapDay(date: CalendarDate, targetYear: number): {
  readonly date: CalendarDate;
  readonly clamped: boolean;
} {
  const parts = requireCalendarDate(date);
  if (parts.month !== 2 || parts.day !== 29) {
    invalid(`not_leap_day:${date}`);
  }
  return alignDateToYear(date, targetYear);
}

/** 校验月键 `YYYY-MM`（月份 01–12）。 */
export function isMonthKey(value: string): boolean {
  const match = MONTH_KEY_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** 校验 ISO 周键 `YYYY-Www`（周 01–53，且该年真实存在该周）。 */
export function isValidIsoWeekKey(value: string): boolean {
  return isoWeekStart(value) !== null;
}
