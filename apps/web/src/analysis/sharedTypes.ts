/**
 * 与 `@libellum/shared` advanced 草案的**结构兼容声明**（C-1，DRAFT）。
 *
 * 为什么不直接 import shared 的深路径：
 * - C-1 草案不在 `@libellum/shared` 的公开 exports 里（未冻结，不能污染包入口）；
 * - 这里只声明「结构上需要什么字段」，shared 的结果对象可直接传入（TS 结构类型）；
 * - 等 S-01 v2 定稿后，改为正式协议类型的 import，此文件删除。
 */

export interface RatioLike {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface SharedMoney {
  readonly currency: string;
  readonly minor: bigint;
}

export interface SharedRankingItem {
  readonly id: string;
  readonly amountMinor: bigint;
  readonly kind: "expense" | "income";
  readonly occurredLocalDate: string;
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly paymentMethodId: string | null;
  readonly paymentMethodLabel: string | null;
  readonly rank: number;
  readonly tieCount: number;
  readonly share: RatioLike | null;
}

export interface SharedRankingResult {
  readonly items: readonly SharedRankingItem[];
  readonly totalMinor: bigint | null;
  readonly truncated: boolean;
  readonly sampleComplete: boolean;
}

export interface SharedContributionRow {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly previousMinor: bigint;
  readonly currentMinor: bigint;
  readonly deltaMinor: bigint;
  readonly deltaShare: RatioLike | null;
  readonly growth: RatioLike | null;
  readonly growthUnavailableReason: "previous-zero" | null;
  readonly isNew: boolean;
  readonly isRemoved: boolean;
}

export interface SharedContributionResult {
  readonly previousTotalMinor: bigint;
  readonly currentTotalMinor: bigint;
  readonly totalDeltaMinor: bigint;
  readonly rows: readonly SharedContributionRow[];
  readonly conservation: {
    readonly rowsDeltaMinor: bigint;
    readonly matchesTotal: boolean;
    readonly matchedBy: "categoryId";
  };
}

export interface SharedHistogramBin {
  readonly index: number;
  readonly lowerMinor: bigint;
  readonly upperMinor: bigint;
  readonly count: number;
  readonly isLast: boolean;
}

export interface SharedHistogram {
  readonly binWidthMinor: bigint;
  readonly bins: readonly SharedHistogramBin[];
  readonly sampleCount: number;
  readonly zeroCount: number;
  readonly minMinor: bigint;
  readonly maxMinor: bigint;
}

export interface SharedQuantile {
  readonly p: RatioLike;
  readonly valueMinor: RatioLike;
}

export interface SharedScaledDecimal {
  readonly scaled: bigint;
  readonly decimals: number;
}

export interface SharedDistributionSummary {
  readonly sampleCount: number;
  readonly completeness: "complete" | "no-transactions" | "unavailable";
  readonly minMinor: bigint | null;
  readonly maxMinor: bigint | null;
  readonly sumMinor: bigint;
  readonly mean: RatioLike | null;
  readonly median: RatioLike | null;
  readonly quantiles: readonly SharedQuantile[];
  readonly variance: RatioLike | null;
  readonly standardDeviation: SharedScaledDecimal | null;
  readonly coefficientOfVariation: RatioLike | null;
  readonly iqr: RatioLike | null;
  readonly histogram: SharedHistogram | null;
}

export interface SharedFenceResult {
  readonly q1: RatioLike;
  readonly q3: RatioLike;
  readonly iqr: RatioLike;
  readonly lowerFence: RatioLike;
  readonly upperFence: RatioLike;
  readonly outliers: readonly bigint[];
  readonly withinCount: number;
}

export interface SharedParetoRow {
  readonly id: string;
  readonly label: string;
  readonly amountMinor: bigint;
  readonly share: RatioLike;
  readonly cumulativeMinor: bigint;
  readonly cumulativeShare: RatioLike;
}

export interface SharedConcentration {
  readonly totalMinor: bigint;
  readonly rows: readonly SharedParetoRow[];
  readonly ratios: readonly {
    readonly topN: number;
    readonly share: RatioLike;
    readonly coveredMinor: bigint;
  }[];
}
