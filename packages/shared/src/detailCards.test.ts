import { describe, expect, it } from "vitest";
import { detailCardSchema, mainDetailMetrics } from "./detailCards.js";
const base = { main: "overview", first: "balance", second: "daily" };
describe("首页卡片容量与兼容", () => {
  it("保留旧数字方案", () => expect(mainDetailMetrics(detailCardSchema.parse(base))).toEqual(["expense", "income"]));
  it.each([["expenseTrend"], ["income", "balance"], ["categoryRank"]].map(mainMetrics => ({ mainMetrics })))("支持主卡 %j", ({ mainMetrics }) => expect(detailCardSchema.safeParse({ ...base, mainMetrics }).success).toBe(true));
  it.each([["expenseTrend", "income"], ["incomeTrend", "expenseBars"], ["income", "income"], [], ["unknown"]].map(mainMetrics => ({ mainMetrics })))("拒绝超量和未知指标 %j", ({ mainMetrics }) => expect(detailCardSchema.safeParse({ ...base, mainMetrics }).success).toBe(false));
  it("副卡拒绝图表和未声明字段", () => { expect(detailCardSchema.safeParse({ ...base, first: "expenseTrend" }).success).toBe(false); expect(detailCardSchema.safeParse({ ...base, userId: "other" }).success).toBe(false); });
});
