import { describe, expect, it } from "vitest";

import {
  LANGUAGE_STORAGE_KEY,
  createLanguageController,
  hasPriorAppState,
  parseLanguagePreference,
  readLanguagePreference,
  resolveLocale,
  type LanguageStorage,
} from "./language.js";

/** 内存版 localStorage，带 `length` / `key()`，与浏览器行为一致。 */
function memoryStorage(initial: Record<string, string> = {}): LanguageStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
  };
}

describe("语言偏好解析", () => {
  it("只接受 system 与支持的语言", () => {
    expect(parseLanguagePreference("en-US")).toBe("en-US");
    expect(parseLanguagePreference(" zh-CN ")).toBe("zh-CN");
    expect(parseLanguagePreference("system")).toBe("system");
    expect(parseLanguagePreference("fr-FR")).toBeNull();
    expect(parseLanguagePreference("")).toBeNull();
    expect(parseLanguagePreference(null)).toBeNull();
  });

  it("跟随系统时按浏览器语言解析", () => {
    expect(resolveLocale("system", ["en-GB"])).toBe("en-US");
    expect(resolveLocale("system", ["zh-TW"])).toBe("zh-CN");
    expect(resolveLocale("en-US", ["zh-CN"])).toBe("en-US");
  });
});

describe("首次运行的默认值", () => {
  it("全新设备记为「跟随系统」", () => {
    const storage = memoryStorage();
    expect(readLanguagePreference(storage)).toBe("system");
    expect(storage.data.get(LANGUAGE_STORAGE_KEY)).toBe("system");
  });

  it("以前用过 Libevra 的设备保持中文，不因浏览器是英文而突然变成英文", () => {
    const storage = memoryStorage({ "libevra.theme": "{\"mode\":\"light\",\"palette\":\"green\"}" });
    expect(hasPriorAppState(storage)).toBe(true);
    expect(readLanguagePreference(storage)).toBe("zh-CN");
    expect(storage.data.get(LANGUAGE_STORAGE_KEY)).toBe("zh-CN");
  });

  it("默认值只决定一次：之后出现其它本地记录也不会改变", () => {
    const storage = memoryStorage();
    expect(readLanguagePreference(storage)).toBe("system");
    storage.setItem("current-book", "abc");
    expect(readLanguagePreference(storage)).toBe("system");
  });

  it("存储不可用时不报错，按跟随系统处理", () => {
    const broken: LanguageStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readLanguagePreference(broken)).toBe("system");
    expect(readLanguagePreference(null)).toBe("system");
  });

  it("无法识别的旧值按首次运行规则重新决定", () => {
    const storage = memoryStorage({ [LANGUAGE_STORAGE_KEY]: "klingon" });
    expect(readLanguagePreference(storage)).toBe("system");
  });
});

describe("语言控制器", () => {
  it("手动选择后保存，刷新（重新创建控制器）后仍然生效", () => {
    const storage = memoryStorage();
    const applied: string[] = [];
    const first = createLanguageController({ storage, languages: () => ["zh-CN"], apply: (locale) => applied.push(locale) });
    expect(first.getSnapshot()).toEqual({ preference: "system", locale: "zh-CN" });

    first.choose("en-US");
    expect(first.getSnapshot()).toEqual({ preference: "en-US", locale: "en-US" });
    expect(storage.data.get(LANGUAGE_STORAGE_KEY)).toBe("en-US");

    const reopened = createLanguageController({ storage, languages: () => ["zh-CN"], apply: (locale) => applied.push(locale) });
    expect(reopened.getSnapshot()).toEqual({ preference: "en-US", locale: "en-US" });
    expect(applied).toEqual(["zh-CN", "en-US", "en-US"]);
  });

  it("通知订阅者；语言没变时不重复切换", () => {
    const storage = memoryStorage();
    const applied: string[] = [];
    const controller = createLanguageController({ storage, languages: () => ["en-US"], apply: (locale) => applied.push(locale) });
    let notified = 0;
    const unsubscribe = controller.subscribe(() => {
      notified += 1;
    });
    controller.choose("en-US"); // system(en) → en-US：显示语言不变，但偏好变了
    expect(notified).toBe(1);
    expect(applied).toEqual(["en-US"]);
    controller.choose("zh-CN");
    expect(notified).toBe(2);
    expect(applied).toEqual(["en-US", "zh-CN"]);
    unsubscribe();
    controller.choose("en-US");
    expect(notified).toBe(2);
  });

  it("另一个标签页改了偏好时同步", () => {
    const storage = memoryStorage({ [LANGUAGE_STORAGE_KEY]: "zh-CN" });
    const controller = createLanguageController({ storage, languages: () => [], apply: () => undefined });
    controller.restore("en-US");
    expect(controller.getSnapshot().locale).toBe("en-US");
    controller.restore(null);
    expect(controller.getSnapshot().preference).toBe("system");
  });

  it("系统语言变化只影响「跟随系统」", () => {
    let languages = ["zh-CN"];
    const storage = memoryStorage();
    const controller = createLanguageController({ storage, languages: () => languages, apply: () => undefined });
    languages = ["en-US"];
    controller.refreshSystem();
    expect(controller.getSnapshot().locale).toBe("en-US");
    controller.choose("zh-CN");
    languages = ["en-GB"];
    controller.refreshSystem();
    expect(controller.getSnapshot().locale).toBe("zh-CN");
  });
});
