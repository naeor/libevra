import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LANGUAGE_STORAGE_KEY, type LanguageStorage } from "./language.js";
import { THEME_STORAGE_KEY } from "./theme.js";

/**
 * S16-E-11：另一个标签页写入主题 / 语言偏好时，当前标签页应实时跟随，并且不得把
 * 收到的值再写回存储（否则会形成两标签页互相覆盖的抖动，见 2026-10-25 的跨标签核对）。
 *
 * 这两个 `storage` 监听器写在 `startThemeRuntime()` / `startLanguageRuntime()` 里，只有
 * 浏览器运行时会注册，所以这里用最小假环境（window/document/localStorage）把它们启动起来，
 * 再派发 StorageEvent 验证行为。
 */
function memoryStorage(initial: Record<string, string> = {}): LanguageStorage & {
  data: Map<string, string>;
  writeCount: number;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    writeCount: 0,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
  } as LanguageStorage & { data: Map<string, string>; writeCount: number };
}

function installBrowserStubs(options: { stored?: Record<string, string>; systemDark?: boolean } = {}) {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const storage = memoryStorage(options.stored);
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    storage.writeCount += 1;
    setItem(key, value);
  };
  const fakeWindow = {
    localStorage: storage,
    matchMedia: () => ({
      matches: options.systemDark ?? false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    addEventListener: (type: string, listener: (event: unknown) => void): void => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (): void => undefined,
    dispatch: (type: string, event: unknown): void => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
  const fakeDocument = {
    documentElement: {
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
      lang: "",
    },
  };
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("navigator", { languages: ["zh-CN"], language: "zh-CN" });
  return { window: fakeWindow, document: fakeDocument, storage };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("跨标签页主题同步", () => {
  it("另一标签页切到深色时，本标签页应用深色且不回写存储", async () => {
    const { window: fakeWindow, document: fakeDocument, storage } = installBrowserStubs();
    const theme = await import("./theme.js");
    const controller = theme.startThemeRuntime();
    expect(controller.getSnapshot()).toEqual({ mode: "light", palette: "green" });
    expect(fakeDocument.documentElement.dataset.themeMode).toBe("light");
    const writesBefore = storage.writeCount;

    fakeWindow.dispatch("storage", {
      key: THEME_STORAGE_KEY,
      newValue: JSON.stringify({ mode: "dark", palette: "blue" }),
    });

    expect(controller.getSnapshot()).toEqual({ mode: "dark", palette: "blue" });
    expect(fakeDocument.documentElement.dataset.themeMode).toBe("dark");
    expect(fakeDocument.documentElement.dataset.themePalette).toBe("blue");
    expect(storage.writeCount).toBe(writesBefore);
  });

  it("存储被清空（key=null）时退回默认主题且不回写", async () => {
    const { window: fakeWindow, document: fakeDocument, storage } = installBrowserStubs({
      stored: { [THEME_STORAGE_KEY]: JSON.stringify({ mode: "dark", palette: "green" }) },
    });
    const theme = await import("./theme.js");
    const controller = theme.startThemeRuntime();
    expect(controller.getSnapshot().mode).toBe("dark");
    const writesBefore = storage.writeCount;

    fakeWindow.dispatch("storage", { key: null, newValue: null });

    expect(controller.getSnapshot()).toEqual({ mode: "light", palette: "green" });
    expect(fakeDocument.documentElement.dataset.themeMode).toBe("light");
    expect(storage.writeCount).toBe(writesBefore);
  });
});

describe("跨标签页语言同步", () => {
  it("另一标签页切到英文时，本标签页立即更新文档语言且不回写存储", async () => {
    const { window: fakeWindow, document: fakeDocument, storage } = installBrowserStubs({
      stored: { [LANGUAGE_STORAGE_KEY]: "zh-CN" },
    });
    const languageRuntime = await import("./languageRuntime.js");
    languageRuntime.startLanguageRuntime();
    expect(fakeDocument.documentElement.lang).toBe("zh-CN");
    const writesBefore = storage.writeCount;

    fakeWindow.dispatch("storage", { key: LANGUAGE_STORAGE_KEY, newValue: "en-US" });

    expect(fakeDocument.documentElement.lang).toBe("en-US");
    expect(storage.writeCount).toBe(writesBefore);
  });

  it("无关的存储键不会改变语言", async () => {
    const { window: fakeWindow, document: fakeDocument } = installBrowserStubs({
      stored: { [LANGUAGE_STORAGE_KEY]: "zh-CN" },
    });
    const languageRuntime = await import("./languageRuntime.js");
    languageRuntime.startLanguageRuntime();

    fakeWindow.dispatch("storage", { key: "libevra.theme", newValue: "garbage" });

    expect(fakeDocument.documentElement.lang).toBe("zh-CN");
  });
});
