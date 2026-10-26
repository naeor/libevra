import type {
  BucketState,
  CalendarHeatmapResult,
  CategorySeriesBucket,
  CategoryShareResult,
  FlowSeriesBucketPoint,
  WeekdayPatternResult,
} from "@libellum/shared";

import { createLinearScale, extentOf, niceDomain, ticksFor, type LinearScale } from "./scales.js";
import type { ChartBox } from "./timeSeriesChart.js";

/**
 * B-2 的图表几何：**只把已确认的数字放到像素上**。
 *
 * 这一层与 `timeSeriesChart.ts` 同一条纪律：
 *
 * 1. 金额、占比、笔数的唯一来源是 shared 的 `computeFlowSeries` /
 *    `computeCategorySeries` / `computeCategoryShares` / `computeWeekdayPattern` /
 *    `computeCalendarHeatmap` 的结果，图表不重新聚合、不改分母。
 * 2. 未知/未来没有几何（没有柱、没有点、格子不可着色），绝不补 0。
 * 3. 像素数字只用于画图；任何 tooltip/来源跳转都回传原字符串。
 */

/** 收入/支出成对柱（CF-B04）：一桶两根柱，零点为共同基线。 */
export interface FlowBar {
  readonly key: string;
  readonly kind: "income" | "expense";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly state: BucketState;
  /** 权威金额；`null` = 该侧未知/未来，柱不存在。 */
  readonly amountMinor: string | null;
}

export interface FlowBarModel {
  readonly slotWidth: number;
  readonly yDomain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly scale: LinearScale;
  readonly zeroY: number;
  readonly bars: readonly FlowBar[];
  readonly allZero: boolean;
  readonly empty: boolean;
  readonly unknownKeys: readonly string[];
}

/** 一根柱最多占槽位的比例；两根并排时每根再除以 2。 */
const FLOW_BAR_WIDTH = 0.32;

export function buildFlowBarModel(
  buckets: readonly FlowSeriesBucketPoint[],
  box: ChartBox,
): FlowBarModel {
  const count = buckets.length;
  const slotWidth = count === 0 ? box.innerWidth : box.innerWidth / count;

  const values: number[] = [];
  for (const bucket of buckets) {
    if (bucket.incomeMinor !== null) values.push(Number(bucket.incomeMinor));
    if (bucket.expenseMinor !== null) values.push(Number(bucket.expenseMinor));
  }

  const extent = extentOf(values);
  const yDomain = extent === null ? ([0, 1] as const) : niceDomain(extent[0], extent[1], 4);
  const scale = createLinearScale(yDomain, [box.padding.top + box.innerHeight, box.padding.top]);
  const zeroY = scale(0);

  const bars: FlowBar[] = [];
  buckets.forEach((bucket, index) => {
    const center = box.padding.left + slotWidth * (index + 0.5);
    const width = Math.max(slotWidth * FLOW_BAR_WIDTH, 1);
    const sides: readonly { kind: "income" | "expense"; amountMinor: string | null; offset: number }[] = [
      { kind: "income", amountMinor: bucket.incomeMinor, offset: -width / 2 },
      { kind: "expense", amountMinor: bucket.expenseMinor, offset: width / 2 },
    ];

    for (const side of sides) {
      if (side.amountMinor === null) continue;
      const y = scale(Number(side.amountMinor));

      bars.push({
        key: `${bucket.bucket.key}:${side.kind}`,
        kind: side.kind,
        x: center + side.offset - width / 2,
        y: Math.min(y, zeroY),
        width,
        height: Math.max(Math.abs(zeroY - y), 1),
        state: bucket.bucket.state,
        amountMinor: side.amountMinor,
      });
    }
  });

  return {
    slotWidth,
    yDomain,
    ticks: ticksFor(yDomain, 4),
    scale,
    zeroY,
    bars,
    allZero: values.length > 0 && values.every((value) => value === 0),
    empty: values.length === 0,
    unknownKeys: buckets
      .filter((bucket) => bucket.incomeMinor === null || bucket.expenseMinor === null)
      .map((bucket) => bucket.bucket.key),
  };
}

/** 堆叠柱的一段（CF-B05）：一个分类在一个时间桶里的那一段。 */
export interface StackSegment {
  readonly key: string;
  readonly categoryId: string;
  readonly colorIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly amountMinor: string;
}

