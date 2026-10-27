/**
 * P12 · 分类金额箱线图（DRAFT，未冻结）。
 *
 * 每个分类一组单笔金额分布，字段沿用 owner 规格 §28：最小 / Q1 / 中位 / Q3 / 最大 /
 * IQR / 样本数 / 可选离群点。分位数一律走 C-1 的 Type 7 线性插值（`quantiles.ts`），
 * 不同分类必须用同一方法（规格要求），所以本模块不提供按分类切换分位算法的选项。
 *
 * 样本过少时统计意义弱：`reliable = sampleCount >= minReliableSample`（默认 5）。
 * 这里不替展示层做决定，只把「不可靠」作为显式事实交给图表层弱化。
 *
 * 离群点使用 1.5×IQR 围栏（C-1 `iqrFences`），围栏与样本做有理数比较，不先舍入。
 */

import { iqrFences } from "./distribution.js";
import { medianOf } from "./quantiles.js";
import { compareRational } from "./rational.js";
import type { DraftBoxplotGroup, DraftBoxplotResult, DraftRational } from "./draftTypes.js";
import { assertRecordShape, type AdvancedRecord } from "./dimensions.js";

export const BOXPLOT_MIN_RELIABLE_SAMPLE = 5;
export const BOXPLOT_DEFAULT_MAX_OUTLIERS = 20;
export const BOXPLOT_QUANTILE_METHOD = "type7-linear" as const;

export interface BoxplotOptions {
  /** 只统计一个方向；默认支出（分类金额分布）。 */
  readonly kind?: "expense" | "income";
  /** 判定「箱体统计意义足够」的最小样本数；默认 5。 */
  readonly minReliableSample?: number;
  /** IQR 围栏倍数；默认 3/2。 */
  readonly fenceMultiplier?: DraftRational;
  /** 每组最多回传多少个离群点（按金额降序取大者）；默认 20，0 表示不返回离群点。 */
  readonly maxOutliersPerGroup?: number;
}

interface GroupBucket {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly amounts: bigint[];
}

/**
 * 分类 → 箱线摘要。
 *
 * @throws {RangeError} 记录金额为负、日期非法、参数非法。
 */
export function boxplotByCategory(
  records: readonly AdvancedRecord[],
  options: BoxplotOptions = {},
): DraftBoxplotResult {
  const kind = options.kind ?? "expense";
  const minReliableSample = options.minReliableSample ?? BOXPLOT_MIN_RELIABLE_SAMPLE;
  const maxOutliersPerGroup = options.maxOutliersPerGroup ?? BOXPLOT_DEFAULT_MAX_OUTLIERS;

  if (kind !== "expense" && kind !== "income") throw new RangeError(`unsupported kind: ${String(kind)}`);
  if (!Number.isInteger(minReliableSample) || minReliableSample < 1) {
    throw new RangeError(`minReliableSample must be a positive integer, received: ${String(minReliableSample)}`);
  }
  if (!Number.isInteger(maxOutliersPerGroup) || maxOutliersPerGroup < 0) {
    throw new RangeError(`maxOutliersPerGroup must be a non-negative integer, received: ${String(maxOutliersPerGroup)}`);
  }

  const buckets = new Map<string, GroupBucket>();

  for (const record of records) {
    assertRecordShape(record);
    if (record.kind !== kind) continue;

    const existing = buckets.get(record.categoryId);
    if (existing === undefined) {
      buckets.set(record.categoryId, {
        categoryId: record.categoryId,
        categoryLabel: record.categoryLabel,
        amounts: [record.amountMinor],
      });
    } else {
      existing.amounts.push(record.amountMinor);
    }
  }

  const groups: DraftBoxplotGroup[] = [];

  for (const bucket of buckets.values()) {
    const sorted = [...bucket.amounts].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    const fences = iqrFences(sorted, options.fenceMultiplier);
    const median = medianOf(sorted);
    if (median === null) throw new Error(`medianOf returned null for a non-empty sample: ${bucket.categoryId}`);

    const outliersAscending = [...fences.outliers].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    const keptOutliers =
      maxOutliersPerGroup === 0
        ? []
        : [...outliersAscending].reverse().slice(0, maxOutliersPerGroup).reverse();

    groups.push({
      categoryId: bucket.categoryId,
      categoryLabel: bucket.categoryLabel,
      sampleCount: sorted.length,
      minMinor: sorted[0] as bigint,
      maxMinor: sorted[sorted.length - 1] as bigint,
      q1: fences.q1,
      median,
      q3: fences.q3,
      iqr: fences.iqr,
      lowerFence: fences.lowerFence,
      upperFence: fences.upperFence,
      outlierCount: fences.outliers.length,
      outlierMinors: keptOutliers,
      reliable: sorted.length >= minReliableSample,
    });
  }

  // 稳定排序：中位数降序，再按分类 id 升序（同额不靠哈希顺序）。
  groups.sort((left, right) => {
    const byMedian = compareRational(right.median, left.median);
    if (byMedian !== 0) return byMedian;
    return left.categoryId < right.categoryId ? -1 : left.categoryId > right.categoryId ? 1 : 0;
  });

  return {
    groups,
    minReliableSample,
    quantileMethod: BOXPLOT_QUANTILE_METHOD,
    completeness: groups.length === 0 ? "no-transactions" : "complete",
  };
}

/** 箱线图（单分布或分类分组）的局部不变量：Q1 ≤ 中位 ≤ Q3 ≤ 最大，且围栏有序。 */
export function boxplotGroupIsOrdered(group: DraftBoxplotGroup): boolean {
  const q1 = compareRational(group.q1, group.median);
  const medianToQ3 = compareRational(group.median, group.q3);
  const q3ToMax = compareRational(group.q3, { numerator: group.maxMinor, denominator: 1n });
  const q1ToMin = compareRational({ numerator: group.minMinor, denominator: 1n }, group.q1);
  const lowerToQ1 = compareRational(group.lowerFence, group.q1);
  const q3ToUpper = compareRational(group.q3, group.upperFence);

  return q1 <= 0 && medianToQ3 <= 0 && q3ToMax <= 0 && q1ToMin <= 0 && lowerToQ1 <= 0 && q3ToUpper <= 0;
}
