import { describe, expect, it } from "vitest";

import {
  dragState,
  GUTTER,
  keyboardRatio,
  layoutPanes,
  orientationFor,
  ratioLimits,
  shellModeFor,
  SPLIT_MARGIN,
  splitAvailable,
  splitFits,
} from "./geometry.js";
import { followsToSecondary, isFollowDetail, isStandalonePath, destinationOf } from "./follow.js";

describe("外壳形态按窗口尺寸，而不是设备型号", () => {
  it("常见手机竖屏 / 横屏保持手机界面，平板与桌面进入大屏外壳", () => {
    expect(shellModeFor(390, 844)).toBe("phone");
    expect(shellModeFor(844, 390)).toBe("phone");
    expect(shellModeFor(768, 1024)).toBe("wide");
    expect(shellModeFor(1024, 768)).toBe("wide");
    expect(shellModeFor(1280, 800)).toBe("wide");
    expect(shellModeFor(507, 1024)).toBe("phone"); // iPad 分屏的一半
  });

  it("横竖由宽高比决定", () => {
    expect(orientationFor(1024, 768)).toBe("landscape");
    expect(orientationFor(768, 1024)).toBe("portrait");
  });
});

describe("双工作区布局", () => {
  it("横屏左右分栏：主 + 分界 + 辅正好铺满（第二轮：辅助区右侧不再有常驻功能区）", () => {
    const area = { w: 956, h: 768 };
    const layout = layoutPanes(area, "landscape", true, 0.55);
    const available = splitAvailable(area, "landscape");
    expect(layout.primary.w).toBe(Math.round(available * 0.55));
    expect(layout.primary.x + layout.primary.w).toBe(layout.divider!.x);
    expect(layout.divider!.x + GUTTER).toBe(layout.secondary!.x);
    expect(layout.secondary!.x + layout.secondary!.w).toBe(area.w - SPLIT_MARGIN);
    expect(layout).not.toHaveProperty("edge");
  });

  it("竖屏上下分栏：比例对应高度", () => {
    const area = { w: 700, h: 1024 };
    const layout = layoutPanes(area, "portrait", true, 0.55);
    const available = splitAvailable(area, "portrait");
    expect(layout.primary.h).toBe(Math.round(available * 0.55));
    expect(layout.divider!.y).toBe(SPLIT_MARGIN + layout.primary.h);
    expect(layout.secondary!.y + layout.secondary!.h).toBe(area.h - SPLIT_MARGIN);
    // 辅助区与主区同宽，右侧不再让出功能区。
    expect(layout.secondary!.w).toBe(layout.primary.w);
  });

  it("单区时主区铺满，没有分界线", () => {
    const layout = layoutPanes({ w: 792, h: 768 }, "landscape", false, 0.55);
    expect(layout.primary).toEqual({ x: 0, y: 0, w: 792, h: 768 });
    expect(layout.secondary).toBeNull();
    expect(layout.divider).toBeNull();
  });

  it("空间不足时不允许双区（辅助区暂时收起）", () => {
    expect(splitFits({ w: 600, h: 768 }, "landscape")).toBe(false);
    expect(splitFits({ w: 956, h: 768 }, "landscape")).toBe(true);
    expect(splitFits({ w: 700, h: 480 }, "portrait")).toBe(false);
  });

  it("30%–70% 同时受最小可操作尺寸约束", () => {
    const wide = ratioLimits(1600, "landscape");
    expect(wide.min).toBeCloseTo(0.3);
    expect(wide.max).toBeCloseTo(0.7);
    const tight = ratioLimits(700, "landscape");
    expect(tight.min).toBeGreaterThan(0.3);
    expect(tight.max).toBeLessThan(0.7);
  });
});

describe("拖动分界线：越界收起预览与迟滞", () => {
  const limits = { min: 0.3, max: 0.7 };

  it("正常范围内完全跟手", () => {
    expect(dragState(0.42, limits, null)).toEqual({ display: 0.42, collapse: null });
  });

  it("越过 30% 一点点不触发；越过阈值进入「松手收起主区」", () => {
    expect(dragState(0.28, limits, null).collapse).toBeNull();
    expect(dragState(0.2, limits, null).collapse).toBe("primary");
    expect(dragState(0.85, limits, null).collapse).toBe("secondary");
  });

  it("进入预览后，只有回到正常范围之内才取消（不在临界点闪动）", () => {
    expect(dragState(0.28, limits, "primary").collapse).toBe("primary");
    expect(dragState(0.31, limits, "primary").collapse).toBeNull();
    expect(dragState(0.72, limits, "secondary").collapse).toBe("secondary");
    expect(dragState(0.69, limits, "secondary").collapse).toBeNull();
  });

  it("越界后带阻尼地继续跟随", () => {
    const { display } = dragState(0.1, limits, null);
    expect(display).toBeGreaterThan(0.1);
    expect(display).toBeLessThan(0.3);
  });

  it("键盘替代：方向键每次 5%，Home / End 到两端", () => {
    expect(keyboardRatio(0.55, "ArrowRight", limits)).toBeCloseTo(0.6);
    expect(keyboardRatio(0.55, "ArrowUp", limits)).toBeCloseTo(0.5);
    expect(keyboardRatio(0.55, "Home", limits)).toBe(0.3);
    expect(keyboardRatio(0.55, "End", limits)).toBe(0.7);
    expect(keyboardRatio(0.55, "Enter", limits)).toBeNull();
  });
});

describe("跟随模式只接管「列表 → 下级详情」", () => {
  it("明细列表点账单 → 辅助区；详情里再点另一笔不跟随", () => {
    expect(followsToSecondary("/", "/transactions/t1")).toBe(true);
    expect(followsToSecondary("/stats", "/transactions/t1")).toBe(true);
    expect(followsToSecondary("/transactions/t1", "/transactions/t2")).toBe(false);
  });

  it("切换主导航目的地、进入设置等不跟随", () => {
    expect(followsToSecondary("/", "/stats")).toBe(false);
    expect(followsToSecondary("/me", "/settings")).toBe(false);
    expect(followsToSecondary("/", "/add")).toBe(false);
  });

  it("分析卡片详情、账本详情、公告详情从各自的列表跟随", () => {
    expect(followsToSecondary("/stats", "/stats/cards/c1")).toBe(true);
    expect(followsToSecondary("/start", "/books/b1")).toBe(true);
    expect(followsToSecondary("/ledger", "/books/b1")).toBe(true);
    expect(followsToSecondary("/books/b1", "/books/b1/settings")).toBe(false);
    expect(followsToSecondary("/update/announcements", "/update/announcements/1.17.0")).toBe(true);
  });

  it("跟随详情页识别与目的地归类", () => {
    expect(isFollowDetail("/transactions/t1")).toBe(true);
    expect(isFollowDetail("/stats")).toBe(false);
    expect(destinationOf("/transactions/t1")).toBe("entries");
    expect(destinationOf("/stats/cards/c1")).toBe("insights");
    expect(destinationOf("/books/b1/settings/categories")).toBe("ledger");
    expect(destinationOf("/settings/appearance")).toBe("me");
    expect(destinationOf("/add")).toBeNull();
  });

  it("登录、注册、公开法律文本与分享链接不显示工作区外壳", () => {
    expect(isStandalonePath("/login")).toBe(true);
    expect(isStandalonePath("/join/abc")).toBe(true);
    expect(isStandalonePath("/legal/privacy-policy")).toBe(true);
    expect(isStandalonePath("/legal/privacy")).toBe(false);
    expect(isStandalonePath("/")).toBe(false);
  });
});
