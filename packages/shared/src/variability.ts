import type { TimeSpan } from "./timeCalendar.js";
import type { TimeSeriesBucketPoint } from "./timeSeries.js";
import { ANALYSIS_METHOD } from "./analysisMethod.js";

/**
 * **波动性与稳定性（B-4，A12 + A20）**——对已算好的金额序列做精确统计。
 *
 * 这一层不重新聚合账本：调用方把每日（A12）或每月（A20）序列算好传进来。
 * 统计口径（规格 §24 §29）用**整数分**做精确算术，不以浮点近似权威值：
 *
 *  * 均值 = 总额 / 有效天数（精确分数，保留分子/分母）；
 *  * 总体标准差用恒等式 `N·Σx² − (Σx)²` 计算，避免浮点累计误差；
 *  * 标准差、变异系数、波动带的展示值是**向下取整**的定点小数（默认 6 位）；
 *  * **未知/未来/未结束的桶不参与统计**，不是 0；排除数量如实输出。
 *
 * “波动大”本身不是好坏判断，UI 文案由调用方决定（规格 §24 文案要求）。
 */

export const VARIABILITY_VERSION = "s17-b-variability-v1" as const;

export type VariabilityMetric = "expense" | "income";

export interface VariabilityOptions {
  /** 有效样本数下限；不足时 `sufficientSample = false`（统计值仍给出）。默认 7。 */
  readonly minSampleDays?: number;
  /** 展示定点小数位数，默认 6。 */
  readonly scale?: number;
  /**
   * A12 极端日阈值（偏离均值多少个总体标准差），默认 2（B-16，待所有者确认）。
   * 只影响 `extremeDays` 的判定，不影响均值/标准差/波动带。非正数或非有限值抛 `RangeError`。
   */
  readonly extremeSigma?: number;
}

/**
 * S-01 v2 冻结的精确有理数（进程内 `bigint`；跨 HTTP 序列化为十进制字符串）。
 * 与 A 的 `Ratio` 同构，B 不依赖 A 的实现基线。
 */
