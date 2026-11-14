import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

import { createPortal } from "react-dom";
import { usePadModalLayer } from "../workspace/padOverlay.js";
import { useDialogFocus } from "../lib/dialogFocus.js";
import { useOverlayPresence, useOverlayScrollLock } from "../lib/useOverlayPresentation.js";
import { useKeyboardInset } from "./entry/keyboardInset.js";
import "./panel-template.css";

/**
 * **弹出面板模板 T3：中央确认 / 选择对话框的共同外壳**（1.19.58）。
 *
 * `ConfirmDialog`（是 / 否，`alertdialog`）与 `ChoiceDialog`（几个去向，`dialog`）原来各写一份几乎相同的外壳；
 * 现在共用这一份，各自只决定按钮与焦点：
 *
 *  * **按钮区固定在底部、不在滚动区里**：长说明、附加字段、横屏低高度或系统字体放大时，标题与说明在框内滚动，
 *    确认 / 取消始终看得见、点得到（S18 审查 U05 的要求，现在按钮不会被一起滚走）；
 *  * **焦点**统一走 `useDialogFocus`（焦点进入、Tab 圈在框内、关闭后回到原控件、多层时只有最上面一层响应
 *    Esc 与 Tab），不再各自另写一份 Tab 圈；打开时把焦点放到调用方指定的按钮（确认框是安全选项）；
 *  * **遮罩**是模板的对话框档（浅色 Original .35、深色统一黑色、浅色 S19 用 `--s19-scrim`），
 *    **不再有 2px 背景模糊**（所有者 2026-11-14 决定）；
 *  * 进出仍是 `useOverlayPresence` + 淡入淡出，不套第二层 Presence（规格 §5）。
 */
export function CenterDialog({
  open,
  appWide = false,
  role,
  title,
  description,
  onDismiss,
  initialFocusRef,
  actions,
  children,
}: {
  readonly open: boolean;
  readonly appWide?: boolean;
  readonly role: "dialog" | "alertdialog";
  readonly title: string;
  readonly description?: string | undefined;
  /** Esc 与点遮罩做什么；不传则两者都不关闭。 */
  readonly onDismiss?: (() => void) | undefined;
  /** 打开时获得焦点的控件（只在打开那一刻聚焦一次）。 */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /** 固定在底部的按钮区。 */
  readonly actions: ReactNode;
  /** 说明之后、按钮之前的内容（后果列表、附加输入框），在滚动区里。 */
  readonly children?: ReactNode;
}): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const { visible, closing } = useOverlayPresence(open);
  const portal = usePadModalLayer(appWide && visible);
  useOverlayScrollLock(backdropRef, visible);
  const keyboard = useKeyboardInset(backdropRef, visible);
  /** 与底部面板共用一个层级栈：叠在面板上的对话框按 Esc 只关自己，关闭后焦点回到原控件。 */
  const layer = useDialogFocus(dialogRef, visible);
  /** S18：大屏上两个工作区可能同时开着对话框，标题 / 说明的 id 每个实例唯一。 */
  const titleId = useId();
  const descriptionId = useId();

  /**
   * ⚠️ **回调放进 ref，焦点只在打开那一刻设置一次。** 调用方的 `onCancel` 通常是内联箭头函数，父组件每次
   * 重渲染都是新函数；如果焦点与按键监听写在同一个依赖它的 effect 里，在框里的输入框打一个字就会把焦点
   * 拉回“取消”，输入框永远只能留下一个字（1.13.02 的教训）。
   */
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    initialFocusRef?.current?.focus();
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // 共用层级栈：已被更上层处理过的按键、另一个工作区里的按键，这里都不再处理。
      if (event.key !== "Escape" || !layer.owns(event)) return;
      const dismiss = dismissRef.current;
      if (dismiss === undefined) return;
      event.preventDefault();
      dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, layer]);

  if (!visible) return null;

  const content = (
    <div
      ref={backdropRef}
      data-overlay-root="dialog"
      data-overlay-state={closing ? "closing" : "open"}
      data-overlay-scrim="dialog"
      role="presentation"
      style={{ paddingBottom: `calc(${String(keyboard + 16)}px + env(safe-area-inset-bottom, 0px))`, paddingTop: "max(16px, env(safe-area-inset-top, 0px))" }}
      className="fixed inset-0 z-50 flex items-center justify-center px-5 py-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismissRef.current?.();
      }}
    >
      <div
        ref={dialogRef}
        data-overlay-surface="dialog"
        data-overlay-state={closing ? "closing" : "open"}
        inert={closing}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="relative z-0 flex max-h-full w-full max-w-sm flex-col rounded-card border border-line bg-surface shadow-lg outline-none"
      >
        <div data-dialog-body className="min-h-0 overflow-y-auto overscroll-contain px-6 pt-6 pb-1">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-2 text-body-relaxed text-muted">
              {description}
            </p>
          ) : null}
          {children}
        </div>
        <div data-dialog-actions className="shrink-0 px-6 pt-5 pb-6">
          {actions}
        </div>
      </div>
    </div>
  );
  return portal ? createPortal(content, portal) : content;
}
