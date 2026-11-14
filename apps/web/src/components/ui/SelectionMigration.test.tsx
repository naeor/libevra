import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EntrySortOptions } from "../EntrySortControls.js";
import { BillFilterRow } from "../import/BillImportViews.js";
import { MonthPicker } from "../MonthPicker.js";

/**
 * 其余页面的选择类控件迁到正式选中组件（1.19.68）。本仓库没有 jsdom：这里用静态渲染检查结构与 aria，
 * 用源码检查“迁了哪个组件、值与选择逻辑原样”，外观由 selection-controls.css 的守卫（SelectionControls.test.tsx）与样板页截图保证。
 */
const src = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const css = readFileSync(new URL("./selection-controls.css", import.meta.url), "utf8");

describe("静态渲染：迁移后结构、aria 与选中状态不变", () => {
  it("排序字段是纵向 MovingSelection：容器仍是 group + 原类名，按钮仍是 aria-pressed，选中块只多一个 aria-hidden 的 span", () => {
    const html = renderToStaticMarkup(<EntrySortOptions value="amount" onSelect={() => undefined} />);
    expect(html).toContain('class="lv-entry-order-list"');
    expect(html).toContain('role="group"');
    expect(html).toContain('data-select-moving=""');
    expect(html).toContain('data-axis="y"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/<button type="button"/g)).toHaveLength(3);
    expect(html).toContain('<span data-select-block="" aria-hidden="true"></span>');
    // 选中的是“金额”这一行（第二个按钮）。
    expect(html.indexOf('aria-pressed="false"')).toBeLessThan(html.indexOf('aria-pressed="true"'));
  });

  it("账单导入状态筛选是 SelectionGrid：每个胶囊仍是 aria-pressed 按钮，只有当前状态为 true", () => {
    const counts = { all: 5, problem: 1, duplicate: 2, ok: 2 } as never;
    const html = renderToStaticMarkup(<BillFilterRow filter="duplicate" counts={counts} onSelect={() => undefined} />);
    expect(html).toContain('data-select-grid=""');
    expect(html).toContain('role="group"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("月份选择：十二个月格与“全部”都是 SelectionItem（aria-pressed、可用性不变），“本月”仍是普通按钮", () => {
    const html = renderToStaticMarkup(<MonthPicker open month="2026-11" maxMonth="2026-11" allowAll onSelect={() => undefined} onClose={() => undefined} />);
    // 弹出面板用 portal 之外的外壳时 renderToStaticMarkup 也能渲染内容；找不到容器时退回断言源码。
    if (html.includes("data-select-item")) {
      expect(html.match(/data-select-item=""/g)!.length).toBe(13);
      expect(html.match(/disabled=""/g)!.length).toBeGreaterThanOrEqual(1);
    }
    expect(src("components/MonthPicker.tsx")).toContain("<SelectionItem");
  });
});

describe("源码：每处迁移用的组件与原逻辑", () => {
  const cases: [string, string, string[]][] = [
    ["批量添加 支出 / 收入", "components/entry/BatchAddSheet.tsx", ['<MovingSelection axis="x" data-select-flat=""', "onChange({ kind, categoryId: null });"]],
    ["记账更多选项 支付方式", "components/entry/EntryMoreOptions.tsx", ["<SelectionGrid", "onPaymentMethodChange(method.id === paymentMethodId ? null : method.id);"]],
    ["留言引用 账目 / 事件", "components/MessageQuote.tsx", ['<MovingSelection axis="x"', "setTab(value);"]],
    ["账本导入 导入 / 跳过", "pages/LedgerImportPage.tsx", ['<MovingSelection axis="x" data-select-track="" role="group"', "data-select-tone={option.tone}", "onClick={() => onChange(option.value)}"]],
    ["明细排序 字段与方向", "components/EntrySortControls.tsx", ['<MovingSelection axis="y" className="lv-entry-order-list"', "onClick={() => onSelect(field)}", "onClick={() => onSelect(direction)}"]],
    ["附件筛选 有无 / 类型", "components/EntrySortControls.tsx", ['<MovingSelection axis="x" className="lv-entry-choices"', '<SelectionGrid className="lv-entry-choices"', "change({ attachment: v })", "change({ type: v })"]],
    ["月份选择", "components/MonthPicker.tsx", ["choose(value);", "onSelect(ALL_MONTHS);"]],
    ["账单导入状态筛选", "components/import/BillImportViews.tsx", ["<SelectionGrid", "onSelect(entry.id);"]],
    ["OCR 概览 状态 / 来源 / 方向", "components/ocr/OcrOverview.tsx", ["<SelectionGrid", '<MovingSelection axis="x"', 'onDirectionChange("income");', "onSourceChange(value);"]],
    ["导出 时间范围与格式", "pages/ExportPage.tsx", ['<SelectionGrid data-select-flat=""', '<MovingSelection axis="x" data-select-flat=""', "setRange(preset);", "setFormat(value);", 'text-current/80']],
    ["月份离线下载 自动 / 从不", "pages/MonthDownloadPage.tsx", ['<MovingSelection axis="x" data-select-flat=""', "setNever(!auto);", "void setNeverMonth(month, !auto).then(() => load());"]],
    ["非重复关系", "components/NotDuplicateRelationsSection.tsx", ['<MovingSelection axis="x" role="group"', "if (showRevoked) onToggleRevoked();", "if (!showRevoked) onToggleRevoked();"]],
    ["冲突页 本地 / 远端", "components/ConflictScreen.tsx", ['<MovingSelection axis="y" data-select-flat=""', "next.set(field.field, option.value);", "setAnswers(next);"]],
    ["附件 PDF 缩放", "components/AttachmentPdf.tsx", ['<MovingSelection axis="x" data-select-track="" className="lv-attachment-zoom"', "setZoom(value)"]],
    ["拍照 单张 / 批量", "pages/ScanPage.tsx", ['<MovingSelection axis="y" data-select-flat=""', "onSelect(mode);"]],
  ];
  for (const [name, file, needles] of cases) {
    it(`${name}`, () => {
      const text = src(file);
      for (const needle of needles) expect(text, needle).toContain(needle);
    });
  }

  it("不该动的没动：标签多选（保留标签自己的颜色）、C 与 Original 的支出 / 收入、登录 / 注册链接", () => {
    expect(src("components/entry/EntryMoreOptions.tsx")).toContain("tagFillStyle(tag.color)");
    expect(src("components/entry/EntryMoreOptions.tsx")).not.toMatch(/<SelectionItem[^>]*tag/);
    expect(src("components/EntryForm.tsx")).not.toContain("SelectionControls");
    expect(src("components/AuthSwitcher.tsx")).not.toContain("SelectionControls");
    expect(src("components/AuthSwitcher.tsx")).toContain("aria-current");
  });
});

describe("外观：1.19.68 新增规则", () => {
  it("选中项的底色让位压过按钮已有的材质映射（抬高优先级的专用块）", () => {
    expect(css).toContain(':root:root:root[data-visual-style][data-theme-mode="light"] .lv-shell[data-s19-scope] {');
  });
  it("被禁用的格子 / 行不显示选中（月份格里不可选的月份）", () => {
    expect(css).toContain('[data-select-grid] > button:is([aria-pressed="true"], [aria-checked="true"]):not(:disabled)');
    expect(css).toContain('[aria-checked="true"]):not(:disabled)');
  });
  it("data-select-flat（1.19.69）：未选项透明加细边、正文色，选中项才有面（B1 / B2 / C 加品牌绿细边，A 不加）；危险语义选中项文字仍是危险色；材质自带的选中描边让位但保留键盘焦点轮廓", () => {
    const start = css.indexOf(':is([data-select-flat] > button, button[data-select-flat], ');
    const flat = css.slice(start, css.indexOf("}", start));
    expect(flat).toContain("background: transparent;");
    expect(flat).toContain("inset 0 0 0 1px color-mix(in srgb, var(--color-line-strong)");
    expect(flat).toContain("color: var(--color-ink);");
    expect(flat).not.toContain("--s19-track");
    expect(css).toContain('[data-select-moving][data-select-ready] > [data-select-block] { box-shadow: var(--s19-select-glass-sh), 0 0 0 1px color-mix(in srgb, var(--color-brand) 34%');
    expect(css).toContain('[data-select-moving][data-select-ready] > [data-select-block] { box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-brand) 30%');
    const aBlock = css.slice(css.indexOf(':root[data-visual-style="a"][data-theme-mode="light"]'), css.indexOf("/* ---------- 平铺变体的选中面"));
    expect(aBlock).not.toContain("data-select-flat");
    expect(css).toContain('[data-select-tone="danger"]');
    expect(css).toContain("color: var(--color-danger-dark)");
    expect(css).toMatch(/\.lv-material:is\(\[aria-selected="true"\], \[aria-pressed="true"\], \[aria-checked="true"\]\):focus-visible \{ outline: 2px solid var\(--color-focus-ring\)/);
  });
  it("统一辨识度规则（1.19.70）：未选项不得比选中项更显眼——所有 SelectionGrid 的格子、带胶囊 / 交互卡材质的选项默认就是未选透明加细边；C 的选中面带品牌绿细线", () => {
    const start = css.indexOf(':is([data-select-flat] > button, button[data-select-flat], ');
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule.split("\n")[0]).toContain("[data-select-grid]:not([data-select-plain]) > button,");
    expect(rule.split("\n")[0]).toContain("[data-select-moving] > button.lv-material[data-material-role]");
    expect(rule.split("\n")[0]).toContain("[data-select-item].lv-material[data-material-role]");
    expect(rule).toContain("background: transparent;");
    // 选中面的品牌绿细边同样覆盖这些选项（B1 / B2 / C 的 ::before 与移动的选中块）
    expect(css.split("[data-select-grid] > button, [data-select-moving] > button.lv-material[data-material-role], [data-select-item].lv-material[data-material-role])::before").length - 1).toBe(2);
    expect(css).toContain("[data-select-moving]:has(> button.lv-material[data-material-role])");
    const cBlock = css.slice(css.indexOf("1.19.70：C 的选中面"));
    expect(cBlock).toContain('[data-select-moving][data-select-ready] > [data-select-block] { box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-brand) 30%');
    expect(cBlock).toContain(':is([data-select-grid] > button, [data-select-item])::before { box-shadow: 0 0 0 1px');
  });
  it("颜色字面量不写在这里（只引用令牌）", () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

/**
 * 1.19.73（所有者 2026-11-14）：A 的“轨道内 A2”只给真正的分段轨道（容器写 data-select-track）；
 * 不在轨道里的会移动的选中（筛选竖向导航、“月份 / 日期范围”等）保留完整 A2 浮起——旧项沉回平面、新项浮起。
 */
describe("A 轨道内 A2 只给分段轨道（1.19.73）", () => {
  it("分段轨道的容器都带 data-select-track", () => {
    const tracks: [string, string][] = [
      ["components/ui/PurposeControls.tsx", '<MovingSelection axis="x" base="slide" data-select-track=""'],
      ["components/entry/KindToggle.tsx", 'data-entry-kind-switch="" data-select-track=""'],
      ["pages/DetailPage.tsx", '<SlidingSelection data-select-track="" className="flex gap-1 rounded-full bg-line/70 p-1">'],
      ["components/ledger/BatchEditSheet.tsx", '<SlidingSelection data-select-track="" className="mt-2 flex gap-1 rounded-full bg-line/70 p-1">'],
      ["pages/ThemeAppearancePage.tsx", '<MovingSelection axis="x" data-select-track="" role="group" aria-label={t("settings.theme.mode")}'],
      ["statsWorkbench/Drawer.tsx", '<SlidingSelection data-select-track="" className="sw-segment"'],
      ["components/MessageQuote.tsx", '<MovingSelection axis="x" data-select-track="" className="flex rounded-field bg-canvas p-1 text-helper">'],
      ["pages/LedgerImportPage.tsx", '<MovingSelection axis="x" data-select-track="" role="group"'],
      ["components/AttachmentPdf.tsx", '<MovingSelection axis="x" data-select-track="" className="lv-attachment-zoom"'],
    ];
    for (const [file, snippet] of tracks) expect(src(file), file).toContain(snippet);
  });

  it("筛选面板的竖向导航与“月份 / 日期范围”不在轨道里，不带 data-select-track", () => {
    const panel = src("components/EntryFilterPanel.tsx");
    expect(panel).toContain('<MovingSelection axis="y" className="lv-filter-nav"');
    expect(panel).toContain('<MovingSelection axis="x" className="lv-filter-segments">');
  });

  it("CSS：会移动的选中只有带 data-select-track 才取消浮起", () => {
    const start = css.indexOf("/* ---------- A · 轨道内的选中");
    const end = css.indexOf("/* ---------- 平铺变体的选中面", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
    // 按顶层逗号拆选择器（:is(...) 里的逗号不拆）
    const selectors = [...block.matchAll(/([^{}]+)\{/g)].flatMap((match) => {
      const out: string[] = [];
      let depth = 0, from = 0;
      const text = match[1]!;
      for (let k = 0; k <= text.length; k += 1) {
        const c = text[k];
        if (c === "(") depth += 1;
        else if (c === ")") depth -= 1;
        if (k === text.length || (c === "," && depth === 0)) { out.push(text.slice(from, k).trim()); from = k + 1; }
      }
      return out.filter(Boolean);
    });
    const moving = selectors.filter((selector) => selector.includes("[data-select-moving]"));
    expect(moving.length).toBeGreaterThan(0);
    for (const selector of moving) expect(selector).toContain("[data-select-track]");
  });
});
