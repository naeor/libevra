/**
 * 工作台的数据作用域：**谁在看、看哪本账、哪段时间、哪个币种**——卡片只读这一份。
 *
 * ⚠️ **数据来源 = 本机当前账本的账目（ledger store）。** 这是明细页、旧分析页离线回退和 Agent B
 * W1 卡片共用的同一来源（Lead 暂定裁定 B-Q17：W1 采用设备账本口径）；切换账本时 store 换成新账本的
 * 账目，所有卡片随之重算，**不会短暂显示上一账本的数字**（ACC-14）。共享账本的权限由既有读取路径
 * 保证，这里不新增任何读取接口（ACC-12）。
 *
 * ⚠️ **本机覆盖核对（ACC-13）。** 原币模式下仍按旧页面的方式向服务器要一次同条件统计
 * （`useStats`，联网时是服务器结果）。服务器那边的笔数多于本机时，页面明确提示「本机还缺账目」，
 * 而不是把本机小计说成全部。离线时 `useStats` 自己回退到本机，不会误报。
 *
 * ⚠️ **综合折算（汇率）只走既有 S16-D 路径**（`useFxRange` → `aggregateFxAsync`，ACC-04），
 * 不另写折算；只有声明了综合结果的卡片在综合模式下显示数字，其余明确显示「暂不支持」。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createContext, useContext } from "react";
import type { Currency, DateRange, StatsBucket, Transaction } from "@libellum/shared";

import { useAuthOptional } from "../auth/AuthProvider.js";
import { toLocalDate } from "../lib/datetime.js";
import { useFxMode, useFxRange } from "../lib/fxView.js";
import { useGuestIdentity } from "../lib/guest/session.js";
import { ledgerSnapshotValue, readLocalTransactions, subscribeLedger } from "../lib/offline/localLedger.js";
import { syncMonth } from "../lib/offline/sync.js";
import { refreshPending } from "../lib/offline/write.js";
import { useLedger, useStats } from "../lib/queries.js";
import { liveEntries, statsFor } from "./compute.js";
import { bucketFor, resolveRange, type WorkbenchFilters } from "./filters.js";

export type FxRangeView = ReturnType<typeof useFxRange>;

export interface WorkbenchScope {
  /** 设备当地的「今天」（不问服务器，见旧分析页的说明）。 */
  readonly today: string;
  readonly filters: WorkbenchFilters;
  readonly range: DateRange;
  readonly bucket: StatsBucket;
  /** 实际生效的综合折算（设备开启了汇率折算 **且** 筛选选了综合）。 */
  readonly combined: boolean;
  readonly fxAvailable: boolean;
  /** 原币模式的币种，或综合模式的目标币种。 */
  readonly currency: Currency;
  readonly defaultCurrency: Currency;
  /** 当前账本、未删除的账目。 */
  readonly entries: readonly Transaction[];
  /** 本机账目是否已经读过一次（读之前显示加载，而不是「没有记录」）。 */
  readonly loaded: boolean;
  readonly fx: FxRangeView | null;
  /** 服务器同条件笔数多于本机时给出两边笔数；否则为 `null`。 */
  readonly coverageGap: { readonly server: number; readonly local: number } | null;
  /** 正在把缺的月份取回本机（取完 store 更新，卡片自动重算）。 */
  readonly repairing: boolean;
  /** 工作台配置的账号作用域（Q-02：每账号一套）。 */
  readonly accountScope: string | null;
}

