import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { S19_PHONE_SELECTOR, S19_SCOPE_SELECTOR, markS19Stage, s19ScopeForShell } from "./scope.js";

/**
 * **S19 作用域标记（总闸）的守卫。**
 *
 * 1.19.57 之前，“只在手机外壳生效”这个条件 `.lv-shell[data-shell="contents"]` 被复制进 247 条选择器、
 * 5 处脚本判断和 4 个转场舞台，没有统一开关；让 Pad 复用手机材质就得改几百处（S19 材质与转场审查 H7）。
 * 现在材质与转场只认 `data-s19-scope`（s19/scope.ts）：
 *
 * - 通用层 `.lv-shell[data-s19-scope]`：只认标记存在，将来 Pad 设上自己的值就自动继承；
 * - 手机专属层 `.lv-shell[data-s19-scope="phone"]`：只收依赖手机底栏结构的规则（下表）。
 *
 * `data-shell` 继续只管外壳布局（workspace.css 的 `display: contents`）。这里守住三件事：
 * 不再用 `data-shell="contents"` 当 S19 作用域；标记只有两种写法；两层不混放。
 * 实验页（Material / Adaptation / Avatar Lab、Component Gallery）自己模拟手机外壳，不在扫描范围。
 * 注释先剥掉再查：说明文字里提到旧写法不算违规。
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const LAB_DIRS = ["s19/optics-lab/", "s19/component-gallery/", "s19/adaptation-lab/", "s19/avatar-lab/"];

/** 依赖手机底栏结构的选择器片段：命中的规则必须写在手机专属层，手机专属层也只收这些。 */
const PHONE_STRUCTURE: readonly (readonly [RegExp, string])[] = [
  [/nav\.shrink-0\.border-t/, "手机常驻底栏本体与材质"],
  [/nav \.bottom-tab-active/, "底栏 Tab 的选中圆片"],
  [/nav button\.size-16/, "底栏中间的“+”"],
  [/\.s19-tab-glass/, "B1 / B2 底栏的选中玻璃胶囊"],
  [/\[data-a-glide\]/, "A 的底栏 DepthGlide 胶囊"],
  [/\.lv-entry-menu|nav ul > li/, "底栏里的记一笔菜单与五张卡"],
  [/\[data-entry-menu-open/, "记一笔菜单在底栏上方的占位"],
  [/\[data-b2-scroll-underlay\]/, "B2 正文延伸到底栏后方的尾部空间"],
  [/\.persistent-nav|\[data-persistent-nav\]/, "常驻底栏与挂在底栏上的账本胶囊"],
  [/\[data-replaces-nav\]/, "底栏让位（NAV_YIELD）后升起的替换栏"],
  [/:root\[data-soft-keyboard/, "软键盘打开时底栏与底部操作区原位隐藏（Pad 大屏仍按 useKeyboardInset 抬升）"],
];
/** 整个文件属于手机专属层。 */
const PHONE_FILES: Readonly<Record<string, string>> = {
  "components/current-book-caption.css": "账本胶囊的几何按手机底栏的 12px 留白对齐（1.19.50）",
};
/** 仍然读 `data-shell="contents"` 的布局规则：手机外壳的盒子全部是 display: contents，隐藏工作区固定定位。 */
const LAYOUT_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  "workspace/workspace.css": [
    '.lv-shell[data-shell="contents"]',
    '.lv-shell[data-shell="contents"] > .lv-area',
    '.lv-shell[data-shell="contents"] .lv-pane[data-mode="hidden"]',
  ],
};

const posix = (path: string): string => relative(SRC, path).split(sep).join("/");
function productionFiles(directory: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === "generated" || LAB_DIRS.some(dir => `${posix(path)}/`.startsWith(dir))) continue;
      found.push(...productionFiles(path, pattern));
    } else if (pattern.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}
const stripCss = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "");
const stripTs = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 每条规则的复合选择器（按顶层逗号拆开，不含 @media 等条件本身）。 */
function selectors(css: string): string[] {
  const clean = stripCss(css), out: string[] = [];
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === "{") {
      const prelude = clean.slice(start, i).trim();
      if (prelude && !prelude.startsWith("@")) {
        let depth = 0, from = 0;
        for (let j = 0; j <= prelude.length; j++) {
          const d = prelude[j];
          if (d === "(" || d === "[") depth++; else if (d === ")" || d === "]") depth--;
          if (j === prelude.length || (d === "," && depth === 0)) { out.push(prelude.slice(from, j).replace(/\s+/g, " ").trim()); from = j + 1; }
        }
      }
      start = i + 1;
    } else if (c === "}" || c === ";") start = i + 1;
  }
  return out.filter(Boolean);
}

