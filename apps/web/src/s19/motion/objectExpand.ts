import { boxFrame, EASE, expansionFrames, EXPANSION_MIDDLE, relativeRect, reliableTarget, type Box } from "../../../../../prototype/geometry.mjs";
import { snapshot, restoreSnapshot } from "./abcPresentation.js";
import { runFrameClock, type FrameClock } from "../../lib/frameClock.js";
import "./objectExpand.css";

export interface ObjectSource { id: string; slot?: string; rect: Box; width: number; height: number; radius: number; safeTop: number; safeBottom: number }
const ORIGIN = { left: 0, top: 0 } as DOMRect;
export function objectSource(node: HTMLElement): ObjectSource {
  const rect = node.getBoundingClientRect();
  const nav = document.querySelector<HTMLElement>("[data-persistent-nav]:not([hidden]):not([data-motion-copy])");
  const header = node.closest(".lv-pane-scroll")?.querySelector<HTMLElement>(".detail-header-row, .tab-page-header, [data-page-nav]");
  return { id: node.dataset.objectSource!, slot: node.dataset.objectSlot ?? "", rect: relativeRect(rect, ORIGIN), width: innerWidth, height: innerHeight,
    safeTop: header?.getBoundingClientRect().bottom ?? 0, safeBottom: nav?.getBoundingClientRect().top ?? innerHeight,
    radius: parseFloat(getComputedStyle(node).borderRadius) || 16 };
}
export function findObject(root: HTMLElement | null, id: string, slot = ""): HTMLElement | null {
  return [...root?.querySelectorAll<HTMLElement>("[data-object-source]") ?? []].find(node => node.dataset.objectSource === id && (node.dataset.objectSlot ?? "") === slot) ?? null;
}

/** 先写入首帧再交给 WAAPI：静态值保证时钟开始前的那一帧就是起始姿态。 */
export function setPose(node: HTMLElement, frame: Keyframe): void {
  for (const [key, value] of Object.entries(frame)) {
    if (key === "offset" || key === "easing" || key === "composite" || value === undefined || value === null) continue;
    node.style.setProperty(key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), String(value));
  }
}
const at = (frames: [number, Keyframe][]): Keyframe[] => frames.map(([offset, frame]) => ({ ...frame, offset }));
/** B2 的玻璃直接画在容器本身（见 CSS）：frosted 把模糊放在 ::before，容器淡出时会把自己变成背景根，玻璃后方就什么也读不到。 */
function finishFor(style: string): string { return style === "b1" ? "satin" : "auto"; }
/** 交接点：容器此时已覆盖约 95% 视口（几何 60% 才完全铺满），详情从这里开始在容器上方渐显，不留空白页。 */
const HANDOFF = .45;
interface Held { node: HTMLElement; style: string | null; inert: boolean }

/**
 * Object Expand（1.19.43 起）：动画发生在真实的原页面上，而不是先进入详情再补播。
 *
 * - 展开：点击当下不提交路由。真实列表保持原样（只是 inert），容器从来源卡片的实际位置与尺寸长大；
 *   A 整页后退压暗、B1 上半页（真实）与下半页（一张副本）完整挤出、B2 原位留在玻璃后、C 轻微退场。
 *   约 45% 容器已覆盖约 95% 视口、旧页几乎全被盖住时，才在容器背后提交详情；详情 45%–80% 在容器上方渐显，
 *   容器 50%–90% 淡回统一壁纸。中间没有“容器铺满但还没有内容”的空白页。
 * - 收回：先放一张详情副本挡住提交瞬间，再提交列表（恢复滚动），容器补上、副本淡出，收缩回实际来源卡片，
 *   列表按风格回到原位；最后 20% 前景淡出露出真实卡片。底栏随列表出现，不提前蹦出来。
 * - 时间由帧锚定时钟推进：第一帧总是起始姿态，长任务（提交、首次绘制）只会让动画停一下而不是跳过前段。
 * - 浏览器自己做了返回动画（iOS 边缘滑动返回）时由协调器直接提交，不再叠一段收回。
 *
 * 几何、关键帧节奏与返回可靠性判定复用已验收原型 `prototype/geometry.mjs`。
 */
