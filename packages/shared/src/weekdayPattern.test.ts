import { describe, expect, it } from "vitest";

import { spanFromInclusiveDates } from "./timeCalendar.js";
import {
  WEEKDAY_MIN_SAMPLE_DAYS,
  WEEKDAY_PATTERN_VERSION,
  computeWeekdayPattern,
  type WeekdayPatternOptions,
} from "./weekdayPattern.js";

/** October 2026: 1st is a Thursday, so Mondays occur 4 times but Thu/Fri/Sat 5 times. */
const OCTOBER: WeekdayPatternOptions = {
  kind: "expense",
  span: spanFromInclusiveDates("2026-10-01", "2026-10-31"),
  today: "2026-11-05",
  coverageEnd: "2026-10-31",
};

function entry(
  occurredLocalDate: string,
  amountMinor: bigint | number,
  kind: "expense" | "income" = "expense",
): { occurredLocalDate: string; kind: "expense" | "income"; amountMinor: bigint | number } {
  return { occurredLocalDate, kind, amountMinor };
}

describe("weekday pattern (I13)", () => {
  it("keeps Monday→Sunday order and counts the observed days per weekday", () => {
    const result = computeWeekdayPattern([], OCTOBER);

    expect(result.version).toBe(WEEKDAY_PATTERN_VERSION);
    expect(result.weekdays.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // 2026-10: Mon/Tue/Wed/Sun 4 days, Thu/Fri/Sat 5 days.
    expect(result.weekdays.map((day) => day.observedDays)).toEqual([4, 4, 4, 5, 5, 5, 4]);
    expect(result.observedDayCount).toBe(31);
    expect(result.complete).toBe(true);
    expect(result.sufficientSample).toBe(true);
  });

  it("reports totals and exact averages separately", () => {
    const result = computeWeekdayPattern(
      [
        entry("2026-10-05", 1_000), // Monday
        entry("2026-10-12", 2_000), // Monday
        entry("2026-10-01", 7_000), // Thursday
      ],
      OCTOBER,
    );

    const monday = result.weekdays[0];
    expect(monday?.totalMinor).toBe("3000");
    expect(monday?.observedDays).toBe(4);
    expect(monday?.average).toEqual({
      numeratorMinor: "3000",
      denominatorDays: 4,
      text: "750.00",
    });

    const thursday = result.weekdays[3];
    expect(thursday?.totalMinor).toBe("7000");
    expect(thursday?.average?.text).toBe("1400.00");
  });

  it("does not divide by an unobserved weekday", () => {
    const result = computeWeekdayPattern([], {
      ...OCTOBER,
      span: spanFromInclusiveDates("2026-10-05", "2026-10-05"), // one Monday
    });

    expect(result.weekdays[0]?.average).toEqual({
      numeratorMinor: "0",
      denominatorDays: 1,
      text: "0.00",
    });
    expect(result.weekdays[1]?.observedDays).toBe(0);
    expect(result.weekdays[1]?.average).toBeNull();
    expect(result.sufficientSample).toBe(false);
  });

  it("flags a short sample instead of calling it a habit", () => {
    const shortSpan = computeWeekdayPattern([], {
      ...OCTOBER,
      span: spanFromInclusiveDates("2026-10-01", "2026-10-20"),
    });

    expect(shortSpan.observedDayCount).toBe(20);
    expect(shortSpan.observedDayCount < WEEKDAY_MIN_SAMPLE_DAYS).toBe(true);
    expect(shortSpan.sufficientSample).toBe(false);
  });

  it("returns unknown totals when the range is not fully covered", () => {
    const result = computeWeekdayPattern([entry("2026-10-05", 1_000)], {
      ...OCTOBER,
      coverageEnd: "2026-10-15",
    });

    expect(result.unknownDayCount).toBe(16);
    expect(result.weekdays[0]?.totalMinor).toBeNull();
    expect(result.weekdays[0]?.average).toBeNull();
    expect(result.complete).toBe(false);
  });

  it("does not treat future days as observed", () => {
    const result = computeWeekdayPattern([entry("2026-10-05", 1_000)], {
      ...OCTOBER,
      today: "2026-10-20",
      coverageEnd: null,
    });

    expect(result.futureDayCount).toBe(11);
    expect(result.weekdays[0]?.totalMinor).toBeNull();
    expect(result.complete).toBe(false);
  });

  it("only counts the requested kind", () => {
    const result = computeWeekdayPattern(
      [entry("2026-10-05", 1_000, "expense"), entry("2026-10-05", 9_000, "income")],
      OCTOBER,
    );

    expect(result.weekdays[0]?.totalMinor).toBe("1000");
  });
});
