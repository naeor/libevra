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
