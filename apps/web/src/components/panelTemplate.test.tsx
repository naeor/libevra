import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChoiceDialog } from "./ChoiceDialog.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ConsentDialog } from "./ConsentGate.js";
import { ProfileAccountNumberSheet } from "./ProfileAccountNumberSheet.js";

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

  it("模板遮罩伪元素只认模板的两档，不给自带底色的旧弹层再叠一层", () => {
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

describe("标准组件迁到模板外壳（源码断言）", () => {
  const callers = [
    "./CategoryTreeList.tsx",
    "./EntryFilterPanel.tsx",
    "./EntrySortControls.tsx",
    "./MessageQuote.tsx",
    "../pages/ThemeAppearancePage.tsx",
    "../statsWorkbench/CardEditor.tsx",
    "../statsWorkbench/PresetSheet.tsx",
    "../statsWorkbench/Sheets.tsx",
    "../statsWorkbench/StatsControls.tsx",
    "../workspace/GlobalRail.tsx",
    "./ui/ChoiceSheet.tsx",
    "./BookSwitcherSheet.tsx",
    "./BookManageSheet.tsx",
    "./MonthPicker.tsx",
  ];

  it("每个底部面板都用模板标题行（外壳的 title，或内容里的 SheetHeader）", () => {
    for (const file of callers) {
      const source = read(file);
      const sheets = source.split("<BottomSheet").slice(1);
      expect(sheets.length, file).toBeGreaterThan(0);
      for (const sheet of sheets) {
        const props = sheet.slice(0, sheet.indexOf(">"));
        expect(props.includes("title=") || source.includes("<SheetHeader"), file).toBe(true);
      }
    }
  });

  it("迁移后的面板不再自己画遮罩、拖动手势与 Tab 圈", () => {
    for (const file of ["./ui/ChoiceSheet.tsx", "./BookSwitcherSheet.tsx", "./BookManageSheet.tsx", "./MonthPicker.tsx"]) {
      const source = read(file);
      expect(source, file).not.toContain("data-overlay-backdrop");
      expect(source, file).not.toContain("onTouchStart");
      expect(source, file).not.toContain('key === "Tab"');
      expect(source, file).not.toContain("useKeyboardInset");
    }
  });

  it("分析的「放弃这次编辑？」是 T3 确认框，不再是底部面板", () => {
    const source = read("../statsWorkbench/Sheets.tsx");
    expect(source).toContain("export function DiscardDialog");
    expect(source).not.toContain("DiscardSheet");
    const dialog = source.slice(source.indexOf("export function DiscardDialog"));
    expect(dialog.slice(0, dialog.indexOf("\n}\n"))).toContain("<ConfirmDialog");
  });

  it("分类编辑器的取消与保存不再跳过退场动画", () => {
    const source = read("./CategoryTreeList.tsx");
    const editor = source.slice(source.indexOf("function CategoryEditor"));
    expect(editor).not.toContain("onClick={onClose}");
    expect(editor).not.toContain(".then(onClose)");
    expect(editor).toContain("sheet.finish()");
  });

  it("去掉列表底部重复的「关闭」：× 在右上角", () => {
    expect(read("../statsWorkbench/StatsControls.tsx")).not.toContain("statsWorkbench.controls.close");
    expect(read("../pages/ThemeAppearancePage.tsx")).not.toContain('t("common.action.close")');
    expect(read("../statsWorkbench/PresetSheet.tsx")).not.toContain('t("common.action.done")');
  });
});

describe("自绘与原生弹窗迁到模板（1.19.59）", () => {
  const panels: Readonly<Record<string, string>> = {
    "./UpdateMoreSheet.tsx": "T1",
    "./AvatarCreationNoteSheet.tsx": "T4",
    "./ledger/BatchEditSheet.tsx": "T2",
    "./ledger/AllCurrenciesSheet.tsx": "T4",
    "./entry/BatchAddSheet.tsx": "T5",
    "./ProfileAccountNumberSheet.tsx": "T4",
    "./Attachments.tsx": "T5",
    "./BookNotificationBell.tsx": "T4",
    "./ConsentGate.tsx": "T5 门禁",
  };

  it("都用模板外壳，不再有原生 <dialog>、私有遮罩与私有进出动画", () => {
    for (const file of Object.keys(panels)) {
      // 注释里提到原来的写法不算。
      const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(source, file).toContain("<BottomSheet");
      expect(source, file).not.toContain("<dialog");
      expect(source, file).not.toContain("showModal");
      expect(source, file).not.toContain(".animate(");
      expect(source, file).not.toContain("bg-ink/45");
    }
    // 全部币种抽成了独立组件。
    expect(read("../pages/DetailPage.tsx")).not.toContain("function AllCurrenciesSheet");
  });

  it("批量修改只换外壳：禁用原因与应用条件原地不动", () => {
    const source = read("./ledger/BatchEditSheet.tsx");
    expect(source).toContain("const applyReason =\n    blockedReason ??");
    expect(source).toContain("disabled={mixedKinds || blockedReason !== null}");
    expect(source).toContain("disabled={applyReason !== null || busy}");
  });

  it("关闭前询问按所有者的分类接入：有输入的五处询问，筛选直接关闭", () => {
    for (const file of ["./entry/BatchAddSheet.tsx", "../statsWorkbench/CardEditor.tsx", "./MessageQuote.tsx", "./ledger/BatchEditSheet.tsx", "./CategoryTreeList.tsx"]) {
      expect(read(file), file).toContain("dirty={");
    }
    expect(read("./EntryFilterPanel.tsx")).not.toContain("dirty={");
    expect(read("../workspace/GlobalRail.tsx")).not.toContain("dirty={");
  });

  it("账号编号：模板标题行、复制按钮，打开后不靠原生 dialog", () => {
    const html = renderToStaticMarkup(<ProfileAccountNumberSheet open number="LV-123456" onClose={() => undefined} />);
    expect(html).toContain("LV-123456");
    expect(html).toContain("data-sheet-close");
    expect(html).toContain('data-sheet-detent="content"');
    expect(html).not.toContain("<dialog");
    expect(renderToStaticMarkup(<ProfileAccountNumberSheet open={false} number="LV-1" onClose={() => undefined} />)).toBe("");
  });

  it("同意书是门禁变体：没有 ×、没有拖动条、层级最高、展示材质", () => {
    const gate = renderToStaticMarkup(<ConsentDialog title="用户协议" footer={<button type="button">同意</button>}><p>摘要</p></ConsentDialog>);
    expect(gate).not.toContain("data-sheet-close");
    expect(gate).not.toContain("data-sheet-handle");
    expect(gate).toContain("z-[80]");
    expect(gate).toContain('data-material-role="display"');
    expect(gate).toContain('data-sheet-gate="true"');
    // 账号数据页的注销确认可以取消：有 × 与拖动条。
    const cancellable = renderToStaticMarkup(<ConsentDialog title="注销账号" onDismiss={() => undefined} footer={null}><p>说明</p></ConsentDialog>);
    expect(cancellable).toContain("data-sheet-close");
  });

  it("B2 同意书面板的填充提到操作玻璃下限（内容 + .12）", () => {
    const token = block(read("../index.css"), 'html:root[data-visual-style="b2"] {').split("\n").find((line) => line.includes("--s19-display-sheet-bg:")) ?? "";
    expect(token).toContain("calc(var(--s19-content-fill) + .12)");
    expect(read("../s19/overlays.css")).toContain("background: var(--s19-display-sheet-bg);");
  });

  it("附件区 44px 点击区在所有风格生效（通用层，不带风格与浅色条件）", () => {
    const css = read("../s19/entry-workspace.css");
    // 规则从行首开始（前面没有 :root[data-visual-style] 或浅色条件）。
    const file = css.indexOf("\n.lv-shell[data-s19-scope] :is(.lv-capture-file, .lv-attachment-file).lv-material {");
    const buttons = css.indexOf("\n.lv-shell[data-s19-scope] :is(.lv-capture-attachments, .lv-attachments) :is(.lv-desk-link, .lv-desk-btn).lv-material {");
    expect(file).toBeGreaterThan(0);
    expect(buttons).toBeGreaterThan(0);
    expect(css.slice(file, css.indexOf("}", file))).toContain("min-height: 44px;");
    expect(css.slice(buttons, css.indexOf("}", buttons))).toContain("min-height: 44px;");
  });
});

describe("底部面板不再用会在深色下发白的墨色遮罩", () => {
  it("BottomSheet 不写 bg-ink/45", () => {
    expect(read("./BottomSheet.tsx")).not.toContain("bg-ink/45");
  });
});
