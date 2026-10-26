/**
 * Agent C · C-1 草案类型（DRAFT，明确未冻结）。
 *
 * 这些类型是 Agent C 在 S17 C-1 批次里的**内部草稿**：只用于 C 的纯数学函数与
 * 图表适配层的实现与测试。它们不是公共协议，**不得被其他 Agent 引用**，也不
 * 得据此实现公共接口；正式结果协议以 Agent A 的 S-01 v2（评审后）为准。
 *
 * 映射关系：
 * - `DraftRational`         → S-01 的 `Ratio`（A 已在 `analysis/rational.ts` 定义）
 * - `DraftDistributionSummary` → S-01 v2 的 `distribution` 结果形状（QC-01 / C-Q16）
 * - `DraftContributionRow`  → S-01 v2 的 `contribution` 结果形状（QC-01 / C-Q16）
 * - `DraftMatrix*`          → S-01 v2 的 `matrix` 结果形状（QC-01 / C-Q16）
 * - `DraftRankedRecord`     → S-01 v2 的 `ranked-records` 结果形状（QC-01 / C-Q16）
 * - `DraftParetoRow`        → `ranked-groups` 的累计派生（A08/P08 用，展示层不重算）
 *
 * 金额一律用「币种最小单位」的 `bigint`：分位插值等会出现「小数分位」的结果，用
 * `DraftRational`（分母为正、已约分）精确表示，显示时才按 `minor-half-away-v1`
 * 舍入到整数最小单位。绝不使用 number 作为权威金额。
 */

export const ADVANCED_DRAFT_VERSION = "c1-draft";

/** 精确有理数：denominator 恒为正，且已约分（见 `rational.ts` 的 `makeRational`）。 */
export interface DraftRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** 完整性状态（草稿子集：C-1 的纯函数不知道权限/离线态，只表达「有没有可算样本」）。 */
export type DraftCompleteness = "complete" | "no-transactions" | "unavailable";

/** 分位点：p 为 0..1 的有理数，valueMinor 为「最小单位的有理数」（可能落在两个整数分之间）。 */
export interface DraftQuantile {
  readonly p: DraftRational;
  readonly valueMinor: DraftRational;
}

/** 直方图的一个箱：`[lowerMinor, upperMinor)`，最后一个箱包含上界（含最大值）。 */
export interface DraftHistogramBin {
  readonly index: number;
  readonly lowerMinor: bigint;
  readonly upperMinor: bigint;
  readonly count: number;
  readonly isLast: boolean;
}

export interface DraftHistogram {
  readonly binWidthMinor: bigint;
  readonly bins: readonly DraftHistogramBin[];
  /** 进入直方图的有效样本数；必须等于 Σ bins.count（守恒由计算层断言）。 */
  readonly sampleCount: number;
  /** 金额为 0 的样本数（单列，避免与「缺失」混淆）。 */
  readonly zeroCount: number;
  readonly minMinor: bigint;
  readonly maxMinor: bigint;
}

/** 定点小数（如标准差）：scaled / 10^decimals，四舍五入的舍入误差由计算层记录。 */
export interface DraftScaledDecimal {
  readonly scaled: bigint;
  readonly decimals: number;
}

/** 分位/直方图/离散度的一次性摘要（`distribution` 形状的草稿）。 */
export interface DraftDistributionSummary {
  readonly sampleCount: number;
  readonly completeness: DraftCompleteness;
  readonly minMinor: bigint | null;
  readonly maxMinor: bigint | null;
  readonly sumMinor: bigint;
  readonly mean: DraftRational | null;
  readonly median: DraftRational | null;
  readonly quantiles: readonly DraftQuantile[];
  /** 描述性总体方差（分母 n；不是样本方差）。 */
  readonly variance: DraftRational | null;
  /** 总体标准差，定点小数表示（默认 6 位）。 */
  readonly standardDeviation: DraftScaledDecimal | null;
  /** 变异系数 CV = 标准差 / 均值；均值为 0 时为 null（不可计算，不写 0）。 */
  readonly coefficientOfVariation: DraftRational | null;
  readonly iqr: DraftRational | null;
  readonly histogram: DraftHistogram | null;
}

/** 两期分类变化的一行（`contribution` 形状的草稿）。 */
export interface DraftContributionRow {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly previousMinor: bigint;
  readonly currentMinor: bigint;
  readonly deltaMinor: bigint;
  /** 变化占总差额的份额；总差额为 0 时为 null（不得除零）。 */
  readonly deltaShare: DraftRational | null;
  /** 增长率 (cur-prev)/prev；prev=0 时为 null 并给出原因。 */
  readonly growth: DraftRational | null;
  readonly growthUnavailableReason: "previous-zero" | null;
  readonly isNew: boolean;
  readonly isRemoved: boolean;
}