export class ObjectExpandPresentation {
  private front: HTMLElement | null = null;
  private back: HTMLElement | null = null;
  private shell: HTMLElement | null = null;
  private animations: Animation[] = [];
  private held: Held[] = [];
  private clock: FrameClock | null = null;
  /** 展开尚未到交接点时，路由提交还没有发生。 */
  private pending: (() => void) | null = null;
  private forward: { source: ObjectSource; style: string; duration: number; old: HTMLElement } | null = null;
  private generation = 0;
  get active(): boolean { return this.front !== null; }

  /** 结束当前呈现；`deliver` 时补上尚未发生的路由提交，绝不让地址与页面分离。 */
  cancel(deliver = true): void {
    ++this.generation;
    this.clock?.cancel(); this.clock = null;
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    this.restore();
    this.front?.remove(); this.back?.remove(); this.front = this.back = this.shell = null;
    const pending = this.pending; this.pending = null; this.forward = null;
    if (pending && deliver) pending();
  }

  private restore(): void {
    for (const { node, style, inert } of this.held) {
      if (style === null) node.removeAttribute("style"); else node.setAttribute("style", style);
      node.inert = inert; delete node.dataset.objectLive;
    }
    this.held = [];
  }
  private hold(node: HTMLElement): HTMLElement {
    if (!this.held.some(item => item.node === node)) this.held.push({ node, style: node.getAttribute("style"), inert: node.inert });
    return node;
  }
  private animate(node: HTMLElement, frames: Keyframe[], duration: number, easing = "linear"): Animation {
    setPose(node, frames[0]!);
    const animation = node.animate(frames, { duration, easing, fill: "both" });
    this.animations.push(animation); return animation;
  }

  run({ source, page, commit, style, reverse = false, duration = 200 }: {
    source: ObjectSource; page: () => HTMLElement | null; commit: () => void; style: string; reverse?: boolean; duration?: number;
  }): void {
    const old = page();
    if (!old || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden || typeof old.animate !== "function") {
      this.cancel(); commit(); return;
    }
    if (reverse && this.pending && this.forward) { this.retract(commit); return; }
    // 中断只读一次当前容器几何，反向从当前位置继续。
    const interrupted = reverse && this.shell?.isConnected ? relativeRect(this.shell.getBoundingClientRect(), ORIGIN) : null;
    if (reverse) this.close(source, old, page, commit, style, duration, interrupted);
    else this.open(source, old, page, commit, style, duration);
  }

  private stage(style: string, z: "front" | "back"): HTMLElement {
    const stage = document.createElement("div");
    stage.className = `lv-shell object-stage object-${z}`; stage.dataset.shell = "contents"; stage.dataset.objectStyle = style;
    stage.inert = true; stage.setAttribute("aria-hidden", "true");
    return stage;
  }
  private buildShell(style: string): { shell: HTMLElement; lift: HTMLElement; shade: HTMLElement } {
    const shell = document.createElement("div");
    shell.className = "object-shell lv-material lv-material-effects";
    shell.dataset.materialRole = "display"; shell.dataset.materialFinish = finishFor(style);
    const lift = document.createElement("div"); lift.className = "object-lift"; shell.append(lift);
    const shade = document.createElement("div"); shade.className = "object-shade";
    this.shell = shell;
    return { shell, lift, shade };
  }
  /** B1 下半页：一张副本，夹在页面与固定底栏之间滑出；上半页是真实页面本身。 */
  private lowerHalf(page: HTMLElement, style: string, split: number): HTMLElement {
    const back = this.stage(style, "back");
    const plane = snapshot(page);
    const half = document.createElement("div"); half.className = "object-neighborhood";
    half.style.clipPath = `inset(${split}px 0 0 0)`; half.append(plane); back.append(half);
    document.body.append(back); restoreSnapshot.get(plane)?.();
    this.back = back;
    return half;
  }

