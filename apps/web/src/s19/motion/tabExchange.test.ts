import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TAB_EASING, TabExchangePresentation, tabIndex } from "./tabExchange.js";

vi.mock("./abcPresentation.js", () => ({ snapshot: () => document.createElement("div"), restoreSnapshot: new WeakMap() }));
class FakeAnimation {
  resolve!: () => void;
  finished = new Promise<void>(resolve => { this.resolve = resolve; });
  cancel = vi.fn();
  constructor(readonly node: Node, readonly frames: Keyframe[], readonly options: KeyframeAnimationOptions) {}
}
class Style { [key: string]: unknown; setProperty(key: string, value: string) { this[key] = value; } }
class Node {
  style = new Style(); dataset: Record<string, string> = {}; className = ""; children: Node[] = []; parent: Node | null = null; inert = false;
  constructor(readonly name = "") {}
  append(...children: Node[]) { this.children.push(...children); children.forEach(n => { n.parent = this; }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
  getAttribute() { return null; }
  setAttribute() {}
  removeAttribute() { this.style = new Style(); }
  animate(frames: Keyframe[], options: KeyframeAnimationOptions) { const a = new FakeAnimation(this, frames, options); animations.push(a); return a; }
}
let animations: FakeAnimation[];
let body: Node;
beforeEach(() => {
  animations = []; body = new Node("body");
  vi.stubGlobal("document", { body, hidden: false, createElement: () => new Node() });
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => vi.unstubAllGlobals());

describe("主 Tab 横向交换", () => {
  it("明细 → 分析：旧页向左离开、新页从右侧进入，两页共用时钟与 easing", () => {
    const tabs = new TabExchangePresentation(), entries = new Node("entries"), insights = new Node("insights");
    let current = entries;
    const commit = vi.fn(() => { current = insights; });
    tabs.request({ from: tabIndex("/"), to: tabIndex("/stats"), page: () => current as unknown as HTMLElement, commit });
    expect(commit).toHaveBeenCalledTimes(1);
    const [out, incoming] = animations;
    expect(out!.frames.at(-1)?.transform).toBe("translate3d(-390px,0,0)");
    expect(incoming!.node).toBe(insights);
    expect(incoming!.frames[0]?.transform).toBe("translate3d(390px,0,0)");
    expect(insights.style["transform"]).toBe("translate3d(390px,0,0)");
    expect(incoming!.options).toMatchObject({ duration: 200, easing: TAB_EASING });
    expect(out!.options).toEqual(incoming!.options);
    tabs.dispose(); expect(body.children).toHaveLength(0);
  });
  it("快速连点只排最后一次，当前交换完成后从实际所在页出发；最左到最右只交换一次", async () => {
    const tabs = new TabExchangePresentation(), pages = ["/", "/stats", "/ledger", "/me"].map(p => new Node(p));
    let current = pages[0]!;
    const go = (i: number) => vi.fn(() => { current = pages[i]!; });
    const first = go(1), skipped = go(2), last = go(3);
    tabs.request({ from: 0, to: 1, page: () => current as unknown as HTMLElement, commit: first });
    tabs.request({ from: 1, to: 2, page: () => current as unknown as HTMLElement, commit: skipped });
    tabs.request({ from: 2, to: 3, page: () => current as unknown as HTMLElement, commit: last });
    expect(first).toHaveBeenCalledTimes(1); expect(last).not.toHaveBeenCalled();
    animations[1]!.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(skipped).not.toHaveBeenCalled(); expect(last).toHaveBeenCalledTimes(1);
    // 从分析（1）出发去我的（3）：仍是一次完整的向左交换。
    expect(animations.at(-2)!.frames.at(-1)?.transform).toBe("translate3d(-390px,0,0)");
    expect(animations.at(-1)!.node).toBe(pages[3]);
    tabs.dispose();
  });
  it("取消时立即交付排队中的目标，不遗留半页", () => {
    const tabs = new TabExchangePresentation(), a = new Node(), b = new Node(), c = new Node();
    let current = a;
    tabs.request({ from: 0, to: 3, page: () => current as unknown as HTMLElement, commit: () => { current = b; } });
    const queued = vi.fn(() => { current = c; });
    tabs.request({ from: 3, to: 0, page: () => current as unknown as HTMLElement, commit: queued });
    tabs.cancel();
    expect(queued).toHaveBeenCalledTimes(1); expect(body.children).toHaveLength(0);
    expect(b.dataset.tabLive).toBeUndefined();
  });
  it("减少动态效果即时切换", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const commit = vi.fn();
    new TabExchangePresentation().request({ from: 0, to: 1, page: () => new Node() as unknown as HTMLElement, commit });
    expect(commit).toHaveBeenCalledTimes(1); expect(animations).toHaveLength(0);
  });
});
