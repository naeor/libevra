import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectExpandPresentation, findObject, setPose, type ObjectSource } from "./objectExpand.js";
import { EnterModePresentation } from "./enterMode.js";

vi.mock("./abcPresentation.js", () => ({ snapshot: () => { const plane = document.createElement("div"); (plane as unknown as Node).isClone = true; return plane; }, restoreSnapshot: new WeakMap() }));
class FakeAnimation {
  currentTime: number | null = null;
  resolve!: () => void;
  finished = new Promise<void>(resolve => { this.resolve = resolve; });
  cancel = vi.fn();
  pause = vi.fn();
  effect: { target: Node };
  constructor(readonly node: Node, readonly frames: Keyframe[], readonly duration: number) { this.effect = { target: node }; }
}
class Style {
  [key: string]: unknown;
  setProperty(key: string, value: string) { this[key] = value; }
  removeProperty(key: string) { delete this[key]; }
}
class Node {
  style = new Style(); dataset: Record<string, string> = {}; className = ""; isClone = false;
  classList = { add: vi.fn(), contains: (name: string) => this.className.split(" ").includes(name) };
  children: Node[] = []; sources: Node[] = []; parent: Node | null = null;
  focus = vi.fn(); inert = false;
  get isConnected(): boolean { let node: Node | null = this; while (node) { if (node === body) return true; node = node.parent; } return false; }
  append(...children: Node[]) { this.children.push(...children); children.forEach(n => { n.parent = this; }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
  getAttribute() { return null; }
  setAttribute() {}
  removeAttribute() { this.style = new Style(); }
  querySelectorAll() { return this.sources; }
  querySelector() { return null; }
  closest() { return null; }
  matches() { return true; }
  getBoundingClientRect() { return { left: 0, top: 200, width: 390, height: 64 }; }
  animate(frames: Keyframe[], options: { duration: number }) { const a = new FakeAnimation(this, frames, options.duration); animations.push(a); return a; }
}
let animations: FakeAnimation[];
let body: Node;
let queue: FrameRequestCallback[];
let now = 0;
const frames = (count: number): void => { for (let i = 0; i < count; i++) { const run = queue; queue = []; run.forEach(callback => callback(now)); now += 16.7; } };
const source: ObjectSource = { id: "/transactions/1", rect: { x: 0, y: 200, width: 390, height: 64 }, width: 390, height: 844, radius: 16, safeTop: 40, safeBottom: 780 };
beforeEach(() => {
  animations = []; body = new Node(); queue = []; now = 0;
  vi.stubGlobal("document", { body, hidden: false, createElement: () => new Node(), querySelector: () => null });
  vi.stubGlobal("innerWidth", 390); vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("getComputedStyle", () => ({ borderRadius: "16px", transform: "none", opacity: "1" }));
  vi.stubGlobal("DOMRect", class { left = 0; top = 0; });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { queue.push(callback); return queue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("performance", { now: () => now });
});
afterEach(() => vi.unstubAllGlobals());
const front = (): Node => body.children.find(n => n.className.includes("object-front"))!;
const shellOf = (stage: Node): Node => stage.children.find(n => n.className.startsWith("object-shell"))!;

describe("Object Expand：在真实原页面上展开", () => {
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
  it("点击当下不提交路由：容器从来源卡片开始，45% 覆盖视口后才在背后提交详情", () => {
    const engine = new ObjectExpandPresentation(), list = new Node(), detail = new Node();
    let current = list;
    const commit = vi.fn(() => { current = detail; });
    engine.run({ source, page: () => current as unknown as HTMLElement, commit, style: "a" });
    expect(commit).not.toHaveBeenCalled();
    expect(list.inert).toBe(true);
    const shell = shellOf(front());
    expect(shell.style["transform"]).toBe("translate3d(0px,200px,0) scale(1)");
    expect(shell.style["width"]).toBe("390px");
    expect(shell.style["opacity"]).toBe("0");
    frames(1); expect(commit).not.toHaveBeenCalled();
    frames(5); expect(commit).not.toHaveBeenCalled();
    frames(1); expect(commit).toHaveBeenCalledTimes(1);
    // 详情在容器上方，从 0 开始显现，不会整页先出现。
    expect(detail.style["zIndex"]).toBe("46");
    const reveal = animations.find(a => a.node === detail)!;
    expect(reveal.frames.map(f => [f.offset, f.opacity])).toEqual([[0, 0], [.45, 0], [.62, .75], [.8, 1], [1, 1]]);
    expect(reveal.currentTime).toBeGreaterThanOrEqual(90);
    frames(8);
    expect(body.children).toHaveLength(0);
    expect(list.inert).toBe(false);
  });
  it("B1 上半页是真实页面、下半页是一张副本，两半完整挤出可视区", () => {
    const engine = new ObjectExpandPresentation(), list = new Node();
    engine.run({ source, page: () => list as unknown as HTMLElement, commit: vi.fn(), style: "b1" });
    expect(list.style["clipPath"]).toBe("inset(0 0 580px 0)");
    expect(animations.find(a => a.node === list)?.frames.at(-1)?.transform).toBe("translate3d(0,-280px,0)");
    const back = body.children.find(n => n.className.includes("object-back"))!;
    const lower = back.children[0]!;
    expect(animations.find(a => a.node === lower)?.frames.at(-1)?.transform).toBe("translate3d(0,596px,0)");
    engine.cancel(false); expect(body.children).toHaveLength(0);
  });
  it("B2 前 30% 不给原页面透明度动画，玻璃卡片保持原样", () => {
    const engine = new ObjectExpandPresentation(), list = new Node();
    engine.run({ source, page: () => list as unknown as HTMLElement, commit: vi.fn(), style: "b2" });
    frames(4); expect(animations.some(a => a.node === list)).toBe(false);
    frames(1); expect(animations.some(a => a.node === list)).toBe(true);
    engine.cancel(false);
  });
  it("交接前返回：路由交回原页，容器沿当前姿态收回，详情从未提交", () => {
    const engine = new ObjectExpandPresentation(), list = new Node(), card = new Node();
    card.dataset.objectSource = source.id; list.sources = [card];
    const open = vi.fn(), back = vi.fn();
    engine.run({ source, page: () => list as unknown as HTMLElement, commit: open, style: "c" });
    frames(3);
    engine.run({ source, page: () => list as unknown as HTMLElement, commit: back, style: "c", reverse: true });
    expect(back).toHaveBeenCalledTimes(1);
    frames(10);
    expect(open).not.toHaveBeenCalled();
    expect(body.children).toHaveLength(0); expect(list.inert).toBe(false);
  });
  it("收回：先提交列表，详情副本挡住首帧，容器收缩到实际来源", () => {
    const engine = new ObjectExpandPresentation(), list = new Node(), detail = new Node(), card = new Node();
    card.dataset.objectSource = source.id; list.sources = [card];
    Object.defineProperty(card, "isConnected", { value: true });
    let current = detail;
    const close = vi.fn(() => { current = list; });
    engine.run({ source, page: () => current as unknown as HTMLElement, commit: close, style: "b2", reverse: true });
    expect(close).toHaveBeenCalledTimes(1);
    const stage = front();
    expect(stage.children.some(n => n.isClone)).toBe(true);
    const shrink = animations.find(a => a.node === shellOf(stage) && a.frames.some(f => f.width))!;
    expect(shrink.frames.at(-1)?.transform).toBe("translate3d(0px,200px,0) scale(1)");
    // 列表在第一帧不可见（详情副本之下），之后才出现。
    expect(list.style["opacity"]).toBe("0");
    // 出现完成、透明度动画移出时钟后，列表不能停在首帧写入的透明度 0。
    frames(4); expect(list.style["opacity"]).toBeUndefined();
    expect(animations.find(a => a.node === list && a.frames.some(f => f.opacity === 0))?.cancel).toHaveBeenCalled();
    frames(10);
    expect(body.children).toHaveLength(0); expect(card.focus).toHaveBeenCalledTimes(1);
  });
  it("来源已删除时淡出，不把容器飞向保存的过时坐标", () => {
    const engine = new ObjectExpandPresentation(), page = () => new Node() as unknown as HTMLElement;
    engine.run({ source, page, commit: vi.fn(), style: "c", reverse: true });
    const shell = shellOf(front());
    const frames = animations.filter(a => a.node === shell).flatMap(a => a.frames);
    expect(frames.every(f => f.transform === undefined || f.transform === "translate3d(0px,0px,0) scale(1)")).toBe(true);
    expect(frames.find(f => f.width)?.opacity).toBe(0);
    engine.cancel(); expect(body.children).toHaveLength(0);
  });
  it("减少动态效果直接提交，不创建动画或舞台", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const commit = vi.fn();
    new ObjectExpandPresentation().run({ source, page: () => new Node() as unknown as HTMLElement, commit, style: "a" });
    expect(commit).toHaveBeenCalledTimes(1); expect(animations).toHaveLength(0); expect(body.children).toHaveLength(0);
  });
  it("B1 工作模式按工作区高度完全向上离屏，不是小幅退让", () => {
    const engine = new EnterModePresentation(), old = new Node(), next = new Node();
    let current = old;
    engine.run(() => current as unknown as HTMLElement, () => { current = next; }, "b1", { duration: 140, fade: false });
    expect(animations[1]?.frames.at(-1)?.transform).toBe("translate3d(0,-844px,0)");
    engine.cancel(); expect(body.children).toHaveLength(0); expect(next.dataset.enterModeLive).toBeUndefined();
  });
});
