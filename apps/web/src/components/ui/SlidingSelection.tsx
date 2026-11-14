import { Children, cloneElement, isValidElement, type HTMLAttributes, type ReactElement, type ReactNode, type RefObject } from "react";
import { MovingSelection } from "./SelectionControls.js";

/**
 * 横向的滑动选择（支出 / 收入、全部 / 支出 / 收入、批量修改的添加 / 移除、展示卡片编辑器的分组、分析工作台的分段与分类）。
 * 子元素是调用方自己的 `<button>`，以 `aria-pressed` / `aria-selected` / `aria-checked` 标出选中；原按钮、角色、aria、
 * 点击、键盘与禁用判断全部由调用方保留。
 *
 * **1.19.67 起就是 `MovingSelection axis="x" base="copy"`**（规格 S19 §3「选中指示」，四种风格同一个模型）：
 * - S19 浅色手机外壳：B1 / B2 一块不染色的模拟玻璃按底栏胶囊的弹性规则滑动，A 选中项按 A2 档浮起，C 浅绿实底干脆滑动，
 *   选中文字变品牌绿；
 * - Original、深色、Pad 与电脑版：与 1.19.66 之前一样——一块从选中按钮复制外观的胶囊用原 200ms 节奏滑到新选项。
 * 每个按钮的内容包一层 `data-select-label`：选中块在未选按钮的底色之上、文字之下滑过（分类胶囊各自有底色）。
 */
export function SlidingSelection({ children, hostRef, ...props }: HTMLAttributes<HTMLDivElement> & { hostRef?: RefObject<HTMLDivElement | null> }) {
  return <MovingSelection {...props} axis="x" base="copy" {...(hostRef === undefined ? {} : { hostRef })}>
    {Children.map(children, child => isValidElement(child) && child.type === "button"
      ? cloneElement(child as ReactElement<{ children: ReactNode }>, {}, <span data-select-label="">{(child.props as { children: ReactNode }).children}</span>)
      : child)}
  </MovingSelection>;
}
