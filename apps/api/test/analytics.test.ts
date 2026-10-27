import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ledgerOf, makeApp, prisma, resetDatabase, signUp } from "./support.js";

/**
 * T2 只读扩展（所有者 2026-10-27 批准，任务文档 §15）。
 *
 * 这些用例守的是「只读」与「口径」两件事：权限必须是既有 `requireBook` 的读强度
 * （viewer 能读、外人不越权），金额必须是十进制字符串，并列规则必须与
 * `packages/shared/src/analysis/primitives.ts` 一致，软删除记录不得出现。
 */
let app: FastifyInstance;

beforeAll(async () => {
  app = makeApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
});

interface Recorded {
  readonly day: string;
  readonly kind: "expense" | "income";
  readonly minor: number;
  readonly currency?: string;
  readonly category?: "餐饮" | "购物";
}

async function record(cookie: string, entries: readonly Recorded[]): Promise<void> {
  const ledger = await ledgerOf(app, cookie);

  for (const [index, entry] of entries.entries()) {
    const category = ledger.categories.find(
      (item) => item.kind === entry.kind && (entry.category === undefined || item.name === entry.category),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie },
      payload: {
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        kind: entry.kind,
        amountCents: entry.minor,
        currency: entry.currency ?? "CNY",
        categoryId: category?.id ?? null,
        paymentMethodId: null,
        occurredAt: `${entry.day}T12:00:00.000+08:00`,
        occurredLocalDate: entry.day,
        occurredTz: "Asia/Shanghai",
        note: `entry-${String(index)}`,
        tagIds: [],
      },
    });

    expect(response.statusCode).toBe(201);
  }
}

async function get(
  cookie: string | undefined,
  url: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await app.inject({
    method: "GET",
    url,
    headers: { ...(cookie === undefined ? {} : { cookie }), ...headers },
  });

  return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
}

describe("GET /analytics/transactions", () => {
  it("requires a session", async () => {
    const response = await get(undefined, "/api/v1/analytics/transactions?from=2026-10-01&to=2026-10-31");

    expect(response.statusCode).toBe(401);
  });

  it("returns the range newest-first with string amounts and labels", async () => {
    const cookie = await signUp(app, "analytics_owner");
    await record(cookie, [
      { day: "2026-10-01", kind: "expense", minor: 1200, category: "餐饮" },
      { day: "2026-10-02", kind: "expense", minor: 800, category: "购物" },
      { day: "2026-10-03", kind: "income", minor: 5000 },
    ]);

    const response = await get(cookie, "/api/v1/analytics/transactions?from=2026-10-01&to=2026-10-03");
    expect(response.statusCode).toBe(200);

    const items = response.body["items"] as { id: string; amountMinor: unknown; categoryName: string; occurredLocalDate: string }[];
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.occurredLocalDate)).toEqual(["2026-10-03", "2026-10-02", "2026-10-01"]);
    expect(typeof items[0]?.["amountMinor"]).toBe("string");
    expect(items[0]?.["amountMinor"]).toBe("5000");
    expect(items[2]?.["categoryName"]).toBe("餐饮");
    expect(response.body["nextCursor"]).toBeNull();
  });

  it("excludes soft-deleted entries", async () => {
    const cookie = await signUp(app, "analytics_deleted");
    await record(cookie, [
      { day: "2026-10-01", kind: "expense", minor: 500 },
      { day: "2026-10-02", kind: "expense", minor: 700 },
    ]);

    const list = await get(cookie, "/api/v1/analytics/transactions?from=2026-10-01&to=2026-10-31");
    const items = list.body["items"] as { id: string }[];
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/transactions/${String(items[0]?.id)}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(204);

    const after = await get(cookie, "/api/v1/analytics/transactions?from=2026-10-01&to=2026-10-31");
    expect((after.body["items"] as unknown[]).length).toBe(1);
  });

  it("keeps currencies apart unless all currencies are requested", async () => {
    const cookie = await signUp(app, "analytics_currency");
    await record(cookie, [
      { day: "2026-10-01", kind: "expense", minor: 1000, currency: "CNY" },
      { day: "2026-10-01", kind: "expense", minor: 3000, currency: "JPY" },
    ]);

    const cny = await get(cookie, "/api/v1/analytics/transactions?from=2026-10-01&to=2026-10-01&currency=CNY");
    expect((cny.body["items"] as unknown[]).length).toBe(1);

    const all = await get(cookie, "/api/v1/analytics/transactions?from=2026-10-01&to=2026-10-01");
    expect((all.body["items"] as unknown[]).length).toBe(2);
  });

  it("paginates by keyset cursor without repeating or losing a row", async () => {
    const cookie = await signUp(app, "analytics_cursor");
    await record(cookie, [
      { day: "2026-10-01", kind: "expense", minor: 100 },
      { day: "2026-10-02", kind: "expense", minor: 200 },
      { day: "2026-10-03", kind: "expense", minor: 300 },
    ]);

    const first = await get(cookie, "/api/v1/analytics/transactions?from=2026-10-01&to=2026-10-03&limit=1");
    const firstItems = first.body["items"] as { id: string }[];
    const cursor = first.body["nextCursor"];
    expect(firstItems).toHaveLength(1);
    expect(typeof cursor).toBe("string");

    const second = await get(
      cookie,
      `/api/v1/analytics/transactions?from=2026-10-01&to=2026-10-03&limit=2&cursor=${encodeURIComponent(String(cursor))}`,
    );
    const secondItems = second.body["items"] as { id: string }[];
    expect(secondItems).toHaveLength(2);
    expect(secondItems.map((item) => item.id)).not.toContain(firstItems[0]?.id);
  });

  it("rejects a backwards range and an oversized range", async () => {
    const cookie = await signUp(app, "analytics_range");

    expect((await get(cookie, "/api/v1/analytics/transactions?from=2026-10-09&to=2026-10-01")).statusCode).toBe(400);
    expect((await get(cookie, "/api/v1/analytics/transactions?from=2020-01-01&to=2026-10-09")).statusCode).toBe(400);
  });
});

