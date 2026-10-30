import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ element: null as unknown, cleanup: undefined as undefined | (() => void) }));
vi.mock("react", () => ({
  useRef: () => ({ current: lifecycle.element }),
  useLayoutEffect: (effect: () => (() => void)) => { lifecycle.cleanup = effect(); },
}));
import { useCollapsingHeader } from "./useCollapsingHeader.js";

/** DOM 边界替身：验证实际 hook 的监听、进度、吸附和清理，而非重复物理公式。 */
class ScrollRegion extends EventTarget {
  scrollTop = 0;
  clientHeight = 720;
}
let scroller: ScrollRegion;
let styles: Map<string, string>;
let header: { offsetHeight: number; dataset: Record<string, string>; style: { setProperty: (key: string, value: string) => void }; parentElement: { parentElement: ScrollRegion; style: { minHeight: string } }; querySelector: () => { inert: boolean } };
let extra: { inert: boolean };
let reduced = false;
let resize: () => void;
function touch(type: string, x: number, y: number, count = 1) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "touches", { value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })) });
  scroller.dispatchEvent(event);
  return event;
}
function scroll(top: number) {
  scroller.scrollTop = top;
  scroller.dispatchEvent(new Event("scroll"));
}
function settle() { vi.advanceTimersByTime(2500); }
/**
 * 一次手指移动：1.17.16 起顶栏不再拦截触摸、不替浏览器移动页面——滚动由浏览器原生完成，
 * hook 只读滚动位置与手势速度。测试替身不会自己滚，所以这里同时派发 touchmove 与浏览器会产生的 scroll。
 */
function drag(fromY: number, toY: number) {
  const move = touch("touchmove", 100, toY);
  scroll(scroller.scrollTop + (fromY - toY));
  return move;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("Element", class {});
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  reduced = false;
  vi.stubGlobal("window", { matchMedia: () => ({ get matches() { return reduced; } }), setTimeout });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "0px" }));
  scroller = new ScrollRegion();
  styles = new Map();
  extra = { inert: false };
  header = {
    offsetHeight: 164,
    dataset: {},
    style: { setProperty: (key, value) => styles.set(key, value) },
    parentElement: { parentElement: scroller, style: { minHeight: "12px" } },
    querySelector: () => extra,
  };
  lifecycle.element = header;
  useCollapsingHeader();
});
afterEach(() => {
  lifecycle.cleanup?.();
  lifecycle.cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("共用顶栏的真实滚动与两端吸附", () => {
  it("跟随真实进度，短页面有完整行程，收缩后移除隐藏辅助内容的交互", () => {
    expect(header.parentElement.style.minHeight).toBe("820px");
    scroll(37);
    expect(Number(styles.get("--header-p"))).toBeCloseTo(0.37);
    scroll(240);
    expect(styles.get("--header-p")).toBe("1");
    expect(extra.inert).toBe(true);
    scroll(0);
    expect(extra.inert).toBe(false);
  });
  it("慢拖未过中线，手指停住时保持进度，松手后展开；拖动时不拦截原生滚动", () => {
    touch("touchstart", 100, 400);
    vi.advanceTimersByTime(800);
    const move = drag(400, 365);
    expect(move.defaultPrevented).toBe(false);
    settle();
    expect(scroller.scrollTop).toBe(35);
    touch("touchend", 100, 365, 0);
    settle();
    expect(scroller.scrollTop).toBe(0);
  });
  it("慢拖过中线，松手后收缩并在继续滚动时保持紧凑", () => {
    touch("touchstart", 100, 400);
    vi.advanceTimersByTime(2000);
    drag(400, 330);
    touch("touchend", 100, 330, 0);
    settle();
    expect(scroller.scrollTop).toBe(100);
    scroll(350);
    settle();
    expect(scroller.scrollTop).toBe(350);
    expect(styles.get("--header-p")).toBe("1");
  });
  it("快速上滑末帧轻微回移，仍按整体方向收缩且不反弹", () => {
    touch("touchstart", 100, 400);
    vi.advanceTimersByTime(35);
    drag(400, 370);
    vi.advanceTimersByTime(10);
    drag(370, 372);
    touch("touchend", 100, 372, 0);
    let previous = scroller.scrollTop;
    // 松手后先等约 120ms 确认原生惯性已停，再由弹簧收到端点，所以给足帧数。
    for (let i = 0; i < 200; i++) {
      vi.advanceTimersByTime(16);
      expect(scroller.scrollTop).toBeGreaterThanOrEqual(previous);
      previous = scroller.scrollTop;
    }
    expect(scroller.scrollTop).toBe(100);
  });
  it("新手势打断旧弹簧，旧回调不继续写入", () => {
    scroll(70);
    vi.advanceTimersByTime(200);
    touch("touchstart", 100, 400);
    const top = scroller.scrollTop;
    settle();
    expect(scroller.scrollTop).toBe(top);
  });
  it("横向手势不被拦截", () => {
    touch("touchstart", 100, 400);
    expect(touch("touchmove", 200, 390).defaultPrevented).toBe(false);
    expect(scroller.scrollTop).toBe(0);
  });
  it("减少动态效果时，松手等原生滚动停稳（约 120ms，再隔两帧核对位置没动）后直接落到端点，不运行弹簧动画", () => {
    reduced = true;
    touch("touchstart", 100, 400);
    vi.advanceTimersByTime(2000);
    drag(400, 330);
    touch("touchend", 100, 330, 0);
    expect(scroller.scrollTop).toBe(70);
    // S18 第二轮：计时器只是「开始核对」，两帧之内位置不变才算停稳（见 nativeHeaderScroll.ts）。
    vi.advanceTimersByTime(120 + 2 * 16);
    expect(scroller.scrollTop).toBe(100);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("安全区和视口尺寸改变后重测，清理恢复原布局并解绑监听", () => {
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "44px" }));
    header.offsetHeight = 208;
    scroller.clientHeight = 600;
    resize();
    expect(styles.get("--header-range")).toBe("100px");
    expect(header.parentElement.style.minHeight).toBe("700px");
    lifecycle.cleanup?.();
    lifecycle.cleanup = undefined;
    expect(header.parentElement.style.minHeight).toBe("12px");
    scroll(90);
    expect(styles.get("--header-p")).toBe("0");
  });
});
