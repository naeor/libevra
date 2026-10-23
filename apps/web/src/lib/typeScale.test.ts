import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **No new arbitrary font sizes.**
 *
 * ⚠️ **This is the guard that keeps the typography system from eroding**, and it exists because the
 * erosion already happened once. The S11 audit found:
 *
 * * `text-xs` used **186 times, 53 of them with an extra `leading-relaxed`** — the same 12px rendering
 *   at **16px or 19.5px** depending on whether the author happened to add a class;
 * * `text-[11px]` used **24 times** — a real, needed size that had **no name**, so it could not be
 *   found, could not be adjusted, and was re-invented at 10px in two more places.
 *
 * ⚠️ **A token that anybody may bypass is not a system.** The audit's own recommendation was this
 * check, in as many words: *"没有这条检查，token 会在几个月内被新的任意值绕过."*
 *
 * ⚠️ **Modeled on `colors.test.ts`**, which has guarded hex literals the same way since S6 — including
 * its second test, which exists because **a guard that silently checks nothing is worse than no
 * guard.**
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));

/**
 * ⚠️ **Every file allowed to name a pixel size, and why.**
 *
 * ⚠️ **An allowlist rather than a blanket ban, on the owner's instruction**: *"不要一刀切禁止所有任意值。
 * 动画插值、图表、必要的技术例外可以明确列入白名单."* Each entry below is a **reason**, not a
 * permission — adding one should feel like adding an exception to a rule, because that is what it is.
 */
const ALLOWED: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: "pages/DetailPage.tsx",
    why: "明细页动态头部：字号随 `--p` 插值、币种卡与提示的本轮保护范围（所有者 §8.2）",
  },
  {
    file: "pages/ExportPage.tsx",
    why: "16px 是 input 的**防 iOS 聚焦缩放**阈值，与 `index.css` 的全局规则同义（所有者 §8.4）",
  },
];

/** ⚠️ The chart components, taken as a directory rather than one by one. */
const ALLOWED_DIRS: readonly { readonly dir: string; readonly why: string }[] = [
  {
    dir: "components/charts",
    why: "图表刻度 / 图例 / 浮层：字号受 SVG 密度约束，10px 是为在 390px 内容纳刻度（所有者 §8.5）",
  },
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "generated" || entry === "node_modules") continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(tsx|ts)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    found.push(path);
  }

  return found;
}

/**
 * ⚠️ **Comments are stripped before searching, and that matters here more than usual.**
 * This project explains its decisions **in the code**, so a comment that says
 * *"it used to be `text-[11px]`"* is documentation, not a use. Counting it would make the guard
 * **punish the explanation** — and the honest repair would be to delete the explanation, which is the
 * opposite of what the documentation rules ask for.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("任意字号", () => {
  const offenders: string[] = [];
  let scanned = 0;

  for (const path of sourceFiles(SRC)) {
    const rel = relative(SRC, path).replace(/\\/g, "/");
    if (ALLOWED.some((entry) => entry.file === rel)) continue;
    if (ALLOWED_DIRS.some((entry) => rel.startsWith(`${entry.dir}/`))) continue;

    scanned += 1;
    const source = stripComments(readFileSync(path, "utf8"));

    for (const match of source.matchAll(/text-\[\d+px\]/g)) {
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${rel}:${String(line)} ${match[0]}`);
    }
  }

  it("只在白名单文件里出现", () => {
    expect(
      offenders,
      [
        "组件里出现了任意字号。请改用语义 token（见 docs/specs/design/文字语义与排版规范.md §13）：",
        "  正文 text-body ｜ 辅助 text-helper ｜ 微文字 text-micro ｜ 功能区标题 text-section-title",
        "确实需要新尺寸时，先加语义 token，再把它加进本测试的白名单并写明理由。",
        `  ${offenders.join("\n  ")}`,
      ].join("\n"),
    ).toEqual([]);
  });

  it("每个白名单条目都还写得有理由", () => {
    /**
      * ⚠️ **An allowlist entry without a reason is a hole, not an exception.** This is the same idea
      * as `colors.test.ts`'s second test: the guard has to stay honest about what it is letting
      * through, or it becomes a list somebody appends to without reading.
      */
    for (const entry of [...ALLOWED, ...ALLOWED_DIRS]) {
      const why = "why" in entry ? entry.why : "";
      expect(why.length, `${JSON.stringify(entry)} 没有写明理由`).toBeGreaterThan(10);
    }
  });

  it("keeps the check honest by finding the files it is meant to guard", () => {
    /**
      * ⚠️ **A guard that silently checks nothing is worse than no guard.** If the walk ever stops
      * finding files — a wrong root, a renamed directory — this fails instead of passing quietly.
      * The threshold is deliberately well below the real count (133) so ordinary file churn does not
      * make it flaky.
      */
    expect(scanned).toBeGreaterThan(100);
    expect(sourceFiles(SRC).some((path) => path.endsWith("index.css"))).toBe(false);
  });
});

/**
 * ⚠️ **The iOS floor is a pair, and this is the second half.**
 *
 * `index.css` gives every form control a 16px default **inside `@layer base`**:
 *
 *  * outside a layer it would override every `text-*` utility, because unlayered rules beat layered
 *    ones whatever their selector — the defect that made `/add` need `text-4xl!` and silently capped
 *    `text-3xl` / `text-2xl` fields at 16px;
 *  * inside `base`, a utility can win — which is the point, and also the risk. iOS Safari magnifies
 *    the whole page when a control smaller than 16px receives focus, and it does not zoom back out.
 *    **A default cannot protect a control that deliberately asks for `text-sm`.**
 *
 * So: the rule must stay in `base`, and no `input` / `select` / `textarea` in the source may name a
 * size below 16px. Two halves, each useless alone — deleting either one is how the protection is
 * lost without any test noticing.
 */

