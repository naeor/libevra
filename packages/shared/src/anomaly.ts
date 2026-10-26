import type { TimeSpan } from "./timeCalendar.js";
import type { TimeSeriesBucketPoint } from "./timeSeries.js";

/**
 * **异常高峰提示（B-4，A19）**——“哪些日期相对自己的历史统计偏高”。
 *
 * 这是**描述性统计**，不是风控、不是判断消费好坏、不是欺诈识别（规格 §29）。
 * 实现选择（全部写进结果的 `parameters`/`formula` 字段，可解释、可复现）：
 *
 *  1. `MAD`（默认）：稳健 z = (x − median) / (1.4826 × MAD)。用中位数与绝对中位差
 *     抵抗离群值；`multiplier = 3.5`（即 z = 3.5）。
 *  2. MAD 为 0（大多数日子金额相同）时 → `IQR`：超过 Q3 + 1.5×IQR 视为偏高。
 *  3. IQR 也为 0（大量 0 或恒定金额）→ `zero-dispersion-quantile`：以 95 分位为
 *     阈值，只标记高于 0 且达到阈值的日，绝不把 0 当异常。
 *
 * 今日的**未结束**一天不参与基线、也不标记为异常（避免把半天数据当全天）；
 * 样本不足（默认 < 28 个完整日）时 `sufficientSample = false` 且不产出标记。
 * 金额全部用整数分做精确比较，浮点只用于展示。
 */

export const ANOMALY_VERSION = "s17-b-anomaly-v1" as const;

export type AnomalyMethod = "mad" | "iqr" | "zero-dispersion-quantile";

export interface AnomalyOptions {
  /** MAD 稳健分数阈值，默认 3.5。 */
  readonly madMultiplier?: number;
  /** IQR 方法阈值，默认 1.5。 */
  readonly iqrMultiplier?: number;
  /** 极端稀疏时的分位阈值，默认 0.95。 */
  readonly quantile?: number;
  /** 最小完整日样本数，默认 28。 */
  readonly minimumSampleDays?: number;
}

export interface AnomalyParameters {
  readonly method: AnomalyMethod;
  readonly madMultiplier: string;
  readonly iqrMultiplier: string;
  readonly quantile: string;
  readonly minimumSampleDays: number;
}

export interface AnomalyBaseline {
  readonly sampleDays: number;
  /** 中位数（精确分数，分）。 */
  readonly median: { readonly numeratorMinor: string; readonly denominator: number };
  /** 绝对中位差（定点小数，scale = 6，分）。 */
  readonly medianAbsoluteDeviationScaledMinor: string;
  readonly meanScaledMinor: string;
  readonly zeroDays: number;
  readonly minMinor: string;
  readonly maxMinor: string;
}

export interface AnomalyMark {
  readonly date: string;
  readonly amountMinor: string;
  /** 稳健偏离分数（定点小数，scale = 6；MAD z 分数或超过 IQR 的倍数）。 */
  readonly deviationScaled: string;
  /** 该方法下的阈值（定点小数，scale = 6，分）。 */
  readonly thresholdScaledMinor: string;
  /** 按金额从高到低的 1 起始排名。 */
  readonly rank: number;
}

export interface AnomalyResult {
  readonly version: typeof ANOMALY_VERSION;
  readonly method: AnomalyMethod;
  readonly parameters: AnomalyParameters;
  /** 全部完整日（基线样本）的统计。样本为 0 时 `null`。 */
  readonly baseline: AnomalyBaseline | null;
  readonly marks: readonly AnomalyMark[];
  readonly sampleDays: number;
  readonly sufficientSample: boolean;
  /** 分析区间（含未参与统计的今天）。 */
  readonly targetRange: TimeSpan;
  /** 今天若未结束，是否被排除出统计与标记。 */
  readonly todayExcluded: boolean;
  /** 公式标识；UI 用它把“怎么算的”讲清楚。 */
  readonly formula: {
    readonly mad: "robust-z-score-v1";
    readonly iqr: "tukey-fence-v1";
    readonly quantile: "percentile-threshold-v1";
  };
}

const DISPLAY_SCALE = 6;
const DISPLAY_UNITS = 10n ** BigInt(DISPLAY_SCALE);
const DEFAULT_MINIMUM_SAMPLE_DAYS = 28;
const DEFAULT_MAD_MULTIPLIER = 3.5;
const DEFAULT_IQR_MULTIPLIER = 1.5;
const DEFAULT_QUANTILE = 0.95;

interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

