import { describe, expect, it } from "vitest";

import { noExpenseStreaksOf, type NoExpenseDay } from "./streaks.js";

const day = (date: string, state: NoExpenseDay["state"]): NoExpenseDay => ({ date, state });

describe("A15 连续无支出记录天数", () => {
  it("只有确认无支出的日期连成段；未知与有支出都会中断，未来不延长当前段", () => {
    const result = noExpenseStreaksOf([
      day("2026-10-01", "none"),
      day("2026-10-02", "none"),
      day("2026-10-03", "spent"),
      day("2026-10-04", "none"),
      day("2026-10-05", "unknown"),
      day("2026-10-06", "none"),
      day("2026-10-07", "none"),
      day("2026-10-08", "none"),
      day("2026-10-09", "future"),
    ]);
    expect(result.longest).toEqual({ from: "2026-10-06", to: "2026-10-08", days: 3 });
    expect(result.current).toEqual({ from: "2026-10-06", to: "2026-10-08", days: 3 });
    expect(result.streaks.map((streak) => streak.days)).toEqual([3, 2, 1]);
    expect(result).toMatchObject({ confirmedNoneDays: 6, spentDays: 1, unknownDays: 1, futureDays: 1 });
  });

  it("最后一个已发生日有支出时没有当前段；没有确认的无支出日时最长段为空", () => {
    expect(noExpenseStreaksOf([day("2026-10-01", "none"), day("2026-10-02", "spent")]).current).toBeNull();
    const none = noExpenseStreaksOf([day("2026-10-01", "unknown"), day("2026-10-02", "spent")]);
    expect(none.longest).toBeNull();
    expect(none.streaks).toEqual([]);
  });

  it("同天数的连续段按开始日期排序；拒绝乱序与重复日期", () => {
    const tie = noExpenseStreaksOf([day("2026-10-01", "none"), day("2026-10-02", "spent"), day("2026-10-03", "none")]);
    expect(tie.longest?.from).toBe("2026-10-01");
    expect(() => noExpenseStreaksOf([day("2026-10-02", "none"), day("2026-10-01", "none")])).toThrow(RangeError);
    expect(() => noExpenseStreaksOf([day("2026-10-01", "none"), day("2026-10-01", "none")])).toThrow(RangeError);
    expect(() => noExpenseStreaksOf([day("2026-1-01", "none")])).toThrow(RangeError);
  });
});
