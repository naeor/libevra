/**
 * Agent C · P17–P20 real projection 最小批次（DRAFT；S-01 v2 冻结后首个接线批）。
 *
 * 边界（Lead 2026-10-27 冻结通知 / 任务文档 §7 C-Q49）：
 * - **不改** `currencyComposition.ts` / `fxDiagnostics.ts` 的纯函数与口径；
 * - 本层只做「真实数据 → draft 输入」的投影：把权威 FX 引擎（`fx.ts`）的
 *   `FxEntry` / `FxLookup` 快照转换成 `DraftFxRecord` / `DraftFxRateObservation`，
 *   再调用既有纯函数；
 * - 折算语义唯一来源是权威 FX 引擎（`minor-half-away-v1` + 最多 7 天回退）；
 *   本层不查库、不发请求、不自建汇率、不新增第二读取入口；
 * - 区间守卫是**注入**的（集成层接 `useFxRange`/`fxRangeMonths` 适配器）；
 *   本层不自建月数上限；守卫拒绝时返回显式拒绝结果，绝不静默返回部分结果；
 * - `partial` 只来自 P17/P19/P20 的 `missingCount>0`（`unavailable` 仅上游映射）。
 *
 * 本文件是 draft：不进入 `@libellum/shared` 包入口，类型不冻结，待 I-0/D 接入。
 */

import type { FxEntry, FxLookup, FxSnapshot } from "../../fx.js";
import { fxCurrency, fxDate, fxDecimal, validateSnapshot } from "../../fx.js";
import { currencyCompositionOf } from "./currencyComposition.js";
import type {
  DraftCurrencyCompositionResult,
  DraftFxCompleteness,
  DraftFxContributionResult,
  DraftFxCoverageResult,
  DraftFxFallbackResult,
  DraftFxRateObservation,
  DraftFxRateTrendResult,
  DraftFxRecord,
} from "./draftTypes.js";
import {
  fxContributionOf,
  fxCoverageOf,
  fxFallbackUsageOf,
  fxRateTrendOf,
} from "./fxDiagnostics.js";

/** 批次溯源标记：结果携带本批的投影来源（便于集成与回执核对）。 */
export const FX_PROJECTION_BATCH = "p17-p20-real-projection-v1";

/**
 * 唯一区间守卫：由集成层注入（`useFxRange`/`fxRangeMonths` 适配器）。
 * 超限时**必须抛错**且 message 含 `fx_range_too_long`；本层据此显式拒绝。
 */
export type FxProjectionRangeGuard = (from: string, to: string) => void;

export interface FxRealProjectionInput {
  /** 折算目标币（法定三字母大写，如 CNY）。 */
  readonly targetCurrency: string;
  /** resolvedPeriod 闭区间起点（业务日期 YYYY-MM-DD）。 */
  readonly from: string;
  /** resolvedPeriod 闭区间终点（业务日期 YYYY-MM-DD）。 */
  readonly to: string;
  /** 调用方已按账本权限 / 软删 / 日期范围过滤后的权威逐笔条目（同 `aggregateFx` 契约）。 */
  readonly entries: readonly FxEntry[];
  /** 权威读取层产出的逐日快照（唯一读取入口，键=业务日期）。 */
  readonly rates: ReadonlyMap<string, FxLookup>;
  /**
   * 可选：P18 汇率趋势观察。`from/to` 缺省取 resolvedPeriod；
   * 趋势区间是**离散观测窗口**（不是交易区间），不要求落在 resolvedPeriod 内。
   */
  readonly trend?: {
    readonly currency: string;
    readonly from?: string;
    readonly to?: string;
  };
}

export interface FxRealProjectionOptions {
  readonly rangeGuard?: FxProjectionRangeGuard;
  readonly maxFallbackDays?: number;
  readonly maxMissingRecords?: number;
}

export type FxRealProjectionRejection = {
  readonly ok: false;
  readonly reason: "fx_range_too_long" | "unsupported_currency" | "invalid_input";
  readonly detail: string;
};

/** P18 趋势投影：超 400 天等边界由 draft 纯函数显式拒绝，不静默截断。 */
export type FxRateTrendProjection =
  | { readonly ok: true; readonly value: DraftFxRateTrendResult }
  | {
      readonly ok: false;
      readonly reason: "trend_range_too_long" | "invalid_input";
      readonly detail: string;
    };

export interface FxRealProjectionSuccess {
  readonly ok: true;
  readonly provenance: typeof FX_PROJECTION_BATCH;
  readonly from: string;
  readonly to: string;
  readonly targetCurrency: string;
  readonly records: readonly DraftFxRecord[];
  readonly observations: readonly DraftFxRateObservation[];
  /** P16：币种交易构成（只比较笔数，不折算、不混加原币）。 */
  readonly currencyComposition: DraftCurrencyCompositionResult;
  /** P17：综合金额币种贡献（份额分母仅覆盖已折算部分）。 */
  readonly contribution: DraftFxContributionResult;
  /** P19：汇率完整性（币种×日期矩阵）。 */
  readonly coverage: DraftFxCoverageResult;
  /** P20：回退使用（直接命中/回退/缺失）。 */
  readonly fallback: DraftFxFallbackResult;
  /** P18：汇率趋势（可选；未给 `trendCurrency` 时为 null）。 */
  readonly trend: FxRateTrendProjection | null;
  readonly completeness: DraftFxCompleteness;
}

