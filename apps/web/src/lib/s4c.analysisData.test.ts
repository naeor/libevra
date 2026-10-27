import { describe, expect, it } from "vitest";

import type { Transaction } from "@libellum/shared";

import {
  AnalysisRangeError,
  deriveAnomalyAnalysis,
  deriveSeasonalComparison,
  SEASONAL_MAX_MONTHS,
} from "./analysisData.js";

let nextId = 1;

function entry(
  occurredLocalDate: string,
  amountCents: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: `t-${String(nextId++).padStart(3, "0")}`,
    kind: "expense",
    amountCents,
    currency: "CNY",
    categoryId: "category-1",
    categoryName: "Food",
    categoryIsSystem: false,
    paymentMethodId: null,
    paymentMethodName: null,
    occurredAt: `${occurredLocalDate}T04:00:00.000Z`,
    occurredLocalDate,
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    ...overrides,
  };
}

describe("deriveSeasonalComparison (S4c A18)", () => {
  it("compares the same natural months across two years", () => {
    const transactions = [
      entry("2025-01-10", 1_000),
      entry("2025-01-20", 500),
      entry("2025-02-05", 2_000),
      entry("2026-01-15", 3_000),
      entry("2026-10-02", 700),
    ];
    const view = deriveSeasonalComparison(transactions, {
      span: { start: "2025-01-01", end: "2026-11-01" },
      today: "2026-10-27",
      coverage: "local-ledger",
    });

    const result = view.result;
    expect(result.granularity).toBe("month");
    expect(result.metric).toBe("expense");
    expect(result.years.map((year) => year.year)).toEqual([2025, 2026]);
    expect(result.comparableYears).toEqual([2025, 2026]);
    expect(result.descriptiveOnly).toBe(false);
    expect(result.maxMonths).toBe(SEASONAL_MAX_MONTHS);
    expect(result.monthCount).toBe(24);

    const [firstYear, secondYear] = result.years;
    expect(firstYear!.months[0]!.amountMinor).toBe("1500");
    expect(firstYear!.months[0]!.transactionCount).toBe(2);
    expect(firstYear!.months[1]!.amountMinor).toBe("2000");
    expect(firstYear!.months[2]!.amountMinor).toBe("0");
    expect(firstYear!.months[2]!.state).toBe("complete");
    expect(secondYear!.months[0]!.amountMinor).toBe("3000");

    // Today's month is unfinished: it keeps the partial confirmed amount but must
    // stay comparable=false, never a complete October total.
    const october = secondYear!.months[9]!;
    expect(october.state).toBe("in-progress");
    expect(october.comparable).toBe(false);
    expect(october.amountMinor).toBe("700");
    expect(october.transactionCount).toBe(1);
    expect(result.hasInProgressCells).toBe(true);
    expect(view.input.coverageEnd).toBe("2026-10-27");
  });

  it("is descriptive only when a single year is in range", () => {
    const transactions = [entry("2026-01-15", 3_000)];
    const view = deriveSeasonalComparison(transactions, {
      span: { start: "2026-01-01", end: "2026-11-01" },
      today: "2026-10-27",
      coverage: "local-ledger",
    });

    expect(view.result.years).toHaveLength(1);
    expect(view.result.comparableYears).toEqual([2026]);
    expect(view.result.descriptiveOnly).toBe(true);
    expect(view.result.descriptiveReason).toBe("fewer-than-two-years");
  });

  it("does not treat unknown coverage as complete months", () => {
    const transactions = [entry("2025-01-10", 1_000)];
    const view = deriveSeasonalComparison(transactions, {
      span: { start: "2025-01-01", end: "2026-11-01" },
      today: "2026-10-27",
      coverage: "unknown",
    });

    expect(view.result.years.every((year) => year.totalMinor === null)).toBe(true);
    expect(view.result.years.every((year) => year.comparableMonths === 0)).toBe(true);
    expect(view.result.comparableYears).toEqual([]);
    expect(view.result.descriptiveOnly).toBe(true);
    // The running month stays `in-progress` (partial amount known so far) even when
    // coverage is unknown; every finished month must be unknown, never a zero.
    const inProgress = view.result.years
      .flatMap((year) => year.months)
      .filter((cell) => cell.state === "in-progress");
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]!.comparable).toBe(false);
    expect(
      view.result.years
        .flatMap((year) => year.months)
        .filter((cell) => cell.state !== "in-progress")
        .every((cell) => cell.amountMinor === null),
    ).toBe(true);
  });

  it(`rejects a history longer than ${SEASONAL_MAX_MONTHS} months instead of truncating`, () => {
    const transactions = [entry("2023-01-10", 1_000)];
    let error: unknown;
    try {
      deriveSeasonalComparison(transactions, {
        span: { start: "2023-01-01", end: "2026-11-01" },
        today: "2026-10-27",
        coverage: "local-ledger",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AnalysisRangeError);
    expect((error as AnalysisRangeError).code).toBe("analysis-range-too-long");
    expect((error as Error).message).toContain("36");
  });

  it("groups by natural quarter when asked", () => {
    const transactions = [
      entry("2025-02-05", 2_000),
      entry("2025-04-05", 4_000),
      entry("2026-01-15", 6_000),
    ];
    const view = deriveSeasonalComparison(transactions, {
      span: { start: "2025-01-01", end: "2026-11-01" },
      today: "2026-10-27",
      coverage: "local-ledger",
      granularity: "quarter",
    });

    expect(view.result.granularity).toBe("quarter");
    const [firstYear] = view.result.years;
    expect(firstYear!.quarters).toHaveLength(4);
    expect(firstYear!.quarters[0]!.amountMinor).toBe("2000");
    expect(firstYear!.quarters[1]!.amountMinor).toBe("4000");
    expect(view.result.years[1]!.quarters[0]!.amountMinor).toBe("6000");
  });
});

