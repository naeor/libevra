import { describe, expect, it } from "vitest";
import type { FxEntry, FxLookup } from "../../fx.js";
import { aggregateFx, convertFx, fxDecimal } from "../../fx.js";
import {
  FX_PROJECTION_BATCH,
  buildFxDraftRecords,
  buildFxRateObservations,
  checkFxProjectionInvariants,
  projectFxDiagnostics,
} from "./fxProjection.js";

const BOOK = "book-1";
const ACCOUNT = "account-1";
const CNY_RATES = { EUR: "1", USD: "1", CNY: "7.2" } as const;

function entry(overrides: Partial<FxEntry> & { readonly id: string }): FxEntry {
  const { id, ...rest } = overrides;
  return {
    id,
    bookId: BOOK,
    amountCents: 1000,
    currency: "CNY",
    occurredLocalDate: "2026-10-20",
    kind: "expense",
    categoryId: "cat-1",
    ...rest,
  };
}

function lookup(
  date: string,
  rates: Readonly<Record<string, string>>,
  provider = "test-provider",
): FxLookup {
  return {
    status: "available",
    cached: false,
    snapshot: {
      base: "EUR",
      date,
      provider,
      revision: "r1",
      fetchedAt: `${date}T00:00:00.000Z`,
      rates,
    },
  };
}

function mapOf(...entries: readonly (readonly [string, FxLookup])[]): ReadonlyMap<string, FxLookup> {
  return new Map(entries);
}

describe("P17–P20 real projection · 输入投影", () => {
  it("真实逐笔 → draft 记录：金额保持 bigint 最小单位，不折算", () => {
    const records = buildFxDraftRecords([
      entry({ id: "t1", amountCents: 1234, currency: "USD" }),
    ]);
    expect(records).toEqual([
      {
        id: "t1",
        kind: "expense",
        amountMinor: 1234n,
        currency: "USD",
        occurredLocalDate: "2026-10-20",
      },
    ]);
  });

  it("权威快照 → 只构造「原币 → 目标币」观测，不含目标币自身", () => {
    const observations = buildFxRateObservations(
      mapOf(["2026-10-20", lookup("2026-10-20", CNY_RATES)]),
      "CNY",
    );
    expect(observations).toHaveLength(2);
    const usd = observations.find((item) => item.baseCurrency === "USD");
    expect(usd).toBeDefined();
    expect(usd?.quoteCurrency).toBe("CNY");
    expect(usd?.rateNumerator).toBe(fxDecimal("7.2"));
    expect(usd?.rateDenominator).toBe(fxDecimal("1"));
    expect(observations.some((item) => item.baseCurrency === "CNY")).toBe(false);
  });
});

