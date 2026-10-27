import { describe, expect, it } from "vitest";

import type { Transaction } from "@libellum/shared";

import {
  AnalysisRangeError,
  AnalyzeEntryError,
  MAX_ANALYSIS_DAYS,
  analysisSpan,
  assertSupportedGranularity,
  buildAnalysisInput,
  deriveCategoryAnalysis,
  deriveCategoryTrend,
  deriveCumulativeAnalysis,
  deriveFlowAnalysis,
  deriveMultiMonthComparison,
  derivePeriodComparison,
  rankCategories,
  toTimeSeriesEntries,
  trailingMonthWindow,
  trailingWeekWindow,
  trailingWindow,
} from "./analysisData.js";

let nextId = 1;

/** Minimal well-formed transaction: only the fields the analysis layer reads. */
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

describe("analysisSpan", () => {
  it("把闭区间业务日期转成半开区间", () => {
    expect(analysisSpan({ from: "2026-10-01", to: "2026-10-27" })).toEqual({
      start: "2026-10-01",
      end: "2026-10-28",
    });
  });

  it("单日窗口是 [当天, 次日)", () => {
    expect(analysisSpan({ from: "2026-10-27", to: "2026-10-27" })).toEqual({
      start: "2026-10-27",
      end: "2026-10-28",
    });
  });

  it("恰好 400 天允许，401 天按上限拒绝（不截断）", () => {
    expect(() => analysisSpan({ from: "2025-09-23", to: "2026-10-27" })).not.toThrow();
    expect(() => analysisSpan({ from: "2025-09-22", to: "2026-10-27" })).toThrow(AnalysisRangeError);
    try {
      analysisSpan({ from: "2025-09-22", to: "2026-10-27" });
    } catch (error) {
      expect((error as AnalysisRangeError).code).toBe("analysis-range-too-long");
    }
  });

  it("开始晚于结束是非法区间", () => {
    expect(() => analysisSpan({ from: "2026-10-27", to: "2026-10-01" })).toThrow(AnalysisRangeError);
  });

  it("非法日期格式直接拒绝", () => {
    expect(() => analysisSpan({ from: "2026-02-30", to: "2026-10-01" })).toThrow();
    expect(() => analysisSpan({ from: "2026/10/01", to: "2026-10-01" })).toThrow();
  });

  it("maxDays 可由调用方覆盖（S-01 §17 参数化）", () => {
    expect(() => analysisSpan({ from: "2025-10-01", to: "2026-10-27" }, 500)).not.toThrow();
    expect(MAX_ANALYSIS_DAYS).toBe(400);
  });
});

describe("trailingWindow", () => {
  it("最近 30 天含今天", () => {
    expect(trailingWindow(30, "2026-10-27")).toEqual({ from: "2026-09-28", to: "2026-10-27" });
  });

  it("天数必须是正整数", () => {
    expect(() => trailingWindow(0, "2026-10-27")).toThrow(AnalysisRangeError);
    expect(() => trailingWindow(1.5, "2026-10-27")).toThrow(AnalysisRangeError);
  });
});

describe("toTimeSeriesEntries", () => {
  it("保留收入/支出与业务日期，金额取精确分", () => {
    const input = [
      entry({ kind: "expense", amountCents: 12_345, occurredLocalDate: "2026-10-01" }),
      entry({ kind: "income", amountCents: 500_000, occurredLocalDate: "2026-10-02" }),
    ];
    expect(toTimeSeriesEntries(input)).toEqual([
      { occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 12_345 },
      { occurredLocalDate: "2026-10-02", kind: "income", amountMinor: 500_000 },
    ]);
  });

  it("已删除的账目不进入分析（不把删除的账目画回来）", () => {
    const input = [
      entry({ occurredLocalDate: "2026-10-01" }),
      entry({ occurredLocalDate: "2026-10-02", deletedAt: "2026-10-03T00:00:00.000Z" }),
    ];
    expect(toTimeSeriesEntries(input)).toHaveLength(1);
  });

  it("非法金额抛出可定位错误而不是猜测", () => {
    expect(() => toTimeSeriesEntries([entry({ amountCents: -1 })])).toThrow(AnalyzeEntryError);
    expect(() => toTimeSeriesEntries([entry({ amountCents: 1.5 })])).toThrow(AnalyzeEntryError);
  });

  it("空输入得到空数组", () => {
    expect(toTimeSeriesEntries([])).toEqual([]);
  });
});

