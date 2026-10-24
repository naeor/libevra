import { afterEach, describe, expect, it } from "vitest";

import { i18n, applyLocale, clearMissingTranslationKeys, currentLocale, missingTranslationKeys, t } from "./index.js";
import { detectLocale, matchLocale, SUPPORTED_LOCALES } from "./locales.js";
import { enUS, zhCN } from "./resources/index.js";

/**
 * S16 国际化：文案完整性与回退规则。
 *
 * TypeScript 已经保证 en-US 与 zh-CN 键结构一致；这里再从**运行时**角度检查那些类型管不到的事：
 * 占位符是否一致、英文里有没有残留中文、有没有空字符串、复数是否成对、回退是否按约定工作。
 */

type Tree = { readonly [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") out.set(path, value);
    else for (const [nested, text] of flatten(value, path)) out.set(nested, text);
  }
  return out;
}

const zh = flatten(zhCN as unknown as Tree);
const en = flatten(enUS as unknown as Tree);

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((match) => match[1] ?? "").sort();
}

/** 英文里允许出现中文的键：语言名称本身按各自语言书写，是刻意的。 */
const CJK_ALLOWED_IN_EN = new Set(["language.rowHint", "language.pageTitle"]);
const CJK = /[㐀-鿿豈-﫿]/u;

afterEach(() => {
  applyLocale("zh-CN");
  clearMissingTranslationKeys();
});

describe("文案资源完整性", () => {
  it("中英文键集合完全一致", () => {
    const onlyZh = [...zh.keys()].filter((key) => !en.has(key));
    const onlyEn = [...en.keys()].filter((key) => !zh.has(key));
    expect(onlyZh).toEqual([]);
    expect(onlyEn).toEqual([]);
  });

  it("每条文案的占位符在两种语言中一致", () => {
    const mismatched: string[] = [];
    for (const [key, zhText] of zh) {
      const enText = en.get(key) ?? "";
      if (placeholders(zhText).join(",") !== placeholders(enText).join(",")) {
        mismatched.push(`${key}: zh{${placeholders(zhText).join(",")}} en{${placeholders(enText).join(",")}}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("没有空文案", () => {
    expect([...zh].filter(([, text]) => text.trim() === "").map(([key]) => key)).toEqual([]);
    expect([...en].filter(([, text]) => text.trim() === "").map(([key]) => key)).toEqual([]);
  });

  it("英文文案里没有残留中文（语言自称除外）", () => {
    const leaked = [...en].filter(([key, text]) => CJK.test(text) && !CJK_ALLOWED_IN_EN.has(key)).map(([key, text]) => `${key}: ${text}`);
    expect(leaked).toEqual([]);
  });

  it("复数键成对出现（_one 必有 _other）", () => {
    for (const map of [zh, en]) {
      for (const key of map.keys()) {
        if (key.endsWith("_one")) expect(map.has(`${key.slice(0, -4)}_other`), key).toBe(true);
      }
    }
  });
});

describe("语言识别", () => {
  it("按主语言匹配", () => {
    expect(matchLocale("zh-CN")).toBe("zh-CN");
    expect(matchLocale("zh-TW")).toBe("zh-CN");
    expect(matchLocale("zh-Hans-SG")).toBe("zh-CN");
    expect(matchLocale("en-GB")).toBe("en-US");
    expect(matchLocale("EN")).toBe("en-US");
    expect(matchLocale("ja-JP")).toBeNull();
    expect(matchLocale("")).toBeNull();
  });

  it("取浏览器语言列表中第一种支持的语言", () => {
    expect(detectLocale(["ja-JP", "en-US", "zh-CN"])).toBe("en-US");
    expect(detectLocale(["zh-HK", "en"])).toBe("zh-CN");
    expect(detectLocale(["fr-FR", "de"])).toBe("zh-CN");
    expect(detectLocale([])).toBe("zh-CN");
  });

  it("支持的语言清单与资源一致", () => {
    expect([...SUPPORTED_LOCALES]).toEqual(["zh-CN", "en-US"]);
  });
});

describe("运行时翻译与回退", () => {
  it("默认是简体中文（测试与无浏览器环境）", () => {
    expect(currentLocale()).toBe("zh-CN");
    expect(t("common.action.save")).toBe("保存");
  });

  it("切换语言不需要刷新，立即生效", () => {
    applyLocale("en-US");
    expect(currentLocale()).toBe("en-US");
    expect(t("common.action.save")).toBe("Save");
    applyLocale("zh-CN");
    expect(t("common.action.save")).toBe("保存");
  });

  it("英文按数量选择单复数，中文不区分", () => {
    applyLocale("en-US");
    expect(t("common.count.entries", { count: 1 })).toBe("1 entry");
    expect(t("common.count.entries", { count: 3 })).toBe("3 entries");
    applyLocale("zh-CN");
    expect(t("common.count.entries", { count: 1 })).toBe("1 笔");
    expect(t("common.count.entries", { count: 3 })).toBe("3 笔");
  });

  it("插值保留原样（React 负责转义，不做二次转义）", () => {
    applyLocale("en-US");
    expect(t("language.current", { language: "<b>English</b>" })).toBe("Current: <b>English</b>");
  });

  it("英文缺某条文案时回退到中文原文", () => {
    i18n.addResource("zh-CN", "translation", "testOnly.fallbackProbe", "仅中文");
    applyLocale("en-US");
    expect(i18n.t("testOnly.fallbackProbe" as "common.action.save")).toBe("仅中文");
  });

  it("两种语言都没有的键显示键名，并被记录为缺失", () => {
    applyLocale("en-US");
    expect(i18n.t("testOnly.doesNotExist" as "common.action.save")).toBe("testOnly.doesNotExist");
    expect(missingTranslationKeys().some((entry) => entry.endsWith("testOnly.doesNotExist"))).toBe(true);
  });
});
