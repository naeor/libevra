import { describe, expect, it } from "vitest";

import {
  ANALYTICS_DEFAULT_PAGE_SIZE,
  ANALYTICS_MAX_PAGE_SIZE,
  analyticsExtremesQuerySchema,
  analyticsExtremesResponseSchema,
  analyticsTransactionsQuerySchema,
  analyticsTransactionsResponseSchema,
  summariseMostRecordedDay,
  summarisePeakDay,
  type AnalyticsDayAggregate,
} from "./analytics.js";

function day(
  date: string,
  counts: { count: number; incomeCount?: number; expenseCount?: number },
  minors: { expenseMinor?: bigint; incomeMinor?: bigint } = {},
): AnalyticsDayAggregate {
  return {
    date,
    count: counts.count,
    incomeCount: counts.incomeCount ?? 0,
    expenseCount: counts.expenseCount ?? 0,
    expenseMinor: minors.expenseMinor ?? 0n,
    incomeMinor: minors.incomeMinor ?? 0n,
  };
}

const RANGE = { from: "2026-10-01", to: "2026-10-31" } as const;

describe("analytics transactions query contract", () => {
  it("defaults to the page size the analysis layer asks for", () => {
    const parsed = analyticsTransactionsQuerySchema.parse(RANGE);

    expect(parsed.limit).toBe(ANALYTICS_DEFAULT_PAGE_SIZE);
    expect(parsed.currency).toBeUndefined();
    expect(parsed.cursor).toBeUndefined();
  });

  it("coerces a numeric limit from the query string", () => {
    expect(analyticsTransactionsQuerySchema.parse({ ...RANGE, limit: "50" }).limit).toBe(50);
  });

  it("rejects a page larger than the hard cap", () => {
    expect(analyticsTransactionsQuerySchema.safeParse({ ...RANGE, limit: ANALYTICS_MAX_PAGE_SIZE + 1 }).success).toBe(false);
  });

  it("rejects a backwards range", () => {
    const result = analyticsTransactionsQuerySchema.safeParse({ from: "2026-10-31", to: "2026-10-01" });

    expect(result.success).toBe(false);
  });

  it("rejects a range longer than the stats contract allows", () => {
    expect(analyticsTransactionsQuerySchema.safeParse({ from: "2020-01-01", to: "2026-10-09" }).success).toBe(false);
  });

  it("accepts an optional kind, category, payment method and tag filter", () => {
    const parsed = analyticsTransactionsQuerySchema.parse({
      ...RANGE,
      kind: "expense",
      categoryId: "8f0c0272-9e5b-4e2a-9c9e-6f3d5c1b7a20",
      paymentMethodId: "0f3a6f31-8b5d-4d1f-b0f0-2f5a9b8c7d61",
      tagId: "7c9b2f10-3e4d-4a5b-8c9d-0e1f2a3b4c5d",
    });

    expect(parsed.kind).toBe("expense");
    expect(parsed.categoryId).toBe("8f0c0272-9e5b-4e2a-9c9e-6f3d5c1b7a20");
  });

  it("keeps amounts as decimal strings through the response schema", () => {
    const parsed = analyticsTransactionsResponseSchema.parse({
      items: [
        {
          id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
          bookId: "2b4e28ba-2fa1-11d2-883f-0016d3cca427",
          kind: "expense",
          amountMinor: "9007199254740993",
          currency: "CNY",
          occurredLocalDate: "2026-10-01",
          categoryId: "3b4e28ba-2fa1-11d2-883f-0016d3cca427",
          categoryName: "餐饮",
          paymentMethodId: null,
          paymentMethodName: null,
          version: 1,
        },
      ],
      nextCursor: null,
      range: RANGE,
    });

    expect(parsed.items[0]?.amountMinor).toBe("9007199254740993");
    expect(parsed.items[0]?.paymentMethodName).toBeNull();
  });

  it("rejects a non-decimal amount string", () => {
    const result = analyticsTransactionsResponseSchema.safeParse({
      items: [
        {
          id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
          bookId: "2b4e28ba-2fa1-11d2-883f-0016d3cca427",
          kind: "expense",
          amountMinor: "12.50",
          currency: "CNY",
          occurredLocalDate: "2026-10-01",
          categoryId: "3b4e28ba-2fa1-11d2-883f-0016d3cca427",
          categoryName: "餐饮",
          paymentMethodId: null,
          paymentMethodName: null,
          version: 1,
        },
      ],
      nextCursor: null,
      range: RANGE,
    });

    expect(result.success).toBe(false);
  });
});