  private open(source: ObjectSource, old: HTMLElement, page: () => HTMLElement | null, commit: () => void, style: string, duration: number): void {
    this.cancel();
    const token = this.generation;
    const rect = source.rect, radius = source.radius, split = rect.y + rect.height;
    const front = this.stage(style, "front");
    const { shell, lift, shade } = this.buildShell(style);
    front.append(shade, shell); document.body.append(front); this.front = front;
    const real = this.hold(old); real.inert = true;
    if (style !== "b2") real.style.willChange = "transform";
    const full: Box = { x: 0, y: 0, width: innerWidth, height: innerHeight };
    const middle: Box = { ...rect };
    for (const key of ["x", "y", "width", "height"] as const) middle[key] += (full[key] - middle[key]) * EXPANSION_MIDDLE;
    this.animate(shell, expansionFrames(boxFrame(rect, radius), boxFrame(middle, radius, style === "a" ? 1.1 : 1), boxFrame(full, 0)), duration);
    // 第一帧容器透明，真实卡片仍在原处；10% 内补满，随后与卡片同形长大。
    // 详情渐显后容器才淡回统一壁纸：任何时刻屏幕上都有内容（原页面、容器或详情），没有只剩容器底色的空白帧。
    this.animate(shell, at([[0, { opacity: 0 }], [.1, { opacity: 1 }], [.5, { opacity: 1 }], [.9, { opacity: 0 }], [1, { opacity: 0 }]]), duration);
    this.animate(lift, style === "a" ? at([[0, { opacity: 0 }], [.19, { opacity: 1 }], [HANDOFF, { opacity: .45 }], [1, { opacity: 0 }]]) : [{ opacity: 0 }, { opacity: 0 }], duration);
    this.animate(shade, style === "a" ? at([[0, { opacity: 0 }], [.19, { opacity: .28 }], [HANDOFF, { opacity: .28 }], [1, { opacity: 0 }]]) : [{ opacity: 0 }, { opacity: 0 }], duration);
    const rest = { transform: "translate3d(0,0px,0) scale(1)", opacity: 1 };
    const toHandoff = (pose: Keyframe): Keyframe[] => [{ ...rest, offset: 0, easing: EASE }, { ...pose, offset: HANDOFF }, { ...pose, offset: 1 }];
    if (style === "b1") {
      // 上半页（含来源卡片）是真实页面，下半页是副本；两半与容器同节奏完整挤出可视区，固定底栏不动。
      const up = -(split + 16), down = innerHeight - split + 16;
      real.style.clipPath = `inset(0 0 ${Math.max(0, innerHeight - split)}px 0)`;
      const lower = this.lowerHalf(old, style, split);
      this.animate(real, expansionFrames({ transform: "translate3d(0,0px,0)" }, { transform: `translate3d(0,${up * EXPANSION_MIDDLE}px,0)` }, { transform: `translate3d(0,${up}px,0)` }), duration);
      this.animate(lower, expansionFrames({ transform: "translate3d(0,0px,0)" }, { transform: `translate3d(0,${down * EXPANSION_MIDDLE}px,0)` }, { transform: `translate3d(0,${down}px,0)` }), duration);
    } else if (style === "a") this.animate(real, toHandoff({ transform: "translate3d(0,0px,0) scale(.98)", opacity: .58 }), duration);
    else if (style === "c") this.animate(real, toHandoff({ transform: "translate3d(0,0px,0) scale(.99)", opacity: .72 }), duration);
    // B2：原页面位置不动，透过玻璃隐约可见；30% 起才给它透明度动画（之前不让页面成为背景根，玻璃卡片保持原样），
    // 在交接前退场，详情出现时后方不留清晰文字。
    let fading = style !== "b2";
    this.forward = { source, style, duration, old };
    this.pending = commit;
    const handoff = (): void => {
      const deliver = this.pending; this.pending = null; this.forward = null;
      if (!deliver || token !== this.generation) return;
      // 旧页几乎全被容器遮住：现在才提交。提交的长任务只会让时钟停一下。
      this.back?.remove(); this.back = null;
      deliver();
      const target = page();
      if (!target || target === old) return;
      const live = this.hold(target);
      live.dataset.objectLive = style;
      Object.assign(live.style, { position: "relative", zIndex: "46" });
      // 前段快、后段收：交接后两帧内文字就清晰可读，缩短只剩容器底色的时间。
      const reveal = this.animate(live, at([[0, { opacity: 0 }], [HANDOFF, { opacity: 0 }], [.62, { opacity: .75 }], [.8, { opacity: 1 }], [1, { opacity: 1 }]]), duration);
      this.clock?.add(reveal);
    };
    this.clock = runFrameClock(this.animations, duration, {
      name: "objectExpand",
      onProgress: progress => {
        if (!fading && progress >= .3) { fading = true; this.clock?.add(this.animate(real, at([[0, { opacity: 1 }], [.3, { opacity: 1 }], [HANDOFF, { opacity: 0 }], [1, { opacity: 0 }]]), duration)); }
        if (progress >= HANDOFF && this.pending) handoff();
      },
      onDone: () => { if (token !== this.generation) return; if (this.pending) handoff(); this.clock = null; this.cancel(); },
    });
  }

