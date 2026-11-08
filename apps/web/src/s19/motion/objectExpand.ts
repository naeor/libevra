import { boxFrame, EASE, expansionFrames, EXPANSION_MIDDLE, relativeRect, reliableTarget, type Box } from "../../../../../prototype/geometry.mjs";
import { snapshot, restoreSnapshot } from "./abcPresentation.js";
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

/** 固定底栏的静态副本：转场期间由舞台持有，真实底栏按导航层级照常显示/隐藏。 */
export function copyPersistentNav(): HTMLElement | null {
  const nav = document.querySelector<HTMLElement>("[data-persistent-nav]:not([data-motion-copy])");
  if (!nav || nav.hidden) return null;
  const copy = nav.cloneNode(true) as HTMLElement;
  copy.dataset.motionCopy = "";
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("[id]")]) node.removeAttribute("id");
  return copy;
}
/** 先写入首帧再交给 WAAPI：Safari 的合成器动画可能晚一帧生效，静态值保证第一帧不闪到终态或左上角。 */
export function setPose(node: HTMLElement, frame: Keyframe): void {
  for (const [key, value] of Object.entries(frame)) {
    if (key === "offset" || key === "easing" || key === "composite" || value === undefined || value === null) continue;
    node.style.setProperty(key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), String(value));
  }
}
const hold = (frames: [number, Keyframe][]): Keyframe[] => frames.map(([offset, frame]) => ({ ...frame, offset }));
function clip(rect: Box, radius: number): string {
  return `inset(${rect.y}px ${Math.max(0, innerWidth - rect.x - rect.width)}px ${Math.max(0, innerHeight - rect.y - rect.height)}px ${rect.x}px round ${radius}px)`;
}
function hideSource(plane: HTMLElement, source: ObjectSource): void {
  const node = findObject(plane, source.id, source.slot);
  if (node) node.style.visibility = "hidden";
}
/** B2 的玻璃直接画在容器本身（见 CSS）：frosted 把模糊放在 ::before，容器淡出时会把自己变成背景根，玻璃后方就什么也读不到。 */
function finishFor(style: string): string { return style === "b1" ? "satin" : "auto"; }

/**
 * 路由呈现适配器：几何、关键帧与返回判定直接复用已验收原型 `prototype/geometry.mjs`。
 * 舞台位于固定底栏之上、真实页面之下或之上（按方向），只放 inert 副本；真实详情始终是原 React 页面。
 *
 * 展开：来源卡片原位起跳 → 约 60% 时铺满 → 真实详情 55%–100% 渐显，容器与原页面副本同时退场。
 * 收回：先补上空容器、详情副本 4%–14% 淡出 → 收缩回实际来源 → 80%–100% 舞台淡出，露出真实来源卡片。
 */
export class ObjectExpandPresentation {
  private stage: HTMLElement | null = null;
  private shell: HTMLElement | null = null;
  private animations: Animation[] = [];
  private real: { node: HTMLElement; style: string | null } | null = null;
  private generation = 0;
  get active(): boolean { return this.stage !== null; }
  private animate(node: HTMLElement, frames: Keyframe[], duration: number, easing = EASE): Animation {
    setPose(node, frames[0]!);
    const animation = node.animate(frames, { duration, easing, fill: "both" });
    this.animations.push(animation); return animation;
  }
  cancel(): void {
    ++this.generation;
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    if (this.real) {
      if (this.real.style === null) this.real.node.removeAttribute("style"); else this.real.node.setAttribute("style", this.real.style);
      delete this.real.node.dataset.objectLive;
    }
    this.real = null; this.stage?.remove(); this.stage = this.shell = null;
  }
  run({ source, page, commit, style, reverse = false, duration = 200 }: {
    source: ObjectSource; page: () => HTMLElement | null; commit: () => void; style: string; reverse?: boolean; duration?: number;
  }): void {
    const old = page();
    if (!old || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden || typeof old.animate !== "function") {
      this.cancel(); commit(); return;
    }
    // 中断只读一次当前容器几何，反向从当前位置继续。
    const interrupted = this.shell?.isConnected ? relativeRect(this.shell.getBoundingClientRect(), ORIGIN) : null;
    if (reverse) this.close(source, old, page, commit, style, duration, interrupted);
    else this.open(source, old, page, commit, style, duration);
  }

