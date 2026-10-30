/**
 * **S18 大屏多工作区外壳。**
 *
 * 一个应用、一份共享数据（同一个查询缓存、登录状态、离线队列与撤销条），两个可组合的工作区实例
 * （`w1` / `w2`），每个实例有自己的路由与返回历史（`PaneHistory`）、筛选、滚动位置与页面内状态。
 *
 * - **手机尺寸**：外壳与主工作区的盒子都是 `display: contents`，页面拿到的 DOM 与以前相同（底部导航、
 *   `h-dvh` 框架、文档滚动），辅助实例若存在则隐藏保留。
 * - **大屏**（窗口约 ≥ 700×520 CSS px，按实际窗口而不是设备型号）：左侧全局侧栏 + 主工作区；用户打开辅助区
 *   后，横屏左右、竖屏上下分栏，默认 55:45，可拖动，越过 30/70 松手收起一侧。
 *
 * ⚠️ **两个实例始终按 `w1`、`w2` 的固定顺序挂载**，角色（主 / 辅）只决定位置与地址栏归属——所以交换角色、
 * 收起、恢复、横竖屏旋转都不会卸载页面，未保存的表单与滚动位置原样保留。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";

import { useAuth } from "../auth/AuthProvider.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useI18n } from "../i18n/index.js";
import { currentBookId, subscribeCurrentBook } from "../lib/currentBook.js";
import { useGuestIdentity } from "../lib/guest/session.js";
import { useBooks } from "../lib/queries.js";
import { foreignBookFor, ViewLedgerContext } from "../lib/workspaceLedger.js";
import {
  PaneContext,
  PaneSizeContext,
  PaneSizeStore,
  WorkspaceActionsContext,
  WorkspaceViewContext,
  type OpenOptions,
  type PaneInfo,
  type WorkspaceActions,
  type WorkspaceView,
} from "./context.js";
import { followTargetFor, isFollowDetail, isStandalonePath } from "./follow.js";
import {
  GUTTER,
  layoutPanes,
  orientationFor,
  railWidthFor,
  shellModeFor,
  splitFits,
  WIDE_MIN_WIDTH,
  type Orientation,
  type Rect,
  type ShellMode,
} from "./geometry.js";
import { GlobalRail } from "./GlobalRail.js";
import {
  INITIAL_WORKSPACE,
  otherInstance,
  parseWorkspaceState,
  workspaceReducer,
  type FollowMode,
  type InstanceId,
  type WorkspaceState,
} from "./model.js";
import { entryKey, parseEntryLedgers, pruneEntryLedgers, withoutInstance, type EntryLedgers } from "./entryLedgers.js";
import { navDrag, type DropTarget } from "./navDrag.js";
import { entryFromPath, entryPath, PaneHistory, type SerializedPaneHistory } from "./paneHistory.js";
import { PaneRouter } from "./PaneRouter.js";
import { START_PATH } from "./paneTitle.js";
import { createSlotFor, Divider, DropPreview, ModeCapsule, RestoreTab, ShellToast, SplitHint, type ResizeController } from "./ShellControls.js";
import { SecondaryFab } from "./SecondaryNav.js";
import { XIcon } from "./icons.js";
import { usePaneIdentity } from "./paneTitle.js";
import "./workspace.css";

const STORAGE_KEY = "libevra.workspace.v1";
const INSTANCES: readonly InstanceId[] = ["w1", "w2"];

interface Persisted {
  readonly state: WorkspaceState;
  readonly histories: Partial<Record<InstanceId, SerializedPaneHistory>>;
  readonly entryLedgers?: EntryLedgers;
  /** 保存时的身份（`user:…` / `guest:…`）；与载入时的身份不同就不恢复辅助区。 */
  readonly owner?: string | null;
}

function readPersisted(): Persisted | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { state?: unknown; histories?: Record<string, SerializedPaneHistory>; owner?: unknown; entryLedgers?: unknown };
    return {
      owner: typeof parsed.owner === "string" ? parsed.owner : null,
      entryLedgers: parseEntryLedgers(parsed.entryLedgers),
      state: parseWorkspaceState(parsed.state),
      histories: {
        ...(isSerialized(parsed.histories?.["w1"]) ? { w1: parsed.histories["w1"] } : {}),
        ...(isSerialized(parsed.histories?.["w2"]) ? { w2: parsed.histories["w2"] } : {}),
      },
    };
  } catch {
    return null;
  }
}

function isSerialized(value: unknown): value is SerializedPaneHistory {
  if (value === null || typeof value !== "object") return false;
  const record = value as { entries?: unknown; index?: unknown };
  return (
    Array.isArray(record.entries) &&
    typeof record.index === "number" &&
    record.entries.every(
      (entry: unknown) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as { path?: unknown }).path === "string" &&
        typeof (entry as { key?: unknown }).key === "string" &&
        (entry as { path: string }).path.startsWith("/"),
    )
  );
}

/**
 * 只保存路由与布局（地址、比例、模式），**不保存任何账目内容**：刷新后在同一会话里恢复两个工作区的
 * 页面；账目本身仍按既有离线与同步机制读取。
 */
function writePersisted(value: Persisted): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 隐私模式 / 存储已满：工作区照常可用，只是刷新后不恢复。
  }
}

function useViewport(): { readonly w: number; readonly h: number } {
  const read = useCallback(() => `${String(window.innerWidth)}x${String(window.innerHeight)}`, []);
  const subscribe = useCallback((listener: () => void) => {
    window.addEventListener("resize", listener);
    window.addEventListener("orientationchange", listener);
    return () => {
      window.removeEventListener("resize", listener);
      window.removeEventListener("orientationchange", listener);
    };
  }, []);
  const value = useSyncExternalStore(subscribe, read, () => "390x844");
  const [w, h] = value.split("x").map(Number);
  return { w: w ?? 390, h: h ?? 844 };
}

