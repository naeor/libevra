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

/* ------------------------------------------------------------------------- *
 * C-3 新增形状：P05 分类层级 / P06 矩形树图 / P07 层级桑基（QC-27…QC-29）
 *
 * 重要：真实分类模型当前**没有 parentId**（QC-03）。C-3 的层级输入是一个显式
 * 的「分类关系表」占位（`DraftCategoryRelation[]`，由未来的数据模型扩展或上层
 * 投影提供）。C 绝不根据分类名称推断父子关系；没有真实关系时，结果必须带
 * `isRealHierarchy=false`，展示层不得声称这是业务层级（owner 规格 §21/§23）。
 * ------------------------------------------------------------------------- */

/** 层级节点类型：root 是合成根；category 是真实分类；direct 是桑基里的「直接金额」终端。 */
export type DraftHierarchyNodeKind = "root" | "category" | "direct";

/** 分类层级关系的一行（占位输入，不是数据模型；见 QC-27）。 */
export interface DraftCategoryRelation {
  readonly categoryId: string;
  readonly categoryLabel: string;
  /** `null` = 顶层分类。 */
  readonly parentCategoryId: string | null;
}

/** 层级树的一个节点；金额为币种最小单位，`subtree*` 含自身直接金额与全部后代。 */
export interface DraftHierarchyNode {
  readonly nodeId: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly kind: DraftHierarchyNodeKind;
  readonly label: string;
  /** 该节点自身的直接交易金额（不含子级）。 */
  readonly directAmountMinor: bigint;
  readonly directCount: number;
  /** 自己 + 全部后代的金额（同一笔交易只计入一个节点）。 */
  readonly subtreeAmountMinor: bigint;
  readonly subtreeCount: number;
  readonly childCount: number;
  readonly isLeaf: boolean;
  /** 分类有效：记录里出现但关系表中没有该分类（历史/孤立节点）。 */
  readonly hasMissingRelation: boolean;
}

export interface DraftHierarchyResult {
  readonly rootId: string;
  /** 指标：支出或收入（金额权威；笔数附带在节点上）。 */
  readonly metric: "expense" | "income";
  readonly currency: string;
  readonly nodes: readonly DraftHierarchyNode[];
  readonly maxDepth: number;
  /** 关系表里至少有一条真实父子边，且没有被丢弃的孤儿父引用。 */
  readonly isRealHierarchy: boolean;
  /** 出现未声明的分类（不能保证层级完整）。 */
  readonly hasUnknownCategories: boolean;
  /** 父引用指向未声明分类的关系行；这些子分类按顶层处理并在此登记。 */
  readonly orphanRelationCategoryIds: readonly string[];
  readonly totalAmountMinor: bigint;
  readonly totalCount: number;
  readonly conservation: {
    /** 根节点子树金额必须等于全部直接金额之和（不得重复计数）。 */
    readonly rootSubtreeAmountMinor: bigint;
    /** 逐节点校验 `subtree = direct + Σ children.subtree`。 */
    readonly nodesConserved: boolean;
    /** 无重复计数：Σ 所有节点 direct 必须等于根子树。 */
    readonly noDoubleCounting: boolean;
    /** 每个直接金额都在叶子或 direct 终端上结束了路径。 */
    readonly edgesConserved: boolean;
  };
  readonly completeness: DraftCompleteness;
}

/** P07 桑基的一条连线：只表示真实层级归属（父级 → 子级 / 父级 → 直接金额终端）。 */
export interface DraftSankeyLink {
  readonly fromId: string;
  readonly toId: string;
  readonly amountMinor: bigint;
  /** 占源节点子树金额的份额；源节点为 0 时为 null（不写 0）。 */
  readonly shareOfSource: DraftRational | null;
}

export interface DraftSankeyNode {
  readonly nodeId: string;
  readonly label: string;
  readonly depth: number;
  readonly kind: DraftHierarchyNodeKind;
  /** 流入金额：根为 0，分类为父级连线金额，direct 终端为其直接金额。 */
  readonly inflowMinor: bigint;
  readonly outflowMinor: bigint;
  /** 终端（叶子或 direct 终端）不再向外流动。 */
  readonly isTerminal: boolean;
}

export interface DraftSankeyResult {
  readonly rootId: string;
  readonly metric: "expense" | "income";
  readonly currency: string;
  readonly totalMinor: bigint;
  readonly nodes: readonly DraftSankeyNode[];
  readonly links: readonly DraftSankeyLink[];
  readonly isRealHierarchy: boolean;
  readonly hasUnknownCategories: boolean;
  readonly conservation: {
    readonly rootOutflowMatchesTotal: boolean;
    readonly allInflowsMatch: boolean;
    readonly outflowConserved: boolean;
    readonly noNegativeLinks: boolean;
  };
  readonly completeness: DraftCompleteness;
}

