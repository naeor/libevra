import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  applyThemePreference,
  parseThemePreference,
  persistThemePreference,
  readThemePreference,
  resolveThemeMode,
  watchSystemTheme,
  type ThemeStorage,
} from "./theme.js";

function storageWith(raw: string | null): ThemeStorage & { value: string | null } {
  return {
    value: raw,
    getItem: () => raw,
    setItem: (_key, value) => {
      raw = value;
    },
  };
}

describe("parseThemePreference", () => {
  it("uses the green light default when nothing is stored", () => {
    expect(parseThemePreference(null)).toEqual(DEFAULT_THEME_PREFERENCE);
  });

  it("accepts a complete preference", () => {
    expect(parseThemePreference(JSON.stringify({ mode: "system", palette: "blue" }))).toEqual({
      mode: "system",
      palette: "blue",
    });
  });

  it("falls back per dimension instead of discarding the whole preference", () => {
    expect(parseThemePreference(JSON.stringify({ mode: "dark", palette: "pink" }))).toEqual({
      mode: "dark",
      palette: "green",
    });
    expect(parseThemePreference(JSON.stringify({ mode: "sepia", palette: "purple" }))).toEqual({
      mode: "light",
      palette: "purple",
    });
  });

  it("survives corrupt JSON and non-object values", () => {
    expect(parseThemePreference("{not json")).toEqual(DEFAULT_THEME_PREFERENCE);
    expect(parseThemePreference("42")).toEqual(DEFAULT_THEME_PREFERENCE);
    expect(parseThemePreference("null")).toEqual(DEFAULT_THEME_PREFERENCE);
  });
});

describe("theme storage", () => {
  it("reads and writes one atomic preference", () => {
    const storage = storageWith(null);
    persistThemePreference(storage, { mode: "system", palette: "red" });

    expect(storage.getItem(THEME_STORAGE_KEY)).toBe(
      JSON.stringify({ mode: "system", palette: "red" }),
    );
    expect(readThemePreference(storage)).toEqual({ mode: "system", palette: "red" });
  });

  it("does not throw when storage is unavailable", () => {
    const broken: ThemeStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readThemePreference(broken)).toEqual(DEFAULT_THEME_PREFERENCE);
    expect(() => persistThemePreference(broken, DEFAULT_THEME_PREFERENCE)).not.toThrow();
  });
});

describe("resolveThemeMode", () => {
  it("resolves system in both directions", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
  });

  it("keeps an explicit choice even when the system disagrees", () => {
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("dark");
  });
});

describe("applyThemePreference", () => {
  it("writes both the literal choice and the resolved mode", () => {
    const root = { dataset: {} as Record<string, string> };
    applyThemePreference(root, { mode: "system", palette: "blue" }, true);

    expect(root.dataset["themePreference"]).toBe("system");
    expect(root.dataset["themeMode"]).toBe("dark");
    expect(root.dataset["themePalette"]).toBe("blue");
  });
});

describe("watchSystemTheme", () => {
  it("reports changes and unsubscribes with the same listener", () => {
    let listener: ((event: { matches: boolean }) => void) | null = null;
    const remove = vi.fn();
    const media = {
      matches: false,
      addEventListener: (_type: "change", next: (event: { matches: boolean }) => void) => {
        listener = next;
      },
      removeEventListener: vi.fn((_type: "change", next: (event: { matches: boolean }) => void) => {
        if (listener === next) listener = null;
        remove();
      }),
    };
    const onChange = vi.fn();
    const unsubscribe = watchSystemTheme(
      media as unknown as Parameters<typeof watchSystemTheme>[0],
      onChange,
    );

    (listener as ((event: { matches: boolean }) => void) | null)?.({ matches: true });
    expect(onChange).toHaveBeenCalledWith(true);

    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
