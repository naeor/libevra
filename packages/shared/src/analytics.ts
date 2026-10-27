import { z } from "zod";

import { currencySchema, transactionKindSchema, uuidSchema } from "./ledger.js";
import { MAX_STATS_DAYS, calendarDateSchema, daysBetween } from "./stats.js";

/**
 * T2 只读扩展的共享契约（所有者 2026-10-27 批准；任务文档 §15）。
 *
 * 这两个端点只 **读取** 账本数据：不新增表、不改迁移、不改交易写入路径，
 * 也不改变既有 `/api/v1/stats`、`/summary`、`/transactions` 的任何响应。
 *
 * 它们存在的唯一理由，是补上分析层真正需要的两件事：
 *
 * 1. **任意区间的逐笔数据**（`/analytics/transactions`）：综合模式要走既有
 *    `aggregateFxAsync` 逐笔折算，就必须拿得到逐笔的 `FxEntry`；现有明细接口
 *    只支持整月过滤，拼接月份会在边界处漏账或重账。
 * 2. **服务端极值/天数聚合**（`/analytics/extremes`）：B09/B10/B17 的命中记录、
 *    B11/B12/B13/B14/B20 的并列信息如果先拉全量再排序，客户端要承担泄漏面与
 *    性能风险，而且并列规则会在多处各写一遍。
 *
 * 金额以 **十进制字符串** 表示最小单位（与 S-01 的 `MoneyValue.amountMinor` 一致），
 * 现有端点仍保持 `number`，不受影响（A-Q14）。
 */

/** 逐笔查询默认页大小；分页参数见 `analyticsTransactionsQuerySchema`。 */
export const ANALYTICS_DEFAULT_PAGE_SIZE = 200;

/** 逐笔查询单页上限。一次拉四百天全部记录不是分析层该做的事。 */
export const ANALYTICS_MAX_PAGE_SIZE = 500;

/** 金额最小单位的十进制字符串；不使用浮点，避免大额时丢精度。 */
export const analyticsAmountMinorSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "金额最小单位应为十进制整数字符串");

function checkRange(value: { readonly from: string; readonly to: string }, ctx: z.RefinementCtx): void {
  if (value.from > value.to) {
    ctx.addIssue({ code: "custom", message: "开始日期不能晚于结束日期", path: ["from"] });
    return;
  }

  if (daysBetween(value.from, value.to) > MAX_STATS_DAYS) {
    ctx.addIssue({ code: "custom", message: `分析区间最长 ${String(MAX_STATS_DAYS)} 天`, path: ["to"] });
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/analytics/transactions
// ---------------------------------------------------------------------------

/**
 * 区间逐笔查询参数。
 *
 * `currency` 省略表示 **返回多币种**：综合模式需要逐笔原币数据再统一折算，
 * 而折算只能由 `packages/shared/src/fx.ts` 做（T2-Q4：服务端不做第二套汇率实现）。
 */
export const analyticsTransactionsQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    currency: currencySchema.optional(),
    kind: transactionKindSchema.optional(),
    categoryId: uuidSchema.optional(),
    paymentMethodId: uuidSchema.optional(),
    tagId: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(ANALYTICS_MAX_PAGE_SIZE).default(ANALYTICS_DEFAULT_PAGE_SIZE),
    cursor: z.string().min(1).max(4096).optional(),
  })
  .superRefine(checkRange);

export type AnalyticsTransactionsQuery = z.infer<typeof analyticsTransactionsQuerySchema>;

/**
 * 逐笔条目：`transactionSchema` 的可安全分析子集。
 *
 * 刻意不返回 `note`/`tags`/`valueHistory`/`userId`/`occurredTz`——分析计算不需要，
 * 来源详情页仍走既有的 `GET /transactions/:id`（最小暴露原则）。
 */
