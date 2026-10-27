import { describe, expect, it } from "vitest";

import {
  makeDefinition,
  makePeriod,
  type WorkbenchState,
} from "../context.js";
import {
  OTHER_GROUP_ID,
  OTHER_GROUP_LABEL,
  assembleCategoryCount,
  assembleCategoryFrequency,
  assembleExpenseCategoryComposition,
  assembleExpenseCategoryRanking,
  assembleIncomeCategoryComposition,
  assembleIncomeCategoryRanking,
  assembleMaxExpenseCategory,
  assemblePaymentMethodAnalysis,
} from "./category.js";
import {
  SAMPLE_A_EMPTY_BOOK,
  SAMPLE_B_INCOME_ONLY,
  SAMPLE_C_EXPENSE_ONLY,
  SAMPLE_D_EQUAL_AMOUNTS,
  SAMPLE_F_MANY_CATEGORIES,
  SAMPLE_O_FILTERS,
} from "../fixtures.js";
import type { AnalysisEntry } from "../primitives.js";
import type { CompositionResult, RankedGroupsResult } from "../types.js";

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

function definition(analysisId: string, metric: string) {
  return makeDefinition({
    analysisId,
    analysisType: "distribution",
    metric,
    time: { mode: "inherit" },
  });
}

const I01 = definition("AN-I01", "expense-category-share");
const I02 = definition("AN-I02", "income-category-share");
const I03 = definition("AN-I03", "expense-category-ranking");
const I04 = definition("AN-I04", "income-category-ranking");
const I05 = definition("AN-I05", "category-frequency");
const I17 = definition("AN-I17", "payment-method-share");
const B15 = definition("AN-B15", "max-expense-category");
const B16 = definition("AN-B16", "category-count");

function composition(result: CompositionResult | RankedGroupsResult): CompositionResult {
  if (result.shape !== "composition") throw new Error(`expected composition, got ${result.shape}`);

  return result;
}

function ranked(result: CompositionResult | RankedGroupsResult): RankedGroupsResult {
  if (result.shape !== "ranked-groups") throw new Error(`expected ranked groups, got ${result.shape}`);

  return result;
}

describe("I01 expense category composition", () => {
  it("returns exact parts, total and shares (sample C)", () => {
    const result = composition(
      assembleExpenseCategoryComposition(SAMPLE_C_EXPENSE_ONLY.entries, I01, OCTOBER),
    );

    expect(result.total).toEqual({ amountMinor: "2000", currency: "CNY", decimals: 2 });
    expect(result.parts.map((part) => [part.id, part.amount.amountMinor])).toEqual([
      ["cat-meal", "1200"],
      ["cat-transport", "600"],
      ["cat-fun", "200"],
    ]);
    expect(result.parts[0]?.share).toEqual({ numerator: 3n, denominator: 5n });
    expect(result.parts[1]?.share).toEqual({ numerator: 3n, denominator: 10n });
    expect(result.parts[2]?.share).toEqual({ numerator: 1n, denominator: 10n });
    expect(result.parts[0]?.count).toBe(1);
    expect(result.completeness).toBe("complete");
  });

  it("keeps an empty book as an explicit empty state (sample A)", () => {
    const result = composition(
      assembleExpenseCategoryComposition(SAMPLE_A_EMPTY_BOOK.entries, I01, OCTOBER),
    );

    expect(result.total).toBeNull();
    expect(result.parts).toEqual([]);
    expect(result.completeness).toBe("no-transactions");
  });

  it("folds the tail into 其他 while preserving the exact total (sample F)", () => {
    const result = composition(
      assembleExpenseCategoryComposition(SAMPLE_F_MANY_CATEGORIES.entries, I01, OCTOBER, {
        maxParts: 5,
      }),
    );

    expect(result.parts).toHaveLength(5);
    expect(result.parts[4]?.id).toBe(OTHER_GROUP_ID);
    expect(result.parts[4]?.label).toBe(OTHER_GROUP_LABEL);
    expect(result.parts[4]?.isFolded).toBe(true);
    expect(result.parts[4]?.amount.amountMinor).toBe("210000");
    expect(result.parts[4]?.count).toBe(20);
    expect(result.foldedGroupIds).toHaveLength(20);
    expect(result.total?.amountMinor).toBe("300000");

    const sum = result.parts.reduce((total, part) => total + BigInt(part.amount.amountMinor), 0n);

    expect(sum.toString()).toBe("300000");
  });

  it("refuses to claim a 100% total when the data is incomplete", () => {
    const result = composition(
      assembleExpenseCategoryComposition(
        SAMPLE_C_EXPENSE_ONLY.entries,
        I01,
        workbench("2026-10-01", "2026-10-31", { completeness: "fx-incomplete" }),
      ),
    );

    expect(result.total).toBeNull();
    expect(result.parts.every((part) => part.share === null)).toBe(true);
    expect(result.completeness).toBe("fx-incomplete");
  });

  it("returns null when blocked", () => {
    const result = composition(
      assembleExpenseCategoryComposition(
        SAMPLE_C_EXPENSE_ONLY.entries,
        I01,
        workbench("2026-10-01", "2026-10-31", { completeness: "no-permission" }),
      ),
    );

    expect(result.total).toBeNull();
    expect(result.parts).toEqual([]);
  });
});

