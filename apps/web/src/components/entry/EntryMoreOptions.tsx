import {
  MAX_TAGS_PER_TRANSACTION,
  type PaymentMethod,
  type Tag,
} from "@libellum/shared";

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
 * ⚠️ **收起时那一行是一份摘要，不是折叠状态的开关说明**：「微信 · 备注 · 标签」让人不用展开
 * 就知道这笔账带了什么。摘要由传入的值算出（`moreOptionsSummary`），组件自己不记状态——
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
          {/*
            ⚠️ **摘要在 360px 上必须能被截断。** `min-w-0` + `truncate` 让这一段收缩，
            「更多选项」与箭头两个 `shrink-0` 保证不被挤没；自定义一个长名字的支付方式
            也不会把行撑破。
          */}
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-helper text-muted">{summary}</span>
            <span aria-hidden="true" className="shrink-0 text-muted">
              {open ? "⌃" : "⌄"}
            </span>
          </span>
        </button>

        {open ? (
          <div
            id="entry-more-options"
            className="flex flex-col gap-4 border-t border-line px-4 py-4"
          >
            <div className="flex flex-col gap-2">
              <h3 className="text-helper text-muted">支付方式</h3>
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
                        ? "bg-brand text-white"
                        : "bg-surface text-ink hover:bg-brand-soft"
                    }`}
                  >
                    {method.name}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-2">
              <span className="text-helper text-muted">备注</span>
              <input
                aria-label="备注"
                value={note}
                onChange={(event) => {
                  onNoteChange(event.target.value);
                }}
                maxLength={200}
                placeholder="可不填"
                className="rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none placeholder:text-muted/80 focus:border-brand focus:ring-4 focus:ring-brand-soft"
              />
            </label>

            {tags.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-helper text-muted">
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
                            ? { backgroundColor: tag.color, borderColor: tag.color }
                            : undefined
                        }
                        className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                          selected
                            ? "text-white"
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
 * 收起那一行右侧的摘要：「微信 · 备注 · 标签」。
 *
 * 顺序是**读者关心的顺序**：先说出这笔钱怎么付的（最常需要确认的一项），
 * 再是备注、标签这两个「有没有填」的标记。什么都没选时给一句兜底，
 * 而不是留白——留白会让人以为这一行坏了。
 */
export function moreOptionsSummary({
  paymentMethodName,
  note,
  tagCount,
}: {
  readonly paymentMethodName: string | null;
  readonly note: string;
  readonly tagCount: number;
}): string {
  const parts = [
    paymentMethodName,
    note.trim() === "" ? null : "备注",
    tagCount > 0 ? "标签" : null,
  ].filter((part): part is string => part !== null && part !== "");

  return parts.length > 0 ? parts.join(" · ") : "可选";
}
