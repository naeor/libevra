import {
  analyticsExtremesQuerySchema,
  analyticsExtremesResponseSchema,
  analyticsTransactionsQuerySchema,
  analyticsTransactionsResponseSchema,
  summariseMostRecordedDay,
  summarisePeakDay,
  type AnalyticsDayAggregate,
  type AnalyticsExtremeKind,
  type AnalyticsExtremesQuery,
  type AnalyticsExtremesResponse,
  type AnalyticsExtremeMetric,
} from "@libellum/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { badRequest } from "../lib/errors.js";

/**
 * T2 只读扩展（所有者 2026-10-27 批准，任务文档 §15）。
 *
 * 两个端点都只读：没有 POST/PATCH/DELETE，不写业务数据，不改既有端点响应。
 * 权限直接复用 `requireBookRead`——viewer 可读、非成员 403、已删/删除中 410、
 * 归档 403，与 `/stats` 同一套语义，不为分析另起一套授权。
 *
 * 为什么需要它们（提案 §1）：
 * 1. 综合模式要逐笔折算，必须拿得到任意区间（≤400 天）的逐笔原币记录；
 *    现有明细接口只支持整月过滤，拼月份会在边界漏账/重账。
 * 2. 极值/天数聚合（B09–B14、B17、B20）如果先拉全量再排序，客户端要承担
 *    泄漏面、性能与并列规则漂移；服务端只读聚合一次解决。
 */

export interface AnalyticsRouteOptions {
  readonly prisma: PrismaClient;
  /** 只读强度。`app.ts` 传入 `requireBookRead`，不要传写权限。 */
  readonly requireAuth: (request: FastifyRequest) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Dates & cursor (kept explicit: `@db.Date` must never drift a day)
// ---------------------------------------------------------------------------

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function fromDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Keyset pagination over `(occurredLocalDate, createdAt, id)` — same cursor shape
 * as `GET /transactions`. Offset pagination would shift while somebody pages.
 */
function encodeCursor(row: { occurredLocalDate: Date; createdAt: Date; id: string }): string {
  const payload = JSON.stringify({
    d: fromDateOnly(row.occurredLocalDate),
    c: row.createdAt.toISOString(),
    i: row.id,
  });

  return Buffer.from(payload, "utf8").toString("base64url");
}

function decodeCursor(raw: string): { d: string; c: string; i: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw badRequest("cursor_invalid", "分页参数无效，请重新加载。");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { d?: unknown }).d !== "string" ||
    typeof (parsed as { c?: unknown }).c !== "string" ||
    typeof (parsed as { i?: unknown }).i !== "string"
  ) {
    throw badRequest("cursor_invalid", "分页参数无效，请重新加载。");
  }

  const cursor = parsed as { d: string; c: string; i: string };

  if (Number.isNaN(toDateOnly(cursor.d).getTime()) || Number.isNaN(new Date(cursor.c).getTime())) {
    throw badRequest("cursor_invalid", "分页参数无效，请重新加载。");
  }

  return cursor;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** `kind` for metrics that need exactly one side; the schema already guarantees it. */
function singleKind(kind: AnalyticsExtremeKind | undefined): "income" | "expense" {
  if (kind !== "income" && kind !== "expense") {
    throw badRequest("kind_required", "该指标必须指定 kind=income 或 kind=expense。");
  }

  return kind;
}

function unitFor(metric: AnalyticsExtremeMetric): "money" | "count" | "days" {
  if (metric === "active-days") return "days";
  if (metric === "most-recorded-day") return "count";

  return "money";
}

function emptyExtremes(
  query: AnalyticsExtremesQuery,
  kind: AnalyticsExtremeKind,
): AnalyticsExtremesResponse {
  return analyticsExtremesResponseSchema.parse({
    metric: query.metric,
    kind,
    range: { from: query.from, to: query.to },
    currency: query.currency,
    unit: unitFor(query.metric),
    value: null,
    occurredLocalDate: null,
    record: null,
    count: null,
    incomeCount: null,
    expenseCount: null,
    tieCount: 0,
    completeness: "no-transactions",
  });
}

