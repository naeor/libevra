import { snapshot, restoreSnapshot } from "./abcPresentation.js";
import { EASE } from "../../../../../prototype/geometry.mjs";

export function enterModeOptions(search: string): { duration: number; fade: boolean } {
  const params = new URLSearchParams(search), ms = Number(params.get("enterMs"));
  return { duration: [110, 140, 160].includes(ms) ? ms : 140, fade: params.get("enterFade") === "1" };
}

/** 同一协调器内的 enterMode 呈现，不接管菜单、文件选择或路由提交。 */
export class EnterModePresentation {
  private stage: HTMLElement | null = null;
  private target: HTMLElement | null = null;
  private animations: Animation[] = [];
  private generation = 0;
  cancel(): void {
    this.generation++;
    this.animations.forEach(a => a.cancel()); this.animations = [];
    if (this.target) delete this.target.dataset.enterModeLive;
    this.target = null; this.stage?.remove(); this.stage = null;
  }
  run(page: () => HTMLElement | null, commit: () => void, style: string, options: { duration: number; fade: boolean }, reverse = false): void {
    const old = page();
    if (!old || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden || typeof old.animate !== "function") { this.cancel(); commit(); return; }
    const copy = snapshot(old);
    this.cancel();
    const token = this.generation;
    const nav = document.querySelector<HTMLElement>("[data-persistent-nav]");
    const bottom = nav && !nav.hidden ? nav.getBoundingClientRect().height : 0;
    const height = innerHeight - bottom;
    commit();
    const target = page(); if (!target) return;
    const stage = document.createElement("div"); stage.className = "lv-shell mode-stage"; stage.dataset.shell = "contents";
    stage.style.bottom = `${bottom}px`; stage.inert = true; stage.setAttribute("aria-hidden", "true");
    stage.append(copy); document.body.append(stage); restoreSnapshot.get(copy)?.(); this.stage = stage;
    this.target = target; target.dataset.enterModeLive = "";
    const animate = (node: HTMLElement, frames: Keyframe[], duration = options.duration, easing = EASE) => {
      const a = node.animate(frames, { duration, easing, fill: "both" }); this.animations.push(a); return a;
    };
    if (reverse) {
      stage.style.background = "transparent";
      delete target.dataset.enterModeLive;
      animate(copy, [{ clipPath: "inset(0 0 0 0)" }, { clipPath: `inset(${height}px 0 0 0)` }]);
      if (style === "b1") animate(target, [{ transform: `translate3d(0,-${height}px,0)` }, { transform: "translate3d(0,0,0)" }]);
      else if (style === "c") animate(target, [{ transform: "translateY(-6px)", opacity: .72 }, { transform: "translateY(0)", opacity: 1 }]);
    } else {
      animate(target, [{ clipPath: `inset(${height}px 0 0 0)` }, { clipPath: "inset(0 0 0 0)" }]);
      if (options.fade) animate(target, [{ opacity: 0 }, { opacity: 1 }], 28, "linear");
      if (style === "b1") animate(copy, [{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(0,-${height}px,0)` }]);
      else if (style === "c") animate(copy, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-6px)", opacity: .72 }]);
    }
    const fence = animate(stage, [{ opacity: 1 }, { opacity: 1 }]);
    void fence.finished.then(() => { if (token === this.generation) this.cancel(); }).catch(() => undefined);
  }
}
