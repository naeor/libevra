import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InlineChoice, type InlineChoiceOption } from "./InlineChoice.js";

/**
 * 通用内嵌选择器（紧贴字段下方展开，`/add` 分类选择器的形态）。
 *
 * 本仓库没有 DOM：打开/收起两种结构用受控渲染断言，点击、Escape、焦点归还用源码断言
 * ——与 `ChoiceSheet.test.tsx`、`backNavigation.test.ts` 同一做法。
 */
const options: readonly InlineChoiceOption[] = [
  { id: "book-a", label: "正式账本 · 甲" },
  { id: "book-b", label: "正式账本 · 乙" },
  { id: "book-c", label: "正式账本 · 丙", hint: "就是来源账本，不能选", disabled: true },
];

function render(open: boolean, value = "book-a", list: readonly InlineChoiceOption[] = options): string {
  return renderToStaticMarkup(
    <InlineChoice
      label="来源账本 B"
      value={value}
      options={list}
      open={open}
      onToggle={() => undefined}
      onSelect={() => undefined}
      onClose={() => undefined}
    />,
  );
}

/** 含某段文字的 `<button>` 开标签（从列表开始找，触发按钮的 aria-label 里也有同样的账本名）。 */
function optionTag(html: string, label: string): string {
  const index = html.indexOf(label, html.indexOf('role="listbox"'));
  const open = html.lastIndexOf("<button", index);

  return html.slice(open, html.indexOf(">", open) + 1);
}

describe("InlineChoice", () => {
  it("收起时只显示当前值，不渲染列表", () => {
    const html = render(false);

    expect(html).toContain("正式账本 · 甲");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="option"');
    // 收起时没有可以指向的列表，就不该留一个悬空的 aria-controls。
    expect(html).not.toContain("aria-controls");
  });

  it("展开后紧贴字段下方列出全部选项，当前项选中，禁用项保留但不可选", () => {
    const html = render(true);

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="来源账本 B"');
    expect((html.match(/role="option"/g) ?? []).length).toBe(options.length);

    expect(optionTag(html, "正式账本 · 甲")).toContain('aria-selected="true"');
    expect(optionTag(html, "正式账本 · 乙")).toContain('aria-selected="false"');
    expect(optionTag(html, "正式账本 · 丙")).toContain("disabled");
    // 禁用原因写在这一项里，而不是只靠颜色。
    expect(html).toContain("就是来源账本，不能选");
  });

  it("是正常流里的内嵌列表：有高度上限并自己滚动，不用 fixed/absolute 脱离布局", () => {
    const html = render(true);

    expect(html).toContain("max-h-64");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overscroll-contain");
    expect(html).toContain("overflow-hidden rounded-field");
    // ⚠️ 绝对定位/固定定位会被父容器的 overflow 裁掉，也不该出现。
    expect(html).not.toContain("absolute");
    expect(html).not.toContain("fixed");
  });

  it("没有匹配的选项时显示占位文字；空列表也不崩", () => {
    expect(render(false, "gone")).toContain("未选择");
    expect(render(true, "gone", [])).toContain('role="listbox"');
    expect(render(true, "gone", [])).not.toContain('role="option"');
    expect(render(true, "gone", [])).toContain("未选择");
  });

  it("箭头复用统一的 ChevronIcon：收起向下、展开旋转 180°，不退回字符画", () => {
    // 渲染层：同一个 SVG 图标出现，两种状态靠 data-chevron 区分（不是两个字符）。
    expect(render(false)).toContain('data-chevron="down"');
    expect(render(true)).toContain('data-chevron="up"');

    const source = readFileSync(
      fileURLToPath(new URL("./InlineChoice.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toContain('import { ChevronIcon } from "../Icons.js";');
    expect(source).toContain("<ChevronIcon up={open} />");
    // 与 /add 第四轮同一条规则：页面上不再出现字符箭头。
    expect(source).not.toContain("⌄");
    expect(source).not.toContain("⌃");
  });

  it("选中随传入的 value 改变，组件自己不记状态（源码 + 渲染）", () => {
    expect(optionTag(render(true, "book-b"), "正式账本 · 乙")).toContain('aria-selected="true"');
    expect(optionTag(render(true, "book-b"), "正式账本 · 甲")).toContain('aria-selected="false"');

    const source = readFileSync(
      fileURLToPath(new URL("./InlineChoice.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("onSelect(option.id);");
    expect(source).toContain("onClose();");
    expect(source).toContain('document.addEventListener("keydown", onKeyDown);');
    expect(source).toContain('document.addEventListener("pointerdown", onPointerDown);');
    // 打开时焦点进列表，关闭时还给触发按钮。
    expect(source).toContain("first?.focus();");
    expect(source).toContain('querySelector<HTMLButtonElement>("[data-inline-choice-trigger]")?.focus();');
  });
});
