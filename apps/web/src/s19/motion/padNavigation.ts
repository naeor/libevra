import { NAVIGATION, TAB_SWITCH, padMotionMs } from "../../lib/motionTokens.js";
import { s19Style } from "../scope.js";
import { hasOpenOverlay } from "../../lib/openOverlay.js";
import type { PaneSnapshot } from "../../workspace/paneHistory.js";
import { isReturnToTab, isTabSwitch } from "./navigation.js";

/** 侧栏里主 Tab 自上而下的顺序（与 tabExchange.ts 的 TAB_ORDER 相同；不从那里导入，免得把手机转场模块打进 Pad 的包）。 */
const PAD_TAB_ORDER: readonly string[] = ["/", "/stats", "/ledger", "/me"];
const tabIndex = (pathname: string): number => PAD_TAB_ORDER.indexOf(pathname);

/*
 * Pad 工作区内的导航转场。
 * - 次级页面：只呈现提交后的真实页面（横向短位移 + 淡入），保持另一区、临时区及滚动容器静止。
 * - 主 Tab 之间（1.19.107，所有者：Pad 的 Tab 栏是竖着摆的）：整页上下滑动。切到侧栏里更靠下的 Tab 时，
 *   旧页向上滑出、新页从下面升上来；切到更靠上的 Tab 时反过来。旧页面在新页面提交后就卸载了，所以提交前
 *   由 {@link preparePadNavigation} 在工作区里留一份静态副本（不可交互、对读屏隐藏），随新页面一起移动，结束即移除。
 */

/** 等待新页面提交的上限；超过就丢掉副本，只交付页面（与其它转场的 giveUpMs 同级）。 */
const PREPARED_GIVE_UP_MS = 1500;

interface Prepared {
  readonly from: string;
  readonly to: string;
  readonly layer: HTMLElement;
  readonly timer: ReturnType<typeof setTimeout>;
}
const prepared = new Map<string, Prepared>();

