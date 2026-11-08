import { runFrameClock, type FrameClock } from "../../lib/frameClock.js";
import { ENTER_MODE, MOTION_CLOCK, easingFunction } from "../../lib/motionTokens.js";

/**
 * 记账工作模式（enterMode）的进入、离开与工作区内切换。
 *
 * 1.19.45 起与主 Tab 交换同一套交接方式（见 tabExchange.ts）：
 * - **点击当帧就有响应，不等新页面**：新页面用 React transition 在后台渲染；点击后立即移动**真实的旧页面**，
 *   新工作区的“纸面”（与统一壁纸对齐的不透明底，`.mode-sheet`）从屏幕底边升起，先停在底栏上缘之下
 *   （`ENTER_MODE.hold`，被底栏挡住）。新页面提交后同一帧对齐进入，时钟放开。
 * - **不克隆**：React 移除旧页时把同一个节点接到舞台上继续响应（Tab 交换的做法）。
 * - **不重叠**：页面本身透明，新工作区带着与壁纸逐像素对齐的纸面（外层平移、内层反向平移）覆盖旧页，
 *   旧页内容不会透过新页出现；B1 是一条竖向轨道，两页之间隔 24px，不需要纸面。
 * - **不改变用户激活**：拍照的文件选择仍在卡片点击里同步打开，选完才导航；五个模式页都不在挂载时
 *   自动聚焦或读剪贴板，后台提交不影响任何浏览器权限。「再记一笔」需要把焦点交回金额框，
 *   所以那条切换是同步提交（见 {@link EnterModePresentation.again}）。
 *
 * 原页面按风格响应（参数在 `ENTER_MODE.styles`）：C 向上让出一段并略微压暗，A 退远（缩小）并压暗，
 * B1 与新工作区同轨上移，B2 原地被“雾化”（壁纸色的薄层，代替会破坏玻璃背景的滤镜）。
 */

export function enterModeOptions(search: string): { duration?: number } {
  const ms = Number(new URLSearchParams(search).get("enterMs"));
  return (ENTER_MODE.choices as readonly number[]).includes(ms) ? { duration: ms } : {};
}

type Style = "a" | "b1" | "b2" | "c";
const styleOf = (value: string): Style => (value === "a" || value === "b1" || value === "b2" ? value : "c");

export interface ModeRequest {
  /** 工作区里当前的页面节点（不含常驻底栏）。 */
  readonly pages: () => HTMLElement[];
  /** 请求提交目标页面；可以是异步的（React transition），呈现会等新页面出现再放开时钟。 */
  readonly commit: () => void;
  readonly style: string;
  /** true：离开记账工作区（回到主 Tab 或来源页）；false：进入。 */
  readonly exit?: boolean;
  /** `?enterMs=` 比较用。 */
  readonly duration?: number;
}

interface Held { node: HTMLElement; style: string | null }

/** 一次呈现的全部临时状态；release 后不留任何样式、动画或节点。 */
class Session {
  stage: HTMLElement | null = null;
  clock: FrameClock | null = null;
  animations: Animation[] = [];
  held: Held[] = [];
  released = false;
  /** 进入中的状态，供“进入尚未结束就返回”从当前姿态倒放。 */
  entering: { time: number; duration: number; frames: Keyframe[]; workspace: HTMLElement[]; arrived: boolean } | null = null;
  hold(node: HTMLElement): HTMLElement {
    if (!this.held.some(item => item.node === node)) this.held.push({ node, style: node.getAttribute("style") });
    return node;
  }
  track(animation: Animation): Animation { this.animations.push(animation); return animation; }
  release(): void {
    if (this.released) return;
    this.released = true;
    this.clock?.cancel(); this.clock = null;
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    for (const { node, style } of this.held) {
      if (style === null) node.removeAttribute("style"); else node.setAttribute("style", style);
      delete node.dataset.modeLive;
    }
    this.held = [];
    this.stage?.remove(); this.stage = null;
  }
}

