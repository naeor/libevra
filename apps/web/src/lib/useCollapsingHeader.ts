import { useLayoutEffect, useRef } from "react";
import { clamp01, decideTarget, hasSettled, springStep } from "./transitionPhysics.js";

/** 原生滚动决定进度；松手复用明细页的吸附判定、限速弹簧，每帧只写 DOM。 */
export function useCollapsingHeader() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const header = ref.current;
    const content = header?.parentElement;
    const scroller = content?.parentElement;
    if (!header || !content || !scroller) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let range = 1, frame = 0, idle = 0;
    let touching = false, dragging = false;
    let startY = 0, startX = 0, started = 0, flick = 0, lastY = 0;
    const oldMinHeight = content.style.minHeight;
    const extra = header.querySelector<HTMLElement>("[data-header-extra]");
    const paint = () => {
      const p = clamp01(scroller.scrollTop / range);
      header.style.setProperty("--header-p", String(p));
      header.dataset.collapsed = String(p >= 0.999);
      if (extra) extra.inert = p >= 0.999;
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(idle);
    };
    const snap = (speed = 0) => {
      if (touching || frame || scroller.scrollTop <= 0 || scroller.scrollTop >= range) return;
      const target = decideTarget(scroller.scrollTop / range, speed);
      if (media.matches) {
        scroller.scrollTop = target * range;
        paint();
        return;
      }
      let p = scroller.scrollTop / range;
      let velocity = 0; // 不把末帧手指速度带进弹簧，避免反向启动。
      let previous = performance.now();
      const tick = (now: number) => {
        const next = springStep(p, velocity, target, Math.min((now - previous) / 1000, 1 / 30));
        previous = now;
        p = target === 1 ? Math.max(p, clamp01(next.progress)) : Math.min(p, clamp01(next.progress));
        velocity = next.velocity;
        const done = hasSettled(p, velocity, target);
        scroller.scrollTop = (done ? target : p) * range;
        paint();
        frame = done ? 0 : requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    const measure = () => {
      const safe = Number.parseFloat(getComputedStyle(header).getPropertyValue("--header-safe")) || 0;
      range = Math.max(1, header.offsetHeight - 64 - safe);
      header.style.setProperty("--header-range", `${range}px`);
      // 短页面也保留足够真实滚动距离。
      content.style.minHeight = `${scroller.clientHeight + range}px`;
      paint();
    };
    const scroll = () => {
      paint();
      if (!frame && !touching) {
        clearTimeout(idle);
        idle = window.setTimeout(() => snap(), 120);
      }
    };
    const start = (e: TouchEvent) => {
      stop();
      touching = e.touches.length === 1;
      dragging = false;
      flick = 0;
      if (!touching) return;
      startY = lastY = e.touches[0]!.clientY;
      startX = e.touches[0]!.clientX;
      started = performance.now();
    };
    const move = (e: TouchEvent) => {
      if (!touching || e.touches.length !== 1) return;
      const touch = e.touches[0]!;
      const dy = touch.clientY - startY;
      if (Math.abs(dy) <= Math.abs(touch.clientX - startX) || Math.abs(dy) < 4) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("[data-h-scroll], [data-header-panel], dialog, [role=dialog], textarea, input, select")) return;
      flick = dy / Math.max(1, performance.now() - started) * 1000 / range;
      // 只接管顶部过渡区间，防止 Safari 惯性与松手弹簧争写滚动位置。
      if (scroller.scrollTop < range && e.cancelable) {
        e.preventDefault();
        scroller.scrollTop = Math.max(0, scroller.scrollTop + lastY - touch.clientY);
        dragging = true;
        paint();
      }
      lastY = touch.clientY;
    };
    const end = () => {
      if (!touching) return;
      touching = false;
      snap(dragging ? flick : 0);
    };
    const interrupt = () => {
      stop();
      idle = window.setTimeout(() => snap(), 120);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(scroller);
    measure();
    scroller.addEventListener("scroll", scroll, { passive: true });
    scroller.addEventListener("touchstart", start, { passive: true });
    scroller.addEventListener("touchmove", move, { passive: false });
    scroller.addEventListener("touchend", end);
    scroller.addEventListener("touchcancel", end);
    scroller.addEventListener("wheel", interrupt, { passive: true });
    scroller.addEventListener("keydown", interrupt);
    return () => {
      stop();
      observer.disconnect();
      content.style.minHeight = oldMinHeight;
      scroller.removeEventListener("scroll", scroll);
      scroller.removeEventListener("touchstart", start);
      scroller.removeEventListener("touchmove", move);
      scroller.removeEventListener("touchend", end);
      scroller.removeEventListener("touchcancel", end);
      scroller.removeEventListener("wheel", interrupt);
      scroller.removeEventListener("keydown", interrupt);
    };
  }, []);
  return ref;
}
