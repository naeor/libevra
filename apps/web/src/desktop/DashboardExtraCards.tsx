/**
 * 第二批的总览卡片（1.19.103，候选清单 A3、A4、A6、A8）：账本对比、全账本月历、待整理、常用账目。
 * 与其它总览卡片一样按正文区的实际像素决定显示多少；数据来自各账本的数据作用域（与分析页同一份读取）。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { useAuth } from "../auth/AuthProvider.js";
import { BottomSheet } from "../components/BottomSheet.js";
import { useI18n } from "../i18n/index.js";
import { formatDayLabel, toLocalDate } from "../lib/datetime.js";
import { formatMoney } from "../lib/format.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { conflictsValue, pendingEntriesValue, subscribeConflicts, subscribePending } from "../lib/offline/localLedger.js";
import { syncNow } from "../lib/offline/syncController.js";
import { pendingAttachments } from "../lib/pendingAttachments.js";
import { sortByTime } from "../pages/DetailPage.js";
import { INBOX_KINDS, nativeOptions, resolveBooks, type NativeMetric } from "../statsWorkbench/nativeCards.js";
import { bookFigures, combinedDaily, dailySeries, inRange } from "./dashboardData.js";
import { dashboardDestination } from "./dashboardNavigation.js";
import { useDashboardBooks } from "./dashboardScopes.js";
import { addTemplate, DASHBOARD_TEMPLATES_CHANGED, deleteTemplate, loadTemplates, templateCopyFrom, type EntryTemplate } from "./dashboardStore.js";
import { useEnterLedger } from "./DesktopNav.js";
import { useDashboardView as useView } from "./dashboardView.js";

function metricValue(totals: { readonly expense: number; readonly income: number; readonly balance: number }, metric: NativeMetric): number {
  return metric === "expense" ? totals.expense : metric === "income" ? totals.income : totals.balance;
}

// ---------------------------------------------------------------------------
// 账本对比（A3）
// ---------------------------------------------------------------------------

export function CompareBody({ card, width, height }: { readonly card: AnalysisCardNode; readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  const view = useView();
  const data = useDashboardBooks();
  const options = nativeOptions(card);
  const metric = options.metric ?? "expense";
  const books = resolveBooks(options.books, view.bookIds);
  // 原币时只比主币种（不同币种不能放在一根轴上）；综合折算时比折算后的合计。
  const rows = books.map((bookId) => {
    const figures = bookFigures(data.get(bookId)?.scope, view.mainCode);
    const main = figures.combined ? figures.totals[0] : figures.totals.find((item) => item.currency === view.mainCode);
    return { bookId, ready: figures.state === "ready", value: main === undefined ? 0 : metricValue(main, metric), currency: main?.currency ?? view.mainCode };
  }).sort((a, b) => b.value - a.value);
  const loading = rows.some((row) => !row.ready);
  if (rows.every((row) => !row.ready)) return <p className="text-helper text-muted">{t("desktop.common.loading")}</p>;
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  const visible = Math.max(1, Math.floor((height - (height >= 120 ? 20 : 0)) / 30));
  const withAmount = width >= 240;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      {height >= 120 ? <p className="text-helper text-muted">{t(`desktop.dashboard.compare.${metric}`, { currency: rows[0]?.currency ?? view.mainCode })}</p> : null}
      <ul className="flex min-h-0 flex-col gap-1.5">
        {rows.slice(0, visible).map((row) => (
          <li key={row.bookId} className="lv-compare-row" title={`${view.books.get(row.bookId)?.name ?? ""} ${formatMoney(row.value, row.currency)}`}>
            <span className="lv-compare-name truncate text-helper text-ink">{view.books.get(row.bookId)?.name ?? "—"}</span>
            <span className="lv-compare-track" aria-hidden="true"><span className={row.value < 0 ? "bg-danger" : "bg-brand"} style={{ width: `${String(Math.max(2, (Math.abs(row.value) / max) * 100))}%` }} /></span>
            {withAmount ? <span className="shrink-0 text-helper tabular-nums text-ink" data-amount="">{row.ready ? formatMoney(row.value, row.currency) : "…"}</span> : null}
          </li>
        ))}
      </ul>
      {rows.length > visible ? <p className="text-helper text-muted">{t("desktop.dashboard.compare.more", { count: rows.length - visible })}</p> : null}
      {loading && height >= 150 ? <p className="text-helper text-muted">{t("desktop.common.loading")}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 全账本月历（A4）
// ---------------------------------------------------------------------------

export function CalendarBody({ card, width, height }: { readonly card: AnalysisCardNode; readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  const view = useView();
  const data = useDashboardBooks();
  const books = resolveBooks(nativeOptions(card).books, view.bookIds);
  const month = view.month;
  const range = useMemo(() => {
    const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
  }, [month]);
  const totals = useMemo(() => {
    const sums = new Map<string, number>();
    let currency = view.mainCode;
    for (const bookId of books) {
      const scope = data.get(bookId)?.scope;
      if (scope === undefined) continue;
      const series = scope.combined ? combinedDaily(scope) : dailySeries(scope.entries, range, view.mainCode);
      if (scope.combined && scope.fx?.result !== undefined) currency = scope.fx.result.targetCurrency;
      for (const item of series ?? []) if (item.date >= range.from && item.date <= range.to) sums.set(item.date, (sums.get(item.date) ?? 0) + item.value);
    }
    return { sums, currency };
  }, [books, data, range, view.mainCode]);
  const days = Number(range.to.slice(8, 10));
  // 周一开始：1 号前面空几格。
  const offset = (new Date(`${range.from}T00:00:00`).getDay() + 6) % 7;
  const weeks = Math.ceil((offset + days) / 7);
  const headerRow = height >= 160 ? 18 : 0;
  const cellHeight = Math.max(12, (height - headerRow - 4) / weeks);
  const cellWidth = width / 7;
  const showAmount = cellWidth >= 64 && cellHeight >= 40;
  const showDay = cellHeight >= 18;
  const max = Math.max(1, ...totals.sums.values());
  const today = toLocalDate(new Date());
  const weekdays = t("desktop.dashboard.calendar.weekdays").split(",");
  return (
    <div className="lv-calendar" style={{ gridTemplateRows: `${headerRow > 0 ? `${String(headerRow)}px ` : ""}repeat(${String(weeks)}, minmax(0, 1fr))` }} role="grid" aria-label={t("desktop.dashboard.calendar.label", { month })}>
      {headerRow > 0 ? weekdays.map((day) => <span key={day} className="text-center text-helper text-muted" role="columnheader">{day}</span>) : null}
      {Array.from({ length: weeks * 7 }, (_, index) => {
        const day = index - offset + 1;
        if (day < 1 || day > days) return <span key={index} aria-hidden="true" />;
        const date = `${month}-${String(day).padStart(2, "0")}`;
        const value = totals.sums.get(date) ?? 0;
        const label = `${formatDayLabel(date)} ${value === 0 ? t("desktop.dashboard.calendar.none") : formatMoney(value, totals.currency)}`;
        return (
          <span key={index} role="gridcell" className="lv-calendar-day" data-today={date === today ? "" : undefined} title={label} aria-label={label}
            style={{ ["--lv-heat" as string]: value === 0 ? "0" : String(0.18 + 0.72 * (value / max)) }}>
            {showDay ? <span className="text-helper tabular-nums">{day}</span> : null}
            {showAmount && value > 0 ? <span className="truncate text-helper tabular-nums" data-amount="">{formatMoney(value, totals.currency)}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 待整理（A6）
// ---------------------------------------------------------------------------

function useAttachmentCounts(): { readonly waiting: number; readonly failed: number } {
  const { user } = useAuth();
  const [counts, setCounts] = useState({ waiting: 0, failed: 0 });
  useEffect(() => {
    if (user === null) return;
    let alive = true;
    const read = () => void pendingAttachments(user.id).then((items) => {
      if (alive) setCounts({ waiting: items.filter((item) => item.error === null).length, failed: items.filter((item) => item.error !== null).length });
    }).catch(() => undefined);
    read();
    const timer = setInterval(read, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [user]);
  return counts;
}

export function InboxBody({ card, width, height }: { readonly card: AnalysisCardNode; readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  const view = useView();
  const data = useDashboardBooks();
  const guest = useGuestMode();
  const { offline } = useAccountOffline();
  const switcher = useEnterLedger();
  const navigate = useNavigate();
  const pending = useSyncExternalStore(subscribePending, pendingEntriesValue, pendingEntriesValue);
  const conflicts = useSyncExternalStore(subscribeConflicts, conflictsValue, conflictsValue);
  const attachments = useAttachmentCounts();
  const [syncing, setSyncing] = useState(false);
  const options = nativeOptions(card);
  const kinds = new Set(options.kinds ?? INBOX_KINDS);
  const books = resolveBooks(options.books, view.bookIds);
  const items: { readonly key: string; readonly count: number; readonly label: string; readonly action?: { readonly label: string; readonly run: () => void; readonly busy?: boolean } }[] = [];
  if (kinds.has("conflicts") && conflicts.length > 0) items.push({ key: "conflicts", count: conflicts.length, label: t("desktop.dashboard.inbox.conflicts", { count: conflicts.length }), action: { label: t("desktop.dashboard.review"), run: () => void navigate("/") } });
  if (kinds.has("pending") && !guest && pending.size > 0) items.push({ key: "pending", count: pending.size, label: offline ? t("desktop.dashboard.pendingOffline", { count: pending.size }) : t("desktop.dashboard.pendingSync", { count: pending.size }), ...(offline ? {} : { action: { label: t("desktop.dashboard.syncNow"), busy: syncing, run: () => { setSyncing(true); void syncNow().finally(() => setSyncing(false)); } } }) });
  if (kinds.has("uncategorised")) {
    for (const bookId of books) {
      const scope = data.get(bookId)?.scope;
      if (scope === undefined || !scope.loaded) continue;
      const count = scope.entries.filter((entry) => entry.categoryIsSystem && inRange(entry, scope.range)).length;
      if (count > 0) items.push({ key: `uncategorised-${bookId}`, count, label: t("desktop.dashboard.inbox.uncategorised", { count, name: view.books.get(bookId)?.name ?? "" }), action: { label: t("desktop.dashboard.review"), run: () => switcher.enter(bookId, undefined, dashboardDestination(view.month)) } });
    }
  }
  if (kinds.has("missingFx")) {
    const missing = books.reduce((sum, bookId) => sum + bookFigures(data.get(bookId)?.scope, view.mainCode).missing, 0);
    if (missing > 0) items.push({ key: "missingFx", count: missing, label: t("desktop.dashboard.missingFx", { count: missing }) });
  }
  if (kinds.has("attachments") && !guest) {
    if (attachments.failed > 0) items.push({ key: "attachments-failed", count: attachments.failed, label: t("desktop.dashboard.inbox.attachmentsFailed", { count: attachments.failed }) });
    if (attachments.waiting > 0) items.push({ key: "attachments", count: attachments.waiting, label: t("desktop.dashboard.inbox.attachmentsWaiting", { count: attachments.waiting }) });
  }
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (items.length === 0) return <p className="text-helper text-muted">{t("desktop.dashboard.inbox.none")}</p>;
  if (height < 70 || width < 200) {
    return (
      <p className="flex items-baseline gap-2">
        <span className="text-card-title tabular-nums text-ink">{total}</span>
        <span className="text-helper text-muted">{t("desktop.dashboard.inbox.short")}</span>
      </p>
    );
  }
  const visible = Math.max(1, Math.floor(height / 46));
  return (
    <ul className="flex flex-col gap-1.5">
      {items.slice(0, visible).map((item) => (
        <li key={item.key} className="lv-dash-pending">
          <span className="min-w-0 flex-1 text-body text-ink">{item.label}</span>
          {item.action === undefined ? null : <button type="button" className="lv-desk-link" disabled={item.action.busy === true || switcher.busy} onClick={item.action.run}>{item.action.label}</button>}
        </li>
      ))}
      {items.length > visible ? <li className="text-helper text-muted">{t("desktop.dashboard.compare.more", { count: items.length - visible })}</li> : null}
      {switcher.status === null ? null : <li role="status" className="text-helper text-danger">{switcher.status}</li>}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 常用账目（A8）
// ---------------------------------------------------------------------------

function useTemplates(owner: string | null): readonly EntryTemplate[] {
  const [items, setItems] = useState(() => loadTemplates(owner));
  useEffect(() => {
    setItems(loadTemplates(owner));
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === owner) setItems(loadTemplates(owner)); };
    window.addEventListener(DASHBOARD_TEMPLATES_CHANGED, changed);
    return () => window.removeEventListener(DASHBOARD_TEMPLATES_CHANGED, changed);
  }, [owner]);
  return items;
}

export function TemplatesBody({ width, height }: { readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  const view = useView();
  const owner = view.owner;
  const navigate = useNavigate();
  const templates = useTemplates(owner);
  const [managing, setManaging] = useState(false);
  const usable = templates.filter((item) => item.bookId === view.currentBookId);
  const others = templates.length - usable.length;
  const iconOnly = width < 180 || height < 60;
  const visible = Math.max(1, Math.floor((height - 24) / (iconOnly ? 34 : 40)) * Math.max(1, Math.floor(width / 150)));
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      {usable.length === 0 ? <p className="text-helper text-muted">{t(templates.length === 0 ? "desktop.dashboard.templates.empty" : "desktop.dashboard.templates.otherBooks", { count: others })}</p> : null}
      <div className="lv-template-grid">
        {usable.slice(0, visible).map((item) => (
          <button
            key={item.id}
            type="button"
            className="lv-template"
            title={`${item.name} ${formatMoney(item.amountCents, item.currency)}`}
            onClick={() => void navigate("/add", { state: { copyFrom: templateCopyFrom(item) } })}
          >
            <span className="min-w-0 flex-1 truncate text-left text-body text-ink">{item.name}</span>
            {iconOnly ? null : <span className="shrink-0 text-helper tabular-nums text-muted" data-amount="">{item.kind === "income" ? "+" : "−"}{formatMoney(item.amountCents, item.currency)}</span>}
          </button>
        ))}
      </div>
      {height >= 90 ? (
        <div className="mt-auto flex items-center gap-3">
          <button type="button" className="lv-desk-link" onClick={() => setManaging(true)}>{t("desktop.dashboard.templates.manage")}</button>
          {usable.length > 0 && others > 0 ? <span className="text-helper text-muted">{t("desktop.dashboard.templates.otherBooks", { count: others })}</span> : null}
        </div>
      ) : null}
      {managing ? <TemplateManager owner={owner} templates={templates} onClose={() => setManaging(false)} /> : null}
    </div>
  );
}

function TemplateManager({ owner, templates, onClose }: { readonly owner: string | null; readonly templates: readonly EntryTemplate[]; readonly onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const view = useView();
  const data = useDashboardBooks();
  const [message, setMessage] = useState<string | null>(null);
  const current = view.currentBookId;
  const recent = current === null ? [] : sortByTime(data.get(current)?.recent ?? []).slice(0, 12);
  return (
    <BottomSheet label={t("desktop.dashboard.templates.title")} title={t("desktop.dashboard.templates.title")} onClose={onClose}>
      {() => (
        <div className="flex flex-col gap-5 px-6 pt-1 pb-6">
          <p className="text-helper-relaxed text-muted">{t("desktop.dashboard.templates.hint")}</p>
          <section className="flex flex-col gap-2">
            {templates.length === 0 ? <p className="text-helper text-muted">{t("desktop.dashboard.templates.empty")}</p> : null}
            {templates.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-field border border-line bg-surface px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">{item.name}</span>
                  <span className="block truncate text-helper text-muted">{view.books.get(item.bookId)?.name ?? t("desktop.dashboard.templates.goneBook")} · {formatMoney(item.amountCents, item.currency)}</span>
                </span>
                <button type="button" className="lv-desk-btn" onClick={() => { if (owner !== null) deleteTemplate(owner, item.id); }}>{t("desktop.dashboard.presets.delete")}</button>
              </div>
            ))}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-helper font-medium text-muted">{t("desktop.dashboard.templates.fromRecent")}</h3>
            {recent.length === 0 ? <p className="text-helper text-muted">{t("desktop.dashboard.recentEmpty")}</p> : null}
            {recent.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 border-b border-line py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">{entry.note || entry.categoryName || "—"}</span>
                  <span className="block truncate text-helper text-muted">{formatDayLabel(entry.occurredLocalDate)} · {entry.kind === "income" ? "+" : "−"}{formatMoney(entry.amountCents, entry.currency)}</span>
                </span>
                <button
                  type="button"
                  className="lv-desk-btn"
                  disabled={owner === null || current === null}
                  onClick={() => {
                    if (owner === null || current === null) return;
                    const result = addTemplate(owner, current, entry, entry.note || entry.categoryName || formatMoney(entry.amountCents, entry.currency));
                    setMessage(t(`desktop.dashboard.templates.results.${result}`));
                  }}
                >
                  {t("desktop.dashboard.templates.save")}
                </button>
              </div>
            ))}
            {message === null ? null : <p role="status" className="text-helper text-muted">{message}</p>}
          </section>
        </div>
      )}
    </BottomSheet>
  );
}