function medianRational(sorted: readonly bigint[]): Rational {
  const count = sorted.length;
  const middle = Math.floor(count / 2);
  if (count % 2 === 1) return { num: sorted[middle]!, den: 1n };
  return { num: sorted[middle - 1]! + sorted[middle]!, den: 2n };
}

function medianOfHalves(sorted: readonly bigint[], lowerHalf: boolean): Rational {
  const count = sorted.length;
  const middle = Math.floor(count / 2);
  const half = lowerHalf ? sorted.slice(0, middle) : sorted.slice(count - middle);
  return medianRational(half);
}

function scaledRational(value: Rational, units: bigint): bigint {
  return (value.num * units) / value.den;
}

/** 把整数金额按精确分数中位数展开为定点小数。 */
function deviationScaled(amount: bigint, median: Rational): bigint {
  const delta = amount * median.den - median.num;
  const absolute = delta < 0n ? -delta : delta;
  return (absolute * DISPLAY_UNITS) / median.den;
}



function rationalFromDecimal(value: number): Rational {
  // 倍率最多 4 位小数；先放大到整数再约分，避免二进制浮点进入比较。
  const scaled = BigInt(Math.round(value * 10_000));
  return { num: scaled, den: 10_000n };
}



function isPositiveRational(value: Rational): boolean {
  return value.num > 0n;
}

/**
 * A19：在每日支出序列上标记“相对自身历史偏高”的日期。
 *
 * 只有 `state === "complete"` 的日进入基线；`in-progress`（通常今天）与
 * `unknown/future` 不参与。没有标记也不等于“今天一定不异常”——今天的数
 * 据还没结束，UI 必须配合 `todayExcluded` 说明。
 */
