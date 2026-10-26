/**
 * 结果 → 图表输入适配器（C-2 第二批，web 侧，DRAFT）。
 *
 * 覆盖 P12 分类箱线图、P13 多指标交叉表、P14 分类周期小多图、P15 全年日历、
 * P21 自定义多维长表。与 C-1/第一批相同：
 * - 输入是 shared 草案结果（结构镜像见 `sharedTypes.ts`），输出是 `types.ts` 的图表输入；
 * - 只做取字段、格式化文本、把 bigint 比例换成「仅用于坐标」的 number；
 * - **不做金额/占比/分位/归因的重算**，需要新统计量应回 shared 加权威函数。
 */

import type { AdapterOptions } from "./adapters.js";
import {
  formatCountText,
  formatMinorText,
  formatRatioMinorText,
  formatRatioPercent,
  ratioToDisplayNumber,
  roundRatioToInteger,
} from "./format.js";
import type {
  BoxplotByCategoryInput,
  BoxplotGroupDatum,
  CalendarHeatmapDay,
  CalendarHeatmapInput,
  ChartSource,
  CrossCubeAdapterResult,
  CrossCubeRow,
  CrossCubeTableInput,
  PivotBodyCell,
  PivotHeaderCell,
  PivotTableInput,
  SmallMultiplePanel,
  SmallMultiplePoint,
  SmallMultiplesInput,
} from "./types.js";
import type {
  RatioLike,
  SharedBoxplotResult,
  SharedCalendarResult,
  SharedCrossCubeOutcome,
  SharedPivotAggregate,
  SharedPivotResult,
  SharedSmallMultiplesResult,
} from "./sharedTypes.js";

const DIMENSION_TEXTS: Readonly<Record<string, string>> = {
  year: "年",
  month: "月份",
  week: "周",
  weekday: "星期",
  category: "分类",
  paymentMethod: "支付方式",
  currency: "币种",
  kind: "收支类型",
  tag: "标签",
};

const CUBE_REJECTION_TEXTS: Readonly<Record<string, string>> = {
  "unsupported-dimension": "该维度不支持交叉分析（仅限受控允许列表）",
  "duplicate-dimension": "维度不能重复选择",
  "too-many-dimensions": "最多支持 3 个维度",
  "unsupported-metric": "该指标不支持交叉分析",
  "mixed-currency": "包含多个原币且未选币种维度，不能直接相加",
  "too-many-combinations": "维度组合过多，请减少维度或缩小时间范围",
};

