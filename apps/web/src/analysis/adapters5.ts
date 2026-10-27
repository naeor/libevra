/**
 * 结果 → 图表输入适配器（C-4，web 侧，DRAFT）：P16–P20 汇率诊断。
 *
 * 与 C-1/C-2/C-3 相同的边界：
 * - 输入是 shared 草案结果（结构镜像见 `sharedTypes.ts`），输出是 `types.ts` 的图表输入；
 * - 只做取字段、格式化文本、把 bigint 比例换成「仅用于坐标」的 number；
 * - **不做汇率/折算/完整性/占比的重算**：需要新统计量应回 shared 加权威函数；
 * - 缺汇率、缺观测、无折算需求都必须显式给出 `available=false` 或提示文本，
 *   不得把缺失当 0，也不得让图表暗示「完整」。
 *
 * 这些输入未冻结（QC-12 / QC-29），等 S-01 v2 冻结后改为正式协议的映射。
 */

import { decimalsFor } from "@libellum/shared";
import type { AdapterOptions } from "./adapters.js";
import {
  formatCountText,
  formatMinorText,
  formatRatioPercent,
  formatScaledDecimalText,
  ratioToDisplayNumber,
} from "./format.js";
import type {
  ChartSource,
  CurrencyCompositionInput,
  CurrencyCompositionRowDatum,
  FxContributionChartInput,
  FxContributionRowDatum,
  FxCoverageCellDatum,
  FxCoverageMatrixInput,
  FxCoverageRowDatum,
  FxFallbackBarDatum,
  FxFallbackDistributionDatum,
  FxFallbackUsageInput,
  FxRateTrendInput,
  FxRateTrendPointDatum,
} from "./types.js";
import type {
  RatioLike,
  SharedCurrencyCompositionResult,
  SharedFxContributionResult,
  SharedFxCoverageResult,
  SharedFxFallbackResult,
  SharedFxRateTrendResult,
} from "./sharedTypes.js";

/** 计算依据文案：渲染层必须原样显示，不得省略（owner 规格 §32–§36）。 */
export const COMPOSITION_BASIS_NOTE =
  "按交易笔数构成；各币种金额只在该币种内合计与显示，不折算、不跨币种相加，也不代表金额份额。";

export const CONTRIBUTION_BASIS_NOTE =
  "金额按逐笔权威汇率折算到目标币种（minor-half-away-v1）；缺汇率的记录单独计数、未计入合计与份额分母。";

export const RATE_TREND_BASIS_NOTE =
  "只展示系统实际持有的离散汇率观测；不插值、不补点，缺失日期只计数，不代表完整行情。";

export const COVERAGE_BASIS_NOTE =
  "完整性=记录覆盖率（已折算/需折算），不是金额覆盖率；缺失的币种×日期组合会显式列出。";

export const FALLBACK_BASIS_NOTE =
  "回退使用统计只针对传入的权威回退元数据；没有元数据时不得据此断言「没有回退」。";

const MILLISECONDS_PER_DAY = 86_400_000;
const MISSING_DATES_PREVIEW = 10;
const PROVIDERS_PREVIEW = 8;
const DATES_PREVIEW = 10;

function sourceOf(options: AdapterOptions, complete: boolean): ChartSource {
  return {
    analysisId: options.analysisId,
    title: options.title,
    currency: options.currency,
    complete,
  };
}

/** 金额 + 币种文本；小数位取权威 `decimalsFor`（JPY 0 位、CNY 2 位…）。 */
function moneyTextOf(minor: bigint, currency: string): string {
  return `${formatMinorText(minor, decimalsFor(currency))} ${currency}`;
}

function fractionOfRatio(ratio: RatioLike | null): number | null {
  if (ratio === null) return null;
  return ratioToDisplayNumber(ratio);
}

function percentOfRatio(ratio: RatioLike | null): string {
  if (ratio === null) return "—";
  return formatRatioPercent(ratio, 1);
}

/** bigint 比例 → 仅展示用 number；分母为 0 时返回 0（调用方保证不会出现）。 */
function fractionBetween(value: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return ratioToDisplayNumber({ numerator: value, denominator });
}

function clampFraction(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** `YYYY-MM-DD` → 自 1970 起的自然日序号（只用于 P18 的 x 坐标）。 */
function dayNumberOf(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / MILLISECONDS_PER_DAY);
}

function truncatedJoin(values: readonly string[], limit: number, suffix: string): string {
  if (values.length === 0) return "";
  const preview = values.slice(0, limit).join("、");
  return values.length > limit ? `${preview}${suffix}` : preview;
}

/* ------------------------------------------------------------------------- *
 * P16 · 币种交易构成（不折算，按笔数）
 * ------------------------------------------------------------------------- */

/**
 * shared P16 结果 → 币种构成输入。
 *
 * 行内 `incomeText`/`expenseText` 是该币种内部的原币合计；不同币种之间
 * 不求和、不折算。份额只按笔数计算（owner 规格 §32）。
 */
