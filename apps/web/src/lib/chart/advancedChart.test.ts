import { describe, expect, it } from "vitest";

import {
  computeDailyExpenseVariability,
  computeSeasonalComparison,
  computeTrailingMovingAverage,
  daySpan,
  detectDailyExpenseAnomalies,
  type SeasonalComparisonResult,
  type TimeBucket,
  type TimeSeriesBucketPoint,
} from "@libellum/shared";

import {
  buildAnomalyModel,
  buildMovingAverageModel,
  buildSeasonalModel,
  buildVolatilityModel,
  type AdvancedBox,
} from "./advancedChart.js";

/** 图表模型的最小盒子：宽 320、高 200，内边距与组件一致。 */
const BOX: AdvancedBox = {
  innerWidth: 320 - 42 - 12,
  innerHeight: 200 - 14 - 26,
  padding: { top: 14, right: 12, bottom: 26, left: 42 },
};

const BASE_Y = BOX.padding.top + BOX.innerHeight;
const TOP_Y = BOX.padding.top;

function dayBucket(date: string, state: TimeBucket["state"] = "complete"): TimeBucket {
  const span = daySpan(date);
  return {
    key: date,
    granularity: "day",
    span,
    naturalSpan: span,
    clippedStart: false,
    clippedEnd: false,
    state,
  };
}

function dayPoint(date: string, amountMinor: string | null, state: TimeBucket["state"] = "complete"): TimeSeriesBucketPoint {
  return {
    bucket: dayBucket(date, state),
    amountMinor,
    transactionCount: amountMinor === null ? 0 : 1,
    unknownReason: null,
  };
}

/** 2026-10-01 起连续 N 天，每天金额 100、200、…（固定偏移）。 */
function dailySeries(count: number, amountOf: (index: number) => string | null): TimeSeriesBucketPoint[] {
  const first = Date.UTC(2026, 9, 1);
  const points: TimeSeriesBucketPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(first + index * 86_400_000).toISOString().slice(0, 10);
    points.push(dayPoint(date, amountOf(index)));
  }
  return points;
}

function seasonalFixture(): SeasonalComparisonResult {
  const entries = [
    { occurredLocalDate: "2025-03-15", kind: "expense" as const, amountMinor: 1000n },
    { occurredLocalDate: "2025-04-10", kind: "expense" as const, amountMinor: 2000n },
    { occurredLocalDate: "2026-03-05", kind: "expense" as const, amountMinor: 1500n },
    { occurredLocalDate: "2026-04-01", kind: "expense" as const, amountMinor: 3000n },
  ];
  return computeSeasonalComparison(entries, {
    metric: "expense",
    span: { start: "2025-01-01", end: "2026-05-01" },
    today: "2026-05-01",
    coverageEnd: "2026-05-01",
  });
}

describe("buildMovingAverageModel", () => {
  it("exposes raw and average geometry on contiguous days", () => {
    const series = dailySeries(10, (index) => String((index + 1) * 100));
    const result = computeTrailingMovingAverage(series, { windowDays: 7 });
    const model = buildMovingAverageModel(result, BOX);

    expect(model.windowDays).toBe(7);
    expect(model.points).toHaveLength(10);
    // 前 6 天没有完整窗口；第 7 天起可计算（4 个点连成一段）。
    expect(model.averageSegments).toHaveLength(1);
    expect(model.averageSegments[0]).toHaveLength(4);
    expect(model.rawSegments).toHaveLength(1);
    expect(model.rawSegments[0]).toHaveLength(10);
    expect(model.empty).toBe(false);
    expect(model.allZero).toBe(false);
    expect(model.yDomain[0]).toBeLessThanOrEqual(0);
    for (const segment of model.averageSegments) {
      for (const point of segment) {
        expect(point.y).toBeGreaterThanOrEqual(TOP_Y);
        expect(point.y).toBeLessThanOrEqual(BASE_Y);
      }
    }
    expect(model.zeroY).toBeCloseTo(BASE_Y, 6);
  });

  it("breaks the average line where a window contains an unknown day", () => {
    const series = dailySeries(10, (index) => String((index + 1) * 100));
    series[8] = dayPoint("2026-10-09", null, "unknown");
    const result = computeTrailingMovingAverage(series, { windowDays: 7 });
    const model = buildMovingAverageModel(result, BOX);

    // 窗口 3–9 与 4–10 都含未知的第 9 天 → 后两个平均点不可算；前两个
    // 平均点（第 7、8 天）连成一段。
    expect(model.points[8]!.yAverage).toBeNull();
    expect(model.points[9]!.yAverage).toBeNull();
    const averagePointCount = model.averageSegments.reduce((total, segment) => total + segment.length, 0);
    expect(averagePointCount).toBe(2);
  });

  it("reports empty model when every day is unknown", () => {
    const series = dailySeries(5, () => null);
    const result = computeTrailingMovingAverage(series, { windowDays: 7 });
    const model = buildMovingAverageModel(result, BOX);
    expect(model.empty).toBe(true);
    expect(model.yDomain).toEqual([0, 1]);
  });

  it("flags all-zero series", () => {
    const series = dailySeries(8, () => "0");
    const result = computeTrailingMovingAverage(series, { windowDays: 7 });
    const model = buildMovingAverageModel(result, BOX);
    expect(model.allZero).toBe(true);
  });
});