describe("buildAnalysisInput", () => {
  it("给出区间、条目、未知覆盖与空 dataVersion（S0 事实）", () => {
    const input = buildAnalysisInput([entry({ occurredLocalDate: "2026-10-05" })], {
      from: "2026-10-01",
      to: "2026-10-27",
    });
    expect(input.span).toEqual({ start: "2026-10-01", end: "2026-10-28" });
    expect(input.entries).toHaveLength(1);
    expect(input.coverageEnd).toBeNull();
    expect(input.dataVersion).toBeNull();
  });
});

describe("assertSupportedGranularity", () => {
  it("接受 day/week/month，拒绝 year", () => {
    expect(() => assertSupportedGranularity("day")).not.toThrow();
    expect(() => assertSupportedGranularity("week")).not.toThrow();
    expect(() => assertSupportedGranularity("month")).not.toThrow();
    expect(() => assertSupportedGranularity("year")).toThrow(AnalysisRangeError);
  });
});

// ---------------------------------------------------------------------------
// S1 — 时间趋势族（I07–I10 / I19 / I20 / I11）
// ---------------------------------------------------------------------------

describe("trailingWeekWindow", () => {
  it("以周一为界，最后一桶是本周（当前周会被引擎标为进行中）", () => {
    // 2026-10-27 是周二；本周周一 = 2026-10-26。
    expect(trailingWeekWindow(1, "2026-10-27")).toEqual({ from: "2026-10-26", to: "2026-10-27" });
    expect(trailingWeekWindow(2, "2026-10-27")).toEqual({ from: "2026-10-19", to: "2026-10-27" });
  });

  it("跨年、跨月也按自然周向右对齐", () => {
    expect(trailingWeekWindow(1, "2027-01-02")).toEqual({ from: "2026-12-28", to: "2027-01-02" });
    expect(trailingWeekWindow(3, "2026-11-03")).toEqual({ from: "2026-10-19", to: "2026-11-03" });
  });

  it("周数必须为正整数", () => {
    expect(() => trailingWeekWindow(0, "2026-10-27")).toThrow(AnalysisRangeError);
    expect(() => trailingWeekWindow(1.5, "2026-10-27")).toThrow(AnalysisRangeError);
  });
});

describe("trailingMonthWindow", () => {
  it("以自然月为界，最后一桶是本月（今天之前的日期）", () => {
    expect(trailingMonthWindow(1, "2026-10-27")).toEqual({ from: "2026-10-01", to: "2026-10-27" });
    expect(trailingMonthWindow(3, "2026-10-27")).toEqual({ from: "2026-08-01", to: "2026-10-27" });
  });

  it("跨年得到正确的上月首日", () => {
    expect(trailingMonthWindow(2, "2027-01-15")).toEqual({ from: "2026-12-01", to: "2027-01-15" });
    expect(trailingMonthWindow(13, "2027-01-15")).toEqual({ from: "2026-01-01", to: "2027-01-15" });
  });
});

describe("deriveCumulativeAnalysis", () => {
  const transactions = [
    entry({ occurredLocalDate: "2026-10-01", amountCents: 100 }),
    entry({ occurredLocalDate: "2026-10-02", amountCents: 300 }),
    entry({ occurredLocalDate: "2026-10-03", kind: "income", amountCents: 999 }),
  ];

  const query = {
    metric: "expense" as const,
    granularity: "day" as const,
    span: { start: "2026-10-01", end: "2026-10-04" },
    today: "2026-10-04",
    coverage: "local-ledger" as const,
  };

  it("逐日累计是精确分的累加（I20）", () => {
    const view = deriveCumulativeAnalysis(transactions, query);
    expect(view.result.points.map((point) => point.cumulativeMinor)).toEqual(["100", "400", "400"]);
    expect(view.result.totalMinor).toBe("400");
    expect(view.result.complete).toBe(true);
  });

  it("未知覆盖时累计链断开，之后不再给自信数字", () => {
    const view = deriveCumulativeAnalysis(transactions, { ...query, coverage: "unknown" });
    expect(view.result.points[0]?.cumulativeMinor).toBeNull();
    expect(view.result.totalMinor).toBeNull();
    expect(view.result.complete).toBe(false);
  });
});

