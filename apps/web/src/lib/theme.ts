/**
 * The two-dimensional theme preference (S16-B0).
 *
 * This module is deliberately only the *foundation*: it defines the dimensions,
 * resolves "follow the system" and applies the attributes the CSS value blocks
 * will target. It does not contain a dark palette or seven brand palettes —
 * those are Codex design work. Nothing calls `applyThemePreference()` yet; the
 * settings UI that will is part of the next S16-B slice.
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
