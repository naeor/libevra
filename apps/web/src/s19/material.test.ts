import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createVisualStyleController } from "../lib/visualStyle.js";
import { isAppDeviceStorageKey } from "../lib/deviceStorageKeys.js";
import { DEFAULT_GLASS_BLUR, GLASS_BLUR_STORAGE_KEY, glassMaterial, motionBlur, parseGlassBlur } from "./material.js";

describe("正式材质令牌", () => {
  const css = readFileSync(new URL("./s19-lab-tokens.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it.each(["a", "b1", "c"])("%s 提供卡片、弹层、控件和编辑顶栏所需的基础令牌", (style) => {
    const selector = `:root[data-visual-style="${style}"]`;
    const block = css.split(selector)[1]?.split("}")[0] ?? "";
    for (const role of ["card-bg", "card-sh", "sheet-bg", "sheet-sh", "pill-bg", "pill-sh", "accent-bg", "accent-sh", "bar-sh"]) {
      expect(block, `${style} / ${role}`).toContain(`--s19-${role}:`);
    }
  });
});

describe("S19 玻璃偏好", () => {
  it("新默认为旧模糊的 65%，各语义有独立尺度；A/C 不随滑块改变", () => {
    expect(glassMaterial("b1").surfaceBlur).toBe(10.4);
    expect(glassMaterial("b2").surfaceBlur).toBe(9.1);
    expect(glassMaterial("b1").outgoingBlur).toBe(9.1);
    expect(glassMaterial("b1").environmentSpread).toBe(.825);
    expect(glassMaterial("b2", 100).surfaceBlur).toBe(14);
    expect(glassMaterial("b1", 0).surfaceBlur).toBe(0);
    for (const material of ["a", "c", "original"]) expect(motionBlur(material, 0, true)).toEqual(motionBlur(material, 100, true));
    expect(motionBlur("b2", 100, false).outgoingBlur).toBe(0);
  });
  it("旧设备、无效值回退默认，数字限制在相对强度范围", () => {
    for (const value of [null, undefined, "", "NaN", "{}", "Infinity"]) expect(parseGlassBlur(value)).toBe(DEFAULT_GLASS_BLUR);
    expect(parseGlassBlur("0")).toBe(0);
    expect(parseGlassBlur("-5")).toBe(0);
    expect(parseGlassBlur("200")).toBe(100);
    expect(isAppDeviceStorageKey(GLASS_BLUR_STORAGE_KEY)).toBe(true);
  });
  it("同一外观控制器保存、刷新恢复、切换风格保留，重置删除偏好", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
    const style = { setProperty: vi.fn() };
    const controller = createVisualStyleController({ dataset: {}, style }, storage);
    controller.chooseBlur(35); controller.choose("b1"); controller.choose("c"); controller.choose("b2");
    expect(controller.getBlurSnapshot()).toBe(35);
    expect(createVisualStyleController({ dataset: {} }, storage).getBlurSnapshot()).toBe(35);
    expect(style.setProperty).toHaveBeenCalledWith("--s19-b1-surface-blur", "5.6px");
    expect(style.setProperty).toHaveBeenCalledWith("--s19-b2-surface-blur", "4.9px");
    controller.resetBlur();
    expect(data.has(GLASS_BLUR_STORAGE_KEY)).toBe(false);
    expect(controller.getBlurSnapshot()).toBe(DEFAULT_GLASS_BLUR);
  });
  it("跨标签页与清除本机偏好即时跟随、不写回；存储不可用仍能预览", () => {
    const storage = { getItem: vi.fn(() => "35"), setItem: vi.fn(), removeItem: vi.fn() };
    const controller = createVisualStyleController({ dataset: {} }, storage);
    const listener = vi.fn(); const unsubscribe = controller.subscribe(listener);
    controller.restoreBlur("100"); controller.restoreBlur(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
    unsubscribe(); controller.chooseBlur(0); expect(listener).toHaveBeenCalledTimes(2);
    const fail = () => { throw new Error("storage unavailable"); };
    const unavailable = createVisualStyleController({ dataset: {} }, { getItem: fail, setItem: fail, removeItem: fail });
    unavailable.chooseBlur(20); expect(unavailable.getBlurSnapshot()).toBe(20);
    unavailable.resetBlur(); expect(unavailable.getBlurSnapshot()).toBe(DEFAULT_GLASS_BLUR);
  });
});
