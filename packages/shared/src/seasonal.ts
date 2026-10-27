import { addDays } from "./stats.js";
import { parseTimeSpan, type TimeSpan } from "./timeCalendar.js";
import { computeTimeSeries, type TimeSeriesBucketPoint, type TimeSeriesEntry, type TimeSeriesMetric } from "./timeSeries.js";
import type { BucketState } from "./timeCalendar.js";

/**
 * **季节性消费比较（B-4，A18）**——把多个自然年的相同月份/季度并排比较。
 *
 * 规则（规格 §28）：
 *  * 只做**自然月**对齐：`YYYY-MM` 键，跨年保留年份；不允许把“1 月”混成无名分类。
 *  * 每个月是完整自然月；未结束的当前月、覆盖未知的月份**不参与直接比较**，
 *    在结果里带状态标记，而不是画成完整月份。
 *  * 只拿 1–2 年数据时可以说“当前只有 N 年数据，趋势仅供描述”，不能编造季节规律；
 *    `descriptiveOnly` 表达这个状态。
 *  * 月键比较不设日上限，但月份数量沿用 S-01 §17 的 36 个月上限；越界抛错，不截断。
 */

export const SEASONAL_COMPARISON_VERSION = "s17-b-seasonal-comparison-v1" as const;

export type SeasonalGranularity = "month" | "quarter";

export type SeasonalDescriptiveReason = "fewer-than-two-years" | "current-period-in-progress";

export interface SeasonalOptions {
  readonly metric: TimeSeriesMetric;
  /** 总体分析区间（决定参与比较的年份）；半开区间 [start, end)。 */
  readonly span: TimeSpan;
  readonly today: string;
  readonly coverageEnd: string | null;
  readonly granularity?: SeasonalGranularity;
  /** 月份数量上限（S-01 §17 暂定 36）；越界抛 RangeError，不静默截断。 */
  readonly maxMonths?: number;
}

export interface SeasonalMonthCell {
  readonly year: number;
  readonly month: number;
  /** 与年份无关的月份键（1–12），供图表分类轴使用。 */
  readonly monthKey: number;
  /** 金额（分）；`null` = 不可用（未结束/覆盖未知/不在分析区间）。 */
  readonly amountMinor: string | null;
  readonly transactionCount: number | null;
  readonly state: BucketState | "outside-span";
  /** 能否参与与其他年份同名月份的直接比较。 */
  readonly comparable: boolean;
  /** 是否落在总体分析区间之外（未分析，不是零）。 */
  readonly outsideSpan: boolean;
  /** 该月观测区是否被分析区间裁剪（首月/末月）。 */
  readonly clipped: boolean;
}

export interface SeasonalQuarterCell {
  readonly year: number;
  readonly quarter: number;
  readonly amountMinor: string | null;
  readonly transactionCount: number | null;
  readonly state: BucketState | "outside-span";
  readonly comparable: boolean;
  readonly outsideSpan: boolean;
}

export interface SeasonalYear {
  readonly year: number;
  /** 1–12 月固定顺序（跨年图表分类轴对齐）。 */
  readonly months: readonly SeasonalMonthCell[];
  /** 该年 4 个季度（granularity = quarter 时填充；否则空）。 */
  readonly quarters: readonly SeasonalQuarterCell[];
  readonly totalMinor: string | null;
  readonly completeMonths: number;
  readonly inProgressMonths: number;
  readonly unknownMonths: number;
  readonly comparableMonths: number;
  /** 该年在分析区间内是否有完整月。 */
  readonly hasCompleteMonths: boolean;
}

export interface SeasonalComparisonResult {
  readonly version: typeof SEASONAL_COMPARISON_VERSION;
  readonly granularity: SeasonalGranularity;
  readonly metric: TimeSeriesMetric;
  readonly span: TimeSpan;
  readonly years: readonly SeasonalYear[];
  /** 完整月数 ≥ 1 的年（可进入比较图表）。 */
  readonly comparableYears: readonly number[];
  /** 只做描述性展示（不足两年数据或当前期未结束）。 */
  readonly descriptiveOnly: boolean;
  readonly descriptiveReason: SeasonalDescriptiveReason | null;
  readonly maxMonths: number;
  readonly monthCount: number;
  readonly hasInProgressCells: boolean;
}

const DEFAULT_MAX_MONTHS = 36;
const MONTH_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function clamp(value: string, lower: string, upper: string): string {
  if (value < lower) return lower;
  if (value > upper) return upper;
  return value;
}

function monthCellsForYear(
  year: number,
  span: TimeSpan,
  series: readonly TimeSeriesBucketPoint[],
): SeasonalMonthCell[] {
  const byKey = new Map<string, TimeSeriesBucketPoint>();
  for (const point of series) byKey.set(point.bucket.key, point);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;
  return MONTH_KEYS.map((month) => {
    const monthStart = `${year}-${pad2(month)}-01`;
    const monthEnd = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
    const outsideSpan = monthEnd <= span.start || monthStart >= span.end;
    if (outsideSpan) {
      return {
        year,
        month,
        monthKey: month,
        amountMinor: null,
        transactionCount: null,
        state: "outside-span" as const,
        comparable: false,
        outsideSpan: true,
        clipped: false,
      };
    }
    const point = byKey.get(`${year}-${pad2(month)}`);
    if (point === undefined) {
      return {
        year,
        month,
        monthKey: month,
        amountMinor: null,
        transactionCount: null,
        state: "unknown" as const,
        comparable: false,
        outsideSpan: false,
        clipped: false,
      };
    }
    const clipped = point.bucket.clippedStart || point.bucket.clippedEnd;
    const state = point.bucket.state;
    const comparable = state === "complete" && !clipped;
    return {
      year,
      month,
      monthKey: month,
      amountMinor: point.amountMinor,
      transactionCount: point.transactionCount,
      state,
      comparable,
      outsideSpan: false,
      clipped,
    };
  });
}

