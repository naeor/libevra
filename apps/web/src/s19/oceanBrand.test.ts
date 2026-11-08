import { describe, expect, it } from "vitest";
import { oceanBrandPresentation, type OceanBrandSize } from "./oceanBrand.js";

const sizes: OceanBrandSize[] = [320, 568, 844, 1024].map(height => ({ height, width: 390, shortHeight: Math.max(116, height * .15), brandHeight: 75, brandWidth: 170 }));

describe("品牌绘制读取海浪，不控制海浪", () => {
  it("B2 中央大字不随进度、潮汐或中途反向发生位移", () => {
    for (const size of sizes) {
      const centre = oceanBrandPresentation(0, 0, size).glassY;
      for (const p of [0, .25, .7, .42, 1, .8, 0]) {
        for (const seconds of [0, 3.5, 12, 28]) expect(oceanBrandPresentation(p, seconds, size).glassY).toBe(centre);
      }
    }
  });
  it("B1 小字必须等大字完全离开后才显现，短横屏也能完整交接", () => {
    for (const size of sizes) {
      for (let step = 0; step <= 100; step++) {
        const v = oceanBrandPresentation(step / 100, 7, size);
        if (v.porcelainCompact > 0) expect(v.printY + size.brandHeight / 2).toBeLessThan(0);
      }
      expect(oceanBrandPresentation(0, 7, size).porcelainCompact).toBe(0);
      expect(oceanBrandPresentation(1, 7, size).porcelainCompact).toBe(1);
    }
  });
  it("B2 小字欢迎态隐藏、上收末段才出现，往返同一位置没有计时残留", () => {
    for (const size of sizes) {
      expect(oceanBrandPresentation(0, 7, size).glassCompact).toBe(0);
      expect(oceanBrandPresentation(.5, 7, size).glassCompact).toBe(0);
      expect(oceanBrandPresentation(1, 7, size).glassCompact).toBe(1);
      const midpoint = oceanBrandPresentation(.87, 7, size);
      oceanBrandPresentation(1, 7, size);
      expect(oceanBrandPresentation(.87, 7, size)).toEqual(midpoint);
    }
  });
  it("B1 大字跟随 1 号层自己的进度；B2 大字在列表内容到达前退场", () => {
    for (const size of sizes) {
      const lagging = oceanBrandPresentation(.6, 7, size, { first: .4, last: .3 });
      const even = oceanBrandPresentation(.6, 7, size);
      expect(lagging.printY).toBeGreaterThan(even.printY);
      expect(oceanBrandPresentation(0, 7, size).glassReveal).toBe(1);
      expect(oceanBrandPresentation(1, 7, size).glassReveal).toBe(0);
      // 列表内容（含 4 号层的落差 contentLag）不论走到哪里，大字都不能与它重叠：内容上沿进入大字下缘 6px 内时显现度必须为 0。
      for (let p = 0; p <= 1.0001; p += .02) for (let last = Math.max(0, p - .35); last <= p + .001; last += .05) {
        const v = oceanBrandPresentation(p, 7, size, { first: Math.min(1, p + .05), last });
        const sea = size.height * .8 * (1 - p) + size.shortHeight * p;
        const lag = 1.12 * (size.height * .8 - size.shortHeight) * Math.max(0, p - last);
        const contentTop = sea + size.height * .2 * (1 - p) + Math.max(24, sea * .07) + lag;
        if (contentTop < v.glassY + size.brandHeight / 2 + 6) expect(v.glassReveal).toBeLessThan(.001);
      }
    }
  });
});