export function detectDailyExpenseAnomalies(
  daily: readonly TimeSeriesBucketPoint[],
  options: AnomalyOptions = {},
): AnomalyResult {
  if (daily.length === 0) {
    throw new RangeError("daily series must not be empty");
  }
  for (const point of daily) {
    if (point.bucket.granularity !== "day") {
      throw new RangeError("anomaly detection needs a day-granularity series");
    }
  }
  const minimumSampleDays = options.minimumSampleDays ?? DEFAULT_MINIMUM_SAMPLE_DAYS;
  const madMultiplier = options.madMultiplier ?? DEFAULT_MAD_MULTIPLIER;
  const iqrMultiplier = options.iqrMultiplier ?? DEFAULT_IQR_MULTIPLIER;
  const quantile = options.quantile ?? DEFAULT_QUANTILE;
  const parameters: AnomalyParameters = {
    method: "mad",
    madMultiplier: String(madMultiplier),
    iqrMultiplier: String(iqrMultiplier),
    quantile: String(quantile),
    minimumSampleDays,
  };

  const complete = daily.filter(
    (point) => point.bucket.state === "complete" && point.amountMinor !== null,
  );
  const todayExcluded = daily.some((point) => point.bucket.state === "in-progress");
  const amounts = complete
    .map((point) => ({ date: point.bucket.key, amount: BigInt(point.amountMinor!) }))
    .sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : a.date < b.date ? -1 : 1));
  const targetRange: TimeSpan = {
    start: daily[0]!.bucket.span.start,
    end: daily[daily.length - 1]!.bucket.span.end,
  };

  const baseResult = {
    version: ANOMALY_VERSION,
    targetRange,
    todayExcluded,
    formula: {
      mad: "robust-z-score-v1",
      iqr: "tukey-fence-v1",
      quantile: "percentile-threshold-v1",
    },
  } as const;

  if (amounts.length === 0) {
    return {
      ...baseResult,
      method: "mad",
      parameters,
      baseline: null,
      marks: [],
      sampleDays: 0,
      sufficientSample: false,
    };
  }

  const sorted = amounts.map((item) => item.amount);
  const median = medianRational(sorted);
  const deviations = amounts
    .map((item) => deviationScaled(item.amount, median))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const madRational = medianRational(deviations);
  const zeroDays = amounts.filter((item) => item.amount === 0n).length;
  const sum = amounts.reduce((total, item) => total + item.amount, 0n);
  const meanScaled = (sum * DISPLAY_UNITS) / BigInt(amounts.length);
  const minMinor = sorted[0]!;
  const maxMinor = sorted[sorted.length - 1]!;
  const baseline: AnomalyBaseline = {
    sampleDays: amounts.length,
    median: { numeratorMinor: median.num.toString(), denominator: Number(median.den) },
    medianAbsoluteDeviationScaledMinor: scaledRational(madRational, DISPLAY_UNITS).toString(),
    meanScaledMinor: meanScaled.toString(),
    zeroDays,
    minMinor: minMinor.toString(),
    maxMinor: maxMinor.toString(),
  };

  const sufficientSample = amounts.length >= minimumSampleDays;
  if (!sufficientSample) {
    return {
      ...baseResult,
      method: "mad",
      parameters,
      baseline,
      marks: [],
      sampleDays: amounts.length,
      sufficientSample: false,
    };
  }

  let method: AnomalyMethod = "mad";
  let marks: AnomalyMark[] = [];
  const ranked = [...amounts].sort((a, b) => (a.amount === b.amount ? (a.date < b.date ? -1 : 1) : a.amount > b.amount ? -1 : 1));

  if (isPositiveRational(madRational)) {
    const multiplier = rationalFromDecimal(madMultiplier);
    for (const item of ranked) {
      const delta = item.amount * median.den - median.num;
      if (delta <= 0n) continue;
      // MAD 与偏差都换算到同一个 10^6 定点尺度后再比较：
      // (x−median)/MAD > multiplier ⇔ deltaScaled·madDen·mDen > mNum·madNum
      const deltaScaled = (delta * DISPLAY_UNITS) / median.den;
      const left = deltaScaled * madRational.den * multiplier.den;
      const right = madRational.num * multiplier.num;
      if (left > right) {
        const deviation = (deltaScaled * madRational.den) / madRational.num;
        const thresholdScaled =
          (median.num * DISPLAY_UNITS) / median.den +
          (madRational.num * multiplier.num * DISPLAY_UNITS) / (madRational.den * multiplier.den);
        marks.push({
          date: item.date,
          amountMinor: item.amount.toString(),
          deviationScaled: deviation.toString(),
          thresholdScaledMinor: thresholdScaled.toString(),
          rank: marks.length + 1,
        });
      }
    }
  } else {
    method = "iqr";
    const q1 = medianOfHalves(sorted, true);
    const q3 = medianOfHalves(sorted, false);
    const iqrNum = q3.num * q1.den - q1.num * q3.den;
    const iqrDen = q3.den * q1.den;
    const iqr: Rational = { num: iqrNum, den: iqrDen };
    const multiplier = rationalFromDecimal(iqrMultiplier);
    if (isPositiveRational(iqr)) {
      for (const item of ranked) {
        const delta = item.amount * q3.den - q3.num;
        if (delta <= 0n) continue;
        const left = delta * iqr.den * multiplier.den;
        const right = iqr.num * q3.den * multiplier.num;
        if (left > right) {
          const deviation = (delta * iqr.den * DISPLAY_UNITS) / (q3.den * iqr.num);
          const thresholdNumerator =
            q3.num * iqr.den * multiplier.den + iqr.num * multiplier.num * q3.den;
          const thresholdDenominator = q3.den * iqr.den * multiplier.den;
          marks.push({
            date: item.date,
            amountMinor: item.amount.toString(),
            deviationScaled: deviation.toString(),
            thresholdScaledMinor: ((thresholdNumerator * DISPLAY_UNITS) / thresholdDenominator).toString(),
            rank: marks.length + 1,
          });
        }
      }
    } else {
      method = "zero-dispersion-quantile";
      const quantileIndex = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
      const threshold = sorted[quantileIndex]!;
      const quantileThreshold = threshold > 0n ? threshold : 0n;
      for (const item of ranked) {
        if (item.amount <= 0n || item.amount <= quantileThreshold) continue;
        const deviation = ((item.amount - quantileThreshold) * DISPLAY_UNITS) / 1n;
        marks.push({
          date: item.date,
          amountMinor: item.amount.toString(),
          deviationScaled: deviation.toString(),
          thresholdScaledMinor: (quantileThreshold * DISPLAY_UNITS).toString(),
          rank: marks.length + 1,
        });
      }
    }
  }

  return {
    ...baseResult,
    method,
    parameters: { ...parameters, method },
    baseline,
    marks,
    sampleDays: amounts.length,
    sufficientSample: true,
  };
}

/** 供 UI/测试使用的阈值引用（不要在这里做金额格式化）。 */
export function anomalyThresholdReference(result: AnomalyResult): {
  readonly method: AnomalyMethod;
  readonly multiplier: string;
} {
  return {
    method: result.method,
    multiplier: result.method === "mad" ? result.parameters.madMultiplier : result.method === "iqr" ? result.parameters.iqrMultiplier : result.parameters.quantile,
  };
}


