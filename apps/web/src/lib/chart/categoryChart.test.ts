import type {
  CategorySeriesOptions,
  FlowSeriesOptions,
  TimeSeriesEntry,
  WeekdayPatternOptions,
} from "@libellum/shared";
import {
  computeCalendarHeatmap,
  computeCategorySeries,
  computeCategoryShares,
  computeFlowSeries,
  computeWeekdayPattern,
  spanFromInclusiveDates,
} from "@libellum/shared";
import { describe, expect, it } from "vitest";

import {
  buildCalendarGridModel,
  buildFlowBarModel,
  buildShareStackModel,
  buildStackedBarModel,
  buildWeekdayModel,
} from "./categoryChart.js";
import type { ChartBox } from "./timeSeriesChart.js";

const BOX: ChartBox = {
  innerWidth: 280,
  innerHeight: 140,
  padding: { top: 10, right: 8, bottom: 24, left: 40 },
};

const OCTOBER = spanFromInclusiveDates("2026-10-01", "2026-10-31");

const FLOW_OPTIONS: FlowSeriesOptions = {
  granularity: "month",
  span: spanFromInclusiveDates("2026-07-01", "2026-10-31"),
  today: "2026-11-05",
  coverageEnd: "2026-10-31",
};

function entry(
  occurredLocalDate: string,
  kind: "expense" | "income",
  amountMinor: bigint | number,
): TimeSeriesEntry {
  return { occurredLocalDate, kind, amountMinor };
}

const CATEGORY_OPTIONS: CategorySeriesOptions = {
  kind: "expense",
  categoryIds: ["food", "rent"],
  granularity: "month",
  span: spanFromInclusiveDates("2026-08-01", "2026-10-31"),
  today: "2026-11-05",
  coverageEnd: "2026-10-31",
};

const WEEKDAY_OPTIONS: WeekdayPatternOptions = {
  kind: "expense",
  span: OCTOBER,
  today: "2026-11-05",
  coverageEnd: "2026-10-31",
};

describe("flow bars (CF-B04)", () => {
  it("draws one income/expense pair per bucket on a shared zero baseline", () => {
    const flow = computeFlowSeries(
      [entry("2026-07-10", "income", 500_000), entry("2026-07-10", "expense", 320_000)],
      FLOW_OPTIONS,
    );
    const model = buildFlowBarModel(flow.buckets, BOX);

    expect(model.bars).toHaveLength(8);
    expect(model.zeroY).toBe(model.scale(0));
    expect(model.bars[0]?.kind).toBe("income");
    expect(model.bars[1]?.kind).toBe("expense");
    // Both sides share the same baseline: bar bottoms meet the zero line.
    expect((model.bars[0]?.y ?? 0) + (model.bars[0]?.height ?? 0)).toBeCloseTo(model.zeroY, 0);
    expect(model.bars[0]?.amountMinor).toBe("500000");
    expect(model.unknownKeys).toEqual([]);
  });

  it("draws no bar for a side whose value is unknown", () => {
    const flow = computeFlowSeries([entry("2026-09-10", "income", 100_000)], {
      ...FLOW_OPTIONS,
      coverageEnd: "2026-08-31",
    });
    const model = buildFlowBarModel(flow.buckets, BOX);

    expect(model.unknownKeys.length).toBeGreaterThan(0);
    // Only the two covered buckets are drawn; unknown buckets contribute no bars.
    expect(model.bars).toHaveLength(4);
    expect(model.bars.every((bar) => bar.state !== "unknown")).toBe(true);
  });
});

describe("stacked category bars (CF-B05)", () => {
  it("stacks segments from the zero baseline without dropping the authoritative amount", () => {
    const series = computeCategorySeries(
      [
        { occurredLocalDate: "2026-08-03", categoryId: "food", kind: "expense", amountMinor: 3_000 },
        { occurredLocalDate: "2026-08-04", categoryId: "rent", kind: "expense", amountMinor: 7_000 },
      ],
      { ...CATEGORY_OPTIONS, span: spanFromInclusiveDates("2026-08-01", "2026-08-31") },
    );
    const model = buildStackedBarModel(series.buckets, BOX);

    expect(model.segments).toHaveLength(2);
    expect(model.segments.map((segment) => segment.amountMinor)).toEqual(["3000", "7000"]);
    const food = model.segments[0];
    const rent = model.segments[1];
    expect((food?.y ?? 0) + (food?.height ?? 0)).toBeCloseTo(model.zeroY, 0);
    expect((rent?.y ?? 0) + (rent?.height ?? 0)).toBeCloseTo(food?.y ?? 0, 0);
    expect(rent?.categoryId).toBe("rent");
  });

  it("keeps an unknown bucket empty instead of stacking zeros", () => {
    const series = computeCategorySeries([], {
      ...CATEGORY_OPTIONS,
      span: spanFromInclusiveDates("2026-10-01", "2026-10-31"),
      coverageEnd: "2026-09-30",
    });
    const model = buildStackedBarModel(series.buckets, BOX);

    expect(model.hasUnknown).toBe(true);
    expect(model.segments).toHaveLength(0);
  });
});

