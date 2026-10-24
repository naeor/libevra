import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeAppearanceView } from "./ThemeAppearancePage.js";

/**
 * The appearance page is the only place where a theme is chosen.
 *
 * These are static-markup checks because this repository deliberately has no
 * DOM test environment. They verify the pieces that would otherwise be easy to
 * regress while moving the page around: both previews are present and use the
 * real semantic classes, all seven palette buttons exist, and the mode group
 * still reflects the saved preference.
 */
function render(preference: { mode: "system" | "light" | "dark"; palette: "green" | "yellow" | "orange" | "blue" | "purple" | "red" | "cyan" }): string {
  return renderToStaticMarkup(
    <ThemeAppearanceView preference={preference} onChoose={() => undefined} />,
  );
}

describe("外观设置页", () => {
  it("同时显示账本空间和明细页预览，并使用真实主题 token", () => {
    const html = render({ mode: "dark", palette: "green" });
    expect(html).toContain('aria-label="账本空间起始页预览"');
    expect(html).toContain('aria-label="明细页面预览"');
    expect(html).toContain('fill="var(--color-ocean-1)"');
    expect(html).toContain('fill="var(--preview-header)"');
    expect(html).toContain('fill="var(--preview-summary)"');
    expect(html).toContain('fill="var(--color-surface)"');
  });

  it("保留三种外观模式，并反映当前选择", () => {
    const html = render({ mode: "system", palette: "green" });
    expect(html.match(/aria-label="外观模式"/g)).toHaveLength(1);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("跟随系统");
    expect(html).toContain("浅色");
    expect(html).toContain("深色");
  });

  it("七个主题色都在，选中项有可访问名称和清晰选中状态", () => {
    const html = render({ mode: "light", palette: "yellow" });
    expect(html.match(/data-theme-palette=/g)).toHaveLength(7);
    for (const label of ["森林绿", "蜜金黄", "暖木棕", "雾霭蓝", "烟霞紫", "丹霞红", "青瓷灰"]) {
      expect(html).toContain(`切换到${label}`);
    }
    expect(html).toContain("蜜金黄");
    expect(html).toContain("ring-2 ring-brand-dark");
    expect(html).toContain("theme-swatch block size-6 rounded-full bg-brand");
  });

  it("微缩图不引入可操作的样例控件，页面仅有三模式与七色按钮", () => {
    const html = render({ mode: "light", palette: "green" });
    expect(html.match(/<button /g)).toHaveLength(10);
    expect(html.match(/role="img"/g)).toHaveLength(2);
  });
});
