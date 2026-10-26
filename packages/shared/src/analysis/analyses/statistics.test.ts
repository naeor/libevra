import { describe, expect, it } from "vitest";

import { makeDefinition, makePeriod, type WorkbenchState } from "../context.js";
import {
  assembleDaysWithoutExpenseRecords,
  assembleDaysWithExpenseRecords,
  assembleExpenseIncomeRatio,
  assembleLedgerSurplusRatio,
  assembleMaxExpenseTransaction,
  assembleMaxIncomeTransaction,
  assembleMedianExpense,
  assembleMinExpenseTransaction,
  assembleMostRecordedDay,
  assemblePeakExpenseDay,
  assemblePeakIncomeDay,
} from "./statistics.js";
import {
  SAMPLE_A_EMPTY_BOOK,
  SAMPLE_B_INCOME_ONLY,
  SAMPLE_C_EXPENSE_ONLY,
  SAMPLE_D_EQUAL_AMOUNTS,
  SAMPLE_G_LARGE_INTEGERS,
  SAMPLE_H_ACROSS_MONTHS,
  SAMPLE_L_OFFLINE_INCOMPLETE,
  SAMPLE_M_DELETED_AND_RESTORED,
  SAMPLE_N_PRECISION_EDGES,
  SAMPLE_O_FILTERS,
} from "../fixtures.js";
import type { AnalysisDefinition, RecordExtremeResult, ScalarResult } from "../types.js";

function workbench(
  from: string,
  to: string,
  overrides: Partial<WorkbenchState> = {},
): WorkbenchState {
  return {
    period: makePeriod(from, to),
    today: "2026-10-27",
    currency: { mode: "original", currency: "CNY" },
    ...overrides,
  };
}

const OCTOBER = workbench("2026-10-01", "2026-10-31");

function definition(analysisId: string, metric: string): AnalysisDefinition {
  return makeDefinition({
    analysisId,
    analysisType: "scalar",
    metric,
    time: { mode: "inherit" },
  });
}

const MEDIAN = definition("AN-B08", "expense-median");
const LARGEST_EXPENSE = definition("AN-B09", "expense-largest-record");
const SMALLEST_EXPENSE = definition("AN-B10", "expense-smallest-record");
const PEAK_EXPENSE_DAY = definition("AN-B11", "expense-peak-day");
const PEAK_INCOME_DAY = definition("AN-B12", "income-peak-day");
const EXPENSE_DAYS = definition("AN-B13", "expense-recorded-days");
const DAYS_WITHOUT = definition("AN-B14", "expense-days-without-records");
const LARGEST_INCOME = definition("AN-B17", "income-largest-record");
const EXPENSE_INCOME_RATIO = definition("AN-B18", "expense-income-ratio");
const LEDGER_SURPLUS = definition("AN-B19", "ledger-surplus-ratio");
const MOST_RECORDED_DAY = definition("AN-B20", "most-recorded-day");

function exactMoneyOf(result: ScalarResult): {
  numeratorMinor: string;
  denominator: string;
  currency: string;
} {
  if (result.value === null) throw new Error("expected an exact-money scalar, got null");
  if (result.value.kind !== "exact-money") {
    throw new Error(`expected exact-money, got ${result.value.kind}`);
  }

  return {
    numeratorMinor: result.value.numeratorMinor,
    denominator: result.value.denominator,
    currency: result.value.currency,
  };
}

function daysOf(result: ScalarResult): number {
  if (result.value === null) throw new Error("expected a days scalar, got null");
  if (result.value.kind !== "days") throw new Error(`expected days, got ${result.value.kind}`);

  return result.value.days;
}

function ratioOfScalar(result: ScalarResult): {
  numerator: string;
  denominator: string;
  scale: string;
} {
  if (result.value === null) throw new Error("expected a ratio scalar, got null");
  if (result.value.kind !== "ratio") throw new Error(`expected ratio, got ${result.value.kind}`);

  return {
    numerator: result.value.ratio.numerator.toString(),
    denominator: result.value.ratio.denominator.toString(),
    scale: result.value.scale,
  };
}

function extremeMoneyOf(result: RecordExtremeResult): string {
  if (result.extreme === null) throw new Error("expected a money extreme, got null");

  return result.extreme.amountMinor;
}

/* ------------------------------------------------------------------ *
 * B08 — median of per-transaction expense amounts
 * ------------------------------------------------------------------ */