describe("deriveFlowAnalysis", () => {
  const transactions = [
    entry({ occurredLocalDate: "2026-10-01", kind: "income", amountCents: 500 }),
    entry({ occurredLocalDate: "2026-10-02", amountCents: 200 }),
  ];

  it("收入与支出共用同一时间轴（I11）", () => {
    const view = deriveFlowAnalysis(transactions, {
      granularity: "day",
      span: { start: "2026-10-01", end: "2026-10-03" },
      today: "2026-10-03",
      coverage: "local-ledger",
    });
    expect(view.result.buckets).toHaveLength(2);
    expect(view.result.totalIncomeMinor).toBe("500");
    expect(view.result.totalExpenseMinor).toBe("200");
    expect(view.result.totalDifferenceMinor).toBe("300");
  });

  it("覆盖未知时收入/支出总额都不冒充已知", () => {
    const view = deriveFlowAnalysis(transactions, {
      granularity: "day",
      span: { start: "2026-10-01", end: "2026-10-03" },
      today: "2026-10-03",
      coverage: "unknown",
    });
    expect(view.result.totalIncomeMinor).toBeNull();
    expect(view.result.totalExpenseMinor).toBeNull();
    expect(view.result.complete).toBe(false);
  });
});

describe("S2 分类区（I14 / I15 / I16）", () => {
  const transactions = [
    entry({ occurredLocalDate: "2026-10-01", categoryId: "food", amountCents: 300 }),
    entry({ occurredLocalDate: "2026-10-01", categoryId: "food", amountCents: 200 }),
    entry({ occurredLocalDate: "2026-10-01", categoryId: "rent", amountCents: 1_000 }),
    entry({ occurredLocalDate: "2026-10-02", categoryId: "food", amountCents: 500 }),
    entry({ occurredLocalDate: "2026-10-02", kind: "income", categoryId: "salary", amountCents: 9_000 }),
    entry({ occurredLocalDate: "2026-10-03", categoryId: "food", amountCents: 1 }),
  ];

  const query = {
    kind: "expense" as const,
    categoryIds: ["food", "rent"],
    granularity: "day" as const,
    span: { start: "2026-10-01", end: "2026-10-04" },
    today: "2026-10-04",
    coverage: "local-ledger" as const,
  };

  it("只按 kind 过滤，按分类稳定 ID 聚合（I15）", () => {
    const view = deriveCategoryAnalysis(transactions, query);
    expect(view.result.kind).toBe("expense");
    expect(view.result.buckets).toHaveLength(3);
    expect(view.result.totals.food).toBe("1001");
    expect(view.result.totals.rent).toBe("1000");
    expect(view.result.totalMinor).toBe("2001");
    expect(view.result.complete).toBe(true);
  });

  it("includeOther 的“其他”等于桶总额减选中分类合计（I15）", () => {
    const view = deriveCategoryAnalysis(transactions, {
      ...query,
      categoryIds: ["food"],
      includeOther: true,
    });
    expect(view.result.categoryIds).toEqual(["food", "__other__"]);
    expect(view.result.totals.__other__).toBe("1000");
    expect(view.result.totalMinor).toBe("2001");
  });

  it("桶内占比的分母是权威总额，选中分类 + 其他 = 100%（I16）", () => {
    const view = deriveCategoryAnalysis(transactions, {
      ...query,
      categoryIds: ["food"],
      includeOther: true,
      span: { start: "2026-10-01", end: "2026-10-02" },
      today: "2026-10-02",
    });
    const first = view.shares.buckets[0];
    expect(first?.totalMinor).toBe("1500");
    expect(first?.points[0]?.share).toEqual({ numeratorMinor: "500", denominatorMinor: "1500" });
    expect(first?.points[1]?.share).toEqual({ numeratorMinor: "1000", denominatorMinor: "1500" });
    expect(first?.state).toBe("ok");
  });

  it("未知覆盖时分类金额与占比都为 null，不是 0", () => {
    const view = deriveCategoryAnalysis(transactions, { ...query, coverage: "unknown" });
    expect(view.result.totals.food).toBeNull();
    expect(view.result.totalMinor).toBeNull();
    expect(view.shares.buckets[0]?.state).toBe("unknown");
    expect(view.shares.buckets[0]?.points[0]?.share).toBeNull();
  });

  it("I14 单分类趋势的数字与分类序列该点一致", () => {
    const trend = deriveCategoryTrend(transactions, {
      categoryId: "food",
      kind: "expense",
      granularity: "day",
      span: { start: "2026-10-01", end: "2026-10-04" },
      today: "2026-10-04",
      coverage: "local-ledger",
    });
    const composition = deriveCategoryAnalysis(transactions, query);

    expect(trend.result.buckets.map((bucket) => bucket.amountMinor)).toEqual(["500", "500", "1"]);
    expect(trend.result.buckets.map((bucket) => bucket.amountMinor)).toEqual(
      composition.result.buckets.map(
        (bucket) => bucket.points.find((point) => point.categoryId === "food")?.amountMinor ?? null,
      ),
    );
    expect(trend.result.totalMinor).toBe("1001");
  });

  it("排行按区间总额降序，并列共享排名（I16 排行）", () => {
    const tied = [
      entry({ occurredLocalDate: "2026-10-01", categoryId: "a", amountCents: 100 }),
      entry({ occurredLocalDate: "2026-10-01", categoryId: "b", amountCents: 100 }),
      entry({ occurredLocalDate: "2026-10-01", categoryId: "c", amountCents: 50 }),
      entry({ occurredLocalDate: "2026-10-01", categoryId: "d", amountCents: 0 }),
    ];
    const view = deriveCategoryAnalysis(tied, {
      kind: "expense",
      categoryIds: ["a", "b", "c", "d"],
      granularity: "day",
      span: { start: "2026-10-01", end: "2026-10-02" },
      today: "2026-10-02",
      coverage: "local-ledger",
    });
    const rows = rankCategories(view);

    expect(rows.map((row) => [row.categoryId, row.rank, row.tiedWithPrevious])).toEqual([
      ["a", 1, false],
      ["b", 1, true],
      ["c", 3, false],
      ["d", 4, false],
    ]);
    expect(rows[0]?.share).toEqual({ numeratorMinor: "100", denominatorMinor: "250" });
  });

  it("排行的 limit 生效且不混入“其他”", () => {
    const view = deriveCategoryAnalysis(transactions, { ...query, includeOther: true });
    const rows = rankCategories(view, 1);
    expect(rows).toHaveLength(1);
    expect(rows.every((row) => row.categoryId !== "__other__")).toBe(true);
  });
});

