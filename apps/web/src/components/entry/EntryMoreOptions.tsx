import {
  MAX_TAGS_PER_TRANSACTION,
  type PaymentMethod,
  type Tag,
} from "@libellum/shared";

import { ChevronIcon } from "../Icons.js";
import { tagFillStyle } from "../../lib/tagColors.js";

/**
 * 备注、支付方式与标签：手动记账页的低频扩展区。
 *
 * ⚠️ **为什么把这几项收起来**（S15-C）。他们是「记完之后顺手补一句」的字段，不是每笔都要填；
 * 之前它们占着保存按钮上方的两整段、约 170px，把最常见的「输金额 → 选分类 → 保存」推到了
 * 两次滑动之外。收进一行「更多选项」后，首屏只留高频字段，但**能力一点没少**：
 * 展开后备注仍是同一个输入框（200 字上限）、标签仍是同一组按钮（10 个上限）、
 * 支付方式仍是同一组胶囊（归档过滤与默认值由页面决定），选中颜色与按钮文字完全沿用原实现。
 *
 * ⚠️ **支付方式在这一轮搬进来了，但它和账户不是一回事.** 支付方式只是「这笔钱用什么付的」
 * （微信/支付宝/银行卡/现金/其他，或用户自建），账本里没有账户实体，两者不能合并、
 * 也不能互相顶替。
 *
 * ⚠️ **收起时那一行是一份摘要，不是折叠状态的开关说明**（S15-C 第三轮引入，第四轮改成混排）：
 * 三项**永远都在**，已填的那一项显示它的值（支付方式名 / 「有备注」/「2 个标签」），
 * 未填的那一项显示灰色字段名（「备注」/「标签」）作为提示。所有者要的就是这种混排：
 * 选了支付宝、其余没填时是「支付宝 · 备注 · 标签」，一眼看出"已经有什么、还能补什么"；
 * 不再像第三轮那样把未填项整段藏起来（只剩「支付宝」，看不出这里还能填什么），
 * 也不再像更早那样把真实值与空字段名混成一句（「支付宝、备注、标签」读起来像后两项也有值）。
 * **已填是正文色，未填是 muted，分隔符 muted**，颜色本身就是"哪些已经填了"。
 *
 * 摘要由传入的值算出（`moreOptionsSummary`），组件自己不记状态——
 * 展开与否由页面持有（`open` / `onToggle`），这样「再记一笔」可以把面板重新收起，
 * 备注、标签与支付方式的值仍由页面管理。做成受控组件还有一个好处：没有 DOM 的测试环境
 * （本仓库没有 jsdom）也能用 `open={false}` / `open={true}` 分别渲染，断言收起时字段不在、
 * 展开后字段齐全。
 */