function quarterCells(
  year: number,
  months: readonly SeasonalMonthCell[],
): SeasonalQuarterCell[] {
  return [1, 2, 3, 4].map((quarter) => {
    const group = months.filter((cell) => Math.ceil(cell.month / 3) === quarter);
    const outsideSpan = group.every((cell) => cell.outsideSpan);
    if (outsideSpan) {
      return { year, quarter, amountMinor: null, transactionCount: null, state: "outside-span" as const, comparable: false, outsideSpan: true };
    }
    const inProgress = group.some((cell) => cell.state === "in-progress");
    const unknown = group.some((cell) => !cell.comparable);
    const sum = group.reduce((total, cell) => total + (cell.amountMinor === null ? 0n : BigInt(cell.amountMinor)), 0n);
    const count = group.reduce((total, cell) => total + (cell.transactionCount ?? 0), 0);
    const state: BucketState | "outside-span" = inProgress ? "in-progress" : unknown ? "unknown" : "complete";
    return {
      year,
      quarter,
      amountMinor: state === "complete" ? sum.toString() : null,
      transactionCount: state === "complete" ? count : null,
      state,
      comparable: state === "complete",
      outsideSpan: false,
    };
  });
}

/** 收集真正参与比较的年份（有至少一个可比较月份或完整月）。 */
function buildYear(
  year: number,
  span: TimeSpan,
  series: readonly TimeSeriesBucketPoint[],
  granularity: SeasonalGranularity,
): SeasonalYear {
  const months = monthCellsForYear(year, span, series);
  const inSpan = months.filter((cell) => !cell.outsideSpan);
  const completeMonths = inSpan.filter((cell) => cell.comparable).length;
  const inProgressMonths = inSpan.filter((cell) => cell.state === "in-progress").length;
  const unknownMonths = inSpan.filter((cell) => cell.state === "unknown" || cell.state === "unavailable").length;
  const total = inSpan.every((cell) => cell.comparable)
    ? inSpan.reduce((sum, cell) => sum + (cell.amountMinor === null ? 0n : BigInt(cell.amountMinor)), 0n).toString()
    : null;
  return {
    year,
    months,
    quarters: granularity === "quarter" ? quarterCells(year, months) : [],
    totalMinor: total,
    completeMonths,
    inProgressMonths,
    unknownMonths,
    comparableMonths: months.filter((cell) => cell.comparable).length,
    hasCompleteMonths: completeMonths > 0,
  };
}

/**
 * 计算 A18：给定账本条目与总分析区间，按自然年展开 1–12 月（或 1–4 季）的
 * 金额/笔数，并标注可比较性。
 *
 * 调用方必须提供 `today`（设备本地业务日）与 `coverageEnd`（已知完整覆盖的
 * 最后一天；离线数据未知时传 `null`）。
 */
export function computeSeasonalComparison(
  entries: readonly TimeSeriesEntry[],
  options: SeasonalOptions,
): SeasonalComparisonResult {
  const span = parseTimeSpan(options.span);
  const granularity = options.granularity ?? "month";
  const maxMonths = options.maxMonths ?? DEFAULT_MAX_MONTHS;
  const startYear = Number(span.start.slice(0, 4));
  const endYear = Number(addDays(span.end, -1).slice(0, 4));
  const monthCount = (endYear - startYear + 1) * 12;
  if (monthCount > maxMonths) {
    throw new RangeError(`seasonal comparison spans more than ${maxMonths} months`);
  }
  const years: SeasonalYear[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year + 1}-01-01`;
    const yearSpan: TimeSpan = {
      start: clamp(span.start, yearStart, yearEnd),
      end: clamp(span.end, yearStart, yearEnd),
    };
    const series = computeTimeSeries(entries, {
      metric: options.metric,
      granularity: "month",
      span: yearSpan,
      today: options.today,
      coverageEnd: options.coverageEnd,
    }).buckets;
    years.push(buildYear(year, span, series, granularity));
  }
  const comparableYears = years.filter((year) => year.hasCompleteMonths).map((year) => year.year);
  const hasInProgressCells = years.some((year) => year.inProgressMonths > 0);
  const descriptiveOnly = comparableYears.length < 2;
  return {
    version: SEASONAL_COMPARISON_VERSION,
    granularity,
    metric: options.metric,
    span,
    years,
    comparableYears,
    descriptiveOnly,
    descriptiveReason: descriptiveOnly ? "fewer-than-two-years" : null,
    maxMonths,
    monthCount,
    hasInProgressCells,
  };
}
