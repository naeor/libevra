import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeAppearanceView } from "./ThemeAppearancePage.js";

/** 正式选项与按需预览的静态结构；交互及真实材质另由打包后的浏览器矩阵验证。 */
function render(preference: { mode: "system" | "light" | "dark"; palette: "green" | "yellow" | "orange" | "blue" | "purple" | "red" | "cyan" }): string {
  return renderToStaticMarkup(
    <ThemeAppearanceView preference={preference} onChoose={() => undefined} />,
  );
}

describe("外观设置页", () => {
  it("大预览按需打开，正式界面仅提供四个风格", () => {
    const html = render({ mode: "dark", palette: "green" });
    expect(html).toContain(">预览</button>");
    expect(html).not.toContain('aria-label="账本空间起始页预览"');
    expect(html).not.toContain("Original");
    expect(html).not.toContain("（测试）");
    for (const name of ["经典简约", "柔和空间", "细腻瓷面", "层叠玻璃"]) expect(html).toContain(name);
    expect(html.indexOf("经典简约")).toBeLessThan(html.indexOf("柔和空间"));
  });

  it("保留三种外观模式，并反映当前选择", () => {
    const html = render({ mode: "system", palette: "green" });
    expect(html.match(/aria-label="明暗"/g)).toHaveLength(1);
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

});