describe("I02 income category composition", () => {
  it("reuses the I01 core for income (sample B)", () => {
    const result = composition(
      assembleIncomeCategoryComposition(SAMPLE_B_INCOME_ONLY.entries, I02, OCTOBER),
    );

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]?.id).toBe("cat-salary");
    expect(result.parts[0]?.amount.amountMinor).toBe("35050");
    expect(result.parts[0]?.share).toEqual({ numerator: 1n, denominator: 1n });
    expect(result.total?.amountMinor).toBe("35050");
  });

  it("is empty when the book has only expenses (sample C)", () => {
    const result = composition(
      assembleIncomeCategoryComposition(SAMPLE_C_EXPENSE_ONLY.entries, I02, OCTOBER),
    );

    expect(result.total).toBeNull();
    expect(result.parts).toEqual([]);
    expect(result.completeness).toBe("no-transactions");
  });
});

describe("I03 expense category ranking", () => {
  it("orders by amount descending and resolves ties by category id (sample D)", () => {
    const result = ranked(
      assembleExpenseCategoryRanking(SAMPLE_D_EQUAL_AMOUNTS.entries, I03, OCTOBER),
    );

    expect(result.groups.map((group) => group.id)).toEqual(["cat-a", "cat-b", "cat-c"]);
    expect(result.groups[0]?.share).toEqual({ numerator: 1n, denominator: 3n });
  });

  it("keeps the exact amount of the folded tail (sample C, topN 1)", () => {
    const result = ranked(
      assembleExpenseCategoryRanking(SAMPLE_C_EXPENSE_ONLY.entries, I03, OCTOBER, { topN: 1 }),
    );

    expect(result.groups).toHaveLength(2);
    expect(result.groups[1]?.id).toBe(OTHER_GROUP_ID);
    expect(result.groups[1]?.primary.kind).toBe("money");

    if (result.groups[1]?.primary.kind !== "money") throw new Error("expected money");

    expect(result.groups[1].primary.money.amountMinor).toBe("800");
    expect(result.foldedGroupIds).toEqual(["cat-transport", "cat-fun"]);
  });

  it("nulls shares when the data is not complete", () => {
    const result = ranked(
      assembleExpenseCategoryRanking(
        SAMPLE_C_EXPENSE_ONLY.entries,
        I03,
        workbench("2026-10-01", "2026-10-31", { completeness: "partial" }),
      ),
    );

    expect(result.groups.every((group) => group.share === null)).toBe(true);
  });
});

describe("I04 income category ranking", () => {
  it("ranks income categories (sample B)", () => {
    const result = ranked(
      assembleIncomeCategoryRanking(SAMPLE_B_INCOME_ONLY.entries, I04, OCTOBER),
    );

    expect(result.groups.map((group) => group.id)).toEqual(["cat-salary"]);
  });
});

describe("I05 category frequency", () => {
  it("ranks by count and keeps the amount as a secondary value (sample O)", () => {
    const result = ranked(assembleCategoryFrequency(SAMPLE_O_FILTERS.entries, I05, OCTOBER));

    expect(result.groups.map((group) => group.id)).toEqual(["cat-a", "cat-b"]);
    expect(result.groups[0]?.primary).toEqual({ kind: "count", count: 2 });
    expect(result.groups[0]?.share).toEqual({ numerator: 2n, denominator: 3n });
    expect(result.groups[0]?.secondary?.kind).toBe("money");

    if (result.groups[0]?.secondary?.kind !== "money") throw new Error("expected money");

    expect(result.groups[0].secondary.money.amountMinor).toBe("4000");
  });

  it("does not borrow the amount ranking of I03 (sample C: equal counts)", () => {
    const byCount = ranked(
      assembleCategoryFrequency(SAMPLE_C_EXPENSE_ONLY.entries, I05, OCTOBER),
    );

    // All three have count 1 → deterministic tie by category id, not amount.
    expect(byCount.groups.map((group) => group.id)).toEqual([
      "cat-fun",
      "cat-meal",
      "cat-transport",
    ]);
  });
});

