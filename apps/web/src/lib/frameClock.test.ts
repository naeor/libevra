import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onClockReport, runFrameClock, runFrameValue, type ClockReport } from "./frameClock.js";

class FakeAnimation {
  currentTime: number | null = null;
  paused = false;
  cancelled = false;
  pause(): void { this.paused = true; }
  cancel(): void { this.cancelled = true; }
}
let queue: FrameRequestCallback[] = [];
const frame = (now: number): void => { const run = queue; queue = []; run.forEach(callback => callback(now)); };
beforeEach(() => {
  queue = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { queue.push(callback); return queue.length; });
  vi.stubGlobal("cancelAnimationFrame", () => { queue = []; });
});
afterEach(() => vi.unstubAllGlobals());

describe("帧锚定时钟", () => {
  it("第一帧固定是起点；首帧很重时只放慢、不跳过前段", () => {
    const a = new FakeAnimation(), seen: number[] = [];
    runFrameClock([a as unknown as Animation], 200, { name: "t", onProgress: p => seen.push(p) });
    expect(a.paused).toBe(true);
    frame(1000); expect(a.currentTime).toBe(0);
    // 下一帧隔了 180ms（例如整页首次绘制）：只推进一帧的上限，而不是直接到 90%。
    frame(1180); expect(a.currentTime).toBe(34);
    frame(1196.7); expect(a.currentTime).toBeCloseTo(50.7, 1);
    expect(seen[0]).toBe(0);
  });
  it("正常 60Hz 下总时长不变，结束时回调并报告真实帧数", () => {
    const a = new FakeAnimation(), done = vi.fn(), reports: ClockReport[] = [];
    const off = onClockReport(report => reports.push(report));
    runFrameClock([a as unknown as Animation], 200, { name: "tab", onDone: done });
    let now = 0; frame(now);
    while (!done.mock.calls.length && now < 1000) { now += 16.7; frame(now); }
    off();
    expect(a.currentTime).toBe(200);
    expect(now).toBeGreaterThanOrEqual(200); expect(now).toBeLessThan(220);
    expect(reports[0]).toMatchObject({ name: "tab", completed: true, duration: 200 });
    expect(reports[0]!.frames).toBeGreaterThanOrEqual(12);
  });
  it("中途加入的动画按当前时间对齐，移出的动画被取消", () => {
    const a = new FakeAnimation(), late = new FakeAnimation();
    const clock = runFrameClock([a as unknown as Animation], 200, { name: "t" });
    frame(0); frame(16); frame(32);
    clock.add(late as unknown as Animation);
    expect(late.currentTime).toBe(32);
    clock.remove(late as unknown as Animation);
    frame(48);
    expect(late.cancelled).toBe(true); expect(late.currentTime).toBe(32);
    clock.cancel(); expect(queue).toHaveLength(0);
  });
  it("数值时钟同样从 0 开始并夹住长帧", () => {
    const values: number[] = [];
    runFrameValue(200, t => values.push(t));
    frame(0); frame(500); frame(516);
    expect(values[0]).toBe(0); expect(values[1]).toBeCloseTo(34 / 200); expect(values[2]).toBeCloseTo(50 / 200);
  });
});
