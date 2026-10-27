import { describe, expect, it } from "vitest";

import type { Transaction } from "@libellum/shared";

import { AnalysisRangeError, deriveMovingAverage } from "./analysisData.js";

let nextId = 1;

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
    occurredAt: "2026-10-20T04:00:00.000Z",
    occurredLocalDate: "2026-10-20",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    ...overrides,
  };
}

describe("deriveMovingAverage（S4b A13/A14）", () => {
  it("窗口从可见区间之前读真实历史，第一个可见点就有完整 7 日窗口", () => {
    const transactions = [entry({ occurredLocalDate: "2026-10-01", amountCents: 70_000 })];
    const view = deriveMovingAverage(transactions, {
      span: { start: "2026-10-07", end: "2026-10-10" },
      today: "2026-10-27",
      windowDays: 7,
      coverage: "local-ledger",
    });

    expect(view.historyDays).toBe(6);
    expect(view.visibleFrom).toBe("2026-10-07");
    expect(view.points.map((point) => point.bucket.key)).toEqual([
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
    // 10-07 的窗口是 10-01..10-07（含读取的历史），分子 70000，分母 7。
    const first = view.points[0]!;
    expect(first.gapReason).toBeNull();
    expect(first.average).toEqual({ numeratorMinor: "70000", denominatorDays: 7 });
    expect(first.averageScaledMinor).toBe("100000000");
    // 确认的零支出日进入窗口（是 0，不是未知）。
    expect(view.points[1]!.average).toEqual({ numeratorMinor: "0", denominatorDays: 7 });
    expect(view.result.complete).toBe(true);
    expect(view.unavailableReason).toBeNull();
  });

  it("可见区间内的计数只看可见点，历史补读不进入 observedDays", () => {
    const transactions = [entry({ occurredLocalDate: "2026-10-01", amountCents: 70_000 })];
    const view = deriveMovingAverage(transactions, {
      span: { start: "2026-10-07", end: "2026-10-10" },
      today: "2026-10-27",
      windowDays: 7,
      coverage: "local-ledger",
    });

    expect(view.result.points).toHaveLength(3);
    expect(view.result.observedDays).toBe(3);
    expect(view.result.computablePoints).toBe(3);
    expect(view.result.missingHistoryPoints).toBe(0);
    expect(view.result.unknownWindowPoints).toBe(0);
  });

  it("A14 的 30 日窗口同样从历史补 29 天，平均是精确分数", () => {
    const transactions = [entry({ occurredLocalDate: "2026-10-01", amountCents: 30_000 })];
    const view = deriveMovingAverage(transactions, {
      span: { start: "2026-10-30", end: "2026-11-01" },
      today: "2026-11-02",
      windowDays: 30,
      coverage: "local-ledger",
    });

    expect(view.historyDays).toBe(29);
    expect(view.points).toHaveLength(2);
    expect(view.points[0]!.bucket.key).toBe("2026-10-30");
    expect(view.points[0]!.average).toEqual({ numeratorMinor: "30000", denominatorDays: 30 });
    expect(view.points[0]!.averageScaledMinor).toBe("10000000");
    expect(view.result.complete).toBe(true);
  });

  it("进行中的今天按 shared 口径计入（部分日），桶状态保留为 in-progress 供卡片标注", () => {
    const transactions = [entry({ occurredLocalDate: "2026-10-20", amountCents: 10_000 })];
    const view = deriveMovingAverage(transactions, {
      span: { start: "2026-10-20", end: "2026-10-28" },
      today: "2026-10-27",
      windowDays: 7,
      coverage: "local-ledger",
    });

    const keys = view.points.map((point) => point.bucket.key);
    expect(keys[keys.length - 1]).toBe("2026-10-27");
    // shared B-4 把「进行中的今天」当作部分日参与窗口（与未来日不同）；
    // 卡片必须通过桶状态判断并在 sampleText 里说明，不能把它写成完整日。
    const last = view.points[view.points.length - 1]!;
    expect(last.bucket.state).toBe("in-progress");
    expect(last.average).not.toBeNull();
    expect(view.points.filter((point) => point.bucket.state === "in-progress")).toHaveLength(1);
    expect(view.result.unknownWindowPoints).toBe(0);
  });

  it("覆盖未知时全部窗口不可计算，且不伪造空样本结论", () => {
    const transactions = [entry({ occurredLocalDate: "2026-10-01", amountCents: 70_000 })];
    const view = deriveMovingAverage(transactions, {
      span: { start: "2026-10-07", end: "2026-10-10" },
      today: "2026-10-27",
      windowDays: 7,
      coverage: "unknown",
    });

    expect(view.unavailableReason).toBe("no-complete-observations");
    expect(view.points.every((point) => point.average === null)).toBe(true);
    expect(view.points.every((point) => point.gapReason === "window-incomplete")).toBe(true);
    expect(view.result.complete).toBe(false);
  });

  it("scale 只影响展示用的定点展开，精确分数不受影响", () => {
    const transactions = [entry({ occurredLocalDate: "2026-10-02", amountCents: 10_000 })];
    const view = deriveMovingAverage(transactions, {
      span: { start: "2026-10-07", end: "2026-10-08" },
      today: "2026-10-27",
      windowDays: 7,
      coverage: "local-ledger",
      scale: 2,
    });

    expect(view.points[0]!.average).toEqual({ numeratorMinor: "10000", denominatorDays: 7 });
    expect(view.points[0]!.averageScaledMinor).toBe("142857");
  });

  it("非法窗口天数直接抛 RangeError", () => {
    const transactions = [entry({ occurredLocalDate: "2026-10-07" })];
    const base = {
      span: { start: "2026-10-07", end: "2026-10-10" },
      today: "2026-10-27",
      coverage: "local-ledger" as const,
    };
    expect(() => deriveMovingAverage(transactions, { ...base, windowDays: 0 })).toThrow(AnalysisRangeError);
    expect(() => deriveMovingAverage(transactions, { ...base, windowDays: 1.5 })).toThrow(AnalysisRangeError);
  });
});