export const analyticsTransactionItemSchema = z.object({
  id: uuidSchema,
  bookId: uuidSchema,
  kind: transactionKindSchema,
  amountMinor: analyticsAmountMinorSchema,
  currency: currencySchema,
  occurredLocalDate: calendarDateSchema,
  categoryId: uuidSchema,
  categoryName: z.string(),
  paymentMethodId: uuidSchema.nullable(),
  paymentMethodName: z.string().nullable(),
  /** `FxResultCache` 的键包含版本号：同一 id 的历史版本不能共用折算结果。 */
  version: z.number().int().positive(),
});

export type AnalyticsTransactionItem = z.infer<typeof analyticsTransactionItemSchema>;

export const analyticsTransactionsResponseSchema = z.object({
  items: z.array(analyticsTransactionItemSchema),
  nextCursor: z.string().nullable(),
  range: z.object({ from: calendarDateSchema, to: calendarDateSchema }),
});

export type AnalyticsTransactionsResponse = z.infer<typeof analyticsTransactionsResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/analytics/extremes
// ---------------------------------------------------------------------------

/**
 * 极值/天数聚合的指标。
 *
 * | metric | 用途 |
 * | --- | --- |
 * | `max` / `min` | B09/B10/B17 单笔极值 |
 * | `peak-day` | B11/B12 单日汇总最高 |
 * | `active-days` | B13 有记录的业务日期去重数 |
 * | `most-recorded-day` | B20 记录最多的一天（计笔数，不是金额） |
 */
export const ANALYTICS_EXTREME_METRICS = [
  "max",
  "min",
  "peak-day",
  "active-days",
  "most-recorded-day",
] as const;

export const analyticsExtremeMetricSchema = z.enum(ANALYTICS_EXTREME_METRICS);
export type AnalyticsExtremeMetric = z.infer<typeof analyticsExtremeMetricSchema>;

/** `both` 只用于 B20（按笔数计，收入+支出）；其余指标必须指明是收入还是支出。 */
export const analyticsExtremeKindSchema = z.enum(["income", "expense", "both"]);
export type AnalyticsExtremeKind = z.infer<typeof analyticsExtremeKindSchema>;

export const analyticsExtremesQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    /** 原币模式必填；综合模式由 `/analytics/transactions` + 逐笔折算处理。 */
    currency: currencySchema,
    metric: analyticsExtremeMetricSchema,
    kind: analyticsExtremeKindSchema.optional(),
  })
  .superRefine((value, ctx) => {
    checkRange(value, ctx);

    if (value.metric === "most-recorded-day") {
      if (value.kind !== undefined && value.kind !== "both") {
        ctx.addIssue({
          code: "custom",
          message: "「交易记录最多的一天」按收入+支出合计计数，kind 只能是 both 或省略",
          path: ["kind"],
        });
      }
      return;
    }

    if (value.kind !== "income" && value.kind !== "expense") {
      ctx.addIssue({
        code: "custom",
        message: "该指标必须指定 kind=income 或 kind=expense",
        path: ["kind"],
      });
    }
  });

export type AnalyticsExtremesQuery = z.infer<typeof analyticsExtremesQuerySchema>;

export const analyticsExtremeRecordSchema = z.object({
  id: uuidSchema,
  categoryId: uuidSchema,
  categoryName: z.string(),
  paymentMethodId: uuidSchema.nullable(),
  paymentMethodName: z.string().nullable(),
});

export type AnalyticsExtremeRecord = z.infer<typeof analyticsExtremeRecordSchema>;

/**
 * `max/min` 的 `value` 是金额字符串；`active-days` 是日数；`most-recorded-day`
 * 是笔数。`unit` 冗余但必要——客户端不该根据 metric 名猜一个字符串是什么。
 */