/* ------------------------------------------------------------------------- *
 * C-4 · P16–P20 汇率诊断草案（QC-12、QC-29）
 *
 * 权威来源约定（owner 规格 §32–§36、§49；S-01 v2 §6.7）：
 * - 折算只能复用权威 FX 引擎（S16-D `aggregateFxAsync` 的逐笔舍入与 7 天
 *   回退策略）；本草案用「合成汇率观测夹具」表达同一语义，不接入新服务、
 *   不在图表层自行发明汇率。
 * - 缺失汇率必须显式进入完整性状态，绝不当作 0 参与合计。
 * - 不同原币金额不得直接相加；P16 只比较交易数量。
 * - P18 只展示系统实际持有的离散观测，不插值生成完整行情。
 * - 金额一律 bigint 最小单位；汇率用精确有理数 numerator/denominator。
 * ------------------------------------------------------------------------- */

/**
 * FX 诊断完整性：比 C-1 的 `DraftCompleteness` 多一态「部分可折算」。
 * `partial` 表示「有记录因缺汇率/未知汇率无法折算」——必须显式标注，
 * 不能把无法折算的记录静默丢弃后按完整结果展示。
 */
export type DraftFxCompleteness = "complete" | "partial" | "no-transactions" | "unavailable";

/** P16–P20 的交易视图：只含汇率诊断需要的字段（原币、方向、金额、业务日期）。 */
export interface DraftFxRecord {
  readonly id: string;
  readonly kind: "expense" | "income";
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly occurredLocalDate: string;
}

/**
 * 权威 FX 引擎的一条离散汇率观测（合成夹具用；真实来源由 S16-D / 只读投影提供）。
 * `rateNumerator / rateDenominator`：1 个 base 币单位 = 该分数个 quote 币单位。
 */
export interface DraftFxRateObservation {
  readonly provider: string;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rateDate: string;
  readonly rateNumerator: bigint;
  readonly rateDenominator: bigint;
}

/** 单笔交易的实际汇率解析结果（P17–P20 共用；缺失时无汇率、无回退天数）。 */
export interface DraftFxRateResolution {
  readonly currency: string;
  readonly targetCurrency: string;
  /** 交易业务日期（请求折算的日期）。 */
  readonly requestedDate: string;
  /** 实际使用的汇率日期；缺失时为 null。 */
  readonly rateDate: string | null;
  /** 0 = 直接命中；缺失时为 null；其余为向前回退的天数。 */
  readonly fallbackDays: number | null;
  readonly provider: string | null;
  /** 实际使用的精确汇率（1 base = numerator/denominator）；identity 与 missing 时为 null。 */
  readonly rateNumerator: bigint | null;
  readonly rateDenominator: bigint | null;
  readonly status: "identity" | "exact" | "fallback" | "missing";
}

/** P16 币种交易构成的一行：只比较交易数量；原币金额分币种显示。 */
export interface DraftCurrencyCompositionRow {
  readonly currency: string;
  readonly recordCount: number;
  readonly incomeCount: number;
  readonly expenseCount: number;
  /** 该币种原币收入合计（最小单位）；不得与其他币种相加。 */
  readonly incomeAmountMinor: bigint;
  /** 该币种原币支出合计（最小单位）；不得与其他币种相加。 */
  readonly expenseAmountMinor: bigint;
  /** recordCount / 总记录数；总数为 0 时为 null。 */
  readonly recordShare: DraftRational | null;
}

export interface DraftCurrencyCompositionResult {
  readonly rows: readonly DraftCurrencyCompositionRow[];
  readonly totalRecordCount: number;
  readonly currencyCount: number;
  readonly completeness: DraftCompleteness;
}

/** P17 综合金额币种贡献的一行：已折算到目标币；缺汇率单独计数，不折算成 0。 */
export interface DraftFxContributionRow {
  readonly currency: string;
  /** 该币种原币金额合计（最小单位，仅该币种内部相加）。 */
  readonly originalSumMinor: bigint;
  /** 成功折算到目标币的金额合计（最小单位）。 */
  readonly convertedMinor: bigint;
  readonly convertedCount: number;
  readonly missingCount: number;
  readonly fallbackCount: number;
  /** convertedMinor / 已折算总额；总额为 0 时为 null。 */
  readonly shareOfConverted: DraftRational | null;
}

