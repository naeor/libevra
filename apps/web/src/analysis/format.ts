/**
 * 展示层文本格式化（C-1 草案，web 侧）。
 *
 * 只做「权威 bigint → 字符串」的排版：不改变数值、不改变舍入政策、不做业务判断。
 * 舍入政策与 shared 一致：`minor-half-away-v1`（四舍五入，远离 0）。
 * 这里的输入一律是 bigint 最小单位或有理数，**不经过 number**。
 */

/** 比率形（与 S-01/DraftRational 结构兼容）。 */
export interface RatioLike {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function powerOfTen(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new RangeError(`powerOfTen expects a non-negative integer, received: ${String(exponent)}`);
  }

  return 10n ** BigInt(exponent);
}

/**
 * 最小单位整数 → 固定小数位金额文本（不分组、不缩略，保证精确值可见）。
 *
 * 例：`formatMinorText(12345n, 2)` → `"123.45"`；`formatMinorText(-5n, 2)` → `"-0.05"`。
 */
export function formatMinorText(minor: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer, received: ${String(decimals)}`);
  }

  const negative = minor < 0n;
  const absolute = abs(minor);
  const scale = powerOfTen(decimals);
  const whole = absolute / scale;
  const fraction = absolute % scale;
  const sign = negative ? "-" : "";

  if (decimals === 0) return `${sign}${whole.toString()}`;

  return `${sign}${whole.toString()}.${fraction.toString().padStart(decimals, "0")}`;
}

/** 带符号金额文本：正数加 `+`，零为 `0.00`（不显示 `+0.00`）。 */
export function formatSignedMinorText(minor: bigint, decimals: number): string {
  if (minor > 0n) return `+${formatMinorText(minor, decimals)}`;
  return formatMinorText(minor, decimals);
}

/** 有理数 → 百分比文本（0..100，默认 1 位小数），四舍五入。 */
export function formatRatioPercent(ratio: RatioLike, decimals = 1): string {
  if (ratio.denominator === 0n) {
    throw new RangeError("formatRatioPercent requires a non-zero denominator");
  }

  const negative = ratio.numerator < 0n !== ratio.denominator < 0n;
  const numerator = abs(ratio.numerator);
  const denominator = abs(ratio.denominator);
  const scale = powerOfTen(decimals);
  const scaled = (numerator * 100n * scale + denominator / 2n) / denominator;
  const whole = scaled / scale;
  const sign = negative ? "-" : "";

  if (decimals === 0) return `${sign}${whole.toString()}%`;

  const fraction = (scaled % scale).toString().padStart(decimals, "0");
  return `${sign}${whole.toString()}.${fraction}%`;
}

/** 有理数 → 四舍五入到整数（minor-half-away-v1；用于把分数金额落回最小单位文本）。 */
export function roundRatioToInteger(ratio: RatioLike): bigint {
  if (ratio.denominator === 0n) {
    throw new RangeError("roundRatioToInteger requires a non-zero denominator");
  }

  const negative = ratio.numerator < 0n !== ratio.denominator < 0n;
  const numerator = abs(ratio.numerator);
  const denominator = abs(ratio.denominator);
  const rounded = (numerator + denominator / 2n) / denominator;

  return negative ? -rounded : rounded;
}

/**
 * 有理数金额（分位插值等可能落在分之间）→ 金额文本。
 *
 * 先按 minor-half-away-v1 舍入到整数最小单位，再按币种小数位排版；
 * 精确的有理数仍保留在结果对象里（本函数只用于显示）。
 */
export function formatRatioMinorText(ratio: RatioLike, decimals: number): string {
  return formatMinorText(roundRatioToInteger(ratio), decimals);
}

/** 有理数 → 展示用 number（仅用于 SVG 坐标/缩放；不得参与财务结论）。 */
export function ratioToDisplayNumber(ratio: RatioLike): number {
  if (ratio.denominator === 0n) return 0;

  return Number(ratio.numerator) / Number(ratio.denominator);
}

/** 定点小数（如标准差）→ 文本；`{scaled: 500000n, decimals: 6}` → `"0.500000"`。 */
export function formatScaledDecimalText(value: { readonly scaled: bigint; readonly decimals: number }): string {
  return formatMinorText(value.scaled, value.decimals);
}

/** 计数 → 本地化千分位文本（纯展示）。 */
export function formatCountText(count: number): string {
  if (!Number.isFinite(count)) return "—";

  return Math.trunc(count).toLocaleString("zh-CN");
}
