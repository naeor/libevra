import { describe, expect, it } from "vitest";
import { isSettingsMotionEdge, isSettingsMotionPage, navigationLevel } from "./navigation.js";

describe("导航层级与设置转场边界", () => {
  it("五种工作模式与四个主 Tab 分别识别，详情属于次级", () => {
    for (const path of ["/paste", "/record", "/add", "/scan", "/import"]) expect(navigationLevel(path)).toBe("enterMode");
    for (const path of ["/", "/stats", "/ledger", "/me"]) expect(navigationLevel(path)).toBe("tabRoot");
    for (const path of ["/settings", "/profile", "/transactions/1", "/stats/cards/1", "/import-ledger"]) expect(navigationLevel(path)).toBe("subpage");
  });
  it("我的四个实际次级入口进入白名单，缺账本时不误把开始页当详情", () => {
    for (const path of ["/profile", "/downloads", "/update", "/books/actual-book"]) {
      expect(isSettingsMotionPage(path)).toBe(true);
      expect(isSettingsMotionEdge("/me", path)).toBe(true);
    }
    for (const path of ["/start", "/stats", "/books/actual-book/settings", "/books/"]) expect(isSettingsMotionEdge("/me", path)).toBe(false);
  });
  it("不会给无来源详情、同级切换及反向 URL 凭空授权 PUSH", () => {
    expect(isSettingsMotionEdge("/profile", "/me")).toBe(false);
    expect(isSettingsMotionEdge("/downloads", "/update")).toBe(false);
    expect(isSettingsMotionEdge("/settings", "/settings/appearance/theme")).toBe(true);
    expect(isSettingsMotionEdge("/settings/appearance/theme", "/settings/appearance/language")).toBe(false);
  });
});
