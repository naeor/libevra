import { describe, expect, it } from "vitest";

import { dragDismisses, SHEET_DRAG } from "./sheetDrag.js";

/**
 * 下拉关闭的松手判断（弹出面板模板，1.19.58）。跟手位移写在指针事件里，需要 DOM；
 * 这里钉住“拉多远 / 甩多快才关”，与原来账本选择、账本管理两块面板的 90px 一致。
 */
describe("下拉关闭：松手时关不关", () => {
  it("拉过 90px 就关闭，与原来两块面板相同", () => {
    expect(SHEET_DRAG.dismissPx).toBe(90);
    expect(dragDismisses(90, 0)).toBe(true);
    expect(dragDismisses(89, 0)).toBe(false);
  });

  it("向下快速一甩也关闭，但手指一抖不算", () => {
    expect(dragDismisses(SHEET_DRAG.flickMinPx, SHEET_DRAG.flickVelocity)).toBe(true);
    expect(dragDismisses(SHEET_DRAG.flickMinPx - 1, 5)).toBe(false);
    expect(dragDismisses(60, SHEET_DRAG.flickVelocity - 0.01)).toBe(false);
  });

  it("没有向下拉（位移为 0）不关闭", () => {
    expect(dragDismisses(0, 10)).toBe(false);
  });
});
