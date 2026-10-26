/**
 * Agent C · C-1 图表适配层类型（web 侧，DRAFT 未冻结）。
 *
 * 职责边界（owner 规格 §2 / Lead 2026-10-27）：
 * - **数学权威在 `@libellum/shared`**（分位、方差、归因、矩阵、排行）；
 * - 本目录只做「结果 → 图表输入」的映射、文本格式化与几何布局；
 * - **几何层不得重算金额、占比、分位、归因**：这里出现的 `*Fraction` / `*Text`
 *   都是 shared 结果的「展示派生」，只用于绘图与排版，不构成新的财务结论。
 *
 * 这些类型是 C-1 内部草稿，正式图表输入协议以 S-01 v2 的 `ChartInput` 为准。
 */

/** 图表输入的共同来源信息：同一分析定义、同一币种、同一完整性。 */
export interface ChartSource {
  readonly analysisId: string;
  readonly title: string;
  readonly currency: string;
  readonly complete: boolean;
}

/** 金额文本：minor 为权威整数，text 为已格式化的展示文本。 */
export interface MoneyText {
  readonly minor: bigint;
  readonly text: string;
}

/** 排行表（I18 / 精确排行表 CF-10 的数据表形态）。 */
export interface RankingTableRow {
  readonly rank: number;
  readonly id: string;
  readonly amountMinor: bigint;
  readonly amountText: string;
  readonly occurredLocalDate: string;
  readonly categoryLabel: string;
  readonly paymentMethodLabel: string | null;
  readonly shareText: string | null;
  readonly tieCount: number;
}

export interface RankingTableInput {
  readonly source: ChartSource;
  readonly rows: readonly RankingTableRow[];
  readonly totalText: string | null;
  readonly truncated: boolean;
  readonly sampleComplete: boolean;
  /** 行数摘要，例如「共 5 笔，显示前 4 笔」由界面层拼接，这里只给事实。 */
  readonly visibleCount: number;
}

/** 发散条（A06 支出变化贡献：正=增加、负=减少）。 */
export interface DivergingBarDatum {
  readonly id: string;
  readonly label: string;
  readonly deltaMinor: bigint;
  readonly deltaText: string;
  readonly direction: "increase" | "decrease" | "flat";
  /** 供几何层缩放：|delta| / max|delta|，仅展示派生。 */
  readonly fractionOfMax: number;
  readonly shareText: string | null;
  readonly isNew: boolean;
  readonly isRemoved: boolean;
}

export interface DivergingBarsInput {
  readonly source: ChartSource;
  readonly rows: readonly DivergingBarDatum[];
  readonly totalDeltaText: string;
  readonly previousTotalText: string;
  readonly currentTotalText: string;
}

/** 瀑布图（A06 的累计解释形态）。 */
export interface WaterfallStep {
  readonly id: string;
  readonly label: string;
  readonly kind: "start" | "delta" | "total";
  readonly deltaText: string | null;
  readonly cumulativeText: string;
  /** 相对「上/下界最大绝对值」的归一化位置，仅几何使用。 */
  readonly startFraction: number;
  readonly endFraction: number;
  readonly direction: "increase" | "decrease" | "flat";
}

export interface WaterfallInput {
  readonly source: ChartSource;
  readonly steps: readonly WaterfallStep[];
  readonly unitText: string;
}

/** 直方图（A09 金额分布）。 */
export interface HistogramBar {
  readonly index: number;
  readonly lowerMinor: bigint;
  readonly upperMinor: bigint;
  readonly label: string;
  readonly count: number;
  /** count / maxCount，仅几何使用。 */
  readonly fractionOfMax: number;
  readonly containsZero: boolean;
  readonly isLast: boolean;
}

export interface HistogramInput {
  readonly source: ChartSource;
  readonly bars: readonly HistogramBar[];
  readonly sampleCount: number;
  readonly zeroCount: number;
  readonly binWidthText: string;
  readonly minText: string | null;
  readonly maxText: string | null;
}

/** 箱线图（A10 四分位数 / P12）。 */
export interface BoxplotInput {
  readonly source: ChartSource;
  readonly sampleCount: number;
  readonly minText: string;
  readonly q1Text: string;
  readonly medianText: string;
  readonly q3Text: string;
  readonly maxText: string;
  readonly lowerFenceText: string;
  readonly upperFenceText: string;
  /** 归一化位置（0..1，按 min..max 轴），仅几何使用。 */
  readonly minFraction: number;
  readonly q1Fraction: number;
  readonly medianFraction: number;
  readonly q3Fraction: number;
  readonly maxFraction: number;
  readonly outlierTexts: readonly string[];
  readonly outlierFractions: readonly number[];
}

/** 帕累托 / 集中度（A08 支出集中度 / P08 累计曲线）。 */
export interface ParetoRow {
  readonly id: string;
  readonly label: string;
  readonly amountMinor: bigint;
  readonly amountText: string;
  readonly shareText: string;
  readonly cumulativeText: string;
  readonly cumulativeFraction: number;
}

export interface ParetoInput {
  readonly source: ChartSource;
  readonly rows: readonly ParetoRow[];
  readonly totalText: string;
  readonly top1Text: string | null;
  readonly top3Text: string | null;
  readonly top5Text: string | null;
}