const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 舞台：固定在视口上；进入时在真实页面之下（z -1），离开时在页面之上、底栏之下。 */
function createStage(style: Style, kind: "enter" | "exit" | "again"): HTMLElement {
  const stage = document.createElement("div");
  stage.className = "lv-shell mode-stage"; stage.dataset.shell = "contents";
  stage.dataset.modeStage = kind; stage.dataset.modeStyle = style;
  stage.inert = true; stage.setAttribute("aria-hidden", "true");
  return stage;
}
const layer = (name: string): HTMLElement => { const node = document.createElement("div"); node.className = name; return node; };

/** 节点离开文档时浏览器会丢掉滚动位置；接到舞台后一次性还原。 */
function scrollsOf(nodes: HTMLElement[]): () => void {
  const saved: [HTMLElement, number, number][] = [];
  for (const root of nodes) for (const node of [root, ...root.querySelectorAll<HTMLElement>("*")]) if (node.scrollTop || node.scrollLeft) saved.push([node, node.scrollTop, node.scrollLeft]);
  return () => { for (const [node, top, left] of saved) { node.scrollTop = top; node.scrollLeft = left; } };
}

/** 进入方向（工作区关闭 → 打开）的关键帧；离开时倒序使用。 */
function poses(style: Style, height: number) {
  const look = ENTER_MODE.styles[style];
  const travel = height + (style === "b1" ? ENTER_MODE.b1Gap : 0);
  const parent: Keyframe[] | null = style === "c" ? [{ transform: "translate3d(0,0px,0)" }, { transform: `translate3d(0,${-Math.round(ENTER_MODE.styles.c.shift * height)}px,0)` }]
    : style === "a" ? [{ transform: "scale(1)" }, { transform: `scale(${ENTER_MODE.styles.a.scale})` }]
    : style === "b1" ? [{ transform: "translate3d(0,0px,0)" }, { transform: `translate3d(0,${-travel}px,0)` }]
    : null;
  const veil = "veil" in look ? look.veil : 0;
  return {
    travel,
    parent,
    workspace: [{ transform: `translate3d(0,${travel}px,0)` }, { transform: "translate3d(0,0px,0)" }] as Keyframe[],
    backing: [{ transform: `translate3d(0,${-travel}px,0)` }, { transform: "translate3d(0,0px,0)" }] as Keyframe[],
    veil: veil > 0 ? [{ opacity: 0 }, { opacity: 0, offset: ENTER_MODE.hold }, { opacity: veil }] as Keyframe[] : null,
  };
}
const reversed = (frames: Keyframe[]): Keyframe[] => frames.slice().reverse().map(frame => frame.offset === undefined || frame.offset === null ? frame : { ...frame, offset: 1 - (frame.offset as number) });

/** 缓动进度到达 progress 的时间（毫秒）。 */
function timeAt(progress: number, duration: number, easing: string): number {
  const ease = easingFunction(easing);
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (ease(mid) < progress) lo = mid; else hi = mid; }
  return lo * duration;
}

export class EnterModePresentation {
  private flow: Session | null = null;
  private light: Session | null = null;
  get active(): boolean { return this.flow !== null; }

  /** 释放全部呈现，立即交付已经请求的页面。 */
  cancel(): void { this.cancelFlow(); this.light?.release(); this.light = null; }
  /** 只释放进入 / 离开（视口大幅变化时）；「再记一笔」的轻切换不受随后弹出的键盘影响。 */
  cancelFlow(): void { this.flow?.release(); this.flow = null; }

  run(request: ModeRequest): void {
    const previous = this.flow;
    const old = request.pages();
    if (!old.length || reduced() || document.hidden || typeof old[0]!.animate !== "function") { this.cancel(); request.commit(); return; }
    // 进入还没结束就离开：从当前姿态原路收回，而不是先跳到终点再重新播放。
    if (request.exit && previous?.entering?.arrived && !previous.released) { this.retreat(previous, request); return; }
    this.cancel();
    const session = new Session(); this.flow = session;
    if (request.exit) this.leave(session, request, old); else this.enter(session, request, old);
  }

