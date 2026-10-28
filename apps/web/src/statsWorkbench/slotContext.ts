import { createContext, useContext } from "react";

import type { SlotMode } from "./composition.js";

/**
 * 组合卡片里一个槽位的展示密度（由 `composition.ts` 的排布给出）。没有提供时（普通卡片、详情页）照旧。
 * - `inline` / `stacked`：数字单元格（单行「名称 … 数值」/ 两行「名称 / 数值」），说明文字收成提示标记；
 * - `spark`：只够画迷你趋势线的图表单元格；`chart`：正常图表单元格。
 *
 * 单独成文件，避免各卡片视图模块与 `cards.tsx` 之间的循环引用。
 */
export const SlotPresentationContext = createContext<{ readonly mode: SlotMode } | null>(null);

export function useSlotMode(): SlotMode | null {
  return useContext(SlotPresentationContext)?.mode ?? null;
}

/**
 * 卡片（或组合卡片小格）正文的像素空间，给需要按空间决定「画多少」的深层视图用（例如环形图的图例行数）。
 * 详情页不提供（`undefined` = 不限高度，完整显示）。
 */
export const CardSpaceContext = createContext<{ readonly width: number | undefined; readonly height: number | undefined } | null>(null);

export function useCardSpace(): { readonly width: number | undefined; readonly height: number | undefined } | null {
  return useContext(CardSpaceContext);
}
