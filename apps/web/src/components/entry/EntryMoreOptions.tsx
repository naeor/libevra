import { MAX_TAGS_PER_TRANSACTION, type Tag } from "@libellum/shared";

/**
 * 备注与标签：手动记账页的低频扩展区。
 *
 * ⚠️ **为什么把这两项收起来**（S15-C）。他们是「记完之后顺手补一句」的字段，不是每笔都要填；
 * 之前它们占着保存按钮上方的两整段、约 170px，把最常见的「输金额 → 选分类 → 保存」推到了
 * 两次滑动之外。收进一行「更多选项」后，首屏只留高频字段，但**能力一点没少**：
 * 展开后备注仍是同一个输入框（200 字上限）、标签仍是同一组按钮（10 个上限）、
 * 选中颜色与按钮文字完全沿用原实现。
 *
 * 折叠面板本身不保存任何状态：展开与否由页面持有（`open` / `onToggle`），
 * 这样「再记一笔」可以把面板重新收起，而备注与标签的值仍由页面管理。
 * 做成受控组件还有一个好处：没有 DOM 的测试环境（本仓库没有 jsdom）也能用
 * `open={false}` / `open={true}` 分别渲染，断言收起时字段不在、展开后字段齐全。
 */
export function EntryMoreOptions({
  open,
  onToggle,
  note,
  onNoteChange,
  tags,
  selectedTagIds,
  onToggleTag,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly note: string;
  readonly onNoteChange: (value: string) => void;
  readonly tags: readonly Tag[];
  readonly selectedTagIds: readonly string[];
  readonly onToggleTag: (tagId: string) => void;
}): React.JSX.Element {
  /**
   * 收着的时候，备注/标签已经填过就换一句提示——否则保存后才发现「原来当时写了话」，
   * 而折叠区看上去和没填一样。展开时字段就在眼前，不需要这层提示。
   */
  const filled = note.trim() !== "" || selectedTagIds.length > 0;

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
          <span className="text-button-lg text-ink">更多选项</span>
          <span className="flex items-center gap-1.5">
            <span className="text-helper text-muted">{open || !filled ? "备注、标签" : "已填写"}</span>
            <span aria-hidden="true" className="text-muted">
              {open ? "⌃" : "⌄"}
            </span>
          </span>
        </button>

        {open ? (
          <div
            id="entry-more-options"
            className="flex flex-col gap-4 border-t border-line px-4 py-4"
          >
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
