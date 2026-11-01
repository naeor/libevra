import { describe, expect, it } from "vitest";
import { placementCells, placementFitsColumns } from "@libellum/shared/analysis/layout";
import { dashboardGeometry, defaultDashboard, parseDashboard, placeDashboardCard, resolveDashboard, updateCard } from "./dashboardModel.js";
import { dashboardAnalysisCard, dashboardDestination } from "./dashboardNavigation.js";
import { readFilters } from "../statsWorkbench/filters.js";
import { cardType } from "../statsWorkbench/catalog.js";
import { clearAllMessageDrafts, messageDraftScope, readMessageDraft, updateMessageDraft } from "../lib/messageDrafts.js";

function expectValid(geometry: ReturnType<typeof dashboardGeometry>): void {
  const used = new Set<number>();
  for (const object of geometry.objects) {
    expect(placementFitsColumns(object.anchor, object, geometry.baseCols)).toBe(true);
    for (const cell of placementCells(object.anchor, object, geometry.baseCols)) {
      expect(used.has(cell)).toBe(false);
      used.add(cell);
    }
  }
}

describe("Dashboard 自由占格与旧配置兼容", () => {
  it("移动到占用区域、双向缩放后仍无覆盖；原配置不变", () => {
    const config = defaultDashboard(["a", "b"]);
    const original = JSON.stringify(config);
    const geometry = dashboardGeometry(config, 6);
    const first = geometry.objects[0]!;
    const moved = placeDashboardCard(config, 6, { ...first, anchor: 19, colSpan: 4, rowSpan: 5 });
    expect(moved.layout?.objects.find((item) => item.objectId === first.objectId)).toMatchObject({ anchor: 19, colSpan: 4, rowSpan: 5 });
    expectValid(moved.layout!);
    expect(JSON.stringify(config)).toBe(original);
    const resized = placeDashboardCard(moved, 6, { ...first, colSpan: 2, rowSpan: 2 });
    expectValid(resized.layout!);
    expect(resized.layout?.objects.find((item) => item.objectId === first.objectId)).toMatchObject({ colSpan: 2, rowSpan: 2 });
  });

  it("窗口收窄只派生排布，重新展开恢复保存位置", () => {
    const config = defaultDashboard(["a", "b", "c"]);
    const base = dashboardGeometry(config, 8);
    const saved = { ...config, layout: base };
    const before = JSON.stringify(saved);
    for (const columns of [1, 2, 3, 4, 6]) expectValid(dashboardGeometry(saved, columns));
    expect(JSON.stringify(saved)).toBe(before);
    expect(dashboardGeometry(saved, 8)).toEqual(base);
  });

  it("保存与读回保留占格和显示选项；旧配置、损坏位置和退出账本安全补位", () => {
    const original = updateCard(defaultDashboard(["a", "b"]), "ledger:a", { showRecent: false, showTrend: false });
    const saved = { ...original, layout: dashboardGeometry(original, 6) };
    const restored = parseDashboard(JSON.parse(JSON.stringify(saved)))!;
    expect(restored).toEqual(saved);
    expectValid(dashboardGeometry(restored, 6));
    const old = parseDashboard({ version: 1, cards: [{ id: "ledger:a", kind: "ledger", bookId: "a", size: "expanded" }], crossScope: "all" })!;
    const merged = resolveDashboard(old, ["a", "c"]);
    expect(merged.cards.some((card) => card.id === "ledger:c")).toBe(true);
    expectValid(dashboardGeometry(merged, 4));
    const damaged = { ...saved, layout: { ...saved.layout, objects: saved.layout.objects.map((item) => ({ ...item, anchor: 1 })) } };
    expectValid(dashboardGeometry(parseDashboard(damaged)!, 6));
    const removed = resolveDashboard(restored, ["b"]);
    expect(dashboardGeometry(removed, 6).objects.some((item) => item.objectId === "ledger:a")).toBe(false);
  });

  it("隐藏再加回不丢配置，默认提供完整功能卡片", () => {
    const config = defaultDashboard(["a", "b"]);
    expect(config.cards.filter((card) => !card.hidden).map((card) => card.kind)).toEqual(expect.arrayContaining(["ledger", "cross", "recent", "pending", "quick", "trend"]));
    const hidden = updateCard(config, "ledger:a", { hidden: true });
    expect(dashboardGeometry(hidden, 6).objects.some((item) => item.objectId === "ledger:a")).toBe(false);
    expect(dashboardGeometry(updateCard(hidden, "ledger:a", { hidden: false }), 6)).toEqual(dashboardGeometry(config, 6));
  });
});

describe("Dashboard 跳转携带原图表上下文", () => {
  it("普通卡片进入指定月份明细；图表打开临时分析而不附加工作台卡片 ID", () => {
    expect(dashboardDestination("2026-10")).toBe("/?month=2026-10");
    const url = new URL(dashboardDestination("2026-10", "expense", "USD"), "http://localhost");
    expect(url.pathname).toBe("/stats");
    expect(url.searchParams.get("card")).toBeNull();
    const filters = readFilters(url.searchParams);
    expect(filters).toMatchObject({ time: { kind: "month", month: "2026-10" }, currency: "USD", combined: false });
    expect(dashboardAnalysisCard(url.searchParams.get("dashboardChart"))?.analysis.analysisId).toBe("AN-I06");
  });
  it("临时图表使用受支持的指标与展示类型，未知值不打开辅助栏", () => {
    expect(dashboardAnalysisCard("unknown")).toBeUndefined();
    for (const metric of ["expense", "income", "balance"]) {
      const card = dashboardAnalysisCard(metric)!;
      expect(cardType(card.analysis.analysisId)?.families).toContain(card.chart.chartFamily);
    }
  });
});

describe("独立留言区的草稿隔离", () => {
  it("切换面板保留同一账号同一本账的文字；其它账号或账本不继承", () => {
    clearAllMessageDrafts();
    const first = messageDraftScope("u1", "a");
    const otherBook = messageDraftScope("u1", "b");
    const otherUser = messageDraftScope("u2", "a");
    updateMessageDraft(first, { text: "这笔需要核对" });
    expect(readMessageDraft(first).text).toBe("这笔需要核对");
    expect(readMessageDraft(otherBook).text).toBe("");
    expect(readMessageDraft(otherUser).text).toBe("");
    updateMessageDraft(otherBook, { text: "另一本账的草稿" });
    updateMessageDraft(first, { text: "" });
    expect(readMessageDraft(otherBook).text).toBe("另一本账的草稿");
    clearAllMessageDrafts();
    expect(readMessageDraft(otherBook).text).toBe("");
  });
});
