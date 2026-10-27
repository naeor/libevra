import { accumulateSeries, computeTimeSeries, spanFromInclusiveDates } from "@libellum/shared";
import { describe, expect, it } from "vitest";

import { areaOf, buildCumulativeModel, buildTimeSeriesModel } from "./timeSeriesChart.js";
import type { ChartBox } from "./timeSeriesChart.js";

const BOX: ChartBox = {
  innerWidth: 350,
  innerHeight: 160,
  padding: { top: 10, right: 10, bottom: 30, left: 40 },
};

function october(overrides: Partial<Parameters<typeof computeTimeSeries>[1]> = {}) {
  return computeTimeSeries(
    [
      { occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 1_000n },
      { occurredLocalDate: "2026-10-03", kind: "expense", amountMinor: 2_500n },
    ],
    {
      metric: "expense",
      granularity: "day",
      span: spanFromInclusiveDates("2026-10-01", "2026-10-07"),
      today: "2026-10-31",
      coverageEnd: "2026-10-07",
      ...overrides,
    },
  );
}

describe("buildTimeSeriesModel", () => {
  it("places one equal slot per bucket", () => {
    const model = buildTimeSeriesModel(october().buckets, {
      box: BOX,
      chartKind: "line",
      metric: "expense",
    });

    expect(model.slotWidth).toBe(50);
    expect(model.points.map((point) => point.x)).toEqual([65, 115, 165, 215, 265, 315, 365]);
  });

  it("maps amounts onto the padded box and always keeps zero in domain", () => {
    const model = buildTimeSeriesModel(october().buckets, {
      box: BOX,
      chartKind: "line",
      metric: "expense",
    });

    const [first, , third] = model.points;

    expect(model.yDomain[0]).toBeLessThanOrEqual(0);
    expect(model.yDomain[1]).toBeGreaterThanOrEqual(2_500);
    expect(model.zeroY).toBe(BOX.padding.top + BOX.innerHeight);
    expect(third!.y!).toBeLessThan(first!.y!);
    expect(first!.y!).toBeLessThan(model.zeroY);
  });

  it("breaks the line at unknown buckets instead of plotting zero", () => {
    const series = october({ coverageEnd: "2026-10-02" });
    const model = buildTimeSeriesModel(series.buckets, {
      box: BOX,
      chartKind: "line",
      metric: "expense",
    });

    // 10-01、10-02 known; 10-03.. are unknown, so two segments of lengths 2 then 0.
    expect(model.segments).toHaveLength(1);
    expect(model.segments[0]).toHaveLength(2);
    expect(model.points[2]!.y).toBeNull();
    expect(model.knownCount).toBe(2);
  });

  it("draws a bar per known bucket only", () => {
    const series = october({ coverageEnd: "2026-10-02" });
    const model = buildTimeSeriesModel(series.buckets, {
      box: BOX,
      chartKind: "bar",
      metric: "expense",
    });

    expect(model.bars).toHaveLength(2);
    expect(model.bars[0]!.width).toBe(30);
    expect(model.bars[0]!.x).toBe(50); // 65 - 30/2
    // Bar grows up from the zero baseline.
    expect(model.bars[0]!.y).toBeLessThan(model.zeroY);
    expect(model.bars[0]!.height).toBeGreaterThan(0);
  });

  it("allows negative amounts and grows the bar downwards", () => {
    const series = computeTimeSeries(
      [
        { occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 1_000n },
        { occurredLocalDate: "2026-10-02", kind: "expense", amountMinor: -400n },
      ],
      {
        metric: "expense",
        granularity: "day",
        span: spanFromInclusiveDates("2026-10-01", "2026-10-03"),
        today: "2026-10-31",
        coverageEnd: "2026-10-03",
      },
    );

    const model = buildTimeSeriesModel(series.buckets, {
      box: BOX,
      chartKind: "bar",
      metric: "expense",
    });

    expect(model.hasNegative).toBe(true);
    const refund = model.bars[1]!;
    expect(refund.y).toBeGreaterThanOrEqual(model.zeroY);
    expect(refund.y + refund.height).toBeGreaterThan(model.zeroY);
  });

  it("uses transaction counts for a count series instead of amounts", () => {
    const series = computeTimeSeries(
      [
        { occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 5_000n },
        { occurredLocalDate: "2026-10-01", kind: "income", amountMinor: 900n },
      ],
      {
        metric: "count",
        granularity: "day",
        span: spanFromInclusiveDates("2026-10-01", "2026-10-03"),
        today: "2026-10-31",
        coverageEnd: "2026-10-03",
      },
    );

    const model = buildTimeSeriesModel(series.buckets, {
      box: BOX,
      chartKind: "bar",
      metric: "count",
    });

    expect(model.points[0]!.count).toBe(2);
    expect(model.yDomain[1]).toBeGreaterThanOrEqual(2);
  });

  it("reports an all-zero series and an empty series", () => {
    const zero = computeTimeSeries([], {
      metric: "expense",
      granularity: "day",
      span: spanFromInclusiveDates("2026-10-01", "2026-10-03"),
      today: "2026-10-31",
      coverageEnd: "2026-10-03",
    });

    expect(buildTimeSeriesModel(zero.buckets, { box: BOX, chartKind: "line", metric: "expense" }).allZero).toBe(
      true,
    );

    const future = computeTimeSeries([], {
      metric: "expense",
      granularity: "day",
      span: spanFromInclusiveDates("2026-11-01", "2026-11-03"),
      today: "2026-10-31",
      coverageEnd: "2026-10-31",
    });

    const empty = buildTimeSeriesModel(future.buckets, { box: BOX, chartKind: "line", metric: "expense" });
    expect(empty.empty).toBe(true);
    expect(empty.segments).toEqual([]);
    expect(empty.yDomain).toEqual([0, 1]);
  });

  it("never produces NaN coordinates", () => {
    const model = buildTimeSeriesModel(october().buckets, {
      box: BOX,
      chartKind: "area",
      metric: "expense",
    });

    for (const point of model.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      if (point.y !== null) expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe("buildCumulativeModel", () => {
  it("keeps the plateau of zero-change days in the cumulative line", () => {
    const cumulative = accumulateSeries(october());
    const model = buildCumulativeModel(cumulative.points, BOX);

    expect(model.points[0]!.y).not.toBeNull();
    // 10-01 1000, 10-02 0 change → same cumulative y.
    expect(model.points[1]!.y).toBe(model.points[0]!.y);
    expect(model.points[2]!.y).not.toBeNull();
    expect(model.firstUnknownKey).toBeNull();
  });

  it("does not connect across an unknown bucket", () => {
    const cumulative = accumulateSeries(october({ coverageEnd: "2026-10-02" }));
    const model = buildCumulativeModel(cumulative.points, BOX);

    expect(model.firstUnknownKey).toBe("2026-10-03");
    expect(model.segments).toHaveLength(1);
    expect(model.segments[0]).toHaveLength(2);
    expect(model.points[2]!.y).toBeNull();
  });

  it("returns a valid empty model when nothing is known", () => {
    const cumulative = accumulateSeries(
      computeTimeSeries([], {
        metric: "expense",
        granularity: "day",
        span: spanFromInclusiveDates("2026-11-01", "2026-11-03"),
        today: "2026-10-31",
        coverageEnd: "2026-10-31",
      }),
    );

    const model = buildCumulativeModel(cumulative.points, BOX);
    expect(model.empty).toBe(true);
    expect(model.firstUnknownKey).toBeNull();
    expect(model.yDomain).toEqual([0, 1]);
  });
});

describe("areaOf", () => {
  it("needs two points to enclose an area", () => {
    expect(areaOf([{ x: 1, y: 2 }], 10)).toBeNull();
    expect(areaOf([{ x: 1, y: 2 }, { x: 3, y: 2 }], 10)).not.toBeNull();
  });
});