describe("GET /analytics/extremes", () => {
  it("requires a session", async () => {
    const response = await get(
      undefined,
      "/api/v1/analytics/extremes?from=2026-10-01&to=2026-10-31&currency=CNY&metric=max&kind=expense",
    );

    expect(response.statusCode).toBe(401);
  });

  it("returns the max/min record with string value and tie count", async () => {
    const cookie = await signUp(app, "analytics_extreme");
    await record(cookie, [
      { day: "2026-10-01", kind: "expense", minor: 500 },
      { day: "2026-10-02", kind: "expense", minor: 1000, category: "购物" },
      { day: "2026-10-03", kind: "expense", minor: 1000 },
      { day: "2026-10-04", kind: "expense", minor: 900 },
    ]);

    const max = await get(
      cookie,
      "/api/v1/analytics/extremes?from=2026-10-01&to=2026-10-31&currency=CNY&metric=max&kind=expense",
    );
    expect(max.statusCode).toBe(200);
    expect(max.body).toMatchObject({ metric: "max", unit: "money", value: "1000", tieCount: 2, completeness: "complete" });
    expect((max.body["record"] as Record<string, unknown>)["categoryName"]).toBe("购物");
    // 并列时按业务日期升序取稳定首项，不允许刷新顺序决定结果。
    expect(max.body["occurredLocalDate"]).toBe("2026-10-02");

    const min = await get(
      cookie,
      "/api/v1/analytics/extremes?from=2026-10-01&to=2026-10-31&currency=CNY&metric=min&kind=expense",
    );
    expect(min.body["value"]).toBe("500");
    expect(min.body["tieCount"]).toBe(1);
  });

  it("returns the peak day by daily sum, not by the largest single record", async () => {
    const cookie = await signUp(app, "analytics_peak");
    await record(cookie, [
      { day: "2026-10-01", kind: "expense", minor: 900 },
      { day: "2026-10-02", kind: "expense", minor: 800 },
      { day: "2026-10-02", kind: "expense", minor: 700 },
    ]);

    const peak = await get(
      cookie,
      "/api/v1/analytics/extremes?from=2026-10-01&to=2026-10-31&currency=CNY&metric=peak-day&kind=expense",
    );

    expect(peak.body).toMatchObject({ value: "1500", occurredLocalDate: "2026-10-02", count: 2, tieCount: 1 });
  });

  it("counts days with records, not records", async () => {
    const cookie = await signUp(app, "analytics_days");
    await record(cookie, [
      { day: "2026-10-01", kind: "expense", minor: 100 },
      { day: "2026-10-01", kind: "expense", minor: 200 },
      { day: "2026-10-02", kind: "expense", minor: 300 },
    ]);

    const active = await get(
      cookie,
      "/api/v1/analytics/extremes?from=2026-10-01&to=2026-10-31&currency=CNY&metric=active-days&kind=expense",
    );

    expect(active.body).toMatchObject({ unit: "days", value: "2", completeness: "complete" });
  });

  it("counts the most recorded day across income and expense", async () => {
    const cookie = await signUp(app, "analytics_most");
    await record(cookie, [
      { day: "2026-10-01", kind: "expense", minor: 100 },
      { day: "2026-10-02", kind: "expense", minor: 200 },
      { day: "2026-10-02", kind: "expense", minor: 300 },
      { day: "2026-10-02", kind: "income", minor: 5000 },
    ]);

    const most = await get(
      cookie,
      "/api/v1/analytics/extremes?from=2026-10-01&to=2026-10-31&currency=CNY&metric=most-recorded-day",
    );

    expect(most.body).toMatchObject({
      unit: "count",
      value: "3",
      occurredLocalDate: "2026-10-02",
      count: 3,
      incomeCount: 1,
      expenseCount: 2,
    });
  });

  it("answers no-transactions rather than failing when the range is empty", async () => {
    const cookie = await signUp(app, "analytics_empty");

    const empty = await get(
      cookie,
      "/api/v1/analytics/extremes?from=2026-10-01&to=2026-10-31&currency=CNY&metric=max&kind=expense",
    );

    expect(empty.statusCode).toBe(200);
    expect(empty.body).toMatchObject({ value: null, completeness: "no-transactions", tieCount: 0 });
  });

  it("rejects a backwards range and a missing kind for a single-record metric", async () => {
    const cookie = await signUp(app, "analytics_invalid");

    expect(
      (await get(cookie, "/api/v1/analytics/extremes?from=2026-10-09&to=2026-10-01&currency=CNY&metric=max&kind=expense")).statusCode,
    ).toBe(400);
    expect(
      (await get(cookie, "/api/v1/analytics/extremes?from=2026-10-01&to=2026-10-31&currency=CNY&metric=max")).statusCode,
    ).toBe(400);
  });
});

