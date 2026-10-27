/**
 * 分布函数（C-1 草案）：总体方差 / 标准差 / 变异系数 / 直方图 / 箱线围栏。
 *
 * 口径（与 owner 规格 §5 一致，须在 S-01 v2 与 A 统一）：
 * - **描述性总体方差**：分母 n，不是 n-1（这是「这一批流水」的完整数据，不是抽样）。
 * - 标准差用定点小数返回（默认 6 位），不返回 number 作为权威值。
 * - 直方图分箱**守恒**：Σ bins.count = 有效样本数，且 0 金额单列 zeroCount。
 * - 直方图「最后一个箱含上界」，与常见的 `[a,b)` 约定配套，便于展示。
 * - 异常值用 1.5×IQR 围栏；围栏本身用有理数表示，不先舍入再比较。
 */

import type {
  DraftDistributionSummary,
  DraftHistogram,
  DraftHistogramBin,
  DraftRational,
  DraftScaledDecimal,
} from "./draftTypes.js";
import {
  addRational,
  compareRational,
  makeRational,
  mulRational,
  RATIONAL_ZERO,
  subRational,
} from "./rational.js";
import { iqrOf, medianOf, quantilesOf, quartileProbabilities, sortMinorAscending } from "./quantiles.js";

/** 向下取整除法（处理负数；`floorDiv(-1n, 5n) = -1n`）。 */
export function floorDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError("floorDiv requires a positive denominator");
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  return remainder !== 0n && numerator < 0n ? quotient - 1n : quotient;
}

/** 整数平方根（牛顿迭代，返回 floor(sqrt(n))；n ≥ 0）。 */
export function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new RangeError("integerSqrt requires a non-negative value");
  if (value < 2n) return value;

  let current = value;
  let next = (current + 1n) / 2n;

  while (next < current) {
    current = next;
    next = (current + value / current) / 2n;
  }

  return current;
}

/**
 * 描述性总体方差（分母 n）。
 *
 * 用 Σ(x-μ)² 的整数恒等式：var = (n·Σx² - (Σx)²) / n²，全程 bigint，无浮点。
 *
 * @returns 空样本为 null；单样本为 0。
 */
export function populationVariance(values: readonly bigint[]): DraftRational | null {
  const count = values.length;
  if (count === 0) return null;

  const n = BigInt(count);
  let sum = 0n;
  let sumOfSquares = 0n;

  for (const value of values) {
    sum += value;
    sumOfSquares += value * value;
  }

  return makeRational(n * sumOfSquares - sum * sum, n * n);
}

/**
 * 总体标准差的定点小数表示：floor(sqrt(variance) · 10^decimals)。
 *
 * 说明：先算 floor(variance·10^(2·decimals)) 再开方，误差 < 1 个 10^-decimals
 * 单位，只用于展示与图表轴，不用于财务比较。
 */
