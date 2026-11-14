import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { ToastAction } from "../../lib/toast/types.js";

/**
 * **统一提示条的守卫（1.19.66）**：不维护五套实现，也不长出第六套。
 *
 * 1. 旧实现（撤销条 `UndoBar`、Pad 外壳提示 `ShellToast`、分析工作台 `sw-toast`、拍照导入的 `ImportToast` 视图、
 *    头像横幅 `AvatarRewardBanner`）在正式代码里一个不剩；`lv-toast` 类只属于 `components/toast/` 与 `s19/toast.css`。
 * 2. 五个旧入口都改走 `useToast()`。
 * 3. `components/toast/` 以外，同一个元素不能既固定定位、又是播报区（`aria-live` / `role="status"|"alert"`）——
 *    那就是一套新的提示条。常驻状态条（离线横幅等）不是固定定位，不受影响。
 * 4. 材质只写在 S19 通用层、只引用令牌；B2 的 `backdrop-filter` 先写 `-webkit-` 前缀；两份样式都有减少动态效果分支。
 * 5. 带操作的提示必须写出常设替代路径（WCAG 2.2.1 写成类型约束，见下方 `@ts-expect-error`）。
 *
 * 注释先剥掉再查：说明文字里提到旧名字不算违规。
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const LAB_DIRS = ["s19/optics-lab/", "s19/component-gallery/", "s19/adaptation-lab/", "s19/avatar-lab/", "s19/motion-lab/"];
const posix = (path: string): string => relative(SRC, path).split(sep).join("/");

function files(directory: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === "generated") continue;
      found.push(...files(path, pattern));
    } else if (pattern.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}
const strip = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const sources = files(SRC, /\.(ts|tsx|css)$/).map((path) => ({ file: posix(path), code: strip(readFileSync(path, "utf8")) }));
const read = (file: string): string => readFileSync(join(SRC, file), "utf8");
/** 按顶层逗号拆选择器（`:is(a, b)` 里的逗号不拆）。 */
function topLevel(rule: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i <= rule.length; i += 1) {
    const c = rule[i];
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth -= 1;
    if (i === rule.length || (c === "," && depth === 0)) {
      out.push(rule.slice(from, i).trim());
      from = i + 1;
    }
  }
  return out.filter(Boolean);
}

