/**
 * P17–P20 · 汇率诊断草案（C-4）。
 *
 * 为什么把汇率解析单独抽成一层：P17（综合金额币种贡献）、P19（完整性）、
 * P20（回退使用）共用同一套「交易 → 实际汇率」的判定；如果各分析各写一套，
 * 会出现「同一笔交易在两张卡片里折算成不同金额」——这正是 S-01 要消灭的问题。
 * 因此这里只有一个 `resolveFxRate` 判定入口，其余分析只消费它的结果。
 *
 * 权威边界（owner 规格 §32–§36、§49；S-01 v2 §6.7）：
 * - 真实实现只能复用 S16-D 权威 FX 引擎（逐笔折算、`minor-half-away-v1` 舍入、
 *   最多 7 天向前回退）；本草案用合成「汇率观测夹具」表达同一语义，不接入
 *   新汇率服务、不在图表层发明或插值汇率。
 * - 缺汇率必须显式进入完整性状态，绝不当作 0 参与合计。
 * - P18 只展示系统实际持有的离散观测，不插值补点。
 *
 * 本文件是 **草案**：类型名与字段与 S-01 v2 的 `FXDiagnosticResult`（§6.7）
 * 仍需映射（QC-12 / QC-29），不得被其他 Agent 直接依赖。
 */

import { decimalsFor } from "../../money.js";
import type {
  DraftFxCompleteness,
  DraftFxContributionResult,
  DraftFxContributionRow,
  DraftFxCoverageCell,
  DraftFxCoverageResult,
  DraftFxCoverageRow,
  DraftFxFallbackResult,
  DraftFxFallbackRow,
  DraftFxRateObservation,
  DraftFxRatePoint,
  DraftFxRateResolution,
  DraftFxRateTrendResult,
  DraftFxRecord,
  DraftScaledDecimal,
} from "./draftTypes.js";
import { makeRational } from "./rational.js";
import type { DraftRational } from "./draftTypes.js";

/** 与 S16-D 的 `FX_MAX_FALLBACK_DAYS` 一致：向前回退最多 7 个自然日。 */
export const FX_DRAFT_MAX_FALLBACK_DAYS = 7;

/** 汇率展示精度（只用于展示，权威值仍是分子/分母）。 */
export const FX_DRAFT_RATE_DECIMALS = 6;

/** 汇率趋势一次最多检查的自然日数量（与统计查询 `MAX_STATS_DAYS` 同量级）。 */
export const FX_DRAFT_MAX_TREND_DAYS = 400;

/** 单次贡献结果最多回传的缺失记录条数（总数仍以 missingCount 为准）。 */
export const FX_DRAFT_MAX_MISSING_RECORDS = 200;

/** 金额覆盖率不可用的原因（P19 必须显式写出来，不能含糊）。 */
export const FX_DRAFT_AMOUNT_COVERAGE_REASON =
  "首版只统计「记录覆盖率」；金额覆盖率需要以权威折算金额口径另行设计（owner 规格 §35），不在 C-4 草案内。";

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

/** 汇率折算选项（只影响回退窗口；默认 7 天）。 */
export interface FxLookupOptions {
  readonly maxFallbackDays?: number;
}

/** 完整性矩阵选项：可显式给日期窗口，否则取记录的最早/最晚业务日期。 */
export interface FxCoverageOptions extends FxLookupOptions {
  readonly from?: string;
  readonly to?: string;
}

/** 币种贡献选项。 */
export interface FxContributionOptions extends FxLookupOptions {
  readonly maxMissingRecords?: number;
}

/** 汇率趋势查询参数。 */
export interface FxRateTrendSpec {
  readonly currency: string;
  readonly targetCurrency: string;
  readonly from: string;
  readonly to: string;
}

/* ------------------------------------------------------------------------- *
 * 基础校验与日期算术
 * ------------------------------------------------------------------------- */

function assertCurrency(currency: string): string {
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new RangeError(`Currency must be three upper-case letters: ${JSON.stringify(currency)}`);
  }
  return currency;
}