  private build(style: string, hood: HTMLElement[]): { stage: HTMLElement; shell: HTMLElement; lift: HTMLElement; layer: HTMLElement } {
    const stage = document.createElement("div");
    stage.className = "lv-shell object-stage"; stage.dataset.shell = "contents"; stage.dataset.objectStyle = style;
    stage.inert = true; stage.setAttribute("aria-hidden", "true");
    const layer = document.createElement("div"); layer.className = "object-hood"; layer.append(...hood);
    const shell = document.createElement("div");
    shell.className = "object-shell lv-material lv-material-effects";
    shell.dataset.materialRole = "display"; shell.dataset.materialFinish = finishFor(style);
    const lift = document.createElement("div"); lift.className = "object-lift"; shell.append(lift);
    stage.append(layer, shell);
    this.stage = stage; this.shell = shell;
    return { stage, shell, lift, layer };
  }

  private open(source: ObjectSource, old: HTMLElement, page: () => HTMLElement | null, commit: () => void, style: string, duration: number): void {
    const rect = source.rect, radius = source.radius;
    // 提交前取副本：周围内容仍是点击瞬间的同一帧，底栏也保持原位直到被容器盖住。
    const upper = snapshot(old), lower = snapshot(old), ghost = snapshot(old);
    const nav = copyPersistentNav();
    this.cancel();
    const token = this.generation;
    commit();
    const target = page();
    const top = document.createElement("div"), bottom = document.createElement("div"), shade = document.createElement("div");
    top.className = bottom.className = "object-neighborhood"; shade.className = "object-shade";
    top.style.clipPath = `inset(0 0 ${Math.max(0, innerHeight - rect.y)}px 0)`;
    bottom.style.clipPath = `inset(${rect.y + rect.height}px 0 0 0)`;
    hideSource(upper, source); hideSource(lower, source);
    top.append(upper); bottom.append(lower);
    const { stage, shell, lift, layer } = this.build(style, [top, bottom, ...(nav ? [nav] : []), shade]);
    const ghostLayer = document.createElement("div"); ghostLayer.className = "object-ghost";
    ghostLayer.style.clipPath = clip(rect, radius); ghostLayer.append(ghost); stage.append(ghostLayer);
    document.body.append(stage);
    for (const plane of [upper, lower, ghost]) restoreSnapshot.get(plane)?.();
    if (target && target !== old) {
      this.real = { node: target, style: target.getAttribute("style") };
      target.dataset.objectLive = style;
      Object.assign(target.style, { position: "relative", zIndex: "46" });
      this.animate(target, hold([[0, { opacity: 0 }], [.55, { opacity: 0 }], [1, { opacity: 1 }]]), duration, "linear");
    }
    const full: Box = { x: 0, y: 0, width: innerWidth, height: innerHeight };
    const middle: Box = { ...rect };
    for (const key of ["x", "y", "width", "height"] as const) middle[key] += (full[key] - middle[key]) * EXPANSION_MIDDLE;
    this.animate(shell, expansionFrames(boxFrame(rect, radius), boxFrame(middle, radius, style === "a" ? 1.1 : 1), boxFrame(full, 0)), duration, "linear");
    // 容器在 60% 铺满后与详情交接：玻璃/瓷片/纸面淡回统一壁纸，真实页面同步显现，结束时没有底色跳变。
    this.animate(lift, style === "a" ? hold([[0, { opacity: 0 }], [.19, { opacity: 1 }], [.6, { opacity: .45 }], [1, { opacity: 0 }]]) : [{ opacity: 0 }, { opacity: 0 }], duration, "linear");
    this.shellOpacity(shell, duration);
    // 后方副本必须在容器开始变淡之前退场：B2 在玻璃模糊下 40%–60% 淡出，其余在容器铺满（不透明）时直接隐藏，
    // 详情文字出现时后方永远没有清晰的旧文字，不产生重影。
    this.animate(layer, style === "b2" ? hold([[0, { opacity: 1 }], [.4, { opacity: 1 }], [.6, { opacity: 0 }], [1, { opacity: 0 }]])
      : hold([[0, { opacity: 1 }], [.6, { opacity: 1 }], [.61, { opacity: 0 }], [1, { opacity: 0 }]]), duration, "linear");
    this.animate(ghostLayer, [{ opacity: 1 }, { opacity: 0 }], duration * .1, "linear");
    if (style === "a") this.animate(shade, [{ opacity: 0 }, { opacity: .28 }], duration * .19, "linear");
    for (const [node, side] of [[top, -1], [bottom, 1]] as const) {
      if (style === "b1") {
        // 瓷片把上下内容同步完整挤出可视区；底栏副本不动。
        const dy = side < 0 ? -(rect.y + 16) : innerHeight - rect.y - rect.height + 16;
        this.animate(node, expansionFrames({ transform: "translate3d(0,0px,0)" }, { transform: `translate3d(0,${dy * EXPANSION_MIDDLE}px,0)` }, { transform: `translate3d(0,${dy}px,0)` }), duration, "linear");
      } else if (style === "a") this.animate(node, [{ transform: "translate3d(0,0px,0) scale(1)", opacity: 1 }, { transform: `translate3d(0,${side * 4}px,0) scale(.98)`, opacity: .58 }], duration);
      else if (style === "c") this.animate(node, [{ transform: "translate3d(0,0px,0)", opacity: 1 }, { transform: `translate3d(0,${side * 6}px,0)`, opacity: .72 }], duration);
      // B2：玻璃后方保持原位，不创建后方位移或透明度。
    }
    this.settle(stage, token, duration, () => undefined);
  }

