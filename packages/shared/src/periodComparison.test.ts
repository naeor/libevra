import { describe, expect, it } from "vitest";

import {
  computePeriodComparison,
  isComparisonRequestValid,
  resolveComparison,
  type ComparisonEntry,
  type ComparisonRequest,
} from "./periodComparison.js";
import { daySpan, monthSpan, weekSpan } from "./timeCalendar.js";

function expense(date: string, amountMinor: bigint | number): ComparisonEntry {
  return { occurredLocalDate: date, kind: "expense", amountMinor };
}

function income(date: string, amountMinor: bigint | number): ComparisonEntry {
  return { occurredLocalDate: date, kind: "income", amountMinor };
}

function request(overrides: Partial<ComparisonRequest>): ComparisonRequest {
  return { kind: "previous-period", today: "2026-11-05", ...overrides };
}

describe("resolveComparison: finished natural month (§19 case 1)", () => {
  it("compares a finished month with the previous natural month", () => {
    const resolution = resolveComparison(
      request({ kind: "previous-period", current: monthSpan("2026-08-01"), today: "2026-09-05" }),
    );
    expect(resolution.periodSpan).toEqual({ start: "2026-08-01", end: "2026-09-01" });
    expect(resolution.current).toEqual({ start: "2026-08-01", end: "2026-09-01" });
    expect(resolution.previous).toEqual({ start: "2026-07-01", end: "2026-08-01" });
    expect(resolution.mode).toBe("natural-month");
    expect(resolution.periodDays).toBe(31);
    expect(resolution.currentDays).toBe(31);
    expect(resolution.previousDays).toBe(31);
    expect(resolution.sameLength).toBe(true);
    expect(resolution.currentInProgress).toBe(false);
    expect(resolution.notes).toEqual([]);
  });

  it("reports exact income/expense differences and a rational growth rate", () => {
    const entries = [
      expense("2026-07-05", 100_000n),
      expense("2026-07-20", 0n),
      expense("2026-08-03", 120_000n),
      income("2026-07-01", 200_000n),
      income("2026-08-01", 150_000n),
      // Outside both compared months: must not leak into either side.
      expense("2026-06-30", 777n),
      expense("2026-09-01", 888n),
    ];
    const result = computePeriodComparison(
      entries,
      request({ kind: "previous-period", current: monthSpan("2026-08-01"), today: "2026-09-05" }),
    );
    expect(result.expense.currentMinor).toBe("120000");
    expect(result.expense.previousMinor).toBe("100000");
    expect(result.expense.differenceMinor).toBe("20000");
    expect(result.expense.growth).toEqual({
      state: "computed",
      numeratorMinor: "20000",
      denominatorMinor: "100000",
    });
    expect(result.income.currentMinor).toBe("150000");
    expect(result.income.previousMinor).toBe("200000");
    expect(result.income.differenceMinor).toBe("-50000");
    expect(result.expense.complete).toBe(true);
    expect(result.expense.transactionCountCurrent).toBe(1);
    expect(result.expense.transactionCountPrevious).toBe(2);
  });
});