export interface StackedBucketMark {
  readonly key: string;
  readonly totalMinor: string | null;
  readonly state: BucketState;
}

export interface StackedBarModel {
  readonly slotWidth: number;
  readonly yDomain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly scale: LinearScale;
  readonly zeroY: number;
  readonly segments: readonly StackSegment[];
  readonly categories: readonly { readonly categoryId: string; readonly colorIndex: number }[];
  readonly buckets: readonly StackedBucketMark[];
  readonly empty: boolean;
  readonly hasUnknown: boolean;
}

/** 堆叠柱宽度占槽位的比例。 */
const STACK_BAR_WIDTH = 0.72;
/** 段高小于该像素值时并入相邻段显示（只影响视觉，不合并金额）。 */
const MIN_SEGMENT_HEIGHT = 0.5;

export function buildStackedBarModel(
  buckets: readonly CategorySeriesBucket[],
  box: ChartBox,
): StackedBarModel {
  const count = buckets.length;
  const slotWidth = count === 0 ? box.innerWidth : box.innerWidth / count;

  const categoryIds = buckets.flatMap((bucket) => bucket.points.map((point) => point.categoryId));
  const categories: { categoryId: string; colorIndex: number }[] = [];
  for (const categoryId of categoryIds) {
    if (categories.some((category) => category.categoryId === categoryId)) continue;
    categories.push({ categoryId, colorIndex: categories.length });
  }

  const totals = buckets
    .map((bucket) => bucket.totalMinor)
    .filter((total): total is string => total !== null);
  const values = totals.map((total) => Number(total));
  const extent = extentOf(values);
  const yDomain = extent === null ? ([0, 1] as const) : niceDomain(extent[0], extent[1], 4);
  const scale = createLinearScale(yDomain, [box.padding.top + box.innerHeight, box.padding.top]);
  const zeroY = scale(0);

  const segments: StackSegment[] = [];
  buckets.forEach((bucket, index) => {
    if (bucket.totalMinor === null) return;

    const center = box.padding.left + slotWidth * (index + 0.5);
    const width = Math.max(slotWidth * STACK_BAR_WIDTH, 1);
    let cumulative = 0;

    for (const point of bucket.points) {
      if (point.amountMinor === null) continue;
      const amount = Number(point.amountMinor);
      if (amount === 0) continue;

      const startY = scale(cumulative);
      cumulative += amount;
      const endY = scale(cumulative);
      const height = Math.max(Math.abs(startY - endY), MIN_SEGMENT_HEIGHT);
      const category = categories.find((entry) => entry.categoryId === point.categoryId);

      segments.push({
        key: `${bucket.bucket.key}:${point.categoryId}`,
        categoryId: point.categoryId,
        colorIndex: category?.colorIndex ?? 0,
        x: center - width / 2,
        y: Math.min(startY, endY),
        width,
        height,
        amountMinor: point.amountMinor,
      });
    }
  });

  return {
    slotWidth,
    yDomain,
    ticks: ticksFor(yDomain, 4),
    scale,
    zeroY,
    segments,
    categories,
    buckets: buckets.map((bucket) => ({
      key: bucket.bucket.key,
      totalMinor: bucket.totalMinor,
      state: bucket.bucket.state,
    })),
    empty: values.length === 0,
    hasUnknown: buckets.some((bucket) => bucket.totalMinor === null),
  };
}

