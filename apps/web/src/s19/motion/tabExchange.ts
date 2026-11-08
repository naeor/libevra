import { snapshot, restoreSnapshot } from "./abcPresentation.js";
import { setPose } from "./objectExpand.js";
import { runFrameClock, type FrameClock } from "../../lib/frameClock.js";
import "./tabExchange.css";

/**
 * 主 Tab 平级交换（switchTab）。移植已验收的 Tab Switch Lab（experiments/tab-switch-lab/motion.mjs）：
 * 同一平面上的两页共用一个时钟、宽度与 easing，整页横向交换；底栏、加号与统一壁纸不参与移动。
 *
 * 正式应用只挂载当前路由，所以旧页用一次 inert 副本、新页直接移动真实 React 页面。
 * 排队语义与 Lab 相同：正在交换时只记住最后一次点击，当前交换完成后再从实际所在页出发。
 *
 * 1.19.43：时间由帧锚定时钟推进（lib/frameClock.ts）。1.19.42 在提交新页面后直接交给浏览器计时，
 * iPhone Safari 上整页副本与新页面的首次绘制吃掉了前一两百毫秒，第一帧就落在 90% 左右，
 * 看起来像“新页面先占满，再被拨进来一点”。现在第一帧固定是起始姿态，两页从同一帧开始同步移动。
 */
export const TAB_ORDER = ["/", "/stats", "/ledger", "/me"] as const;
export const TAB_EASING = "cubic-bezier(0.22, 0.68, 0, 1)";
export const TAB_DURATION = 200;
export function tabIndex(pathname: string): number { return (TAB_ORDER as readonly string[]).indexOf(pathname); }

interface Pending { from: number; to: number; page: () => HTMLElement | null; commit: () => void; done?: () => void }

export class TabExchangePresentation {
  private stage: HTMLElement | null = null;
  private animations: Animation[] = [];
  private clock: FrameClock | null = null;
  private real: { node: HTMLElement; style: string | null } | null = null;
  private generation = 0;
  private queued: Pending | null = null;
  private runningTo = -1;
  constructor(private readonly duration = (): number => TAB_DURATION) {}
  get active(): boolean { return this.stage !== null; }

  /** 正在交换时排队（最后一次优先）；否则立即提交并交换。 */
  request(next: Pending): void {
    if (this.stage) { this.queued?.done?.(); this.queued = next; return; }
    this.play(next);
  }

  /** 释放呈现并立刻交付排队中的最终页面；不遗留半页或未提交的点击。 */
  cancel(): void {
    this.release();
    const queued = this.queued; this.queued = null;
    if (queued) { queued.commit(); queued.done?.(); }
  }

  private release(): void {
    ++this.generation;
    this.clock?.cancel(); this.clock = null;
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    if (this.real) {
      if (this.real.style === null) this.real.node.removeAttribute("style"); else this.real.node.setAttribute("style", this.real.style);
      delete this.real.node.dataset.tabLive;
    }
    this.real = null; this.stage?.remove(); this.stage = null;
  }

  /** origin 是屏幕上实际所在的 Tab：排队项从上一次交换的终点出发，而不是从被覆盖的中间点击出发。 */
  private play({ from, to, page, commit, done }: Pending, origin = from): void {
    const old = page();
    // 排队期间页面可能已经回到目标（返回或重复点击），这时只交付，不重复交换。
    const direction = Math.sign(to - origin);
    if (!old || !direction || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden || typeof old.animate !== "function") {
      this.release(); commit(); done?.(); return;
    }
    const outgoing = snapshot(old);
    this.release();
    const token = this.generation;
    commit();
    this.runningTo = to;
    const target = page();
    if (!target || target === old) { done?.(); this.pump(); return; }
    const stage = document.createElement("div");
    stage.className = "lv-shell tab-stage"; stage.dataset.shell = "contents";
    stage.inert = true; stage.setAttribute("aria-hidden", "true");
    stage.append(outgoing); document.body.append(stage); restoreSnapshot.get(outgoing)?.();
    this.stage = stage;
    this.real = { node: target, style: target.getAttribute("style") };
    target.dataset.tabLive = "";
    const width = innerWidth, duration = this.duration();
    const timing: KeyframeAnimationOptions = { duration, easing: TAB_EASING, fill: "both" };
    const move = (node: HTMLElement, frames: Keyframe[]): Animation => {
      setPose(node, frames[0]!);
      const animation = node.animate(frames, timing); this.animations.push(animation); return animation;
    };
    // 两页并排：旧页离开 -direction，新页从 +direction 进入，始终相距一个视口宽度。
    move(outgoing, [{ transform: "translate3d(0px,0,0)" }, { transform: `translate3d(${-direction * width}px,0,0)` }]);
    move(target, [{ transform: `translate3d(${direction * width}px,0,0)` }, { transform: "translate3d(0px,0,0)" }]);
    this.clock = runFrameClock(this.animations, duration, { name: "switchTab", onDone: () => {
      if (token !== this.generation) return;
      this.clock = null; this.release(); done?.(); this.pump();
    } });
  }

  private pump(): void {
    const next = this.queued; this.queued = null;
    if (next) this.play(next, this.runningTo);
  }

  dispose(): void { this.cancel(); }
}