export interface DraftContributionResult {
  readonly previousTotalMinor: bigint;
  readonly currentTotalMinor: bigint;
  readonly totalDeltaMinor: bigint;
  readonly rows: readonly DraftContributionRow[];
  /** Σ rows.deltaMinor = previousTotalMinor - currentTotalMinor 的乘 -1；由计算层断言。 */
  readonly conservation: {
    readonly rowsDeltaMinor: bigint;
    readonly matchesTotal: boolean;
    readonly matchedBy: "categoryId";
  };
}

/** 矩阵单元格（`matrix` 形状的草稿）。 */
export interface DraftMatrixCell {
  readonly rowId: string;
  readonly colId: string;
  readonly amountMinor: bigint;
  readonly count: number;
}

export interface DraftMatrixResult {
  readonly rowIds: readonly string[];
  readonly colIds: readonly string[];
  readonly cells: readonly DraftMatrixCell[];
  readonly rowTotals: ReadonlyMap<string, bigint>;
  readonly colTotals: ReadonlyMap<string, bigint>;
  readonly grandTotalMinor: bigint;
  readonly grandTotalCount: number;
  /** 有值的单元格数（amountMinor !== 0n 或 count > 0）。 */
  readonly filledCellCount: number;
  /** 互斥维度下 行合计=列合计=总计；由调用方通过 `matrixIsConserved` 断言。 */
}

/** 记录级排行的一项（`ranked-records` 形状的草稿）。 */
export interface DraftRankedRecord {
  readonly id: string;
  readonly amountMinor: bigint;
  readonly kind: "expense" | "income";
  readonly occurredLocalDate: string;
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly paymentMethodId: string | null;
  readonly paymentMethodLabel: string | null;
}

export interface DraftRankedRecordItem extends DraftRankedRecord {
  readonly rank: number;
  /** 与它并列（金额相同）的记录数，含自己。 */
  readonly tieCount: number;
  readonly share: DraftRational | null;
}

export interface DraftRankingResult {
  readonly items: readonly DraftRankedRecordItem[];
  readonly totalMinor: bigint | null;
  readonly tiePolicy: "amount-desc-date-asc-id-asc";
  readonly truncated: boolean;
  readonly sampleComplete: boolean;
}

/** 帕累托 / 集中度的一行（A08、P08 的累计派生根，非新结果形状）。 */
export interface DraftParetoRow {
  readonly id: string;
  readonly label: string;
  readonly amountMinor: bigint;
  readonly share: DraftRational;
  readonly cumulativeMinor: bigint;
  readonly cumulativeShare: DraftRational;
}

export interface DraftConcentration {
  readonly totalMinor: bigint;
  readonly rows: readonly DraftParetoRow[];
  /** TopN 占比；N 超过分类数时取全部分类。 */
  readonly ratios: readonly { readonly topN: number; readonly share: DraftRational; readonly coveredMinor: bigint }[];
}

/* ------------------------------------------------------------------------- *
 * C-2 新增形状（P09 排名迁移 / P10 记录级散点 / P11 分类气泡）
 *
 * 与 C-1 相同的约束：全部是草稿，不得被其他 Agent 引用；正式形状在 S-01 v2
 * 评审时统一映射（QC-18）。金额权威仍是 bigint，展示派生只在 web 适配层做。
 * ------------------------------------------------------------------------- */

/** P09 排名迁移的一行：两期名次与金额变化。 */
export interface DraftRankMigrationRow {
  readonly id: string;
  readonly label: string;
  /** 上期名次（1 起）；上期不存在该分类时为 null。 */
  readonly previousRank: number | null;
  /** 本期名次（1 起）；本期不存在该分类时为 null。 */
  readonly currentRank: number | null;
  /** 上期名次 - 本期名次；正数=名次上升；任一期缺失时为 null（不是 0）。 */
  readonly rankDelta: number | null;
  readonly previousMinor: bigint;
  readonly currentMinor: bigint;
  readonly amountDeltaMinor: bigint;
  readonly isNew: boolean;
  readonly isRemoved: boolean;
}

export interface DraftRankMigrationResult {
  readonly previousEntryCount: number;
  readonly currentEntryCount: number;
  readonly rows: readonly DraftRankMigrationRow[];
  /** 两期都存在且名次变化的分类数。 */
  readonly movedCount: number;
  readonly newCount: number;
  readonly removedCount: number;
  /** 名次口径：金额降序、同额按 id 升序、同额共享名次（competition rank）。 */
  readonly rankingPolicy: "amount-desc-id-asc-ties-share-rank";
}