  private enter(session: Session, request: ModeRequest, old: HTMLElement[]): void {
    const style = styleOf(request.style);
    const height = innerHeight;
    const { parent, workspace, backing, veil } = poses(style, height);
    const duration = request.duration ?? ENTER_MODE.enter.duration;
    const timing: KeyframeAnimationOptions = { duration, easing: ENTER_MODE.enter.easing, fill: "both" };
    const nav = document.querySelector<HTMLElement>("[data-persistent-nav]");
    const navHeight = nav && !nav.hidden ? nav.getBoundingClientRect().height : 0;
    // 新页面未到时纸面最多升到底栏上缘（被底栏挡住），不露出空白工作区。
    const hold = timeAt(Math.min(ENTER_MODE.hold, navHeight / height), duration, ENTER_MODE.enter.easing);
    const started = performance.now();

    const stage = createStage(style, "enter");
    const holder = layer("mode-plane");
    stage.append(holder);
    if (veil) { const node = layer("mode-veil"); stage.append(node); session.track(node.animate(veil, timing)); }
    if (style !== "b1") {
      const sheet = layer("mode-sheet"), base = layer("mode-backing");
      sheet.append(base); stage.append(sheet);
      session.track(sheet.animate(workspace, timing)); session.track(base.animate(backing, timing));
    }
    document.body.append(stage); session.stage = stage;
    const restore = scrollsOf(old);
    let early = parent ? old.map(node => session.track(session.hold(node).animate(parent, timing))) : [];
    let parked = false, arrived = false;
    const entering = { time: 0, duration, frames: workspace, workspace: [] as HTMLElement[], arrived: false };
    session.entering = entering;
    const park = (): void => {
      parked = true;
      for (const animation of early) session.clock?.remove(animation);
      early = [];
      holder.append(...old);
      restore();
      if (parent) session.clock?.add(session.track(holder.animate(parent, timing)));
    };
    const attach = (next: HTMLElement[]): void => {
      arrived = true; entering.arrived = true; entering.workspace = next;
      for (const node of next) { session.hold(node).dataset.modeLive = ""; session.clock?.add(session.track(node.animate(workspace, timing))); }
    };
    const step = (): void => {
      if (session.released) return;
      if (!parked && old.some(node => !node.isConnected)) park();
      if (!arrived) {
        const next = request.pages().filter(node => !old.includes(node));
        if (next.length && parked) attach(next);
        else if (performance.now() - started > ENTER_MODE.giveUpMs) this.finish(session);
      }
    };
    session.clock = runFrameClock(session.animations.slice(), duration, {
      name: "enterMode", maxStep: MOTION_CLOCK.maxStep,
      limit: () => arrived ? duration : hold,
      onProgress: progress => { entering.time = progress * duration; step(); },
      onDone: () => this.finish(session),
    });
    request.commit();
    // 同步提交（降级或测试）时，在本任务内接好，第一帧就是起始姿态。
    step();
  }

