import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../i18n/index.js";
import { MonthPicker } from "./MonthPicker.js";

/**
 * **S16：月份选择的文字随界面语言变化，月份本身（`YYYY-MM`）不变。**
 *
 * 中文保留原来的「1 月」「2026 年」写法；英文用 `Intl` 的月份简称。
 */
function render(): string {
  return renderToStaticMarkup(
    <MonthPicker
      open
      month="2026-03"
      maxMonth="2026-10"
      onSelect={() => undefined}
      onClose={() => undefined}
    />,
  );
}

describe("MonthPicker", () => {
  afterEach(() => {
    applyLocale("zh-CN");
  });

  it("keeps the Chinese month and year wording", () => {
    const html = render();

    expect(html).toContain("2026 年");
    expect(html).toContain(">1 月<");
    expect(html).toContain(">12 月<");
    expect(html).toContain("回到本月");
    expect(html).toContain('aria-label="上一年"');
  });

  it("uses English month names and no Chinese in English", () => {
    applyLocale("en-US");
    const html = render();

    expect(html).not.toMatch(/[㐀-鿿]/);
    expect(html).toContain(">2026<");
    expect(html).toContain(">Jan<");
    expect(html).toContain(">Dec<");
    expect(html).toContain("Back to this month");
    expect(html).toContain('aria-label="Previous year"');
  });

  it("still disables the months after the last allowed one", () => {
    const html = render();
    const november = html.slice(html.lastIndexOf("<button", html.indexOf(">11 月<")), html.indexOf(">11 月<"));

    expect(november).toContain('disabled=""');
  });
});