describe("统一提示条守卫", () => {
  it("旧的五套实现在正式代码里一个不剩", () => {
    const offenders = sources.flatMap(({ file, code }) =>
      [/\bUndoBar\b/, /\bShellToast\b/, /\bsw-toast\b/, /\bAvatarRewardBanner\b/, /\bimportToastReducer\b/, /<ImportToast\b/, /\bIMPORT_TOAST_MS\b/]
        .filter((pattern) => pattern.test(code))
        .map((pattern) => `${file}: ${String(pattern)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("lv-toast 类只属于 components/toast/ 与 s19/toast.css", () => {
    const offenders = sources
      .filter(({ file }) => !file.startsWith("components/toast/") && file !== "s19/toast.css")
      .filter(({ code }) => /\blv-toast/.test(code))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("五个旧入口都改走 useToast()", () => {
    expect(read("components/UndoProvider.tsx")).toMatch(/useToast\(\)[\s\S]*toast\.show\(/);
    expect(read("workspace/WorkspaceShell.tsx")).toMatch(/const say = useCallback\(\(text: string\) => \{\s*toast\.show\(\{ tone: "info", text, scope: "app" \}\);/);
    const stats = read("pages/StatsPage.tsx");
    expect(stats).toContain("const toast = useToast();");
    expect(stats).not.toMatch(/setToast\(/);
    expect(read("components/ocr/ImportDoneScreen.tsx")).toContain("toast.show(importDoneToast(outcome))");
    expect(read("components/AvatarRewardNotice.tsx")).toMatch(/toast\.show\(\s*avatarRewardToast\(/);
    // 宿主只有两处：手机 / Pad 外壳与电脑版外壳。
    const hosts = sources
      .filter(({ file, code }) => !file.startsWith("components/toast/") && !LAB_DIRS.some((dir) => file.startsWith(dir)) && /<ToastViewport\b/.test(code))
      .map(({ file }) => file);
    expect(hosts.sort()).toEqual(["desktop/DesktopShell.tsx", "workspace/WorkspaceShell.tsx"]);
  });

  it("components/toast/ 以外，没有既固定定位又是播报区的元素（防止长出第六套）", () => {
    const offenders: string[] = [];
    for (const { file, code } of sources) {
      if (!file.endsWith(".tsx") || file.startsWith("components/toast/") || LAB_DIRS.some((dir) => file.startsWith(dir))) continue;
      for (const match of code.matchAll(/aria-live=|role="(?:status|alert)"/g)) {
        const start = code.lastIndexOf("<", match.index);
        let depth = 0;
        let end = start;
        for (let i = start; i < code.length; i += 1) {
          const c = code[i];
          if (c === "{") depth += 1;
          else if (c === "}") depth -= 1;
          else if (c === ">" && depth === 0 && code[i - 1] !== "=") {
            end = i;
            break;
          }
        }
        const tag = code.slice(start, end + 1);
        if (/(^|[\s"'`])fixed(\s|["'`])|position:\s*["']fixed["']/.test(tag)) offenders.push(`${file}: ${tag.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("S19 材质只写在通用层、只引用令牌；B2 背景模糊先写 -webkit- 前缀", () => {
    const css = strip(read("s19/toast.css"));
    const rules = css.split("{").map((part) => part.split("}").pop()!.trim()).filter((selector) => selector.includes("[data-toast-surface]"));
    expect(rules.length).toBeGreaterThan(10);
    for (const rule of rules) {
      for (const selector of topLevel(rule)) {
        expect(selector).toContain('.lv-shell[data-s19-scope]');
        expect(selector).not.toContain('[data-s19-scope="phone"]');
      }
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    // 只看声明块（花括号里面）；@supports 的条件里两种写法的先后无所谓。
    const declarations = [...css.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1]!).filter((body) => body.includes("backdrop-filter"));
    expect(declarations.length).toBeGreaterThan(0);
    for (const block of declarations) {
      const prefixed = block.indexOf("-webkit-backdrop-filter");
      const plain = block.search(/(^|[^-])backdrop-filter/);
      expect(prefixed).toBeGreaterThanOrEqual(0);
      expect(prefixed).toBeLessThan(plain);
    }
    // A 用 A3 悬浮档（不带品牌色）；B2 用提示条专用填充（1.19.72：约 70% 不透明，压在纯黑上正文约 6:1，仍 ≥ 4.5:1；
    // 1.19.67 曾用账本卡填充约 80%），保留表面模糊。只降底材质，不降组件整体透明度。
    expect(css).toContain("--lv-toast-sh: var(--s19-a-elev-3)");
    expect(css).toContain("--lv-toast-bg: var(--s19-toast-bg)");
    expect(css).not.toContain("--lv-toast-bg: var(--s19-action-bar-bg)");
    expect(css).not.toMatch(/\[data-toast-surface\][^{]*\{[^}]*(^|[^-])opacity:\s*0?\.\d/m);
    expect(read("index.css")).toContain("--s19-toast-bg: rgb(var(--s19-glass-rgb) / max(.7, var(--s19-chrome-fill)));");
    expect(css).toMatch(/\[data-visual-style="b2"\][^{]*\[data-toast-surface\]::before\s*\{[^}]*backdrop-filter: var\(--s19-entry-filter\)/);
  });

  it("错误提示的描边比 1.19.66 略粗、略深，只给错误类型（1.19.72）", () => {
    const base = strip(read("components/toast/toast.css"));
    const s19 = strip(read("s19/toast.css"));
    expect(base).toMatch(/\.lv-toast\[data-tone="error"\]\s*\{[^}]*border-width: 1\.5px; border-color: color-mix\(in oklab, var\(--color-danger\) 50%, transparent\)/);
    expect(s19).toMatch(/\[data-tone="error"\]::after\s*\{[^}]*inset 0 0 0 1\.5px color-mix\(in oklab, var\(--color-danger\) 50%, transparent\)/);
    // 其他类型不带危险色描边
    for (const tone of ["info", "success", "warning"]) {
      expect(base).not.toContain(`[data-tone="${tone}"] {`);
      expect(s19).not.toContain(`[data-tone="${tone}"]::after`);
    }
  });

  it("入场延迟只来自宿主写的变量：账本胶囊让位时等它基本缩回（1.19.72）", () => {
    const base = strip(read("components/toast/toast.css"));
    const s19 = strip(read("s19/toast.css"));
    expect(base).toMatch(/\.lv-toast\[data-phase="enter"\]\s*\{[^}]*var\(--lv-toast-enter-delay, 0ms\) both/);
    expect(s19.match(/lv-toast-(move|fade)-in [^;]*var\(--lv-toast-enter-delay, 0ms\) both/g)?.length).toBe(3);
    // 胶囊让位，不再是障碍物
    expect(read("components/PersistentBookCapsule.tsx")).not.toContain("data-toast-avoid");
    expect(read("components/PersistentBookCapsule.tsx")).toContain("data-toast-give-way");
  });

  it("两份提示条样式都有减少动态效果分支", () => {
    expect(read("components/toast/toast.css")).toContain("@media (prefers-reduced-motion: reduce)");
    expect(read("s19/toast.css")).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("带操作的提示必须写出常设替代路径（类型约束）", () => {
    // @ts-expect-error —— 缺少 alternative：提示消失后用户在哪里还能做这件事？
    const missing: ToastAction = { label: "撤销", run: () => undefined };
    const ok: ToastAction = { label: "撤销", run: () => undefined, alternative: "编辑历史 → 已删除账目 →「恢复」" };
    expect(missing.label).toBe(ok.label);
  });
});
