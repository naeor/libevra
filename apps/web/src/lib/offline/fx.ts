import { FxHistoryService, type FxProvider, type FxRepository, type FxStored } from "../../../../../packages/shared/src/fxHistory.js";
import { aggregateFx, copyFxSnapshot, FxResultCache, rateAge, validateSnapshot,
  type FxEntry, type FxLookup } from "../../../../../packages/shared/src/fx.js";
import { readValue, writeValue } from "./storage.js";
import { offlineScope } from "./scope.js";

const KEY = "fx-public-rates-v1";
let publicQueue: Promise<unknown> = Promise.resolve();
interface PublicRates { values: Record<string, FxStored>; }
/** 复用原 kv，键只包含公共汇率。无金额、交易 ID、账号偏好或汇总，允许跨账号共享。 */
export class OfflineFxRepository implements FxRepository {
  constructor(private readonly capacity = 512) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("capacity");
  }
  async get(provider: string, date: string): Promise<FxStored | null> {
    await publicQueue;
    const store = await readValue<PublicRates>(KEY);
    const value = store?.values?.[JSON.stringify([provider, date])];
    if (!value) return null;
    try { return { snapshot: copyFxSnapshot(value.snapshot), checkedAt: value.checkedAt }; } catch { return null; }
  }
  async save(provider: string, date: string, value: FxStored): Promise<void> {
    validateSnapshot(value.snapshot);
    if (provider !== value.snapshot.provider || rateAge(date, value.snapshot.date) < 0 || rateAge(date, value.snapshot.date) > 7) throw new Error("fx_invalid_resolution");
    const task = publicQueue.then(async () => {
      const store = await readValue<PublicRates>(KEY);
      const entries = Object.entries(store?.values ?? {}).map(([key, prior]): [string, FxStored] => {
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
      if (!await writeValue(KEY, { values })) throw new Error("fx_storage_unavailable");
    });
    publicQueue = task.catch(() => undefined);
    await task;
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
  private readonly cache: FxResultCache;
  constructor(capacity = 5000) { this.cache = new FxResultCache(capacity); }
  clear(): void { this.scope = ""; this.cache.clear(); }
  aggregate(entries: readonly FxEntry[], target: string, rates: ReadonlyMap<string, FxLookup>) {
    const scope = offlineScope();
    if (scope !== this.scope) { this.cache.clear(); this.scope = scope; }
    const [accountId, bookId] = scope.split(":");
    if (!accountId || !bookId) throw new Error("fx_scope_unresolved");
    return aggregateFx(accountId, bookId, entries, target, rates, this.cache);
  }
}
