/**
 * 结果 → 图表输入适配器（C-1 草案，web 侧）。
 *
 * 输入是 shared 草案结果（结构声明见 `sharedTypes.ts`），输出是 `types.ts` 的
 * 图表输入。只做三件事：取字段、格式化文本、把 bigint 比例换成「仅用于坐标」的
 * number。**不做任何金额/占比/分位/归因的重算**；需要新统计量应回 shared 增加权威函数。
 */

import {
  formatCountText,
  formatMinorText,
  formatRatioMinorText,
  formatRatioPercent,
  formatSignedMinorText,
  ratioToDisplayNumber,
} from "./format.js";
import type {
  BoxplotInput,
  BubbleDatum,
  BubbleInput,
  ChartSource,
  DivergingBarDatum,
  DivergingBarsInput,
  HeatmapCell,
  HeatmapColumn,
  HeatmapInput,
  HeatmapRow,
  HistogramBar,
  HistogramInput,
  ParetoInput,
  ParetoRow,
  RankMigrationDatum,
  RankMigrationInput,
  RankingTableInput,
  RankingTableRow,
  ScatterDatum,
  ScatterInput,
  StackedBarsInput,
  StackedBarsRow,
  StackedBarSegment,
  StackedBarSeries,
  WaterfallInput,
  WaterfallStep,
} from "./types.js";
import type {
  SharedBubbleResult,
  SharedConcentration,
  SharedContributionResult,
  SharedDistributionSummary,
  SharedFenceResult,
  SharedHistogram,
  SharedMatrixCell,
  SharedMatrixResult,
  SharedRankMigrationResult,
  SharedRankingResult,
  SharedScatterResult,
} from "./sharedTypes.js";

export interface AdapterOptions {
  readonly analysisId: string;
  readonly title: string;
  readonly currency: string;
  /** 币种小数位（来自 shared money 的便捷值；JPY=0）。 */
  readonly decimals: number;
}

function sourceOf(options: AdapterOptions, complete: boolean): ChartSource {
  return {
    analysisId: options.analysisId,
    title: options.title,
    currency: options.currency,
    complete,
  };
}

function maxAbsBigInt(values: readonly bigint[]): bigint {
  let max = 0n;
  for (const value of values) {
    const absolute = value < 0n ? -value : value;
    if (absolute > max) max = absolute;
  }
  return max;
}

function fractionOf(value: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return ratioToDisplayNumber({ numerator: value, denominator });
}

/**
 * 记录级排行 → 精确排行表（I18）。
 *
 * 截断时仍保留 `sampleComplete=false`，界面必须显示「仅显示前 N 笔」，
 * 不得把截断样本的占比当作全量结论。
 */
export function toRankingTableInput(
  result: SharedRankingResult,
  options: AdapterOptions,
): RankingTableInput {
  const rows: RankingTableRow[] = result.items.map((item) => ({
    rank: item.rank,
    id: item.id,
    amountMinor: item.amountMinor,
    amountText: formatMinorText(item.amountMinor, options.decimals),
    occurredLocalDate: item.occurredLocalDate,
    categoryLabel: item.categoryLabel,
    paymentMethodLabel: item.paymentMethodLabel,
    shareText: item.share === null ? null : formatRatioPercent(item.share, 1),
    tieCount: item.tieCount,
  }));

  return {
    source: sourceOf(options, result.sampleComplete),
    rows,
    totalText: result.totalMinor === null ? null : formatMinorText(result.totalMinor, options.decimals),
    truncated: result.truncated,
    sampleComplete: result.sampleComplete,
    visibleCount: rows.length,
  };
}

