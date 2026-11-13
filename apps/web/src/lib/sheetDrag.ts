/**
 * **底部面板的下拉关闭**（弹出面板模板，1.19.58）。
 *
 * 原来只有账本选择与账本管理两块面板各写了一份触摸处理；现在收进模板，所有可下拉的底部面板共用。
 *
 * - **只从拖动条与标题区起手**（调用方把 `bind` 挂在这两处）：内容区照常滚动，不和列表滚动抢手势；
 * - **跟手**：拖动中的位移直接写到面板的 `transform` 上，不经过 React 渲染（大面板每帧重渲染会掉帧）；
 * - **松手判断**：拉过 `dismissPx`，或向下快速一甩（速度过 `flickVelocity` 且至少 `flickMinPx`）就关闭；
 *   否则弹回原位（`s19/overlays.css` 的 180ms 过渡）。向上拉不会把面板提离下缘。
 * - **关闭被拒绝时弹回**：有改动要先询问、或正在保存不允许关闭时，`onDismiss` 返回 false，面板回到原位。
 *
 * 关闭动画从当前位移接着向下（`--overlay-drag` + `lv-overlay-drag-out`），不会先跳回原位再滑出。
 */
import { useCallback, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export const SHEET_DRAG = {
  /** 松手时位移超过它就关闭（与原来两块面板相同）。 */
  dismissPx: 90,
  /** 快速下甩：px/ms。 */
  flickVelocity: 0.65,
  /** 快速下甩至少要拉动的距离，避免手指一抖就关。 */
  flickMinPx: 32,
  /** 起手判定：移动超过它才算拖动，轻点标题区的按钮仍是点击。 */
  slopPx: 6,
} as const;

/** 松手时该不该关闭。纯函数，便于测试。 */
export function dragDismisses(offset: number, velocity: number): boolean {
  if (offset >= SHEET_DRAG.dismissPx) return true;
  return offset >= SHEET_DRAG.flickMinPx && velocity >= SHEET_DRAG.flickVelocity;
}

/** 挂在拖动条 / 标题区上的指针事件。 */
export interface SheetDragZone {
  readonly "data-overlay-drag": true;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

interface Gesture {
  readonly id: number;
  readonly startY: number;
  lastY: number;
  lastT: number;
  velocity: number;
  active: boolean;
}

function place(panel: HTMLElement, offset: number): void {
  panel.dataset.overlayEntered = "true";
  panel.dataset.overlayDragging = "true";
  panel.style.setProperty("--overlay-drag", `${String(offset)}px`);
  panel.style.transform = `translateY(${String(offset)}px)`;
}

function release(panel: HTMLElement): void {
  delete panel.dataset.overlayDragging;
  panel.style.removeProperty("--overlay-drag");
  panel.style.transform = "";
}

/**
 * @param panelRef 面板元素（`data-overlay-surface`）。
 * @param enabled  可下拉：门禁面板、正在关闭时为 false。
 * @param onDismiss 松手判定为关闭时调用；返回 false 表示这次关闭被拒绝（要询问或正在保存），面板弹回。
 */
export function useSheetDrag(
  panelRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onDismiss: () => boolean,
): SheetDragZone | null {
  const gesture = useRef<Gesture | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const end = useCallback((event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const current = gesture.current;
    if (current === null || current.id !== event.pointerId) return;
    gesture.current = null;
    const panel = panelRef.current;
    if (!current.active || panel === null) return;
    const offset = Math.max(0, event.clientY - current.startY);
    if (!cancelled && dragDismisses(offset, current.velocity) && dismissRef.current()) {
      // 保留位移：关闭动画从这里接着向下。
      place(panel, offset);
      return;
    }
    release(panel);
  }, [panelRef]);

  const zone = useMemo<SheetDragZone>(() => ({
    "data-overlay-drag": true,
    onPointerDown(event) {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      gesture.current = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0, active: false };
    },
    onPointerMove(event) {
      const current = gesture.current;
      const panel = panelRef.current;
      if (current === null || current.id !== event.pointerId || panel === null) return;
      const dy = event.clientY - current.startY;
      if (!current.active) {
        if (dy <= -SHEET_DRAG.slopPx) { gesture.current = null; return; }
        if (dy < SHEET_DRAG.slopPx) return;
        current.active = true;
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 指针已经离开：照常按移动处理 */ }
      }
      const dt = event.timeStamp - current.lastT;
      if (dt > 0) current.velocity = (event.clientY - current.lastY) / dt;
      current.lastY = event.clientY;
      current.lastT = event.timeStamp;
      // 向上拉不提离下缘。
      place(panel, Math.max(0, dy));
    },
    onPointerUp(event) { end(event, false); },
    onPointerCancel(event) { end(event, true); },
  }), [end, panelRef]);

  return enabled ? zone : null;
}
