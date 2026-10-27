/**
 * P15 · 全年日历分析（DRAFT，未冻结）。
 *
 * 输出一整年的逐日值（支出金额 / 收入金额 / 交易笔数），供年度热力日历与
 * 12 个月日历矩阵使用。
 *
 * 核心要求（owner 规格 §31）：日期完整（365/366 天全部返回）、星期正确（周一起始）、
 * 闰年支持 366 天、**无数据与未知区分**、未来日期区别处理、与 Agent B 的 I12
 * 使用相同日期与金额结果（C 分支没有 B 的 timeCalendar，本地实现登记 QC-26）。
 *
 * 状态语义：
 * - `future`     今天之后的日期（不得画成 0，也不得参与强度）
 * - `in-progress` 今天（当天可能还有交易，展示层应标注「进行中」）
 * - `complete`   过去日期且有交易
 * - `no-data`    过去日期且无交易（真实的 0，不是未知）
 * - `unknown`    覆盖范围未知时的过去日期（只有在 coverageKnown=false 时出现）
 */

import type { DraftCalendarDay, DraftCalendarMetric, DraftCalendarResult } from "./draftTypes.js";
import { parseCalendarDate, utcDateOf, type AdvancedRecord } from "./dimensions.js";

const MILLISECONDS_PER_DAY = 86_400_000;
const MIN_YEAR = 1970;
const MAX_YEAR = 9999;

export interface AnnualCalendarOptions {
  readonly year: number;
  /** 默认支出金额。 */
  readonly metric?: DraftCalendarMetric;
  /** 判定「进行中 / 未来」的基准日（`YYYY-MM-DD`，业务日期口径）。 */
  readonly today: string;
  /** 覆盖范围是否已确认；false 时过去日期标为 `unknown`（缺失 ≠ 零）。默认 true。 */
  readonly coverageKnown?: boolean;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 周一起始的年内周列号（0 基；1 月 1 日所在周为第 0 列）。 */
export function weekIndexOf(date: string): number {
  const { year } = parseCalendarDate(date);
  const probe = utcDateOf(date);
  const januaryFirst = Date.UTC(year, 0, 1);
  const januaryWeekday = new Date(januaryFirst).getUTCDay() === 0
    ? 7
    : (new Date(januaryFirst).getUTCDay() as number);
  const baseMonday = januaryFirst - (januaryWeekday - 1) * MILLISECONDS_PER_DAY;
  return Math.floor((probe.getTime() - baseMonday) / (7 * MILLISECONDS_PER_DAY));
}

interface DayAccumulator {
  amountMinor: bigint;
  count: number;
}

/**
 * 全年日历。
 *
 * @throws {RangeError} 年份/日期/指标非法、记录非法。
 */
export function annualCalendarOf(
  records: readonly AdvancedRecord[],
  options: AnnualCalendarOptions,
): DraftCalendarResult {
  const { year, metric = "expense" } = options;
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(`year must be an integer in [${String(MIN_YEAR)}, ${String(MAX_YEAR)}], received: ${String(year)}`);
  }
  if (metric !== "expense" && metric !== "income" && metric !== "count") {
    throw new RangeError(`unsupported calendar metric: ${String(metric)}`);
  }
  parseCalendarDate(options.today);

  const coverageKnown = options.coverageKnown ?? true;
  const yearText = String(year);
  const dayCount = isLeapYear(year) ? 366 : 365;

  const totals = new Map<string, DayAccumulator>();
  let recordCount = 0;

  for (const record of records) {
    if (record.occurredLocalDate.slice(0, 4) !== yearText) continue;
    parseCalendarDate(record.occurredLocalDate);
    if (record.amountMinor < 0n) {
      throw new RangeError(`amountMinor must be non-negative (use kind to express direction): ${record.id}`);
    }
    if (metric === "expense" && record.kind !== "expense") continue;
    if (metric === "income" && record.kind !== "income") continue;
    if (metric === "count" && record.kind !== "expense" && record.kind !== "income") continue;

    recordCount += 1;
    const existing = totals.get(record.occurredLocalDate);
    if (existing === undefined) {
      totals.set(record.occurredLocalDate, { amountMinor: record.amountMinor, count: 1 });
    } else {
      existing.amountMinor += record.amountMinor;
      existing.count += 1;
    }
  }

  const days: DraftCalendarDay[] = [];
  let totalMinor = 0n;
  let totalCount = 0;
  let noDataDayCount = 0;
  let unknownDayCount = 0;
  let futureDayCount = 0;
  let inProgressDayCount = 0;
  let intensityMinMinor: bigint | null = null;
  let intensityMaxMinor: bigint | null = null;

  const januaryFirst = Date.UTC(year, 0, 1);

  for (let offset = 0; offset < dayCount; offset += 1) {
    const probe = new Date(januaryFirst + offset * MILLISECONDS_PER_DAY);
    const date = `${yearText}-${String(probe.getUTCMonth() + 1).padStart(2, "0")}-${String(probe.getUTCDate()).padStart(2, "0")}`;
    const weekday = probe.getUTCDay() === 0 ? 7 : probe.getUTCDay();

    const accumulator = totals.get(date);
    const amountMinor = accumulator?.amountMinor ?? 0n;
    const count = accumulator?.count ?? 0;
    const valueMinor = metric === "count" ? BigInt(count) : amountMinor;

    let state: DraftCalendarDay["state"];
    if (date > options.today) {
      state = "future";
      futureDayCount += 1;
    } else if (date === options.today) {
      state = "in-progress";
      inProgressDayCount += 1;
    } else if (!coverageKnown) {
      state = "unknown";
      unknownDayCount += 1;
    } else if (count > 0) {
      state = "complete";
    } else {
      state = "no-data";
      noDataDayCount += 1;
    }

    if (state === "complete" || state === "in-progress") {
      totalMinor += valueMinor;
      totalCount += count;
      if (intensityMinMinor === null || valueMinor < intensityMinMinor) intensityMinMinor = valueMinor;
      if (intensityMaxMinor === null || valueMinor > intensityMaxMinor) intensityMaxMinor = valueMinor;
    }

    days.push({
      date,
      weekday,
      month: probe.getUTCMonth() + 1,
      weekIndex: weekIndexOf(date),
      valueMinor,
      count,
      state,
    });
  }

  const monthStartWeekIndex: number[] = [];
  for (let month = 1; month <= 12; month += 1) {
    monthStartWeekIndex.push(weekIndexOf(`${yearText}-${String(month).padStart(2, "0")}-01`));
  }

  const weekCount = (days[days.length - 1]?.weekIndex ?? 0) + 1;

  return {
    year,
    metric,
    leapYear: isLeapYear(year),
    dayCount,
    weekCount,
    days,
    monthStartWeekIndex,
    totalMinor,
    totalCount,
    recordCount,
    noDataDayCount,
    unknownDayCount,
    futureDayCount,
    inProgressDayCount,
    intensityMinMinor,
    intensityMaxMinor,
    completeness: recordCount === 0 ? "no-transactions" : "complete",
  };
}
