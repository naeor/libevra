import type {
  BucketState,
  CumulativeBucketPoint,
  TimeSeriesBucketPoint,
  TimeSeriesMetric,
} from "@libellum/shared";

import { areaPath, linePath, type Point } from "./geometry.js";
import { createLinearScale, extentOf, niceDomain, ticksFor, type LinearScale } from "./scales.js";

/**
 * 时间序列 → 像素坐标。
 *
 * 这一层只做“把权威结果放到一个盒子里”：数值来自 shared 的
 * `computeTimeSeries` / `accumulateSeries`（十进制字符串或整数），到这里只为
 * 绘制换算成像素数字。**图表的几何永远不能反过来当作统计口径**——I20/§33.3
 * 明确禁止从 SVG 坐标反推日期或金额。
 *
 * 三条规则写在这里，而不是散落在各图表组件里：
 *
 * 1. **缺数据的点没有 y**（不是 0）。折线在未知/未来处断开；柱状图不画柱。
 * 2. **X 是等宽槽位**。日/周/月的桶天然等宽；等宽也只保证“每个桶一个位置”，
 *    不代表真实日期间隔——需要真实时间轴时由上层换比例尺，不在图表里猜。
 * 3. **Y 永远包含 0**（`niceDomain` 保证）。柱状与面积是相对基线的比较，
 *    截断纵轴会把微小差异画成巨变。
 */

/** 与 `ChartFrame` 的 `ChartLayout` 结构兼容；这里不 import 组件，保持纯函数。 */
export interface ChartBox {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly padding: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
}

export type SeriesChartKind = "line" | "area" | "bar";

export interface SeriesValuePoint {
  readonly key: string;
  /** 槽位中心的像素 x。 */
  readonly x: number;
  /** 像素 y；未知/未来桶为 `null`，调用方必须断开而不是补 0。 */
  readonly y: number | null;
  readonly amountMinor: string | null;
  readonly count: number | null;
  readonly state: BucketState;
}

export interface SeriesBar {
  readonly key: string;
  /** 柱体左上角。 */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly state: BucketState;
}

export interface SeriesChartModel {
  readonly kind: SeriesChartKind;
  readonly slotWidth: number;
  readonly yDomain: readonly [number, number];
  readonly ticks: readonly number[];
  /** 数值 → 像素 y（绝对坐标，含 padding.top）。 */
  readonly scale: LinearScale;
  /** 数值 0 所在像素。 */
  readonly zeroY: number;
  readonly points: readonly SeriesValuePoint[];
  /** 折线/面积的分段；未知处断开，每段至少 1 个点。 */
  readonly segments: readonly (readonly Point[])[];
  /** `chartKind: "bar"` 时的柱体；未知/未来桶没有柱。 */
  readonly bars: readonly SeriesBar[];
  readonly allZero: boolean;
  readonly hasNegative: boolean;
  readonly knownCount: number;
  readonly empty: boolean;
}

function offsetY(box: ChartBox): readonly [number, number] {
  return [box.padding.top + box.innerHeight, box.padding.top];
}

function numericValue(point: TimeSeriesBucketPoint, metric: TimeSeriesMetric): number | null {
  if (point.bucket.state === "unknown" || point.bucket.state === "unavailable") return null;

  if (metric === "count") return point.transactionCount;
  if (point.amountMinor === null) return null;

  return Number(point.amountMinor);
}

/** 把连续的非空点切成折线/面积段。 */
function segmentsOf(points: readonly SeriesValuePoint[]): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] = [];

  for (const point of points) {
    if (point.y === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }

    current.push({ x: point.x, y: point.y });
  }

  if (current.length > 0) segments.push(current);

  return segments;
}

