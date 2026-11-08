import { useLayoutEffect, useRef } from "react";
import { clamp01 } from "./transitionPhysics.js";
import { bindNativeHeaderScroll, scrollContentHeight } from "./nativeHeaderScroll.js";

/** 返回恢复在快照前完成；不等待异步 scroll 事件才更新标题位置。 */
export const RESTORE_HEADER_SCROLL = "libevra:restore-header-scroll";

export function useCollapsingHeader() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const header = ref.current, content = header?.parentElement, scroller = content?.parentElement;
    if (!header || !content || !scroller) return;
    let range = 1;
    const extra = header.querySelector<HTMLElement>("[data-header-extra]");
    const paint = () => {
      const p = clamp01(scroller.scrollTop / range);
      header.style.setProperty("--header-p", String(p));
      header.dataset.collapsed = String(p >= 0.999);
      if (extra) extra.inert = p >= 0.999;
    };
    const measure = () => {
      const safe = Number.parseFloat(getComputedStyle(header).getPropertyValue("--header-safe")) || 0;
      range = Math.max(1, header.offsetHeight - 64 - safe);
      header.style.setProperty("--header-range", `${range}px`);
      content.style.minHeight = `${scrollContentHeight(scroller) + range}px`;
      paint();
    };
    const controller = bindNativeHeaderScroll(scroller, () => range, paint);
    const restored = (event: Event) => {
      controller.cancel(); measure();
      // 底栏可能刚完成测量。先更新可滚动高度，再写目标，避免按旧高度钳制。
      const top = (event as CustomEvent<number>).detail;
      if (typeof top === "number" && Number.isFinite(top)) { scroller.scrollTop = top; paint(); }
    };
    scroller.addEventListener(RESTORE_HEADER_SCROLL, restored);
    const observer = new ResizeObserver(measure);
    observer.observe(header); observer.observe(scroller); measure();
    return () => {
      scroller.removeEventListener(RESTORE_HEADER_SCROLL, restored); controller.destroy(); observer.disconnect();
      // 行程随整个页面 DOM 一起移除。StrictMode 会在仍挂载的页面上清理再订阅；
      // 此时撤掉 minHeight 会钳制刚恢复的 scrollTop，下一次测量也无法找回位置。
    };
  }, []);
  return ref;
}
