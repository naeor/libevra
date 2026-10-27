import { describe, expect, it } from "vitest";

import type { Transaction } from "@libellum/shared";

import {
  AnalysisRangeError,
  deriveTimeAnalysis,
  type TimeAnalysisQuery,
} from "./analysisData.js";

let nextId = 1;

/**
 * Minimal well-formed transaction. The local ledger type carries the business date
 * (`occurredLocalDate`) *separately* from the instant (`occurredAt`); the analysis
 * layer must only ever read the former.
 */
function entry(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `t-${String(nextId++).padStart(3, "0")}`,
    kind: "expense",
    amountCents: 1_000,
    currency: "CNY",
    categoryId: "category-1",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: null,
    paymentMethodName: null,
    occurredAt: "2026-10-02T04:00:00.000Z",
    occurredLocalDate: "2026-10-02",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    deletedAt: null,
    ...overrides,
  };
}

const TODAY = "2026-10-27";
const PAST_SPAN = { start: "2026-10-01", end: "2026-10-08" };

function query(overrides: Partial<TimeAnalysisQuery> = {}): TimeAnalysisQuery {
  return {
    metric: "expense",
    granularity: "day",
    span: PAST_SPAN,
    today: TODAY,
    ...overrides,
  };
}

describe("deriveTimeAnalysis（真实 Transaction → 时间序列）", () => {
  it("按业务日期分桶并精确求和（同日两笔支出 = 3500 分）", () => {
    const view = deriveTimeAnalysis(
      [
        entry({ occurredLocalDate: "2026-10-02", amountCents: 1_000 }),
        entry({ occurredLocalDate: "2026-10-02", amountCents: 2_500 }),
      ],
      query(),
    );
    expect(view.result.buckets).toHaveLength(7);
    const second = view.result.buckets[1];
    expect(second?.bucket.key).toBe("2026-10-02");
    expect(second?.amountMinor).toBe("3500");
    expect(second?.transactionCount).toBe(2);
    expect(view.result.totalMinor).toBe("3500");
    expect(view.result.complete).toBe(true);
  });

  it("只按 occurredLocalDate 归属，occurredAt 的 UTC 跨日不改变桶", () => {
    const view = deriveTimeAnalysis(
      [entry({ occurredAt: "2026-10-02T20:00:00.000Z", occurredLocalDate: "2026-10-03" })],
      query(),
    );
    const bucket = view.result.buckets.find((point) => point.bucket.key === "2026-10-03");
    expect(bucket?.amountMinor).toBe("1000");
    // 前一日是完整零桶（不是 unknown），value 可读但计数为 0。
    const previous = view.result.buckets.find((point) => point.bucket.key === "2026-10-02");
    expect(previous?.amountMinor).toBe("0");
    expect(previous?.transactionCount).toBe(0);
  });

  it("支出序列排除收入；笔数序列默认统计全部 kind", () => {
    const transactions = [
      entry({ occurredLocalDate: "2026-10-02", kind: "expense", amountCents: 1_000 }),
      entry({ occurredLocalDate: "2026-10-02", kind: "income", amountCents: 9_000 }),
    ];
    const expense = deriveTimeAnalysis(transactions, query({ metric: "expense" }));
    expect(expense.result.totalMinor).toBe("1000");

    const counts = deriveTimeAnalysis(transactions, query({ metric: "count", countKind: "all" }));
    const bucket = counts.result.buckets.find((point) => point.bucket.key === "2026-10-02");
    expect(bucket?.transactionCount).toBe(2);
  });

  it("笔数不受金额影响，软删除记录不进入序列", () => {
    const view = deriveTimeAnalysis(
      [
        entry({ amountCents: 1_000_000 }),
        entry({ deletedAt: "2026-10-03T00:00:00.000Z" }),
      ],
      query({ metric: "count", countKind: "all" }),
    );
    const bucket = view.result.buckets.find((point) => point.bucket.key === "2026-10-02");
    expect(bucket?.transactionCount).toBe(1);
  });

  it("未知覆盖（unknown）不给金额、不给完整汇总，不当作零", () => {
    const view = deriveTimeAnalysis([entry()], query({ coverage: "unknown" }));
    const bucket = view.result.buckets.find((point) => point.bucket.key === "2026-10-02");
    expect(bucket?.amountMinor).toBeNull();
    expect(view.result.totalMinor).toBeNull();
    expect(view.result.complete).toBe(false);
    expect(view.input.coverageEnd).toBeNull();
  });

  it("W1 原币默认采用设备账本口径：历史桶完整且金额可读", () => {
    const view = deriveTimeAnalysis([entry()], query());
    expect(view.input.coverageEnd).toBe("2026-10-07");
    const bucket = view.result.buckets.find((point) => point.bucket.key === "2026-10-02");
    expect(bucket?.amountMinor).toBe("1000");
  });

  it("包含今天的窗口标记未完成，但今天已发生的金额仍可读", () => {
    const view = deriveTimeAnalysis(
      [entry({ occurredLocalDate: TODAY, amountCents: 700 })],
      query({ span: { start: "2026-10-26", end: "2026-10-28" } }),
    );
    const todayBucket = view.result.buckets.find((point) => point.bucket.key === TODAY);
    expect(todayBucket?.amountMinor).toBe("700");
    expect(todayBucket?.bucket.state).toBe("in-progress");
    expect(view.result.complete).toBe(false);
  });

  it("超过 400 日的窗口直接拒绝，不截断", () => {
    expect(() =>
      deriveTimeAnalysis([], query({ span: { start: "2025-09-22", end: "2026-10-28" } })),
    ).toThrow(AnalysisRangeError);
  });
});
