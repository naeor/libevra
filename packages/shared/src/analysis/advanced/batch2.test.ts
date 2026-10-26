import { describe, expect, it } from "vitest";

import {
  ADVANCED_DIMENSIONS,
  annualCalendarOf,
  boxplotByCategory,
  boxplotGroupIsOrdered,
  collectDimensionValues,
  crossCubeOf,
  dimensionKeyOf,
  isoWeekKey,
  isoWeekday,
  isLeapYear,
  pivotOf,
  smallMultiplesOf,
  sortDimensionKeys,
  weekIndexOf,
  type AdvancedRecord,
} from "./index.js";

function record(
  overrides: Partial<AdvancedRecord> & { occurredLocalDate: string; amountMinor: bigint },
): AdvancedRecord {
  return {
    id: overrides.id ?? `${overrides.occurredLocalDate}-${overrides.amountMinor.toString()}`,
    kind: overrides.kind ?? "expense",
    amountMinor: overrides.amountMinor,
    currency: overrides.currency ?? "CNY",
    occurredLocalDate: overrides.occurredLocalDate,
    categoryId: overrides.categoryId ?? "c-food",
    categoryLabel: overrides.categoryLabel ?? "餐饮",
    paymentMethodId: overrides.paymentMethodId === undefined ? "pm-card" : overrides.paymentMethodId,
    paymentMethodLabel: overrides.paymentMethodLabel === undefined ? "银行卡" : overrides.paymentMethodLabel,
  };
}

describe("dimensions · 维度键与时间桶", () => {
  it("ISO 星期与 ISO 周键（周一起始）", () => {
    expect(isoWeekday("2026-01-01")).toBe(4); // 周四
    expect(isoWeekday("2026-10-27")).toBe(2); // 周二
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01");
    expect(isoWeekKey("2026-12-31")).toBe("2026-W53");
  });

  it("维度键/标签：支付方式缺失落到显式键", () => {
    const item = record({
      occurredLocalDate: "2026-03-05",
      amountMinor: 100n,
      paymentMethodId: null,
      paymentMethodLabel: null,
    });
    expect(dimensionKeyOf(item, "paymentMethod")).toBe("__unspecified__");
    expect(dimensionKeyOf(item, "month")).toBe("2026-03");
    expect(dimensionKeyOf(item, "weekday")).toBe("4");
    expect(dimensionKeyOf(item, "kind")).toBe("expense");
  });

  it("维度取值收集后按时间/标签确定性排序", () => {
    const items = [
      record({ occurredLocalDate: "2026-02-01", amountMinor: 10n }),
      record({ occurredLocalDate: "2026-01-01", amountMinor: 10n, categoryId: "c-b", categoryLabel: "交通" }),
    ];
    const months = collectDimensionValues(items, "month");
    expect(months.values).toEqual(["2026-01", "2026-02"]);
    expect(sortDimensionKeys("weekday", ["7", "1", "5"], new Map())).toEqual(["1", "5", "7"]);
    expect(ADVANCED_DIMENSIONS).toContain("week");
  });
});