/** 分类变化贡献 → 发散条（A06）。正=增加、负=减少，方向来自权威 delta 符号。 */
export function toDivergingBarsInput(
  result: SharedContributionResult,
  options: AdapterOptions,
): DivergingBarsInput {
  const maxAbs = maxAbsBigInt(result.rows.map((row) => row.deltaMinor));

  const rows: DivergingBarDatum[] = result.rows.map((row) => ({
    id: row.categoryId,
    label: row.categoryLabel,
    deltaMinor: row.deltaMinor,
    deltaText: formatSignedMinorText(row.deltaMinor, options.decimals),
    direction: row.deltaMinor > 0n ? "increase" : row.deltaMinor < 0n ? "decrease" : "flat",
    fractionOfMax: fractionOf(row.deltaMinor, maxAbs),
    shareText: row.deltaShare === null ? null : formatRatioPercent(row.deltaShare, 1),
    isNew: row.isNew,
    isRemoved: row.isRemoved,
  }));

  return {
    source: sourceOf(options, true),
    rows,
    totalDeltaText: formatSignedMinorText(result.totalDeltaMinor, options.decimals),
    previousTotalText: formatMinorText(result.previousTotalMinor, options.decimals),
    currentTotalText: formatMinorText(result.currentTotalMinor, options.decimals),
  };
}

export interface WaterfallLabels {
  readonly start: string;
  readonly total: string;
}

/**
 * 分类变化贡献 → 瀑布图（A06 / P22 形态之一）。
 *
 * 累计位置由「权威 delta 依次累加」得到（这是布局算术，不是财务重算）；
 * 缩放轴取 0、各期初末与累计值的最大绝对值，保证所有柱在同一轴上可比。
 */
export function toWaterfallInput(
  result: SharedContributionResult,
  options: AdapterOptions,
  labels: WaterfallLabels = { start: "上期", total: "本期" },
): WaterfallInput {
  const cumulative: bigint[] = [];
  let running = 0n;
  for (const row of result.rows) {
    running += row.deltaMinor;
    cumulative.push(running);
  }

  const candidates = [
    0n,
    result.previousTotalMinor,
    result.currentTotalMinor,
    ...cumulative,
  ];
  const scale = maxAbsBigInt(candidates);
  const scaleDenominator = scale === 0n ? 1n : scale;

  const toFraction = (value: bigint): number => {
    // 0..1 归一化：负值截到 0（瀑布本批次只有支出/正金额场景；P22 再扩展双轴）。
    const positive = value < 0n ? 0n : value;
    return Math.min(1, fractionOf(positive, scaleDenominator));
  };

  const steps: WaterfallStep[] = [
    {
      id: "start",
      label: labels.start,
      kind: "start",
      deltaText: null,
      cumulativeText: formatMinorText(result.previousTotalMinor, options.decimals),
      startFraction: 0,
      endFraction: toFraction(result.previousTotalMinor),
      direction: "flat",
    },
  ];

  let previousCumulative = 0n;
  result.rows.forEach((row, index) => {
    const currentCumulative = cumulative[index] as bigint;
    steps.push({
      id: row.categoryId,
      label: row.categoryLabel,
      kind: "delta",
      deltaText: formatSignedMinorText(row.deltaMinor, options.decimals),
      cumulativeText: formatMinorText(currentCumulative, options.decimals),
      startFraction: toFraction(previousCumulative),
      endFraction: toFraction(currentCumulative),
      direction: row.deltaMinor > 0n ? "increase" : row.deltaMinor < 0n ? "decrease" : "flat",
    });
    previousCumulative = currentCumulative;
  });

  steps.push({
    id: "total",
    label: labels.total,
    kind: "total",
    deltaText: null,
    cumulativeText: formatMinorText(result.currentTotalMinor, options.decimals),
    startFraction: 0,
    endFraction: toFraction(result.currentTotalMinor),
    direction: "flat",
  });

  return {
    source: sourceOf(options, true),
    steps,
    unitText: options.currency,
  };
}

