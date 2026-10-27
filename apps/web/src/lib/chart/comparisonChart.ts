import type {
  ComparisonMetric,
  ComparisonResult,
  MonthComparisonPoint,
  MultiMonthComparisonResult,
} from "@libellum/shared";

import { createLinearScale, extentOf, niceDomain, ticksFor, type LinearScale } from "./scales.js";

/**
 * **What this module is.** The input layer shared by the A01/A04 comparison
 * charts: it turns the authoritative shared results into plain numbers, pixel
 * positions and bar rectangles. The authoritative amounts stay strings
 * (decimal minor units) in the source result and are only converted for
 * geometry — the chart never recomputes a total.
 *
 * **The contract it must keep** (owner §19–§23, protocol v1):
 * 1. A side whose coverage is unknown is drawn as *no bar*, never as a zero
 *    height rectangle — "no data" and "zero" are different heights.
 * 2. The two sides of a comparison always use the same y scale so the bars are
 *    visually comparable; a chart that rescales one side lies.
 * 3. A04 keeps every selected month explicit and keeps the year in labels;
 *    incomplete months are drawn hollow (not filled), never silently normal.
 */

export interface ComparisonBox {
  readonly width: number;
  readonly height: number;
  readonly padding: ComparisonPadding;
}

export interface ComparisonPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface GroupedBarRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ComparisonSide = "current" | "previous";

export interface ComparisonBarGroup {
  readonly metric: ComparisonMetric;
  /** Screen values; `null` when that side's amount is unknown. */
  readonly currentValue: number | null;
  readonly previousValue: number | null;
  /** Authoritative exact amounts for tooltips and labels. */
  readonly currentMinor: string | null;
  readonly previousMinor: string | null;
  /** True when both observation windows are fully covered by known data. */
  readonly complete: boolean;
}

export interface ComparisonBarsModel {
  readonly box: ComparisonBox;
  readonly groups: readonly ComparisonBarGroup[];
  readonly groupWidth: number;
  readonly barWidth: number;
  readonly yDomain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly scale: LinearScale;
  readonly zeroY: number;
  readonly hasNegative: boolean;
  readonly empty: boolean;
}

export interface MonthBar {
  /** `YYYY-MM`; the label layer keeps the year visible (owner §22). */
  readonly monthKey: string;
  /** Screen value; `null` when the month is unknown or unavailable. */
  readonly value: number | null;
  /** Authoritative exact amount, `null` when unknown. */
  readonly valueMinor: string | null;
  readonly state: MonthComparisonPoint["state"];
  /** Only complete months are comparable (filled bars). */
  readonly comparable: boolean;
}

export interface MonthComparisonModel {
  readonly box: ComparisonBox;
  readonly bars: readonly MonthBar[];
  readonly slotWidth: number;
  readonly barWidth: number;
  readonly yDomain: readonly [number, number];
  readonly ticks: readonly number[];
  readonly scale: LinearScale;
  readonly zeroY: number;
  readonly hasNegative: boolean;
  readonly empty: boolean;
}

const DEFAULT_PADDING: ComparisonPadding = { top: 12, right: 12, bottom: 24, left: 44 };

/** Integer minor units to a finite screen number; anything else is "unknown". */
function toNumber(minor: string | null): number | null {
  if (minor === null) return null;
  const value = Number(minor);
  return Number.isFinite(value) ? value : null;
}

function innerWidth(box: ComparisonBox): number {
  return Math.max(0, box.width - box.padding.left - box.padding.right);
}

function innerHeight(box: ComparisonBox): number {
  return Math.max(0, box.height - box.padding.top - box.padding.bottom);
}

/** Domain/ticks shared by both comparison charts (always includes zero). */
function vertical(
  box: ComparisonBox,
  values: readonly (number | null)[],
): { domain: readonly [number, number]; ticks: readonly number[]; scale: LinearScale; zeroY: number } {
  const extent = extentOf(values.filter((value): value is number => value !== null));
  const domain = niceDomain(extent?.[0] ?? 0, extent?.[1] ?? 0, 4);
  const height = innerHeight(box);
  const scale = createLinearScale(
    [domain[0], domain[1]],
    [box.padding.top + height, box.padding.top],
  );
  return { domain, ticks: ticksFor(domain, 4), scale, zeroY: scale(0) };
}

