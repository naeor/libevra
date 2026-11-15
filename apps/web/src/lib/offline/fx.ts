import { FxHistoryService, type FxProvider, type FxRepository, type FxStored } from "../../../../../packages/shared/src/fxHistory.js";
import { aggregateFx, aggregateFxAsync, copyFxSnapshot, FxResultCache, rateAge, validateSnapshot, yieldFxControl,
  type FxAsyncOptions, type FxEntry, type FxLookup } from "../../../../../packages/shared/src/fx.js";
import { readValue, writeValue } from "./storage.js";
import { offlineScope } from "./scope.js";
import { withDeadline } from "./deadline.js";

const KEY = "fx-public-rates-v1";
export interface PublicRates { values: Record<string, FxStored>; }
/**
 * 汇率缓存落在哪里。默认是账号离线库的公共键；游客仓库（`lib/guest/fx.ts`）换成游客库里带游客 id 的键。
 * 其余的合并、乱序保护、容量裁剪逻辑两边完全一样，所以只抽这一处。
 */
export interface FxRepositoryStore {
  /** 同一个存储位置用同一个锁名，防止多标签页同时写。 */
  readonly lockName: () => string;
  readonly read: () => Promise<PublicRates | null>;
  readonly write: (value: PublicRates) => Promise<boolean>;
}
const accountStore: FxRepositoryStore = {
  lockName: () => KEY,
  read: () => readValue<PublicRates>(KEY),
  write: value => writeValue(KEY, value),
};
/** 复用原 kv，键只包含公共汇率。无金额、交易 ID、账号偏好或汇总，允许跨账号共享。 */
export class OfflineFxRepository implements FxRepository {
  /** 每个仓库（账号 / 游客）各有自己的写队列，互不排队。 */
  private publicQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly capacity = 512, private readonly store: FxRepositoryStore = accountStore) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("capacity");
  }
  private withPublicLock<T>(write: () => Promise<T>): Promise<T> {
    return typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(this.store.lockName(), write) : write();
  }
  private async boundedRead(): Promise<PublicRates | null> {
    const result = await withDeadline(this.store.read());
    if (result.timedOut) throw new Error("fx_storage_timeout");
    return result.value;
  }
  async get(provider: string, date: string): Promise<FxStored | null> {
    const ready = await withDeadline(this.publicQueue);
    if (ready.timedOut) throw new Error("fx_storage_timeout");
    const store = await this.boundedRead();
    const value = store?.values?.[JSON.stringify([provider, date])];
    if (!value) return null;
    try { return { snapshot: copyFxSnapshot(value.snapshot), checkedAt: value.checkedAt }; } catch { return null; }
  }
  async save(provider: string, date: string, value: FxStored): Promise<void> {
    validateSnapshot(value.snapshot);
    if (provider !== value.snapshot.provider || rateAge(date, value.snapshot.date) < 0 || rateAge(date, value.snapshot.date) > 7) throw new Error("fx_invalid_resolution");
    const task = this.publicQueue.then(() => this.withPublicLock(async () => {
      const store = await this.boundedRead();
      const usable = Object.entries(store?.values ?? {}).filter(([, prior]) => {
        try { validateSnapshot(prior.snapshot); return Number.isFinite(Date.parse(prior.checkedAt)); } catch { return false; }
      });
      const entries = usable.map(([key, prior]): [string, FxStored] => {
        // 同日历史修订更新所有周末/假日解析，防止旧副本继续参与折算。
        if (prior.snapshot.provider === provider && prior.snapshot.date === value.snapshot.date) {
          if (Date.parse(prior.snapshot.fetchedAt) > Date.parse(value.snapshot.fetchedAt)) throw new Error("fx_revision_conflict");
          const sameVersion = prior.snapshot.revision === value.snapshot.revision;
          const sameRates = JSON.stringify(Object.entries(prior.snapshot.rates).sort()) === JSON.stringify(Object.entries(value.snapshot.rates).sort());
          if ((sameVersion && !sameRates) || (!sameVersion && Date.parse(prior.snapshot.fetchedAt) === Date.parse(value.snapshot.fetchedAt))) throw new Error("fx_revision_conflict");
          return [key, { snapshot: copyFxSnapshot(value.snapshot), checkedAt: prior.checkedAt }];
        }
        return [key, { snapshot: copyFxSnapshot(prior.snapshot), checkedAt: prior.checkedAt }];
      }).filter(([key]) => key !== JSON.stringify([provider, date]));
      entries.push([JSON.stringify([provider, date]), { snapshot: copyFxSnapshot(value.snapshot), checkedAt: value.checkedAt }]);
      const values = Object.fromEntries(entries.slice(-this.capacity));
      if (!await this.store.write({ values })) throw new Error("fx_storage_unavailable");
    }));
    this.publicQueue = task.catch(() => undefined);
    const saved = await withDeadline(task);
    // 底层写仍由队列/锁持有到真正结束，迟到的旧写不能越过后续新版本。
    if (saved.timedOut) throw new Error("fx_storage_timeout");
  }
}

/** 调用方在恢复网络后对实际需要日期补齐；此处不注册全局监听、不触碰同步队列。 */
export function createOfflineFxService(provider: FxProvider, repository: FxRepository = new OfflineFxRepository()): FxHistoryService {
  return new FxHistoryService(repository, provider);
}
export async function refillFxDates(service: FxHistoryService, dates: readonly string[]) {
  const result = new Map<string, FxLookup>();
  // 串行且去重，避免恢复网络瞬间扇出大量请求。
  for (const date of new Set(dates)) result.set(date, await service.lookup(date));
  return result;
}

/** 当前登录/账本作用域来自既有离线基础设施；不能由 UI 传任意账号认领缓存。 */
export class OfflineFxCalculator {
  private scope = "";
  private generation = 0;
  private readonly cache: FxResultCache;
  constructor(capacity = 5000) { this.cache = new FxResultCache(capacity); }
  clear(): void { this.generation++; this.scope = ""; this.cache.clear(); }
  aggregate(entries: readonly FxEntry[], target: string, rates: ReadonlyMap<string, FxLookup>) {
    this.generation++;
    const scope = offlineScope();
    if (scope !== this.scope) { this.cache.clear(); this.scope = scope; }
    const [accountId, bookId] = scope.split(":");
    if (!accountId || !bookId) throw new Error("fx_scope_unresolved");
    return aggregateFx(accountId, bookId, entries, target, rates, this.cache);
  }
  async aggregateAsync(entries: readonly FxEntry[], target: string, rates: ReadonlyMap<string, FxLookup>, options: FxAsyncOptions = {}) {
    const generation = ++this.generation;
    const scope = offlineScope();
    if (scope !== this.scope) { this.cache.clear(); this.scope = scope; }
    const [accountId, bookId] = scope.split(":");
    if (!accountId || !bookId) throw new Error("fx_scope_unresolved");
    const ensureScope = () => {
      if (offlineScope() !== scope) throw new Error("fx_scope_changed");
      if (generation !== this.generation) throw new Error("fx_request_superseded");
    };
    const result = await aggregateFxAsync(accountId, bookId, entries, target, rates, { ...options,
      yieldControl: async () => {
        await (options.yieldControl?.() ?? yieldFxControl());
        ensureScope();
      },
    });
    ensureScope();
    return result;
  }
}