export function useWorkbenchScope(filters: WorkbenchFilters): WorkbenchScope {
  const auth = useAuthOptional();
  const user = auth?.user ?? null;
  const guest = useGuestIdentity();
  /**
   * ⚠️ **依赖里只能放游客 id，不能放身份对象。** `useGuestIdentity()` 每次渲染都重新解析 localStorage，
   * 返回新对象；放进依赖会让「重读本机 → 发布新快照 → 重渲染 → 又重读」无限循环（游客模式下页面卡死）。
   */
  const guestId = guest?.id ?? null;
  const fxMode = useFxMode();
  const all = useSyncExternalStore(subscribeLedger, ledgerSnapshotValue, ledgerSnapshotValue);
  const [readOnce, setReadOnce] = useState(false);
  /**
   * ⚠️ 账本元数据返回（或切换账本）之后要再读一次本机：直接打开「分析」时，第一次读发生在
   * `useLedger` 完成 `prepareOfflineBook` 之前，那时离线作用域（账号:账本）还没建立，读到的是空的。
   * 以 `useLedger` 成功为信号，正是作用域已就绪的时刻。
   */
  const ledgerMeta = useLedger();
  const bookId = ledgerMeta.data?.book.id ?? null;

  useEffect(() => {
    let alive = true;
    void (async () => {
      await readLocalTransactions();
      if (guestId === null) await refreshPending();
      if (alive) setReadOnce(true);
    })();
    return () => {
      alive = false;
    };
  }, [guestId, bookId]);

  // 「今天」按设备时钟取一次；跨午夜由页面重新进入时更新（与旧页一致）。
  const today = useMemo(() => toLocalDate(new Date()), []);
  const range = useMemo(() => resolveRange(filters.time, today), [filters.time, today]);
  const bucket = bucketFor(range);
  const combined = fxMode.enabled && filters.combined;
  const defaultCurrency: Currency = user?.defaultCurrency ?? "CNY";
  const currency: Currency = combined ? (fxMode.target as Currency) : (filters.currency ?? defaultCurrency);
  const entries = useMemo(() => liveEntries(all), [all]);

  const fx = useFxRange(range.from, range.to, combined);

  // ACC-13：同条件向服务器要一次统计；离线时 useStats 回退本机，两边一致，不会误报。
  const server = useStats({ from: range.from, to: range.to, bucket, currency });
  const local = statsFor(entries, range, currency, bucket);
  const serverCount = server.data?.totals.count;
  const coverageGap =
    !combined && serverCount !== undefined && serverCount > local.totals.count
      ? { server: serverCount, local: local.totals.count }
      : null;

  const accountScope = user !== null ? `user:${user.id}` : guestId !== null ? `guest:${guestId}` : null;

  /**
   * ⚠️ **本机缺账目时先补齐，再提示。** 新设备、刚清过缓存、或后台下载还没把月份发布到 store 时，
   * 本机笔数会少于服务器。做法与明细页「刷新本月」相同：先重读本机（后台已下载的月份会被发布），
   * 仍不够就按月调用既有 `syncMonth`（只读 `/transactions`，同一套鉴权）把这段时间的月份取回本机；
   * 每个账号每个月本次打开只试一次，失败就保留提示，不反复请求。
   */
  const [repairing, setRepairing] = useState(false);
  const gapKey =
    coverageGap === null || accountScope === null || bookId === null ? null : `${accountScope}:${bookId}:${range.from}:${range.to}:${currency}`;
  useEffect(() => {
    if (gapKey === null || guestId !== null || coverageGap === null || attemptedRanges.has(gapKey)) return;
    attemptedRanges.add(gapKey);
    let alive = true;
    setRepairing(true);
    void (async () => {
      try {
        const reread = liveEntries(await readLocalTransactions());
        if (statsFor(reread, range, currency, bucket).totals.count >= coverageGap.server) return;
        for (const month of monthsIn(range)) {
          const key = `${accountScope ?? ""}:${bookId ?? ""}:${month}`;
          if (attemptedMonths.has(key)) continue;
          attemptedMonths.add(key);
          await syncMonth(month);
        }
      } finally {
        if (alive) setRepairing(false);
      }
    })();
    return () => {
      alive = false;
    };
    // range 由 gapKey 表达
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapKey, guestId]);

  return {
    today,
    filters,
    range,
    bucket,
    combined,
    fxAvailable: fxMode.enabled,
    currency,
    defaultCurrency,
    entries,
    loaded: readOnce || all.length > 0,
    fx: combined ? fx : null,
    coverageGap,
    repairing,
    accountScope,
  };
}

const attemptedRanges = new Set<string>();
const attemptedMonths = new Set<string>();

/** 区间覆盖的自然月（`YYYY-MM`），最多 14 个（400 天上限内）。 */
function monthsIn(range: DateRange): readonly string[] {
  const months: string[] = [];
  let cursor = range.from.slice(0, 7);
  const last = range.to.slice(0, 7);
  while (cursor <= last && months.length < 14) {
    months.push(cursor);
    const [year = 0, month = 1] = cursor.split("-").map(Number);
    cursor = month === 12 ? `${String(year + 1).padStart(4, "0")}-01` : `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}`;
  }
  return months;
}

const ScopeContext = createContext<WorkbenchScope | null>(null);

export const WorkbenchScopeProvider = ScopeContext.Provider;

export function useScope(): WorkbenchScope {
  const scope = useContext(ScopeContext);
  if (scope === null) throw new Error("useScope must be used inside <WorkbenchScopeProvider>");
  return scope;
}