/** P10 记录级散点的一个点（只含来源键与原始金额，不含展示字段）。 */
export interface DraftScatterPoint {
  readonly id: string;
  readonly occurredLocalDate: string;
  readonly amountMinor: bigint;
  readonly categoryId: string;
}

export interface DraftScatterResult {
  readonly points: readonly DraftScatterPoint[];
  readonly sampleCount: number;
  readonly plottedCount: number;
  /** 因超过 maxPoints 而未绘制的记录数；必须是显式事实，不允许静默丢弃。 */
  readonly omittedCount: number;
  /** none = 全量绘制；top-amount = 按金额取前 N 后按日期排序（确定性抽样）。 */
  readonly strategy: "none" | "top-amount";
  /** omittedCount === 0 时为 true。 */
  readonly complete: boolean;
  readonly completeness: DraftCompleteness;
}

/** P11 分类气泡的一个气泡：金额、笔数与派生均值（均值是权威计算，份额是展示派生）。 */
export interface DraftBubbleDatum {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly count: number;
  readonly sumMinor: bigint;
  /** sum / count；count = 0 时为 null（不写 0）。 */
  readonly meanMinor: DraftRational | null;
  /** sum / total；total = 0 时为 null。 */
  readonly shareOfTotal: DraftRational | null;
}

export interface DraftBubbleResult {
  readonly bubbles: readonly DraftBubbleDatum[];
  readonly totalMinor: bigint;
  readonly totalCount: number;
  readonly completeness: DraftCompleteness;
}

/* ------------------------------------------------------------------------- *
 * C-2 第二批：P12 / P13 / P14 / P15 / P21（QC-21…QC-25，待 S-01 v2 映射）
 * ------------------------------------------------------------------------- */

/**
 * P12 分类箱线图的一组：单笔金额的 min / Q1 / 中位 / Q3 / max / IQR 与可选离群点。
 * 分位与围栏用有理数精确表示；展示层只做 `minor-half-away-v1` 舍入后的文本。
 */
export interface DraftBoxplotGroup {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly sampleCount: number;
  readonly minMinor: bigint;
  readonly maxMinor: bigint;
  readonly q1: DraftRational;
  readonly median: DraftRational;
  readonly q3: DraftRational;
  readonly iqr: DraftRational;
  readonly lowerFence: DraftRational;
  readonly upperFence: DraftRational;
  /** 离群点总数（可能大于 `outlierMinors.length`，后者受 maxOutliersPerGroup 限制）。 */
  readonly outlierCount: number;
  /** 回传的离群点（金额升序；最多 maxOutliersPerGroup 个）。 */
  readonly outlierMinors: readonly bigint[];
  /** 样本数达到 minReliableSample；false 时展示层必须弱化箱体，不得当作同等可信。 */
  readonly reliable: boolean;
}

export interface DraftBoxplotResult {
  readonly groups: readonly DraftBoxplotGroup[];
  readonly minReliableSample: number;
  /** 分位方法：所有分类必须一致（owner 规格 §28 正确性）。 */
  readonly quantileMethod: "type7-linear";
  readonly completeness: DraftCompleteness;
}

/** P13 交叉表指标（受控允许列表）。 */
export type DraftPivotMetric = "amount" | "count" | "average" | "share";

/** P13 的行/列/总计聚合：金额与笔数是权威，metricValue 是同一口径的派生。 */
export interface DraftPivotAggregate {
  readonly amountMinor: bigint;
  readonly count: number;
  /** 按 metric 派生：average 在笔数 0 时为 null，share 在总额 0 时为 null（不写 0）。 */
  readonly metricValue: DraftRational | null;
}

export interface DraftPivotCell extends DraftPivotAggregate {
  readonly rowId: string;
  readonly colId: string;
}

export interface DraftPivotResult {
  readonly rowDimension: import("./dimensions.js").AdvancedDimension;
  readonly colDimension: import("./dimensions.js").AdvancedDimension;
  readonly metric: DraftPivotMetric;
  readonly rowIds: readonly string[];
  readonly colIds: readonly string[];
  readonly rowLabels: ReadonlyMap<string, string>;
  readonly colLabels: ReadonlyMap<string, string>;
  readonly cells: readonly DraftPivotCell[];
  readonly rowTotals: ReadonlyMap<string, DraftPivotAggregate>;
  readonly colTotals: ReadonlyMap<string, DraftPivotAggregate>;
  readonly grandTotal: DraftPivotAggregate;
  readonly sampleCount: number;
  readonly completeness: DraftCompleteness;
  /** Σ cells ⇔ 总计的守恒自检（展示层不得重算合计，只能消费）。 */
  readonly conservation: {
    readonly amountsMatch: boolean;
    readonly countsMatch: boolean;
  };
}

