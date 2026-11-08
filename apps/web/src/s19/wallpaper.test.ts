import { describe, expect, it } from "vitest";
import { createVisualStyleController, VISUAL_STYLE_STORAGE_KEY, type VisualStyleRoot, type VisualStyleStorage } from "../lib/visualStyle.js";
import { createThemeController, THEME_STORAGE_KEY } from "../lib/theme.js";
import { isAppDeviceStorageKey } from "../lib/deviceStorageKeys.js";
import { b2GlassStorageKey, presetGlass } from "./b2Glass.js";
import { DEFAULT_WALLPAPER, parseWallpaper, WALLPAPERS, WALLPAPER_STORAGE_KEY } from "./wallpaper.js";

function memory(initial: Record<string, string> = {}): VisualStyleStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value), removeItem: key => void data.delete(key) };
}

describe("壁纸与既有外观偏好的兼容", () => {
  it("旧用户或未知壁纸只回退壁纸，不改写主题、风格或账号玻璃配置", () => {
    for (const raw of [null, "", "unknown", '{"id":"quiet"}']) {
      const initial = { [VISUAL_STYLE_STORAGE_KEY]: "b2", [THEME_STORAGE_KEY]: '{"mode":"dark","palette":"purple"}', [b2GlassStorageKey("alice")]: JSON.stringify(presetGlass("clear")) };
      const storage = memory(initial);
      if (raw !== null) storage.setItem(WALLPAPER_STORAGE_KEY, raw);
      const before = [...storage.data];
      const root: VisualStyleRoot = { dataset: {} };
      const runtime = createVisualStyleController(root, storage);
      runtime.setB2Account("alice");
      expect(runtime.getWallpaperSnapshot()).toBe(DEFAULT_WALLPAPER);
      expect(root.dataset.wallpaper).toBe(DEFAULT_WALLPAPER);
      expect(runtime.getSnapshot()).toBe("b2");
      expect(runtime.getB2Snapshot().mode).toBe("clear");
      expect([...storage.data]).toEqual(before);
    }
  });

  it.each(WALLPAPERS)("%s 在切风格、玻璃、主题、账号和重新创建控制器后保持", id => {
    const storage = memory();
    const runtime = createVisualStyleController({ dataset: {} }, storage);
    const theme = createThemeController({ dataset: {} }, storage, { matches: false, addEventListener: () => {}, removeEventListener: () => {} });
    runtime.chooseWallpaper(id);
    runtime.choose("b2");
    runtime.setB2Account("alice");
    runtime.chooseB2Preset("clear");
    theme.choose({ palette: "purple", mode: "dark" });
    runtime.choose("b1");
    runtime.setB2Account("bob");
    runtime.chooseB2Preset("soft");
    const restored = createVisualStyleController({ dataset: {} }, storage);
    expect(restored.getWallpaperSnapshot()).toBe(id);
    expect(restored.getSnapshot()).toBe("b1");
    restored.setB2Account("alice");
    expect(restored.getB2Snapshot().mode).toBe("clear");
    expect(JSON.parse(storage.getItem(THEME_STORAGE_KEY)!)).toEqual({ palette: "purple", mode: "dark" });
    theme.dispose();
  });

  it("其他标签页的变更/清除只更新会话，不循环写回，不清除其它偏好", () => {
    const storage = memory({ [WALLPAPER_STORAGE_KEY]: "luminous", [VISUAL_STYLE_STORAGE_KEY]: "a" });
    const runtime = createVisualStyleController({ dataset: {} }, storage);
    let notifications = 0;
    const unsubscribe = runtime.subscribe(() => { notifications++; });
    runtime.restoreWallpaper("quiet");
    runtime.restoreWallpaper("quiet");
    expect(runtime.getWallpaperSnapshot()).toBe("quiet");
    expect(notifications).toBe(1);
    expect(storage.getItem(WALLPAPER_STORAGE_KEY)).toBe("luminous");
    runtime.restoreWallpaper(null);
    expect(runtime.getWallpaperSnapshot()).toBe(DEFAULT_WALLPAPER);
    expect(runtime.getSnapshot()).toBe("a");
    unsubscribe();
    runtime.chooseWallpaper("luminous");
    expect(notifications).toBe(2);
  });

  it("隐私模式或配额失败仍可切换，且清除本机数据覆盖新偏好键", () => {
    const fail = (): never => { throw new Error("存储不可用"); };
    const root: VisualStyleRoot = { dataset: {} };
    const runtime = createVisualStyleController(root, { getItem: fail, setItem: fail, removeItem: fail });
    runtime.chooseWallpaper("quiet");
    expect(runtime.getWallpaperSnapshot()).toBe("quiet");
    expect(root.dataset.wallpaper).toBe("quiet");
    expect(isAppDeviceStorageKey(WALLPAPER_STORAGE_KEY)).toBe(true);
    expect(parseWallpaper("url(https://invalid.test/image)")).toBe(DEFAULT_WALLPAPER);
  });
});