/**
 * Sizes generated by the project's own tokens, plus Tailwind's `text-xs` / `text-sm`.
 *
 * ⚠️ `placeholder:` and `file:` are excluded on purpose: they size the *placeholder* or the
 * file-selector button, not the text the control itself renders. `focus:` / `sm:` are kept,
 * because those really do change what a person types on this device.
 */
const SMALL_TEXT_CLASS =
  /(?:^|[\s"'`])(?!(?:placeholder|file|before|after|marker|selection):)((?:[\w-]+:)?text-(?:body-relaxed|helper-relaxed|button-lg|card-title|body|helper|micro|link|button|xs|sm))(?![\w-])/g;

/** `text-[10px]` / `text-[0.875rem]` are not tokens, but they are still sizes. */
function arbitraryTextSizesIn(tag: string): string[] {
  const found: string[] = [];
  for (const match of tag.matchAll(/text-\[([0-9]*\.?[0-9]+)(px|rem)\]/g)) {
    const value = Number(match[1]);
    const pixels = match[2] === "rem" ? value * 16 : value;
    if (pixels < 16) found.push(match[0]);
  }
  return found;
}

/** ⚠️ The opening tag is delimited before any comment stripping — see the note below. */
function formControlTag(source: string, start: number): string {
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

  return source.slice(start, start + 1200);
}

/** Checkboxes, radios and file/hidden inputs carry no text; their font size is not the iOS issue. */
function carriesText(tag: string): boolean {
  return !/\btype=(?:"(?:checkbox|radio|file|hidden)"|'(?:checkbox|radio|file|hidden)')/.test(tag);
}

/**
 * ⚠️ **Comments inside an opening tag are prose, not classes** — and this repo puts whole
 * explanations between `<select` and `className`. They are removed here, but **only outside
 * quotes**, so a `/*` inside a literal (`accept="image/*"`) cannot swallow the rest of the tag.
 */
function withoutJsComments(source: string): string {
  let result = "";
  let quote: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote !== null) {
      result += character;
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      result += character;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index + 2);
      index = end === -1 ? source.length : end;
      continue;
    }
    result += character;
  }

  return result;
}

/** The body of every `@layer <name> { … }` block, matched by braces rather than by regex alone. */
function layerBodies(css: string, name: string): string[] {
  const bodies: string[] = [];
  const opener = new RegExp(`@layer\\s+${name}\\s*\\{`, "g");

  for (const match of css.matchAll(opener)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let close = css.length;
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) { close = index; break; }
      }
    }
    bodies.push(css.slice(open + 1, close));
  }

  return bodies;
}

/** The same CSS with every named layer block removed, for the "not outside a layer" check. */
function withoutLayer(css: string, name: string): string {
  const opener = new RegExp(`@layer\\s+${name}\\s*\\{`, "g");
  let result = "";
  let cursor = 0;

  for (const match of css.matchAll(opener)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let close = css.length;
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) { close = index; break; }
      }
    }
    result += css.slice(cursor, match.index);
    cursor = close + 1;
  }

  return result + css.slice(cursor);
}

describe("表单控件字号", () => {
  const formRule = /input\s*,\s*select\s*,\s*textarea\s*\{[^}]*font-size:\s*16px\s*;?/;

  it("16px 保底在 @layer base 里，而不是在层外", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

    expect(
      layerBodies(css, "base").some((body) => formRule.test(body)),
      "index.css 的 `input, select, textarea { font-size: 16px }` 必须写在 @layer base 里（见该处注释）。",
    ).toBe(true);

    expect(
      formRule.test(withoutLayer(css, "base")),
      "层外还有一份 `input, select, textarea { font-size: … }`：层外规则会重新压过所有 text-* utility。",
    ).toBe(false);
  });

  it("input / select / textarea 不使用低于 16px 的字号类", () => {
    const offenders: string[] = [];
    let checked = 0;

    /**
      * ⚠️ **The raw source is scanned, and only the opening tag is comment-stripped.**
      *
      * A whole-file block-comment strip is wrong here: the repo has `accept="image/*"` in file
      * inputs, and the `/*` inside that string makes a naive strip swallow the next few hundred
      * characters — the guard would then read a broken tag and quietly check less than it claims.
      * `withoutJsComments` therefore removes comments **only outside quotes**, which also handles
      * the explanations this repo writes between `<select` and `className`.
      */
    for (const path of sourceFiles(SRC)) {
      const source = readFileSync(path, "utf8");
      const rel = relative(SRC, path).replace(/\\/g, "/");

      for (const match of source.matchAll(/<(input|select|textarea)\b/g)) {
        const tag = withoutJsComments(formControlTag(source, match.index));
        if (!carriesText(tag)) continue;
        checked += 1;

        const found = [...tag.matchAll(SMALL_TEXT_CLASS)].map((hit) => hit[1] ?? "");
        found.push(...arbitraryTextSizesIn(tag));

        if (found.length > 0) {
          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(`${rel}:${String(line)} ${[...new Set(found)].join(", ")}`);
        }
      }
    }

    expect(checked).toBeGreaterThan(25);
    expect(
      offenders,
      [
        "表单控件出现了低于 16px 的字号类。iOS Safari 会在控件聚焦时放大整页且不缩回：",
        "  请改用 text-base（16px）或更大的 token；确需例外，先改这条不变量并说明理由。",
        `  ${offenders.join("\n  ")}`,
      ].join("\n"),
    ).toEqual([]);
  });
});
