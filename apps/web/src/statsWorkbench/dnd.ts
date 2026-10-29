/**
 * 编辑态的拖放手势（只负责「手指/鼠标在哪」，**合法与否由 D 的几何校验回答**）。
 *
 * 手机端的手势冲突按交互补充 §6 的建议处理：
 * - **鼠标**：按下后移动超过 5px 才开始拖动，单击照常是单击；
 * - **触摸**：必须**长按约 0.3 秒**才开始拖动；手指先动就当作滚动（页面纵滚、抽屉滚动优先），
 *   浏览器接管滚动时会发 `pointercancel`，长按计时随之取消；
 * - 拖动开始后，用非被动的 `touchmove` 监听阻止页面跟着滚，靠近上下边缘时自动滚动；
 * - 拖动结束后紧跟的那次 click 被吞掉，避免「放下的同时又打开了菜单」。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { GridSize } from "@libellum/shared/analysis/layout";

import type { LayoutObjectChoice } from "./catalog.js";

export type DragPayload =
  | {
      readonly kind: "object";
      readonly objectId: string;
      readonly size: GridSize;
      /** 按下点相对对象左上角的格子偏移，让对象「跟着手指」而不是跳到指针处。 */
      readonly grab: { readonly row: number; readonly col: number };
      readonly label: string;
    }
  | { readonly kind: "new-card"; readonly analysisId: string; readonly size: GridSize; readonly label: string }
  | { readonly kind: "new-layout"; readonly choice: LayoutObjectChoice; readonly size: GridSize; readonly label: string };

export interface DragState {
  readonly payload: DragPayload;
  readonly x: number;
  readonly y: number;
}

const MOUSE_THRESHOLD = 5;
const TOUCH_SLOP = 8;
const LONG_PRESS_MS = 300;
const EDGE = 64;

export interface DragController {
  readonly cancel: () => void;
  readonly drag: DragState | null;
  /** 给可拖对象的指针事件。`payload` 在开始拖动时才取，可以读最新状态。 */
  readonly sourceProps: (payload: (event: { clientX: number; clientY: number }) => DragPayload | null) => {
    readonly onPointerDown: (event: React.PointerEvent) => void;
    readonly onContextMenu: (event: React.MouseEvent) => void;
  };
  /** 拖动刚结束时吞掉随后的 click；返回 `true` 表示这次 click 应该忽略。 */
  readonly consumeClick: () => boolean;
}

