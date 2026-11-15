/**
 * **总览（Dashboard）**：整个 Libevra 的个人化首页——各账本的概况、跨账本收支、最近账目、待处理与快捷操作，
 * 不必进入某个账本就能知道最近发生了什么。它不是某个账本的分析页，也不代替左侧导航。
 *
 * 1.19.100：总览改用分析工作台的同一套编辑引擎（与手机分析页一样在格子上自定义）：
 *
 * - 卡片库里有「总览卡片」（账本、多账本收支、支出趋势、最近账目、待处理、快捷操作），也有分析页的全部分析卡片
 *   与自定义（组合）卡片；分析卡片可以指定数据来自哪一本账。
 * - 拖动换位、调宽高（每种卡片有自己可选的尺寸）、横向滑动抽屉 / 分割卡片组 / 留白、按列数的专属排列、
 *   向上紧凑、撤销 / 重做、恢复默认，与分析页相同。卡片按实际大小决定显示多少内容。
 * - 按「完成」才保存到本机（`dashboardStore.ts`）；窗口变化只改变排布。旧版总览配置第一次打开时自动转换。
 *
 * 数据全部来自现有查询：每本账的数据作用域与最近账目（`dashboardScopes.tsx`），当前账本走本机优先的读取，
 * 其它账本在线读取，权限由服务器按账本检查。跨账本金额原币按币种分别相加，不折算、不去重，并在卡片上说明。
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { useAuth } from "../auth/AuthProvider.js";
import { NotificationBell } from "../components/Notifications.js";
import { useI18n } from "../i18n/index.js";
import { formatLocalDate, toLocalDate } from "../lib/datetime.js";
import { useDefaultCurrency } from "../lib/defaultCurrency.js";
import { useGuestIdentity } from "../lib/guest/session.js";
import { useBooks, useCurrentBookId } from "../lib/queries.js";
import { AccountWorkbench, type WorkbenchFrameParts } from "../pages/StatsPage.js";
import { CardRenderContext, type CardRenderHooks } from "../statsWorkbench/cardRender.js";
import { resolveRange, type WorkbenchFilters } from "../statsWorkbench/filters.js";
import {
  cardDisplay,
  cardSourceBook,
  nativeAnalysisId,
  nativeKindOfId,
  nativeSizing,
  newNativeCard,
  setNativeBookNames,
  type NativeKind,
} from "../statsWorkbench/nativeCards.js";
import { useWorkbenchScope, WorkbenchScopeProvider } from "../statsWorkbench/scope.js";
import type { WorkbenchSurface } from "../statsWorkbench/surface.js";
import { useCardContextMenu } from "./DashboardCardMenu.js";
import { DashboardCardSettings } from "./DashboardCardSettings.js";
import { DashboardStatsControl, DashboardTimeControl, MaskToggle } from "./DashboardControls.js";
import { dashboardDestination } from "./dashboardNavigation.js";
import { DashboardSidebar, SidebarCustomizer } from "./DashboardSidebar.js";
import { DashboardPageTabs, DashboardPresetSheet } from "./DashboardPages.js";
import { DashboardViewContext, NativeTile, type DashboardBook, type DashboardView } from "./DashboardNativeCards.js";
import { DashboardAvailableContext, DashboardScopeContext, DashboardScopeProbes, DashboardScopeStore, useDashboardCardScope } from "./dashboardScopes.js";
import {
  DASHBOARD_INSTALLED,
  defaultDashboardDocuments,
  findDashboardCard,
  followDefaultDashboard,
  isDefaultDashboard,
  readDashboard,
  readDashboardSettings,
  readMask,
  saveDashboard,
  scopeBooks,
  timeChoiceFor,
  writeDashboardSettings,
  writeMask,
  expandPerBook,
  listPages,
  readActivePage,
  templateObjectId,
  writeActivePage,
  type DashboardSettings,
  type PageSummary,
  type SidebarConfig,
} from "./dashboardStore.js";
import type { WorkbenchDocuments } from "../statsWorkbench/storage.js";
import { DesktopToolbar } from "./DesktopToolbar.js";
import { useEnterLedger } from "./DesktopNav.js";

function readSession(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function writeSession(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* 仅影响下次恢复位置。 */ }
}

