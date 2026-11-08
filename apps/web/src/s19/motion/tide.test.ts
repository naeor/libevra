import { afterEach, describe, expect, it, vi } from "vitest";
import { TidePresentation, tideLook } from "./tide.js";
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
  it("品牌转场整段约 1 秒：涌下 + 退去在 0.7–1.0 秒之间，淡出很短", () => {
    const total = LEDGER_TIDE.cover.duration + LEDGER_TIDE.recede.duration;
    expect(total).toBeGreaterThanOrEqual(700); expect(total).toBeLessThanOrEqual(1000);
    expect(LEDGER_TIDE.fadeOut).toBeLessThanOrEqual(200);
  });
});
