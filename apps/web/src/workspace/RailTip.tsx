/**
 * 紧凑侧栏只有图标：名字靠这里的提示显示给看得见的用户（读屏名一直在按钮里，不靠提示）。
 *
 * 以前用 `title`：键盘聚焦时看不到，出现时机由浏览器决定。现在按项目 skill `libevra-desktop-ui`
 * 的提示规则（WCAG 1.4.13）：
 *
 * - 鼠标停住约 400ms 出现；刚关掉一个提示的 300ms 内移到相邻图标，立即出现（逐个看图标不用每次等）；
 * - 键盘聚焦（`:focus-visible`）立即出现，鼠标点击产生的焦点不出现；触摸不出现；
 * - 离开后留 100ms 宽限，指针可以移到提示上；Esc、按下、滚动、窗口变化都收起；不自动定时消失。
 *
 * ⚠️ 侧栏 `overflow: hidden`，所以提示放到 `document.body` 里用 `position: fixed` 定位，不会被裁掉。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const TIP_DELAY_MS = 400;
export const TIP_SKIP_MS = 300;
export const TIP_GRACE_MS = 100;

/** 指针停住多久后出现：上一个提示刚收起（`TIP_SKIP_MS` 内）时为 0。 */
export function tipDelay(now: number, lastHiddenAt: number): number {
  return now - lastHiddenAt <= TIP_SKIP_MS ? 0 : TIP_DELAY_MS;
}

/** 全侧栏共用：最近一次有提示收起的时间。 */
let lastHiddenAt = Number.NEGATIVE_INFINITY;

interface Anchor {
  readonly left: number;
  readonly top: number;
}

function keyboardFocused(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

export interface RailTipBinding {
  readonly onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerLeave: () => void;
  readonly onPointerDownCapture: () => void;
  readonly onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  readonly onBlur: () => void;
}

export function useRailTip(label: string, enabled: boolean): { readonly bind: RailTipBinding; readonly tip: React.ReactNode } {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const shown = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const hide = useCallback((): void => {
    clear();
    if (shown.current) lastHiddenAt = Date.now();
    shown.current = false;
    setAnchor(null);
  }, [clear]);
  const show = useCallback((element: HTMLElement): void => {
    clear();
    const box = element.getBoundingClientRect();
    shown.current = true;
    setAnchor({ left: box.right + 8, top: box.top + box.height / 2 });
  }, [clear]);

  useEffect(() => {
    if (!enabled) hide();
  }, [enabled, hide]);
  useEffect(() => clear, [clear]);
  useEffect(() => {
    if (anchor === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [anchor, hide]);

  const bind: RailTipBinding = {
    onPointerEnter: (event) => {
      if (!enabled || event.pointerType === "touch") return;
      const element = event.currentTarget;
      const delay = tipDelay(Date.now(), lastHiddenAt);
      clear();
      if (delay === 0) show(element);
      else timer.current = setTimeout(() => show(element), delay);
    },
    onPointerLeave: () => {
      clear();
      timer.current = setTimeout(hide, TIP_GRACE_MS);
    },
    onPointerDownCapture: hide,
    onFocus: (event) => {
      if (enabled && keyboardFocused(event.currentTarget)) show(event.currentTarget);
    },
    onBlur: hide,
  };

  const tip = enabled && anchor !== null
    ? createPortal(
        <span
          className="lv-rail-tip rounded-md bg-ink px-2 py-1 text-xs text-surface shadow-md"
          style={{ left: anchor.left, top: anchor.top }}
          aria-hidden="true"
          onPointerEnter={clear}
          onPointerLeave={hide}
        >
          {label}
        </span>,
        document.body,
      )
    : null;

  return { bind, tip };
}
