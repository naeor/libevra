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
 * **时间序列计算（B-1）**——I06–I10、I19、I20 背后的算术。
 *
 * 这一层只做“把账目按业务日期分桶并求和”这件事，不知道自己被哪个页面使用，
 * 也不知道图表长什么样。它输出的是**权威金额**（以分为单位的精确整数，用字符串
 * 承载以避开 `number` 的 2^53 限制），绘图时再降级为坐标数字。
 *
 * 三条不可协商的规则：
 *
 *  * **业务日期即 `occurredLocalDate`**：日期是 `YYYY-MM-DD` 的日历日，不经过
 *    UTC 午夜、不按当前设备时区重新换算（详见 `timeCalendar.ts`）。
 *  * **零不等于未知**：一个桶只有被数据覆盖（`coverageEnd` 覆盖到它的最后一天）
 *    才是“确认的 0”；覆盖不到的桶是未知，金额为 `null`，不得写成 0。
 *  * **未来不是零**：桶在 `today` 之后开始时没有金额，也没有“0 支出”的含义。
 *
 * 汇总（`totalMinor`）只累加可计算的桶；只要有一个桶未知，完整汇总就是未知
 * （`null`），不会给出一个看起来精确、实际漏钱的数字。
 */

/** 结果结构版本。与 `TIME_CONTRACT_VERSION` 一起构成缓存键的一部分。 */
export const TIME_SERIES_VERSION = "s17-b-time-series-v1" as const;

/** 时间序列指标：金额（支出/收入）或交易笔数。 */
export type TimeSeriesMetric = "expense" | "income" | "count";

/** 交易笔数统计口径。I19 三种都支持，默认全部交易。 */
export type CountKind = "all" | "expense" | "income";

/** 桶金额不可计算的原因。 */
export type UnknownReason = "coverage-missing" | "not-yet-happened";

/**
 * 一条参与统计的账目。
 *
 * 调用方负责**币种口径**：原币模式只传一种币种的账目；综合模式传入已按权威
 * 逐笔汇率折算好的目标币种金额。这里不做汇率，也不做币种换算。
 *
 * `amountMinor` 是金额绝对值（分），符号由 `kind` 决定；支出与收入都传正数。
 */
export interface TimeSeriesEntry {
  readonly occurredLocalDate: string;
  readonly kind: "expense" | "income";
  readonly amountMinor: bigint | number;
}

export interface TimeSeriesOptions {
  readonly metric: TimeSeriesMetric;
  readonly granularity: TimeGranularity;
  /** 半开区间 `[start, end)`，业务日历日。 */
  readonly span: TimeSpan;
  /** 设备本地的“今天”（业务日期）。服务端不决定今天。 */
  readonly today: string;
  /** 数据覆盖到的最后一天（已完整下载/已完整迁移）；`null` = 未知。 */
  readonly coverageEnd: string | null;
  /** 仅 `metric: "count"` 使用；默认 `"all"`。 */
  readonly countKind?: CountKind;
}

/** 一个时间桶的权威结果。 */
export interface TimeSeriesBucketPoint {
  readonly bucket: TimeBucket;
  /** 精确金额（分），十进制字符串；`null` = 未知/未来，不是 0。 */
  readonly amountMinor: string | null;
  /** 该桶内符合条件的交易笔数；未知/未来时为 `null`。 */
  readonly transactionCount: number | null;
  readonly unknownReason: UnknownReason | null;
}

