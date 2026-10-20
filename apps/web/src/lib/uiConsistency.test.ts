import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **同一套界面里，两个地方不该对同一件事有两种答案。**
 *
 * ⚠️ **这条检查来自 S16 视觉一致性审查里两个真实的漂移，不是假想：**
 *
 * 1. **横向筛选条的原生滚动条。** 明细页的币种条早就用
 *    `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden` 把滚动条隐掉了，而分析页的两条筛选条
 *    是同一个写法却漏了这两个类——桌面 Chrome 下它们各自带出一条**带左右箭头的灰色滚动条**，
 *    贴在筛选片下方。**同一个模式、两处代码、两种观感**，而代码评审里看不出来。
 * 2. **下拉框的字段外观。** `rounded-field` 是「控件 / 列表行 / 输入框」的唯一形状
 *    （见《布局间距与圆角规范》§15.7）。一个裸 `<select>` 会自己画出浏览器默认的方角、默认边框和
 *    默认字号——**它不是"样式差一点"，它是另一个软件的控制件。**
 *
 * ⚠️ **为什么是这两条，而不是"把所有样式都查一遍"。** 能稳定判定的只有"这个结构必须带上那个类"，
 * 判不了"这个间距好不好看"。守卫越小越不会被删掉，这与 `colors.test.ts` / `typeScale.test.ts`
 * 的选择一致：**只把已经真实漂移过、且判定规则无歧义的部分编码成规则，其余写进文档。**
 *
 * ⚠️ **注释先剥掉再查**：本项目把决定写在注释里，`ErrorBoundary` 的注释里就出现过
 * `overflow-x-auto`。惩罚解释的守卫会被删掉。
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "generated" || entry === "node_modules") continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(tsx|ts|css)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    found.push(path);
  }

  return found;
}

/**
 * ⚠️ **The one place a visible scrollbar is honest: the stack trace.**
 *
 * `ErrorBoundary` renders the error's stack in a `<pre>`; it is a block of pre-formatted text whose
 * whole job is to be copied out of, so hiding the scrollbar there would only hide the fact that the
 * line is longer than the screen. That is a different thing from a strip of chips that happens to
 * be one pixel wider than the phone.
 */
const SCROLLBAR_ALLOWED: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: "components/ErrorBoundary.tsx",
    why: "堆栈文本的横向滚动条是**信息**（这一行比屏幕宽），不是多余的界面装饰",
  },
];

/** ⚠️ How far after `<select` / `overflow-x-auto` the class string is allowed to start. */
const WINDOW = 400;

/**
 * ⚠️ **The `<select>`'s opening tag, not "the next 400 characters".**
 *
 * A fixed window is the obvious first attempt and it is wrong in both directions: `BatchEditSheet`'s
 * selects carry a multi-line `onChange` before `className`, so 400 characters stopped short and the
 * guard **reported two controls that were fine**; a longer window would instead start reading the
 * *next* element's classes and pass a select that had none. **A guard with false alarms gets deleted,
 * and one that reads the wrong element is worse than absent** — so the tag is delimited properly:
 * `>` ends it only outside quotes and outside `{}` / `()` (the arrow functions inside `onChange`
 * contain both).
 */
function openingTag(source: string, start: number): string {
  let brace = 0;
  let paren = 0;
  let quote: string | null = null;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") { quote = character; continue; }
    if (character === "{") { brace += 1; continue; }
    if (character === "}") { brace -= 1; continue; }
    if (character === "(") { paren += 1; continue; }
    if (character === ")") { paren -= 1; continue; }
    if (character === ">" && brace === 0 && paren === 0) return source.slice(start, index + 1);
  }

  return source.slice(start, start + WINDOW);
}

describe("界面一致性", () => {
  const files = sourceFiles(SRC).map((path) => ({
    rel: relative(SRC, path).replace(/\\/g, "/"),
    source: path.endsWith(".css") ? "" : stripComments(readFileSync(path, "utf8")),
  }));

  it("下拉框都使用字段形状（rounded-field），不用浏览器默认外观", () => {
    const offenders: string[] = [];
    let selects = 0;

    for (const { rel, source } of files) {
      for (const match of source.matchAll(/<select\b/g)) {
        selects += 1;
        const tag = openingTag(source, match.index);
        if (!tag.includes("rounded-field")) {
          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(`${rel}:${String(line)}`);
        }
      }
    }

    expect(
      offenders,
      [
        "出现了没有字段形状的 <select>。裸 <select> 会画出浏览器默认的方角/边框/字号：",
        "  请至少带上 rounded-field 与 border border-line bg-surface，字号不低于 16px",
        "  （16px 是 index.css 里「iOS 聚焦不放大整页」的不变量）。",
        `  ${offenders.join("\n  ")}`,
      ].join("\n"),
    ).toEqual([]);

    // ⚠️ A guard that silently checks nothing is worse than no guard.
    expect(selects).toBeGreaterThan(5);
  });

  it("横向滚动条被显式处理过（要么隐藏，要么在白名单里写明理由）", () => {
    const offenders: string[] = [];
    let strips = 0;

    for (const { rel, source } of files) {
      const exempt = SCROLLBAR_ALLOWED.some((entry) => entry.file === rel);

      for (const match of source.matchAll(/overflow-x-auto/g)) {
        strips += 1;
        const window = source.slice(Math.max(0, match.index - 200), match.index + WINDOW);
        const hides = window.includes("[scrollbar-width:none]") && window.includes("[&::-webkit-scrollbar]:hidden");
        if (!hides && !exempt) {
          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(`${rel}:${String(line)}`);
        }
      }
    }

    expect(
      offenders,
      [
        "横向滚动容器没有隐藏原生滚动条。桌面 Chrome 会画出一条带箭头的灰条，",
        "把「一排标签」读成「一个滚动区」：",
        "  请照明细页的写法补上 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden，",
        "  或把文件加进 SCROLLBAR_ALLOWED 并写明为什么这里的滚动条是信息。",
        `  ${offenders.join("\n  ")}`,
      ].join("\n"),
    ).toEqual([]);

    expect(strips).toBeGreaterThan(2);
  });

  it("每个白名单条目都还写得有理由", () => {
    for (const entry of SCROLLBAR_ALLOWED) {
      expect(entry.why.length, `${entry.file} 没有写明理由`).toBeGreaterThan(10);
    }
  });

  it("keeps the check honest by finding the files it is meant to guard", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.rel.endsWith("index.css"))).toBe(true);
  });
});
