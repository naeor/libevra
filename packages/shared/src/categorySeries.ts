import {
  assertCalendarDate,
  bucketKeyOf,
  enumerateBuckets,
  isSpanValid,
  parseTimeSpan,
  spanContains,
  type BucketState,
  type TimeBucket,
  type TimeGranularity,
  type TimeSpan,
} from "./timeCalendar.js";

/**
 * **分类时间序列（B-2）**——I14、I15、I16 背后的算术。
 *
 * 与 `timeSeries.ts` 的分工：
 *
 *  * `timeSeries.ts` 回答“每个时间桶一共多少钱 / 多少笔”；
 *  * 这一层回答“每个时间桶里**每个分类**各多少钱”，并在此基础上给出权威的
 *    桶内占比（I16）。
 *
 * 四条不可协商的规则：
 *
 *  * **分类只看稳定 ID**：重命名不改变历史归属，同名不同 ID 不合并（I14 的边界）。
 *  * **分母是权威总额**：占比的分母是该桶全部（分类过滤后）金额，不是“选中
 *    分类的合计”。否则 Top N 的占比会自己凑成 100%，看着完整、其实漏掉了
 *    “其他”分类。
 *  * **总额为零不等于 0% 占比**：总支出为 0 的桶没有构成可谈，占比为 `null`，
 *    不能给每个分类一个“0%”再假装构成有效。
 *  * **未完成的桶只是部分构成**：当前周期的占比可以算，但必须标记
 *    `partial`，不能拿“月初两天的构成”冒充整月构成。
 */

/** 结果结构版本。与 `TIME_CONTRACT_VERSION` 一起构成缓存键的一部分。 */
export const CATEGORY_SERIES_VERSION = "s17-b-category-series-v1" as const;

/** 聚合“其他”分类时使用的稳定键（用户分类 ID 是 UUID，不会与之冲突）。 */
export const OTHER_CATEGORY_KEY = "__other__";

/** 分类桶不可计算的原因。 */
export type CategoryUnknownReason = "coverage-missing" | "not-yet-happened";

/** 一条参与分类统计的账目。金额是绝对值（分），符号由 `kind` 决定。 */
export interface CategorySeriesEntry {
  readonly occurredLocalDate: string;
  readonly kind: "expense" | "income";
  readonly amountMinor: bigint | number;
  readonly categoryId: string;
}

export interface CategorySeriesOptions {
  /** 只看支出的分类构成，或只看收入；不做混合口径。 */
  readonly kind: "expense" | "income";
  /** 用户选中的分类稳定 ID；顺序即图例/表格顺序。允许传 Top N 的结果。 */
  readonly categoryIds: readonly string[];
  readonly granularity: TimeGranularity;
  /** 半开区间 `[start, end)`，业务日历日。 */
  readonly span: TimeSpan;
  readonly today: string;
  readonly coverageEnd: string | null;
  /** `true` 时追加一条“其他”序列（= 该桶全部合计 − 选中分类合计）。 */
  readonly includeOther?: boolean;
}

export interface CategorySeriesPoint {
  readonly categoryId: string;
  /** 精确金额（分），十进制字符串；`null` = 未知/未来，不是 0。 */
  readonly amountMinor: string | null;
  readonly transactionCount: number | null;
  readonly unknownReason: CategoryUnknownReason | null;
}

export interface CategorySeriesBucket {
  readonly bucket: TimeBucket;
  readonly points: readonly CategorySeriesPoint[];
  /** 该桶全部（`kind` 过滤后）金额合计；未知/未来为 `null`。 */
  readonly totalMinor: string | null;
  readonly totalCount: number | null;
  readonly unknownReason: CategoryUnknownReason | null;
}

export interface CategorySeriesResult {
  readonly version: typeof CATEGORY_SERIES_VERSION;
  readonly kind: "expense" | "income";
  readonly granularity: TimeGranularity;
  readonly span: TimeSpan;
  /** 实际返回的序列键（`includeOther` 时为选中 ID + `OTHER_CATEGORY_KEY`）。 */
  readonly categoryIds: readonly string[];
  readonly buckets: readonly CategorySeriesBucket[];
  /** 全区间合计（分）；存在未知桶时为 `null`。 */
  readonly totalMinor: string | null;
  readonly totals: Readonly<Record<string, string | null>>;
  readonly complete: boolean;
  readonly unknownBucketCount: number;
  readonly inProgressBucketCount: number;
  readonly futureBucketCount: number;
}

function toMinor(value: bigint | number): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isInteger(value)) {
    throw new RangeError("金额必须是整数（以分为单位）");
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("金额超出可安全表示的整数范围");
  }

  return BigInt(value);
}

function unknownReasonOf(state: BucketState): CategoryUnknownReason | null {
  if (state === "future") return "not-yet-happened";
  if (state === "unknown" || state === "unavailable") return "coverage-missing";

  return null;
}

interface AmountAndCount {
  amount: bigint;
  count: number;
}

