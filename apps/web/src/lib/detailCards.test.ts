import { describe, expect, it } from "vitest";
import { dailyMinor, DEFAULT_DETAIL_CARDS, detailDayCount, parseDetailCards } from "./detailCards.js";

describe("明细展示卡片", () => {
  it.each([null, "bad", "null", "[]", "{}"])("无配置或损坏配置使用默认内容：%s", raw => {
    expect(parseDetailCards(raw)).toEqual(DEFAULT_DETAIL_CARDS);
  });
  it("按槽位恢复兼容配置，不丢弃仍支持的选项", () => {
    expect(parseDetailCards('{"main":"removed","first":"count","second":"income"}')).toEqual({ main: "overview", first: "count", second: "income" });
  });
  it.each([
    ["2024-02", "", "", "2026-11-01", 29],
    ["2026-10", "", "", "2026-11-01", 31],
    ["2026-11", "", "", "2026-11-09", 9],
    ["2026-12", "", "", "2026-11-09", null],
    ["all", "", "", "2026-11-09", null],
    ["all", "2026-10-30", "2026-11-03", "2026-11-01", 3],
    ["all", "2026-11-03", "2026-11-01", "2026-11-09", null],
  ])("日均采用已过去的自然日：%s %s %s", (month, from, to, today, expected) => {
    expect(detailDayCount(month, from, to, today)).toBe(expected);
  });
  it("按最小货币单位四舍五入，并保持大整数精度", () => {
    expect(dailyMinor("101", 2)).toBe("51");
    expect(dailyMinor("0", 31)).toBe("0");
    expect(dailyMinor("90071992547409930", 3)).toBe("30023997515803310");
  });
});
