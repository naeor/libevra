/**
 * 工作台的数据作用域：**谁在看、看哪本账、哪段时间、哪个币种**——卡片只读这一份。
 *
 * ⚠️ **数据来源 = 本机当前账本的账目（ledger store）。** 这是明细页、旧分析页离线回退和 Agent B
 * W1 卡片共用的同一来源（Lead 暂定裁定 B-Q17：W1 采用设备账本口径）；切换账本时 store 换成新账本的
 * 账目，所有卡片随之重算，**不会短暂显示上一账本的数字**（ACC-14）。共享账本的权限由既有读取路径
 * 保证，这里不新增任何读取接口（ACC-12）。
 *
 * ⚠️ **范围覆盖核对（ACC-13/W5）。** 原币与FX共用useAnalysisRange的完整月份分页、空月下载
 * 凭据与离线原件核对。未核实完整覆盖时明确显示小计，不再维护第二条逐月补读路径。
 *
 * ⚠️ **综合折算（汇率）只走既有 S16-D 路径**（`useFxRange` → `aggregateFxAsync`，ACC-04），
 * 不另写折算；只有声明了综合结果的卡片在综合模式下显示数字，其余明确显示「暂不支持」。
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createContext, useContext } from "react";
import type { AnalysisCompleteness, Currency, DateRange, StatsBucket, Transaction } from "@libellum/shared";

import { useAuthOptional } from "../auth/AuthProvider.js";
import { toLocalDate } from "../lib/datetime.js";
import { useAnalysisRange } from "../lib/analysisRange.js";
import { useFxRange } from "../lib/fxView.js";
import { useGuestIdentity } from "../lib/guest/session.js";
import { ledgerSnapshotValue, readLocalTransactions, subscribeLedger } from "../lib/offline/localLedger.js";
import { refreshPending } from "../lib/offline/write.js";
import { useLedger } from "../lib/queries.js";
import { currenciesUsed, liveEntries } from "./compute.js";
import {
  bucketFor,
  filterKey,
  filterWorkbenchEntries,
  matchesWorkbenchFilters,
  resolveRange,
  type WorkbenchFilters,
} from "./filters.js";

export type FxRangeView = ReturnType<typeof useFxRange>;

export interface WorkbenchScope {
  /** 设备当地的「今天」（不问服务器，见旧分析页的说明）。 */
  readonly today: string;
  readonly filters: WorkbenchFilters;
  readonly range: DateRange;
  readonly bucket: StatsBucket;
  /** 工作台综合统计独立于明细金额的设备显示偏好；游客保留原币离线流程。 */
  readonly combined: boolean;
  readonly fxAvailable: boolean;
  /** 原币模式的币种，或综合模式的目标币种。 */
  readonly currency: Currency;
  readonly defaultCurrency: Currency;
  /** 当前账本、未删除、且通过 W5 维度筛选（分类/支付方式/标签）的账目。 */
  readonly entries: readonly Transaction[];
  /** 当前账本未筛的币种清单：筛选面板的币种候选不应随分类/标签筛选收窄（W5）。 */
  readonly ledgerCurrencies?: readonly string[];
  /** 本机账目是否已经读过一次（读之前显示加载，而不是「没有记录」）。 */
  readonly loaded: boolean;
  readonly fx: FxRangeView | null;
  /** 综合折算下「上期比较」卡片自己读取的上一周期折算；其它卡片为 `null`/缺省。 */
  readonly previousFx?: FxRangeView | null;
  /** 服务器同条件笔数多于本机时给出两边笔数；否则为 `null`。 */
  readonly coverageGap: { readonly server: number; readonly local: number } | null;
  /** 正在把缺的月份取回本机（取完 store 更新，卡片自动重算）。 */
  readonly repairing: boolean;
  /** 工作台配置的账号作用域（Q-02：每账号一套）。 */
  readonly accountScope: string | null;
  /** 正式账号会话允许卡片按独立范围复用W5原件读取；游客继续只读本机。 */
  readonly readRanges?: boolean;
  /** 卡片独立范围的读取状态与覆盖证明，不写入布局。 */
  readonly rangeReadState?: AnalysisCompleteness;
  readonly rangeSourceComplete?: boolean;
  readonly comparisonRead?: { readonly entries: readonly Transaction[]; readonly verified: boolean };
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
  const fxAvailable = user !== null;
  const combined = fxAvailable && filters.combined;
  const defaultCurrency: Currency = user?.defaultCurrency ?? "CNY";
  const currency: Currency = combined ? defaultCurrency : (filters.currency ?? defaultCurrency);
  const source = useAnalysisRange(range, user !== null && !combined);
  const unfilteredEntries = useMemo(
    () => liveEntries(user !== null && !combined ? source.data?.entries ?? [] : all),
    [all, source.data?.entries, user, combined],
  );
  /**
   * ⚠️ **W5 维度筛选必须发生在所有读取/折算入口之前**：卡片、趋势、热力、上期比较都只看 `entries`；
   * 综合折算的 `sourceEntries` 也要经过同一谓词，缺汇率影响范围才会随筛选变化（任务 §7.2）。
   */
  const entries = useMemo(() => filterWorkbenchEntries(unfilteredEntries, filters), [unfilteredEntries, filters]);
  const ledgerCurrencies = useMemo(() => currenciesUsed(unfilteredEntries), [unfilteredEntries]);
  const fxFilter = useCallback(
    (entry: Transaction) => matchesWorkbenchFilters(entry, filters),
    [filters],
  );
  const fx = useFxRange(range.from, range.to, combined, {
    enabled: fxAvailable,
    filter: fxFilter,
    filterKey: filterKey(filters),
  });

  const accountScope = user !== null ? `user:${user.id}` : guestId !== null ? `guest:${guestId}` : null;

  return {
    today,
    filters,
    range,
    bucket,
    combined,
    fxAvailable,
    currency,
    defaultCurrency,
    entries,
    ledgerCurrencies,
    loaded: user !== null && !combined ? source.data !== undefined || source.error : readOnce || all.length > 0,
    fx: combined ? fx : null,
    coverageGap: null,
    repairing: user !== null && !combined && source.loading,
    accountScope,
    readRanges: user !== null,
    ...(user !== null && !combined ? {
      rangeSourceComplete: source.data?.sourceComplete === true,
      rangeReadState: source.permissionDenied ? "no-permission" as const : source.error ? "request-failed" as const : source.loading ? "loading" as const : source.data?.sourceComplete === true ? "complete" as const : "offline-incomplete" as const,
    } : {}),
  };
}

const ScopeContext = createContext<WorkbenchScope | null>(null);

export const WorkbenchScopeProvider = ScopeContext.Provider;

export function useScope(): WorkbenchScope {
  const scope = useContext(ScopeContext);
  if (scope === null) throw new Error("useScope must be used inside <WorkbenchScopeProvider>");
  return scope;
}
