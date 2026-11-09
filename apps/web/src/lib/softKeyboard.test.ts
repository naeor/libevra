import { describe, expect, it } from "vitest";
import { coveredHeight, KEYBOARD_THRESHOLD, keyboardOpen } from "./softKeyboard.js";

const base = { focused: true, covered: 0, shrunk: 0, scale: 1 };

describe("软键盘判定（保存栏与底栏在键盘打开时隐藏）", () => {
  it("iOS：可视区被挡住且焦点在输入框上才算打开", () => {
    expect(keyboardOpen({ ...base, covered: 336 })).toBe(true);
    expect(keyboardOpen({ ...base, covered: 336, focused: false })).toBe(false);
  });
  it("Android resizes-content：布局高度变矮同样算打开", () => {
    expect(keyboardOpen({ ...base, shrunk: 300 })).toBe(true);
  });
  it("地址栏伸缩、iOS 26 收起后残留的几十像素不算键盘", () => {
    expect(keyboardOpen({ ...base, covered: 24 })).toBe(false);
    expect(keyboardOpen({ ...base, shrunk: 80 })).toBe(false);
    expect(keyboardOpen({ ...base, covered: KEYBOARD_THRESHOLD - 1 })).toBe(false);
  });
  it("双指缩放时不当作键盘", () => {
    expect(keyboardOpen({ ...base, covered: 400, scale: 1.6 })).toBe(false);
  });
  it("被挡住的高度按布局视口坐标计算，没有遮挡时为 0", () => {
    // U02 推算：布局视口约 703，可视区 407，offsetTop 0
    expect(coveredHeight(703, 0, 407)).toBe(296);
    expect(coveredHeight(703, 0, 703)).toBe(0);
    expect(coveredHeight(703, 120, 600)).toBe(0);
  });
});