export type FxRealProjectionResult = FxRealProjectionSuccess | FxRealProjectionRejection;

/**
 * 真实逐笔 → draft 记录。金额保持 `bigint` 最小单位，不做任何折算或单位换算。
 */
export function buildFxDraftRecords(entries: readonly FxEntry[]): DraftFxRecord[] {
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    amountMinor: BigInt(entry.amountCents),
    currency: entry.currency,
    occurredLocalDate: entry.occurredLocalDate,
  }));
}

/**
 * 权威快照 → draft 汇率观测（只构造「原币 → 目标币」的有序对）。
 *
 * - 快照 `rates` 为「每 EUR 的币种数」，`EUR` 自身为 `"1"`；
 * - `1 base = numerator/denominator quote`，故 pair(source→target) 的
 *   numerator = fxDecimal(rates[target])、denominator = fxDecimal(rates[source])；
 * - 目标币不在快照中 → 该日无法折算（保持缺失，不构造假汇率）；
 * - 同 (provider, base, quote, date) 重复观测直接判输入错误（不静默取一）。
 */
export function buildFxRateObservations(
  rates: ReadonlyMap<string, FxLookup>,
  targetCurrency: string,
): DraftFxRateObservation[] {
  if (!fxCurrency(targetCurrency)) {
    throw new RangeError(`unsupported_currency: targetCurrency ${JSON.stringify(targetCurrency)}`);
  }
  const observations: DraftFxRateObservation[] = [];
  const seen = new Set<string>();
  for (const lookup of rates.values()) {
    if (lookup.status !== "available") {
      continue;
    }
    const snapshot: FxSnapshot = lookup.snapshot;
    validateSnapshot(snapshot);
    const targetRate = snapshot.rates[targetCurrency];
    if (targetRate === undefined) {
      continue;
    }
    const numerator = fxDecimal(targetRate);
    for (const [sourceCurrency, sourceRate] of Object.entries(snapshot.rates)) {
      if (sourceCurrency === targetCurrency) {
        continue;
      }
      const key = `${snapshot.provider}|${sourceCurrency}|${targetCurrency}|${snapshot.date}`;
      if (seen.has(key)) {
        throw new RangeError(`invalid_input: duplicate fx observation ${key}`);
      }
      seen.add(key);
      observations.push({
        provider: snapshot.provider,
        baseCurrency: sourceCurrency,
        quoteCurrency: targetCurrency,
        rateDate: snapshot.date,
        rateNumerator: numerator,
        rateDenominator: fxDecimal(sourceRate),
      });
    }
  }
  observations.sort(
    (left, right) =>
      (left.rateDate < right.rateDate ? -1 : left.rateDate > right.rateDate ? 1 : 0) ||
      (left.baseCurrency < right.baseCurrency ? -1 : left.baseCurrency > right.baseCurrency ? 1 : 0),
  );
  return observations;
}

/** 投影不变量检查（证据用；不修改结果、不隐藏差异）。 */
export interface FxProjectionChecks {
  /** P17 各行已折算金额之和 == 结果层已折算总额。 */
  readonly rowsDeltaConserved: boolean;
  /** P19 converted+missing == needsConversion；notNeeded+needs == 记录数。 */
  readonly coverageCountsConserved: boolean;
  /** P20 回退计数与 P17 同源。 */
  readonly fallbackCountsConserved: boolean;
  /** P18 趋势只画真实观测（无插值）；未启用趋势时视为通过。 */
  readonly trendNoInterpolation: boolean;
}

export function checkFxProjectionInvariants(result: FxRealProjectionSuccess): FxProjectionChecks {
  const rowConverted = result.contribution.rows.reduce((total, row) => total + row.convertedMinor, 0n);
  const rowConvertedCount = result.contribution.rows.reduce(
    (total, row) => total + BigInt(row.convertedCount),
    0n,
  );
  const rowMissingCount = result.contribution.rows.reduce(
    (total, row) => total + BigInt(row.missingCount),
    0n,
  );
  return {
    rowsDeltaConserved: rowConverted === result.contribution.totalConvertedMinor,
    coverageCountsConserved:
      // P17 的 `convertedCount` 含 identity；P19 的 `convertedCount` 只统计「需要折算且成功」。
      rowConvertedCount - BigInt(result.contribution.identityCount) ===
        BigInt(result.coverage.convertedCount) &&
      BigInt(result.coverage.missingCount) === rowMissingCount &&
      BigInt(result.coverage.convertedCount) + BigInt(result.coverage.missingCount) ===
        BigInt(result.coverage.needsConversionCount) &&
      BigInt(result.coverage.notNeededCount) === BigInt(result.contribution.identityCount) &&
      BigInt(result.coverage.notNeededCount) + BigInt(result.coverage.needsConversionCount) ===
        BigInt(result.records.length),
    fallbackCountsConserved:
      BigInt(result.fallback.fallbackRecordCount) === BigInt(result.contribution.fallbackCount) &&
      BigInt(result.fallback.missingRateCount) === BigInt(result.contribution.missingCount) &&
      result.fallback.fallbackDaysDistribution.reduce(
        (total, bucket) => total + BigInt(bucket.count),
        0n,
      ) === BigInt(result.fallback.fallbackRecordCount),
    trendNoInterpolation: result.trend === null || !result.trend.ok || result.trend.value.interpolation === "none",
  };
}

