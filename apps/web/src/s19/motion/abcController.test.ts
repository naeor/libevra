import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ABCMotion } from "../../../../../experiments/abc-motion/controller.js";
import { interruptsTransition } from "../../lib/motionTokens.js";

/**
 * A / B1 / C 默认页面转场的 ABC 控制器（1.19.57）：不再自己监听视口 / 舞台尺寸，被动画节点的尺寸变化也只按
 * 共享的转场打断规则（宽度变化或高度变化 > 150px）判断，iOS 工具栏伸缩不再让动画闪到终点。
 */
interface Entry { target: unknown; contentRect: { width: number; height: number } }
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  constructor(private readonly callback: (entries: Entry[]) => void) { FakeResizeObserver.last = this; }
  observe(): void { /* 由测试直接触发回调 */ }
  disconnect(): void { /* 无需释放 */ }
  resize(target: unknown, width: number, height: number): void { this.callback([{ target, contentRect: { width, height } }]); }
}
function plane(): HTMLElement {
  const node = {
    animate: vi.fn(() => ({ effect: { target: node }, finished: new Promise(() => undefined), cancel: vi.fn(), pause: vi.fn(), currentTime: 0 })),
  };
  return node as unknown as HTMLElement;
}
async function outcome(engine: ABCMotion, run: (observer: FakeResizeObserver, from: HTMLElement, to: HTMLElement) => void): Promise<unknown> {
  const from = plane(), to = plane();
  let result: unknown = null;
  void engine.run({ from, to, style: "c", direction: "push", duration: 200 }).finished.then((value) => { result = value; });
  run(FakeResizeObserver.last!, from, to);
  await Promise.resolve(); await Promise.resolve();
  return result;
}

describe("ABC 控制器服从共享的转场打断规则", () => {
  const viewport = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers();
    viewport.addEventListener.mockClear();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("window", { visualViewport: viewport });
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    // 下一次 run 会从上一段动画的当前姿态接续，读计算样式。
    vi.stubGlobal("getComputedStyle", () => ({ transform: "none", opacity: "1", filter: "none", clipPath: "none", boxShadow: "none" }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("不自己监听可视区：视口变化由协调器统一收束", () => {
    const engine = new ABCMotion({} as HTMLElement, { interrupts: interruptsTransition });
    expect(viewport.addEventListener).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("平面高度只变几十像素（iOS 工具栏）继续播放；大幅变化才收束", async () => {
    const engine = new ABCMotion({} as HTMLElement, { interrupts: interruptsTransition });
    const small = await outcome(engine, (observer, from, to) => {
      observer.resize(from, 390, 664); observer.resize(to, 390, 664);
      observer.resize(from, 390, 747); observer.resize(to, 390, 600);
    });
    expect(small).toBeNull();
    const large = await outcome(engine, (observer, from) => {
      observer.resize(from, 390, 664);
      observer.resize(from, 390, 900);
    });
    expect(large).toEqual({ status: "cancelled", reason: "content-resize" });
    engine.dispose();
  });

  it("与转场开始时比较：分几次累积的大幅变化同样收束；宽度变化立即收束", async () => {
    const engine = new ABCMotion({} as HTMLElement, { interrupts: interruptsTransition });
    const gradual = await outcome(engine, (observer, from) => {
      observer.resize(from, 390, 664);
      for (const height of [744, 804, 864]) observer.resize(from, 390, height);
    });
    expect(gradual).toEqual({ status: "cancelled", reason: "content-resize" });
    const rotated = await outcome(engine, (observer, from) => {
      observer.resize(from, 390, 664);
      observer.resize(from, 400, 664);
    });
    expect(rotated).toEqual({ status: "cancelled", reason: "content-resize" });
    engine.dispose();
  });

  it("没有传入规则时不因尺寸打断", async () => {
    const engine = new ABCMotion({} as HTMLElement);
    const result = await outcome(engine, (observer, from) => {
      observer.resize(from, 390, 664);
      observer.resize(from, 800, 1200);
    });
    expect(result).toBeNull();
    engine.dispose();
  });
});
