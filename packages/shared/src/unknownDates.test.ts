/**
 * 「金额无法确定的日期」（综合折算缺汇率）在时间引擎里的语义。
 *
 * 规则：含这些日期的桶是 `unknown`——金额与笔数为 `null`，不是 0；合计与累计因此也是 `null`
 * （一个漏了一天的合计不是合计）；不传 / 传空集合时结果与改动前逐位相同。
 * 期望值全部手算（字面量），不通过再调用被测函数得出。
 */
import { describe, expect, it } from "vitest";

import { computeCalendarHeatmap } from "./calendarHeatmap.js";
import { computeCategorySeries } from "./categorySeries.js";
import { accumulateSeries, computeFlowSeries, computeTimeSeries } from "./timeSeries.js";
import { classifyBucket, daySpan, weekSpan, monthSpan } from "./timeCalendar.js";

const TODAY = "2026-10-27";
const SPAN = { start: "2026-10-01", end: "2026-10-08" };

const entries = [
  { occurredLocalDate: "2026-10-01", kind: "expense" as const, amountMinor: 100 },
  { occurredLocalDate: "2026-10-02", kind: "expense" as const, amountMinor: 200 },
  { occurredLocalDate: "2026-10-02", kind: "income" as const, amountMinor: 5000 },
  { occurredLocalDate: "2026-10-04", kind: "expense" as const, amountMinor: 400 },
  { occurredLocalDate: "2026-10-07", kind: "expense" as const, amountMinor: 700 },
];

describe("classifyBucket · unknownDates", () => {
  it("含未知日期的桶是 unknown；不含的不受影响；未来桶仍是 future", () => {
    const unknownDates = new Set(["2026-10-03"]);
    const context = { today: TODAY, coverageEnd: TODAY, unknownDates };
    expect(classifyBucket({ naturalSpan: daySpan("2026-10-03"), span: daySpan("2026-10-03") }, context)).toBe("unknown");
    expect(classifyBucket({ naturalSpan: daySpan("2026-10-04"), span: daySpan("2026-10-04") }, context)).toBe("complete");
    // 10-03 是周六，所在的周（10-26 之前的 9-28~10-04）整周未知。
    expect(classifyBucket({ naturalSpan: weekSpan("2026-10-03"), span: weekSpan("2026-10-03") }, context)).toBe("unknown");
    expect(classifyBucket({ naturalSpan: monthSpan("2026-10-03"), span: monthSpan("2026-10-03") }, { ...context, today: "2026-12-01", coverageEnd: "2026-12-01" })).toBe("unknown");
    const future = classifyBucket({ naturalSpan: daySpan("2026-11-02"), span: daySpan("2026-11-02") }, { today: TODAY, coverageEnd: TODAY, unknownDates: new Set(["2026-11-02"]) });
    expect(future).toBe("future");
  });

  it("空集合与不传完全等价", () => {
    const base = { today: TODAY, coverageEnd: TODAY };
    for (const date of ["2026-10-01", "2026-10-27", "2026-11-01"]) {
      const bucket = { naturalSpan: daySpan(date), span: daySpan(date) };
      expect(classifyBucket(bucket, { ...base, unknownDates: new Set() })).toBe(classifyBucket(bucket, base));
    }
  });
});

describe("computeTimeSeries · unknownDates", () => {
  const options = { metric: "expense" as const, granularity: "day" as const, span: SPAN, today: TODAY, coverageEnd: TODAY };

  it("未知日金额与笔数为 null，其余日精确；合计为 null、完整为 false", () => {
    const result = computeTimeSeries(entries, { ...options, unknownDates: new Set(["2026-10-04"]) });
    expect(result.buckets.map((point) => point.amountMinor)).toEqual(["100", "200", "0", null, "0", "0", "700"]);
    expect(result.buckets.map((point) => point.transactionCount)).toEqual([1, 1, 0, null, 0, 0, 1]);
    expect(result.buckets[3]?.unknownReason).toBe("coverage-missing");
    expect(result.totalMinor).toBeNull();
    expect(result.unknownBucketCount).toBe(1);
    expect(result.complete).toBe(false);
  });

  it("没有未知日期时：合计为所有桶之和（手算 100+200+400+700 = 1400）", () => {
    const result = computeTimeSeries(entries, options);
    expect(result.totalMinor).toBe("1400");
    expect(result.unknownBucketCount).toBe(0);
    const empty = computeTimeSeries(entries, { ...options, unknownDates: new Set() });
    expect(empty).toEqual(result);
  });

  it("周 / 月粒度：含未知日期的整个桶未知，其余桶仍精确", () => {
    const weekly = computeTimeSeries(entries, { ...options, granularity: "week", span: { start: "2026-09-28", end: "2026-10-12" }, unknownDates: new Set(["2026-10-07"]) });
    expect(weekly.buckets.map((point) => point.amountMinor)).toEqual(["700", null]);
    expect(weekly.buckets[1]?.bucket.state).toBe("unknown");
    // 第一周（9-28~10-04）：100 + 200 + 400 = 700
    const monthly = computeTimeSeries(entries, { ...options, granularity: "month", span: { start: "2026-10-01", end: "2026-11-01" }, today: "2026-12-01", coverageEnd: "2026-12-01", unknownDates: new Set(["2026-10-04"]) });
    expect(monthly.buckets.map((point) => point.amountMinor)).toEqual([null]);
  });

  it("未知日期落在区间之外不影响结果", () => {
    const inside = computeTimeSeries(entries, options);
    const outside = computeTimeSeries(entries, { ...options, unknownDates: new Set(["2026-09-30", "2026-10-09"]) });
    expect(outside).toEqual(inside);
  });

  it("笔数口径的序列同样把未知桶标 null，不当作 0 笔", () => {
    const counted = computeTimeSeries(entries, { ...options, metric: "count", countKind: "all", unknownDates: new Set(["2026-10-02"]) });
    expect(counted.buckets[1]?.transactionCount).toBeNull();
    expect(counted.buckets[0]?.transactionCount).toBe(1);
    expect(counted.totalCount).toBeNull();
  });

  it("累计序列：未知之后全部不可确认（传播），之前的精确", () => {
    const cumulative = accumulateSeries(computeTimeSeries(entries, { ...options, unknownDates: new Set(["2026-10-04"]) }));
    expect(cumulative.points.map((point) => point.cumulativeMinor)).toEqual(["100", "300", "300", null, null, null, null]);
    expect(cumulative.firstUnknownKey).toBe("2026-10-04");
    expect(cumulative.totalMinor).toBeNull();
    expect(cumulative.complete).toBe(false);
  });
});

