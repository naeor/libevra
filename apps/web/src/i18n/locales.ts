/**
 * **界面语言的唯一清单（S16 国际化）。**
 *
 * ⚠️ **界面语言 ≠ 识别语言 ≠ 货币 ≠ 时区。** 这里只决定按钮、标题、提示用哪种语言显示；
 * 账目金额的币种、记账时区、OCR / 语音 / 粘贴的识别规则都各自独立，切换语言不会改变它们。
 *
 * ⚠️ **新增语言的步骤**：在 `SUPPORTED_LOCALES` 加一项 → 在 `resources/` 下加同名目录并补齐
 * 与 `zh-CN` 完全一致的键（类型检查与 `i18n.test.ts` 会拦住缺键）→ 在 `LOCALE_NATIVE_NAMES`
 * 写上该语言的**自称**。日期 / 数字 / 复数都走 `Intl`，不需要额外代码。
 */

export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * 文案的源语言，也是缺键时的回退语言。
 *
 * 中文是产品的原始语言：英文缺某条文案时显示中文原文，比显示一串键名更能让人看懂，
 * 也更容易在验收中被发现。测试保证正式发布时英文不缺键。
 */
export const SOURCE_LOCALE: Locale = "zh-CN";

/**
 * 浏览器语言既不是中文也不是英文时用哪种。
 *
 * 选中文的理由：现有用户、法律文本与运营都以中文为准；多数非中文浏览器的语言列表里本来就带着
 * `en`，会先被匹配成英文，真正落到这里的情况很少。要改成英文只需改这一行。
 */
export const UNMATCHED_BROWSER_LOCALE: Locale = "zh-CN";

/**
 * 每种语言用**它自己的写法**显示，切到看不懂的语言后也能找回来。
 * 这几个名字刻意不翻译。
 */
export const LOCALE_NATIVE_NAMES: Readonly<Record<Locale, string>> = {
  "zh-CN": "简体中文",
  "en-US": "English",
};

/** 登录页切换按钮上用的短名。 */
export const LOCALE_SHORT_NAMES: Readonly<Record<Locale, string>> = {
  "zh-CN": "中文",
  "en-US": "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * 把一个 BCP 47 语言标签对应到支持的界面语言；对应不上返回 `null`。
 *
 * 只看主语言：`zh-TW` / `zh-HK` / `zh-Hans-SG` 都归到简体中文（目前唯一的中文版本），
 * `en-GB` / `en-AU` 都归到 English。以后加入繁体中文时，在这里先匹配完整标签即可。
 */
export function matchLocale(tag: string): Locale | null {
  const normalized = tag.trim().toLowerCase();
  if (normalized === "") return null;
  for (const locale of SUPPORTED_LOCALES) {
    if (locale.toLowerCase() === normalized) return locale;
  }
  const primary = normalized.split(/[-_]/)[0];
  if (primary === "zh") return "zh-CN";
  if (primary === "en") return "en-US";
  return null;
}

/**
 * 按浏览器给出的语言顺序找第一种能支持的语言。
 *
 * ⚠️ **只看浏览器 / 系统语言，不看 IP，也不看账号所在地区。** 在国外用中文系统的人应该看到中文，
 * 在国内用英文系统的人应该看到英文；地理位置不是语言偏好。
 */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const matched = matchLocale(tag);
    if (matched !== null) return matched;
  }
  return UNMATCHED_BROWSER_LOCALE;
}

/** 浏览器语言列表；没有 `navigator`（测试、服务端渲染）时返回空列表。 */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined" || typeof window === "undefined") return [];
  const list = Array.isArray(navigator.languages) ? navigator.languages : [];
  if (list.length > 0) return list;
  return typeof navigator.language === "string" ? [navigator.language] : [];
}