/** 直方图 → 柱状输入（A09）。高度比例来自 count，几何不得重算金额。 */
export function toHistogramInput(
  histogram: SharedHistogram | null,
  options: AdapterOptions,
): HistogramInput {
  if (histogram === null) {
    return {
      source: sourceOf(options, false),
      bars: [],
      sampleCount: 0,
      zeroCount: 0,
      binWidthText: "",
      minText: null,
      maxText: null,
    };
  }

  let maxCount = 0;
  for (const bin of histogram.bins) {
    if (bin.count > maxCount) maxCount = bin.count;
  }

  const bars: HistogramBar[] = histogram.bins.map((bin) => ({
    index: bin.index,
    lowerMinor: bin.lowerMinor,
    upperMinor: bin.upperMinor,
    label: `${formatMinorText(bin.lowerMinor, options.decimals)}–${formatMinorText(bin.upperMinor, options.decimals)}`,
    count: bin.count,
    fractionOfMax: maxCount === 0 ? 0 : bin.count / maxCount,
    containsZero: bin.lowerMinor <= 0n && bin.upperMinor >= 0n,
    isLast: bin.isLast,
  }));

  return {
    source: sourceOf(options, histogram.sampleCount > 0),
    bars,
    sampleCount: histogram.sampleCount,
    zeroCount: histogram.zeroCount,
    binWidthText: formatMinorText(histogram.binWidthMinor, options.decimals),
    minText: formatMinorText(histogram.minMinor, options.decimals),
    maxText: formatMinorText(histogram.maxMinor, options.decimals),
  };
}

/**
 * 分布摘要 + 1.5×IQR 围栏 → 箱线输入（A10 / P12）。
 *
 * 无样本返回 null：调用方应显示空态，不能用「0 的箱」冒充「没有支出」。
 */
export function toBoxplotInput(
  summary: SharedDistributionSummary,
  fences: SharedFenceResult | null,
  options: AdapterOptions,
): BoxplotInput | null {
  if (summary.sampleCount === 0 || summary.median === null || summary.minMinor === null) return null;
  if (summary.maxMinor === null) return null;

  const minMinor = summary.minMinor;
  const maxMinor = summary.maxMinor;
  const range = maxMinor - minMinor;
  const rangeDenominator = range === 0n ? 1n : range;

  const fractionOfMinor = (value: bigint): number => fractionOf(value - minMinor, rangeDenominator);

  const q1 = summary.quantiles[0]?.valueMinor ?? summary.median;
  const median = summary.median;
  const q3 = summary.quantiles[2]?.valueMinor ?? summary.median;

  const lowerFence = fences?.lowerFence ?? q1;
  const upperFence = fences?.upperFence ?? q3;

  const toDisplay = (ratio: { readonly numerator: bigint; readonly denominator: bigint }): number =>
    ratioToDisplayNumber(ratio);

  const lowerFenceNumber = toDisplay(lowerFence);
  const upperFenceNumber = toDisplay(upperFence);
  const minNumber = toDisplay({ numerator: minMinor, denominator: 1n });
  const maxNumber = toDisplay({ numerator: maxMinor, denominator: 1n });

  const domainMin = Math.min(minNumber, lowerFenceNumber);
  const domainMax = Math.max(maxNumber, upperFenceNumber);
  const domainSpan = domainMax - domainMin === 0 ? 1 : domainMax - domainMin;

  const domainFraction = (value: number): number => Math.min(1, Math.max(0, (value - domainMin) / domainSpan));

  const outlierFractions = (fences?.outliers ?? []).map((outlier) =>
    domainFraction(toDisplay({ numerator: outlier, denominator: 1n })),
  );

  return {
    source: sourceOf(options, true),
    sampleCount: summary.sampleCount,
    minText: formatMinorText(minMinor, options.decimals),
    q1Text: formatRatioMinorText(q1, options.decimals),
    medianText: formatRatioMinorText(median, options.decimals),
    q3Text: formatRatioMinorText(q3, options.decimals),
    maxText: formatMinorText(maxMinor, options.decimals),
    lowerFenceText: formatRatioMinorText(lowerFence, options.decimals),
    upperFenceText: formatRatioMinorText(upperFence, options.decimals),
    minFraction: domainFraction(minNumber),
    q1Fraction: domainFraction(toDisplay(q1)),
    medianFraction: domainFraction(toDisplay(median)),
    q3Fraction: domainFraction(toDisplay(q3)),
    maxFraction: domainFraction(maxNumber),
    outlierTexts: (fences?.outliers ?? []).map((outlier) => formatMinorText(outlier, options.decimals)),
    outlierFractions,
  };
}

