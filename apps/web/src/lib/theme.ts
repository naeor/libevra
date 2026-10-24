/**
 * The two-dimensional theme preference (S16-B0).
 *
 * B0 的偏好解析、持久化与文档属性由首屏脚本及设置入口共同复用。
 * 本地候选只开放已有映射的绿色；绿色浅色沿用原始品牌，绿色深色采用
 * 所有者选定的 R3-A 柔和鼠尾草绿。其他色盘仍未开放。
 *
 * Why attributes and not a React context? A theme is a document-level fact, and
 * every component already reads semantic tokens from CSS. A context would put a
 * theme value in the render tree of every component for no benefit, and a
 * `useTheme()` branch is exactly the `theme === "purple"` pattern the component
 * layer must not have.
 */

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_PALETTES = [
  "green",
  "red",
  "orange",
  "yellow",
  "cyan",
  "blue",
  "purple",
] as const;
export type ThemePalette = (typeof THEME_PALETTES)[number];

/** 只开放已有实际浅/深色映射的色盘；其余色盘仍保留 B0 的契约。 */
export const AVAILABLE_THEME_PALETTES: readonly ThemePalette[] = ["green"];

export function availableThemePreference(preference: ThemePreference): ThemePreference {
  return AVAILABLE_THEME_PALETTES.includes(preference.palette)
    ? preference
    : { ...preference, palette: "green" };
}

export interface ThemePreference {
  readonly mode: ThemeMode;
  readonly palette: ThemePalette;
}

/** The current product's default. Green light is the pre-S16-B appearance. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  mode: "light",
  palette: "green",
};

/** One key so mode and palette cannot be half-saved by a crash. */
export const THEME_STORAGE_KEY = "libevra.theme";

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

function isThemePalette(value: unknown): value is ThemePalette {
  return typeof value === "string" && (THEME_PALETTES as readonly string[]).includes(value);
}

/**
 * Turn an unknown stored value into a preference.
 *
 * A corrupt JSON string, an old value or an unknown palette must not blank the
 * app: each invalid half falls back on its own, so a future palette can be
 * removed without invalidating the user's light/dark choice.
 */
export function parseThemePreference(raw: string | null): ThemePreference {
  if (raw === null) return DEFAULT_THEME_PREFERENCE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_THEME_PREFERENCE;

  const record = parsed as Record<string, unknown>;
  return {
    mode: isThemeMode(record["mode"]) ? record["mode"] : DEFAULT_THEME_PREFERENCE.mode,
    palette: isThemePalette(record["palette"])
      ? record["palette"]
      : DEFAULT_THEME_PREFERENCE.palette,
  };
}

export function readThemePreference(storage: ThemeStorage | null = null): ThemePreference {
  if (storage === null) return DEFAULT_THEME_PREFERENCE;
  try {
    return parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can throw in private mode or when the quota is exhausted. A theme
    // is not worth failing a page for; the product default is always valid.
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function persistThemePreference(storage: ThemeStorage, preference: ThemePreference): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Same reasoning as reading: a failed preference write must not break the
    // settings screen. The in-memory preference still applies for this session.
  }
}

/** `system` is not a CSS mode; it resolves to the OS preference. */
export function resolveThemeMode(mode: ThemeMode, systemDark: boolean): "light" | "dark" {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

/** The minimal document surface the applier needs, which keeps it testable without a DOM. */
export interface ThemeRoot {
  readonly style?: { colorScheme: string };
  readonly dataset: {
    themeMode?: string;
    themePalette?: string;
    themePreference?: string;
  };
}

/**
 * Apply the resolved mode and palette to the document root.
 *
 * `data-theme-preference` keeps the user's literal choice (`system`) available
 * for the settings UI; `data-theme-mode` is always the *resolved* light/dark that
 * CSS value blocks target. Keeping both means a system-theme listener can
 * re-resolve without losing the user's choice.
 */
export function applyThemePreference(
  root: ThemeRoot,
  preference: ThemePreference,
  systemDark: boolean,
): void {
  root.dataset.themePreference = preference.mode;
  root.dataset.themeMode = resolveThemeMode(preference.mode, systemDark);
  root.dataset.themePalette = preference.palette;
  if (root.style) root.style.colorScheme = resolveThemeMode(preference.mode, systemDark);
}

/**
 * Watch the OS colour scheme and report changes.
 *
 * Returns an unsubscribe function. Callers only attach this while the preference
 * is `system`; when it is explicit light/dark, listening would be wasted work.
 */
export function watchSystemTheme(
  media: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">,
  onChange: (systemDark: boolean) => void,
): () => void {
  const listener = (event: MediaQueryListEvent): void => onChange(event.matches);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

type SystemThemeMedia = Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;

/** 首屏脚本与运行时共用，避免两份 JSON 解析/回退规则。 */
export function restoreThemeBeforePaint(root: ThemeRoot, storage: ThemeStorage | null, systemDark: boolean): ThemePreference {
  const preference = availableThemePreference(readThemePreference(storage));
  applyThemePreference(root, preference, systemDark);
  return preference;
}

/** 偏好只在这里管理；React 订阅选择值，颜色仍由文档属性与 CSS 决定。 */
export function createThemeController(root: ThemeRoot, storage: ThemeStorage | null, media: SystemThemeMedia) {
  let preference = restoreThemeBeforePaint(root, storage, media.matches);
  const listeners = new Set<() => void>();
  let unwatch = (): void => undefined;
  const apply = (): void => applyThemePreference(root, preference, media.matches);
  const notify = (): void => { for (const listener of listeners) listener(); };
  const watch = (): void => {
    unwatch();
    unwatch = preference.mode === "system" ? watchSystemTheme(media, () => { apply(); }) : () => undefined;
  };
  const replace = (next: ThemePreference): void => {
    preference = availableThemePreference(next);
    apply(); watch(); notify();
  };
  watch();
  return {
    getSnapshot: (): ThemePreference => preference,
    subscribe: (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    choose: (next: Partial<ThemePreference>): void => {
      const chosen = availableThemePreference({ ...preference, ...next });
      if (storage) persistThemePreference(storage, chosen);
      replace(chosen);
    },
    restore: (raw: string | null): void => { replace(parseThemePreference(raw)); },
    dispose: (): void => { unwatch(); listeners.clear(); },
  };
}

let browserController: ReturnType<typeof createThemeController> | null = null;

export function startThemeRuntime(): ReturnType<typeof createThemeController> {
  if (browserController !== null) return browserController;
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* 隐私模式下只保持本次会话。 */ }
  browserController = createThemeController(document.documentElement, storage, window.matchMedia("(prefers-color-scheme: dark)"));
  const controller = browserController;
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) controller.restore(event.newValue);
  });
  return controller;
}
