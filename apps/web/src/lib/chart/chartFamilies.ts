/**
 * Chart family registry — B-5 deliverable.
 *
 * The card layer (CF-01..CF-11 in the design spec, analysis families
 * CF-B01..CF-B15) needs one place that says, for every chart family this
 * agent delivers:
 *
 * - which analysis result shape it consumes (S-01 draft shapes, section
 *   `docs/specs/product/s17-agents/S17-Agent-B-S01-时间扩展协议草案.md`);
 * - which web component renders it;
 * - which result fields are required (a missing field is a programming error,
 *   not a silent empty chart);
 * - which data states it can express (complete / in-progress / unknown /
 *   future) so the card layer can decide whether a "current period" badge or
 *   an "incomplete" note is needed;
 * - minimum readable size and legend/series capabilities, so the grid can
 *   reject a family for a card size instead of shrinking labels forever
 *   (spec §32);
 * - whether the family supports negative values and multiple series.
 *
 * B-5 adapts CF-B12 (moving average), CF-B13 (volatility band), CF-B14
 * (seasonal comparison) and CF-B15 (anomaly marks); they were already rendered
 * by `MovingAverageChart` / `VolatilityBandChart` /
 * `SeasonalComparisonChart` / `AnomalyMarkerChart` in B-4. This registry makes
 * their capabilities explicit and testable instead of implicit in JSX.
 *
 * Keep this file ASCII-only: it is data, not UI copy (labels come from i18n
 * keys in the card layer).
 */

/** Analysis result shapes produced by this agent (S-01 draft shape names). */
export type ChartResultShape =
  | "time-series"
  | "moving-average"
  | "multi-series"
  | "calendar-heatmap"
  | "period-comparison"
  | "composition"
  | "variability"
  | "seasonal"
  | "anomaly";

/** Data states a family can express without lying about completeness. */
export type FamilyDataState = "complete" | "in-progress" | "unknown" | "future";

export interface ChartFamilyDefinition {
  /** Family id from the owner spec (CF-B01..CF-B15). */
  readonly id: string;
  /** Short English name for docs/tests; UI copy comes from i18n. */
  readonly name: string;
  readonly resultShape: ChartResultShape;
  /** Web component file (charts/ directory) that renders this family. */
  readonly component: string;
  /** Required result fields; checked by `assertFamilyShape`. */
  readonly requires: readonly string[];
  /** States the component can express (it may also annotate others). */
  readonly states: readonly FamilyDataState[];
  readonly supportsNegative: boolean;
  readonly supportsMultiSeries: boolean;
  readonly needsLegend: boolean;
  /** Minimum readable layout box, in CSS pixels (spec §32 / design §13.6). */
  readonly minSize: { readonly width: number; readonly height: number };
  /** One-line responsibility, used in the B-5 acceptance mapping doc. */
  readonly responsibility: string;
}

const ALL_STATES: readonly FamilyDataState[] = ["complete", "in-progress", "unknown", "future"];

/**
 * B-owned families. Families CF-B01..CF-B11 are shared by B-1..B-4 and the
 * existing S15 stats components; CF-B12..CF-B15 are the "advanced" families
 * adapted in B-5.
 */
