import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 颜色类守卫（BUG-005，1.19.71）：源码里的颜色类，颜色名必须是 `index.css` `@theme` 里定义的令牌。
 * 实现在 `tools/check-color-classes.mjs`，`pnpm check:build` 也会调用同一个函数。
 */
const mod = (await import(pathToFileURL(resolve(import.meta.dirname, "../../../../tools/check-color-classes.mjs")).href)) as {
  collectThemeTokens: (css: string) => unknown;
  findUnknownColorClasses: (text: string, tokens: unknown) => { line: number; cls: string }[];
  scanColorClasses: () => { tokenCount: number; problems: { file: string; line: number; cls: string }[] };
};

const tokens = mod.collectThemeTokens(`
  @theme {
    --color-warn: #b07d2b; --color-warn-dark: #8f6420; --color-warn-soft: #fdf6e7; --color-ink: #24312b; --color-chart-1: #111;
    --text-helper: 0.75rem; --text-helper--line-height: 1rem; --shadow-card: 0 0 1px #000;
  }
`);
const bad = (src: string) => mod.findUnknownColorClasses(src, tokens).map((h) => h.cls);

describe("颜色类守卫", () => {
  it("能找出不存在的颜色名，含透明度与变体前缀", () => {
    expect(bad(`<p className="text-warning-dark bg-warning/10 hover:text-ink-3 md:border-t-nope" />`)).toEqual([
      "text-warning-dark",
      "bg-warning",
      "text-ink-3",
      "border-t-nope",
    ]);
  });

  it("令牌、特殊值与 Tailwind 非颜色用法不误报", () => {
    expect(
      bad(
        `"text-warn-dark bg-warn/10 bg-warn-soft text-ink border-chart-1 text-sm text-left text-helper shadow-card shadow-lg border-2 border-b-0 border-t-4 ring-offset-2 ring-inset ` +
          `bg-transparent text-current border-white outline-none outline-offset-2 divide-y text-[11px] bg-[url(#sample)] placeholder:text-ink placeholder-shown:bg-ink"`,
      ),
    ).toEqual([]);
  });

  it("注释里提到的类名不算", () => {
    expect(bad(`// 以前写过 text-warning-dark\n/* bg-warning/10 */\nconst a = "text-ink";`)).toEqual([]);
  });

  it("全仓库源码没有使用不存在的颜色名", () => {
    const { tokenCount, problems } = mod.scanColorClasses();
    expect(tokenCount).toBeGreaterThan(20);
    expect(problems.map((p) => `${p.file}:${p.line} ${p.cls}`)).toEqual([]);
  });
});
