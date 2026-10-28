import { describe, expect, it } from "vitest";

import { cardRange, cardSubtitle } from "./cards.js";
import { buildCard } from "./customCards.js";
import { newCard } from "./defaults.js";
import { readComposition, slotCard } from "./composition.js";
import type { WorkbenchScope } from "./scope.js";
import { cardWindow, resolveWindow, withWindow } from "./timeWindows.js";
import { t as translate } from "../i18n/index.js";

const scope = { today: "2026-10-28", range: { from: "2026-09-29", to: "2026-10-28" } } as unknown as WorkbenchScope;

describe("相对时间窗口：按今天解析（手算）", () => {
  // 2026-10-28 是星期三。
  it("最近 7 个完整自然日：10/21–10/27（不含今天）", () => {
    expect(resolveWindow("last-7-days", "2026-10-28")).toEqual({ from: "2026-10-21", to: "2026-10-27" });
  });
  it("本月至今：10/1–10/28；上个月：9/1–9/30", () => {
    expect(resolveWindow("month-to-date", "2026-10-28")).toEqual({ from: "2026-10-01", to: "2026-10-28" });
    expect(resolveWindow("previous-month", "2026-10-28")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("最近 4 个完整自然周：止于上一个周日 10/25，共 28 天（9/28 周一起）", () => {
    expect(resolveWindow("last-4-weeks", "2026-10-28")).toEqual({ from: "2026-09-28", to: "2026-10-25" });
    // 今天是周日：本周还没结束，止于上一个周日。
    expect(resolveWindow("last-4-weeks", "2026-10-25")).toEqual({ from: "2026-09-21", to: "2026-10-18" });
    // 今天是周一：昨天（周日）就是最近一个完整周的最后一天。
    expect(resolveWindow("last-4-weeks", "2026-10-26").to).toBe("2026-10-25");
  });
  it("最近 6 / 12 个完整自然月：不含本月；跨年与闰年 2 月正确", () => {
    expect(resolveWindow("last-6-months", "2026-10-28")).toEqual({ from: "2026-04-01", to: "2026-09-30" });
    expect(resolveWindow("last-12-months", "2026-10-28")).toEqual({ from: "2025-10-01", to: "2026-09-30" });
    expect(resolveWindow("last-6-months", "2028-03-05")).toEqual({ from: "2027-09-01", to: "2028-02-29" });
  });
});

describe("相对时间窗口：存在卡片上、优先于顶部筛选、随组合槽位走", () => {
  it("写在 chart.options.window，不改其它键；设置窗口时去掉固定区间", () => {
    const pinned = { ...newCard("AN-B01", "c1"), rangePolicy: "pinned" as const, pinnedRange: { from: "2026-01-01", to: "2026-01-31" } };
    const windowed = withWindow(pinned, "month-to-date");
    expect(cardWindow(windowed)).toBe("month-to-date");
    expect(windowed.rangePolicy).toBe("inherit");
    expect(windowed.pinnedRange).toBeUndefined();
    expect(cardWindow(withWindow(windowed, null))).toBeNull();
  });

  it("cardRange 用窗口而不是顶部筛选；副标题写明窗口与实际日期", () => {
    const card = withWindow(newCard("AN-B01", "c2"), "last-7-days");
    expect(cardRange(card, scope)).toEqual({ from: "2026-10-21", to: "2026-10-27" });
    expect(cardSubtitle(card, scope, translate)).toContain("最近 7 天");
  });

  it("组合卡片：窗口由整张卡片共享，每个槽位按同一段日期读取；组合配置保留", () => {
    const built = buildCard({ template: "T1", slots: [{ id: "s1", analysisId: "AN-B01", family: "number" }, { id: "s2", analysisId: "AN-B02", family: "number" }], name: "", window: "previous-month" }, undefined, "combo")!;
    expect(cardWindow(built)).toBe("previous-month");
    expect(readComposition(built).template).toBe("T1");
    const slot = slotCard(built, readComposition(built).slots[1]!);
    expect(cardRange(slot, scope)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("编辑时改回跟随顶部筛选：去掉窗口", () => {
    const built = buildCard({ template: "single", slots: [{ id: "s1", analysisId: "AN-B01", family: "number" }], name: "", window: "month-to-date" }, undefined, "single")!;
    const back = buildCard({ template: "single", slots: [{ id: "s1", analysisId: "AN-B01", family: "number" }], name: "" }, built)!;
    expect(cardWindow(back)).toBeNull();
    expect(cardRange(back, scope)).toEqual(scope.range);
  });
});