  private leave(session: Session, request: ModeRequest, old: HTMLElement[]): void {
    const style = styleOf(request.style);
    const height = innerHeight;
    const { parent, workspace, backing, veil } = poses(style, height);
    const duration = request.duration ?? ENTER_MODE.exit.duration;
    const timing: KeyframeAnimationOptions = { duration, easing: ENTER_MODE.exit.easing, fill: "both" };
    const restore = scrollsOf(old);
    const started = performance.now();
    let arrived = false;
    // 目标页面到达前什么都不动（离开的工作区仍完整盖着），到达当帧把工作区接到上层舞台再一起开始。
    const arrive = (next: HTMLElement[]): void => {
      arrived = true;
      const stage = createStage(style, "exit");
      if (veil) { const node = layer("mode-veil"); stage.append(node); session.clock?.add(session.track(node.animate(reversed(veil), timing))); }
      const holder = layer("mode-plane");
      if (style === "b1") stage.append(holder);
      else { const sheet = layer("mode-sheet"), base = layer("mode-backing"); sheet.append(base, holder); stage.append(sheet); session.clock?.add(session.track(sheet.animate(reversed(workspace), timing))); session.clock?.add(session.track(base.animate(reversed(backing), timing))); }
      holder.append(...old); restore();
      if (style === "b1") session.clock?.add(session.track(holder.animate(reversed(workspace), timing)));
      document.body.append(stage); session.stage = stage;
      if (parent) for (const node of next) session.clock?.add(session.track(session.hold(node).animate(reversed(parent), timing)));
    };
    const step = (): void => {
      if (session.released || arrived) return;
      const next = request.pages().filter(node => !old.includes(node));
      if (next.length && old.every(node => !node.isConnected)) arrive(next);
      else if (performance.now() - started > ENTER_MODE.giveUpMs) this.finish(session);
    };
    session.clock = runFrameClock([], duration, {
      name: "exitMode", maxStep: MOTION_CLOCK.maxStep,
      limit: () => arrived ? duration : 0,
      onProgress: step,
      onDone: () => this.finish(session),
    });
    request.commit();
    step();
  }

  /**
   * 进入中途返回：停下进入的时钟，所有动画从当前时间倒放回 0。React 提交返回页时，离开的工作区接到同一个舞台
   * 的最上层继续倒放；真实返回页先隐藏，由舞台里原样停着的旧页代表它，结束时再换回（两者是同一页面同一滚动）。
   */
  private retreat(session: Session, request: ModeRequest): void {
    const entering = session.entering!;
    session.clock?.cancel(); session.clock = null;
    session.entering = null;
    const stage = session.stage!;
    const workspace = entering.workspace;
    const from = entering.time;
    const back = Math.max(ENTER_MODE.retreatMin, ENTER_MODE.exit.duration * (from / entering.duration));
    const restore = scrollsOf(workspace);
    const started = performance.now();
    let parked = false;
    const step = (): void => {
      if (session.released || parked) return;
      if (workspace.length && workspace.every(node => !node.isConnected)) {
        parked = true;
        const top = layer("mode-plane"); top.dataset.modeTop = "";
        // 工作区节点自己的平移改由外层承担（与进入时旧页接到舞台的做法相同）。
        session.animations = session.animations.filter(animation => {
          const target = (animation.effect as KeyframeEffect | null)?.target;
          if (target && workspace.includes(target as HTMLElement)) { animation.cancel(); return false; }
          return true;
        });
        top.append(...workspace); restore(); stage.append(top);
        const animation = session.track(top.animate(entering.frames, { duration: entering.duration, easing: ENTER_MODE.enter.easing, fill: "both" }));
        animation.pause(); animation.currentTime = from;
        // 返回页先隐藏，由舞台里停着的旧页代表它；结束时恢复。
        for (const node of request.pages().filter(node => !workspace.includes(node))) session.hold(node).style.visibility = "hidden";
      } else if (performance.now() - started > ENTER_MODE.giveUpMs) this.finish(session);
    };
    // 返回页提交前最多倒放到 80%：工作区不会在提交前完全离开、再被真实页面盖回来。
    session.clock = runFrameClock([], back, {
      name: "exitMode", maxStep: MOTION_CLOCK.maxStep,
      limit: () => parked ? back : back * 0.8,
      onProgress: progress => {
        step();
        const time = from * (1 - progress);
        for (const animation of session.animations) animation.currentTime = time;
      },
      onDone: () => this.finish(session),
    });
    request.commit();
    step();
  }

  private finish(session: Session): void {
    session.release();
    if (this.flow === session) this.flow = null;
    if (this.light === session) this.light = null;
  }