function editingText(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return active.isContentEditable || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || (active instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(active.type));
}

function useSnapshot(history: PaneHistory) {
  return useSyncExternalStore(history.subscribe, () => history.snapshot, () => history.snapshot);
}

function createHistories(saved: Persisted | null, primary: InstanceId): { readonly histories: Record<InstanceId, PaneHistory>; readonly rebuilt: boolean } {
  const histories = {
    w1: PaneHistory.restore("w1", saved?.histories.w1, primary === "w1" ? "/" : START_PATH),
    w2: PaneHistory.restore("w2", saved?.histories.w2, primary === "w2" ? "/" : START_PATH),
  };
  // 地址栏是主区的真相：保存的当前页与地址栏不一致（深链、刷新到别处）时，主区从地址栏重新开始。
  const url = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const owner = histories[primary];
  if (entryPath(owner.location) !== url) {
    histories[primary] = new PaneHistory(primary, [entryFromPath(url, "default")]);
    return { histories, rebuilt: true };
  }
  return { histories, rebuilt: false };
}

export function WorkspaceShell({
  renderRoutes,
  wrapChrome,
}: {
  /** 每个工作区实例里渲染的同一套路由。 */
  readonly renderRoutes: () => React.ReactNode;
  /** 包住整个外壳、需要主区路由上下文的全局门禁（同意书 / 重大公告）。 */
  readonly wrapChrome: (children: React.ReactNode) => React.ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  const viewport = useViewport();
  /**
   * ⚠️ **软键盘弹出不是「窗口变小」。** 有的平板浏览器在键盘弹出时缩小布局视口，高度可能低于大屏下限；
   * 如果因此切回手机界面，正在输入的表单会突然换成底部导航的样子。所以已经是大屏、且焦点在输入框里时，
   * 高度变化不改变外壳形态（宽度不足仍然切换）。
   */
  const lastMode = useRef<ShellMode | null>(null);
  let shellMode = shellModeFor(viewport.w, viewport.h);
  if (shellMode === "phone" && lastMode.current === "wide" && viewport.w >= WIDE_MIN_WIDTH && editingText()) shellMode = "wide";
  lastMode.current = shellMode;
  const orientation: Orientation = orientationFor(viewport.w, viewport.h);
  const { status, user } = useAuth();
  const guest = useGuestIdentity();

  const [boot] = useState(() => {
    const saved = readPersisted();
    const state = saved?.state ?? INITIAL_WORKSPACE;
    const created = createHistories(saved, state.primary);
    // 主区从地址栏重新开始时，它以前那些记录的账本不再适用（新的第一页同样叫 "default"）。
    const entryLedgers = created.rebuilt ? withoutInstance(saved?.entryLedgers ?? {}, state.primary) : (saved?.entryLedgers ?? {});
    return { state, owner: saved?.owner ?? null, histories: created.histories, entryLedgers };
  });
  const histories = boot.histories;
  const [state, dispatch] = useReducer(workspaceReducer, boot.state);
  const primaryHistory = histories[state.primary];
  const secondaryId = state.secondary;

  const primarySnap = useSnapshot(primaryHistory);
  const secondarySnap = useSnapshot(histories[otherInstance(state.primary)]);

  /**
   * ⚠️ **账本隔离（第二轮）。** 每个实例查看自己的账本：`state.ledgers[实例]`，再被单条记录的账本覆盖
   * （跟随 / 拖入打开的那一页属于来源工作区的那本账）。设备当前账本只有一个，`null` 表示跟随它。
   */
  const deviceBook = useSyncExternalStore(subscribeCurrentBook, currentBookId, currentBookId);
  const [entryLedgers, setEntryLedgers] = useState<EntryLedgers>(boot.entryLedgers);
  const entryLedgersRef = useRef(entryLedgers);
  entryLedgersRef.current = entryLedgers;
  /** 某个实例当前页实际选的账本（`null` = 设备当前账本）。 */
  const chosenLedger = (id: InstanceId, key: string): string | null => entryLedgers[entryKey(id, key)] ?? state.ledgers[id];

  /** 账本列表刷新后，丢掉已经无权访问的工作区账本（见 `LedgerWatch`）。 */
  const pruneLedgers = useCallback((ids: ReadonlySet<string>) => {
    for (const id of INSTANCES) {
      const chosen = latest.current.state.ledgers[id];
      if (chosen !== null && !ids.has(chosen)) dispatch({ type: "setLedger", instance: id, ledger: null });
    }
    setEntryLedgers((current) => {
      const stale = Object.keys(current).filter((key) => !ids.has(current[key] as string));
      if (stale.length === 0) return current;
      const next = { ...current };
      for (const key of stale) delete next[key];
      return next;
    });
  }, []);

  // ---- 地址栏归属：主区实例写地址栏，角色转换时交接 ----
  const ownerRef = useRef<InstanceId | null>(null);
  useLayoutEffect(() => {
    const primary = histories[state.primary];
    if (ownerRef.current === null) {
      primary.adopt(window);
    } else if (ownerRef.current !== state.primary) {
      histories[ownerRef.current].detach();
      primary.takeOver(window);
    }
    ownerRef.current = state.primary;
  }, [histories, state.primary]);
  useEffect(
    () => () => {
      histories.w1.detach();
      histories.w2.detach();
      ownerRef.current = null;
    },
    [histories],
  );

  // ---- 外壳尺寸 ----
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [shellBox, setShellBox] = useState<{ w: number; h: number }>({ w: viewport.w, h: viewport.h });
  useLayoutEffect(() => {
    const element = shellRef.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    // 内容盒（扣除安全区内边距）：工作区与侧栏都排在它里面。
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box === undefined || box.width === 0 || box.height === 0) return;
      setShellBox((current) =>
        Math.round(current.w) === Math.round(box.width) && Math.round(current.h) === Math.round(box.height)
          ? current
          : { w: box.width, h: box.height },
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const hasSession = status !== "loading" && (user !== null || guest !== null);

  /**
   * ⚠️ **辅助区属于当前身份。** 退出登录、换账号或游客升级为正式账号时，辅助区实例连同它的页面一起丢掉，
   * 不会在下一个身份登录后把上一个人的页面（或一张停在登录页的辅助区）显示出来。
   */
  const identity = status === "loading" ? undefined : user !== null ? `user:${user.id}` : guest !== null ? `guest:${guest.id}` : null;
  const lastIdentity = useRef<string | null | undefined>(boot.owner ?? undefined);
  useEffect(() => {
    if (identity === undefined) return;
    const previous = lastIdentity.current;
    lastIdentity.current = identity;
    if (previous === undefined || previous === identity) return;
    if (latest.current.state.secondary === null) return;
    const other = histories[otherInstance(latest.current.state.primary)];
    other.reset(START_PATH);
    setEntryLedgers({});
    dispatch({ type: "resetForIdentity" });
  }, [histories, identity]);
  const chrome = shellMode === "wide" && hasSession && !isStandalonePath(primarySnap.location.pathname);
  const box = chrome ? shellBox : { w: viewport.w, h: viewport.h };
  const splitRail = railWidthFor(state.rail, true);
  const fits = splitFits({ w: box.w - splitRail, h: box.h }, orientation);
  const splitVisible = chrome && state.secondaryOpen && secondaryId !== null && fits;
  const railWidth = chrome ? railWidthFor(state.rail, splitVisible) : 0;
  const area = { w: Math.max(0, box.w - railWidth), h: box.h };
  const layout = layoutPanes(area, orientation, splitVisible, state.ratio);

  // ---- 草稿登记、跟随拦截、自动独立 ----
  const latest = useRef({ state, splitVisible, canSplit: chrome && fits });
  latest.current = { state, splitVisible, canSplit: chrome && fits };
  const dirty = useRef<Record<InstanceId, boolean>>({ w1: false, w2: false });
  const shellNavigating = useRef(false);
  const lastShellNav = useRef(0);
  const [toast, setToast] = useState<{ readonly id: number; readonly text: string } | null>(null);
  const say = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);

  const shellNav = useCallback((run: () => void) => {
    shellNavigating.current = true;
    lastShellNav.current = Date.now();
    try {
      run();
    } finally {
      shellNavigating.current = false;
    }
  }, []);

  const markEntryLedger = useCallback((instance: InstanceId, entry: string, ledger: string | null | undefined) => {
    if (ledger === undefined) return;
    const key = entryKey(instance, entry);
    setEntryLedgers((current) => {
      if (ledger === null) {
        if (current[key] === undefined) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      return current[key] === ledger ? current : { ...current, [key]: ledger };
    });
  }, []);

  /**
   * 在一页「别的账本」的页面里继续往下点（例如跟随打开的明细 → 它的编辑记录），新页面仍属于那本账。
   * 外壳自己的导航（辅助区导航、拖入打开）不继承，由调用方明确指定。
   */
  useEffect(() => {
    const offs = INSTANCES.map((id) => {
      const history = histories[id];
      let previous = history.location;
      return history.onNavigate((navigation) => {
        const before = previous;
        previous = navigation.location;
        if (navigation.source !== "app" || navigation.action === "POP" || shellNavigating.current) return;
        const inherited = entryLedgersRef.current[entryKey(id, before.key)];
        if (inherited === undefined || entryLedgersRef.current[entryKey(id, navigation.location.key)] !== undefined) return;
        markEntryLedger(id, navigation.location.key, inherited);
      });
    });
    return () => {
      for (const off of offs) off();
    };
  }, [histories, markEntryLedger]);

  useEffect(() => {
    const primary = histories[state.primary];
    const other = histories[otherInstance(state.primary)];
    other.setInterceptor(null);
    primary.setInterceptor((request) => {
      const current = latest.current;
      const target = followTargetFor({ ...current.state, splitVisible: current.splitVisible, canSplit: current.canSplit }, request.from.pathname, request.to.pathname);
      if (target === null) return false;
      if (dirty.current[other.id as InstanceId]) {
        // 辅助区有尚未保存的修改：跟随不能替换掉它，详情改在主区打开。
        say(t("workspace.toast.followBlocked"));
        return false;
      }
      // 跟随打开的详情属于主区正在看的那本账（辅助区可以在看另一本）。
      const source = entryLedgersRef.current[entryKey(primary.id as InstanceId, request.from.key)] ?? current.state.ledgers[primary.id as InstanceId] ?? currentBookId();
      shellNav(() => {
        if (target === "open-secondary" && current.state.secondary === null) other.reset(START_PATH);
        // 连续点开：替换上一条跟随详情，而不是越叠越深；第一次压在辅助区原有页面之上，按返回能回去。
        other.open(entryPath(request.to), {
          replace: isFollowDetail(other.location.pathname),
          state: request.to.state,
        });
      });
      markEntryLedger(other.id as InstanceId, other.location.key, source);
      if (target === "open-secondary") {
        dispatch({ type: "openSecondary", independent: false });
        dispatch({ type: "setMode", mode: "follow" });
      }
      return true;
    });
    return () => {
      primary.setInterceptor(null);
    };
  }, [histories, state.primary, say, shellNav, t, markEntryLedger]);

  /**
   * 「返回」的意图（第三轮）：页面的返回按钮有时并不是后退一步，而是打开声明的上级页面（例如账单详情的
   * 返回是 `navigate("/")`，是一次 push）。外壳据此把它认作返回，而不是用户主动打开新页面。
   */
  const backIntent = useRef<{ readonly instance: InstanceId; readonly at: number } | null>(null);

  useEffect(() => {
    if (secondaryId === null) return;
    const history = histories[secondaryId];
    let previous = history.location;
    return history.onNavigate((navigation) => {
      const before = previous;
      previous = navigation.location;
      if (shellNavigating.current || navigation.source !== "app") return;
      const intent = backIntent.current;
      const isBack = navigation.action === "POP" || (intent !== null && intent.instance === secondaryId && Date.now() - intent.at < 1500);
      if (isBack) backIntent.current = null;
      if (latest.current.state.mode !== "follow" || !latest.current.splitVisible) return;

      if (isBack) {
        /**
         * ⚠️ **返回不等于「用户想让两边各走各的」**（所有者 2026-10-30 第三轮）。跟随模式下在辅助区按返回：
         * 不切独立；如果返回后辅助区显示的正是主区当前这一页（同一地址、同一本账），辅助区回到空白的
         * 起始页并保持跟随——两边显示同一页没有意义。
         */
        const ledgers = entryLedgersRef.current;
        const state = latest.current.state;
        const resolve = (instance: InstanceId, key: string, inheritFrom: string | null): string | null =>
          ledgers[entryKey(instance, key)] ??
          (inheritFrom === null ? undefined : ledgers[entryKey(instance, inheritFrom)]) ??
          state.ledgers[instance] ??
          currentBookId();
        const primary = histories[state.primary];
        const here = resolve(secondaryId, navigation.location.key, navigation.action === "POP" ? null : before.key);
        const there = resolve(state.primary, primary.location.key, null);
        if (entryPath(navigation.location) === entryPath(primary.location) && here === there) {
          queueMicrotask(() => {
            shellNav(() => {
              history.reset(START_PATH);
            });
            setEntryLedgers((current) => withoutInstance(current, secondaryId));
          });
        }
        return;
      }

      const filterChange =
        navigation.action === "REPLACE" &&
        navigation.location.pathname === before.pathname &&
        navigation.location.search !== before.search &&
        Date.now() - lastShellNav.current > 1200;
      if (navigation.action === "PUSH" || filterChange) {
        dispatch({ type: "setMode", mode: "independent" });
        say(t("workspace.mode.autoIndependent"));
      }
    });
  }, [histories, secondaryId, say, t, shellNav]);

  // ---- 会话内保存 ----
  const persistNow = useCallback(() => {
    const w1 = histories.w1.serialize();
    const w2 = histories.w2.serialize();
    writePersisted({
      state: latest.current.state,
      owner: lastIdentity.current ?? null,
      histories: { w1, w2 },
      entryLedgers: pruneEntryLedgers(entryLedgersRef.current, { w1, w2 }),
    });
  }, [histories]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(persistNow, 150);
    };
    const flush = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      persistNow();
    };
    save();
    const off1 = histories.w1.subscribe(save);
    const off2 = histories.w2.subscribe(save);
    // 切换账本会整页重新载入：离开页面前立刻写一次，重新载入后两个工作区原样恢复。
    window.addEventListener("pagehide", flush);
    return () => {
      off1();
      off2();
      window.removeEventListener("pagehide", flush);
      if (timer !== null) clearTimeout(timer);
    };
  }, [histories, state, entryLedgers, persistNow]);

  // ---- 动作 ----
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exiting, setExiting] = useState<{ readonly id: InstanceId; readonly rect: Rect } | null>(null);
  const lastSecondaryRect = useRef<Rect | null>(null);
  if (layout.secondary !== null) lastSecondaryRect.current = layout.secondary;

  const beginExit = useCallback((id: InstanceId) => {
    const rect = lastSecondaryRect.current;
    if (rect === null) return;
    if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    setExiting({ id, rect });
    exitTimer.current = setTimeout(() => {
      setExiting(null);
    }, 260);
  }, []);
  useEffect(
    () => () => {
      if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    },
    [],
  );

  /**
   * ⚠️ **丢弃草稿之前先问。** 在辅助区打开新页面会卸载它当前的页面（即使辅助区处于收起状态），切换账本会
   * 整页重新载入两个工作区——有未保存修改时先确认，取消就什么都不做。
   */
  const [pendingDiscard, setPendingDiscard] = useState<{ readonly kind: "primary" | "secondary" | "reload"; readonly run: () => void } | null>(null);
  const allowUnload = useRef(false);
  const guardSecondary = useCallback((run: () => void) => {
    const secondary = latest.current.state.secondary;
    if (secondary !== null && dirty.current[secondary]) {
      setPendingDiscard({ kind: "secondary", run });
      return;
    }
    run();
  }, []);
  /** 拖到主区 / 菜单「在主工作区打开」会替换主区当前页：有未保存修改时同样先问。 */
  const guardPrimary = useCallback((run: () => void) => {
    if (dirty.current[latest.current.state.primary]) {
      setPendingDiscard({ kind: "primary", run });
      return;
    }
    run();
  }, []);

  const confirmReload = useCallback((run: () => void) => {
    const go = (): void => {
      allowUnload.current = true;
      run();
    };
    if (dirty.current.w1 || dirty.current.w2) {
      setPendingDiscard({ kind: "reload", run: go });
      return;
    }
    go();
  }, []);

  /** 有两个工作区实例、且任一边有未保存修改时，整页重新载入 / 关闭页面先由浏览器确认。 */
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (allowUnload.current || latest.current.state.secondary === null) return;
      if (!dirty.current.w1 && !dirty.current.w2) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  const actions = useMemo<WorkspaceActions & {
    readonly collapse: (side: "primary" | "secondary") => void;
    readonly setRatio: (ratio: number) => void;
    readonly navigatePrimary: (path: string) => void;
    readonly navigateSecondary: (path: string) => void;
    readonly setRail: (rail: WorkspaceState["rail"]) => void;
    readonly confirmReload: (run: () => void) => void;
  }>(
    () => ({
      openInSecondary: (path: string, options?: OpenOptions) => {
        guardSecondary(() => {
          const current = latest.current.state;
          const id = current.secondary ?? otherInstance(current.primary);
          const target = histories[id];
          // 第一次打开的辅助区从干净的起始页开始，不接着用以前会话里留下的历史。
          if (current.secondary === null) target.reset(START_PATH);
          shellNav(() => {
            target.open(path, { replace: target.location.pathname === START_PATH && target.snapshot.length === 1 });
          });
          // 没有指定账本 = 目标工作区自己的账本（替换第一页时那一页原有的记录账本也要清掉）。
          markEntryLedger(id, target.location.key, options?.ledger ?? null);
          dispatch({ type: "openSecondary", independent: true });
          // 拖入整本账等同于在目标区切换账本；后续主导航继续使用这本账。
          if (path === "/" && options?.ledger !== undefined) dispatch({ type: "setLedger", instance: id, ledger: options.ledger });
        });
      },
      openInPrimary: (path: string, options?: OpenOptions) => {
        // 只改主区：不经过跟随拦截，不交换角色，辅助区的页面与历史原样保留。
        guardPrimary(() => {
          const current = latest.current.state;
          const target = histories[current.primary];
          shellNav(() => {
            target.open(path);
          });
          markEntryLedger(current.primary, target.location.key, options?.ledger ?? null);
          if (path === "/" && options?.ledger !== undefined) dispatch({ type: "setLedger", instance: current.primary, ledger: options.ledger });
        });
      },
      enterLedger: (instance: InstanceId, bookId: string, reload: () => void) => {
        const current = latest.current.state;
        const device = currentBookId();
        const target = histories[instance];
        if (instance !== current.primary) {
          // 辅助区：只换它自己查看的账本，主区与设备当前账本都不动。
          guardSecondary(() => {
            dispatch({ type: "setLedger", instance, ledger: bookId === device ? null : bookId });
            shellNav(() => {
              target.open("/");
            });
            if (latest.current.state.mode === "follow" && latest.current.splitVisible) dispatch({ type: "setMode", mode: "independent" });
          });
          return;
        }
        if (bookId === device || (bookId === current.ledgers[instance] && device !== null)) {
          // 主区本来就在这本账（设备当前账本，或主区一直在看的那本外部账本）：回到它的明细，不重新载入。
          if (bookId === device) dispatch({ type: "setLedger", instance, ledger: null });
          shellNav(() => {
            target.open("/");
          });
          markEntryLedger(instance, target.location.key, null);
          return;
        }
        confirmReload(() => {
          // 设备当前账本将要改变：先把其余跟随当前账本的工作区钉在原来那本账上，并立刻写进会话，
          // 重新载入后辅助区仍然显示它原来的账本。主区从地址栏重新开始，它以前的记录账本一并清掉。
          if (device !== null) {
            const next = workspaceReducer(latest.current.state, { type: "pinLedgers", keep: instance, previous: device, next: bookId });
            latest.current = { ...latest.current, state: next };
            dispatch({ type: "pinLedgers", keep: instance, previous: device, next: bookId });
          }
          entryLedgersRef.current = withoutInstance(entryLedgersRef.current, instance);
          setEntryLedgers(entryLedgersRef.current);
          persistNow();
          reload();
        });
      },
      restoreSecondary: () => {
        if (latest.current.state.secondary === null) {
          histories[otherInstance(latest.current.state.primary)].reset(START_PATH);
          dispatch({ type: "openSecondary", independent: false });
          return;
        }
        dispatch({ type: "restoreSecondary" });
      },
      closeSecondary: () => {
        const current = latest.current.state;
        if (current.secondary !== null) beginExit(current.secondary);
        dispatch({ type: "closeSecondary" });
      },
      setMode: (mode: FollowMode) => {
        dispatch({ type: "setMode", mode });
      },
      setDirty: (instance: InstanceId, value: boolean) => {
        if (dirty.current[instance] === value) return;
        dirty.current = { ...dirty.current, [instance]: value };
        const current = latest.current.state;
        if (value && instance === current.secondary && current.mode === "follow" && latest.current.splitVisible) {
          dispatch({ type: "setMode", mode: "independent" });
        }
      },
      markBack: (instance: InstanceId) => {
        backIntent.current = { instance, at: Date.now() };
      },
      viewDeviceLedger: (instance: InstanceId) => {
        dispatch({ type: "setLedger", instance, ledger: null });
        markEntryLedger(instance, histories[instance].location.key, null);
      },
      collapse: (side: "primary" | "secondary") => {
        dispatch({ type: "collapse", side });
      },
      setRatio: (ratio: number) => {
        dispatch({ type: "setRatio", ratio });
      },
      navigatePrimary: (path: string) => {
        // 侧栏导航本身就是「在主区打开」，不经过跟随拦截；主导航按主区自己的账本，不继承当前页的记录账本。
        const current = latest.current.state;
        const target = histories[current.primary];
        shellNav(() => {
          target.open(path);
        });
      },
      navigateSecondary: (path: string) => {
        guardSecondary(() => {
          const current = latest.current.state;
          if (current.secondary === null) return;
          shellNav(() => {
            histories[current.secondary as InstanceId].open(path);
          });
          dispatch({ type: "setMode", mode: "independent" });
        });
      },
      setRail: (rail: WorkspaceState["rail"]) => {
        dispatch({ type: "setRail", rail });
      },
      confirmReload,
    }),
    [beginExit, confirmReload, guardPrimary, guardSecondary, histories, markEntryLedger, persistNow, shellNav],
  );

  const followedPath =
    splitVisible && state.mode === "follow" && isFollowDetail(secondarySnap.location.pathname)
      ? secondarySnap.location.pathname
      : null;
  const canSplit = chrome && fits;
  const view = useMemo<WorkspaceView>(
    () => ({ state, shell: chrome ? "wide" : "phone", orientation, splitVisible, canSplit, followedPath }),
    [state, chrome, orientation, splitVisible, canSplit, followedPath],
  );

  /**
   * ---- 「在指定工作区打开」的落点（第二轮） ----
   *
   * 按两个工作区**真实的矩形**判断（不是屏幕的一半）：两区都在时，落在哪一区就在哪一区打开，分界区不算；
   * 只有一个工作区时，落在将来辅助区的位置（横屏右侧 / 竖屏下方，按上次的比例）= 新建辅助区，
   * 其余 = 主区。
   */
  const areaRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLDivElement | null>(null);
  const paneElements = useRef<Record<InstanceId, HTMLElement | null>>({ w1: null, w2: null });
  const dropGeometry = useRef({ area, orientation, canSplit });
  dropGeometry.current = { area, orientation, canSplit };
  useEffect(() => {
    if (!chrome) return;
    const inside = (rect: DOMRect, x: number, y: number): boolean => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    return navDrag.register({
      resolve: (x, y) => {
        // 右上角的取消区域优先（可按范围比看得见的大一圈）。
        const cancel = cancelRef.current?.getBoundingClientRect();
        if (cancel !== undefined && x >= cancel.left - 12 && x <= cancel.right + 12 && y >= cancel.top - 12 && y <= cancel.bottom + 12) return "cancel";
        const element = areaRef.current;
        if (element === null) return null;
        const box = element.getBoundingClientRect();
        if (!inside(box, x, y)) return null;
        const current = latest.current;
        if (current.splitVisible && current.state.secondary !== null) {
          const primary = paneElements.current[current.state.primary]?.getBoundingClientRect();
          const secondary = paneElements.current[current.state.secondary]?.getBoundingClientRect();
          if (primary !== undefined && inside(primary, x, y)) return "primary";
          if (secondary !== undefined && inside(secondary, x, y)) return "secondary";
          return null;
        }
        const geometry = dropGeometry.current;
        if (!geometry.canSplit) return "primary";
        const slot = createSlotFor(geometry.area, geometry.orientation, current.state.ratio);
        if (slot === null) return "primary";
        const localX = x - box.left;
        const localY = y - box.top;
        const inSlot = geometry.orientation === "landscape" ? localX >= slot.x : localY >= slot.y;
        return inSlot ? "create" : "primary";
      },
      drop: (target: Exclude<DropTarget, "cancel">, payload) => {
        const options = payload.ledger === null ? {} : { ledger: payload.ledger };
        if (target === "primary") actions.openInPrimary(payload.path, options);
        else actions.openInSecondary(payload.path, options);
      },
    });
  }, [actions, chrome]);

  /** 拖动中的状态：只在「开始 / 换落点 / 结束」时让外壳重新渲染，不跟随每一帧的指针移动。 */
  const dragKey = useSyncExternalStore(
    navDrag.subscribe,
    () => {
      const drag = navDrag.get();
      return drag.active ? (drag.target ?? "none") : "idle";
    },
    () => "idle",
  );

  // ---- 分界线拖动（预览帧在区域内，侧栏分割线读同一个 CSS 变量） ----
  const resize = useRef<ResizeController | null>(null);

  /** 主区在分界方向上的尺寸（px）：侧栏里的分割线与拖动预览都从它算起。 */
  const splitPx = layout.divider === null ? 0 : orientation === "landscape" ? layout.primary.w : layout.primary.h;

  const panes = INSTANCES.filter((id) => id === state.primary || id === secondaryId);
  /**
   * 同一个路由元素交给两个工作区：外壳因提示、尺寸或模式变化重新渲染时，页面树按引用相同直接跳过，
   * 不会跟着整页重算（拖动分界线本身不经过 React）。
   */
  const routes = useMemo(() => renderRoutes(), [renderRoutes]);

  const shell = (
    <div
      ref={shellRef}
      className="lv-shell"
      data-shell={chrome ? "wide" : "contents"}
      data-orientation={orientation}
      data-split={splitVisible ? "true" : "false"}
      data-navdrag={chrome && dragKey !== "idle" ? "true" : undefined}
      data-drop={chrome && dragKey !== "idle" ? dragKey : undefined}
      style={
        chrome
          ? ({
              ["--lv-rail-w" as string]: `${String(railWidth)}px`,
              ["--lv-split-a" as string]: `${String(splitPx)}px`,
              ["--lv-gutter" as string]: `${String(GUTTER)}px`,
              ["--lv-ratio" as string]: String(state.ratio),
            } as React.CSSProperties)
          : undefined
      }
    >
      {chrome ? (
        <ViewLedgerContext.Provider value={chosenLedger(state.primary, primarySnap.location.key)}>
        <GlobalRail
          compact={railWidth < 120}
          orientation={orientation}
          splitVisible={splitVisible}
          preference={state.rail}
          primaryPath={primarySnap.location.pathname}
          secondaryPath={secondaryId === null ? null : secondarySnap.location.pathname}
          onNavigate={actions.navigatePrimary}
          onNavigateSecondary={actions.navigateSecondary}
          onOpenInSecondary={actions.openInSecondary}
          onSetRail={actions.setRail}
          onEnterLedger={(bookId, reload) => {
            actions.enterLedger(latest.current.state.primary, bookId, reload);
          }}
          canSplit={canSplit}
        />
        </ViewLedgerContext.Provider>
      ) : null}

      <div ref={areaRef} className="lv-area">
        {panes.map((id) => {
          const role = id === state.primary ? "primary" : "secondary";
          const visible = role === "primary" || splitVisible;
          const snap = role === "primary" ? primarySnap : secondarySnap;
          const chosen = chosenLedger(id, snap.location.key);
          const rect =
            role === "primary"
              ? layout.primary
              : (layout.secondary ?? (exiting?.id === id ? exiting.rect : lastSecondaryRect.current) ?? layout.primary);
          const info: PaneInfo = {
            instance: id,
            role,
            shell: chrome ? "wide" : "phone",
            nav: role === "secondary" ? "none" : chrome ? "rail" : "bottom",
            split: splitVisible ? (orientation === "landscape" ? "row" : "column") : "none",
            visible,
          };
          return (
            <Pane
              key={id}
              history={histories[id]}
              info={info}
              rect={rect}
              mode={chrome ? "box" : role === "primary" ? "contents" : "hidden"}
              exiting={exiting?.id === id}
              label={role === "primary" ? t("workspace.pane.primary") : t("workspace.pane.secondary")}
              ledger={chosen}
              foreign={foreignBookFor(chosen, deviceBook, guest !== null)}
              drag={chrome && dragKey !== "idle" ? (dragKey === role ? "target" : "other") : "idle"}
              fab={chrome && role === "secondary" && splitVisible}
              register={(element) => {
                paneElements.current[id] = element;
              }}
            >
              {routes}
            </Pane>
          );
        })}

        {chrome && splitVisible && layout.divider !== null ? (
          <>
            <Divider
              rect={layout.divider}
              orientation={orientation}
              ratio={state.ratio}
              area={area}
              shellRef={shellRef}
              controller={resize}
              primaryPath={primarySnap.location.pathname}
              secondaryPath={secondarySnap.location.pathname}
              primaryLedger={chosenLedger(state.primary, primarySnap.location.key)}
              secondaryLedger={chosenLedger(secondaryId as InstanceId, secondarySnap.location.key)}
              onCommit={actions.setRatio}
              onCollapse={(side) => {
                actions.collapse(side);
                if (side === "secondary") say(t("workspace.toast.collapsedSecondary"));
              }}
              onPromoted={(title) => {
                say(t("workspace.toast.promoted", { title }));
              }}
            />
            <ModeCapsule mode={state.mode} orientation={orientation} divider={layout.divider} area={area} onChange={(mode) => {
              actions.setMode(mode);
              say(mode === "follow" ? t("workspace.mode.nowFollow") : t("workspace.mode.nowIndependent"));
            }} />
            <SplitHint orientation={orientation} divider={layout.divider} />
          </>
        ) : null}

        {chrome && !splitVisible && canSplit ? (
          <RestoreTab
            orientation={orientation}
            retainedPath={secondaryId === null ? null : secondarySnap.location.pathname}
            retainedLedger={secondaryId === null ? null : chosenLedger(secondaryId, secondarySnap.location.key)}
            onRestore={actions.restoreSecondary}
          />
        ) : null}

        {chrome && canSplit ? (
          <DropPreview orientation={orientation} area={area} splitVisible={splitVisible} canSplit={canSplit} ratio={state.ratio} />
        ) : null}
      </div>

      {chrome ? <ShellToast toast={toast} /> : null}
      {chrome && dragKey !== "idle" ? (
        <div ref={cancelRef} className="lv-drop-cancel" data-over={dragKey === "cancel" ? "true" : undefined} aria-hidden="true">
          <XIcon className="size-5" />
          <span>{dragKey === "cancel" ? t("workspace.drop.releaseCancel") : t("workspace.drop.cancel")}</span>
        </div>
      ) : null}
      {user !== null && (state.ledgers.w1 !== null || state.ledgers.w2 !== null || Object.keys(entryLedgers).length > 0) ? (
        <LedgerWatch onBooks={pruneLedgers} />
      ) : null}

      <ConfirmDialog
        open={pendingDiscard !== null}
        tone="danger"
        title={t("workspace.discard.title")}
        description={
          pendingDiscard?.kind === "reload"
            ? t("workspace.discard.reload")
            : pendingDiscard?.kind === "primary"
              ? t("workspace.discard.primary")
              : t("workspace.discard.secondary")
        }
        confirmLabel={t("workspace.discard.confirm")}
        cancelLabel={t("workspace.discard.cancel")}
        onCancel={() => {
          setPendingDiscard(null);
        }}
        onConfirm={() => {
          const pending = pendingDiscard;
          setPendingDiscard(null);
          pending?.run();
        }}
      />
    </div>
  );

  return (
    <WorkspaceActionsContext.Provider value={actions}>
      <WorkspaceViewContext.Provider value={view}>
        <PaneRouter history={primaryHistory}>{wrapChrome(shell)}</PaneRouter>
      </WorkspaceViewContext.Provider>
    </WorkspaceActionsContext.Provider>
  );
}