describe("P17–P20 real projection · 与权威引擎对账", () => {
  it("P16/P17/P19/P20 投影结果与 convertFx/aggregateFx 一致且守恒", () => {
    const entries = [
      entry({ id: "c1", currency: "CNY", amountCents: 15000 }),
      entry({ id: "u1", currency: "USD", amountCents: 1000 }),
    ];
    const rates = mapOf(["2026-10-20", lookup("2026-10-20", CNY_RATES)]);
    const result = projectFxDiagnostics({
      targetCurrency: "CNY",
      from: "2026-10-20",
      to: "2026-10-20",
      entries,
      rates,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.provenance).toBe(FX_PROJECTION_BATCH);
    expect(result.completeness).toBe("complete");
    expect(result.contribution.totalConvertedMinor).toBe(22200n);
    expect(result.contribution.missingCount).toBe(0);

    const rowsByCurrency = new Map(result.contribution.rows.map((row) => [row.currency, row]));
    expect(rowsByCurrency.get("CNY")?.convertedMinor).toBe(15000n);
    expect(rowsByCurrency.get("USD")?.convertedMinor).toBe(7200n);

    // 逐笔权威引擎：每币种已折算金额与投影行一致
    for (const currency of ["CNY", "USD"] as const) {
      const authoritative = entries
        .filter((item) => item.currency === currency)
        .map((item) => convertFx(item, "CNY", rates.get(item.occurredLocalDate)))
        .reduce((total, converted) => total + BigInt(converted.convertedMinor ?? "0"), 0n);
      expect(rowsByCurrency.get(currency)?.convertedMinor).toBe(authoritative);
    }

    // 合计守恒：投影总额 == 权威 aggregateFx 的收入+支出合计
    const aggregate = aggregateFx(ACCOUNT, BOOK, entries, "CNY", rates);
    expect(aggregate.complete).toBe(true);
    expect(BigInt(aggregate.totals.incomeMinor) + BigInt(aggregate.totals.expenseMinor)).toBe(
      result.contribution.totalConvertedMinor,
    );

    // P16 币种构成：只笔数、原币金额不混加
    expect(result.currencyComposition.totalRecordCount).toBe(2);
    expect(result.currencyComposition.currencyCount).toBe(2);

    expect(checkFxProjectionInvariants(result)).toEqual({
      rowsDeltaConserved: true,
      coverageCountsConserved: true,
      fallbackCountsConserved: true,
      trendNoInterpolation: true,
    });
  });

  it("缺汇率一笔 → partial，缺失单独计数且不折算成 0", () => {
    const entries = [
      entry({ id: "c1", currency: "CNY", amountCents: 1000 }),
      entry({ id: "u2", currency: "USD", amountCents: 1000, occurredLocalDate: "2026-10-30" }),
    ];
    const result = projectFxDiagnostics({
      targetCurrency: "CNY",
      from: "2026-10-20",
      to: "2026-10-30",
      entries,
      rates: mapOf(["2026-10-20", lookup("2026-10-20", CNY_RATES)]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.completeness).toBe("partial");
    expect(result.contribution.missingCount).toBe(1);
    expect(result.contribution.missingRecords.map((item) => item.id)).toEqual(["u2"]);
    expect(result.coverage.missingCount).toBe(1);
    expect(result.coverage.needsConversionCount).toBe(1);
    expect(result.coverage.convertedCount).toBe(0);
    expect(result.coverage.coverageRatio?.numerator).toBe(0n);
    expect(result.coverage.coverageRatio?.denominator).toBe(1n);
    expect(result.coverage.amountCoverageAvailable).toBe(false);
    expect(checkFxProjectionInvariants(result).rowsDeltaConserved).toBe(true);
  });

  it("回退读取更早快照（≤7 天），与 P20 回退计数同源", () => {
    const entries = [
      entry({ id: "u1", currency: "USD", amountCents: 1000, occurredLocalDate: "2026-10-22" }),
    ];
    const result = projectFxDiagnostics({
      targetCurrency: "CNY",
      from: "2026-10-20",
      to: "2026-10-22",
      entries,
      rates: mapOf(["2026-10-20", lookup("2026-10-20", CNY_RATES)]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const row = result.contribution.rows.find((item) => item.currency === "USD");
    expect(row?.convertedMinor).toBe(7200n);
    expect(row?.fallbackCount).toBe(1);
    expect(row?.missingCount).toBe(0);
    expect(result.fallback.fallbackRecordCount).toBe(1);
    expect(result.fallback.fallbackDaysDistribution).toContainEqual({ fallbackDays: 2, count: 1 });
    expect(checkFxProjectionInvariants(result).fallbackCountsConserved).toBe(true);
  });
});

describe("P17–P20 real projection · 显式拒绝（无部分结果）", () => {
  it("注入的区间守卫超限 → fx_range_too_long，且不返回任何结果字段", () => {
    const rejected = projectFxDiagnostics(
      {
        targetCurrency: "CNY",
        from: "2026-01-01",
        to: "2029-12-31",
        entries: [entry({ id: "c1" })],
        rates: mapOf(["2026-10-20", lookup("2026-10-20", CNY_RATES)]),
      },
      {
        rangeGuard: () => {
          throw new RangeError("fx_range_too_long: 48 months exceeds 36");
        },
      },
    );
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.reason).toBe("fx_range_too_long");
    expect("records" in rejected).toBe(false);
    expect("contribution" in rejected).toBe(false);
    expect("completeness" in rejected).toBe(false);
  });

  it("超出 resolvedPeriod 的逐笔 → invalid_input，不静默丢弃", () => {
    const rejected = projectFxDiagnostics({
      targetCurrency: "CNY",
      from: "2026-10-20",
      to: "2026-10-20",
      entries: [entry({ id: "old", occurredLocalDate: "2026-10-19" })],
      rates: mapOf(),
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.reason).toBe("invalid_input");
    expect(rejected.detail).toContain("outside resolved period");
  });

  it("非法目标币 → unsupported_currency", () => {
    const rejected = projectFxDiagnostics({
      targetCurrency: "cny",
      from: "2026-10-20",
      to: "2026-10-20",
      entries: [],
      rates: mapOf(),
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.reason).toBe("unsupported_currency");
  });
});

describe("P17–P20 real projection · P18 离散观测", () => {
  it("只画真实观测、不插值；缺观测日显式计数", () => {
    const result = projectFxDiagnostics({
      targetCurrency: "CNY",
      from: "2026-10-20",
      to: "2026-10-21",
      entries: [entry({ id: "c1" })],
      rates: mapOf(["2026-10-20", lookup("2026-10-20", CNY_RATES)]),
      trend: { currency: "USD" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.trend?.ok).toBe(true);
    if (result.trend === null || !result.trend.ok) {
      return;
    }
    expect(result.trend.value.points).toHaveLength(1);
    expect(result.trend.value.observationCount).toBe(1);
    expect(result.trend.value.missingDateCount).toBe(1);
    expect(result.trend.value.interpolation).toBe("none");
    expect(result.trend.value.points[0]?.rateDate).toBe("2026-10-20");
  });

  it("超过草案 400 天上限 → 趋势显式拒绝，主结果不静默截断", () => {
    const result = projectFxDiagnostics({
      targetCurrency: "CNY",
      from: "2026-10-20",
      to: "2026-10-20",
      entries: [entry({ id: "c1" })],
      rates: mapOf(["2026-10-20", lookup("2026-10-20", CNY_RATES)]),
      trend: { currency: "USD", from: "2025-01-01", to: "2026-12-31" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.trend?.ok).toBe(false);
    if (result.trend === null || result.trend.ok) {
      return;
    }
    expect(result.trend.reason).toBe("trend_range_too_long");
  });
});

describe("P17–P20 real projection · 空区间", () => {
  it("空记录 → no-transactions，而不是 0", () => {
    const result = projectFxDiagnostics({
      targetCurrency: "CNY",
      from: "2026-10-20",
      to: "2026-10-20",
      entries: [],
      rates: mapOf(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.completeness).toBe("no-transactions");
    expect(result.contribution.rows).toEqual([]);
    expect(result.contribution.totalConvertedMinor).toBe(0n);
    expect(result.currencyComposition.completeness).toBe("no-transactions");
  });
});