describe("B15 max expense category", () => {
  it("returns the largest category and reports ties deterministically (sample D)", () => {
    const result = assembleMaxExpenseCategory(SAMPLE_D_EQUAL_AMOUNTS.entries, B15, OCTOBER);

    expect(result.shape).toBe("record-extreme");
    expect(result.categoryId).toBe("cat-a");
    expect(result.extreme?.amountMinor).toBe("5000");
    expect(result.tieCount).toBe(3);
  });

  it("is empty for an empty book (sample A)", () => {
    const result = assembleMaxExpenseCategory(SAMPLE_A_EMPTY_BOOK.entries, B15, OCTOBER);

    expect(result.extreme).toBeNull();
    expect(result.tieCount).toBe(0);
  });
});

describe("B16 category count", () => {
  it("counts distinct real categories (sample C)", () => {
    const result = assembleCategoryCount(SAMPLE_C_EXPENSE_ONLY.entries, B16, OCTOBER);

    if (result.value?.kind !== "count") throw new Error("expected count");

    expect(result.value.count).toBe(3);
    expect(result.computation.notes).toContain("realCategories=3");
    expect(result.computation.notes).toContain("uncategorised-absent");
  });

  it("excludes the system 暂无分类 bucket but reports its presence", () => {
    const entries: AnalysisEntry[] = [
      ...SAMPLE_C_EXPENSE_ONLY.entries,
      {
        id: "sys-1",
        kind: "expense",
        amountMinor: 100n,
        currency: "CNY",
        occurredLocalDate: "2026-10-04",
        categoryId: "cat-uncategorised",
        categoryName: "暂无分类",
        categoryIsSystem: true,
        paymentMethodId: null,
        paymentMethodName: null,
        deletedAt: null,
      },
    ];
    const result = assembleCategoryCount(entries, B16, OCTOBER);

    if (result.value?.kind !== "count") throw new Error("expected count");

    expect(result.value.count).toBe(3);
    expect(result.computation.notes).toContain("uncategorised-present");

    const including = assembleCategoryCount(entries, B16, OCTOBER, {
      includeSystemCategories: true,
    });

    if (including.value?.kind !== "count") throw new Error("expected count");

    expect(including.value.count).toBe(4);
  });

  it("counts both kinds when requested (sample O)", () => {
    const result = assembleCategoryCount(SAMPLE_O_FILTERS.entries, B16, OCTOBER, {
      kind: "both",
    });

    if (result.value?.kind !== "count") throw new Error("expected count");

    expect(result.value.count).toBe(3);
  });
});

describe("I17 payment method composition", () => {
  it("groups by payment method and never drops the unspecified bucket (sample C)", () => {
    const result = composition(
      assemblePaymentMethodAnalysis(SAMPLE_C_EXPENSE_ONLY.entries, I17, OCTOBER),
    );

    expect(result.total?.amountMinor).toBe("2000");
    expect(result.parts.map((part) => [part.id, part.amount.amountMinor])).toEqual([
      ["pm-wallet", "1200"],
      ["pm-card", "600"],
      ["__unspecified_payment_method__", "200"],
    ]);
    expect(result.parts[2]?.label).toBe("未指定");
  });

  it("keeps count as a separate metric (sample C)", () => {
    const result = ranked(
      assemblePaymentMethodAnalysis(SAMPLE_C_EXPENSE_ONLY.entries, I17, OCTOBER, {
        metric: "count",
      }),
    );

    expect(result.groups.every((group) => group.primary.kind === "count")).toBe(true);
    expect(result.groups.reduce((total, group) => total + (group.count ?? 0), 0)).toBe(3);
  });

  it("has no income composition in an expense-only book (sample C)", () => {
    const result = composition(
      assemblePaymentMethodAnalysis(SAMPLE_C_EXPENSE_ONLY.entries, I17, OCTOBER, {
        kind: "income",
      }),
    );

    expect(result.total).toBeNull();
    expect(result.parts).toEqual([]);
  });
});
