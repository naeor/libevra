import { describe, expect, it } from "vitest";

import { currencyCompositionOf } from "./currencyComposition.js";
import type { DraftFxRateObservation, DraftFxRecord } from "./draftTypes.js";
import {
  FX_DRAFT_FALLBACK_UNAVAILABLE_NO_CONVERSION_NEEDED,
  FX_DRAFT_FALLBACK_UNAVAILABLE_NO_TRANSACTIONS,
  FX_DRAFT_MAX_FALLBACK_DAYS,
  FX_DRAFT_RATE_DECIMALS,
  assertFxRecord,
  convertMinorAtRate,
  fxAddDays,
  fxCalendarDatesBetween,
  fxContributionOf,
  fxCoverageOf,
  fxDayNumber,
  fxFallbackUsageOf,
  fxRateTrendOf,
  makeFxRateIndex,
  resolveFxRate,
  roundHalfAwayMinor,
} from "./fxDiagnostics.js";

const EXPENSE = "expense" as const;

function record(
  id: string,
  currency: string,
  amountMinor: bigint,
  occurredLocalDate: string,
  kind: "expense" | "income" = EXPENSE,
): DraftFxRecord {
  return { id, kind, amountMinor, currency, occurredLocalDate };
}

function observation(
  baseCurrency: string,
  quoteCurrency: string,
  rateDate: string,
  rateNumerator: bigint,
  rateDenominator: bigint,
  provider = "synthetic-fx",
): DraftFxRateObservation {
  return { provider, baseCurrency, quoteCurrency, rateDate, rateNumerator, rateDenominator };
}

