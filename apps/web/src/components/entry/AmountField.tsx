import type { Currency } from "@libellum/shared";
import type { RefObject } from "react";

import { amountPlaceholder, currencyName, currencySymbol } from "../../lib/format.js";

/**
 * 金额输入卡：左边是币种符号，中间是金额，右边是币种入口。
 *
 * ⚠️ **外面是 `<div>`，不是 `<label>`**（S15-C 第三轮）。原来的整行是一个 `<label>`，
 * 金额输入框和右侧的币种文字都在里面；一旦右侧换成按钮，点按钮会同时触发 label 的
 * "把焦点交给输入框"，两个点击区域就分不开了。现在输入框有自己的 `aria-label="金额"`，
 * **点金额就是编辑金额，点币种就是打开币种面板**，两者是并列的兄弟节点。
 *
 * ⚠️ **符号来自 `currencySymbol(currency)`，不是写死的 `¥`。** 换币种时左侧符号
 * 与右侧代码必须一起变；数值、精度与提交语义都不在这里，仍由页面用
 * `parseAmountInput` / `decimalsFor` 决定。
 */
export function AmountField({
  amountText,
  currency,
  currencyOpen,
  inputRef,
  onAmountChange,
  onOpenCurrency,
}: {
  readonly amountText: string;
  readonly currency: Currency;
  /** 币种面板是否打开，只用于按钮的 `aria-expanded`。 */
  readonly currencyOpen: boolean;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onAmountChange: (value: string) => void;
  readonly onOpenCurrency: () => void;
}): React.JSX.Element {
  return (
    <div
      data-entry-amount="card"
      className="flex items-baseline gap-2 rounded-card border-2 border-brand bg-surface px-4 py-4 shadow-sm"
    >
      <span aria-hidden="true" className="text-2xl text-brand-dark">
        {currencySymbol(currency)}
      </span>

      <input
        ref={inputRef}
        value={amountText}
        onChange={(event) => {
          onAmountChange(event.target.value);
        }}
        inputMode="decimal"
        placeholder={amountPlaceholder(currency)}
        aria-label="金额"
        autoFocus
        className="min-w-0 flex-1 bg-transparent text-4xl font-semibold text-ink outline-none placeholder:text-muted/80"
      />

      {/*
        ⚠️ **`type="button"`，否则它在表单里就是第二个提交按钮。**
        品牌绿 + 下拉箭头是所有者要的"这是一个可以点开的入口"，而不是一段说明文字。
        `px-2 py-1` 让 44px 左右的触控高度成立（与 36px 的金额文字同一基线）。
      */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={currencyOpen}
        aria-label={`币种：${currencyName(currency)}（${currency}），点按切换`}
        onClick={onOpenCurrency}
        className="-mr-1 flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2 py-2 text-base font-medium text-brand-dark outline-none transition hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span className="tabular-nums">{currency}</span>
        <span aria-hidden="true" className="text-helper text-brand-dark/80">
          ⌄
        </span>
      </button>
    </div>
  );
}