describe("buildVolatilityModel", () => {
  it("bands the mean by one population standard deviation", () => {
    const series = dailySeries(10, (index) => String((index + 1) * 100));
    const variability = computeDailyExpenseVariability(series);
    const model = buildVolatilityModel(series, variability, BOX);

    expect(model.segments).toHaveLength(1);
    expect(model.segments[0]).toHaveLength(10);
    // y 轴向下，因此上界像素应小于均值像素。
    expect(model.bandTopY).toBeLessThan(model.meanY);
    expect(model.meanY).toBeLessThan(model.bandBottomY);
    expect(model.empty).toBe(false);
    expect(model.zeroY).toBeCloseTo(BASE_Y, 6);
  });

  it("breaks the line at unknown days", () => {
    const series = dailySeries(6, (index) => String((index + 1) * 100));
    series[2] = dayPoint("2026-10-03", null, "unknown");
    const variability = computeDailyExpenseVariability(series);
    const expected = computeDailyExpenseVariability(series.filter((point) => point.bucket.key !== "2026-10-03"));
    expect(variability.mean.denominatorCount).toBe(expected.mean.denominatorCount);
    const model = buildVolatilityModel(series, variability, BOX);
    expect(model.segments.map((segment) => segment.length)).toEqual([2, 3]);
  });
});

describe("buildSeasonalModel", () => {
  it("places twelve categories and only in-span months draw", () => {
    const result = seasonalFixture();
    const model = buildSeasonalModel(result, BOX);

    expect(model.monthCount).toBe(12);
    expect(model.years).toHaveLength(2);
    expect(model.years[0]!.year).toBe(2025);
    expect(model.years[0]!.colorIndex).toBe(0);
    expect(model.years[1]!.colorIndex).toBe(1);
    expect(model.slotWidth).toBeCloseTo(BOX.innerWidth / 12, 6);

    const march2025 = model.years[0]!.points[2]!;
    expect(march2025.y).not.toBeNull();
    expect(march2025.x).toBeCloseTo(BOX.padding.left + model.slotWidth * 2.5, 6);

    // 2026 年 5 月之后不在分析区间，不画。
    const december2026 = model.years[1]!.points[11]!;
    expect(december2026.y).toBeNull();
    expect(december2026.comparable).toBe(false);
  });

  it("marks in-progress months as not comparable", () => {
    const entries = [
      { occurredLocalDate: "2026-03-05", kind: "expense" as const, amountMinor: 1500n },
      { occurredLocalDate: "2026-04-01", kind: "expense" as const, amountMinor: 3000n },
    ];
    const result = computeSeasonalComparison(entries, {
      metric: "expense",
      span: { start: "2026-01-01", end: "2026-05-01" },
      today: "2026-04-15",
      coverageEnd: "2026-04-15",
    });
    const model = buildSeasonalModel(result, BOX);
    const april = model.years[0]!.points[3]!;
    expect(april.inProgress).toBe(true);
  });
});

describe("buildAnomalyModel", () => {
  it("maps anomaly marks onto their day slots", () => {
    // 30 天里一天异常：MAD = 0 时改用分位阈值（0.95 → 第 29 个值），
    // 单个极端日必须被标出（规格 §28）。
    const first = Date.UTC(2026, 8, 22);
    const series: TimeSeriesBucketPoint[] = [];
    for (let index = 0; index < 30; index += 1) {
      const date = new Date(first + index * 86_400_000).toISOString().slice(0, 10);
      series.push(dayPoint(date, index === 20 ? "5000" : "100"));
    }
    const anomaly = detectDailyExpenseAnomalies(series, { minimumSampleDays: 5 });
    expect(anomaly.marks.length).toBeGreaterThan(0);

    const model = buildAnomalyModel(series, anomaly, BOX);
    expect(model.marks).toHaveLength(anomaly.marks.length);
    const mark = model.marks[0]!;
    const point = model.points.find((candidate) => candidate.key === mark.date)!;
    expect(mark.x).toBeCloseTo(point.x, 6);
    expect(mark.y).toBeCloseTo(point.y!, 6);
    expect(mark.amountMinor).toBe(anomaly.marks[0]!.amountMinor);
    expect(model.segments).toHaveLength(1);
    expect(model.empty).toBe(false);
  });

  it("has no marks for a uniform series", () => {
    const series = dailySeries(10, () => "100");
    const anomaly = detectDailyExpenseAnomalies(series, { minimumSampleDays: 5 });
    const model = buildAnomalyModel(series, anomaly, BOX);
    expect(anomaly.marks).toHaveLength(0);
    expect(model.marks).toHaveLength(0);
  });
});