/**
 * 工作区查看的账本已经不在账本列表里（在别处退出、弃置、被移出）：那个工作区回到设备当前账本，
 * 而不是一直停在一本无权访问的账上。只按服务器刚给出的列表判断，离线 / 读取失败时不动。
 * 只在已登录、且确实有工作区在看外部账本时挂载。
 */
function LedgerWatch({ onBooks }: { readonly onBooks: (ids: ReadonlySet<string>) => void }): null {
  const books = useBooks();
  useEffect(() => {
    if (!books.isSuccess || books.isFetching) return;
    onBooks(new Set(books.data.books.map((book) => book.id)));
  }, [books.data, books.isFetching, books.isSuccess, onBooks]);
  return null;
}

/**
 * 一个工作区实例。`mode`：
 * - `contents`：手机外壳的主区——盒子不存在（`display: contents`），页面与以前完全一样；
 * - `box`：大屏工作区，绝对定位于区域内，是页面的容器（`container-name: lvpane`）与滚动容器；
 * - `hidden`：被收起 / 空间不足的实例，保持挂载与上次尺寸，不可见、不可聚焦。
 */
function Pane({
  history,
  info,
  rect,
  mode,
  exiting,
  label,
  ledger,
  foreign,
  drag,
  fab,
  register,
  children,
}: {
  readonly history: PaneHistory;
  readonly info: PaneInfo;
  readonly rect: Rect;
  readonly mode: "contents" | "box" | "hidden";
  readonly exiting: boolean;
  readonly label: string;
  /** 这个工作区当前页选的账本（`null` = 设备当前账本）。 */
  readonly ledger: string | null;
  /** 解析后的外部账本（与设备当前账本不同时才有值）：页面子树按它重新挂载，绝不复用另一本账的页面状态。 */
  readonly foreign: string | null;
  /** 「在指定工作区打开」拖动中：`target` = 指针正落在这个工作区上。 */
  readonly drag: "idle" | "other" | "target";
  /** 辅助区右下角的导航按钮。 */
  readonly fab: boolean;
  /** 外壳按真实矩形判断落点，需要拿到这个工作区的元素。 */
  readonly register: (element: HTMLElement | null) => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLElement | null>(null);
  const [sizes] = useState(() => new PaneSizeStore());
  const hidden = !info.visible && !exiting;
  const registerRef = useRef(register);
  registerRef.current = register;
  useLayoutEffect(() => {
    registerRef.current(ref.current);
    return () => {
      registerRef.current(null);
    };
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (mode === "contents") {
      const update = (): void => {
        sizes.set(window.innerWidth, window.innerHeight);
      };
      update();
      window.addEventListener("resize", update);
      return () => {
        window.removeEventListener("resize", update);
      };
    }
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      // 隐藏实例保持上次尺寸，不把 0 写给页面（页面据此重新排版会丢掉滚动位置）。
      if (entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      sizes.set(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [mode, sizes]);

  const memoInfo = useMemo(() => info, [info.instance, info.role, info.shell, info.nav, info.split, info.visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const style: React.CSSProperties | undefined =
    mode === "contents"
      ? undefined
      : {
          left: `${String(rect.x)}px`,
          top: `${String(rect.y)}px`,
          width: `${String(rect.w)}px`,
          height: `${String(rect.h)}px`,
        };

  return (
    <section
      ref={ref}
      className="lv-pane"
      data-mode={mode === "box" && hidden ? "hidden" : mode}
      data-role={info.role}
      data-instance={info.instance}
      data-exiting={exiting ? "true" : undefined}
      data-drop-target={drag === "target" ? "true" : undefined}
      aria-label={mode === "contents" ? undefined : label}
      aria-hidden={hidden ? true : undefined}
      inert={hidden}
      style={style}
    >
      <PaneContext.Provider value={memoInfo}>
        <PaneSizeContext.Provider value={sizes}>
          <PaneRouter history={history} nested>
            <ViewLedgerContext.Provider value={ledger}>
              {/* ⚠️ 换账本 = 页面重新挂载：筛选、缓存的选中项、未保存的表单都属于原来那本账，不能带进另一本。 */}
              <div key={foreign ?? "device"} className="lv-pane-scroll" data-ledger={foreign === null ? undefined : "foreign"}>
                {children}
              </div>
              {drag !== "idle" && mode === "box" && !hidden ? <PaneTag history={history} role={info.role} target={drag === "target"} /> : null}
              {fab && mode === "box" && !hidden ? <SecondaryFab history={history} /> : null}
            </ViewLedgerContext.Provider>
          </PaneRouter>
        </PaneSizeContext.Provider>
      </PaneContext.Provider>
    </section>
  );
}

/**
 * 拖动时盖在工作区上方的遮罩与中央的身份标签：「主工作区 · 明细」；指针落在这个工作区上时换成「在主工作区打开」。
 * 遮罩本身负责模糊下面的内容（`backdrop-filter`，见 workspace.css「在指定工作区打开」）：它是 `.lv-pane-scroll`
 * 的兄弟，拖动开始时只是加上它，不改动手指按着的那一行所在的滚动区（iPad 上改动它会打断这次触摸）。
 */
function PaneTag({ history, role, target }: { readonly history: PaneHistory; readonly role: "primary" | "secondary"; readonly target: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const snapshot = useSnapshot(history);
  const identity = usePaneIdentity(snapshot.location.pathname);
  const pane = role === "primary" ? t("workspace.pane.primary") : t("workspace.pane.secondary");
  const text = target
    ? role === "primary"
      ? t("workspace.drop.inPrimary")
      : t("workspace.drop.inSecondary")
    : t("workspace.pane.label", { pane, page: identity.title });
  return (
    <div className="lv-pane-tag" data-target={target ? "true" : undefined} aria-hidden="true">
      <span className="lv-tag" data-target={target ? "true" : undefined}>
        <span className="lv-tag-text">{text}</span>
      </span>
    </div>
  );
}