describe("derivePeriodComparison（S3 A01/A02/A03/A05）", () => {
  const transactions = [
    entry({ occurredLocalDate: "2026-09-10", amountCents: 500 }),
    entry({ occurredLocalDate: "2026-10-10", amountCents: 800 }),
    entry({ occurredLocalDate: "2026-09-20", kind: "income", amountCents: 1_000 }),
    entry({ occurredLocalDate: "2026-10-20", kind: "income", amountCents: 2_000 }),
  ];
  const october = analysisSpan({ from: "2026-10-01", to: "2026-10-27" });

  it("上期收支比较：金额、差额与上期区间都由 shared 结果给出（A01）", () => {
    const view = derivePeriodComparison(transactions, {
      kind: "previous-period",
      current: october,
      today: "2026-10-27",
      coverage: "local-ledger",
    });

    expect(view.result.kind).toBe("previous-period");
    expect(view.result.expense).toMatchObject({
      metric: "expense",
      currentMinor: "800",
      previousMinor: "500",
      differenceMinor: "300",
    });
    expect(view.result.income).toMatchObject({
      metric: "income",
      currentMinor: "2000",
      previousMinor: "1000",
      differenceMinor: "1000",
    });
    // Previous-period uses a same-length rolling window: 27 days ending the day before
    // the current period starts (2026-09-04 → 2026-10-01).
    expect(view.result.resolution.previous).toEqual({ start: "2026-09-04", end: "2026-10-01" });
    expect(view.result.resolution.sameLength).toBe(true);
  });

  it("增长率只给精确分子/分母，百分比与文案留给调用方（A02）", () => {
    const view = derivePeriodComparison(transactions, {
      kind: "month-over-month",
      current: october,
      today: "2026-10-27",
    });

    expect(view.result.expense.growth.state).toBe("computed");
    if (view.result.expense.growth.state === "computed") {
      expect(String(view.result.expense.growth.numeratorMinor)).toBe("300");
      expect(String(view.result.expense.growth.denominatorMinor)).toBe("500");
    }
  });

  it("同比把 2/29 对齐到目标年 2 月最后一天并留下记录，不静默丢日（A03）", () => {
    const view = derivePeriodComparison([], {
      kind: "year-over-year",
      // 2028-02-01 → 2028-02-29 half-open: the exclusive end 2028-02-29 has no
      // counterpart in 2027, so it is aligned to 2027-02-28 and recorded.
      current: analysisSpan({ from: "2028-02-01", to: "2028-02-28" }),
      today: "2028-02-28",
    });

    expect(view.result.resolution.leapDayFallbacks).toEqual([
      { date: "2028-02-29", alignedTo: "2027-02-28" },
    ]);
  });

  it("本月至今默认同序号窗口：本月 1–27 日对上月 1–27 日（A05）", () => {
    const view = derivePeriodComparison(transactions, {
      kind: "month-to-date",
      today: "2026-10-27",
    });

    expect(view.result.resolution.current).toEqual({ start: "2026-10-01", end: "2026-10-28" });
    expect(view.result.resolution.previous).toEqual({ start: "2026-09-01", end: "2026-09-28" });
    expect(view.result.resolution.currentDayInProgress).toBe(true);
    expect(view.result.expense.currentMinor).toBe("800");
    expect(view.result.expense.previousMinor).toBe("500");
  });

  it("日窗口上限由调用方传入，越界拒绝而不是截断（S-01 v2 §17）", () => {
    expect(() =>
      derivePeriodComparison(transactions, {
        kind: "previous-period",
        current: october,
        today: "2026-10-27",
        maxDays: 10,
      }),
    ).toThrow(AnalysisRangeError);
  });

  it("覆盖未知时金额为 null，差额与增长率不伪造为 0", () => {
    const view = derivePeriodComparison(transactions, {
      kind: "previous-period",
      current: october,
      today: "2026-10-27",
      coverage: "unknown",
    });

    expect(view.result.expense.currentMinor).toBeNull();
    expect(view.result.expense.previousMinor).toBeNull();
    expect(view.result.expense.differenceMinor).toBeNull();
    expect(view.result.expense.growth.state).toBe("unavailable");
  });
});

