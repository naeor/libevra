/**
 * **总览卡片的画法**（1.19.100）：账本、多账本收支、支出趋势、最近账目、待处理、快捷操作。
 *
 * 与分析卡片一样，**卡片按自己正文区的实际像素决定显示多少内容**（不缩小字号去硬塞、不截断金额）：
 *
 * | 卡片 | 小 | 中 | 大 |
 * |---|---|---|---|
 * | 账本 | 主要指标一个数 | + 另外两项指标 | + 每日趋势；更大时 + 最近账目（宽时并排） |
 * | 多账本收支 | 合计支出 | 支出 / 收入 / 结余 | 按币种的表；宽时按账本分列 |
 * | 支出趋势 | 迷你趋势线 + 合计 | 每日柱 + 合计 | + 日期刻度、日均 |
 * | 最近账目 | 按高度决定几行 | 宽时加日期 | 再宽加账本名 |
 * | 待处理 | 件数 | 列表与操作 | |
 * | 快捷操作 | 只有图标 | 图标 + 名称 | |
 *
 * 数据来自各账本的数据作用域（`dashboardScopes.tsx`），与分析页同一份读取；点击账本相关的内容会先激活那本账
 * （切换账本仍是整页重新载入），再进入明细或分析（S18-B 桌面第二轮，所有者 2026-11-01）。
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import { useDashboardView, type DashboardView } from "./dashboardView.js";
import { CalendarBody, CompareBody, InboxBody, TemplatesBody } from "./DashboardExtraCards.js";
import { UNCATEGORISED_NAME, type Transaction } from "@libellum/shared";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { BookNotificationBell } from "../components/BookNotificationBell.js";
import { useI18n } from "../i18n/index.js";
import { formatDayLabel } from "../lib/datetime.js";
import { formatMoney } from "../lib/format.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { conflictsValue, pendingEntriesValue, subscribeConflicts, subscribePending } from "../lib/offline/localLedger.js";
import { syncNow } from "../lib/offline/syncController.js";
import { displayCategoryName } from "../lib/presetNames.js";
import { sortByTime } from "../pages/DetailPage.js";
import { cardTitle } from "../statsWorkbench/cards.js";
import type { NativeTileProps } from "../statsWorkbench/cardRender.js";
import { cardDisplay, nativeKindOf, nativeOptions, resolveBooks, type NativeMetric } from "../statsWorkbench/nativeCards.js";
import { openInNewTab, wantsNewTab } from "../lib/desktopInput.js";
import { ChevronRight, FitAmount, useElementSize } from "../statsWorkbench/ui.js";
import { EntryMethodList } from "../workspace/RailEntryMenu.js";
import { bookFigures, combinedDaily, dailySeries, inRange, mergeTotals, type BookFigures, type CurrencyTotals } from "./dashboardData.js";
import { dashboardDestination } from "./dashboardNavigation.js";
import { useDashboardBooks, type BookData } from "./dashboardScopes.js";
import { desktopEntryDisabled, useEnterLedger } from "./DesktopNav.js";

export { DashboardViewContext, type DashboardBook, type DashboardView } from "./dashboardView.js";
const useView = useDashboardView;

const METRICS: readonly NativeMetric[] = ["expense", "income", "balance"];

function metricOf(item: CurrencyTotals, metric: NativeMetric): number {
  return metric === "expense" ? item.expense : metric === "income" ? item.income : item.balance;
}

// ---------------------------------------------------------------------------
// 外框
// ---------------------------------------------------------------------------

/**
 * 整张卡片可点的只有账本卡片（先激活那本账，再进入明细）与支出趋势（再进入分析，在右侧辅助栏显示每日支出图）；
 * 其它总览卡片的内容里有自己的按钮，不放整卡的点击层。
 */