/** 帕累托 / 集中度 → 累计曲线输入（A08 / P08）。 */
export function toParetoInput(
  concentration: SharedConcentration,
  options: AdapterOptions,
): ParetoInput {
  const rows: ParetoRow[] = concentration.rows.map((row) => ({
    id: row.id,
    label: row.label,
    amountMinor: row.amountMinor,
    amountText: formatMinorText(row.amountMinor, options.decimals),
    shareText: formatRatioPercent(row.share, 1),
    cumulativeText: formatRatioPercent(row.cumulativeShare, 1),
    cumulativeFraction: Math.min(1, Math.max(0, ratioToDisplayNumber(row.cumulativeShare))),
  }));

  const shareTextOf = (topN: number): string | null => {
    const ratio = concentration.ratios.find((entry) => entry.topN === topN);
    return ratio === undefined ? null : formatRatioPercent(ratio.share, 1);
  };

  return {
    source: sourceOf(options, concentration.rows.length > 0),
    rows,
    totalText: formatMinorText(concentration.totalMinor, options.decimals),
    top1Text: shareTextOf(1),
    top3Text: shareTextOf(3),
    top5Text: shareTextOf(5),
  };
}

/** 排行表行数摘要（供界面拼接文案；不做翻译，翻译交给 i18n 层）。 */
export function rankingCountSummary(input: RankingTableInput): string {
  return `${formatCountText(input.visibleCount)} 行`;
}

/* ------------------------------------------------------------------------- *
 * C-2：矩阵 / 排名迁移 / 散点 / 气泡
 * ------------------------------------------------------------------------- */

export interface HeatmapLabels {
  readonly row?: Readonly<Record<string, string>>;
  readonly col?: Readonly<Record<string, string>>;
}

function labelOf(labels: Readonly<Record<string, string>> | undefined, id: string): string {
  return labels?.[id] ?? id;
}

function matrixCellKey(rowId: string, colId: string): string {
  return `${rowId}\u0000${colId}`;
}

function matrixCellMap(matrix: SharedMatrixResult): ReadonlyMap<string, SharedMatrixCell> {
  const cells = new Map<string, SharedMatrixCell>();
  for (const cell of matrix.cells) {
    cells.set(matrixCellKey(cell.rowId, cell.colId), cell);
  }
  return cells;
}

/**
 * 矩阵 → 热力矩阵输入（P01 分类×月份 / P02 分类×星期 / P03 分类×支付方式）。
 *
 * 强度 = |amount| / 全表最大 |amount|；行内占比 = amount / 行合计。
 * 行合计为 0 时 shareOfRow=null（不写 0，也不除零）。
 */
export function toHeatmapInput(
  matrix: SharedMatrixResult,
  labels: HeatmapLabels,
  options: AdapterOptions,
): HeatmapInput {
  const maxAbs = maxAbsBigInt(matrix.cells.map((cell) => cell.amountMinor));
  const rows: HeatmapRow[] = matrix.rowIds.map((rowId) => ({
    id: rowId,
    label: labelOf(labels.row, rowId),
    totalText: formatMinorText(matrix.rowTotals.get(rowId) ?? 0n, options.decimals),
  }));
  const cols: HeatmapColumn[] = matrix.colIds.map((colId) => ({
    id: colId,
    label: labelOf(labels.col, colId),
  }));
  const cells: HeatmapCell[] = matrix.cells.map((cell) => {
    const rowTotal = matrix.rowTotals.get(cell.rowId) ?? 0n;
    const absolute = cell.amountMinor < 0n ? -cell.amountMinor : cell.amountMinor;
    return {
      rowId: cell.rowId,
      colId: cell.colId,
      rowLabel: labelOf(labels.row, cell.rowId),
      colLabel: labelOf(labels.col, cell.colId),
      amountMinor: cell.amountMinor,
      amountText: formatMinorText(cell.amountMinor, options.decimals),
      count: cell.count,
      shareOfRow: rowTotal === 0n ? null : fractionOf(cell.amountMinor, rowTotal),
      intensity: fractionOf(absolute, maxAbs),
      isNegative: cell.amountMinor < 0n,
    };
  });

  return {
    source: sourceOf(options, matrix.filledCellCount > 0),
    rows,
    cols,
    cells,
    maxText: formatMinorText(maxAbs, options.decimals),
    totalText: formatMinorText(matrix.grandTotalMinor, options.decimals),
    filledCellCount: matrix.filledCellCount,
    emptyCellText: "—",
  };
}