describe("deriveMultiMonthComparison（S3 A04）", () => {
  const transactions = [
    entry({ occurredLocalDate: "2026-07-05", amountCents: 100 }),
    entry({ occurredLocalDate: "2026-09-05", amountCents: 50 }),
    entry({ occurredLocalDate: "2026-10-05", amountCents: 30 }),
  ];

  it("逐月金额、完整月排行与进行中月不可比（A04）", () => {
    const view = deriveMultiMonthComparison(transactions, {
      months: ["2026-07", "2026-08", "2026-09", "2026-10"],
      metric: "expense",
      today: "2026-10-27",
      coverage: "local-ledger",
    });

    expect(view.result.months.map((month) => month.amountMinor)).toEqual([
      "100",
      "0",
      "50",
      // The current month is still running: its amount is unconfirmed, not 30.
      null,
    ]);
    expect(view.result.months[3]?.comparable).toBe(false);
    expect(view.result.ranking?.map((entry) => entry.month)).toEqual([
      "2026-07",
      "2026-09",
      "2026-08",
    ]);
    // A total that includes a running month is not confirmed, so it is null rather
    // than "150" (sum of the complete months only would be a different statement).
    expect(view.result.totalMinor).toBeNull();
    expect(view.result.completeMonths).toBe(3);
    expect(view.result.complete).toBe(false);
  });

  it("跨年月份保留年份并给出 cross-year 提示", () => {
    const view = deriveMultiMonthComparison(transactions, {
      months: ["2025-11", "2026-01"],
      metric: "expense",
      today: "2026-10-27",
    });
    expect(view.result.crossYear).toBe(true);
    expect(view.result.months.map((month) => month.month)).toEqual(["2025-11", "2026-01"]);
  });

  it("月份数超过 36 拒绝而不是截断（S-01 v2 §17 draft）", () => {
    const months: string[] = [];
    for (let index = 0; index < 37; index += 1) {
      const year = 2023 + Math.floor(index / 12);
      const month = (index % 12) + 1;
      months.push(`${year}-${String(month).padStart(2, "0")}`);
    }
    expect(() =>
      deriveMultiMonthComparison(transactions, {
        months,
        metric: "expense",
        today: "2026-10-27",
      }),
    ).toThrow(AnalysisRangeError);
  });

  it("覆盖未知时逐月金额与总额都是 null", () => {
    const view = deriveMultiMonthComparison(transactions, {
      months: ["2026-07", "2026-09"],
      metric: "expense",
      today: "2026-10-27",
      coverage: "unknown",
    });
    expect(view.result.months.every((month) => month.amountMinor === null)).toBe(true);
    expect(view.result.totalMinor).toBeNull();
  });
});
