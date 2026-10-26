import { describe, expect, it } from "vitest";

import {
  filterEntries,
  isBlocking,
  makeDefinition,
  makePeriod,
  prepareScope,
  resolveDefinitionPeriod,
  resolveFilters,
  type WorkbenchState,
} from "./context.js";
import { SAMPLE_A_EMPTY_BOOK, SAMPLE_C_EXPENSE_ONLY, SAMPLE_H_ACROSS_MONTHS, SAMPLE_I_MULTI_CURRENCY, SAMPLE_O_FILTERS } from "./fixtures.js";
import type { AnalysisEntry } from "./primitives.js";
import type { ResolvedFilters } from "./types.js";

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

function definition(
  overrides: {
    readonly analysisId?: string;
    readonly time?: {
      readonly mode: "inherit" | "preset" | "fixed" | "relative";
      readonly preset?: "7d" | "30d" | "90d" | "365d";
      readonly from?: string;
      readonly to?: string;
      readonly days?: number;
    };
    readonly filters?: {
      readonly kind?: "expense" | "income" | "both";
      readonly categoryIds?: readonly string[];
      readonly paymentMethodIds?: readonly string[];
      readonly tagIds?: readonly string[];
    };
  } = {},
) {
  const filters =
    overrides.filters === undefined
      ? undefined
      : { kind: overrides.filters.kind ?? "expense", ...overrides.filters };

  return makeDefinition({
    analysisId: overrides.analysisId ?? "AN-B01",
    analysisType: "scalar",
    metric: "expense-total",
    time: overrides.time ?? { mode: "inherit" },
    ...(filters === undefined ? {} : { filters }),
  });
}

describe("makePeriod", () => {
  it("builds an inclusive period with its calendar day count", () => {
    expect(makePeriod("2026-10-01", "2026-10-31")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      dayCount: 31,
    });
  });

  it("counts a single day as one day", () => {
    expect(makePeriod("2026-10-01", "2026-10-01").dayCount).toBe(1);
  });

  it("rejects malformed calendar dates", () => {
    expect(() => makePeriod("2026-1-01", "2026-10-31")).toThrow(/calendar_date/);
    expect(() => makePeriod("2026-10-01", "31/10/2026")).toThrow(/calendar_date/);
  });

  it("rejects a reversed period", () => {
    expect(() => makePeriod("2026-10-31", "2026-10-01")).toThrow(/period_order/);
  });

  it("rejects a period longer than the stats contract allows", () => {
    expect(() => makePeriod("2025-01-01", "2026-10-31")).toThrow(/period_too_long/);
  });
});

describe("resolveDefinitionPeriod", () => {
  it("inherits the workbench period by default", () => {
    expect(resolveDefinitionPeriod(definition(), { period: OCTOBER.period, today: OCTOBER.today })).toEqual(
      OCTOBER.period,
    );
  });

  it("re-validates an inherited period", () => {
    const invalid = { from: "2026-10-31", to: "2026-10-01", dayCount: 31 } as const;

    expect(() =>
      resolveDefinitionPeriod(definition(), { period: invalid, today: "2026-10-27" }),
    ).toThrow(/period_order/);
  });

  it("expands a preset to a range ending today (inclusive)", () => {
    expect(
      resolveDefinitionPeriod(definition({ time: { mode: "preset", preset: "7d" } }), {
        period: OCTOBER.period,
        today: "2026-10-27",
      }),
    ).toEqual({ from: "2026-10-21", to: "2026-10-27", dayCount: 7 });
  });

  it("requires an explicit fixed period", () => {
    expect(() =>
      resolveDefinitionPeriod(definition({ time: { mode: "fixed" } }), {
        period: OCTOBER.period,
        today: "2026-10-27",
      }),
    ).toThrow(/fixed_period_missing/);

    expect(
      resolveDefinitionPeriod(
        definition({ time: { mode: "fixed", from: "2026-10-01", to: "2026-10-10" } }),
        { period: OCTOBER.period, today: "2026-10-27" },
      ),
    ).toEqual({ from: "2026-10-01", to: "2026-10-10", dayCount: 10 });
  });

  it("turns relative days into a window ending today", () => {
    expect(
      resolveDefinitionPeriod(definition({ time: { mode: "relative", days: 30 } }), {
        period: OCTOBER.period,
        today: "2026-10-30",
      }),
    ).toEqual({ from: "2026-10-01", to: "2026-10-30", dayCount: 30 });
  });

  it("rejects a non-positive relative window", () => {
    expect(() =>
      resolveDefinitionPeriod(definition({ time: { mode: "relative", days: 0 } }), {
        period: OCTOBER.period,
        today: "2026-10-27",
      }),
    ).toThrow(/relative_days/);
  });
});

