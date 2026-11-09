/**
 * S19：B1 / B2 底栏的选中玻璃胶囊与弹性动效（只在开发 / 测试构建里运行）。
 *
 * ⚠️ 不改 BottomNav 组件。每个 Tab 页面各自渲染底栏，切换页面时底栏会整体替换；这里在
 * 当前可见的底栏里插入一块独立的胶囊（`.s19-tab-glass`），用 DOM 测量出各 Tab 的真实位置，
 * 发现选中项变化（`aria-current="page"`）时从上一位置动到新位置。导航本身不经过这里，
 * 点击后页面立即切换，动画只是跟上。原来每个 Tab 自带的选中圆片在 B1 / B2 里透明（保留占位）。
 *
 * 动画只用 transform、width、opacity（胶囊是底栏里一个绝对定位的小元素，宽度变化不影响别处布局），
 * 模糊半径不随帧变化。新的切换会打断旧动画，从胶囊当前所在的位置接着走，不排队。
 *
 * 形变规则：移动方向的前缘先走、后缘滞后（前缘分到 70% 的拉伸），到点后越过 2–3.5px 再回弹一次；
 * 图标与文字不在胶囊里，所以不会被拉伸。
 */
import { tabMotion } from "./tabMotion.js";

const NAV_SELECTOR = '.lv-shell[data-shell="contents"] nav.shrink-0.border-t';
/** 静止宽高比。 */
const RATIO = 1.15;
/** 运动中最多拉长到静止宽度的 1 + MAX_STRETCH 倍。 */
const MAX_STRETCH = 0.28;
/** B1/B2 的既有轨迹统一延长 8%，约降低 7.4% 移动速度。 */
const MOTION_TIME_SCALE = 1.08;
/** 底栏消失后多久内重新出现仍算“同一次切换”（页面替换底栏的那一下）。 */
const SWAP_WINDOW = 800;

interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
interface Frame { readonly offset: number; readonly x: number; readonly w: number; readonly opacity: number; readonly easing?: string }

let nav: HTMLElement | null = null;
let main: HTMLSpanElement | null = null;
let ghost: HTMLSpanElement | null = null;
let index: number | null = null;
let rest: Box | null = null;
let goneAt = Number.NEGATIVE_INFINITY;
let running: Animation[] = [];

function enabled(): boolean {
  const data = document.documentElement.dataset;
  return (data.visualStyle === "b1" || data.visualStyle === "b2") && data.themeMode === "light";
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function findNav(): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(NAV_SELECTOR)) {
    if (!element.closest("[data-abc-snapshot]") && element.getClientRects().length > 0) return element;
  }
  return null;
}

function slotsOf(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>(":scope > ul > li"));
}

function plusIndex(items: readonly HTMLElement[]): number {
  return items.findIndex((li) => li.querySelector("button.size-16") !== null);
}

function activeIndex(items: readonly HTMLElement[]): number {
  const tab = items.findIndex((li) => li.querySelector('[aria-current="page"]') !== null);
  // 1.19.52：在记账方式页时没有当前 Tab，胶囊停到“＋”后面（被“＋”挡住、透明），离开时从那里滑回。
  return tab >= 0 ? tab : items.findIndex((li) => li.hasAttribute("data-entry-current"));
}

/** 停在“＋”后面：横向对准“＋”，高度与形状沿用普通 Tab，透明（“＋”本身也会挡住它）。 */
function targetBox(element: HTMLElement, items: readonly HTMLElement[], at: number): Box | null {
  const plus = plusIndex(items);
  if (at !== plus) return boxFor(element, items[at]);
  const button = items[plus]?.querySelector<HTMLElement>("button");
  const tab = boxFor(element, items.find((_, i) => i !== plus));
  if (!button || tab === null) return null;
  const r = button.getBoundingClientRect(), n = element.getBoundingClientRect();
  return { ...tab, x: r.left - n.left + r.width / 2 - tab.w / 2 };
}

function restOpacity(items: readonly HTMLElement[], at: number): number {
  return at === plusIndex(items) ? 0 : 1;
}

/** 与原选中圆片同一高度（按钮高度减 12px），宽度为高度的 1.15 倍，中心对准按钮中心。 */
function boxFor(element: HTMLElement, li: HTMLElement | undefined): Box | null {
  const button = li?.querySelector<HTMLElement>("button, a");
  if (!button) return null;
  const r = button.getBoundingClientRect();
  const n = element.getBoundingClientRect();
  const h = Math.max(0, Math.round(r.height - 12));
  const w = Math.round(h * RATIO);
  return { x: r.left - n.left + r.width / 2 - w / 2, y: r.top - n.top + r.height / 2 - h / 2, w, h };
}

