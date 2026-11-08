import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectExpandPresentation, findObject, setPose, type ObjectSource } from "./objectExpand.js";
import { EnterModePresentation } from "./enterMode.js";

vi.mock("./abcPresentation.js", () => ({ snapshot: () => document.createElement("div"), restoreSnapshot: new WeakMap() }));
class FakeAnimation {
  resolve!: () => void;
  finished = new Promise<void>(resolve => { this.resolve = resolve; });
  cancel = vi.fn();
  constructor(readonly node: Node, readonly frames: Keyframe[], readonly duration: number) {}
}
class Style {
  [key: string]: unknown;
  setProperty(key: string, value: string) { this[key] = value; }
  removeProperty(key: string) { delete this[key]; }
}
class Node {
  style = new Style(); dataset: Record<string, string> = {}; className = "";
  classList = { add: vi.fn() }; children: Node[] = []; sources: Node[] = []; parent: Node | null = null;
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
const source: ObjectSource = { id: "/transactions/1", rect: { x: 0, y: 200, width: 390, height: 64 }, width: 390, height: 844, radius: 16, safeTop: 40, safeBottom: 780 };
beforeEach(() => {
  animations = []; body = new Node();
  vi.stubGlobal("document", { body, hidden: false, createElement: () => new Node(), querySelector: () => null });
  vi.stubGlobal("innerWidth", 390); vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("getComputedStyle", () => ({ borderRadius: "16px" }));
  vi.stubGlobal("DOMRect", class { left = 0; top = 0; });
});
afterEach(() => vi.unstubAllGlobals());
const stage = (): Node => body.children[0]!;
const shellOf = (s: Node): Node => s.children.find(n => n.className.startsWith("object-shell"))!;

describe("对象呈现生命周期", () => {
  it("两个汇总槽配置相同指标时仍返回实际点击的那一个", () => {
    const root = new Node(), first = new Node(), second = new Node();
    first.dataset = { objectSource: "/ledger/metrics/balance", objectSlot: "0" };
    second.dataset = { objectSource: "/ledger/metrics/balance", objectSlot: "1" }; root.sources = [first, second];
    expect(findObject(root as unknown as HTMLElement, "/ledger/metrics/balance", "1")).toBe(second);
  });
  it("首帧写成静态样式：Safari 合成器晚一帧时容器不会落在左上角、详情也不会先整页出现", () => {
    const node = new Node();
    setPose(node as unknown as HTMLElement, { transform: "translate3d(0px,200px,0) scale(1)", borderRadius: "16px", offset: 0, easing: "linear" });
    expect(node.style["transform"]).toBe("translate3d(0px,200px,0) scale(1)");
    expect(node.style["border-radius"]).toBe("16px");
    expect(node.style["offset"]).toBeUndefined();

    const engine = new ObjectExpandPresentation(), list = new Node(), detail = new Node();
    let current = list;
    engine.run({ source, page: () => current as unknown as HTMLElement, commit: () => { current = detail; }, style: "a" });
    const shell = shellOf(stage());
    expect(shell.style["transform"]).toBe("translate3d(0px,200px,0) scale(1)");
    expect(shell.style["width"]).toBe("390px");
    expect(detail.style["opacity"]).toBe("0");
    expect(detail.style["zIndex"]).toBe("46");
    // 详情在 55% 之后才显现；容器在 60% 铺满后与详情交接。
    const reveal = animations.find(a => a.node === detail)!;
    expect(reveal.frames.map(f => [f.offset, f.opacity])).toEqual([[0, 0], [.55, 0], [1, 1]]);
  });
  it("B1 工作模式按工作区高度完全向上离屏，不是小幅退让", () => {
    const engine = new EnterModePresentation(), old = new Node(), next = new Node();
    let current = old;
    engine.run(() => current as unknown as HTMLElement, () => { current = next; }, "b1", { duration: 140, fade: false });
    expect(animations[1]?.frames.at(-1)?.transform).toBe("translate3d(0,-844px,0)");
    engine.cancel(); expect(body.children).toHaveLength(0); expect(next.dataset.enterModeLive).toBeUndefined();
  });
  it("B1 展开把上下两半完整挤出可视区；B2 后方不动", () => {
    for (const style of ["b1", "b2"]) {
      animations = [];
      const engine = new ObjectExpandPresentation(), list = new Node(), detail = new Node();
      let current = list;
      engine.run({ source, page: () => current as unknown as HTMLElement, commit: () => { current = detail; }, style });
      const halves = stage().children[0]!.children.filter(n => n.className === "object-neighborhood");
      const moves = halves.map(half => animations.find(a => a.node === half)?.frames.at(-1)?.transform);
      expect(moves).toEqual(style === "b1" ? ["translate3d(0,-216px,0)", "translate3d(0,596px,0)"] : [undefined, undefined]);
      engine.cancel();
    }
  });
  it("快速返回时提交各一次，旧完成回调不能撤掉正在收缩的新容器", async () => {
    const engine = new ObjectExpandPresentation(), list = new Node(), detail = new Node(), card = new Node();
    card.dataset.objectSource = source.id; list.sources = [card];
    Object.defineProperty(card, "isConnected", { value: true });
    let current = list;
    const open = vi.fn(() => { current = detail; }), close = vi.fn(() => { current = list; });
    const page = () => current as unknown as HTMLElement;
    engine.run({ source, page, commit: open, style: "b2" });
    const oldFence = animations.at(-1)!;
    engine.run({ source, page, commit: close, style: "b2", reverse: true });
    oldFence.resolve(); await Promise.resolve();
    expect(body.children).toHaveLength(1);
    expect(open).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
    // 收缩回实际来源，第一帧从中断时的容器位置接续。
    const shrink = animations.find(a => a.node === shellOf(stage()) && a.frames.some(f => f.width))!;
    expect(shrink.frames.at(-1)?.transform).toBe("translate3d(0px,200px,0) scale(1)");
    expect(detail.style["opacity"]).not.toBe("0");
    animations.at(-1)!.resolve(); await Promise.resolve();
    expect(body.children).toHaveLength(0); expect(card.focus).toHaveBeenCalledTimes(1);
  });
  it("来源已删除时淡出，不把容器飞向保存的过时坐标", () => {
    const engine = new ObjectExpandPresentation(), page = () => new Node() as unknown as HTMLElement;
    engine.run({ source, page, commit: vi.fn(), style: "c", reverse: true });
    const shell = shellOf(stage());
    const frames = animations.filter(a => a.node === shell).flatMap(a => a.frames);
    expect(frames.every(f => f.transform === undefined || f.transform === "translate3d(0px,0px,0) scale(1)")).toBe(true);
    expect(frames.find(f => f.width)?.opacity).toBe(0);
    engine.cancel(); expect(body.children).toHaveLength(0);
  });
  it("减少动态效果直接提交，不创建动画或遮罩", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const commit = vi.fn();
    new ObjectExpandPresentation().run({ source, page: () => new Node() as unknown as HTMLElement, commit, style: "a" });
    expect(commit).toHaveBeenCalledTimes(1); expect(animations).toHaveLength(0); expect(body.children).toHaveLength(0);
  });
});