describe("analytics extremes query contract", () => {
  const base = { ...RANGE, currency: "CNY" } as const;

  it("accepts max with an explicit kind", () => {
    const parsed = analyticsExtremesQuerySchema.parse({ ...base, metric: "max", kind: "expense" });

    expect(parsed.metric).toBe("max");
    expect(parsed.kind).toBe("expense");
  });

  it("requires a kind for single-record extremes", () => {
    expect(analyticsExtremesQuerySchema.safeParse({ ...base, metric: "max" }).success).toBe(false);
    expect(analyticsExtremesQuerySchema.safeParse({ ...base, metric: "min", kind: "both" }).success).toBe(false);
    expect(analyticsExtremesQuerySchema.safeParse({ ...base, metric: "peak-day" }).success).toBe(false);
  });

  it("accepts most-recorded-day without a kind, or with both, but not one side", () => {
    expect(analyticsExtremesQuerySchema.safeParse({ ...base, metric: "most-recorded-day" }).success).toBe(true);
    expect(analyticsExtremesQuerySchema.safeParse({ ...base, metric: "most-recorded-day", kind: "both" }).success).toBe(true);
    expect(analyticsExtremesQuerySchema.safeParse({ ...base, metric: "most-recorded-day", kind: "expense" }).success).toBe(false);
  });

  it("requires a currency and a known metric", () => {
    expect(analyticsExtremesQuerySchema.safeParse({ ...RANGE, metric: "max", kind: "expense" }).success).toBe(false);
    expect(analyticsExtremesQuerySchema.safeParse({ ...base, metric: "median", kind: "expense" }).success).toBe(false);
  });

  it("round-trips a no-transactions response", () => {
    const parsed = analyticsExtremesResponseSchema.parse({
      metric: "peak-day",
      kind: "expense",
      range: RANGE,
      currency: "CNY",
      unit: "money",
      value: null,
      occurredLocalDate: null,
      record: null,
      count: null,
      incomeCount: null,
      expenseCount: null,
      tieCount: 0,
      completeness: "no-transactions",
    });

    expect(parsed.completeness).toBe("no-transactions");
  });
});

describe("summarisePeakDay (B11/B12)", () => {
  it("returns the day with the highest kind sum and its count", () => {
    const days = [
      day("2026-10-01", { count: 3, expenseCount: 3 }, { expenseMinor: 1200n }),
      day("2026-10-02", { count: 2, expenseCount: 2 }, { expenseMinor: 2000n }),
    ];

    expect(summarisePeakDay(days, "expense")).toEqual({
      date: "2026-10-02",
      totalMinor: 2000n,
      count: 2,
      tieCount: 1,
    });
  });

  it("keeps the earliest date and counts ties when totals are equal", () => {
    const days = [
      day("2026-10-09", { count: 1, expenseCount: 1 }, { expenseMinor: 1500n }),
      day("2026-10-02", { count: 1, expenseCount: 1 }, { expenseMinor: 1500n }),
    ];

    expect(summarisePeakDay(days, "expense")).toMatchObject({
      date: "2026-10-02",
      totalMinor: 1500n,
      tieCount: 2,
    });
  });

  it("picks income days from the income minor, not the expense minor", () => {
    const days = [
      day("2026-10-01", { count: 1, incomeCount: 1 }, { expenseMinor: 9000n }),
      day("2026-10-02", { count: 2, incomeCount: 2 }, { incomeMinor: 5000n, expenseMinor: 1n }),
    ];

    expect(summarisePeakDay(days, "income")?.date).toBe("2026-10-02");
    expect(summarisePeakDay(days, "income")?.count).toBe(2);
  });

  it("returns null when there is no day to compare", () => {
    expect(summarisePeakDay([], "expense")).toBeNull();
  });
});

describe("summariseMostRecordedDay (B20)", () => {
  it("counts income+expense entries per day and reports the split", () => {
    const days = [
      day("2026-10-01", { count: 1, incomeCount: 1, expenseCount: 0 }),
      day("2026-10-02", { count: 3, incomeCount: 1, expenseCount: 2 }),
    ];

    expect(summariseMostRecordedDay(days)).toEqual({
      date: "2026-10-02",
      count: 3,
      incomeCount: 1,
      expenseCount: 2,
      tieCount: 1,
    });
  });

  it("keeps the earliest date and counts ties when counts are equal", () => {
    const days = [
      day("2026-10-05", { count: 2, incomeCount: 0, expenseCount: 2 }),
      day("2026-10-03", { count: 2, incomeCount: 2, expenseCount: 0 }),
    ];

    expect(summariseMostRecordedDay(days)).toMatchObject({
      date: "2026-10-03",
      count: 2,
      tieCount: 2,
    });
  });

  it("returns null with no days", () => {
    expect(summariseMostRecordedDay([])).toBeNull();
  });
});
