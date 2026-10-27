import {
  computeMultiMonthComparison,
  computePeriodComparison,
  spanFromInclusiveDates,
  type ComparisonEntry,
  type MonthEntry,
} from "@libellum/shared";
import { describe, expect, it } from "vitest";

import {
  buildComparisonBarsModel,
  buildMonthComparisonModel,
  comparisonBarRect,
  monthBarRect,
  type ComparisonBox,
} from "./comparisonChart.js";

const BOX: ComparisonBox = {
  width: 320,
  height: 200,
  padding: { top: 12, right: 12, bottom: 24, left: 44 },
};

const TODAY = "2026-10-27";
/** Coverage through today: both observation windows are known. */
const COVERAGE = "2026-10-27";

function entry(
  occurredLocalDate: string,
  kind: "expense" | "income",
  amountMinor: number,
): ComparisonEntry {
  return { occurredLocalDate, kind, amountMinor };
}

function previousPeriodResult(
  entries: readonly ComparisonEntry[],
  coverageEnd: string | null = COVERAGE,
) {
  return computePeriodComparison(
    entries,
    {
      kind: "previous-period",
      current: spanFromInclusiveDates("2026-10-01", "2026-10-27"),
      today: TODAY,
    },
    { coverageEnd },
  );
}

describe("buildComparisonBarsModel (A01–A03/A05 grouped bars)", () => {
  it("maps authoritative amounts for both sides of both metric groups", () => {
    const result = previousPeriodResult([
      entry("2026-10-03", "expense", 5_000),
      entry("2026-10-05", "income", 20_000),
      entry("2026-09-10", "expense", 4_000),
      entry("2026-09-12", "income", 10_000),
    ]);

    const model = buildComparisonBarsModel(result, BOX);
    const expense = model.groups[0]!;
    const income = model.groups[1]!;

    expect(expense.currentValue).toBe(5_000);
    expect(expense.previousValue).toBe(4_000);
    expect(income.currentValue).toBe(20_000);
    expect(income.previousValue).toBe(10_000);
    expect(expense.currentMinor).toBe("5000");
    expect(model.empty).toBe(false);
    expect(model.hasNegative).toBe(false);
    // A shared y scale must include the largest value of either side.
    expect(model.yDomain[1]).toBeGreaterThanOrEqual(20_000);
    expect(model.yDomain[0]).toBeLessThanOrEqual(0);
  });

  it("draws an unknown side as no bar, never as a zero-height bar", () => {
    // Coverage stops before the current window: both windows are unknown.
    const result = previousPeriodResult([], "2026-09-10");
    const model = buildComparisonBarsModel(result, BOX);

    expect(model.groups[0]!.currentValue).toBeNull();
    expect(model.groups[0]!.previousValue).toBeNull();
    expect(model.empty).toBe(true);
    expect(comparisonBarRect(model, 0, "current")).toBeNull();
    expect(comparisonBarRect(model, 0, "previous")).toBeNull();
  });

  it("keeps a known zero as a zero-height rectangle", () => {
    const result = previousPeriodResult([
      entry("2026-10-03", "expense", 5_000),
      entry("2026-10-05", "income", 20_000),
    ]);
    const model = buildComparisonBarsModel(result, BOX);
    const previous = comparisonBarRect(model, 0, "previous");

    expect(model.groups[0]!.previousValue).toBe(0);
    expect(previous).not.toBeNull();
    expect(previous!.height).toBe(0);
  });

  it("anchors the current bar left of the comparison bar inside the plot", () => {
    const result = previousPeriodResult([
      entry("2026-10-03", "expense", 5_000),
      entry("2026-09-10", "expense", 4_000),
    ]);
    const model = buildComparisonBarsModel(result, BOX);
    const current = comparisonBarRect(model, 0, "current")!;
    const previous = comparisonBarRect(model, 0, "previous")!;

    expect(current.x).toBeLessThan(previous.x);
    expect(current.x).toBeGreaterThanOrEqual(BOX.padding.left);
    expect(previous.x + previous.width).toBeLessThanOrEqual(BOX.width - BOX.padding.right);
    expect(current.width).toBe(previous.width);
  });

  it("marks negative amounts so the chart can draw below the zero line", () => {
    const result = previousPeriodResult([
      entry("2026-10-03", "income", -500),
      entry("2026-10-04", "expense", 1_000),
    ]);
    const model = buildComparisonBarsModel(result, BOX);
    const rect = comparisonBarRect(model, 1, "current")!;

    expect(model.hasNegative).toBe(true);
    expect(model.groups[1]!.currentValue).toBe(-500);
    // A negative bar starts at the zero line and grows downward on screen.
    expect(rect.y).toBeCloseTo(model.zeroY, 6);
    expect(rect.y + rect.height).toBeGreaterThan(model.zeroY);
    expect(rect.height).toBeGreaterThan(0);
  });
});

function monthEntries(): MonthEntry[] {
  return [
    { occurredLocalDate: "2026-01-10", kind: "expense", amountMinor: 1_500 },
    { occurredLocalDate: "2026-03-20", kind: "expense", amountMinor: 2_500 },
  ];
}

function monthResult(coverageEnd: string | null = "2026-10-27") {
  return computeMultiMonthComparison(
    monthEntries(),
    { months: ["2026-01", "2026-03", "2026-11"], metric: "expense", today: TODAY },
    { coverageEnd },
  );
}

describe("buildMonthComparisonModel (A04 multi-month comparison)", () => {
  it("keeps every selected natural month as its own bar, in caller order", () => {
    const model = buildMonthComparisonModel(monthResult(), BOX);

    expect(model.bars.map((bar) => bar.monthKey)).toEqual(["2026-01", "2026-03", "2026-11"]);
    expect(model.bars[0]!.value).toBe(1_500);
    expect(model.bars[1]!.value).toBe(2_500);
    expect(model.empty).toBe(false);
    expect(model.slotWidth).toBeGreaterThan(0);
  });

  it("leaves a future month without a bar and without a value", () => {
    const model = buildMonthComparisonModel(monthResult(), BOX);

    expect(model.bars[2]!.value).toBeNull();
    expect(model.bars[2]!.state).toBe("future");
    expect(monthBarRect(model, 2)).toBeNull();
  });

  it("does not treat an unknown month as zero", () => {
    const model = buildMonthComparisonModel(monthResult("2026-01-10"), BOX);
    const january = model.bars[0]!;

    expect(january.value).toBeNull();
    expect(january.valueMinor).toBeNull();
    expect(january.state).toBe("unknown");
    expect(monthBarRect(model, 0)).toBeNull();
  });

  it("positions bars evenly inside the plot area", () => {
    const model = buildMonthComparisonModel(monthResult(), BOX);
    const first = monthBarRect(model, 0)!;
    const second = monthBarRect(model, 1)!;

    expect(second.x - first.x).toBeCloseTo(model.slotWidth, 6);
    expect(first.x).toBeGreaterThanOrEqual(BOX.padding.left);
  });
});
