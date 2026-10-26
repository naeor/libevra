/**
 * 精确有理数运算（C-1 草案）。
 *
 * 为什么不用 number：分位插值会产生「小数分位」，方差是分数，比例是分数。
 * 用 IEEE 浮点做这些运算会让「同一数据、同一算法、不同批次」出现末位漂移，
 * 而 C 的结果要能回到同一批来源账目、并在任何尺寸下金额一致。
 *
 * 约定：
 * - `denominator` 恒为正（负号只出现在 `numerator`）；
 * - 所有运算结果都约分到最简；
 * - 显示走 `rationalToDecimalText` / `roundRationalToMinor`，舍入政策
 *   `minor-half-away-v1`（与 S-01 一致）。
 */

import type { DraftRational } from "./draftTypes.js";

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** 非负最大公约数；`gcdBigInt(0n, 0n)` 返回 0n（调用方不应把 0/0 造成有理数）。 */
export function gcdBigInt(a: bigint, b: bigint): bigint {
  let x = absBigInt(a);
  let y = absBigInt(b);

  while (y !== 0n) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }

  return x;
}

/**
 * 构造最简有理数。
 *
 * @throws {RangeError} 分母为 0，或 numerator/denominator 任一为 NaN 语义的非法值。
 */
export function makeRational(numerator: bigint, denominator: bigint): DraftRational {
  if (denominator === 0n) {
    throw new RangeError("Rational denominator must not be zero");
  }

  // 负号统一挪到分子，分母保持为正。
  const sign = denominator < 0n ? -1n : 1n;
  const signedNumerator = numerator * sign;
  const absoluteDenominator = absBigInt(denominator);
  const divisor = gcdBigInt(signedNumerator, absoluteDenominator) || 1n;

  return {
    numerator: signedNumerator / divisor,
    denominator: absoluteDenominator / divisor,
  };
}

export const RATIONAL_ZERO: DraftRational = Object.freeze({ numerator: 0n, denominator: 1n });
export const RATIONAL_ONE: DraftRational = Object.freeze({ numerator: 1n, denominator: 1n });

export function rationalFromBigInt(value: bigint): DraftRational {
  return { numerator: value, denominator: 1n };
}

export function isZeroRational(value: DraftRational): boolean {
  return value.numerator === 0n;
}

export function negateRational(value: DraftRational): DraftRational {
  return { numerator: -value.numerator, denominator: value.denominator };
}

export function addRational(a: DraftRational, b: DraftRational): DraftRational {
  return makeRational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

export function subRational(a: DraftRational, b: DraftRational): DraftRational {
  return addRational(a, negateRational(b));
}

export function mulRational(a: DraftRational, b: DraftRational): DraftRational {
  return makeRational(a.numerator * b.numerator, a.denominator * b.denominator);
}

/** @throws {RangeError} 除数为 0。 */
export function divRational(a: DraftRational, b: DraftRational): DraftRational {
  if (b.numerator === 0n) {
    throw new RangeError("Cannot divide by a zero rational");
  }

  return makeRational(a.numerator * b.denominator, a.denominator * b.numerator);
}

/** 比较：a<b 返回 -1，a=b 返回 0，a>b 返回 1。 */
export function compareRational(a: DraftRational, b: DraftRational): -1 | 0 | 1 {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;

  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** 整数幂：`powerOfTen(3n)` 为 1000n。 */
export function powerOfTen(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new RangeError(`powerOfTen expects a non-negative integer, received: ${String(exponent)}`);
  }

  return 10n ** BigInt(exponent);
}

/**
 * 按 `minor-half-away-v1` 把有理数舍入到整数最小单位。
 *
 * 例：5/2 → 3，-5/2 → -3，7/3 → 2（0.333 向下），8/3 → 3（0.667 向上）。
 */
export function roundRationalToMinor(value: DraftRational): bigint {
  if (value.denominator === 1n) return value.numerator;

  const negative = value.numerator < 0n;
  const absoluteNumerator = absBigInt(value.numerator);
  const rounded = (absoluteNumerator + value.denominator / 2n) / value.denominator;

  return negative ? -rounded : rounded;
}

/**
 * 转成固定小数位的十进制文本（不要用于权威计算，只用于展示）。
 *
 * `decimals` 为 0 时不带小数点。舍入同样是 half-away-from-zero。
 */
export function rationalToDecimalText(value: DraftRational, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer, received: ${String(decimals)}`);
  }

  const negative = value.numerator < 0n;
  const absoluteNumerator = absBigInt(value.numerator);
  const scale = powerOfTen(decimals);
  const scaled = (absoluteNumerator * scale + value.denominator / 2n) / value.denominator;

  const sign = negative ? "-" : "";
  if (decimals === 0) return `${sign}${scaled.toString()}`;

  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(decimals, "0");

  return `${sign}${whole.toString()}.${fraction}`;
}

/**
 * 以 number 近似（仅允许展示/绘图坐标使用）。
 *
 * 权威金额、比例、分位一律走有理数；这里显式标注为 `toNumberForDisplay`，
 * 代码评审时一眼能看出它不参与财务计算。
 */
export function toNumberForDisplay(value: DraftRational): number {
  return Number(value.numerator) / Number(value.denominator);
}