function sourceOf(options: AdapterOptions, complete: boolean): ChartSource {
  return {
    analysisId: options.analysisId,
    title: options.title,
    currency: options.currency,
    complete,
  };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** bigint 值在 [lower, lower+span] 中的位置（0..1，仅坐标用）。 */
function fractionBetweenBigInt(value: bigint, lower: bigint, span: bigint): number {
  if (span <= 0n) return 0;
  return clamp01(ratioToDisplayNumber({ numerator: value - lower, denominator: span }));
}

/** 有理数（分位等）在 [lower, lower+span] 中的位置（0..1，仅坐标用）。 */
function fractionBetweenRatio(value: RatioLike, lower: bigint, span: bigint): number {
  if (span <= 0n) return 0;
  return clamp01(
    ratioToDisplayNumber({
      numerator: value.numerator - lower * value.denominator,
      denominator: value.denominator * span,
    }),
  );
}

function dimensionTextOf(dimension: string): string {
  return DIMENSION_TEXTS[dimension] ?? dimension;
}

/* ------------------------------------------------------------------------- *
 * P12 · 分类金额箱线图
 * ------------------------------------------------------------------------- */

/**
 * 分类箱线结果 → 箱线图输入（P12）。
 *
 * 所有组的箱线共享同一个 domain（全体 min..max 与围栏/离群点），因此跨组的
 * 长度可比；`reliable=false` 的组必须由展示层弱化（样本过少不得当作同等可信）。
 */
export function toBoxplotByCategoryInput(
  result: SharedBoxplotResult,
  options: AdapterOptions,
): BoxplotByCategoryInput {
  const domainCandidates: bigint[] = [];
  for (const group of result.groups) {
    domainCandidates.push(group.minMinor, group.maxMinor);
    domainCandidates.push(roundRatioToInteger(group.lowerFence), roundRatioToInteger(group.upperFence));
    for (const outlier of group.outlierMinors) domainCandidates.push(outlier);
  }

  let domainMin = 0n;
  let domainMax = 0n;
  if (domainCandidates.length > 0) {
    domainMin = domainCandidates[0] as bigint;
    domainMax = domainCandidates[0] as bigint;
    for (const candidate of domainCandidates) {
      if (candidate < domainMin) domainMin = candidate;
      if (candidate > domainMax) domainMax = candidate;
    }
  }
  const span = domainMax - domainMin;

  const groups: BoxplotGroupDatum[] = result.groups.map((group) => ({
    categoryId: group.categoryId,
    label: group.categoryLabel,
    sampleCount: group.sampleCount,
    reliable: group.reliable,
    minText: formatMinorText(group.minMinor, options.decimals),
    q1Text: formatRatioMinorText(group.q1, options.decimals),
    medianText: formatRatioMinorText(group.median, options.decimals),
    q3Text: formatRatioMinorText(group.q3, options.decimals),
    maxText: formatMinorText(group.maxMinor, options.decimals),
    lowerFenceText: formatRatioMinorText(group.lowerFence, options.decimals),
    upperFenceText: formatRatioMinorText(group.upperFence, options.decimals),
    outlierTexts: group.outlierMinors.map((outlier) => formatMinorText(outlier, options.decimals)),
    minFraction: fractionBetweenBigInt(group.minMinor, domainMin, span),
    q1Fraction: fractionBetweenRatio(group.q1, domainMin, span),
    medianFraction: fractionBetweenRatio(group.median, domainMin, span),
    q3Fraction: fractionBetweenRatio(group.q3, domainMin, span),
    maxFraction: fractionBetweenBigInt(group.maxMinor, domainMin, span),
    lowerFenceFraction: fractionBetweenRatio(group.lowerFence, domainMin, span),
    upperFenceFraction: fractionBetweenRatio(group.upperFence, domainMin, span),
    outlierFractions: group.outlierMinors.map((outlier) => fractionBetweenBigInt(outlier, domainMin, span)),
  }));

  return {
    source: sourceOf(options, result.completeness === "complete"),
    groups,
    quantileMethodText: result.quantileMethod === "type7-linear" ? "Type 7 线性插值" : result.quantileMethod,
    minReliableSample: result.minReliableSample,
    domainMinText: formatMinorText(domainMin, options.decimals),
    domainMaxText: formatMinorText(domainMax, options.decimals),
  };
}

/* ------------------------------------------------------------------------- *
 * P13 · 多指标交叉表
 * ------------------------------------------------------------------------- */

function pivotAggregateText(
  aggregate: SharedPivotAggregate,
  metric: SharedPivotResult["metric"],
  decimals: number,
): string {
  switch (metric) {
    case "amount":
      return formatMinorText(aggregate.amountMinor, decimals);
    case "count":
      return formatCountText(aggregate.count);
    case "average":
      return aggregate.metricValue === null ? "—" : formatRatioMinorText(aggregate.metricValue, decimals);
    case "share":
      return aggregate.metricValue === null ? "—" : formatRatioPercent(aggregate.metricValue, 1);
    default:
      return "—";
  }
}

export interface PivotLabels {
  readonly rowDimensionText: string;
  readonly colDimensionText: string;
  readonly metricText: string;
}

/**
 * 交叉表结果 → 表格输入（P13）。
 *
 * 合计一律消费 shared 给的 `rowTotals/colTotals/grandTotal`，这里不重算；
 * 守恒校验失败时给出显式文案，界面不得静默显示可疑数字。
 */
export function toPivotTableInput(
  result: SharedPivotResult,
  options: AdapterOptions,
  labels: PivotLabels,
): PivotTableInput {
  const rowIndex = new Map<string, number>(result.rowIds.map((id, index) => [id, index]));
  const colIndex = new Map<string, number>(result.colIds.map((id, index) => [id, index]));

  const rowHeaders: PivotHeaderCell[] = result.rowIds.map((id) => ({
    id,
    label: result.rowLabels.get(id) ?? id,
    totalText: pivotAggregateText(result.rowTotals.get(id) ?? result.grandTotal, result.metric, options.decimals),
  }));
  const colHeaders: PivotHeaderCell[] = result.colIds.map((id) => ({
    id,
    label: result.colLabels.get(id) ?? id,
    totalText: pivotAggregateText(result.colTotals.get(id) ?? result.grandTotal, result.metric, options.decimals),
  }));

  const cells: PivotBodyCell[] = result.cells.map((cell) => ({
    rowIndex: rowIndex.get(cell.rowId) ?? -1,
    colIndex: colIndex.get(cell.colId) ?? -1,
    valueText: pivotAggregateText(cell, result.metric, options.decimals),
    shareText: null,
    isNegative: cell.amountMinor < 0n,
  }));

  return {
    source: sourceOf(options, result.completeness === "complete"),
    rowDimensionText: labels.rowDimensionText,
    colDimensionText: labels.colDimensionText,
    metricText: labels.metricText,
    rowHeaders,
    colHeaders,
    cells,
    grandTotalText: pivotAggregateText(result.grandTotal, result.metric, options.decimals),
    emptyCellText: "—",
    filledCellCount: cells.length,
    conservationText:
      result.conservation.amountsMatch && result.conservation.countsMatch
        ? null
        : "合计校验失败：单元格合计与总计不一致，请勿据此下结论",
  };
}

/* ------------------------------------------------------------------------- *
 * P14 · 分类周期小多图
 * ------------------------------------------------------------------------- */

/**
 * 小多图结果 → 面板输入（P14）。
 *
 * 共享尺度时 fractionOfMax 用 `sharedMaxMinor`，独立尺度时用各面板 `maxMinor`；
 * 两种模式都保留 `sharedMaxMinor` 文本，供界面标注「尺度不同，不可直接比高」。
 */
export function toSmallMultiplesInput(
  result: SharedSmallMultiplesResult,
  options: AdapterOptions,
): SmallMultiplesInput {
  const bucketLabel = new Map<string, string>(
    result.bucketKeys.map((key, index) => [key, result.bucketLabels[index] ?? key]),
  );

  const panels: SmallMultiplePanel[] = result.panels.map((panel) => {
    const denominator = result.scaleMode === "shared" ? result.sharedMaxMinor : panel.maxMinor;
    const points: SmallMultiplePoint[] = panel.points.map((point) => ({
      bucketLabel: bucketLabel.get(point.bucketKey) ?? point.bucketKey,
      valueText: formatMinorText(point.valueMinor, options.decimals),
      fractionOfMax: fractionBetweenBigInt(point.valueMinor, 0n, denominator),
    }));

    return {
      categoryId: panel.categoryId,
      label: panel.categoryLabel,
      totalText: formatMinorText(panel.totalMinor, options.decimals),
      maxText: formatMinorText(panel.maxMinor, options.decimals),
      points,
    };
  });

  const noteText = result.truncated
    ? `仅显示前 ${String(result.panels.length)} 个分类（另有 ${String(result.omittedCategoryCount)} 个未显示）`
    : null;

  return {
    source: sourceOf(options, result.completeness === "complete"),
    panels,
    bucketLabels: result.bucketLabels,
    scaleMode: result.scaleMode,
    sharedMaxText: formatMinorText(result.sharedMaxMinor, options.decimals),
    truncated: result.truncated,
    omittedCategoryCount: result.omittedCategoryCount,
    noteText,
  };
}

/* ------------------------------------------------------------------------- *
 * P15 · 全年日历
 * ------------------------------------------------------------------------- */

const MONTH_LABELS: readonly string[] = [
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
];

/**
 * 日历结果 → 年度热力日历输入（P15）。
 *
 * `no-data`（真实零）、`unknown`（覆盖未知）、`future` 是三种不同事实，文本与
 * 强度都必须区分：只有真实有数据/真实零进入色阶，未知与未来不得画成 0。
 */
export function toCalendarHeatmapInput(
  result: SharedCalendarResult,
  options: AdapterOptions,
): CalendarHeatmapInput {
  const isCount = result.metric === "count";
  const intensityMin = result.intensityMinMinor;
  const intensityMax = result.intensityMaxMinor;
  const intensitySpan = intensityMin === null || intensityMax === null ? null : intensityMax - intensityMin;

  const intensityOf = (day: SharedCalendarResult["days"][number]): number => {
    if (day.state !== "complete" && day.state !== "in-progress") return 0;
    if (intensitySpan === null || intensityMin === null) return 0;
    if (intensitySpan === 0n) return 0.5;
    return fractionBetweenBigInt(day.valueMinor, intensityMin, intensitySpan);
  };

  const valueTextOf = (day: SharedCalendarResult["days"][number]): string => {
    if (day.state === "future") return "—";
    if (day.state === "unknown") return "—";
    return isCount ? formatCountText(day.count) : formatMinorText(day.valueMinor, options.decimals);
  };

  const days: CalendarHeatmapDay[] = result.days.map((day) => ({
    date: day.date,
    weekday: day.weekday,
    weekIndex: day.weekIndex,
    month: day.month,
    state: day.state,
    valueText: valueTextOf(day),
    countText: formatCountText(day.count),
    intensity: intensityOf(day),
  }));

  return {
    source: sourceOf(options, result.completeness === "complete"),
    year: result.year,
    leapYear: result.leapYear,
    weekCount: result.weekCount,
    monthLabels: MONTH_LABELS,
    monthStartWeekIndex: result.monthStartWeekIndex,
    days,
    totalText: isCount ? formatCountText(result.totalCount) : formatMinorText(result.totalMinor, options.decimals),
    maxText:
      intensityMax === null
        ? null
        : isCount
          ? formatCountText(Number(intensityMax))
          : formatMinorText(intensityMax, options.decimals),
    noDataText: "无记录",
    unknownText: "覆盖未知",
    futureText: "未来",
  };
}

/* ------------------------------------------------------------------------- *
 * P21 · 自定义多维长表
 * ------------------------------------------------------------------------- */

/**
 * 立方结果 → 长表输入（P21；维度 > 2 时退回长表，2 维时界面可改用矩阵/热力）。
 *
 * 能力检查失败（维度不受控、跨币种混加、组合过多等）时返回 `ok: false` 与
 * 可展示原因；**不抛异常**，由界面显示拒绝原因，避免把错误数据画成图。
 */
export function toCrossCubeTableInput(
  outcome: SharedCrossCubeOutcome,
  options: AdapterOptions,
): CrossCubeAdapterResult {
  if (!outcome.ok) {
    return {
      ok: false,
      reason: outcome.reason,
      reasonText: CUBE_REJECTION_TEXTS[outcome.reason] ?? outcome.detail,
    };
  }

  const result = outcome.result;
  const dimensionTexts = result.dimensions.map((dimension) => dimensionTextOf(dimension));
  const isCount = result.metric === "count";

  const rows: CrossCubeRow[] = result.cells.map((cell) => {
    const path = cell.coords.map((coord, index) => ({
      dimensionText: dimensionTexts[index] ?? "",
      label: result.axes[index]?.labels.get(coord) ?? coord,
    }));

    const shareText =
      isCount
        ? result.totalCount === 0
          ? null
          : formatRatioPercent({ numerator: BigInt(cell.count), denominator: BigInt(result.totalCount) }, 1)
        : result.totalMinor === 0n
          ? null
          : formatRatioPercent({ numerator: cell.amountMinor, denominator: result.totalMinor }, 1);

    return {
      key: cell.coords.join("|"),
      path,
      valueText: isCount ? formatCountText(cell.count) : formatMinorText(cell.amountMinor, options.decimals),
      shareText,
      countText: formatCountText(cell.count),
    };
  });

  const input: CrossCubeTableInput = {
    source: sourceOf(options, result.completeness === "complete"),
    dimensionTexts,
    metricText: isCount ? "笔数" : "金额",
    rows,
    totalText: isCount ? formatCountText(result.totalCount) : formatMinorText(result.totalMinor, options.decimals),
    truncated: false,
  };

  return { ok: true, input };
}
