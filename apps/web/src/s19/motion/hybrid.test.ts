import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaults } from "./backdrop.js";
import { MotionEngine } from "./engine.js";

const options = { ...defaults, scheme: "hybrid" as const, blurStrength: 35 };
function deferred() {
  let resolve!: () => void; let reject!: () => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = () => no(new Error("capture failed")); });
  return { promise, resolve, reject };
}
function nativeMock() {
  const ready = deferred(); const finished = deferred(); const skipTransition = vi.fn();
  let update!: () => void;
  const capture = vi.fn((callback: () => void) => { update = callback; return { ready: ready.promise, finished: finished.promise, skipTransition }; });
  Object.assign(document, { startViewTransition: capture });
  return { capture, ready, finished, skipTransition, update: () => update() };
}
function fallbackSurface() {
  const finished = deferred(); const cancel = vi.fn();
  const animate = vi.fn(() => ({ finished: finished.promise, cancel }));
  return { surface: { animate } as unknown as HTMLElement, animate, finished, cancel };
}
describe("B2 Hybrid 交接与释放", () => {
  let properties: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers(); properties = new Map();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("document", { hidden: false, documentElement: { dataset: {}, style: {
      setProperty: (key: string, value: string) => properties.set(key, value), removeProperty: (key: string) => properties.delete(key),
    } } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("捕获前预置目标环境；读取低模糊映射，结束清除交接属性与计时器", async () => {
    const native = nativeMock(); const engine = new MotionEngine(); const commit = vi.fn();
    engine.run(options, "push", commit, undefined, { ambient: "target-environment" });
    expect(commit).not.toHaveBeenCalled(); expect(engine.snapshots).toBe(2);
    expect(properties.get("--motion-hybrid-ambient")).toBe("target-environment");
    expect(properties.get("--motion-blur")).toBe("4.9px");
    expect(Number(properties.get("--motion-hybrid-contrast"))).toBeLessThan(.56);
    native.update(); native.ready.resolve(); await Promise.resolve();
    expect(commit).toHaveBeenCalledTimes(1); expect(engine.phase).toBe("transition");
    native.finished.resolve(); await Promise.resolve();
    expect(engine.snapshots).toBe(0); expect(engine.phase).toBe("idle");
    expect(properties.has("--motion-hybrid-ambient")).toBe(false);
    expect(document.documentElement.dataset.motionHybrid).toBeUndefined();
    expect(engine.samples[0]).toMatchObject({ scheme: "hybrid", handoff: true, fallback: null });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("交接开关关闭、其他材质不写 Hybrid 样式", () => {
    const engine = new MotionEngine();
    for (const setting of [{ ...options, handoff: false }, { ...options, material: "b1" as const }, { ...options, scheme: "native" as const }]) {
      nativeMock(); engine.run(setting, "push", vi.fn());
      expect(document.documentElement.dataset.motionHybrid).toBeUndefined(); engine.cancel();
    }
  });
  it("不支持原生时只淡入目标 Ambient，不复活旧页面", async () => {
    const target = fallbackSurface(); const commit = vi.fn(); const engine = new MotionEngine();
    engine.run(options, "push", commit, undefined, { ambient: "target", fallbackSurface: () => target.surface });
    expect(commit).toHaveBeenCalledTimes(1); expect(target.animate).toHaveBeenCalledTimes(1);
    expect(engine.snapshots).toBe(0); expect(engine.phase).toBe("ambient");
    target.finished.resolve(); await Promise.resolve();
    expect(engine.samples[0]).toMatchObject({ fallback: "unsupported", fallbackMode: "ambient" });
    expect(target.cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("取消捕获后立即交付目标；旧回调不能覆盖下一次返回及其环境", async () => {
    const engine = new MotionEngine(); const pages: string[] = [];
    const first = nativeMock(); engine.run(options, "push", () => pages.push("D"), undefined, { ambient: "D" });
    const second = nativeMock(); engine.run(options, "pop", () => pages.push("C"), undefined, { ambient: "C-from-B" });
    second.update(); first.update(); first.ready.resolve(); first.finished.resolve(); await Promise.resolve();
    expect(pages).toEqual(["D", "C"]); expect(properties.get("--motion-hybrid-ambient")).toBe("C-from-B");
    expect(engine.active).toBe(true); expect(first.skipTransition).toHaveBeenCalledTimes(1);
    second.finished.resolve(); await Promise.resolve(); expect(engine.active).toBe(false);
  });
  it("捕获超时降到 C，迟到的 ready/finished 不提前结束 C 或重复提交", async () => {
    const native = nativeMock(); const target = fallbackSurface(); const commit = vi.fn(); const engine = new MotionEngine();
    engine.run(options, "pop", commit, undefined, { ambient: "restored-C", fallbackSurface: () => target.surface });
    vi.advanceTimersByTime(121); native.update(); native.ready.resolve(); native.finished.resolve(); await Promise.resolve();
    expect(commit).toHaveBeenCalledTimes(1); expect(engine.phase).toBe("ambient"); expect(engine.active).toBe(true);
    expect(engine.snapshots).toBe(0); expect(native.skipTransition).toHaveBeenCalledTimes(1);
    target.finished.resolve(); await Promise.resolve();
    expect(engine.samples[0]).toMatchObject({ fallback: "capture-timeout", fallbackMode: "ambient" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("捕获拒绝只降级一次；淡入也不可用时即时显示", async () => {
    const native = nativeMock(); const commit = vi.fn(); const engine = new MotionEngine();
    const broken = { animate: () => { throw new Error("animation unavailable"); } } as unknown as HTMLElement;
    engine.run(options, "push", commit, undefined, { ambient: "target", fallbackSurface: () => broken });
    native.ready.reject(); native.finished.reject(); await Promise.resolve(); await Promise.resolve();
    expect(commit).toHaveBeenCalledTimes(1); expect(engine.fallbacks).toBe(1);
    expect(engine.samples[0]?.fallbackMode).toBe("instant"); expect(engine.snapshots).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("减少动态/后台直接提交，无隐形等待；过大快照不申请", () => {
    const engine = new MotionEngine(); const native = nativeMock(); const commit = vi.fn();
    vi.stubGlobal("matchMedia", () => ({ matches: true })); engine.run(options, "push", commit);
    vi.stubGlobal("matchMedia", () => ({ matches: false })); Object.assign(document, { hidden: true }); engine.run(options, "pop", commit);
    expect(commit).toHaveBeenCalledTimes(2); expect(native.capture).not.toHaveBeenCalled();
    Object.assign(document, { hidden: false }); vi.stubGlobal("window", { innerWidth: 2000, innerHeight: 1000, devicePixelRatio: 3 });
    engine.run(options, "push", commit);
    expect(native.capture).not.toHaveBeenCalled(); expect(engine.samples[0]?.fallback).toBe("snapshot-budget");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("逐帧审查只暂停转场动画、支持恢复，样本标记为非性能数据", async () => {
    const native = nativeMock(); const engine = new MotionEngine();
    const animation = { animationName: "hybrid-recede", pause: vi.fn(), play: vi.fn(), currentTime: 0 };
    const unrelated = { animationName: "ml-pulse", pause: vi.fn() };
    Object.assign(document, { getAnimations: () => [animation, unrelated] });
    engine.seekInspection(.4); engine.run(options, "push", vi.fn());
    native.update(); native.ready.resolve(); await Promise.resolve();
    expect(animation.pause).toHaveBeenCalledTimes(1); expect(unrelated.pause).not.toHaveBeenCalled();
    expect(animation.currentTime).toBe(80);
    engine.seekInspection(.95); expect(animation.currentTime).toBe(190);
    engine.resumeInspection(); expect(animation.play).toHaveBeenCalledTimes(1);
    native.finished.resolve(); await Promise.resolve();
    expect(engine.samples[0]?.inspection).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
});
