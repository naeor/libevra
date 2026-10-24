/**
 * **Libevra 的国际化入口（S16）。** 所有界面文案都从这里取。
 *
 * 选型：i18next + react-i18next（见 `docs/adr/` 中的 S16 国际化 ADR）。
 *   - 文案是普通 TS 对象（`resources/zh-CN/*.ts` 与 `resources/en-US/*.ts`），英文用
 *     `Messages<typeof zh>` 约束，缺键在类型检查阶段就会报错；
 *   - 插值写 `{{name}}`，复数写 `key_one` / `key_other`（按 `Intl.PluralRules` 选择）；
 *   - 缺键回退：英文缺某条 → 显示中文原文；两种语言都没有 → 显示键名，并在开发环境告警；
 *   - 两种语言都打进主包，切换即时、离线可用。
 *
 * 用法：
 * ```tsx
 * const { t } = useI18n();   // 或直接 import { t } from "../i18n/index.js"
 * return <h1>{t("settings.home.title")}</h1>;
 * ```
 * 非组件代码用导出的 `t()`，但**必须在渲染 / 调用时取文案，不能在模块顶层取**——
 * 顶层常量会把当时的语言固定下来，切换后不会变。
 */
import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";

import {
  SOURCE_LOCALE,
  SUPPORTED_LOCALES,
  isLocale,
  type Locale,
} from "./locales.js";
import { PSEUDO_LOCALE, pseudoEnabled, pseudoLocalizeTree } from "./pseudo.js";
import { enUS, zhCN } from "./resources/index.js";

export { LOCALE_NATIVE_NAMES, LOCALE_SHORT_NAMES, SUPPORTED_LOCALES, type Locale } from "./locales.js";

const missing = new Set<string>();

/** 本次运行中出现过的缺失键（`语言:键`）。测试用它断言页面没有漏翻。 */
export function missingTranslationKeys(): readonly string[] {
  return [...missing];
}

export function clearMissingTranslationKeys(): void {
  missing.clear();
}

void i18next.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
  lng: SOURCE_LOCALE,
  fallbackLng: SOURCE_LOCALE,
  // 伪语言只在开发环境注册（见 `pseudo.ts`），生产包里只有两种正式语言。
  supportedLngs: import.meta.env?.DEV === true ? [...SUPPORTED_LOCALES, PSEUDO_LOCALE] : [...SUPPORTED_LOCALES],
  load: "currentOnly",
  defaultNS: "translation",
  ns: ["translation"],
  initAsync: false,
  returnNull: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
  saveMissing: true,
  missingKeyHandler: (languages, _namespace, key) => {
    for (const language of languages) missing.add(`${language}:${key}`);
    if (import.meta.env?.DEV === true) {
      console.warn(`[i18n] 缺少文案：${key}（${languages.join(", ")}）`); // i18n-ignore：开发者日志
    }
  },
  react: { useSuspense: false, bindI18n: "languageChanged" },
});

export const i18n = i18next;

/** 当前界面语言。 */
export function currentLocale(): Locale {
  const value = i18next.resolvedLanguage ?? i18next.language;
  if (value === PSEUDO_LOCALE) return "en-US"; // 伪语言按英文格式化日期与数字
  return isLocale(value) ? value : SOURCE_LOCALE;
}

/** 当前语言是否是中文（中文路径保留原有格式化输出，见 `lib/format.ts`）。 */
export function isChineseLocale(locale: Locale = currentLocale()): boolean {
  return locale === "zh-CN";
}

/**
 * 非组件代码取文案。
 *
 * ⚠️ 只在函数执行时调用。组件里请用 `useI18n()`，它会在切换语言时让组件重新渲染。
 */
export const t: typeof i18next.t = i18next.t.bind(i18next) as typeof i18next.t;

/**
 * 组件里取文案与当前语言。
 *
 * ⚠️ **刻意不调用任何 React hook。** 本项目的不少测试把展示组件当普通函数直接调用来检查返回的元素树，
 * 组件里一旦有 hook 就会在测试里报错。语言切换时的重新渲染由根组件统一负责：`App` 用
 * `useLanguageRerender()` 订阅 i18next，切换后整棵树重新渲染（项目里没有 `React.memo`），
 * 所以这里直接读当前语言即可。
 *
 * ⚠️ 若在 `useMemo` 里拼接文案，请把 `locale` 放进依赖数组，否则切换后会显示旧语言。
 */
export function useI18n(): { readonly t: typeof i18next.t; readonly locale: Locale } {
  return { t, locale: currentLocale() };
}

/** 只在根组件调用一次：订阅语言切换，让整棵树随语言重新渲染。 */
export function useLanguageRerender(): Locale {
  const { i18n: instance } = useTranslation();
  const value = instance.resolvedLanguage ?? instance.language;
  if (value === PSEUDO_LOCALE) return "en-US";
  return isLocale(value) ? value : SOURCE_LOCALE;
}

/** 直接切换显示语言（不保存偏好）。正常界面请用 `lib/languageRuntime.ts` 的控制器。 */
export function applyLocale(locale: Locale): void {
  const target = locale === "en-US" && pseudoEnabled() ? PSEUDO_LOCALE : locale;
  if (target === PSEUDO_LOCALE && !i18next.hasResourceBundle(PSEUDO_LOCALE, "translation")) {
    i18next.addResourceBundle(PSEUDO_LOCALE, "translation", pseudoLocalizeTree(enUS));
  }
  if (i18next.language !== target) void i18next.changeLanguage(target);
}
