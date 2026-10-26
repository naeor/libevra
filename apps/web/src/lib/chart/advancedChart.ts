import type { Point } from "./geometry.js";
import type { LinearScale } from "./scales.js";
import { createLinearScale, extentOf, niceDomain, ticksFor } from "./scales.js";
import type { AnomalyResult, DailyExpenseVariability, MovingAverageResult, SeasonalComparisonResult } from "@libellum/shared";
import type { TimeSeriesBucketPoint } from "@libellum/shared";

/**
 * **B-4 图表输入层**：把 shared 的统计结果转换成 SVG 坐标。
 *
 * 与其它分析图表一样，这里只做“数据 → 几何”的纯换算；金额的权威值仍是
 * shared 结果里的定点字符串，模型里的 `number` 只用于画线/画柱。
 * 图表不得自行分组、插值或平滑（规格 §30/§34）。
 */

export interface AdvancedBox {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly padding: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
}

export type AdvancedChartKind = "moving-average" | "volatility-band" | "seasonal" | "anomaly-marks";

function minorToNumber(amountMinor: string | null): number | null {
  if (amountMinor === null) return null;
  return Number(amountMinor);
}

function percentPoint(minor: number): number {
  return minor;
}

function slotCenter(box: AdvancedBox, index: number, count: number): number {
  const slot = count === 0 ? box.innerWidth : box.innerWidth / count;
  return box.padding.left + slot * (index + 0.5);
}

function baseY(box: AdvancedBox): number {
  return box.padding.top + box.innerHeight;
}

export interface MovingAveragePointGeometry {
  readonly key: string;
  readonly x: number;
  readonly yRaw: number | null;
  readonly yAverage: number | null;
  readonly amountMinor: string | null;
  readonly averageScaledMinor: string | null;
  readonly gapReason: string | null;
}

export interface MovingAverageChartModel {
  readonly kind: "moving-average";
  readonly windowDays: number;
  readonly points: readonly MovingAveragePointGeometry[];
  readonly yDomain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly scale: LinearScale;
  readonly zeroY: number;
  readonly rawSegments: readonly (readonly Point[])[];
  readonly averageSegments: readonly (readonly Point[])[];
  readonly allZero: boolean;
  readonly empty: boolean;
}

export function buildMovingAverageModel(
  result: MovingAverageResult,
  box: AdvancedBox,
): MovingAverageChartModel {
  const points = result.points;
  const known: number[] = [];
  for (const point of points) {
    const raw = minorToNumber(point.rawMinor);
    if (raw !== null) known.push(raw);
    if (point.average !== null) known.push(Number(point.average.numeratorMinor) / point.average.denominatorDays);
  }
  const extent = extentOf(known);
  const yDomain = extent === null ? ([0, 1] as const) : niceDomain(extent[0], extent[1], 4);
  const scaleY = createLinearScale(yDomain, [baseY(box), box.padding.top]);
  const count = points.length;
  const geometry: MovingAveragePointGeometry[] = points.map((point, index) => {
    const raw = minorToNumber(point.rawMinor);
    const average =
      point.average === null ? null : Number(point.average.numeratorMinor) / point.average.denominatorDays;
    return {
      key: point.bucket.key,
      x: slotCenter(box, index, count),
      yRaw: raw === null ? null : scaleY(percentPoint(raw)),
      yAverage: average === null ? null : scaleY(percentPoint(average)),
      amountMinor: point.rawMinor,
      averageScaledMinor: point.averageScaledMinor,
      gapReason: point.gapReason,
    };
  });
  const rawSegments: Point[][] = [];
  const averageSegments: Point[][] = [];
  let rawCurrent: Point[] = [];
  let averageCurrent: Point[] = [];
  for (const point of geometry) {
    if (point.yRaw === null) {
      if (rawCurrent.length > 0) rawSegments.push(rawCurrent);
      rawCurrent = [];
    } else {
      rawCurrent.push({ x: point.x, y: point.yRaw });
    }
    if (point.yAverage === null) {
      if (averageCurrent.length > 0) averageSegments.push(averageCurrent);
      averageCurrent = [];
    } else {
      averageCurrent.push({ x: point.x, y: point.yAverage });
    }
  }
  if (rawCurrent.length > 0) rawSegments.push(rawCurrent);
  if (averageCurrent.length > 0) averageSegments.push(averageCurrent);
  return {
    kind: "moving-average",
    windowDays: result.windowDays,
    points: geometry,
    yDomain,
    ticks: ticksFor(yDomain, 4),
    scale: scaleY,
    zeroY: scaleY(0),
    rawSegments,
    averageSegments,
    allZero: known.length > 0 && known.every((value) => value === 0),
    empty: known.length === 0,
  };
}

