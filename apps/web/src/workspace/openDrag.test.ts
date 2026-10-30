import { describe, expect, it } from "vitest";

import { isLedgerScopedPath, isOpenablePath, openDragPayload, plainText } from "./openDrag.js";

describe("哪些入口可以拖到另一个工作区打开", () => {
  it("具体账本拖到明细时显式携带账本，不误用主区正在看的账本", () => {
    expect(openDragPayload({ path: "/", title: "家庭账本", ledger: "book-b", fromRail: true }, "w1", "book-a"))
      .toEqual({ path: "/", title: "家庭账本", ledger: "book-b", source: null });
  });
  it("普通侧栏导航不带来源账本，交易入口继续带来源账本", () => {
    expect(openDragPayload({ path: "/stats", title: "分析", fromRail: true }, "w1", "book-a").ledger).toBeNull();
    expect(openDragPayload({ path: "/transactions/t1", title: "账目" }, "w2", "book-b")).toMatchObject({ ledger: "book-b", source: "w2" });
  });
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