function make(className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function ensure(element: HTMLElement): { main: HTMLSpanElement; ghost: HTMLSpanElement } {
  main ??= make("s19-tab-glass");
  ghost ??= make("s19-tab-glass s19-tab-glass-ghost");
  if (main.parentElement !== element) element.appendChild(main);
  if (ghost.parentElement !== element) element.appendChild(ghost);
  return { main, ghost };
}

function apply(node: HTMLElement, box: Box, opacity: number): void {
  node.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`;
  node.style.width = `${box.w}px`;
  node.style.height = `${box.h}px`;
  node.style.opacity = String(opacity);
}

function cancel(): void {
  for (const animation of running) animation.cancel();
  running = [];
}

function keyframes(frames: readonly Frame[], y: number): Keyframe[] {
  return frames.map((f) => ({
    offset: f.offset,
    transform: `translate3d(${f.x}px, ${y}px, 0)`,
    width: `${f.w}px`,
    opacity: f.opacity,
    ...(f.easing === undefined ? {} : { easing: f.easing }),
  }));
}

/** 中心在 c、多出 s 像素拉伸时的左边缘与宽度；前缘（运动方向一侧）分到 70%。 */
function stretched(c: number, w: number, s: number, dir: number): { x: number; w: number } {
  return { x: dir > 0 ? c - w / 2 - s * 0.3 : c - w / 2 - s * 0.7, w: w + s };
}

/** 普通方向性平移（相邻切换；V1 跨“＋”也用它，从“＋”后方连续穿过）。 */
function slide(from: Box, to: Box, fromOpacity: number, toOpacity = 1): Frame[] {
  const fromC = from.x + from.w / 2;
  const toC = to.x + to.w / 2;
  const d = toC - fromC;
  const dir = d >= 0 ? 1 : -1;
  const dist = Math.abs(d);
  const s = Math.min(to.w * MAX_STRETCH, dist * 0.35);
  const over = Math.min(3.5, 1.5 + dist * 0.01);
  // 去“＋”后面时后半程淡出（滑到“＋”下方消失）；从“＋”后面出来时前半程淡入。
  const fade = (offset: number): number => (toOpacity < 1 ? (offset < 0.4 ? 1 : offset >= 0.72 ? toOpacity : 0.5) : 1);
  const at = (offset: number, c: number, stretch: number, easing?: string): Frame => ({
    offset, ...stretched(c, to.w, stretch, dir), opacity: fade(offset), ...(easing === undefined ? {} : { easing }),
  });
  return [
    { offset: 0, x: from.x, w: from.w, opacity: fromOpacity, easing: "cubic-bezier(.45, .05, .55, .95)" },
    at(0.4, fromC + d * 0.5, s, "cubic-bezier(.2, .6, .35, 1)"),
    at(0.72, toC + dir * over, s * 0.15, "cubic-bezier(.4, 0, .6, 1)"),
    at(0.88, toC - dir * over * 0.3, 0, "ease-in-out"),
    at(1, toC, 0),
  ];
}

/** V2 第一阶段：在原位置朝目标方向轻微拉伸，随即收窄、变淡消失（不横穿底栏）。 */
function leave(from: Box, dir: number, fromOpacity: number): Frame[] {
  const c = from.x + from.w / 2;
  return [
    { offset: 0, x: from.x, w: from.w, opacity: fromOpacity, easing: "cubic-bezier(.3, 0, .5, 1)" },
    { offset: 0.42, ...stretched(c + dir * 3, from.w, from.w * 0.2, dir), opacity: 0.85, easing: "cubic-bezier(.5, 0, .9, .6)" },
    { offset: 1, x: c + dir * 9 - from.w * 0.27, w: from.w * 0.54, opacity: 0 },
  ];
}

/** V2 第二阶段：在目标位置、靠来时方向一侧 12px 处以较窄的形状出现，伸展到位，越过一点再回弹。 */
function arrive(to: Box, dir: number): Frame[] {
  const c = to.x + to.w / 2;
  return [
    { offset: 0, x: c - dir * 12 - to.w * 0.3, w: to.w * 0.6, opacity: 0, easing: "cubic-bezier(.2, .7, .3, 1)" },
    { offset: 0.45, ...stretched(c - dir * 1, to.w, to.w * 0.18, dir), opacity: 1, easing: "cubic-bezier(.4, 0, .6, 1)" },
    { offset: 0.75, x: c + dir * 2.5 - to.w / 2, w: to.w, opacity: 1, easing: "ease-in-out" },
    { offset: 1, x: to.x, w: to.w, opacity: 1 },
  ];
}

/** 胶囊此刻在屏幕上的位置（动画中途被打断时，从这里接着走）。 */
function visual(element: HTMLElement): { box: Box; opacity: number } | null {
  if (!main || !ghost || main.parentElement !== element) return null;
  const pick = Number(getComputedStyle(main).opacity) >= Number(getComputedStyle(ghost).opacity) ? main : ghost;
  const r = pick.getBoundingClientRect();
  if (r.width === 0) return null;
  const n = element.getBoundingClientRect();
  return { box: { x: r.left - n.left, y: r.top - n.top, w: r.width, h: r.height }, opacity: Number(getComputedStyle(pick).opacity) };
}

function track(animations: Animation[]): void {
  running = animations;
  for (const animation of animations) {
    animation.addEventListener("finish", () => {
      running = running.filter((item) => item !== animation);
    });
  }
}

function move(element: HTMLElement, items: readonly HTMLElement[], fromIndex: number, toIndex: number, to: Box): void {
  const nodes = ensure(element);
  const now = running.length > 0 ? visual(element) : null;
  const from = now?.box ?? targetBox(element, items, fromIndex) ?? to;
  const fromOpacity = now?.opacity ?? restOpacity(items, fromIndex);
  const toOpacity = restOpacity(items, toIndex);
  cancel();
  apply(nodes.main, to, toOpacity);
  apply(nodes.ghost, from, 0);
  if (reducedMotion()) {
    if (toOpacity > 0) track([nodes.main.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "ease-out" })]);
    return;
  }
  const plus = plusIndex(items);
  const crosses = plus >= 0 && (fromIndex - plus) * (toIndex - plus) < 0;
  const dir = to.x + to.w / 2 >= from.x + from.w / 2 ? 1 : -1;
  if (crosses && tabMotion() === "v2") {
    track([
      nodes.ghost.animate(keyframes(leave(from, dir, fromOpacity), from.y), { duration: 120 * MOTION_TIME_SCALE }),
      nodes.main.animate(keyframes(arrive(to, dir), to.y), { duration: 170 * MOTION_TIME_SCALE, delay: 60 * MOTION_TIME_SCALE, fill: "backwards" }),
    ]);
    return;
  }
  const dist = Math.abs(to.x + to.w / 2 - (from.x + from.w / 2));
  const duration = Math.round(Math.min(270, Math.max(crosses ? 210 : 190, 150 + dist * 0.4)) * MOTION_TIME_SCALE);
  track([nodes.main.animate(keyframes(slide(from, to, fromOpacity, toOpacity), to.y), { duration })]);
}

/** 再次点按已选中的 Tab：胶囊轻轻收一下再回到原形（位置不变）。 */
function pulse(): void {
  if (!main || !rest || running.length > 0 || reducedMotion()) return;
  const c = rest.x + rest.w / 2;
  const frame = (offset: number, scale: number): Frame => ({ offset, x: c - (rest!.w * scale) / 2, w: rest!.w * scale, opacity: 1 });
  track([main.animate(keyframes([frame(0, 1), { ...frame(0.35, 0.92), easing: "cubic-bezier(.3, .7, .4, 1)" }, frame(0.7, 1.04), frame(1, 1)], rest.y), { duration: 180 * MOTION_TIME_SCALE, easing: "ease-out" })]);
}

function same(a: Box | null, b: Box): boolean {
  return a !== null && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && a.w === b.w && a.h === b.h;
}

function sync(): void {
  const element = enabled() ? findNav() : null;
  if (element === null) {
    cancel(); main?.remove(); ghost?.remove(); main = ghost = null;
    if (!enabled()) { index = null; rest = null; }
    if (nav !== null) goneAt = performance.now();
    nav = null;
    return;
  }
  const previous = nav;
  nav = element;
  const nodes = ensure(element);
  const items = slotsOf(element);
  const next = activeIndex(items);
  if (next < 0) {
    cancel();
    nodes.main.style.opacity = "0";
    index = null;
    rest = null;
    return;
  }
  const to = targetBox(element, items, next);
  if (to === null) return;
  // 同一底栏里切换，或者页面切换时旧底栏刚被新底栏替换 —— 都算一次连续的切换。
  const continuous = previous === element || previous !== null || performance.now() - goneAt < SWAP_WINDOW;
  if (index !== null && next !== index && continuous) {
    move(element, items, index, next, to);
  } else if (running.length === 0 && (next !== index || !same(rest, to))) {
    cancel();
    apply(nodes.main, to, restOpacity(items, next));
    apply(nodes.ghost, to, 0);
  }
  index = next;
  rest = to;
}

let queued = false;
function queue(): void {
  if (queued) return;
  queued = true;
  // 在 MutationObserver 的回调（同一帧、绘制之前）里同步，页面替换底栏时胶囊不会缺一帧。
  queueMicrotask(() => { queued = false; sync(); });
}

let started = false;
export function startTabIndicator(): void {
  if (started) return; started = true;
  const root = document.getElementById("root") ?? document.body;
  new MutationObserver(queue).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current"] });
  new MutationObserver(queue).observe(document.documentElement, { attributes: true, attributeFilter: ["data-visual-style", "data-theme-mode"] });
  window.addEventListener("resize", queue);
  window.visualViewport?.addEventListener("resize", queue);
  document.addEventListener("click", (event) => {
    if (!enabled() || nav === null) return;
    const target = event.target instanceof Element ? event.target.closest("button, a") : null;
    if (target === null || !nav.contains(target) || target.getAttribute("aria-current") !== "page") return;
    pulse();
  }, true);
  queue();
}