describe("fxDiagnostics 日期与舍入基础", () => {
  it("按自然日序号做日期算术并正确处理闰年", () => {
    expect(fxDayNumber("1970-01-01")).toBe(0);
    expect(fxDayNumber("2024-02-29")).toBe(fxDayNumber("2024-03-01") - 1);
    expect(fxAddDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(fxAddDays("2023-02-28", 1)).toBe("2023-03-01");
    expect(fxAddDays("2026-10-01", -7)).toBe("2026-09-24");
  });

  it("拒绝不存在的日历日", () => {
    expect(() => fxDayNumber("2023-02-29")).toThrow(RangeError);
    expect(() => fxDayNumber("2026-13-01")).toThrow(RangeError);
    expect(() => fxDayNumber("2026/10/01")).toThrow(RangeError);
  });

  it("枚举区间自然日并拒绝超长区间", () => {
    expect(fxCalendarDatesBetween("2026-10-01", "2026-10-03")).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(() => fxCalendarDatesBetween("2026-10-03", "2026-10-01")).toThrow(RangeError);
    expect(() => fxCalendarDatesBetween("2020-01-01", "2022-01-01")).toThrow(RangeError);
  });

  it("minor-half-away-v1 舍入", () => {
    expect(roundHalfAwayMinor(1n, 2n)).toBe(1n);
    expect(roundHalfAwayMinor(-1n, 2n)).toBe(-1n);
    expect(roundHalfAwayMinor(4n, 10n)).toBe(0n);
    expect(roundHalfAwayMinor(5n, 10n)).toBe(1n);
    expect(roundHalfAwayMinor(15n, 10n)).toBe(2n);
    expect(roundHalfAwayMinor(-15n, 10n)).toBe(-2n);
    expect(() => roundHalfAwayMinor(1n, 0n)).toThrow(RangeError);
  });

  it("按币种小数位做精确折算（CNY 2 位、JPY 0 位）", () => {
    // 1000 分（10 CNY）按 1 CNY = 10/72 USD 折算 = 1.3888… USD → 139 分。
    expect(convertMinorAtRate(1000n, 10n, 72n, "CNY", "USD")).toBe(139n);
    // 1000 日元（JPY 0 位）× 0.05 CNY = 50.00 CNY → 5000 分。
    expect(convertMinorAtRate(1000n, 5n, 100n, "JPY", "CNY")).toBe(5000n);
    expect(() => convertMinorAtRate(-1n, 1n, 1n, "CNY", "CNY")).toThrow(RangeError);
    expect(() => convertMinorAtRate(1n, 0n, 1n, "CNY", "USD")).toThrow(RangeError);
    expect(() => convertMinorAtRate(1n, 1n, 1n, "cny", "USD")).toThrow(RangeError);
  });

  it("校验交易视图：金额非负、币种三字母、日期真实", () => {
    expect(() => assertFxRecord(record("a", "CNY", 1n, "2026-10-01"))).not.toThrow();
    expect(() => assertFxRecord(record("a", "CNY", -1n, "2026-10-01"))).toThrow(RangeError);
    expect(() => assertFxRecord(record("a", "cny", 1n, "2026-10-01"))).toThrow(RangeError);
    expect(() => assertFxRecord(record("a", "CNY", 1n, "2026-02-30"))).toThrow(RangeError);
    expect(() => assertFxRecord(record("", "CNY", 1n, "2026-10-01"))).toThrow(RangeError);
  });
});

describe("fxDiagnostics 汇率解析", () => {
  const observations = [
    observation("USD", "CNY", "2026-10-01", 72n, 10n),
    observation("USD", "CNY", "2026-10-03", 75n, 10n),
  ];

  it("同币种直接 identity，不折算", () => {
    const resolution = resolveFxRate(record("a", "CNY", 100n, "2026-10-05"), observations, "CNY");
    expect(resolution.status).toBe("identity");
    expect(resolution.rateDate).toBe("2026-10-05");
    expect(resolution.rateNumerator).toBeNull();
  });

  it("当天命中为 exact，向前命中为 fallback 并给出天数", () => {
    const exact = resolveFxRate(record("a", "USD", 100n, "2026-10-01"), observations, "CNY");
    expect(exact.status).toBe("exact");
    expect(exact.fallbackDays).toBe(0);
    expect(exact.rateNumerator).toBe(72n);

    const fallback = resolveFxRate(record("a", "USD", 100n, "2026-10-04"), observations, "CNY");
    expect(fallback.status).toBe("fallback");
    expect(fallback.fallbackDays).toBe(1);
    expect(fallback.rateDate).toBe("2026-10-03");
  });

  it("超出回退窗口为 missing，且 maxFallbackDays=0 时禁用回退", () => {
    const missing = resolveFxRate(record("a", "USD", 100n, "2026-10-12"), observations, "CNY");
    expect(missing.status).toBe("missing");
    expect(missing.rateNumerator).toBeNull();

    const noFallback = resolveFxRate(
      record("a", "USD", 100n, "2026-10-04"),
      observations,
      "CNY",
      { maxFallbackDays: 0 },
    );
    expect(noFallback.status).toBe("missing");
    expect(FX_DRAFT_MAX_FALLBACK_DAYS).toBe(7);
  });

  it("拒绝同一键上互相矛盾的汇率观测", () => {
    const conflicting = [
      observation("USD", "CNY", "2026-10-01", 72n, 10n),
      observation("USD", "CNY", "2026-10-01", 73n, 10n),
    ];
    expect(() => makeFxRateIndex(conflicting)).toThrow(RangeError);
    expect(makeFxRateIndex(observations).size).toBe(2);
  });
});

describe("currencyCompositionOf · P16 币种交易构成", () => {
  it("按币种统计笔数与收/支原币金额，份额只按笔数", () => {
    const result = currencyCompositionOf([
      record("a", "CNY", 1000n, "2026-10-01"),
      record("b", "CNY", 2000n, "2026-10-02", "income"),
      record("c", "USD", 500n, "2026-10-03"),
    ]);

    expect(result.totalRecordCount).toBe(3);
    expect(result.currencyCount).toBe(2);
    expect(result.completeness).toBe("complete");

    const [first, second] = result.rows;
    expect(first?.currency).toBe("CNY");
    expect(first?.recordCount).toBe(2);
    expect(first?.incomeCount).toBe(1);
    expect(first?.expenseCount).toBe(1);
    expect(first?.incomeAmountMinor).toBe(2000n);
    expect(first?.expenseAmountMinor).toBe(1000n);
    expect(first?.recordShare).toEqual({ numerator: 2n, denominator: 3n });

    expect(second?.currency).toBe("USD");
    expect(second?.recordShare).toEqual({ numerator: 1n, denominator: 3n });
  });

  it("空输入返回 no-transactions，负金额抛错", () => {
    expect(currencyCompositionOf([]).completeness).toBe("no-transactions");
    expect(() => currencyCompositionOf([record("a", "CNY", -1n, "2026-10-01")])).toThrow(RangeError);
  });
});

describe("fxContributionOf · P17 综合金额币种贡献", () => {
  const observations = [observation("USD", "CNY", "2026-10-01", 72n, 10n)];

  it("按原始币种分组折算，identity 计入且缺汇率单独计数", () => {
    const result = fxContributionOf(
      [
        record("cny-1", "CNY", 1000n, "2026-10-01"),
        record("usd-1", "USD", 1000n, "2026-10-01"),
        record("usd-2", "USD", 500n, "2026-10-09"),
      ],
      observations,
      "CNY",
    );

    expect(result.targetCurrency).toBe("CNY");
    expect(result.totalConvertedMinor).toBe(8200n);
    expect(result.convertedCount).toBe(2);
    expect(result.identityCount).toBe(1);
    expect(result.missingCount).toBe(1);
    expect(result.sharesOverConvertedOnly).toBe(true);
    expect(result.completeness).toBe("partial");
    expect(result.missingRecords).toEqual([
      { id: "usd-2", currency: "USD", occurredLocalDate: "2026-10-09" },
    ]);
    expect(result.missingRecordsTruncated).toBe(false);

    const [usdRow, cnyRow] = result.rows;
    expect(usdRow?.currency).toBe("USD");
    expect(usdRow?.convertedMinor).toBe(7200n);
    expect(usdRow?.missingCount).toBe(1);
    expect(usdRow?.shareOfConverted).toEqual({ numerator: 36n, denominator: 41n });
    expect(cnyRow?.currency).toBe("CNY");
    expect(cnyRow?.convertedMinor).toBe(1000n);
    expect(cnyRow?.shareOfConverted).toEqual({ numerator: 5n, denominator: 41n });
  });

  it("空输入与非法目标币种", () => {
    expect(fxContributionOf([], observations, "CNY").completeness).toBe("no-transactions");
    expect(() => fxContributionOf([], observations, "cny")).toThrow(RangeError);
  });
});

describe("fxRateTrendOf · P18 汇率历史趋势", () => {
  const observations = [
    observation("USD", "CNY", "2026-10-01", 72n, 10n),
    observation("USD", "CNY", "2026-10-03", 75n, 10n),
  ];

  it("只回传离散观测，缺失日期计数而不插值", () => {
    const result = fxRateTrendOf(observations, {
      currency: "USD",
      targetCurrency: "CNY",
      from: "2026-10-01",
      to: "2026-10-04",
    });

    expect(result.observationCount).toBe(2);
    expect(result.interpolation).toBe("none");
    expect(result.missingDateCount).toBe(2);
    expect(result.missingDates).toEqual(["2026-10-02", "2026-10-04"]);
    expect(result.points.map((point) => point.rateDate)).toEqual(["2026-10-01", "2026-10-03"]);
    expect(result.change).toEqual({ numerator: 1n, denominator: 24n });
    expect(result.minPoint?.rateDate).toBe("2026-10-01");
    expect(result.maxPoint?.rateDate).toBe("2026-10-03");
    expect(result.points[0]?.rateScaled).toEqual({
      scaled: 7_200_000n,
      decimals: FX_DRAFT_RATE_DECIMALS,
    });
    expect(result.completeness).toBe("complete");
  });

  it("无观测时为 unavailable，同币种抛错", () => {
    const empty = fxRateTrendOf([], {
      currency: "USD",
      targetCurrency: "CNY",
      from: "2026-10-01",
      to: "2026-10-02",
    });
    expect(empty.completeness).toBe("unavailable");
    expect(empty.points).toEqual([]);
    expect(empty.change).toBeNull();

    expect(() =>
      fxRateTrendOf([], { currency: "CNY", targetCurrency: "CNY", from: "2026-10-01", to: "2026-10-02" }),
    ).toThrow(RangeError);
  });
});

describe("fxCoverageOf · P19 完整性", () => {
  it("按币种×日期标记状态，记录覆盖率与缺失组合显式回传", () => {
    const result = fxCoverageOf(
      [
        record("cny-1", "CNY", 1000n, "2026-10-01"),
        record("usd-1", "USD", 100n, "2026-10-01"),
        record("usd-2", "USD", 200n, "2026-10-12"),
      ],
      [observation("USD", "CNY", "2026-10-01", 72n, 10n)],
      "CNY",
      { from: "2026-10-01", to: "2026-10-12" },
    );

    expect(result.currencies).toEqual(["CNY", "USD"]);
    expect(result.dates.length).toBe(12);
    expect(result.dates[0]).toBe("2026-10-01");
    expect(result.dates[11]).toBe("2026-10-12");
    expect(result.needsConversionCount).toBe(2);
    expect(result.convertedCount).toBe(1);
    expect(result.missingCount).toBe(1);
    expect(result.notNeededCount).toBe(1);
    expect(result.exactCount).toBe(1);
    expect(result.coverageRatio).toEqual({ numerator: 1n, denominator: 2n });
    expect(result.amountCoverageAvailable).toBe(false);
    expect(result.amountCoverageReason.length).toBeGreaterThan(0);
    expect(result.missingCombinations).toEqual([
      { currency: "USD", date: "2026-10-12", recordCount: 1 },
    ]);
    expect(result.completeness).toBe("partial");
    expect(result.cells).toEqual([
      { currency: "CNY", date: "2026-10-01", status: "not-needed", recordCount: 1 },
      { currency: "USD", date: "2026-10-01", status: "exact", recordCount: 1 },
      { currency: "USD", date: "2026-10-12", status: "missing", recordCount: 1 },
    ]);

    const usdRow = result.rows.find((row) => row.currency === "USD");
    expect(usdRow?.coverage).toEqual({ numerator: 1n, denominator: 2n });
    const cnyRow = result.rows.find((row) => row.currency === "CNY");
    expect(cnyRow?.coverage).toBeNull();
  });
});

describe("fxFallbackUsageOf · P20 回退使用", () => {
  const observations = [observation("USD", "CNY", "2026-10-03", 72n, 10n, "synthetic-fx")];

  it("统计回退天数分布、来源与日期，缺失单独计数", () => {
    const result = fxFallbackUsageOf(
      [
        record("usd-fallback", "USD", 100n, "2026-10-05"),
        record("usd-missing", "USD", 100n, "2026-10-11"),
        record("cny-identity", "CNY", 100n, "2026-10-05"),
      ],
      observations,
      "CNY",
    );

    expect(result.needsConversionCount).toBe(2);
    expect(result.fallbackRecordCount).toBe(1);
    expect(result.missingRateCount).toBe(1);
    expect(result.maxFallbackDays).toBe(2);
    expect(result.fallbackDaysDistribution).toEqual([{ fallbackDays: 2, count: 1 }]);
    expect(result.providers).toEqual([{ provider: "synthetic-fx", count: 1 }]);
    expect(result.dates).toEqual([{ date: "2026-10-05", count: 1 }]);
    expect(result.completeness).toBe("partial");
    expect(result.rows).toEqual([
      { currency: "USD", directCount: 0, fallbackCount: 1, missingCount: 1, fallbackDays: [{ fallbackDays: 2, count: 1 }] },
    ]);
  });

  it("maxFallbackDays 收窄后回退变缺失", () => {
    const result = fxFallbackUsageOf(
      [record("usd-fallback", "USD", 100n, "2026-10-05")],
      observations,
      "CNY",
      { maxFallbackDays: 1 },
    );
    expect(result.fallbackRecordCount).toBe(0);
    expect(result.missingRateCount).toBe(1);
    expect(result.completeness).toBe("partial");
  });

  it("空输入为 no-transactions，available=false 且原因码为 no-transactions", () => {
    const result = fxFallbackUsageOf([], observations, "CNY");
    expect(result.completeness).toBe("no-transactions");
    expect(result.available).toBe(false);
    expect(result.unavailableReason).toBe(FX_DRAFT_FALLBACK_UNAVAILABLE_NO_TRANSACTIONS);
  });

  it("G-28b：无折算需求时 available=false（no-conversion-needed），有折算需求时 available=true", () => {
    const identityOnly = fxFallbackUsageOf(
      [record("cny-identity", "CNY", 100n, "2026-10-05")],
      observations,
      "CNY",
    );
    expect(identityOnly.needsConversionCount).toBe(0);
    expect(identityOnly.available).toBe(false);
    expect(identityOnly.unavailableReason).toBe(
      FX_DRAFT_FALLBACK_UNAVAILABLE_NO_CONVERSION_NEEDED,
    );
    expect(identityOnly.fallbackRecordCount).toBe(0);

    const needed = fxFallbackUsageOf(
      [record("usd-1", "USD", 100n, "2026-10-05")],
      observations,
      "CNY",
    );
    expect(needed.needsConversionCount).toBe(1);
    expect(needed.available).toBe(true);
    expect(needed.unavailableReason).toBeNull();
  });

  it("存在回退记录时 available=true 且不带有不可用原因", () => {
    const result = fxFallbackUsageOf(
      [record("usd-fallback", "USD", 100n, "2026-10-05")],
      observations,
      "CNY",
    );
    expect(result.available).toBe(true);
    expect(result.unavailableReason).toBeNull();
  });
});
