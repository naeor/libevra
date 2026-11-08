import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectExpandPresentation, findObject, type ObjectSource } from "./objectExpand.js";
import { EnterModePresentation } from "./enterMode.js";

vi.mock("./abcPresentation.js", () => ({ snapshot: () => document.createElement("div"), restoreSnapshot: new WeakMap() }));
class FakeAnimation {
  resolve!: () => void;
  finished = new Promise<void>(resolve => { this.resolve = resolve; });
  cancel = vi.fn();
  constructor(readonly frames: Keyframe[]) {}
}
class Node {
  style: Record<string, string> = {}; dataset: Record<string, string> = {}; className = "";
  classList = { add: vi.fn() }; children: Node[] = []; sources: Node[] = []; parent: Node | null = null;
  focus = vi.fn(); inert = false;
  append(...children: Node[]) { this.children.push(...children); children.forEach(n => { n.parent = this; }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  getAttribute() { return null; }
  setAttribute() {}
  removeAttribute() { this.style = {}; }
  querySelectorAll() { return this.sources; }
  querySelector() { return null; }
  closest() { return null; }
  matches() { return true; }
  getBoundingClientRect() { return { left: 0, top: 200, width: 390, height: 64 }; }
  animate(frames: Keyframe[]) { const a = new FakeAnimation(frames); animations.push(a); return a; }
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
describe("对象呈现生命周期", () => {
  it("两个汇总槽配置相同指标时仍返回实际点击的那一个", () => {
    const root = new Node(), first = new Node(), second = new Node();
    first.dataset = { objectSource: "/ledger/metrics/balance", objectSlot: "0" };
    second.dataset = { objectSource: "/ledger/metrics/balance", objectSlot: "1" }; root.sources = [first, second];
    expect(findObject(root as unknown as HTMLElement, "/ledger/metrics/balance", "1")).toBe(second);
  });
  it("B1 工作模式按工作区高度完全向上离屏，不是小幅退让", () => {
    const engine = new EnterModePresentation(), old = new Node(), next = new Node();
    let current = old;
    engine.run(() => current as unknown as HTMLElement, () => { current = next; }, "b1", { duration: 140, fade: false });
    expect(animations[1]?.frames.at(-1)?.transform).toBe("translate3d(0,-844px,0)");
    engine.cancel(); expect(body.children).toHaveLength(0); expect(next.dataset.enterModeLive).toBeUndefined();
  });
  it("快速返回时提交各一次，旧完成回调不能撤掉正在收缩的新容器", async () => {
    const engine = new ObjectExpandPresentation(), list = new Node(), detail = new Node(), card = new Node();
    card.dataset.objectSource = source.id; list.sources = [card];
    let current = list;
    const open = vi.fn(() => { current = detail; }), close = vi.fn(() => { current = list; });
    const page = () => current as unknown as HTMLElement;
    engine.run({ source, page, commit: open, style: "b2" });
    const oldFence = animations.at(-1)!;
    engine.run({ source, page, commit: close, style: "b2", reverse: true });
    oldFence.resolve(); await Promise.resolve();
    expect(body.children).toHaveLength(1); expect(card.style.visibility).toBe("hidden");
    expect(open).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
    animations.at(-1)!.resolve(); await Promise.resolve();
    expect(body.children).toHaveLength(0); expect(card.style.visibility).not.toBe("hidden"); expect(card.focus).toHaveBeenCalledTimes(1);
  });
  it("来源已删除时淡出，不把容器飞向保存的过时坐标", () => {
    const engine = new ObjectExpandPresentation(), page = () => new Node() as unknown as HTMLElement;
    engine.run({ source, page, commit: vi.fn(), style: "c", reverse: true });
    expect(animations[0]?.frames.map(f => f.opacity)).toEqual([1, 0]);
    engine.cancel(); expect(body.children).toHaveLength(0);
  });
  it("减少动态效果直接提交，不创建动画或遮罩", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const commit = vi.fn();
    new ObjectExpandPresentation().run({ source, page: () => new Node() as unknown as HTMLElement, commit, style: "a" });
    expect(commit).toHaveBeenCalledTimes(1); expect(animations).toHaveLength(0); expect(body.children).toHaveLength(0);
  });
});