export const analyticsExtremesResponseSchema = z.object({
  metric: analyticsExtremeMetricSchema,
  kind: analyticsExtremeKindSchema,
  range: z.object({ from: calendarDateSchema, to: calendarDateSchema }),
  currency: currencySchema,
  unit: z.enum(["money", "count", "days"]),
  value: z.string().nullable(),
  occurredLocalDate: calendarDateSchema.nullable(),
  record: analyticsExtremeRecordSchema.nullable(),
  /** `peak-day` 的当日笔数；`most-recorded-day` 的总笔数；其余为 null。 */
  count: z.number().int().nullable(),
  incomeCount: z.number().int().nullable(),
  expenseCount: z.number().int().nullable(),
  /** 并列命中数；非极值指标为 0。 */
  tieCount: z.number().int().min(0),
  completeness: z.enum(["complete", "no-transactions"]),
});

export type AnalyticsExtremesResponse = z.infer<typeof analyticsExtremesResponseSchema>;

// ---------------------------------------------------------------------------
// 服务端聚合的纯函数（路由用；也让并列规则可单测）
// ---------------------------------------------------------------------------

/** 一天的业务日期聚合；金额用 bigint，不在服务端提前转 number。 */
export interface AnalyticsDayAggregate {
  readonly date: string;
  readonly count: number;
  readonly incomeCount: number;
  readonly expenseCount: number;
  readonly expenseMinor: bigint;
  readonly incomeMinor: bigint;
}

export interface AnalyticsPeakDaySummary {
  readonly date: string;
  readonly totalMinor: bigint;
  readonly count: number;
  readonly tieCount: number;
}

export interface AnalyticsMostRecordedDaySummary {
  readonly date: string;
  readonly count: number;
  readonly incomeCount: number;
  readonly expenseCount: number;
  readonly tieCount: number;
}

function byDate(left: { readonly date: string }, right: { readonly date: string }): number {
  return left.date < right.date ? -1 : left.date > right.date ? 1 : 0;
}

/**
 * 单日汇总最高的业务日期（B11/B12）。
 *
 * 并列时保留 **最早** 日期并累加 `tieCount`——与 `primitives.ts › peakDay` 同一规则，
 * 不允许刷新顺序决定用户看到哪一天。
 */
export function summarisePeakDay(
  days: readonly AnalyticsDayAggregate[],
  kind: "income" | "expense",
): AnalyticsPeakDaySummary | null {
  const sorted = [...days].sort(byDate);

  let peak: AnalyticsPeakDaySummary | null = null;

  for (const day of sorted) {
    const totalMinor = kind === "expense" ? day.expenseMinor : day.incomeMinor;
    const count = kind === "expense" ? day.expenseCount : day.incomeCount;

    if (peak === null || totalMinor > peak.totalMinor) {
      peak = { date: day.date, totalMinor, count, tieCount: 1 };
    } else if (totalMinor === peak.totalMinor) {
      // Rebuild explicitly: spreading a `let` union here loses the narrowing.
      peak = {
        date: peak.date,
        totalMinor: peak.totalMinor,
        count: peak.count,
        tieCount: peak.tieCount + 1,
      };
    }
  }

  return peak;
}

/**
 * 记录最多的一天（B20，收入+支出合计）。并列保留最早日期并累加 `tieCount`，
 * 与 `primitives.ts › peakRecordedDay` 同一规则。
 */
export function summariseMostRecordedDay(
  days: readonly AnalyticsDayAggregate[],
): AnalyticsMostRecordedDaySummary | null {
  const sorted = [...days].sort(byDate);

  let peak: AnalyticsMostRecordedDaySummary | null = null;

  for (const day of sorted) {
    if (peak === null || day.count > peak.count) {
      peak = {
        date: day.date,
        count: day.count,
        incomeCount: day.incomeCount,
        expenseCount: day.expenseCount,
        tieCount: 1,
      };
    } else if (day.count === peak.count) {
      peak = {
        date: peak.date,
        count: peak.count,
        incomeCount: peak.incomeCount,
        expenseCount: peak.expenseCount,
        tieCount: peak.tieCount + 1,
      };
    }
  }

  return peak;
}
