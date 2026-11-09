import { afterEach, describe, expect, it, vi } from "vitest";
import { beginMotion, isMotionIdle, whenMotionIdle } from "./motionIdle.js";

afterEach(() => vi.useRealTimers());

describe("转场期间让出主线程", () => {
  it("转场进行时推迟，最后一个转场结束后按顺序执行；重复结束只生效一次", () => {
    const done: string[] = [];
    const a = beginMotion(), b = beginMotion();
    whenMotionIdle(() => done.push("chart"));
    expect(isMotionIdle()).toBe(false); expect(done).toEqual([]);
    a(); a();
    expect(done).toEqual([]);
    b();
    expect(done).toEqual(["chart"]); expect(isMotionIdle()).toBe(true);
    whenMotionIdle(() => done.push("now"));
    expect(done).toEqual(["chart", "now"]);
  });
  it("呈现器没有收尾时，安全阀到时照样放行", () => {
    vi.useFakeTimers();
    const done: string[] = [];
    beginMotion();
    whenMotionIdle(() => done.push("chart"));
    vi.advanceTimersByTime(2600);
    expect(done).toEqual(["chart"]); expect(isMotionIdle()).toBe(true);
  });
});
