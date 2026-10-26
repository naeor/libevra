import { describe, expect, it } from "vitest";

import { spanFromInclusiveDates } from "./timeCalendar.js";
import {
  CALENDAR_HEAT_LEVELS,
  CALENDAR_HEATMAP_VERSION,
  computeCalendarHeatmap,
  type CalendarHeatmapOptions,
} from "./calendarHeatmap.js";

const OCTOBER: CalendarHeatmapOptions = {
  metric: "expense",
  span: spanFromInclusiveDates("2026-10-01", "2026-10-31"),
  today: "2026-11-05",
  coverageEnd: "2026-10-31",
};

function spend(date: string, amountMinor: bigint | number, kind: "expense" | "income" = "expense") {
  return { occurredLocalDate: date, kind, amountMinor };
}

describe("calendar heatmap (I12)", () => {
  it("lays out one month on a Monday-first 7-column grid", () => {
    const result = computeCalendarHeatmap([], OCTOBER);

    expect(result.version).toBe(CALENDAR_HEATMAP_VERSION);
    expect(result.cells).toHaveLength(31);
    expect(result.months).toHaveLength(1);

    const month = result.months[0];
    expect(month?.monthKey).toBe("2026-10");
    expect(month?.weeks).toHaveLength(5);
    // 2026-10-01 is a Thursday: index 0 is Monday, so three leading blanks.
    expect(month?.weeks[0]?.days[0]).toBeNull();
    expect(month?.weeks[0]?.days[1]).toBeNull();
    expect(month?.weeks[0]?.days[2]).toBeNull();
    expect(month?.weeks[0]?.days[3]?.date).toBe("2026-10-01");
    expect(month?.weeks[0]?.days[6]?.date).toBe("2026-10-04");
  });

  it("turns every day of a covered month into a confirmed value, zero included", () => {
    const result = computeCalendarHeatmap(
      [spend("2026-10-01", 1_000), spend("2026-10-03", 2_000)],
      OCTOBER,
    );

    expect(result.cells[0]).toMatchObject({
      date: "2026-10-01",
      valueMinor: "1000",
      transactionCount: 1,
      state: "complete",
      level: expect.any(Number),
    });
    // A covered day without entries is a real 0, not "unknown".
    expect(result.cells[1]).toMatchObject({
      date: "2026-10-02",
      valueMinor: "0",
      transactionCount: 0,
      state: "complete",
      level: 0,
    });
    expect(result.complete).toBe(true);
    expect(result.unknownDayCount).toBe(0);
  });

  it("keeps unknown days uncoloured and never renders them as zero", () => {
    const result = computeCalendarHeatmap([spend("2026-10-01", 1_000)], {
      ...OCTOBER,
      coverageEnd: "2026-10-15",
    });

    expect(result.cells[14]?.state).toBe("complete");
    expect(result.cells[15]?.state).toBe("unknown");
    expect(result.cells[15]?.valueMinor).toBeNull();
    expect(result.cells[15]?.level).toBeNull();
    expect(result.unknownDayCount).toBe(16);
    expect(result.complete).toBe(false);
  });

  it("treats today as in progress and later days as future without pretending they happened", () => {
    const result = computeCalendarHeatmap([spend("2026-10-01", 1_000)], {
      ...OCTOBER,
      today: "2026-10-20",
    });

    expect(result.cells[19]?.state).toBe("in-progress");
    expect(result.cells[20]?.state).toBe("future");
    expect(result.cells[20]?.valueMinor).toBeNull();
    expect(result.cells[30]?.state).toBe("future");
    expect(result.futureDayCount).toBe(11);
    expect(result.inProgressDayCount).toBe(1);
    expect(result.complete).toBe(false);
  });

  it("derives colour levels from quantiles over the whole range", () => {
    const result = computeCalendarHeatmap(
      [
        spend("2026-10-01", 100),
        spend("2026-10-02", 200),
        spend("2026-10-03", 300),
        spend("2026-10-04", 400),
      ],
      { ...OCTOBER, span: spanFromInclusiveDates("2026-10-01", "2026-10-04") },
    );

    expect(result.intensity.kind).toBe("quantile");
    expect(result.intensity.levels).toBe(CALENDAR_HEAT_LEVELS);
    expect(result.intensity.thresholdsMinor).toHaveLength(CALENDAR_HEAT_LEVELS - 1);
    expect(result.intensity.minMinor).toBe("100");
    expect(result.intensity.maxMinor).toBe("400");
    expect(result.cells[0]?.level).toBe(1);
    expect(result.cells[3]?.level).toBe(4);
  });

  it("supports the count metric and counts both kinds", () => {
    const result = computeCalendarHeatmap(
      [
        spend("2026-10-01", 1_000, "expense"),
        spend("2026-10-01", 9_000, "income"),
        spend("2026-10-02", 500, "expense"),
      ],
      { ...OCTOBER, metric: "count" },
    );

    expect(result.cells[0]?.valueMinor).toBe("2");
    expect(result.cells[0]?.transactionCount).toBe(2);
    expect(result.cells[1]?.valueMinor).toBe("1");
    expect(result.metric).toBe("count");
  });

  it("excludes the other kind for income/expense metrics", () => {
    const result = computeCalendarHeatmap(
      [spend("2026-10-01", 1_000, "expense"), spend("2026-10-01", 9_000, "income")],
      OCTOBER,
    );

    expect(result.cells[0]?.valueMinor).toBe("1000");
  });

  it("lays out consecutive months with independent grids", () => {
    const result = computeCalendarHeatmap([], {
      ...OCTOBER,
      span: spanFromInclusiveDates("2026-10-01", "2026-11-30"),
    });

    expect(result.months.map((month) => month.monthKey)).toEqual(["2026-10", "2026-11"]);
    // 2026-11-01 is a Sunday: six leading blanks before it.
    expect(result.months[1]?.weeks[0]?.days[6]?.date).toBe("2026-11-01");
  });
});
