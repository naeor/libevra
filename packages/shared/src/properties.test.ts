import { describe, expect, it } from "vitest";
import { addDays } from "./stats.js";
import { enumerateBuckets, type TimeGranularity, type TimeSpan } from "./timeCalendar.js";
import { accumulateSeries, computeTimeSeries, type TimeSeriesEntry } from "./timeSeries.js";
import { computeTrailingMovingAverage } from "./movingAverage.js";
import { computeCategorySeries, type CategorySeriesEntry } from "./categorySeries.js";
import { computeCalendarHeatmap } from "./calendarHeatmap.js";
import { computePeriodComparison, type ComparisonEntry } from "./periodComparison.js";

/**
 * B-5 性质测试（规格 §37）：
 *
 *  - 分组守恒：完整且互斥的每日桶金额之和 = 同范围总支出；
 *  - 聚合一致：日→周/月聚合总额 = 直接按同条件统计的权威总额；
 *  - 累计一致：最后一个完整累计值 = 对应区间权威总额；
 *  - 来源一致：某个时间点的来源明细按同口径复现该点金额；
 *  - 比较一致：当前值 − 历史值 = 绝对差额；
 *  - 移动平均一致：完整七日窗口的移动平均 = 七日精确金额之和 / 7；
 *  - 确定性：同一输入、同一日期合同、同一参数 → 相同结果。
 *
 * 使用固定种子的 LCG 产生随机样本（无新依赖、跨机器可复现）；
 * 每个性质跑若干轮随机输入，失败时可凭 seed 复现。
 */

const TODAY = "2026-01-31";

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomEntries(
  random: () => number,
  from: string,
  days: number,
): { entries: TimeSeriesEntry[]; expenseMinor: bigint } {
  const entries: TimeSeriesEntry[] = [];
  let expenseMinor = 0n;
  for (let day = 0; day < days; day += 1) {
    const count = Math.floor(random() * 3);
    for (let index = 0; index < count; index += 1) {
      const kind = random() < 0.7 ? "expense" : "income";
      const amountMinor = BigInt(Math.floor(random() * 500_000) + 1);
      entries.push({ occurredLocalDate: addDays(from, day), kind, amountMinor });
      if (kind === "expense") expenseMinor += amountMinor;
    }
  }
  return { entries, expenseMinor };
}

function sumComplete(amounts: readonly (string | null)[]): bigint {
  return amounts.reduce<bigint>((total, amount) => total + (amount === null ? 0n : BigInt(amount)), 0n);
}

describe("property: 分组守恒与聚合一致 (spec §37)", () => {
  it("每日桶合计 = 相同范围的总支出，且日→周/月聚合总额一致", () => {
    for (let run = 0; run < 20; run += 1) {
      const random = makeRandom(1_000 + run);
      const from = "2025-01-01";
      const days = 60;
      const span: TimeSpan = { start: from, end: addDays(from, days) };
      const { entries, expenseMinor } = randomEntries(random, from, days);
      const base = { metric: "expense" as const, span, today: TODAY, coverageEnd: addDays(from, days - 1) };

      const day = computeTimeSeries(entries, { ...base, granularity: "day" });
      const week = computeTimeSeries(entries, { ...base, granularity: "week" });
      const month = computeTimeSeries(entries, { ...base, granularity: "month" });

      expect(day.complete).toBe(true);
      expect(week.complete).toBe(true);
      expect(month.complete).toBe(true);
      expect(sumComplete(day.buckets.map((point) => point.amountMinor))).toBe(expenseMinor);
      expect(day.totalMinor).toBe(expenseMinor.toString());
      expect(week.totalMinor).toBe(day.totalMinor);
      expect(month.totalMinor).toBe(day.totalMinor);
    }
  });

  it("来源一致：按某一天筛选的流水复现该日桶金额", () => {
    for (let run = 0; run < 20; run += 1) {
      const random = makeRandom(2_000 + run);
      const from = "2025-03-01";
      const days = 30;
      const span: TimeSpan = { start: from, end: addDays(from, days) };
      const { entries } = randomEntries(random, from, days);
      const day = computeTimeSeries(entries, {
        metric: "expense",
        granularity: "day",
        span,
        today: TODAY,
        coverageEnd: addDays(from, days - 1),
      });
      for (const point of day.buckets) {
        const expected = entries
          .filter((entry) => entry.kind === "expense" && entry.occurredLocalDate === point.bucket.span.start)
          .reduce((total, entry) => total + BigInt(entry.amountMinor), 0n);
        expect(point.amountMinor).toBe(expected.toString());
      }
    }
  });
});

