import { useDesktopActive } from "../../desktop/surface.js";
import { useRootVisualStyle } from "../../lib/useRootVisualStyle.js";
import { usePane } from "../../workspace/context.js";
import { SlidingSelection } from "../ui/SlidingSelection.js";

/**
 * 记账工作区里支出 / 收入是否改用明细同款选择栏（1.19.51，所有者决定）：手机外壳里的 A / B1 / B2。
 * C 保留经典外观（手动记账只压缩绿色顶区），Original、Pad 与桌面保持原样。
 */
export function useKindBar(): boolean {
  const desktop = useDesktopActive();
  const pane = usePane();
  const style = useRootVisualStyle();
  return !desktop && pane.shell === "phone" && (style === "a" || style === "b1" || style === "b2");
}

/**
 * 支出 / 收入选择栏（1.19.51）：与明细页「全部 / 支出 / 收入」**同一套外观**（`DetailPage` 的 `detail-toggle-bar`）。
 *
 * 类名与明细保持一致，所以 S19 的轨道 / 胶囊映射（`s19/shared.css`「分段控件」）、深色与 Original 的基础外观、
 * 已确认的滑动胶囊（`SlidingSelection`，200ms，减少动态效果时直接到位）都直接生效，不另写一份材质。
 * 只负责外观与选择；切换后要清空什么（手动记账清分类与沿用提示、OCR 记录已确认方向）仍由调用方的 `onChange` 决定。
 * `value` 为 `null` 表示还没确定方向（OCR 识别不出收支时），此时两项都不选中。
 */
export function KindToggle<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  readonly value: T | null;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <SlidingSelection role="group" aria-label={label} data-entry-kind-switch="" className={`flex gap-1 rounded-full bg-line/70 p-1 ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => {
            onChange(option.value);
          }}
          className={`flex-1 rounded-full py-2 text-sm font-medium transition ${
            value === option.value ? "bg-surface text-brand-dark shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </SlidingSelection>
  );
}