describe("resolveComparison: running natural month (§19 case 4)", () => {
  it("clips the current month to the elapsed days and compares the same-day-index window", () => {
    const resolution = resolveComparison(
      request({
        kind: "month-over-month",
        current: monthSpan("2026-10-01"),
        today: "2026-10-27",
      }),
    );
    expect(resolution.periodSpan).toEqual({ start: "2026-10-01", end: "2026-11-01" });
    expect(resolution.current).toEqual({ start: "2026-10-01", end: "2026-10-28" });
    expect(resolution.previous).toEqual({ start: "2026-09-01", end: "2026-09-28" });
    expect(resolution.periodDays).toBe(31);
    expect(resolution.currentDays).toBe(27);
    expect(resolution.previousDays).toBe(27);
    expect(resolution.sameLength).toBe(true);
    expect(resolution.currentInProgress).toBe(true);
    expect(resolution.currentDayInProgress).toBe(true);
    expect(resolution.mode).toBe("same-day-index");
    expect(resolution.notes).toEqual(["current-period-in-progress", "current-day-in-progress"]);
  });

  it("does not count days after today or after the same-day-index window", () => {
    const entries = [
      expense("2026-10-03", 30_000n),
      expense("2026-10-30", 99_999n), // future day inside the natural month
      expense("2026-09-02", 20_000n),
      expense("2026-09-29", 777n), // after Sep 28
    ];
    const result = computePeriodComparison(
      entries,
      request({ kind: "month-over-month", current: monthSpan("2026-10-01"), today: "2026-10-27" }),
    );
    expect(result.expense.currentMinor).toBe("30000");
    expect(result.expense.previousMinor).toBe("20000");
    expect(result.expense.differenceMinor).toBe("10000");
    expect(result.resolution.currentDays).toBe(27);
  });

  it("clips the previous month when it is shorter than the elapsed days", () => {
    const resolution = resolveComparison(
      request({
        kind: "month-over-month",
        current: monthSpan("2026-03-01"),
        today: "2026-03-31",
      }),
    );
    expect(resolution.current).toEqual({ start: "2026-03-01", end: "2026-04-01" });
    expect(resolution.previous).toEqual({ start: "2026-02-01", end: "2026-03-01" });
    expect(resolution.currentDays).toBe(31);
    expect(resolution.previousDays).toBe(28);
    expect(resolution.sameLength).toBe(false);
    expect(resolution.previousClipped).toBe(true);
    expect(resolution.notes).toContain("previous-period-clipped");
    expect(resolution.notes).toContain("length-mismatch");
  });
});

describe("resolveComparison: natural week and custom ranges (§19 cases 2/3)", () => {
  it("compares a finished natural week with the previous natural week", () => {
    const resolution = resolveComparison(
      request({
        kind: "previous-period",
        current: weekSpan("2026-10-19"),
        today: "2026-10-27",
      }),
    );
    expect(resolution.mode).toBe("natural-week");
    expect(resolution.current).toEqual({ start: "2026-10-19", end: "2026-10-26" });
    expect(resolution.previous).toEqual({ start: "2026-10-12", end: "2026-10-19" });
    expect(resolution.currentDays).toBe(7);
    expect(resolution.previousDays).toBe(7);
  });

  it("compares a custom range with the adjacent equal-length range", () => {
    const resolution = resolveComparison(
      request({
        kind: "previous-period",
        current: { start: "2026-09-01", end: "2026-09-11" },
        today: "2026-09-12",
      }),
    );
    expect(resolution.mode).toBe("equal-length");
    expect(resolution.previous).toEqual({ start: "2026-08-22", end: "2026-09-01" });
    expect(resolution.currentDays).toBe(10);
    expect(resolution.previousDays).toBe(10);
  });

  it("compares a running custom range on its elapsed window, not its full length", () => {
    const resolution = resolveComparison(
      request({
        kind: "previous-period",
        current: { start: "2026-10-20", end: "2026-11-10" },
        today: "2026-10-27",
      }),
    );
    expect(resolution.current).toEqual({ start: "2026-10-20", end: "2026-10-28" });
    expect(resolution.previous).toEqual({ start: "2026-10-12", end: "2026-10-20" });
    expect(resolution.currentDays).toBe(8);
    expect(resolution.previousDays).toBe(8);
    expect(resolution.sameLength).toBe(true);
    expect(resolution.notes).toContain("current-day-in-progress");
  });
});