function paneScroll(instance: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.lv-pane[data-mode="box"][data-instance="${instance}"] > .lv-pane-scroll`);
}

function pages(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter((page): page is HTMLElement =>
    page instanceof HTMLElement && page.getClientRects().length > 0 && !page.matches("[data-overlay-root], [data-persistent-nav]"));
}

/** 与 {@link animatePadNavigation} 相同的放行条件；不满足时一律不做转场。 */
function motionAllowed(instance: string, from: string, to: string): { root: HTMLElement; style: "a" | "b1" | "b2" | "c" } | null {
  const style = s19Style(document.documentElement.dataset.visualStyle);
  if (from === to || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !style) return null;
  const root = paneScroll(instance);
  if (!root || root.closest("[inert]") || hasOpenOverlay(root) || document.querySelector("[data-pad-modal-layer]")) return null;
  return { root, style };
}

function discard(instance: string): void {
  const entry = prepared.get(instance);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.layer.remove();
  prepared.delete(instance);
}

/** 复制页面当前的样子：滚动位置（页面自己的滚动容器）与画布内容不随 cloneNode 复制，逐个补上。 */
type Pair = readonly [Element, Element | undefined];

function snapshotPage(page: HTMLElement): { copy: HTMLElement; pairs: Pair[] } {
  const copy = page.cloneNode(true) as HTMLElement;
  const source = [page, ...Array.from(page.querySelectorAll("*"))];
  const target = [copy, ...Array.from(copy.querySelectorAll("*"))];
  return { copy, pairs: source.map((node, i): Pair => [node, target[i]]) };
}

/** 副本插入文档后才能设滚动位置。 */
function restorePaint(pairs: readonly Pair[]): void {
  for (const [node, copy] of pairs) {
    if (!copy) continue;
    if (node.scrollTop > 0 || node.scrollLeft > 0) { copy.scrollTop = node.scrollTop; copy.scrollLeft = node.scrollLeft; }
    if (node instanceof HTMLCanvasElement && copy instanceof HTMLCanvasElement && node.width > 0 && node.height > 0) {
      try { copy.getContext("2d")?.drawImage(node, 0, 0); } catch { /* 读不了的画布保持空白，不影响转场 */ }
    }
  }
}

/**
 * 主 Tab 切换提交前调用：在工作区里放一份旧页面的静态副本，盖在原位（与旧页面完全重合，看不出变化）。
 * 其它导航什么都不做。
 */
export function preparePadNavigation(instance: string, from: PaneSnapshot, to: PaneSnapshot): void {
  discard(instance);
  const fromPath = from.location.pathname, toPath = to.location.pathname;
  if (!isTabSwitch(fromPath, toPath)) return;
  const allowed = motionAllowed(instance, fromPath, toPath);
  const pane = allowed?.root.parentElement;
  if (!allowed || !pane) return;
  const { root } = allowed;
  const layer = document.createElement("div");
  layer.className = "lv-pad-tab-snapshot";
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;
  Object.assign(layer.style, {
    position: "absolute", left: `${root.offsetLeft}px`, top: `${root.offsetTop}px`,
    width: `${root.offsetWidth}px`, height: `${root.offsetHeight}px`,
    overflow: "hidden", pointerEvents: "none", zIndex: "1",
  });
  const inner = document.createElement("div");
  Object.assign(inner.style, { transform: `translateY(${-root.scrollTop}px)` });
  const pairs: Pair[] = [];
  for (const page of pages(root)) {
    const snap = snapshotPage(page);
    pairs.push(...snap.pairs);
    inner.append(snap.copy);
  }
  layer.append(inner);
  pane.append(layer);
  restorePaint(pairs);
  prepared.set(instance, { from: fromPath, to: toPath, layer, timer: setTimeout(() => discard(instance), PREPARED_GIVE_UP_MS) });
}

export function animatePadNavigation(instance: string, from: PaneSnapshot, to: PaneSnapshot): Animation[] {
  const fromPath = from.location.pathname, toPath = to.location.pathname;
  const entry = prepared.get(instance);
  const snapshot = entry && entry.from === fromPath && entry.to === toPath ? entry : null;
  if (entry && !snapshot) discard(instance);
  const allowed = motionAllowed(instance, fromPath, toPath);
  if (!allowed) { discard(instance); return []; }
  const { root, style } = allowed;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const tab = isTabSwitch(fromPath, toPath);
  const animations: Animation[] = [];

  if (tab) {
    const config = { duration: padMotionMs(TAB_SWITCH.duration), easing: TAB_SWITCH.easing };
    // 侧栏里往下走（明细 → 分析）：内容向上移；往上走则向下移。
    const down = tabIndex(toPath) > tabIndex(fromPath);
    const height = root.clientHeight * (down ? 1 : -1);
    for (const page of pages(root)) {
      animations.push(page.animate([{ transform: `translateY(${height}px)` }, { transform: "translateY(0)" }], config));
    }
    if (snapshot) {
      clearTimeout(snapshot.timer);
      prepared.delete(instance);
      const layer = snapshot.layer;
      const out = layer.animate([{ transform: "translateY(0)" }, { transform: `translateY(${-height}px)` }], { ...config, fill: "forwards" });
      animations.push(out);
      void out.finished.catch(() => undefined).finally(() => layer.remove());
    }
  } else {
    discard(instance);
    const back = (to.action === "POP" && from.index >= to.index) || isReturnToTab(fromPath, toPath);
    const config = NAVIGATION[style === "a" ? "b1" : style];
    const distance = Math.min(30, root.clientWidth * .055) * (back ? -1 : 1);
    const frames = [
      { opacity: .76, transform: `translateX(${distance}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ];
    for (const page of pages(root)) animations.push(page.animate(frames, { duration: padMotionMs(config.duration), easing: config.easing }));
  }

  const settle = () => { if (reduced.matches) for (const animation of animations) animation.cancel(); };
  reduced.addEventListener("change", settle);
  void Promise.allSettled(animations.map(animation => animation.finished)).then(() => reduced.removeEventListener("change", settle));
  return animations;
}