/** 一条 100% 堆叠带上的一个点（CF-B06）。 */
export interface ShareBandPoint {
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

export interface ShareBand {
  readonly categoryId: string;
  readonly colorIndex: number;
  /** 未知/未来处断开；每段至少 2 个点才画面积。 */
  readonly segments: readonly (readonly ShareBandPoint[])[];
}

export interface ShareStackModel {
  readonly slotWidth: number;
  readonly plotTop: number;
  readonly plotBottom: number;
  /** 0–1 的占比刻度。 */
  readonly ticks: readonly number[];
  readonly bands: readonly ShareBand[];
  readonly empty: boolean;
  readonly unknownKeys: readonly string[];
  readonly zeroTotalKeys: readonly string[];
  readonly partial: boolean;
}

/** 占比 → 像素：只用于画图，不参与任何金额/占比回算。 */
function ratioValue(numeratorMinor: string, denominatorMinor: string): number {
  const numerator = Number(numeratorMinor);
  const denominator = Number(denominatorMinor);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return NaN;

  return numerator / denominator;
}

export function buildShareStackModel(shares: CategoryShareResult, box: ChartBox): ShareStackModel {
  const count = shares.buckets.length;
  const slotWidth = count === 0 ? box.innerWidth : box.innerWidth / count;
  const plotTop = box.padding.top;
  const plotBottom = box.padding.top + box.innerHeight;
  const plotHeight = plotBottom - plotTop;

  const categoryIds = shares.buckets.flatMap((bucket) => bucket.points.map((point) => point.categoryId));
  const categories: { categoryId: string; colorIndex: number }[] = [];
  for (const categoryId of categoryIds) {
    if (categories.some((category) => category.categoryId === categoryId)) continue;
    categories.push({ categoryId, colorIndex: categories.length });
  }

  const bucketsWithShares = shares.buckets.map((bucket, index) => {
    const x = box.padding.left + slotWidth * (index + 0.5);
    const available =
      (bucket.state === "ok" || bucket.state === "in-progress") &&
      bucket.points.every((point) => point.share !== null);

    if (!available) return { x, values: null as null | number[], categoryIds: null as null | string[] };

    const values: number[] = [];
    const ids: string[] = [];
    for (const point of bucket.points) {
      if (point.share === null) continue;
      const value = ratioValue(point.share.numeratorMinor, point.share.denominatorMinor);
      values.push(Number.isFinite(value) ? value : NaN);
      ids.push(point.categoryId);
    }

    return { x, values, categoryIds: ids };
  });

  const bands: ShareBand[] = categories.map((category) => {
    const segments: ShareBandPoint[][] = [];
    let current: ShareBandPoint[] = [];

    for (const bucket of bucketsWithShares) {
      if (bucket.values === null || bucket.categoryIds === null) {
        if (current.length > 0) segments.push(current);
        current = [];
        continue;
      }
      const index = bucket.categoryIds.indexOf(category.categoryId);
      if (index < 0) {
        if (current.length > 0) segments.push(current);
        current = [];
        continue;
      }

      let below = 0;
      for (let previous = 0; previous < index; previous += 1) {
        below += bucket.values[previous] ?? 0;
      }
      const value = bucket.values[index] ?? 0;
      const bottom = plotBottom - below * plotHeight;
      const top = plotBottom - (below + value) * plotHeight;

      current.push({ x: bucket.x, top, bottom });
    }

    if (current.length > 0) segments.push(current);

    return { categoryId: category.categoryId, colorIndex: category.colorIndex, segments };
  });

  return {
    slotWidth,
    plotTop,
    plotBottom,
    ticks: [0, 0.25, 0.5, 0.75, 1],
    bands,
    empty: shares.buckets.every((bucket) => bucket.totalMinor === null),
    unknownKeys: shares.buckets.filter((bucket) => bucket.state === "unknown").map((bucket) => bucket.bucket.key),
    zeroTotalKeys: shares.buckets
      .filter((bucket) => bucket.state === "zero-total")
      .map((bucket) => bucket.bucket.key),
    partial: shares.buckets.some((bucket) => bucket.state === "in-progress"),
  };
}

/** 星期分布的一根柱（CF-B09）。 */
export interface WeekdayBar {
  readonly weekday: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly value: number | null;
  readonly exactText: string | null;
  readonly observedDays: number;
}

export type WeekdayMode = "total" | "average";

export interface WeekdayModel {
  readonly slotWidth: number;
  readonly yDomain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly scale: LinearScale;
  readonly zeroY: number;
  readonly bars: readonly WeekdayBar[];
  readonly mode: WeekdayMode;
  readonly empty: boolean;
  readonly insufficientSample: boolean;
}

/** 星期柱宽度占槽位的比例。 */
const WEEKDAY_BAR_WIDTH = 0.6;

export function buildWeekdayModel(
  pattern: WeekdayPatternResult,
  options: { readonly box: ChartBox; readonly mode: WeekdayMode },
): WeekdayModel {
  const { box, mode } = options;
  const weekdays = pattern.weekdays;
  const slotWidth = weekdays.length === 0 ? box.innerWidth : box.innerWidth / weekdays.length;

  const values: number[] = [];
  for (const day of weekdays) {
    if (mode === "total" && day.totalMinor !== null) values.push(Number(day.totalMinor));
    if (mode === "average" && day.average !== null) {
      values.push(Number(day.average.numeratorMinor) / day.average.denominatorDays);
    }
  }

  const extent = extentOf(values);
  const yDomain = extent === null ? ([0, 1] as const) : niceDomain(extent[0], extent[1], 4);
  const scale = createLinearScale(yDomain, [box.padding.top + box.innerHeight, box.padding.top]);
  const zeroY = scale(0);
  const width = Math.max(slotWidth * WEEKDAY_BAR_WIDTH, 1);

  const bars: WeekdayBar[] = weekdays.map((day, index) => {
    const center = box.padding.left + slotWidth * (index + 0.5);
    if (mode === "total" && day.totalMinor !== null) {
      const y = scale(Number(day.totalMinor));
      return {
        weekday: day.weekday,
        x: center - width / 2,
        y: Math.min(y, zeroY),
        width,
        height: Math.max(Math.abs(zeroY - y), 1),
        value: Number(day.totalMinor),
        exactText: day.totalMinor,
        observedDays: day.observedDays,
      };
    }
    if (mode === "average" && day.average !== null) {
      const value = Number(day.average.numeratorMinor) / day.average.denominatorDays;
      const y = scale(value);
      return {
        weekday: day.weekday,
        x: center - width / 2,
        y: Math.min(y, zeroY),
        width,
        height: Math.max(Math.abs(zeroY - y), 1),
        value,
        exactText: day.average.text,
        observedDays: day.observedDays,
      };
    }

    return {
      weekday: day.weekday,
      x: center - width / 2,
      y: zeroY,
      width,
      height: 0,
      value: null,
      exactText: null,
      observedDays: day.observedDays,
    };
  });

  return {
    slotWidth,
    yDomain,
    ticks: ticksFor(yDomain, 4),
    scale,
    zeroY,
    bars,
    mode,
    empty: values.length === 0,
    insufficientSample: !pattern.sufficientSample,
  };
}

/** 日历热力图的一格（CF-B08）。 */
export interface CalendarCellBox {
  readonly date: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly level: number | null;
  readonly state: BucketState;
  readonly valueMinor: string | null;
  readonly transactionCount: number | null;
}

export interface CalendarMonthBox {
  readonly monthKey: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly CalendarCellBox[];
}

export interface CalendarGridModel {
  readonly cellSize: number;
  readonly gap: number;
  readonly months: readonly CalendarMonthBox[];
  readonly empty: boolean;
}

/**
 * 日历格子的像素布局：星期一起始、7 列，月份之间留出间距。
 * 不含任何文字（月份标题等单位由组件的 i18n 属性提供）。
 */
export function buildCalendarGridModel(
  heatmap: CalendarHeatmapResult,
  options: { readonly box: ChartBox; readonly gap?: number; readonly monthGap?: number },
): CalendarGridModel {
  const { box } = options;
  const gap = options.gap ?? 2;
  const monthGap = options.monthGap ?? 16;
  const monthWidth = box.innerWidth;

  const cellSize = Math.max((monthWidth - gap * 6) / 7, 1);
  const months: CalendarMonthBox[] = [];

  let y = box.padding.top;
  for (const month of heatmap.months) {
    const rowCount = month.weeks.length;
    const monthHeight = rowCount * cellSize + Math.max(0, rowCount - 1) * gap;
    const cells: CalendarCellBox[] = [];

    month.weeks.forEach((week, weekIndex) => {
      week.days.forEach((cell, dayIndex) => {
        if (cell === null) return;
        cells.push({
          date: cell.date,
          x: box.padding.left + dayIndex * (cellSize + gap),
          y: y + weekIndex * (cellSize + gap),
          width: cellSize,
          height: cellSize,
          level: cell.level,
          state: cell.state,
          valueMinor: cell.valueMinor,
          transactionCount: cell.transactionCount,
        });
      });
    });

    months.push({
      monthKey: month.monthKey,
      x: box.padding.left,
      y,
      width: monthWidth,
      height: monthHeight,
      cells,
    });

    y += monthHeight + monthGap;
  }

  return {
    cellSize,
    gap,
    months,
    empty: months.every((month) => month.cells.length === 0),
  };
}
