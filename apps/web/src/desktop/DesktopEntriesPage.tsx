/**
 * **电脑版明细**：找到、查看与处理账目。
 *
 * - 顶部稳定工具栏：月份、收支、搜索、刷新、选择、摘要设置与记账入口；滚动时不变高。
 * - 轻量月度摘要（可隐藏、可选指标、可选每日趋势），默认很矮。
 * - 按日期分组的账目列表，金额右对齐；单击一行在右侧辅助栏显示详情，可以继续点别的行对照；
 *   ↑↓ 在行间移动并跟着显示，Esc 关闭详情或退出选择。中键 / Ctrl(⌘)+点击在新标签页打开。
 * - 辅助栏放不下时详情改在主展示区里显示（带返回），列表、搜索与滚动位置原样保留。
 * - 批量选择沿用手机明细同一份逻辑（`useLedgerBatch`）：Ctrl(⌘)+点击切换、Shift+点击连选。
 *
 * 数据与手机明细完全相同：同一组查询、同一份本机副本合并（未同步、已删除、冲突标记），没有新的财务计算。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { UNCATEGORISED_NAME, type Transaction } from "@libellum/shared";

import { useAuth } from "../auth/AuthProvider.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { ConflictScreen } from "../components/ConflictScreen.js";
import { FxAmount } from "../components/FxDisplay.js";
import { MonthPicker } from "../components/MonthPicker.js";
import { OfflineStatus } from "../components/OfflineStatus.js";
import { SyncBanner } from "../components/SyncBanner.js";
import { BatchActionBar } from "../components/ledger/BatchActionBar.js";
import { BatchEditSheet } from "../components/ledger/BatchEditSheet.js";
import { BatchRoleProbe } from "../components/ledger/BatchRoleProbe.js";
import { SelectionBar } from "../components/ledger/SelectionBar.js";
import { EMPTY_BATCH_DRAFT, selectAllLoaded, toggleSelection } from "../components/ledger/batch.js";
import { refreshMessage } from "../components/ledger/refreshFeedback.js";
import { useLedgerBatch } from "../components/ledger/useLedgerBatch.js";
import { ChevronIcon } from "../components/Icons.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { currentMonth, formatDayLabel, formatTimeWithZone, isAllMonths } from "../lib/datetime.js";
import { openInNewTab, wantsNewTab } from "../lib/desktopInput.js";
import { formatMoney } from "../lib/format.js";
import { useFxMode } from "../lib/fxView.js";
import { useGuestMode } from "../lib/guest/session.js";
import { mergeLedgerEntries } from "../lib/ledgerView.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import {
  conflictsValue,
  deletedEntriesValue,
  pendingEntriesValue,
  readLocalTransactions,
  subscribeConflicts,
  subscribeDeleted,
  subscribePending,
  type ConflictRecord,
} from "../lib/offline/localLedger.js";
import { syncMonth } from "../lib/offline/sync.js";
import { pendingCount, retryAbandonedWrites, syncNow } from "../lib/offline/syncController.js";
import { resolveConflict } from "../lib/offline/write.js";
import { displayCategoryName, displayPaymentMethodName } from "../lib/presetNames.js";
import { useLedger, useSummary, useTransactions } from "../lib/queries.js";
import { headerMonthLabel, shiftMonth, sortByTime, useLocalEntries } from "../pages/DetailPage.js";
import { EntryDetailPage } from "../pages/EntryDetailPage.js";
import { DesktopPopover } from "./DesktopPopover.js";
import { DesktopSplit } from "./DesktopSplit.js";
import { DesktopToolbar } from "./DesktopToolbar.js";
import { entryMatches, groupByDay, dailyTotals, type EntryKindFilter } from "./entriesView.js";
import { RefreshIcon, SearchIcon, SelectIcon, SlidersIcon } from "./icons.js";

const SESSION_KEY = "libevra.desktop.entries:v1";
const SUMMARY_KEY = "libevra.desktop.entries-summary:v1";
export const ENTRY_PARAM = "entry";

interface SummaryPrefs {
  readonly show: boolean;
  readonly expense: boolean;
  readonly income: boolean;
  readonly balance: boolean;
  readonly trend: boolean;
}

const DEFAULT_SUMMARY: SummaryPrefs = { show: true, expense: true, income: true, balance: true, trend: true };

function readJson<T>(storage: "session" | "local", key: string, fallback: T): T {
  try {
    const raw = (storage === "session" ? window.sessionStorage : window.localStorage).getItem(key);
    return raw === null ? fallback : { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

function writeJson(storage: "session" | "local", key: string, value: unknown): void {
  try {
    (storage === "session" ? window.sessionStorage : window.localStorage).setItem(key, JSON.stringify(value));
  } catch {
    // 记不住只影响下次打开时的默认值。
  }
}

const NO_ENTRIES: readonly Transaction[] = [];

export function DesktopEntriesPage(): React.JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user } = useAuth();
  const guest = useGuestMode();
  const fxMode = useFxMode();
  const { offline } = useAccountOffline();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get(ENTRY_PARAM);

  const saved = useRef(readJson<{ month?: string; kind?: EntryKindFilter }>("session", SESSION_KEY, {})).current;
  const [month, setMonth] = useState(() => saved.month ?? currentMonth());
  const [kind, setKind] = useState<EntryKindFilter>(() => saved.kind ?? "all");
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [prefs, setPrefs] = useState<SummaryPrefs>(() => readJson("local", SUMMARY_KEY, DEFAULT_SUMMARY));
  const [settling, setSettling] = useState<ConflictRecord | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const anchorId = useRef<string | null>(null);
  const allMonths = isAllMonths(month);

  useEffect(() => {
    writeJson("session", SESSION_KEY, { month, kind });
  }, [month, kind]);
  useEffect(() => {
    writeJson("local", SUMMARY_KEY, prefs);
  }, [prefs]);

  const ledger = useLedger();
  const summary = useSummary(month);
  const filters = useMemo(() => ({ month: allMonths ? undefined : month, kind: kind === "all" ? undefined : kind }), [allMonths, month, kind]);
  const list = useTransactions(filters);
  const local = useLocalEntries(filters);
  const pending = useSyncExternalStore(subscribePending, pendingEntriesValue, pendingEntriesValue);
  const deleted = useSyncExternalStore(subscribeDeleted, deletedEntriesValue, deletedEntriesValue);
  const conflicts = useSyncExternalStore(subscribeConflicts, conflictsValue, conflictsValue);
  const conflicted = useMemo(() => new Set(conflicts.map((conflict) => conflict.mine.id)), [conflicts]);

  // 一个月的账目一次读完（月份视图条目有限）；「全部月份」时按需再读。
  useEffect(() => {
    if (!allMonths && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, [allMonths, list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage]);

  const entries = useMemo(() => {
    const fromQuery = (list.data?.pages ?? []).flatMap((page) => page.items);
    return mergeLedgerEntries(local, fromQuery, pending, filters, deleted);
  }, [list.data, local, pending, filters, deleted]);
  const ordered = useMemo(() => sortByTime(entries), [entries]);
  const shown = useMemo(() => (query.trim() === "" ? ordered : ordered.filter((entry) => entryMatches(entry, query))), [ordered, query]);
  const groups = useMemo(() => groupByDay(shown), [shown]);

  const batch = useLedgerBatch({ ordered: shown, conflicted, ledger: ledger.data, guest, offline, filterKey: `${month}|${kind}` });

  const mainCode = user?.defaultCurrency ?? "CNY";
  const currencies = summary.data?.currencies ?? [];
  const main = currencies.find((item) => item.currency === mainCode) ?? currencies[0] ?? null;
  const otherCount = currencies.filter((item) => item !== main).length;
  const trend = useMemo(
    () => (allMonths || main === null ? [] : dailyTotals(ordered.length > 0 ? ordered : NO_ENTRIES, month, main.currency)),
    [allMonths, main, ordered, month],
  );

  const select = useCallback(
    (id: string | null) => {
      setSettling(null);
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (id === null) next.delete(ENTRY_PARAM);
          else next.set(ENTRY_PARAM, id);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const activate = (entry: Transaction, event: React.MouseEvent<HTMLButtonElement>): void => {
    if (batch.selecting) {
      if (event.button !== 0) return;
      if (event.shiftKey && anchorId.current !== null) {
        const ids = shown.map((item) => item.id);
        const from = ids.indexOf(anchorId.current);
        const to = ids.indexOf(entry.id);
        if (from !== -1 && to !== -1) {
          const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
          batch.setSelected((current) => new Set([...current, ...range]));
          return;
        }
      }
      anchorId.current = entry.id;
      batch.setSelected((current) => toggleSelection(current, entry.id));
      return;
    }
    const newTab = !conflicted.has(entry.id) && !pending.has(entry.id) && !deleted.has(entry.id);
    if (event.button === 1 && !newTab) return;
    if (newTab && wantsNewTab(event)) {
      event.preventDefault();
      openInNewTab(`/transactions/${entry.id}`);
      return;
    }
    if (conflicted.has(entry.id) && !guest) {
      const waiting = conflicts.find((conflict) => conflict.mine.id === entry.id);
      if (waiting !== undefined) {
        select(null);
        setSettling(waiting);
        return;
      }
    }
    select(entry.id);
  };

  const onListKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      if (batch.selecting) batch.exitBatch();
      else if (selectedId !== null || settling !== null) select(null);
      else return;
      event.preventDefault();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLButtonElement>("button[data-entry-id]");
    if (row === null) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-entry-id]")];
    const next = rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
    if (!batch.selecting) {
      const id = next.dataset.entryId ?? null;
      if (id !== null && !conflicted.has(id)) select(id);
    }
  };

  const refresh = async (): Promise<void> => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshNote(null);
    let delivered = 0;
    let pulled = 0;
    let failure: string | null = null;
    let waiting = 0;
    try {
      if (!guest) {
        await retryAbandonedWrites();
        delivered = await syncNow();
      }
      if (allMonths || guest) {
        const [answer] = await Promise.all([list.refetch(), summary.refetch()]);
        pulled = (answer.data?.pages ?? []).reduce((count, page) => count + page.items.length, 0);
      } else {
        pulled = await syncMonth(month);
      }
    } catch (caught) {
      failure = errorMessage(caught);
    } finally {
      try {
        await readLocalTransactions();
      } catch {
        // 本机读取失败时列表保持原样。
      }
      try {
        waiting = guest ? 0 : await pendingCount();
      } catch {
        waiting = 0;
      }
      setRefreshNote(refreshMessage({ guest, offline, delivered, pulled, failed: failure !== null, error: failure, waiting, allMonths }));
      setRefreshing(false);
    }
  };

  const panel =
    settling !== null ? (
      <div className="lv-desk-panel-page">
        <div className="lv-desk-panel-body">
          <ConflictScreen
            conflict={settling}
            categories={ledger.data?.categories}
            paymentMethods={ledger.data?.paymentMethods}
            tags={ledger.data?.tags}
            onResolve={async (settled) => {
              await resolveConflict(settling.mine.id, settled, settling.theirs);
              setSettling(null);
            }}
            onLater={() => setSettling(null)}
          />
        </div>
      </div>
    ) : selectedId !== null ? (
      <EntryDetailPage key={selectedId} entryId={selectedId} />
    ) : null;

  const monthLabel = allMonths ? t("ledger.detail.allTime") : headerMonthLabel(month);
  const searching = query.trim() !== "";

  return (
    <DesktopSplit panel={panel} panelLabel={t("desktop.entries.panel")} panelDisabled={batch.selecting} disabledMessage={t("desktop.entries.panelPaused")} onClosePanel={() => select(null)}>
      <div className="flex h-full min-h-0 flex-col">
        <SyncBanner />
        <OfflineStatus />
        <DesktopToolbar
          title={t("desktop.entries.title")}
          meta={ledger.data?.book.name}
          actions={
            <>
              <button type="button" className="lv-desk-icon-btn" onClick={() => void refresh()} disabled={refreshing} aria-label={t("desktop.entries.refresh")} title={t("desktop.entries.refresh")}>
                <RefreshIcon className={`size-[18px] ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} />
              </button>
              <button
                type="button"
                className="lv-desk-icon-btn"
                aria-pressed={batch.selecting}
                aria-label={batch.selecting ? t("desktop.entries.selectDone") : t("desktop.entries.select")}
                title={batch.selecting ? t("desktop.entries.selectDone") : t("desktop.entries.select")}
                onClick={() => {
                  if (batch.selecting) batch.exitBatch();
                  else {
                    batch.enterBatch();
                  }
                }}
              >
                <SelectIcon className="size-[18px]" />
              </button>
              <SummarySettings prefs={prefs} onChange={setPrefs} />
              <button type="button" className="lv-desk-btn lv-desk-btn-primary" onClick={() => void navigate("/add")}>
                {t("desktop.nav.add")}
              </button>
            </>
          }
        >
          {/* 放不下时搜索框换到第二行，月份与收支切换不被挤压或遮住。 */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="lv-desk-month" role="group" aria-label={t("desktop.entries.month")}>
              <button type="button" className="lv-desk-icon-btn" disabled={allMonths} onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("desktop.entries.prevMonth")}>
                <ChevronIcon direction="left" className="size-4" />
              </button>
              <button type="button" className="lv-desk-month-label" onClick={() => setPickerOpen(true)} aria-haspopup="dialog">
                {monthLabel}
              </button>
              <button
                type="button"
                className="lv-desk-icon-btn"
                disabled={allMonths || month >= currentMonth()}
                onClick={() => setMonth(shiftMonth(month, 1))}
                aria-label={t("desktop.entries.nextMonth")}
              >
                <ChevronIcon direction="right" className="size-4" />
              </button>
            </div>
            <div className="lv-desk-seg" role="radiogroup" aria-label={t("desktop.entries.kind")}>
              {(["all", "expense", "income"] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={kind === value} onClick={() => setKind(value)}>
                  {value === "all" ? t("desktop.entries.kindAll") : t(`common.kind.${value}`)}
                </button>
              ))}
            </div>
            <label className="lv-desk-search min-w-44 flex-1 basis-44">
              <SearchIcon className="size-4 shrink-0 text-muted" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query !== "") {
                    event.preventDefault();
                    setQuery("");
                  }
                }}
                placeholder={t("desktop.entries.searchPlaceholder")}
                aria-label={t("desktop.entries.search")}
              />
            </label>
          </div>
        </DesktopToolbar>

        {batch.selecting ? (
          <div className="lv-desk-batchbar">
            <SelectionBar
              selectedCount={batch.selectedIds.length}
              loadedCount={batch.loadedIds.length}
              allSelected={batch.everythingLoadedSelected}
              notice={batch.selectionNotice}
              onToggleAll={() => batch.setSelected((current) => selectAllLoaded(batch.loadedIds, current))}
            />
            <BatchActionBar
              selectedCount={batch.selectedIds.length}
              blockedReason={batch.permission.reason}
              busy={batch.batchBusy}
              summary={batch.batchSummary}
              onEdit={() => {
                batch.setBatchDraft(EMPTY_BATCH_DRAFT);
                batch.setBatchEditOpen(true);
              }}
              onDelete={() => batch.setConfirmBatchDelete(true)}
            />
          </div>
        ) : null}

        <div className="lv-desk-scroll min-h-0 flex-1 overflow-y-auto" onKeyDown={onListKey}>
          <div className="lv-desk-entries">
            {prefs.show && main !== null ? (
              <section className="lv-desk-summary" aria-label={t("desktop.entries.summary")}>
                {prefs.expense ? <SummaryFigure label={t("desktop.entries.expense")} value={formatMoney(main.expenseCents, main.currency)} /> : null}
                {prefs.income ? <SummaryFigure label={t("desktop.entries.income")} value={formatMoney(main.incomeCents, main.currency)} /> : null}
                {prefs.balance ? <SummaryFigure label={t("desktop.entries.balance")} value={formatMoney(main.balanceCents, main.currency)} /> : null}
                {otherCount > 0 ? <p className="self-end text-helper text-muted">{t("desktop.entries.otherCurrencies", { count: otherCount })}</p> : null}
                {prefs.trend && trend.length > 0 ? <DailyBars values={trend} label={t("desktop.entries.trend")} /> : null}
              </section>
            ) : null}

            {refreshNote === null ? null : (
              <p role="status" className="text-helper text-muted">{refreshNote}</p>
            )}

            {list.isPending && entries.length === 0 ? <p className="py-10 text-center text-body text-muted">{t("desktop.common.loading")}</p> : null}
            {!list.isPending && shown.length === 0 ? (
              <p className="py-12 text-center text-body text-muted">
                {searching ? t("desktop.entries.emptySearch", { query: query.trim() }) : t("desktop.entries.empty")}
              </p>
            ) : null}

            {groups.map((group) => (
              <section key={group.date} className="lv-desk-day">
                <h2 className="lv-desk-day-head">
                  <span>{formatDayLabel(group.date)}</span>
                  <span className="tabular-nums">{dayTotalsLabel(group.entries, mainCode, t)}</span>
                </h2>
                <ul>
                  {group.entries.map((entry) => (
                    <li key={entry.id}>
                      <EntryRow
                        entry={entry}
                        selected={batch.selecting ? batch.selected.has(entry.id) : entry.id === selectedId}
                        selecting={batch.selecting}
                        pending={pending.has(entry.id)}
                        conflicted={conflicted.has(entry.id)}
                        fx={fxMode.enabled ? <FxAmount entry={entry} /> : undefined}
                        onActivate={(event) => activate(entry, event)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {allMonths && list.hasNextPage ? (
              <div className="flex justify-center py-4">
                <button type="button" className="lv-desk-btn" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                  {list.isFetchingNextPage ? t("desktop.common.loading") : t("desktop.entries.loadMore")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {batch.selecting && batch.shared ? <BatchRoleProbe onProbe={batch.setRoleState} /> : null}
      <BatchEditSheet
        open={batch.batchEditOpen}
        count={batch.selectedIds.length}
        kinds={batch.selectedKinds}
        categories={batch.ledgerIndex.categories}
        paymentMethods={batch.ledgerIndex.paymentMethods}
        tags={batch.ledgerIndex.tags}
        draft={batch.batchDraft}
        blockedReason={batch.permission.reason}
        busy={batch.batchBusy}
        onDraftChange={batch.setBatchDraft}
        onApply={() => void batch.applyBatchEdit(batch.batchDraft)}
        onClose={() => batch.setBatchEditOpen(false)}
      />
      <ConfirmDialog
        open={batch.confirmBatchDelete}
        busy={batch.batchBusy}
        title={batch.deleteConfirmation.title}
        description={batch.deleteConfirmation.description}
        consequences={batch.deleteConfirmation.consequences}
        confirmLabel={batch.deleteConfirmation.confirmLabel}
        onCancel={() => batch.setConfirmBatchDelete(false)}
        onConfirm={() => void batch.runBatchDelete()}
      />
      <MonthPicker open={pickerOpen} month={month} maxMonth={currentMonth()} allowAll onSelect={setMonth} onClose={() => setPickerOpen(false)} />
    </DesktopSplit>
  );
}

function dayTotalsLabel(entries: readonly Transaction[], currency: string, t: ReturnType<typeof useI18n>["t"]): string {
  let expense = 0;
  let income = 0;
  for (const entry of entries) {
    if (entry.currency !== currency) continue;
    if (entry.kind === "expense") expense += entry.amountCents;
    else if (entry.kind === "income") income += entry.amountCents;
  }
  const parts: string[] = [];
  if (expense > 0) parts.push(`${t("desktop.entries.expense")} ${formatMoney(expense, currency)}`);
  if (income > 0) parts.push(`${t("desktop.entries.income")} ${formatMoney(income, currency)}`);
  return parts.join(" · ");
}

function SummaryFigure({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-helper text-muted">{label}</span>
      <span className="text-section-title font-semibold whitespace-nowrap text-ink tabular-nums">{value}</span>
    </div>
  );
}

function DailyBars({ values, label }: { readonly values: readonly number[]; readonly label: string }): React.JSX.Element {
  const max = Math.max(...values, 1);
  const width = values.length * 6;
  return (
    <svg className="lv-desk-trend" viewBox={`0 0 ${String(width)} 32`} preserveAspectRatio="none" role="img" aria-label={label}>
      {values.map((value, index) => {
        const height = value === 0 ? 1.5 : Math.max(2, (value / max) * 30);
        return <rect key={index} x={index * 6 + 1} y={32 - height} width={4} height={height} rx={1} className={value === 0 ? "fill-line" : "fill-brand"} />;
      })}
    </svg>
  );
}

function EntryRow({
  entry,
  selected,
  selecting,
  pending,
  conflicted,
  fx,
  onActivate,
}: {
  readonly entry: Transaction;
  readonly selected: boolean;
  readonly selecting: boolean;
  readonly pending: boolean;
  readonly conflicted: boolean;
  readonly fx: React.ReactNode;
  readonly onActivate: (event: React.MouseEvent<HTMLButtonElement>) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const category = displayCategoryName(entry.categoryIsSystem ? UNCATEGORISED_NAME : entry.categoryName);
  const sign = entry.kind === "expense" ? "-" : entry.kind === "income" ? "+" : "";
  return (
    <button
      type="button"
      data-entry-id={entry.id}
      className="lv-desk-row"
      aria-pressed={selecting ? selected : undefined}
      aria-current={!selecting && selected ? "true" : undefined}
      data-state={conflicted ? "conflict" : pending ? "pending" : undefined}
      onClick={onActivate}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) onActivate(event);
      }}
    >
      {selecting ? <span className="lv-desk-check" data-on={selected ? "true" : undefined} aria-hidden="true" /> : null}
      <span className="lv-desk-row-badge" aria-hidden="true">{entry.categoryIsSystem ? "—" : Array.from(category)[0]}</span>
      <span className="lv-desk-row-main">
        <span className="truncate text-body text-ink">{category}</span>
        {entry.note ? <span className="truncate text-body text-muted"> · {entry.note}</span> : null}
        {conflicted ? <span className="lv-desk-chip" data-tone="warn">{t("desktop.entries.conflict")}</span> : pending ? <span className="lv-desk-chip">{t("desktop.entries.pending")}</span> : null}
      </span>
      <span className="lv-desk-row-meta truncate">{entry.paymentMethodName ? displayPaymentMethodName(entry.paymentMethodName) : ""}</span>
      <span className="lv-desk-row-meta lv-desk-row-time tabular-nums">{formatTimeWithZone(entry.occurredAt, entry.occurredTz)}</span>
      <span className={`lv-desk-row-amount tabular-nums ${entry.kind === "income" ? "text-brand-dark" : "text-ink"}`}>
        {fx ?? `${sign}${formatMoney(entry.amountCents, entry.currency)}`}
      </span>
    </button>
  );
}

function SummarySettings({ prefs, onChange }: { readonly prefs: SummaryPrefs; readonly onChange: (next: SummaryPrefs) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const options: readonly { readonly key: keyof SummaryPrefs; readonly label: string }[] = [
    { key: "show", label: t("desktop.entries.summaryShow") },
    { key: "expense", label: t("desktop.entries.expense") },
    { key: "income", label: t("desktop.entries.income") },
    { key: "balance", label: t("desktop.entries.balance") },
    { key: "trend", label: t("desktop.entries.trend") },
  ];
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="lv-desk-icon-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("desktop.entries.summaryEdit")}
        title={t("desktop.entries.summaryEdit")}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersIcon className="size-[18px]" />
      </button>
      {open ? (
        <DesktopPopover anchor={anchor} label={t("desktop.entries.summaryEdit")} onClose={close} placement="bottom-end" width={248}>
          <div className="p-4">
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="mb-3 px-1 text-card-title text-ink">{t("desktop.entries.summaryEdit")}</legend>
            {options.map((option) => (
              <label key={option.key} className={`lv-desk-check-row ${option.key !== "show" && !prefs.show ? "opacity-45" : ""}`}>
                <input
                  type="checkbox"
                  checked={prefs[option.key]}
                  disabled={option.key !== "show" && !prefs.show}
                  onChange={(event) => onChange({ ...prefs, [option.key]: event.target.checked })}
                />
                <span className="text-body text-ink">{option.label}</span>
              </label>
            ))}
          </fieldset>
          </div>
        </DesktopPopover>
      ) : null}
    </>
  );
}