/** P14 小多图的一个时间点。 */
export interface DraftSmallMultiplePoint {
  readonly bucketKey: string;
  readonly valueMinor: bigint;
  readonly count: number;
}

export interface DraftSmallMultiplePanel {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly points: readonly DraftSmallMultiplePoint[];
  readonly totalMinor: bigint;
  readonly maxMinor: bigint;
}

export interface DraftSmallMultiplesResult {
  readonly panels: readonly DraftSmallMultiplePanel[];
  readonly bucketKeys: readonly string[];
  readonly bucketLabels: readonly string[];
  /** 共享纵轴的最大单桶值（所有回传面板）。 */
  readonly sharedMaxMinor: bigint;
  /** 每个分类自己的最大单桶值；仅在显式选择独立尺度时使用。 */
  readonly panelMaxMinor: ReadonlyMap<string, bigint>;
  readonly scaleMode: "shared" | "independent";
  readonly topN: number;
  readonly truncated: boolean;
  readonly omittedCategoryCount: number;
  readonly completeness: DraftCompleteness;
}

/** P15 日历指标。 */
export type DraftCalendarMetric = "expense" | "income" | "count";

/** P15 日期状态；`no-data` 是真实的零，`unknown` 是覆盖未知，二者不得混淆。 */
export type DraftCalendarDayState = "complete" | "no-data" | "in-progress" | "future" | "unknown";

export interface DraftCalendarDay {
  /** `YYYY-MM-DD`。 */
  readonly date: string;
  /** ISO 星期：周一 = 1 … 周日 = 7。 */
  readonly weekday: number;
  readonly month: number;
  /** 周一起始的年内周列号（0 基）。 */
  readonly weekIndex: number;
  /** 指标值：金额小单位（expense/income）或笔数（count）。 */
  readonly valueMinor: bigint;
  readonly count: number;
  readonly state: DraftCalendarDayState;
}

export interface DraftCalendarResult {
  readonly year: number;
  readonly metric: DraftCalendarMetric;
  readonly leapYear: boolean;
  /** 365 或 366；`days.length` 必须等于它。 */
  readonly dayCount: number;
  /** 年度热力日历的列数（周数，52 或 53）。 */
  readonly weekCount: number;
  readonly days: readonly DraftCalendarDay[];
  /** 每个月的 1 号落在第几列（0 基，长度 12）。 */
  readonly monthStartWeekIndex: readonly number[];
  readonly totalMinor: bigint;
  readonly totalCount: number;
  readonly recordCount: number;
  readonly noDataDayCount: number;
  readonly unknownDayCount: number;
  readonly futureDayCount: number;
  readonly inProgressDayCount: number;
  /** 有数据日期的强度范围；无任何数据时为 null。 */
  readonly intensityMinMinor: bigint | null;
  readonly intensityMaxMinor: bigint | null;
  readonly completeness: DraftCompleteness;
}

/** P21 能力检查的拒绝原因（可展示，不抛异常）。 */
export type DraftCubeRejectionReason =
  | "unsupported-dimension"
  | "duplicate-dimension"
  | "too-many-dimensions"
  | "unsupported-metric"
  | "mixed-currency"
  | "too-many-combinations";

export interface DraftCubeAxis {
  readonly dimension: import("./dimensions.js").AdvancedDimension;
  readonly values: readonly string[];
  readonly labels: ReadonlyMap<string, string>;
}

export interface DraftCrossCubeCell {
  /** 按 `dimensions` 顺序的维度键。 */
  readonly coords: readonly string[];
  readonly amountMinor: bigint;
  readonly count: number;
}

export interface DraftCrossCubeResult {
  readonly metric: "amount" | "count";
  readonly dimensions: readonly import("./dimensions.js").AdvancedDimension[];
  readonly axes: readonly DraftCubeAxis[];
  readonly cells: readonly DraftCrossCubeCell[];
  readonly totalMinor: bigint;
  readonly totalCount: number;
  readonly scaleNodeCount: readonly number[];
  /** 维度取值的笛卡尔积大小（成本控制用）。 */
  readonly combinations: number;
  readonly filledCellCount: number;
  readonly completeness: DraftCompleteness;
  readonly supportedDimensions: readonly import("./dimensions.js").AdvancedDimension[];
  readonly dimensionPositions: ReadonlyMap<import("./dimensions.js").AdvancedDimension, number>;
}