/**
 * P17–P20 real projection 唯一入口。
 *
 * 顺序：输入校验 → 注入的区间守卫（超限显式拒绝、无部分结果）→ 构造 draft 输入
 * → 调用既有纯函数（P16/P17/P19/P20，可选 P18）→ 不变量自检 → 返回。
 */
export function projectFxDiagnostics(
  input: FxRealProjectionInput,
  options: FxRealProjectionOptions = {},
): FxRealProjectionResult {
  try {
    assertProjectionInput(input);
    if (options.rangeGuard !== undefined) {
      try {
        options.rangeGuard(input.from, input.to);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          reason: detail.includes("fx_range_too_long") ? "fx_range_too_long" : "invalid_input",
          detail,
        };
      }
    }
    if (!fxCurrency(input.targetCurrency)) {
      return {
        ok: false,
        reason: "unsupported_currency",
        detail: `targetCurrency: ${JSON.stringify(input.targetCurrency)}`,
      };
    }
    const records = buildFxDraftRecords(input.entries);
    const observations = buildFxRateObservations(input.rates, input.targetCurrency);
    const lookupOptions =
      options.maxFallbackDays === undefined ? {} : { maxFallbackDays: options.maxFallbackDays };

    const contribution = fxContributionOf(
      records,
      observations,
      input.targetCurrency,
      options.maxMissingRecords === undefined
        ? lookupOptions
        : { ...lookupOptions, maxMissingRecords: options.maxMissingRecords },
    );
    const coverage = fxCoverageOf(records, observations, input.targetCurrency, {
      ...lookupOptions,
      from: input.from,
      to: input.to,
    });
    const fallback = fxFallbackUsageOf(records, observations, input.targetCurrency, lookupOptions);
    const currencyComposition = currencyCompositionOf(records);
    const trend =
      input.trend === undefined
        ? null
        : projectTrend(observations, input.trend, input.targetCurrency, input.from, input.to);

    return {
      ok: true,
      provenance: FX_PROJECTION_BATCH,
      from: input.from,
      to: input.to,
      targetCurrency: input.targetCurrency,
      records,
      observations,
      currencyComposition,
      contribution,
      coverage,
      fallback,
      trend,
      completeness: contribution.completeness,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: detail.includes("unsupported_currency") ? "unsupported_currency" : "invalid_input",
      detail,
    };
  }
}

function assertProjectionInput(input: FxRealProjectionInput): void {
  if (!fxCurrency(input.targetCurrency)) {
    throw new RangeError(`unsupported_currency: targetCurrency ${JSON.stringify(input.targetCurrency)}`);
  }
  if (!fxDate(input.from) || !fxDate(input.to)) {
    throw new RangeError(`invalid_input: from/to must be YYYY-MM-DD (${input.from}..${input.to})`);
  }
  if (input.from > input.to) {
    throw new RangeError(`invalid_input: from ${input.from} is after to ${input.to}`);
  }
  const from = input.from;
  const to = input.to;
  for (const entry of input.entries) {
    if (entry.occurredLocalDate < from || entry.occurredLocalDate > to) {
      throw new RangeError(
        `invalid_input: entry ${entry.id} (${entry.occurredLocalDate}) is outside resolved period ${from}..${to}`,
      );
    }
  }
}

function projectTrend(
  observations: readonly DraftFxRateObservation[],
  spec: { readonly currency: string; readonly from?: string; readonly to?: string },
  targetCurrency: string,
  defaultFrom: string,
  defaultTo: string,
): FxRateTrendProjection {
  const from = spec.from ?? defaultFrom;
  const to = spec.to ?? defaultTo;
  if (!fxCurrency(spec.currency)) {
    return { ok: false, reason: "invalid_input", detail: `trend.currency: ${JSON.stringify(spec.currency)}` };
  }
  if (spec.currency === targetCurrency) {
    return { ok: false, reason: "invalid_input", detail: "trend.currency must differ from targetCurrency" };
  }
  if (!fxDate(from) || !fxDate(to) || from > to) {
    return { ok: false, reason: "invalid_input", detail: `trend window: ${from}..${to}` };
  }
  try {
    return {
      ok: true,
      value: fxRateTrendOf(observations, { currency: spec.currency, targetCurrency, from, to }),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: detail.includes("draft limit") ? "trend_range_too_long" : "invalid_input",
      detail,
    };
  }
}
