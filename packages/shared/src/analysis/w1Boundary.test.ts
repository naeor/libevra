/**
 * A-4 准备：W1 边界用例（时间桶 × 账目聚合的交叉约束）。
 *
 * 数据来源：本文件的 `tx(...)` 构造的**合成样本**（明确标注，非 fixtures 库的
 * A–O 原始样本，按 Lead m03390「不得改 fixtures 库原始数据，只能构造合成样本并标注」）。
 * 目标是把 `timeKeys` 的区间键语义与既有 `primitives` 的账目聚合放在一起验证：
 * 桶连续覆盖、首尾裁剪、跨年/闰年/月末、空桶不伪造 0、逐桶求和守恒、多币种隔离、
 * 大整数精度、区间上限、dataVersion 透传。
 */
import { describe, expect, it } from "vitest";

import { addDays, daysBetween } from "../stats.js";
import { assembleTotalExpense } from "./analyses/basic.js";
import { makePeriod, type WorkbenchState } from "./context.js";
import {
  assertSingleCurrency,
  dayTotals,
  entriesInRange,
  totalsOf,
  type AnalysisEntry,
} from "./primitives.js";
import {
  alignDateToYear,
  alignLeapDay,
  assertWithinAnalysisLimit,
  bucketOf,
  enumerateBuckets,
  isoWeekKey,
  isLeapYear,
  isMonthKey,
  isValidIsoWeekKey,
  monthKey,
  type AdaptedBucket,
  type InclusiveRange,
  type TimeKeyGranularity,
} from "./timeKeys.js";

/** 合成样本账目（非 fixtures 库数据；仅 W1 边界测试使用）。 */
function tx(
  id: string,
  amountMinor: bigint,
  occurredLocalDate: string,
  kind: "expense" | "income" = "expense",
  currency = "CNY",
): AnalysisEntry {
  return {
    id,
    kind,
    amountMinor,
    currency,
    occurredLocalDate,
    categoryId: "cat-w1",
  };
}

function bucketEntries(
  entries: readonly AnalysisEntry[],
  bucket: AdaptedBucket,
): readonly AnalysisEntry[] {
  return entriesInRange(entries, bucket.from, bucket.to);
}

function assertContinuousCoverage(
  buckets: readonly AdaptedBucket[],
  granularity: TimeKeyGranularity,
  range: InclusiveRange,
): void {
  expect(buckets.length).toBeGreaterThan(0);
  expect(buckets[0]?.granularity).toBe(granularity);
  expect(buckets[0]?.from).toBe(range.from);
  expect(buckets[buckets.length - 1]?.to).toBe(range.to);
  for (let index = 1; index < buckets.length; index += 1) {
    expect(buckets[index]?.span.start).toBe(buckets[index - 1]?.span.end);
  }
}

