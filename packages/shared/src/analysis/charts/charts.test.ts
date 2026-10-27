import { describe, expect, it } from "vitest";

import {
  makeDefinition,
  makePeriod,
  type WorkbenchState,
} from "../context.js";
import {
  assembleNetAmount,
  assembleTotalExpense,
} from "../analyses/basic.js";
import {
  assembleAverageExpensePerTransaction,
  assembleDailyAverageExpense,
} from "../analyses/basic.js";
import {
  assembleCategoryFrequency,
  assembleExpenseCategoryComposition,
  assembleExpenseCategoryRanking,
} from "../analyses/category.js";
import {
  SAMPLE_A_EMPTY_BOOK,
  SAMPLE_B_INCOME_ONLY,
  SAMPLE_C_EXPENSE_ONLY,
  SAMPLE_F_MANY_CATEGORIES,
  SAMPLE_O_FILTERS,
} from "../fixtures.js";
import type { AnalysisDefinition } from "../types.js";
import { compositionChartInput } from "./composition.js";
import {
  CARD_DENSITY_THRESHOLDS,
  chooseCardDensity,
  numericCardInput,
  scalarText,
} from "./numericCard.js";
import { rankingChartInput } from "./ranking.js";

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
const NET_AMOUNT = definition("AN-B03", "net-amount");
const DAILY_AVERAGE = definition("AN-B06", "expense-daily-average");
const PER_TRANSACTION = definition("AN-B07", "expense-average-per-transaction");
const I01 = definition("AN-I01", "expense-category-share");
const I03 = definition("AN-I03", "expense-category-ranking");
const I05 = definition("AN-I05", "category-frequency");

describe("chooseCardDensity", () => {
  it("uses the real size, not a grid preset", () => {
    expect(chooseCardDensity({ width: 100, height: 80 })).toBe("compact");
    expect(chooseCardDensity({ width: 240, height: 140 })).toBe("medium");
    expect(chooseCardDensity({ width: 480, height: 320 })).toBe("expanded");
  });

  it("treats the thresholds themselves as the next density", () => {
    expect(
      chooseCardDensity({
        width: CARD_DENSITY_THRESHOLDS.medium.minWidth,
        height: CARD_DENSITY_THRESHOLDS.medium.minHeight,
      }),
    ).toBe("medium");
    expect(
      chooseCardDensity({
        width: CARD_DENSITY_THRESHOLDS.expanded.minWidth,
        height: CARD_DENSITY_THRESHOLDS.expanded.minHeight,
      }),
    ).toBe("expanded");
  });

  it("rejects a non-positive size", () => {
    expect(() => chooseCardDensity({ width: 0, height: 100 })).toThrow(/card_size/);
  });
});

describe("scalarText", () => {
  it("renders exact money with the currency scale", () => {
    expect(scalarText({ kind: "money", money: { amountMinor: "2000", currency: "CNY", decimals: 2 } })).toEqual({
      text: "20.00",
      unit: "currency",
      currency: "CNY",
      sign: "positive",
      ratio: null,
    });
  });

  it("keeps the sign of a negative net amount", () => {
    expect(
      scalarText({ kind: "money", money: { amountMinor: "-2000", currency: "CNY", decimals: 2 } }),
    ).toMatchObject({ text: "-20.00", sign: "negative" });
  });

  it("rounds an exact average once, half away from zero", () => {
    // 2000 / 31 = 64.516… minor units → 65 → "0.65"
    expect(
      scalarText({
        kind: "exact-money",
        numeratorMinor: "2000",
        denominator: "31",
        currency: "CNY",
        decimals: 2,
      }),
    ).toMatchObject({ text: "0.65", unit: "currency", sign: "positive" });

    // 5 / 8 = 0.625 minor units → 1 → "0.01"
    expect(
      scalarText({
        kind: "exact-money",
        numeratorMinor: "5",
        denominator: "8",
        currency: "CNY",
        decimals: 2,
      }),
    ).toMatchObject({ text: "0.01" });
  });

  it("renders counts and percent ratios", () => {
    expect(scalarText({ kind: "count", count: 3 })).toMatchObject({
      text: "3",
      unit: "count",
      sign: "positive",
    });
    expect(
      scalarText({ kind: "ratio", ratio: { numerator: 3n, denominator: 5n }, scale: "percent-100" }),
    ).toMatchObject({ text: "60.0%", unit: "percent" });
  });

  it("renders 'cannot be determined' as null, never zero", () => {
    expect(scalarText(null)).toEqual({
      text: null,
      unit: null,
      currency: null,
      sign: "unknown",
      ratio: null,
    });
  });
});

