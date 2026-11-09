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
  it("整页重新载入后的交接帧：只有铺底帧仍在、风格与宽度一致时才接着播放；播放出画面前不删除；不接时铺底淡出", () => {
    vi.useFakeTimers();
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    const attrs = new Map<string, string>([["data-tide-resume", ""]]);
    vi.stubGlobal("document", { documentElement: { dataset: {}, hasAttribute: (n: string) => attrs.has(n), getAttribute: (n: string) => attrs.get(n) ?? null,
      setAttribute: (n: string, v: string) => attrs.set(n, v), removeAttribute: (n: string) => attrs.delete(n), style: { removeProperty: () => "" } } });
    vi.stubGlobal("innerWidth", 390); vi.stubGlobal("innerHeight", 844);
    const frame: TideResume = { at: Date.now(), look: "b2", seconds: 2, y: 200, c: 90, width: 390, height: 844, image: "data:image/jpeg;base64,", color: "#fff" };
    store.set("libevra.tide-resume", JSON.stringify(frame));
    expect(takeTideResume("b2")?.y).toBe(200);
    // StrictMode 立刻重建协调器时还能再取到。
    expect(takeTideResume("b2")?.y).toBe(200);
    // iOS 地址栏让视口高度变了：照样接着播放（按比例换算）。
    vi.stubGlobal("innerHeight", 760);
    expect(takeTideResume("b2")?.y).toBe(200);
    // 风格不同：不接着播放，删除交接帧，铺底先淡出再撤掉（不硬切）。
    expect(takeTideResume("c")).toBeNull();
    expect(store.size).toBe(0); expect(attrs.get("data-tide-resume")).toBe("fade");
    vi.advanceTimersByTime(250);
    expect(attrs.size).toBe(0);
    // 宽度变了（转屏）也不接。
    attrs.set("data-tide-resume", ""); store.set("libevra.tide-resume", JSON.stringify(frame)); vi.stubGlobal("innerWidth", 844);
    expect(takeTideResume("b2")).toBeNull();
    vi.useRealTimers();
  });
  it("切换账本：转场不能播放时照常载入（go(null)），不让切换卡住；不能播放时也不等海浪", async () => {
    html({ themeMode: "light", visualStyle: "c" });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const go = vi.fn();
    new TidePresentation().run({ exit: true, look: "c", page: () => ({}) as HTMLElement, commit: () => undefined, reload: { ready: () => true, go } });
    expect(go).toHaveBeenCalledWith(null);
    const work = vi.fn(() => Promise.resolve());
    await new TidePresentation().coverForReload("c", () => ({}) as HTMLElement, work, "正在加载新账本……");
    expect(work).toHaveBeenCalledTimes(1);
  });
  it("等待提示：载入很快时不出现（先等一小段再淡入），淡入很短", () => {
    expect(LEDGER_TIDE.hint.delay).toBeGreaterThanOrEqual(200); expect(LEDGER_TIDE.hint.delay).toBeLessThanOrEqual(600);
    expect(LEDGER_TIDE.hint.fadeIn).toBeLessThanOrEqual(240);
    expect(LEDGER_TIDE.resumeHoldMs).toBeGreaterThan(1000);
  });
  it("品牌转场整段约 1 秒，浪比屏幕厚、留出整屏遮挡的交接行程，淡出很短", () => {
    expect(LEDGER_TIDE.sweep.duration).toBeGreaterThanOrEqual(800); expect(LEDGER_TIDE.sweep.duration).toBeLessThanOrEqual(1100);
    expect(LEDGER_TIDE.coverWindow).toBeGreaterThan(0);
    expect(LEDGER_TIDE.fadeOut).toBeLessThanOrEqual(200);
  });
});
