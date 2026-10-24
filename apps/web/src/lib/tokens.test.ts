import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * S16-B0: the foundation is only useful if the semantic roles exist and the
 * default light theme does not get worse in the refactor.
 *
 * These assertions are about *roles and defaults*, not about a final dark
 * palette: the dark/palette value blocks are still Codex design work. When those
 * arrive, this test should keep checking the default light contract and gain
 * mode-aware cases.
 */

const CSS = readFileSync(join(import.meta.dirname, "..", "index.css"), "utf8");

describe("S16-B3 R3-A 深色正式映射", () => {
  it("完整覆盖已有 50 个角色并采用 R3-A 品牌色", () => {
    const block =
      [...CSS.matchAll(/html\[data-theme-mode="dark"\]\s*\{([^}]+)\}/g)]
        .map((match) => match[1]!)
        .find((value) => value.includes("--color-canvas:")) ?? "";
    const values = new Map(
      [...block.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)].map((match) => [
        match[1]!,
        match[2]!.trim(),
      ]),
    );
    expect(values.size).toBe(50);
    expect(values.get("brand")).toBe("#8eab96");
    expect(values.get("on-brand")).toBe("#142119");
    expect(values.get("focus-ring")).toBe("#a3c3ab");
    for (const [fg, bg] of [
      ["ink", "surface"],
      ["muted", "surface"],
      ["on-brand", "brand"],
      ["on-danger", "danger"],
      ["brand-dark", "brand-soft"],
    ]) {
      expect(contrast(values.get(fg!)!, values.get(bg!)!)).toBeGreaterThanOrEqual(4.5);
    }
    expect(token("canvas")).toBe("#fafcfb");
  });
});

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(CSS);
  if (match?.[1] === undefined) throw new Error(`missing --color-${name}`);
  return match[1].trim();
}

function luminance(hex: string): number {
  const raw = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16) / 255);
  const linear = (value: number): number =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!);
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("S16-B0 token foundation", () => {
  it("keeps the existing 19 token names and their light-theme values", () => {
    const legacy: Record<string, string> = {
      "category-ink": "#3f7059",
      canvas: "#fafcfb",
      surface: "#ffffff",
      ink: "#24312b",
      muted: "#60726a",
      line: "#e3ede7",
      brand: "#55997a",
      "brand-dark": "#447d63",
      "brand-soft": "#edf5f0",
      "accent-ink": "#5f7268",
      "chart-rule": "#8fa39a",
      danger: "#b8574f",
      "danger-dark": "#9c4740",
      "danger-soft": "#fbefee",
      warn: "#b07d2b",
      "warn-dark": "#8f6420",
      "warn-soft": "#fdf6e7",
      "overlay-soft": "rgb(36 49 43 / 0.25)",
      overlay: "rgb(36 49 43 / 0.35)",
    };

    for (const [name, value] of Object.entries(legacy)) {
      expect(token(name), name).toBe(value);
    }
  });

  it("defines the new role, data, chart, ocean and glass tokens", () => {
    const names = [
      "on-brand",
      "on-danger",
      "on-warn",
      "on-ink",
      "on-heat",
      "on-tag",
      "control-knob",
      "focus-ring",
      "line-strong",
      "data-expense",
      "data-income",
      "data-transfer",
      ...Array.from({ length: 8 }, (_, index) => `chart-${String(index + 1)}`),
      ...Array.from({ length: 5 }, (_, index) => `chart-heat-${String(index)}`),
      ...Array.from({ length: 4 }, (_, index) => `ocean-${String(index + 1)}`),
      "on-ocean",
      "glass-highlight",
    ];

    for (const name of names) {
      expect(token(name), name).not.toBe("");
    }
  });

  it("keeps the default light-theme contrast at least as good as today", () => {
    expect(contrast(token("ink"), token("canvas"))).toBeGreaterThanOrEqual(7);
    expect(contrast(token("muted"), token("canvas"))).toBeGreaterThanOrEqual(4.5);
    // The green brand fill is a known 3.37:1 limitation for large/button text;
    // the refactor must not make it worse. A future palette supplies its own
    // on-brand value if it wants to clear AA.
    expect(contrast(token("on-brand"), token("brand"))).toBeGreaterThanOrEqual(3.3);
    expect(contrast(token("on-ink"), token("ink"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("on-danger"), token("danger"))).toBeGreaterThanOrEqual(4.5);
    // on-warn is currently unused, but must already be a usable foreground when
    // the first warning-filled control arrives; white on warn is only 3.61:1.
    expect(contrast(token("on-warn"), token("warn"))).toBeGreaterThanOrEqual(4.5);
    // A future focus ring token: the current value is the legacy pale halo
    // (1.08:1), kept once as an explicit default while Codex designs the
    // accessible dark/palette value. The test pins the known gap so a silent
    // visual change cannot masquerade as a token refactor.
    expect(token("focus-ring")).toBe("#edf5f0");
    expect(contrast(token("focus-ring"), token("canvas"))).toBeLessThan(3);
    // line-strong is a foundation token not yet applied to inputs; its value
    // must already support the 3:1 non-text boundary it will be used for.
    expect(contrast(token("line-strong"), token("surface"))).toBeGreaterThanOrEqual(3);
  });

  it("records the heat-foreground contrast debt for the dark/palette design", () => {
    // Calendar heat uses text-on-heat for levels 3–4. White is legible on the
    // darkest step but fails AA on level 3; changing it to dark text would alter
    // the default calendar. Keep the debt visible rather than pretending the
    // foundation solved it.
    expect(contrast(token("on-heat"), token("chart-heat-3"))).toBeLessThan(3);
    expect(contrast(token("on-heat"), token("chart-heat-4"))).toBeGreaterThan(3);
  });

  it("keeps financial data colours distinguishable from the page", () => {
    for (const name of ["data-expense", "data-income", "data-transfer"]) {
      expect(contrast(token(name), token("canvas")), name).toBeGreaterThanOrEqual(4);
    }
  });
});
