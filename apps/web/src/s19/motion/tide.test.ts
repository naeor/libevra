import { afterEach, describe, expect, it, vi } from "vitest";
import { TidePresentation, takeTideResume, tideLook, type TideResume } from "./tide.js";
import { LEDGER_TIDE } from "../../lib/motionTokens.js";

afterEach(() => vi.unstubAllGlobals());
const html = (dataset: Record<string, string>) => vi.stubGlobal("document", { documentElement: { dataset }, hidden: false });

describe("账本空间海浪转场", () => {
  it("只在浅色 A / B1 / B2 / C 下播放（开始页海浪也只有这四种材质）", () => {
    html({ themeMode: "light", visualStyle: "b2" }); expect(tideLook()).toBe("b2");
    html({ themeMode: "light", visualStyle: "c" }); expect(tideLook()).toBe("c");
    html({ themeMode: "dark", visualStyle: "b2" }); expect(tideLook()).toBeNull();
    html({ themeMode: "light", visualStyle: "original" }); expect(tideLook()).toBeNull();
  });
  it("减少动态效果：只交付页面，不建舞台", () => {
    html({ themeMode: "light", visualStyle: "c" });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const commit = vi.fn();
    new TidePresentation().run({ exit: false, look: "c", page: () => ({}) as HTMLElement, commit });
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it("整页重新载入后的交接帧：只有铺底帧仍在、风格与尺寸一致时才接着播放；播放出画面前不删除", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    const attrs = new Set<string>(["data-tide-resume"]);
    vi.stubGlobal("document", { documentElement: { dataset: {}, hasAttribute: (n: string) => attrs.has(n), removeAttribute: (n: string) => attrs.delete(n), style: { removeProperty: () => "" } } });
    vi.stubGlobal("innerWidth", 390); vi.stubGlobal("innerHeight", 844);
    const frame: TideResume = { at: Date.now(), look: "b2", seconds: 2, y: 200, c: 90, width: 390, height: 844, image: "data:image/jpeg;base64,", color: "#fff" };
    store.set("libevra.tide-resume", JSON.stringify(frame));
    expect(takeTideResume("b2")?.y).toBe(200);
    // StrictMode 立刻重建协调器时还能再取到。
    expect(takeTideResume("b2")?.y).toBe(200);
    // 风格不同：不接着播放，撤掉铺底并删除。
    expect(takeTideResume("c")).toBeNull();
    expect(store.size).toBe(0); expect(attrs.size).toBe(0);
  });
  it("品牌转场整段约 1 秒，浪比屏幕厚、留出整屏遮挡的交接行程，淡出很短", () => {
    expect(LEDGER_TIDE.sweep.duration).toBeGreaterThanOrEqual(800); expect(LEDGER_TIDE.sweep.duration).toBeLessThanOrEqual(1100);
    expect(LEDGER_TIDE.coverWindow).toBeGreaterThan(0);
    expect(LEDGER_TIDE.fadeOut).toBeLessThanOrEqual(200);
  });
});