describe("property: 累计一致 (spec §37)", () => {
  it("最后一个完整累计值 = 对应区间权威总额", () => {
    for (let run = 0; run < 20; run += 1) {
      const random = makeRandom(3_000 + run);
      const from = "2025-05-01";
      const days = 40;
      const span: TimeSpan = { start: from, end: addDays(from, days) };
      const { entries } = randomEntries(random, from, days);
      const day = computeTimeSeries(entries, {
        metric: "expense",
        granularity: "day",
        span,
        today: TODAY,
        coverageEnd: addDays(from, days - 1),
      });
      const cumulative = accumulateSeries(day);
      expect(cumulative.complete).toBe(true);
      expect(cumulative.totalMinor).toBe(day.totalMinor);
      const last = cumulative.points[cumulative.points.length - 1]!;
      expect(last.cumulativeMinor).toBe(day.totalMinor);
      expect(cumulative.points.reduce((total, point) => total + BigInt(point.deltaMinor ?? 0), 0n)).toBe(
        BigInt(day.totalMinor ?? 0),
      );
    }
  });
});

describe("property: 比较一致 (spec §37)", () => {
  it("当前值 − 历史值 = 绝对差额（收入与支出都成立）", () => {
    for (let run = 0; run < 10; run += 1) {
      const random = makeRandom(4_000 + run);
      const entries: ComparisonEntry[] = [];
      for (let index = 0; index < 120; index += 1) {
        const kind = random() < 0.6 ? "expense" : "income";
        entries.push({
          occurredLocalDate: addDays("2026-09-01", index),
          kind,
          amountMinor: BigInt(Math.floor(random() * 100_000) + 1),
        });
      }
      const result = computePeriodComparison(
        entries,
        { kind: "previous-period", current: { start: "2026-10-01", end: "2026-11-01" }, today: "2026-12-31" },
        { coverageEnd: "2026-12-31" },
      );
      for (const side of [result.income, result.expense]) {
        expect(side.currentMinor === null || side.previousMinor === null).toBe(false);
        const expected = BigInt(side.currentMinor ?? "0") - BigInt(side.previousMinor ?? "0");
        expect(side.differenceMinor).toBe(expected.toString());
      }
    }
  });
});

describe("property: 移动平均一致 (spec §37)", () => {
  it("完整七日窗口的移动平均 = 窗口精确金额之和 / 7", () => {
    for (let run = 0; run < 20; run += 1) {
      const random = makeRandom(5_000 + run);
      const from = "2025-06-01";
      const days = 21;
      const span: TimeSpan = { start: from, end: addDays(from, days) };
      const { entries } = randomEntries(random, from, days);
      const day = computeTimeSeries(entries, {
        metric: "expense",
        granularity: "day",
        span,
        today: TODAY,
        coverageEnd: addDays(from, days - 1),
      });
      const average = computeTrailingMovingAverage(day.buckets, { windowDays: 7 });
      expect(average.points).toHaveLength(days);
      for (let index = 0; index < days; index += 1) {
        const point = average.points[index]!;
        if (index < 6) {
          expect(point.average).toBeNull();
          expect(point.gapReason).toBe("insufficient-history");
          continue;
        }
        expect(point.average).not.toBeNull();
        const windowMinor = day.buckets
          .slice(index - 6, index + 1)
          .reduce((total, bucket) => total + BigInt(bucket.amountMinor ?? "0"), 0n);
        expect(point.average?.numeratorMinor).toBe(windowMinor.toString());
        expect(point.average?.denominatorDays).toBe(7);
        expect(BigInt(point.average?.numeratorMinor ?? "0")).toBe(windowMinor);
      }
    }
  });
});