describe("B08 median expense", () => {
  it("takes the middle amount for an odd sample (sample C)", () => {
    const result = assembleMedianExpense(SAMPLE_C_EXPENSE_ONLY.entries, MEDIAN, OCTOBER);

    expect(exactMoneyOf(result)).toEqual({
      numeratorMinor: "600",
      denominator: "1",
      currency: "CNY",
    });
    expect(result.computation.sampleCount).toBe(3);
    expect(result.completeness).toBe("complete");
  });

  it("keeps half a minor unit for an even sample (sample N)", () => {
    const result = assembleMedianExpense(SAMPLE_N_PRECISION_EDGES.entries, MEDIAN, OCTOBER);

    expect(exactMoneyOf(result)).toEqual({
      numeratorMinor: "2005",
      denominator: "2",
      currency: "CNY",
    });
  });

  it("sorts exact amounts of equal records deterministically (sample D)", () => {
    const result = assembleMedianExpense(SAMPLE_D_EQUAL_AMOUNTS.entries, MEDIAN, OCTOBER);

    expect(exactMoneyOf(result).numeratorMinor).toBe("5000");
  });

  it("keeps a value above Number.MAX_SAFE_INTEGER exact (sample G)", () => {
    const result = assembleMedianExpense(SAMPLE_G_LARGE_INTEGERS.entries, MEDIAN, OCTOBER);

    expect(exactMoneyOf(result).numeratorMinor).toBe("3");
  });

  it("has no median when nothing was recorded (sample A)", () => {
    const result = assembleMedianExpense(SAMPLE_A_EMPTY_BOOK.entries, MEDIAN, OCTOBER);

    expect(result.value).toBeNull();
    expect(result.completeness).toBe("no-transactions");
  });

  it("ignores soft-deleted records (sample M)", () => {
    const result = assembleMedianExpense(SAMPLE_M_DELETED_AND_RESTORED.entries, MEDIAN, OCTOBER);

    expect(exactMoneyOf(result).numeratorMinor).toBe("700");
  });
});

/* ------------------------------------------------------------------ *
 * B09/B10/B17 — single extreme records
 * ------------------------------------------------------------------ */

describe("B09 largest expense transaction", () => {
  it("returns the record, its date, labels and source id (sample C)", () => {
    const result = assembleMaxExpenseTransaction(
      SAMPLE_C_EXPENSE_ONLY.entries,
      LARGEST_EXPENSE,
      OCTOBER,
    );

    expect(extremeMoneyOf(result)).toBe("1200");
    expect(result.recordId).toBe("c-meal");
    expect(result.occurredLocalDate).toBe("2026-10-01");
    expect(result.categoryLabel).toBe("餐饮");
    expect(result.paymentMethodLabel).toBe("钱包");
    expect(result.tieCount).toBe(1);
    expect(result.source.transactionIds).toEqual(["c-meal"]);
    expect(result.source.query.kind).toBe("transactions");
  });

  it("reports ties instead of letting refresh order pick one (sample D)", () => {
    const result = assembleMaxExpenseTransaction(
      SAMPLE_D_EQUAL_AMOUNTS.entries,
      LARGEST_EXPENSE,
      OCTOBER,
    );

    expect(extremeMoneyOf(result)).toBe("5000");
    expect(result.recordId).toBe("d-1");
    expect(result.occurredLocalDate).toBe("2026-10-05");
    expect(result.tieCount).toBe(3);
  });

  it("keeps a large amount exact (sample G)", () => {
    const result = assembleMaxExpenseTransaction(
      SAMPLE_G_LARGE_INTEGERS.entries,
      LARGEST_EXPENSE,
      OCTOBER,
    );

    expect(extremeMoneyOf(result)).toBe("9007199254740993");
  });

  it("has no extreme for an empty book (sample A)", () => {
    const result = assembleMaxExpenseTransaction(
      SAMPLE_A_EMPTY_BOOK.entries,
      LARGEST_EXPENSE,
      OCTOBER,
    );

    expect(result.extreme).toBeNull();
    expect(result.recordId).toBeNull();
    expect(result.tieCount).toBe(0);
    expect(result.completeness).toBe("no-transactions");
  });

  it("renders nothing when permission is missing", () => {
    const blocked = workbench("2026-10-01", "2026-10-31", { completeness: "no-permission" });
    const result = assembleMaxExpenseTransaction(
      SAMPLE_C_EXPENSE_ONLY.entries,
      LARGEST_EXPENSE,
      blocked,
    );

    expect(result.extreme).toBeNull();
    expect(result.completeness).toBe("no-permission");
  });
});

