import { describe, expect, it } from "vitest";
import { readStatsView, updateStatsView } from "./statsView.js";

describe("分析导航上下文", () => {
  it("反复切换只改变模式，月份、币种与分类收支保持", () => {
    let params = new URLSearchParams("month=2026-02&range=90d&currency=JPY&kind=income&heat=7d");
    for (let index = 0; index < 10; index++) {
      params = updateStatsView(params, { analysis: index % 2 ? "combined" : "currency" });
      expect(readStatsView(params)).toMatchObject({ month: "2026-02", currency: "JPY", kind: "income", preset: "90d", heatRange: "7d" });
    }
    expect(readStatsView(new URLSearchParams(params.toString()))).toEqual(readStatsView(params));
  });
  it("切换相对日期只清除指定月，不清空币种或收支", () => {
    const before = new URLSearchParams("month=2026-02&currency=USD&kind=income&analysis=currency");
    const after = updateStatsView(before, { range: "7d", month: null });
    expect(readStatsView(after)).toMatchObject({ combined: false, month: "", preset: "7d", currency: "USD", kind: "income" });
    expect(before.get("month")).toBe("2026-02");
  });
  it("无效深链参数回退，不交给金额查询", () => {
    expect(readStatsView(new URLSearchParams("month=2026-13&range=all&currency=BAD&kind=transfer"))).toMatchObject({ combined: true, month: "", preset: "30d", currency: null, kind: "expense" });
    expect(readStatsView(new URLSearchParams("month=0000-01")).month).toBe("");
  });
});
