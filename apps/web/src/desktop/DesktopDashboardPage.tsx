import { DashboardMessages } from "./DashboardMessages.js";
import { BookNotificationBell } from "../components/BookNotificationBell.js";
import { NotificationBell } from "../components/Notifications.js";
/**
 * **总览（Dashboard）**：整个 Libevra 的个人化首页——各账本的本月概况、跨账本收支、最近账目、待处理与
 * 快捷操作，不必进入某个账本就能知道最近发生了什么。它不是某个账本的分析页，也不代替左侧导航。
 *
 * 数据全部来自现有查询：每本账的本月汇总与账目（当前账本走本机优先的读取，其它账本在线读取，权限由服务器
 * 按账本检查）。跨账本金额只按币种分别相加，不折算、不去重，并在卡片上说明。
 *
 * 外层复用分析工作台的网格落位和拖动，可自由移动、缩放、隐藏与加回；账本卡片可选主要指标与内容开关，
 * 跨账本卡片可选范围。按「完成」才保存到本机；窗口变化只改变排布。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import { UNCATEGORISED_NAME, type CurrencySummary, type Transaction } from "@libellum/shared";

type SummaryResponse = { readonly month: string; readonly currencies: readonly CurrencySummary[] };

import { useAuth } from "../auth/AuthProvider.js";
import { LedgerMonthPicker } from "../components/LedgerMonthPicker.js";
import { ChevronIcon } from "../components/Icons.js";
import { useI18n } from "../i18n/index.js";
import { currentMonth, formatDayLabel } from "../lib/datetime.js";
import { formatMoney } from "../lib/format.js";
import { useGuestIdentity, useGuestMode } from "../lib/guest/session.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { conflictsValue, pendingEntriesValue, subscribeConflicts, subscribePending } from "../lib/offline/localLedger.js";
import { syncNow } from "../lib/offline/syncController.js";
import { displayCategoryName } from "../lib/presetNames.js";
import { useBooks, useCurrentBookId, useSummary, useTransactions } from "../lib/queries.js";
import { ViewLedgerContext } from "../lib/workspaceLedger.js";
import { headerMonthLabel, sortByTime } from "../pages/DetailPage.js";
import { EntryMethodList } from "../workspace/RailEntryMenu.js";
import { DesktopPopover } from "./DesktopPopover.js";
import { DashboardGrid } from "./DashboardGrid.js";
import { dashboardDestination } from "./dashboardNavigation.js";
import { DesktopToolbar } from "./DesktopToolbar.js";
import { desktopEntryDisabled, useEnterLedger } from "./DesktopNav.js";
import {
  moveCard,
  parseDashboard,
  resolveDashboard,
  totalsByCurrency,
  updateCard,
  type CardSize,
  type DashboardCard,
  type DashboardConfig,
  type LedgerMetric,
} from "./dashboardModel.js";
import { dailyTotals } from "./entriesView.js";

interface BookSnapshot {
  readonly month: string;
  readonly summary: SummaryResponse | undefined;
  readonly entries: readonly Transaction[] | undefined;
  readonly recent: readonly Transaction[] | undefined;
  readonly complete: boolean;
  readonly failed: boolean;
}

interface BookInfo {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
}

function storageKey(owner: string): string {
  return `libevra.desktop.dashboard:v1:${owner}`;
}

function readRawConfig(owner: string | null): string | null | undefined {
  if (owner === null) return null;
  try { return window.localStorage.getItem(storageKey(owner)); } catch { return undefined; }
}

function readSession(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function writeSession(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* 仅影响下次恢复位置。 */ }
}

