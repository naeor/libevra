import { describe, expect, it } from "vitest";

import {
  ANALYSIS_SAMPLES,
  SAMPLE_A_EMPTY_BOOK,
  SAMPLE_B_INCOME_ONLY,
  SAMPLE_C_EXPENSE_ONLY,
  SAMPLE_D_EQUAL_AMOUNTS,
  SAMPLE_F_MANY_CATEGORIES,
  SAMPLE_G_LARGE_INTEGERS,
  SAMPLE_H_ACROSS_MONTHS,
  SAMPLE_I_MULTI_CURRENCY,
  SAMPLE_L_OFFLINE_INCOMPLETE,
  SAMPLE_M_DELETED_AND_RESTORED,
  SAMPLE_N_PRECISION_EDGES,
  SAMPLE_O_FILTERS,
} from "./fixtures.js";
import {
  assertSingleCurrency,
  averageMinor,
  categoryTotals,
  countByKind,
  dayTotals,
  daysWithoutRecords,
  distinctRecordedDays,
  entriesInRange,
  extremeRecord,
  foldRemainder,
  formatMoneyForDisplay,
  isLive,
  liveEntries,
  medianMinor,
  paymentMethodTotals,
  peakDay,
  peakRecordedDay,
  sumByKind,
  sumMinorExact,
  toMoneyValue,
  totalsOf,
  type AnalysisEntry,
  type CategoryAmount,
} from "./primitives.js";

/** Folding only needs an id and an amount; category groups expose `categoryId`. */
function foldable(groups: readonly CategoryAmount[]): Array<{ id: string; amountMinor: bigint }> {
  return groups.map((group) => ({ id: group.categoryId, amountMinor: group.amountMinor }));
}

function ratioParts(value: { numerator: bigint; denominator: bigint } | null): [string, string] {
  if (value === null) throw new Error("expected_ratio");
  return [value.numerator.toString(), value.denominator.toString()];
}

describe("sample fixture contract", () => {
  it("exposes all fifteen specification samples", () => {
    expect(ANALYSIS_SAMPLES).toHaveLength(15);
    expect(ANALYSIS_SAMPLES.map((sample) => sample.letter)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
    ]);
  });

  it("visits every sample range with entries inside it", () => {
    for (const sample of ANALYSIS_SAMPLES) {
      for (const entry of sample.entries) {
        if (sample.letter === "H" || sample.letter === "O") continue;
        expect(entry.occurredLocalDate >= sample.range.from).toBe(true);
        expect(entry.occurredLocalDate <= sample.range.to).toBe(true);
      }
    }
  });
});

describe("isLive / liveEntries", () => {
  it("excludes soft-deleted records", () => {
    const live = liveEntries(SAMPLE_M_DELETED_AND_RESTORED.entries);

    expect(live.map((entry) => entry.id)).toEqual(["m-live"]);
    expect(isLive(SAMPLE_M_DELETED_AND_RESTORED.entries[1] as AnalysisEntry)).toBe(false);
  });
});

describe("entriesInRange", () => {
  it("includes both ends of the period and nothing around it", () => {
    const inside = entriesInRange(
      SAMPLE_H_ACROSS_MONTHS.entries,
      SAMPLE_H_ACROSS_MONTHS.range.from,
      SAMPLE_H_ACROSS_MONTHS.range.to,
    );

    expect(inside.map((entry) => entry.id)).toEqual(["h-oct-01", "h-oct-15", "h-oct-31"]);
    expect(sumMinorExact(inside.map((entry) => entry.amountMinor))).toBe(600n);
  });
});

describe("assertSingleCurrency", () => {
  it("returns null for an empty set", () => {
    expect(assertSingleCurrency([])).toBeNull();
  });

  it("returns the single currency", () => {
    expect(assertSingleCurrency(SAMPLE_C_EXPENSE_ONLY.entries)).toBe("CNY");
  });

  it("refuses to mix currencies", () => {
    expect(() => assertSingleCurrency(SAMPLE_I_MULTI_CURRENCY.entries)).toThrow(/mixed_currency/);
  });
});

