import { describe, expect, it } from "vitest";

import type { Transaction } from "@libellum/shared";

import {
  deriveDailyExpenseVariability,
  deriveIncomeStability,
  deriveWeekdayAnalysis,
} from "./analysisData.js";

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

const span = { start: "2026-10-01", end: "2026-10-27" };

describe("deriveDailyExpenseVariability（S4a I12/A12）", () => {
  it("精确均值与总体标准差，未知/未来日不参与", () => {
    const transactions = [
      entry({ occurredLocalDate: "2026-10-01", amountCents: 30_000 }),
      entry({ occurredLocalDate: "2026-10-02", amountCents: 10_000 }),
      entry({ occurredLocalDate: "2026-10-08", amountCents: 20_000 }),
    ];
    const view = deriveDailyExpenseVariability(transactions, {
      span,
      today: "2026-10-27",
      coverage: "local-ledger",
    });
    const result = view.result;
    expect(result).not.toBeNull();
    if (result === null) return;
    // 10-01..10-26 are confirmed days (today is still running): 26 observations,
    // including the days without any expense, which are confirmed zeros here.
    expect(result.observedCount).toBe(26);
    expect(result.excludedInProgressCount).toBe(0);
    expect(result.sumMinor).toBe("60000");
    expect(result.minMinor).toBe("0");
    expect(result.maxMinor).toBe("30000");
    expect(result.rangeMinor).toBe("30000");
    expect(result.mean.numeratorMinor).toBe("60000");
    expect(result.mean.denominatorCount).toBe(26);
    expect(result.meanScaledMinor).toBe("2307692307");
    // 30k and 20k sit >2σ above the 2,307 mean: the extreme-day rule is visible.
    expect(result.extremeDays.map((day) => day.date)).toEqual(["2026-10-01", "2026-10-08"]);
    expect(result.sufficientSample).toBe(true);
    expect(result.formula.stdDev).toBe("population-standard-deviation-v1");
    expect(view.points).toHaveLength(26);
    expect(view.unavailableReason).toBeNull();
  });

  it("覆盖未知时 result 为 null，而不是伪造 0 样本", () => {
    const transactions = [entry({ occurredLocalDate: "2026-10-02", amountCents: 10_000 })];
    const view = deriveDailyExpenseVariability(transactions, {
      span,
      today: "2026-10-27",
      coverage: "unknown",
    });
    expect(view.result).toBeNull();
    expect(view.unavailableReason).toBe("no-complete-observations");
    expect(view.points.every((point) => point.bucket.state !== "complete")).toBe(true);
  });

  it("非法 sigma 仍抛出，不被空样本兜底吞掉", () => {
    const transactions = [entry({ occurredLocalDate: "2026-10-02", amountCents: 10_000 })];
    expect(() =>
      deriveDailyExpenseVariability(transactions, {
        span,
        today: "2026-10-27",
        coverage: "local-ledger",
        extremeSigma: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe("deriveIncomeStability（S4a A20）", () => {
  it("只统计完整自然月，进行中月份不计入", () => {
    const transactions = [
      entry({ kind: "income", occurredLocalDate: "2026-07-05", amountCents: 100_000 }),
      entry({ kind: "income", occurredLocalDate: "2026-08-05", amountCents: 300_000 }),
      entry({ kind: "income", occurredLocalDate: "2026-10-03", amountCents: 500_000 }),
      entry({ kind: "expense", occurredLocalDate: "2026-08-06", amountCents: 999_999 }),
    ];
    const view = deriveIncomeStability(transactions, {
      span: { start: "2026-07-01", end: "2026-09-01" },
      today: "2026-10-27",
      coverage: "local-ledger",
      minSampleMonths: 2,
    });
    const result = view.result;
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.positiveMonths).toBe(2);
    expect(result.zeroMonths).toBe(0);
    expect(result.judgedState).toBe("computed");
    expect(result.minimumSampleMonths).toBe(2);
    expect(result.sumMinor).toBe("400000");
    expect(result.maxMinor).toBe("300000");
    expect(result.minMinor).toBe("100000");
    expect(result.mean.numeratorMinor).toBe("400000");
    expect(result.mean.denominatorCount).toBe(2);
  });

  it("样本月数不足时判定为 insufficient-sample，但数字仍如实给出", () => {
    const transactions = [
      entry({ kind: "income", occurredLocalDate: "2026-08-05", amountCents: 100_000 }),
    ];
    const view = deriveIncomeStability(transactions, {
      span: { start: "2026-08-01", end: "2026-10-01" },
      today: "2026-10-27",
      coverage: "local-ledger",
    });
    const result = view.result;
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.judgedState).toBe("insufficient-sample");
    expect(result.positiveMonths).toBe(1);
    expect(result.zeroMonths).toBe(1);
    expect(result.minimumSampleMonths).toBe(3);
  });

  it("覆盖未知时 result 为 null", () => {
    const view = deriveIncomeStability([], {
      span: { start: "2026-07-01", end: "2026-10-01" },
      today: "2026-10-27",
      coverage: "unknown",
    });
    expect(view.result).toBeNull();
    expect(view.unavailableReason).toBe("no-complete-observations");
  });
});

describe("deriveWeekdayAnalysis（S4a I13）", () => {
  it("七个桶、金额与笔数分列、平均只在出现过的日期上求", () => {
    const transactions = [
      // 2026-10-05 is a Monday, 2026-10-06 a Tuesday.
      entry({ occurredLocalDate: "2026-10-05", amountCents: 30_000 }),
      entry({ occurredLocalDate: "2026-10-05", amountCents: 10_000 }),
      entry({ occurredLocalDate: "2026-10-06", amountCents: 20_000 }),
      entry({ kind: "income", occurredLocalDate: "2026-10-05", amountCents: 90_000 }),
    ];
    const view = deriveWeekdayAnalysis(transactions, {
      kind: "expense",
      span,
      today: "2026-10-27",
      coverage: "local-ledger",
    });
    const result = view.result;
    expect(result.weekdays).toHaveLength(7);
    expect(result.weekdays.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Mondays in the confirmed range (10-01..10-26): 5, 12, 19, 26 -> 4 observed days.
    expect(result.weekdays[0]?.totalMinor).toBe("40000");
    expect(result.weekdays[0]?.observedDays).toBe(4);
    expect(result.weekdays[0]?.average?.numeratorMinor).toBe("40000");
    expect(result.weekdays[0]?.average?.denominatorDays).toBe(4);
    expect(result.weekdays[1]?.totalMinor).toBe("20000");
    expect(result.weekdays[1]?.observedDays).toBe(3);
    // A weekday with no expense is a confirmed zero, not a missing value.
    expect(result.weekdays[2]?.totalMinor).toBe("0");
    expect(result.weekdays[2]?.average?.numeratorMinor).toBe("0");
    // 26 observed days is below the 28-day stability threshold.
    expect(result.sufficientSample).toBe(false);
    expect(result.complete).toBe(true);
  });

  it("覆盖未知时所有桶金额为 null 而不是 0", () => {
    const transactions = [entry({ occurredLocalDate: "2026-10-05", amountCents: 30_000 })];
    const view = deriveWeekdayAnalysis(transactions, {
      kind: "expense",
      span,
      today: "2026-10-27",
      coverage: "unknown",
    });
    expect(view.result.weekdays.every((day) => day.totalMinor === null)).toBe(true);
    expect(view.result.weekdays.every((day) => day.average === null)).toBe(true);
    expect(view.result.unknownDayCount).toBe(26);
    expect(view.result.complete).toBe(false);
  });
});