export function NativeTile({ card, bare, oneRow, aside }: NativeTileProps): React.JSX.Element {
  const { t } = useI18n();
  const view = useView();
  const books = useDashboardBooks();
  const switcher = useEnterLedger();
  const body = useElementSize<HTMLDivElement>({ deferred: true });
  const kind = nativeKindOf(card);
  const title = cardTitle(card, t);
  const subtitle = useSubtitle(card);
  const options = nativeOptions(card);
  const display = cardDisplay(card);
  const bookId = kind === "ledger" ? options.bookId : undefined;
  const target = kind === "ledger" ? options.bookId : kind === "trend" ? options.bookId ?? view.currentBookId ?? undefined : undefined;
  // 点卡片：账本卡片默认进明细、趋势默认进分析；卡片设置里可以改成另一个或不响应。
  const toAnalysis = display.open === "analysis" || (kind === "trend" && display.open !== "entries");
  const destination = toAnalysis ? dashboardDestination(view.month, "expense", view.mainCode) : dashboardDestination(view.month);
  const open = target === undefined || !view.books.has(target) || display.open === "none" ? undefined : () => switcher.enter(target, undefined, destination);
  // 只有当前账本能直接在新标签页打开（别的账本要先激活，新标签页里还是设备的当前账本）。
  const newTab = open !== undefined && target === view.currentBookId ? destination : null;
  const quiet = display.empty === "quiet" && nativeIsEmpty(card, view, books);
  return (
    <article
      className={`sw-card lv-native group relative flex h-full min-h-0 flex-col ${bare ? "px-3.5 pt-3 pb-2" : "rounded-card border border-line bg-surface p-3.5 sm:p-4"}`}
      aria-label={title}
      data-card-id={card.objectId}
      data-kind={kind ?? "unknown"}
      data-one-row={oneRow ? "" : undefined}
      data-masked={display.masked === true ? "" : undefined}
      data-quiet={quiet ? "" : undefined}
    >
      {open === undefined ? null : (
        <button
          type="button"
          id={`sw-card-${card.objectId}`}
          className="sw-card-hit"
          aria-label={t("desktop.dashboard.openNamed", { name: title })}
          disabled={switcher.busy}
          onClick={(event) => { if (newTab !== null && wantsNewTab(event)) openInNewTab(newTab); else open(); }}
          onAuxClick={(event) => { if (newTab !== null && event.button === 1) openInNewTab(newTab); }}
        />
      )}
      <header className="pointer-events-none relative flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1">
          <h3 className={`${oneRow ? "truncate" : "line-clamp-2 break-words"} text-helper font-medium text-ink`} title={oneRow ? title : undefined}>{title}</h3>
          {subtitle === "" ? null : <p className="truncate text-helper text-muted">{subtitle}</p>}
          {display.note === undefined ? null : <p className="truncate text-helper text-muted" title={display.note}>{display.note}</p>}
        </span>
        {/* 一行高的卡片放不下 44px 的提醒铃：留给数字（提醒仍在侧栏与账本页）。 */}
        {aside ?? (bookId !== undefined && !oneRow ? <span className="pointer-events-auto relative"><BookNotificationBell bookId={bookId} /></span> : open === undefined ? null : <ChevronRight width={14} height={14} className="sw-card-chevron mt-0.5 shrink-0 text-muted" />)}
      </header>
      <div ref={body.ref} className="sw-card-body lv-native-body relative mt-2 min-h-0 flex-1 overflow-hidden">
        {quiet ? <p className="text-helper text-muted">{t("statsWorkbench.states.empty")}</p> : body.width === 0 ? null : <NativeBody card={card} width={body.width} height={body.height} />}
      </div>
    </article>
  );
}

/** 「没有数据时只留一句说明」：账本 / 趋势看那一本，多账本收支看所选账本；读完了且范围内一笔都没有才算。 */
function nativeIsEmpty(card: AnalysisCardNode, view: DashboardView, books: ReadonlyMap<string, BookData>): boolean {
  const kind = nativeKindOf(card);
  const options = nativeOptions(card);
  const ids = kind === "ledger" ? (options.bookId === undefined ? [] : [options.bookId])
    : kind === "trend" ? [options.bookId ?? view.currentBookId ?? ""]
      : kind === "cross" || kind === "compare" ? resolveBooks(options.books, view.bookIds)
        : [];
  if (ids.length === 0) return false;
  return ids.every((id) => {
    const scope = books.get(id)?.scope;
    return scope !== undefined && scope.loaded && !scope.entries.some((entry) => inRange(entry, scope.range));
  });
}