describe("resolveComparison: year-over-year (§21)", () => {
  it("clamps Feb 29 to Feb 28 and records the fallback", () => {
    const resolution = resolveComparison(
      request({
        kind: "year-over-year",
        current: daySpan("2024-02-29"),
        today: "2024-03-05",
      }),
    );
    expect(resolution.mode).toBe("calendar-year-shift");
    expect(resolution.previous).toEqual({ start: "2023-02-28", end: "2023-03-01" });
    expect(resolution.currentDays).toBe(1);
    expect(resolution.previousDays).toBe(1);
    expect(resolution.notes).toEqual(["leap-day-fallback"]);
    expect(resolution.leapDayFallbacks).toEqual([
      { date: "2024-02-29", alignedTo: "2023-02-28" },
    ]);
  });

  it("uses the equal observation window for a running month-to-date-style year comparison", () => {
    const resolution = resolveComparison(
      request({
        kind: "year-over-year",
        current: monthSpan("2026-10-01"),
        today: "2026-10-27",
      }),
    );
    expect(resolution.current).toEqual({ start: "2026-10-01", end: "2026-10-28" });
    expect(resolution.previous).toEqual({ start: "2025-10-01", end: "2025-10-28" });
    expect(resolution.currentDays).toBe(27);
    expect(resolution.previousDays).toBe(27);
    expect(resolution.currentInProgress).toBe(true);
    expect(resolution.periodDays).toBe(31);
  });

  it("shifts an explicit same-period range one year earlier", () => {
    const result = computePeriodComparison(
      [
        expense("2026-09-10", 50_000n),
        expense("2025-09-10", 40_000n),
        expense("2025-08-31", 9_999n),
      ],
      request({
        kind: "year-over-year",
        current: { start: "2026-09-01", end: "2026-10-01" },
        today: "2026-10-05",
      }),
    );
    expect(result.resolution.previous).toEqual({ start: "2025-09-01", end: "2025-10-01" });
    expect(result.expense.currentMinor).toBe("50000");
    expect(result.expense.previousMinor).toBe("40000");
    expect(result.expense.differenceMinor).toBe("10000");
    expect(result.expense.growth).toEqual({
      state: "computed",
      numeratorMinor: "10000",
      denominatorMinor: "40000",
    });
  });
});

describe("resolveComparison: month-to-date (§23)", () => {
  it("defaults to same-day-index: Oct 1-27 against Sep 1-27", () => {
    const resolution = resolveComparison({
      kind: "month-to-date",
      today: "2026-10-27",
    });
    expect(resolution.periodSpan).toEqual({ start: "2026-10-01", end: "2026-11-01" });
    expect(resolution.current).toEqual({ start: "2026-10-01", end: "2026-10-28" });
    expect(resolution.previous).toEqual({ start: "2026-09-01", end: "2026-09-28" });
    expect(resolution.currentDays).toBe(27);
    expect(resolution.previousDays).toBe(27);
    expect(resolution.sameLength).toBe(true);
    expect(resolution.mode).toBe("same-day-index");
    expect(resolution.currentInProgress).toBe(true);
    expect(resolution.notes).toEqual(["current-period-in-progress", "current-day-in-progress"]);
  });

  it("supports the documented equal-length-window policy that may cross the month edge", () => {
    const resolution = resolveComparison({
      kind: "month-to-date",
      today: "2026-03-31",
      monthToDatePolicy: "equal-length-window",
    });
    expect(resolution.current).toEqual({ start: "2026-03-01", end: "2026-04-01" });
    expect(resolution.previous).toEqual({ start: "2026-02-01", end: "2026-03-04" });
    expect(resolution.currentDays).toBe(31);
    expect(resolution.previousDays).toBe(31);
    expect(resolution.notes).toContain("previous-period-crosses-month");
  });

  it("clips the same-day-index window when the previous month is shorter", () => {
    const resolution = resolveComparison({ kind: "month-to-date", today: "2026-03-30" });
    expect(resolution.currentDays).toBe(30);
    expect(resolution.previous).toEqual({ start: "2026-02-01", end: "2026-03-01" });
    expect(resolution.previousDays).toBe(28);
    expect(resolution.previousClipped).toBe(true);
    expect(resolution.sameLength).toBe(false);
    expect(resolution.notes).toContain("previous-period-clipped");
  });

  it("computes totals over the real observation windows only", () => {
    const result = computePeriodComparison(
      [
        expense("2026-09-05", 1_000n),
        expense("2026-09-27", 2_000n),
        expense("2026-09-29", 9_999n), // after the same-day-index window
        expense("2026-10-02", 3_000n),
        expense("2026-10-27", 4_000n), // today: running observation day
        expense("2026-10-28", 8_888n), // after today: not observed
      ],
      { kind: "month-to-date", today: "2026-10-27" },
    );
    expect(result.expense.currentMinor).toBe("7000");
    expect(result.expense.previousMinor).toBe("3000");
    expect(result.expense.differenceMinor).toBe("4000");
    expect(result.expense.growth).toEqual({
      state: "computed",
      numeratorMinor: "4000",
      denominatorMinor: "3000",
    });
  });
});

