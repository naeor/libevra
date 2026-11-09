import { useAnalysisRange } from "../lib/analysisRange.js";
import { SlidingSelection } from "../components/ui/SlidingSelection.js";
import "../components/ledger/detail-overview.css";
import { DetailOverview } from "../components/ledger/DetailOverview.js";
import { useDetailCards, detailDayCount } from "../lib/detailCards.js";
import { entryMatches } from "../desktop/entriesView.js";
import { EntrySortControls, useEntryPresentation } from "../components/EntrySortControls.js";
import { ChevronIcon } from "../components/Icons.js";
import { AttachmentPanel } from "../components/Attachments.js";
import { CURRENCIES, endOfMonth, type CurrencySummary, type Transaction, type TransactionKind } from "@libellum/shared";
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { runFrameClock, type FrameClock } from "../lib/frameClock.js";
import { CONTROL_MORPH } from "../lib/motionTokens.js";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { entryReturnState } from "../lib/entryReturn.js";

import { useAuth } from "../auth/AuthProvider.js";
import { FxAmount } from "../components/FxDisplay.js";
import { useFxMode, useFxRange } from "../lib/fxView.js";
import { AvatarRewardBanner } from "../components/AvatarRewardBanner.js";
import { CurrentBookCaption } from "../components/CurrentBookCaption.js";
import { BottomNav } from "../components/BottomNav.js";
import { useEntryMenu } from "../components/Layouts.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { GuestModeBadge } from "../components/GuestModeBadge.js";
import { EntryFilterPanel, useDetailFilters } from "../components/EntryFilterPanel.js";
import { FunnelIcon } from "../statsWorkbench/ui.js";
import { usePageFilter } from "../lib/usePageFilter.js";
import { summaryFor } from "../lib/offline/localStats.js";
import { EmptyState, ErrorState, SkeletonRows } from "../components/States.js";
import { OfflineStatus } from "../components/OfflineStatus.js";
import { ConflictScreen } from "../components/ConflictScreen.js";
import { SyncBanner } from "../components/SyncBanner.js";
import { BatchActionBar } from "../components/ledger/BatchActionBar.js";
import { BatchEditSheet } from "../components/ledger/BatchEditSheet.js";
import { BatchRoleProbe } from "../components/ledger/BatchRoleProbe.js";
import { DetailTools } from "../components/ledger/DetailTools.js";
import { LedgerEntryRow } from "../components/ledger/LedgerEntryRow.js";
import { SelectionBar } from "../components/ledger/SelectionBar.js";
import { useLedgerBatch } from "../components/ledger/useLedgerBatch.js";
import {
  EMPTY_BATCH_DRAFT,
  allLoadedSelected,
  batchDeleteConfirmation,
  batchPermission,
  buildBatchEdit,
  entryTapAction,
  selectAllLoaded,
  selectedLoadedIds,
  summarizeBatch,
  toggleSelection,
  type BatchEditDraft,
  type BatchItemResult,
  type BatchRoleState,
  type BatchSummary,
} from "../components/ledger/batch.js";
import { refreshMessage } from "../components/ledger/refreshFeedback.js";
import { isChineseLocale, useI18n } from "../i18n/index.js";

import { errorMessage } from "../lib/api.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { currentMonth, formatDayLabel, formatInstant, formatMonthLabel, isAllMonths, toLocalDate } from "../lib/datetime.js";
import { readSession, useDetailTransition, writeSession } from "../lib/detailTransition.js";
import { currencyName, formatMoney } from "../lib/format.js";
import { displayCategoryName } from "../lib/presetNames.js";
import {
  filterLocally,
  lastLocalRead,
  ledgerSnapshotValue,
  deletedEntriesValue,
  pendingEntriesValue,
  readLocalTransactions,
  readMarks,
  readStoredMonths,
  subscribeLedger,
  type ConflictRecord,
  conflictsValue,
  subscribeConflicts,
  subscribeDeleted,
  subscribePending,
} from "../lib/offline/localLedger.js";
import { logOffline } from "../lib/offline/diagnostics.js";
import { markPresentationSeen } from "../lib/spaceTransition.js";
import { limitToWholeDays, mergeLedgerEntries } from "../lib/ledgerView.js";
import { syncMonth } from "../lib/offline/sync.js";
import { pendingCount, retryAbandonedWrites, syncNow } from "../lib/offline/syncController.js";
import { deleteEntry, resolveConflict, updateEntry } from "../lib/offline/write.js";
import { useSharedLedgerOfflineReadOnly } from "../lib/offline/writePolicy.js";
import {
  hasLocalTransactions,
  useLedger,
  useSummary,
  useTransactions,
  type TransactionFilters,
} from "../lib/queries.js";
import { handOverForScan } from "../lib/scanHandoff.js";
import { keepMetricSnapshot } from "../components/ledger/metricSnapshot.js";
import { useViewBookId } from "../lib/workspaceLedger.js";
import { useGuestIdentity, useGuestMode } from "../lib/guest/session.js";
import { useFollowedPath, usePane } from "../workspace/context.js";
import { useFocusTask } from "../components/PersistentNavContext.js";
import { useForeignBookId } from "../lib/workspaceLedger.js";

/** S18：工作区查看外部账本时，设备的本机副本与待同步标记都属于另一本账，一律当作空。 */
const NO_LOCAL_ENTRIES: readonly Transaction[] = [];
const NO_MARKS: ReadonlySet<string> = new Set<string>();
const NO_CONFLICTS: readonly ConflictRecord[] = [];

/** 展示态呈现固定槽位的收支摘要；滚动进入明细态后隐藏卡片。
 * 搜索与收起同步进行，输入焦点不等待动画，工作区各自保留查询与滚动位置。
 */
