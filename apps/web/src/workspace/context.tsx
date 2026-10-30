/**
 * **页面看得见的工作区信息**：我在哪个工作区、担任什么角色、实际有多大。
 *
 * ⚠️ **页面按自己所在工作区的实际尺寸响应，而不是按整个窗口。** 横屏 iPad 1024px 宽，扣除侧栏与分界线
 * 后两个工作区可能只有约 500 / 400px；`usePaneSize` 给的就是这两个数，CSS 侧对应的是工作区元素上的
 * 容器（`container-name: lvpane`）。不要在页面里用 `window.innerWidth` 判断布局。
 *
 * 没有外壳时（组件测试、静态渲染）给出手机主区的默认值，组件行为与 S18 之前完全一样。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

import type { FollowMode, InstanceId, WorkspaceState } from "./model.js";
import type { Orientation, ShellMode } from "./geometry.js";

export type PaneRole = "primary" | "secondary";
/** 这个工作区的主导航由谁提供：手机底部导航、大屏全局侧栏，或没有（辅助区）。 */
export type NavChrome = "bottom" | "rail" | "none";
export type PaneSplit = "none" | "row" | "column";
/** 按工作区实际宽度的粗分档（页面也可以直接读宽度或用容器查询）。 */
export type PaneSizeClass = "narrow" | "comfortable" | "expanded" | "wide";

export interface PaneInfo {
  readonly instance: InstanceId;
  readonly role: PaneRole;
  readonly shell: ShellMode;
  readonly nav: NavChrome;
  readonly split: PaneSplit;
  /** 当前是否显示（被收起 / 空间不足时为 `false`，内容仍保留）。 */
  readonly visible: boolean;
}

const DEFAULT_PANE: PaneInfo = {
  instance: "w1",
  role: "primary",
  shell: "phone",
  nav: "bottom",
  split: "none",
  visible: true,
};

export const PaneContext = createContext<PaneInfo>(DEFAULT_PANE);

export function usePane(): PaneInfo {
  return useContext(PaneContext);
}

// ---------------------------------------------------------------------------
// 尺寸：每个工作区一份小仓库，ResizeObserver 写入，订阅者按需重渲染。
// ---------------------------------------------------------------------------

export interface PaneSize {
  readonly width: number;
  readonly height: number;
}

export class PaneSizeStore {
  private value: PaneSize = { width: 0, height: 0 };
  private readonly listeners = new Set<() => void>();

  get = (): PaneSize => this.value;