function readConfig(owner: string | null): DashboardConfig | null {
  if (owner === null) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(owner));
    return raw === null ? null : parseDashboard(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeConfig(owner: string | null, config: DashboardConfig | null): boolean {
  if (owner === null) return false;
  try {
    if (config === null) window.localStorage.removeItem(storageKey(owner));
    else window.localStorage.setItem(storageKey(owner), JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

/** 读一本账本月的汇总与账目（在这本账的上下文里，用与明细相同的查询），把结果交给总览。 */
function BookProbe({ bookId, month, onSnapshot }: { readonly bookId: string; readonly month: string; readonly onSnapshot: (bookId: string, snapshot: BookSnapshot) => void }): React.JSX.Element {
  return (
    <ViewLedgerContext.Provider value={bookId}>
      <BookProbeInner bookId={bookId} month={month} onSnapshot={onSnapshot} />
    </ViewLedgerContext.Provider>
  );
}

function BookProbeInner({ bookId, month, onSnapshot }: { readonly bookId: string; readonly month: string; readonly onSnapshot: (bookId: string, snapshot: BookSnapshot) => void }): null {
  const summary = useSummary(month);
  const list = useTransactions({ month });
  const recentList = useTransactions({});
  const entries = useMemo(() => (list.data === undefined ? undefined : list.data.pages.flatMap((page) => page.items)), [list.data]);
  const recent = useMemo(() => recentList.data?.pages.flatMap((page) => page.items), [recentList.data]);
  const complete = list.isSuccess && !list.hasNextPage;
  useEffect(() => {
    if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) void list.fetchNextPage();
  }, [list.hasNextPage, list.isFetchingNextPage, list.isFetchNextPageError, list.fetchNextPage]);
  const failed = summary.isError || list.isError || list.isFetchNextPageError;
  useEffect(() => {
    onSnapshot(bookId, { month, summary: summary.data, entries, recent, complete, failed });
  }, [bookId, month, summary.data, entries, recent, complete, failed, onSnapshot]);
  return null;
}

export function DesktopDashboardPage(): React.JSX.Element {
  const { t } = useI18n();
  const { user } = useAuth();
  const guestIdentity = useGuestIdentity();
  const owner = user !== null ? `user:${user.id}` : guestIdentity !== null ? `guest:${guestIdentity.id}` : null;
  const books = useBooks();
  const currentBookId = useCurrentBookId();
  const [month, setMonth] = useState(() => { try { const value = readSession("libevra.dashboard.month"); return value !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : currentMonth(); } catch { return currentMonth(); } });
  const mainCode = user?.defaultCurrency ?? "CNY";
  const monthAnchor = useRef<HTMLButtonElement | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  const bookList: readonly BookInfo[] = useMemo(() => (books.data?.books ?? []).map((book) => ({ id: book.id, name: book.name, memberCount: book.memberCount })), [books.data]);
  const bookIds = useMemo(() => bookList.map((book) => book.id), [bookList]);

  const [saved, setSaved] = useState<DashboardConfig | null>(() => readConfig(owner));
  const [draft, setDraft] = useState<DashboardConfig | null>(null);
  const editing = draft !== null;
  const [undo, setUndo] = useState<DashboardConfig[]>([]);
  const [redo, setRedo] = useState<DashboardConfig[]>([]);
  const [saveError, setSaveError] = useState(false);
  const baseline = useRef<string | null | undefined>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setSaved(readConfig(owner)); setDraft(null); }, [owner]);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (owner !== null && event.key === storageKey(owner) && draft === null) setSaved(readConfig(owner)); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [owner, draft]);
  useEffect(() => { const top = Number(readSession("libevra.dashboard.scroll") ?? 0); if (scrollRef.current !== null) scrollRef.current.scrollTop = top; }, [books.isSuccess]);
  const config = useMemo(() => resolveDashboard(draft ?? saved, bookIds), [draft, saved, bookIds]);

  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, BookSnapshot>>(new Map());
  const onSnapshot = useCallback((bookId: string, snapshot: BookSnapshot) => {
    setSnapshots((current) => {
      const previous = current.get(bookId);
      if (previous !== undefined && previous.month === snapshot.month && previous.summary === snapshot.summary && previous.entries === snapshot.entries && previous.recent === snapshot.recent && previous.complete === snapshot.complete && previous.failed === snapshot.failed) return current;
      const next = new Map(current);
      next.set(bookId, snapshot);
      return next;
    });
  }, []);

  const hiddenCards = config.cards.filter((card) => card.hidden === true && card.kind !== "quick");
  // 快捷操作固定在侧栏；仅派生显示配置，不删除用户保存的卡片配置。
  const mainConfig = useMemo(() => ({ ...config, cards: config.cards.filter(card => card.kind !== "quick") }), [config]);
  const scopeIds = config.crossScope === "all" ? bookIds : config.crossScope;

  const books_ = { list: bookList, byId: new Map(bookList.map((book) => [book.id, book])) };

  const edit = (next: DashboardConfig): void => { setUndo((values) => [...values, config]); setRedo([]); setDraft(next); };

  return (
    <>
      {bookIds.map((bookId) => (
        <BookProbe key={bookId} bookId={bookId} month={month} onSnapshot={onSnapshot} />
      ))}
      <div className="flex h-full min-h-0 flex-col">
        <DesktopToolbar
          title={t("desktop.dashboard.title")}
          meta={t("desktop.dashboard.meta", { month: headerMonthLabel(month) })}
          actions={
            editing ? (
              <>
                {hiddenCards.length > 0 ? <AddCardMenu cards={hiddenCards} books={books_.byId} onAdd={(id) => edit(updateCard(config, id, { hidden: false }))} /> : null}
                <button type="button" className="lv-desk-btn" disabled={undo.length === 0} onClick={() => { const previous = undo.at(-1); if (previous) { setRedo((values) => [...values, config]); setDraft(previous); setUndo((values) => values.slice(0, -1)); } }}>{t("desktop.dashboard.undo")}</button>
                <button type="button" className="lv-desk-btn" disabled={redo.length === 0} onClick={() => { const next = redo.at(-1); if (next) { setUndo((values) => [...values, config]); setDraft(next); setRedo((values) => values.slice(0, -1)); } }}>{t("desktop.dashboard.redo")}</button>
                <button type="button" className="lv-desk-btn" onClick={() => edit(resolveDashboard(null, bookIds))}>
                  {t("desktop.dashboard.reset")}
                </button>
                <button type="button" className="lv-desk-btn" onClick={() => { setDraft(null); setSaved(readConfig(owner)); setSaveError(false); }}>
                  {t("desktop.common.cancel")}
                </button>
                <button
                  type="button"
                  className="lv-desk-btn lv-desk-btn-primary"
                  onClick={() => {
                    if (owner === null || readRawConfig(owner) !== baseline.current || !writeConfig(owner, config)) { setSaveError(true); return; }
                    setSaveError(false);
                    setSaved(config);
                    setDraft(null);
                  }}
                >
                  {t("desktop.common.done")}
                </button>
              </>
            ) : (
              <><NotificationBell showHeading={false} panelClassName="lv-account-notice-panel" /><button type="button" className="lv-desk-btn" onClick={() => { baseline.current = readRawConfig(owner); setUndo([]); setRedo([]); setSaveError(false); setDraft(config); }}>
                {t("desktop.dashboard.edit")}
              </button></>
            )
          }
        >
          <button ref={monthAnchor} type="button" className="lv-desk-btn lv-month-trigger" aria-haspopup="dialog" aria-expanded={monthPickerOpen} title={t("ledger.monthPicker.title")} onClick={() => setMonthPickerOpen(value => !value)}>
            {headerMonthLabel(month)}<ChevronIcon up={monthPickerOpen} className="size-4 text-brand" />
          </button>
          <LedgerMonthPicker open={monthPickerOpen} month={month} maxMonth={currentMonth()} bookIds={bookIds} anchor={monthAnchor}
            onClose={() => setMonthPickerOpen(false)} onSelect={value => { setMonth(value); writeSession("libevra.dashboard.month", value); }} />
        </DesktopToolbar>
        <div className="lv-dash-workspace">
        <div ref={scrollRef} onScroll={(event) => writeSession("libevra.dashboard.scroll", String(event.currentTarget.scrollTop))} className="lv-desk-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="lv-dash">
            {editing ? <p className="text-helper-relaxed text-muted">{t("desktop.dashboard.editHint")}</p> : null}
            {saveError && editing ? <p role="alert" className="text-helper text-danger">{t("desktop.dashboard.saveError")}</p> : null}
            {books.isPending ? <p className="text-body text-muted">{t("desktop.common.loading")}</p> : null}
            {books.isError ? <div role="alert" className="flex items-center gap-4"><p className="text-body text-danger">{t("desktop.dashboard.readFailed")}</p><button className="lv-desk-btn" onClick={() => void books.refetch()}>{t("common.action.retry")}</button></div> : null}
            <DashboardGrid config={mainConfig} editing={editing} onChange={next => edit({ ...next, cards: [...next.cards, ...config.cards.filter(card => card.kind === "quick")] })} scrollRef={scrollRef}
              tools={(card) => card.kind === "ledger" || card.kind === "cross" ? <CardSettings key={card.id} card={card} books={bookList} config={config} onChange={edit} /> : null}
              render={(card) => (
                    <CardFrame
                      card={card}
                      editing={false}
                      first={false}
                      last={false}
                      books={bookList}
                      config={config}
                      onChange={edit}
                    >
                      <CardBody
                        card={card}
                        books={books_.byId}
                        bookIds={bookIds}
                        scopeIds={scopeIds}
                        snapshots={snapshots}
                        currentBookId={currentBookId}
                        mainCode={mainCode}
                        month={month}
                        editing={editing}
                      />
                    </CardFrame>
              )} />
          </div>
        </div>
        <aside className="lv-dash-sidebar" aria-label={t("desktop.dashboard.aside")}><QuickActions /><DashboardMessages books={bookList} /></aside>
        </div>
      </div>
    </>
  );
}

