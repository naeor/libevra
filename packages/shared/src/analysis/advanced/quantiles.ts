/**
 * 分位数（C-1 草案，Type 7 插值）。
 *
 * 取 Type 7（Excel / R 默认）：h = 1 + (n-1)p，第 h 个次序统计量线性插值。
 * 选它的理由：与 A 的 `medianMinor` 口径一致（A 已在 `primitives.ts` 用「中间两项
 * 平均」实现中位数，等价于 Type 7 在 p=0.5、n 为任意值时的结果），也与「无偏、
 * 对任意 p 连续」的展示需求一致。S-01 v2 评审时须与 A 统一确认（QC 已登记）。
 *
 * 若样本量 < 3：p25/p75 退化为 min/max（显式随摘要给出，不隐藏小样本）。
 */

import type { DraftQuantile, DraftRational } from "./draftTypes.js";
import {
  addRational,
  mulRational,
  rationalFromBigInt,
  RATIONAL_ONE,
  RATIONAL_ZERO,
  subRational,
} from "./rational.js";

/** 把样本升序排序（不修改入参）。 */
export function sortMinorAscending(values: readonly bigint[]): bigint[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** Type 7 的连续位置 h = 1 + (n-1)p（返回有理数，1-based）。 */
export function type7Position(sampleCount: number, p: DraftRational): DraftRational {
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError(`sampleCount must be a positive integer, received: ${String(sampleCount)}`);
  }
  if (p.numerator < 0n || p.numerator > p.denominator) {
    throw new RangeError("quantile probability p must be between 0 and 1");
  }

  const nMinusOne = rationalFromBigInt(BigInt(sampleCount - 1));
  return addRational(RATIONAL_ONE, mulRational(nMinusOne, p));
}

/**
 * 计算升序样本的 p 分位（Type 7 线性插值）。
 *
 * @param sortedMinor 已升序的样本（调用方负责排序；本函数再校验一次顺序）。
 * @throws {RangeError} p 越界或 sortedMinor 未升序。
 */
export function quantileOfSorted(
  sortedMinor: readonly bigint[],
  p: DraftRational,
): DraftRational | null {
  assertSorted(sortedMinor);

  if (sortedMinor.length === 0) return null;
  if (sortedMinor.length === 1) return rationalFromBigInt(sortedMinor[0] as bigint);

  const position = type7Position(sortedMinor.length, p);

  // h 的有理数形式：position = hNum/hDen（numerator/denominator 均 > 0）；
  // floor(h) 即 hNum / hDen（bigint 整除，正数向下取整）。
  const oneBasedLower = position.numerator / position.denominator;
  const lowerIndexOneBased =
    oneBasedLower < 1n
      ? 1n
      : oneBasedLower > BigInt(sortedMinor.length)
        ? BigInt(sortedMinor.length)
        : oneBasedLower;
  const upperIndexOneBased =
    lowerIndexOneBased >= BigInt(sortedMinor.length) ? lowerIndexOneBased : lowerIndexOneBased + 1n;

  const lowerValue = sortedMinor[Number(lowerIndexOneBased) - 1] as bigint;
  const upperValue = sortedMinor[Number(upperIndexOneBased) - 1] as bigint;

  if (lowerValue === upperValue) return rationalFromBigInt(lowerValue);

  // h = lowerIndexOneBased + weight，weight = h - floor(h)。
  const floorValue = rationalFromBigInt(lowerIndexOneBased);
  const weight = subRational(position, floorValue);

  const interpolated = addRational(
    rationalFromBigInt(lowerValue),
    mulRational(subRational(rationalFromBigInt(upperValue), rationalFromBigInt(lowerValue)), weight),
  );

  return interpolated;
}

/** 中位数（等价于 Type 7 在 p=0.5）；空样本返回 null。 */
export function medianOf(values: readonly bigint[]): DraftRational | null {
  const sorted = sortMinorAscending(values);
  return quantileOfSorted(sorted, { numerator: 1n, denominator: 2n });
}

/** 一次性求多个分位；返回顺序与入参一致；空样本返回空数组。 */
export function quantilesOf(
  values: readonly bigint[],
  probabilities: readonly DraftRational[],
): readonly DraftQuantile[] {
  const sorted = sortMinorAscending(values);

  return probabilities.map((p) => {
    const valueMinor = quantileOfSorted(sorted, p);
    if (valueMinor === null) {
      throw new RangeError("quantilesOf requires at least one sample");
    }

    return { p, valueMinor };
  });
}

/** 常用分位点：p25 / p50 / p75（四分位）。 */
export function quartileProbabilities(): readonly DraftRational[] {
  return [
    { numerator: 1n, denominator: 4n },
    { numerator: 1n, denominator: 2n },
    { numerator: 3n, denominator: 4n },
  ];
}

/** 四分位距 IQR = q3 - q1；样本 < 2 时为 0（数学上无离散度可算）。 */
export function iqrOf(values: readonly bigint[]): DraftRational | null {
  if (values.length === 0) return null;

  const sorted = sortMinorAscending(values);
  const q1 = quantileOfSorted(sorted, { numerator: 1n, denominator: 4n });
  const q3 = quantileOfSorted(sorted, { numerator: 3n, denominator: 4n });

  if (q1 === null || q3 === null) return RATIONAL_ZERO;
  return subRational(q3, q1);
}

function assertSorted(values: readonly bigint[]): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1] as bigint;
    const current = values[index] as bigint;
    if (current < previous) {
      throw new RangeError("quantileOfSorted expects an ascending array");
    }
  }
}
