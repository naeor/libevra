import { boxFrame, EASE, expansionFrames, EXPANSION_MIDDLE, relativeRect, reliableTarget, type Box } from "../../../../../prototype/geometry.mjs";
import { snapshot, restoreSnapshot } from "./abcPresentation.js";
import "./objectExpand.css";

export interface ObjectSource { id: string; slot?: string; rect: Box; width: number; height: number; radius: number; safeTop: number; safeBottom: number }
export function objectSource(node: HTMLElement): ObjectSource {
  const rect = node.getBoundingClientRect();
  const nav = document.querySelector<HTMLElement>("[data-persistent-nav]:not([hidden])");
  const header = node.closest(".lv-pane-scroll")?.querySelector<HTMLElement>(".detail-header-row, .tab-page-header, [data-page-nav]");
  return { id: node.dataset.objectSource!, slot: node.dataset.objectSlot ?? "", rect: relativeRect(rect, new DOMRect()), width: innerWidth, height: innerHeight,
    safeTop: header?.getBoundingClientRect().bottom ?? 0, safeBottom: nav?.getBoundingClientRect().top ?? innerHeight,
    radius: parseFloat(getComputedStyle(node).borderRadius) || 16 };
}
export function findObject(root: HTMLElement | null, id: string, slot = ""): HTMLElement | null {
  return [...root?.querySelectorAll<HTMLElement>("[data-object-source]") ?? []].find(node => node.dataset.objectSource === id && (node.dataset.objectSlot ?? "") === slot) ?? null;
}

/** 路由呈现适配器：直接复用已验收原型的几何、关键帧与返回判定；不拥有历史或业务内容。
 * 快照只作 inert 背景，真实详情始终是原 React 页面，文字只改变 opacity。
 */