export function toCurrencyCompositionInput(
  result: SharedCurrencyCompositionResult,
  options: AdapterOptions,
): CurrencyCompositionInput {
  const rows: CurrencyCompositionRowDatum[] = result.rows.map((row) => ({
    currency: row.currency,
    recordCount: row.recordCount,
    recordCountText: formatCountText(row.recordCount),
    incomeCount: row.incomeCount,
    expenseCount: row.expenseCount,
    incomeText: moneyTextOf(row.incomeAmountMinor, row.currency),
    expenseText: moneyTextOf(row.expenseAmountMinor, row.currency),
    recordShare: fractionOfRatio(row.recordShare),
    shareText: percentOfRatio(row.recordShare),
  }));
  const available = rows.length > 0;
  return {
    source: sourceOf(options, result.completeness === "complete"),
    available,
    unavailableReason: available ? null : "所选范围内没有可统计的交易",
    rows,
    totalRecordCount: result.totalRecordCount,
    totalText: `${formatCountText(result.totalRecordCount)} 笔`,
    currencyCount: result.currencyCount,
    basisNote: COMPOSITION_BASIS_NOTE,
  };
}

/* ------------------------------------------------------------------------- *
 * P17 · 综合金额币种贡献
 * ------------------------------------------------------------------------- */

/**
 * shared P17 结果 → 币种贡献输入。
 *
 * 份额分母只覆盖「已折算金额」；缺汇率的记录以 `missingText` 显式提示，
 * 不得隐藏缺失去凑 100%（owner 规格 §33）。
 */
export function toFxContributionChartInput(
  result: SharedFxContributionResult,
  options: AdapterOptions,
): FxContributionChartInput {
  const rows: FxContributionRowDatum[] = result.rows.map((row) => ({
    currency: row.currency,
    convertedMinor: row.convertedMinor,
    convertedText: moneyTextOf(row.convertedMinor, result.targetCurrency),
    originalText: moneyTextOf(row.originalSumMinor, row.currency),
    convertedCount: row.convertedCount,
    fallbackCount: row.fallbackCount,
    missingCount: row.missingCount,
    shareOfConverted: fractionOfRatio(row.shareOfConverted),
    shareText: percentOfRatio(row.shareOfConverted),
  }));
  const available = rows.length > 0;
  const missingText =
    result.missingCount === 0
      ? ""
      : `缺汇率 ${formatCountText(result.missingCount)} 笔，未计入合计`;
  return {
    source: sourceOf(options, result.completeness === "complete"),
    available,
    unavailableReason: available ? null : "所选范围内没有可折算的交易",
    targetCurrency: result.targetCurrency,
    rows,
    totalMinor: result.totalConvertedMinor,
    totalText: moneyTextOf(result.totalConvertedMinor, result.targetCurrency),
    convertedCount: result.convertedCount,
    missingCount: result.missingCount,
    missingText,
    sharesOverConvertedOnly: true,
    basisNote: CONTRIBUTION_BASIS_NOTE,
  };
}

/* ------------------------------------------------------------------------- *
 * P18 · 汇率历史趋势（只画离散观测）
 * ------------------------------------------------------------------------- */

function missingDatesTextOf(result: SharedFxRateTrendResult): string {
  if (result.missingDateCount === 0) {
    return "无缺失日期";
  }
  const preview = truncatedJoin(result.missingDates, MISSING_DATES_PREVIEW, "…");
  const countText = `缺失 ${formatCountText(result.missingDateCount)} 天`;
  return preview.length === 0 ? countText : `${countText}：${preview}`;
}

/**
 * shared P18 结果 → 离散汇率观测输入。
 *
 * 不生成占位点、不插值；`xFraction`/`yFraction` 只按观测集合归一化，
 * 缺失日期只体现在 `missingDatesText`（owner 规格 §34）。
 */
export function toFxRateTrendInput(
  result: SharedFxRateTrendResult,
  options: AdapterOptions,
): FxRateTrendInput {
  const fromDay = dayNumberOf(result.from);
  const toDay = dayNumberOf(result.to);
  const daySpan = toDay - fromDay;
  const scaledValues = result.points.map((point) => point.rateScaled.scaled);
  let minScaled = 0n;
  let maxScaled = 0n;
  for (const [index, scaled] of scaledValues.entries()) {
    if (index === 0 || scaled < minScaled) minScaled = scaled;
    if (index === 0 || scaled > maxScaled) maxScaled = scaled;
  }
  const scaledSpan = maxScaled - minScaled;
  const points: FxRateTrendPointDatum[] = result.points.map((point) => ({
    rateDate: point.rateDate,
    rateText: formatScaledDecimalText(point.rateScaled),
    provider: point.provider,
    xFraction: daySpan > 0 ? clampFraction((dayNumberOf(point.rateDate) - fromDay) / daySpan) : 0,
    yFraction: scaledSpan === 0n ? 1 : clampFraction(fractionBetween(point.rateScaled.scaled - minScaled, scaledSpan)),
  }));
  const available = points.length > 0;
  return {
    source: sourceOf(options, result.completeness === "complete"),
    available,
    unavailableReason: available ? null : "所选范围内没有该币种的汇率观测记录",
    currency: result.currency,
    targetCurrency: result.targetCurrency,
    points,
    observationCount: result.observationCount,
    missingDateCount: result.missingDateCount,
    missingDatesText: missingDatesTextOf(result),
    changeText: result.change === null ? null : formatRatioPercent(result.change, 1),
    interpolation: "none",
    basisNote: RATE_TREND_BASIS_NOTE,
  };
}