/** 卡片库「总览卡片」分组里的顺序；多账本收支只在有两本以上账本时提供。 */
const LIBRARY: readonly NativeKind[] = ["ledger", "cross", "trend", "recent", "pending", "quick"];

export function DesktopDashboardPage(): React.JSX.Element {
  const { t } = useI18n();
  const { user } = useAuth();
  const guestIdentity = useGuestIdentity();
  const owner = user !== null ? `user:${user.id}` : guestIdentity !== null ? `guest:${guestIdentity.id}` : null;
  const books = useBooks();
  const currentBookId = useCurrentBookId();
  const mainCode = useDefaultCurrency();
  // 总览口径（时间、范围、统计方式）记在本机，改了立即生效，不需要进编辑（1.19.100）。
  const [settings, setSettingsState] = useState<DashboardSettings>(() => readDashboardSettings(owner));
  useEffect(() => setSettingsState(readDashboardSettings(owner)), [owner]);
  const setSettings = (next: DashboardSettings): void => {
    setSettingsState(next);
    if (owner !== null) writeDashboardSettings(owner, next);
  };
  const [masked, setMaskedState] = useState(() => readMask(owner));
  useEffect(() => setMaskedState(readMask(owner)), [owner]);
  const setMasked = (value: boolean): void => {
    setMaskedState(value);
    if (owner !== null) writeMask(owner, value);
  };
  // 1.19.102：多页总览。页面列表在保存的记录里；这台设备停在哪一页另记。
  const [pages, setPages] = useState<readonly PageSummary[]>(() => listPages(owner));
  const [pageId, setPageIdState] = useState<string | undefined>(() => readActivePage(owner));
  useEffect(() => {
    setPages(listPages(owner));
    setPageIdState(readActivePage(owner));
    const installed = (event: Event) => { if ((event as CustomEvent<string>).detail === owner) setPages(listPages(owner)); };
    window.addEventListener(DASHBOARD_INSTALLED, installed);
    return () => window.removeEventListener(DASHBOARD_INSTALLED, installed);
  }, [owner]);
  const activePage = pages.find((page) => page.id === pageId) ?? pages[0] ?? { id: "main", name: "" };
  const selectPage = (id: string): void => {
    setPageIdState(id);
    if (owner !== null) writeActivePage(owner, id);
  };
  const today = useMemo(() => toLocalDate(new Date()), []);
  const time = useMemo(() => timeChoiceFor(settings.time, today), [settings.time, today]);
  const range = useMemo(() => resolveRange(time, today), [time, today]);
  /** 进入明细 / 分析时带的月份：时间范围的最后一个月。 */
  const month = range.to.slice(0, 7);

  /**
   * 游客多账本：总览只放**当前**游客账本。每本账的卡片靠读取器在那本账的上下文里读数（正式账号是
   * “外部账本”的在线读取），游客的数据层只有当前账本一份快照——放进别的游客账本，卡片上会显示当前账本的
   * 数字配别的账本的名字。换账本仍从侧栏 / 账本选择进入（整页重新载入）。
   */
  const guestMode = guestIdentity !== null;
  const bookList: readonly DashboardBook[] = useMemo(
    () =>
      (books.data?.books ?? [])
        .filter((book) => !guestMode || book.id === currentBookId)
        .map((book) => ({ id: book.id, name: book.name, memberCount: book.memberCount })),
    [books.data, guestMode, currentBookId],
  );
  const allBookIds = useMemo(() => bookList.map((book) => book.id), [bookList]);
  /** 总览范围（「统计设置」里选的账本）：全部账本类卡片按它统计，新账本是否自动出现也看它。 */
  const bookIds = useMemo(() => scopeBooks(settings, allBookIds), [settings, allBookIds]);
  const bookSignature = bookIds.join(",");
  // 卡片标题（账本卡片 = 账本名称）在编辑格、菜单里也要用，先于渲染登记。
  useMemo(() => setNativeBookNames(new Map(bookList.map((book) => [book.id, book.name]))), [bookList]);

  const filters = useMemo<WorkbenchFilters>(() => ({ time, currency: null, combined: settings.combined }), [time, settings.combined]);
  const store = useMemo(() => new DashboardScopeStore(), []);
  // 卡片可以指定范围以外的账本（例如账本卡片）：读取器按全部账本挂，卡片按自己的设置取用。
  const available = useMemo(() => new Set(allBookIds), [allBookIds]);

  const perBook = activePage.kind === "per-book";
  const surface = useMemo<WorkbenchSurface>(() => ({
    id: "dashboard",
    readStored: (accountScope) => readDashboard(accountScope, bookIds, allBookIds, activePage.id),
    save: async (accountScope, documents, version) => saveDashboard(accountScope, documents, version, bookIds, activePage.id),
    ...(perBook ? { browseDocuments: (documents: WorkbenchDocuments) => expandPerBook(documents, bookIds) } : {}),
    renderPresets: ({ current, apply, onClose }) => <DashboardPresetSheet owner={owner} bookIds={bookIds} current={current} apply={apply} onClose={onClose} />,
    defaults: () => defaultDashboardDocuments(bookIds),
    isSystemDefault: (documents) => isDefaultDashboard(documents, bookIds),
    followSystemDefault: followDefaultDashboard,
    installedEvent: DASHBOARD_INSTALLED,
    columnsKey: "dashboard",
    createCard: (analysisId, objectId) => {
      const kind = nativeKindOfId(analysisId);
      if (kind === null) return null;
      const bookId = currentBookId ?? bookIds[0];
      return newNativeCard(kind, objectId, kind === "ledger" && bookId !== undefined ? { bookId } : {});
    },
    defaultSize: (analysisId) => {
      const kind = nativeKindOfId(analysisId);
      return kind === null ? null : nativeSizing(kind).defaultSize;
    },
    nativeItems: LIBRARY.filter((kind) => kind !== "cross" || bookIds.length > 1).map((kind) => ({
      analysisId: nativeAnalysisId(kind),
      title: t(`desktop.dashboard.cards.${kind}`),
      description: t(`desktop.dashboard.library.${kind}`),
      defaultSize: nativeSizing(kind).defaultSize,
    })),
    presets: false,
    sync: null,
    texts: {
      saved: t("desktop.dashboard.saved"),
      reset: t("desktop.dashboard.resetLayout"),
      resetHint: t("desktop.dashboard.resetLayoutHint"),
      resetDone: t("desktop.dashboard.resetDone"),
    },
  }), [bookIds, allBookIds, currentBookId, t, activePage.id, perBook, owner]);

  // 账本变化（新账本、退出 / 归档）或换页：让工作台按新的账本 / 页面重新读取（派生，不写回）。
  useEffect(() => {
    if (owner !== null) window.dispatchEvent(new CustomEvent(DASHBOARD_INSTALLED, { detail: owner }));
  }, [owner, bookSignature, activePage.id, perBook]);

  const view = useMemo<DashboardView>(() => ({
    books: new Map(bookList.map((book) => [book.id, book])),
    bookIds,
    currentBookId,
    mainCode,
    month,
  }), [bookList, bookIds, currentBookId, mainCode, month]);

  /** 总览上的分析卡片点开去哪：分析页右侧辅助栏（默认），或那个月的明细。 */
  const analysisDestination = (card: AnalysisCardNode): string =>
    cardDisplay(card).open === "entries"
      ? dashboardDestination(month)
      : `/stats?${new URLSearchParams({ month, ...(settings.combined ? {} : { analysis: "currency" }), dashboardCard: card.objectId }).toString()}`;

  const hooks = useMemo<CardRenderHooks>(() => ({
    renderNative: (props) => <NativeTile {...props} />,
    useScopeFor: useDashboardCardScope,
    // 只有当前账本的卡片能直接在新标签页打开（别的账本要先激活）。
    hrefFor: (card) => {
      const source = cardSourceBook(card);
      return source === null || source === currentBookId ? analysisDestination(card) : null;
    },
    // 数据固定来自某本账的分析卡片，标题下写出账本名称（多本账时才写）。
    sourceLabel: (card) => {
      const source = cardSourceBook(card);
      return source === null || allBookIds.length <= 1 ? null : view.books.get(source)?.name ?? null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [currentBookId, month, settings.combined, allBookIds, view]);

  const switcher = useEnterLedger();
  const navigate = useNavigate();
  const openAnalysisCard = (cardId: string): void => {
    if (owner === null) return;
    // 「每本账一组」页展开后的卡片 id 是「模板 id@账本」：打开模板那张卡片，数据来自那本账。
    const templateId = templateObjectId(cardId);
    const card = findDashboardCard(owner, templateId);
    if (card === undefined) return;
    const destination = analysisDestination(card);
    const source = cardId === templateId ? cardSourceBook(card) : cardId.slice(templateId.length + 1);
    if (source !== null && source !== currentBookId) switcher.enter(source, undefined, destination);
    else void navigate(destination);
  };

  if (books.isPending) {
    return <div className="p-6"><p className="text-body text-muted">{t("desktop.common.loading")}</p></div>;
  }

  return (
    <DashboardScopeContext.Provider value={store}>
      <DashboardAvailableContext.Provider value={available}>
      <DashboardViewContext.Provider value={view}>
        <CardRenderContext.Provider value={hooks}>
          <DashboardScopeProbes books={allBookIds} filters={filters} store={store} />
          <CurrentScope filters={filters}>
            <AccountWorkbench
              key={owner ?? "pending"}
              analysis={null}
              surface={surface}
              onOpenCard={openAnalysisCard}
              renderConfigure={(args) => (
                <DashboardCardSettings
                  card={args.card}
                  books={bookList}
                  currentBookId={currentBookId}
                  onSave={args.onSave}
                  onEditContent={args.onEditContent}
                  onClose={args.onClose}
                />
              )}
              renderFrame={(parts) => (
                <DashboardFrame
                  parts={parts}
                  meta={t("statsWorkbench.summary.dates", { from: formatLocalDate(range.from), to: formatLocalDate(range.to) })}
                  books={bookList}
                  sidebar={settings.sidebar}
                  onSidebar={(sidebar) => setSettings({ ...settings, sidebar })}
                  masked={masked}
                  failed={books.isError}
                  onRetry={() => void books.refetch()}
                  switchStatus={switcher.status}
                  perBook={perBook}
                  controls={
                    <>
                      <DashboardPageTabs
                        owner={owner}
                        pages={pages}
                        active={activePage.id}
                        bookIds={bookIds}
                        currentDocuments={() => readDashboard(owner, bookIds, allBookIds, activePage.id).documents}
                        disabled={parts.editing}
                        onSelect={selectPage}
                      />
                      <DashboardTimeControl value={settings.time} bookIds={allBookIds} disabled={parts.editing} onChange={(value) => setSettings({ ...settings, time: value })} />
                      <DashboardStatsControl settings={settings} books={bookList} mainCode={mainCode} disabled={parts.editing} onChange={setSettings} />
                      <MaskToggle masked={masked} onChange={setMasked} />
                    </>
                  }
                />
              )}
            />
          </CurrentScope>
        </CardRenderContext.Provider>
      </DashboardViewContext.Provider>
      </DashboardAvailableContext.Provider>
    </DashboardScopeContext.Provider>
  );
}

/** 当前账本的数据作用域（工作台本身、没有指定来源账本的分析卡片用它）。 */
function CurrentScope({ filters, children }: { readonly filters: WorkbenchFilters; readonly children: React.ReactNode }): React.JSX.Element {
  const scope = useWorkbenchScope(filters);
  return <WorkbenchScopeProvider value={scope}>{children}</WorkbenchScopeProvider>;
}

function DashboardFrame({
  parts,
  meta,
  books,
  sidebar,
  onSidebar,
  masked,
  failed,
  onRetry,
  switchStatus,
  controls,
  perBook,
}: {
  /** 「每本账一组」页：编辑的是一组卡片的模板。 */
  readonly perBook: boolean;
  readonly parts: WorkbenchFrameParts;
  readonly meta: string;
  readonly books: readonly DashboardBook[];
  readonly sidebar: SidebarConfig;
  readonly onSidebar: (sidebar: SidebarConfig) => void;
  readonly masked: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly switchStatus: string | null;
  readonly controls: React.ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  // 「每本账一组」页浏览时是展开后的卡片（id 带 @账本），右键菜单作用在模板里对应的那张。
  const menu = useCardContextMenu({ act: (id, action) => parts.act(templateObjectId(id), action), isRootObject: (id) => parts.isRootObject(templateObjectId(id)) });
  const [customizing, setCustomizing] = useState(false);
  useEffect(() => {
    const scroll = parts.scrollRef.current;
    if (scroll === null) return;
    const top = Number(readSession("libevra.dashboard.scroll") ?? 0);
    if (Number.isFinite(top)) scroll.scrollTop = top;
  }, [parts.scrollRef]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {parts.editing ? parts.editBar : (
        <DesktopToolbar
          title={t("desktop.dashboard.title")}
          meta={meta}
          actions={
            <>
              <NotificationBell showHeading={false} panelClassName="lv-account-notice-panel" />
              <button type="button" className="lv-desk-btn" onClick={parts.enterEdit}>{t("desktop.dashboard.edit")}</button>
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-2">{controls}</div>
        </DesktopToolbar>
      )}
      <div className="lv-dash-workspace">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-workbench-frame="">
          <div
            ref={parts.scrollRef}
            onScroll={(event) => { if (!parts.editing) writeSession("libevra.dashboard.scroll", String(event.currentTarget.scrollTop)); }}
            className="lv-desk-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            <div
              className={`lv-dash-host ${parts.editing ? "pb-28" : "pb-10"}`}
              data-mask={masked && !parts.editing ? "" : undefined}
              {...(parts.editing ? {} : { onContextMenu: menu.onContextMenu, onKeyDown: menu.onKeyDown })}
            >
              {failed ? <div role="alert" className="flex items-center gap-4 px-6 pt-4"><p className="text-body text-danger">{t("desktop.dashboard.readFailed")}</p><button type="button" className="lv-desk-btn" onClick={onRetry}>{t("common.action.retry")}</button></div> : null}
              {switchStatus === null ? null : <p role="status" className="px-6 pt-3 text-helper text-danger">{switchStatus}</p>}
              {parts.editing && perBook ? <p className="px-6 pt-3 text-helper-relaxed text-brand-dark">{t("desktop.dashboard.pages.perBookEditing")}</p> : null}
              {parts.editHint}
              {parts.grid}
            </div>
          </div>
          {parts.drawer === undefined || parts.drawer === null ? null : <div className="pointer-events-none absolute inset-x-4 bottom-4 z-30 [&>*]:pointer-events-auto">{parts.drawer}</div>}
        </div>
        {/* 编辑时侧栏仍占位（暂停交互），网格宽度与浏览时相同：编辑时看到的格子就是浏览时的格子。 */}
        <aside className="lv-dash-sidebar" aria-label={t("desktop.dashboard.aside")} inert={parts.editing} data-paused={parts.editing ? "true" : undefined} data-mask={masked ? "" : undefined}>
          <DashboardSidebar config={sidebar} books={books} onChange={onSidebar} onCustomize={() => setCustomizing(true)} />
        </aside>
      </div>
      {parts.overlays}
      {menu.menu}
      {customizing ? <SidebarCustomizer config={sidebar} onChange={onSidebar} onClose={() => setCustomizing(false)} /> : null}
    </div>
  );
}

export type { AnalysisCardNode };