function emptyAmounts(): AmountAndCount {
  return { amount: 0n, count: 0 };
}

/** 去重并保持顺序；`includeOther` 时把“其他”键放在最后。 */
function normalizeCategoryIds(options: CategorySeriesOptions): string[] {
  const ids: string[] = [];
  for (const id of options.categoryIds) {
    if (id === OTHER_CATEGORY_KEY || ids.includes(id)) continue;
    ids.push(id);
  }
  if (options.includeOther === true) ids.push(OTHER_CATEGORY_KEY);

  return ids;
}

/**
 * 按桶 × 分类聚合并生成权威结果。
 *
 * 区间外的账目被忽略；日期非法、金额不是整数则抛错（调用方合同错误）。
 * 分类为空的账目照常计入桶合计（I16 的分母必须包含它们），只是没有自己的序列。
 */
export function computeCategorySeries(
  entries: readonly CategorySeriesEntry[],
  options: CategorySeriesOptions,
): CategorySeriesResult {
  const span = parseTimeSpan(options.span);
  const today = assertCalendarDate(options.today);
  const coverageEnd = options.coverageEnd === null ? null : assertCalendarDate(options.coverageEnd);

  const categoryIds = normalizeCategoryIds(options);
  const selected = new Set(
    categoryIds.filter((id) => id !== OTHER_CATEGORY_KEY),
  );
  const includeOther = categoryIds.includes(OTHER_CATEGORY_KEY);

  const bucketList = enumerateBuckets(options.granularity, span, { today, coverageEnd });
  const byKey = new Map<
    string,
    { total: AmountAndCount; categories: Map<string, AmountAndCount> }
  >();
  for (const bucket of bucketList) {
    byKey.set(bucket.key, { total: emptyAmounts(), categories: new Map() });
  }

  for (const entry of entries) {
    if (entry.kind !== options.kind) continue;
    const date = assertCalendarDate(entry.occurredLocalDate);
    if (!spanContains(span, date)) continue;

    const bucket = byKey.get(bucketKeyOf(options.granularity, date));
    if (bucket === undefined) continue;

    const amount = toMinor(entry.amountMinor);
    bucket.total.amount += amount;
    bucket.total.count += 1;

    if (!selected.has(entry.categoryId)) continue;
    const current = bucket.categories.get(entry.categoryId) ?? emptyAmounts();
    current.amount += amount;
    current.count += 1;
    bucket.categories.set(entry.categoryId, current);
  }

  const totals: Record<string, string | null> = {};
  for (const id of categoryIds) totals[id] = "0";

  const buckets: CategorySeriesBucket[] = [];
  let total = 0n;
  let hasUnknown = false;
  let unknownBucketCount = 0;
  let inProgressBucketCount = 0;
  let futureBucketCount = 0;

  for (const bucket of bucketList) {
    const accumulator = byKey.get(bucket.key) ?? { total: emptyAmounts(), categories: new Map() };
    const unknownReason = unknownReasonOf(bucket.state);
    const computable = unknownReason === null;

    if (bucket.state === "in-progress") inProgressBucketCount += 1;
    if (bucket.state === "future") futureBucketCount += 1;
    if (bucket.state === "unknown" || bucket.state === "unavailable") {
      unknownBucketCount += 1;
      hasUnknown = true;
    }

    const selectedSum = { amount: 0n, count: 0 };
    for (const [id, value] of accumulator.categories) {
      selectedSum.amount += value.amount;
      selectedSum.count += value.count;
      if (computable) {
        totals[id] = (BigInt(totals[id] ?? "0") + value.amount).toString();
      }
    }

    const points: CategorySeriesPoint[] = categoryIds.map((id) => {
      if (id === OTHER_CATEGORY_KEY) {
        const amount = accumulator.total.amount - selectedSum.amount;
        const count = accumulator.total.count - selectedSum.count;
        return {
          categoryId: id,
          amountMinor: computable && includeOther ? amount.toString() : null,
          transactionCount: computable ? count : null,
          unknownReason,
        };
      }
      const value = accumulator.categories.get(id) ?? emptyAmounts();
      return {
        categoryId: id,
        amountMinor: computable ? value.amount.toString() : null,
        transactionCount: computable ? value.count : null,
        unknownReason,
      };
    });

    if (computable) total += accumulator.total.amount;
    if (computable && includeOther) {
      const otherAmount = accumulator.total.amount - selectedSum.amount;
      totals[OTHER_CATEGORY_KEY] = (BigInt(totals[OTHER_CATEGORY_KEY] ?? "0") + otherAmount).toString();
    }

    buckets.push({
      bucket,
      points,
      totalMinor: computable ? accumulator.total.amount.toString() : null,
      totalCount: computable ? accumulator.total.count : null,
      unknownReason,
    });
  }

  if (hasUnknown) {
    for (const id of categoryIds) totals[id] = null;
  }

  return {
    version: CATEGORY_SERIES_VERSION,
    kind: options.kind,
    granularity: options.granularity,
    span,
    categoryIds,
    buckets,
    totalMinor: hasUnknown ? null : total.toString(),
    totals,
    complete: unknownBucketCount === 0 && futureBucketCount === 0 && inProgressBucketCount === 0,
    unknownBucketCount,
    inProgressBucketCount,
    futureBucketCount,
  };
}

