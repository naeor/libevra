import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CurrencyQuickPick } from "../SettingsCard.js";
import { LanguageChoiceList } from "../../pages/LanguagePage.js";
import { ThemeAppearanceView } from "../../pages/ThemeAppearancePage.js";
import { B2PresetChoices } from "../../s19/B2GlassSection.js";
import { WallpaperChoices } from "../../s19/WallpaperSection.js";
import { B2_GLASS_DEFAULT } from "../../s19/b2Glass.js";
import { createVisualStyleController } from "../../lib/visualStyle.js";

/**
 * 选择类控件迁移的最后一批（1.19.70）：外观与设置、分析工作台、展示卡片编辑器、账本切换面板。
 * 本仓库没有 jsdom：用静态渲染检查结构 / aria / 选中值，用源码检查“迁了哪个组件、值与选择逻辑原样”。
 */
const src = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

describe("静态渲染：外观与设置的选择组，值与角色不变", () => {
  it("外观页：明暗三选一、主题色七个圆点、视觉风格四张卡片、B1 模糊三档各是一组会移动的选中，每组恰好一个 aria-pressed 为 true", () => {
    const controller = createVisualStyleController({ dataset: {} }, null, "b1");
    const html = renderToStaticMarkup(<ThemeAppearanceView preference={{ mode: "light", palette: "green" }} onChoose={() => undefined} controller={controller} />);
    expect(count(html, /data-select-moving=""/g)).toBe(4);
    expect(count(html, /data-axis="y"/g)).toBe(2);
    expect(count(html, /data-axis="x"/g)).toBe(2);
    // 默认模糊 65 不在三档（30 / 55 / 80）里，所以模糊那组没有选中档，只留“保留原值”的提示
    expect(count(html, /aria-pressed="true"/g)).toBe(3);
    expect(html).toContain('data-theme-palette="green"');
    expect(count(html, /data-select-block=""/g)).toBe(4);
  });

  it("壁纸三选一：缩略图卡片仍是 aria-pressed 按钮，容器是 group + 横向会移动的选中", () => {
    const html = renderToStaticMarkup(<WallpaperChoices selected="luminous" onChoose={() => undefined} />);
    expect(html).toContain('data-select-moving=""');
    expect(html).toContain('data-axis="x"');
    expect(html).toContain('role="group"');
    expect(count(html, /aria-pressed="true"/g)).toBe(1);
    expect(count(html, /aria-pressed="false"/g)).toBe(2);
  });

  it("B2 玻璃三档：按钮仍是 aria-pressed，竖向会移动的选中，“自定义”提示留在容器里", () => {
    const html = renderToStaticMarkup(<B2PresetChoices selection={{ ...B2_GLASS_DEFAULT, mode: "custom" }} onChoose={() => undefined} />);
    expect(html).toContain('data-axis="y"');
    expect(count(html, /aria-pressed="false"/g)).toBe(3);
    expect(html).toContain('role="status"');
  });

  it("默认货币：六个胶囊是网格选中里的 aria-pressed 按钮，保存中仍是真 disabled", () => {
    const value = { current: "USD", pending: false, saved: false, error: null, choose: () => undefined } as never;
    const html = renderToStaticMarkup(<CurrencyQuickPick value={value} />);
    expect(html).toContain('data-select-grid=""');
    expect(count(html, /data-currency=/g)).toBe(6);
    expect(count(html, /aria-pressed="true"/g)).toBe(1);
    const pending = renderToStaticMarkup(<CurrencyQuickPick value={{ ...(value as object), pending: true } as never} />);
    expect(count(pending, /disabled=""/g)).toBe(6);
  });

  it("语言：三项仍是 radio + aria-checked，容器仍是 radiogroup，现在是竖向会移动的选中", () => {
    const html = renderToStaticMarkup(<LanguageChoiceList preference="system" locale="zh-CN" onChoose={() => undefined} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('data-axis="y"');
    expect(count(html, /role="radio"/g)).toBe(3);
    expect(count(html, /aria-checked="true"/g)).toBe(1);
    expect(html).toContain('data-language-option="system"');
  });
});

describe("源码：分析工作台、展示卡片编辑器、账本行、头像迁了哪个组件，值与逻辑原样", () => {
  const cases: [string, string, string[]][] = [
    ["分析筛选面板选项行", "statsWorkbench/FilterPanel.tsx", ["<SelectionItem", 'data-select-flat=""', "clearDimension(key)", "toggle(key, option.id)", 'setTime({ kind: "preset", preset })', "onDraft({ ...draft, combined: true })", "aria-pressed={!combined && selectedCurrency === currency}"]],
    ["统计设置 合并 / 单币种", "statsWorkbench/StatsControls.tsx", ["<SelectionGrid", "onChoose({ combined: true, currency: null })", "currency === defaultCurrency ? null"]],
    ["卡片编辑器 模板 / 尺寸 / 时间方式 / 相对窗口", "statsWorkbench/CardEditor.tsx", ['<SelectionGrid data-select-flat="" className="sw-template-grid" role="radiogroup"', 'role="radio"', "aria-checked={active}", 'setChosenTemplate(id === recommended && fit.status === "ok" ? null : id)', "setChosenSize(check.size)", "setTimeMode(mode)", "setRelativeWindow(window)"]],
    ["卡片尺寸弹层", "statsWorkbench/Sheets.tsx", ['<SelectionGrid data-select-flat=""', "disabled={problem !== null}", "onPick(size);"]],
    ["展示卡片编辑器 指标", "components/ledger/DetailCardEditor.tsx", ['<SelectionItem data-select-flat="" className="dce-metric"', "disabled={onlyMain || (!added && full)}", "draft[slot].filter(x => x !== id)"]],
    ["账本切换面板 账本行", "components/BookSwitcherSheet.tsx", ["<SelectionItem", "onClick={onSelect}", "aria-pressed={selected}"]],
    ["头像", "pages/AvatarPickerPage.tsx", ['<SelectionGrid data-select-plain=""', "setSelected(id);", "aria-pressed={selected === id}", "disabled={busy}"]],
    ["外观页", "pages/AppearanceStyleSection.tsx", ['<MovingSelection axis="y" role="group" aria-label={t("settings.visualStyle.title")}', "controller?.choose(value)", "controller?.chooseBlur(value)"]],
    ["主题色", "pages/ThemeAppearancePage.tsx", ['<MovingSelection axis="x" role="group" aria-label={t("settings.theme.palette")}', "onChoose({ palette: value })"]],
  ];
  for (const [name, file, needles] of cases) {
    it(name, () => {
      const text = src(file);
      for (const needle of needles) expect(text, needle).toContain(needle);
    });
  }

  it("跳过项没有被动：日历热力图日期格、展示卡片编辑器的卡槽、标签多选、开发用风格实验区", () => {
    expect(src("components/charts/CalendarHeatmap.tsx")).not.toContain("SelectionControls");
    expect(src("components/ledger/DetailCardEditor.tsx")).toContain('className={"dce-card dce-" + id} data-selected={slot === id} aria-pressed={slot === id}');
    expect(src("components/entry/EntryMoreOptions.tsx")).toContain("tagFillStyle(tag.color)");
    expect(src("s19/VisualStyleLabSection.tsx")).not.toContain("SelectionControls");
  });
});

describe("外观：1.19.70 新增规则", () => {
  const css = readFileSync(new URL("./selection-controls.css", import.meta.url), "utf8");
  it("网格选中的规则同时认 aria-pressed 与 aria-checked（卡片编辑器的 role=radio 小组）", () => {
    expect(css).toContain('[data-select-grid] > button:is([aria-pressed="true"], [aria-checked="true"]):not(:disabled)');
    expect(css).not.toContain('[data-select-grid] > button[aria-pressed="true"]:not(:disabled)');
  });
  it("data-select-plain：未选项本来就没有底（头像），不加未选细边", () => {
    expect(css).toContain("[data-select-grid]:not([data-select-plain]) > button");
  });
  it("B1 瓷面的高光层在会移动的选中组里不画（未选项不能还是一块白瓷）", () => {
    expect(css).toContain("[data-select-moving] > button[data-material-finish]::before");
    expect(css).toContain(':root:root:root[data-visual-style="b1"]');
  });
});
