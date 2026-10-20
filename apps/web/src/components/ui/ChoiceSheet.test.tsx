import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChoiceSheet, type ChoiceSheetOption } from "./ChoiceSheet.js";

/**
 * 通用底部选择面板。本文件测"打开后的结构"——本仓库没有 jsdom，点击与 Escape 只能靠
 * 受控渲染 + 源码断言覆盖（与 `AddEntryPage.test.tsx`、`backNavigation.test.ts` 同一做法）。
 */
const options: readonly ChoiceSheetOption<string>[] = [
  { value: "cny", label: "人民币", trailing: "CNY" },
  { value: "usd", label: "美元", trailing: "USD" },
  { value: "jpy", label: "日元", hint: "这个账本暂不支持", disabled: true },
];

function renderSheet(open: boolean, value = "cny"): string {
  return renderToStaticMarkup(
    <ChoiceSheet
      open={open}
      title="选择币种"
      options={options}
      value={value}
      onSelect={() => undefined}
      onClose={() => undefined}
    />,
  );
}

/** 含某段文字的 `<button>` 开标签。 */
function optionTag(html: string, label: string): string {
  const index = html.indexOf(label);
  const open = html.lastIndexOf("<button", index);

  return html.slice(open, html.indexOf(">", open) + 1);
}

describe("ChoiceSheet", () => {
  it("关闭时什么都不渲染，打开时不会留下一个空壳", () => {
    expect(renderSheet(false)).toBe("");
    expect(renderSheet(true)).not.toBe("");
  });

  it("是固定定位的 dialog + listbox，高度有上限且列表自己滚动", () => {
    const html = renderSheet(true);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="选择币种"');
    expect(html).toContain('role="listbox"');
    // 遮罩与面板都在 z-50 以下/之上，父容器的 overflow 裁不到它们。
    expect(html).toContain("fixed inset-0 z-40");
    expect(html).toContain("fixed inset-x-0 bottom-0 z-50");
    expect(html).toContain("max-h-[calc(100dvh-24px)]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overscroll-contain");
    expect(html).toContain("rounded-t-sheet");
    expect(html).toContain("pb-[env(safe-area-inset-bottom,0px)]");
  });

  it("列出全部选项，当前项选中，禁用项保留但不能点", () => {
    const html = renderSheet(true);

    expect((html.match(/role="option"/g) ?? []).length).toBe(options.length);
    expect(optionTag(html, "人民币")).toContain('aria-selected="true"');
    expect(optionTag(html, "美元")).toContain('aria-selected="false"');
    expect(optionTag(html, "日元")).toContain("disabled");
    // 禁用原因写在这一项里，而不是只靠颜色。
    expect(html).toContain("这个账本暂不支持");
  });

  it("选中项随传入的 value 改变，组件自己不记状态", () => {
    expect(optionTag(renderSheet(true, "usd"), "美元")).toContain('aria-selected="true"');
    expect(optionTag(renderSheet(true, "usd"), "人民币")).toContain('aria-selected="false"');
  });

  it("点选一项会回调页面并关闭；Escape 与遮罩走同一个 onClose（源码）", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./ChoiceSheet.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("onSelect(option.value);");
    expect(source).toContain("onClose();");
    expect(source).toContain("closeRef.current();");
    expect(source).toContain("onKeyDown={moveFocus}");
    // 打开时把焦点放到当前项，关闭时还给打开它的控件。
    expect(source).toContain('querySelector<HTMLButtonElement>(');
    expect(source).toContain("previous?.focus();");
  });
});
