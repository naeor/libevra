import { describe, expect, it } from "vitest";

import { resistedOffset, swipeAxis, swipeTarget } from "./carouselGesture.js";

describe("横向滑动抽屉：翻页手势", () => {
  it("先判方向：小位移不认领；横向明显大于纵向才算翻页，否则交给页面滚动", () => {
    expect(swipeAxis(4, 3)).toBeNull();
    expect(swipeAxis(30, 10)).toBe("x");
    expect(swipeAxis(12, 11)).toBe("y");
    expect(swipeAxis(2, 20)).toBe("y");
  });

  it("慢慢拖：过 30% 翻到相邻一页，不足则回到原页", () => {
    // 宽 300，慢拖 1 秒：速度 = 0.33 / 0.2 个宽度每秒，都低于一甩门槛。
    expect(swipeTarget(0, 3, -100, 1000, 300)).toBe(1);
    expect(swipeTarget(1, 3, 100, 1000, 300)).toBe(0);
    expect(swipeTarget(0, 3, -60, 1000, 300)).toBe(0);
  });

  it("快速一甩：距离不够也翻页（平均速度超过门槛）", () => {
    // 60px / 100ms = 600 px/s = 2 个宽度每秒。
    expect(swipeTarget(0, 3, -60, 100, 300)).toBe(1);
  });

  it("到头了：第一页不能再往前、最后一页不能再往后；拉过头有阻力", () => {
    expect(swipeTarget(0, 3, 200, 100, 300)).toBe(0);
    expect(swipeTarget(2, 3, -200, 100, 300)).toBe(2);
    expect(resistedOffset(90, 0, 3)).toBe(30);
    expect(resistedOffset(-90, 2, 3)).toBe(-30);
    expect(resistedOffset(-90, 0, 3)).toBe(-90);
  });
});
