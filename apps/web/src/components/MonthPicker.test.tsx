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

  it("offers「全部」only where it is allowed, and marks it as the selection", () => {
    expect(render()).not.toContain(">全部<");

    const all = renderToStaticMarkup(
      <MonthPicker open month="all" maxMonth="2026-10" allowAll onSelect={() => undefined} onClose={() => undefined} />,
    );
    const button = all.slice(all.lastIndexOf("<button", all.indexOf(">全部<")), all.indexOf(">全部<"));
    expect(button).toContain('aria-pressed="true"');
    // 选了「全部」时没有哪个月份是选中的，年份显示当前年。
    expect(all.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(all).toContain("2026 年");
  });

  it("still disables the months after the last allowed one", () => {
    const html = render();
    const november = html.slice(html.lastIndexOf("<button", html.indexOf(">11 月<")), html.indexOf(">11 月<"));

    expect(november).toContain('disabled=""');
  });

  it("空月置灰并禁用，未知月份保持可选", () => {
    const html = renderToStaticMarkup(<MonthPicker open month="2026-03" maxMonth="2026-10" availability={{ "2026-03": false, "2026-04": true }} onSelect={() => undefined} onClose={() => undefined} />);
    const button = (label: string) => html.slice(html.lastIndexOf("<button", html.indexOf(`>${label}<`)), html.indexOf(`>${label}<`));
    expect(button("3 月")).toContain('disabled=""');
    expect(button("3 月")).toContain("text-muted/40");
    expect(button("3 月")).not.toContain("bg-brand text-on-brand");
    expect(button("4 月")).not.toContain('disabled=""');
    expect(button("5 月")).not.toContain('disabled=""');
  });

  it("等待检查时禁用未知月份，但保留已知有账月份", () => {
    const html = renderToStaticMarkup(<MonthPicker open month="2026-03" maxMonth="2026-10" loading availability={{ "2026-04": true }} onSelect={() => undefined} onClose={() => undefined} />);
    const button = (label: string) => html.slice(html.lastIndexOf("<button", html.indexOf(`>${label}<`)), html.indexOf(`>${label}<`));
    expect(button("3 月")).toContain('disabled=""');
    expect(button("4 月")).not.toContain('disabled=""');
  });
});
