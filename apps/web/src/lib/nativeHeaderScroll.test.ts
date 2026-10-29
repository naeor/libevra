import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindNativeHeaderScroll } from "./nativeHeaderScroll.js";

class Scroller extends EventTarget { scrollTop = 0; }
function touch(target: Scroller, type: string, y: number) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientY: y, clientX: 0 }] });
  target.dispatchEvent(event);
  return event;
}
describe("原生滚动与顶栏两端吸附", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), setTimeout });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  function setup() {
    const scroller = new Scroller();
    const paint = vi.fn();
    const controller = bindNativeHeaderScroll(scroller as unknown as HTMLElement, () => 100, paint);
    return { scroller, paint, ...controller };
  }
  it("同一次按住跨过收缩端点后仍不取消原生滚动，也不抢写位置", () => {
    const c = setup();
    touch(c.scroller, "touchstart", 500);
    for (const top of [20, 80, 100, 160, 350]) {
      c.scroller.scrollTop = top;
      c.scroller.dispatchEvent(new Event("scroll"));
      expect(touch(c.scroller, "touchmove", 500 - top).defaultPrevented).toBe(false);
      vi.advanceTimersByTime(200);
      expect(c.scroller.scrollTop).toBe(top);
    }
    expect(c.paint).toHaveBeenCalledTimes(5);
    c.destroy();
  });
  it("松手后等待原生惯性结束，不会在惯性期间启动弹簧", () => {
    const c = setup();
    touch(c.scroller, "touchstart", 500);
    c.scroller.scrollTop = 30;
    touch(c.scroller, "touchend", 470);
    for (const top of [50, 75, 130, 240]) {
      vi.advanceTimersByTime(80);
      c.scroller.scrollTop = top;
      c.scroller.dispatchEvent(new Event("scroll"));
    }
    vi.advanceTimersByTime(1000);
    expect(c.scroller.scrollTop).toBe(240);
    c.destroy();
  });
  it("慢滑停在中途会吸附到两端；重新按下会立即中止吸附", () => {
    const c = setup();
    c.scroller.scrollTop = 70;
    c.scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(2000);
    expect(c.scroller.scrollTop).toBe(100);
    c.scroller.scrollTop = 30;
    c.scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(2000);
    expect(c.scroller.scrollTop).toBe(0);
    c.goTo(1); vi.advanceTimersByTime(32);
    touch(c.scroller, "touchstart", 400);
    const interrupted = c.scroller.scrollTop;
    vi.advanceTimersByTime(2000);
    expect(c.scroller.scrollTop).toBe(interrupted);
    c.destroy();
  });
  it("减少动态效果直接落到端点；清理后不再处理事件", () => {
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    const c = setup();
    c.scroller.scrollTop = 60;
    c.scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(120);
    expect(c.scroller.scrollTop).toBe(100);
    c.destroy(); c.paint.mockClear();
    c.scroller.dispatchEvent(new Event("scroll"));
    expect(c.paint).not.toHaveBeenCalled();
  });
});
