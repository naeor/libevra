import { useEffect, useId, useRef } from "react";

import { useI18n } from "../../i18n/index.js";
import { ChevronIcon } from "../Icons.js";

/**
 * 从一列固定选项里选一个：**紧贴字段下方展开的内嵌列表**。
 *
 * ⚠️ **为什么不是 `ChoiceSheet`（底部面板）。** 所有者对 `/add` 的分类选择器和本页的
 * 「来源 / 目标」提的是同一件事：选择器应该像字段的一部分，展开的列表就在字段下面，
 * 而不是把整屏盖住再从底部滑上来。`ChoiceSheet` 本身保留——`/add` 的币种、导入等仍在用；
 * 这里只是把"内嵌展开"这一种形态抽成可复用组件。
 *
 * ⚠️ **为什么是正常流里的展开，不是绝对定位的弹层。** 弹层要算位置、要处理视口边缘，
 * 而且会被任何父容器的 `overflow` 裁掉。内嵌展开的高度、滚动、裁切全部由父容器自然处理：
 * 列表自己有 `max-h-64` 与 `overflow-y-auto`，页面上不会溢出，窄屏也一样。
 *
 * ⚠️ **受控组件**：`open` / `value` / `onToggle` / `onSelect` / `onClose` 全部由页面给。
 * 这样"同一时间只开一个"由页面决定（本页用 `picking`），组件只负责渲染与键盘/焦点。
 * 也因此没有 DOM 的测试环境可以分别渲染"收起"和"展开"两种结构。
 *
 * 可访问性：触发按钮是 `aria-haspopup="listbox"` + `aria-expanded`；展开后列表是
 * `role="listbox"`，每项 `role="option"` + `aria-selected`，禁用项是真的 `disabled`。
 * Escape 关闭、点组件外部关闭、打开时焦点进列表、关闭时焦点还给触发按钮。
 */
export interface InlineChoiceOption {
  readonly id: string;
  /** 主文字：账本名、分类名这类"选的是哪一个"。 */
  readonly label: string;
  /** 这一项存在但不能选（例如目标账本不能就是来源账本）。 */
  readonly disabled?: boolean;
  /** 第二行小字，解释这一项为什么不能选之类。 */
  readonly hint?: string;
}

/**
 * 内嵌选择器。
 *
 * ⚠️ **选中态只有一份来源：`value`。** 没有让每个选项自己带 `selected`——
 * 那会变成同一件事的第二份记录，页面更新 `value` 时忘了同步它就会显示错的一行。
 * 触发按钮显示当前项的 `label`；没有匹配项时显示 `placeholder`（收起与展开都不会空着）。
 */
export function InlineChoice({
  label,
  value,
  options,
  open,
  placeholder: placeholderProp,
  testId,
  onToggle,
  onSelect,
  onClose,
}: {
  /** 字段名，也是列表的 `aria-label`（例如「来源账本 B」）。 */
  readonly label: string;
  /** 当前值；没有对应选项时触发按钮显示 `placeholder`。 */
  readonly value: string;
  readonly options: readonly InlineChoiceOption[];
  readonly open: boolean;
  readonly placeholder?: string;
  /** 给测试与页面留下的稳定标识；放在触发按钮上。 */
  readonly testId?: string;
  readonly onToggle: () => void;
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  /** 默认「未选择」（`nav.choice.placeholder`），渲染时按当前语言取。 */
  const placeholder = placeholderProp ?? t("nav.choice.placeholder");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  /**
   * ⚠️ **回调走 ref，不进 effect 的依赖。** 页面每次渲染都传内联箭头函数，写进依赖会让
   * 打开期间的重渲染重跑 effect：焦点被抢回当前项，监听器反复解绑重绑。
   */
  const closeRef = useRef(onClose);
  const toggleRef = useRef(onToggle);

  useEffect(() => {
    closeRef.current = onClose;
    toggleRef.current = onToggle;
  }, [onClose, onToggle]);

  useEffect(() => {
    if (!open) return;

    const root = rootRef.current;
    const selected = root?.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="true"]:not(:disabled)',
    );
    const first = selected ?? root?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)');
    first?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    }

    /**
     * 点组件外面关闭。用 `pointerdown` 而不是 `click`：手指按下就收起，不必等抬起；
     * 点在组件内部时交给选项自己处理。
     */
    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target) === true) return;
      closeRef.current();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      /** 关闭/卸载后焦点回到打开它的那个按钮，而不是掉到 `body`。 */
      root?.querySelector<HTMLButtonElement>("[data-inline-choice-trigger]")?.focus();
    };
  }, [open]);

  /** 上下方向键在可用项之间移动焦点；Tab 仍按浏览器默认顺序走。 */
  function moveFocus(event: React.KeyboardEvent<HTMLUListElement>): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const items = [
      ...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []),
    ];
    if (items.length === 0) return;

    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const forward = event.key === "ArrowDown";
    const next =
      current < 0
        ? items[forward ? 0 : items.length - 1]
        : items[(current + (forward ? 1 : -1) + items.length) % items.length];

    next?.focus();
  }

  const current = options.find((option) => option.id === value);

  return (
    <div ref={rootRef} className="overflow-hidden rounded-field border border-line bg-surface">
      <button
        type="button"
        data-inline-choice-trigger=""
        {...(testId === undefined ? {} : { "data-testid": testId })}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...(open ? { "aria-controls": listId } : {})}
        aria-label={t("nav.choice.current", { label, value: current?.label ?? placeholder })}
        onClick={onToggle}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none"
      >
        <span
          className={`min-w-0 truncate ${current === undefined ? "text-muted" : "text-ink"}`}
        >
          {current?.label ?? placeholder}
        </span>
        <span aria-hidden="true" className="shrink-0 text-muted">
          <ChevronIcon up={open} />
        </span>
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          onKeyDown={moveFocus}
          className="max-h-64 overflow-y-auto overscroll-contain border-t border-line"
        >
          {options.map((option) => {
            const selected = option.id === value;

            return (
              <li key={option.id} className="border-t border-line first:border-t-0">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled === true}
                  onClick={() => {
                    if (option.disabled === true) return;
                    onSelect(option.id);
                    onClose();
                  }}
                  className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left transition ${
                    selected ? "text-brand-dark" : "text-ink"
                  } ${option.disabled === true ? "cursor-not-allowed opacity-45" : "hover:bg-brand-soft"}`}
                >
                  <span className={`truncate text-sm ${selected ? "font-medium" : ""}`}>
                    {option.label}
                  </span>
                  {option.hint === undefined ? null : (
                    <span className="text-helper text-muted">{option.hint}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