describe("B10 smallest expense transaction", () => {
  it("returns the smallest recorded amount (sample C)", () => {
    const result = assembleMinExpenseTransaction(
      SAMPLE_C_EXPENSE_ONLY.entries,
      SMALLEST_EXPENSE,
      OCTOBER,
    );

    expect(extremeMoneyOf(result)).toBe("200");
    expect(result.recordId).toBe("c-fun");
    expect(result.occurredLocalDate).toBe("2026-10-02");
  });

  it("reports ties with the earliest date first (sample D)", () => {
    const result = assembleMinExpenseTransaction(
      SAMPLE_D_EQUAL_AMOUNTS.entries,
      SMALLEST_EXPENSE,
      OCTOBER,
    );

    expect(result.recordId).toBe("d-1");
    expect(result.tieCount).toBe(3);
  });

  it("does not filter non-positive records to force a positive answer (sample N)", () => {
    const result = assembleMinExpenseTransaction(
      SAMPLE_N_PRECISION_EDGES.entries,
      SMALLEST_EXPENSE,
      OCTOBER,
    );

    expect(extremeMoneyOf(result)).toBe("1001");
  });
});

describe("B17 largest income transaction", () => {
  it("picks the largest income record (sample B)", () => {
    const result = assembleMaxIncomeTransaction(
      SAMPLE_B_INCOME_ONLY.entries,
      LARGEST_INCOME,
      OCTOBER,
    );

    expect(extremeMoneyOf(result)).toBe("25050");
    expect(result.recordId).toBe("b-salary-2");
    expect(result.occurredLocalDate).toBe("2026-10-17");
  });

  it("has no income extreme when only expenses exist (sample C)", () => {
    const result = assembleMaxIncomeTransaction(
      SAMPLE_C_EXPENSE_ONLY.entries,
      LARGEST_INCOME,
      OCTOBER,
    );

    expect(result.extreme).toBeNull();
    expect(result.completeness).toBe("no-transactions");
  });
});

/* ------------------------------------------------------------------ *
 * B11/B12 — peak business day by one kind's daily total
 * ------------------------------------------------------------------ */

describe("B11 peak expense day", () => {
  it("picks the day with the highest daily total, not the largest record day (sample C)", () => {
    const result = assemblePeakExpenseDay(
      SAMPLE_C_EXPENSE_ONLY.entries,
      PEAK_EXPENSE_DAY,
      OCTOBER,
    );

    expect(extremeMoneyOf(result)).toBe("1200");
    expect(result.occurredLocalDate).toBe("2026-10-01");
    expect(result.computation.sampleCount).toBe(1);
  });

  it("compares single days inside the resolved range (sample H)", () => {
    const result = assemblePeakExpenseDay(SAMPLE_H_ACROSS_MONTHS.entries, PEAK_EXPENSE_DAY, OCTOBER);

    expect(extremeMoneyOf(result)).toBe("300");
    expect(result.occurredLocalDate).toBe("2026-10-31");
  });

  it("uses business dates across kinds (sample O)", () => {
    const result = assemblePeakExpenseDay(SAMPLE_O_FILTERS.entries, PEAK_EXPENSE_DAY, OCTOBER);

    expect(extremeMoneyOf(result)).toBe("3000");
    expect(result.occurredLocalDate).toBe("2026-10-04");
  });

  it("has no peak day for an empty book (sample A)", () => {
    const result = assemblePeakExpenseDay(SAMPLE_A_EMPTY_BOOK.entries, PEAK_EXPENSE_DAY, OCTOBER);

    expect(result.extreme).toBeNull();
    expect(result.completeness).toBe("no-transactions");
  });
});

describe("B12 peak income day", () => {
  it("picks the day with the highest income total (sample B)", () => {
    const result = assemblePeakIncomeDay(SAMPLE_B_INCOME_ONLY.entries, PEAK_INCOME_DAY, OCTOBER);

    expect(extremeMoneyOf(result)).toBe("25050");
    expect(result.occurredLocalDate).toBe("2026-10-17");
  });

  it("has no income peak day when only expenses exist (sample C)", () => {
    const result = assemblePeakIncomeDay(SAMPLE_C_EXPENSE_ONLY.entries, PEAK_INCOME_DAY, OCTOBER);

    expect(result.extreme).toBeNull();
    expect(result.completeness).toBe("no-transactions");
  });
});