export function standardDeviationScaled(
  variance: DraftRational | null,
  decimals = 6,
): DraftScaledDecimal | null {
  if (variance === null) return null;
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer, received: ${String(decimals)}`);
  }

  const scale = 10n ** BigInt(decimals);
  const scaledSquare = (variance.numerator * scale * scale) / variance.denominator;

  return { scaled: integerSqrt(scaledSquare), decimals };
}

/** 变异系数 CV = 标准差 / 均值；均值为 0 时为 null（不可计算，不得写 0）。 */
export function coefficientOfVariation(
  mean: DraftRational | null,
  variance: DraftRational | null,
  decimals = 6,
): DraftRational | null {
  if (mean === null || variance === null) return null;
  if (compareRational(mean, RATIONAL_ZERO) === 0) return null;

  const standardDeviation = standardDeviationScaled(variance, decimals);
  if (standardDeviation === null) return null;

  const stdScaled = makeRational(standardDeviation.scaled, 10n ** BigInt(standardDeviation.decimals));

  return makeRational(
    stdScaled.numerator * mean.denominator,
    stdScaled.denominator * mean.numerator,
  );
}

/** 把「最小单位整数」与有理数阈值比较：<0 小于，=0 等于，>0 大于。 */
export function compareMinorToRational(minor: bigint, threshold: DraftRational): -1 | 0 | 1 {
  const left = minor * threshold.denominator;
  const right = threshold.numerator;

  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** 1/2/5×10^k 的「好看」箱宽；range ≤ 0 时返回 1 个最小单位。 */
export function niceBinWidth(range: bigint, targetBins = 12): bigint {
  if (!Number.isInteger(targetBins) || targetBins < 1) {
    throw new RangeError(`targetBins must be a positive integer, received: ${String(targetBins)}`);
  }
  if (range <= 0n) return 1n;

  const rough = (range + BigInt(targetBins) - 1n) / BigInt(targetBins);
  if (rough <= 1n) return 1n;

  const magnitude = 10n ** BigInt(rough.toString().length - 1);
  const normalized = rough / magnitude;
  const step = normalized <= 1n ? 1n : normalized <= 2n ? 2n : normalized <= 5n ? 5n : 10n;

  return step * magnitude;
}

export interface HistogramOptions {
  readonly targetBins?: number;
  /** 超过该箱数时自动加大箱宽（防御异常离群值导致箱数爆炸）。 */
  readonly maxBins?: number;
}

/**
 * 等宽直方图（末箱含上界）。
 *
 * @throws {RangeError} 无样本（调用方应先检查完整性，不要用空直方图冒充 0）。
 */
export function buildHistogram(
  values: readonly bigint[],
  options: HistogramOptions = {},
): DraftHistogram {
  if (values.length === 0) {
    throw new RangeError("buildHistogram requires at least one sample");
  }

  const targetBins = options.targetBins ?? 12;
  const maxBins = options.maxBins ?? 256;

  const sorted = sortMinorAscending(values);
  const minMinor = sorted[0] as bigint;
  const maxMinor = sorted[sorted.length - 1] as bigint;

  let binWidthMinor = niceBinWidth(maxMinor - minMinor, targetBins);
  let start = floorDiv(minMinor, binWidthMinor) * binWidthMinor;
  let binCount = Number(floorDiv(maxMinor - start, binWidthMinor)) + 1;

  while (binCount > maxBins) {
    binWidthMinor *= 2n;
    start = floorDiv(minMinor, binWidthMinor) * binWidthMinor;
    binCount = Number(floorDiv(maxMinor - start, binWidthMinor)) + 1;
  }

  const counts = new Array<number>(binCount).fill(0);

  for (const value of sorted) {
    const index = Number(floorDiv(value - start, binWidthMinor));
    const safeIndex = Math.min(Math.max(index, 0), binCount - 1);
    counts[safeIndex] = (counts[safeIndex] ?? 0) + 1;
  }

  let zeroCount = 0;
  for (const value of sorted) {
    if (value === 0n) zeroCount += 1;
  }

  let runningCount = 0;
  const bins: DraftHistogramBin[] = counts.map((count, index) => {
    runningCount += count;

    return {
      index,
      lowerMinor: start + BigInt(index) * binWidthMinor,
      upperMinor: start + BigInt(index + 1) * binWidthMinor,
      count,
      isLast: index === counts.length - 1,
    };
  });

  if (runningCount !== sorted.length) {
    throw new Error(
      `Histogram bins do not conserve samples: bins=${String(runningCount)}, samples=${String(sorted.length)}`,
    );
  }

  return {
    binWidthMinor,
    bins,
    sampleCount: sorted.length,
    zeroCount,
    minMinor,
    maxMinor,
  };
}

export interface FenceResult {
  readonly q1: DraftRational;
  readonly q3: DraftRational;
  readonly iqr: DraftRational;
  readonly lowerFence: DraftRational;
  readonly upperFence: DraftRational;
  readonly outliers: readonly bigint[];
  readonly withinCount: number;
}

/**
 * 1.5×IQR 围栏与异常值。
 *
 * 围栏用有理数表示并直接与整数比较，不先舍入再比较——否则边际值可能被误判。
 * @throws {RangeError} 空样本。
 */
export function iqrFences(
  values: readonly bigint[],
  multiplier: DraftRational = { numerator: 3n, denominator: 2n },
): FenceResult {
  if (values.length === 0) {
    throw new RangeError("iqrFences requires at least one sample");
  }

  const sorted = sortMinorAscending(values);
  const quartiles = quantilesOf(sorted, quartileProbabilities());
  const q1 = quartiles[0]?.valueMinor ?? RATIONAL_ZERO;
  const q3 = quartiles[2]?.valueMinor ?? RATIONAL_ZERO;
  const iqr = subRational(q3, q1);
  const spread = mulRational(multiplier, iqr);

  const lowerFence = subRational(q1, spread);
  const upperFence = addRational(q3, spread);

  const outliers: bigint[] = [];
  let withinCount = 0;

  for (const value of sorted) {
    const below = compareMinorToRational(value, lowerFence) < 0;
    const above = compareMinorToRational(value, upperFence) > 0;

    if (below || above) {
      outliers.push(value);
    } else {
      withinCount += 1;
    }
  }

  return { q1, q3, iqr, lowerFence, upperFence, outliers, withinCount };
}

export interface DistributionSummaryOptions {
  readonly targetBins?: number;
  readonly standardDeviationDecimals?: number;
  readonly quantileProbabilities?: readonly DraftRational[];
}

/**
 * 一次性摘要：分位 + 分位点 + 总体方差/标准差/CV + IQR + 直方图。
 *
 * 空样本返回 `no-transactions` 且所有数值为 null（不得把缺失当 0）。
 */
export function summariseDistribution(
  values: readonly bigint[],
  options: DistributionSummaryOptions = {},
): DraftDistributionSummary {
  const decimals = options.standardDeviationDecimals ?? 6;
  const probabilities = options.quantileProbabilities ?? quartileProbabilities();

  if (values.length === 0) {
    return {
      sampleCount: 0,
      completeness: "no-transactions",
      minMinor: null,
      maxMinor: null,
      sumMinor: 0n,
      mean: null,
      median: null,
      quantiles: [],
      variance: null,
      standardDeviation: null,
      coefficientOfVariation: null,
      iqr: null,
      histogram: null,
    };
  }

  const sorted = sortMinorAscending(values);
  const sumMinor = sorted.reduce((total, value) => total + value, 0n);
  const mean = makeRational(sumMinor, BigInt(sorted.length));
  const variance = populationVariance(sorted);
  const standardDeviation = standardDeviationScaled(variance, decimals);

  return {
    sampleCount: sorted.length,
    completeness: "complete",
    minMinor: sorted[0] as bigint,
    maxMinor: sorted[sorted.length - 1] as bigint,
    sumMinor,
    mean,
    median: medianOf(sorted),
    quantiles: quantilesOf(sorted, probabilities),
    variance,
    standardDeviation,
    coefficientOfVariation: coefficientOfVariation(mean, variance, decimals),
    iqr: iqrOf(sorted),
    histogram: buildHistogram(sorted, { targetBins: options.targetBins ?? 12 }),
  };
}

/** 直方图守恒自检：样本数 = Σ 箱计数。 */
export function histogramIsConserved(histogram: DraftHistogram): boolean {
  const total = histogram.bins.reduce((sum, bin) => sum + bin.count, 0);
  return total === histogram.sampleCount;
}