function useSubtitle(card: AnalysisCardNode): string {
  const { t } = useI18n();
  const view = useView();
  const kind = nativeKindOf(card);
  const options = nativeOptions(card);
  if (kind === "ledger") {
    const book = options.bookId === undefined ? undefined : view.books.get(options.bookId);
    if (book === undefined) return "";
    return options.bookId === view.currentBookId ? t("desktop.dashboard.currentLedger") : t("desktop.ledgerPicker.members", { count: book.memberCount });
  }
  if (kind === "trend") {
    const bookId = options.bookId ?? view.currentBookId ?? undefined;
    return bookId === undefined ? "" : view.books.get(bookId)?.name ?? "";
  }
  if (kind === "cross" || kind === "recent" || kind === "compare" || kind === "calendar" || kind === "inbox") {
    const books = resolveBooks(options.books, view.bookIds);
    if (view.bookIds.length <= 1) return "";
    return books.length === view.bookIds.length ? t("desktop.dashboard.booksAll", { count: books.length }) : t("desktop.dashboard.booksSome", { count: books.length });
  }
  return "";
}

function NativeBody({ card, width, height }: { readonly card: AnalysisCardNode; readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  switch (nativeKindOf(card)) {
    case "ledger":
      return <LedgerBody card={card} width={width} height={height} />;
    case "cross":
      return <CrossBody card={card} width={width} height={height} />;
    case "trend":
      return <TrendBody card={card} width={width} height={height} />;
    case "recent":
      return <RecentBody card={card} width={width} height={height} />;
    case "pending":
      return <PendingBody width={width} height={height} />;
    case "quick":
      return <QuickBody width={width} height={height} />;
    case "inbox":
      return <InboxBody card={card} width={width} height={height} />;
    case "calendar":
      return <CalendarBody card={card} width={width} height={height} />;
    case "templates":
      return <TemplatesBody width={width} height={height} />;
    case "compare":
      return <CompareBody card={card} width={width} height={height} />;
    default:
      return <p className="text-helper text-muted">{t("statsWorkbench.card.unknown")}</p>;
  }
}

function StateNote({ figures }: { readonly figures: BookFigures }): React.JSX.Element | null {
  const { t } = useI18n();
  if (figures.state === "loading") return <p className="text-helper text-muted">{t("desktop.common.loading")}</p>;
  if (figures.state === "denied") return <p className="text-helper text-muted">{t("desktop.dashboard.denied")}</p>;
  if (figures.state === "failed") return <p className="text-helper text-muted">{t("desktop.dashboard.readFailed")}</p>;
  if (figures.totals.length === 0) return <p className="text-helper text-muted">{t("desktop.dashboard.noData")}</p>;
  return null;
}

// ---------------------------------------------------------------------------
// 账本
// ---------------------------------------------------------------------------

function LedgerBody({ card, width, height }: { readonly card: AnalysisCardNode; readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  const view = useView();
  const books = useDashboardBooks();
  const switcher = useEnterLedger();
  const options = nativeOptions(card);
  const bookId = options.bookId;
  const data = bookId === undefined ? undefined : books.get(bookId);
  const available = bookId !== undefined && view.books.has(bookId);
  const figures = available ? bookFigures(data?.scope, view.mainCode) : { state: "denied" as const, totals: [], missing: 0, combined: false };
  const metric = options.metric ?? "expense";
  const main = figures.totals[0];
  if (figures.state !== "ready" || main === undefined) return <StateNote figures={figures} />;

  // 按正文区像素决定显示多少：先保证主要数字，再依次加次要指标、趋势、最近账目。
  const wide = width >= 560 && height >= 150;
  const columnWidth = wide ? Math.floor(width * 0.55) : width;
  const showRow = height >= 84 && columnWidth >= 230;
  const trendRoom = height - (showRow ? 112 : 64);
  const showTrend = options.showTrend !== false && trendRoom >= 56;
  const recentRoom = wide ? height : height - 64 - (showRow ? 48 : 0) - (showTrend ? Math.min(96, trendRoom) + 12 : 0);
  const showRecent = options.showRecent !== false && recentRoom >= 64;
  const open = (chart: boolean) => {
    if (bookId !== undefined) switcher.enter(bookId, undefined, dashboardDestination(view.month, chart ? metric : undefined, main.currency));
  };
  const figuresBlock = (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0">
        {/* 很矮的卡片（1×1）只放数字：指标名称在读屏名称里。 */}
        {height >= 60 ? <p className="text-helper text-muted">{t(`desktop.dashboard.metricThisMonth.${metric}`)}</p> : null}
        <FitAmount className="lv-dash-figure tabular-nums" text={formatMoney(metricOf(main, metric), main.currency)} />
      </div>
      {showRow ? (
        <dl className="lv-dash-metrics-row">
          {METRICS.filter((item) => item !== metric).map((item) => (
            <div key={item}><dt className="text-helper text-muted">{t(`desktop.entries.${item}`)}</dt><dd className="text-body tabular-nums text-ink">{formatMoney(metricOf(main, item), main.currency)}</dd></div>
          ))}
        </dl>
      ) : null}
      {figures.totals.length > 1 && height >= 84 ? <p className="text-helper text-muted">{t("desktop.entries.otherCurrencies", { count: figures.totals.length - 1 })}</p> : null}
      {figures.missing > 0 && height >= 84 ? <p className="text-helper text-warn-dark">{t("desktop.dashboard.missingFx", { count: figures.missing })}</p> : null}
      {showTrend && data !== undefined ? (
        <button type="button" className="lv-native-trend" disabled={switcher.busy} onClick={() => open(true)} aria-label={t("desktop.dashboard.openTrend")}>
          <DailyBars data={data} currency={main.currency} height={Math.min(96, trendRoom)} />
        </button>
      ) : null}
      {switcher.status === null ? null : <p role="status" className="text-helper text-danger">{switcher.status}</p>}
    </div>
  );
  const recent = showRecent && data?.recent !== undefined ? (
    <div className="flex min-h-0 min-w-0 flex-col">
      <p className="text-helper text-muted">{t("desktop.dashboard.cards.recent")}</p>
      <RecentRows items={sortByTime(data.recent).map((entry) => ({ entry, bookId: bookId! }))} width={wide ? width - columnWidth - 16 : width} height={Math.max(0, recentRoom - 20)} showBook={false} />
    </div>
  ) : null;
  return wide && recent !== null ? (
    <div className="lv-native-split" style={{ gridTemplateColumns: `${String(columnWidth)}px 1fr` }}>{figuresBlock}{recent}</div>
  ) : (
    <div className="flex h-full min-h-0 flex-col gap-3">{figuresBlock}{recent}</div>
  );
}

function DailyBars({ data, currency, height }: { readonly data: BookData; readonly currency: string; readonly height: number }): React.JSX.Element {
  const series = useMemo(
    () => (data.scope.combined ? combinedDaily(data.scope) : null) ?? dailySeries(data.scope.entries, data.scope.range, currency),
    [data.scope, currency],
  );
  return <Bars series={series} height={height} />;
}

function Bars({ series, height }: { readonly series: readonly { readonly value: number }[]; readonly height: number }): React.JSX.Element {
  const max = Math.max(1, ...series.map((item) => item.value));
  const step = 310 / Math.max(1, series.length);
  return (
    <svg viewBox="0 0 310 70" preserveAspectRatio="none" aria-hidden="true" style={{ height, width: "100%", display: "block" }}>
      {series.map((item, index) => (
        <rect key={index} x={index * step + 0.5} y={68 - (item.value / max) * 64} width={Math.max(1.5, step - 2)} height={Math.max(1.5, (item.value / max) * 64)} rx="1.5" className={item.value === 0 ? "fill-line" : "fill-brand"} />
      ))}
    </svg>
  );
}

function Spark({ series, height }: { readonly series: readonly { readonly value: number }[]; readonly height: number }): React.JSX.Element {
  const max = Math.max(1, ...series.map((item) => item.value));
  const step = 300 / Math.max(1, series.length - 1);
  const points = series.map((item, index) => `${(index * step).toFixed(1)},${(66 - (item.value / max) * 60).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 300 70" preserveAspectRatio="none" aria-hidden="true" style={{ height, width: "100%", display: "block" }}>
      <polyline points={points} fill="none" className="stroke-brand" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 多账本收支
// ---------------------------------------------------------------------------

function CrossBody({ card, width, height }: { readonly card: AnalysisCardNode; readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  const view = useView();
  const data = useDashboardBooks();
  const books = resolveBooks(nativeOptions(card).books, view.bookIds);
  const perBook = books.map((bookId) => ({ bookId, figures: bookFigures(data.get(bookId)?.scope, view.mainCode) }));
  const ready = perBook.filter((item) => item.figures.state === "ready");
  const pending = perBook.length - ready.length;
  const totals = mergeTotals(ready.map((item) => item.figures.totals), view.mainCode);
  const missing = ready.reduce((sum, item) => sum + item.figures.missing, 0);
  const main = totals[0];
  if (main === undefined) return <p className="text-helper text-muted">{pending > 0 ? t("desktop.common.loading") : t("desktop.dashboard.noData")}</p>;
  const tiny = height < 84 || width < 200;
  const showTable = height >= 150;
  const byBook = width >= 460 && height >= 200 && books.length > 1;
  const notes = (
    <>
      {height >= 180 ? <p className="lv-dash-note text-helper text-muted">{ready.some((item) => item.figures.combined) ? t("desktop.dashboard.crossNoteCombined") : t("desktop.dashboard.crossNote")}</p> : null}
      {pending > 0 && height >= 120 ? <p className="text-helper text-muted">{t("desktop.dashboard.crossMissing", { count: pending })}</p> : null}
      {missing > 0 && height >= 120 ? <p className="text-helper text-warn-dark">{t("desktop.dashboard.missingFx", { count: missing })}</p> : null}
    </>
  );
  if (tiny) {
    return (
      <div className="min-w-0">
        {height >= 60 ? <p className="text-helper text-muted">{t("desktop.entries.expense")}</p> : null}
        <FitAmount className="lv-dash-figure tabular-nums" text={formatMoney(main.expense, main.currency)} />
      </div>
    );
  }
  if (!showTable) {
    return (
      <dl className="lv-dash-metrics-row">
        {METRICS.map((item) => (
          <div key={item}><dt className="text-helper text-muted">{t(`desktop.entries.${item}`)}</dt><dd className="text-body tabular-nums text-ink">{formatMoney(metricOf(main, item), main.currency)}</dd></div>
        ))}
      </dl>
    );
  }
  if (byBook) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <table className="lv-dash-table">
          <thead>
            <tr>
              <th scope="col">{t("desktop.dashboard.book")}</th>
              {METRICS.map((item) => <th key={item} scope="col">{t(`desktop.entries.${item}`)}</th>)}
            </tr>
          </thead>
          <tbody>
            {ready.map(({ bookId, figures }) => {
              const row = figures.totals.find((item) => item.currency === main.currency);
              return (
                <tr key={bookId}>
                  <th scope="row" className="max-w-[10rem] truncate">{view.books.get(bookId)?.name ?? "—"}</th>
                  {METRICS.map((item) => <td key={item}>{row === undefined ? "—" : formatMoney(metricOf(row, item), main.currency)}</td>)}
                </tr>
              );
            })}
            <tr className="lv-dash-total">
              <th scope="row">{t("desktop.dashboard.total")}</th>
              {METRICS.map((item) => <td key={item}>{formatMoney(metricOf(main, item), main.currency)}</td>)}
            </tr>
          </tbody>
        </table>
        {totals.length > 1 ? <p className="text-helper text-muted">{t("desktop.entries.otherCurrencies", { count: totals.length - 1 })}</p> : null}
        {notes}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <table className="lv-dash-table">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">{t("desktop.dashboard.currency")}</span></th>
            {METRICS.map((item) => <th key={item} scope="col">{t(`desktop.entries.${item}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {totals.map((row) => (
            <tr key={row.currency}>
              <th scope="row">{row.currency}</th>
              {METRICS.map((item) => <td key={item}>{formatMoney(metricOf(row, item), row.currency)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {notes}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 支出趋势
// ---------------------------------------------------------------------------

function TrendBody({ card, width, height }: { readonly card: AnalysisCardNode; readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  const view = useView();
  const books = useDashboardBooks();
  const bookId = nativeOptions(card).bookId ?? view.currentBookId ?? undefined;
  const data = bookId === undefined ? undefined : books.get(bookId);
  const figures = bookId !== undefined && view.books.has(bookId) ? bookFigures(data?.scope, view.mainCode) : { state: "denied" as const, totals: [], missing: 0, combined: false };
  const main = figures.totals[0];
  const currency = main?.currency ?? view.mainCode;
  const series = useMemo(
    () => (data === undefined ? [] : (data.scope.combined ? combinedDaily(data.scope) : null) ?? dailySeries(data.scope.entries, data.scope.range, currency)),
    [data, currency],
  );
  if (figures.state !== "ready" || data === undefined) return <StateNote figures={figures} />;
  const total = main?.expense ?? 0;
  const days = Math.max(1, series.length);
  const caption = (
    <p className="flex flex-wrap items-baseline gap-x-3 text-helper text-muted">
      <span>{t("desktop.dashboard.trendTotal", { amount: formatMoney(total, currency) })}</span>
      {width >= 360 ? <span>{t("desktop.dashboard.dailyAverage", { amount: formatMoney(Math.round(total / days), currency) })}</span> : null}
    </p>
  );
  if (height < 80) {
    return (
      <div className="flex h-full min-h-0 items-center gap-3">
        <span className="shrink-0 text-body tabular-nums text-ink">{formatMoney(total, currency)}</span>
        <div className="min-w-0 flex-1"><Spark series={series} height={Math.max(24, height - 8)} /></div>
      </div>
    );
  }
  const axis = height >= 150 && width >= 300;
  const chartHeight = Math.max(40, height - 28 - (axis ? 20 : 0));
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      {caption}
      <Bars series={series} height={chartHeight} />
      {axis && series.length > 0 ? (
        <p className="flex justify-between text-helper tabular-nums text-muted">
          <span>{formatDayLabel(series[0]!.date)}</span>
          {series.length > 2 && width >= 480 ? <span>{formatDayLabel(series[Math.floor(series.length / 2)]!.date)}</span> : null}
          <span>{formatDayLabel(series.at(-1)!.date)}</span>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 最近账目
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 44;

export function RecentRows({ items, width, height, showBook }: {
  readonly items: readonly { readonly entry: Transaction; readonly bookId: string }[];
  readonly width: number;
  readonly height: number;
  readonly showBook: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const view = useView();
  const switcher = useEnterLedger();
  const rows = Math.max(1, Math.floor(height / ROW_HEIGHT));
  const withDate = width >= 300;
  const withBook = showBook && width >= 440;
  if (items.length === 0) return <p className="text-helper text-muted">{t("desktop.dashboard.recentEmpty")}</p>;
  return (
    <ul className="lv-native-rows">
      {items.slice(0, rows).map(({ entry, bookId }) => {
        const name = displayCategoryName(entry.categoryIsSystem ? UNCATEGORISED_NAME : entry.categoryName);
        return (
          <li key={`${bookId}:${entry.id}`}>
            <button
              type="button"
              className="lv-dash-row lv-native-row"
              disabled={switcher.busy}
              onClick={() => switcher.enter(bookId, undefined, `${dashboardDestination(entry.occurredLocalDate.slice(0, 7))}&entry=${encodeURIComponent(entry.id)}`)}
            >
              {withDate ? <span className="shrink-0 text-helper tabular-nums text-muted">{formatDayLabel(entry.occurredLocalDate)}</span> : null}
              <span className="min-w-0 flex-1 truncate text-body text-ink">
                {name}
                {entry.note ? <span className="text-muted"> · {entry.note}</span> : null}
              </span>
              {withBook ? <span className="max-w-[8rem] shrink-0 truncate text-helper text-muted">{view.books.get(bookId)?.name ?? ""}</span> : null}
              <span className={`shrink-0 text-body tabular-nums ${entry.kind === "income" ? "text-brand-dark" : "text-ink"}`}>
                {entry.kind === "expense" ? "−" : "+"}
                {formatMoney(entry.amountCents, entry.currency)}
              </span>
            </button>
          </li>
        );
      })}
      {switcher.status === null ? null : <li role="status" className="text-helper text-danger">{switcher.status}</li>}
    </ul>
  );
}

function RecentBody({ card, width, height }: { readonly card: AnalysisCardNode; readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  const view = useView();
  const data = useDashboardBooks();
  const books = resolveBooks(nativeOptions(card).books, view.bookIds);
  const loading = books.some((bookId) => data.get(bookId)?.recent === undefined && data.get(bookId)?.recentFailed !== true);
  const items = useMemo(() => {
    const all: { readonly entry: Transaction; readonly bookId: string }[] = [];
    for (const bookId of books) for (const entry of data.get(bookId)?.recent ?? []) all.push({ entry, bookId });
    const order = new Map(sortByTime(all.map((item) => item.entry)).map((entry, index) => [entry.id, index]));
    return [...all].sort((a, b) => (order.get(a.entry.id) ?? 0) - (order.get(b.entry.id) ?? 0));
  }, [books, data]);
  if (items.length === 0 && loading) return <p className="text-helper text-muted">{t("desktop.common.loading")}</p>;
  return <RecentRows items={items} width={width} height={height} showBook={books.length > 1} />;
}

// ---------------------------------------------------------------------------
// 待处理与快捷操作
// ---------------------------------------------------------------------------

export function PendingBody({ width, height }: { readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const { offline } = useAccountOffline();
  const pending = useSyncExternalStore(subscribePending, pendingEntriesValue, pendingEntriesValue);
  const conflicts = useSyncExternalStore(subscribeConflicts, conflictsValue, conflictsValue);
  const [syncing, setSyncing] = useState(false);
  const pendingCount = guest ? 0 : pending.size;
  const count = conflicts.length + (pendingCount > 0 ? 1 : 0);
  if (count === 0) return <p className="text-helper text-muted">{t("desktop.dashboard.pendingNone")}</p>;
  if (height < 70 || width < 200) {
    return (
      <p className="flex items-baseline gap-2">
        <span className="text-card-title tabular-nums text-ink">{conflicts.length + pendingCount}</span>
        <span className="text-helper text-muted">{t("desktop.dashboard.pendingShort")}</span>
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {conflicts.length > 0 ? (
        <li className="lv-dash-pending" data-tone="warn">
          <span className="min-w-0 flex-1 text-body text-ink">{t("desktop.dashboard.pendingConflicts", { count: conflicts.length })}</span>
          <Link to="/" className="lv-desk-link">{t("desktop.dashboard.review")}</Link>
        </li>
      ) : null}
      {pendingCount > 0 ? (
        <li className="lv-dash-pending">
          <span className="min-w-0 flex-1 text-body text-ink">{offline ? t("desktop.dashboard.pendingOffline", { count: pendingCount }) : t("desktop.dashboard.pendingSync", { count: pendingCount })}</span>
          {offline ? null : (
            <button type="button" className="lv-desk-link" disabled={syncing} onClick={() => { setSyncing(true); void syncNow().finally(() => setSyncing(false)); }}>
              {t("desktop.dashboard.syncNow")}
            </button>
          )}
        </li>
      ) : null}
    </ul>
  );
}

function QuickBody({ width, height }: { readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const navigate = useNavigate();
  // 五种记账方式：每个至少约 88px 宽才放得下名称，放不下就只留图标（完整名称在读屏名称与悬停提示里）。
  const iconOnly = width / 5 < 88 && height < 120;
  return (
    <div className="lv-native-quick" role="menu" aria-label={t("desktop.dashboard.cards.quick")} data-icon-only={iconOnly ? "true" : undefined}>
      <EntryMethodList disabledFor={(action) => desktopEntryDisabled(action, guest)} onNavigate={(path, prepare) => { prepare?.(); void navigate(path); }} />
    </div>
  );
}