describe("W1 边界：时间桶枚举（合成样本，非 fixtures 库数据）", () => {
  const crossYear: InclusiveRange = { from: "2026-12-20", to: "2027-01-10" };

  it("日桶：逐日连续、无裁剪、数量等于闭区间天数", () => {
    const buckets = enumerateBuckets(crossYear, "day");
    assertContinuousCoverage(buckets, "day", crossYear);
    expect(buckets).toHaveLength(daysBetween(crossYear.from, crossYear.to));
    for (const bucket of buckets) {
      expect(bucket.key).toBe(bucket.from);
      expect(bucket.span).toEqual({
        start: bucket.from,
        end: addDays(bucket.to, 1),
      });
      expect(bucket.clippedStart).toBe(false);
      expect(bucket.clippedEnd).toBe(false);
    }
  });

  it("周桶：首桶被区间起点裁剪、跨年含 ISO W53、末桶正确裁剪", () => {
    const buckets = enumerateBuckets(crossYear, "week");
    assertContinuousCoverage(buckets, "week", crossYear);
    expect(buckets[0]?.clippedStart).toBe(true);
    expect(buckets[0]?.from).toBe(crossYear.from);
    // 2026-12-28 所在 ISO 周为 2026-W53（2026 年有第 53 周）。
    expect(isoWeekKey("2026-12-28")).toBe("2026-W53");
    expect(isValidIsoWeekKey("2026-W53")).toBe(true);
    expect(buckets.some((bucket) => bucket.key === "2026-W53")).toBe(true);
    // 末尾落在周日：最后一周自然结束于次日，不裁剪。
    expect(buckets[buckets.length - 1]?.key).toBe(isoWeekKey("2027-01-10"));
    expect(buckets[buckets.length - 1]?.clippedEnd).toBe(false);

    // 换一个非周日结束的区间：末周必须被终点裁剪，且闭区间端点回到区间结束日。
    const midWeekEnd: InclusiveRange = { from: "2026-12-20", to: "2027-01-06" };
    const clipped = enumerateBuckets(midWeekEnd, "week");
    expect(clipped[clipped.length - 1]?.clippedEnd).toBe(true);
    expect(clipped[clipped.length - 1]?.to).toBe(midWeekEnd.to);
  });

  it("月桶：跨年、首尾裁剪；闰年 2 月 span 为 29 天", () => {
    const crossMonth = enumerateBuckets(crossYear, "month");
    assertContinuousCoverage(crossMonth, "month", crossYear);
    expect(crossMonth.map((bucket) => bucket.key)).toEqual(["2026-12", "2027-01"]);
    expect(crossMonth[0]?.clippedStart).toBe(true);
    expect(crossMonth[1]?.clippedEnd).toBe(true);
    expect(crossMonth[1]?.to).toBe(crossYear.to);

    const leapRange: InclusiveRange = { from: "2028-01-25", to: "2028-03-05" };
    const leapBuckets = enumerateBuckets(leapRange, "month");
    expect(leapBuckets.map((bucket) => bucket.key)).toEqual([
      "2028-01",
      "2028-02",
      "2028-03",
    ]);
    const february = leapBuckets[1];
    expect(february?.span).toEqual({ start: "2028-02-01", end: "2028-03-01" });
    expect(daysBetween(february!.span.start, addDays(february!.span.end, -1))).toBe(29);
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2027)).toBe(false);
    expect(isMonthKey("2028-02")).toBe(true);
    expect(isMonthKey("2028-13")).toBe(false);
  });

  it("空桶不伪造 0：桶枚举与账目无关，空桶取数为空数组", () => {
    const range: InclusiveRange = { from: "2026-10-01", to: "2026-10-05" };
    const entries = [tx("w1-empty-a", 100n, "2026-10-01")];
    const buckets = enumerateBuckets(range, "day");
    expect(buckets).toHaveLength(5);

    const empty = buckets.slice(1);
    for (const bucket of empty) {
      expect(bucketEntries(entries, bucket)).toHaveLength(0);
    }
    // 既有原语只返回有记录的日期，不补 0 值。
    expect(dayTotals(entries)).toHaveLength(1);
  });

  it("闰日/月末对齐：目标年不存在 2/29 时取该月月末并标 clamped", () => {
    expect(alignLeapDay("2028-02-29", 2027)).toEqual({
      date: "2027-02-28",
      clamped: true,
    });
    expect(alignLeapDay("2028-02-29", 2026)).toEqual({
      date: "2026-02-28",
      clamped: true,
    });
    expect(alignDateToYear("2026-01-31", 2027)).toEqual({
      date: "2027-01-31",
      clamped: false,
    });
    expect(() => alignLeapDay("2027-02-28", 2026)).toThrowError(/not_leap_day/);
  });

  it("区间上限：400 天（含端点）可枚举、401 天直接拒绝而不截断", () => {
    const maxRange: InclusiveRange = {
      from: "2026-01-01",
      to: "2027-02-04", // 含两端共 400 天
    };
    expect(daysBetween(maxRange.from, maxRange.to)).toBe(400);
    expect(() => assertWithinAnalysisLimit(maxRange)).not.toThrow();
    expect(enumerateBuckets(maxRange, "month")).toHaveLength(14);

    const tooLong: InclusiveRange = { from: "2026-01-01", to: "2027-02-05" };
    expect(daysBetween(tooLong.from, tooLong.to)).toBe(401);
    expect(() => assertWithinAnalysisLimit(tooLong)).toThrowError(RangeError);
    expect(() => enumerateBuckets(tooLong, "month")).toThrowError(RangeError);
  });

  it("bucketOf 的键与自然 span 一致（日/周/月）", () => {
    expect(bucketOf("2026-10-15", "day")).toEqual({
      key: "2026-10-15",
      naturalSpan: { start: "2026-10-15", end: "2026-10-16" },
    });
    expect(bucketOf("2026-10-15", "week").key).toBe(isoWeekKey("2026-10-15"));
    expect(bucketOf("2026-10-15", "month")).toEqual({
      key: monthKey("2026-10-15"),
      naturalSpan: { start: "2026-10-01", end: "2026-11-01" },
    });
  });
});