describe("P12 · 分类金额箱线图", () => {
  it("Type 7 分位与 IQR/围栏；分类按中位降序", () => {
    const result = boxplotByCategory([
      record({ occurredLocalDate: "2026-01-01", amountMinor: 100n }),
      record({ occurredLocalDate: "2026-01-02", amountMinor: 200n }),
      record({ occurredLocalDate: "2026-01-03", amountMinor: 300n }),
      record({ occurredLocalDate: "2026-01-04", amountMinor: 400n }),
      record({ occurredLocalDate: "2026-01-05", amountMinor: 900n, categoryId: "c-fun", categoryLabel: "娱乐" }),
    ]);

    expect(result.groups.map((group) => group.categoryId)).toEqual(["c-fun", "c-food"]);
    expect(result.quantileMethod).toBe("type7-linear");

    const food = result.groups[1];
    expect(food?.sampleCount).toBe(4);
    expect(food?.median).toEqual({ numerator: 250n, denominator: 1n });
    expect(food?.q1).toEqual({ numerator: 175n, denominator: 1n });
    expect(food?.q3).toEqual({ numerator: 325n, denominator: 1n });
    expect(food?.iqr).toEqual({ numerator: 150n, denominator: 1n });
    expect(food?.reliable).toBe(false); // 默认 5 笔才算可靠
    expect(boxplotGroupIsOrdered(food as NonNullable<typeof food>)).toBe(true);
  });

  it("1.5×IQR 围栏外的离群点；maxOutliersPerGroup 只回传前 N 大", () => {
    const amounts = [100n, 100n, 100n, 100n, 100n, 100n, 100n, 100n, 100n, 100n];
    const records = amounts.map((amount, index) =>
      record({ occurredLocalDate: `2026-02-${String(index + 1).padStart(2, "0")}`, amountMinor: amount }),
    );
    records.push(record({ occurredLocalDate: "2026-02-20", amountMinor: 9_900n }));
    records.push(record({ occurredLocalDate: "2026-02-21", amountMinor: 10_000n }));

    const group = boxplotByCategory(records, { minReliableSample: 10 }).groups[0];
    expect(group?.sampleCount).toBe(12);
    expect(group?.outlierCount).toBe(2);
    expect(group?.outlierMinors).toEqual([9_900n, 10_000n]);
    expect(group?.reliable).toBe(true);
  });

  it("空样本与非法输入", () => {
    expect(boxplotByCategory([]).completeness).toBe("no-transactions");
    expect(boxplotByCategory([record({ occurredLocalDate: "2026-01-01", amountMinor: 100n })]).groups[0]?.reliable).toBe(false);
    expect(() => boxplotByCategory([record({ occurredLocalDate: "2026-01-01", amountMinor: -1n })])).toThrow(RangeError);
    expect(() => boxplotByCategory([], { minReliableSample: 0 })).toThrow(RangeError);
  });
});

describe("P13 · 多指标交叉表", () => {
  const items = [
    record({ occurredLocalDate: "2026-01-05", amountMinor: 1_000n, categoryId: "c-food", categoryLabel: "餐饮", paymentMethodId: "pm-card", paymentMethodLabel: "银行卡" }),
    record({ occurredLocalDate: "2026-02-06", amountMinor: 2_000n, categoryId: "c-food", categoryLabel: "餐饮", paymentMethodId: "pm-cash", paymentMethodLabel: "现金" }),
    record({ occurredLocalDate: "2026-02-07", amountMinor: 4_000n, categoryId: "c-fun", categoryLabel: "娱乐", paymentMethodId: "pm-cash", paymentMethodLabel: "现金" }),
  ];

  it("金额指标：单元格/行/列/总计守恒", () => {
    const result = pivotOf(items, { rowDimension: "category", colDimension: "month", metric: "amount" });

    expect(result.rowIds).toEqual(["c-fun", "c-food"]);
    expect(result.colIds).toEqual(["2026-01", "2026-02"]);
    expect(result.cells).toHaveLength(3);
    expect(result.grandTotal.amountMinor).toBe(7_000n);
    expect(result.grandTotal.count).toBe(3);
    expect(result.rowTotals.get("c-food")?.amountMinor).toBe(3_000n);
    expect(result.colTotals.get("2026-02")?.amountMinor).toBe(6_000n);
    expect(result.conservation).toEqual({ amountsMatch: true, countsMatch: true });
  });

  it("笔数指标允许跨币种；金额指标跨币种且无币种维度被拒绝", () => {
    const mixed = [
      record({ occurredLocalDate: "2026-01-01", amountMinor: 1_000n, currency: "CNY" }),
      record({ occurredLocalDate: "2026-01-02", amountMinor: 2_000n, currency: "USD" }),
    ];
    expect(pivotOf(mixed, { rowDimension: "category", colDimension: "month", metric: "count" }).grandTotal.count).toBe(2);
    expect(() => pivotOf(mixed, { rowDimension: "category", colDimension: "month", metric: "amount" })).toThrow(RangeError);
    expect(pivotOf(mixed, { rowDimension: "currency", colDimension: "month", metric: "amount" }).grandTotal.amountMinor).toBe(3_000n);
  });

  it("平均单笔与占比；行列同维度/非法指标被拒绝", () => {
    const average = pivotOf(items, { rowDimension: "category", colDimension: "month", metric: "average" });
    const foodTotal = average.rowTotals.get("c-food");
    expect(foodTotal?.metricValue).toEqual({ numerator: 1_500n, denominator: 1n });

    const share = pivotOf(items, { rowDimension: "category", colDimension: "month", metric: "share" });
    expect(share.cells.find((cell) => cell.rowId === "c-fun")?.metricValue).toEqual({ numerator: 4n, denominator: 7n });

    expect(() => pivotOf(items, { rowDimension: "category", colDimension: "category", metric: "amount" })).toThrow(RangeError);
    expect(() => pivotOf(items, { rowDimension: "category", colDimension: "month", metric: "bogus" as never })).toThrow(RangeError);
    expect(pivotOf([], { rowDimension: "category", colDimension: "month", metric: "amount" }).completeness).toBe("no-transactions");
  });
});

