/**
 * **总览的按账本数据**（1.19.100）：总览上的卡片可以来自不同的账本。每本用到的账本挂一个不显示的读取器，
 * 在那本账的上下文（`ViewLedgerContext`）里取得：
 *
 * - 与分析页相同的数据作用域（`useWorkbenchScope`：同一份时间、币种、原币 / 综合折算；当前账本走本机优先的
 *   读取，其它账本在线读取，权限由服务器按账本检查）；
 * - 最近账目（与明细相同的查询，**不限于所选时间**——所有者 2026-11-01：总览的近期账目不限定本月）。
 *
 * 结果交给一个小仓库，只有卡片订阅仓库。
 *
 * ⚠️ 读取器是页面的兄弟节点，不包住卡片：用到的账本增减时只增减读取器，不会让编辑中的工作台重新挂载；
 * 页面本身不订阅仓库，读取器发布新结果不会反过来让自己重渲染（避免循环）。
 */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";
import type { Transaction } from "@libellum/shared";

import { useTransactions } from "../lib/queries.js";
import { ViewLedgerContext } from "../lib/workspaceLedger.js";
import { cardSourceBook } from "../statsWorkbench/nativeCards.js";
import { useWorkbenchScope, type WorkbenchScope } from "../statsWorkbench/scope.js";
import type { WorkbenchFilters } from "../statsWorkbench/filters.js";

export interface BookData {
  readonly scope: WorkbenchScope;
  /** 最近账目（第一页，按时间倒序由查询决定）；还没读到时 `undefined`。 */
  readonly recent: readonly Transaction[] | undefined;
  readonly recentFailed: boolean;
}

export class DashboardScopeStore {
  private books: ReadonlyMap<string, BookData> = new Map();
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): ReadonlyMap<string, BookData> => this.books;

  publish(bookId: string, data: BookData): void {
    const previous = this.books.get(bookId);
    if (previous !== undefined && previous.scope === data.scope && previous.recent === data.recent && previous.recentFailed === data.recentFailed) return;
    this.books = new Map(this.books).set(bookId, data);
    for (const listener of this.listeners) listener();
  }

  forget(bookId: string): void {
    if (!this.books.has(bookId)) return;
    const next = new Map(this.books);
    next.delete(bookId);
    this.books = next;
    for (const listener of this.listeners) listener();
  }
}

export const DashboardScopeContext = createContext<DashboardScopeStore | null>(null);

function Probe({ bookId, filters, store }: { readonly bookId: string; readonly filters: WorkbenchFilters; readonly store: DashboardScopeStore }): null {
  const scope = useWorkbenchScope(filters);
  const list = useTransactions({});
  const recent = useMemo(() => list.data?.pages.flatMap((page) => page.items), [list.data]);
  const recentFailed = list.isError;
  useEffect(() => {
    store.publish(bookId, { scope, recent, recentFailed });
  });
  useEffect(() => () => store.forget(bookId), [bookId, store]);
  return null;
}

/** 每本用到的账本一个读取器。 */
export function DashboardScopeProbes({ books, filters, store }: { readonly books: readonly string[]; readonly filters: WorkbenchFilters; readonly store: DashboardScopeStore }): React.JSX.Element {
  return (
    <>
      {books.map((bookId) => (
        <ViewLedgerContext.Provider key={bookId} value={bookId}>
          <Probe bookId={bookId} filters={filters} store={store} />
        </ViewLedgerContext.Provider>
      ))}
    </>
  );
}

const EMPTY: ReadonlyMap<string, BookData> = new Map();
const noopSubscribe = (): (() => void) => () => undefined;
const emptySnapshot = (): ReadonlyMap<string, BookData> => EMPTY;

/** 卡片读多本账的数据（订阅仓库）。 */
export function useDashboardBooks(): ReadonlyMap<string, BookData> {
  const store = useContext(DashboardScopeContext);
  return useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.snapshot ?? emptySnapshot, store?.snapshot ?? emptySnapshot);
}

/** 账本还没读到（或已不可用）时的占位作用域：不拿当前账本的数字冒充那本账。 */
export function pendingScope(fallback: WorkbenchScope, available: boolean): WorkbenchScope {
  return {
    ...fallback,
    entries: [],
    ledgerCurrencies: [],
    fx: null,
    coverageGap: null,
    repairing: false,
    loaded: !available,
    readRanges: true,
    rangeSourceComplete: false,
    rangeReadState: available ? "loading" : "no-permission",
  };
}

/**
 * 网格画分析卡片时用的作用域（`CardRenderContext.useScopeFor`）：卡片指定了来源账本就用那本账的，否则用当前账本。
 * 是个 hook：订阅仓库，那本账的数据到了卡片就重画。
 */
export function useDashboardCardScope(card: AnalysisCardNode | undefined, fallback: WorkbenchScope): WorkbenchScope {
  const books = useDashboardBooks();
  const available = useContext(DashboardAvailableContext);
  const source = card === undefined ? null : cardSourceBook(card);
  if (source === null) return fallback;
  return books.get(source)?.scope ?? pendingScope(fallback, available.has(source));
}

/** 总览范围里的账本（卡片的来源账本不在里面 = 已退出 / 归档，显示「无权读取」而不是一直加载）。 */
export const DashboardAvailableContext = createContext<ReadonlySet<string>>(new Set());
