import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useDialogFocus } from "../lib/dialogFocus.js";
import { useKeyboardInset } from "./entry/keyboardInset.js";

/**
 * **从底部升起的半屏面板 —— 一个负责「进 / 出」两层动画的外壳**（m06693）。
 *
 * 所有者对引用面板的要求很具体：*「像这样从下面弹出来的半屏弹窗，我希望他们都能够做到有从下往上展开，
 * 以及从上往下收回的入场和消失画面」*。所以进出动画不写在每个面板里，而是收在这里一份：
 *
 *  * **入场**用 `sheet-in`（260ms 出弦缓动），从屏幕下缘升上来；
 *  * **退场**用 `sheet-out`（200ms 加速），先播放完再真正调用 `onClose` 卸载，**不会在动画半路消失**；
 *  * 遮罩同进同出（`backdrop-in` / `backdrop-out`），点击遮罩或 Escape 都走同一条关闭路径。
 *
 * ⚠️ **动画时长与 CSS 是两份真相**：`SHEET_EXIT_MS` 必须与 `index.css` 里 `libellum-sheet-out` 的
 * 200ms 保持一致。改一处要改两处——多等 30ms 只是慢，少等则是「关到一半被拔掉」。
 *
 * ⚠️ **减少动态（`prefers-reduced-motion`）时整段动画由 CSS 关掉**（`index.css` 的媒体查询），
 * 但关闭仍然照常经过这里——`onClose` 的时机不受影响，只是没有位移可见。
 */
const SHEET_EXIT_MS = 200;

export function BottomSheet({
  label,
  onClose,
  dialogClassName = "",
  children,
}: {
  /** 无障碍名称：`role="dialog"` 没有可见标题时也必须有名字。 */
  readonly label: string;
  readonly onClose: () => void;
  /** 面板自己的高度/圆角等；动画与结构不在这里改。 */
  readonly dialogClassName?: string;
  /**
   * 面板内容。传函数时拿到 `close`（走同一段退场动画再卸载）；面板里的 × 按钮应当用它，
   * **不要直接调用 `onClose`**，否则面板会在动画开始的那一帧被拔掉。
   */
  readonly children: ReactNode | ((close: () => void) => ReactNode);
}): React.JSX.Element {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * ⚠️ **S18（审查 U04）：焦点进入面板、Tab 圈在面板里、关闭后回到打开它的控件。** 多层面板时只有最上面
   * 那一层响应 Esc——以前每一层都在 `window` 上听 Esc，按一次会把叠着的面板全部关掉。
   */
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const focus = useDialogFocus(dialogRef);
  /**
   * ⚠️ **S18（审查 U07）：软键盘弹出时面板整体抬到键盘之上。** 与记账页保存条同一套测量
   * （`visualViewport` 的可视区底边 vs 遮罩底边），面板高度同步减去被盖住的部分，输入框与按钮都还能看见。
   */
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const keyboard = useKeyboardInset(backdropRef);

  const requestClose = useCallback(() => {
    if (closing) return;

    setClosing(true);
    timer.current = setTimeout(onClose, SHEET_EXIT_MS);
  }, [closing, onClose]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && focus.owns(event)) {
        event.preventDefault();
        requestClose();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [focus, requestClose]);

  return (
    /**
     * ⚠️ **S18：高度单位是 `--lv-vh`**——手机上等于 `dvh`；大屏工作区里是工作区自己的高度，面板只盖住
     * 自己所在的工作区（`lv-sheet*` 按工作区宽度选择底部面板或居中对话框，见 `workspace.css`）。
     */
    <div
      ref={backdropRef}
      role="presentation"
      onClick={requestClose}
      style={keyboard > 0 ? { paddingBottom: keyboard } : undefined}
      className={`lv-sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-ink/45 sm:items-center ${
        closing ? "backdrop-out" : "backdrop-in"
      }`}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={keyboard > 0 ? { maxHeight: `calc(var(--lv-vh) * 88 - ${String(keyboard)}px)` } : undefined}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className={`lv-sheet flex max-h-[calc(var(--lv-vh)*88)] w-full max-w-md flex-col rounded-t-sheet bg-surface shadow-sheet outline-none ${
          closing ? "sheet-out" : "sheet-in"
        } sm:max-h-[calc(var(--lv-vh)*80)] sm:rounded-card ${dialogClassName}`}
      >
        {typeof children === "function" ? children(requestClose) : children}
      </div>
    </div>
  );
}