describe("deriveAnomalyAnalysis (S4c A19)", () => {
  it("marks a spike above the MAD threshold and keeps the sample statement", () => {
    const transactions = [];
    for (let day = 1; day <= 30; day += 1) {
      const date = `2026-09-${String(day).padStart(2, "0")}`;
      transactions.push(entry(date, day === 15 ? 90_000 : 1_000));
    }
    const view = deriveAnomalyAnalysis(transactions, {
      span: { start: "2026-09-01", end: "2026-10-01" },
      today: "2026-10-27",
      coverage: "local-ledger",
    });

    expect(view.observedDays).toBe(30);
    expect(view.unavailableReason).toBeNull();
    expect(view.result.sampleDays).toBe(30);
    expect(view.result.sufficientSample).toBe(true);
    expect(view.result.baseline).not.toBeNull();
    expect(view.result.marks).toHaveLength(1);
    expect(view.result.marks[0]!.date).toBe("2026-09-15");
    expect(view.result.marks[0]!.rank).toBe(1);
    expect(view.result.marks[0]!.amountMinor).toBe("90000");
    expect(view.result.todayExcluded).toBe(false);
    expect(view.result.targetRange).toEqual({ start: "2026-09-01", end: "2026-10-01" });
  });

  it("never treats the unfinished today as a spike", () => {
    const transactions = [];
    for (let day = 20; day <= 26; day += 1) {
      transactions.push(entry(`2026-10-${day}`, 1_000));
    }
    transactions.push(entry("2026-10-27", 500_000));
    const view = deriveAnomalyAnalysis(transactions, {
      span: { start: "2026-10-20", end: "2026-10-28" },
      today: "2026-10-27",
      coverage: "local-ledger",
      options: { minimumSampleDays: 5 },
    });

    expect(view.result.todayExcluded).toBe(true);
    expect(view.result.sampleDays).toBe(7);
    expect(view.result.sufficientSample).toBe(true);
    expect(view.result.marks.every((mark) => mark.date !== "2026-10-27")).toBe(true);
    // The in-progress day keeps its partial confirmed amount in the series but the
    // detector samples complete days only, so today can never become a mark.
    const todayPoint = view.points.find((point) => point.bucket.key === "2026-10-27");
    expect(todayPoint!.bucket.state).toBe("in-progress");
    expect(todayPoint!.amountMinor).toBe("500000");
  });

  it("keeps an insufficient sample visible instead of marking peaks", () => {
    const transactions = [1, 2, 3, 4].map((day) =>
      entry(`2026-10-0${day}`, 1_000),
    );
    const view = deriveAnomalyAnalysis(transactions, {
      span: { start: "2026-10-01", end: "2026-10-05" },
      today: "2026-10-27",
      coverage: "local-ledger",
    });

    expect(view.observedDays).toBe(4);
    expect(view.result.sampleDays).toBe(4);
    expect(view.result.sufficientSample).toBe(false);
    expect(view.result.baseline).not.toBeNull();
    expect(view.result.marks).toEqual([]);
  });

  it("reports no baseline when no day is confirmed yet", () => {
    const view = deriveAnomalyAnalysis([], {
      span: { start: "2026-10-28", end: "2026-10-31" },
      today: "2026-10-27",
      coverage: "local-ledger",
    });

    expect(view.observedDays).toBe(0);
    expect(view.unavailableReason).toBe("no-complete-observations");
    expect(view.result.baseline).toBeNull();
    expect(view.result.marks).toEqual([]);
    expect(view.result.sufficientSample).toBe(false);
  });
});
