/**
 * W5：分析范围唯一原件读取链，由S16-D范围读取提取。
 * 原币、固定窗口、上期比较和FX复用同一分页/月份凭据/离线降级；不计算金额。
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { daysBetween, fxRangeMonths, MAX_STATS_DAYS, type DateRange, type Transaction, type TransactionListResponse } from "@libellum/shared";
import { useAuthOptional } from "../auth/AuthProvider.js";
import { apiFetch, ApiRequestError } from "./api.js";
import { mergeLedgerEntries } from "./ledgerView.js";
import { useCurrentBookId } from "./queries.js";
import { useAccountOffline } from "./offline/connectivity.js";
import { VOLATILE } from "./offline/cache.js";
import { withDeadline } from "./offline/deadline.js";
import { ledgerSnapshotValue, readLocalTransactions, readMarks, readStoredMonths, storeMonth, subscribeLedger } from "./offline/localLedger.js";
import { offlineScope } from "./offline/scope.js";
import { readValue, writeValue } from "./offline/storage.js";
import { foreignKey, useForeignBookId } from "./workspaceLedger.js";

export type AnalysisMarks = Readonly<Record<string, { readonly pending?: boolean; readonly deleted?: boolean }>>;
export type AnalysisCoverage = Readonly<Record<string, readonly string[]>>;
export interface AnalysisRangeRead {
  readonly entries: readonly Transaction[];
  /** 在线已完整读取的原件；只驻留内存，供本机待同步改动重新合并。 */
  readonly remoteEntries: readonly Transaction[] | null;
  readonly sourceComplete: boolean;
  readonly offline: boolean;
}
export interface AnalysisRangeIo {
  readonly scope: () => string;
  readonly fetchMonth: (month: string, cursor: string | undefined, bookId: string) => Promise<TransactionListResponse>;
  readonly storeMonth: (month: string, entries: readonly Transaction[]) => Promise<void>;
  readonly readStored: () => Promise<Readonly<Record<string, readonly Transaction[]>>>;
  readonly readOriginals: () => Promise<readonly Transaction[]>;
  readonly readMarks: () => Promise<AnalysisMarks>;
  readonly readCoverage: (scope: string) => Promise<AnalysisCoverage | null>;
  readonly saveReceipt: (scope: string, month: string, ids: readonly string[]) => Promise<void>;
}
/** 单标签页同账本下载落盘、读回核对、凭据签发为一个串行段。 */
const cacheCommits = new Map<string, Promise<void>>();
function withAnalysisCacheCommit(scope: string, commit: () => Promise<void>): Promise<void> {
  const task = (cacheCommits.get(scope) ?? Promise.resolve()).catch(() => {}).then(commit);
  cacheCommits.set(scope, task);
  void task.finally(() => { if (cacheCommits.get(scope) === task) cacheCommits.delete(scope); }).catch(() => {});
  return task;
}

export function analysisMonthStored(rows: readonly Transaction[], stored: readonly Transaction[]): boolean {
  const versions = new Map(stored.map(row => [row.id, row.version]));
  return rows.every(row => (versions.get(row.id) ?? -1) >= row.version);
}
export function analysisMonthCovered(ids: readonly string[] | undefined, stored: readonly Transaction[] | undefined): boolean {
  if (!ids || !stored) return false;
  const present = new Set(stored.map(row => row.id));
  return ids.every(id => present.has(id));
}
export function mergeAnalysisOriginals(remote: readonly Transaction[], local: readonly Transaction[], marks: AnalysisMarks): readonly Transaction[] {
  const pending = new Set(Object.keys(marks).filter(id => marks[id]?.pending)), deleted = new Set(Object.keys(marks).filter(id => marks[id]?.deleted));
  const remoteIds = new Set(remote.map(row => row.id));
  return mergeLedgerEntries(local.filter(row => pending.has(row.id) || remoteIds.has(row.id)), remote, pending, {}, deleted);
}
export function entriesInAnalysisRange(entries: readonly Transaction[], range: DateRange): readonly Transaction[] {
  return entries.filter(row => row.occurredLocalDate >= range.from && row.occurredLocalDate <= range.to && !row.deletedAt);
}

