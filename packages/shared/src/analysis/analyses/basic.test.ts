import { describe, expect, it } from "vitest";

import {
  makeDefinition,
  makePeriod,
  type WorkbenchState,
} from "../context.js";
import {
  assembleAverageExpensePerTransaction,
  assembleDailyAverageExpense,
  assembleExpenseCount,
  assembleIncomeCount,
  assembleNetAmount,
  assembleTotalExpense,
  assembleTotalIncome,
} from "./basic.js";
import {
  SAMPLE_A_EMPTY_BOOK,
  SAMPLE_B_INCOME_ONLY,
  SAMPLE_C_EXPENSE_ONLY,
  SAMPLE_G_LARGE_INTEGERS,
  SAMPLE_H_ACROSS_MONTHS,
  SAMPLE_M_DELETED_AND_RESTORED,
  SAMPLE_N_PRECISION_EDGES,
} from "../fixtures.js";
import type { AnalysisDefinition, ScalarResult } from "../types.js";

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

const TOTAL_EXPENSE = definition("AN-B01", "expense-total");
const TOTAL_INCOME = definition("AN-B02", "income-total");
const NET_AMOUNT = definition("AN-B03", "net-amount");
const EXPENSE_COUNT = definition("AN-B04", "expense-count");
const INCOME_COUNT = definition("AN-B05", "income-count");
const DAILY_AVERAGE = definition("AN-B06", "expense-daily-average");
const PER_TRANSACTION = definition("AN-B07", "expense-average-per-transaction");

function moneyOf(result: ScalarResult): { amountMinor: string; currency: string; decimals: number } {
  if (result.value === null) throw new Error("expected a money scalar, got null");
  if (result.value.kind !== "money") throw new Error(`expected money, got ${result.value.kind}`);

  return result.value.money;
}

function countOf(result: ScalarResult): number {
  if (result.value === null) throw new Error("expected a count scalar, got null");
  if (result.value.kind !== "count") throw new Error(`expected count, got ${result.value.kind}`);

  return result.value.count;
}

describe("B01 total expense", () => {
  it("sums exactly the qualifying expense amounts (sample C)", () => {
    const result = assembleTotalExpense(SAMPLE_C_EXPENSE_ONLY.entries, TOTAL_EXPENSE, OCTOBER);

    expect(moneyOf(result)).toEqual({ amountMinor: "2000", currency: "CNY", decimals: 2 });
    expect(result.completeness).toBe("complete");
    expect(result.computation.sampleCount).toBe(3);
    expect(result.source.period).toEqual(OCTOBER.period);
  });

  it("includes only October records (sample H)", () => {
    const result = assembleTotalExpense(SAMPLE_H_ACROSS_MONTHS.entries, TOTAL_EXPENSE, OCTOBER);

    expect(moneyOf(result).amountMinor).toBe("600");
  });

  it("ignores soft-deleted records (sample M)", () => {
    const result = assembleTotalExpense(
      SAMPLE_M_DELETED_AND_RESTORED.entries,
      TOTAL_EXPENSE,
      OCTOBER,
    );

    expect(moneyOf(result).amountMinor).toBe("700");
    expect(result.computation.sampleCount).toBe(1);
  });

  it("keeps a large integer sum exact (sample G, above 2^53)", () => {
    const result = assembleTotalExpense(SAMPLE_G_LARGE_INTEGERS.entries, TOTAL_EXPENSE, OCTOBER);

    expect(moneyOf(result).amountMinor).toBe("9007199254740997");
  });

  it("reports a real zero with no-transactions for an empty book (sample A)", () => {
    const result = assembleTotalExpense(SAMPLE_A_EMPTY_BOOK.entries, TOTAL_EXPENSE, OCTOBER);

    expect(moneyOf(result).amountMinor).toBe("0");
    expect(result.completeness).toBe("no-transactions");
    expect(result.computation.sampleCount).toBe(0);
  });

  it("returns null when the data layer blocks numbers", () => {
    const result = assembleTotalExpense(
      SAMPLE_C_EXPENSE_ONLY.entries,
      TOTAL_EXPENSE,
      workbench("2026-10-01", "2026-10-31", { completeness: "no-permission" }),
    );

    expect(result.value).toBeNull();
    expect(result.completeness).toBe("no-permission");
  });
});

describe("B02 total income", () => {
  it("sums only income (sample B)", () => {
    const result = assembleTotalIncome(SAMPLE_B_INCOME_ONLY.entries, TOTAL_INCOME, OCTOBER);

    expect(moneyOf(result).amountMinor).toBe("35050");
    expect(result.computation.sampleCount).toBe(2);
  });

  it("does not mistake an expense-only book for zero income as an error", () => {
    const result = assembleTotalIncome(SAMPLE_C_EXPENSE_ONLY.entries, TOTAL_INCOME, OCTOBER);

    expect(moneyOf(result).amountMinor).toBe("0");
    expect(result.completeness).toBe("no-transactions");
  });
});

