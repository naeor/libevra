import { runFrameClock, type FrameClock } from "../../lib/frameClock.js";
import { MOTION_CLOCK, TAB_SWITCH } from "../../lib/motionTokens.js";
import "./tabExchange.css";

/**
 * 主 Tab 平级交换（switchTab）。同一平面上的两页共用一个时钟、宽度与 easing，整页横向交换；
 * 底栏、加号与统一壁纸不参与移动。排队语义沿用 Tab Switch Lab：正在交换时只记住最后一次点击，
 * 当前交换完成后再从实际所在页出发。
 *
 * 1.19.44：点击与新页面初始化解耦。
 * - 1.19.43 在点击处理里先克隆整页旧页、再同步提交新页面，分析页还要在提交后按网格尺寸再渲染全部卡片；
 *   这些都发生在第一帧位移之前，于是“点了以后先停一下，再一下子滑过去”（曲线前两帧就走完 67%）。
 * - 现在点击当帧就移动**真实的旧页面**，新页面用 React transition 在后台渲染、不占住帧；旧页先走到
 *   `TAB_SWITCH.waitFor`（约 8%），之后慢速蠕动（最多约 13%）等新页面。React 提交新页面时会把旧页从工作区移除——同一个节点随即
 *   接到交换舞台上继续离开（不克隆、不重算 SVG id），新页面按时钟当前时间对齐进入。两步都发生在同一帧
 *   绘制之前，屏幕上不会有缺页的一帧。
 * - 时长与曲线来自 Motion Token（tokens.ts），时间由帧锚定时钟推进。
 */
export const TAB_ORDER = ["/", "/stats", "/ledger", "/me"] as const;
export function tabIndex(pathname: string): number { return (TAB_ORDER as readonly string[]).indexOf(pathname); }

interface Pending {
  from: number; to: number;
  page: () => HTMLElement | null;
  /** 请求提交新页面；可以是异步的（React transition），交换会等到新页面出现再放开时钟。 */
  commit: () => void;
  done?: () => void;
}
interface Held { node: HTMLElement; style: string | null }

export class TabExchangePresentation {
  private stage: HTMLElement | null = null;
  private animations: Animation[] = [];
  private clock: FrameClock | null = null;
  private held: Held[] = [];
  private generation = 0;
  private queued: Pending | null = null;
  private runningTo = -1;
  constructor(private readonly duration = (): number => TAB_SWITCH.duration) {}
  get active(): boolean { return this.stage !== null; }

  /** 正在交换时排队（最后一次优先）；否则立即开始。 */
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
    for (const { node, style } of this.held) {
      if (style === null) node.removeAttribute("style"); else node.setAttribute("style", style);
      delete node.dataset.tabLive;
    }
    this.held = [];
    this.stage?.remove(); this.stage = null;
  }

  private hold(node: HTMLElement): HTMLElement {
    if (!this.held.some(item => item.node === node)) this.held.push({ node, style: node.getAttribute("style") });
    return node;
  }

  /** origin 是屏幕上实际所在的 Tab：排队项从上一次交换的终点出发，而不是从被覆盖的中间点击出发。 */
  private play({ from, to, page, commit, done }: Pending, origin = from): void {
    const old = page();
    // 排队期间页面可能已经回到目标（返回或重复点击），这时只交付，不重复交换。
    const direction = Math.sign(to - origin);
    if (!old || !direction || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden || typeof old.animate !== "function") {
      this.release(); commit(); done?.(); return;
    }
    this.release();
    const token = this.generation, started = performance.now();
    this.runningTo = to;
    const width = innerWidth, duration = this.duration();
    const timing: KeyframeAnimationOptions = { duration, easing: TAB_SWITCH.easing, fill: "both" };
    const leaving: Keyframe[] = [{ transform: "translate3d(0px,0,0)" }, { transform: `translate3d(${-direction * width}px,0,0)` }];
    const entering: Keyframe[] = [{ transform: `translate3d(${direction * width}px,0,0)` }, { transform: "translate3d(0px,0,0)" }];

    // 舞台：统一壁纸之上、真实页面之下；旧页被 React 移除后接到这里继续离开。
    const stage = document.createElement("div");
    stage.className = "lv-shell tab-stage"; stage.dataset.shell = "contents";
    stage.inert = true; stage.setAttribute("aria-hidden", "true");
    const plane = document.createElement("div"); plane.className = "s19-abc-plane";
    stage.append(plane); document.body.append(stage);
    this.stage = stage;

    // 旧页的滚动位置：节点离开文档时浏览器会丢掉它，接到舞台后一次性还原。
    const scrolls: [HTMLElement, number, number][] = [];
    for (const node of [old, ...old.querySelectorAll<HTMLElement>("*")]) if (node.scrollTop || node.scrollLeft) scrolls.push([node, node.scrollTop, node.scrollLeft]);
    const documentY = window.scrollY;

    let outgoing = this.track(this.hold(old).animate(leaving, timing));
    let parked = false, arrived = false;
    const park = (): void => {
      parked = true;
      this.clock?.remove(outgoing);
      plane.append(old);
      for (const [node, top, left] of scrolls) { node.scrollTop = top; node.scrollLeft = left; }
      plane.scrollTop = documentY;
      outgoing = this.track(old.animate(leaving, timing));
      this.clock?.add(outgoing);
    };
    const attach = (target: HTMLElement): void => {
      arrived = true;
      this.hold(target).dataset.tabLive = "";
      this.clock?.add(this.track(target.animate(entering, timing)));
    };
    this.clock = runFrameClock([outgoing], duration, {
      name: "switchTab",
      maxStep: MOTION_CLOCK.maxStep,
      // 新页面未到：先走到 waitFor，再慢速蠕动到 waitMax；到达后放开。
      limit: () => arrived ? duration : Math.min(TAB_SWITCH.waitMax, TAB_SWITCH.waitFor + Math.max(0, performance.now() - started - TAB_SWITCH.waitFor) * TAB_SWITCH.waitCreep),
      onProgress: () => {
        if (token !== this.generation) return;
        // React 提交新页面后才会到这里的下一帧：先把被移除的旧页接回舞台，再让新页面对齐进入，同一帧绘制。
        if (!parked && !old.isConnected) park();
        if (!arrived) {
          const target = page();
          if (target && target !== old && target.isConnected) attach(target);
          else if (performance.now() - started > TAB_SWITCH.giveUpMs) { this.release(); done?.(); this.pump(); }
        }
      },
      onDone: () => {
        if (token !== this.generation) return;
        this.clock = null; this.release(); done?.(); this.pump();
      },
    });
    commit();
  }

  private track(animation: Animation): Animation { this.animations.push(animation); return animation; }

  private pump(): void {
    const next = this.queued; this.queued = null;
    if (next) this.play(next, this.runningTo);
  }

  dispose(): void { this.cancel(); }
}