export function DetailPage(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const metricBook = useViewBookId();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const fxMode = useFxMode();
  const guest = useGuestMode();
  const guestIdentity = useGuestIdentity();
  /**
   * ⚠️ **S14-C: the presentation flag is keyed by identity, not by account.** A guest has no
   * `user.id`; without this it would share the signed-out key with every other guest on the
   * browser, and the wave's first-run state would be wrong in both directions.
   */
  const presentationOwnerId = guestIdentity?.id ?? user?.id;
  /**
   * ⚠️ **S18：明细在哪个工作区里。** 月份、收支切换与滚动位置按工作区实例各存一份（主区与辅助区可以同时
   * 打开明细而互不覆盖）；大屏工作区里主导航与记账入口在全局侧栏，这一页不再画底部导航。
   */
  const pane = usePane();
  const wide = pane.shell === "wide";
  /** 跟随模式下辅助区正在显示的那一笔：在列表里标出来。 */
  const followedPath = useFollowedPath();

  // Read once, on the first render. The session outlives a tab switch but not
  // a reload, which is exactly what the owner asked for: leaving the ledger and
  // coming back finds it as it was, quitting the app starts fresh.
  const saved = useRef(readSession(pane.instance)).current;

  /**
   * 1.19.53：月份与其它筛选条件保存在本机（按账号与账本），刷新、切 Tab、记一笔回来都保留；
   * 默认与分析页共用同一份（`lib/ledgerFilter.ts`）。地址栏带来的条件读入后从地址栏移除。
   */
  const pageFilter = usePageFilter("ledger");
  const month = pageFilter.value.month;
  /** 月份选择里选了「全部」（1.17.17）：整本账，不按月份截取。 */
  const allMonths = isAllMonths(month);
  const [kind, setKind] = useState<TransactionKind | "all">(() => saved.kind ?? "all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showAllCurrencies, setShowAllCurrencies] = useState(false);

  const cardConfig = useDetailCards(presentationOwnerId ?? "local");
  const [searchOpen, setSearchOpen] = useState(saved.searchOpen ?? false);
  const [query, setQuery] = useState(saved.search ?? "");
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchSpace = useRef<HTMLSpanElement>(null);
  const searchShell = useRef<HTMLDivElement>(null);
  const searchCancel = useRef<HTMLButtonElement>(null);
  const headerTitle = useRef<HTMLDivElement>(null);
  const headerActions = useRef<HTMLDivElement>(null);
  const monthRow = useRef<HTMLDivElement>(null);
  /** 屏幕上的搜索形态（可能先于 React 状态）：open / closed。 */
  const searchVisual = useRef<boolean>(saved.searchOpen ?? false);
  const searchMorph = useRef<{ clock: FrameClock; animations: Animation[] } | null>(null);
  const searchOrigin = useRef(saved.searchOrigin ?? saved.scrollTop);
  const monthAnchor = useRef<HTMLButtonElement>(null);
  const { rootRef, scrollRef, atList, goTo, lockSearch } = useDetailTransition(saved.progress, pane.instance, saved.searchOpen);
  useLayoutEffect(() => {
    const root = rootRef.current, slot = searchSpace.current;
    if (!root || !slot || searchOpen) return;
    const row = slot.closest<HTMLElement>(".detail-header-row")!;
    const measure = () => {
      let left = 0, node: HTMLElement | null = slot;
      while (node && node !== row) { left += node.offsetLeft; node = node.offsetParent as HTMLElement | null; }
      row.style.setProperty("--search-left", `${left}px`);
      row.style.setProperty("--search-right", `calc(100% - ${left + slot.offsetWidth}px)`);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(row); observer.observe(slot.parentElement!);
    return () => observer.disconnect();
  }, [searchOpen, guest, wide]);
  useLayoutEffect(() => {
    const root = rootRef.current, overview = root?.querySelector<HTMLElement>(".detail-overview");
    if (!root || !overview) return;
    const main = overview.querySelector<HTMLElement>(".detail-overview-main")!, small = overview.querySelector<HTMLElement>(".detail-overview-small")!;
    const measure = () => {
      // S19 测试风格可以用 CSS 变量收紧收起前的版式（apps/web/src/s19/compact.css）：
      // 两张卡的保底高度与标题、月份、间距的合计高度。没有设置时取原值，Original 完全不变。
      const style = getComputedStyle(root);
      const px = (name: string, fallback: number) => { const value = parseFloat(style.getPropertyValue(name)); return Number.isFinite(value) ? value : fallback; };
      const mainHeight = Math.max(px("--card-floor", 128), main.offsetHeight);
      const smallHeight = Math.max(px("--secondary-floor", 74), ...Array.from(small.children).map(e => e.scrollHeight));
      root.style.setProperty("--card-tall", `${mainHeight}px`);
      root.style.setProperty("--secondary-tall", `${smallHeight}px`);
      root.style.setProperty("--hero-tall", `${px("--hero-chrome", 160) + mainHeight + smallHeight}px`);
    };
    const observer = new ResizeObserver(measure); observer.observe(main); Array.from(small.children).forEach(e => observer.observe(e)); measure();
    return () => observer.disconnect();
  }, []);

  /**
   * The entry menu is shared with every other screen.
   *
   * The ledger used to own this state, which was the wrong shape: the cards are
   * the app's way of starting a record, and they are wanted on every screen. The
   * one thing the ledger does differently is fold them when the reader scrolls
   * down into the list — the summary has just collapsed to give the entries
   * room, and leaving a menu open would spend exactly what was won.
   */
  /**
   * **搜索是本页控件的形态变化，不是一次页面切换（S19 1.19.43）。**
   *
   * 以前点击时先 `flushSync` 整页重渲染再聚焦：iPhone 上这段同步渲染加上键盘弹出，正好占掉了胶囊展开与
   * 顶部收起的前半段，第一次尤其明显——看起来是先停一下、顶部先换了布局、搜索框再出现在新位置。
   *
   * 现在点击当下只改这几个元素的 DOM 状态并同步聚焦（iOS 只在同一次手势里弹出键盘）：胶囊从按钮的
   * 实际位置向左右展开、标题与工具让位、顶部按同一时钟收起；React 状态在形变结束后再同步（结果相同，
   * 不再产生视觉变化）。关闭按相反顺序收回到按钮位置，再清空查询。
   */
  const presentSearch = (open: boolean): void => {
    const root = rootRef.current, input = searchInput.current, cancel = searchCancel.current, button = searchButton.current;
    if (root) root.dataset.searching = String(open);
    if (searchShell.current) searchShell.current.dataset.open = String(open);
    for (const node of [headerTitle.current, headerActions.current, monthRow.current]) {
      if (!node) continue;
      node.inert = open;
      if (open) node.setAttribute("aria-hidden", "true"); else node.removeAttribute("aria-hidden");
    }
    if (input) { input.readOnly = !open; input.tabIndex = open ? 0 : -1; input.setAttribute("aria-hidden", String(!open)); }
    if (cancel) { cancel.tabIndex = open ? 0 : -1; cancel.setAttribute("aria-hidden", String(!open)); }
    if (button) { button.tabIndex = open ? -1 : 0; button.setAttribute("aria-expanded", String(open)); }
  };
  const morphSearch = (open: boolean, done: () => void): void => {
    const shell = searchShell.current, input = searchInput.current, cancel = searchCancel.current;
    // 先读屏幕上的当前姿态（可能正停在上一次开合的中途），再取消上一次的动画；否则暂停在中途的
    // fill 动画会盖住新的目标值，快速重复开合后胶囊停在半路。
    const current = shell ? getComputedStyle(shell) : null;
    const from = { left: current?.left ?? "", right: current?.right ?? "" };
    const fade = [input, cancel].map(node => { if (!node) return 0; const style = getComputedStyle(node); return style.visibility === "hidden" ? 0 : Number(style.opacity); });
    const previous = searchMorph.current; searchMorph.current = null;
    previous?.clock.cancel(); for (const animation of previous?.animations ?? []) animation.cancel();
    if (!shell || typeof shell.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { presentSearch(open); done(); return; }
    presentSearch(open);
    const after = getComputedStyle(shell);
    const to = { left: after.left, right: after.right };
    const timing: KeyframeAnimationOptions = { duration: CONTROL_MORPH.duration, fill: "both" };
    const animations = [shell.animate([{ ...from, easing: CONTROL_MORPH.easing }, to], timing)];
    // 输入框与取消随胶囊变宽淡入；收回时先淡出再随胶囊回到按钮（保持可见直到淡出结束）。
    [input, cancel].forEach((node, i) => {
      if (!node) return;
      const start = fade[i]!;
      animations.push(node.animate(open
        ? [{ opacity: start, visibility: "visible", offset: 0 }, { opacity: start, visibility: "visible", offset: .3 }, { opacity: 1, visibility: "visible", offset: 1 }]
        : [{ opacity: start, visibility: "visible", offset: 0 }, { opacity: 0, visibility: "visible", offset: .3 }, { opacity: 0, visibility: "hidden", offset: 1 }], timing));
    });
    const clock = runFrameClock(animations, CONTROL_MORPH.duration, { name: open ? "searchOpen" : "searchClose", onDone: () => {
      if (searchMorph.current?.clock === clock) searchMorph.current = null;
      for (const animation of animations) animation.cancel();
      done();
    } });
    searchMorph.current = { clock, animations };
  };
  const openSearch = () => {
    if (searchVisual.current) { searchInput.current?.focus({ preventScroll: true }); return; }
    searchVisual.current = true;
    searchOrigin.current = scrollRef.current?.scrollTop ?? 0;
    morphSearch(true, () => { if (searchVisual.current) startTransition(() => setSearchOpen(true)); });
    // 同一手势里聚焦，键盘照常弹出；输入框此时已可编辑、可见。
    searchInput.current?.focus({ preventScroll: true });
    lockSearch(true);
  };
  /**
   * 1.19.52：只有键盘关闭（Esc、用键盘按下“取消”）时才把焦点交回搜索键；用手指点“取消”时只收起键盘。
   * 从输入框（总是 focus-visible）把焦点程序化地交给按钮，浏览器会让按钮也显示焦点描边，看起来像搜索键一直被选中。
   */
  const closeSearch = (returnFocus = false) => {
    if (!searchVisual.current && !searchOpen) return;
    searchVisual.current = false;
    searchInput.current?.blur();
    lockSearch(false, searchOrigin.current);
    morphSearch(false, () => { if (!searchVisual.current) startTransition(() => { setSearchOpen(false); setQuery(""); }); });
    if (returnFocus) searchButton.current?.focus({ preventScroll: true });
  };
  useEffect(() => { writeSession({ search: query, searchOpen, searchOrigin: searchOrigin.current }, pane.instance); }, [query, searchOpen, pane.instance]);
  const menu = useEntryMenu();
  const entryOpen = menu.open;

  useEffect(() => {
    if (atList) menu.close();
    // `menu.close` is stable for a given open state, and depending on `menu`
    // would re-run this on every toggle — closing the menu the moment it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atList]);

  useEffect(() => {
    writeSession({ month, kind }, pane.instance);
  }, [month, kind, pane.instance]);

  // Put the reader back where they were, but only if they were reading the
  // list — somebody returning to the display state should see it from the top.
  useEffect(() => {
    const element = scrollRef.current;
    if (element !== null && saved.progress >= 1 && saved.scrollTop > 0) {
      element.scrollTop = saved.scrollTop;
    }
  }, [saved.progress, saved.scrollTop, scrollRef]);

  /**
   * ⚠️ **The merged signal**, not `navigator.onLine`: offline when either the browser says
   * so or a request failed to get an answer. The error panel below keys off this, so it
   * disappears on the strength of a real failed request rather than the browser's guess.
   */
  const { offline } = useAccountOffline();

  const summary = useSummary(month);
  /**
   * ⚠️ 「全部」不做综合折算：折算读取有跨度上限（按月拆分、最多 36 个月），整本账会超出；
   * 这时顶部按原币分别累计，并有一行说明（`allFxOriginal`）。逐笔金额旁的折算仍照常显示。
   */
  const fxActive = fxMode.enabled && !allMonths;
  const fxMonth = allMonths ? currentMonth() : month;

  const ledger = useLedger();
  const filter = useDetailFilters(pageFilter.value, pageFilter.set, ledger.data);
  const fxSummary = useFxRange(`${fxMonth}-01`, endOfMonth(`${fxMonth}-01`), fxActive, { filter: row => filter.predicate(row) && entryMatches(row, query) && (kind === "all" || row.kind === kind), filterKey: `${filter.key}|${kind}|${query}` });

  /**
   * ⚠️ **Named once, so the query and the loading gate cannot drift apart.**
   *
   * The skeleton check below has to ask about the *same* filters the query uses — if they ever
   * disagreed, a screen with data would show placeholder rows, which is the bug this whole change
   * is about.
   */
  const filters = { month: allMonths ? undefined : month, kind: kind === "all" ? undefined : kind };
  const list = useTransactions(filters);

  /**
   * ⚠️ **A loading state that has lasted too long says so.**
   *
   * The owner watched the tablet flicker placeholder rows for over thirty seconds: "他加载了至少有30秒，
   * 期间我很确定我一直在盯着他." **An indefinite skeleton is a screen that never tells the user
   * anything** — it is indistinguishable from a slow network, a dead database and a bug, and the
   * person waiting cannot act on any of them.
   *
   * Three seconds is long enough that a working load never shows it, and short enough that nobody
   * sits through it twice. What appears is honest and actionable: the device holds nothing for this
   * month, and the server could not be reached.
   */
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  const listPending = list.isPending;

  /**
   * ⚠️ **The timer is armed on mount, not on a query state change.**
   *
   * The first version depended on `list.isPending` and cleared itself whenever that was false. The
   * owner reported **no message appearing at all** after more than a minute of flickering
   * placeholders: "还是一直闪，什么字都没有……已经过去了差不多一分钟."
   *
   * A timer that never fires is one that was never started, or one that was cleared by a state
   * change before it could run. **So this one depends on nothing at all** — it is armed once and
   * left alone. Whatever the query is doing, after three seconds the screen explains itself; if the
   * data arrives first the message is simply not rendered, because there is nothing to explain.
   *
   * **A watchdog that can be cancelled by the thing it is watching is not a watchdog.**
   */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWaitedTooLong(true);
    }, 3_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);


  /**
   * The main card is the account's own currency, always — even in a month with
   * nothing in it.
   *
   * The owner was explicit: a card that quietly showed a different currency
   * whenever the usual one had no entries would be worse than an empty one.
   * People learn where to look, and moving it is what confuses them.
   */
  const mainCode = user?.defaultCurrency ?? "CNY";

  /**
   * ⚠️ **A copy of this month that does not depend on the query layer at all.**
   *
   * The owner's tablet settled a long argument with one measurement: the diagnostics showed
   * `local-read — 磁盘 … → 138 条`, the banner correctly reported 138 entries, **and the screen still
   * flickered placeholders.** The data was found and `isPending` stayed true — so the fault is in the
   * query's state, not in the reading, and no amount of fixing the read was ever going to help.
   *
   * **So the screen stops asking the query whether it has anything.** It reads the device itself, on
   * mount and whenever the view changes, and shows what it finds. The query still runs underneath and
   * still supplies fresher data when it can — `list.data` wins whenever it exists — but a screen with
   * the user's ledger on it can no longer be held hostage by a query state that never settles.
   *
   * ⚠️ **This is what the owner asked for, twice**: "加载超过一秒后，立刻去本地读取数据并运算，显示".
   * It took three rounds to see that the "立刻" part had to bypass the query, because the query is
   * precisely the component that was failing.
   */
  /**
   * ⚠️ **S18 账本隔离**：这个工作区查看的是另一本账（不是设备当前账本）时，本机副本、待同步标记与冲突
   * 都属于设备当前账本，不能混进这本账的列表；列表与汇总只来自那本账的在线读取。
   */
  const foreign = useForeignBookId();
  const deviceEntries = useLocalEntries(filters);
  const localEntries = foreign === null ? deviceEntries : NO_LOCAL_ENTRIES;

  /**
   * ⚠️ **The pending set comes from the same store mechanism as the ledger**, for the reason this
   * project spent four hours learning: a value that travels through a React state update can be dropped
   * on the device that needs it most.
   */
  const devicePending = useSyncExternalStore(subscribePending, pendingEntriesValue, pendingEntriesValue);
  const pending = foreign === null ? devicePending : NO_MARKS;

  /**
   * ⚠️ **What was deleted on this device, and therefore must not appear — whatever the query still holds.**
   *
   * The stored copy of a deleted entry is kept on purpose (round 3 asks the user whether the delete should
   * stand), so the deletion has to be expressed somewhere the merge can see. **Adding nothing cannot remove
   * anything** — which is why the entry the owner deleted stayed on screen: the merge combined the device's
   * list with the query's, and the query still had it.
   */
  const deviceDeleted = useSyncExternalStore(subscribeDeleted, deletedEntriesValue, deletedEntriesValue);
  const deleted = foreign === null ? deviceDeleted : NO_MARKS;

  /**
   * ⚠️ **Conflicts are a state of their own, and the green mark could not say so.**
   *
   * The owner's own test showed what that costs: he edited one entry on the tablet and the phone, and the tablet's
   * row **"是绿色的；点击刷新也没用"** — a green row says "waiting to be sent", which is also what a row says when
   * it is retrying a request the server keeps refusing. **There was nothing on screen to tell him a decision was
   * waiting, so there was nothing to tap.**
   */
  const deviceConflicts = useSyncExternalStore(subscribeConflicts, conflictsValue, conflictsValue);
  const conflicts = foreign === null ? deviceConflicts : NO_CONFLICTS;

  /** Entry ids waiting for a decision, so a row can say so instead of looking merely unsent. */
  const conflicted = useMemo(
    () => new Set(conflicts.map((conflict) => conflict.mine.id)),
    [conflicts],
  );

  /** The conflict being settled right now, if the user tapped a row. */
  const [settling, setSettling] = useState<ConflictRecord | null>(null);

  /**
   * ⚠️ **The refresh button: read the device again, and deliver what is waiting.**
   *
   * The owner asked for both halves in one sentence: "点击刷新按钮时，它会重新渲染这个网页。并且与此同时触发一次
   * 联网同步判定."
   *
   * ⚠️ **He is right that they belong together, and the reason is that they are the same question.** "Show me
   * what is really there" and "make what I did really reach the server" are two halves of *is my ledger in
   * step* — and a user who has to press one button after another is being made to guess which half is wrong.
   *
   * ⚠️ **`readLocalTransactions` is what re-renders**, because the ledger on screen is read from the store this
   * publishes to. Reloading the page would also "re-render" and would lose the scroll position and the month
   * the user was looking at — **so the honest reading of "重新渲染这个网页" is "show me the current state
   * again", not "reload".**
   */
  const [refreshing, setRefreshing] = useState(false);

  /**
   * ⚠️ **What the refresh actually managed to do, said once and briefly.**
   *
   * The owner asked for a sentence, not just a spinner: a turning icon says "something is running"
   * but not whether the **server** was reached — and that is the thing the button is for. It is also
   * the one place where a wrong sentence is worse than none, so the wording lives in
   * `refreshMessage`: a zero is never reported as "the cloud was updated".
   */
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  useEffect(() => {
    if (refreshNote === null) return;

    /** ⚠️ The sentence leaves on its own; it is a report, not a permanent banner. */
    const timer = window.setTimeout(() => {
      setRefreshNote(null);
    }, 8_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [refreshNote]);

  const refresh = useCallback(async () => {
    if (refreshing) return;

    setRefreshing(true);
    setRefreshNote(null);

    /** S18：外部账本没有本机队列可投递，也没有本机副本可重读——只重新向服务器读取这本账。 */
    if (foreign !== null) {
      try {
        await Promise.all([list.refetch(), summary.refetch()]);
      } finally {
        setRefreshing(false);
      }
      return;
    }

    /**
     * ⚠️ **The offline signal is read at the press, not afterwards.** The merged signal changes
     * *because* a request failed, so reading it after the attempt would describe the state the
     * attempt produced rather than the one it started from.
     */
    const offlineAtPress = offline;
    let delivered = 0;
    let pulled = 0;
    let failure: string | null = null;
    /**
     * ⚠️ **Counted after the attempt, so the sentence can mention what was left behind.**
     *
     * `syncNow` reports only how many changes went, and **a delivery can fail without throwing** — a
     * refused request is counted rather than raised. So "delivered 0" used to reach the note as "没有待
     * 投递的改动" while the list was still showing marked rows. This is the number that makes the two
     * statements agree; it comes from the same queue the colours come from (`pendingIds`), so it cannot
     * disagree with them.
     */
    let waiting = 0;

    try {
      /**
       * ⚠️ **A press of this button is a person asking us to try again**, so the session's "give up"
       * verdicts are dropped before anything is delivered (`syncController` has promised that since it
       * was written; nothing implemented it until now). **Memory only** — the marks, the queue and the
       * data are untouched, and every entry is judged again from scratch: a 4xx is still a 4xx, it is
       * simply re-judged. The automatic triggers do **not** call this.
       */
      await retryAbandonedWrites();

      /** ⚠️ Delivery first, so the pull below sees everything this device had to send. */
      delivered = await syncNow();

      /**
       * ⚠️ **And then the server's current values are taken, which is what was missing.**
       *
       * The owner's report: "我在 pad 上在线修改数据，点刷新，它居然没法同步数据，还需要我直接动浏览器的刷新才可以."
       *
       * **The button delivered and re-read the device, but never fetched the server** — so a value changed elsewhere,
       * or changed here and confirmed there, never came back. **Only reloading the page fetched the server's list**,
       * which is exactly why a browser reload appeared to fix it.
       *
       * ⚠️ **His own description of what this moment should be**: "理论上在点击它的一瞬间，它里面的数据应该跟服务器的
       * 同步（大部分情况下服务器覆盖，小部分情况有冲突）."
       */
      if (allMonths) {
        /**
         * 「全部」（1.17.17）：不把整本账下载进本机（下载范围由「我的 → 下载管理」决定），
         * 只让列表和汇总重新问一次服务器。
         */
        const [answer] = await Promise.all([list.refetch(), summary.refetch()]);
        pulled = (answer.data?.pages ?? []).reduce((count, page) => count + page.items.length, 0);
      } else {
        pulled = await syncMonth(month);
      }
    } catch (caught) {
      /**
       * ⚠️ **A failure is reported, not swallowed.** The previous version let it escape as an
       * unhandled rejection, so the only visible sign was a spinner that stopped — indistinguishable
       * from success.
       */
      failure = errorMessage(caught);
    } finally {
      /**
       * ⚠️ **Both layers are refreshed, not just the store.**
       *
       * The screen merges the device's entries with the query's, so re-reading the device alone would leave the
       * query's stale pages in place — **the same trap as before**: the store is fresh and the list still shows
       * the old data.
       */
      try {
        await readLocalTransactions();
      } catch {
        /** ⚠️ A failed re-read must not hide the outcome of the sync that just ran. */
      }

      try {
        await logOffline(
          "DIAGNOSTIC:manual-refresh",
          delivered > 0 ? `投递 ${String(delivered)} 条` : "没有待投递的改动", // i18n-ignore：诊断日志，不是界面文字
        );
      } catch {
        /** Diagnostics never break the button. */
      }

      /**
       * ⚠️ **What is still waiting, read from the queue rather than assumed from `delivered`.**
       *
       * A failed attempt that did not throw leaves `delivered` at zero, which on its own reads exactly
       * like an empty queue. This is the fact that tells them apart, and it is the one the reader needs:
       * the rows are still marked on screen, so the note has to account for them.
       */
      try {
        waiting = guest ? 0 : await pendingCount();
      } catch {
        /** A queue that cannot be read must not break the refresh; the note then says less, not wrong. */
        waiting = 0;
      }

      setRefreshNote(
        refreshMessage({
          guest,
          offline: offlineAtPress,
          delivered,
          pulled,
          failed: failure !== null,
          error: failure,
          waiting,
          allMonths,
        }),
      );
      setRefreshing(false);
    }
    /**
     * ⚠️ **Not `window.location.reload()`, and that is a decision rather than an omission.** A
     * reload would also "re-render the page"; it would also throw away the month being read, the
     * scroll position, and any import in flight — and it would bypass the conflict and idempotency
     * paths this button is supposed to exercise.
     */
  }, [refreshing, month, allMonths, offline, guest, foreign, list.refetch, summary.refetch]);

  // 明细更多只提交一次入口请求；实际同步继续使用本页原有刷新流程。
  useEffect(() => {
    if (!readSession(pane.instance).syncRequested) return;
    writeSession({ syncRequested: false }, pane.instance);
    void refresh();
  }, [pane.instance, refresh]);

  const entries = useMemo(() => {
    const fromQuery = (list.data?.pages ?? []).flatMap((page) => page.items);

    return mergeLedgerEntries(localEntries, fromQuery, pending, filters, deleted);
  }, [list.data, localEntries, pending, month, kind, deleted]);

  /**
   * ⚠️ **One explicit sort, applied to whatever the sources produced.**
   *
   * See `sortByTime`. The owner asked for a separate sorting function called when the screen opens and on
   * every change: "每次打开明细页面时或者明细页面有任何修改（新增账单，修改账单等等）都会单独调用一个排序
   * 函数，排序函数会根据时间把所有的账单排序."
   *
   * **The reason it matters is that every previous attempt sorted as a side effect of something else** — of
   * where the data came from, of which layer happened to answer, of whether a refetch had landed. **That is
   * why the order kept looking shuffled: it was never a decision, it was a leftover.**
   *
   * It runs whenever the entries change, which covers both halves of what he asked for: opening the screen
   * sorts what the device holds, and any write changes the entries so the sort runs again.
   */
  const filtered = useMemo(() => entries.filter(entry => filter.predicate(entry) && entryMatches(entry, query)), [entries, filter.predicate, query]);
  const cardFrom = filter.value.from || (!allMonths ? month + "-01" : "");
  const cardTo = filter.value.to || (!allMonths ? endOfMonth(month) : "");
  const chartSource = useAnalysisRange({ from: cardFrom || currentMonth() + "-01", to: cardTo || endOfMonth(currentMonth()) }, !guest && !fxActive && !!cardFrom && !!cardTo);
  const chartEntries = (chartSource.data?.entries ?? filtered).filter(e => filter.predicate(e) && entryMatches(e, query) && (kind === "all" || e.kind === kind));
  const presentation = useEntryPresentation(filtered, !list.hasNextPage && !list.isPending && !list.isError, { order: saved.presentation?.order ?? "timeDesc", attachment: "any", type: "", minMB: "", maxMB: "" }, filter.extended || query.trim() !== "" || kind !== "all");
  const currencies = filter.extended || query.trim() !== "" || kind !== "all" ? (presentation.waiting ? [] : summaryFor(filtered, month, { from: "0000-01-01", to: "9999-12-31" }).currencies) : summary.data?.currencies ?? [];
  const main = currencies.find(item => item.currency === mainCode) ?? null;

  useEffect(() => { writeSession({ presentation: presentation.options }, pane.instance); }, [presentation.options, pane.instance]);
  const ordered = presentation.ordered;
  useEffect(() => { if (presentation.extended && list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) void list.fetchNextPage(); }, [presentation.extended, list.hasNextPage, list.isFetchingNextPage, list.isFetchNextPageError, list.fetchNextPage]);

  /**
   * 「全部」（1.17.17）分批渲染：整本账可能有几千笔，一次画完会卡；先画最近的一批，滚到底再加一批，
   * 本机这批画完了再向服务器要下一页（见下方 `loadMore`）。只影响画多少，不影响数据与合计。
   */
  const [renderLimit, setRenderLimit] = useState(ALL_RENDER_STEP);
  const viewKey = `${filter.key}|${query}|${kind}|${JSON.stringify(presentation.options)}`;

  useEffect(() => {
    setRenderLimit(ALL_RENDER_STEP);
  }, [viewKey]);

  const shown = useMemo(() => (allMonths ? (presentation.flat ? ordered.slice(0, renderLimit) : limitToWholeDays(ordered, renderLimit)) : ordered), [allMonths, ordered, renderLimit, presentation.flat]);

  const grouped = useMemo(() => {
    if (presentation.flat) return [["", shown] as [string, Transaction[]]];
    const groups = new Map<string, Transaction[]>();

    for (const entry of shown) {
      const bucket = groups.get(entry.occurredLocalDate) ?? [];
      bucket.push(entry);
      groups.set(entry.occurredLocalDate, bucket);
    }

    /**
     * ⚠️ **The day headings are ordered too, by date descending** — a map preserves insertion order, so
     * without this the sections would follow whatever the entries happened to arrive in. **The heading and
     * its contents have to agree about which end is newest.**
     */
    return [...groups.entries()];
  }, [shown, presentation.flat]);

  const moreToRender = allMonths && shown.length < ordered.length;
  const canLoadMore = moreToRender || list.hasNextPage;
  const loadMore = useCallback(() => {
    if (moreToRender) {
      setRenderLimit((limit) => limit + ALL_RENDER_STEP);
      return;
    }
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, [moreToRender, list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage]);

  /**
   * 「全部」滚到底自动加载：底部哨兵进入视口就继续 `loadMore`，直到画完、服务器也没有下一页。
   * 哨兵仍在视口内时（新的一页恰好全是本机已有的账目，页面没有变长）会继续取下一页，不会停住。
   */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [sentinelVisible, setSentinelVisible] = useState(false);

  useEffect(() => {
    const element = sentinelRef.current;
    if (!allMonths || element === null || typeof IntersectionObserver === "undefined") {
      setSentinelVisible(false);
      return;
    }
    const observer = new IntersectionObserver(
      (records) => {
        setSentinelVisible(records.some((record) => record.isIntersecting));
      },
      { root: scrollRef.current, rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [allMonths, canLoadMore, scrollRef]);

  useEffect(() => {
    if (allMonths && sentinelVisible && canLoadMore && !list.isFetchingNextPage) loadMore();
  }, [allMonths, sentinelVisible, canLoadMore, list.isFetchingNextPage, loadMore, shown.length]);

  /** 离线时的「全部」只是本机已下载的部分：读出下载了几个月，好让提示说清楚。 */
  const [storedMonthCount, setStoredMonthCount] = useState<number | null>(null);

  useEffect(() => {
    if (!allMonths || !offline || guest || foreign !== null) {
      setStoredMonthCount(null);
      return;
    }
    let cancelled = false;
    void readStoredMonths()
      .then((stored) => {
        if (!cancelled) setStoredMonthCount(Object.keys(stored).length);
      })
      .catch(() => {
        if (!cancelled) setStoredMonthCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [allMonths, offline, guest, foreign]);

  /**
   * ⚠️ **Batch mode is a state of this screen, not another screen.**
   *
   * The owner's instruction was "当前列表原地进入多选模式（不跳新页面）", and the reason it has to be
   * in place is the one this whole file is about: the list, the month and the filters are the context
   * the user is choosing from. A route would rebuild them — and a selection made on one screen and
   * acted on in another is how the wrong entries get deleted.
   *
   * Everything below is deliberately local state. Nothing is persisted: leaving the screen, changing
   * the filter or pressing 取消 puts the ledger back exactly as it was.
   */
  const { readOnly: sharedOfflineReadOnly } = useSharedLedgerOfflineReadOnly();
  const batch = useLedgerBatch({
    ordered,
    conflicted,
    ledger: ledger.data,
    guest,
    offline,
    filterKey: `${filter.key}|${kind}`,
    onEnter: () => {
      menu.close();
    },
  });
  const {
    selecting,
    selected,
    setSelected,
    selectionNotice,
    batchEditOpen,
    setBatchEditOpen,
    batchDraft,
    setBatchDraft,
    confirmBatchDelete,
    setConfirmBatchDelete,
    batchBusy,
    batchSummary,
    setRoleState,
    shared,
    permission,
    loadedIds,
    selectedIds,
    selectedKinds,
    everythingLoadedSelected,
    ledgerIndex,
    enterBatch,
    exitBatch,
    applyBatchEdit,
    runBatchDelete,
    deleteConfirmation,
  } = batch;
  /**
   * 1.19.52：批量操作是专注型任务——手机常驻底栏（PaneShell）变灰、向下退出，批量删除 / 编辑栏占用它的位置，
   * 取消批量后底栏升回。此前常驻底栏是 fixed，盖住了页面底部的批量操作栏。
   */
  useFocusTask(selecting);

  const isEmptyMonth = list.isSuccess && entries.length === 0;

  /**
   * ⚠️ **The confirmation is built from the count that is on screen right now**, so the dialog can
   * never describe a different number of entries from the ones the bar reported.
   */

  /**
   * ⚠️ **The choice is shown in place of the list, and that is deliberate.**
   *
   * The user reached it by tapping a specific row, so the question is about *that* entry — **a separate route or a
   * sheet would lose the connection between the row they touched and the decision they are making**, and this is
   * the one screen in the app where losing that connection means choosing the wrong version of the wrong entry.
   */
  if (settling !== null && !guest) {
    return (
      <div className="detail-root flex h-dvh flex-col overflow-hidden">
        <div className="flex items-center px-6 pt-6 pb-2">
          <button
            type="button"
            onClick={() => {
              setSettling(null);
            }}
            className="text-sm text-muted transition hover:text-ink"
          >
            {t("ledger.detail.backToEntries")}
          </button>
        </div>

        <ConflictScreen
          conflict={settling}
          /**
           * ⚠️ **The names, so a conflict about a category reads as a category.**
           *
           * The owner's report: "在冲突页面，分类并不会显示成文字，而是一串代码" — **the entry carries the category
           * name, but a conflict value is a bare id from the server.**
           */
          categories={ledger.data?.categories}
          paymentMethods={ledger.data?.paymentMethods}
          tags={ledger.data?.tags}
          onResolve={async (settled) => {
            await resolveConflict(settling.mine.id, settled, settling.theirs);
            setSettling(null);
          }}
          onLater={() => {
            setSettling(null);
          }}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} data-searching={searchOpen} className={`detail-root detail-redesign flex h-dvh flex-col overflow-hidden ${fxMode.enabled ? "detail-fx-root" : ""}`}>
      {/*
        ⚠️ **The ledger builds its own frame, so it needs its own banners.**

        `OfflineStatus` lives in the shared frames — `TabPage` and `InnerPage` — and this
        screen deliberately uses neither, because it owns its scroll position and its hero
        animation. **That is why the download notice appeared everywhere except here**,
        which is what the owner reported: "它只会在分析和账户页面出现，在明细页面则不会弹出."

        Anything added to a shared frame has to be added here too. This is the only screen
        with a frame of its own; if a second one appears, these banners should move into a
        component both can use rather than being copied a third time.
      */}
      <SyncBanner />
      <OfflineStatus />

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain" style={{ overflowAnchor: "none" }}>
        <div className={`mx-auto flex w-full flex-col ${wide ? "max-w-[60rem] pb-10" : "max-w-md pb-24"}`}>
          <div className="detail-scroll-travel" aria-hidden="true" />
          {/*
            The green area. Its height is the one place a layout size animates,
            and it is contained so the reflow stops here instead of reaching
            the list on every frame.
          */}
          <header
            className="detail-hero relative bg-brand px-6 text-on-brand"
            data-pinned={atList}
          >
            <div className="detail-header-row">
<div ref={headerTitle} className="detail-header-title" inert={searchOpen} aria-hidden={searchOpen}>
              <div className="flex min-w-0 items-center gap-2">
                {/**
                  * ⚠️ **S18：大屏上品牌在全局侧栏左上角，这里不再重复 Libevra**（所有者规格 §16.1），
                  * 换成页面名「明细」；字号与位置不变，所以随滚动收起的动画照旧。
                  */}
                {wide ? (
                  <h1 className="detail-title -ml-1 px-1 text-2xl font-semibold tracking-tight">{t("nav.tabs.entries")}</h1>
                ) : (
                <button
                  type="button"
                  onClick={() => {
                    markPresentationSeen(presentationOwnerId);
                    // 1.19.45：站内导航（与账本切换面板里的入口相同），进入账本空间才能播放它专属的海浪转场；
                    // 原来的整页重新载入没有记录在案的理由，账本空间挂载时照样读取上面写入的“已看过展开态”。
                    void navigate("/start");
                  }}
                  aria-label={t("ledger.detail.goToLedgers")}
                  className="detail-title -ml-1 rounded-field px-1 text-2xl font-semibold tracking-tight transition hover:opacity-80"
                >
                  Libevra
                </button>
                )}
                {/**
                  * ⚠️ **The guest badge leaves on the same clock as the wordmark** (S14-C UI fix,
                  * 1.14.05). It used to stay in the header row while the title faded and the month
                  * rose into that space, so at the end of the collapse it sat on top of the month.
                  *
                  * The wrapper fades with `--p-title` — the existing progress variable, already
                  * written by the transition loop — rather than a new timer or a React state update
                  * per frame. `pointer-events: none` keeps an invisible badge from intercepting a
                  * tap, and `aria-hidden` is set once the screen has settled into the list, where it
                  * is fully transparent. It is never unmounted, so re-expanding fades it back in
                  * instead of popping.
                  */}
                <span className="detail-guest-badge" aria-hidden={atList ? true : undefined}>
                  <GuestModeBadge />
                </span>
              </div>

              {/* 排序 / 批量操作 / 更多；服务器同步入口在明细更多。 */}
              </div><div ref={headerActions} className="detail-header-actions" inert={searchOpen} aria-hidden={searchOpen}><span ref={searchSpace} className="detail-search-space" />
              <DetailTools
                sortControl={<EntrySortControls state={presentation} mode="compact" />}
                guest={guest || foreign !== null}
                selecting={selecting}
                onBatch={enterBatch}
                onMore={() => {
                  writeSession({ syncReturnPath: `/${searchParams.size ? `?${searchParams.toString()}` : ""}` }, pane.instance);
                  void navigate("/ledger/more");
                }}
                onExitSelection={exitBatch}
              />
              </div>
              <div ref={searchShell} className="detail-search-shell" data-open={searchOpen}>
                <button ref={searchButton} type="button" className="detail-search-icon" aria-label={t("ledger.cards.search")} aria-expanded={searchOpen} disabled={selecting} tabIndex={searchOpen ? -1 : 0} onPointerDown={e => e.preventDefault()} onClick={openSearch}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5" strokeLinecap="round"/></svg>
                </button>
                <input ref={searchInput} type="search" value={query} readOnly={!searchOpen} tabIndex={searchOpen ? 0 : -1} aria-hidden={!searchOpen} aria-label={t("ledger.cards.search")} placeholder={t("ledger.cards.placeholder")} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape" && !e.nativeEvent.isComposing) closeSearch(true); }} />
                <button ref={searchCancel} type="button" className="detail-search-cancel" tabIndex={searchOpen ? 0 : -1} aria-hidden={!searchOpen} onClick={e => { closeSearch(e.detail === 0); }}>{t("common.action.cancel")}</button>
              </div>
            </div>

            {/*
              The month. It starts on its own line under the wordmark and rises
              onto the wordmark's line as the list state arrives — the wordmark
              fades over the same stretch, so the month is moving into space
              being vacated rather than crossing anything. Left-aligned in both
              states: centred, it took horizontal room the currency cards need.
            */}
            <div ref={monthRow} className="detail-month-row relative mt-2 h-8" inert={searchOpen} aria-hidden={searchOpen}>
              <div className="detail-month-controls flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    setPickerOpen(true);
                  }}
                  ref={monthAnchor}
                  aria-haspopup="dialog" aria-expanded={pickerOpen} aria-label={filter.label.startsWith(t("ledger.filters.title")) ? filter.label : `${t("ledger.filters.title")} · ${filter.label}`}
                  data-filtered={filter.extended || undefined}
                  className="detail-month lv-filter-trigger inline-flex items-center text-base text-on-brand/95"
                >
                  {/* 1.19.53：与分析页筛选同一个漏斗图标。收起到账目列表时随收起进度长出来（在月份的玻璃底面里），
                      有其它筛选条件时一直显示。 */}
                  <span className="detail-month-funnel" aria-hidden="true"><FunnelIcon width={16} height={16} /></span><span className="min-w-0 truncate">{filter.label}</span>
                  <ChevronIcon up={pickerOpen} className="size-4 text-on-brand/75" />
                </button>
              </div>
            </div>

            {/* 常驻、随 --search-k（搜索开合的帧锚定时钟）淡入淡出：形变期间就能出现，不等 React 状态同步后才蹦出来。 */}
            <p className="detail-search-scope text-helper text-on-brand/75" aria-hidden={!searchOpen}>{t("ledger.cards.scope", { scope: filter.label })}</p>
            <DetailOverview onOpen={data => {
              const key = keepMetricSnapshot({ ...data, owner: user?.id ?? guestIdentity?.id ?? "", book: metricBook, pane: pane.instance, returnTo: location.pathname + location.search });
              void navigate(`/ledger/metrics/${data.metric}`, { state: { metricSnapshot: key } });
            }} syncStatus={cardConfig.conflict ? "syncConflict" : cardConfig.syncError ? "syncError" : cardConfig.dirty ? "syncPending" : undefined} onEdit={() => void navigate("/ledger/cards")} entries={chartEntries} chartFrom={cardFrom} chartTo={cardTo} chartComplete={guest ? !list.hasNextPage : chartSource.data?.sourceComplete === true} config={cardConfig.value} summary={main} currency={mainCode} label={filter.label} days={detailDayCount(month, filter.value.from, filter.value.to, toLocalDate(new Date()))} fx={fxActive ? fxSummary : null} onCurrencies={() => setShowAllCurrencies(true)} hidden={atList || searchOpen} loading={summary.isPending || summary.isError || presentation.waiting || !!presentation.error} />
          </header>

          {/*
            The expense/income control. It keeps its size and its place — it is
            the seam between the two halves, and a control that moved while the
            things above it collapsed would make the whole change look loose.
          */}
          <div className={`detail-toggle-bar px-6 pt-4 ${atList ? "detail-toggle-sticky" : ""}`}>
            <SlidingSelection className="flex gap-1 rounded-full bg-line/70 p-1">
              {(["all", "expense", "income"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={kind === option}
                  onClick={() => {
                    setKind(option);
                  }}
                  className={`flex-1 rounded-full py-2 text-sm font-medium transition ${
                    kind === option
                      ? "bg-surface text-brand-dark shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {option === "all" ? t("desktop.entries.kindAll") : t(`common.kind.${option}`)}
                </button>
              ))}
            </SlidingSelection>

            {/* 从更多返回后，在列表上方显示同步进度和结果。 */}
            {refreshing ? <p role="status" className="mt-2 text-helper text-muted">{t("books.more.syncing")}</p> : null}
            {refreshNote === null ? null : (
              <p role="status" className="mt-2 text-helper-relaxed text-muted">
                {refreshNote}
              </p>
            )}

            <EntrySortControls state={presentation} mode="status" />
            {filter.extended && (list.isError || list.isFetchNextPageError) ? <p role="alert" className="text-helper text-danger">{t("ledger.filters.failed")} <button type="button" className="text-brand" onClick={() => { if (list.isFetchNextPageError) void list.fetchNextPage(); else void list.refetch(); }}>{t("ledger.filters.retry")}</button></p> : null}
            {selecting && selectedIds.length > 0 ? <AttachmentPanel bookId={ledger.data?.book.id ?? null} entryIds={selectedIds} readOnly={!!permission.reason} /> : null}
            {selecting ? (
              <SelectionBar
                selectedCount={selectedIds.length}
                loadedCount={loadedIds.length}
                allSelected={everythingLoadedSelected}
                notice={selectionNotice}
                onToggleAll={() => {
                  setSelected((current) => selectAllLoaded(loadedIds, current));
                }}
              />
            ) : null}
          </div>

          <div className="detail-body flex flex-col px-6">
            {/*
              The heading belongs to the display state. It collapses rather than
              staying and pushing the list down, so nothing below it moves.
            */}

            {/*
                ⚠️ **Placeholder rows only when there is genuinely nothing to draw.**

                `isPending` alone means "the query has not answered yet" — which on a tablet whose
                database read is slow is a state the user can sit in while the ledger is already on
                the device. The owner reported exactly that: the same screen instant on a phone,
                stuck on a spinner on a tablet.

                `hasLocalTransactions` answers the question the skeleton is really asking — "is
                there anything to show?" — from a synchronous snapshot, so a device that holds
                entries shows them and one that holds nothing still gets the honest skeleton.
              */}
              {/*
                ⚠️ **The skeleton is drawn only while the device genuinely has nothing to show.**

                `hasLocalTransactions` answers the question the skeleton is really asking — "is there
                anything to show?" — from a synchronous snapshot, so a device holding entries shows
                them and one holding nothing still gets the honest placeholder.

                ⚠️ **And after three seconds the explanation replaces it rather than sitting under it.**
                The owner watched the two coexist: "还是一直闪，什么字都没有." Flashing rows above a
                sentence is a screen contradicting itself — one part saying "coming soon" while the
                other says "this is not coming". When the wait is over, the wait indicator goes.
              */}
              {entries.length === 0 && list.isPending && !(foreign === null && hasLocalTransactions(filters)) && !waitedTooLong ? (
                <SkeletonRows />
              ) : null}

              {/*
                ⚠️ **What was tried, not just that something failed.**

                The owner asked for this: "如果此时没有读到数据或者出现了任何问题，就显示尝试读取数据但
                失败（也可以分得详细些）". A message naming the numbers lets the reader tell a month that
                was never downloaded from a database that is not answering — different problems with
                different fixes, and identical on screen otherwise.
              */}
              {entries.length === 0 && list.isPending && waitedTooLong ? <StuckOnLoad /> : null}

            {/*
              ⚠️ **"加载失败" is suppressed when there is nothing the user can do.**
              
              The owner's report: "在断网的情况下，它会显示加载失败，请求超时，让我检查网络
              后重试。但是在重试下面又会有之前下载好的明细." A hard failure panel above a
              perfectly good list is worse than no panel at all — it tells the user
              something is broken while showing them the thing that is not.
              
              Two conditions, and both are needed:
              
                * **offline** — a request that fails while online is real news, and
                  the retry button is the useful thing to offer;
                * **there are entries to show** — when there are none, an error is the
                  only honest thing on the screen.
              
              The red offline banner above already says what is happening, and says it
              once, which is the point: one message that is read beats two that
              contradict each other.
            */}
            {allMonths && fxMode.enabled ? (
              <p className="pt-2 text-xs text-muted">{t("ledger.detail.allFxOriginal")}</p>
            ) : null}

            {allMonths && storedMonthCount !== null ? (
              <p className="pt-2 text-xs text-muted">
                {t("ledger.detail.allOfflinePartial", { count: storedMonthCount })}
              </p>
            ) : null}

            {list.isError && !(offline && entries.length > 0) ? (
              <ErrorState
                message={errorMessage(list.error)}
                onRetry={() => {
                  void list.refetch();
                }}
              />
            ) : null}

            {!presentation.waiting && !list.isError && (filter.extended || query.trim() !== "") && ordered.length === 0 ? <p className="py-10 text-center text-body text-muted">{t("ledger.filters.noResults")}</p> : null}
            {!filter.extended && isEmptyMonth ? (
              <EmptyState
                title={
                  kind === "all" ? t(allMonths ? "ledger.detail.emptyAll" : "ledger.detail.emptyMonth") : kind === "expense"
                    ? t(allMonths ? "ledger.detail.emptyExpenseAll" : "ledger.detail.emptyExpense")
                    : t(allMonths ? "ledger.detail.emptyIncomeAll" : "ledger.detail.emptyIncome")
                }
                actionLabel={t("ledger.detail.emptyAction")}
                onAction={() => void navigate("/add")}
              />
            ) : null}

            {grouped.map(([day, dayEntries], index) => (
              <section key={day}>
                {!presentation.flat && allMonths && (index === 0 || grouped[index - 1]![0].slice(0, 7) !== day.slice(0, 7)) ? (
                  <h3 className="pt-4 pb-1 text-sm font-medium text-ink">{headerMonthLabel(day.slice(0, 7))}</h3>
                ) : null}
                {!presentation.flat ? <h2 className="py-2 text-xs text-muted">{formatDayLabel(day)}</h2> : null}
                <ul className="overflow-hidden rounded-card bg-surface">
                  {dayEntries.map((entry) => (
                    <LedgerEntryRow
                      key={entry.id}
                      entry={entry}
                      flat={presentation.flat}
                      space={presentation.options.order.startsWith("storage")}
                      fx={fxMode.enabled ? <FxAmount entry={entry} /> : undefined}
                      selecting={selecting}
                      selected={selected.has(entry.id)}
                      pending={pending.has(entry.id)}
                      conflicted={conflicted.has(entry.id)}
                      deleted={deleted.has(entry.id)}
                      current={followedPath === `/transactions/${entry.id}`}
                      dragPath={`/transactions/${entry.id}`}
                      onActivate={() => {
                        /**
                         * ⚠️ **One decision, in one pure function** (`entryTapAction`), so batch mode
                         * cannot half-apply: in selection a tap toggles and never navigates, even on a
                         * conflicted row; outside it, a conflicted row still opens the choice before
                         * the editor — otherwise the user would make a *third* version of an entry
                         * that already has two, and "which of these do you want" would never be asked.
                         */
                        const action = entryTapAction({
                          selecting,
                          conflicted: conflicted.has(entry.id),
                        });

                        if (action === "toggle-selection") {
                          setSelected((current) => toggleSelection(current, entry.id));

                          return;
                        }

                        if (action === "settle-conflict") {
                          const waiting = conflicts.find((conflict) => conflict.mine.id === entry.id);

                          if (waiting !== undefined) {
                            setSettling(waiting);

                            return;
                          }
                        }

                        void navigate(`/transactions/${entry.id}`, { state: entryReturnState(location) });
                      }}
                    />
                  ))}
                </ul>
              </section>
            ))}

            {canLoadMore ? (
              <button
                type="button"
                disabled={list.isFetchingNextPage}
                onClick={loadMore}
                className="my-4 w-full rounded-field bg-surface py-3 text-sm text-muted transition hover:text-ink disabled:opacity-45"
              >
                {list.isFetchingNextPage ? t("common.status.loading") : t("ledger.detail.loadEarlier")}
              </button>
            ) : null}
            {allMonths ? <div ref={sentinelRef} aria-hidden="true" className="h-px" /> : null}
          </div>
        </div>
      </div>

      {/*
        Which ledger this is.
        
        The owner asked for this on every screen once several ledgers exist, and
        it earns its place even before then: the number is what two people say
        out loud to confirm they are looking at the same one. A ledger somebody
        has been invited into can be called anything, so the name alone is not
        enough.
        
        ⚠️ **Moved here at his request, and the placement is the point.** It was
        first tried above the expense/income control, floating on a pill over the
        seam — he called it ugly, and he was right: it cut the control off from
        the list it belongs to and looked like a stray label. 
        
        It now sits **above the bar and outside it**: to the left, in line with
        the 明细 and 分析 tabs directly beneath it, so it reads as a caption for
        the whole screen rather than a badge on one control.
        
        Two constraints that decided the exact placement:
        
          * **Outside the bar, not inside it.** Inside, it would be a sixth thing
            competing with five tabs for a phone's width, and it would move
            whenever the tab row did.
          * **Still part of the column, not the scrolling region.** Being a flex
            sibling of the scroll area means it cannot be scrolled away — "which
            ledger am I adding to" is a question you ask mid-list, so the answer
            has to be there mid-list. It also cannot affect the transition: the
            green area's height is the only thing that animates.
        
        Hidden while the entry cards are open, because those cards are 100px
        of buttons immediately above this line and a caption underneath a menu is
        just noise.
      */}
      {/*
        ⚠️ **In batch mode the bar at the bottom belongs to the action, not to navigation.**

        The owner's constraint was that the batch bar must not collide with `BottomNav`, its raised
        记账 button or the safe area. One bar at a time is the only arrangement that satisfies all
        three without duplicating the navigation's height here — so during selection the navigation,
        its caption and the space the cards reserve are all replaced by the action bar, and 取消 puts
        them back. **Nothing is unmounted that holds state**, so the ledger is exactly as it was.
      */}
      {selecting ? (
        <BatchActionBar
          selectedCount={selectedIds.length}
          blockedReason={permission.reason}
          busy={batchBusy}
          summary={batchSummary}
          onEdit={() => {
            setBatchDraft(EMPTY_BATCH_DRAFT);
            setBatchEditOpen(true);
          }}
          onDelete={() => {
            setConfirmBatchDelete(true);
          }}
        />
      ) : pane.nav !== "bottom" ? (
        <CurrentBookCaption name={ledger.data?.book.name} />
      ) : (
        <>
          <div className={`shrink-0 ${entryOpen ? "invisible" : ""}`} inert={entryOpen} aria-hidden={entryOpen}>
            <CurrentBookCaption name={ledger.data?.book.name} />
          </div>

          <LedgerNav
            open={entryOpen}
            onToggle={menu.toggle}
            onNavigate={(to) => void navigate(to)}
            onPickImages={(chosen) => {
              /**
               * Straight from the tap to recognition.
               *
               * The card has just opened the picker and has the pictures; this hands
               * them over in memory and goes to the screen that recognises them. The
               * user's two presses — 拍照, then choosing a picture — are the whole
               * interaction, where before there was a screen in between whose only
               * job was to ask for the picture again.
               */
              handOverForScan(chosen);
              void navigate("/scan");
            }}
          />
        </>
      )}

      {/*
        ⚠️ **Mounted only while batch mode is on, and only in a shared ledger.** A personal ledger
        has one member — its owner — so asking the server for this account's role there would be a
        request on every visit for an answer that cannot vary.
      */}
      {selecting && shared ? <BatchRoleProbe onProbe={setRoleState} /> : null}

      <BatchEditSheet
        open={batchEditOpen}
        count={selectedIds.length}
        kinds={selectedKinds}
        categories={ledgerIndex.categories}
        paymentMethods={ledgerIndex.paymentMethods}
        tags={ledgerIndex.tags}
        draft={batchDraft}
        blockedReason={permission.reason}
        busy={batchBusy}
        onDraftChange={setBatchDraft}
        onApply={() => {
          void applyBatchEdit(batchDraft);
        }}
        onClose={() => {
          setBatchEditOpen(false);
        }}
      />

      <ConfirmDialog
        open={confirmBatchDelete}
        busy={batchBusy}
        title={deleteConfirmation.title}
        description={deleteConfirmation.description}
        consequences={deleteConfirmation.consequences}
        confirmLabel={deleteConfirmation.confirmLabel}
        onCancel={() => {
          setConfirmBatchDelete(false);
        }}
        onConfirm={() => {
          void runBatchDelete();
        }}
      />

      <EntryFilterPanel open={pickerOpen} value={filter.value} ledger={ledger.data} anchor={monthAnchor} onApply={filter.apply} onClose={() => setPickerOpen(false)} />

      {showAllCurrencies ? (
        <AllCurrenciesSheet
          currencies={currencies}
          mainCode={mainCode}
          allMonths={allMonths}
          onClose={() => {
            setShowAllCurrencies(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The bottom bar, plus the space the entry cards need when they are out.
 *
 * The ledger builds its own frame rather than using `TabPage` because it owns
 * its scrolling region — the transition needs to know where the list is — and
 * because the bar's expansion has to reserve real space in this page's column.
 *
 * The cards behave the same here as on every other screen — pressing the button
 * unfolds the ways to add records. The difference is only that the ledger folds
 * them itself when the reader scrolls into the list; see the call site.
 *
 * The ledger is also where 拍照 gets the picker-direct behaviour: this is the
 * main screen, so it is where somebody is most likely to press that card, and
 * the two taps saved are saved here first.
 */
function LedgerNav({
  open,
  onToggle,
  onNavigate,
  onPickImages,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onNavigate: (to: string) => void;
  readonly onPickImages: (files: File[]) => void;
}): React.JSX.Element {
  return (
    <>
      <div
        aria-hidden="true"
        data-detail-menu-space
        data-entry-menu-open={open}
        className={`shrink-0 transition-[height] duration-200 ease-out ${open ? "h-[100px]" : "h-0"}`}
      />
      {/*
        ⚠️ **Banner and bar share one positioned wrapper, and that is the whole layout contract.**
        The notice is absolutely positioned above this wrapper's top edge, so it always sits just
        above the navigation no matter how tall the bar or safe area is — no fixed pixel offset,
        no measuring, no "it was right on my phone" guess. The `+` button is raised 32px above the
        bar, hence the 2.25rem gap in `AvatarRewardBanner`.
      */}
      <div className="relative shrink-0">
        <AvatarRewardBanner />
        <BottomNav
          active="/"
          onNavigate={onNavigate}
          cards={{ mode: "toggle", expanded: open, active: true, onToggle }}
          onPickImages={onPickImages}
        />
      </div>
    </>
  );
}


/** Every currency the account can use, including the ones with nothing in them. */
function AllCurrenciesSheet({
  currencies,
  mainCode,
  allMonths = false,
  onClose,
}: {
  readonly currencies: readonly CurrencySummary[];
  readonly mainCode: string;
  readonly allMonths?: boolean;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" aria-label={t("common.a11y.close")} onClick={onClose} className="absolute inset-0 bg-overlay" />

      <div
        role="dialog"
        aria-label={t("ledger.detail.allCurrencies")}
        className="relative w-full max-w-md rounded-t-sheet bg-surface px-6 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <h2 className="mb-4 text-base font-medium text-ink">{t("ledger.detail.allCurrencies")}</h2>

        <ul className="flex flex-col gap-2">
          {CURRENCIES.map((code) => {
            const row = currencies.find((item) => item.currency === code);

            return (
              <li key={code} className="flex items-center justify-between gap-3 rounded-field bg-canvas px-4 py-3">
                <span className="min-w-0 text-sm text-ink">
                  {currencyName(code)}
                  {code === mainCode ? (
                    <span className="ml-2 text-xs text-muted">{t("ledger.detail.mainCurrency")}</span>
                  ) : null}
                </span>

                {row === undefined ? (
                  <span className="shrink-0 text-xs text-muted">{allMonths ? t("ledger.detail.noData") : t("ledger.detail.nothingThisMonth")}</span>
                ) : (
                  <span className="shrink-0 text-sm tabular-nums text-ink">
                    {formatMoney(row.expenseCents, row.currency)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-field bg-brand-soft py-3 text-sm font-medium text-brand-dark"
        >
          {t("common.action.close")}
        </button>
      </div>
    </div>
  );
}

/**
 * 头部的月份文字（S16）。
 *
 * 中文沿用 `formatMonthLabel`（`2026 年 10 月`，与以前逐字一致）；其它语言用月份简称（`Oct 2026`）：
 * 列表态里月份和右上角三个工具按钮挤在同一行，320px 宽时放不下 `September 2026` 这样的全称。
 */
export function headerMonthLabel(month: string): string {
  if (isChineseLocale()) return formatMonthLabel(month);
  const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  return formatInstant(date, { month: "short", year: "numeric" });
}

/** 「全部」每批渲染的账目数（1.17.17）。 */
const ALL_RENDER_STEP = 200;


/**
 * Put the ledger in the order it is always shown in: newest first, oldest last.
 *
 * ⚠️ **A named function, called from one place, because the order must not depend on anything else.**
 *
 * The owner asked for exactly this: "每次打开明细页面时或者明细页面有任何修改（新增账单，修改账单等等）
 * 都会单独调用一个排序函数，排序函数会根据时间把所有的账单排序."
 *
 * **Every previous attempt sorted as a side effect of something else** — of where the data came from, of
 * which layer happened to answer, of whether a refetch had landed. That is why the order kept looking
 * shuffled: **it was never a decision, it was a leftover.** A single explicit sort, applied to whatever the
 * sources produced, makes the order a decision.
 *
 * It runs whenever the entries change, which covers both halves of his request: opening the screen sorts
 * what the device holds, and any write changes the entries, so the sort runs again.
 *
 * ⚠️ **Ties fall back to the id.** Two entries recorded in the same second must keep a stable relative
 * order, or they swap places between renders — **and a list that reshuffles while being read is worse than
 * one that is slightly wrong.**
 */
export function sortByTime(entries: readonly Transaction[]): readonly Transaction[] {
  return [...entries].sort((left, right) => {
    /**
     * ⚠️ **Compared as instants, never as strings — and that was a real bug, not a precaution.**
     *
     * The first version compared `occurredAt` lexicographically. That is only correct when every entry
     * carries the same UTC offset, and **this ledger holds entries recorded in two different zones**: the
     * owner was in California (UTC-7) while other entries were recorded in UTC+8.
     *
     * ```
     * "2026-10-11T20:00:00.000-07:00"   -> 03:00 UTC the next day   (actually the newest)
     * "2026-10-11T19:09:00.000+08:00"   -> 11:09 UTC that day
     * ```
     *
     * String order reads the second as *later*, because it compares the digits `19` and `20` and **never
     * looks at the offset**. So an entry recorded at eight in the evening sorted below one recorded at seven,
     * for no reason visible on screen — which is exactly what he reported: "他们都是在晚上8点…记得，应该在
     * 最前面才对."
     *
     * **Two instants compare by when they happened; two ISO strings compare by how they are spelled.**
     */
    const leftAt = Date.parse(left.occurredAt);
    const rightAt = Date.parse(right.occurredAt);

    /**
     * ⚠️ **An unparsable value sorts last rather than throwing.** One malformed timestamp must not take the
     * whole screen down, and an entry whose time cannot be read belongs at the bottom rather than nowhere.
     */
    if (Number.isNaN(leftAt) || Number.isNaN(rightAt)) {
      if (Number.isNaN(leftAt) && Number.isNaN(rightAt)) return left.id < right.id ? 1 : -1;

      return Number.isNaN(leftAt) ? 1 : -1;
    }

    if (leftAt !== rightAt) return leftAt < rightAt ? 1 : -1;

    /** ⚠️ Same instant: a stable tiebreak, so two entries never swap places between renders. */
    return left.id < right.id ? 1 : -1;
  });
}

/**
 * This month's entries, read straight from the device.
 *
 * ⚠️ **`useSyncExternalStore`, not `useState`, and that change is the fix.**
 *
 * The owner's tablet read the ledger correctly — 138 entries, reported by the diagnostics and by the
 * banner — and the screen stayed on its placeholder rows through several attempts, **including one
 * that passed the read's result straight into `useState`.** The state updater ran and the component
 * did not re-render, which is a reported WebKit/React interaction rather than anything about the data
 * ([React #22459](https://github.com/react/react/issues/22459)). The device is an iPad Pro, so the
 * rendering is not the weak link.
 *
 * **So the answer is not to make the work smaller — it is to stop routing the answer through a
 * mechanism that can drop it.** `useSyncExternalStore` reads the value **synchronously during render**
 * and re-renders when the store changes, so the entries are present the next time anything renders,
 * however that render was triggered.
 *
 * It does not poll: one read is kicked off on mount and whenever the view changes. **Re-reading a
 * hundred-kilobyte blob on a timer is the cost that made the tablet struggle in the first place**, and
 * the data only changes when the user does something.
 */
export function useLocalEntries(filters: TransactionFilters): readonly Transaction[] {
  /**
   * ⚠️ **The stored value is the whole ledger**, so this subscribes to that and filters on read.
   *
   * Filtering inside the snapshot getter would return a new array every call, and
   * `useSyncExternalStore` compares snapshots by identity — a new array each time is an infinite
   * render loop.
   */
  const all = useSyncExternalStore(subscribeLedger, ledgerSnapshotValue, ledgerSnapshotValue);

  /**
   * The filters as strings, so this effect compares values rather than object identity — otherwise a
   * fresh object literal every render would re-read the whole cache every render, which is the bug
   * being fixed.
   */
  const month = filters.month ?? "";
  const kind = filters.kind ?? "";
  const categoryId = filters.categoryId ?? "";
  const categoryIdsKey=JSON.stringify(filters.categoryIds);
  const currency = filters.currency ?? "";

  useEffect(() => {
    /**
     * ⚠️ **Fired and not awaited.** The result arrives through the store, so there is nothing to do
     * with it here — and awaiting it inside the effect would put the update back on the path that was
     * failing.
     */
    void readLocalTransactions();
  }, [month, kind, categoryId, currency]);

  return useMemo(
    () =>
      filterLocally(all, {
        ...(month === "" ? {} : { month }),
        ...(kind === "" ? {} : { kind: kind as Transaction["kind"] }),
        ...(categoryId === "" ? {} : { categoryId }),
        ...(filters.categoryIds===undefined?{}:{categoryIds:filters.categoryIds}),
        ...(currency === "" ? {} : { currency }),
      }),
    [all, month, kind, categoryId, categoryIdsKey, currency],
  );
}

/**
 * Why a screen is still waiting, in terms a person can act on.
 *
 * ⚠️ **Two different problems, told apart on screen.**
 *
 * "It will not load offline" has two very different causes and the owner has hit both:
 *
 *  * **the device holds nothing for this view** — a download that never happened, or a month outside
 *    the range that was downloaded. Fixable by downloading, and the message says so;
 *  * **the device was never successfully read** — the cache is there but something failed. Fixable
 *    by nothing the user can do, and the message says that instead of sending them to re-download.
 *
 * Telling them apart needs the counts from the last local read, which is why that is recorded at all.
 */
function StuckOnLoad(): React.JSX.Element {
  const { t } = useI18n();
  const read = lastLocalRead();

  const nothingStored = read.at === 0 || read.total === 0;

  return (
    <div className="flex flex-col gap-1.5 py-3 text-center text-helper-relaxed text-muted">
      {nothingStored ? (
        <>
          <p>{t("ledger.detail.stuck.nothingStored")}</p>
          <p>{t("ledger.detail.stuck.nothingStoredHint")}</p>
        </>
      ) : (
        <>
          <p>{t("ledger.detail.stuck.unreadable", { count: read.total })}</p>
          <p>{t("ledger.detail.stuck.unreadableHint")}</p>
        </>
      )}

      {/* The numbers, so the line above can be checked rather than believed. */}
      <p className="font-mono text-[10px] opacity-70">
        {read.at === 0
          ? t("ledger.detail.stuck.readNotTried")
          : `${t("ledger.detail.stuck.readCounts", {
              stored: read.storedEntries,
              disk: read.diskEntries,
              live: read.liveEntries,
              total: read.total,
            })}${read.note === null ? "" : t("ledger.detail.stuck.readNote", { note: read.note })}`}
      </p>
    </div>
  );
}