describe("P14 · 分类周期小多图", () => {
  it("共享尺度取所有面板最大单桶；缺失月份补 0", () => {
    const items = [
      record({ occurredLocalDate: "2026-01-05", amountMinor: 1_000n }),
      record({ occurredLocalDate: "2026-02-05", amountMinor: 3_000n }),
      record({ occurredLocalDate: "2026-01-09", amountMinor: 500n, categoryId: "c-fun", categoryLabel: "娱乐" }),
    ];
    const result = smallMultiplesOf(items);

    expect(result.bucketKeys).toEqual(["2026-01", "2026-02"]);
    expect(result.bucketLabels).toEqual(["1月", "2月"]);
    expect(result.sharedMaxMinor).toBe(3_000n);
    expect(result.panels[0]?.categoryId).toBe("c-food");
    expect(result.panels[0]?.points.map((point) => point.valueMinor)).toEqual([1_000n, 3_000n]);
    expect(result.panels[1]?.points.map((point) => point.valueMinor)).toEqual([500n, 0n]);
    expect(result.scaleMode).toBe("shared");
  });

  it("topN 截断显式报告；独立尺度仍保留共享最大值", () => {
    const items = Array.from({ length: 4 }, (_, index) =>
      record({
        occurredLocalDate: "2026-01-05",
        amountMinor: BigInt((index + 1) * 100),
        categoryId: `c-${String(index)}`,
        categoryLabel: `分类${String(index)}`,
      }),
    );
    const result = smallMultiplesOf(items, { topN: 2, scaleMode: "independent" });

    expect(result.panels).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.omittedCategoryCount).toBe(2);
    expect(result.sharedMaxMinor).toBe(400n);
    expect(result.panelMaxMinor.get("c-3")).toBe(400n);
  });

  it("空数据与非法参数", () => {
    expect(smallMultiplesOf([]).completeness).toBe("no-transactions");
    expect(() => smallMultiplesOf([], { topN: 0 })).toThrow(RangeError);
    expect(() => smallMultiplesOf([], { months: ["2026-13"] })).toThrow(RangeError);
  });
});

