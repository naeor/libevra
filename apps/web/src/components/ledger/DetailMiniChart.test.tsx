import { describe, expect, it } from "vitest";
import { miniSeries, netSeries, type MiniEntry } from "./DetailMiniChart.js";
const entry = (date: string, minor: string, categoryId = "a"): MiniEntry => ({ occurredLocalDate: date, minor, categoryId, categoryName: categoryId, currency: "CNY", kind: "expense" });
describe("主页单色图表口径", () => {
  it("净收支按同一分桶相减，支持负值、大整数并保留全范围合计", () => {
    const entries = [entry("2026-01-01", "90071992547409931"), { ...entry("2026-12-31", "90071992547409932"), kind: "income" as const }];
    const rows = netSeries(entries, "2026-01-01", "2026-12-31");
    expect(rows.reduce((sum, r) => sum + r.amount, 0n)).toBe(1n);
    expect(rows[0]?.amount).toBe(-90071992547409931n);
    expect(rows.at(-1)?.amount).toBe(90071992547409932n);
  });
  it("补齐无交易日期，保持大整数精度", () => {
    const rows = miniSeries("expenseTrend", [entry("2026-01-01", "90071992547409931"), entry("2026-01-01", "2")], "2026-01-01", "2026-01-03");
    expect(rows.map(r => r.amount)).toEqual([90071992547409933n, 0n, 0n]);
  });
  it("分桶保留全部金额且排除时间外和收入", () => {
    const rows = miniSeries("expenseBars", [entry("2026-01-01", "1"), entry("2026-12-31", "9"), entry("2025-01-01", "100"), { ...entry("2026-03-01", "200"), kind: "income" }], "2026-01-01", "2026-12-31");
    expect(rows.length).toBeLessThanOrEqual(31); expect(rows.reduce((s, r) => s + r.amount, 0n)).toBe(10n);
  });
  it("排行按分类合并后取前三，金额相同稳定排序", () => {
    const rows = miniSeries("categoryRank", [entry("2026-01-01", "50", "a"), entry("2026-01-01", "51", "b"), entry("2026-01-01", "50", "a"), entry("2026-01-01", "1", "c"), entry("2026-01-01", "0", "d")], "2026-01-01", "2026-01-31");
    expect(rows).toEqual([{label:"a",amount:100n},{label:"b",amount:51n},{label:"c",amount:1n}]);
  });
});