/** 捕获账号/账本，所有await后复核；迟到响应不能写入新账本，也不返回旧账本结果。 */
export async function readAnalysisRange(
  request: { readonly accountId: string; readonly bookId: string; readonly range: DateRange; readonly offline: boolean; readonly signal: AbortSignal },
  io: AnalysisRangeIo,
): Promise<AnalysisRangeRead> {
  const { accountId, bookId, range, signal } = request;
  if (!accountId || !bookId) throw new Error("analysis_scope_missing");
  if (daysBetween(range.from, range.to) > MAX_STATS_DAYS) throw new RangeError("analysis_range_too_long");
  const months = fxRangeMonths(range.from, range.to);
  const scope = `${accountId}:${bookId}`;
  const check = () => { signal.throwIfAborted(); if (io.scope() !== scope) throw new Error("analysis_scope_changed"); };
  const remote = new Map<string, Transaction>();
  let online = !request.offline;
  check();
  if (online) {
    try {
      for (const month of months) {
        const rows: Transaction[] = [];
        const cursors = new Set<string>();
        let cursor: string | undefined;
        do {
          check();
          const page = await io.fetchMonth(month, cursor, bookId); check();
          rows.push(...page.items);
          for (const row of page.items) remote.set(row.id, row);
          if (remote.size > 100_000) throw new Error("fx_range_capacity");
          cursor = page.nextCursor ?? undefined;
          if (cursor !== undefined) {
            if (cursors.has(cursor)) throw new Error("analysis_cursor_cycle");
            cursors.add(cursor);
          }
        } while (cursor !== undefined);
        // 本机写盘失败不抹掉已完整读取的在线原件；没有保存成功就不签发离线凭据。
        try {
          // 超时只让调用方继续使用在线原件；队列仍等待底层写完成，不提前释放造成迟到覆盖。
          await bounded(withAnalysisCacheCommit(scope, async () => {
            check(); await io.storeMonth(month, rows); check();
            const saved = await io.readStored(); check();
            if (saved[month] !== undefined && analysisMonthStored(rows, saved[month])) {
              await io.saveReceipt(scope, month, rows.map(row => row.id)); check();
            }
          }));
        } catch (error) { check(); /* 公共读取仍可使用内存中的已鉴权原件。 */ }
      }
    } catch (error) {
      check();
      if ((error instanceof ApiRequestError && error.status !== 0) ||
          (error instanceof Error && (error.message === "fx_range_capacity" || error.message === "analysis_cursor_cycle"))) throw error;
      online = false;
    }
  }
  if (online) {
    const originals = [...remote.values()];
    try {
      const [local, marks] = await Promise.all([io.readOriginals(), io.readMarks()]); check();
      return { entries: entriesInAnalysisRange(mergeAnalysisOriginals(originals, local, marks), range), remoteEntries: entriesInAnalysisRange(originals, range), sourceComplete: true, offline: false };
    } catch (error) {
      check();
      return { entries: entriesInAnalysisRange(originals, range), remoteEntries: entriesInAnalysisRange(originals, range), sourceComplete: false, offline: false };
    }
  }
  const [stored, receipts, local] = await Promise.all([io.readStored(), io.readCoverage(scope), io.readOriginals()]); check();
  return { entries: entriesInAnalysisRange(local, range), remoteEntries: null, sourceComplete: months.every(month => analysisMonthCovered(receipts?.[month], stored[month])), offline: true };
}

async function bounded<T>(task: Promise<T>): Promise<T> {
  const result = await withDeadline(task);
  if (result.timedOut) throw new Error("analysis_storage_timeout");
  return result.value as T;
}
const productionIo: AnalysisRangeIo = {
  scope: offlineScope,
  fetchMonth: (month, cursor, bookId) => apiFetch<TransactionListResponse>("/transactions", { query: { month, cursor }, bookId }),
  storeMonth,
  readStored: () => bounded(readStoredMonths()),
  readOriginals: () => bounded(readLocalTransactions()),
  readMarks: () => bounded(readMarks()),
  // 沿用S16-D已保存凭据，不建立第二份账户原件或金额缓存。
  readCoverage: scope => bounded(readValue<AnalysisCoverage>(`fx-month-coverage:${scope}`)),
  async saveReceipt(scope, month, ids) {
    if (offlineScope() !== scope) throw new Error("analysis_scope_changed");
    const key = `fx-month-coverage:${scope}`;
    const prior = await readValue<AnalysisCoverage>(key);
    if (offlineScope() !== scope) throw new Error("analysis_scope_changed");
    if (!await writeValue(key, { ...prior, [month]: ids })) throw new Error("analysis_storage_unavailable");
  },
};