describe("growth semantics (§20)", () => {
  it("marks a zero previous period unavailable but keeps the absolute difference", () => {
    const result = computePeriodComparison(
      [expense("2026-08-03", 50_000n)],
      request({ kind: "month-over-month", current: monthSpan("2026-08-01"), today: "2026-09-05" }),
    );
    expect(result.expense.previousMinor).toBe("0");
    expect(result.expense.differenceMinor).toBe("50000");
    expect(result.expense.growth).toEqual({ state: "unavailable", reason: "previous-zero" });
  });

  it("treats both-zero as a single consistent policy", () => {
    const result = computePeriodComparison(
      [],
      request({ kind: "month-over-month", current: monthSpan("2026-08-01"), today: "2026-09-05" }),
    );
    expect(result.expense.differenceMinor).toBe("0");
    expect(result.expense.growth).toEqual({ state: "unavailable", reason: "both-zero" });
  });

  it("refuses to apply the classic formula to a negative base", () => {
    const result = computePeriodComparison(
      [expense("2026-07-10", -100_000n), expense("2026-08-10", 50_000n)],
      request({ kind: "month-over-month", current: monthSpan("2026-08-01"), today: "2026-09-05" }),
    );
    expect(result.expense.previousMinor).toBe("-100000");
    expect(result.expense.differenceMinor).toBe("150000");
    expect(result.expense.growth).toEqual({ state: "unavailable", reason: "previous-negative" });
  });
});

describe("data coverage", () => {
  it("returns null amounts instead of zero when the coverage is unknown", () => {
    const result = computePeriodComparison(
      [expense("2026-10-05", 12_000n)],
      request({
        kind: "month-over-month",
        current: monthSpan("2026-10-01"),
        today: "2026-11-05",
      }),
      { coverageEnd: "2026-10-20" },
    );
    expect(result.expense.currentMinor).toBeNull();
    expect(result.expense.previousMinor).toBe("0");
    expect(result.expense.complete).toBe(false);
    expect(result.expense.growth).toEqual({ state: "unavailable", reason: "current-unknown" });
  });
});

describe("request validation", () => {
  it("rejects missing/invalid spans and unknown kinds", () => {
    expect(isComparisonRequestValid({ kind: "previous-period", today: "2026-10-27" })).toBe(false);
    expect(
      isComparisonRequestValid({
        kind: "previous-period",
        current: { start: "2026-10-02", end: "2026-10-01" },
        today: "2026-10-27",
      }),
    ).toBe(false);
    expect(
      isComparisonRequestValid({
        kind: "no-such-kind" as never,
        current: monthSpan("2026-09-01"),
        today: "2026-10-27",
      }),
    ).toBe(false);
  });

  it("accepts a valid month-to-date request without a current span", () => {
    expect(isComparisonRequestValid({ kind: "month-to-date", today: "2026-10-27" })).toBe(true);
  });
});