export class ObjectExpandPresentation {
  private stage: HTMLElement | null = null;
  private shell: HTMLElement | null = null;
  private animations: Animation[] = [];
  private real: { node: HTMLElement; style: string | null } | null = null;
  private hidden: { node: HTMLElement; value: string } | null = null;
  private generation = 0;
  private animate(node: HTMLElement, frames: Keyframe[], duration: number, easing = EASE): Animation {
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
    if (this.hidden) this.hidden.node.style.visibility = this.hidden.value;
    this.hidden = null; this.real = null; this.stage?.remove(); this.stage = this.shell = null;
  }
  run({ source, page, commit, style, reverse = false, duration = 200 }: {
    source: ObjectSource; page: () => HTMLElement | null; commit: () => void; style: string; reverse?: boolean; duration?: number;
  }): void {
    const old = page();
    if (!old || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden || typeof old.animate !== "function") {
      this.cancel(); commit(); return;
    }
    // 中断只读一次当前容器几何，反向从当前位置继续。
    const interrupted = this.shell ? relativeRect(this.shell.getBoundingClientRect(), new DOMRect()) : null;
    const outgoing = old ? snapshot(old) : null;
    const outgoingLower = old ? snapshot(old) : null;
    this.cancel();
    if (!outgoing) { commit(); return; }
    const token = this.generation;
    commit();
    const target = page();
    if (!target) return;
    const sourceNode = reverse ? findObject(target, source.id, source.slot) : null;
    const now = sourceNode ? objectSource(sourceNode).rect : null;
    const reliable = !reverse || reliableTarget(source.rect, now, { width: innerWidth, height: innerHeight }, source.width !== innerWidth || source.height !== innerHeight)
      && !!now && now.y >= source.safeTop - 1 && now.y + now.height <= source.safeBottom + 1;
    const stage = document.createElement("div"); stage.className = "lv-shell object-stage"; stage.dataset.shell = "contents"; stage.dataset.objectStyle = style;
    stage.inert = true; stage.setAttribute("aria-hidden", "true");
    this.stage = stage; document.body.append(stage);
    const background = reverse ? snapshot(target) : outgoing;
    const clonedSource = findObject(background, source.id, source.slot);
    if (clonedSource) clonedSource.style.visibility = "hidden";
    // 两个裁切平面保持各自内部间距；B1 的上下区域真正越出视口，没有 24px 退让上限。
    const upper = document.createElement("div"), lower = document.createElement("div");
    upper.className = lower.className = "object-neighborhood";
    const splitTop = source.rect.y, splitBottom = source.rect.y + source.rect.height;
    upper.style.clipPath = `inset(0 0 ${Math.max(0, innerHeight - splitTop)}px 0)`;
    lower.style.clipPath = `inset(${splitBottom}px 0 0 0)`;
    const lowerCopy = reverse ? snapshot(target) : outgoingLower!;
    const lowerSource = findObject(lowerCopy, source.id, source.slot); if (lowerSource) lowerSource.style.visibility = "hidden";
    upper.append(background); lower.append(lowerCopy); stage.append(upper, lower);
    restoreSnapshot.get(background)?.(); restoreSnapshot.get(lowerCopy)?.();
    const shell = document.createElement("div"); shell.className = "object-shell lv-material-effects"; stage.append(shell); this.shell = shell;
    const full: Box = { x: 0, y: 0, width: innerWidth, height: innerHeight };
    const middle: Box = { ...source.rect };
    for (const key of ["x", "y", "width", "height"] as const) middle[key] += (full[key] - middle[key]) * EXPANSION_MIDDLE;
    const expanded = boxFrame(full, 0);
    const frames = reverse ? [
      { ...boxFrame(interrupted ?? full, 0), offset: 0 }, { ...boxFrame(interrupted ?? full, 0), offset: .1, easing: EASE },
      { ...boxFrame(now ?? source.rect, source.radius), offset: .9 }, { ...boxFrame(now ?? source.rect, source.radius), offset: 1 },
    ] : expansionFrames(boxFrame(source.rect, source.radius), boxFrame(middle, source.radius, style === "a" ? 1.1 : 1), expanded);
    this.animate(shell, reliable ? frames : [{ ...expanded, opacity: 1 }, { ...expanded, opacity: 0 }], duration, "linear");
    for (const [node, dy] of [[upper, -splitTop - 16], [lower, innerHeight - splitBottom + 16]] as const) {
      const rest: Keyframe = { transform: "translate3d(0,0,0)", opacity: 1 };
      const pose: Keyframe = style === "b1" ? { transform: `translate3d(0,${dy}px,0)`, opacity: 1 }
        : style === "a" ? { transform: `translate3d(0,${Math.sign(dy) * 4}px,0) scale(.98)`, opacity: .58 }
        : style === "c" ? { transform: `translate3d(0,${Math.sign(dy) * 6}px,0)`, opacity: .72 } : rest;
      this.animate(node, reverse ? [pose, rest] : expansionFrames(rest, { ...pose, transform: style === "b1" ? `translate3d(0,${dy * EXPANSION_MIDDLE}px,0)` : pose.transform }, pose), duration, "linear");
    }
    if (reverse) {
      if (sourceNode) { this.hidden = { node: sourceNode, value: sourceNode.style.visibility }; sourceNode.style.visibility = "hidden"; }
      outgoing.classList.add("object-outgoing"); stage.append(outgoing); restoreSnapshot.get(outgoing)?.();
      this.animate(outgoing, [{ opacity: 1 }, { opacity: 0 }], duration * .15, "linear");
    } else {
      this.real = { node: target, style: target.getAttribute("style") };
      target.dataset.objectLive = style;
      Object.assign(target.style, { position: "relative", zIndex: "21" });
      this.animate(target, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .55 }, { opacity: 1, offset: 1 }], duration, "linear");
    }
    const fence = this.animate(stage, [{ opacity: 1 }, { opacity: 1 }], duration, "linear");
    void fence.finished.then(() => {
      if (token !== this.generation) return;
      // B2 保留少量真实来源轮廓；其余样式完成后立即释放所有呈现副本。
      if (style !== "b2" || reverse) {
        this.cancel();
        if (reverse && sourceNode) (sourceNode.matches("button,a") ? sourceNode : sourceNode.querySelector<HTMLElement>("button,a"))?.focus({ preventScroll: true });
      }
      else {
        Object.assign(shell.style, boxFrame(full, 0)); target.style.opacity = "1";
        for (const a of this.animations) a.cancel();
        this.animations = []; stage.dataset.objectSettled = "";
      }
    }).catch(() => undefined);
  }
}
