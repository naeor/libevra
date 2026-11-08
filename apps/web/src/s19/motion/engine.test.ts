import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaults } from "./backdrop.js";
import { MotionEngine } from "./engine.js";
describe("转场失效与并发提交", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("document", { hidden: false, documentElement: { dataset: {}, style: { setProperty: vi.fn() } } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("无 API 立即提交并清理计时器", () => {
    const engine = new MotionEngine(); const commit = vi.fn();
    engine.run(defaults, "push", commit);
    expect(commit).toHaveBeenCalledTimes(1); expect(engine.active).toBe(false);
    expect(engine.snapshots).toBe(0); expect(engine.samples[0]?.fallback).toBe("unsupported");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("原生快照与 DOM 动画消费同一强度，取消后仍可清理", () => {
    const engine = new MotionEngine();
    const oldAnimate = vi.fn((_frames: Keyframe[]) => ({ finished: new Promise(() => undefined), cancel: vi.fn() }));
    const nextAnimate = vi.fn(() => ({ finished: new Promise(() => undefined), cancel: vi.fn() }));
    engine.run({ ...defaults, scheme: "live", blurStrength: 35 }, "push", vi.fn(), {
      old: { animate: oldAnimate } as unknown as HTMLElement,
      next: { animate: nextAnimate } as unknown as HTMLElement, settle: vi.fn(),
    });
    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith("--motion-blur", "4.9px");
    expect(oldAnimate.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ filter: "blur(4.9px) contrast(.56) saturate(.8)" })]));
    engine.cancel(); expect(vi.getTimerCount()).toBe(0);
  });
  it("减少动态不捕获、不等待原时长", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const capture = vi.fn(); Object.assign(document, { startViewTransition: capture });
    const engine = new MotionEngine(); const commit = vi.fn();
    engine.run(defaults, "pop", commit);
    expect(commit).toHaveBeenCalledTimes(1); expect(capture).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("取消后的原生回调不覆盖新页面，也不清理新动画", async () => {
    const callbacks: (() => void)[] = []; const completions: (() => void)[] = [];
    const skips = vi.fn();
    Object.assign(document, { startViewTransition: (cb: () => void) => {
      callbacks.push(cb);
      return { ready: new Promise(() => undefined), finished: new Promise<void>(resolve => completions.push(resolve)), skipTransition: skips };
    } });
    const pages: string[] = []; const engine = new MotionEngine();
    engine.run(defaults, "push", () => pages.push("B"));
    engine.run(defaults, "push", () => pages.push("C"));
    callbacks[1]?.(); callbacks[0]?.(); completions[0]?.(); await Promise.resolve();
    expect(pages).toEqual(["B", "C"]); expect(engine.active).toBe(true);
    completions[1]?.(); await Promise.resolve();
    expect(engine.active).toBe(false); expect(engine.snapshots).toBe(0);
    expect(engine.interruptions).toBe(1); expect(skips).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("捕获超时后提交一次，迟到回调没有副作用", () => {
    let callback: (() => void) | undefined;
    Object.assign(document, { startViewTransition: (cb: () => void) => {
      callback = cb;
      return { ready: new Promise(() => undefined), finished: new Promise(() => undefined), skipTransition: vi.fn() };
    } });
    const engine = new MotionEngine(); const commit = vi.fn();
    engine.run(defaults, "push", commit); vi.advanceTimersByTime(121); callback?.();
    expect(commit).toHaveBeenCalledTimes(1); expect(engine.snapshots).toBe(0);
    expect(engine.samples[0]?.fallback).toBe("capture-timeout"); expect(vi.getTimerCount()).toBe(0);
  });
  it("过大快照不申请浏览器资源，后台直接提交", () => {
    vi.stubGlobal("window", { innerWidth: 1400, innerHeight: 1000, devicePixelRatio: 3 });
    const capture = vi.fn(); Object.assign(document, { startViewTransition: capture });
    const engine = new MotionEngine(); const commit = vi.fn();
    engine.run(defaults, "push", commit);
    expect(engine.samples[0]?.fallback).toBe("snapshot-budget"); expect(capture).not.toHaveBeenCalled();
    Object.assign(document, { hidden: true });
    engine.run(defaults, "pop", commit);
    expect(commit).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});
