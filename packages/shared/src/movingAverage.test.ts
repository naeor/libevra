import { describe, expect, it } from "vitest";
import { addDays } from "./stats.js";
import { computeTimeSeries, type TimeSeriesEntry } from "./timeSeries.js";
import {
  MOVING_AVERAGE_VERSION,
  computeTrailingMovingAverage,
  movingAverageSeries,
} from "./movingAverage.js";

const TODAY = "2026-01-31";

function entriesFor(
  from: string,
  amounts: readonly (number | null)[],
): TimeSeriesEntry[] {
  return amounts.flatMap((amount, index): TimeSeriesEntry[] =>
    amount === null
      ? []
      : [{ occurredLocalDate: addDays(from, index), kind: "expense", amountMinor: BigInt(amount) }],
  );
}

function dailySeries(
  from: string,
  amounts: readonly (number | null)[],
  coverageEnd: string | null = null,
) {
  const span = { start: from, end: addDays(from, amounts.length) };
  return computeTimeSeries(entriesFor(from, amounts), {
    metric: "expense",
    granularity: "day",
    span,
    today: TODAY,
    coverageEnd: coverageEnd ?? addDays(span.end, -1),
  }).buckets;
}

describe("computeTrailingMovingAverage", () => {
  it("days before a full window are insufficient-history, not zero", () => {
    const daily = dailySeries("2026-01-01", [100, 100, 100, 100, 100, 100, 100]);
    const result = computeTrailingMovingAverage(daily, { windowDays: 7 });
    expect(result.version).toBe(MOVING_AVERAGE_VERSION);
    expect(result.points).toHaveLength(7);
    expect(result.points.slice(0, 6).every((point) => point.gapReason === "insufficient-history")).toBe(true);
    expect(result.points[6]!.average).toEqual({ numeratorMinor: "700", denominatorDays: 7 });
    expect(result.points[6]!.averageScaledMinor).toBe("1000000");
    expect(result.missingHistoryPoints).toBe(6);
    expect(result.complete).toBe(false);
  });

  it("keeps the mean as an exact fraction and renders a floored scaled value", () => {
    const daily = dailySeries("2026-01-01", [1, 2, 3, 4, 5, 6, 7]);
    const result = computeTrailingMovingAverage(daily, { windowDays: 7, scale: 2 });
    expect(result.points[6]!.average).toEqual({ numeratorMinor: "28", denominatorDays: 7 });
    expect(result.points[6]!.averageScaledMinor).toBe("400");
  });

  it("marks a window containing an uncovered day as incomplete instead of treating it as zero", () => {
    const daily = dailySeries("2026-01-01", [100, 100, null, null, null, null, null], "2026-01-02");
    const result = computeTrailingMovingAverage(daily, { windowDays: 3 });
    expect(result.points[2]!.gapReason).toBe("window-incomplete");
    expect(result.points[2]!.average).toBeNull();
    expect(result.unknownWindowPoints).toBe(5);
  });

  it("does not average across future days", () => {
    const span = { start: "2026-02-01", end: "2026-02-05" };
    const daily = computeTimeSeries(entriesFor("2026-02-01", [10, 10]), {
      metric: "expense",
      granularity: "day",
      span,
      today: "2026-02-02",
      coverageEnd: "2026-02-02",
    }).buckets;
    const result = computeTrailingMovingAverage(daily, { windowDays: 2 });
    expect(result.points[0]!.gapReason).toBe("insufficient-history");
    expect(result.points[1]!.average).toEqual({ numeratorMinor: "20", denominatorDays: 2 });
    expect(result.points[2]!.gapReason).toBe("window-incomplete");
  });

  it("rejects a non-contiguous series", () => {
    const daily = dailySeries("2026-01-01", [10, 10, 10, 10]);
    const gapped = [daily[0]!, daily[2]!, daily[3]!];
    expect(() => computeTrailingMovingAverage(gapped, { windowDays: 2 })).toThrow(/contiguous/);
  });

  it("rejects an invalid window and scale", () => {
    const daily = dailySeries("2026-01-01", [10]);
    expect(() => computeTrailingMovingAverage(daily, { windowDays: 0 })).toThrow(/windowDays/);
    expect(() => computeTrailingMovingAverage(daily, { windowDays: 7, scale: 9 })).toThrow(/scale/);
  });

  it("exposes both series for charting without recomputing buckets", () => {
    const daily = dailySeries("2026-01-01", [10, 20, 30, 40]);
    const result = computeTrailingMovingAverage(daily, { windowDays: 2 });
    const series = movingAverageSeries(result);
    expect(series.raw).toEqual(["10", "20", "30", "40"]);
    expect(series.averageScaled).toHaveLength(4);
    expect(series.averageScaled[0]).toBeNull();
    expect(series.averageScaled[1]).toBe("150000");
  });

  it("is complete when every day has a full window", () => {
    const daily = dailySeries("2026-01-01", [10, 20, 30, 40, 50, 60, 70, 80]);
    const result = computeTrailingMovingAverage(daily, { windowDays: 3 });
    expect(result.observedDays).toBe(8);
    expect(result.computablePoints).toBe(6);
    expect(result.complete).toBe(false);
    expect(result.unknownWindowPoints).toBe(0);
  });
});