describe("numeric card input (CF-A01)", () => {
  const result = assembleTotalExpense(SAMPLE_C_EXPENSE_ONLY.entries, TOTAL_EXPENSE, OCTOBER);

  it("shows only the core value in compact density", () => {
    const input = numericCardInput(result, { title: "总支出", size: { width: 120, height: 90 } });

    expect(input.density).toBe("compact");
    expect(input.valueText).toBe("20.00");
    expect(input.unit).toBe("currency");
    expect(input.currency).toBe("CNY");
    expect(input.auxiliary).toEqual([]);
    expect(input.completeness).toBe("complete");
    expect(input.source.analysisId).toBe("AN-B01");
  });

  it("adds one auxiliary value in medium density", () => {
    const input = numericCardInput(result, { title: "总支出", size: { width: 240, height: 140 } });

    expect(input.density).toBe("medium");
    expect(input.auxiliary).toEqual([{ id: "count", valueText: "3" }]);
  });

  it("adds the full auxiliary list in expanded density", () => {
    const input = numericCardInput(result, { title: "总支出", size: { width: 480, height: 320 } });

    expect(input.density).toBe("expanded");
    expect(input.auxiliary.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the authoritative value identical across densities", () => {
    const values = [
      { width: 120, height: 90 },
      { width: 240, height: 140 },
      { width: 480, height: 320 },
    ].map((size) => numericCardInput(result, { title: "总支出", size }).valueText);

    expect(new Set(values)).toEqual(new Set(["20.00"]));
  });

  it("keeps a negative net amount negative", () => {
    const net = assembleNetAmount(SAMPLE_C_EXPENSE_ONLY.entries, NET_AMOUNT, OCTOBER);
    const input = numericCardInput(net, { title: "账目收支差额", size: { width: 120, height: 90 } });

    expect(input.valueText).toBe("-20.00");
    expect(input.sign).toBe("negative");
  });

  it("shows null, not zero, when an average does not exist", () => {
    const average = assembleAverageExpensePerTransaction(
      SAMPLE_B_INCOME_ONLY.entries,
      PER_TRANSACTION,
      OCTOBER,
    );
    const input = numericCardInput(average, { title: "单笔平均支出", size: { width: 120, height: 90 } });

    expect(input.valueText).toBeNull();
    expect(input.sign).toBe("unknown");
  });

  it("labels a daily average from its exact fraction", () => {
    const daily = assembleDailyAverageExpense(
      SAMPLE_C_EXPENSE_ONLY.entries,
      DAILY_AVERAGE,
      OCTOBER,
    );
    const input = numericCardInput(daily, { title: "日均支出", size: { width: 480, height: 320 } });

    expect(input.valueText).toBe("0.65");
    expect(input.auxiliary).toContainEqual({ id: "days", valueText: "31" });
  });
});

describe("composition chart input", () => {
  it("passes exact amounts and drawing-only fractions (sample C)", () => {
    const result = assembleExpenseCategoryComposition(SAMPLE_C_EXPENSE_ONLY.entries, I01, OCTOBER);
    const input = compositionChartInput(result);

    expect(input.kind).toBe("composition-chart");
    expect(input.totalMinor).toBe("2000");
    expect(input.totalText).toBe("20.00");
    expect(input.drawable).toBe(true);
    expect(input.segments).toHaveLength(3);
    expect(input.segments[0]).toMatchObject({
      id: "cat-meal",
      amountMinor: "1200",
      amountText: "12.00",
      shareText: "60.0%",
      isFolded: false,
    });
    expect(input.segments[0]?.fractionOfTotal).toBeCloseTo(0.6, 10);
    expect(input.segments[1]?.fractionOfTotal).toBeCloseTo(0.3, 10);
    expect(input.segments[2]?.fractionOfTotal).toBeCloseTo(0.1, 10);
  });

  it("is not drawable when there is nothing to compose (sample A)", () => {
    const result = assembleExpenseCategoryComposition(SAMPLE_A_EMPTY_BOOK.entries, I01, OCTOBER);
    const input = compositionChartInput(result);

    expect(input.drawable).toBe(false);
    expect(input.totalMinor).toBeNull();
    expect(input.segments).toEqual([]);
  });

  it("is not drawable when the data is incomplete", () => {
    const result = assembleExpenseCategoryComposition(
      SAMPLE_C_EXPENSE_ONLY.entries,
      I01,
      workbench("2026-10-01", "2026-10-31", { completeness: "fx-incomplete" }),
    );
    const input = compositionChartInput(result);

    expect(input.drawable).toBe(false);
    expect(input.segments.every((segment) => segment.fractionOfTotal === null)).toBe(true);
    expect(input.segments.every((segment) => segment.shareText === null)).toBe(true);
  });

  it("marks the folded 其他 segment as display-only (sample F)", () => {
    const result = assembleExpenseCategoryComposition(
      SAMPLE_F_MANY_CATEGORIES.entries,
      I01,
      OCTOBER,
      { maxParts: 5 },
    );
    const input = compositionChartInput(result);

    expect(input.segments).toHaveLength(5);
    expect(input.segments[4]).toMatchObject({
      id: "__other__",
      isFolded: true,
      amountText: "2100.00",
    });
    expect(input.segments[4]?.fractionOfTotal).toBeCloseTo(0.7, 10);
  });
});

describe("ranking chart input", () => {
  it("passes exact ranks and drawing fractions (sample C)", () => {
    const result = assembleExpenseCategoryRanking(SAMPLE_C_EXPENSE_ONLY.entries, I03, OCTOBER);
    const input = rankingChartInput(result);

    expect(input.kind).toBe("ranking-chart");
    expect(input.primaryKind).toBe("money");
    expect(input.maxValue).toBe("1200");
    expect(input.items.map((item) => [item.rank, item.primaryText])).toEqual([
      [1, "12.00"],
      [2, "6.00"],
      [3, "2.00"],
    ]);
    expect(input.items[0]?.fractionOfMax).toBeCloseTo(1, 10);
    expect(input.items[1]?.fractionOfMax).toBeCloseTo(0.5, 10);
    expect(input.items[2]?.fractionOfMax).toBeCloseTo(1 / 6, 10);
  });

  it("keeps a count ranking identifiable as a count ranking (sample O)", () => {
    const result = assembleCategoryFrequency(SAMPLE_O_FILTERS.entries, I05, OCTOBER);
    const input = rankingChartInput(result);

    expect(input.primaryKind).toBe("count");
    expect(input.maxValue).toBe("2");
    expect(input.items[0]?.primaryText).toBe("2");
    expect(input.items[0]?.secondaryText).toBe("40.00");
    expect(input.items[0]?.fractionOfMax).toBeCloseTo(1, 10);
    expect(input.items[1]?.fractionOfMax).toBeCloseTo(0.5, 10);
  });

  it("is empty for an empty book (sample A)", () => {
    const result = assembleExpenseCategoryRanking(SAMPLE_A_EMPTY_BOOK.entries, I03, OCTOBER);
    const input = rankingChartInput(result);

    expect(input.items).toEqual([]);
    expect(input.maxValue).toBeNull();
  });

  it("keeps the folded tail visible with its exact amount (sample C, topN 1)", () => {
    const result = assembleExpenseCategoryRanking(SAMPLE_C_EXPENSE_ONLY.entries, I03, OCTOBER, {
      topN: 1,
    });
    const input = rankingChartInput(result);

    expect(input.items).toHaveLength(2);
    expect(input.items[1]).toMatchObject({
      id: "__other__",
      isFolded: true,
      primaryText: "8.00",
    });
    expect(input.items[1]?.fractionOfMax).toBeCloseTo(2 / 3, 10);
  });
});