describe("computeFlowSeries · unknownDates", () => {
  it("收入与支出共用同一组未知日期；其余桶收入支出都精确", () => {
    const flow = computeFlowSeries(entries, { granularity: "day", span: SPAN, today: TODAY, coverageEnd: TODAY, unknownDates: new Set(["2026-10-02"]) });
    expect(flow.buckets[0]).toMatchObject({ expenseMinor: "100", incomeMinor: "0" });
    expect(flow.buckets[1]).toMatchObject({ expenseMinor: null, incomeMinor: null });
    expect(flow.buckets[3]).toMatchObject({ expenseMinor: "400" });
    expect(flow.complete).toBe(false);
    expect(flow.unknownBucketCount).toBe(1);
  });
});

describe("computeCategorySeries · unknownDates", () => {
  const categoryEntries = [
    { occurredLocalDate: "2026-10-01", kind: "expense" as const, amountMinor: 100, categoryId: "food" },
    { occurredLocalDate: "2026-10-02", kind: "expense" as const, amountMinor: 250, categoryId: "rent" },
    { occurredLocalDate: "2026-10-03", kind: "expense" as const, amountMinor: 50, categoryId: "food" },
  ];
  it("未知桶所有分类都是 null；其余桶分类金额精确；总额为 null", () => {
    const result = computeCategorySeries(categoryEntries, {
      kind: "expense",
      categoryIds: ["food", "rent"],
      granularity: "day",
      span: { start: "2026-10-01", end: "2026-10-04" },
      today: TODAY,
      coverageEnd: TODAY,
      unknownDates: new Set(["2026-10-02"]),
    });
    const second = result.buckets[1];
    expect(second?.points.every((point) => point.amountMinor === null)).toBe(true);
    expect(result.buckets[0]?.points.map((point) => point.amountMinor)).toEqual(["100", "0"]);
    expect(result.buckets[2]?.points.map((point) => point.amountMinor)).toEqual(["50", "0"]);
    expect(result.totalMinor).toBeNull();
    expect(result.complete).toBe(false);
  });
});

describe("computeCalendarHeatmap · unknownDates", () => {
  it("未知日 level / 金额为 null，不是 0；颜色分位只由已知日决定；缺失天数被计数", () => {
    const heatmap = computeCalendarHeatmap(entries, {
      metric: "expense",
      span: SPAN,
      today: TODAY,
      coverageEnd: TODAY,
      unknownDates: new Set(["2026-10-04"]),
    });
    const unknown = heatmap.cells.find((cell) => cell.date === "2026-10-04");
    expect(unknown).toMatchObject({ valueMinor: null, transactionCount: null, level: null, state: "unknown" });
    const zero = heatmap.cells.find((cell) => cell.date === "2026-10-03");
    expect(zero).toMatchObject({ valueMinor: "0", level: 0 });
    expect(heatmap.unknownDayCount).toBe(1);
    expect(heatmap.complete).toBe(false);
    // 已知日 100/200/0/0/0/700 → 最大值 700、最小值 0；未知的 400 不参与。
    expect(heatmap.intensity.maxMinor).toBe("700");
    expect(heatmap.intensity.minMinor).toBe("0");
  });

  it("没有未知日期时与不传结果相同", () => {
    const base = { metric: "expense" as const, span: SPAN, today: TODAY, coverageEnd: TODAY };
    expect(computeCalendarHeatmap(entries, { ...base, unknownDates: new Set() })).toEqual(computeCalendarHeatmap(entries, base));
  });
});
