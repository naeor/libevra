import { useEffect, useState, type RefObject } from "react";

/**
 * 软键盘把滚动视口底部盖住了多少像素。
 *
 * ⚠️ **为什么需要它。** `TabPage` 用 `h-dvh` 把页面高度锁在动态视口上，这在「地址栏伸缩」
 * 的场景里是对的；但**软键盘不是浏览器工具栏**。iOS Safari 与新版 Android Chrome 默认只缩
 * *visual viewport*，`dvh` 与布局视口并不跟着变，于是任何 `sticky bottom-0` 的行动条都会
 * 停在键盘后面——打字时看不见，也点不到。
 *
 * 计算方式不是猜键盘高度，而是量出来的：
 *
 * ```
 * 行动条底边（相对滚动容器）= 滚动容器底边 − 可视区底边 − 间隙
 * ```
 *
 * `visualViewport.offsetTop + height` 是可视区底边在**布局视口**坐标里的位置，
 * `scrollportBottom` 也是布局视口坐标，所以两者相减就是「被键盘盖住的高度」，
 * 再减去底部导航本身占掉的那一段（滚动区在导航之上结束）。这样既不会多抬一个导航高度，
 * 也不会在地址栏伸缩时误判（没有键盘时结果是负数，取 0）。
 *
 * 只读不写 DOM，也不监听 scroll 容器本身：滚动页面不会改变键盘位置。
 */
export const KEYBOARD_GAP = 8;

export function keyboardOffset(
  scrollportBottom: number,
  visualViewportTop: number,
  visualViewportHeight: number,
): number {
  const keyboardTop = visualViewportTop + visualViewportHeight;
  const offset = scrollportBottom - keyboardTop - KEYBOARD_GAP;

  return offset > 0 ? Math.round(offset) : 0;
}

/**
 * 给底部的固定行动条用：返回它应当额外抬起的像素数。
 *
 * 没有 `visualViewport`（老浏览器）或没有滚动容器时保持 0，页面行为与以前完全一致。
 * 缩放（双指放大）期间也不抬：那时可视区变小不是键盘造成的，抬起只会让按钮乱跳。
 */
export function useKeyboardInset(scrollRef: RefObject<HTMLDivElement | null>): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    const scrollport = scrollRef.current;

    if (!viewport || !scrollport) return;

    let frame = 0;

    const update = (): void => {
      frame = 0;

      if (viewport.scale > 1.01) {
        setInset(0);
        return;
      }

      const rect = scrollport.getBoundingClientRect();

      setInset(keyboardOffset(rect.bottom, viewport.offsetTop, viewport.height));
    };

    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);

    // 顶部横幅出现/消失会改变滚动区底边；尺寸变化时也要重算。
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(scrollport);

    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();

      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [scrollRef]);

  return inset;
}
