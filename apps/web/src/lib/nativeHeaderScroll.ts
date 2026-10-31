import { clamp01, decideTarget, hasSettled, springStep } from "./transitionPhysics.js";

/**
 * 滚动停下多久之后才考虑吸附。只是「开始核对」的时机，不是判断依据——真正的依据是下面的位置核对。
 */
const IDLE_MS = 120;
/** 位置相差不到半个像素视为没动（高分屏上 scrollTop 可能是小数）。 */
const STILL_PX = 0.5;
/** 弹簧写入后读回的位置与滚动事件里的位置相差超过这么多，说明有别的力量（惯性 / 手指）在滚动。 */
const FOREIGN_PX = 1;
/**
 * 1.18.7：松手后的惯性阶段，「安静多久才算停」随惯性的节奏变化——至少是最近两次滚动事件间隔的这么多倍。
 * 慢速惯性里 scroll 事件可能一两百毫秒才来一次（见下方说明），固定的 120ms 会在两次事件之间误判为「停了」。
 */
const MOMENTUM_QUIET_FACTOR = 3;
/** 惯性阶段安静时间的上限：再慢的尾巴也只等这么久（那时每秒只移动一两个像素，看不出差别）。 */
const MOMENTUM_QUIET_MAX_MS = 700;
/** 弹簧被惯性打断过一次：下一次至少安静这么久再判断，不在同一段惯性里反复启动、反复让出。 */
const PREEMPTED_QUIET_MS = 400;

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
 *
 * ⚠️ **1.18.7：慢速惯性时 Logo、小卡片高频「闪回」的根因与修复**（所有者 2026-10-31 iPhone 录屏：
 * 惯性滑动、尤其速度较慢时，动画每隔极短时间回到时间线上稍早的位置，Logo 变暗变亮交替、位置细颤；
 * 手指一直按着时完全正常）。
 *
 * - Safari 的滚动位置是整像素。惯性很慢时（每秒几十像素以下），位置要好几帧才变一个像素，scroll
 *   事件也就一两百毫秒才来一次；而上面第 1 条的核对是「120ms 没事件 + 两帧之内没动」——在两次事件
 *   之间恰好成立，于是**惯性还在走时弹簧就启动了**。
 * - 弹簧朝同一方向、但比慢速惯性快得多地写 `scrollTop`，画面往前跳；下一次惯性位置到达，又被拉回
 *   惯性自己的位置（时间线上稍早处）——第 2 条在这时才察觉并让出，过一百多毫秒核对又误判、再启动、
 *   再被拉回……就是录屏里的高频闪回。手指按着时不吸附，所以不会出现。
 *
 * 修复（只改「什么时候算停」与「什么时候让出」，弹簧本身、吸附目标、动画曲线都不变）：
 * 3. 松手后按**惯性的节奏**判断安静：要求安静时间 ≥ 最近两次滚动事件间隔的 3 倍（120–700ms）。
 *    惯性越慢、事件越稀，等得越久；没有惯性（松手时已停）仍是原来的 120ms。
 * 4. 弹簧每一帧写入前先读回位置：与上一帧写入的不符（惯性已经改了它，哪怕 scroll 事件还没派发），
 *    立即让出，这一帧不写。
 * 5. 让出过一次后，下一次至少安静 400ms 才重新判断，不会在同一段惯性里反复启动、反复被拉回。
 */