export interface VolatilityPointGeometry {
  readonly key: string;
  readonly x: number;
  readonly y: number | null;
  readonly amountMinor: string | null;
}

export interface VolatilityChartModel {
  readonly kind: "volatility-band";
  readonly points: readonly VolatilityPointGeometry[];
  readonly segments: readonly (readonly Point[])[];
  readonly yDomain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly scale: LinearScale;
  readonly zeroY: number;
  readonly meanY: number;
  readonly bandTopY: number;
  readonly bandBottomY: number;
  readonly allZero: boolean;
  readonly empty: boolean;
}

export function buildVolatilityModel(
  points: readonly TimeSeriesBucketPoint[],
  variability: DailyExpenseVariability,
  box: AdvancedBox,
): VolatilityChartModel {
  const known: number[] = [];
  for (const point of points) {
    const amount = minorToNumber(point.amountMinor);
    if (amount !== null) known.push(amount);
  }
  const unit = 10 ** variability.band.scale;
  const meanMinor = Number(variability.meanScaledMinor) / unit;
  const lowerMinor = Number(variability.band.lowerScaledMinor) / unit;
  const upperMinor = Number(variability.band.upperScaledMinor) / unit;
  known.push(meanMinor, lowerMinor, upperMinor);
  const extent = extentOf(known);
  const yDomain = extent === null ? ([0, 1] as const) : niceDomain(extent[0], extent[1], 4);
  const scaleY = createLinearScale(yDomain, [baseY(box), box.padding.top]);
  const count = points.length;
  const geometry: VolatilityPointGeometry[] = points.map((point, index) => {
    const amount = minorToNumber(point.amountMinor);
    return {
      key: point.bucket.key,
      x: slotCenter(box, index, count),
      y: amount === null ? null : scaleY(amount),
      amountMinor: point.amountMinor,
    };
  });
  const segments: Point[][] = [];
  let current: Point[] = [];
  for (const point of geometry) {
    if (point.y === null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push({ x: point.x, y: point.y });
    }
  }
  if (current.length > 0) segments.push(current);
  return {
    kind: "volatility-band",
    points: geometry,
    segments,
    yDomain,
    ticks: ticksFor(yDomain, 4),
    scale: scaleY,
    zeroY: scaleY(0),
    meanY: scaleY(meanMinor),
    bandTopY: scaleY(upperMinor),
    bandBottomY: scaleY(lowerMinor),
    allZero: known.length > 0 && known.every((value) => value === 0),
    empty: geometry.every((point) => point.y === null),
  };
}

export interface SeasonalPointGeometry {
  readonly month: number;
  readonly key: string;
  readonly x: number;
  readonly y: number | null;
  readonly amountMinor: string | null;
  readonly comparable: boolean;
  readonly inProgress: boolean;
}

export interface SeasonalSeriesGeometry {
  readonly year: number;
  readonly colorIndex: number;
  readonly points: readonly SeasonalPointGeometry[];
  readonly totalMinor: string | null;
}

export interface SeasonalChartModel {
  readonly kind: "seasonal";
  readonly years: readonly SeasonalSeriesGeometry[];
  readonly yDomain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly scale: LinearScale;
  readonly zeroY: number;
  readonly monthCount: number;
  readonly slotWidth: number;
  readonly allZero: boolean;
  readonly empty: boolean;
}