/**
 * 矩阵 → 堆叠柱输入（P04 时间×支付方式：行=时间桶，列=支付方式）。
 *
 * 段占比 = amount / 行合计；行合计为 0 时全部为 0。累计偏移由适配层给出，
 * 几何层只按 offsetFraction + fraction 摆位置。
 */
export function toStackedBarsInput(
  matrix: SharedMatrixResult,
  labels: HeatmapLabels,
  options: AdapterOptions,
): StackedBarsInput {
  const lookup = matrixCellMap(matrix);
  const seriesSegments: StackedBarSegment[][] = matrix.colIds.map(() => []);

  const rows: StackedBarsRow[] = matrix.rowIds.map((rowId, rowIndex) => {
    const total = matrix.rowTotals.get(rowId) ?? 0n;
    let offset = 0;
    matrix.colIds.forEach((colId, colIndex) => {
      const cell = lookup.get(matrixCellKey(rowId, colId));
      const amount = cell === undefined ? 0n : cell.amountMinor;
      const fraction = total === 0n ? 0 : fractionOf(amount, total);
      seriesSegments[colIndex]?.push({
        rowIndex,
        seriesId: colId,
        amountMinor: amount,
        amountText: formatMinorText(amount, options.decimals),
        fraction,
        offsetFraction: offset,
      });
      offset += fraction;
    });
    return {
      bucketLabel: labelOf(labels.row, rowId),
      totalText: formatMinorText(total, options.decimals),
    };
  });

  const series: StackedBarSeries[] = matrix.colIds.map((colId, colIndex) => ({
    id: colId,
    label: labelOf(labels.col, colId),
    segments: seriesSegments[colIndex] ?? [],
  }));

  return {
    source: sourceOf(options, matrix.filledCellCount > 0),
    rows,
    series,
    unitText: options.currency,
  };
}

/**
 * 排名迁移结果 → Bump/斜率图输入（P09）。
 *
 * 名次 → 纵向比例：1 名在顶部；新分类 currentFraction 有值、previousFraction=null；
 * 消失分类相反。金额文本对消失分类取上期金额（不显示 0）。
 */
export function toRankMigrationInput(
  result: SharedRankMigrationResult,
  options: AdapterOptions,
): RankMigrationInput {
  const ranks: number[] = [];
  for (const row of result.rows) {
    if (row.previousRank !== null) ranks.push(row.previousRank);
    if (row.currentRank !== null) ranks.push(row.currentRank);
  }
  let maxRank = 1;
  for (const rank of ranks) {
    if (rank > maxRank) maxRank = rank;
  }
  const fractionOfRank = (rank: number | null): number | null => {
    if (rank === null) return null;
    if (maxRank <= 1) return 1;
    return 1 - (rank - 1) / (maxRank - 1);
  };

  const rows: RankMigrationDatum[] = result.rows.map((row) => {
    let movement: RankMigrationDatum["movement"];
    if (row.isNew) {
      movement = "new";
    } else if (row.isRemoved) {
      movement = "removed";
    } else if (row.rankDelta === null || row.rankDelta === 0) {
      movement = "flat";
    } else if (row.rankDelta > 0) {
      movement = "up";
    } else {
      movement = "down";
    }
    return {
      id: row.id,
      label: row.label,
      previousRank: row.previousRank,
      currentRank: row.currentRank,
      rankDelta: row.rankDelta,
      movement,
      amountText: formatMinorText(row.isRemoved ? row.previousMinor : row.currentMinor, options.decimals),
      deltaText: formatSignedMinorText(row.amountDeltaMinor, options.decimals),
      previousFraction: fractionOfRank(row.previousRank),
      currentFraction: fractionOfRank(row.currentRank),
    };
  });

  return {
    source: sourceOf(options, rows.length > 0),
    rows,
    movedCount: result.movedCount,
    newCount: result.newCount,
    removedCount: result.removedCount,
    maxRank,
  };
}

