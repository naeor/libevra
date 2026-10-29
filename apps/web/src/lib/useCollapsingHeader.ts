import { useLayoutEffect, useRef } from "react";
import { clamp01 } from "./transitionPhysics.js";
import { bindNativeHeaderScroll } from "./nativeHeaderScroll.js";

export function useCollapsingHeader() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const header = ref.current, content = header?.parentElement, scroller = content?.parentElement;
    if (!header || !content || !scroller) return;
    let range = 1;
    const oldMinHeight = content.style.minHeight;
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
      content.style.minHeight = `${scroller.clientHeight + range}px`;
      paint();
    };
    const controller = bindNativeHeaderScroll(scroller, () => range, paint);
    const observer = new ResizeObserver(measure);
    observer.observe(header); observer.observe(scroller); measure();
    return () => { controller.destroy(); observer.disconnect(); content.style.minHeight = oldMinHeight; };
  }, []);
  return ref;
}
