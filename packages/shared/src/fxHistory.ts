import { FX_MAX_FALLBACK_DAYS, fxDate, fxDecimal, rateAge, validateSnapshot,
  type FxLookup, type FxReason, type FxSnapshot } from "./fx.js";

export class FxError extends Error {
  constructor(readonly reason: FxReason) { super(reason); }
}
export interface FxStored { snapshot: FxSnapshot; checkedAt: string; }
/** 仅公共汇率，不含账号、账本、金额。实现必须原子写入并拒绝乱序覆盖。 */
export interface FxRepository {
  get(provider: string, requestedDate: string): Promise<FxStored | null>;
  save(provider: string, requestedDate: string, value: FxStored): Promise<void>;
}
export interface FxProvider {
  readonly id: string;
  fetch(requestedDate: string): Promise<FxSnapshot>;
}

export class MemoryFxRepository implements FxRepository {
  private readonly resolutions = new Map<string, { date: string; checkedAt: string }>();
  private readonly dates = new Map<string, FxSnapshot>();
  private readonly revisions = new Map<string, string>();
  async get(provider: string, date: string): Promise<FxStored | null> {
    const resolution = this.resolutions.get(JSON.stringify([provider, date]));
    const snapshot = resolution && this.dates.get(JSON.stringify([provider, resolution.date]));
    return snapshot && resolution ? structuredClone({ snapshot, checkedAt: resolution.checkedAt }) : null;
  }
  async save(provider: string, date: string, value: FxStored): Promise<void> {
    validateSnapshot(value.snapshot);
    const snapshot = value.snapshot;
    const dateKey = JSON.stringify([provider, snapshot.date]);
    const revisionKey = JSON.stringify([provider, snapshot.date, snapshot.revision]);
    const canonical = JSON.stringify(Object.entries(snapshot.rates).sort());
    const prior = this.revisions.get(revisionKey);
    const current = this.dates.get(dateKey);
    if (provider !== snapshot.provider || (prior !== undefined && prior !== canonical)
      || (current && Date.parse(current.fetchedAt) === Date.parse(snapshot.fetchedAt) && current.revision !== snapshot.revision)) throw new FxError("conflict");
    if (current && Date.parse(current.fetchedAt) > Date.parse(snapshot.fetchedAt)) throw new FxError("conflict");
    this.revisions.set(revisionKey, canonical);
    this.dates.set(dateKey, structuredClone(snapshot));
    this.resolutions.set(JSON.stringify([provider, date]), { date: snapshot.date, checkedAt: value.checkedAt });
  }
}

export interface FxHistoryOptions {
  /** 修订重新核对周期；不是按交易日期驱逐历史汇率。 */
  recheckMs?: number;
  offlineMaxAgeMs?: number;
  /** 异常隔离阈值是工程防线，未经过产品验收不自动放行。 */
  maxJumpFactor?: number;
  now?: () => number;
}
export class FxHistoryService {
  private readonly pending = new Map<string, Promise<FxLookup>>();
  private readonly now: () => number;
  constructor(private readonly repository: FxRepository, private readonly provider: FxProvider,
    private readonly options: FxHistoryOptions = {}) { this.now = options.now ?? Date.now; }
  async lookup(date: string, options: { offline?: boolean; refresh?: boolean } = {}): Promise<FxLookup> {
    if (!fxDate(date) || date > new Date(this.now()).toISOString().slice(0, 10)) return { status: "unavailable", reason: "invalid_input" };
    let existing: FxStored | null;
    try { existing = await this.repository.get(this.provider.id, date); }
    catch { return { status: "unavailable", reason: "storage_error" }; }
    if (existing) {
      try { validateSnapshot(existing.snapshot); } catch { return { status: "unavailable", reason: "invalid_rate" }; }
      const age = rateAge(date, existing.snapshot.date);
      const sinceCheck = this.now() - Date.parse(existing.checkedAt);
      const sinceFetch = this.now() - Date.parse(existing.snapshot.fetchedAt);
      if (!Number.isFinite(sinceCheck) || !Number.isFinite(sinceFetch) || sinceCheck < 0 || sinceFetch < 0
        || age < 0 || age > FX_MAX_FALLBACK_DAYS || existing.snapshot.provider !== this.provider.id) return { status: "unavailable", reason: "invalid_rate" };
      if (options.offline) return sinceFetch <= (this.options.offlineMaxAgeMs ?? 30 * 86400000)
        ? { status: "available", snapshot: existing.snapshot, cached: true }
        : { status: "unavailable", reason: "stale_rate" };
      if (!options.refresh && sinceCheck < (this.options.recheckMs ?? 86400000)) return { status: "available", snapshot: existing.snapshot, cached: true };
    }
    if (options.offline) return { status: "unavailable", reason: "missing_rate" };
    const pending = this.pending.get(date);
    if (pending) return pending;
    const promise = this.acquire(date, existing).finally(() => { this.pending.delete(date); });
    this.pending.set(date, promise);
    return promise;
  }
  private async acquire(date: string, existing: FxStored | null): Promise<FxLookup> {
    try {
      const snapshot = await this.provider.fetch(date);
      try { validateSnapshot(snapshot); } catch { throw new FxError("invalid_rate"); }
      const age = rateAge(date, snapshot.date);
      if (Date.parse(snapshot.fetchedAt) > this.now()) throw new FxError("invalid_rate");
      if (snapshot.provider !== this.provider.id || age < 0 || age > FX_MAX_FALLBACK_DAYS) throw new FxError("missing_rate");
      // 同日修订和跨日跳变均隔离；比较的是已确认参考数据，不猜测正确值。
      const previousDay = new Date(Date.parse(`${snapshot.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      const previous = existing ?? await this.repository.get(this.provider.id, previousDay);
      if (previous) {
        const factor = this.options.maxJumpFactor ?? 2;
        if (!Number.isFinite(factor) || factor < 1) throw new FxError("invalid_input");
        const limit = BigInt(Math.round(factor * 1000000));
        for (const [currency, rate] of Object.entries(snapshot.rates)) {
          const old = previous.snapshot.rates[currency];
          if (old && (fxDecimal(rate) * 1000000n > fxDecimal(old) * limit
            || fxDecimal(old) * 1000000n > fxDecimal(rate) * limit)) throw new FxError("anomaly");
        }
      }
      try { await this.repository.save(this.provider.id, date, { snapshot, checkedAt: new Date(this.now()).toISOString() }); }
      catch (error) { throw error instanceof FxError ? error : new FxError("storage_error"); }
      return { status: "available", snapshot, cached: false };
    } catch (error) {
      return { status: "unavailable", reason: error instanceof FxError ? error.reason : "network" };
    }
  }
}
