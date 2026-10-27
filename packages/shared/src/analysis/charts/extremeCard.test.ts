import { describe, expect, it } from "vitest";

import { makeDefinition, makePeriod, type WorkbenchState } from "../context.js";
import {
  assembleMaxExpenseTransaction,
  assembleMostRecordedDay,
} from "../analyses/statistics.js";
import { extremeCardInput } from "./extremeCard.js";
import { chooseCardDensity } from "./numericCard.js";
import {
  SAMPLE_A_EMPTY_BOOK,
  SAMPLE_C_EXPENSE_ONLY,
  SAMPLE_D_EQUAL_AMOUNTS,
} from "../fixtures.js";
import type { AnalysisDefinition } from "../types.js";

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
    analysisType: "record-extreme",
    metric,
    time: { mode: "inherit" },
  });
}

const LARGEST_EXPENSE = definition("AN-B09", "expense-largest-record");
const MOST_RECORDED_DAY = definition("AN-B20", "most-recorded-day");

const COMPACT = { width: 100, height: 80 };
const MEDIUM = { width: 240, height: 140 };
const EXPANDED = { width: 480, height: 320 };

describe("CF-A02 extreme card density", () => {
  it("shows the core value and the business date at compact size", () => {
    const result = assembleMaxExpenseTransaction(
      SAMPLE_C_EXPENSE_ONLY.entries,
      LARGEST_EXPENSE,
      OCTOBER,
    );
    const card = extremeCardInput(result, { title: "最大单笔支出", size: COMPACT });

    expect(card.kind).toBe("extreme-card");
    expect(card.density).toBe("compact");
    expect(card.valueText).toBe("12.00");
    expect(card.unit).toBe("currency");
    expect(card.currency).toBe("CNY");
    expect(card.sign).toBe("positive");
    expect(card.occurredLocalDate).toBe("2026-10-01");
    expect(card.auxiliary).toEqual([{ id: "date", valueText: "2026-10-01" }]);
    expect(card.source.transactionIds).toEqual(["c-meal"]);
  });

  it("adds the tie count at medium size (sample D)", () => {
    const result = assembleMaxExpenseTransaction(
      SAMPLE_D_EQUAL_AMOUNTS.entries,
      LARGEST_EXPENSE,
      OCTOBER,
    );
    const card = extremeCardInput(result, { title: "最大单笔支出", size: MEDIUM });

    expect(card.density).toBe("medium");
    expect(card.auxiliary).toEqual([
      { id: "date", valueText: "2026-10-05" },
      { id: "tie", valueText: "3" },
    ]);
  });

  it("adds labels and the record breakdown at expanded size (sample C)", () => {
    const result = assembleMaxExpenseTransaction(
      SAMPLE_C_EXPENSE_ONLY.entries,
      LARGEST_EXPENSE,
      OCTOBER,
    );
    const card = extremeCardInput(result, { title: "最大单笔支出", size: EXPANDED });

    expect(card.density).toBe("expanded");
    expect(card.auxiliary).toEqual([
      { id: "date", valueText: "2026-10-01" },
      { id: "category", valueText: "餐饮" },
    ]);
    expect(card.categoryLabel).toBe("餐饮");
    expect(card.paymentMethodLabel).toBe("钱包");
  });

  it("never changes the authoritative value with the size", () => {
    const result = assembleMaxExpenseTransaction(
      SAMPLE_C_EXPENSE_ONLY.entries,
      LARGEST_EXPENSE,
      OCTOBER,
    );
    const compact = extremeCardInput(result, { title: "最大单笔支出", size: COMPACT });
    const expanded = extremeCardInput(result, { title: "最大单笔支出", size: EXPANDED });

    expect(expanded.valueText).toBe(compact.valueText);
    expect(expanded.source).toEqual(compact.source);
  });
});

describe("CF-A02 extreme card values", () => {
  it("renders a record-count extreme as a count, never as money (B20)", () => {
    const result = assembleMostRecordedDay(
      SAMPLE_C_EXPENSE_ONLY.entries,
      MOST_RECORDED_DAY,
      OCTOBER,
    );
    const card = extremeCardInput(result, { title: "交易记录最多的一天", size: EXPANDED });

    expect(card.valueText).toBe("2");
    expect(card.unit).toBe("count");
    expect(card.currency).toBeNull();
    expect(card.countBreakdown).toEqual({ total: 2, income: 0, expense: 2 });
    expect(card.auxiliary).toEqual([
      { id: "date", valueText: "2026-10-02" },
      { id: "income-count", valueText: "0" },
      { id: "expense-count", valueText: "2" },
    ]);
  });

  it("shows no value when nothing can be determined (sample A)", () => {
    const result = assembleMaxExpenseTransaction(
      SAMPLE_A_EMPTY_BOOK.entries,
      LARGEST_EXPENSE,
      OCTOBER,
    );
    const card = extremeCardInput(result, { title: "最大单笔支出", size: COMPACT });

    expect(card.valueText).toBeNull();
    expect(card.unit).toBeNull();
    expect(card.sign).toBe("unknown");
    expect(card.auxiliary).toEqual([]);
    expect(card.completeness).toBe("no-transactions");
  });

  it("keeps a blocked state visible instead of rendering zero", () => {
    const blocked = workbench("2026-10-01", "2026-10-31", { completeness: "no-permission" });
    const result = assembleMaxExpenseTransaction(
      SAMPLE_C_EXPENSE_ONLY.entries,
      LARGEST_EXPENSE,
      blocked,
    );
    const card = extremeCardInput(result, { title: "最大单笔支出", size: EXPANDED });

    expect(card.valueText).toBeNull();
    expect(card.completeness).toBe("no-permission");
  });

  it("keeps compact below the medium density threshold", () => {
    expect(chooseCardDensity(COMPACT)).toBe("compact");
  });
});