describe("P15 · 全年日历", () => {
  it("闰年 366 天、周数、月份起始列与星期", () => {
    const result = annualCalendarOf([], { year: 2024, today: "2026-10-27" });

    expect(result.leapYear).toBe(true);
    expect(result.dayCount).toBe(366);
    expect(result.days).toHaveLength(366);
    expect(result.days[0]?.date).toBe("2024-01-01");
    expect(result.days[0]?.weekday).toBe(1); // 2024-01-01 周一
    expect(result.monthStartWeekIndex).toHaveLength(12);
    expect(result.weekCount).toBe(weekIndexOf("2024-12-31") + 1);
    expect(isLeapYear(2025)).toBe(false);
  });

  it("无数据 / 进行中 / 未来 与 counts 区分", () => {
    const items = [
      record({ occurredLocalDate: "2026-10-26", amountMinor: 500n }),
      record({ occurredLocalDate: "2026-10-27", amountMinor: 700n }),
    ];
    const result = annualCalendarOf(items, { year: 2026, today: "2026-10-27" });

    const past = result.days.find((day) => day.date === "2026-10-25");
    const today = result.days.find((day) => day.date === "2026-10-27");
    const future = result.days.find((day) => day.date === "2026-10-28");

    expect(past?.state).toBe("no-data");
    expect(past?.valueMinor).toBe(0n);
    expect(today?.state).toBe("in-progress");
    expect(today?.valueMinor).toBe(700n);
    expect(future?.state).toBe("future");
    expect(result.futureDayCount).toBeGreaterThan(0);
    expect(result.inProgressDayCount).toBe(1);
    expect(result.noDataDayCount).toBeGreaterThan(0);
    expect(result.totalMinor).toBe(1_200n);
    expect(result.recordCount).toBe(2);
  });

  it("覆盖未知时过去日期标 unknown；count 指标；非法年份", () => {
    const unknown = annualCalendarOf([], { year: 2026, today: "2026-12-31", coverageKnown: false });
    expect(unknown.unknownDayCount + unknown.futureDayCount).toBe(364);
    expect(unknown.inProgressDayCount).toBe(1);
    expect(unknown.noDataDayCount).toBe(0);

    const counted = annualCalendarOf(
      [
        record({ occurredLocalDate: "2026-03-01", amountMinor: 100n }),
        record({ occurredLocalDate: "2026-03-01", amountMinor: 200n }),
      ],
      { year: 2026, metric: "count", today: "2026-12-31" },
    );
    expect(counted.days.find((day) => day.date === "2026-03-01")?.valueMinor).toBe(2n);
    expect(counted.totalCount).toBe(2);

    expect(() => annualCalendarOf([], { year: 1969, today: "2026-10-27" })).toThrow(RangeError);
    expect(() => annualCalendarOf([], { year: 2026, today: "2026-02-30" })).toThrow(RangeError);
  });
});

describe("P21 · 自定义多维", () => {
  const items = [
    record({ occurredLocalDate: "2026-01-05", amountMinor: 1_000n, paymentMethodId: "pm-card", paymentMethodLabel: "银行卡" }),
    record({ occurredLocalDate: "2026-01-06", amountMinor: 2_000n, paymentMethodId: "pm-cash", paymentMethodLabel: "现金" }),
    record({ occurredLocalDate: "2026-02-07", amountMinor: 4_000n, paymentMethodId: "pm-card", paymentMethodLabel: "银行卡" }),
  ];

  it("两维交叉：单元格稀疏、合计守恒、组合数", () => {
    const outcome = crossCubeOf(items, { metric: "amount", dimensions: ["category", "month"] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const { result } = outcome;
    expect(result.dimensions).toEqual(["category", "month"]);
    expect(result.cells).toHaveLength(2);
    expect(result.totalMinor).toBe(7_000n);
    expect(result.scaleNodeCount).toEqual([1, 2]);
    expect(result.combinations).toBe(2);
    expect(result.completeness).toBe("complete");
    expect(result.dimensionPositions.get("month")).toBe(1);
  });

  it("能力检查：拒绝非受控维度/重复维度/超 3 维/跨币种金额/组合超限", () => {
    const expectReject = (
      outcome: ReturnType<typeof crossCubeOf>,
      reason: string,
    ): void => {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe(reason);
    };

    expectReject(crossCubeOf(items, { metric: "amount", dimensions: ["nope" as never] }), "unsupported-dimension");
    expectReject(crossCubeOf(items, { metric: "amount", dimensions: ["category", "category"] }), "duplicate-dimension");
    expectReject(
      crossCubeOf(items, { metric: "amount", dimensions: ["category", "month", "weekday", "kind"] }),
      "too-many-dimensions",
    );
    expectReject(crossCubeOf(items, { metric: "count", dimensions: [] }), "too-many-dimensions");

    const mixed = [
      record({ occurredLocalDate: "2026-01-01", amountMinor: 1_000n, currency: "CNY" }),
      record({ occurredLocalDate: "2026-01-02", amountMinor: 2_000n, currency: "USD" }),
    ];
    expectReject(crossCubeOf(mixed, { metric: "amount", dimensions: ["category"] }), "mixed-currency");
    expect(crossCubeOf(mixed, { metric: "amount", dimensions: ["currency"] }).ok).toBe(true);

    expectReject(
      crossCubeOf(items, { metric: "count", dimensions: ["category", "month", "paymentMethod"], maxCombinations: 1 }),
      "too-many-combinations",
    );
  });
});
