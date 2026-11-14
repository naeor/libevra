import { BottomSheet } from "../BottomSheet.js";

/**
 * 从一列固定选项里选一个：项目自己的底部选择面板。
 *
 * ⚠️ **为什么不是原生 `<select>`**（S15-C 第三轮）。原生下拉的菜单由浏览器绘制：白色/灰色、
 * 圆角与项目无关、选中态不是品牌绿，而且在桌面与手机上是两个样子——它看起来像系统控件，
 * 不像这块屏幕的一部分。所有者对 `/add` 币种与账本导入的「来源/目标」两处都提了同一件事。
 *
 * ⚠️ **为什么做成底部面板而不是锚在按钮上的弹层。** 项目里已有的选择器（`MonthPicker`、
 * `BookSwitcherSheet`、`UpdateMoreSheet`）都是同一种形态：遮罩 + `fixed bottom-0` + 顶部圆角 +
 * 安全区。手机上一只手可及，**也不会被任何父容器的 `overflow` 裁掉**——`fixed` 让它脱离
 * 文档流，`z-50` 让它压在粘性保存条（`z-20`）与底部导航（`z-10`）之上。
 *
 * ⚠️ **受控组件，自己不记"选了谁"**：`value` / `onSelect` / `onClose` 都由页面给。
 * 这样没有 DOM 的测试环境（本仓库没有 jsdom）也能用 `open={true}` 渲染出打开后的结构，
 * 分别断言"列全部选项""当前项选中""关闭时不渲染"。
 *
 * 可访问性：面板是 `role="dialog"`（有标题、`aria-modal`），列表是 `role="listbox"`，
 * 每一项是 `role="option"` 且带 `aria-selected`；禁用项是真的 `disabled`。
 * Escape 关闭、点遮罩关闭、下拉关闭、点中一项后关闭；打开时把焦点放到当前项，关闭时还给打开它的控件。
 *
 * 弹出面板模板（1.19.58）：外壳是 `BottomSheet` 的 T1 列表模板——模板标题行（标题 + 右上角 ×）、
 * 按内容档（1.19.63 内容优先：按内容、最高到大档，选项更多时列表在面板里滚动）、下拉关闭与焦点都由外壳负责。
 * 宽屏下仍一直贴底（`wide="bottom"`，与原来相同）。
 */
export interface ChoiceSheetOption<Value extends string> {
  readonly value: Value;
  /** 主文字。账本名、币种名这类"选的是哪一个"。 */
  readonly label: string;
  /** 第二行小字，解释这一项为什么不能选之类。 */
  readonly hint?: string;
  /** 右侧的稳定标识，例如币种代码 `CNY`。 */
  readonly trailing?: string;
  /** 这一项存在但不能选（例如目标账本不能就是来源账本）。 */
  readonly disabled?: boolean;
}

/** 打开时获得焦点的项：当前选中项，没有就第一项可用项。 */
function initialOption(panel: HTMLElement): HTMLElement | null {
  return (
    panel.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not(:disabled)') ??
    panel.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')
  );
}

/**
 * 上下方向键在可用项之间移动焦点。Tab 顺序不变，由共享焦点栈约束在当前面板内。
 */
function moveFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')];
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

/**
 * 底部面板：标题 + 关闭 + 一列选项。
 *
 * ⚠️ **高度是内容驱动 + 上限**（模板按内容档，最高到大档 + 列表自己滚动），不是固定若干像素：
 * 六个币种时它刚好包住内容，账本很多时它停在上限并让列表滚动，标题与关闭按钮始终可见。
 */
export function ChoiceSheet<Value extends string>({
  open,
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  readonly open: boolean;
  /** 面板标题，也是列表的 `aria-label`（例如「选择币种」）。 */
  readonly title: string;
  readonly options: readonly ChoiceSheetOption<Value>[];
  /** 当前值；对应项显示品牌绿选中态。 */
  readonly value: Value;
  readonly onSelect: (value: Value) => void;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  if (!open) return null;

  return (
    <BottomSheet label={title} title={title} wide="bottom" initialFocus={initialOption} onClose={onClose}>
      {(requestClose) => (
        <div
          role="listbox"
          aria-label={title}
          onKeyDown={moveFocus}
          className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line"
        >
          {options.map((option) => {
            const selected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled === true}
                onClick={() => {
                  if (option.disabled === true) return;
                  onSelect(option.value);
                  requestClose();
                }}
                className={`flex min-h-14 w-full items-center gap-3 border-b border-line px-5 py-3 text-left transition last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${
                  selected ? "bg-brand-soft text-brand-dark" : "text-ink hover:bg-canvas"
                } ${option.disabled === true ? "opacity-45" : ""}`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={`truncate text-body ${selected ? "font-medium" : ""}`}>
                    {option.label}
                  </span>
                  {option.hint === undefined ? null : (
                    <span className="text-helper text-muted">{option.hint}</span>
                  )}
                </span>

                {option.trailing === undefined ? null : (
                  <span className="shrink-0 text-helper tabular-nums text-muted">
                    {option.trailing}
                  </span>
                )}

                {/* 选中是"颜色 + 对勾"两重信号，不靠颜色单独表达。 */}
                <span
                  aria-hidden="true"
                  className={`flex size-5 shrink-0 items-center justify-center ${
                    selected ? "text-brand" : "text-transparent"
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m4.5 12.5 5 5 10-11" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </BottomSheet>
  );
}