  /** 尚未交接就返回：容器沿当前姿态收回原卡片，页面回到原位，不经过详情。 */
  private retract(commit: () => void): void {
    const { source, duration } = this.forward!;
    const token = ++this.generation;
    this.clock?.cancel(); this.clock = null;
    const shell = this.shell!;
    const poses = new Map<HTMLElement, Keyframe>();
    for (const animation of this.animations) {
      const node = (animation.effect as KeyframeEffect | null)?.target as HTMLElement | null;
      if (!node || poses.has(node)) continue;
      const computed = getComputedStyle(node);
      poses.set(node, { transform: computed.transform === "none" ? "translate3d(0,0px,0)" : computed.transform, opacity: computed.opacity });
    }
    const now = relativeRect(shell.getBoundingClientRect(), ORIGIN);
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    this.pending = null; this.forward = null;
    // 详情从未提交，屏幕上仍是原页面；这次 POP 只是把路由交回同一页。
    commit();
    const back = Math.max(100, Math.round(duration * .6));
    // 容器先以实体形态缩回卡片，后半段才淡去，读作“收回卡片”而不是原地溶解。
    this.animate(shell, [boxFrame(now, 0), boxFrame(source.rect, source.radius)], back, EASE);
    const opacity = poses.get(shell)?.opacity ?? 1;
    this.animate(shell, at([[0, { opacity }], [.5, { opacity }], [1, { opacity: 0 }]]), back);
    for (const [node, pose] of poses) {
      if (node === shell) continue;
      const decor = node.classList.contains("object-shade") || node.classList.contains("object-lift");
      this.animate(node, [decor ? { opacity: pose.opacity } : pose, decor ? { opacity: 0 } : { transform: "translate3d(0,0px,0)", opacity: 1 }], back, EASE);
    }
    this.clock = runFrameClock(this.animations, back, { name: "objectRetract", onDone: () => { if (token === this.generation) { this.clock = null; this.cancel(false); } } });
  }