export function buildTimeSeriesModel(
  points: readonly TimeSeriesBucketPoint[],
  options: {
    readonly box: ChartBox;
    readonly chartKind: SeriesChartKind;
    readonly metric: TimeSeriesMetric;
  },
): SeriesChartModel {
  const { box, chartKind, metric } = options;
  const count = points.length;
  const slotWidth = count === 0 ? box.innerWidth : box.innerWidth / count;

  const values = points
    .map((point) => numericValue(point, metric))
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const extent = extentOf(values);
  const yDomain = extent === null ? ([0, 1] as const) : niceDomain(extent[0], extent[1], 4);
  const scale = createLinearScale(yDomain, [box.padding.top + box.innerHeight, box.padding.top]);

  const geometry: SeriesValuePoint[] = points.map((point, index) => {
    const value = numericValue(point, metric);

    return {
      key: point.bucket.key,
      x: box.padding.left + slotWidth * (index + 0.5),
      y: value === null ? null : scale(value),
      amountMinor: point.amountMinor,
      count: point.transactionCount,
      state: point.bucket.state,
    };
  });

  const bars: SeriesBar[] =
    chartKind === "bar"
      ? geometry.flatMap((point) => {
          if (point.y === null) return [];

          const zeroY = scale(0);
          const width = Math.max(slotWidth * 0.6, 1);

          return [
            {
              key: point.key,
              x: point.x - width / 2,
              y: Math.min(point.y, zeroY),
              width,
              height: Math.max(Math.abs(zeroY - point.y), 1),
              state: point.state,
            },
          ];
        })
      : [];

  return {
    kind: chartKind,
    slotWidth,
    yDomain,
    ticks: ticksFor(yDomain, 4),
    scale,
    zeroY: scale(0),
    points: geometry,
    segments: segmentsOf(geometry),
    bars,
    allZero: values.length > 0 && values.every((value) => value === 0),
    hasNegative: values.some((value) => value < 0),
    knownCount: values.length,
    empty: values.length === 0,
  };
}

export interface CumulativeValuePoint {
  readonly key: string;
  readonly x: number;
  readonly y: number | null;
  readonly cumulativeMinor: string | null;
  readonly deltaMinor: string | null;
  readonly state: BucketState;
}

export interface CumulativeChartModel {
  readonly slotWidth: number;
  readonly yDomain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly scale: LinearScale;
  readonly zeroY: number;
  readonly points: readonly CumulativeValuePoint[];
  readonly segments: readonly (readonly Point[])[];
  readonly allZero: boolean;
  readonly hasNegative: boolean;
  readonly knownCount: number;
  readonly empty: boolean;
  readonly firstUnknownKey: string | null;
}

/**
 * 累计序列的几何（I20 / CF-B11）。
 *
 * 未知会向后传播：共享层的 `accumulateSeries` 已经把后续累计值置空，
 * 这里只把空值断开——绝不把前后的点连成一条看起来完整的“累计线”。
 */
export function buildCumulativeModel(
  points: readonly CumulativeBucketPoint[],
  box: ChartBox,
): CumulativeChartModel {
  const count = points.length;
  const slotWidth = count === 0 ? box.innerWidth : box.innerWidth / count;

  const values = points
    .map((point) => (point.cumulativeMinor === null ? null : Number(point.cumulativeMinor)))
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const extent = extentOf(values);
  const yDomain = extent === null ? ([0, 1] as const) : niceDomain(extent[0], extent[1], 4);
  const scale = createLinearScale(yDomain, [box.padding.top + box.innerHeight, box.padding.top]);

  const geometry: CumulativeValuePoint[] = points.map((point, index) => ({
    key: point.bucket.key,
    x: box.padding.left + slotWidth * (index + 0.5),
    y: point.cumulativeMinor === null ? null : scale(Number(point.cumulativeMinor)),
    cumulativeMinor: point.cumulativeMinor,
    deltaMinor: point.deltaMinor,
    state: point.bucket.state,
  }));

  const segments: Point[][] = [];
  let current: Point[] = [];
  for (const point of geometry) {
    if (point.y === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push({ x: point.x, y: point.y });
  }
  if (current.length > 0) segments.push(current);

  return {
    slotWidth,
    yDomain,
    ticks: ticksFor(yDomain, 4),
    scale,
    zeroY: scale(0),
    points: geometry,
    segments,
    allZero: values.length > 0 && values.every((value) => value === 0),
    hasNegative: values.some((value) => value < 0),
    knownCount: values.length,
    empty: values.length === 0,
    firstUnknownKey: points.find((point) => point.bucket.state === "unknown" || point.bucket.state === "unavailable")?.bucket.key ?? null,
  };
}

/** 便捷：从一段点生成面积路径（不足两个点时返回 `null`，面积没有意义）。 */
export function areaOf(segment: readonly Point[], baselineY: number): string | null {
  return segment.length >= 2 ? areaPath(segment, baselineY) : null;
}

/** 便捷：折线路径（单点也画，但由调用方决定是否显示）。 */
export function lineOf(segment: readonly Point[]): string {
  return linePath(segment);
}

export type { LinearScale };
