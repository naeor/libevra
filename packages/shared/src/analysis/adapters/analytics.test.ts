import { describe, expect, it } from "vitest";

import type { AnalyticsTransactionItem } from "../../analytics.js";

import { toAnalysisEntries, toAnalysisEntry, toFxEntries, toFxEntry } from "./analytics.js";

function row(overrides: Partial<AnalyticsTransactionItem> = {}): AnalyticsTransactionItem {
  return {
    id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
    bookId: "2b4e28ba-2fa1-11d2-883f-0016d3cca427",
    kind: "expense",
    amountMinor: "1200",
    currency: "CNY",
    occurredLocalDate: "2026-10-01",
    categoryId: "3b4e28ba-2fa1-11d2-883f-0016d3cca427",
    categoryName: "餐饮",
    paymentMethodId: "4b4e28ba-2fa1-11d2-883f-0016d3cca427",
    paymentMethodName: "钱包",
    version: 2,
    ...overrides,
  };
}

describe("toAnalysisEntry", () => {
  it("converts the decimal minor string to a bigint and keeps the labels", () => {
    const entry = toAnalysisEntry(row());

    expect(entry.amountMinor).toBe(1200n);
    expect(entry.kind).toBe("expense");
    expect(entry.occurredLocalDate).toBe("2026-10-01");
    expect(entry.categoryName).toBe("餐饮");
    expect(entry.paymentMethodName).toBe("钱包");
  });

  it("keeps an unspecified payment method as null, not as an empty id", () => {
    const entry = toAnalysisEntry(row({ paymentMethodId: null, paymentMethodName: null }));

    expect(entry.paymentMethodId).toBeNull();
    expect(entry.paymentMethodName).toBeNull();
  });

  it("survives an amount beyond Number.MAX_SAFE_INTEGER without rounding", () => {
    const entry = toAnalysisEntry(row({ amountMinor: "9007199254740993" }));

    expect(entry.amountMinor).toBe(9007199254740993n);
  });
});

describe("toFxEntry", () => {
  it("maps to the shape the existing FX engine consumes", () => {
    const entry = toFxEntry(row());

    expect(entry).toEqual({
      id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
      bookId: "2b4e28ba-2fa1-11d2-883f-0016d3cca427",
      amountCents: 1200,
      currency: "CNY",
      occurredLocalDate: "2026-10-01",
      kind: "expense",
      categoryId: "3b4e28ba-2fa1-11d2-883f-0016d3cca427",
      version: 2,
    });
  });

  it("refuses to silently round an amount that is not a safe integer", () => {
    expect(() => toFxEntry(row({ amountMinor: "9007199254740993" }))).toThrow(RangeError);
    expect(() => toFxEntry(row({ amountMinor: "9007199254740993" }))).toThrow(/fx_amount_unsafe/);
  });
});

describe("batch adapters", () => {
  it("map every row", () => {
    const rows = [row(), row({ id: "5b4e28ba-2fa1-11d2-883f-0016d3cca427", amountMinor: "0" })];

    expect(toAnalysisEntries(rows).map((entry) => entry.amountMinor)).toEqual([1200n, 0n]);
    expect(toFxEntries(rows).map((entry) => entry.amountCents)).toEqual([1200, 0]);
  });
});