/* ------------------------------------------------------------------------- *
 * P19 · 汇率完整性（币种 × 日期）
 * ------------------------------------------------------------------------- */

const COVERAGE_STATUS_LABELS: Record<FxCoverageCellDatum["status"], string> = {
  exact: "命中",
  fallback: "回退",
  missing: "缺失",
  "not-needed": "无需折算",
};

/**
 * shared P19 结果 → 完整性矩阵输入。
 *
 * 完整性是「记录覆盖率」，金额覆盖率首版明确不可用并给出原因；
 * 缺失组合逐条展示，不用空白掩盖（owner 规格 §35）。
 */
export function toFxCoverageMatrixInput(
  result: SharedFxCoverageResult,
  options: AdapterOptions,
): FxCoverageMatrixInput {
  const rows: FxCoverageRowDatum[] = result.rows.map((row) => ({
    currency: row.currency,
    recordCount: row.recordCount,
    convertedCount: row.convertedCount,
    missingCount: row.missingCount,
    coverageFraction: fractionOfRatio(row.coverage),
    coverageText: percentOfRatio(row.coverage),
  }));
  const cells: FxCoverageCellDatum[] = result.cells.map((cell) => ({
    currency: cell.currency,
    date: cell.date,
    status: cell.status,
    statusLabel: COVERAGE_STATUS_LABELS[cell.status],
    recordCount: cell.recordCount,
  }));
  const missingCombinationsText = result.missingCombinations.map(
    (combination) =>
      `${combination.currency} · ${combination.date}（${formatCountText(combination.recordCount)} 笔）`,
  );
  const available = cells.length > 0;
  return {
    source: sourceOf(options, result.completeness === "complete"),
    available,
    unavailableReason: available ? null : "所选范围内没有需要检查折算的记录",
    targetCurrency: result.targetCurrency,
    rows,
    columns: result.dates,
    cells,
    needsConversionCount: result.needsConversionCount,
    convertedCount: result.convertedCount,
    missingCount: result.missingCount,
    coverageFraction: fractionOfRatio(result.coverageRatio),
    coverageText: percentOfRatio(result.coverageRatio),
    amountCoverageAvailable: false,
    amountCoverageReason: result.amountCoverageReason,
    missingCombinationsText,
    basisNote: COVERAGE_BASIS_NOTE,
  };
}

/* ------------------------------------------------------------------------- *
 * P20 · 回退使用分析
 * ------------------------------------------------------------------------- */

/**
 * shared P20 结果 → 回退使用输入。
 *
 * 只统计传入的权威回退元数据；无折算需求时显式标记不可用，
 * 而不是显示「0 次回退」让人误以为结论可靠（owner 规格 §36）。
 */
export function toFxFallbackUsageInput(
  result: SharedFxFallbackResult,
  options: AdapterOptions,
): FxFallbackUsageInput {
  const rows: FxFallbackBarDatum[] = result.rows.map((row) => ({
    currency: row.currency,
    directCount: row.directCount,
    fallbackCount: row.fallbackCount,
    missingCount: row.missingCount,
    fallbackText: `回退 ${formatCountText(row.fallbackCount)} 笔`,
  }));
  const distribution: FxFallbackDistributionDatum[] = result.fallbackDaysDistribution.map((entry) => ({
    fallbackDays: entry.fallbackDays,
    label: `${formatCountText(entry.fallbackDays)} 天前`,
    count: entry.count,
    fraction:
      result.fallbackRecordCount === 0
        ? 0
        : clampFraction(entry.count / result.fallbackRecordCount),
  }));
  const providersText =
    result.providers.length === 0
      ? "无回退来源元数据"
      : result.providers
          .slice(0, PROVIDERS_PREVIEW)
          .map((provider) => `${provider.provider}：${formatCountText(provider.count)} 笔`)
          .join("；");
  const datesText =
    result.dates.length === 0
      ? "无回退日期元数据"
      : truncatedJoin(
          result.dates.map((entry) => `${entry.date}（${formatCountText(entry.count)} 笔）`),
          DATES_PREVIEW,
          "…",
        );
  const available = result.needsConversionCount > 0;
  return {
    source: sourceOf(options, result.completeness === "complete"),
    available,
    unavailableReason: available ? null : "所选范围内没有需要折算的交易（可能均为目标币种）",
    targetCurrency: result.targetCurrency,
    rows,
    fallbackRecordCount: result.fallbackRecordCount,
    needsConversionCount: result.needsConversionCount,
    maxFallbackDays: result.maxFallbackDays,
    distribution,
    providersText,
    datesText,
    missingRateCount: result.missingRateCount,
    basisNote: FALLBACK_BASIS_NOTE,
  };
}
