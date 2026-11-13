import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChoiceDialog } from "./ChoiceDialog.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

/**
 * 弹出面板模板的令牌与中央对话框外壳（1.19.58，规格 S19 设计系统「弹出面板模板」）。
 * 观感（遮罩深浅、档位高度）要看截图；这里钉住“集中定义、深色变暗、没有背景模糊、按钮不随说明滚走”。
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

function block(css: string, head: string): string {
  const start = css.indexOf(head);
  expect(start, head).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("模板令牌集中定义", () => {
  const css = read("./panel-template.css");

  it("三档高度是可调的 CSS 变量", () => {
    const root = block(css, ":root {");
    for (const token of ["--lv-sheet-content-ratio", "--lv-sheet-half-ratio", "--lv-sheet-half-min", "--lv-sheet-half-max", "--lv-sheet-large-gap"]) {
      expect(root).toContain(token);
    }
    expect(root).toMatch(/--lv-sheet-half-ratio:\s*52;/);
  });

  it("遮罩：浅色 Original 底部面板 .25 档、对话框与大档 .35 档；深色统一一档黑色", () => {
    const root = block(css, ":root {");
    expect(root).toContain("--lv-scrim-sheet: var(--color-overlay-soft)");
    expect(root).toContain("--lv-scrim-dialog: var(--color-overlay)");
    const dark = block(css, 'html[data-theme-mode="dark"] {');
    // 深色两档都取深色主题的黑色遮罩（.52），不会出现浅色墨色那种“发白”。
    expect(dark).toContain("--lv-scrim-sheet: var(--color-overlay-soft)");
    expect(dark).toContain("--lv-scrim-dialog: var(--color-overlay-soft)");
    expect(dark).not.toContain("--color-ink");
    const index = read("../index.css");
    expect(index.match(/--color-overlay-soft: rgb\(0 0 0 \/ 0\.52\);/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("S19 四种风格都有自己的遮罩定义（A、C 原来缺）", () => {
    const tokens = read("../s19/s19-lab-tokens.css");
    for (const style of ["a", "b1", "c"]) {
      expect(block(tokens, `:root[data-visual-style="${style}"] {`), style).toContain("--s19-scrim:");
    }
    expect(block(read("../index.css"), 'html:root[data-visual-style="b2"] {')).toContain("--s19-scrim:");
  });

  it("同意书弹窗自带遮罩，模板的遮罩伪元素不再叠一层", () => {
    expect(css).not.toMatch(/\[data-overlay-root\]\[data-overlay-scrim\]::before/);
    expect(css).toContain('[data-overlay-scrim="sheet"], [data-overlay-scrim="dialog"]');
  });
});

describe("中央对话框（T3）共同外壳", () => {
  it("确认框与选择框共用 CenterDialog，不再各写外壳、Tab 圈与背景模糊", () => {
    for (const file of ["./ConfirmDialog.tsx", "./ChoiceDialog.tsx", "./CenterDialog.tsx"]) {
      const source = read(file);
      expect(source, file).not.toContain("backdrop-blur");
      expect(source, file).not.toContain('key === "Tab"');
    }
    expect(read("./ConfirmDialog.tsx")).toContain("<CenterDialog");
    expect(read("./ChoiceDialog.tsx")).toContain("<CenterDialog");
    expect(read("./CenterDialog.tsx")).toContain("useDialogFocus");
  });

  it("按钮区固定在底部、不在说明的滚动区里", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog open title="删除这条账目？" description="很长的说明" confirmLabel="删除" onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    const body = html.indexOf("data-dialog-body");
    const actions = html.indexOf("data-dialog-actions");
    expect(body).toBeGreaterThanOrEqual(0);
    expect(actions).toBeGreaterThan(body);
    expect(html.slice(body, actions)).not.toContain("删除</button>");
    expect(html.slice(actions)).toContain("删除");
    expect(html).toContain('data-overlay-scrim="dialog"');
  });

  it("确认框仍是 alertdialog，选择框仍是 dialog", () => {
    const confirm = renderToStaticMarkup(
      <ConfirmDialog open title="确认" onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    const choice = renderToStaticMarkup(
      <ChoiceDialog open title="选择" choices={[{ id: "a", label: "甲" }]} onChoose={() => undefined} />,
    );
    expect(confirm).toContain('role="alertdialog"');
    expect(choice).toContain('role="dialog"');
    expect(choice).not.toContain("alertdialog");
  });
});

describe("底部面板不再用会在深色下发白的墨色遮罩", () => {
  it("BottomSheet 不写 bg-ink/45", () => {
    expect(read("./BottomSheet.tsx")).not.toContain("bg-ink/45");
  });
});
