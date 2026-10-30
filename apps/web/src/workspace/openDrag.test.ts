import { describe, expect, it } from "vitest";

import { isLedgerScopedPath, isOpenablePath, plainText } from "./openDrag.js";

describe("哪些入口可以拖到另一个工作区打开", () => {
  it("页面层级的入口可以：明细、分析卡片、账本与设置页", () => {
    for (const path of ["/", "/stats", "/stats/cards/c1?range=30d", "/transactions/t1", "/ledger/history", "/books/b1/settings", "/me", "/settings/appearance", "/profile/avatar", "/downloads", "/update"]) {
      expect(isOpenablePath(path)).toBe(true);
    }
  });

  it("带着进行中流程的入口不参与：拍照、语音、粘贴、导入、登录与加入链接", () => {
    for (const path of ["/scan", "/record", "/paste", "/paste/review", "/voice/review", "/ocr/overview", "/import", "/import-ledger", "/join/abc", "/login", "/guest"]) {
      expect(isOpenablePath(path)).toBe(false);
    }
    expect(isOpenablePath("https://example.com")).toBe(false);
  });

  it("属于某一本账的页面：拖到另一个工作区后仍显示来源那本账", () => {
    expect(isLedgerScopedPath("/transactions/t1")).toBe(true);
    expect(isLedgerScopedPath("/stats/cards/c1?x=1")).toBe(true);
    expect(isLedgerScopedPath("/ledger/members")).toBe(true);
    // 主导航目的地与账户级页面在目标工作区按那里自己的账本显示。
    expect(isLedgerScopedPath("/")).toBe(false);
    expect(isLedgerScopedPath("/stats")).toBe(false);
    expect(isLedgerScopedPath("/ledger")).toBe(false);
    expect(isLedgerScopedPath("/me")).toBe(false);
  });

  it("预览名字只取纯文字；拿不到名字的入口不参与拖动", () => {
    expect(plainText("个人资料")).toBe("个人资料");
    expect(plainText(42)).toBe("42");
    expect(plainText(null)).toBe("");
    expect(plainText({ type: "span" } as unknown as React.ReactNode)).toBe("");
  });
});