/**
 * 散点结果 → 散点图输入（P10：x=日期序数、y=单笔金额占比）。
 *
 * x 使用日期序数而非时间戳，保证同一业务日期的点共享同一 x 位置；
 * yFraction 只用于坐标，金额文本仍来自 shared。
 */
export function toScatterInput(
  result: SharedScatterResult,
  options: AdapterOptions,
): ScatterInput {
  const dates = [...new Set(result.points.map((point) => point.occurredLocalDate))].sort();
  const dateIndex = new Map<string, number>();
  dates.forEach((date, index) => dateIndex.set(date, index));

  let maxAmount = 0n;
  let minAmount = 0n;
  result.points.forEach((point, index) => {
    if (index === 0 || point.amountMinor > maxAmount) maxAmount = point.amountMinor;
    if (index === 0 || point.amountMinor < minAmount) minAmount = point.amountMinor;
  });

  const points: ScatterDatum[] = result.points.map((point) => ({
    id: point.id,
    dateIndex: dateIndex.get(point.occurredLocalDate) ?? 0,
    dateLabel: point.occurredLocalDate,
    amountMinor: point.amountMinor,
    amountText: formatMinorText(point.amountMinor, options.decimals),
    categoryId: point.categoryId,
    yFraction: maxAmount === 0n ? 0 : fractionOf(point.amountMinor, maxAmount),
  }));

  return {
    source: sourceOf(options, result.complete),
    points,
    sampleCount: result.sampleCount,
    plottedCount: result.plottedCount,
    omittedCount: result.omittedCount,
    xLabels: dates,
    minText: points.length === 0 ? null : formatMinorText(minAmount, options.decimals),
    maxText: points.length === 0 ? null : formatMinorText(maxAmount, options.decimals),
  };
}

/**
 * 气泡结果 → 气泡图输入（P11：金额=半径、笔数=x、均值=y）。
 *
 * 半径按 sqrt(金额占比) 缩放（面积与金额成正比）；均值缺失时 yFraction=0，
 * 但 meanText=null，界面必须显示「无可用笔数」，不得把 0 当真实均值。
 */
export function toBubbleInput(result: SharedBubbleResult, options: AdapterOptions): BubbleInput {
  let maxCount = 0;
  let maxMean = 0;
  for (const bubble of result.bubbles) {
    if (bubble.count > maxCount) maxCount = bubble.count;
    if (bubble.meanMinor !== null) {
      const mean = ratioToDisplayNumber(bubble.meanMinor);
      if (mean > maxMean) maxMean = mean;
    }
  }

  const bubbles: BubbleDatum[] = result.bubbles.map((bubble) => {
    const mean = bubble.meanMinor === null ? null : ratioToDisplayNumber(bubble.meanMinor);
    return {
      id: bubble.categoryId,
      label: bubble.categoryLabel,
      count: bubble.count,
      sumMinor: bubble.sumMinor,
      sumText: formatMinorText(bubble.sumMinor, options.decimals),
      countText: formatCountText(bubble.count),
      meanText: bubble.meanMinor === null ? null : formatRatioMinorText(bubble.meanMinor, options.decimals),
      shareText: bubble.shareOfTotal === null ? null : formatRatioPercent(bubble.shareOfTotal, 1),
      radiusFraction: bubble.shareOfTotal === null ? 0 : Math.sqrt(Math.max(0, ratioToDisplayNumber(bubble.shareOfTotal))),
      xFraction: maxCount === 0 ? 0 : bubble.count / maxCount,
      yFraction: mean === null || maxMean === 0 ? 0 : mean / maxMean,
    };
  });

  return {
    source: sourceOf(options, result.completeness === "complete"),
    bubbles,
    totalText: formatMinorText(result.totalMinor, options.decimals),
    totalCount: result.totalCount,
  };
}
