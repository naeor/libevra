import { CURRENCIES, type Currency } from "./ledger.js";
import { decimalsFor } from "./money.js";

/** 派生规则版本；不写回流水。参考汇率是每 EUR 的主币单位数。 */
export const FX_POLICY = "minor-half-away-v1";
export const FX_MAX_FALLBACK_DAYS = 7;
/** 月键范围上限（S-01 v2 draft，B-S01v2-02；对齐 S-01 §17.1(a) 暂记 36，待所有者确认 Q-BA-12a/G-09）。 */
export const FX_MAX_RANGE_MONTHS = 36;
/** 逐笔投影上限（S-01 v2 draft，B-S01v2-01）；超限显式报错，不截断。 */
export const FX_MAX_DETAIL_ENTRIES = 50_000;
export type FxReason = "invalid_input" | "unsupported_currency" | "missing_rate"
  | "invalid_rate" | "conflict" | "anomaly" | "timeout" | "network" | "api_error" | "storage_error";
export interface FxSnapshot {
  readonly base: "EUR";
  readonly date: string;
  readonly provider: string;
  readonly revision: string;
  readonly fetchedAt: string;
  readonly rates: Readonly<Record<string, string>>;
}
export interface FxEntry {
  readonly id: string;
  readonly bookId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly occurredLocalDate: string;
  readonly kind: "income" | "expense";
  readonly categoryId: string;
  readonly version?: number;
}
export interface FxReview { readonly checkedAt: string; readonly needsReview: boolean; readonly nextCheckAt: string; }
export type FxLookup = { readonly status: "available"; readonly snapshot: FxSnapshot; readonly cached: boolean; readonly review?: FxReview }
  | { readonly status: "unavailable"; readonly reason: FxReason };
export interface FxResult {
  readonly originalMinor: number;
  readonly originalCurrency: string;
  readonly targetCurrency: string;
  readonly requestedDate: string;
  readonly status: "converted" | "identity" | "unavailable";
  readonly convertedMinor: string | null;
  readonly reason: FxReason | null;
  /** 精确有理数，目标主币单位 / 来源主币单位；避免截断汇率后再算金额。 */
  readonly rate: { readonly numerator: string; readonly denominator: string } | null;
  readonly rateDate: string | null;
  readonly provider: string | null;
  readonly revision: string | null;
  readonly rateCached: boolean;
  readonly resultCached: boolean;
  readonly review: FxReview | null;
  readonly policy: string;
}
export function fxDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function fxCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}
/** 提供方小数最多 12 位；全程使用 BigInt，不经过二进制浮点乘除。 */
export function fxDecimal(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,12})?$/.test(value)) throw new Error("invalid_rate");
  const [whole = "0", fraction = ""] = value.split(".");
  const parsed = BigInt(whole) * 10n ** 12n + BigInt(fraction.padEnd(12, "0"));
  if (parsed <= 0n) throw new Error("invalid_rate");
  return parsed;
}
export function validateSnapshot(snapshot: FxSnapshot): void {
  if (snapshot.base !== "EUR" || !fxDate(snapshot.date) || !snapshot.provider || !snapshot.revision
    || snapshot.provider.length > 100 || snapshot.revision.length > 128
    || !Number.isFinite(Date.parse(snapshot.fetchedAt)) || snapshot.rates["EUR"] !== "1") throw new Error("invalid_rate");
  for (const [currency, value] of Object.entries(snapshot.rates)) {
    if (!fxCurrency(currency)) throw new Error("unsupported_currency");
    fxDecimal(value);
  }
}
/** 公共持久层白名单投影，额外属性不能意外携带财务数据。 */
export function copyFxSnapshot(snapshot: FxSnapshot): FxSnapshot {
  validateSnapshot(snapshot);
  return { base: "EUR", date: snapshot.date, provider: snapshot.provider, revision: snapshot.revision,
    fetchedAt: snapshot.fetchedAt, rates: Object.fromEntries(Object.entries(snapshot.rates)) };
}
export function rateAge(requested: string, actual: string): number {
  return (Date.parse(`${requested}T00:00:00Z`) - Date.parse(`${actual}T00:00:00Z`)) / 86400000;
}

