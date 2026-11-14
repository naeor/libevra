import { describe, expect, it } from "vitest";

import { bottomOffset, centeredSpan, topOffset } from "./placement.js";

/**
 * 1.19.66 提示条位置（方案 §3.1）：底栏、“+”、账本胶囊、底部操作栏与键盘之上；分析编辑态在编辑条下方。
 * 尺寸按 iPhone 15 竖屏（393 × 852，底部安全区 34px）。
 */
const phone = { viewportHeight: 852, safeBottom: 34, span: centeredSpan(393), keyboardCover: 0, gap: 8, edge: 16 };

describe("提示条位置", () => {
  it("手机水平居中：min(视口宽 − 32px, 28rem)", () => {
    expect(centeredSpan(393)).toEqual({ left: 16, right: 377 });
    expect(centeredSpan(1024)).toEqual({ left: 288, right: 736 });
  });

  it("没有障碍物：底部安全区之上 16px", () => {
    expect(bottomOffset({ ...phone, obstacles: [] })).toBe(50);
  });

  it("底栏、抬高的“+”与账本胶囊：放在最高上缘之上 8px（原撤销条写死 112px，会压住“+”）", () => {
    const nav = { top: 753, bottom: 852, left: 0, right: 393 };
    const plus = { top: 721, bottom: 785, left: 164, right: 228 };
    const capsule = { top: 713, bottom: 753, left: 0, right: 180 };
    expect(bottomOffset({ ...phone, obstacles: [nav, plus, capsule] })).toBe(852 - 713 + 8);
  });

  it("只避开横向重叠、在屏幕下半部分的障碍物", () => {
    const sideButton = { top: 600, bottom: 650, left: 380, right: 393 };
    const header = { top: 0, bottom: 60, left: 0, right: 393 };
    expect(bottomOffset({ ...phone, obstacles: [sideButton, header] })).toBe(50);
  });

  it("软键盘打开：底栏与保存栏原位隐藏（宿主不计入），提示在键盘上方 8px", () => {
    expect(bottomOffset({ ...phone, keyboardCover: 336, obstacles: [] })).toBe(344);
  });

  it("电脑版：底部操作栏之上 16px，没有则离底 24px", () => {
    const desk = { viewportHeight: 900, safeBottom: 0, span: { left: 400, right: 848 }, keyboardCover: 0, gap: 16, edge: 24 };
    expect(bottomOffset({ ...desk, obstacles: [] })).toBe(24);
    expect(bottomOffset({ ...desk, obstacles: [{ top: 836, bottom: 900, left: 260, right: 1440 }] })).toBe(80);
  });

  it("分析编辑态：编辑条下方 8px", () => {
    expect(topOffset({ anchorBottom: 112, safeTop: 47, gap: 8 })).toBe(120);
    expect(topOffset({ anchorBottom: 0, safeTop: 47, gap: 8 })).toBe(55);
  });
});
