import { addDays } from "./stats.js";
import type { TimeBucket } from "./timeCalendar.js";
import type { TimeSeriesBucketPoint } from "./timeSeries.js";

/**
 * **移动平均计算（B-4，A13/A14）**——在**完整的每日支出序列**上做尾随窗口平均。
 *
 * 这一层只做算术，不读数据库、不画图、不做汇率；调用方负责先把每日序列算好
 * （`computeTimeSeries(..., { granularity: "day", metric: "expense" })`），并且
 * 按需要把读取区间向历史方向扩展 —— 这样窗口一开始就能用真实历史数据，而
 * 不是从查询区间第一天才开始。
 *
 * 三条不可协商的规则（规格 §25/§26）：
 *
 *  * **日历日，不是“最近七笔交易”**：窗口是连续 7 个 `YYYY-MM-DD` 日历日。
 *  * **未知不等于零**：窗口内任一天未知/未来，该点不可计算（`null`），不得
 *    把未知当 0 参与平均。
 *  * **窗口不足不画假点**：距序列起点不足一个完整窗口的点是
 *    `insufficient-history`；调用方扩展不到历史时如实显示不可计算。
 *
 * 平均值用**精确分数**表示（`numeratorMinor / denominatorDays`），不在这里
 * 转成浮点；`averageScaledMinor` 只是给 UI 的向下取整十进制展开，便于直接
 * 显示，不是权威值。
 */

export const MOVING_AVERAGE_VERSION = "s17-b-moving-average-v1" as const;

/** 一个点不可计算的原因；`null` = 可计算。 */
export type MovingAverageGapReason = "insufficient-history" | "window-incomplete";

/** 移动平均结果中的一个点。 */
export interface MovingAveragePoint {
  readonly bucket: TimeBucket;
  /** 原始每日金额（分，字符串）；未知/未来为 `null`。 */
  readonly rawMinor: string | null;
  /**
   * 精确尾随平均 = `numeratorMinor / denominatorDays`（单位：分）。
   * `null` = 不可计算；不要把它当 0。
   */
  readonly average: {
    readonly numeratorMinor: string;
    readonly denominatorDays: number;
  } | null;
  /** 供展示用的十进制定点值（向下取整，单位：分 × 10^scale）。 */
  readonly averageScaledMinor: string | null;
  readonly gapReason: MovingAverageGapReason | null;
}

export interface MovingAverageResult {
  readonly version: typeof MOVING_AVERAGE_VERSION;
  readonly windowDays: number;
  /** A13/A14 都是尾随窗口；保留字段给 S-01 `MovingAverageResult` 对齐。 */
  readonly trailing: true;
  readonly granularity: "day";
  readonly points: readonly MovingAveragePoint[];
  /** 可计算原始金额的日数（完整日；不含未知/未来）。 */
  readonly observedDays: number;
  readonly computablePoints: number;
  /** 因窗口含未知/未来日而不可计算的点数。 */
  readonly unknownWindowPoints: number;
  /** 因序列起点不足一个窗口而不可计算的点数。 */
  readonly missingHistoryPoints: number;
  /** 缺失处理策略：窗口必须完整才计算（不跳过未知、不插值）。 */
  readonly gapPolicy: "require-complete-window";
  /** `averageScaledMinor` 的十进制位数。 */
  readonly scale: number;
  /** 每个点都有原始值且平均可计算。 */
  readonly complete: boolean;
}

export interface MovingAverageOptions {
  /** 窗口长度（日历日数）；A13 = 7、A14 = 30。必须为正整数。 */
  readonly windowDays: number;
  /** `averageScaledMinor` 的小数位数，默认 4。 */
  readonly scale?: number;
}

const DEFAULT_SCALE = 4;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * On the daily series in chronological order, compute the trailing mean over
 * `windowDays` consecutive calendar days ending at (and including) each day.
 *
 * The series must be **contiguous** day buckets: a missing day would silently
 * change the window. Pass an extended series when a window needs history that
 * starts before the visible range.
 */
export function computeTrailingMovingAverage(
  daily: readonly TimeSeriesBucketPoint[],
  options: MovingAverageOptions,
): MovingAverageResult {
  if (!isPositiveInteger(options.windowDays)) {
    throw new RangeError("windowDays must be a positive integer");
  }
  const scale = options.scale ?? DEFAULT_SCALE;
  if (!Number.isInteger(scale) || scale < 0 || scale > 8) {
    throw new RangeError("scale must be an integer between 0 and 8");
  }
  if (daily.length === 0) {
    throw new RangeError("daily series must not be empty");
  }
  const first = daily[0]!;
  let previousKey = first.bucket.key;
  for (const point of daily) {
    if (point.bucket.granularity !== "day") {
      throw new RangeError("moving average needs a day-granularity series");
    }
    if (point.bucket.key !== previousKey && point.bucket.key !== addDays(previousKey, 1)) {
      throw new RangeError("moving average needs contiguous calendar days");
    }
    previousKey = point.bucket.key;
  }

  const amountByDate = new Map<string, string | null>();
  for (const point of daily) {
    amountByDate.set(point.bucket.key, point.amountMinor);
  }

  const scaledUnits = 10n ** BigInt(scale);
  const windowDays = options.windowDays;
  const points: MovingAveragePoint[] = daily.map((point, index) => {
    const from = addDays(point.bucket.key, -(windowDays - 1));
    let numerator = 0n;
    let unknown = false;
    for (let offset = 0; offset < windowDays && !unknown; offset += 1) {
      const date = addDays(from, offset);
      const amount = amountByDate.get(date);
      if (amount === undefined || amount === null) unknown = true;
      else numerator += BigInt(amount);
    }
    const knownStart = index >= windowDays - 1;
    if (!knownStart) {
      return {
        bucket: point.bucket,
        rawMinor: point.amountMinor,
        average: null,
        averageScaledMinor: null,
        gapReason: "insufficient-history",
      };
    }
    if (unknown) {
      return {
        bucket: point.bucket,
        rawMinor: point.amountMinor,
        average: null,
        averageScaledMinor: null,
        gapReason: "window-incomplete",
      };
    }
    const denominator = BigInt(windowDays);
    return {
      bucket: point.bucket,
      rawMinor: point.amountMinor,
      average: { numeratorMinor: numerator.toString(), denominatorDays: windowDays },
      averageScaledMinor: ((numerator * scaledUnits) / denominator).toString(),
      gapReason: null,
    };
  });

  const observedDays = daily.filter((point) => point.amountMinor !== null).length;
  const computablePoints = points.filter((point) => point.average !== null).length;
  const unknownWindowPoints = points.filter((point) => point.gapReason === "window-incomplete").length;
  const missingHistoryPoints = points.filter((point) => point.gapReason === "insufficient-history").length;
  return {
    version: MOVING_AVERAGE_VERSION,
    windowDays,
    trailing: true,
    granularity: "day",
    points,
    observedDays,
    computablePoints,
    unknownWindowPoints,
    missingHistoryPoints,
    gapPolicy: "require-complete-window",
    scale,
    complete: computablePoints === points.length,
  };
}

/**
 * `MovingAverageResult` 是“原始 + 平均”两条序列；同时算 7 日与 30 日时复用
 * 同一份原始序列，不重复分桶（规格 §26 最后一段）。
 */
export function movingAverageSeries(result: MovingAverageResult): {
  readonly raw: readonly (string | null)[];
  readonly averageScaled: readonly (string | null)[];
} {
  return {
    raw: result.points.map((point) => point.rawMinor),
    averageScaled: result.points.map((point) => point.averageScaledMinor),
  };
}
