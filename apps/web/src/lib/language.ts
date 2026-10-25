/**
 * **界面语言偏好（S16 国际化）。**
 *
 * 结构刻意与 `theme.ts` 保持一致：纯函数负责解析 / 持久化 / 解析出实际语言，控制器负责通知订阅者，
 * 浏览器运行时只在 `startLanguageRuntime()` 里接一次。
 *
 * ⚠️ **存在哪里：本机（`localStorage` 的 `libevra.language`），与主题偏好相同。** 本轮不改数据库结构，
 * 所以语言偏好不跨设备同步；登录前、游客模式、离线时都能读到它，切换后刷新 / 重新打开 PWA 仍然有效。
 * 以后若要做账号级同步（路线图 S16-G-07 / S16-E-03），这里的 `LanguagePreference` 就是要同步的值。
 *
 * ⚠️ **默认值的规则**（只在本机第一次运行带语言功能的版本时决定一次，然后记下来）：
 *   - 这台设备以前用过 Libevra（本域名下已有任何本地记录）→ 记为「简体中文」。老用户更新后界面不会
 *     因为浏览器是英文而突然变成英文；他们想换随时可以换。
 *   - 全新设备 → 记为「跟随系统」，按浏览器语言列表选中文或英文。
 * 只根据浏览器 / 系统语言判断，**不看 IP**。
 *
 * ⚠️ **切换不刷新页面**：只调用 i18next 的 `changeLanguage`，React 重新渲染文字；表单里正在输入的内容、
 * 登录状态、离线队列都不受影响。
 */
import {
  SOURCE_LOCALE,
  SUPPORTED_LOCALES,
  browserLanguages,
  detectLocale,
  isLocale,
  type Locale,
} from "../i18n/locales.js";

export const LANGUAGE_PREFERENCES = ["system", ...SUPPORTED_LOCALES] as const;
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];

/** 一个键，与 `libevra.theme` 同一命名方式。 */
export const LANGUAGE_STORAGE_KEY = "libevra.language";

export interface LanguageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || isLocale(value);
}

/** 存储里的值 → 偏好；没有或无法识别时返回 `null`（交给首次运行规则决定）。 */
export function parseLanguagePreference(raw: string | null): LanguagePreference | null {
  if (raw === null) return null;
  const value = raw.trim();
  return isLanguagePreference(value) ? value : null;
}

/** 偏好 → 实际显示的语言。 */
export function resolveLocale(preference: LanguagePreference, languages: readonly string[]): Locale {
  return preference === "system" ? detectLocale(languages) : preference;
}

/** 本域名下是否已经有 Libevra 以前写下的本地记录（语言键本身不算）。 */
export function hasPriorAppState(storage: LanguageStorage): boolean {
  try {
    const count = storage.length ?? 0;
    for (let index = 0; index < count; index += 1) {
      const key = storage.key?.(index);
      if (key !== null && key !== undefined && key !== LANGUAGE_STORAGE_KEY) return true;
    }
  } catch {
    // 读不到就当作新设备：最坏结果是按浏览器语言显示，用户可以立刻改回来。
  }
  return false;
}

export function persistLanguagePreference(storage: LanguageStorage, preference: LanguagePreference): void {
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // 隐私模式 / 配额满：本次会话仍按选择显示，只是下次打开不会记住。
  }
}

/**
 * 读出偏好；本机第一次运行时按上面的规则决定默认值**并记下来**，
 * 这样之后这台设备上出现其它本地记录，也不会让默认值从「跟随系统」变成「中文」。
 */
export function readLanguagePreference(storage: LanguageStorage | null): LanguagePreference {
  if (storage === null) return "system";
  let stored: LanguagePreference | null = null;
  try {
    stored = parseLanguagePreference(storage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return "system";
  }
  if (stored !== null) return stored;

  const initial: LanguagePreference = hasPriorAppState(storage) ? SOURCE_LOCALE : "system";
  persistLanguagePreference(storage, initial);
  return initial;
}

export interface LanguageSnapshot {
  readonly preference: LanguagePreference;
  readonly locale: Locale;
}

/** 文档上需要被更新的那一小部分，便于在没有 DOM 的测试里验证。 */
export interface LanguageRoot {
  lang: string;
}

export interface LanguageControllerOptions {
  readonly storage: LanguageStorage | null;
  readonly languages: () => readonly string[];
  /** 实际语言变化时调用（切换 i18next、更新 `<html lang>`）。 */
  readonly apply: (locale: Locale) => void;
}

export function createLanguageController(options: LanguageControllerOptions) {
  const { storage, languages, apply } = options;
  const listeners = new Set<() => void>();
  const build = (preference: LanguagePreference): LanguageSnapshot => ({
    preference,
    locale: resolveLocale(preference, languages()),
  });

  let snapshot = build(readLanguagePreference(storage));
  apply(snapshot.locale);

  const replace = (preference: LanguagePreference): void => {
    const next = build(preference);
    const changed = next.locale !== snapshot.locale;
    const preferenceChanged = next.preference !== snapshot.preference;
    snapshot = next;
    if (changed) apply(next.locale);
    if (changed || preferenceChanged) for (const listener of listeners) listener();
  };

  return {
    getSnapshot: (): LanguageSnapshot => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** 用户在设置或登录页明确选择。 */
    choose: (preference: LanguagePreference): void => {
      if (storage !== null) persistLanguagePreference(storage, preference);
      replace(preference);
    },
    /** 另一个标签页改了偏好（`storage` 事件）。 */
    restore: (raw: string | null): void => {
      replace(parseLanguagePreference(raw) ?? "system");
    },
    /** 系统 / 浏览器语言变了；只有选了「跟随系统」才会影响显示。 */
    refreshSystem: (): void => {
      replace(snapshot.preference);
    },
  };
}

export type LanguageController = ReturnType<typeof createLanguageController>;
