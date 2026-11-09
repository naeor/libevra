import { describe, expect, it } from "vitest";
import {
  VISUAL_STYLE_STORAGE_KEY,
  applyVisualStyle,
  createVisualStyleController,
  parseVisualStyle,
  type VisualStyleStorage,
} from "./visualStyle.js";
import { isAppDeviceStorageKey } from "./deviceStorageKeys.js";

function memoryStorage(initial: Record<string, string> = {}): VisualStyleStorage & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("S19 visual style lab", () => {
  it("defaults to Original for missing or unknown values", () => {
    expect(parseVisualStyle(null)).toBe("original");
    expect(parseVisualStyle("")).toBe("original");
    expect(parseVisualStyle("glass")).toBe("original");
    expect(parseVisualStyle(" B1 ")).toBe("b1");
  });

  it("writes no attribute for Original, so no S19 rule can match", () => {
    const root = { dataset: {} as { visualStyle?: string } };
    applyVisualStyle(root, "a");
    expect(root.dataset.visualStyle).toBe("a");
    applyVisualStyle(root, "original");
    expect("visualStyle" in root.dataset).toBe(false);
  });

  it("restores the stored choice, persists new ones and follows other tabs without writing back", () => {
    const storage = memoryStorage({ [VISUAL_STYLE_STORAGE_KEY]: "c" });
    const root = { dataset: {} as { visualStyle?: string } };
    const controller = createVisualStyleController(root, storage);
    expect(controller.getSnapshot()).toBe("c");
    expect(root.dataset.visualStyle).toBe("c");

    let notified = 0;
    controller.subscribe(() => { notified += 1; });
    controller.choose("b2");
    expect(storage.data.get(VISUAL_STYLE_STORAGE_KEY)).toBe("b2");
    controller.choose("original");
    expect(storage.data.has(VISUAL_STYLE_STORAGE_KEY)).toBe(false);
    expect("visualStyle" in root.dataset).toBe(false);

    controller.restore("a");
    expect(root.dataset.visualStyle).toBe("a");
    expect(storage.data.has(VISUAL_STYLE_STORAGE_KEY)).toBe(false);
    expect(notified).toBe(3);
  });

  it("lets a test link pick a style and remembers it", () => {
    const storage = memoryStorage();
    const root = { dataset: {} as { visualStyle?: string } };
    const controller = createVisualStyleController(root, storage, "b1");
    expect(controller.getSnapshot()).toBe("b1");
    expect(storage.data.get(VISUAL_STYLE_STORAGE_KEY)).toBe("b1");
  });

  it("首次从 B1 进入 B2 后重载，不把 B1 强度当作旧 B2 模糊迁移", () => {
    const storage = memoryStorage();
    const controller = createVisualStyleController({ dataset: {} }, storage);
    controller.choose("b1"); controller.chooseBlur(30); controller.choose("b2");
    const restored = createVisualStyleController({ dataset: {} }, storage);
    expect(restored.getB2Snapshot().mode).toBe("balanced");
    expect(restored.getB2Snapshot().values.blur).toBe(65);
    expect(restored.getBlurSnapshot()).toBe(30);
  });

  it("is an app-owned device key, so clearing local data also clears it", () => {
    expect(isAppDeviceStorageKey(VISUAL_STYLE_STORAGE_KEY)).toBe(true);
  });
  it("四风格正式可选，重载及往返切换保留独立参数和旧偏好", () => {
    const storage = memoryStorage({ [VISUAL_STYLE_STORAGE_KEY]: "b1", "libevra.s19-glass-blur": "65", "libevra.theme": '{"mode":"system","palette":"purple"}' });
    const controller = createVisualStyleController({ dataset: {} }, storage, undefined, false);
    expect(controller.getSnapshot()).toBe("b1");
    expect(controller.getBlurSnapshot()).toBe(65);
    controller.chooseWallpaper("quiet");
    controller.chooseB2Preset("soft");
    for (const strength of [30, 55, 80]) {
      controller.chooseBlur(strength);
      for (const style of ["c", "a", "b2", "b1"] as const) {
        controller.choose(style);
        expect(controller.getSnapshot()).toBe(style);
        expect(controller.getBlurSnapshot()).toBe(strength);
        expect(controller.getWallpaperSnapshot()).toBe("quiet");
        expect(controller.getB2Snapshot().mode).toBe("soft");
      }
    }
    const restored = createVisualStyleController({ dataset: {} }, storage, undefined, false);
    expect(restored.getBlurSnapshot()).toBe(80);
    expect(restored.getB2Snapshot().mode).toBe("soft");
    expect(restored.getWallpaperSnapshot()).toBe("quiet");
    expect(storage.data.get("libevra.theme")).toBe('{"mode":"system","palette":"purple"}');
  });

});