describe("resolveFilters", () => {
  it("falls back to the caller's default kind and null restrictions", () => {
    expect(resolveFilters(definition(), { defaultKind: "expense", currency: "CNY" })).toEqual({
      kind: "expense",
      categoryIds: null,
      paymentMethodIds: null,
      tagIds: null,
      currency: "CNY",
    });
  });

  it("keeps 'not restricted' and 'restricted to nothing' apart", () => {
    const resolved = resolveFilters(definition({ filters: { categoryIds: [] } }), {
      defaultKind: "expense",
      currency: "CNY",
    });

    expect(resolved.categoryIds).toEqual([]);
    expect(resolved.paymentMethodIds).toBeNull();
  });

  it("copies the definition arrays instead of aliasing them", () => {
    const ids = ["cat-a"];
    const resolved = resolveFilters(definition({ filters: { categoryIds: ids } }), {
      defaultKind: "expense",
      currency: "CNY",
    });

    expect(resolved.categoryIds).toEqual(["cat-a"]);
    expect(resolved.categoryIds).not.toBe(ids);
  });
});

describe("filterEntries", () => {
  const filters = (overrides: Partial<ResolvedFilters>): ResolvedFilters => ({
    kind: "expense",
    categoryIds: null,
    paymentMethodIds: null,
    tagIds: null,
    currency: "CNY",
    ...overrides,
  });

  it("keeps only the requested kind", () => {
    const income = filterEntries(
      SAMPLE_O_FILTERS.entries,
      filters({ kind: "income" }),
      OCTOBER.period,
    );

    expect(income.map((entry) => entry.id)).toEqual(["o-inc-1"]);
  });

  it("applies category restrictions", () => {
    const result = filterEntries(
      SAMPLE_O_FILTERS.entries,
      filters({ categoryIds: ["cat-a"] }),
      OCTOBER.period,
    );

    expect(result.map((entry) => entry.id)).toEqual(["o-exp-a-1", "o-exp-a-2"]);
  });

  it("never matches a null payment method against a restriction", () => {
    const result = filterEntries(
      SAMPLE_C_EXPENSE_ONLY.entries,
      filters({ paymentMethodIds: ["pm-card"] }),
      OCTOBER.period,
    );

    expect(result.map((entry) => entry.id)).toEqual(["c-transport"]);
  });

  it("matches any of the requested tags", () => {
    const tagged: AnalysisEntry[] = SAMPLE_C_EXPENSE_ONLY.entries.map((entry, index) => ({
      ...entry,
      tagIds: index === 0 ? ["tag-out"] : ["tag-in"],
    }));

    const result = filterEntries(tagged, filters({ tagIds: ["tag-out"] }), OCTOBER.period);

    expect(result.map((entry) => entry.id)).toEqual(["c-meal"]);
  });

  it("filters by business date, not by creation order", () => {
    const result = filterEntries(
      SAMPLE_H_ACROSS_MONTHS.entries,
      filters({}),
      OCTOBER.period,
    );

    expect(result.map((entry) => entry.id)).toEqual([
      "h-oct-01",
      "h-oct-15",
      "h-oct-31",
    ]);
  });

  it("drops soft-deleted records", () => {
    const withDeleted: AnalysisEntry[] = [
      ...SAMPLE_C_EXPENSE_ONLY.entries,
      {
        id: "deleted",
        kind: "expense",
        amountMinor: 50_000n,
        currency: "CNY",
        occurredLocalDate: "2026-10-03",
        categoryId: "cat-meal",
        categoryName: "餐饮",
        categoryIsSystem: false,
        paymentMethodId: null,
        paymentMethodName: null,
        deletedAt: "2026-10-04T00:00:00.000Z",
      },
    ];

    const result = filterEntries(withDeleted, filters({}), OCTOBER.period);

    expect(result.map((entry) => entry.id)).toEqual(["c-meal", "c-transport", "c-fun"]);
  });
});