describe("totalsOf / sumByKind / countByKind", () => {
  it("sums expense-only sample exactly", () => {
    const totals = totalsOf(SAMPLE_C_EXPENSE_ONLY.entries);

    expect(totals.expenseMinor).toBe(2_000n);
    expect(totals.incomeMinor).toBe(0n);
    expect(totals.netMinor).toBe(-2_000n);
    expect(totals.expenseCount).toBe(3);
    expect(totals.incomeCount).toBe(0);
    expect(totals.count).toBe(3);
  });

  it("keeps income and expense apart in the income-only sample", () => {
    const totals = totalsOf(SAMPLE_B_INCOME_ONLY.entries);

    expect(totals.incomeMinor).toBe(35_050n);
    expect(totals.expenseMinor).toBe(0n);
    expect(totals.netMinor).toBe(35_050n);
    expect(totals.incomeCount).toBe(2);
  });

  it("returns real zeros for the empty book", () => {
    const totals = totalsOf(SAMPLE_A_EMPTY_BOOK.entries);

    expect(totals.expenseMinor).toBe(0n);
    expect(totals.incomeMinor).toBe(0n);
    expect(totals.netMinor).toBe(0n);
    expect(totals.count).toBe(0);
  });

  it("sums one kind only", () => {
    expect(sumByKind(SAMPLE_O_FILTERS.entries, "expense")).toBe(6_000n);
    expect(sumByKind(SAMPLE_O_FILTERS.entries, "income")).toBe(5_000n);
    expect(countByKind(SAMPLE_O_FILTERS.entries, "income")).toBe(1);
  });

  it("stays exact above Number.MAX_SAFE_INTEGER", () => {
    const totals = totalsOf(SAMPLE_G_LARGE_INTEGERS.entries);

    expect(totals.expenseMinor).toBe(9_007_199_254_740_997n);
    expect(totals.expenseMinor).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  });
});

describe("averageMinor", () => {
  it("returns an exact fraction that does not divide evenly", () => {
    const average = averageMinor(1_000n, 3);

    expect(ratioParts(average)).toEqual(["1000", "3"]);
  });

  it("returns null when there is nothing to divide by", () => {
    expect(averageMinor(0n, 0)).toBeNull();
  });

  it("rejects an invalid count", () => {
    expect(() => averageMinor(1n, -1)).toThrow(RangeError);
    expect(() => averageMinor(1n, 1.5)).toThrow(RangeError);
  });

  it("computes B06-style daily average over calendar days", () => {
    const total = totalsOf(SAMPLE_C_EXPENSE_ONLY.entries).expenseMinor;
    const daily = averageMinor(total, 10);

    expect(ratioParts(daily)).toEqual(["200", "1"]);
  });
});

describe("medianMinor", () => {
  it("returns null for an empty sample", () => {
    expect(medianMinor([])).toBeNull();
  });

  it("takes the middle value of an odd sample", () => {
    expect(ratioParts(medianMinor([30n, 10n, 20n]))).toEqual(["20", "1"]);
  });

  it("averages the two middle values of an even sample", () => {
    expect(ratioParts(medianMinor([10n, 20n, 30n, 40n]))).toEqual(["25", "1"]);
  });

  it("can land on half a minor unit", () => {
    expect(ratioParts(medianMinor([1n, 2n]))).toEqual(["3", "2"]);
  });

  it("sorts bigint amounts exactly", () => {
    const median = medianMinor([9_007_199_254_740_993n, 1n, 3n]);

    expect(ratioParts(median)).toEqual(["3", "1"]);
  });

  it("matches sample N's precision edges", () => {
    const amounts = SAMPLE_N_PRECISION_EDGES.entries.map((entry) => entry.amountMinor);
    const median = medianMinor(amounts);

    expect(ratioParts(median)).toEqual(["2005", "2"]);
    expect(formatMoneyForDisplay(2_005n, "CNY")).toBe("20.05");
  });
});

describe("distinctRecordedDays / daysWithoutRecords", () => {
  it("counts distinct business dates once", () => {
    expect(distinctRecordedDays(SAMPLE_C_EXPENSE_ONLY.entries)).toBe(2);
    expect(distinctRecordedDays(SAMPLE_A_EMPTY_BOOK.entries)).toBe(0);
  });

  it("does not count soft-deleted records", () => {
    expect(distinctRecordedDays(SAMPLE_M_DELETED_AND_RESTORED.entries)).toBe(1);
  });

  it("returns calendar days without records inside the period", () => {
    expect(
      daysWithoutRecords(
        SAMPLE_L_OFFLINE_INCOMPLETE.entries,
        SAMPLE_L_OFFLINE_INCOMPLETE.range.from,
        SAMPLE_L_OFFLINE_INCOMPLETE.range.to,
      ),
    ).toBe(27);
  });

  it("never goes negative when records fall outside the period", () => {
    expect(daysWithoutRecords(SAMPLE_H_ACROSS_MONTHS.entries, "2026-10-15", "2026-10-16")).toBe(1);
  });
});