describe("W1 边界：逐桶求和守恒（合成样本，非 fixtures 库数据）", () => {
  const range: InclusiveRange = { from: "2026-12-20", to: "2027-01-10" };
  const entries: readonly AnalysisEntry[] = [
    tx("w1-sum-1", 1_200n, "2026-12-20"),
    tx("w1-sum-2", 300n, "2026-12-21"),
    tx("w1-sum-3", 50n, "2026-12-31"),
    tx("w1-sum-4", 7n, "2027-01-01"),
    tx("w1-sum-5", 900n, "2027-01-10"),
    tx("w1-sum-6", 10_000n, "2027-01-05", "income"),
  ];

  it.each(["day", "week", "month"] as const)(
    "各粒度逐桶求和 = 区间合计（%s）",
    (granularity) => {
      const buckets = enumerateBuckets(range, granularity);
      const whole = totalsOf(entriesInRange(entries, range.from, range.to));
      let expense = 0n;
      let income = 0n;
      let count = 0;
      for (const bucket of buckets) {
        const totals = totalsOf(bucketEntries(entries, bucket));
        expense += totals.expenseMinor;
        income += totals.incomeMinor;
        count += totals.count;
      }
      expect(expense).toBe(whole.expenseMinor);
      expect(income).toBe(whole.incomeMinor);
      expect(count).toBe(whole.count);
      expect(expense).toBe(2_457n);
      expect(income).toBe(10_000n);
    },
  );

  it("多币种隔离：混合币种被拒绝，单币种合计精确", () => {
    const mixed = [
      tx("w1-mixed-1", 100n, "2026-10-01", "expense", "CNY"),
      tx("w1-mixed-2", 200n, "2026-10-02", "expense", "USD"),
    ];
    expect(() => assertSingleCurrency(mixed)).toThrowError(/mixed_currency/);
    expect(totalsOf(mixed.filter((entry) => entry.currency === "CNY")).expenseMinor).toBe(100n);
    expect(totalsOf(mixed.filter((entry) => entry.currency === "USD")).expenseMinor).toBe(200n);
  });

  it("大整数精度：超过 Number.MAX_SAFE_INTEGER 的金额逐桶求和与排序仍精确", () => {
    const big = [
      tx("w1-big-1", 9_007_199_254_740_993n, "2026-10-01"),
      tx("w1-big-2", 9_007_199_254_740_995n, "2026-10-02"),
      tx("w1-big-3", 1n, "2026-10-31"),
    ];
    const totals = totalsOf(big);
    expect(totals.expenseMinor).toBe(18_014_398_509_481_989n);
    expect(totals.expenseMinor > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);

    const buckets = enumerateBuckets({ from: "2026-10-01", to: "2026-10-31" }, "month");
    expect(bucketEntries(big, buckets[0]!).length).toBe(3);
    expect(totalsOf(bucketEntries(big, buckets[0]!)).expenseMinor).toBe(totals.expenseMinor);
  });

  it("dataVersion 透传：工作台快照版本进入结果 source，缺失时为 null", () => {
    const workbench: WorkbenchState = {
      period: makePeriod("2026-10-01", "2026-10-31"),
      today: "2026-10-31",
      currency: { mode: "original", currency: "CNY" },
      dataVersion: "dv-w1-001",
    };
    const definition = {
      version: "s01-draft" as const,
      analysisId: "AN-B01",
      analysisType: "scalar",
      metric: "expense-total",
      time: { mode: "inherit" as const },
      currency: { mode: "inherit" as const },
      filters: { kind: "expense" as const },
    };
    const withVersion = assembleTotalExpense(
      [tx("w1-dv-1", 100n, "2026-10-01")],
      definition,
      workbench,
    );
    expect(withVersion.source.dataVersion).toBe("dv-w1-001");

    const withoutVersion = assembleTotalExpense(
      [tx("w1-dv-2", 100n, "2026-10-01")],
      definition,
      {
        period: makePeriod("2026-10-01", "2026-10-31"),
        today: "2026-10-31",
        currency: { mode: "original", currency: "CNY" },
      },
    );
    expect(withoutVersion.source.dataVersion).toBeNull();
  });
});
