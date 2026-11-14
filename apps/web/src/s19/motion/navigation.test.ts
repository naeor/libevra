import { describe, expect, it } from "vitest";
import { defaultMotionBetween, focusesOnEntry, hasDefaultMotion, inEntryWorkspace, isDefaultMotionEdge, isReturnToTab, isTabSwitch, navigationLevel, navVisibleAt } from "./navigation.js";

describe("导航层级与默认转场边界", () => {
  it("五种工作模式与四个主 Tab 分别识别，详情属于次级", () => {
    for (const path of ["/paste", "/record", "/add", "/scan", "/import"]) expect(navigationLevel(path)).toBe("enterMode");
    for (const path of ["/", "/stats", "/ledger", "/me"]) expect(navigationLevel(path)).toBe("tabRoot");
    for (const path of ["/settings", "/profile", "/transactions/1", "/stats/cards/1", "/import-ledger"]) expect(navigationLevel(path)).toBe("subpage");
  });
  it("记账工作区包含五种方式与各自的识别核对步骤；只有挂载即聚焦的手动记账需要在点击里同步提交", () => {
    for (const path of ["/paste", "/record", "/add", "/scan", "/import", "/paste/review", "/voice/review", "/ocr/overview", "/ocr/overview/c1"]) expect(inEntryWorkspace(path)).toBe(true);
    for (const path of ["/", "/stats", "/import-ledger", "/transactions/1", "/settings"]) expect(inEntryWorkspace(path)).toBe(false);
    expect(focusesOnEntry("/add")).toBe(true);
    for (const path of ["/paste", "/record", "/scan", "/import"]) expect(focusesOnEntry(path)).toBe(false);
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
    for (const path of ["/start", "/login", "/recover"]) {
      expect(hasDefaultMotion(path)).toBe(false);
      expect(isDefaultMotionEdge("/me", path)).toBe(false);
    }
    expect(isDefaultMotionEdge("/start", "/books/a")).toBe(false);
  });
  it("1.19.75 T6：账本空间的「成员」「分享」走默认次级导航；进出账本空间本身仍不是默认边（海浪）", () => {
    for (const path of ["/start/book/a/members", "/start/book/a/share"]) {
      expect(hasDefaultMotion(path)).toBe(true);
      expect(isDefaultMotionEdge("/start", path)).toBe(true);
      // 返回时协调器按 PUSH 那条边的反向放行（两端之间允许默认转场）。
      expect(defaultMotionBetween(path, "/start")).toBe(true);
      // 账本空间只作为起点：从子页面 PUSH 进账本空间不是默认覆盖边。
      expect(isDefaultMotionEdge(path, "/start")).toBe(false);
    }
    expect(hasDefaultMotion("/start")).toBe(false);
    expect(defaultMotionBetween("/start", "/books/a")).toBe(false);
    expect(defaultMotionBetween("/me", "/start")).toBe(false);
    expect(defaultMotionBetween("/login", "/me")).toBe(false);
  });
  it("1.19.75 T1：底栏在哪些层级显示只由 navVisibleAt 决定——主 Tab 与记账工作区显示，次级页面隐藏", () => {
    expect(navVisibleAt("tabRoot")).toBe(true);
    expect(navVisibleAt("enterMode")).toBe(true);
    expect(navVisibleAt("subpage")).toBe(false);
    // 主 Tab 之间交换、主 Tab ↔ 记账工作区：前后结果相同，底栏不动；主 Tab ↔ 次级页：结果不同，播放退出 / 升回。
    const changes = (from: string, to: string): boolean => navVisibleAt(navigationLevel(from)) !== navVisibleAt(navigationLevel(to));
    expect(changes("/", "/me")).toBe(false);
    expect(changes("/", "/add")).toBe(false);
    expect(changes("/me", "/settings")).toBe(true);
    expect(changes("/transactions/1", "/")).toBe(true);
    expect(changes("/settings", "/settings/security")).toBe(false);
  });
  it("1.19.75 T4：从次级页前往主 Tab（PUSH / REPLACE）按返回方向播放；工作区、账本空间与登录不在此列", () => {
    expect(isReturnToTab("/stats/cards/1", "/")).toBe(true);
    expect(isReturnToTab("/ledger/invite", "/ledger")).toBe(true);
    expect(isReturnToTab("/transactions/1", "/")).toBe(true);
    expect(isReturnToTab("/start/book/a/members", "/")).toBe(true);
    expect(isReturnToTab("/start", "/")).toBe(false);
    expect(isReturnToTab("/login", "/")).toBe(false);
    expect(isReturnToTab("/add", "/")).toBe(false);
    expect(isReturnToTab("/me", "/")).toBe(false);
    expect(isReturnToTab("/settings", "/settings/security")).toBe(false);
  });
});