export function bindNativeHeaderScroll(scroller: HTMLElement, range: () => number, paint: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, idle = 0, probe = 0, touching = false, flick = 0, startY = 0, startX = 0, started = 0;
  /** 最近一次 scroll 事件时的位置。 */
  let seen = scroller.scrollTop;
  /** 弹簧最近一次写入后读回的位置（未在运行时无意义）。 */
  let written = Number.NaN;
  /** 安静时间从这一刻算起：最近一次（非弹簧引起的）scroll 事件、松手或让出的时间。 */
  let lastMoveAt = performance.now();
  /** 最近一次（非弹簧引起的）scroll 事件的时间：只用来量事件间隔（跨过松手那一刻）。 */
  let lastEventAt = Number.NaN;
  /** 松手后的惯性阶段：松手时间与最近两次 scroll 事件的间隔（0 = 没有观察到惯性）。 */
  let releasedAt = Number.NaN, momentumGap = 0;
  /** 手指按着时最近两次 scroll 事件的间隔：松手瞬间的滚动节奏，惯性从这个速度开始。 */
  let touchMoveAt = Number.NaN, touchGap = 0;
  /** 弹簧在这段运动里被惯性打断过。 */
  let preempted = false;
  const cancelProbe = () => { if (probe !== 0) { cancelAnimationFrame(probe); probe = 0; } };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; clearTimeout(idle); cancelProbe(); };
  /** 这一次要安静多久才开始核对（见文件头第 3、5 条）。 */
  const quietNeeded = () => {
    let quiet = IDLE_MS;
    if (momentumGap > 0) quiet = Math.max(quiet, Math.min(MOMENTUM_QUIET_MAX_MS, momentumGap * MOMENTUM_QUIET_FACTOR));
    if (preempted) quiet = Math.max(quiet, PREEMPTED_QUIET_MS);
    return quiet;
  };
  /** 这段运动已经确认停下：清掉惯性记录，下一段运动重新观察。 */
  const settle = () => { releasedAt = Number.NaN; momentumGap = 0; preempted = false; lastEventAt = Number.NaN; };
  /** 弹簧发现位置被别的力量改了：让出、记下，等这段运动真正停下再判断。 */
  const yieldToNative = () => {
    stop();
    preempted = true;
    seen = scroller.scrollTop;
    lastMoveAt = performance.now();
    paint();
    if (!touching) schedule();
  };
  const goTo = (target: number) => {
    stop(); target = clamp01(target);
    let p = clamp01(scroller.scrollTop / range()), velocity = 0, previous = performance.now();
    if (media.matches) { scroller.scrollTop = target * range(); seen = scroller.scrollTop; paint(); return; }
    const tick = (now: number) => {
      // 写入前先读回：惯性已经改了位置（scroll 事件可能还没派发），这一帧不写，立即让出。
      if (Math.abs(scroller.scrollTop - written) > FOREIGN_PX) { frame = 0; yieldToNative(); return; }
      const next = springStep(p, velocity, target, Math.min((now - previous) / 1000, 1 / 30));
      previous = now;
      p = target === 1 ? Math.max(p, clamp01(next.progress)) : Math.min(p, clamp01(next.progress));
      velocity = next.velocity;
      const done = hasSettled(p, velocity, target);
      scroller.scrollTop = (done ? target : p) * range();
      written = scroller.scrollTop;
      seen = written;
      paint();
      if (done) settle();
      frame = done ? 0 : requestAnimationFrame(tick);
    };
    written = scroller.scrollTop;
    frame = requestAnimationFrame(tick);
  };
  const snap = () => {
    if (touching || frame) return;
    settle();
    if (scroller.scrollTop > 0 && scroller.scrollTop < range()) goTo(decideTarget(scroller.scrollTop / range(), flick));
  };
  /**
   * 「可能停了」→ 核对位置：安静够久、两帧之内都没动，才算真的停下。`ended`：浏览器报告滚动结束
   * （`scrollend`）——平常照旧立即核对；但已经观察到慢速惯性或被惯性打断过时，仍要等够安静时间，
   * 不让一个提前到来的 `scrollend` 绕过第 3、5 条。
   */
  const check = (ended = false) => {
    clearTimeout(idle); cancelProbe();
    if (touching || frame) return;
    const quiet = quietNeeded();
    if (!ended || quiet > IDLE_MS) {
      const waited = performance.now() - lastMoveAt;
      if (waited < quiet) { idle = window.setTimeout(() => check(), quiet - waited); return; }
    }
    const before = scroller.scrollTop;
    if (Math.abs(before - seen) > STILL_PX) { seen = before; lastMoveAt = performance.now(); schedule(); return; }
    probe = requestAnimationFrame(() => {
      probe = requestAnimationFrame(() => {
        probe = 0;
        if (touching || frame) return;
        const now = scroller.scrollTop;
        if (Math.abs(now - before) > STILL_PX) { seen = now; lastMoveAt = performance.now(); schedule(); return; }
        snap();
      });
    });
  };
  const schedule = () => { clearTimeout(idle); cancelProbe(); idle = window.setTimeout(() => check(), quietNeeded()); };
  const scroll = () => {
    paint();
    const top = scroller.scrollTop;
    if (frame) {
      // 弹簧运行中，位置却不是弹簧写的：惯性或手指还在推动——让出，等这次运动停下。
      if (Math.abs(top - written) > FOREIGN_PX) yieldToNative();
      // 是弹簧自己写入引起的 scroll 事件：不算惯性的节奏。
      return;
    }
    const now = performance.now();
    if (touching) {
      if (!Number.isNaN(touchMoveAt)) touchGap = now - touchMoveAt;
      touchMoveAt = now;
    } else if (!Number.isNaN(releasedAt) && !Number.isNaN(lastEventAt)) {
      // 松手后的惯性：记下事件间隔（第一次从松手前最后一次事件量起），慢速惯性的事件越稀，判断「停了」之前就等得越久。
      momentumGap = now - lastEventAt;
    }
    lastEventAt = now;
    lastMoveAt = now;
    seen = top;
    if (!touching) schedule();
  };
  const start = (e: TouchEvent) => {
    stop(); settle(); flick = 0; touching = e.touches.length === 1;
    touchMoveAt = Number.NaN; touchGap = 0;
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
  const end = () => {
    touching = false;
    seen = scroller.scrollTop;
    releasedAt = performance.now();
    // 松手时手指还在动（最近一次 scroll 事件就在一两个间隔之内）：惯性会以同样的节奏开始，先按它等待；
    // 松手前已经停住：没有惯性，仍是原来的 120ms。
    const stillMoving = touchGap > 0 && releasedAt - lastEventAt <= Math.max(IDLE_MS, touchGap * 2);
    momentumGap = stillMoving ? touchGap : 0;
    lastMoveAt = releasedAt;
    schedule();
  };
  const interrupt = () => { stop(); flick = 0; schedule(); };
  const ended = () => check(true);
  scroller.addEventListener("scroll", scroll, { passive: true });
  scroller.addEventListener("scrollend", ended, { passive: true });
  scroller.addEventListener("touchstart", start, { passive: true });
  scroller.addEventListener("touchmove", move, { passive: true });
  scroller.addEventListener("touchend", end);
  scroller.addEventListener("touchcancel", end);
  scroller.addEventListener("wheel", interrupt, { passive: true });
  scroller.addEventListener("keydown", interrupt);
  return { goTo, destroy() {
    stop();
    scroller.removeEventListener("scroll", scroll);
    scroller.removeEventListener("scrollend", ended);
    scroller.removeEventListener("touchstart", start);
    scroller.removeEventListener("touchmove", move);
    scroller.removeEventListener("touchend", end);
    scroller.removeEventListener("touchcancel", end);
    scroller.removeEventListener("wheel", interrupt);
    scroller.removeEventListener("keydown", interrupt);
  } };
}