export function EntryMoreOptions({
  open,
  onToggle,
  paymentMethods,
  paymentMethodId,
  onPaymentMethodChange,
  note,
  onNoteChange,
  tags,
  selectedTagIds,
  onToggleTag,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** 已按归档规则过滤过；顺序也是页面给的顺序。 */
  readonly paymentMethods: readonly PaymentMethod[];
  readonly paymentMethodId: string | null;
  /** 再点一次已选中的那一项就取消，与页面原来的行为一致。 */
  readonly onPaymentMethodChange: (paymentMethodId: string | null) => void;
  readonly note: string;
  readonly onNoteChange: (value: string) => void;
  readonly tags: readonly Tag[];
  readonly selectedTagIds: readonly string[];
  readonly onToggleTag: (tagId: string) => void;
}): React.JSX.Element {
  const paymentMethodName =
    paymentMethods.find((method) => method.id === paymentMethodId)?.name ?? null;
  const summary = moreOptionsSummary({
    paymentMethodName,
    note,
    tagCount: selectedTagIds.length,
  });

  return (
    <section className="flex flex-col gap-2 px-6 pt-5">
      <div className="overflow-hidden rounded-field border border-line bg-surface">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="entry-more-options"
          onClick={onToggle}
          className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-canvas"
        >
          <span className="shrink-0 text-button-lg text-ink">更多选项</span>
          <span className="flex min-w-0 items-center gap-1.5">
            {/*
              ⚠️ **摘要在 360px 上必须能被截断。** `min-w-0` + `truncate` 让这一段收缩，
              「更多选项」与箭头两个 `shrink-0` 保证不被挤没；自定义一个长名字的支付方式
              也不会把行撑破。三段都是行内元素，省略号落在整句末尾，
              **「支付方式」这一项永远排在前面**，窄屏先丢的是后面的提示。
            */}
            <span data-entry-more-summary className="min-w-0 truncate text-helper">
              {summary.map((part, index) => (
                <span key={part.slot}>
                  {index > 0 ? <span className="text-muted"> · </span> : null}
                  <span className={part.filled ? "text-ink" : "text-muted"}>{part.text}</span>
                </span>
              ))}
            </span>
            <ChevronIcon up={open} className="text-muted" />
          </span>
        </button>

        {open ? (
          <div
            id="entry-more-options"
            className="flex flex-col gap-4 border-t border-line px-4 py-4"
          >
            <div className="flex flex-col gap-2">
              <h3 className="text-card-title text-ink">支付方式</h3>
              <div className="flex flex-wrap gap-2">
                {paymentMethods.map((method) => (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => {
                      onPaymentMethodChange(method.id === paymentMethodId ? null : method.id);
                    }}
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      method.id === paymentMethodId
                        ? "bg-brand text-on-brand"
                        : "bg-surface text-ink hover:bg-brand-soft"
                    }`}
                  >
                    {method.name}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-2">
              <span className="text-card-title text-ink">备注</span>
              <input
                aria-label="备注"
                value={note}
                onChange={(event) => {
                  onNoteChange(event.target.value);
                }}
                maxLength={200}
                placeholder="可不填"
                className="rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none placeholder:text-muted/80 focus:border-brand focus:ring-4 focus:ring-focus-ring"
              />
            </label>

            {tags.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-card-title text-ink">
                  标签（最多 {String(MAX_TAGS_PER_TRANSACTION)} 个，已选 {String(selectedTagIds.length)}{" "}
                  个）
                </h3>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const selected = selectedTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => {
                          onToggleTag(tag.id);
                        }}
                        style={
                          selected
                            ? tagFillStyle(tag.color)
                            : undefined
                        }
                        className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                          selected
                            ? "text-on-tag"
                            : "border-line bg-surface text-ink hover:bg-brand-soft"
                        }`}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * 收起那一行右侧的摘要，**已填值与未填提示混排**（所有者指定的规则，S15-C 第四轮）。
 *
 * | 状态 | 摘要 |
 * |---|---|
 * | 只选了支付宝 | `支付宝 · 备注 · 标签` |
 * | 支付宝 + 备注 | `支付宝 · 有备注 · 标签` |
 * | 支付宝 + 2 个标签 | `支付宝 · 备注 · 2 个标签` |
 * | 三项都有 | `支付宝 · 有备注 · 2 个标签` |
 * | 只有默认支付方式「其他」 | `其他 · 备注 · 标签` |
 *
 * ⚠️ **三个槽位永远在，顺序永远是 支付方式 → 备注 → 标签。** 未填的槽位用字段名当提示，
 * 已填的槽位用值；调用方按 `filled` 上色（已填 `text-ink`、未填 `text-muted`），
 * 所以"哪些已经填了"由颜色和文字共同表达，不需要再写一句"可填"。
 *
 * ⚠️ **返回结构而不是拼好的字符串。** 上色要求在同一个句子里混两种颜色；如果这里 `join`
 * 成一个字符串，组件就只能整体染成一种颜色，或者再按字符串切一遍——两处都会慢慢和规则
 * 对不上。返回 `{ slot, text, filled }[]` 让"哪一段是什么状态"只有一个来源。
 * 纯函数、无 React，四种组合可以在没有 DOM 的测试里直接断言。
 */
export interface MoreOptionsSummaryPart {
  /** 固定槽位，用作 React key，也用来断言顺序。 */
  readonly slot: "payment" | "note" | "tags";
  /** 已填时是实际值（支付方式名 / 有备注 / N 个标签），未填时是字段名提示。 */
  readonly text: string;
  /** 这一项是否有值：决定正文色还是 muted。 */
  readonly filled: boolean;
}

export function moreOptionsSummary({
  paymentMethodName,
  note,
  tagCount,
}: {
  readonly paymentMethodName: string | null;
  readonly note: string;
  readonly tagCount: number;
}): readonly MoreOptionsSummaryPart[] {
  const paymentName = paymentMethodName?.trim() ?? "";
  const hasNote = note.trim() !== "";

  return [
    {
      slot: "payment",
      // 默认支付方式（如「其他」）也是实际值，显示它的名字，不退化成字段名。
      text: paymentName === "" ? "支付方式" : paymentName,
      filled: paymentName !== "",
    },
    {
      slot: "note",
      text: hasNote ? "有备注" : "备注",
      filled: hasNote,
    },
    {
      slot: "tags",
      text: tagCount > 0 ? `${String(tagCount)} 个标签` : "标签",
      filled: tagCount > 0,
    },
  ];
}