/* ------------------------------------------------------------------ *
 * B13/B14 — recorded days and days without expense records
 * ------------------------------------------------------------------ */

describe("B13 days with expense records", () => {
  it("counts distinct business dates (sample C)", () => {
    expect(daysOf(assembleDaysWithExpenseRecords(SAMPLE_C_EXPENSE_ONLY.entries, EXPENSE_DAYS, OCTOBER))).toBe(2);
  });

  it("counts only dates inside the resolved range (sample H)", () => {
    expect(daysOf(assembleDaysWithExpenseRecords(SAMPLE_H_ACROSS_MONTHS.entries, EXPENSE_DAYS, OCTOBER))).toBe(3);
  });

  it("is zero for an empty book (sample A)", () => {
    const result = assembleDaysWithExpenseRecords(SAMPLE_A_EMPTY_BOOK.entries, EXPENSE_DAYS, OCTOBER);

    expect(daysOf(result)).toBe(0);
    expect(result.completeness).toBe("no-transactions");
  });

  it("keeps the FX incompleteness state instead of dropping days", () => {
    const fxIncomplete = workbench("2026-10-01", "2026-10-31", { completeness: "fx-incomplete" });
    const result = assembleDaysWithExpenseRecords(
      SAMPLE_C_EXPENSE_ONLY.entries,
      EXPENSE_DAYS,
      fxIncomplete,
    );

    expect(daysOf(result)).toBe(2);
    expect(result.completeness).toBe("fx-incomplete");
  });

  it("renders nothing when permission is missing", () => {
    const blocked = workbench("2026-10-01", "2026-10-31", { completeness: "no-permission" });
    const result = assembleDaysWithExpenseRecords(SAMPLE_C_EXPENSE_ONLY.entries, EXPENSE_DAYS, blocked);

    expect(result.value).toBeNull();
    expect(result.completeness).toBe("no-permission");
  });
});

describe("B14 days without expense records", () => {
  it("is calendar days minus days with an expense record (sample C, October)", () => {
    const result = assembleDaysWithoutExpenseRecords(
      SAMPLE_C_EXPENSE_ONLY.entries,
      DAYS_WITHOUT,
      OCTOBER,
    );

    expect(daysOf(result)).toBe(29);
    expect(result.computation.denominatorDays).toBe(31);
  });

  it("stays a recording statement inside a shorter range (sample H)", () => {
    expect(
      daysOf(assembleDaysWithoutExpenseRecords(SAMPLE_H_ACROSS_MONTHS.entries, DAYS_WITHOUT, OCTOBER)),
    ).toBe(28);
  });

  it("counts every calendar day for an empty book (sample A)", () => {
    const result = assembleDaysWithoutExpenseRecords(SAMPLE_A_EMPTY_BOOK.entries, DAYS_WITHOUT, OCTOBER);

    expect(daysOf(result)).toBe(31);
    expect(result.completeness).toBe("no-transactions");
  });

  it("marks offline coverage as incomplete instead of claiming full coverage (sample L)", () => {
    const offline = workbench("2026-10-01", "2026-10-30", { completeness: "offline-incomplete" });
    const result = assembleDaysWithoutExpenseRecords(
      SAMPLE_L_OFFLINE_INCOMPLETE.entries,
      DAYS_WITHOUT,
      offline,
    );

    expect(daysOf(result)).toBe(27);
    expect(result.completeness).toBe("offline-incomplete");
    expect(result.computation.notes?.join("\n")).toContain("coverage incomplete");
  });
});

/* ------------------------------------------------------------------ *
 * B18/B19 — ratios
 * ------------------------------------------------------------------ */