export interface DraftFxContributionResult {
  readonly targetCurrency: string;
  readonly rows: readonly DraftFxContributionRow[];
  /** 仅「实际折算成功（含 identity）」的金额合计；缺汇率不计入。 */
  readonly totalConvertedMinor: bigint;
  readonly convertedCount: number;
  readonly identityCount: number;
  readonly fallbackCount: number;
  readonly missingCount: number;
  /** 份额分母只覆盖「已折算」部分——展示层必须写明，不得暗示覆盖全部金额。 */
  readonly sharesOverConvertedOnly: true;
  readonly missingRecords: readonly {
    readonly id: string;
    readonly currency: string;
    readonly occurredLocalDate: string;
  }[];
  /** `missingRecords` 是否被截断（缺失总数仍以 missingCount 为准）。 */
  readonly missingRecordsTruncated: boolean;
  readonly completeness: DraftFxCompleteness;
}

/** P18 汇率趋势的一个离散观测点（只画真实观测，不插值）。 */
export interface DraftFxRatePoint {
  readonly currency: string;
  readonly targetCurrency: string;
  readonly rateDate: string;
  readonly provider: string;
  readonly rateNumerator: bigint;
  readonly rateDenominator: bigint;
  /** 汇率定点小数（6 位），仅展示用；权威值仍是上面的分数。 */
  readonly rateScaled: DraftScaledDecimal;
}

export interface DraftFxRateTrendResult {
  readonly currency: string;
  readonly targetCurrency: string;
  readonly points: readonly DraftFxRatePoint[];
  readonly from: string;
  readonly to: string;
  readonly observationCount: number;
  /** [from, to] 内无观测的自然日数量（趋势不得插值补点）。 */
  readonly missingDateCount: number;
  readonly missingDates: readonly string[];
  readonly interpolation: "none";
  /** (末点 - 首点) / 首点；少于两个观测时为 null。 */
  readonly change: DraftRational | null;
  readonly minPoint: DraftFxRatePoint | null;
  readonly maxPoint: DraftFxRatePoint | null;
  readonly completeness: DraftCompleteness;
}

/** P19 完整性矩阵单元格：按「币种 × 日期」的实际可折算状态。 */
export interface DraftFxCoverageCell {
  readonly currency: string;
  readonly date: string;
  readonly status: "exact" | "fallback" | "missing" | "not-needed";
  readonly recordCount: number;
}

export interface DraftFxCoverageRow {
  readonly currency: string;
  readonly recordCount: number;
  readonly convertedCount: number;
  readonly missingCount: number;
  readonly exactCount: number;
  readonly fallbackCount: number;
  /** convertedCount / 需要折算的记录数；分母为 0 时为 null。 */
  readonly coverage: DraftRational | null;
}

export interface DraftFxCoverageResult {
  readonly targetCurrency: string;
  readonly currencies: readonly string[];
  readonly dates: readonly string[];
  readonly cells: readonly DraftFxCoverageCell[];
  readonly needsConversionCount: number;
  readonly convertedCount: number;
  readonly missingCount: number;
  readonly exactCount: number;
  readonly fallbackCount: number;
  readonly notNeededCount: number;
  /** convertedCount / needsConversionCount；分母为 0 时为 null。 */
  readonly coverageRatio: DraftRational | null;
  /** 首版没有金额覆盖率：可用记录数不等于金额覆盖（owner 规格 §35）。 */
  readonly amountCoverageAvailable: false;
  readonly amountCoverageReason: string;
  readonly missingCombinations: readonly {
    readonly currency: string;
    readonly date: string;
    readonly recordCount: number;
  }[];
  readonly rows: readonly DraftFxCoverageRow[];
  readonly completeness: DraftFxCompleteness;
}

/** P20 回退使用分析按币种的一行。 */
export interface DraftFxFallbackRow {
  readonly currency: string;
  readonly directCount: number;
  readonly fallbackCount: number;
  readonly missingCount: number;
  readonly fallbackDays: readonly { readonly fallbackDays: number; readonly count: number }[];
}

export interface DraftFxFallbackResult {
  readonly targetCurrency: string;
  readonly fallbackRecordCount: number;
  readonly needsConversionCount: number;
  readonly maxFallbackDays: number;
  readonly fallbackDaysDistribution: readonly {
    readonly fallbackDays: number;
    readonly count: number;
  }[];
  readonly rows: readonly DraftFxFallbackRow[];
  readonly providers: readonly { readonly provider: string; readonly count: number }[];
  readonly dates: readonly { readonly date: string; readonly count: number }[];
  readonly missingRateCount: number;
  readonly completeness: DraftFxCompleteness;
}