/** 按全区间合计选出 Top N 分类（金额降序；合计未知的分类排在最后）。 */
export function topCategoriesByTotal(
  series: CategorySeriesResult,
  limit: number,
): string[] {
  const usable = series.categoryIds.filter((id) => id !== OTHER_CATEGORY_KEY);

  return [...usable]
    .sort((left, right) => {
      const a = series.totals[left] ?? null;
      const b = series.totals[right] ?? null;
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return BigInt(b) > BigInt(a) ? 1 : BigInt(b) < BigInt(a) ? -1 : 0;
    })
    .slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// I16：分类占比
// ---------------------------------------------------------------------------

/** 精确比例：`numeratorMinor / denominatorMinor`（都以分为单位）。不转浮点。 */
export interface ShareRatio {
  readonly numeratorMinor: string;
  readonly denominatorMinor: string;
}

export type CategoryShareState = "ok" | "in-progress" | "zero-total" | "unknown" | "future";

export interface CategorySharePoint {
  readonly categoryId: string;
  readonly valueMinor: string | null;
  /** `null`：该桶构成不可计算（总额为零/未知/未来），不是 0%。 */
  readonly share: ShareRatio | null;
}

export interface CategoryShareBucket {
  readonly bucket: TimeBucket;
  readonly totalMinor: string | null;
  readonly state: CategoryShareState;
  /** `true`：当前周期尚未结束，构成只是部分构成。 */
  readonly partial: boolean;
  readonly points: readonly CategorySharePoint[];
}

export interface CategoryShareResult {
  readonly version: typeof CATEGORY_SERIES_VERSION;
  readonly kind: "expense" | "income";
  readonly granularity: TimeGranularity;
  readonly span: TimeSpan;
  readonly categoryIds: readonly string[];
  readonly buckets: readonly CategoryShareBucket[];
  /** 所有桶都是可比较的完整构成。 */
  readonly complete: boolean;
  readonly zeroTotalBucketCount: number;
  readonly unknownBucketCount: number;
}

/**
 * 把分类金额序列变成桶内占比序列（I16）。
 *
 * 分母固定为该桶的权威总额（`CategorySeriesBucket.totalMinor`），因此
 * 选中的分类 + “其他” = 100% 是**可验证**的；只传部分分类时占比合计小于 100%
 * 恰恰说明还有未选分类，不会被静默归一化。总额为零时占比为 `null`，
 * 不给每个分类一个“0%”再假装构成有效。
 */
export function computeCategoryShares(series: CategorySeriesResult): CategoryShareResult {
  let zeroTotalBucketCount = 0;
  let unknownBucketCount = 0;

  const buckets: CategoryShareBucket[] = series.buckets.map((bucket) => {
    const total = bucket.totalMinor;
    let state: CategoryShareState;
    if (bucket.bucket.state === "unknown" || bucket.bucket.state === "unavailable") {
      state = "unknown";
    } else if (bucket.bucket.state === "future") {
      state = "future";
    } else if (total === null) {
      state = "unknown";
    } else if (BigInt(total) === 0n) {
      state = "zero-total";
    } else if (bucket.bucket.state === "in-progress") {
      state = "in-progress";
    } else {
      state = "ok";
    }

    if (state === "zero-total") zeroTotalBucketCount += 1;
    if (state === "unknown") unknownBucketCount += 1;

    const shareAvailable = state === "ok" || state === "in-progress";
    const points: CategorySharePoint[] = bucket.points.map((point) => ({
      categoryId: point.categoryId,
      valueMinor: point.amountMinor,
      share:
        shareAvailable && point.amountMinor !== null && total !== null
          ? { numeratorMinor: point.amountMinor, denominatorMinor: total }
          : null,
    }));

    return {
      bucket: bucket.bucket,
      totalMinor: total,
      state,
      partial: state === "in-progress",
      points,
    };
  });

  return {
    version: CATEGORY_SERIES_VERSION,
    kind: series.kind,
    granularity: series.granularity,
    span: series.span,
    categoryIds: series.categoryIds,
    buckets,
    complete: buckets.every((bucket) => bucket.state === "ok"),
    zeroTotalBucketCount,
    unknownBucketCount,
  };
}

/** 校验一组选项是否合法（给上层入口检查用，不重复计算）。 */
export function isCategorySeriesOptionsValid(options: CategorySeriesOptions): boolean {
  if (!isSpanValid(options.span)) return false;
  if (options.categoryIds.includes(OTHER_CATEGORY_KEY)) return false;

  return true;
}

/** 给 UI 用：判断桶内构成是否可完整展示（不参与计算）。 */
export function isCompositionComplete(series: CategoryShareResult): boolean {
  return series.complete;
}