function cardTitleFor(card: DashboardCard, books: ReadonlyMap<string, BookInfo>, t: ReturnType<typeof useI18n>["t"]): string {
  if (card.kind === "ledger") return books.get(card.bookId ?? "")?.name ?? t("desktop.dashboard.cards.ledger");
  return t(`desktop.dashboard.cards.${card.kind}`);
}

function CardFrame({
  card,
  editing,
  first,
  last,
  books,
  config,
  onChange,
  children,
}: {
  readonly card: DashboardCard;
  readonly editing: boolean;
  readonly first: boolean;
  readonly last: boolean;
  readonly books: readonly BookInfo[];
  readonly config: DashboardConfig;
  readonly onChange: (next: DashboardConfig) => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  const byId = useMemo(() => new Map(books.map((book) => [book.id, book])), [books]);
  const title = cardTitleFor(card, byId, t);
  return (
    <section className="lv-dash-card" data-kind={card.kind} data-size={card.size} aria-label={title}>
      <div className="lv-dash-body">{children}</div>
      {editing ? (
        <div className="lv-dash-edit" role="group" aria-label={t("desktop.dashboard.cardTools", { name: title })}>
          <div className="lv-desk-seg lv-desk-seg-sm" role="radiogroup" aria-label={t("desktop.dashboard.size")}>
            {(["compact", "standard", "expanded"] as const).map((size: CardSize) => (
              <button key={size} type="button" role="radio" aria-checked={card.size === size} onClick={() => onChange(updateCard(config, card.id, { size }))}>
                {t(`desktop.dashboard.sizes.${size}`)}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          {card.kind === "ledger" || card.kind === "cross" ? <CardSettings card={card} books={books} config={config} onChange={onChange} /> : null}
          <button type="button" className="lv-desk-icon-btn" disabled={first} onClick={() => onChange(moveCard(config, card.id, -1))} aria-label={t("desktop.dashboard.moveBack")} title={t("desktop.dashboard.moveBack")}>
            ←
          </button>
          <button type="button" className="lv-desk-icon-btn" disabled={last} onClick={() => onChange(moveCard(config, card.id, 1))} aria-label={t("desktop.dashboard.moveForward")} title={t("desktop.dashboard.moveForward")}>
            →
          </button>
          <button type="button" className="lv-desk-icon-btn" onClick={() => onChange(updateCard(config, card.id, { hidden: true }))} aria-label={t("desktop.dashboard.hide")} title={t("desktop.dashboard.hide")}>
            ×
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CardSettings({ card, books, config, onChange }: { readonly card: DashboardCard; readonly books: readonly BookInfo[]; readonly config: DashboardConfig; readonly onChange: (next: DashboardConfig) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const scope = config.crossScope === "all" ? new Set(books.map((book) => book.id)) : new Set(config.crossScope);
  return (
    <>
      <button ref={anchor} type="button" className="lv-desk-btn lv-desk-btn-sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {t("desktop.dashboard.configure")}
      </button>
      {open ? (
        <DesktopPopover anchor={anchor} label={t("desktop.dashboard.configure")} onClose={close} placement="bottom-end" width={240}>
          {card.kind === "ledger" ? (
            <fieldset className="flex flex-col gap-1 p-3">
              <legend className="px-1 pb-1 text-card-title text-ink">{t("desktop.dashboard.metric")}</legend>
              {(["expense", "income", "balance"] as const).map((metric: LedgerMetric) => (
                <label key={metric} className="lv-desk-check-row">
                  <input type="radio" name={`metric-${card.id}`} checked={(card.metric ?? "expense") === metric} onChange={() => onChange(updateCard(config, card.id, { metric }))} />
                  <span className="text-body text-ink">{t(`desktop.entries.${metric}`)}</span>
                </label>
              ))}
              {(["showTrend", "showRecent"] as const).map((key) => <label key={key} className="lv-desk-check-row"><input type="checkbox" checked={card[key] !== false} onChange={(event) => onChange(updateCard(config, card.id, { [key]: event.target.checked }))} /><span className="text-body">{t(`desktop.dashboard.${key}`)}</span></label>)}
            </fieldset>
          ) : (
            <fieldset className="flex flex-col gap-1 p-3">
              <legend className="px-1 pb-1 text-card-title text-ink">{t("desktop.dashboard.scope")}</legend>
              {books.map((book) => (
                <label key={book.id} className="lv-desk-check-row">
                  <input
                    type="checkbox"
                    checked={scope.has(book.id)}
                    onChange={(event) => {
                      const next = new Set(scope);
                      if (event.target.checked) next.add(book.id);
                      else next.delete(book.id);
                      if (next.size === 0) return;
                      onChange({ ...config, crossScope: next.size === books.length ? "all" : books.filter((item) => next.has(item.id)).map((item) => item.id) });
                    }}
                  />
                  <span className="truncate text-body text-ink">{book.name}</span>
                </label>
              ))}
            </fieldset>
          )}
        </DesktopPopover>
      ) : null}
    </>
  );
}

function AddCardMenu({ cards, books, onAdd }: { readonly cards: readonly DashboardCard[]; readonly books: ReadonlyMap<string, BookInfo>; readonly onAdd: (id: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={anchor} type="button" className="lv-desk-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {t("desktop.dashboard.add")}
      </button>
      {open ? (
        <DesktopPopover anchor={anchor} label={t("desktop.dashboard.add")} onClose={close} placement="bottom-end" width={240} role="menu">
          <ul className="p-2">
            {cards.map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  role="menuitem"
                  className="lv-desk-menu-row"
                  onClick={() => {
                    onAdd(card.id);
                    close();
                  }}
                >
                  <span className="truncate text-body text-ink">{cardTitleFor(card, books, t)}</span>
                </button>
              </li>
            ))}
          </ul>
        </DesktopPopover>
      ) : null}
    </>
  );
}

function pickCurrency(summary: SummaryResponse | undefined, preferred: string): { readonly main: CurrencySummary | null; readonly others: number } {
  const list = summary?.currencies ?? [];
  const main = list.find((item) => item.currency === preferred) ?? list[0] ?? null;
  return { main, others: list.filter((item) => item !== main).length };
}

function metricCents(item: CurrencySummary, metric: LedgerMetric): number {
  return metric === "expense" ? item.expenseCents : metric === "income" ? item.incomeCents : item.balanceCents;
}

function CardBody(props: {
  readonly card: DashboardCard;
  readonly books: ReadonlyMap<string, BookInfo>;
  readonly bookIds: readonly string[];
  readonly scopeIds: readonly string[];
  readonly snapshots: ReadonlyMap<string, BookSnapshot>;
  readonly currentBookId: string | null;
  readonly mainCode: string;
  readonly month: string;
  readonly editing: boolean;
}): React.JSX.Element {
  const { card } = props;
  if (card.kind === "ledger") return <LedgerCardBody {...props} />;
  if (card.kind === "trend") return <TrendCardBody {...props} />;
  if (card.kind === "cross") return <CrossCardBody {...props} />;
  if (card.kind === "recent") return <RecentList books={props.books} snapshots={props.snapshots} scopeIds={props.bookIds} limit={24} />;
  if (card.kind === "pending") return <PendingList />;
  return <QuickActions />;
}

function LedgerCardBody({ card, books, snapshots, currentBookId, mainCode, month, editing }: Parameters<typeof CardBody>[0]): React.JSX.Element {
  const { t } = useI18n();
  const switcher = useEnterLedger();
  const book = books.get(card.bookId ?? "");
  const raw = snapshots.get(card.bookId ?? "");
  const snapshot = raw?.month === month ? raw : undefined;
  const { main, others } = pickCurrency(snapshot?.summary, mainCode);
  const metric = card.metric ?? "expense";
  const current = card.bookId === currentBookId;
  const recent = raw?.recent === undefined ? [] : sortByTime(raw.recent).slice(0, 24);
  const open = (chart = false) => {
    if (!editing && book !== undefined) switcher.enter(book.id, undefined, dashboardDestination(month, chart ? "expense" : undefined, main?.currency ?? mainCode));
  };
  return (
    <div className="lv-dash-ledger" data-link={!editing || undefined} onClick={(event) => {
      if (!(event.target instanceof Element) || event.target.closest("button,a,input,select")) return;
      open();
    }}>
      <header className="lv-dash-ledger-head">
        <span className="lv-desk-ledger-badge" aria-hidden="true">{Array.from(book?.name ?? "·")[0]}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-card-title text-ink"><button className="lv-dash-title" disabled={editing || switcher.busy} onClick={() => open()}>{book?.name ?? "—"}</button></h2>
          <p className="text-helper text-muted">{current ? t("desktop.dashboard.currentLedger") : t("desktop.ledgerPicker.members", { count: book?.memberCount ?? 1 })}</p>
        </div>
        {book && !editing ? <BookNotificationBell bookId={book.id} /> : null}
      </header>
      {snapshot?.summary === undefined ? <p className="text-helper text-muted">{t(snapshot?.failed ? "desktop.dashboard.readFailed" : "desktop.common.loading")}</p> : main === null ?
        <p className="text-helper text-muted">{t("desktop.dashboard.noData")}</p> : <>
        <div className="lv-dash-metric"><span className="text-helper text-muted">{t(`desktop.dashboard.metricThisMonth.${metric}`)}</span><span className="lv-dash-figure tabular-nums">{formatMoney(metricCents(main, metric), main.currency)}</span></div>
        <dl className="lv-dash-metrics-row">{(["expense", "income", "balance"] as const).filter((item) => item !== metric).map((item) => <div key={item}><dt className="text-helper text-muted">{t(`desktop.entries.${item}`)}</dt><dd className="text-body text-ink tabular-nums">{formatMoney(metricCents(main, item), main.currency)}</dd></div>)}</dl>
        {others > 0 ? <p className="text-helper text-muted">{t("desktop.entries.otherCurrencies", { count: others })}</p> : null}
      </>}
      {card.showTrend !== false && main !== null ? <DashboardTrend snapshot={snapshot} month={month} currency={main.currency} onOpen={() => open(true)} disabled={editing || switcher.busy} /> : null}
      {card.showRecent !== false && recent.length > 0 ? <div className="lv-dash-ledger-recent">
        <h3 className="text-helper text-muted">{t("desktop.dashboard.cards.recent")}</h3>
        <ul>{recent.map((entry) => <li key={entry.id} className="lv-dash-recent-line text-helper"><span className="text-muted tabular-nums">{entry.occurredLocalDate.slice(5)}</span><span className="min-w-0 truncate text-ink">{entry.note || displayCategoryName(entry.categoryIsSystem ? UNCATEGORISED_NAME : entry.categoryName)}</span><span className="text-ink tabular-nums">{entry.kind === "expense" ? "−" : "+"}{formatMoney(entry.amountCents, entry.currency)}</span></li>)}</ul>
      </div> : null}
      <footer className="lv-dash-ledger-foot"><span role="status" className="text-helper text-danger">{switcher.status}</span><span className="flex-1" /><button className="lv-desk-link" disabled={editing || switcher.busy} onClick={() => open()}>{t("desktop.dashboard.openEntries")} →</button></footer>
    </div>
  );
}

function DashboardTrend({ snapshot, month, currency, onOpen, disabled }: { readonly snapshot: BookSnapshot | undefined; readonly month: string; readonly currency: string; readonly onOpen: () => void; readonly disabled: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const totals = useMemo(() => snapshot?.complete ? dailyTotals(snapshot.entries ?? [], month, currency) : [], [snapshot, month, currency]);
  const max = Math.max(...totals, 1);
  return <button type="button" className="lv-dash-chart" disabled={disabled} onClick={onOpen} aria-label={t("desktop.dashboard.openTrend")}>
    <span className="lv-dash-chart-label text-helper"><span>{t("desktop.entries.trend")} · {currency}</span><span>↗</span></span>
    {snapshot?.complete ? <svg viewBox="0 0 310 70" preserveAspectRatio="none" aria-hidden="true">{totals.map((value, index) => <rect key={index} x={index * 310 / totals.length + 1} y={68 - value / max * 64} width={Math.max(2, 310 / totals.length - 3)} height={Math.max(2, value / max * 64)} rx="2" className={value === 0 ? "fill-line" : "fill-brand"} />)}</svg> : <span className="text-helper text-muted">{t(snapshot?.failed ? "desktop.dashboard.readFailed" : "desktop.common.loading")}</span>}
  </button>;
}

function TrendCardBody({ books, snapshots, currentBookId, bookIds, mainCode, month, editing }: Parameters<typeof CardBody>[0]): React.JSX.Element {
  const { t } = useI18n();
  const [chosen, setChosen] = useState(currentBookId ?? bookIds[0] ?? "");
  const bookId = books.has(chosen) ? chosen : bookIds[0] ?? "";
  const snapshot = snapshots.get(bookId);
  const data = snapshot?.month === month ? snapshot : undefined;
  const { main } = pickCurrency(data?.summary, mainCode);
  const currency = main?.currency ?? mainCode;
  const switcher = useEnterLedger();
  return <div className="lv-dash-list lv-dash-trend-card"><header className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-card-title">{t("desktop.dashboard.cards.trend")}</h2><select aria-label={t("desktop.ledgerPicker.title")} className="lv-dash-select rounded-field border border-line bg-surface text-base" value={bookId} disabled={editing} onChange={(event) => setChosen(event.target.value)}>{bookIds.map((id) => <option key={id} value={id}>{books.get(id)?.name}</option>)}</select></header>
    <p className="text-helper text-muted">{headerMonthLabel(month)} · {currency}</p>
    <DashboardTrend snapshot={data} month={month} currency={currency} disabled={editing || switcher.busy} onOpen={() => switcher.enter(bookId, undefined, dashboardDestination(month, "expense", currency))} />
    <p className="text-helper text-muted">{data?.summary === undefined ? t(data?.failed ? "desktop.dashboard.readFailed" : "desktop.common.loading") : main === null ? t("desktop.dashboard.noData") : t("desktop.dashboard.metricThisMonth.expense") + " · " + formatMoney(main.expenseCents, currency)}</p>
    {switcher.status ? <p role="status" className="text-helper text-danger">{switcher.status}</p> : null}
  </div>;
}

function CrossCardBody({ books, scopeIds, snapshots, mainCode, month }: Parameters<typeof CardBody>[0]): React.JSX.Element {
  const { t } = useI18n();
  const ready = scopeIds.map((id) => (snapshots.get(id)?.month === month ? snapshots.get(id)?.summary : undefined)).filter((summary): summary is SummaryResponse => summary !== undefined);
  const missing = scopeIds.length - ready.length;
  const totals = totalsByCurrency(ready, mainCode);
  const names = scopeIds.map((id) => books.get(id)?.name).filter((name): name is string => name !== undefined);
  return (
    <div className="lv-dash-cross">
      <header>
        <h2 className="text-card-title text-ink">{t("desktop.dashboard.cards.cross")}</h2>
        <p className="truncate text-helper text-muted" title={names.join("、")}>
          {scopeIds.length === books.size ? t("desktop.dashboard.scopeAll", { count: scopeIds.length }) : t("desktop.dashboard.scopeSome", { count: scopeIds.length })}
        </p>
      </header>
      {totals.length === 0 ? (
        <p className="text-helper text-muted">{missing > 0 ? t("desktop.common.loading") : t("desktop.dashboard.noData")}</p>
      ) : (
        <table className="lv-dash-table">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">{t("desktop.dashboard.currency")}</span></th>
              <th scope="col">{t("desktop.entries.expense")}</th>
              <th scope="col">{t("desktop.entries.income")}</th>
              <th scope="col">{t("desktop.entries.balance")}</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((row) => (
              <tr key={row.currency}>
                <th scope="row">{row.currency}</th>
                <td>{formatMoney(row.expenseCents, row.currency)}</td>
                <td>{formatMoney(row.incomeCents, row.currency)}</td>
                <td>{formatMoney(row.balanceCents, row.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="lv-dash-note text-helper text-muted">
        {t("desktop.dashboard.crossNote")}
        {missing > 0 && totals.length > 0 ? ` ${t("desktop.dashboard.crossMissing", { count: missing })}` : ""}
      </p>
    </div>
  );
}

function RecentList({
  books,
  snapshots,
  scopeIds,
  limit,
}: {
  readonly books: ReadonlyMap<string, BookInfo>;
  readonly snapshots: ReadonlyMap<string, BookSnapshot>;
  readonly scopeIds: readonly string[];
  readonly limit: number;
}): React.JSX.Element {
  const { t } = useI18n();
  const switcher = useEnterLedger();
  const multiple = books.size > 1;
  const items = useMemo(() => {
    const all: { readonly entry: Transaction; readonly bookId: string }[] = [];
    for (const bookId of scopeIds) {
      for (const entry of snapshots.get(bookId)?.recent ?? []) all.push({ entry, bookId });
    }
    const order = new Map(sortByTime(all.map((item) => item.entry)).map((entry, index) => [entry.id, index]));
    return [...all].sort((a, b) => (order.get(a.entry.id) ?? 0) - (order.get(b.entry.id) ?? 0)).slice(0, limit);
  }, [scopeIds, snapshots, limit]);
  return (
    <div className="lv-dash-list">
      <h2 className="text-card-title text-ink">{t("desktop.dashboard.cards.recent")}</h2>
      {switcher.status ? <p role="status" className="text-helper text-danger">{switcher.status}</p> : null}
      {items.length === 0 ? <p className="text-helper text-muted">{t("desktop.dashboard.recentEmpty")}</p> : null}
      <ul>
        {items.map(({ entry, bookId }) => {
          const label = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">
                  {displayCategoryName(entry.categoryIsSystem ? UNCATEGORISED_NAME : entry.categoryName)}
                  {entry.note ? <span className="text-muted"> · {entry.note}</span> : null}
                </span>
                <span className="block truncate text-helper text-muted">
                  {formatDayLabel(entry.occurredLocalDate)}
                  {multiple ? ` · ${books.get(bookId)?.name ?? ""}` : ""}
                </span>
              </span>
              <span className={`shrink-0 text-body tabular-nums ${entry.kind === "income" ? "text-brand-dark" : "text-ink"}`}>
                {entry.kind === "expense" ? "-" : "+"}
                {formatMoney(entry.amountCents, entry.currency)}
              </span>
            </>
          );
          return (
            <li key={`${bookId}:${entry.id}`}>
              <button className="lv-dash-row" disabled={switcher.busy} onClick={() => switcher.enter(bookId, undefined, dashboardDestination(entry.occurredLocalDate.slice(0, 7)) + "&entry=" + encodeURIComponent(entry.id))}>{label}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PendingList(): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const { offline } = useAccountOffline();
  const pending = useSyncExternalStore(subscribePending, pendingEntriesValue, pendingEntriesValue);
  const conflicts = useSyncExternalStore(subscribeConflicts, conflictsValue, conflictsValue);
  const [syncing, setSyncing] = useState(false);
  const items: React.ReactNode[] = [];
  if (conflicts.length > 0) {
    items.push(
      <li key="conflicts" className="lv-dash-pending" data-tone="warn">
        <span className="min-w-0 flex-1 text-body text-ink">{t("desktop.dashboard.pendingConflicts", { count: conflicts.length })}</span>
        <Link to="/" className="lv-desk-link">{t("desktop.dashboard.review")}</Link>
      </li>,
    );
  }
  if (!guest && pending.size > 0) {
    items.push(
      <li key="pending" className="lv-dash-pending">
        <span className="min-w-0 flex-1 text-body text-ink">{offline ? t("desktop.dashboard.pendingOffline", { count: pending.size }) : t("desktop.dashboard.pendingSync", { count: pending.size })}</span>
        {offline ? null : (
          <button
            type="button"
            className="lv-desk-link"
            disabled={syncing}
            onClick={() => {
              setSyncing(true);
              void syncNow().finally(() => setSyncing(false));
            }}
          >
            {t("desktop.dashboard.syncNow")}
          </button>
        )}
      </li>,
    );
  }
  return (
    <div className="lv-dash-list">
      <h2 className="text-card-title text-ink">{t("desktop.dashboard.cards.pending")}</h2>
      {items.length === 0 ? <p className="text-helper text-muted">{t("desktop.dashboard.pendingNone")}</p> : <ul>{items}</ul>}
    </div>
  );
}

function QuickActions(): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const navigate = useNavigate();
  return (
    <div className="lv-dash-quick">
      <h2 className="text-card-title text-ink">{t("desktop.dashboard.cards.quick")}</h2>
      <div className="lv-dash-quick-grid" role="menu" aria-label={t("desktop.dashboard.cards.quick")}>
        <EntryMethodList
          disabledFor={(action) => desktopEntryDisabled(action, guest)}
          onNavigate={(path, prepare) => {
            prepare?.();
            void navigate(path);
          }}
        />
      </div>
    </div>
  );
}
