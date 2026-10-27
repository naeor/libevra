import type { AnalyticsTransactionItem } from "../../analytics.js";
import type { FxEntry } from "../../fx.js";

import type { AnalysisEntry } from "../primitives.js";

/**
 * T2 逐笔端点 → 分析层条目的适配器。
 *
 * 为什么需要单独一层：`AnalysisEntry` 与 `FxEntry` 都是 **纯计算定义**（不依赖 HTTP、
 * 不依赖 Prisma），它们的金额/日期形态与线上 DTO 不同——分析条目用 `bigint` 保证
 * 任意精度，FX 入口沿用既有 `FxEntry`（`amountCents: number`，由 `convertFx` 校验
 * safe integer）。适配器把「传输形态」翻译成「计算形态」，让装配层与既有 FX 引擎都
 * 能直接消费，而不需要为了端点改协议。
 */

/**
 * 逐笔 → 分析条目。
 *
 * `amountMinor` 在 DTO 里是十进制字符串（避免 JSON 大整数丢精度），到这里再转
 * `bigint`；`categoryName` 由端点顺带返回，免得来源追溯时再查一次。支付方式为
 * `null` 表示「未指定」，与 `PaymentMethodAmount.paymentMethodId: null` 的约定一致。
 */
export function toAnalysisEntry(row: AnalyticsTransactionItem): AnalysisEntry {
  return {
    id: row.id,
    kind: row.kind,
    amountMinor: BigInt(row.amountMinor),
    currency: row.currency,
    occurredLocalDate: row.occurredLocalDate,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    paymentMethodId: row.paymentMethodId,
    paymentMethodName: row.paymentMethodName,
  };
}

/**
 * 逐笔 → `FxEntry`（综合模式逐笔折算的输入）。
 *
 * 既有 FX 引擎的 `FxEntry.amountCents` 是 `number` 且 `convertFx` 要求 safe integer，
 * 所以这里必须显式校验：超出 `Number.MAX_SAFE_INTEGER` 时抛错，而不是静默换成
 * 浮点近似（金额合同禁止浮点权威累加）。写入侧 `amountCentsSchema` 上限是 1e12 分，
 * 正常数据不会触发；这条校验是防御端点契约被放宽后的回归。
 */
export function toFxEntry(row: AnalyticsTransactionItem): FxEntry {
  const amountCents = Number(row.amountMinor);

  if (!Number.isSafeInteger(amountCents)) {
    throw new RangeError(`fx_amount_unsafe:${row.id}:${row.amountMinor}`);
  }

  return {
    id: row.id,
    bookId: row.bookId,
    amountCents,
    currency: row.currency,
    occurredLocalDate: row.occurredLocalDate,
    kind: row.kind,
    categoryId: row.categoryId,
    version: row.version,
  };
}

export function toAnalysisEntries(rows: readonly AnalyticsTransactionItem[]): AnalysisEntry[] {
  return rows.map((row) => toAnalysisEntry(row));
}

export function toFxEntries(rows: readonly AnalyticsTransactionItem[]): FxEntry[] {
  return rows.map((row) => toFxEntry(row));
}
