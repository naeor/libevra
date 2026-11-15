import { describe, expect, it } from "vitest";
import { temporaryWidth } from "./temporaryGeometry.js";

describe("宿主拆分条件", () => {
  it("单区筛选以 460 为上限，短任务、编辑和详情各自保留原理想宽度", () => {
    expect(temporaryWidth("filter", 1134, 1024, 1134, false)).toBe(460);
    expect(temporaryWidth("short", 1134, 1024, 1134, false)).toBe(320);
    expect(temporaryWidth("editor", 1134, 1024, 1134, false)).toBe(470);
    expect(temporaryWidth("detail", 1134, 1024, 1134, false)).toBe(440);
  });

  it("双区筛选取宿主的 48% 且不超过 420，竖排和副区使用自己的矩形", () => {
    expect(temporaryWidth("filter", 828, 1012, 1298, true)).toBe(397);
    expect(temporaryWidth("filter", 866, 1012, 1298, true)).toBe(416);
    expect(temporaryWidth("filter", 754, 644, 766, true)).toBe(362);
    expect(temporaryWidth("filter", 1030, 1012, 1670, true)).toBe(420);
    expect(temporaryWidth("editor", 1030, 1012, 1670, true)).toBe(420);
    expect(temporaryWidth("detail", 1030, 1012, 1670, true)).toBe(420);
  });

  it("空间不足回退；较短的任务仍可使用原来的紧凑列", () => {
    expect(temporaryWidth("filter", 511, 756, 956, true)).toBe(0);
    expect(temporaryWidth("editor", 690, 810, 1112, true)).toBe(0);
    expect(temporaryWidth("short", 690, 810, 1112, true)).toBe(297);
  });

  it("考虑应用占比、纵横比、进出滞回与最小宿主正文", () => {
    expect(temporaryWidth("filter", 700, 700, 1800, true)).toBe(0);
    expect(temporaryWidth("filter", 700, 1250, 730, false)).toBe(0);
    expect(temporaryWidth("filter", 700, 550, 730, true)).toBe(336);
    expect(temporaryWidth("filter", 674, 700, 1000, true)).toBe(0);
    expect(temporaryWidth("filter", 674, 700, 1000, true, true)).toBe(332);
    expect(temporaryWidth("filter", 650, 700, 1000, true, true)).toBe(0);
    expect(temporaryWidth("editor", 716, 700, 900, true, true)).toBe(360);
  });
});
