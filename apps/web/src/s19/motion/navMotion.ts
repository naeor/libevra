import { NAV_YIELD } from "../../lib/motionTokens.js";
import { S19_PHONE_SELECTOR, s19Style } from "../scope.js";

/**
 * **常驻底栏的“向下退出 / 从下方升回”**（1.19.52 让位；1.19.75 起也用于随页面层级的显隐，审查 T1）。
 *
 * 所有者原话：“从主页进入次级页面时，tab 做一个新动画，也就是快速往下退出屏幕，同样的它出现的时候也是从屏幕下方快速弹出。”
 * 显示与否只由 `navVisibleAt(level)`（navigation.ts）和页面的让位决定，这里只管“怎么动”：
 *
 * - **时长与曲线**：与让位共用 `NAV_YIELD`——退出 180ms `cubic-bezier(.4,0,1,1)`，升回 220ms `cubic-bezier(.2,.8,.3,1)`，
 *   与账本胶囊的缩回 200ms / 弹起 220ms 同一档。升回不过冲：底栏贴着屏幕底边，向上过冲会在底边露出一条缝。
 * - **图层**：底栏压在页面转场之上。A / B1 / C 的转场舞台（z 80，不透明全屏）存在时底栏抬到 81（navigation.css）；
 *   B2 的 View Transition 里底栏单独成组、画在页面组之上（pilot.css）。对象展开的容器（45）仍在底栏（40）之上，底栏在长大的
 *   卡片下面退出。
 * - **退出走完才真正隐藏**（`hidden`），之前一直可见、退出途中不可点；**升回前先显示**，第一帧就在屏幕下方。
 * - **中途反向**：从此刻的位置反向走回，时长按剩下的距离折算；不会先跳回起点。
 * - **一定收尾**：动画没有推进（后台标签页、浏览器跳过）时，看门狗按终点收尾，不卡在半路。
 *
 * 退出 / 升回期间底栏带 `data-nav-motion="exit|rise"`：提示条据此按底栏要去的位置摆放（ToastViewport）。
 */
export type NavMotionKind = "exit" | "rise";
export const NAV_MOTION_ATTRIBUTE = "data-nav-motion";

export interface NavMotion {
  readonly kind: NavMotionKind;
  /** 立即停下（不调用 done）；底栏回到没有动画时的位置。 */
  cancel(): void;
}

/** 随层级的退出 / 升回只在 S19 四风格手机外壳播放；Original、Pad、电脑版保持即时显隐。 */
export function navMotionEnabled(nav: Element): boolean {
  const data = document.documentElement.dataset;
  return nav.closest(S19_PHONE_SELECTOR) !== null && s19Style(data.visualStyle) !== null;
}

/**
 * B2 的 View Transition 正在拍新页（engine.ts 在更新回调里写 `data-motion-capture`）：底栏的退出 / 升回由快照播放
 * （pilot.css 的 `lv-persistent-nav`），活的底栏这时直接换到结果，不再自己动一遍。
 */
export function navCapturedByPageTransition(): boolean {
  const data = document.documentElement.dataset;
  return data.motionCapture !== undefined && data.visualStyle === "b2";
}

export function canAnimateNav(nav: HTMLElement): boolean {
  return typeof nav.animate === "function" && !document.hidden
    && !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/** 计算样式里的纵向位移（px）：`none` 为 0；`matrix(…)` 取第 6 项，`matrix3d(…)` 取第 14 项。纯函数。 */
export function translateYOf(transform: string): number {
  const match = /^matrix(3d)?\(([^)]*)\)$/.exec(transform.trim());
  if (!match) return 0;
  const values = match[2]!.split(",").map(Number);
  const y = match[1] ? values[13] : values[5];
  return Number.isFinite(y) ? y! : 0;
}

/** 元素此刻的纵向位移（含正在播放的动画）。 */
export function navOffset(element: Element): number {
  return translateYOf(getComputedStyle(element).transform);
}

/** 退出 / 升回走完全程的比例：从中途反向时只走剩下的距离。纯函数。 */
export function remainingShare(kind: NavMotionKind, fromPx: number | null, awayPx: number): number {
  if (fromPx === null || !(awayPx > 0)) return 1;
  const share = kind === "exit" ? (awayPx - fromPx) / awayPx : fromPx / awayPx;
  return Math.min(1, Math.max(0, share));
}

/** 中途反向时的最短时长：太短的动画在 Safari 上容易被直接跳过。 */
const MIN_MS = 90;
/** 看门狗：比动画长出这么多仍没结束，就按终点收尾（提交后的长任务会推迟动画开始，留足余量）。 */
const WATCHDOG_MS = 1000;

/**
 * 播放一次退出或升回。`fromPx` 为 null 时从完整起点开始（退出从原位、升回从屏幕下方）；否则从此刻的位移开始（中途反向）。
 * 退出结束时调用 `done`（调用方在里面真正隐藏底栏），之后才撤掉动画，中间不会露出一帧原位。
 */
export function playNavMotion(nav: HTMLElement, kind: NavMotionKind, fromPx: number | null, done?: () => void): NavMotion {
  const timing = kind === "exit" ? NAV_YIELD.exit : NAV_YIELD.enter;
  const away = `translateY(${NAV_YIELD.offset})`;
  const awayPx = nav.getBoundingClientRect().height * (Number.parseFloat(NAV_YIELD.offset) / 100);
  const start = fromPx !== null ? `translateY(${fromPx}px)` : kind === "exit" ? "translateY(0)" : away;
  const end = kind === "exit" ? away : "translateY(0)";
  const share = remainingShare(kind, fromPx, awayPx);
  const duration = fromPx === null ? timing.duration : Math.max(MIN_MS, Math.round(timing.duration * share));
  nav.setAttribute(NAV_MOTION_ATTRIBUTE, kind);
  const animation = nav.animate([{ transform: start }, { transform: end }], { duration, easing: timing.easing, fill: "forwards" });
  let settled = false;
  const release = (): void => {
    window.clearTimeout(watchdog);
    animation.cancel();
    if (nav.getAttribute(NAV_MOTION_ATTRIBUTE) === kind) nav.removeAttribute(NAV_MOTION_ATTRIBUTE);
  };
  const finish = (): void => {
    if (settled) return;
    settled = true;
    done?.();
    release();
  };
  animation.onfinish = finish;
  const watchdog = window.setTimeout(finish, duration + WATCHDOG_MS);
  return { kind, cancel: () => { if (settled) return; settled = true; release(); } };
}
