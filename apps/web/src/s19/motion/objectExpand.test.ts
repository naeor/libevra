import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectExpandPresentation, contentFrame, findObject, setPose, type ObjectSource } from "./objectExpand.js";
import { OBJECT_EXPAND, easingFunction } from "../../lib/motionTokens.js";

vi.mock("./abcPresentation.js", () => ({ snapshot: () => { const plane = document.createElement("div"); (plane as unknown as Node).isClone = true; return plane; }, restoreSnapshot: new WeakMap() }));
class FakeAnimation {
  currentTime: number | null = null;
  finished = new Promise<void>(() => undefined);
  cancel = vi.fn();
  pause = vi.fn();
  effect: { target: Node; getTiming: () => { duration: number } };
  constructor(readonly node: Node, readonly frames: Keyframe[], readonly duration: number) { this.effect = { target: node, getTiming: () => ({ duration }) }; }
}
class Style {
  [key: string]: unknown;
  setProperty(key: string, value: string) { this[key] = value; }
  removeProperty(key: string) { delete this[key]; }
}
class Node {
  style = new Style(); dataset: Record<string, string> = {}; className = ""; isClone = false;
  classList = { add: vi.fn(), contains: (name: string) => this.className.split(" ").includes(name) };
  children: Node[] = []; sources: Node[] = []; parent: Node | null = null; attached = false;
  focus = vi.fn(); inert = false; scrollTop = 0; scrollLeft = 0; offsetHeight = 844; savedStyle: string | null = null;
  rect = { left: 0, top: 0, width: 390, height: 844 };
  firstElementChild: Node | null = null;
  get isConnected(): boolean { return this === body || this.attached || (this.parent?.isConnected ?? false); }
  append(...children: Node[]) { for (const n of children) { n.parent?.removeChild(n); n.parent = this; this.children.push(n); this.firstElementChild ??= n; } }
  removeChild(n: Node) { this.children = this.children.filter(c => c !== n); n.parent = null; n.attached = false; }
  remove() { this.parent?.removeChild(this); }
  getAttribute() { return this.savedStyle; }
  setAttribute(name: string, value: string) { if (name === "style") this.savedStyle = value; }
  removeAttribute(name: string) { if (name === "style") { this.savedStyle = null; this.style = new Style(); } }
  querySelectorAll(selector: string) { return selector === "*" ? [] : this.sources; }
  querySelector() { return null; }
  closest() { return null; }
  matches() { return true; }
  getBoundingClientRect() { return this.rect; }
  animate(frames: Keyframe[], options: { duration: number }) { const a = new FakeAnimation(this, frames, options.duration); animations.push(a); return a; }
}
let animations: FakeAnimation[];
let body: Node;
let queue: FrameRequestCallback[];
let now = 0;
const frames = (count: number): void => { for (let i = 0; i < count; i++) { now += 16.7; const run = queue; queue = []; run.forEach(callback => callback(now)); } };
const source: ObjectSource = { id: "/transactions/1", rect: { x: 24, y: 200, width: 342, height: 64 }, width: 390, height: 844, radius: 16, safeTop: 40, safeBottom: 780 };
const W = 390, H = 844;
beforeEach(() => {
  animations = []; body = new Node(); queue = []; now = 0;
  vi.stubGlobal("document", { body, hidden: false, createElement: () => new Node(), querySelector: () => null });
  vi.stubGlobal("window", { scrollY: 0 });
  vi.stubGlobal("innerWidth", W); vi.stubGlobal("innerHeight", H);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("getComputedStyle", () => ({ borderRadius: "16px", transform: "none", opacity: "1", width: "342px", height: "64px" }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { queue.push(callback); return queue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("performance", { now: () => now });
});
afterEach(() => vi.unstubAllGlobals());
const stage = (kind: "front" | "back"): Node | undefined => body.children.find(n => n.className.includes(`object-${kind}`));
const shellOf = (front: Node): Node => front.children.find(n => n.className.startsWith("object-shell"))!;
/** 工作区：页面节点挂在这里；React 提交时换成新页面。 */
function pane(first: Node) {
  const root = new Node(); root.attached = true; root.append(first);
  const state = { current: first };
  return {
    page: () => state.current as unknown as HTMLElement,
    swap: (next: Node) => { root.removeChild(state.current); state.current = next; root.append(next); },
  };
}

describe("Object Expand：卡片逐渐成为详情", () => {
  it("两个汇总槽配置相同指标时仍返回实际点击的那一个", () => {
    const root = new Node(), first = new Node(), second = new Node();
    first.dataset = { objectSource: "/ledger/metrics/balance", objectSlot: "0" };
    second.dataset = { objectSource: "/ledger/metrics/balance", objectSlot: "1" }; root.sources = [first, second];
    expect(findObject(root as unknown as HTMLElement, "/ledger/metrics/balance", "1")).toBe(second);
  });
  it("首帧样式写成静态值，键名转成 CSS 属性", () => {
    const node = new Node();
    setPose(node as unknown as HTMLElement, { transform: "translate3d(0px,200px,0) scale(1)", borderRadius: "16px", offset: 0, easing: "linear" });
    expect(node.style["transform"]).toBe("translate3d(0px,200px,0) scale(1)");
    expect(node.style["border-radius"]).toBe("16px");
    expect(node.style["offset"]).toBeUndefined();
  });
  it("cubic-bezier 求值与 CSS 定义一致", () => {
    const ease = easingFunction("cubic-bezier(.25,.1,.25,1)");
    expect(ease(0)).toBe(0); expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
  });
  it("详情内容按容器宽度等比缩放、顶端对齐，只露出容器高度；铺满时没有变换与裁剪", () => {
    const page = { left: 0, top: 0, width: W, height: H };
    const card = contentFrame({ x: 24, y: 200, width: 342, height: 64, scale: 1, radius: 16 }, page);
    const s = 342 / W;
    expect(card.transform).toBe(`translate3d(24px,200px,0) scale(${s})`);
    expect(card.clipPath).toBe(`inset(0px 0px ${H - 64 / s}px 0px round ${16 / s}px)`);
    expect(contentFrame({ x: 0, y: 0, width: W, height: H, scale: 1, radius: 0 }, page)).toEqual({ transform: "translate3d(0px,0px,0) scale(1)", clipPath: "inset(0px 0px 0px 0px round 0px)" });
  });
  it("展开：点击当下请求后台提交，容器从来源卡片开始；详情到达前最多长到中间帧", () => {
    const engine = new ObjectExpandPresentation(), list = new Node();
    const { page } = pane(list);
    const commit = vi.fn(), commitNow = vi.fn();
    engine.run({ source, page, commit, commitNow, style: "a" });
    expect(commit).toHaveBeenCalledTimes(1); expect(commitNow).not.toHaveBeenCalled();
    expect(list.inert).toBe(true);
    const shell = shellOf(stage("front")!);
    expect(shell.style["transform"]).toBe("translate3d(24px,200px,0) scale(1)");
    expect(shell.style["width"]).toBe("342px");
    expect(shell.style["opacity"]).toBe("0");
    frames(40);
    const geometry = animations.find(a => a.node === shell && a.frames.some(f => f.width))!;
    expect(geometry.currentTime).toBeLessThanOrEqual(OBJECT_EXPAND.open.duration * OBJECT_EXPAND.waitMax + 0.001);
    expect(geometry.currentTime).toBeGreaterThanOrEqual(OBJECT_EXPAND.open.duration * OBJECT_EXPAND.waitAt);
    engine.cancel(); expect(body.children).toHaveLength(0); expect(list.inert).toBe(false);
  });
  it("React 提交后同一帧：原页面接到背景舞台，详情放进容器并按当前时间对齐；结束后复原", () => {
    const engine = new ObjectExpandPresentation(), list = new Node(), detail = new Node();
    const { page, swap } = pane(list);
    engine.run({ source, page, commit: () => undefined, commitNow: vi.fn(), style: "c" });
    frames(2);
    swap(detail);
    frames(1);
    expect(stage("back")!.children[0]!.children).toContain(list);
    expect(detail.dataset.objectLive).toBe("c");
    expect(detail.style["zIndex"]).toBe("46");
    const shellTime = animations.find(a => a.node === shellOf(stage("front")!))!.currentTime;
    const content = animations.filter(a => a.node === detail);
    expect(content.map(a => a.currentTime)).toEqual([shellTime, shellTime]);
    // 内容在容器里，从当前容器姿态开始，不是整屏。
    const reveal = content.find(a => a.frames.some(f => f.opacity !== undefined))!;
    expect(reveal.frames[0]?.opacity).toBe(0);
    frames(40);
    expect(body.children).toHaveLength(0);
    expect(detail.dataset.objectLive).toBeUndefined();
    expect(detail.style["zIndex"]).toBeUndefined();
  });
  it("B1 上半页是真实页面（只留上半）、下半页是一张完整内容的副本", () => {
    const engine = new ObjectExpandPresentation(), list = new Node();
    const { page } = pane(list);
    engine.run({ source, page, commit: () => undefined, commitNow: vi.fn(), style: "b1" });
    expect(list.style["clipPath"]).toBe(`inset(0 0 ${H - 264}px 0)`);
    const lower = stage("back")!.children.find(n => n.className === "object-neighborhood")!;
    expect(lower.style["clipPath"]).toBe("inset(264px 0 0 0)");
    expect(animations.find(a => a.node === lower)?.frames.at(-1)?.transform).toBe(`translate3d(0,${H - 264 + 16}px,0)`);
    engine.cancel(); expect(body.children).toHaveLength(0);
  });
  it("详情到达前返回：同步把路由交回原页，容器沿当前姿态收回，不经过详情", () => {
    const engine = new ObjectExpandPresentation(), list = new Node();
    const { page } = pane(list);
    const back = vi.fn();
    engine.run({ source, page, commit: () => undefined, commitNow: vi.fn(), style: "c" });
    frames(3);
    engine.run({ source, page, commit: vi.fn(), commitNow: back, style: "c", reverse: true });
    expect(back).toHaveBeenCalledTimes(1);
    frames(15);
    expect(body.children).toHaveLength(0); expect(list.inert).toBe(false);
  });
  it("收回：同步提交列表，详情节点放进前景，在收缩的容器里回到实际来源卡片", () => {
    const engine = new ObjectExpandPresentation(), detail = new Node(), list = new Node(), card = new Node();
    card.dataset.objectSource = source.id; card.rect = { left: 24, top: 200, width: 342, height: 64 }; card.attached = true;
    list.sources = [card];
    const { page, swap } = pane(detail);
    const close = vi.fn(() => swap(list));
    engine.run({ source, page, commit: vi.fn(), commitNow: close, style: "b2", reverse: true });
    expect(close).toHaveBeenCalledTimes(1);
    const front = stage("front")!;
    expect(front.children.find(n => n.className.includes("object-content"))?.children).toContain(detail);
    const shrink = animations.find(a => a.node === shellOf(front) && a.frames.some(f => f.width))!;
    expect(shrink.frames.at(-1)?.transform).toBe("translate3d(24px,200px,0) scale(1)");
    // 列表在第一帧不可见（详情之下、容器补满之前）；出现后清掉首帧静态透明度。
    expect(list.style["opacity"]).toBe("0");
    frames(4); expect(list.style["opacity"]).toBeUndefined();
    frames(20);
    expect(body.children).toHaveLength(0); expect(card.focus).toHaveBeenCalledTimes(1);
  });
  it("来源已删除时详情原地淡出，不把容器飞向过时坐标", () => {
    const engine = new ObjectExpandPresentation(), detail = new Node(), list = new Node();
    const { page, swap } = pane(detail);
    engine.run({ source, page, commit: vi.fn(), commitNow: () => swap(list), style: "c", reverse: true });
    const shell = shellOf(stage("front")!);
    expect(animations.filter(a => a.node === shell).some(a => a.frames.some(f => f.width))).toBe(false);
    expect(animations.find(a => a.node === detail)?.frames.at(-1)?.opacity).toBe(0);
    engine.cancel(); expect(body.children).toHaveLength(0);
  });
  it("减少动态效果直接同步提交，不创建动画或舞台", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const commit = vi.fn(), commitNow = vi.fn();
    new ObjectExpandPresentation().run({ source, page: () => new Node() as unknown as HTMLElement, commit, commitNow, style: "a" });
    expect(commitNow).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
    expect(animations).toHaveLength(0); expect(body.children).toHaveLength(0);
  });
});
