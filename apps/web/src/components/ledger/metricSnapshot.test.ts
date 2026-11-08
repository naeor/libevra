import { describe, expect, it, vi } from "vitest";
import { keepMetricSnapshot, readMetricSnapshot, type MetricSnapshot } from "./metricSnapshot.js";
import { miniSeries } from "./DetailMiniChart.js";
import { dailyMinor } from "../../lib/detailCards.js";

const sample: MetricSnapshot = { owner: "owner", book: "book", pane: "pane", returnTo: "/?month=2026-11&category=food", metric: "daily",
  label: "2026-11", currency: "CNY", from: "2026-11-01", to: "2026-11-08", days: 8,
  values: { income: "0.00", expense: "153.50", balance: "−153.50", daily: "19.19" }, incomplete: false,
  entries: [{ kind: "expense", currency: "CNY", categoryId: "food", categoryName: "food", occurredLocalDate: "2026-11-01", minor: "15350" }] };
describe("汇总详情沿用来源上下文", () => {
  it("局域网 HTTP 没有 randomUUID 时仍可打开指标详情", () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    try {
      expect(readMetricSnapshot(keepMetricSnapshot(sample), "owner", "book", "pane")).toEqual(sample);
    } finally { vi.unstubAllGlobals(); }
  });
  it("保持已筛选金额、时间、币种与返回条件；图表精确合计与日均独立复算一致", () => {
    const value = readMetricSnapshot(keepMetricSnapshot(sample), "owner", "book", "pane")!;
    expect(value).toEqual(sample);
    expect(miniSeries("expenseTrend", value.entries, value.from, value.to).reduce((sum, point) => sum + point.amount, 0n)).toBe(15350n);
    expect(dailyMinor("15350", value.days!)).toBe("1919");
  });
  it("跨账号、账本、工作区和刷新后的无来源入口都不读取旧上下文", () => {
    const key = keepMetricSnapshot(sample);
    expect(readMetricSnapshot(key, "other", "book", "pane")).toBeUndefined();
    expect(readMetricSnapshot(key, "owner", "other", "pane")).toBeUndefined();
    expect(readMetricSnapshot(key, "owner", "book", "other")).toBeUndefined();
    expect(readMetricSnapshot(undefined, "owner", "book", "pane")).toBeUndefined();
  });
  it("上下文缓存有界，过期历史使用可解释的降级入口", () => {
    const old = keepMetricSnapshot(sample);
    for (let i = 0; i < 8; i++) keepMetricSnapshot(sample);
    expect(readMetricSnapshot(old, "owner", "book", "pane")).toBeUndefined();
  });
});