/**
 * 含首尾月份的 `YYYY-MM` 枚举（S-01 v2 draft，B-S01v2-02）。
 * 月键比较不设日上限（S-01 §17.1(a)）；月份数超过 `maxMonths`（默认 36）抛 `fx_range_too_long`，不截断。
 */
export function fxRangeMonths(from: string, to: string, maxMonths: number = FX_MAX_RANGE_MONTHS): string[] {
  if (!fxDate(from) || !fxDate(to) || from > to) throw new Error("fx_range_invalid");
  if (!Number.isSafeInteger(maxMonths) || maxMonths < 1 || maxMonths > 1200) throw new RangeError("fx_range_limit");
  const result: string[] = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7);) {
    result.push(month);
    if (result.length > maxMonths) throw new Error("fx_range_too_long");
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    month = date.toISOString().slice(0, 7);
  }
  return result;
}

export function convertFx(entry: FxEntry, target: string, lookup?: FxLookup): FxResult {
  const result: FxResult = {
    originalMinor: entry.amountCents, originalCurrency: entry.currency, targetCurrency: target,
    requestedDate: entry.occurredLocalDate, status: "unavailable", convertedMinor: null, reason: null,
    rate: null, rateDate: null, provider: null, revision: null, rateCached: false, resultCached: false, review: null, policy: FX_POLICY,
  };
  const unavailable = (reason: FxReason): FxResult => ({ ...result, reason });
  // 既有流水语义：金额非负，收入/支出由 kind 表达；退款不擅自引入负流水。
  if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents < 0 || !fxDate(entry.occurredLocalDate)
    || !["income", "expense"].includes(entry.kind)) return unavailable("invalid_input");
  if (!fxCurrency(entry.currency) || !fxCurrency(target)) return unavailable("unsupported_currency");
  if (entry.currency === target) return { ...result, status: "identity", convertedMinor: String(entry.amountCents), rate: { numerator: "1", denominator: "1" } };
  if (!lookup || lookup.status === "unavailable") return unavailable(lookup?.reason ?? "missing_rate");
  const snapshot = lookup.snapshot;
  try { validateSnapshot(snapshot); } catch { return unavailable("invalid_rate"); }
  const age = rateAge(entry.occurredLocalDate, snapshot.date);
  if (age < 0 || age > FX_MAX_FALLBACK_DAYS) return unavailable("missing_rate");
  const source = snapshot.rates[entry.currency], quote = snapshot.rates[target];
  if (!source || !quote) return unavailable("missing_rate");
  const numerator = fxDecimal(quote), denominator = fxDecimal(source);
  const n = BigInt(entry.amountCents) * numerator * 10n ** BigInt(decimalsFor(target));
  const d = denominator * 10n ** BigInt(decimalsFor(entry.currency));
  const rounded = (n * 2n + d) / (2n * d);
  return { ...result, status: "converted", convertedMinor: rounded.toString(),
    rate: { numerator: numerator.toString(), denominator: denominator.toString() }, rateDate: snapshot.date,
    provider: snapshot.provider, revision: snapshot.revision, rateCached: lookup.cached, review: lookup.review ?? null };
}

