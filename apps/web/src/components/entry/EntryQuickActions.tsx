import type { Currency } from "@libellum/shared";

import { minorToInput } from "../../lib/format.js";

/**
 * 金额下面那一行紧凑快捷操作：左边「沿用上一笔」，右边「快捷金额」。
 *
 * ⚠️ **Why this row exists** (S15-C 第二轮). 五个快捷金额按钮常驻在金额框下方，占一整行；
 * 而它们不是每笔都用——**一笔账最常见的动作是输金额、选分类、保存**。收起来只留一个入口，
 * 首屏少一行，金额与分类之间不再隔着一排可以忽略的胶囊。
 *
 * ⚠️ **「沿用上一笔」不是「复制这一笔」。** 复制是从明细页带着金额/备注/标签进来的一整笔；
 * 沿用只取分类、支付方式、币种、标签，金额与时间始终是读者自己的。两个入口同时存在，
 * 谁也不会顶替谁。
 *
 * 展开状态由页面持有（`open` / `onToggle`），与 `EntryMoreOptions` 相同的受控做法：
 * 「再记一笔」能把这一行重新收起，没有 DOM 的测试也能分别渲染收起与展开两种状态。
 */
export function EntryQuickActions({
  amounts,
  currency,
  open,
  onToggle,
  onPickAmount,
  onInherit,
  notice,
}: {
  readonly amounts: readonly number[];
  readonly currency: Currency;
  readonly open: boolean;
  readonly onToggle: () => void;
  /** 收到的是分值，填入输入框的文本仍由页面按币种格式化。 */
  readonly onPickAmount: (cents: number) => void;
  readonly onInherit: () => void;
  /** 沿用成功或失败的一句短提示；null 表示还没有点过。 */
  readonly notice: string | null;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 pt-3">
      {/* 一行两个入口：360px 上是「沿用上一笔」+「快捷金额 ⌄」，两边都装得下。 */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onInherit}
          className="shrink-0 rounded-full border border-brand-soft bg-brand-soft px-3 py-1 text-body text-brand-dark transition hover:border-brand"
        >
          沿用上一笔
        </button>

        <button
          type="button"
          aria-expanded={open}
          aria-controls="entry-quick-amounts"
          onClick={onToggle}
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-body text-muted transition hover:text-brand-dark"
        >
          快捷金额
          <span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
        </button>
      </div>

      {/*
        ⚠️ **取值与点击逻辑一个字没改**：仍是 `quickAmounts` 里的那五个分值，
        仍是 `minorToInput` 转成输入框里的文本（`useQuickAmounts` 决定是哪五个）。
        这里只控制可见性，不做动画，也不新增状态。
      */}
      {open ? (
        <div id="entry-quick-amounts" className="flex flex-wrap gap-2">
          {amounts.map((cents) => (
            <button
              key={cents}
              type="button"
              onClick={() => {
                onPickAmount(cents);
              }}
              className="rounded-full border border-brand-soft bg-brand-soft px-3.5 py-1.5 text-body text-brand-dark transition hover:border-brand"
            >
              {minorToInput(cents, currency)}
            </button>
          ))}
        </div>
      ) : null}

      {/* 提示放在这一行下面：点了「沿用上一笔」，结果或原因都该在原地出现。 */}
      {notice !== null ? (
        <p role="status" className="text-helper-relaxed text-muted">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