export interface TimeSeriesResult {
  readonly version: typeof TIME_SERIES_VERSION;
  readonly metric: TimeSeriesMetric;
  readonly granularity: TimeGranularity;
  readonly span: TimeSpan;
  readonly buckets: readonly TimeSeriesBucketPoint[];
  /**
   * 可计算桶的精确合计（分），十进制字符串。
   *
   * 只要存在未知桶就是 `null`：一个漏了一天数据的“总支出”不是总支出。
   * 未来桶不参与合计（它们还没有发生），是否完整见 `complete`。
   */
  readonly totalMinor: string | null;
  readonly totalCount: number | null;
  /** 所有桶都可计算且都不是未来桶（即请求区间已被数据与时间共同覆盖）。 */
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

function isEligibleKind(
  metric: TimeSeriesMetric,
  countKind: CountKind,
  kind: "expense" | "income",
): boolean {
  if (metric === "expense") return kind === "expense";
  if (metric === "income") return kind === "income";
  if (countKind === "all") return true;
  return countKind === kind;
}

function unknownReasonOf(state: BucketState): UnknownReason | null {
  if (state === "future") return "not-yet-happened";
  if (state === "unknown" || state === "unavailable") return "coverage-missing";
  return null;
}

interface Accumulator {
  amount: bigint;
  count: number;
}

/**
 * 按桶累加账目并生成权威结果。
 *
 * 区间外的账目被忽略（调用方应已按区间筛选；这里忽略而不是抛错，避免一次
 * 分析因为上游多传了几笔而整体失败）。日期格式非法、金额不是整数则抛错——
 * 那属于调用方合同错误，静默吞掉只会产出错误的钱数。
 */
export function computeTimeSeries(
  entries: readonly TimeSeriesEntry[],
  options: TimeSeriesOptions,
): TimeSeriesResult {
  const span = parseTimeSpan(options.span);
  const today = assertCalendarDate(options.today);
  const coverageEnd = options.coverageEnd === null ? null : assertCalendarDate(options.coverageEnd);

  const countKind: CountKind = options.countKind ?? "all";
  const bucketList = enumerateBuckets(options.granularity, span, { today, coverageEnd });

  const byKey = new Map<string, Accumulator>();
  for (const bucket of bucketList) byKey.set(bucket.key, { amount: 0n, count: 0 });

  const needsAmount = options.metric !== "count";

  for (const entry of entries) {
    const date = assertCalendarDate(entry.occurredLocalDate);
    if (!spanContains(span, date)) continue;
    if (!isEligibleKind(options.metric, countKind, entry.kind)) continue;

    const bucket = byKey.get(bucketKeyOf(options.granularity, date));
    // enumerateBuckets 覆盖整个 span，理论上必然命中；防御性保留。
    if (bucket === undefined) continue;

    bucket.count += 1;
    if (needsAmount) {
      bucket.amount += toMinor(entry.amountMinor);
    }
  }

  const points: TimeSeriesBucketPoint[] = [];
  let totalMinor = 0n;
  let totalCount = 0;
  let unknownBucketCount = 0;
  let inProgressBucketCount = 0;
  let futureBucketCount = 0;
  let hasUnknown = false;

  for (const bucket of bucketList) {
    const accumulator = byKey.get(bucket.key) ?? { amount: 0n, count: 0 };
    const unknownReason = unknownReasonOf(bucket.state);
    const computable = unknownReason === null;

    if (bucket.state === "in-progress") inProgressBucketCount += 1;
    if (bucket.state === "future") futureBucketCount += 1;
    // 只有“覆盖未知”才是未知桶；未来桶不是未知，它们只是还没有金额。
    if (bucket.state === "unknown" || bucket.state === "unavailable") {
      unknownBucketCount += 1;
      hasUnknown = true;
    }

    const amount = computable && needsAmount ? accumulator.amount.toString() : null;
    const transactionCount = computable ? accumulator.count : null;

    if (computable) {
      totalMinor += accumulator.amount;
      totalCount += accumulator.count;
    }

    points.push({
      bucket,
      amountMinor: amount,
      transactionCount,
      unknownReason,
    });
  }

  return {
    version: TIME_SERIES_VERSION,
    metric: options.metric,
    granularity: options.granularity,
    span,
    buckets: points,
    totalMinor: !needsAmount || hasUnknown ? null : totalMinor.toString(),
    totalCount: hasUnknown ? null : totalCount,
    // 完整=没有未知桶，也没有“尚未结束/尚未发生”的桶。
    complete:
      unknownBucketCount === 0 && futureBucketCount === 0 && inProgressBucketCount === 0,
    unknownBucketCount,
    inProgressBucketCount,
    futureBucketCount,
  };
}

/** 累计序列中一个桶的结果。 */
export interface CumulativeBucketPoint {
  readonly bucket: TimeBucket;
  readonly deltaMinor: string | null;
  /** 从区间起点到该桶末日的累计值；一旦遇到未知桶则为 `null`。 */
  readonly cumulativeMinor: string | null;
  /** 该桶自身不可计算的原因；未知之前的桶为 `null`。 */
  readonly unknownReason: UnknownReason | "propagated" | null;
}

export interface CumulativeResult {
  readonly version: typeof TIME_SERIES_VERSION;
  readonly metric: TimeSeriesMetric;
  readonly granularity: TimeGranularity;
  readonly span: TimeSpan;
  readonly points: readonly CumulativeBucketPoint[];
  /** 区间末的累计值；存在未知/未来桶时为 `null`。 */
  readonly totalMinor: string | null;
  readonly complete: boolean;
  /** 第一个未知桶的 key；没有则为 `null`。 */
  readonly firstUnknownKey: string | null;
}

/**
 * 从单序列结果生成累计序列（I20）。
 *
 * 未知会向后传播：I20 明确要求“某一天存在未知支出金额时，后面日期的累计值
 * 可能全部无法确认为完整”。负数差额（冲销、退款）如实保留，不强制单调。
 */
export function accumulateSeries(series: TimeSeriesResult): CumulativeResult {
  const points: CumulativeBucketPoint[] = [];
  let running = 0n;
  let broken = false;
  let firstUnknownKey: string | null = null;

  for (const point of series.buckets) {
    if (broken) {
      points.push({
        bucket: point.bucket,
        deltaMinor: null,
        cumulativeMinor: null,
        unknownReason: "propagated",
      });
      continue;
    }

    const unavailable =
      point.bucket.state === "unknown" || point.bucket.state === "unavailable";
    const delta = point.amountMinor === null ? null : BigInt(point.amountMinor);

    if (unavailable || delta === null) {
      // 未知会污染之后所有累计值；未来桶只是“还没有金额”，不算数据缺失。
      if (unavailable) {
        broken = true;
        firstUnknownKey ??= point.bucket.key;
      }
      points.push({
        bucket: point.bucket,
        deltaMinor: null,
        cumulativeMinor: null,
        unknownReason: point.unknownReason ?? "propagated",
      });
      continue;
    }

    running += delta;
    points.push({
      bucket: point.bucket,
      deltaMinor: delta.toString(),
      cumulativeMinor: running.toString(),
      unknownReason: null,
    });
  }

  return {
    version: TIME_SERIES_VERSION,
    metric: series.metric,
    granularity: series.granularity,
    span: series.span,
    points,
    totalMinor: broken ? null : running.toString(),
    complete: !broken && series.complete,
    firstUnknownKey,
  };
}

/** 校验一组选项是否合法（给上层 API 做入口检查用，不重复计算）。 */
export function isTimeSeriesOptionsValid(options: TimeSeriesOptions): boolean {
  if (!isSpanValid(options.span)) return false;

  return true;
}