/** 有界 LRU，只存派生结果；实例只能由上层在已授权的会话中持有。 */
export class FxResultCache {
  private readonly values = new Map<string, FxResult>();
  constructor(readonly capacity = 5000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("capacity");
  }
  get size(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  convert(accountId: string, bookId: string, entry: FxEntry, target: string, lookup?: FxLookup): FxResult {
    if (!accountId || !bookId || entry.bookId !== bookId) throw new Error("fx_scope_mismatch");
    // 包含实际汇率内容，防止相同 revision 的冲突数据复用旧结果。
    const key = JSON.stringify([accountId, bookId, entry.id, entry.version, entry.amountCents, entry.currency,
      entry.occurredLocalDate, entry.kind, target, FX_POLICY, lookup]);
    const cached = this.values.get(key);
    if (cached) {
      this.values.delete(key); this.values.set(key, cached);
      return structuredClone({ ...cached, resultCached: true });
    }
    const value = convertFx(entry, target, lookup);
    if (value.status !== "unavailable") {
      this.values.set(key, structuredClone(value));
      if (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value!);
    }
    return value;
  }
}

export interface FxTotals { incomeMinor: string; expenseMinor: string; netMinor: string; }
export interface FxAggregate {
  targetCurrency: string; complete: boolean; missingCount: number; convertedCount: number;
  reviewNeededCount: number; reviewDates: string[];
  totals: FxTotals; months: Record<string, FxTotals>; categories: Record<string, FxTotals>;
  originalByCurrency: Record<string, FxTotals>;
  failures: { id: string; bookId: string; date: string; currency: string; reason: FxReason }[];
  /** 缺项时不提供虚假的分母；完整时仍由上层按整数比例绘图。 */
  shareDenominatorMinor: string | null;
}

/** 一笔已成功折算的流水投影（S-01 v2 draft，B-S01v2-01）；字段全部来自 convertFx 结果，不二次舍入。 */
export interface FxConvertedEntry {
  readonly id: string;
  readonly bookId: string;
  readonly date: string;
  readonly kind: FxEntry["kind"];
  readonly categoryId: string;
  readonly targetMinor: string;
  readonly originalMinor: number;
  readonly originalCurrency: string;
  readonly rateDate: string | null;
  readonly rateCached: boolean;
  readonly needsReview: boolean;
}

/** 逐日/逐笔投影选项（S-01 v2 draft）；默认只输出 daily，不输出逐笔。 */
export interface FxDetailOptions {
  readonly includeEntries?: boolean;
  readonly maxEntries?: number;
}

/** 逐日/逐笔投影（S-01 v2 draft）：daily 只含至少一笔成功折算的日期，缺失日期不出现（≠0）。 */
export interface FxAggregateDetail {
  readonly daily: Readonly<Record<string, FxTotals>>;
  readonly entries: readonly FxConvertedEntry[] | null;
}

/** `FxAggregate` 的 additive 扩展：现有字段与语义完全不变。 */
export interface FxDetailedAggregate extends FxAggregate {
  readonly detail: FxAggregateDetail;
}
const emptyTotals = (): FxTotals => ({ incomeMinor: "0", expenseMinor: "0", netMinor: "0" });
function addTotal(totals: FxTotals, kind: FxEntry["kind"], amount: string): void {
  const key = kind === "income" ? "incomeMinor" : "expenseMinor";
  totals[key] = (BigInt(totals[key]) + BigInt(amount)).toString();
  totals.netMinor = (BigInt(totals.incomeMinor) - BigInt(totals.expenseMinor)).toString();
}
interface FxDetailResolution {
  readonly includeEntries: boolean;
  readonly maxEntries: number;
}

function resolveFxDetail(options: FxDetailOptions | undefined): FxDetailResolution {
  const includeEntries = options?.includeEntries === true;
  const maxEntries = options?.maxEntries ?? FX_MAX_DETAIL_ENTRIES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError("fx_detail_max_entries");
  return { includeEntries, maxEntries };
}

interface FxAggregateCore {
  readonly aggregate: FxAggregate;
  readonly detail: FxAggregateDetail;
}

function emptyFxAggregate(target: string): FxAggregate {
  return { targetCurrency: target, complete: true, missingCount: 0, convertedCount: 0,
    reviewNeededCount: 0, reviewDates: [],
    totals: emptyTotals(), months: Object.create(null) as Record<string, FxTotals>,
    categories: Object.create(null) as Record<string, FxTotals>,
    originalByCurrency: Object.create(null) as Record<string, FxTotals>, failures: [], shareDenominatorMinor: null };
}

/** 单一扫描核心；`detail` 只控制输出投影，不改变任何金额/折算语义。 */
function aggregateFxCore(accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: ReadonlyMap<string, FxLookup>, cache: FxResultCache, detail: FxDetailResolution): FxAggregateCore {
  if (!accountId || !bookId || entries.some(entry => entry.bookId !== bookId)) throw new Error("fx_scope_mismatch");
  if (!fxCurrency(target)) throw new Error("unsupported_currency");
  if (detail.includeEntries && entries.length > detail.maxEntries) throw new Error("fx_detail_limit");
  const output = emptyFxAggregate(target);
  const daily: Record<string, FxTotals> = Object.create(null) as Record<string, FxTotals>;
  const converted: FxConvertedEntry[] = [];
  for (const entry of entries) {
    // 基准测试表明超容量顺序扫描会全量淘汰、没有热命中；直接重算更快且不冲掉浏览缓存。
    const result = entries.length > cache.capacity
      ? convertFx(entry, target, rates.get(entry.occurredLocalDate))
      : cache.convert(accountId, bookId, entry, target, rates.get(entry.occurredLocalDate));
    if (Number.isSafeInteger(entry.amountCents) && entry.amountCents >= 0 && fxCurrency(entry.currency)
      && ["income", "expense"].includes(entry.kind)) {
      addTotal(output.originalByCurrency[entry.currency] ??= emptyTotals(), entry.kind, String(entry.amountCents));
    }
    if (result.convertedMinor === null) {
      output.failures.push({ id: entry.id, bookId, date: entry.occurredLocalDate, currency: entry.currency, reason: result.reason! });
      continue;
    }
    output.convertedCount++;
    if (result.review?.needsReview) {
      output.reviewNeededCount++;
      if (!output.reviewDates.includes(entry.occurredLocalDate)) output.reviewDates.push(entry.occurredLocalDate);
    }
    addTotal(output.totals, entry.kind, result.convertedMinor);
    addTotal(output.months[entry.occurredLocalDate.slice(0, 7)] ??= emptyTotals(), entry.kind, result.convertedMinor);
    addTotal(output.categories[entry.categoryId] ??= emptyTotals(), entry.kind, result.convertedMinor);
    addTotal(daily[entry.occurredLocalDate] ??= emptyTotals(), entry.kind, result.convertedMinor);
    if (detail.includeEntries) converted.push({ id: entry.id, bookId, date: entry.occurredLocalDate, kind: entry.kind,
      categoryId: entry.categoryId, targetMinor: result.convertedMinor, originalMinor: entry.amountCents,
      originalCurrency: entry.currency, rateDate: result.rateDate, rateCached: result.rateCached,
      needsReview: result.review?.needsReview === true });
  }
  output.missingCount = output.failures.length;
  output.complete = output.missingCount === 0;
  if (output.complete) output.shareDenominatorMinor = output.totals.expenseMinor;
  return { aggregate: output, detail: { daily, entries: detail.includeEntries ? converted : null } };
}

/** 调用方先按权限、软删除、日期范围过滤；本模块不查询任何账本。 */
export function aggregateFx(accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: ReadonlyMap<string, FxLookup>, cache = new FxResultCache()): FxAggregate {
  return aggregateFxCore(accountId, bookId, entries, target, rates, cache,
    { includeEntries: false, maxEntries: FX_MAX_DETAIL_ENTRIES }).aggregate;
}

/**
 * S-01 v2 draft（B-S01v2-01）：`FxAggregate` + 逐日/可选逐笔投影；additive，不改变 `aggregateFx` 行为。
 * `daily` 与 `totals/months/categories` 共用同一扫描，严格守恒；逐笔与 `convertFx` 同源。待协议冻结后由 W1 接入。
 */
export function aggregateFxDetailed(accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: ReadonlyMap<string, FxLookup>, cache = new FxResultCache(), options?: FxDetailOptions): FxDetailedAggregate {
  const core = aggregateFxCore(accountId, bookId, entries, target, rates, cache, resolveFxDetail(options));
  return { ...core.aggregate, detail: core.detail };
}

export interface FxAsyncOptions {
  readonly batchSize?: number;
  readonly signal?: AbortSignal;
  readonly yieldControl?: () => Promise<void>;
}
/** MessageChannel 让出宏任务，避免 Windows 定时器粒度为每批额外增加十几毫秒。 */
export function yieldFxControl(): Promise<void> {
  return new Promise(resolve => {
    if (typeof MessageChannel === "undefined") { setTimeout(resolve, 0); return; }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
}
interface FxAsyncCoreResult {
  readonly aggregate: FxAggregate;
  readonly detail: FxAggregateDetail;
}

/** 分批核心；未完成或被取消的结果不会作为完整统计返回。 */
async function aggregateFxAsyncCore(accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: ReadonlyMap<string, FxLookup>, options: FxAsyncOptions, detail: FxDetailResolution): Promise<FxAsyncCoreResult> {
  const batchSize = options.batchSize ?? 200;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new RangeError("fx_batch_size");
  if (detail.includeEntries && entries.length > detail.maxEntries) throw new Error("fx_detail_limit");
  const output = aggregateFxCore(accountId, bookId, [], target, rates, new FxResultCache(1), detail).aggregate;
  const daily: Record<string, FxTotals> = Object.create(null) as Record<string, FxTotals>;
  const converted: FxConvertedEntry[] = [];
  const yieldControl = options.yieldControl ?? yieldFxControl;
  const mergeTotals = (into: FxTotals, from: FxTotals): void => {
    into.incomeMinor = (BigInt(into.incomeMinor) + BigInt(from.incomeMinor)).toString();
    into.expenseMinor = (BigInt(into.expenseMinor) + BigInt(from.expenseMinor)).toString();
    into.netMinor = (BigInt(into.incomeMinor) - BigInt(into.expenseMinor)).toString();
  };
  options.signal?.throwIfAborted();
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    options.signal?.throwIfAborted();
    const part = aggregateFxCore(accountId, bookId, entries.slice(offset, offset + batchSize), target, rates,
      new FxResultCache(1), detail);
    mergeTotals(output.totals, part.aggregate.totals);
    for (const group of ["months", "categories", "originalByCurrency"] as const) {
      for (const [key, total] of Object.entries(part.aggregate[group])) mergeTotals(output[group][key] ??= emptyTotals(), total);
    }
    for (const [date, total] of Object.entries(part.detail.daily)) mergeTotals(daily[date] ??= emptyTotals(), total);
    output.failures.push(...part.aggregate.failures);
    output.convertedCount += part.aggregate.convertedCount;
    output.reviewNeededCount += part.aggregate.reviewNeededCount;
    for (const date of part.aggregate.reviewDates) if (!output.reviewDates.includes(date)) output.reviewDates.push(date);
    if (part.detail.entries) converted.push(...part.detail.entries);
    if (offset + batchSize < entries.length) await yieldControl();
  }
  options.signal?.throwIfAborted();
  output.missingCount = output.failures.length;
  output.complete = output.missingCount === 0;
  output.shareDenominatorMinor = output.complete ? output.totals.expenseMinor : null;
  return { aggregate: output, detail: { daily, entries: detail.includeEntries ? converted : null } };
}

/** 大批量派生计算分批让出事件循环；未完成或被取消的结果不会作为完整统计返回。 */
export async function aggregateFxAsync(accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: ReadonlyMap<string, FxLookup>, options: FxAsyncOptions = {}): Promise<FxAggregate> {
  return (await aggregateFxAsyncCore(accountId, bookId, entries, target, rates, options,
    { includeEntries: false, maxEntries: FX_MAX_DETAIL_ENTRIES })).aggregate;
}

/**
 * S-01 v2 draft（B-S01v2-01）：异步逐日/可选逐笔投影；与 `aggregateFxAsync` 同批量/取消语义。
 * 待协议冻结后由 W1 接入；`signal` 取消时不返回部分结果。
 */
export async function aggregateFxDetailedAsync(accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: ReadonlyMap<string, FxLookup>, options: FxAsyncOptions = {}, detailOptions?: FxDetailOptions): Promise<FxDetailedAggregate> {
  const core = await aggregateFxAsyncCore(accountId, bookId, entries, target, rates, options, resolveFxDetail(detailOptions));
  return { ...core.aggregate, detail: core.detail };
}
