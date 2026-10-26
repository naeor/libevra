/**
 * Exact rational arithmetic for analysis results (S-01 draft, 2026-10-27).
 *
 * Every authoritative financial value is an integer in a currency's minor unit.
 * An average, the median of an even sample, a share or a ratio is a division of
 * two such integers — and dividing it in binary floating point is exactly the
 * class of bug the money module exists to prevent.
 *
 * So the calculation layer carries the **exact fraction** and only the display
 * layer rounds it. Rounding happens once, at the end, with the existing
 * `minor-half-away-v1` direction; it never feeds back into an amount.
 *
 * Invariants:
 *  * `denominator > 0n` — a negative fraction carries its sign in the numerator;
 *  * the fraction is reduced (gcd 1);
 *  * a zero denominator is represented by `null`, never by zero. "Cannot be
 *    computed" and "is zero" are different answers (规格 §3.6).
 */

export interface Ratio {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** Euclid's algorithm. `gcd(0, n)` is `n`, so `0 / n` reduces to `0 / 1`. */
function greatestCommonDivisor(a: bigint, b: bigint): bigint {
  let x = absolute(a);
  let y = absolute(b);

  while (y !== 0n) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }

  return x;
}

/**
 * An exact fraction, or `null` when the denominator is zero.
 *
 * Sign normalisation and reduction happen here so that every producer of a
 * `Ratio` compares equal to every other producer of the same value.
 */
export function ratioOf(numerator: bigint, denominator: bigint): Ratio | null {
  if (denominator === 0n) return null;

  const sign = denominator < 0n ? -1n : 1n;
  const signedNumerator = numerator * sign;
  const signedDenominator = denominator * sign;
  const divisor = greatestCommonDivisor(signedNumerator, signedDenominator);

  return {
    numerator: signedNumerator / divisor,
    denominator: signedDenominator / divisor,
  };
}

/** Cross-multiplied comparison, exact and independent of reduction. */
export function compareRatio(left: Ratio, right: Ratio): number {
  const difference =
    left.numerator * right.denominator - right.numerator * left.denominator;

  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}

/**
 * The value as a JavaScript number.
 *
 * **Display and drawing only.** It is allowed to lose precision; the exact
 * fraction above is what a label or a source total must be derived from.
 */
export function ratioToNumber(value: Ratio): number {
  return Number(value.numerator) / Number(value.denominator);
}

function powerOfTen(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new RangeError("exponent");
  }

  return 10n ** BigInt(exponent);
}

/**
 * Round an exact value to a decimal string, half away from zero.
 *
 * `scaled = value × 10^fractionDigits`, rounded once. The magnitude is rounded
 * and the sign re-applied, which is what "half away from zero" means for the
 * existing `minor-half-away-v1` policy; a banker's rounding of an accounting
 * number is a different, unintended answer.
 */
export function ratioToDecimalText(value: Ratio, fractionDigits = 0): string {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
    throw new RangeError("fractionDigits");
  }

  const scale = powerOfTen(fractionDigits);
  const scaled = value.numerator * scale;
  const negative = scaled < 0n;
  const magnitude = absolute(scaled);
  const denominator = value.denominator;

  let quotient = magnitude / denominator;
  const remainder = magnitude % denominator;

  // Round the magnitude up when the discarded part is at least one half.
  if (remainder * 2n >= denominator) quotient += 1n;

  const digits = quotient.toString().padStart(fractionDigits + 1, "0");
  const whole = digits.slice(0, digits.length - fractionDigits);
  const fraction = digits.slice(digits.length - fractionDigits);
  const body = fractionDigits === 0 ? whole : `${whole}.${fraction}`;

  return negative && quotient !== 0n ? `-${body}` : body;
}

/**
 * A percentage label such as `33.3%` or `-12.5%`.
 *
 * Percentages are display values: two parts may be rounded independently and
 * therefore not add up to exactly 100%. That is allowed; changing an amount to
 * make the label add up is not (规格 §20).
 */
export function ratioToPercentText(value: Ratio, fractionDigits = 1): string {
  const percent = ratioOf(value.numerator * 100n, value.denominator);

  // `ratioOf` cannot return null here: the denominator is non-zero by invariant.
  if (percent === null) throw new Error("ratio_invalid");

  return `${ratioToDecimalText(percent, fractionDigits)}%`;
}

/**
 * A minor-unit integer as a decimal string in its currency's scale.
 *
 * `formatMinor` in `money.ts` works on `number` and refuses unsafe integers;
 * analysis sums are `bigint` (a year of large entries can legitimately exceed
 * `Number.MAX_SAFE_INTEGER` in the minor unit — 规格 §21.1 样本 G), so this
 * counterpart is exact for any size.
 */
export function formatMinorExact(minor: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError("decimals");
  }

  const negative = minor < 0n;
  const magnitude = absolute(minor);
  const scale = powerOfTen(decimals);
  const whole = magnitude / scale;
  const fraction = magnitude % scale;

  if (decimals === 0) return `${negative ? "-" : ""}${whole.toString()}`;

  return `${negative ? "-" : ""}${whole.toString()}.${fraction
    .toString()
    .padStart(decimals, "0")}`;
}
