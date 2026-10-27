import { describe, expect, it } from "vitest";
import { addDays } from "./stats.js";
import { accumulateSeries, computeTimeSeries, type TimeSeriesEntry } from "./timeSeries.js";
import { computeTrailingMovingAverage } from "./movingAverage.js";

/**
 * B-5 performance baseline (spec §36.12 / §44).
 *
 * Records measured numbers instead of inventing results. Assertions only set a
 * loose upper bound to avoid flakiness on slow machines; actual timings are
 * logged by the test run and recorded in
 * `docs/specs/design/S17-B-性能基线.md`.
 *
 * This file is intentionally ASCII-only so it can never be mangled by tools
 * that do not round-trip UTF-8.
 */

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Deterministic data: `count` entries spread over 2019-01-01 .. 2027-01-01. */
function buildEntries(count: number): TimeSeriesEntry[] {
  const random = makeRandom(20_261_027);
  const start = "2019-01-01";
  const totalDays = 2_922; // 2019-01-01 -> 2027-01-01
  const entries: TimeSeriesEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const dayOffset = Math.floor(random() * totalDays);
    entries.push({
      occurredLocalDate: addDays(start, dayOffset),
      kind: random() < 0.75 ? "expense" : "income",
      amountMinor: BigInt(Math.floor(random() * 1_000_000) + 1),
    });
  }
  return entries;
}

describe("performance baseline (spec 36.12)", () => {
  it("50k entries: daily series + cumulative + 7-day moving average stay within budget", () => {
    const entries = buildEntries(50_000);
    const started = performance.now();
    const day = computeTimeSeries(entries, {
      metric: "expense",
      granularity: "day",
      span: { start: "2019-01-01", end: "2027-01-01" },
      today: "2027-01-01",
      coverageEnd: "2026-12-31",
    });
    const cumulative = accumulateSeries(day);
    const average = computeTrailingMovingAverage(day.buckets, { windowDays: 7 });
    const elapsedMs = performance.now() - started;

    console.log(
      `[B-5 perf] 50k entries -> ${day.buckets.length} day buckets, ` +
        `${cumulative.points.length} cumulative points, ${average.points.length} moving-average points, ` +
        `${elapsedMs.toFixed(1)} ms`,
    );
    expect(day.buckets.length).toBe(2_922);
    expect(average.points.length).toBe(2_922);
    expect(day.complete).toBe(true);
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it("10k entries: daily series stays linear and within budget", () => {
    const entries = buildEntries(10_000);
    const started = performance.now();
    const day = computeTimeSeries(entries, {
      metric: "expense",
      granularity: "day",
      span: { start: "2019-01-01", end: "2027-01-01" },
      today: "2027-01-01",
      coverageEnd: "2026-12-31",
    });
    const elapsedMs = performance.now() - started;
    console.log(`[B-5 perf] 10k entries -> ${day.buckets.length} day buckets, ${elapsedMs.toFixed(1)} ms`);
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
