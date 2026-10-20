import type { Currency } from "@libellum/shared";
import type { RefObject } from "react";

import { amountPlaceholder, currencyName, currencySymbol } from "../../lib/format.js";
import { ChevronIcon } from "../Icons.js";

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
 *
 * ⚠️ **S15-C 第四轮：金额的 36px 必须写成 `text-4xl!`，而且这不是样式偏好。**
 * `index.css` 有一条**不带 layer** 的 `input, select, textarea { font-size: 16px }`
 * （防 iOS 聚焦缩放整页），而 Tailwind 的 `text-4xl` 在 `@layer utilities` 里。
 * CSS 层叠顺序里**未分层的普通声明胜过任何分层的普通声明**，与选择器特异性无关：
 * 这条卡上的 `text-4xl` 被压回 16px（headless Chrome 实测修复前 computed
 * `font-size: 16px / line-height: 17.78px`）。于是金额比左边的 `¥`（24px）还小、
 * 与右边的 `CNY` 同大——**这不是"字号差一点"，是"金额不再是主视觉"**，也是符号
 * 看起来飘、币种看起来陷的直接原因。`!` 让这条工具类成为 important 声明，按层叠
 * 规则胜过那条未分层的普通声明；**`index.css` 不动**（它是全局的，改它会影响全站
 * 所有输入框；那条规则真正该做的是放进 `@layer base`，属于全站审计范围）。
 *
 * ⚠️ **四种字号排在一行，垂直对齐用 `items-center`，不再用 `items-baseline`。**
 * 基线对齐只对"同一段文字"成立：36px 的数字、24px 的符号、16px 的币种代码、14px 的箭头
 * 共用一条基线时，小字号会吊在基线附近、大字号的重心则高得多，视觉上就是"飘/陷"。
 * 居中让每个元素的行盒在同一中线上，金额仍是最大的那个，符号与币种成为它的两侧。
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
      className="flex items-center gap-2 rounded-card border-2 border-brand bg-surface px-4 py-4 shadow-sm"
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
        className="min-w-0 flex-1 bg-transparent text-4xl! font-semibold text-ink outline-none placeholder:text-muted/80"
      />

      {/*
        ⚠️ **`type="button"`，否则它在表单里就是第二个提交按钮。**
        品牌绿 + 下拉箭头是所有者要的"这是一个可以点开的入口"，而不是一段说明文字。
        `min-h-11` 让 44px 的触控高度成立；`items-center` 让币种代码与箭头的中线一致，
        不再靠基线把 16px 的文字挂在 36px 数字的脚下。
      */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={currencyOpen}
        aria-label={`币种：${currencyName(currency)}（${currency}），点按切换`}
        onClick={onOpenCurrency}
        className="-mr-1 flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-2 py-2 text-base font-medium text-brand-dark outline-none transition hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span className="tabular-nums">{currency}</span>
        <ChevronIcon up={currencyOpen} className="text-brand-dark/80" />
      </button>
    </div>
  );
}