  private close(source: ObjectSource, old: HTMLElement, page: () => HTMLElement | null, commit: () => void, style: string, duration: number, interrupted: Box | null): void {
    // 提交前取一张详情副本放在最上层：提交与首帧绘制期间屏幕仍是详情本身。
    const outgoing = snapshot(old);
    this.cancel();
    const token = this.generation;
    const front = this.stage(style, "front");
    const { shell, lift, shade } = this.buildShell(style);
    outgoing.classList.add("object-outgoing");
    front.append(shade, shell, outgoing); document.body.append(front); this.front = front;
    restoreSnapshot.get(outgoing)?.();
    setPose(shell, { opacity: 0 }); setPose(shade, { opacity: 0 });
    commit();
    const target = page();
    if (!target) { this.cancel(); return; }
    const sourceNode = findObject(target, source.id, source.slot);
    const now = sourceNode ? relativeRect(sourceNode.getBoundingClientRect(), ORIGIN) : null;
    const reliable = reliableTarget(source.rect, now, { width: innerWidth, height: innerHeight }, source.width !== innerWidth || source.height !== innerHeight)
      && !!now && now.y >= source.safeTop - 1 && now.y + now.height <= source.safeBottom + 1;
    const rect = reliable && now ? now : source.rect, radius = source.radius, split = rect.y + rect.height;
    const real = this.hold(target); real.inert = true;
    if (style !== "b2") real.style.willChange = "transform";
    const nav = document.querySelector<HTMLElement>("[data-persistent-nav]:not([hidden])");
    const full: Box = interrupted ?? { x: 0, y: 0, width: innerWidth, height: innerHeight };
    // 列表与底栏在容器补满（不透明）那一刻才出现；B2 在玻璃模糊下 8%–14% 出现。
    const appear = (value: number): Keyframe[] => !reliable ? at([[0, { opacity: 0 }], [.2, { opacity: 0 }], [1, { opacity: value }]])
      : style === "b2" ? at([[0, { opacity: 0 }], [.08, { opacity: 0 }], [.14, { opacity: value }], [1, { opacity: value }]])
      : at([[0, { opacity: 0 }], [.09, { opacity: 0 }], [.1, { opacity: value }], [1, { opacity: value }]]);
    this.animate(outgoing, at([[0, { opacity: 1 }], [.04, { opacity: 1 }], [.14, { opacity: 0 }], [1, { opacity: 0 }]]), duration);
    // 出现完成后移除透明度动画：页面与底栏不再是背景根，玻璃卡片恢复对壁纸的模糊。
    const transient: [Animation, number][] = [];
    const settleAt = !reliable ? 1 : style === "b2" ? .14 : .1;
    if (nav) transient.push([this.animate(this.hold(nav), appear(1), duration), settleAt]);
    if (reliable) {
      this.animate(shell, [
        { ...boxFrame(full, 0), offset: 0 }, { ...boxFrame(full, 0), offset: .14, easing: EASE },
        { ...boxFrame(rect, radius), offset: .9 }, { ...boxFrame(rect, radius), offset: 1 },
      ], duration);
      this.animate(shell, at([[0, { opacity: 0 }], [.08, { opacity: 1 }], [1, { opacity: 1 }]]), duration);
    } else this.animate(shell, [{ ...boxFrame(full, 0), opacity: 0 }, { ...boxFrame(full, 0), opacity: 0 }], duration);
    this.animate(lift, style === "a" && reliable ? at([[0, { opacity: 0 }], [.1, { opacity: .45 }], [1, { opacity: 0 }]]) : [{ opacity: 0 }, { opacity: 0 }], duration);
    this.animate(shade, style === "a" ? at([[0, { opacity: 0 }], [.09, { opacity: 0 }], [.1, { opacity: .28 }], [1, { opacity: 0 }]]) : [{ opacity: 0 }, { opacity: 0 }], duration);
    transient.push([this.animate(real, appear(1), duration), settleAt]);
    if (style === "b1" && reliable) {
      const up = -(split + 16), down = innerHeight - split + 16;
      real.style.clipPath = `inset(0 0 ${Math.max(0, innerHeight - split)}px 0)`;
      const lower = this.lowerHalf(target, style, split);
      const slide = (dy: number): Keyframe[] => [
        { transform: `translate3d(0,${dy}px,0)`, offset: 0 }, { transform: `translate3d(0,${dy}px,0)`, offset: .14, easing: EASE },
        { transform: "translate3d(0,0px,0)", offset: .9 }, { transform: "translate3d(0,0px,0)", offset: 1 }];
      this.animate(real, slide(up), duration);
      this.animate(lower, slide(down), duration);
      transient.push([this.animate(lower, appear(1), duration), settleAt]);
    } else if (style === "a") this.animate(real, [{ transform: "translate3d(0,0px,0) scale(.98)", offset: 0 }, { transform: "translate3d(0,0px,0) scale(.98)", offset: .1, easing: EASE }, { transform: "translate3d(0,0px,0) scale(1)", offset: 1 }], duration);
    else if (style === "c") this.animate(real, [{ transform: "translate3d(0,0px,0) scale(.99)", offset: 0 }, { transform: "translate3d(0,0px,0) scale(.99)", offset: .1, easing: EASE }, { transform: "translate3d(0,0px,0) scale(1)", offset: 1 }], duration);
    // 最后 20% 前景淡出，露出已恢复滚动的真实页面与真实来源卡片。
    this.animate(front, at([[0, { opacity: 1 }], [.8, { opacity: 1 }], [1, { opacity: 0 }]]), duration);
    this.clock = runFrameClock(this.animations, duration, { name: "objectCollapse", onProgress: progress => {
      for (let i = transient.length - 1; i >= 0; i--) {
        const [animation, end] = transient[i]!;
        if (end < 1 && progress >= end) {
          // 移除动画后元素会回到 animate() 预先写入的首帧静态值（透明度 0），必须一并清掉，否则列表与底栏整段不可见。
          ((animation.effect as KeyframeEffect | null)?.target as HTMLElement | null)?.style.removeProperty("opacity");
          this.clock?.remove(animation); transient.splice(i, 1);
        }
      }
    }, onDone: () => {
      if (token !== this.generation) return;
      this.clock = null; this.cancel();
      if (reliable && sourceNode?.isConnected) (sourceNode.matches("button,a") ? sourceNode : sourceNode.querySelector<HTMLElement>("button,a"))?.focus({ preventScroll: true });
    } });
  }
}
