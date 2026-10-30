import { clamp01, decideTarget, hasSettled, springStep } from "./transitionPhysics.js";

/**
 * 滚动停下多久之后才考虑吸附。只是「开始核对」的时机，不是判断依据——真正的依据是下面的位置核对。
 */
const IDLE_MS = 120;
/** 位置相差不到半个像素视为没动（高分屏上 scrollTop 可能是小数）。 */
const STILL_PX = 0.5;
/** 弹簧写入后读回的位置与滚动事件里的位置相差超过这么多，说明有别的力量（惯性 / 手指）在滚动。 */
const FOREIGN_PX = 1;

/** 一次触摸从头到尾由同一原生滚动容器处理，不能在 preventDefault 后中途交还。
 * 只读取滚动位置驱动动画，停止滚动后复用两端弹簧；不会模拟惯性或逐帧更新 React。
 *
 * ⚠️ **S18 第二轮：快速上下滑动时「停顿、跳回」的根因与修复。**
 *
 * 原来的「停止」判断只有一条：120ms 没收到 scroll 事件。iPad Safari 的惯性滚动在合成线程上进行，
 * 主线程忙的时候（双工作区同时渲染两页、列表加载下一页、`atList` 切换引起的重渲染）scroll 事件会
 * 被推迟甚至合并，计时器于是在**惯性仍在进行**时触发；此时位置恰好落在摘要过渡区内，弹簧就从这个
 * 位置开始逐帧写 `scrollTop`——它比惯性慢，每一帧都把内容往回拉，与惯性互相争夺位置，表现为摘要
 * 收缩不连续、卡住、跳回。
 *
 * 修复不是加延迟，而是**核对位置**：
 * 1. 计时器 / `scrollend` 只是「开始核对」的信号：先比对最近一次 scroll 事件看到的位置，再隔两帧
 *    读两次 `scrollTop`；任何一处变化都说明还在滚动，重新等待，绝不在运动中启动弹簧。
 * 2. 弹簧运行时记住自己写入的位置；scroll 事件里读到的位置与之不符（惯性或手指仍在推动），弹簧
 *    立即让出，等这次运动真正停下后再重新判断。
 */
export function bindNativeHeaderScroll(scroller: HTMLElement, range: () => number, paint: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, idle = 0, probe = 0, touching = false, flick = 0, startY = 0, startX = 0, started = 0;
  /** 最近一次 scroll 事件时的位置。 */
  let seen = scroller.scrollTop;
  /** 弹簧最近一次写入后读回的位置（未在运行时无意义）。 */
  let written = Number.NaN;
  const cancelProbe = () => { if (probe !== 0) { cancelAnimationFrame(probe); probe = 0; } };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; clearTimeout(idle); cancelProbe(); };
  const goTo = (target: number) => {
    stop(); target = clamp01(target);
    let p = clamp01(scroller.scrollTop / range()), velocity = 0, previous = performance.now();
    if (media.matches) { scroller.scrollTop = target * range(); seen = scroller.scrollTop; paint(); return; }
    const tick = (now: number) => {
      const next = springStep(p, velocity, target, Math.min((now - previous) / 1000, 1 / 30));
      previous = now;
      p = target === 1 ? Math.max(p, clamp01(next.progress)) : Math.min(p, clamp01(next.progress));
      velocity = next.velocity;
      const done = hasSettled(p, velocity, target);
      scroller.scrollTop = (done ? target : p) * range();
      written = scroller.scrollTop;
      seen = written;
      paint();
      frame = done ? 0 : requestAnimationFrame(tick);
    };
    written = scroller.scrollTop;
    frame = requestAnimationFrame(tick);
  };
  const snap = () => {
    if (!touching && !frame && scroller.scrollTop > 0 && scroller.scrollTop < range())
      goTo(decideTarget(scroller.scrollTop / range(), flick));
  };
  /** 「可能停了」→ 核对位置：两帧之内都没动，才算真的停下。 */
  const check = () => {
    clearTimeout(idle); cancelProbe();
    if (touching || frame) return;
    const before = scroller.scrollTop;
    if (Math.abs(before - seen) > STILL_PX) { seen = before; schedule(); return; }
    probe = requestAnimationFrame(() => {
      probe = requestAnimationFrame(() => {
        probe = 0;
        if (touching || frame) return;
        const now = scroller.scrollTop;
        if (Math.abs(now - before) > STILL_PX) { seen = now; schedule(); return; }
        snap();
      });
    });
  };
  const schedule = () => { clearTimeout(idle); cancelProbe(); idle = window.setTimeout(check, IDLE_MS); };
  const scroll = () => {
    paint();
    const top = scroller.scrollTop;
    if (frame && Math.abs(top - written) > FOREIGN_PX) {
      // 弹簧运行中，位置却不是弹簧写的：惯性或手指还在推动——让出，等这次运动停下。
      stop();
    }
    seen = top;
    if (!touching && !frame) schedule();
  };
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
  const end = () => { touching = false; seen = scroller.scrollTop; schedule(); };
  const interrupt = () => { stop(); flick = 0; schedule(); };
  scroller.addEventListener("scroll", scroll, { passive: true });
  scroller.addEventListener("scrollend", check, { passive: true });
  scroller.addEventListener("touchstart", start, { passive: true });
  scroller.addEventListener("touchmove", move, { passive: true });
  scroller.addEventListener("touchend", end);
  scroller.addEventListener("touchcancel", end);
  scroller.addEventListener("wheel", interrupt, { passive: true });
  scroller.addEventListener("keydown", interrupt);
  return { goTo, destroy() {
    stop();
    scroller.removeEventListener("scroll", scroll);
    scroller.removeEventListener("scrollend", check);
    scroller.removeEventListener("touchstart", start);
    scroller.removeEventListener("touchmove", move);
    scroller.removeEventListener("touchend", end);
    scroller.removeEventListener("touchcancel", end);
    scroller.removeEventListener("wheel", interrupt);
    scroller.removeEventListener("keydown", interrupt);
  } };
}
