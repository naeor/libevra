import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BottomSheet } from "./BottomSheet.js";
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

  it("高度档位是可调的 CSS 变量", () => {
    const root = block(css, ":root {");
    for (const token of ["--lv-sheet-half-ratio", "--lv-sheet-half-min", "--lv-sheet-half-max", "--lv-sheet-large-gap", "--lv-sheet-resize-ms", "--lv-sheet-resize-ease"]) {
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

describe("1.19.61：筛选高半屏、S19 对话框遮罩深一档、筛选设置小卡宽度", () => {
  const css = read("./panel-template.css");

  it("高半屏是可调令牌（约 66%，带上下限），按 --lv-vh 计算", () => {
    const root = block(css, ":root {");
    expect(root).toMatch(/--lv-sheet-tall-ratio:\s*66;/);
    expect(root).toContain("--lv-sheet-tall-min:");
    expect(root).toContain("--lv-sheet-tall-max:");
    const formula = "clamp(var(--lv-sheet-tall-min), calc(var(--lv-vh) * var(--lv-sheet-tall-ratio)), var(--lv-sheet-tall-max))";
    // 底部面板形态：手机宽度（视口）与 Pad 分屏的窄工作区（容器）各一段，两段都是同一个固定高度。
    const phone = css.slice(css.lastIndexOf("@media (max-width: 639.98px) {"));
    const pane = css.slice(css.indexOf("@container lvpane (max-width: 639px) {"));
    expect(phone.slice(0, phone.indexOf("\n}"))).toContain(formula);
    expect(pane.slice(0, pane.indexOf("\n}"))).toContain(formula);
    expect(phone.slice(0, phone.indexOf("\n}"))).toContain('[data-sheet-detent="tall"]');
    expect(pane.slice(0, pane.indexOf("\n}"))).toContain('[data-sheet-detent="tall"]');
  });

  it("宽屏形态保持原样：高半屏在宽屏与固定半屏同高", () => {
    const shared = block(css, '[data-overlay-surface]:is([data-sheet-detent="half-fixed"], [data-sheet-detent="tall"]) {');
    expect(shared).toContain("clamp(var(--lv-sheet-half-min), calc(var(--lv-vh) * var(--lv-sheet-half-ratio)), var(--lv-sheet-half-max))");
  });

  it("高半屏只给明细与分析筛选（同一个 EntryFilterPanel），其余面板不用", () => {
    const hits: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && readFileSync(path, "utf8").includes('detent="tall"')) hits.push(entry);
      }
    };
    walk(fileURLToPath(new URL("..", import.meta.url)));
    expect(hits).toEqual(["EntryFilterPanel.tsx"]);
    for (const page of ["../pages/DetailPage.tsx", "../pages/StatsPage.tsx"]) expect(read(page), page).toContain("<EntryFilterPanel");
    const html = renderToStaticMarkup(<BottomSheet label="筛选" detent="tall" onClose={() => undefined}>x</BottomSheet>);
    expect(html).toContain('data-sheet-detent="tall"');
    // 高半屏仍是底部面板的遮罩档；宽屏形态默认居中（原样）。
    expect(html).toContain('data-overlay-scrim="sheet"');
    expect(html).toContain('data-sheet-wide="center"');
  });

  it("S19 每种风格的对话框遮罩：同一色相，比底部面板深 .10", () => {
    const tokens = read("../s19/s19-lab-tokens.css");
    const blocks: Record<string, string> = {
      a: block(tokens, ':root[data-visual-style="a"] {'),
      b1: block(tokens, ':root[data-visual-style="b1"] {'),
      b2: block(read("../index.css"), 'html:root[data-visual-style="b2"] {'),
      c: block(tokens, ':root[data-visual-style="c"] {'),
    };
    const expected: Record<string, readonly [number, number]> = { a: [0.24, 0.34], b1: [0.26, 0.36], b2: [0.22, 0.32], c: [0.24, 0.34] };
    for (const [style, text] of Object.entries(blocks)) {
      const sheet = /--s19-scrim:\s*rgb\((\d+ \d+ \d+) \/ (\.\d+)\);/.exec(text);
      const dialog = /--s19-scrim-dialog:\s*rgb\((\d+ \d+ \d+) \/ (\.\d+)\);/.exec(text);
      expect(sheet, style).not.toBeNull();
      expect(dialog, style).not.toBeNull();
      expect(dialog?.[1], style).toBe(sheet?.[1]);
      expect(Number(sheet?.[2]), style).toBeCloseTo(expected[style]![0], 5);
      expect(Number(dialog?.[2]), style).toBeCloseTo(expected[style]![1], 5);
    }
  });

  it("对话框档只用于中央对话框外壳；底部面板、大档与同意书门禁仍是 --s19-scrim；深色不变", () => {
    const overlays = read("../s19/overlays.css");
    const rule = overlays.indexOf('[data-overlay-root="dialog"][data-overlay-scrim="dialog"]::before {');
    expect(rule).toBeGreaterThan(0);
    expect(overlays.slice(rule, overlays.indexOf("}", rule))).toContain("var(--s19-scrim-dialog");
    // 只在浅色 S19 外壳里。
    expect(overlays.slice(overlays.lastIndexOf("\n", rule), rule)).toContain(':root[data-visual-style][data-theme-mode="light"] .lv-shell[data-s19-scope]');
    // CenterDialog 的根节点是 dialog；底部面板（含大档与门禁）的根节点是 sheet，不会命中。
    expect(read("./CenterDialog.tsx")).toContain('data-overlay-root="dialog"');
    // 下方用实际渲染断言手机面板的遮罩；Pad 非模态区没有遮罩标记。
    const large = renderToStaticMarkup(<BottomSheet label="大档" detent="large" onClose={() => undefined}>x</BottomSheet>);
    expect(large).toContain('data-overlay-root="sheet"');
    // 颜色字面量只在令牌文件里。
    expect(overlays.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/rgb\(/);
    // 深色仍是统一一档黑色（模板令牌不变）。
    const dark = block(css, 'html[data-theme-mode="dark"] {');
    expect(dark).toContain("--lv-scrim-dialog: var(--color-overlay-soft)");
  });

  it("筛选设置小卡在底部面板里与面板内容同宽，开关逻辑不变", () => {
    const filters = read("./entry-filters.css");
    expect(filters).toContain(".lv-filter-panel > [data-sheet-header] { position:relative; }");
    expect(filters).toContain(".lv-filter-panel > [data-sheet-header] .lv-filter-settings-wrap { position:static; }");
    expect(filters).toContain(".lv-filter-panel > [data-sheet-header] .lv-filter-settings { left:16px; right:16px; width:auto; }");
    const source = read("./EntryFilterPanel.tsx");
    expect(source).toContain("<Switch checked={sync} onCheckedChange={next => { setFilterSync(next, owner !== null && bookId !== null ? { owner, bookId } : null); }}");
  });
});

describe("1.19.63：高度内容优先（T1 / T2 / T4 按内容，最高到大档）", () => {
  const css = read("./panel-template.css");
  const phone = css.slice(css.indexOf("@media (max-width: 639.98px) {"));
  const phoneBlock = phone.slice(0, phone.indexOf("\n}"));
  /** 手机宽度大档的高度式子：按内容档的上限必须与它完全相同。 */
  const LARGE_LIMIT = "min(\n      calc(var(--lv-vh) * 100 - var(--lv-sheet-large-gap) - env(safe-area-inset-top, 0px)),\n      calc(var(--lv-vh) * 100 - var(--lv-sheet-edge) - var(--lv-sheet-kb, 0px))\n    )";

  it("按内容档的上限就是大档的高度：内容再多也只到大档，超过才在面板内滚动", () => {
    /** 媒体查询里的一条规则（缩进两格，以换行加两格缩进的右花括号结束）。 */
    const rule = (head: string): string => {
      const start = phoneBlock.indexOf(head);
      expect(start, head).toBeGreaterThanOrEqual(0);
      return phoneBlock.slice(start, phoneBlock.indexOf("\n  }", start));
    };
    const content = rule('[data-overlay-surface][data-sheet-detent="content"] {');
    expect(content).toContain(`max-height: ${LARGE_LIMIT};`);
    // 按内容：只有上限，没有固定高度。
    expect(content).not.toMatch(/\n\s*height:/);
    const large = rule('[data-overlay-surface][data-sheet-detent="large"] {');
    expect(large).toContain(`height: ${LARGE_LIMIT};`);
  });

  it("半屏 half 与按内容的约 50% 上限已删除；固定半屏的令牌仍在", () => {
    expect(css).not.toContain('data-sheet-detent="half"]');
    expect(css).not.toContain("--lv-sheet-content-ratio");
    const sheet = read("./BottomSheet.tsx");
    expect(sheet).toContain('export type SheetDetent = "content" | "half-fixed" | "tall" | "large";');
    expect(sheet).toContain('detent = "content",');
    const root = block(css, ":root {");
    expect(root).toMatch(/--lv-sheet-half-ratio:\s*52;/);
  });

  it("没有调用方再用 half；固定高度只剩两处例外：账本选择 half-fixed、明细与分析筛选 tall", () => {
    const uses: Record<string, string[]> = {};
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          for (const match of readFileSync(path, "utf8").matchAll(/detent="([a-z-]+)"/g)) (uses[match[1]!] ??= []).push(entry);
        }
      }
    };
    walk(fileURLToPath(new URL("..", import.meta.url)));
    expect(uses.half).toBeUndefined();
    expect(uses["half-fixed"]).toEqual(["BookSwitcherSheet.tsx"]);
    expect(uses.tall).toEqual(["EntryFilterPanel.tsx"]);
    expect(Object.keys(uses).sort()).toEqual(["content", "half-fixed", "large", "tall"]);
  });

  it("T1 列表、T2 表单的调用方都落在按内容档（不写档位即默认按内容）", () => {
    const t1t2 = [
      "./ui/ChoiceSheet.tsx",
      "./BookManageSheet.tsx",
      "./MonthPicker.tsx",
      "./UpdateMoreSheet.tsx",
      "../statsWorkbench/Sheets.tsx",
      "../statsWorkbench/StatsControls.tsx",
      "./MessageQuote.tsx",
      "./EntrySortControls.tsx",
      "../workspace/GlobalRail.tsx",
      "./CategoryTreeList.tsx",
      "./ledger/BatchEditSheet.tsx",
    ];
    for (const file of t1t2) {
      const source = read(file);
      expect(source, file).toContain("<BottomSheet");
      // 这些文件里只可能写按内容档，或者不写（默认按内容）。
      expect(/detent="(?!content")/.test(source), file).toBe(false);
    }
    const html = renderToStaticMarkup(<BottomSheet label="列表" onClose={() => undefined}>x</BottomSheet>);
    expect(html).toContain('data-sheet-detent="content"');
    expect(html).toContain('data-overlay-scrim="sheet"');
  });

  it("内容变化时的高度过渡：令牌与面板升起同一时长与曲线，过渡期间内容区不出滚动条，只给按内容档", () => {
    const root = block(css, ":root {");
    expect(root).toContain("--lv-sheet-resize-ms: 260ms;");
    expect(root).toContain("--lv-sheet-resize-ease: cubic-bezier(0.32, 0.72, 0, 1);");
    expect(read("../index.css")).toContain("animation: libellum-sheet-in 260ms cubic-bezier(0.32, 0.72, 0, 1);");
    expect(block(css, "[data-overlay-surface][data-sheet-resizing] > [data-sheet-body] {")).toContain("overflow: hidden;");
    expect(read("./BottomSheet.tsx")).toContain('useSheetHeightTransition(panelRef, rootRef, detent === "content" && !split);');
  });
});
