import { describe, expect, it } from "vitest";

import { entryNewTabPath } from "../components/ledger/LedgerEntryRow.js";
import { TIP_DELAY_MS, TIP_SKIP_MS, tipDelay } from "../workspace/RailTip.js";
import { isImeComposing, wantsNewTab } from "./desktopInput.js";

describe("输入法组字中的按键不是命令", () => {
  it("组字中（isComposing）或 Safari 上屏那次（keyCode 229）都算组字", () => {
    expect(isImeComposing({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true);
  });
  it("普通 Enter 不受影响", () => {
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeComposing({})).toBe(false);
  });
});

describe("新标签页打开的点击", () => {
  const click = (button: number, ctrlKey = false, metaKey = false) => ({ button, ctrlKey, metaKey });
  it("中键、Ctrl + 左键、⌘ + 左键", () => {
    expect(wantsNewTab(click(1))).toBe(true);
    expect(wantsNewTab(click(0, true))).toBe(true);
    expect(wantsNewTab(click(0, false, true))).toBe(true);
  });
  it("普通左键与右键不是", () => {
    expect(wantsNewTab(click(0))).toBe(false);
    expect(wantsNewTab(click(2, true))).toBe(false);
  });
});

describe("账目行在新标签页打开的范围", () => {
  const row = { path: "/transactions/t1", selecting: false, conflicted: false, pending: false, deleted: false, foreignBook: null };
  it("当前账本里已同步的普通账目可以", () => {
    expect(entryNewTabPath(row)).toBe("/transactions/t1");
  });
  it("多选、冲突、未同步新建 / 删除、外部账本、没有详情路径时不可以，点击照旧", () => {
    expect(entryNewTabPath({ ...row, selecting: true })).toBeUndefined();
    expect(entryNewTabPath({ ...row, conflicted: true })).toBeUndefined();
    expect(entryNewTabPath({ ...row, pending: true })).toBeUndefined();
    expect(entryNewTabPath({ ...row, deleted: true })).toBeUndefined();
    expect(entryNewTabPath({ ...row, foreignBook: "b2" })).toBeUndefined();
    expect(entryNewTabPath({ ...row, path: undefined })).toBeUndefined();
  });
});

describe("紧凑侧栏提示的出现时机", () => {
  it("第一次要停住一会儿；刚收起一个提示后移到相邻图标立即出现", () => {
    expect(tipDelay(10_000, Number.NEGATIVE_INFINITY)).toBe(TIP_DELAY_MS);
    expect(tipDelay(10_000, 10_000 - TIP_SKIP_MS)).toBe(0);
    expect(tipDelay(10_000, 10_000 - TIP_SKIP_MS - 1)).toBe(TIP_DELAY_MS);
  });
});
