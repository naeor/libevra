import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AmountField } from "./AmountField.js";

/**
 * 金额输入卡（S15-C 第四轮 + 2026-10-21 所有者确认）。
 *
 * 本仓库测试没有 DOM，点击与真实聚焦无法断言；这里覆盖三件可以用渲染证明的事：
 *
 * 1. **金额是 30px**（规范 §13.5 的金额专用 size），且因为 `index.css` 未分层的
 *    `input{font-size:16px}` 仍在，必须写成 `text-3xl!` 越过它；不得回退到 36px。
 * 2. **焦点态画在整张卡上、只认金额输入框**（`has-[input:focus-visible]` 的 brand-soft ring），
 *    而不是 `focus-within`——否则点右侧 CNY 按钮也会让整张卡亮起来。
 * 3. **两个点击区域独立**：输入框与币种按钮是兄弟节点，没有包在同一个 `<label>` 里；
 *    币种按钮是 `type="button"`、带 `aria-haspopup="dialog"`，不会提交表单或把焦点交给金额。
 */
function render(): string {
  return renderToStaticMarkup(
    <AmountField
      amountText="12.50"
      currency="CNY"
      currencyOpen={false}
      inputRef={{ current: null }}
      onAmountChange={() => undefined}
      onOpenCurrency={() => undefined}
    />,
  );
}

describe("AmountField", () => {
  it("金额 30px（text-3xl!），没有 36px（text-4xl）残留", () => {
    const html = render();
    const input = /<input[^>]*aria-label="金额"[^>]*>/.exec(html)?.[0] ?? "";

    expect(input).toContain("text-3xl!");
    expect(input).not.toContain("text-4xl");
    // 金额仍是主视觉：符号 24px（text-2xl）；输入本身 semibold。
    expect(html).toContain("text-2xl text-brand-dark");
    expect(input).toContain("font-semibold");
  });

  it("焦点态用 brand-soft ring 画在卡上，且只认金额输入框（不是 focus-within）", () => {
    const html = render();
    const card = /<div[^>]*data-entry-amount="card"[^>]*>/.exec(html)?.[0] ?? "";

    expect(card).toContain("has-[input:focus-visible]:ring-4");
    expect(card).toContain("has-[input:focus-visible]:ring-brand-soft");
    // focus-within 会被右侧币种按钮的聚焦触发，不能用于金额焦点态。
    expect(card).not.toContain("focus-within:ring");
    // ring 走 box-shadow，不改边框宽度：聚焦不会让卡或文字跳动。
    expect(card).toContain("border-2 border-brand");
  });

  it("金额与币种是两个独立点击区：不共用 label，币种按钮不提交表单", () => {
    const html = render();
    const card = /<div[^>]*data-entry-amount="card"[^>]*>([\s\S]*)<\/div>$/.exec(html)?.[1] ?? "";

    // 卡内没有 <label> 包裹，两个控件是并列兄弟，点币种不会触发 label 的“聚焦输入框”。
    expect(card).not.toContain("<label");
    expect(card).toContain('aria-label="金额"');

    const currencyButton = /<button[^>]*>/.exec(card)?.[0] ?? "";
    expect(currencyButton).toContain('type="button"');
    expect(currencyButton).toContain('aria-haspopup="dialog"');
    // 币种按钮自带展开状态，且用统一的 Chevron（不是字符画）。
    expect(currencyButton).toContain('aria-expanded="false"');
    expect(card).toContain('data-chevron="down"');
  });
});
