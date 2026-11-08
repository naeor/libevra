import { describe, expect, it } from "vitest";
import { hasDefaultMotion, isDefaultMotionEdge, isTabSwitch, navigationLevel } from "./navigation.js";

describe("导航层级与默认转场边界", () => {
  it("五种工作模式与四个主 Tab 分别识别，详情属于次级", () => {
    for (const path of ["/paste", "/record", "/add", "/scan", "/import"]) expect(navigationLevel(path)).toBe("enterMode");
    for (const path of ["/", "/stats", "/ledger", "/me"]) expect(navigationLevel(path)).toBe("tabRoot");
    for (const path of ["/settings", "/profile", "/transactions/1", "/stats/cards/1", "/import-ledger"]) expect(navigationLevel(path)).toBe("subpage");
  });
  it("主 Tab 之间是 switchTab，进入次级或模式都不是", () => {
    expect(isTabSwitch("/", "/me")).toBe(true);
    expect(isTabSwitch("/stats", "/ledger")).toBe(true);
    expect(isTabSwitch("/", "/")).toBe(false);
    expect(isTabSwitch("/me", "/settings")).toBe(false);
    expect(isTabSwitch("/", "/add")).toBe(false);
  });
  it("我的四个入口及主页面进入任意次级页面都使用默认覆盖转场", () => {
    for (const path of ["/profile", "/downloads", "/update", "/books/actual-book", "/settings"]) expect(isDefaultMotionEdge("/me", path)).toBe(true);
    expect(isDefaultMotionEdge("/settings", "/settings/appearance/theme")).toBe(true);
    expect(isDefaultMotionEdge("/settings", "/settings/security")).toBe(true);
    expect(isDefaultMotionEdge("/books/a", "/books/a/settings")).toBe(true);
    expect(isDefaultMotionEdge("/ledger", "/ledger/members")).toBe(true);
    expect(isDefaultMotionEdge("/", "/ledger/cards")).toBe(true);
    expect(isDefaultMotionEdge("/stats", "/stats/cards/1")).toBe(true);
    expect(isDefaultMotionEdge("/paste", "/paste/review")).toBe(true);
  });
  it("返回上级、主 Tab、记账模式、同页与自带动效的页面不授权默认 PUSH", () => {
    expect(isDefaultMotionEdge("/profile", "/me")).toBe(false);
    expect(isDefaultMotionEdge("/me", "/stats")).toBe(false);
    expect(isDefaultMotionEdge("/", "/add")).toBe(false);
    expect(isDefaultMotionEdge("/settings", "/settings")).toBe(false);
    for (const path of ["/start", "/start/book/a/members", "/login", "/recover"]) {
      expect(hasDefaultMotion(path)).toBe(false);
      expect(isDefaultMotionEdge("/me", path)).toBe(false);
    }
    expect(isDefaultMotionEdge("/start", "/books/a")).toBe(false);
  });
});