describe("isBlocking", () => {
  it("blocks rendering only for data states that cannot produce numbers", () => {
    expect(isBlocking("loading")).toBe(true);
    expect(isBlocking("request-failed")).toBe(true);
    expect(isBlocking("no-permission")).toBe(true);
    expect(isBlocking("complete")).toBe(false);
    expect(isBlocking("partial")).toBe(false);
    expect(isBlocking("fx-incomplete")).toBe(false);
    expect(isBlocking("no-transactions")).toBe(false);
  });
});

describe("prepareScope", () => {
  it("marks a complete but empty scope as no-transactions", () => {
    const scope = prepareScope(
      SAMPLE_A_EMPTY_BOOK.entries,
      definition(),
      OCTOBER,
      "expense",
    );

    expect(scope.completeness).toBe("no-transactions");
    expect(scope.unavailableReason).toBe("no_matching_transactions");
    expect(scope.entries).toEqual([]);
  });

  it("keeps an empty scope that was already no-transactions", () => {
    const scope = prepareScope(
      [],
      definition(),
      workbench("2026-10-01", "2026-10-31", { completeness: "no-transactions" }),
      "expense",
    );

    expect(scope.completeness).toBe("no-transactions");
  });

  it("passes data-layer completeness through, including blocking states", () => {
    const degraded = prepareScope(
      SAMPLE_C_EXPENSE_ONLY.entries,
      definition(),
      workbench("2026-10-01", "2026-10-31", {
        completeness: "fx-incomplete",
        unavailableReason: "fx:missing_rate:2026-10-02",
      }),
      "expense",
    );

    expect(degraded.completeness).toBe("fx-incomplete");
    expect(degraded.unavailableReason).toBe("fx:missing_rate:2026-10-02");

    const blocked = prepareScope(
      SAMPLE_C_EXPENSE_ONLY.entries,
      definition(),
      workbench("2026-10-01", "2026-10-31", { completeness: "loading" }),
      "expense",
    );

    expect(blocked.completeness).toBe("loading");
  });

  it("carries the data version for shared-result de-duplication", () => {
    const scope = prepareScope(
      SAMPLE_C_EXPENSE_ONLY.entries,
      definition(),
      workbench("2026-10-01", "2026-10-31", { dataVersion: "dv-7" }),
      "expense",
    );

    expect(scope.dataVersion).toBe("dv-7");
  });

  it("rejects a mixed-currency record set in original mode", () => {
    expect(() =>
      prepareScope(SAMPLE_I_MULTI_CURRENCY.entries, definition(), OCTOBER, "expense"),
    ).toThrow(/mixed_currency/);
  });

  it("rejects records whose single currency is not the resolved one", () => {
    const usdOnly: AnalysisEntry[] = [
      { ...SAMPLE_C_EXPENSE_ONLY.entries[0]!, currency: "USD" },
    ];

    expect(() => prepareScope(usdOnly, definition(), OCTOBER, "expense")).toThrow(
      /currency_mismatch/,
    );
  });
});
