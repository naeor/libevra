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

  it("is an app-owned device key, so clearing local data also clears it", () => {
    expect(isAppDeviceStorageKey(VISUAL_STYLE_STORAGE_KEY)).toBe(true);
  });
});
