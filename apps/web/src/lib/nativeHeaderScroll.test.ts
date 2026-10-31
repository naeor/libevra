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
    // 120ms 后开始核对，再隔两帧确认位置没动。
    vi.advanceTimersByTime(120 + 2 * 16);
    expect(c.scroller.scrollTop).toBe(100);
    c.destroy(); c.paint.mockClear();
    c.scroller.dispatchEvent(new Event("scroll"));
    expect(c.paint).not.toHaveBeenCalled();
  });

  it("计时器触发时位置仍在变化（scroll 事件被推迟）：不启动弹簧，等真正停下再吸附", () => {
    const c = setup();
    touch(c.scroller, "touchstart", 500);
    c.scroller.scrollTop = 50;
    c.scroller.dispatchEvent(new Event("scroll"));
    touch(c.scroller, "touchend", 450);
    // 惯性继续推动，但主线程忙，scroll 事件迟迟没到：每次核对都看到位置变了。
    for (const top of [62, 74, 83, 90, 95, 98]) {
      vi.advanceTimersByTime(130);
      c.scroller.scrollTop = top;
      expect(c.scroller.scrollTop).toBe(top);
    }
    // 真正停下后才吸附（停在 98，过半 → 收起端）。
    vi.advanceTimersByTime(2000);
    expect(c.scroller.scrollTop).toBe(100);
    c.destroy();
  });
  it("核对的两帧之内位置又动了：重新等待，不会在运动中写位置", () => {
    const c = setup();
    c.scroller.scrollTop = 70;
    c.scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(120);
    c.scroller.scrollTop = 72;
    vi.advanceTimersByTime(32);
    expect(c.scroller.scrollTop).toBe(72);
    vi.advanceTimersByTime(2000);
    expect(c.scroller.scrollTop).toBe(100);
    c.destroy();
  });
  it("弹簧运行中惯性仍在推动：弹簧立即让出，不把内容往回拉", () => {
    const c = setup();
    c.scroller.scrollTop = 70;
    c.scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(120 + 2 * 16 + 48);
    expect(c.scroller.scrollTop).toBeGreaterThan(70);
    c.scroller.scrollTop = 40;
    c.scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(100);
    expect(c.scroller.scrollTop).toBe(40);
    // 这次运动停下后重新判断：40 未过半，回到展示端。
    vi.advanceTimersByTime(2000);
    expect(c.scroller.scrollTop).toBe(0);
    c.destroy();
  });
  /**
   * 1.18.7（所有者 iPhone 录屏）：Safari 的滚动位置是整像素，慢速惯性每 200ms 左右才走一个像素、来一次
   * scroll 事件。旧判断「120ms 没事件 + 两帧没动」在两次事件之间成立，弹簧在惯性中启动——往前跳，下一次
   * 惯性位置又把它拉回，就是 Logo 变暗变亮交替的高频闪回。（这条在旧实现上失败。）
   */
  it("慢速惯性（约 200ms 才动一个像素）期间不启动弹簧，惯性真正结束后才吸附", () => {
    const c = setup();
    touch(c.scroller, "touchstart", 500);
    // 手指慢慢推：位置每 200ms 走一个像素。
    for (const value of [27, 28, 29, 30]) {
      c.scroller.scrollTop = value;
      c.scroller.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(value === 30 ? 100 : 200);
    }
    // 松手（离上一次事件 100ms），惯性以同样的节奏继续。
    touch(c.scroller, "touchend", 470);
    let top = 30;
    for (let step = 0; step < 12; step += 1) {
      vi.advanceTimersByTime(step === 0 ? 100 : 200);
      // 每一刻读到的都必须是惯性自己的位置：弹簧没有插手写入。
      expect(c.scroller.scrollTop).toBe(top);
      top += 1;
      c.scroller.scrollTop = top;
      c.scroller.dispatchEvent(new Event("scroll"));
    }
    // 惯性结束（42，未过半 → 回到展示端）。
    vi.advanceTimersByTime(3000);
    expect(c.scroller.scrollTop).toBe(0);
    c.destroy();
  });
  it("已观察到慢速惯性时，提前到来的 scrollend 不能绕过安静时间", () => {
    const c = setup();
    touch(c.scroller, "touchstart", 500);
    for (const value of [27, 28, 29, 30]) {
      c.scroller.scrollTop = value;
      c.scroller.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(value === 30 ? 100 : 200);
    }
    touch(c.scroller, "touchend", 470);
    // 浏览器在松手时就报告了 scrollend，但惯性仍以每 200ms 一个像素的节奏继续。
    c.scroller.dispatchEvent(new Event("scrollend"));
    let top = 30;
    for (let step = 0; step < 6; step += 1) {
      vi.advanceTimersByTime(step === 0 ? 100 : 200);
      expect(c.scroller.scrollTop).toBe(top);
      top += 1;
      c.scroller.scrollTop = top;
      c.scroller.dispatchEvent(new Event("scroll"));
    }
    vi.advanceTimersByTime(3000);
    expect(c.scroller.scrollTop).toBe(0);
    c.destroy();
  });
  it("弹簧写入前发现位置已被惯性改动（scroll 事件尚未派发）：这一帧不写并让出，至少安静 400ms 再判断", () => {
    const c = setup();
    c.scroller.scrollTop = 70;
    c.scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(120 + 2 * 16 + 48);
    expect(c.scroller.scrollTop).toBeGreaterThan(70);
    // 惯性把位置改到 40，scroll 事件还没来：下一帧弹簧不能把它写回去。
    c.scroller.scrollTop = 40;
    vi.advanceTimersByTime(16);
    expect(c.scroller.scrollTop).toBe(40);
    // 让出后 300ms 内不重新启动。
    vi.advanceTimersByTime(300);
    expect(c.scroller.scrollTop).toBe(40);
    // 之后真正安静：40 未过半，回到展示端。
    vi.advanceTimersByTime(2000);
    expect(c.scroller.scrollTop).toBe(0);
    c.destroy();
  });
  it("快速惯性（每帧都有 scroll 事件）结束后仍在 120ms 左右开始吸附，节奏不变", () => {
    const c = setup();
    touch(c.scroller, "touchstart", 500);
    c.scroller.scrollTop = 20;
    c.scroller.dispatchEvent(new Event("scroll"));
    touch(c.scroller, "touchend", 480);
    for (const value of [30, 38, 44, 49, 53, 56, 58, 59]) {
      vi.advanceTimersByTime(16);
      c.scroller.scrollTop = value;
      c.scroller.dispatchEvent(new Event("scroll"));
    }
    // 120ms 安静 + 两帧核对之后弹簧已经开始（59 过半 → 收起端）。
    vi.advanceTimersByTime(120 + 2 * 16 + 48);
    expect(c.scroller.scrollTop).toBeGreaterThan(59);
    vi.advanceTimersByTime(2000);
    expect(c.scroller.scrollTop).toBe(100);
    c.destroy();
  });
  it("scrollend 也只是核对信号：位置刚变过就继续等待", () => {
    const c = setup();
    c.scroller.scrollTop = 30;
    c.scroller.dispatchEvent(new Event("scroll"));
    c.scroller.scrollTop = 35;
    c.scroller.dispatchEvent(new Event("scrollend"));
    vi.advanceTimersByTime(32);
    expect(c.scroller.scrollTop).toBe(35);
    vi.advanceTimersByTime(2000);
    expect(c.scroller.scrollTop).toBe(0);
    c.destroy();
  });
});