export function useDragController({
  onStart,
  onMove,
  onDrop,
  onCancel,
  scrollRef,
}: {
  readonly onStart?: (payload: DragPayload) => void;
  readonly onMove?: (state: DragState) => void;
  readonly onDrop: (state: DragState) => void;
  readonly onCancel?: () => void;
  readonly scrollRef: React.RefObject<HTMLElement | null>;
}): DragController {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressUntil = useRef(0);
  const cleanup = useRef<(() => void) | null>(null);
  const handlers = useRef({ onStart, onMove, onDrop, onCancel });
  handlers.current = { onStart, onMove, onDrop, onCancel };

  useEffect(() => () => cleanup.current?.(), []);

  const sourceProps = useCallback<DragController["sourceProps"]>(
    (payloadFor) => ({
      onContextMenu: (event) => {
        // 长按不弹系统菜单（iOS / Android 的长按菜单会打断拖动）；编辑态的对象没有右键菜单可失去。
        event.preventDefault();
      },
      onPointerDown: (event) => {
        if (event.button !== 0 || cleanup.current !== null) return;
        const pointerId = event.pointerId;
        const touch = event.pointerType !== "mouse";
        const start = { x: event.clientX, y: event.clientY };
        const source = event.currentTarget;
        if (touch) source.classList.add("sw-press-pending");
        let active = false;
        let last = { x: event.clientX, y: event.clientY };
        let timer: ReturnType<typeof setTimeout> | null = null;
        let frame = 0;

        const preventScroll = (touchEvent: TouchEvent) => {
          if (active) touchEvent.preventDefault();
        };

        const autoScroll = () => {
          const scroller = scrollRef.current;
          if (!active || scroller === null) return;
          const rect = scroller.getBoundingClientRect();
          const previousTop = scroller.scrollTop;
          if (last.y < rect.top + EDGE) scroller.scrollTop -= Math.ceil((rect.top + EDGE - last.y) / 6);
          else if (last.y > rect.bottom - EDGE && last.y < rect.bottom + EDGE) scroller.scrollTop += Math.ceil((last.y - (rect.bottom - EDGE)) / 6);
          if (scroller.scrollTop !== previousTop && dragRef.current !== null) handlers.current.onMove?.(dragRef.current);
          frame = requestAnimationFrame(autoScroll);
        };

        const begin = () => {
          source.classList.remove("sw-press-pending");
          const payload = payloadFor({ clientX: start.x, clientY: start.y });
          if (payload === null) return finish();
          active = true;
          const state = { payload, x: last.x, y: last.y };
          dragRef.current = state;
          setDrag(state);
          handlers.current.onStart?.(payload);
          handlers.current.onMove?.(state);
          if (touch && typeof navigator.vibrate === "function") navigator.vibrate(8);
          frame = requestAnimationFrame(autoScroll);
        };

        const move = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== pointerId) return;
          last = { x: moveEvent.clientX, y: moveEvent.clientY };
          const distance = Math.hypot(last.x - start.x, last.y - start.y);
          if (!active) {
            if (touch) {
              if (distance > TOUCH_SLOP) finish();
            } else if (distance > MOUSE_THRESHOLD) {
              begin();
            }
            return;
          }
          moveEvent.preventDefault();
          const current = dragRef.current;
          if (current === null) return;
          const next = { ...current, x: last.x, y: last.y };
          dragRef.current = next;
          setDrag(next);
          handlers.current.onMove?.(next);
        };

        const up = (upEvent: PointerEvent) => {
          if (upEvent.pointerId !== pointerId) return;
          const state = dragRef.current;
          if (active && state !== null) {
            suppressUntil.current = Date.now() + 450;
            handlers.current.onDrop({ ...state, x: upEvent.clientX, y: upEvent.clientY });
          }
          finish();
        };

        const cancel = (cancelEvent: PointerEvent) => {
          if (cancelEvent.pointerId !== pointerId) return;
          if (active) {
            suppressUntil.current = Date.now() + 450;
            handlers.current.onCancel?.();
          }
          finish();
        };

        const keydown = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key === "Escape" && active) {
            suppressUntil.current = Date.now() + 450;
            handlers.current.onCancel?.();
            finish();
          }
        };

        function finish(): void {
          source.classList.remove("sw-press-pending");
          if (timer !== null) clearTimeout(timer);
          cancelAnimationFrame(frame);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", cancel);
          window.removeEventListener("keydown", keydown);
          document.removeEventListener("touchmove", preventScroll);
          active = false;
          dragRef.current = null;
          cleanup.current = null;
          setDrag(null);
        }

        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("keydown", keydown);
        document.addEventListener("touchmove", preventScroll, { passive: false });
        cleanup.current = finish;
        if (touch) timer = setTimeout(begin, LONG_PRESS_MS);
      },
    }),
    [scrollRef],
  );

  const consumeClick = useCallback(() => Date.now() < suppressUntil.current, []);

  const cancel = useCallback(() => {
    if (dragRef.current) handlers.current.onCancel?.();
    cleanup.current?.();
  }, []);
  return { drag, sourceProps, consumeClick, cancel };
}

/** 指针 → 网格格子（1 起）；在网格外返回 `null`。 */
export function cellAt(
  grid: HTMLElement,
  columns: number,
  x: number,
  y: number,
): { readonly row: number; readonly col: number } | null {
  const rect = grid.getBoundingClientRect();
  const style = getComputedStyle(grid);
  const gap = Number.parseFloat(style.columnGap) || 0;
  // 行高取实际排版结果（第一行轨道的 px），不读 CSS 变量本身（那是 rem）。
  const firstTrack = style.gridTemplateRows.split(" ")[0] ?? "";
  const rowHeight = firstTrack.endsWith("px") ? Number.parseFloat(firstTrack) : 116;
  if (x < rect.left - gap || x > rect.right + gap || y < rect.top - gap) return null;
  const colWidth = (rect.width - gap * (columns - 1)) / columns;
  const col = Math.min(columns, Math.max(1, Math.floor((x - rect.left + gap / 2) / (colWidth + gap)) + 1));
  const row = Math.max(1, Math.floor((y - rect.top + gap / 2) / (rowHeight + gap)) + 1);
  if (y > rect.bottom + rowHeight) return null;
  return { row, col };
}
