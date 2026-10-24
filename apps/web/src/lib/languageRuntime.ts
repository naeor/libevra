/**
 * 浏览器里的语言运行时：把 `language.ts` 的偏好控制器接到 i18next、`<html lang>`、
 * 跨标签页同步与系统语言变化上。只在 `main.tsx` 渲染前启动一次。
 */
import { useSyncExternalStore } from "react";

import { applyLocale } from "../i18n/index.js";
import { browserLanguages, type Locale } from "../i18n/locales.js";
import {
  LANGUAGE_STORAGE_KEY,
  createLanguageController,
  type LanguageController,
  type LanguageSnapshot,
} from "./language.js";

let controller: LanguageController | null = null;

function applyToDocument(locale: Locale): void {
  applyLocale(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

/** 测试与无 DOM 环境：不读存储，固定为源语言，但仍可切换。 */
function fallbackController(): LanguageController {
  return createLanguageController({ storage: null, languages: () => [], apply: applyLocale });
}

export function startLanguageRuntime(): LanguageController {
  if (controller !== null) return controller;
  if (typeof window === "undefined") {
    controller = fallbackController();
    return controller;
  }

  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    /* 隐私模式：只在本次会话里生效。 */
  }

  const created = createLanguageController({
    storage,
    languages: browserLanguages,
    apply: applyToDocument,
  });
  controller = created;

  window.addEventListener("storage", (event) => {
    if (event.key === LANGUAGE_STORAGE_KEY) created.restore(event.newValue);
  });
  window.addEventListener("languagechange", () => {
    created.refreshSystem();
  });
  return created;
}

/** 组件订阅当前语言偏好（设置页、登录页切换按钮）。 */
export function useLanguagePreference(): LanguageSnapshot & { readonly choose: LanguageController["choose"] } {
  const runtime = startLanguageRuntime();
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  return { ...snapshot, choose: runtime.choose };
}