describe("categoryTotals", () => {
  it("aggregates expenses and orders by amount then category id", () => {
    const groups = categoryTotals(SAMPLE_C_EXPENSE_ONLY.entries, "expense");

    expect(groups.map((group) => [group.categoryName, group.amountMinor.toString(), group.count])).toEqual([
      ["餐饮", "1200", 1],
      ["交通", "600", 1],
      ["娱乐", "200", 1],
    ]);
    expect(sumMinorExact(groups.map((group) => group.amountMinor))).toBe(2_000n);
  });

  it("breaks amount ties deterministically by category id", () => {
    const groups = categoryTotals(SAMPLE_D_EQUAL_AMOUNTS.entries, "expense");

    expect(groups.map((group) => group.categoryId)).toEqual(["cat-a", "cat-b", "cat-c"]);
  });

  it("keeps the system category as a real group and marks it", () => {
    const entries: readonly AnalysisEntry[] = [
      {
        id: "sys-1",
        kind: "expense",
        amountMinor: 500n,
        currency: "CNY",
        occurredLocalDate: "2026-10-01",
        categoryId: "cat-uncategorised",
        categoryName: "暂无分类",
        categoryIsSystem: true,
      },
    ];

    const [first] = categoryTotals(entries, "expense");

    expect(first?.categoryName).toBe("暂无分类");
    expect(first?.isSystem).toBe(true);
  });

  it("returns nothing for the other kind", () => {
    expect(categoryTotals(SAMPLE_B_INCOME_ONLY.entries, "expense")).toEqual([]);
  });

  it("conserves the whole amount of sample F across 24 categories", () => {
    const groups = categoryTotals(SAMPLE_F_MANY_CATEGORIES.entries, "expense");

    expect(groups).toHaveLength(24);
    expect(sumMinorExact(groups.map((group) => group.amountMinor))).toBe(300_000n);
  });
});

describe("paymentMethodTotals", () => {
  it("groups by structured payment method and keeps an explicit unspecified group", () => {
    const groups = paymentMethodTotals(SAMPLE_C_EXPENSE_ONLY.entries, "expense");

    expect(groups).toEqual([
      { paymentMethodId: "pm-wallet", paymentMethodName: "钱包", amountMinor: 1_200n, count: 1 },
      { paymentMethodId: "pm-card", paymentMethodName: "银行卡", amountMinor: 600n, count: 1 },
      { paymentMethodId: null, paymentMethodName: "未指定", amountMinor: 200n, count: 1 },
    ]);
    expect(sumMinorExact(groups.map((group) => group.amountMinor))).toBe(2_000n);
  });
});

describe("dayTotals / peakDay", () => {
  it("aggregates each business date", () => {
    const days = dayTotals(SAMPLE_C_EXPENSE_ONLY.entries);

    expect(days.map((day) => [day.date, day.expenseMinor.toString(), day.count])).toEqual([
      ["2026-10-01", "1200", 1],
      ["2026-10-02", "800", 2],
    ]);
  });

  it("finds the peak day by daily total, not by the largest single record", () => {
    const entries: readonly AnalysisEntry[] = [
      {
        id: "peak-a",
        kind: "expense",
        amountMinor: 700n,
        currency: "CNY",
        occurredLocalDate: "2026-10-01",
        categoryId: "cat-a",
      },
      {
        id: "peak-b",
        kind: "expense",
        amountMinor: 400n,
        currency: "CNY",
        occurredLocalDate: "2026-10-02",
        categoryId: "cat-a",
      },
      {
        id: "peak-c",
        kind: "expense",
        amountMinor: 400n,
        currency: "CNY",
        occurredLocalDate: "2026-10-02",
        categoryId: "cat-b",
      },
    ];

    expect(peakDay(entries, "expense")).toEqual({
      date: "2026-10-02",
      totalMinor: 800n,
      count: 2,
      tieCount: 1,
    });
  });

  it("counts tied peak days", () => {
    const entries: readonly AnalysisEntry[] = [
      {
        id: "tie-a",
        kind: "expense",
        amountMinor: 500n,
        currency: "CNY",
        occurredLocalDate: "2026-10-01",
        categoryId: "cat-a",
      },
      {
        id: "tie-b",
        kind: "expense",
        amountMinor: 500n,
        currency: "CNY",
        occurredLocalDate: "2026-10-02",
        categoryId: "cat-a",
      },
    ];

    const peak = peakDay(entries, "expense");

    expect(peak?.tieCount).toBe(2);
  });

  it("returns null for the empty book", () => {
    expect(peakDay(SAMPLE_A_EMPTY_BOOK.entries, "expense")).toBeNull();
  });
});

