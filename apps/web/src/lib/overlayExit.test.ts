import { afterEach, describe, expect, it, vi } from "vitest";
import { createOverlayExit, OVERLAY_EXIT_MS } from "./overlayExit.js";

afterEach(() => vi.useRealTimers());
describe("弹窗退出生命周期", () => {
  it("动画结束才关闭，同一帧连续触发只执行一次", () => {
    vi.useFakeTimers();
    const phase = vi.fn(), close = vi.fn(), duplicate = vi.fn();
    const exit = createOverlayExit(phase);
    exit.schedule(close);
    exit.schedule(duplicate);
    expect(phase).toHaveBeenCalledExactlyOnceWith(true);
    vi.advanceTimersByTime(OVERLAY_EXIT_MS - 1);
    expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(close).toHaveBeenCalledOnce();
    expect(duplicate).not.toHaveBeenCalled();
    expect(phase).toHaveBeenLastCalledWith(false);
  });
  it("卸载或关闭后重新打开会取消旧计时，不延迟执行旧操作", () => {
    vi.useFakeTimers();
    const oldClose = vi.fn(), nextClose = vi.fn();
    const exit = createOverlayExit(() => undefined);
    exit.schedule(oldClose);
    exit.cancel();
    exit.schedule(nextClose);
    vi.runAllTimers();
    expect(oldClose).not.toHaveBeenCalled();
    expect(nextClose).toHaveBeenCalledOnce();
  });
  it("调用方暂时拒绝关闭后可以再次操作", () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const exit = createOverlayExit(() => undefined);
    exit.schedule(close);
    vi.runAllTimers();
    exit.schedule(close);
    vi.runAllTimers();
    expect(close).toHaveBeenCalledTimes(2);
  });
});