/**
 * 业务日期 → 自 1970-01-01 起的自然日序号。
 *
 * @throws {RangeError} 不是真实日历日（含 2025-02-30、月份越界、格式错误）。
 */
export function fxDayNumber(date: string): number {
  const match = CALENDAR_DATE_PATTERN.exec(date);
  if (!match) {
    throw new RangeError(`Not a calendar date (YYYY-MM-DD expected): ${JSON.stringify(date)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const milliseconds = Date.UTC(year, month - 1, day);
  const check = new Date(milliseconds);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`Not a real calendar date: ${JSON.stringify(date)}`);
  }
  return Math.round(milliseconds / MILLISECONDS_PER_DAY);
}

/** 校验业务日期字符串（返回原值，便于链式使用）。 */
export function fxAssertDate(date: string): string {
  fxDayNumber(date);
  return date;
}

/** 自然日序号 → `YYYY-MM-DD`。 */
export function fxDateFromDayNumber(day: number): string {
  if (!Number.isInteger(day)) {
    throw new RangeError(`Day number must be an integer: ${String(day)}`);
  }
  const date = new Date(day * MILLISECONDS_PER_DAY);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

/** 业务日期向前/向后移动若干自然日。 */
export function fxAddDays(date: string, delta: number): string {
  if (!Number.isInteger(delta)) {
    throw new RangeError(`Day delta must be an integer: ${String(delta)}`);
  }
  return fxDateFromDayNumber(fxDayNumber(date) + delta);
}

/**
 * 枚举 `[from, to]` 之间的全部自然日（含两端），按日期升序。
 *
 * @throws {RangeError} from 晚于 to，或区间超过 {@link FX_DRAFT_MAX_TREND_DAYS}。
 */
export function fxCalendarDatesBetween(from: string, to: string): readonly string[] {
  const start = fxDayNumber(from);
  const end = fxDayNumber(to);
  if (end < start) {
    throw new RangeError(`fxCalendarDatesBetween: from ${from} is after to ${to}`);
  }
  const count = end - start + 1;
  if (count > FX_DRAFT_MAX_TREND_DAYS) {
    throw new RangeError(
      `fxCalendarDatesBetween: ${String(count)} days exceeds the draft limit of ${String(FX_DRAFT_MAX_TREND_DAYS)}`,
    );
  }
  const dates: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    dates.push(fxDateFromDayNumber(start + offset));
  }
  return dates;
}

/** 校验一条 P16–P20 交易视图。 */
export function assertFxRecord(record: DraftFxRecord): void {
  if (record.id.length === 0) {
    throw new RangeError("DraftFxRecord.id must be a non-empty string");
  }
  if (record.kind !== "expense" && record.kind !== "income") {
    throw new RangeError(`DraftFxRecord.kind must be expense or income: ${String(record.kind)}`);
  }
  if (record.amountMinor < 0n) {
    throw new RangeError(
      "DraftFxRecord.amountMinor must be non-negative; refunds are expressed through authoritative rules, not negative entries",
    );
  }
  assertCurrency(record.currency);
  fxAssertDate(record.occurredLocalDate);
}

/* ------------------------------------------------------------------------- *
 * 精确舍入与折算
 * ------------------------------------------------------------------------- */

/**
 * 有理数 → 最小单位整数，`minor-half-away-v1`（与 S-01 / S16-D 一致）。
 *
 * @throws {RangeError} 分母不为正。
 */
export function roundHalfAwayMinor(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError("roundHalfAwayMinor: denominator must be positive");
  }
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * 按精确汇率把「源币最小单位」折算成「目标币最小单位」，逐笔舍入。
 *
 * 语义：1 个 base 主单位 = `rateNumerator / rateDenominator` 个 quote 主单位；
 * 主单位与最小单位之间按各币种小数位换算（JPY 0 位、CNY 2 位…）。
 *
 * @throws {RangeError} 金额/汇率非法，或币种非法。
 */
export function convertMinorAtRate(
  amountMinor: bigint,
  rateNumerator: bigint,
  rateDenominator: bigint,
  baseCurrency: string,
  targetCurrency: string,
): bigint {
  if (amountMinor < 0n) {
    throw new RangeError("convertMinorAtRate: amountMinor must be non-negative");
  }
  if (rateNumerator <= 0n || rateDenominator <= 0n) {
    throw new RangeError("convertMinorAtRate: rate must be a positive fraction");
  }
  const baseDecimals = decimalsFor(assertCurrency(baseCurrency));
  const targetDecimals = decimalsFor(assertCurrency(targetCurrency));
  const targetScale = 10n ** BigInt(targetDecimals);
  const baseScale = 10n ** BigInt(baseDecimals);
  return roundHalfAwayMinor(
    amountMinor * rateNumerator * targetScale,
    rateDenominator * baseScale,
  );
}

/* ------------------------------------------------------------------------- *
 * 汇率观测索引与解析
 * ------------------------------------------------------------------------- */

function observationKey(baseCurrency: string, quoteCurrency: string, rateDate: string): string {
  return `${baseCurrency}|${quoteCurrency}|${rateDate}`;
}

/**
 * 建立「base|quote|date → 观测」索引。
 *
 * @throws {RangeError} 观测字段非法、币种相同，或同一键出现互相矛盾的汇率。
 */
export function makeFxRateIndex(
  observations: readonly DraftFxRateObservation[],
): ReadonlyMap<string, DraftFxRateObservation> {
  const index = new Map<string, DraftFxRateObservation>();
  for (const observation of observations) {
    assertCurrency(observation.baseCurrency);
    assertCurrency(observation.quoteCurrency);
    if (observation.baseCurrency === observation.quoteCurrency) {
      throw new RangeError("makeFxRateIndex: base and quote currency must differ");
    }
    fxAssertDate(observation.rateDate);
    if (observation.rateNumerator <= 0n || observation.rateDenominator <= 0n) {
      throw new RangeError("makeFxRateIndex: rate must be a positive fraction");
    }
    const key = observationKey(observation.baseCurrency, observation.quoteCurrency, observation.rateDate);
    const existing = index.get(key);
    if (existing !== undefined) {
      if (
        existing.rateNumerator !== observation.rateNumerator ||
        existing.rateDenominator !== observation.rateDenominator
      ) {
        throw new RangeError(`makeFxRateIndex: ambiguous observations for ${key}`);
      }
      continue;
    }
    index.set(key, observation);
  }
  return index;
}

function normaliseMaxFallbackDays(value: number | undefined): number {
  const maxFallbackDays = value ?? FX_DRAFT_MAX_FALLBACK_DAYS;
  if (!Number.isInteger(maxFallbackDays) || maxFallbackDays < 0) {
    throw new RangeError(`maxFallbackDays must be a non-negative integer: ${String(value)}`);
  }
  return maxFallbackDays;
}

function resolveWithIndex(
  record: DraftFxRecord,
  index: ReadonlyMap<string, DraftFxRateObservation>,
  targetCurrency: string,
  maxFallbackDays: number,
): DraftFxRateResolution {
  const requestedDate = record.occurredLocalDate;
  if (record.currency === targetCurrency) {
    return {
      currency: record.currency,
      targetCurrency,
      requestedDate,
      rateDate: requestedDate,
      fallbackDays: 0,
      provider: null,
      rateNumerator: null,
      rateDenominator: null,
      status: "identity",
    };
  }
  const direct = index.get(observationKey(record.currency, targetCurrency, requestedDate));
  if (direct !== undefined) {
    return {
      currency: record.currency,
      targetCurrency,
      requestedDate,
      rateDate: direct.rateDate,
      fallbackDays: 0,
      provider: direct.provider,
      rateNumerator: direct.rateNumerator,
      rateDenominator: direct.rateDenominator,
      status: "exact",
    };
  }
  for (let days = 1; days <= maxFallbackDays; days += 1) {
    const candidateDate = fxAddDays(requestedDate, -days);
    const observation = index.get(observationKey(record.currency, targetCurrency, candidateDate));
    if (observation !== undefined) {
      return {
        currency: record.currency,
        targetCurrency,
        requestedDate,
        rateDate: observation.rateDate,
        fallbackDays: days,
        provider: observation.provider,
        rateNumerator: observation.rateNumerator,
        rateDenominator: observation.rateDenominator,
        status: "fallback",
      };
    }
  }
  return {
    currency: record.currency,
    targetCurrency,
    requestedDate,
    rateDate: null,
    fallbackDays: null,
    provider: null,
    rateNumerator: null,
    rateDenominator: null,
    status: "missing",
  };
}

/**
 * 解析单笔交易实际使用的汇率：同币种 → identity；当天命中 → exact；
 * 向前最多 `maxFallbackDays` 天命中 → fallback；否则 missing。
 *
 * @throws {RangeError} 记录/汇率观测/选项非法。
 */
export function resolveFxRate(
  record: DraftFxRecord,
  observations: readonly DraftFxRateObservation[],
  targetCurrency: string,
  options: FxLookupOptions = {},
): DraftFxRateResolution {
  assertFxRecord(record);
  assertCurrency(targetCurrency);
  const index = makeFxRateIndex(observations);
  return resolveWithIndex(record, index, targetCurrency, normaliseMaxFallbackDays(options.maxFallbackDays));
}

/* ------------------------------------------------------------------------- *
 * P17 · 综合金额币种贡献
 * ------------------------------------------------------------------------- */

interface ContributionAccumulator {
  currency: string;
  originalSumMinor: bigint;
  convertedMinor: bigint;
  convertedCount: number;
  missingCount: number;
  fallbackCount: number;
}

function contributionCompleteness(
  recordCount: number,
  missingCount: number,
): DraftFxCompleteness {
  if (recordCount === 0) {
    return "no-transactions";
  }
  return missingCount > 0 ? "partial" : "complete";
}

/**
 * P17：综合折算模式下，按「原始币种」分组统计各自对已折算总额的贡献。
 *
 * 约束（owner 规格 §33）：
 * - 每笔交易复用同一权威折算口径；本函数只做「分组 + 求和 + 份额」；
 * - 缺汇率的记录单独计数、不折算成 0，份额分母只覆盖已折算金额；
 * - 各币种折算合计必须与同口径综合总额一致（调用方用 `totalConvertedMinor`
 *   与权威引擎的输出核对，本函数不引入第二套总额）。
 */
export function fxContributionOf(
  records: readonly DraftFxRecord[],
  observations: readonly DraftFxRateObservation[],
  targetCurrency: string,
  options: FxContributionOptions = {},
): DraftFxContributionResult {
  const target = assertCurrency(targetCurrency);
  const maxFallbackDays = normaliseMaxFallbackDays(options.maxFallbackDays);
  const maxMissingRecords = options.maxMissingRecords ?? FX_DRAFT_MAX_MISSING_RECORDS;
  if (!Number.isInteger(maxMissingRecords) || maxMissingRecords < 0) {
    throw new RangeError(`maxMissingRecords must be a non-negative integer: ${String(options.maxMissingRecords)}`);
  }
  const index = makeFxRateIndex(observations);
  const accumulators = new Map<string, ContributionAccumulator>();
  const missingRecords: { id: string; currency: string; occurredLocalDate: string }[] = [];
  let convertedCount = 0;
  let identityCount = 0;
  let fallbackCount = 0;
  let missingCount = 0;

  for (const record of records) {
    assertFxRecord(record);
    let accumulator = accumulators.get(record.currency);
    if (accumulator === undefined) {
      accumulator = {
        currency: record.currency,
        originalSumMinor: 0n,
        convertedMinor: 0n,
        convertedCount: 0,
        missingCount: 0,
        fallbackCount: 0,
      };
      accumulators.set(record.currency, accumulator);
    }
    accumulator.originalSumMinor += record.amountMinor;

    const resolution = resolveWithIndex(record, index, target, maxFallbackDays);
    if (resolution.status === "missing") {
      accumulator.missingCount += 1;
      missingCount += 1;
      if (missingRecords.length < maxMissingRecords) {
        missingRecords.push({
          id: record.id,
          currency: record.currency,
          occurredLocalDate: record.occurredLocalDate,
        });
      }
      continue;
    }

    const convertedMinor =
      resolution.status === "identity"
        ? record.amountMinor
        : convertMinorAtRate(
            record.amountMinor,
            resolution.rateNumerator ?? 0n,
            resolution.rateDenominator ?? 1n,
            record.currency,
            target,
          );

    accumulator.convertedMinor += convertedMinor;
    accumulator.convertedCount += 1;
    convertedCount += 1;
    if (resolution.status === "identity") {
      identityCount += 1;
    }
    if (resolution.status === "fallback") {
      accumulator.fallbackCount += 1;
      fallbackCount += 1;
    }
  }

  const totalConvertedMinor = [...accumulators.values()].reduce(
    (sum, accumulator) => sum + accumulator.convertedMinor,
    0n,
  );

  const rows: DraftFxContributionRow[] = [...accumulators.values()]
    .sort((left, right) => {
      if (left.convertedMinor !== right.convertedMinor) {
        return left.convertedMinor > right.convertedMinor ? -1 : 1;
      }
      return left.currency < right.currency ? -1 : left.currency > right.currency ? 1 : 0;
    })
    .map((accumulator) => ({
      currency: accumulator.currency,
      originalSumMinor: accumulator.originalSumMinor,
      convertedMinor: accumulator.convertedMinor,
      convertedCount: accumulator.convertedCount,
      missingCount: accumulator.missingCount,
      fallbackCount: accumulator.fallbackCount,
      shareOfConverted:
        totalConvertedMinor === 0n
          ? null
          : makeRational(accumulator.convertedMinor, totalConvertedMinor),
    }));

  return {
    targetCurrency: target,
    rows,
    totalConvertedMinor,
    convertedCount,
    identityCount,
    fallbackCount,
    missingCount,
    sharesOverConvertedOnly: true,
    missingRecords,
    missingRecordsTruncated: missingRecords.length < missingCount,
    completeness: contributionCompleteness(records.length, missingCount),
  };
}

/* ------------------------------------------------------------------------- *
 * P18 · 汇率历史趋势（只展示离散观测）
 * ------------------------------------------------------------------------- */

function pointOf(observation: DraftFxRateObservation, targetCurrency: string): DraftFxRatePoint {
  const scale = 10n ** BigInt(FX_DRAFT_RATE_DECIMALS);
  const scaled: DraftScaledDecimal = {
    scaled: roundHalfAwayMinor(observation.rateNumerator * scale, observation.rateDenominator),
    decimals: FX_DRAFT_RATE_DECIMALS,
  };
  return {
    currency: observation.baseCurrency,
    targetCurrency,
    rateDate: observation.rateDate,
    provider: observation.provider,
    rateNumerator: observation.rateNumerator,
    rateDenominator: observation.rateDenominator,
    rateScaled: scaled,
  };
}

function compareRatePoints(left: DraftFxRatePoint, right: DraftFxRatePoint): -1 | 0 | 1 {
  const leftScaled = left.rateNumerator * right.rateDenominator;
  const rightScaled = right.rateNumerator * left.rateDenominator;
  if (leftScaled < rightScaled) {
    return -1;
  }
  if (leftScaled > rightScaled) {
    return 1;
  }
  return 0;
}

/**
 * P18：展示 `[from, to]` 内系统实际持有的离散汇率观测。
 *
 * 约束（owner 规格 §34）：不插值、不补点、不把回退汇率当作市场汇率；
 * 缺失日期只计数回传，不生成占位点。
 *
 * @throws {RangeError} 币种相同、区间非法或超过 {@link FX_DRAFT_MAX_TREND_DAYS}。
 */
export function fxRateTrendOf(
  observations: readonly DraftFxRateObservation[],
  spec: FxRateTrendSpec,
): DraftFxRateTrendResult {
  const currency = assertCurrency(spec.currency);
  const targetCurrency = assertCurrency(spec.targetCurrency);
  if (currency === targetCurrency) {
    throw new RangeError("fxRateTrendOf: currency and targetCurrency must differ");
  }
  const dates = fxCalendarDatesBetween(spec.from, spec.to);
  const index = makeFxRateIndex(observations);
  const points: DraftFxRatePoint[] = [];
  const missingDates: string[] = [];
  for (const date of dates) {
    const observation = index.get(observationKey(currency, targetCurrency, date));
    if (observation === undefined) {
      missingDates.push(date);
      continue;
    }
    points.push(pointOf(observation, targetCurrency));
  }

  const first = points[0];
  const last = points[points.length - 1];
  const change: DraftRational | null =
    first === undefined || last === undefined
      ? null
      : makeRational(
          last.rateNumerator * first.rateDenominator - first.rateNumerator * last.rateDenominator,
          first.rateNumerator * last.rateDenominator,
        );

  let minPoint = first ?? null;
  let maxPoint = first ?? null;
  for (const point of points) {
    if (minPoint === null || compareRatePoints(point, minPoint) < 0) {
      minPoint = point;
    }
    if (maxPoint === null || compareRatePoints(point, maxPoint) > 0) {
      maxPoint = point;
    }
  }

  return {
    currency,
    targetCurrency,
    points,
    from: spec.from,
    to: spec.to,
    observationCount: points.length,
    missingDateCount: missingDates.length,
    missingDates,
    interpolation: "none",
    change,
    minPoint,
    maxPoint,
    completeness: points.length === 0 ? "unavailable" : "complete",
  };
}

/* ------------------------------------------------------------------------- *
 * P19 · 完整性（币种 × 日期）
 * ------------------------------------------------------------------------- */

interface CoverageAccumulator {
  currency: string;
  recordCount: number;
  convertedCount: number;
  missingCount: number;
  exactCount: number;
  fallbackCount: number;
  needsConversion: boolean;
}

/**
 * P19：按「币种 × 日期」统计折算完整性。
 *
 * 约束（owner 规格 §35）：
 * - 完整性是「记录覆盖率」，不等于金额覆盖率（首版不提供金额覆盖率并写明原因）；
 * - 缺失的「币种 × 日期」组合必须显式列出，不得用空白或零掩盖；
 * - 状态判定复用 {@link resolveFxRate}，与 P17/P20 完全一致。
 */
export function fxCoverageOf(
  records: readonly DraftFxRecord[],
  observations: readonly DraftFxRateObservation[],
  targetCurrency: string,
  options: FxCoverageOptions = {},
): DraftFxCoverageResult {
  const target = assertCurrency(targetCurrency);
  const maxFallbackDays = normaliseMaxFallbackDays(options.maxFallbackDays);
  const index = makeFxRateIndex(observations);

  const recordDates: string[] = [];
  for (const record of records) {
    assertFxRecord(record);
    recordDates.push(record.occurredLocalDate);
  }
  const sortedRecordDates = [...new Set(recordDates)].sort();

  const earliest = sortedRecordDates[0];
  const latest = sortedRecordDates[sortedRecordDates.length - 1];
  const from = options.from ?? earliest;
  const to = options.to ?? latest;
  const dates =
    from === undefined || to === undefined
      ? []
      : fxCalendarDatesBetween(from, to);

  const accumulators = new Map<string, CoverageAccumulator>();
  const cellAccumulators = new Map<string, { currency: string; date: string; status: DraftFxCoverageCell["status"]; recordCount: number }>();
  let needsConversionCount = 0;
  let convertedCount = 0;
  let missingCount = 0;
  let exactCount = 0;
  let fallbackCount = 0;
  let notNeededCount = 0;

  for (const record of records) {
    let accumulator = accumulators.get(record.currency);
    if (accumulator === undefined) {
      accumulator = {
        currency: record.currency,
        recordCount: 0,
        convertedCount: 0,
        missingCount: 0,
        exactCount: 0,
        fallbackCount: 0,
        needsConversion: record.currency !== target,
      };
      accumulators.set(record.currency, accumulator);
    }
    accumulator.recordCount += 1;

    const resolution = resolveWithIndex(record, index, target, maxFallbackDays);
    const status: DraftFxCoverageCell["status"] =
      resolution.status === "identity"
        ? "not-needed"
        : resolution.status === "exact"
          ? "exact"
          : resolution.status === "fallback"
            ? "fallback"
            : "missing";
    const cellKey = `${record.currency}|${record.occurredLocalDate}`;
    const cell = cellAccumulators.get(cellKey);
    if (cell === undefined) {
      cellAccumulators.set(cellKey, {
        currency: record.currency,
        date: record.occurredLocalDate,
        status,
        recordCount: 1,
      });
    } else {
      cell.recordCount += 1;
    }

    if (record.currency === target) {
      notNeededCount += 1;
      continue;
    }
    needsConversionCount += 1;
    if (resolution.status === "missing") {
      accumulator.missingCount += 1;
      missingCount += 1;
      continue;
    }
    accumulator.convertedCount += 1;
    convertedCount += 1;
    if (resolution.status === "exact") {
      accumulator.exactCount += 1;
      exactCount += 1;
    }
    if (resolution.status === "fallback") {
      accumulator.fallbackCount += 1;
      fallbackCount += 1;
    }
  }

  const rows: DraftFxCoverageRow[] = [...accumulators.values()]
    .sort((left, right) =>
      left.currency < right.currency ? -1 : left.currency > right.currency ? 1 : 0,
    )
    .map((accumulator) => ({
      currency: accumulator.currency,
      recordCount: accumulator.recordCount,
      convertedCount: accumulator.convertedCount,
      missingCount: accumulator.missingCount,
      exactCount: accumulator.exactCount,
      fallbackCount: accumulator.fallbackCount,
      coverage: accumulator.needsConversion
        ? makeRational(
            BigInt(accumulator.convertedCount),
            BigInt(accumulator.convertedCount + accumulator.missingCount),
          )
        : null,
    }));

  const cells: DraftFxCoverageCell[] = [...cellAccumulators.values()]
    .sort((left, right) =>
      left.currency < right.currency
        ? -1
        : left.currency > right.currency
          ? 1
          : left.date < right.date
            ? -1
            : left.date > right.date
              ? 1
              : 0,
    )
    .map((cell) => ({ ...cell }));

  const missingCombinations = cells
    .filter((cell) => cell.status === "missing")
    .map((cell) => ({ currency: cell.currency, date: cell.date, recordCount: cell.recordCount }));

  return {
    targetCurrency: target,
    currencies: [...accumulators.keys()].sort(),
    dates,
    cells,
    needsConversionCount,
    convertedCount,
    missingCount,
    exactCount,
    fallbackCount,
    notNeededCount,
    coverageRatio: needsConversionCount === 0 ? null : makeRational(BigInt(convertedCount), BigInt(needsConversionCount)),
    amountCoverageAvailable: false,
    amountCoverageReason: FX_DRAFT_AMOUNT_COVERAGE_REASON,
    missingCombinations,
    rows,
    completeness: contributionCompleteness(records.length, missingCount),
  };
}

/* ------------------------------------------------------------------------- *
 * P20 · 回退使用分析
 * ------------------------------------------------------------------------- */

interface FallbackAccumulator {
  currency: string;
  directCount: number;
  fallbackCount: number;
  missingCount: number;
  fallbackDays: { fallbackDays: number; count: number }[];
}

/**
 * P20：统计回退策略的实际使用情况（直接命中/回退/缺失、回退天数分布、
 * 来源与日期）。没有可靠回退元数据时调用方不得渲染本形状的「零回退」
 * 结论——本函数只对传入的观测夹具负责。
 *
 * 约束（owner 规格 §36）：不得反推「肯定使用过回退」。
 */
export function fxFallbackUsageOf(
  records: readonly DraftFxRecord[],
  observations: readonly DraftFxRateObservation[],
  targetCurrency: string,
  options: FxLookupOptions = {},
): DraftFxFallbackResult {
  const target = assertCurrency(targetCurrency);
  const maxFallbackDays = normaliseMaxFallbackDays(options.maxFallbackDays);
  const index = makeFxRateIndex(observations);

  const rowsByCurrency = new Map<string, FallbackAccumulator>();
  const fallbackDaysCounts = new Map<number, number>();
  const providerCounts = new Map<string, number>();
  const dateCounts = new Map<string, number>();
  let needsConversionCount = 0;
  let fallbackRecordCount = 0;
  let missingRateCount = 0;

  for (const record of records) {
    assertFxRecord(record);
    if (record.currency === target) {
      continue;
    }
    needsConversionCount += 1;
    const resolution = resolveWithIndex(record, index, target, maxFallbackDays);
    let row = rowsByCurrency.get(record.currency);
    if (row === undefined) {
      row = {
        currency: record.currency,
        directCount: 0,
        fallbackCount: 0,
        missingCount: 0,
        fallbackDays: [],
      };
      rowsByCurrency.set(record.currency, row);
    }
    if (resolution.status === "missing") {
      row.missingCount += 1;
      missingRateCount += 1;
      continue;
    }
    if (resolution.status === "exact") {
      row.directCount += 1;
      continue;
    }
    row.fallbackCount += 1;
    fallbackRecordCount += 1;
    const days = resolution.fallbackDays ?? 0;
    fallbackDaysCounts.set(days, (fallbackDaysCounts.get(days) ?? 0) + 1);
    const daysEntry = row.fallbackDays.find((entry) => entry.fallbackDays === days);
    if (daysEntry === undefined) {
      row.fallbackDays.push({ fallbackDays: days, count: 1 });
    } else {
      daysEntry.count += 1;
    }
    if (resolution.provider !== null) {
      providerCounts.set(resolution.provider, (providerCounts.get(resolution.provider) ?? 0) + 1);
    }
    dateCounts.set(record.occurredLocalDate, (dateCounts.get(record.occurredLocalDate) ?? 0) + 1);
  }

  const rows: DraftFxFallbackRow[] = [...rowsByCurrency.values()]
    .sort((left, right) =>
      left.currency < right.currency ? -1 : left.currency > right.currency ? 1 : 0,
    )
    .map((row) => ({
      ...row,
      fallbackDays: [...row.fallbackDays].sort((left, right) => left.fallbackDays - right.fallbackDays),
    }));

  const fallbackDaysDistribution = [...fallbackDaysCounts.entries()]
    .map(([fallbackDays, count]) => ({ fallbackDays, count }))
    .sort((left, right) => left.fallbackDays - right.fallbackDays);

  const providers = [...providerCounts.entries()]
    .map(([provider, count]) => ({ provider, count }))
    .sort((left, right) =>
      left.count !== right.count ? right.count - left.count : left.provider < right.provider ? -1 : 1,
    );

  const dates = [...dateCounts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));

  return {
    targetCurrency: target,
    fallbackRecordCount,
    needsConversionCount,
    maxFallbackDays: fallbackDaysDistribution.reduce(
      (max, entry) => Math.max(max, entry.fallbackDays),
      0,
    ),
    fallbackDaysDistribution,
    rows,
    providers,
    dates,
    missingRateCount,
    completeness: contributionCompleteness(records.length, missingRateCount),
  };
}