function dayAggregates(
  rows: readonly { occurredLocalDate: Date; kind: "income" | "expense"; count: number; sumMinor: bigint }[],
): AnalyticsDayAggregate[] {
  const byDate = new Map<string, { count: number; incomeCount: number; expenseCount: number; expenseMinor: bigint; incomeMinor: bigint }>();

  for (const row of rows) {
    const date = fromDateOnly(row.occurredLocalDate);
    const day = byDate.get(date) ?? {
      count: 0,
      incomeCount: 0,
      expenseCount: 0,
      expenseMinor: 0n,
      incomeMinor: 0n,
    };

    day.count += row.count;

    if (row.kind === "income") {
      day.incomeCount += row.count;
      day.incomeMinor += row.sumMinor;
    } else {
      day.expenseCount += row.count;
      day.expenseMinor += row.sumMinor;
    }

    byDate.set(date, day);
  }

  return [...byDate.entries()].map(([date, day]) => ({ date, ...day }));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerAnalyticsRoutes(app: FastifyInstance, options: AnalyticsRouteOptions): void {
  const { prisma, requireAuth } = options;

  // -------------------------------------------------------------------------
  // GET /api/v1/analytics/transactions
  // -------------------------------------------------------------------------

  /**
   * 任意区间（≤400 天）的逐笔原币记录。`currency` 省略 = 多币种返回，
   * 供分析层用既有 `aggregateFxAsync` 逐笔折算（服务端不做第二套汇率）。
   * 金额输出十进制字符串，避免 JSON 大整数丢精度。
   */
  app.get("/api/v1/analytics/transactions", { preHandler: requireAuth }, async (request) => {
    const bookId = request.book!.bookId;
    const query = analyticsTransactionsQuerySchema.parse(request.query);

    const where: Prisma.TransactionWhereInput = {
      bookId,
      deletedAt: null,
      occurredLocalDate: { gte: toDateOnly(query.from), lte: toDateOnly(query.to) },
    };

    if (query.currency !== undefined) where.currency = query.currency;
    if (query.kind !== undefined) where.kind = query.kind;
    if (query.categoryId !== undefined) where.categoryId = query.categoryId;
    if (query.paymentMethodId !== undefined) where.paymentMethodId = query.paymentMethodId;
    if (query.tagId !== undefined) where.tags = { some: { tagId: query.tagId } };

    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      const occurredLocalDate = toDateOnly(cursor.d);
      const createdAt = new Date(cursor.c);

      where.OR = [
        { occurredLocalDate: { lt: occurredLocalDate } },
        { occurredLocalDate, createdAt: { lt: createdAt } },
        { occurredLocalDate, createdAt, id: { lt: cursor.i } },
      ];
    }

    const rows = await prisma.transaction.findMany({
      where,
      select: {
        id: true,
        bookId: true,
        kind: true,
        amountCents: true,
        currency: true,
        occurredLocalDate: true,
        categoryId: true,
        paymentMethodId: true,
        version: true,
        createdAt: true,
        category: { select: { name: true } },
        paymentMethod: { select: { name: true } },
      },
      orderBy: [{ occurredLocalDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return analyticsTransactionsResponseSchema.parse({
      items: page.map((row) => ({
        id: row.id,
        bookId: row.bookId,
        kind: row.kind,
        amountMinor: row.amountCents.toString(),
        currency: row.currency,
        occurredLocalDate: fromDateOnly(row.occurredLocalDate),
        categoryId: row.categoryId,
        categoryName: row.category.name,
        paymentMethodId: row.paymentMethodId,
        paymentMethodName: row.paymentMethod?.name ?? null,
        version: row.version,
      })),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      range: { from: query.from, to: query.to },
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/analytics/extremes
  // -------------------------------------------------------------------------

  /**
   * 极值/天数聚合。金额、笔数、日数都以字符串 `value` 返回，`unit` 说明其含义。
   * 并列规则与 `packages/shared/src/analysis/primitives.ts` 完全一致：
   * 单笔极值按「金额 → 业务日期升序 → id 升序」取稳定首项；单日极值并列保留
   * 最早日期；`tieCount` 记录并列数量。
   */
  app.get("/api/v1/analytics/extremes", { preHandler: requireAuth }, async (request) => {
    const bookId = request.book!.bookId;
    const query = analyticsExtremesQuerySchema.parse(request.query);

    const baseWhere: Prisma.TransactionWhereInput = {
      bookId,
      deletedAt: null,
      currency: query.currency,
      occurredLocalDate: { gte: toDateOnly(query.from), lte: toDateOnly(query.to) },
    };

    if (query.metric === "max" || query.metric === "min") {
      const kind = singleKind(query.kind);

      const boundary = await prisma.transaction.findFirst({
        where: { ...baseWhere, kind },
        orderBy: [{ amountCents: query.metric === "max" ? "desc" : "asc" }],
        select: { amountCents: true },
      });

      if (boundary === null) return emptyExtremes(query, kind);

      const [tieCount, record] = await Promise.all([
        prisma.transaction.count({ where: { ...baseWhere, kind, amountCents: boundary.amountCents } }),
        prisma.transaction.findFirst({
          where: { ...baseWhere, kind, amountCents: boundary.amountCents },
          orderBy: [{ occurredLocalDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            occurredLocalDate: true,
            categoryId: true,
            paymentMethodId: true,
            category: { select: { name: true } },
            paymentMethod: { select: { name: true } },
          },
        }),
      ]);

      if (record === null) return emptyExtremes(query, kind);

      return analyticsExtremesResponseSchema.parse({
        metric: query.metric,
        kind,
        range: { from: query.from, to: query.to },
        currency: query.currency,
        unit: "money",
        value: boundary.amountCents.toString(),
        occurredLocalDate: fromDateOnly(record.occurredLocalDate),
        record: {
          id: record.id,
          categoryId: record.categoryId,
          categoryName: record.category.name,
          paymentMethodId: record.paymentMethodId,
          paymentMethodName: record.paymentMethod?.name ?? null,
        },
        count: null,
        incomeCount: null,
        expenseCount: null,
        tieCount,
        completeness: "complete",
      });
    }

    if (query.metric === "peak-day") {
      const kind = singleKind(query.kind);

      const rows = await prisma.transaction.groupBy({
        by: ["occurredLocalDate"],
        where: { ...baseWhere, kind },
        _sum: { amountCents: true },
        _count: { _all: true },
      });

      const days = dayAggregates(
        rows.map((row) => ({
          occurredLocalDate: row.occurredLocalDate,
          kind,
          count: row._count._all,
          sumMinor: row._sum.amountCents ?? 0n,
        })),
      );

      const peak = summarisePeakDay(days, kind);
      if (peak === null) return emptyExtremes(query, kind);

      return analyticsExtremesResponseSchema.parse({
        metric: query.metric,
        kind,
        range: { from: query.from, to: query.to },
        currency: query.currency,
        unit: "money",
        value: peak.totalMinor.toString(),
        occurredLocalDate: peak.date,
        record: null,
        count: peak.count,
        incomeCount: null,
        expenseCount: null,
        tieCount: peak.tieCount,
        completeness: "complete",
      });
    }

    if (query.metric === "active-days") {
      const kind = singleKind(query.kind);

      const rows = await prisma.transaction.groupBy({
        by: ["occurredLocalDate"],
        where: { ...baseWhere, kind },
        _count: { _all: true },
      });

      if (rows.length === 0) return emptyExtremes(query, kind);

      return analyticsExtremesResponseSchema.parse({
        metric: query.metric,
        kind,
        range: { from: query.from, to: query.to },
        currency: query.currency,
        unit: "days",
        value: String(rows.length),
        occurredLocalDate: null,
        record: null,
        count: null,
        incomeCount: null,
        expenseCount: null,
        tieCount: 0,
        completeness: "complete",
      });
    }

    // most-recorded-day：B20 按「收入+支出」合计笔数计，不区分 kind。
    const kindScope: AnalyticsExtremeKind = query.kind ?? "both";

    const rows = await prisma.transaction.groupBy({
      by: ["occurredLocalDate", "kind"],
      where: baseWhere,
      _count: { _all: true },
    });

    const days = dayAggregates(
      rows.map((row) => ({
        occurredLocalDate: row.occurredLocalDate,
        kind: row.kind,
        count: row._count._all,
        sumMinor: 0n,
      })),
    );

    const peak = summariseMostRecordedDay(days);
    if (peak === null) return emptyExtremes(query, kindScope);

    return analyticsExtremesResponseSchema.parse({
      metric: query.metric,
      kind: kindScope,
      range: { from: query.from, to: query.to },
      currency: query.currency,
      unit: "count",
      value: String(peak.count),
      occurredLocalDate: peak.date,
      record: null,
      count: peak.count,
      incomeCount: peak.incomeCount,
      expenseCount: peak.expenseCount,
      tieCount: peak.tieCount,
      completeness: "complete",
    });
  });
}