export const CHART_FAMILIES: readonly ChartFamilyDefinition[] = [
  {
    id: "CF-B01",
    name: "line trend",
    resultShape: "time-series",
    component: "SeriesTrendChart.tsx",
    requires: ["buckets", "metric", "granularity"],
    states: ALL_STATES,
    supportsNegative: false,
    supportsMultiSeries: false,
    needsLegend: false,
    minSize: { width: 240, height: 120 },
    responsibility: "single metric over time with gap breaks",
  },
  {
    id: "CF-B02",
    name: "area trend",
    resultShape: "time-series",
    component: "SeriesTrendChart.tsx",
    requires: ["buckets", "metric", "granularity"],
    states: ALL_STATES,
    supportsNegative: false,
    supportsMultiSeries: false,
    needsLegend: false,
    minSize: { width: 240, height: 120 },
    responsibility: "cumulative-feeling single metric area, zero baseline",
  },
  {
    id: "CF-B03",
    name: "grouped bars over time",
    resultShape: "time-series",
    component: "SeriesTrendChart.tsx",
    requires: ["buckets", "metric", "granularity"],
    states: ALL_STATES,
    supportsNegative: false,
    supportsMultiSeries: false,
    needsLegend: false,
    minSize: { width: 240, height: 120 },
    responsibility: "discrete day/week/month amounts, zero baseline",
  },
  {
    id: "CF-B04",
    name: "income vs expense grouped bars",
    resultShape: "multi-series",
    component: "IncomeExpenseBars.tsx",
    requires: ["points", "granularity"],
    states: ALL_STATES,
    supportsNegative: false,
    supportsMultiSeries: true,
    needsLegend: true,
    minSize: { width: 280, height: 160 },
    responsibility: "two series side by side on one shared bucket axis",
  },
  {
    id: "CF-B05",
    name: "stacked category bars",
    resultShape: "composition",
    component: "CategoryStackedBars.tsx",
    requires: ["buckets", "categoryIds"],
    states: ALL_STATES,
    supportsNegative: false,
    supportsMultiSeries: true,
    needsLegend: true,
    minSize: { width: 280, height: 160 },
    responsibility: "stacked parts summing to the bucket total",
  },
  {
    id: "CF-B06",
    name: "100% stacked category bands",
    resultShape: "composition",
    component: "CategoryShareBands.tsx",
    requires: ["buckets", "categoryIds"],
    states: ALL_STATES,
    supportsNegative: false,
    supportsMultiSeries: true,
    needsLegend: true,
    minSize: { width: 280, height: 120 },
    responsibility: "category share per bucket, no amounts on the y axis",
  },
  {
    id: "CF-B07",
    name: "sparkline",
    resultShape: "time-series",
    component: "Sparkline.tsx",
    requires: ["buckets"],
    states: ["complete", "in-progress"],
    supportsNegative: false,
    supportsMultiSeries: false,
    needsLegend: false,
    minSize: { width: 72, height: 32 },
    responsibility: "tiny trend hint; exact numbers live in the card header",
  },
  {
    id: "CF-B08",
    name: "calendar heatmap",
    resultShape: "calendar-heatmap",
    component: "CalendarHeatmapGrid.tsx",
    requires: ["days"],
    states: ["complete", "unknown"],
    supportsNegative: false,
    supportsMultiSeries: false,
    needsLegend: true,
    minSize: { width: 240, height: 120 },
    responsibility: "day-intensity grid, Monday-first, unknown days distinct",
  },
  {
    id: "CF-B09",
    name: "weekday bars",
    resultShape: "time-series",
    component: "WeekdayBars.tsx",
    requires: ["weekdays"],
    states: ["complete", "unknown"],
    supportsNegative: false,
    supportsMultiSeries: false,
    needsLegend: false,
    minSize: { width: 240, height: 140 },
    responsibility: "average by weekday, Monday-first, sample explained",
  },
  {
    id: "CF-B10",
    name: "period comparison card",
    resultShape: "period-comparison",
    component: "PeriodComparisonCard.tsx",
    requires: ["current", "previous", "comparisonMode"],
    states: ["complete", "in-progress", "unknown"],
    supportsNegative: true,
    supportsMultiSeries: false,
    needsLegend: false,
    minSize: { width: 220, height: 120 },
    responsibility: "two periods, difference and growth with explicit basis",
  },
  {
    id: "CF-B11",
    name: "cumulative trend",
    resultShape: "time-series",
    component: "CumulativeTrendChart.tsx",
    requires: ["buckets", "span"],
    states: ALL_STATES,
    supportsNegative: true,
    supportsMultiSeries: false,
    needsLegend: false,
    minSize: { width: 240, height: 120 },
    responsibility: "running total from an explicit baseline; unknown propagates",
  },
  {
    id: "CF-B12",
    name: "moving average",
    resultShape: "moving-average",
    component: "MovingAverageChart.tsx",
    requires: ["points", "windowDays"],
    states: ALL_STATES,
    supportsNegative: false,
    supportsMultiSeries: true,
    needsLegend: true,
    minSize: { width: 280, height: 140 },
    responsibility: "raw series plus trailing window average; gaps stay gaps",
  },
  {
    id: "CF-B13",
    name: "volatility band",
    resultShape: "variability",
    component: "VolatilityBandChart.tsx",
    requires: ["points", "mean", "standardDeviation"],
    states: ["complete", "unknown"],
    supportsNegative: true,
    supportsMultiSeries: false,
    needsLegend: true,
    minSize: { width: 280, height: 150 },
    responsibility: "per-bucket amount vs mean +/- band; exact fractions kept",
  },
  {
    id: "CF-B14",
    name: "seasonal comparison",
    resultShape: "seasonal",
    component: "SeasonalComparisonChart.tsx",
    requires: ["monthOfYear", "years"],
    states: ["complete", "in-progress", "unknown"],
    supportsNegative: false,
    supportsMultiSeries: true,
    needsLegend: true,
    minSize: { width: 300, height: 160 },
    responsibility: "same calendar month across years, incomplete year marked",
  },
  {
    id: "CF-B15",
    name: "anomaly marks",
    resultShape: "anomaly",
    component: "AnomalyMarkerChart.tsx",
    requires: ["points", "marks", "threshold"],
    states: ALL_STATES,
    supportsNegative: true,
    supportsMultiSeries: false,
    needsLegend: false,
    minSize: { width: 280, height: 140 },
    responsibility: "daily series with explicit deviation marks, no alarm copy",
  },
];

const BY_ID = new Map(CHART_FAMILIES.map((family) => [family.id, family]));

/** Look up one family; unknown id is a programming error. */
export function chartFamily(familyId: string): ChartFamilyDefinition {
  const family = BY_ID.get(familyId);
  if (family === undefined) throw new RangeError(`unknown chart family: ${familyId}`);
  return family;
}

/** All families that can render a result shape, registry order. */
export function familiesForShape(shape: ChartResultShape): readonly ChartFamilyDefinition[] {
  return CHART_FAMILIES.filter((family) => family.resultShape === shape);
}

/** Families that fit a card box (spec §32 minimum readable size). */
export function familiesFittingBox(
  box: { readonly width: number; readonly height: number },
): readonly ChartFamilyDefinition[] {
  return CHART_FAMILIES.filter(
    (family) => family.minSize.width <= box.width && family.minSize.height <= box.height,
  );
}

/** True when the family understands the given data state honestly. */
export function familySupportsState(familyId: string, state: FamilyDataState): boolean {
  return chartFamily(familyId).states.includes(state);
}

/**
 * Reject a broken result/component pairing before rendering: required fields
 * must be present (arrays may be empty, but the property must exist).
 */
export function assertFamilyShape(
  familyId: string,
  result: Readonly<Record<string, unknown>>,
): void {
  const family = chartFamily(familyId);
  for (const field of family.requires) {
    if (!(field in result)) {
      throw new RangeError(`chart family ${family.id} requires result.${field}`);
    }
  }
}

/** Families with the given result shape and a legend requirement. */
export function needsLegend(familyId: string): boolean {
  return chartFamily(familyId).needsLegend;
}
