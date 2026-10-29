import { clamp01, decideTarget, hasSettled, springStep } from "./transitionPhysics.js";

/** 一次触摸从头到尾由同一原生滚动容器处理，不能在 preventDefault 后中途交还。
 * 只读取滚动位置驱动动画，停止滚动后复用两端弹簧；不会模拟惯性或逐帧更新 React。
 */
export function bindNativeHeaderScroll(scroller: HTMLElement, range: () => number, paint: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, idle = 0, touching = false, flick = 0, startY = 0, startX = 0, started = 0;
  const stop = () => { cancelAnimationFrame(frame); frame = 0; clearTimeout(idle); };
  const goTo = (target: number) => {
    stop(); target = clamp01(target);
    let p = clamp01(scroller.scrollTop / range()), velocity = 0, previous = performance.now();
    if (media.matches) { scroller.scrollTop = target * range(); paint(); return; }
    const tick = (now: number) => {
      const next = springStep(p, velocity, target, Math.min((now - previous) / 1000, 1 / 30));
      previous = now;
      p = target === 1 ? Math.max(p, clamp01(next.progress)) : Math.min(p, clamp01(next.progress));
      velocity = next.velocity;
      const done = hasSettled(p, velocity, target);
      scroller.scrollTop = (done ? target : p) * range();
      paint();
      frame = done ? 0 : requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  const snap = () => {
    if (!touching && !frame && scroller.scrollTop > 0 && scroller.scrollTop < range())
      goTo(decideTarget(scroller.scrollTop / range(), flick));
  };
  const schedule = () => { clearTimeout(idle); idle = window.setTimeout(snap, 120); };
  const scroll = () => { paint(); if (!touching && !frame) schedule(); };
  const start = (e: TouchEvent) => {
    stop(); flick = 0; touching = e.touches.length === 1;
    startY = e.touches[0]?.clientY ?? 0; startX = e.touches[0]?.clientX ?? 0; started = performance.now();
  };
  const move = (e: TouchEvent) => {
    if (!touching || e.touches.length !== 1) return;
    const touch = e.touches[0]!;
    const dy = touch.clientY - startY;
    if (Math.abs(dy) <= Math.abs(touch.clientX - startX)) return;
    // 只读速度；包括超出端点的后续移动都不阻止默认滚动。
    flick = dy / Math.max(1, performance.now() - started) * 1000 / range();
  };
  const end = () => { touching = false; schedule(); };
  const interrupt = () => { stop(); flick = 0; schedule(); };
  scroller.addEventListener("scroll", scroll, { passive: true });
  scroller.addEventListener("scrollend", snap, { passive: true });
  scroller.addEventListener("touchstart", start, { passive: true });
  scroller.addEventListener("touchmove", move, { passive: true });
  scroller.addEventListener("touchend", end);
  scroller.addEventListener("touchcancel", end);
  scroller.addEventListener("wheel", interrupt, { passive: true });
  scroller.addEventListener("keydown", interrupt);
  return { goTo, destroy() {
    stop();
    scroller.removeEventListener("scroll", scroll);
    scroller.removeEventListener("scrollend", snap);
    scroller.removeEventListener("touchstart", start);
    scroller.removeEventListener("touchmove", move);
    scroller.removeEventListener("touchend", end);
    scroller.removeEventListener("touchcancel", end);
    scroller.removeEventListener("wheel", interrupt);
    scroller.removeEventListener("keydown", interrupt);
  } };
}
