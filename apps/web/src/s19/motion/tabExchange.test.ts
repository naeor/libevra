import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabExchangePresentation, tabIndex } from "./tabExchange.js";
import { TAB_SWITCH } from "../../lib/motionTokens.js";

class FakeAnimation {
  currentTime: number | null = null;
  cancel = vi.fn();
  pause = vi.fn();
  constructor(readonly node: Node, readonly frames: Keyframe[], readonly options: KeyframeAnimationOptions) {}
}
let queue: FrameRequestCallback[] = [];
let clockNow = 0;
/** 按 60Hz 推进若干帧。 */
const frames = (count: number): void => { for (let i = 0; i < count; i++) { clockNow += 16.7; const run = queue; queue = []; run.forEach(callback => callback(clockNow)); } };
class Style { [key: string]: unknown; setProperty(key: string, value: string) { this[key] = value; } }
class Node {
  style = new Style(); dataset: Record<string, string> = {}; className = ""; children: Node[] = []; parent: Node | null = null; inert = false;
  scrollTop = 0; scrollLeft = 0; attached = true; savedStyle: string | null = null;
  constructor(readonly name = "") {}
  get isConnected(): boolean { return this.parent ? this.parent.isConnected : this.attached; }
  append(...children: Node[]) { for (const n of children) { n.parent?.removeChild(n); n.parent = this; this.children.push(n); } }
  removeChild(n: Node) { this.children = this.children.filter(c => c !== n); n.parent = null; n.attached = false; }
  remove() { this.parent?.removeChild(this); }
  getAttribute() { return this.savedStyle; }
  setAttribute(_: string, value: string) { this.savedStyle = value; }
  removeAttribute() { this.savedStyle = null; this.style = new Style(); }
  querySelectorAll() { return []; }
  animate(frames: Keyframe[], options: KeyframeAnimationOptions) { const a = new FakeAnimation(this, frames, options); animations.push(a); return a; }
}
let animations: FakeAnimation[];
let body: Node;
const stagePlane = (): Node | undefined => body.children.find(n => n.className.includes("tab-stage"))?.children[0];
beforeEach(() => {
  animations = []; body = new Node("body"); queue = []; clockNow = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { queue.push(callback); return queue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("performance", { now: () => clockNow });
  vi.stubGlobal("document", { body, hidden: false, createElement: () => new Node() });
  vi.stubGlobal("window", { scrollY: 0 });
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => vi.unstubAllGlobals());

/** 模拟 React 在后台完成提交：旧页离开文档，工作区第一个子元素换成新页。 */
function react(pages: { current: Node }, next: Node): () => void {
  return () => { pages.current.attached = false; pages.current = next; };
}

describe("主 Tab 横向交换（新页面后台提交）", () => {
  it("点击当帧移动真实旧页；新页面提交前旧页只走到 waitFor，再慢速蠕动且不超过 waitMax", () => {
    const tabs = new TabExchangePresentation(), entries = new Node("entries");
    const pages = { current: entries };
    const commit = vi.fn();
    tabs.request({ from: tabIndex("/"), to: tabIndex("/stats"), page: () => pages.current as unknown as HTMLElement, commit });
    expect(commit).toHaveBeenCalledTimes(1);
    const [out] = animations;
    expect(out!.node).toBe(entries);
    expect(out!.frames.at(-1)?.transform).toBe("translate3d(-390px,0,0)");
    expect(out!.options).toMatchObject({ duration: TAB_SWITCH.duration, easing: TAB_SWITCH.easing });
    frames(1); expect(out!.currentTime).toBe(0);
    frames(1); expect(out!.currentTime).toBeGreaterThan(0);
    frames(1); expect(out!.currentTime).toBeGreaterThanOrEqual(TAB_SWITCH.waitFor); expect(out!.currentTime).toBeLessThan(TAB_SWITCH.waitFor + 5);
    frames(30); expect(out!.currentTime).toBeLessThanOrEqual(TAB_SWITCH.waitMax); expect(out!.currentTime).toBeGreaterThan(TAB_SWITCH.waitFor);
    tabs.dispose();
  });
  it("React 提交后同一帧：旧页节点接到舞台继续离开，新页面按当前时间对齐进入，结束后复原", () => {
    const tabs = new TabExchangePresentation(), entries = new Node("entries"), insights = new Node("insights");
    const pages = { current: entries };
    const commit = react(pages, insights);
    tabs.request({ from: 0, to: 1, page: () => pages.current as unknown as HTMLElement, commit: () => undefined });
    frames(2);
    commit();
    frames(1);
    expect(stagePlane()?.children).toContain(entries);
    const incoming = animations.find(a => a.node === insights)!;
    const parked = animations.filter(a => a.node === entries).at(-1)!;
    expect(incoming.frames[0]?.transform).toBe("translate3d(390px,0,0)");
    expect(incoming.currentTime).toBe(parked.currentTime);
    expect(insights.dataset.tabLive).toBe("");
    frames(30);
    expect(body.children).toHaveLength(0);
    expect(insights.dataset.tabLive).toBeUndefined();
  });
  it("快速连点只排最后一次，当前交换完成后从实际所在页出发", () => {
    const tabs = new TabExchangePresentation(), pages = ["/", "/stats", "/ledger", "/me"].map(p => new Node(p));
    const state = { current: pages[0]! };
    const go = (i: number) => vi.fn(() => { state.current.attached = false; state.current = pages[i]!; });
    const first = go(1), skipped = go(2), last = go(3);
    const page = () => state.current as unknown as HTMLElement;
    tabs.request({ from: 0, to: 1, page, commit: first });
    tabs.request({ from: 1, to: 2, page, commit: skipped });
    tabs.request({ from: 2, to: 3, page, commit: last });
    expect(first).toHaveBeenCalledTimes(1); expect(last).not.toHaveBeenCalled();
    frames(30);
    expect(skipped).not.toHaveBeenCalled(); expect(last).toHaveBeenCalledTimes(1);
    // 从分析（1）出发去我的（3）：仍是一次完整的向左交换。
    expect(animations.find(a => a.node === pages[1] && String(a.frames.at(-1)?.transform).startsWith("translate3d(-390px"))).toBeTruthy();
    tabs.dispose();
  });
  it("取消时立即交付排队中的目标；未提交的旧页样式复原", () => {
    const tabs = new TabExchangePresentation(), a = new Node(), c = new Node();
    a.savedStyle = "color: red";
    const state = { current: a };
    tabs.request({ from: 0, to: 3, page: () => state.current as unknown as HTMLElement, commit: () => undefined });
    const queued = vi.fn(() => { state.current = c; });
    tabs.request({ from: 3, to: 0, page: () => state.current as unknown as HTMLElement, commit: queued });
    frames(2);
    tabs.cancel();
    expect(queued).toHaveBeenCalledTimes(1); expect(body.children).toHaveLength(0);
    expect(a.savedStyle).toBe("color: red");
  });
  it("新页面迟迟不提交时放弃呈现，不让旧页停在半路", () => {
    const tabs = new TabExchangePresentation(), a = new Node();
    const done = vi.fn();
    tabs.request({ from: 0, to: 1, page: () => a as unknown as HTMLElement, commit: () => undefined, done });
    frames(Math.ceil(TAB_SWITCH.giveUpMs / 16.7) + 2);
    expect(done).toHaveBeenCalledTimes(1); expect(body.children).toHaveLength(0);
  });
  it("减少动态效果即时切换", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const commit = vi.fn();
    new TabExchangePresentation().request({ from: 0, to: 1, page: () => new Node() as unknown as HTMLElement, commit });
    expect(commit).toHaveBeenCalledTimes(1); expect(animations).toHaveLength(0);
  });
});