  /**
   * 工作区内的轻切换：「再记一笔」、识别结果回到输入方式、换一种记账方式。上一屏（保存成功的那一笔）向上收起
   * 并淡出，新的一笔从下方轻轻升入。commit 可以同步（「再记一笔」需要在点击里把焦点交回金额框，
   * iOS 只在用户手势内弹出键盘），也可以是后台提交。
   *
   * 换下来的可能是整页（手动记账的成功屏），也可能只是页面里的一段（拍照识别的成功步骤在同一页里）：
   * 从成功屏（`[data-entry-saved]`，没有就是第一张页面）向上找到提交后仍在文档里的最近容器，
   * 它被换掉的直接子节点就是“上一屏”，新出现的子节点就是“新的一笔”。上一屏按原位置接到舞台上。
   */
  again(request: { readonly root: () => HTMLElement | null; readonly commit: () => void; readonly style: string }): void {
    this.light?.release(); this.light = null;
    const root = request.root();
    const own = (node: Element): node is HTMLElement => "dataset" in node && !node.matches("[data-persistent-nav], .persistent-nav-space");
    const first = root ? Array.from(root.children).find(own) : undefined;
    const anchor = root?.querySelector<HTMLElement>("[data-entry-saved]") ?? first;
    if (!root || !anchor || reduced() || document.hidden || typeof anchor.animate !== "function" || this.flow) { request.commit(); return; }
    const chain: HTMLElement[] = [];
    for (let node: HTMLElement | null = anchor; node && node !== root; node = node.parentElement) chain.push(node);
    chain.push(root);
    const before = new Map(chain.map(node => [node, Array.from(node.children).filter(own)]));
    const rects = new Map<HTMLElement, DOMRect>();
    for (const list of before.values()) for (const node of list) rects.set(node, node.getBoundingClientRect());
    const restore = scrollsOf([anchor]);
    const session = new Session(); this.light = session;
    const style = styleOf(request.style);
    const { duration, easing, rise, drop, out, in: enter } = ENTER_MODE.again;
    const timing: KeyframeAnimationOptions = { duration, easing, fill: "both" };
    const started = performance.now();
    let arrived = false;
    const arrive = (removed: HTMLElement[], added: HTMLElement[]): void => {
      arrived = true;
      const box = removed.map(node => rects.get(node)!).reduce((a, b) => {
        const top = Math.min(a.top, b.top), left = Math.min(a.left, b.left);
        return new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top);
      });
      const stage = createStage(style, "again"), holder = layer("mode-plane");
      Object.assign(holder.style, { inset: "auto", top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` });
      holder.append(...removed); restore(); stage.append(holder); document.body.append(stage); session.stage = stage;
      session.clock?.add(session.track(holder.animate([
        { transform: "translate3d(0,0px,0)", opacity: 1 },
        { transform: `translate3d(0,${-rise}px,0)`, opacity: 0, offset: out },
        { transform: `translate3d(0,${-rise}px,0)`, opacity: 0 },
      ], timing)));
      for (const node of added) session.clock?.add(session.track(session.hold(node).animate([
        { transform: `translate3d(0,${drop}px,0)`, opacity: 0 },
        { transform: `translate3d(0,${drop}px,0)`, opacity: 0, offset: enter },
        { transform: "translate3d(0,0px,0)", opacity: 1 },
      ], timing)));
    };
    const step = (): void => {
      if (session.released || arrived) return;
      const container = chain.find(node => node.isConnected);
      const previous = container ? before.get(container)! : [];
      const removed = previous.filter(node => !node.isConnected);
      const added = container ? Array.from(container.children).filter(own).filter(node => !previous.includes(node)) : [];
      if (removed.length && added.length) arrive(removed, added);
      else if (performance.now() - started > ENTER_MODE.giveUpMs) this.finish(session);
    };
    session.clock = runFrameClock([], duration, {
      name: "entryAgain", maxStep: MOTION_CLOCK.maxStep,
      limit: () => arrived ? duration : 0,
      onProgress: step,
      // 结束即移除全部动画（透明度动画不留在页面上，B2 玻璃需要真实背景）。
      onDone: () => this.finish(session),
    });
    request.commit();
    step();
  }
}