/**
 * Grouped bars for A01/A02/A03/A05: one group per flow metric (expense,
 * income) with a current bar and a comparison bar side by side.
 */
export function buildComparisonBarsModel(
  result: ComparisonResult,
  box: ComparisonBox,
): ComparisonBarsModel {
  const groups: ComparisonBarGroup[] = [
    {
      metric: "expense",
      currentValue: toNumber(result.expense.currentMinor),
      previousValue: toNumber(result.expense.previousMinor),
      currentMinor: result.expense.currentMinor,
      previousMinor: result.expense.previousMinor,
      complete: result.expense.complete,
    },
    {
      metric: "income",
      currentValue: toNumber(result.income.currentMinor),
      previousValue: toNumber(result.income.previousMinor),
      currentMinor: result.income.currentMinor,
      previousMinor: result.income.previousMinor,
      complete: result.income.complete,
    },
  ];
  const values = groups.flatMap((group) => [group.currentValue, group.previousValue]);
  const { domain, ticks, scale, zeroY } = vertical(box, values);
  const width = innerWidth(box);
  const groupWidth = groups.length === 0 ? 0 : width / groups.length;
  const barWidth = Math.max(6, Math.min(20, groupWidth * 0.28));
  const hasNegative = values.some((value) => value !== null && value < 0);
  const empty = values.every((value) => value === null);
  return {
    box,
    groups,
    groupWidth,
    barWidth,
    yDomain: domain,
    ticks,
    scale,
    zeroY,
    hasNegative,
    empty,
  };
}

/** Bar rectangle for one side of one group; anchors on the zero line. */
export function comparisonBarRect(
  model: ComparisonBarsModel,
  groupIndex: number,
  side: ComparisonSide,
): GroupedBarRect | null {
  const group = model.groups[groupIndex];
  if (group === undefined) return null;
  const value = side === "current" ? group.currentValue : group.previousValue;
  if (value === null) return null;
  const center = model.box.padding.left + model.groupWidth * (groupIndex + 0.5);
  const x =
    side === "current"
      ? center - model.barWidth - 2
      : center + 2;
  const y = model.scale(value);
  const top = Math.min(y, model.zeroY);
  const height = Math.max(value === 0 ? 0 : 1, Math.abs(model.zeroY - y));
  return { x, y: top, width: model.barWidth, height };
}

/**
 * Bars for A04: each selected natural month is one bar, in the caller's order
 * (chronological by default). Incomplete months are not filled.
 */
export function buildMonthComparisonModel(
  result: MultiMonthComparisonResult,
  box: ComparisonBox,
): MonthComparisonModel {
  const bars: MonthBar[] = result.months.map((month) => ({
    monthKey: month.month,
    value: toNumber(month.amountMinor),
    valueMinor: month.amountMinor,
    state: month.state,
    comparable: month.comparable,
  }));
  const { domain, ticks, scale, zeroY } = vertical(
    box,
    bars.map((bar) => bar.value),
  );
  const width = innerWidth(box);
  const slotWidth = bars.length === 0 ? 0 : width / bars.length;
  const barWidth = Math.max(4, Math.min(28, slotWidth * 0.6));
  const hasNegative = bars.some((bar) => bar.value !== null && bar.value < 0);
  return {
    box,
    bars,
    slotWidth,
    barWidth,
    yDomain: domain,
    ticks,
    scale,
    zeroY,
    hasNegative,
    empty: bars.every((bar) => bar.value === null),
  };
}

/** Bar rectangle for one month, anchored on the zero line. */
export function monthBarRect(model: MonthComparisonModel, index: number): GroupedBarRect | null {
  const bar = model.bars[index];
  if (bar === undefined || bar.value === null) return null;
  const x = model.box.padding.left + model.slotWidth * (index + 0.5) - model.barWidth / 2;
  const y = model.scale(bar.value);
  const top = Math.min(y, model.zeroY);
  const height = Math.max(bar.value === 0 ? 0 : 1, Math.abs(model.zeroY - y));
  return { x, y: top, width: model.barWidth, height };
}

export { DEFAULT_PADDING as COMPARISON_DEFAULT_PADDING };
