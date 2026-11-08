import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnterModePresentation, enterModeOptions } from "./enterMode.js";
import { ENTER_MODE, easingFunction } from "../../lib/motionTokens.js";

class FakeAnimation {
  currentTime: number | null = null;
  cancel = vi.fn(() => { this.cancelled = true; });
  cancelled = false;
  pause = vi.fn();
  effect: { target: Node };
  constructor(readonly node: Node, readonly frames: Keyframe[], readonly duration: number) { this.effect = { target: node }; }
}
class Style { [key: string]: unknown; setProperty(key: string, value: string) { this[key] = value; } removeProperty(key: string) { delete this[key]; } }
class Node {
  style = new Style(); dataset: Record<string, string> = {}; className = ""; inert = false; scrollTop = 0; scrollLeft = 0;
  children: Node[] = []; parent: Node | null = null; nav = false; savedStyle: string | null = null;
  rect = new DOMRectish(0, 0, 390, 844);
  get parentElement(): Node | null { return this.parent; }
  get isConnected(): boolean { return this === body || (this.parent?.isConnected ?? false); }
  append(...nodes: Node[]) { for (const n of nodes) { n.parent?.removeChild(n); n.parent = this; this.children.push(n); } }
  removeChild(n: Node) { this.children = this.children.filter(c => c !== n); n.parent = null; }
  remove() { this.parent?.removeChild(this); }
  getAttribute() { return this.savedStyle; }
  setAttribute(name: string, value: string) { if (name === "style") this.savedStyle = value; }
  removeAttribute(name: string) { if (name === "style") { this.savedStyle = null; this.style = new Style(); } }
  querySelectorAll() { return []; }
  querySelector(selector: string): Node | null {
    if (!selector.includes("data-entry-saved")) return null;
    for (const child of this.children) { if (child.dataset.entrySaved !== undefined) return child; const found = child.querySelector(selector); if (found) return found; }
    return null;
  }
  matches(selector: string) { return selector.includes("data-persistent-nav") && this.nav; }
  getBoundingClientRect() { return this.rect; }
  animate(frames: Keyframe[], options: { duration: number }) { const a = new FakeAnimation(this, frames, options.duration); animations.push(a); return a; }
}
class DOMRectish { constructor(public left: number, public top: number, public width: number, public height: number) {} get right() { return this.left + this.width; } get bottom() { return this.top + this.height; } get x() { return this.left; } get y() { return this.top; } }
let animations: FakeAnimation[], body: Node, pane: Node, queue: FrameRequestCallback[], now = 0;
const frames = (count: number): void => { for (let i = 0; i < count; i++) { now += 1000 / 60; const run = queue; queue = []; run.forEach(callback => callback(now)); } };
const stage = (): Node | undefined => body.children.find(n => n.className.includes("mode-stage"));
const pages = (): HTMLElement[] => pane.children.filter(n => !n.nav) as unknown as HTMLElement[];
const of = (node: Node) => animations.filter(a => a.node === node && !a.cancelled);
const H = 844;
beforeEach(() => {
  animations = []; body = new Node(); pane = new Node(); body.append(pane); queue = []; now = 0;
  const nav = { hidden: false, getBoundingClientRect: () => ({ height: 65 }) };
  vi.stubGlobal("document", { body, hidden: false, createElement: () => new Node(), querySelector: (s: string) => s.includes("persistent-nav") ? nav : null });
  vi.stubGlobal("innerWidth", 390); vi.stubGlobal("innerHeight", H);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("DOMRect", DOMRectish);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { queue.push(callback); return queue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("performance", { now: () => now });
});
afterEach(() => vi.unstubAllGlobals());

describe("记账工作模式", () => {
  it("?enterMs= 只接受登记的候选时长", () => {
    expect(enterModeOptions("")).toEqual({});
    for (const duration of ENTER_MODE.choices) expect(enterModeOptions(`?enterMs=${duration}`)).toEqual({ duration });
    expect(enterModeOptions("?enterMs=900")).toEqual({});
  });

  it("进入：点击当帧就移动真实旧页；新页面未到时纸面停在底栏后面，到达后同一帧对齐进入", () => {
    const old = new Node(), next = new Node(); pane.append(old);
    const engine = new EnterModePresentation();
    let commit!: () => void;
    engine.run({ pages, commit: () => { commit = () => { pane.removeChild(old); pane.append(next); }; }, style: "c" });
    // 旧页（C：上移让位）在提交前就有动画；纸面在舞台里。
    expect(of(old)).toHaveLength(1);
    const sheet = stage()!.children.find(n => n.className === "mode-sheet")!;
    expect(of(sheet)[0]!.frames[0]!.transform).toBe(`translate3d(0,${H}px,0)`);
    frames(12);
    // 等新页面：时间停在缓动进度 ≤ 底栏高度占比处，不露出空白工作区。
    const time = of(sheet)[0]!.currentTime!;
    expect(easingFunction(ENTER_MODE.enter.easing)(time / ENTER_MODE.enter.duration)).toBeLessThanOrEqual(65 / H + 1e-3);
    commit(); frames(1);
    // 旧页接到舞台（不克隆），新页面以同一时刻对齐。
    const holder = stage()!.children.find(n => n.className === "mode-plane")!;
    expect(holder.children).toEqual([old]);
    expect(of(old)).toHaveLength(0);
    expect(of(holder)[0]!.frames.at(-1)!.transform).toBe(`translate3d(0,${-Math.round(ENTER_MODE.styles.c.shift * H)}px,0)`);
    expect(of(next)[0]!.frames[0]!.transform).toBe(`translate3d(0,${H}px,0)`);
    expect(of(next)[0]!.currentTime).toBe(of(sheet)[0]!.currentTime);
    frames(40);
    expect(stage()).toBeUndefined(); expect(of(next)).toHaveLength(0); expect(next.dataset.modeLive).toBeUndefined();
  });

  it("B1：两页在同一竖向轨道上，间隔 24px，不需要纸面", () => {
    const old = new Node(), next = new Node(); pane.append(old);
    new EnterModePresentation().run({ pages, commit: () => { pane.removeChild(old); pane.append(next); }, style: "b1" });
    const travel = H + ENTER_MODE.b1Gap;
    expect(stage()!.children.some(n => n.className === "mode-sheet")).toBe(false);
    const holder = stage()!.children.find(n => n.className === "mode-plane")!;
    expect(of(holder)[0]!.frames.at(-1)!.transform).toBe(`translate3d(0,${-travel}px,0)`);
    expect(of(next)[0]!.frames[0]!.transform).toBe(`translate3d(0,${travel}px,0)`);
  });

  it("离开：目标页面到达前什么都不动，到达后工作区在上层舞台随纸面下沉，原页面回到原位", () => {
    const mode = new Node(), home = new Node(); pane.append(mode);
    let commit!: () => void;
    new EnterModePresentation().run({ pages, commit: () => { commit = () => { pane.removeChild(mode); pane.append(home); }; }, style: "a", exit: true });
    frames(5);
    expect(stage()).toBeUndefined(); expect(animations).toHaveLength(0);
    commit(); frames(1);
    const top = stage()!;
    expect(top.dataset.modeStage).toBe("exit");
    const sheet = top.children.find(n => n.className === "mode-sheet")!;
    expect(sheet.children.find(n => n.className === "mode-plane")!.children).toEqual([mode]);
    expect(of(sheet)[0]!.frames.at(-1)!.transform).toBe(`translate3d(0,${H}px,0)`);
    expect(of(home)[0]!.frames[0]!.transform).toBe(`scale(${ENTER_MODE.styles.a.scale})`);
    frames(40);
    expect(stage()).toBeUndefined();
  });

  it("进入中途返回：从当前姿态倒放，返回页先隐藏，结束后恢复", () => {
    const old = new Node(), next = new Node(), back = new Node(); pane.append(old);
    const engine = new EnterModePresentation();
    engine.run({ pages, commit: () => { pane.removeChild(old); pane.append(next); }, style: "c" });
    frames(6);
    const sheet = stage()!.children.find(n => n.className === "mode-sheet")!;
    const at = of(sheet)[0]!.currentTime!;
    let commit!: () => void;
    engine.run({ pages, commit: () => { commit = () => { pane.removeChild(next); pane.append(back); }; }, style: "c", exit: true });
    frames(2);
    expect(of(sheet)[0]!.currentTime!).toBeLessThan(at);
    commit(); frames(1);
    expect(back.style.visibility).toBe("hidden");
    expect(stage()!.children.at(-1)!.children).toEqual([next]);
    frames(30);
    expect(stage()).toBeUndefined(); expect(back.style.visibility).toBeUndefined();
  });

  it("再记一笔：同步提交（保留输入焦点的用户手势），上一屏按原位置收起，新的一笔升入", () => {
    const page = new Node(), saved = new Node(), form = new Node(); saved.dataset.entrySaved = ""; saved.rect = new DOMRectish(0, 120, 390, 500);
    pane.append(page); page.append(saved);
    const committed = vi.fn(() => { page.removeChild(saved); page.append(form); });
    new EnterModePresentation().again({ root: () => pane as unknown as HTMLElement, commit: committed, style: "b2" });
    expect(committed).toHaveBeenCalledTimes(1);
    const holder = stage()!.children[0]!;
    expect(holder.children).toEqual([saved]);
    expect(holder.style.top).toBe("120px"); expect(holder.style.height).toBe("500px");
    expect(of(form)[0]!.frames[0]!.opacity).toBe(0);
    frames(30);
    expect(stage()).toBeUndefined(); expect(of(form)).toHaveLength(0);
  });

  it("减少动态效果：只交付页面", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const old = new Node(); pane.append(old); const commit = vi.fn();
    new EnterModePresentation().run({ pages, commit, style: "c" });
    expect(commit).toHaveBeenCalledTimes(1); expect(animations).toHaveLength(0); expect(stage()).toBeUndefined();
  });
});