  private shellOpacity(shell: HTMLElement, duration: number, reverse = false): Animation {
    return this.animate(shell, reverse ? hold([[0, { opacity: 0 }], [.08, { opacity: 1 }], [1, { opacity: 1 }]])
      : hold([[0, { opacity: 1 }], [.6, { opacity: 1 }], [1, { opacity: 0 }]]), duration, "linear");
  }

  private close(source: ObjectSource, old: HTMLElement, page: () => HTMLElement | null, commit: () => void, style: string, duration: number, interrupted: Box | null): void {
    const outgoing = snapshot(old);
    this.cancel();
    const token = this.generation;
    commit();
    const target = page();
    if (!target) return;
    const sourceNode = findObject(target, source.id, source.slot);
    const now = sourceNode ? relativeRect(sourceNode.getBoundingClientRect(), ORIGIN) : null;
    const reliable = reliableTarget(source.rect, now, { width: innerWidth, height: innerHeight }, source.width !== innerWidth || source.height !== innerHeight)
      && !!now && now.y >= source.safeTop - 1 && now.y + now.height <= source.safeBottom + 1;
    const rect = reliable && now ? now : source.rect, radius = source.radius;
    const upper = snapshot(target), lower = snapshot(target);
    const nav = copyPersistentNav();
    const top = document.createElement("div"), bottom = document.createElement("div"), shade = document.createElement("div");
    top.className = bottom.className = "object-neighborhood"; shade.className = "object-shade";
    top.style.clipPath = `inset(0 0 ${Math.max(0, innerHeight - rect.y)}px 0)`;
    bottom.style.clipPath = `inset(${rect.y + rect.height}px 0 0 0)`;
    if (reliable) { hideSource(upper, source); hideSource(lower, source); }
    top.append(upper); bottom.append(lower);
    const { stage, shell, lift, layer } = this.build(style, [top, bottom, ...(nav ? [nav] : []), shade]);
    outgoing.classList.add("object-outgoing"); stage.append(outgoing);
    document.body.append(stage);
    for (const plane of [upper, lower, outgoing]) restoreSnapshot.get(plane)?.();
    const full: Box = interrupted ?? { x: 0, y: 0, width: innerWidth, height: innerHeight };
    // 第一帧与详情完全相同：详情副本在上、空容器与列表副本从透明补上，再收缩回原卡片。
    // 先补上容器（0–8%），详情副本 4%–14% 淡出；列表副本在容器已不透明时才出现（B2 在玻璃模糊下 8%–14%）。
    this.animate(outgoing, hold([[0, { opacity: 1 }], [.04, { opacity: 1 }], [.14, { opacity: 0 }], [1, { opacity: 0 }]]), duration, "linear");
    if (reliable) {
      this.animate(shell, [
        { ...boxFrame(full, 0), offset: 0 }, { ...boxFrame(full, 0), offset: .14, easing: EASE },
        { ...boxFrame(rect, radius), offset: .9 }, { ...boxFrame(rect, radius), offset: 1 },
      ], duration, "linear");
      this.shellOpacity(shell, duration, true);
      this.animate(layer, style === "b2" ? hold([[0, { opacity: 0 }], [.08, { opacity: 0 }], [.14, { opacity: 1 }], [1, { opacity: 1 }]])
        : hold([[0, { opacity: 0 }], [.09, { opacity: 0 }], [.1, { opacity: 1 }], [1, { opacity: 1 }]]), duration, "linear");
    } else {
      // 来源已删除、改序或离开可视区：交叉淡出，不飞向过时坐标。
      this.animate(shell, [{ ...boxFrame(full, 0), opacity: 0 }, { ...boxFrame(full, 0), opacity: 0 }], duration, "linear");
      this.animate(layer, hold([[0, { opacity: 0 }], [.25, { opacity: 0 }], [1, { opacity: 1 }]]), duration, "linear");
    }
    this.animate(lift, style === "a" && reliable ? [{ opacity: .45 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 0 }], duration, "linear");
    if (style === "a") this.animate(shade, [{ opacity: .28 }, { opacity: 0 }], duration);
    for (const [node, side] of [[top, -1], [bottom, 1]] as const) {
      const rest: Keyframe = { transform: "translate3d(0,0px,0)", opacity: 1 };
      if (style === "b1") {
        const dy = side < 0 ? -(rect.y + 16) : innerHeight - rect.y - rect.height + 16;
        const pose: Keyframe = { transform: `translate3d(0,${dy}px,0)`, opacity: 1 };
        this.animate(node, reliable ? [{ ...pose, offset: 0 }, { ...pose, offset: .14, easing: EASE }, { ...rest, offset: .9 }, { ...rest, offset: 1 }] : [pose, rest], duration, reliable ? "linear" : EASE);
      } else if (style === "a") this.animate(node, [{ transform: `translate3d(0,${side * 4}px,0) scale(.98)`, opacity: .58 }, { transform: "translate3d(0,0px,0) scale(1)", opacity: 1 }], duration);
      else if (style === "c") this.animate(node, [{ transform: `translate3d(0,${side * 6}px,0)`, opacity: .72 }, rest], duration);
    }
    // 最后 20% 整个舞台淡出，露出已恢复滚动的真实页面：来源卡片的内容回到原位，
    // 异步补齐的数据（分析卡片的图表）也不会在舞台移除的一刻才跳出来。
    this.settle(stage, token, duration, () => {
      if (reliable && sourceNode?.isConnected) (sourceNode.matches("button,a") ? sourceNode : sourceNode.querySelector<HTMLElement>("button,a"))?.focus({ preventScroll: true });
    }, true);
  }

  private settle(stage: HTMLElement, token: number, duration: number, after: () => void, reveal = false): void {
    const fence = stage.animate(reveal ? hold([[0, { opacity: 1 }], [.8, { opacity: 1 }], [1, { opacity: 0 }]]) : [{ opacity: 1 }, { opacity: 1 }], { duration, fill: "both" });
    this.animations.push(fence);
    void fence.finished.then(() => {
      if (token !== this.generation) return;
      this.cancel(); after();
    }).catch(() => undefined);
  }
}
