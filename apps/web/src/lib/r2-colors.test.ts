import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { tagForeground } from "./tagColors.js";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
function block(marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  return Object.fromEntries(
    [...css.slice(start, css.indexOf("}", start)).matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );
}
function contrast(a: string, b: string): number {
  const luminance = (c: string): number => {
    const x = c
      .slice(1)
      .match(/../g)!
      .map((v) => Number.parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return x[0]! * 0.2126 + x[1]! * 0.7152 + x[2]! * 0.0722;
  };
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
describe("S16-B 深色中性卡片与 R3-A 品牌组", () => {
  const light = block("@theme {");
  const fallback = block('html[data-theme-mode="dark"] {');
  const r3 = block('html[data-theme-mode="dark"][data-theme-palette="green"] {');
  it("50 个角色齐全，绿色正式映射采用 R3-A，回退也使用同一套值", () => {
    expect(Object.keys(r3).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(r3)).toHaveLength(50);
    expect(r3.brand).toBe("#8eab96");
    expect(r3["brand-dark"]).toBe("#b9d2bf");
    expect(r3["brand-soft"]).toBe("#26312b");
    expect(r3["on-brand"]).toBe("#142119");
    expect(r3["focus-ring"]).toBe("#a3c3ab");
    expect(r3["ocean-1"]).toBe("#22332b");
    expect(r3["on-ocean"]).toBe("#e5efe8");
    expect(r3.canvas).toBe("#17181a");
    expect(r3.surface).toBe("#2c2c2c");
    expect(r3.muted).toBe("#afb3b8");
    expect(r3["line-strong"]).toBe("#7e858d");
    expect(fallback.brand).toBe("#8eab96");
    expect(fallback.canvas).toBe("#17181a");
    expect(fallback.surface).toBe("#2c2c2c");
    expect(fallback.line).toBe("#3b3e42");
    expect(fallback["line-strong"]).toBe("#7e858d");
    expect(fallback.muted).toBe("#afb3b8");
    expect(fallback["on-ink"]).toBe("#17181a");
    // Neutral fields keep a single neutral temperature; the control boundary
    // stays slightly cooler so inputs remain distinguishable.
    for (const key of ["canvas", "surface", "ink", "muted", "line"]) {
      const channels = r3[key]!.slice(1).match(/../g)!.map((x) => Number.parseInt(x, 16));
      expect(Math.max(...channels) - Math.min(...channels), key).toBeLessThanOrEqual(15);
    }
    expect(r3["line-strong"]).toBe("#7e858d");
  });
  it("正文、次级文字和各状态前景满足 AA", () => {
    for (const bg of ["canvas", "surface", "brand-soft"]) {
      for (const fg of ["ink", "muted"]) {
        expect(contrast(r3[fg]!, r3[bg]!), `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const [fg, bg] of [
      ["on-brand", "brand"],
      ["on-danger", "danger"],
      ["on-warn", "warn"],
      ["on-ink", "ink"],
      ["danger", "danger-soft"],
      ["warn", "warn-soft"],
      ["on-ocean", "ocean-1"],
    ]) {
      expect(contrast(r3[fg!]!, r3[bg!]!), `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const fg of [
      "brand-dark",
      "data-expense",
      "data-income",
      "data-transfer",
      ...Array.from({ length: 8 }, (_, i) => `chart-${String(i + 1)}`),
    ]) {
      expect(contrast(r3[fg]!, r3.surface!), fg).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("输入边界、焦点和每档热力数字满足目标", () => {
    for (const fg of ["line-strong", "focus-ring"]) {
      expect(contrast(r3[fg]!, r3.surface!), fg).toBeGreaterThanOrEqual(3);
    }
    for (let level = 0; level < 5; level++) {
      expect(
        contrast(r3[level < 3 ? "ink" : "on-heat"]!, r3[`chart-heat-${String(level)}`]!),
        `heat-${String(level)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("任意用户原色选择最大对比黑白前景，临界色也不低于 AA", () => {
    for (let value = 0; value <= 0xffffff; value += 7919) {
      const color = `#${value.toString(16).padStart(6, "0")}`;
      expect(contrast(tagForeground(color), color)).toBeGreaterThanOrEqual(4.5);
    }
    expect(tagForeground("#c4c87d")).toBe("#000000");
    expect(tagForeground("#704b80")).toBe("#ffffff");
  });
  it("A 的页头以 canvas 为底，正文与次级文字保持 AA", () => {
    for (const fg of ["ink", "muted"]) {
      expect(contrast(r3[fg]!, r3.canvas!), fg).toBeGreaterThanOrEqual(4.5);
    }
  });
});