describe("100% share bands (CF-B06)", () => {
  it("accumulates exact shares upward from the plot bottom", () => {
    const series = computeCategorySeries(
      [
        { occurredLocalDate: "2026-08-03", categoryId: "food", kind: "expense", amountMinor: 1_500 },
        { occurredLocalDate: "2026-08-04", categoryId: "rent", kind: "expense", amountMinor: 3_500 },
      ],
      { ...CATEGORY_OPTIONS, span: spanFromInclusiveDates("2026-08-01", "2026-08-31") },
    );
    const shares = computeCategoryShares(series);
    const model = buildShareStackModel(shares, BOX);

    expect(model.bands).toHaveLength(2);
    const food = model.bands[0]?.segments[0]?.[0];
    const rent = model.bands[1]?.segments[0]?.[0];
    expect(food?.bottom).toBeCloseTo(model.plotBottom, 0);
    // Food is 30% of 5000: its band covers the bottom 30% of the plot.
    expect((food?.bottom ?? 0) - (food?.top ?? 0)).toBeCloseTo((model.plotBottom - model.plotTop) * 0.3, 0);
    expect((rent?.bottom ?? 0) - (rent?.top ?? 0)).toBeCloseTo((model.plotBottom - model.plotTop) * 0.7, 0);
    expect(model.partial).toBe(false);
  });

  it("breaks the band where the share is unknown or the total is zero", () => {
    const series = computeCategorySeries([], {
      ...CATEGORY_OPTIONS,
      span: spanFromInclusiveDates("2026-09-01", "2026-10-31"),
      coverageEnd: "2026-09-30",
    });
    const shares = computeCategoryShares(series);
    const model = buildShareStackModel(shares, BOX);

    expect(model.unknownKeys).toEqual(["2026-10"]);
    expect(model.bands.every((band) => band.segments.length === 0)).toBe(true);
  });
});

describe("weekday bars (CF-B09)", () => {
  it("renders total mode and marks insufficient samples", () => {
    const pattern = computeWeekdayPattern([entry("2026-10-05", "expense", 10_000)], {
      ...WEEKDAY_OPTIONS,
      span: spanFromInclusiveDates("2026-10-05", "2026-10-11"),
    });
    const model = buildWeekdayModel(pattern, { box: BOX, mode: "total" });

    expect(model.bars).toHaveLength(7);
    expect(model.bars[0]?.exactText).toBe("10000");
    expect(model.insufficientSample).toBe(true);
  });

  it("uses the per-weekday denominator in average mode", () => {
    const pattern = computeWeekdayPattern(
      [entry("2026-10-05", "expense", 1_000), entry("2026-10-12", "expense", 2_000)],
      WEEKDAY_OPTIONS,
    );
    const model = buildWeekdayModel(pattern, { box: BOX, mode: "average" });

    // Monday: 3000 over 4 observed Mondays → 750.00.
    expect(model.bars[0]?.exactText).toBe("750.00");
    expect(model.bars[0]?.observedDays).toBe(4);
    expect(model.bars[0]?.value).toBeCloseTo(750, 5);
  });

  it("has no bar for an unobserved weekday", () => {
    const pattern = computeWeekdayPattern([], {
      ...WEEKDAY_OPTIONS,
      span: spanFromInclusiveDates("2026-10-05", "2026-10-05"),
    });
    const model = buildWeekdayModel(pattern, { box: BOX, mode: "average" });

    expect(model.bars[0]?.value).toBe(0);
    expect(model.bars[1]?.value).toBeNull();
    expect(model.bars[1]?.height).toBe(0);
  });
});

describe("calendar grid (CF-B08)", () => {
  it("lays out a month on a Monday-first grid", () => {
    const heatmap = computeCalendarHeatmap([], {
      metric: "expense",
      span: OCTOBER,
      today: "2026-11-05",
      coverageEnd: "2026-10-31",
    });
    const model = buildCalendarGridModel(heatmap, { box: BOX });

    expect(model.months).toHaveLength(1);
    expect(model.months[0]?.cells).toHaveLength(31);
    const first = model.months[0]?.cells[0];
    // 2026-10-01 is Thursday → day index 3.
    expect(first?.x).toBeCloseTo(BOX.padding.left + 3 * (model.cellSize + model.gap), 1);
    expect(first?.date).toBe("2026-10-01");
    expect(model.months[0]?.height).toBeGreaterThan(0);
  });

  it("stacks consecutive months with a gap", () => {
    const heatmap = computeCalendarHeatmap([], {
      metric: "expense",
      span: spanFromInclusiveDates("2026-10-01", "2026-11-30"),
      today: "2026-12-05",
      coverageEnd: "2026-11-30",
    });
    const model = buildCalendarGridModel(heatmap, { box: BOX, monthGap: 16 });

    expect(model.months).toHaveLength(2);
    const [first, second] = model.months;
    expect((second?.y ?? 0) - ((first?.y ?? 0) + (first?.height ?? 0))).toBeCloseTo(16, 0);
  });

  it("keeps unknown cells uncoloured", () => {
    const heatmap = computeCalendarHeatmap([], {
      metric: "expense",
      span: OCTOBER,
      today: "2026-11-05",
      coverageEnd: "2026-10-15",
    });
    const model = buildCalendarGridModel(heatmap, { box: BOX });

    const cells = model.months[0]?.cells ?? [];
    expect(cells[14]?.level).not.toBeNull();
    expect(cells[15]?.level).toBeNull();
    expect(cells[15]?.valueMinor).toBeNull();
    expect(cells[15]?.state).toBe("unknown");
  });
});