describe("property: 桶分区与确定性 (spec §37)", () => {
  it("时间桶互斥、按序且完整覆盖请求区间", () => {
    const spans: { span: TimeSpan; granularity: TimeGranularity }[] = [
      { span: { start: "2026-10-14", end: "2026-12-03" }, granularity: "week" },
      { span: { start: "2026-01-17", end: "2026-04-09" }, granularity: "month" },
      { span: { start: "2026-02-26", end: "2026-03-03" }, granularity: "day" },
    ];
    for (const { span, granularity } of spans) {
      const buckets = enumerateBuckets(granularity, span, { today: TODAY, coverageEnd: TODAY });
      expect(buckets.length).toBeGreaterThan(0);
      expect(buckets[0]!.span.start).toBe(span.start);
      expect(buckets[buckets.length - 1]!.span.end).toBe(span.end);
      const keys = new Set(buckets.map((bucket) => bucket.key));
      expect(keys.size).toBe(buckets.length);
      for (let index = 1; index < buckets.length; index += 1) {
        expect(buckets[index]!.span.start).toBe(buckets[index - 1]!.span.end);
        expect(buckets[index]!.naturalSpan.start).toBe(buckets[index - 1]!.naturalSpan.end);
      }
    }
  });

  it("同一输入与日期合同重复计算结果完全一致", () => {
    const random = makeRandom(6_000);
    const from = "2025-08-01";
    const days = 45;
    const span: TimeSpan = { start: from, end: addDays(from, days) };
    const { entries } = randomEntries(random, from, days);
    const options = { metric: "expense" as const, granularity: "day" as const, span, today: TODAY, coverageEnd: addDays(from, days - 1) };
    expect(computeTimeSeries(entries, options)).toEqual(computeTimeSeries(entries, options));

    const categoryEntries: CategorySeriesEntry[] = entries.map((entry, index) => ({
      occurredLocalDate: entry.occurredLocalDate,
      kind: "expense",
      amountMinor: entry.amountMinor,
      categoryId: index % 3 === 0 ? "c1" : index % 3 === 1 ? "c2" : "c3",
    }));
    const categoryOptions = {
      kind: "expense" as const,
      categoryIds: ["c1", "c2"],
      granularity: "month" as const,
      span,
      today: TODAY,
      coverageEnd: addDays(from, days - 1),
      includeOther: true,
    };
    expect(computeCategorySeries(categoryEntries, categoryOptions)).toEqual(
      computeCategorySeries(categoryEntries, categoryOptions),
    );

    const heatmapOptions = { metric: "expense" as const, span, today: TODAY, coverageEnd: addDays(from, days - 1) };
    expect(computeCalendarHeatmap(entries, heatmapOptions)).toEqual(computeCalendarHeatmap(entries, heatmapOptions));
  });
});

describe("property: 构成守恒 (spec §37)", () => {
  it("每个完整桶的分类金额之和 = 该桶总额；分类合计 = 结果总额", () => {
    const random = makeRandom(7_000);
    const from = "2025-02-01";
    const days = 62;
    const span: TimeSpan = { start: from, end: addDays(from, days) };
    const categoryEntries: CategorySeriesEntry[] = [];
    for (let day = 0; day < days; day += 1) {
      const count = Math.floor(random() * 3);
      for (let index = 0; index < count; index += 1) {
        categoryEntries.push({
          occurredLocalDate: addDays(from, day),
          kind: "expense",
          amountMinor: BigInt(Math.floor(random() * 80_000) + 1),
          categoryId: ["c1", "c2", "c3"][Math.floor(random() * 3)] ?? "c1",
        });
      }
    }
    const result = computeCategorySeries(categoryEntries, {
      kind: "expense",
      categoryIds: ["c1", "c2"],
      granularity: "month",
      span,
      today: TODAY,
      coverageEnd: addDays(from, days - 1),
      includeOther: true,
    });
    expect(result.complete).toBe(true);
    let classifiedTotal = 0n;
    for (const bucket of result.buckets) {
      expect(bucket.totalMinor).not.toBeNull();
      const partSum = sumComplete(bucket.points.map((point) => point.amountMinor));
      expect(partSum).toBe(BigInt(bucket.totalMinor ?? "0"));
      classifiedTotal += partSum;
    }
    expect(result.totalMinor).not.toBeNull();
    expect(classifiedTotal).toBe(BigInt(result.totalMinor ?? "0"));
    const totalsSum = Object.values(result.totals).reduce<bigint>(
      (total, amount) => total + (amount === null ? 0n : BigInt(amount)),
      0n,
    );
    expect(totalsSum).toBe(BigInt(result.totalMinor ?? "0"));
  });
});
