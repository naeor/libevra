import { CURRENCIES, type Currency } from "./ledger.js";
import { decimalsFor } from "./money.js";

/** 派生规则版本；不写回流水。参考汇率是每 EUR 的主币单位数。 */
export const FX_POLICY = "minor-half-away-v1";
export const FX_MAX_FALLBACK_DAYS = 7;
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
const emptyTotals = (): FxTotals => ({ incomeMinor: "0", expenseMinor: "0", netMinor: "0" });
function addTotal(totals: FxTotals, kind: FxEntry["kind"], amount: string): void {
  const key = kind === "income" ? "incomeMinor" : "expenseMinor";
  totals[key] = (BigInt(totals[key]) + BigInt(amount)).toString();
  totals.netMinor = (BigInt(totals.incomeMinor) - BigInt(totals.expenseMinor)).toString();
}
/** 调用方先按权限、软删除、日期范围过滤；本模块不查询任何账本。 */
export function aggregateFx(accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: ReadonlyMap<string, FxLookup>, cache = new FxResultCache()): FxAggregate {
  if (!accountId || !bookId || entries.some(entry => entry.bookId !== bookId)) throw new Error("fx_scope_mismatch");
  if (!fxCurrency(target)) throw new Error("unsupported_currency");
  const output: FxAggregate = { targetCurrency: target, complete: true, missingCount: 0, convertedCount: 0,
    reviewNeededCount: 0, reviewDates: [],
    totals: emptyTotals(), months: Object.create(null) as Record<string, FxTotals>,
    categories: Object.create(null) as Record<string, FxTotals>, originalByCurrency: Object.create(null) as Record<string, FxTotals>, failures: [], shareDenominatorMinor: null };
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
  }
  output.missingCount = output.failures.length; output.complete = output.missingCount === 0;
  if (output.complete) output.shareDenominatorMinor = output.totals.expenseMinor;
  return output;
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
/** 大批量派生计算分批让出事件循环；未完成或被取消的结果不会作为完整统计返回。 */
export async function aggregateFxAsync(accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: ReadonlyMap<string, FxLookup>, options: FxAsyncOptions = {}): Promise<FxAggregate> {
  const batchSize = options.batchSize ?? 200;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new RangeError("fx_batch_size");
  const output = aggregateFx(accountId, bookId, [], target, rates);
  const yieldControl = options.yieldControl ?? yieldFxControl;
  const mergeTotals = (into: FxTotals, from: FxTotals): void => {
    into.incomeMinor = (BigInt(into.incomeMinor) + BigInt(from.incomeMinor)).toString();
    into.expenseMinor = (BigInt(into.expenseMinor) + BigInt(from.expenseMinor)).toString();
    into.netMinor = (BigInt(into.incomeMinor) - BigInt(into.expenseMinor)).toString();
  };
  options.signal?.throwIfAborted();
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    options.signal?.throwIfAborted();
    const part = aggregateFx(accountId, bookId, entries.slice(offset, offset + batchSize), target, rates, new FxResultCache(1));
    mergeTotals(output.totals, part.totals);
    for (const group of ["months", "categories", "originalByCurrency"] as const) {
      for (const [key, total] of Object.entries(part[group])) mergeTotals(output[group][key] ??= emptyTotals(), total);
    }
    output.failures.push(...part.failures);
    output.convertedCount += part.convertedCount;
    output.reviewNeededCount += part.reviewNeededCount;
    for (const date of part.reviewDates) if (!output.reviewDates.includes(date)) output.reviewDates.push(date);
    if (offset + batchSize < entries.length) await yieldControl();
  }
  options.signal?.throwIfAborted();
  output.missingCount = output.failures.length;
  output.complete = output.missingCount === 0;
  output.shareDenominatorMinor = output.complete ? output.totals.expenseMinor : null;
  return output;
}