export function buildSeasonalModel(
  result: SeasonalComparisonResult,
  box: AdvancedBox,
): SeasonalChartModel {
  const monthCount = 12;
  const known: number[] = [];
  for (const year of result.years) {
    for (const month of year.months) {
      const amount = minorToNumber(month.amountMinor);
      if (amount !== null) known.push(amount);
    }
  }
  const extent = extentOf(known);
  const yDomain = extent === null ? ([0, 1] as const) : niceDomain(extent[0], extent[1], 4);
  const scaleY = createLinearScale(yDomain, [baseY(box), box.padding.top]);
  const slotWidth = box.innerWidth / monthCount;
  const years = result.years.map((year, yearIndex): SeasonalSeriesGeometry => ({
    year: year.year,
    colorIndex: yearIndex,
    totalMinor: year.totalMinor,
    points: year.months.map((month) => {
      const amount = minorToNumber(month.amountMinor);
      const x = box.padding.left + slotWidth * (month.month - 0.5);
      return {
        month: month.month,
        key: `${year.year}-${String(month.month).padStart(2, "0")}`,
        x,
        y: amount === null ? null : scaleY(amount),
        amountMinor: month.amountMinor,
        comparable: month.comparable,
        inProgress: month.state === "in-progress",
      };
    }),
  }));
  return {
    kind: "seasonal",
    years,
    yDomain,
    ticks: ticksFor(yDomain, 4),
    scale: scaleY,
    zeroY: scaleY(0),
    monthCount,
    slotWidth,
    allZero: known.length > 0 && known.every((value) => value === 0),
    empty: known.length === 0,
  };
}

export interface AnomalyPointGeometry {
  readonly key: string;
  readonly x: number;
  readonly y: number | null;
  readonly amountMinor: string | null;
}

export interface AnomalyMarkGeometry {
  readonly date: string;
  readonly x: number;
  readonly y: number;
  readonly amountMinor: string;
  readonly deviationScaled: string;
  readonly rank: number;
}

export interface AnomalyChartModel {
  readonly kind: "anomaly-marks";
  readonly points: readonly AnomalyPointGeometry[];
  readonly segments: readonly (readonly Point[])[];
  readonly marks: readonly AnomalyMarkGeometry[];
  readonly yDomain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly scale: LinearScale;
  readonly zeroY: number;
  readonly allZero: boolean;
  readonly empty: boolean;
}

export function buildAnomalyModel(
  points: readonly TimeSeriesBucketPoint[],
  anomaly: AnomalyResult,
  box: AdvancedBox,
): AnomalyChartModel {
  const known: number[] = [];
  for (const point of points) {
    const amount = minorToNumber(point.amountMinor);
    if (amount !== null) known.push(amount);
  }
  const extent = extentOf(known);
  const yDomain = extent === null ? ([0, 1] as const) : niceDomain(extent[0], extent[1], 4);
  const scaleY = createLinearScale(yDomain, [baseY(box), box.padding.top]);
  const count = points.length;
  const byDate = new Map<string, number>();
  const geometry: AnomalyPointGeometry[] = points.map((point, index) => {
    const amount = minorToNumber(point.amountMinor);
    byDate.set(point.bucket.key, index);
    return {
      key: point.bucket.key,
      x: slotCenter(box, index, count),
      y: amount === null ? null : scaleY(amount),
      amountMinor: point.amountMinor,
    };
  });
  const segments: Point[][] = [];
  let current: Point[] = [];
  for (const point of geometry) {
    if (point.y === null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push({ x: point.x, y: point.y });
    }
  }
  if (current.length > 0) segments.push(current);
  const marks: AnomalyMarkGeometry[] = [];
  for (const mark of anomaly.marks) {
    const index = byDate.get(mark.date);
    if (index === undefined) continue;
    const point = geometry[index]!;
    if (point.y === null) continue;
    marks.push({
      date: mark.date,
      x: point.x,
      y: point.y,
      amountMinor: mark.amountMinor,
      deviationScaled: mark.deviationScaled,
      rank: mark.rank,
    });
  }
  return {
    kind: "anomaly-marks",
    points: geometry,
    segments,
    marks,
    yDomain,
    ticks: ticksFor(yDomain, 4),
    scale: scaleY,
    zeroY: scaleY(0),
    allZero: known.length > 0 && known.every((value) => value === 0),
    empty: geometry.every((point) => point.y === null),
  };
}