const cssFiles = productionFiles(SRC, /\.css$/).map(path => ({ file: posix(path), rules: selectors(readFileSync(path, "utf8")) }));
const scoped = cssFiles.flatMap(({ file, rules }) => rules.filter(rule => rule.includes("[data-s19-scope")).map(rule => ({ file, rule })));
const phoneStructure = (file: string, rule: string): boolean => file in PHONE_FILES || PHONE_STRUCTURE.some(([pattern]) => pattern.test(rule));

describe("S19 作用域标记（总闸）", () => {
  it("外壳与舞台：手机外壳写 phone，Pad 宽屏写 pad；舞台带同一组属性", () => {
    expect(s19ScopeForShell("contents")).toBe("phone");
    expect(s19ScopeForShell("wide")).toBe("pad");
    const stage = { dataset: {} as Record<string, string> };
    markS19Stage(stage as unknown as HTMLElement);
    expect(stage.dataset).toEqual({ shell: "contents", s19Scope: "phone" });
    // 脚本与 CSS 读同一个标记、同一种写法。
    expect(S19_SCOPE_SELECTOR).toBe(".lv-shell[data-s19-scope]");
    expect(S19_PHONE_SELECTOR).toBe('.lv-shell[data-s19-scope="phone"]');
    const shell = readFileSync(join(SRC, "workspace/WorkspaceShell.tsx"), "utf8");
    expect(shell).toContain('data-shell={chrome ? "wide" : "contents"}');
    expect(shell).toContain('data-s19-scope={s19ScopeForShell(chrome ? "wide" : "contents")}');
  });

  it("正式 CSS 不再用 data-shell=\"contents\" 作 S19 作用域（只剩 workspace.css 的外壳布局）", () => {
    const offenders = cssFiles.flatMap(({ file, rules }) =>
      rules.filter(rule => rule.includes('[data-shell="contents"]') && !(LAYOUT_ALLOWED[file] ?? []).includes(rule)).map(rule => `${file}: ${rule}`));
    expect(offenders).toEqual([]);
    expect(scoped.length).toBeGreaterThan(200);
  });

  it("通用、手机和 Pad 三种作用域都挂在 .lv-shell 上", () => {
    const offenders = scoped.flatMap(({ file, rule }) => {
      const all = rule.match(/\[data-s19-scope[^\]]*\]/g) ?? [];
      const ok = rule.match(/\.lv-shell(?:\.[\w-]+)*\[data-s19-scope(?:="(?:phone|pad)")?\]/g) ?? [];
      return all.length === ok.length ? [] : [`${file}: ${rule}`];
    });
    expect(offenders).toEqual([]);
  });

  it("依赖手机底栏结构的规则只写在手机专属层", () => {
    const offenders = scoped.filter(({ file, rule }) => phoneStructure(file, rule) && !rule.includes('[data-s19-scope="phone"]'))
      .map(({ file, rule }) => `${file}: ${rule}`);
    expect(offenders).toEqual([]);
  });

  it("手机专属层只收手机底栏结构的规则，其余留在通用层（将来 Pad 自动继承）", () => {
    const offenders = scoped.filter(({ file, rule }) => rule.includes('[data-s19-scope="phone"]') && !phoneStructure(file, rule))
      .map(({ file, rule }) => `${file}: ${rule}`);
    expect(offenders).toEqual([]);
  });

  it("脚本判断与转场舞台读写同一个标记", () => {
    const sources = productionFiles(SRC, /\.(ts|tsx)$/).map(path => ({ file: posix(path), code: stripTs(readFileSync(path, "utf8")) }));
    expect(sources.filter(({ code }) => code.includes('[data-shell="contents"]')).map(({ file }) => file)).toEqual([]);
    expect(sources.filter(({ code }) => /dataset\.shell\s*=\s*"contents"/.test(code)).map(({ file }) => file)).toEqual(["s19/scope.ts"]);
    const stages = sources.filter(({ code }) => /className = [`"]lv-shell /.test(code));
    expect(stages.map(({ file }) => file).sort()).toEqual(["s19/motion/abcPresentation.ts", "s19/motion/enterMode.ts", "s19/motion/objectExpand.ts", "s19/motion/tabExchange.ts"]);
    expect(stages.filter(({ code }) => !code.includes("markS19Stage(")).map(({ file }) => file)).toEqual([]);
  });
});
