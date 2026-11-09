import { describe, expect, it } from "vitest";
import { claimDailyFillNotice, localDay } from "./fill.js";

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe("自动下载提示每个自然日只出现一次", () => {
  it("同一天第二次自动下载不再提示，第二天又可以", () => {
    const storage = memory();
    expect(claimDailyFillNotice(new Date(2026, 10, 9, 8), storage)).toBe(true);
    expect(claimDailyFillNotice(new Date(2026, 10, 9, 23, 59), storage)).toBe(false);
    expect(claimDailyFillNotice(new Date(2026, 10, 10, 0, 1), storage)).toBe(true);
  });
  it("按本地日期划分", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
  it("存储读写失败时照常提示", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(claimDailyFillNotice(new Date(2026, 10, 9), broken)).toBe(true);
    expect(claimDailyFillNotice(new Date(2026, 10, 9), null)).toBe(true);
  });
});