describe("B18 expense income ratio", () => {
  it("computes expense / income as an exact percentage (sample O, 120%)", () => {
    const result = assembleExpenseIncomeRatio(SAMPLE_O_FILTERS.entries, EXPENSE_INCOME_RATIO, OCTOBER);

    expect(ratioOfScalar(result)).toEqual({
      numerator: "6",
      denominator: "5",
      scale: "percent-100",
    });
  });

  it("allows 0% when there is income but no expense (sample B)", () => {
    const result = assembleExpenseIncomeRatio(
      SAMPLE_B_INCOME_ONLY.entries,
      EXPENSE_INCOME_RATIO,
      OCTOBER,
    );

    expect(ratioOfScalar(result)).toEqual({
      numerator: "0",
      denominator: "1",
      scale: "percent-100",
    });
  });

  it("does not exist when income is zero (sample C)", () => {
    const result = assembleExpenseIncomeRatio(
      SAMPLE_C_EXPENSE_ONLY.entries,
      EXPENSE_INCOME_RATIO,
      OCTOBER,
    );

    expect(result.value).toBeNull();
    expect(result.computation.notes?.join("\n")).toContain("income = 0");
  });

  it("has no ratio for an empty book (sample A)", () => {
    const result = assembleExpenseIncomeRatio(
      SAMPLE_A_EMPTY_BOOK.entries,
      EXPENSE_INCOME_RATIO,
      OCTOBER,
    );

    expect(result.value).toBeNull();
    expect(result.completeness).toBe("no-transactions");
  });
});

describe("B19 ledger surplus ratio", () => {
  it("is negative when expense exceeds income (sample O, -20%)", () => {
    const result = assembleLedgerSurplusRatio(SAMPLE_O_FILTERS.entries, LEDGER_SURPLUS, OCTOBER);

    expect(ratioOfScalar(result)).toEqual({
      numerator: "-1",
      denominator: "5",
      scale: "percent-100",
    });
  });

  it("is exactly 100% when there is no expense (sample B)", () => {
    const result = assembleLedgerSurplusRatio(SAMPLE_B_INCOME_ONLY.entries, LEDGER_SURPLUS, OCTOBER);

    expect(ratioOfScalar(result)).toEqual({
      numerator: "1",
      denominator: "1",
      scale: "percent-100",
    });
  });

  it("does not exist when income is zero (sample C)", () => {
    const result = assembleLedgerSurplusRatio(
      SAMPLE_C_EXPENSE_ONLY.entries,
      LEDGER_SURPLUS,
      OCTOBER,
    );

    expect(result.value).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * B20 — the day with the most recorded transactions
 * ------------------------------------------------------------------ */

describe("B20 most recorded day", () => {
  it("picks the day with the most records and keeps the kind breakdown (sample C)", () => {
    const result = assembleMostRecordedDay(
      SAMPLE_C_EXPENSE_ONLY.entries,
      MOST_RECORDED_DAY,
      OCTOBER,
    );

    expect(result.extreme).toBeNull();
    expect(result.extremeValue).toEqual({ kind: "count", count: 2 });
    expect(result.occurredLocalDate).toBe("2026-10-02");
    expect(result.countBreakdown).toEqual({ total: 2, income: 0, expense: 2 });
    expect(result.tieCount).toBe(1);
  });

  it("counts income and expense records together (sample O, four tied days)", () => {
    const result = assembleMostRecordedDay(SAMPLE_O_FILTERS.entries, MOST_RECORDED_DAY, OCTOBER);

    expect(result.occurredLocalDate).toBe("2026-10-01");
    expect(result.countBreakdown).toEqual({ total: 1, income: 0, expense: 1 });
    expect(result.tieCount).toBe(4);
  });

  it("includes income-only days (sample B)", () => {
    const result = assembleMostRecordedDay(SAMPLE_B_INCOME_ONLY.entries, MOST_RECORDED_DAY, OCTOBER);

    expect(result.occurredLocalDate).toBe("2026-10-03");
    expect(result.countBreakdown).toEqual({ total: 1, income: 1, expense: 0 });
    expect(result.tieCount).toBe(2);
  });

  it("has no peak day for an empty book (sample A)", () => {
    const result = assembleMostRecordedDay(SAMPLE_A_EMPTY_BOOK.entries, MOST_RECORDED_DAY, OCTOBER);

    expect(result.extremeValue).toBeUndefined();
    expect(result.occurredLocalDate).toBeNull();
    expect(result.completeness).toBe("no-transactions");
  });

  it("renders nothing when permission is missing", () => {
    const blocked = workbench("2026-10-01", "2026-10-31", { completeness: "no-permission" });
    const result = assembleMostRecordedDay(SAMPLE_O_FILTERS.entries, MOST_RECORDED_DAY, blocked);

    expect(result.extremeValue).toBeUndefined();
    expect(result.completeness).toBe("no-permission");
  });
});