  set(width: number, height: number): void {
    const next = { width: Math.round(width), height: Math.round(height) };
    if (next.width === this.value.width && next.height === this.value.height) return;
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

const FALLBACK_SIZE = new PaneSizeStore();

export const PaneSizeContext = createContext<PaneSizeStore | null>(null);

/**
 * 工作区的实际可用尺寸（CSS px）。手机外壳下没有工作区盒子，返回窗口尺寸——与那时页面实际可用的
 * 空间一致。
 */
export function usePaneSize(): PaneSize {
  const store = useContext(PaneSizeContext) ?? FALLBACK_SIZE;
  const size = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (size.width === 0 && typeof window !== "undefined" && store === FALLBACK_SIZE) {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return size;
}

export function sizeClassFor(width: number): PaneSizeClass {
  if (width < 480) return "narrow";
  if (width < 720) return "comfortable";
  if (width < 1040) return "expanded";
  return "wide";
}

// ---------------------------------------------------------------------------
// 外壳 API：页面只用其中几项（草稿登记、在辅助区打开、跟随选中项）。
// ---------------------------------------------------------------------------

/** 在指定工作区打开一页时附带的信息。 */
export interface OpenOptions {
  /**
   * 这一页属于哪本账（来源工作区实际查看的账本 id）。从主区拖一笔明细到辅助区时，辅助区要显示的是
   * **主区那本账**里的这一笔，而不是辅助区当前账本里同 id 的记录（并不存在）。省略 = 目标工作区自己的账本。
   */
  readonly ledger?: string | null;
}

/** 外壳的动作（引用稳定，不随状态变化而重建）。 */
export interface WorkspaceActions {
  openInSecondary(path: string, options?: OpenOptions): void;
  /** 在主工作区打开（不经过跟随拦截，辅助区不变）。 */
  openInPrimary(path: string, options?: OpenOptions): void;
  /**
   * 在某个工作区「进入」一本账（第二轮 · 账本隔离）。
   * - 辅助区：只换辅助区自己查看的账本，回到它的明细，主区不受影响；
   * - 主区：选的就是设备当前账本 → 回到明细；否则先把辅助区钉在它原来那本账上，再由 `reload`
   *   完成设备当前账本的切换（服务器激活 + 整页重新载入）。
   */
  enterLedger(instance: InstanceId, bookId: string, reload: () => void): void;
  /** 这个工作区（连同当前这一页）改回查看设备当前账本，停在原来的页面上。 */
  viewDeviceLedger(instance: InstanceId): void;
  /** 辅助区导航：只改辅助区，并切到独立模式。 */
  navigateSecondary(path: string): void;
  /** 页面的「返回」即将导航（可能是后退一步，也可能是打开声明的上级页）：外壳不把它当成用户主动打开新页面。 */
  markBack(instance: InstanceId): void;
  restoreSecondary(): void;
  closeSecondary(): void;
  setMode(mode: FollowMode): void;
  /** 页面登记 / 撤销「这个工作区有尚未保存的修改」。 */
  setDirty(instance: InstanceId, dirty: boolean): void;
}

/** 外壳的当前状态（变化时订阅者重渲染）。 */
export interface WorkspaceView {
  readonly state: WorkspaceState;
  readonly shell: ShellMode;
  readonly orientation: Orientation;
  /** 双区是否正在显示（打开 + 空间允许 + 外壳可见）。 */
  readonly splitVisible: boolean;
  /** 空间是否允许显示两个工作区（单区时决定能否新建辅助区）。 */
  readonly canSplit: boolean;
  /** 跟随模式下辅助区正在显示的路径（主区列表据此标出选中项）；否则 `null`。 */
  readonly followedPath: string | null;
}

export const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);
export const WorkspaceViewContext = createContext<WorkspaceView | null>(null);

export function useWorkspaceActions(): WorkspaceActions | null {
  return useContext(WorkspaceActionsContext);
}

export function useWorkspaceView(): WorkspaceView | null {
  return useContext(WorkspaceViewContext);
}

/**
 * 页面登记本工作区的未保存修改：辅助区开始编辑时自动切到独立模式，跟随导航也不会直接替换掉它。
 * 没有外壳时什么都不做。
 */
export function usePaneDirty(dirty: boolean): void {
  const actions = useContext(WorkspaceActionsContext);
  const { instance } = useContext(PaneContext);
  useEffect(() => {
    if (actions === null) return;
    actions.setDirty(instance, dirty);
  }, [actions, instance, dirty]);
  useEffect(() => {
    if (actions === null) return;
    return () => {
      actions.setDirty(instance, false);
    };
  }, [actions, instance]);
}

/**
 * 页面里「进入这本账」的工作区版本：大屏外壳下只影响本工作区（见 `WorkspaceActions.enterLedger`）；
 * 没有外壳时返回 `null`，页面走原来的整页切换。
 */
export function usePaneLedgerEntry(): ((bookId: string, reload: () => void) => void) | null {
  const actions = useContext(WorkspaceActionsContext);
  const { instance } = useContext(PaneContext);
  return useMemo(
    () => (actions === null ? null : (bookId: string, reload: () => void) => {
      actions.enterLedger(instance, bookId, reload);
    }),
    [actions, instance],
  );
}

/** 页面「返回」前调用（见 `WorkspaceActions.markBack`）；没有外壳时什么都不做。 */
export function useMarkBack(): () => void {
  const actions = useContext(WorkspaceActionsContext);
  const { instance } = useContext(PaneContext);
  return useCallback(() => {
    actions?.markBack(instance);
  }, [actions, instance]);
}

/** 主区列表要标出的「辅助区正在跟随显示的那一项」的路径。 */
export function useFollowedPath(): string | null {
  const view = useContext(WorkspaceViewContext);
  const pane = useContext(PaneContext);
  if (view === null || pane.role !== "primary") return null;
  return view.followedPath;
}