describe("extremeRecord", () => {
  it("finds the largest expense and its source", () => {
    const extreme = extremeRecord(SAMPLE_C_EXPENSE_ONLY.entries, "expense", "max");

    expect(extreme?.entry.id).toBe("c-meal");
    expect(extreme?.entry.amountMinor).toBe(1_200n);
    expect(extreme?.tieCount).toBe(1);
  });

  it("finds the smallest expense", () => {
    const extreme = extremeRecord(SAMPLE_C_EXPENSE_ONLY.entries, "expense", "min");

    expect(extreme?.entry.id).toBe("c-fun");
  });

  it("reports ties instead of letting refresh order decide", () => {
    const extreme = extremeRecord(SAMPLE_D_EQUAL_AMOUNTS.entries, "expense", "max");

    expect(extreme?.entry.id).toBe("d-1");
    expect(extreme?.tieCount).toBe(3);
  });

  it("returns null when the kind has no records", () => {
    expect(extremeRecord(SAMPLE_B_INCOME_ONLY.entries, "expense", "max")).toBeNull();
    expect(extremeRecord(SAMPLE_A_EMPTY_BOOK.entries, "income", "max")).toBeNull();
  });

  it("excludes soft-deleted records", () => {
    const extreme = extremeRecord(SAMPLE_M_DELETED_AND_RESTORED.entries, "expense", "max");

    expect(extreme?.entry.id).toBe("m-live");
  });
});

describe("foldRemainder", () => {
  it("keeps the top groups and folds the rest without losing amount", () => {
    const items = foldable(categoryTotals(SAMPLE_F_MANY_CATEGORIES.entries, "expense"));
    const { kept, folded } = foldRemainder(items, 5);

    expect(kept).toHaveLength(4);
    expect(folded).toHaveLength(20);
    expect(sumMinorExact([...kept, ...folded].map((group) => group.amountMinor))).toBe(300_000n);
    expect(
      sumMinorExact(kept.map((group) => group.amountMinor)) +
        sumMinorExact(folded.map((group) => group.amountMinor)),
    ).toBe(300_000n);
  });

  it("does not fold when everything fits", () => {
    const items = foldable(categoryTotals(SAMPLE_C_EXPENSE_ONLY.entries, "expense"));
    const { kept, folded } = foldRemainder(items, 5);

    expect(kept).toHaveLength(3);
    expect(folded).toEqual([]);
  });

  it("folds everything into the remainder when only one slot exists", () => {
    const items = foldable(categoryTotals(SAMPLE_C_EXPENSE_ONLY.entries, "expense"));
    const { kept, folded } = foldRemainder(items, 1);

    expect(kept).toEqual([]);
    expect(folded).toHaveLength(3);
  });

  it("rejects an invalid slot count", () => {
    expect(() => foldRemainder([], 0)).toThrow(RangeError);
  });
});

describe("money values", () => {
  it("serialises amounts as decimal strings", () => {
    expect(toMoneyValue(12_345n, "CNY")).toEqual({
      amountMinor: "12345",
      currency: "CNY",
      decimals: 2,
    });
  });

  it("knows zero-decimal currencies", () => {
    expect(toMoneyValue(1_000n, "JPY").decimals).toBe(0);
    expect(formatMoneyForDisplay(1_000n, "JPY")).toBe("1000");
  });

  it("formats negative net amounts", () => {
    expect(formatMoneyForDisplay(-2_000n, "CNY")).toBe("-20.00");
  });

  it("does not round a value above the safe integer range", () => {
    expect(formatMoneyForDisplay(9_007_199_254_740_997n, "CNY")).toBe("90071992547409.97");
  });
});

describe("sample O filter scenarios", () => {
  it("filters by kind", () => {
    const expenses = SAMPLE_O_FILTERS.entries.filter((entry) => entry.kind === "expense");

    expect(sumMinorExact(expenses.map((entry) => entry.amountMinor))).toBe(6_000n);
  });

  it("filters by category", () => {
    const categoryA = SAMPLE_O_FILTERS.entries.filter(
      (entry) => entry.categoryId === "cat-a" && entry.kind === "expense",
    );

    expect(sumMinorExact(categoryA.map((entry) => entry.amountMinor))).toBe(4_000n);
  });

  it("filters by date", () => {
    const firstTwoDays = entriesInRange(SAMPLE_O_FILTERS.entries, "2026-10-01", "2026-10-02");

    expect(firstTwoDays.map((entry) => entry.id)).toEqual(["o-exp-a-1", "o-exp-b-1"]);
  });
});

describe("peak recorded day (B20)", () => {
  it("picks the date with the most records, counting both kinds", () => {
    expect(peakRecordedDay(SAMPLE_C_EXPENSE_ONLY.entries)).toEqual({
      date: "2026-10-02",
      count: 2,
      incomeCount: 0,
      expenseCount: 2,
      tieCount: 1,
    });
  });

  it("keeps the earliest date and reports every tied day", () => {
    expect(peakRecordedDay(SAMPLE_O_FILTERS.entries)).toEqual({
      date: "2026-10-01",
      count: 1,
      incomeCount: 0,
      expenseCount: 1,
      tieCount: 4,
    });
  });

  it("returns null when nothing is recorded", () => {
    expect(peakRecordedDay(SAMPLE_A_EMPTY_BOOK.entries)).toBeNull();
  });
});
