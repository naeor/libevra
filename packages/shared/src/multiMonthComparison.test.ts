import { describe, expect, it } from "vitest";

import {
  computeMultiMonthComparison,
  daysInMonth,
  isMonthKey,
  isMultiMonthComparisonValid,
  normalizeMonthKeys,
  type MonthEntry,
} from "./multiMonthComparison.js";

function expense(date: string, amountMinor: bigint | number): MonthEntry {
  return { occurredLocalDate: date, kind: "expense", amountMinor };
}

const baseRequest = {
  months: ["2026-01", "2026-03", "2026-06", "2026-09"],
  metric: "expense" as const,
  today: "2026-10-27",
};

describe("multi-month comparison (A04 §22)", () => {
  it("keeps each selected month explicit and sums exactly inside natural months", () => {
    const entries = [
      expense("2026-01-01", 1_000n),
      expense("2026-01-31", 2_000n),
      expense("2026-02-01", 9_999n), // not selected
      expense("2026-03-15", 3_000n),
      expense("2026-06-30", 4_000n),
      expense("2026-09-30", 5_000n),
      { occurredLocalDate: "2026-09-30", kind: "income" as const, amountMinor: 7_000n }, // other metric
    ];
    const result = computeMultiMonthComparison(entries, baseRequest);
    expect(result.months.map((point) => point.month)).toEqual([
      "2026-01",
      "2026-03",
      "2026-06",
      "2026-09",
    ]);
    expect(result.months.map((point) => point.amountMinor)).toEqual(["3000", "3000", "4000", "5000"]);
    expect(result.complete).toBe(true);
    expect(result.completeMonths).toBe(4);
    expect(result.totalMinor).toBe("15000");
    expect(result.source).toEqual({ start: "2026-01-01", end: "2026-10-01" });
    expect(result.crossYear).toBe(false);
    expect(result.notes).toEqual([]);
    expect(result.months[0]?.span).toEqual({ start: "2026-01-01", end: "2026-02-01" });
  });

  it("keeps the year visible when the same month of two years is selected", () => {
    const result = computeMultiMonthComparison(
      [expense("2025-01-10", 1_000n), expense("2026-01-10", 2_000n)],
      { months: ["2025-01", "2026-01"], metric: "expense", today: "2026-10-27" },
    );
    expect(result.months.map((point) => point.month)).toEqual(["2025-01", "2026-01"]);
    expect(result.crossYear).toBe(true);
    expect(result.notes).toContain("cross-year");
    expect(result.ranking).toEqual([
      { month: "2026-01", amountMinor: "2000", rank: 1 },
      { month: "2025-01", amountMinor: "1000", rank: 2 },
    ]);
  });

  it("marks the current month in-progress and keeps it out of the strict ranking", () => {
    const result = computeMultiMonthComparison(
      [expense("2026-09-10", 2_000n), expense("2026-10-10", 500n)],
      { months: ["2026-09", "2026-10"], metric: "expense", today: "2026-10-27" },
    );
    expect(result.months[1]?.state).toBe("in-progress");
    expect(result.months[1]?.comparable).toBe(false);
    expect(result.months[1]?.amountMinor).toBe("500");
    expect(result.inProgressMonths).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.ranking).toEqual([{ month: "2026-09", amountMinor: "2000", rank: 1 }]);
    expect(result.notes).toContain("incomplete-months");
  });

  it("marks a future month as not yet happened instead of zero", () => {
    const result = computeMultiMonthComparison(
      [],
      { months: ["2026-09", "2026-11"], metric: "expense", today: "2026-10-27" },
    );
    expect(result.months[1]?.state).toBe("future");
    expect(result.months[1]?.amountMinor).toBeNull();
    expect(result.months[1]?.unavailableReason).toBe("future-month");
    expect(result.totalMinor).toBeNull();
    expect(result.futureMonths).toBe(1);
  });

  it("returns null instead of zero when the coverage ends inside a month", () => {
    const result = computeMultiMonthComparison(
      [expense("2026-08-01", 1_000n), expense("2026-09-01", 2_000n)],
      { months: ["2026-08", "2026-09"], metric: "expense", today: "2026-10-27" },
      { coverageEnd: "2026-09-15" },
    );
    expect(result.months[0]?.state).toBe("complete");
    expect(result.months[0]?.amountMinor).toBe("1000");
    expect(result.months[1]?.state).toBe("unknown");
    expect(result.months[1]?.amountMinor).toBeNull();
    expect(result.unknownMonths).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.totalMinor).toBeNull();
  });

  it("ranks only complete months, descending, with stable first-in-order tie-breaking", () => {
    const result = computeMultiMonthComparison(
      [
        expense("2026-01-01", 1_000n),
        expense("2026-03-01", 5_000n),
        expense("2026-06-01", 1_000n),
        expense("2026-09-01", 9_000n),
      ],
      baseRequest,
    );
    expect(result.ranking?.map((entry) => entry.month)).toEqual(["2026-09", "2026-03", "2026-01", "2026-06"]);
    expect(result.ranking?.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
    expect(result.maxMonth).toBe("2026-09");
    expect(result.minMonth).toBe("2026-01");
  });

  it("drops duplicates but reports them, and keeps invalid keys visible", () => {
    const result = computeMultiMonthComparison(
      [expense("2026-01-01", 1_000n)],
      { months: ["2026-01", "2026-01", "not-a-month"], metric: "expense", today: "2026-10-27" },
    );
    expect(result.months.map((point) => point.month)).toEqual(["2026-01", "not-a-month"]);
    expect(result.months[1]?.state).toBe("unavailable");
    expect(result.months[1]?.unavailableReason).toBe("invalid-month");
    expect(result.notes).toContain("duplicates-ignored");
  });

  it("reports no-complete-months when every month is incomplete", () => {
    const result = computeMultiMonthComparison(
      [],
      { months: ["2026-10"], metric: "expense", today: "2026-10-27" },
    );
    expect(result.ranking).toBeNull();
    expect(result.notes).toContain("no-complete-months");
    expect(result.complete).toBe(false);
  });
});

describe("multi-month helpers", () => {
  it("recognises month keys and counts days", () => {
    expect(isMonthKey("2026-02")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-2")).toBe(false);
    expect(daysInMonth("2024-02")).toBe(29);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("bad")).toBeNull();
  });

  it("deduplicates while preserving the first occurrence order", () => {
    expect(normalizeMonthKeys(["2026-03", "2026-01", "2026-03"]).months).toEqual([
      "2026-03",
      "2026-01",
    ]);
  });

  it("validates requests", () => {
    expect(isMultiMonthComparisonValid(baseRequest)).toBe(true);
    expect(
      isMultiMonthComparisonValid({ months: [], metric: "expense", today: "2026-10-27" }),
    ).toBe(false);
    expect(
      isMultiMonthComparisonValid({ months: ["2026-01"], metric: "expense", today: "bad" }),
    ).toBe(false);
  });
});
