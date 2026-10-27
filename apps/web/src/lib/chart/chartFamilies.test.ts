import { describe, expect, it } from "vitest";
import {
  CHART_FAMILIES,
  assertFamilyShape,
  chartFamily,
  familiesFittingBox,
  familiesForShape,
  familySupportsState,
  needsLegend,
  type ChartResultShape,
} from "./chartFamilies.js";

/**
 * B-5 chart family registry tests (spec §40.5 "图表一致性、多尺寸、CF-B12–B15
 * 适配"). These assert the registry stays complete and consistent, not how a
 * component draws pixels (that is covered by the component tests).
 */
describe("chart family registry", () => {
  it("covers exactly the fifteen B families with unique ids", () => {
    const ids = CHART_FAMILIES.map((family) => family.id);
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);
    for (let index = 1; index <= 15; index += 1) {
      expect(ids).toContain(`CF-B${String(index).padStart(2, "0")}`);
    }
  });

  it("every family declares a component, result shape and minimum size", () => {
    for (const family of CHART_FAMILIES) {
      expect(family.component.length).toBeGreaterThan(0);
      expect(family.minSize.width).toBeGreaterThan(0);
      expect(family.minSize.height).toBeGreaterThan(0);
      expect(family.requires.length).toBeGreaterThan(0);
      expect(family.states.length).toBeGreaterThan(0);
      expect(family.responsibility.length).toBeGreaterThan(0);
    }
  });

  it("advanced families CF-B12..CF-B15 are adapted by distinct components", () => {
    expect(chartFamily("CF-B12").component).toBe("MovingAverageChart.tsx");
    expect(chartFamily("CF-B13").component).toBe("VolatilityBandChart.tsx");
    expect(chartFamily("CF-B14").component).toBe("SeasonalComparisonChart.tsx");
    expect(chartFamily("CF-B15").component).toBe("AnomalyMarkerChart.tsx");
    expect(chartFamily("CF-B12").resultShape).toBe("moving-average");
    expect(chartFamily("CF-B13").resultShape).toBe("variability");
    expect(chartFamily("CF-B14").resultShape).toBe("seasonal");
    expect(chartFamily("CF-B15").resultShape).toBe("anomaly");
  });

  it("rejects unknown families with a clear error", () => {
    expect(() => chartFamily("CF-B99")).toThrow(RangeError);
    expect(() => chartFamily("not-a-family")).toThrow(/unknown chart family/);
  });

  it("maps result shapes to renderable families", () => {
    const shapes: ChartResultShape[] = [
      "time-series",
      "moving-average",
      "multi-series",
      "calendar-heatmap",
      "period-comparison",
      "composition",
      "variability",
      "seasonal",
      "anomaly",
    ];
    for (const shape of shapes) {
      expect(familiesForShape(shape).length).toBeGreaterThan(0);
    }
    expect(familiesForShape("time-series").map((family) => family.id)).toEqual([
      "CF-B01",
      "CF-B02",
      "CF-B03",
      "CF-B07",
      "CF-B09",
      "CF-B11",
    ]);
    expect(familiesForShape("period-comparison").map((family) => family.id)).toEqual(["CF-B10"]);
  });

  it("filters families by readable card size (spec §32)", () => {
    const tiny = familiesFittingBox({ width: 96, height: 48 });
    expect(tiny.map((family) => family.id)).toEqual(["CF-B07"]);
    const wide = familiesFittingBox({ width: 320, height: 160 });
    expect(wide.length).toBe(15);
    const tallButNarrow = familiesFittingBox({ width: 240, height: 160 });
    expect(tallButNarrow.some((family) => family.id === "CF-B14")).toBe(false);
  });

  it("declares which data states each family can express", () => {
    expect(familySupportsState("CF-B08", "unknown")).toBe(true);
    expect(familySupportsState("CF-B08", "future")).toBe(false);
    expect(familySupportsState("CF-B12", "in-progress")).toBe(true);
    expect(familySupportsState("CF-B13", "future")).toBe(false);
    expect(() => familySupportsState("CF-B99", "complete")).toThrow(RangeError);
  });

  it("legend requirement is explicit for multi-series families", () => {
    expect(needsLegend("CF-B04")).toBe(true);
    expect(needsLegend("CF-B12")).toBe(true);
    expect(needsLegend("CF-B15")).toBe(false);
  });

  it("assertFamilyShape rejects results missing required fields", () => {
    expect(() => assertFamilyShape("CF-B13", { points: [], mean: "0" })).toThrow(
      /requires result\.standardDeviation/,
    );
    expect(() => assertFamilyShape("CF-B13", { points: [], mean: "0", standardDeviation: "0" })).not.toThrow();
  });
});