describe("analytics read authorization", () => {
  it("lets a viewer read but never write, and keeps outsiders out", async () => {
    const ownerCookie = await signUp(app, "analytics_auth_owner");
    const viewerCookie = await signUp(app, "analytics_auth_view");
    const book = await prisma.book.findFirst({ where: { creator: { username: "analytics_auth_owner" } } });
    expect(book).not.toBeNull();

    const outsider = await get(
      ownerCookie,
      "/api/v1/analytics/transactions?from=2026-10-01&to=2026-10-31",
      { "x-libellum-book": book!.id },
    );
    expect(outsider.statusCode).toBe(200);

    const forbidden = await get(
      viewerCookie,
      "/api/v1/analytics/transactions?from=2026-10-01&to=2026-10-31",
      { "x-libellum-book": book!.id },
    );
    expect(forbidden.statusCode).toBe(403);

    const viewer = (await prisma.user.findUnique({ where: { username: "analytics_auth_view" } }))!;
    await prisma.bookMember.create({ data: { bookId: book!.id, userId: viewer.id, role: "viewer" } });

    const allowed = await get(
      viewerCookie,
      "/api/v1/analytics/transactions?from=2026-10-01&to=2026-10-31",
      { "x-libellum-book": book!.id },
    );
    expect(allowed.statusCode).toBe(200);

    const write = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: viewerCookie, "x-libellum-book": book!.id },
      payload: {},
    });
    expect(write.statusCode).toBe(403);

    const extremes = await get(
      viewerCookie,
      "/api/v1/analytics/extremes?from=2026-10-01&to=2026-10-31&currency=CNY&metric=active-days&kind=expense",
      { "x-libellum-book": book!.id },
    );
    expect(extremes.statusCode).toBe(200);
  });
});