describe("B03 net amount", () => {
  it("is income minus expense, positive (sample B)", () => {
    const result = assembleNetAmount(SAMPLE_B_INCOME_ONLY.entries, NET_AMOUNT, OCTOBER);

    expect(moneyOf(result).amountMinor).toBe("35050");
    expect(result.computation.notes).toContain("expenseMinor=0");
    expect(result.computation.notes).toContain("incomeMinor=35050");
  });

  it("keeps a negative difference negative (sample C)", () => {
    const result = assembleNetAmount(SAMPLE_C_EXPENSE_ONLY.entries, NET_AMOUNT, OCTOBER);

    expect(moneyOf(result).amountMinor).toBe("-2000");
    expect(result.computation.sampleCount).toBe(3);
  });

  it("is a real zero when both sides are zero (sample A)", () => {
    const result = assembleNetAmount(SAMPLE_A_EMPTY_BOOK.entries, NET_AMOUNT, OCTOBER);

    expect(moneyOf(result).amountMinor).toBe("0");
  });

  it("never derives the difference from a display percentage", () => {
    const result = assembleNetAmount(SAMPLE_N_PRECISION_EDGES.entries, NET_AMOUNT, OCTOBER);

    expect(moneyOf(result).amountMinor).toBe("-4010");
  });
});

describe("B04/B05 transaction counts", () => {
  it("counts expense records, not category groups (sample C)", () => {
    const result = assembleExpenseCount(SAMPLE_C_EXPENSE_ONLY.entries, EXPENSE_COUNT, OCTOBER);

    expect(countOf(result)).toBe(3);
    expect(result.computation.sampleCount).toBe(3);
  });

  it("counts income records (sample B)", () => {
    const result = assembleIncomeCount(SAMPLE_B_INCOME_ONLY.entries, INCOME_COUNT, OCTOBER);

    expect(countOf(result)).toBe(2);
  });

  it("returns zero for the absent side without failing (sample B)", () => {
    const result = assembleExpenseCount(SAMPLE_B_INCOME_ONLY.entries, EXPENSE_COUNT, OCTOBER);

    expect(countOf(result)).toBe(0);
    expect(result.completeness).toBe("no-transactions");
  });
});

describe("B06 daily expense average", () => {
  it("divides by calendar days of the resolved period, not active days (sample C)", () => {
    const result = assembleDailyAverageExpense(
      SAMPLE_C_EXPENSE_ONLY.entries,
      DAILY_AVERAGE,
      OCTOBER,
    );

    expect(result.computation.denominatorDays).toBe(31);
    expect(result.computation.numeratorMinor).toBe("2000");
    expect(result.value?.kind).toBe("exact-money");

    if (result.value?.kind !== "exact-money") throw new Error("expected exact money");

    expect(result.value.numeratorMinor).toBe("2000");
    expect(result.value.denominator).toBe("31");
    expect(result.value.currency).toBe("CNY");
    expect(result.value.decimals).toBe(2);
  });

  it("keeps a non-dividing quotient exact (sample N: 4010 / 31)", () => {
    const result = assembleDailyAverageExpense(
      SAMPLE_N_PRECISION_EDGES.entries,
      DAILY_AVERAGE,
      OCTOBER,
    );

    if (result.value?.kind !== "exact-money") throw new Error("expected exact money");

    expect(result.value.numeratorMinor).toBe("4010");
    expect(result.value.denominator).toBe("31");
  });

  it("uses the resolved fixed period as the denominator", () => {
    const fixed = makeDefinition({
      analysisId: "AN-B06",
      analysisType: "scalar",
      metric: "expense-daily-average",
      time: { mode: "fixed", from: "2026-10-01", to: "2026-10-10" },
    });
    const result = assembleDailyAverageExpense(SAMPLE_C_EXPENSE_ONLY.entries, fixed, OCTOBER);

    expect(result.computation.denominatorDays).toBe(10);
    expect(result.resolvedPeriod).toEqual({ from: "2026-10-01", to: "2026-10-10", dayCount: 10 });
  });

  it("returns a real zero for an empty book, not null", () => {
    const result = assembleDailyAverageExpense(SAMPLE_A_EMPTY_BOOK.entries, DAILY_AVERAGE, OCTOBER);

    if (result.value?.kind !== "exact-money") throw new Error("expected exact money");

    expect(result.value.numeratorMinor).toBe("0");
    // The exact fraction is reduced; the intended denominator stays in metadata.
    expect(result.value.denominator).toBe("1");
    expect(result.computation.denominatorDays).toBe(31);
  });
});

describe("B07 average expense per transaction", () => {
  it("divides by expense record count (sample C: 2000 / 3)", () => {
    const result = assembleAverageExpensePerTransaction(
      SAMPLE_C_EXPENSE_ONLY.entries,
      PER_TRANSACTION,
      OCTOBER,
    );

    if (result.value?.kind !== "exact-money") throw new Error("expected exact money");

    expect(result.value.numeratorMinor).toBe("2000");
    expect(result.value.denominator).toBe("3");
    expect(result.computation.denominator).toBe(3);
  });

  it("has no average when there are no expense records (sample B)", () => {
    const result = assembleAverageExpensePerTransaction(
      SAMPLE_B_INCOME_ONLY.entries,
      PER_TRANSACTION,
      OCTOBER,
    );

    expect(result.value).toBeNull();
    expect(result.completeness).toBe("no-transactions");
    expect(result.computation.denominator).toBe(0);
  });

  it("has no average for an empty book (sample A)", () => {
    const result = assembleAverageExpensePerTransaction(
      SAMPLE_A_EMPTY_BOOK.entries,
      PER_TRANSACTION,
      OCTOBER,
    );

    expect(result.value).toBeNull();
    expect(result.completeness).toBe("no-transactions");
  });
});