export interface Ratio {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/**
 * S-01 v2 冻结的标准差表示：`radicand` 是精确 σ²（权威值），`decimalText` 是
 * **只做一次**“√ 后按固定小数位 half-away”的派生展示值（不得回写/参与校验）。
 */
export interface SqrtValue {
  readonly radicand: Ratio;
  readonly decimalText: string;
  readonly decimals: number;
}

/** S-01 v2 冻结的变异系数表示（无量纲；`scale` 决定展示形态）。 */
export interface CoefficientsOfVariation {
  readonly standardDeviation: SqrtValue;
  readonly mean: Ratio;
  readonly scale: "fraction" | "percent-100";
  readonly decimalText: string;
}

/** 方差口径：B 的统计默认总体口径（样本口径仅在显式要求时提供，当前未实现）。 */
export type VarianceKind = "population" | "sample";

/** A12/A20 共用的金额统计摘要。 */
export interface AmountSummary {
  readonly metric: VariabilityMetric;
  /** 参与统计的有效桶数（完整日/完整月）。 */
  readonly observedCount: number;
  readonly excludedUnknownCount: number;
  readonly excludedInProgressCount: number;
  readonly excludedFutureCount: number;
  /** 总额（分，字符串）。 */
  readonly sumMinor: string;
  readonly minMinor: string;
  readonly maxMinor: string;
  readonly rangeMinor: string;
  /** 精确均值 = numeratorMinor / denominatorCount（分）。 */
  readonly mean: { readonly numeratorMinor: string; readonly denominatorCount: number };
  /** 精确均值（S-01 v2 `Ratio` 形态；与 `mean` 同口径、同值）。 */
  readonly meanRatio: Ratio;
  readonly meanScaledMinor: string;
  /** 方差口径：B 统计默认总体口径。 */
  readonly varianceKind: VarianceKind;
  /** 总体标准差（S-01 v2 `SqrtValue`；`decimalText` 为 6 位定点，展示层再按币种小数位一次舍入）。 */
  readonly standardDeviation: SqrtValue;
  /** 变异系数（S-01 v2 `CoefficientsOfVariation`；均值为 0 时为 `null`，不补 0）。 */
  readonly coefficientOfVariation: CoefficientsOfVariation | null;
  /** 总体标准差（定点小数，向下取整）。 */
  readonly stdDevScaledMinor: string;
  /** 变异系数 = 标准差 / 均值（定点小数，向下取整）；均值为 0 时为 `null`。 */
  readonly coefficientOfVariationScaled: string | null;
  readonly cvUnavailableReason: "mean-zero" | null;
  /** 均值 ± 标准差（定点小数，向下取整；负值保留负号）。 */
  readonly band: {
    readonly lowerScaledMinor: string;
    readonly upperScaledMinor: string;
    readonly scale: number;
  };
  /** 有效样本是否达到下限。 */
  readonly sufficientSample: boolean;
  /** 参与统计的桶跨越的日期范围（含两端）。 */
  readonly sampleRange: TimeSpan;
  /** 公式标识，便于结果自解释（规格 §34.4 不得把不透明推算当权威）。 */
  readonly formula: {
    readonly mean: "exact-mean-v1";
    readonly stdDev: "population-standard-deviation-v1";
    readonly coefficientOfVariation: "coefficient-of-variation-v1";
  };
}

/** A12 每日支出波动性。 */
export interface DailyExpenseVariability extends AmountSummary {
  readonly version: typeof VARIABILITY_VERSION;
  /** 偏离均值超过 `extremeSigma` 个总体标准差的完整日（规格 §24 “最大/最小是否极端”）。 */
  readonly extremeDays: readonly { readonly date: string; readonly amountMinor: string }[];
  /** 实际采用的阈值（σ 的定点整数，`EXTREME_SIGMA_SCALE` = 1000，如默认 2σ → 2000）。 */
  readonly extremeSigmaScaled: number;
  /** 极端日判定公式标识，保证结果可自解释（B-16 口径，待所有者确认）。 */
  readonly extremeThresholdFormula: "abs-deviation-gt-sigma-multiple-v1";
  readonly sampleRange: TimeSpan;
}

/** A20 收入稳定性。 */
export interface IncomeStability extends AmountSummary {
  readonly version: typeof VARIABILITY_VERSION;
  /** 零收入月数（完整月且金额为 0）。 */
  readonly zeroMonths: number;
  readonly positiveMonths: number;
  /** 判定状态：样本足够才给稳定性描述，否则明确“样本不足”。 */
  readonly judgedState: "computed" | "insufficient-sample";
  readonly minimumSampleMonths: number;
}

const DEFAULT_SCALE = 6;
const DEFAULT_MIN_SAMPLE_DAYS = 7;
const DEFAULT_MIN_SAMPLE_MONTHS = 3;

/**
 * A12 极端日阈值默认值：2σ（B-16，待所有者确认；规格 §24 “最大/最小是否极端”）。
 * **只在此处定义一次**，`extremeDays` 判定与 UI 说明都必须引用本常量/结果字段，不得在多处硬编码。
 */
export const DEFAULT_EXTREME_SIGMA = 2;

/** 阈值的定点放大倍数：使 1.5σ、2.5σ 这类非整数阈值也可走整数精确比较。 */
export const EXTREME_SIGMA_SCALE = 1_000;

/**
 * 把调用方传入的 σ 阈值解析为定点整数；非法值抛 `RangeError`（不静默回退，避免“看起来是默认值”）。
 */
function resolveExtremeSigma(value: number | undefined): number {
  const sigma = value ?? DEFAULT_EXTREME_SIGMA;
  if (!Number.isFinite(sigma) || sigma <= 0) {
    throw new RangeError("extremeSigma must be a positive finite number");
  }
  const scaled = Math.round(sigma * EXTREME_SIGMA_SCALE);
  if (scaled <= 0) {
    throw new RangeError("extremeSigma is too small to represent");
  }
  return scaled;
}

/** 整数平方根（向下取整），用于大整数精确开方。 */
function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new RangeError("cannot take the square root of a negative number");
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

/** 最大公约数（用于把精确分数约分）。 */
function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

/** 把精确分数约分为 S-01 v2 `Ratio`（分母恒正、互素）。 */
function reduceRatio(numerator: bigint, denominator: bigint): Ratio {
  if (denominator === 0n) throw new RangeError("ratio denominator must not be zero");
  const sign = denominator < 0n ? -1n : 1n;
  const signedNumerator = numerator * sign;
  const signedDenominator = denominator * sign;
  const divisor = gcd(signedNumerator, signedDenominator);
  return {
    numerator: signedNumerator / divisor,
    denominator: signedDenominator / divisor,
  };
}

/** 把定点整数格式化为固定小数位的十进制文本（不含单位、不做货币舍入）。 */
function formatScaledDecimal(scaled: bigint, decimals: number): string {
  const units = 10n ** BigInt(decimals);
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / units;
  const fraction = absolute % units;
  const text =
    decimals === 0
      ? whole.toString()
      : `${whole.toString()}.${fraction.toString().padStart(decimals, "0")}`;
  return negative ? `-${text}` : text;
}

/**
 * 计算 `round_half_away(multiplier · √numerator / divisor × 10^decimals)` 的定点整数。
 *
 * 用于 S-01 v2 的 `SqrtValue.decimalText` / CV 展示文本：**只做一次** half-away
 * （不是向下取整）；`radicand` 始终保留精确值。
 */
function roundedSqrtScaled(
  numerator: bigint,
  multiplier: bigint,
  divisor: bigint,
  decimals: number,
): bigint {
  if (numerator < 0n) throw new RangeError("cannot take the square root of a negative number");
  if (divisor <= 0n) throw new RangeError("sqrt divisor must be positive");
  const scaledUnits = 10n ** BigInt(decimals);
  // value × 10^decimals = √(multiplier² · numerator · 10^(2·decimals)) / divisor
  const scaledNumerator = multiplier * multiplier * numerator * scaledUnits * scaledUnits;
  const denominator = divisor * divisor;
  const floor = integerSqrt(scaledNumerator / denominator);
  const twicePlusOne = 2n * floor + 1n;
  if (twicePlusOne * twicePlusOne * denominator <= 4n * scaledNumerator) {
    return floor + 1n;
  }
  return floor;
}

interface AmountSample {
  readonly amounts: readonly { readonly key: string; readonly amountMinor: bigint }[];
  readonly excludedUnknownCount: number;
  readonly excludedInProgressCount: number;
  readonly excludedFutureCount: number;
}

function collectSamples(points: readonly TimeSeriesBucketPoint[]): AmountSample {
  const amounts: { key: string; amountMinor: bigint }[] = [];
  let excludedUnknownCount = 0;
  let excludedInProgressCount = 0;
  let excludedFutureCount = 0;
  for (const point of points) {
    switch (point.bucket.state) {
      case "complete":
        if (point.amountMinor !== null) {
          amounts.push({ key: point.bucket.key, amountMinor: BigInt(point.amountMinor) });
        } else {
          excludedUnknownCount += 1;
        }
        break;
      case "in-progress":
        excludedInProgressCount += 1;
        break;
      case "future":
        excludedFutureCount += 1;
        break;
      case "unknown":
      case "unavailable":
        excludedUnknownCount += 1;
        break;
    }
  }
  return { amounts, excludedUnknownCount, excludedInProgressCount, excludedFutureCount };
}

function scaledFloorDivide(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  return negative ? -quotient : quotient;
}

function summarize(
  points: readonly TimeSeriesBucketPoint[],
  sample: AmountSample,
  metric: VariabilityMetric,
  options: VariabilityOptions,
): AmountSummary {
  if (sample.amounts.length === 0) {
    throw new RangeError("variability needs at least one complete observation");
  }
  const scale = options.scale ?? DEFAULT_SCALE;
  const minSample = options.minSampleDays ?? DEFAULT_MIN_SAMPLE_DAYS;
  const amounts = sample.amounts;
  const count = BigInt(amounts.length);
  const sum = amounts.reduce((total, item) => total + item.amountMinor, 0n);
  const sumOfSquares = amounts.reduce((total, item) => total + item.amountMinor * item.amountMinor, 0n);
  let min = amounts[0]!.amountMinor;
  let max = amounts[0]!.amountMinor;
  for (const item of amounts) {
    if (item.amountMinor < min) min = item.amountMinor;
    if (item.amountMinor > max) max = item.amountMinor;
  }
  const scaledUnits = 10n ** BigInt(scale);
  const meanScaled = (sum * scaledUnits) / count;
  const varianceNumerator = count * sumOfSquares - sum * sum;
  const stdDevScaled = integerSqrt(varianceNumerator * scaledUnits * scaledUnits) / count;
  const cvScaled = sum > 0n ? integerSqrt(varianceNumerator * scaledUnits * scaledUnits) / sum : null;
  // S-01 v2 §16.6：σ/CV 以“精确 radicand + 一次 half-away 的展示文本”表示。
  const meanRatio = reduceRatio(sum, count);
  const varianceRatio = reduceRatio(varianceNumerator, count * count);
  const deviationDecimals = 6;
  const standardDeviation: SqrtValue = {
    radicand: varianceRatio,
    decimalText: formatScaledDecimal(
      roundedSqrtScaled(varianceNumerator, 1n, count, deviationDecimals),
      deviationDecimals,
    ),
    decimals: deviationDecimals,
  };
  const coefficientOfVariation: CoefficientsOfVariation | null =
    sum > 0n
      ? {
          standardDeviation,
          mean: meanRatio,
          scale: "percent-100",
          decimalText: formatScaledDecimal(
            roundedSqrtScaled(varianceNumerator, 100n, sum, 1),
            1,
          ),
        }
      : null;
  const sampleRange: TimeSpan = {
    start: points[0]?.bucket.span.start ?? "",
    end: points[points.length - 1]?.bucket.span.end ?? "",
  };
  return {
    metric,
    observedCount: amounts.length,
    excludedUnknownCount: sample.excludedUnknownCount,
    excludedInProgressCount: sample.excludedInProgressCount,
    excludedFutureCount: sample.excludedFutureCount,
    sumMinor: sum.toString(),
    minMinor: min.toString(),
    maxMinor: max.toString(),
    rangeMinor: (max - min).toString(),
    mean: { numeratorMinor: sum.toString(), denominatorCount: amounts.length },
    meanRatio,
    meanScaledMinor: meanScaled.toString(),
    varianceKind: "population",
    standardDeviation,
    coefficientOfVariation,
    stdDevScaledMinor: stdDevScaled.toString(),
    coefficientOfVariationScaled: cvScaled === null ? null : cvScaled.toString(),
    cvUnavailableReason: cvScaled === null ? "mean-zero" : null,
    band: {
      lowerScaledMinor: scaledFloorDivide(meanScaled * count - stdDevScaled * count, count).toString(),
      upperScaledMinor: scaledFloorDivide(meanScaled * count + stdDevScaled * count, count).toString(),
      scale,
    },
    sufficientSample: amounts.length >= minSample,
    sampleRange,
    formula: {
      mean: ANALYSIS_METHOD.exactMean,
      stdDev: ANALYSIS_METHOD.populationStandardDeviation,
      coefficientOfVariation: ANALYSIS_METHOD.coefficientOfVariation,
    },
  };
}

/**
 * A12 每日支出波动性：在每日支出序列上给出均值、总体标准差、变异系数、
 * 极值与“极端日”的精确判定。末尾未结束的今天与未来日不参与统计。
 */
export function computeDailyExpenseVariability(
  daily: readonly TimeSeriesBucketPoint[],
  options: VariabilityOptions = {},
): DailyExpenseVariability {
  if (daily.length === 0) {
    throw new RangeError("daily series must not be empty");
  }
  const sample = collectSamples(daily);
  const summary = summarize(daily, sample, "expense", options);
  const count = BigInt(sample.amounts.length);
  const sum = BigInt(summary.sumMinor);
  const sumOfSquares = sample.amounts.reduce((total, item) => total + item.amountMinor * item.amountMinor, 0n);
  // |x − mean| > k·σ ⇔ delta²·S² > (k·S)²·(N·Σx² − (Σx)²)：两侧均为非负整数，可精确比较（S = EXTREME_SIGMA_SCALE）。
  const varianceNumerator = count * sumOfSquares - sum * sum;
  const extremeSigmaScaled = resolveExtremeSigma(options.extremeSigma);
  const sigmaScaledSquared = BigInt(extremeSigmaScaled) * BigInt(extremeSigmaScaled);
  const scaleSquared = BigInt(EXTREME_SIGMA_SCALE) * BigInt(EXTREME_SIGMA_SCALE);
  const extremeDays: { date: string; amountMinor: string }[] = [];
  for (const item of sample.amounts) {
    const delta = count * item.amountMinor - sum;
    if (delta * delta * scaleSquared > sigmaScaledSquared * varianceNumerator) {
      extremeDays.push({ date: item.key, amountMinor: item.amountMinor.toString() });
    }
  }
  return {
    ...summary,
    version: VARIABILITY_VERSION,
    extremeDays,
    extremeSigmaScaled,
    extremeThresholdFormula: ANALYSIS_METHOD.extremeThreshold,
  };
}

/**
 * A20 收入稳定性：在**完整自然月**收入序列上给均值/标准差/变异系数与零收入月。
 * 样本不足（默认 < 3 个完整月）时 `judgedState = "insufficient-sample"`，
 * 但统计值仍如实给出，不编造稳定性结论。
 */
export function computeIncomeStability(
  monthly: readonly TimeSeriesBucketPoint[],
  options: VariabilityOptions & { readonly minSampleMonths?: number } = {},
): IncomeStability {
  if (monthly.length === 0) {
    throw new RangeError("monthly series must not be empty");
  }
  const sample = collectSamples(monthly);
  const summary = summarize(monthly, sample, "income", options);
  const minMonths = options.minSampleMonths ?? DEFAULT_MIN_SAMPLE_MONTHS;
  const zeroMonths = sample.amounts.filter((item) => item.amountMinor === 0n).length;
  return {
    ...summary,
    version: VARIABILITY_VERSION,
    zeroMonths,
    positiveMonths: sample.amounts.length - zeroMonths,
    judgedState: sample.amounts.length >= minMonths ? "computed" : "insufficient-sample",
    minimumSampleMonths: minMonths,
  };
}
