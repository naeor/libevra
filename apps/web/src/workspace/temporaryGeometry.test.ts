import { describe, expect, it } from "vitest";
import { temporaryWidth } from "./temporaryGeometry.js";

describe("宿主拆分条件", () => {
  it("左右分屏保留可操作的明细与筛选宽度", () => {
    expect(temporaryWidth("filter", 870, 1012, 1298)).toBeGreaterThanOrEqual(332);
    expect(temporaryWidth("filter", 511, 756, 956)).toBe(0);
    expect(temporaryWidth("editor", 690, 810, 1112)).toBe(0);
    expect(temporaryWidth("short", 690, 810, 1112)).toBeGreaterThan(0);
  });
  it("考虑应用占比、纵横比、竖排双区和进出滞回", () => {
    expect(temporaryWidth("filter", 700, 700, 1800)).toBe(0);
    expect(temporaryWidth("filter", 700, 1250, 730)).toBe(0);
    expect(temporaryWidth("filter", 700, 550, 730)).toBeGreaterThan(0);
    expect(temporaryWidth("filter", 674, 700, 1000)).toBe(0);
    expect(temporaryWidth("filter", 674, 700, 1000, true)).toBe(332);
    expect(temporaryWidth("filter", 650, 700, 1000, true)).toBe(0);
  });
});
