import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { UNSAFE_LocationContext } from "react-router";

import { PaneSizeContext, type PaneSizeStore } from "./context.js";
import type { InstanceId } from "./model.js";
import type { PaneEntry, PaneHistory } from "./paneHistory.js";
import type { TemporaryContent } from "./temporaryGeometry.js";

export interface TemporaryTask {
  readonly id: symbol;
  readonly instance: InstanceId;
  readonly origin: PaneEntry;
  readonly owner: string | null;
  readonly book: string | null;
  readonly kind: TemporaryContent;
  readonly detailPath?: string;
  readonly existingForward?: ReadonlySet<string>;
  /** 复用发起面板原有保存中 / 放弃保护。 */
  readonly protected: () => boolean;
  readonly invalidate?: () => void;
  readonly close: (after?: () => void) => void;
}

/** 全外壳一份、仅内存的附属任务，既不序列化，也不接管浏览器历史。 */
export class TemporaryTasks {
  private active: TemporaryTask | null = null;
  private listeners = new Set<() => void>();
  read = () => this.active;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  acquire(task: TemporaryTask): boolean {
    if (this.active !== null) return false;
    this.active = task;
    this.listeners.forEach(listener => listener());
    return true;
  }
  release(id: symbol): void {
    if (this.active?.id !== id) return;
    this.active = null;
    this.listeners.forEach(listener => listener());
  }
  leave(instance: InstanceId, run: () => void): void {
    if (this.active?.instance === instance) this.active.close(run);
    else run();
  }
}

export interface TemporaryHost {
  readonly instance: InstanceId;
  readonly owner: string | null;
  readonly book: string | null;
  readonly history: PaneHistory;
  readonly tasks: TemporaryTasks;
  readonly slot: RefObject<HTMLElement | null>;
  readonly sizes: PaneSizeStore;
  readonly width: (kind: TemporaryContent, open: boolean) => number;
  readonly isCurrent: (task: TemporaryTask) => boolean;
  readonly guardHost: (run: () => void, cancel?: () => void) => void;
  readonly expired: () => void;
  readonly openDetail: (path: string) => boolean;
}

export const TemporaryHostContext = createContext<TemporaryHost | null>(null);
export const InsideTemporary = createContext(false);
export const useTemporaryHost = () => useContext(TemporaryHostContext);
export const useInsideTemporary = () => useContext(InsideTemporary);
export const useTemporaryTask = (store: TemporaryTasks) => useSyncExternalStore(store.subscribe, store.read, store.read);

/** 任务期间保持来源页的 React 实例。跳到其他页面时仅隐藏它，portal 中的面板仍可操作；
 * 返回原记录直接恢复原 DOM。关闭任务时已经显示的新页继续使用自己的实例。 */
export function PanePages({ task, children, inert, foreign, scrollRef }: {
  readonly task: TemporaryTask | null;
  readonly children: React.ReactNode;
  readonly inert: boolean;
  readonly foreign: boolean;
  readonly scrollRef: (node: HTMLDivElement | null) => void;
}): React.JSX.Element {
  const route = useContext(UNSAFE_LocationContext);
  const pages = useRef({ current: 0, pinned: null as { id: symbol; index: number; route: typeof route } | null });
  const state = pages.current;
  if (task === null || task.kind === "detail") state.pinned = null;
  else if (state.pinned?.id !== task.id && route.location.key === task.origin.key) {
    state.pinned = { id: task.id, index: state.current, route };
  }
  const pin = state.pinned;
  if (pin !== null) state.current = route.location.key === pin.route.location.key ? pin.index : 1 - pin.index;
  const indexes = pin !== null && pin.index !== state.current ? [pin.index, state.current] : [state.current];
  return <>{indexes.map(index => {
    const hidden = index !== state.current;
    return <div key={index} ref={hidden ? undefined : scrollRef} className={hidden ? "lv-temporary-source" : "lv-pane-scroll"}
      data-ledger={foreign ? "foreign" : undefined} hidden={hidden} inert={inert || hidden}>
      <UNSAFE_LocationContext.Provider value={hidden && pin !== null ? pin.route : route}>{children}</UNSAFE_LocationContext.Provider>
    </div>;
  })}</>;
}

export function useTemporarySheet(kind: TemporaryContent, eligible: boolean, handlers: {
  protected: () => boolean;
  invalidate: () => void;
  close: (after?: () => void) => void;
}) {
  const host = useTemporaryHost();
  const latest = useRef(handlers);
  latest.current = handlers;
  const [claimed, setClaimed] = useState<TemporaryTask | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  useLayoutEffect(() => {
    const h = hostRef.current;
    if (!eligible || !h?.slot.current || h.width(kind, false) === 0 || h.owner === null || h.book === null) return;
    const task: TemporaryTask = { id: Symbol("sheet"), instance: h.instance, owner: h.owner, book: h.book,
      origin: h.history.location, existingForward: h.history.forwardKeys(), kind, protected: () => latest.current.protected(), close: after => latest.current.close(after),
      invalidate: () => latest.current.invalidate() };
    if (!h.tasks.acquire(task)) return;
    const trigger = document.activeElement;
    setClaimed(task);
    return () => {
      const focused = document.activeElement;
      h.tasks.release(task.id);
      if (trigger instanceof HTMLElement && trigger.isConnected && !trigger.closest("[hidden], [inert]")
        && (focused === document.body || h.slot.current?.contains(focused))) trigger.focus({ preventScroll: true });
    };
  }, [kind, eligible]);
  const owned = claimed !== null && host?.tasks.read()?.id === claimed.id;
  const openingInHost = eligible && !claimed && host !== null && host.slot.current !== null
    && host.owner !== null && host.book !== null && host.tasks.read() === null && host.width(kind, false) > 0;
  return { host, task: owned ? claimed : null, openingInHost, split: owned && host.width(kind, true) > 0 };
}

/** 屏幕上的表单在宿主导航后仍使用冻结来源页绑定的同步筛选设置。 */
export function TemporaryContents({ host, children }: { readonly host: TemporaryHost; readonly children: React.ReactNode }) {
  return <InsideTemporary.Provider value><PaneSizeContext.Provider value={host.sizes}>{children}</PaneSizeContext.Provider></InsideTemporary.Provider>;
}