/**
 * S18：工作区查看外部账本时的读取方式——只在线读取那本账，不写、也不读设备的离线副本（那是当前账本的）。
 * 作用域固定为那本账，所以「切换了账本」的复核仍然成立。
 */
export function foreignAnalysisIo(scope: string): AnalysisRangeIo {
  return {
    scope: () => scope,
    fetchMonth: productionIo.fetchMonth,
    storeMonth: async () => {},
    readStored: async () => ({}),
    readOriginals: async () => [],
    readMarks: async () => ({}),
    readCoverage: async () => null,
    saveReceipt: async () => {},
  };
}

/** 相同账号/账本/范围共享请求；目标币种不进入原件读取键。 */
export function useAnalysisRange(range: DateRange, active = true) {
  const accountId = useAuthOptional()?.user?.id ?? "";
  const foreign = useForeignBookId();
  const current = useCurrentBookId();
  const bookId = foreign ?? current;
  const { offline } = useAccountOffline();
  const client = useQueryClient();
  const snapshot = useSyncExternalStore(subscribeLedger, ledgerSnapshotValue, ledgerSnapshotValue);
  const revision = useMemo(() => active ? entriesInAnalysisRange(snapshot, range).map(row => `${row.id}:${row.version}`).sort().join("|") : "", [snapshot, range.from, range.to, active]);
  // 外部账本的读取（只在线、不合并本机标记）用单独的键，不与同一本账作为设备当前账本时的结果混用。
  const queryKey = useMemo(
    () => (foreign === null ? ["analysis-range", accountId, bookId, range.from, range.to, offline] : foreignKey(foreign, "analysis-range", accountId, range.from, range.to)),
    [accountId, bookId, foreign, range.from, range.to, offline],
  );
  const ready = accountId !== "" && bookId !== null && (foreign !== null || offlineScope() === `${accountId}:${bookId}`);
  const enabled = active && ready;
  const query = useQuery({
    queryKey,
    // 外部账本：在 `ws-ledger` 前缀下（写入后随那本账一起失效），也不写进设备的离线缓存。
    ...(foreign !== null ? { meta: VOLATILE } : {}),
    queryFn: ({ signal }) =>
      foreign !== null
        ? readAnalysisRange({ accountId, bookId: foreign, range, offline: false, signal }, foreignAnalysisIo(`${accountId}:${foreign}`))
        : readAnalysisRange({ accountId, bookId: bookId ?? "", range, offline, signal }, productionIo),
    enabled, networkMode: "always", retry: false, staleTime: 30_000,
    meta: { volatile: true },
  });
  const latest = useRef(query.data);
  latest.current = query.data;
  const remoteEntries = query.data?.remoteEntries;
  useEffect(() => {
    // 外部账本没有本机待同步改动可合并。
    if (!enabled || foreign !== null || query.data === undefined || query.isError || query.isFetching || bookId === null) return;
    let alive = true;
    const scope = `${accountId}:${bookId}`;
    void (async () => {
      if (offlineScope() !== scope) return;
      let next: AnalysisRangeRead;
      if (remoteEntries !== undefined && remoteEntries !== null) {
        // 订阅快照只负责触发，不能把换账本前尚未发布清空的旧内存当作新账本原件。
        const [local, marks] = await Promise.all([productionIo.readOriginals(), productionIo.readMarks()]);
        if (!alive || offlineScope() !== scope) return;
        next = { ...latest.current!, entries: entriesInAnalysisRange(mergeAnalysisOriginals(remoteEntries, local, marks), range) };
      } else {
        next = await readAnalysisRange({ accountId, bookId, range, offline: true, signal: new AbortController().signal }, productionIo);
      }
      const current = client.getQueryState(queryKey);
      if (!alive || offlineScope() !== scope || current?.status === "error" || current?.fetchStatus === "fetching") return;
      client.setQueryData<AnalysisRangeRead>(queryKey, next);
    })().catch(() => {});
    return () => { alive = false; };
    // 仅本机原件或新远端读取变化时合并；不因写入衍生缓存再次发网络请求。
  }, [enabled, queryKey, revision, remoteEntries, query.isError, query.isFetching]);
  return { data: enabled && !query.isError ? query.data : undefined, loading: active && accountId !== "" && (!ready || query.isPending), error: enabled && query.isError, permissionDenied: query.error instanceof ApiRequestError && (query.error.status === 401 || query.error.status === 403), capacityExceeded: query.error instanceof Error && query.error.message === "fx_range_capacity", refresh: () => { void query.refetch(); }, accountId, bookId };
}
