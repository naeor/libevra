import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  computeDailyExpenseVariability,
  computeSeasonalComparison,
  computeTimeSeries,
  computeTrailingMovingAverage,
  detectDailyExpenseAnomalies,
  spanFromInclusiveDates,
  type TimeSeriesBucketPoint,
  type TimeSeriesEntry,
} from "@libellum/shared";

import { AnomalyMarkerChart } from "./AnomalyMarkerChart.js";
import { MovingAverageChart } from "./MovingAverageChart.js";
import { SeasonalComparisonChart } from "./SeasonalComparisonChart.js";
import { VolatilityBandChart } from "./VolatilityBandChart.js";

const CJK = /[\u4e00-\u9fff]/;
const TODAY = "2026-10-27";
const COVERAGE = "2026-10-27";
const SPAN = spanFromInclusiveDates("2026-09-01", "2026-10-27");

function entry(occurredLocalDate: string, kind: "expense" | "income", amountMinor: number): TimeSeriesEntry {
  return { occurredLocalDate, kind, amountMinor };
}

/** 2026-09-22 起 30 天：每天 100，第 21 天 5000（异常）。 */
function thirtyDays(): TimeSeriesEntry[] {
  const first = Date.UTC(2026, 8, 22);
  const entries: TimeSeriesEntry[] = [];
  for (let index = 0; index < 30; index += 1) {
    const date = new Date(first + index * 86_400_000).toISOString().slice(0, 10);
    entries.push(entry(date, "expense", index === 20 ? 5_000 : 100));
  }
  return entries;
}

const DAILY = computeTimeSeries(thirtyDays(), {
  metric: "expense",
  granularity: "day",
  span: SPAN,
  today: TODAY,
  coverageEnd: COVERAGE,
});

const DAILY_POINTS: readonly TimeSeriesBucketPoint[] = DAILY.buckets;

const MA = computeTrailingMovingAverage(DAILY_POINTS, { windowDays: 7 });
const VARIABILITY = computeDailyExpenseVariability(DAILY_POINTS);
const ANOMALY = detectDailyExpenseAnomalies(DAILY_POINTS, { minimumSampleDays: 5 });

const SEASONAL = computeSeasonalComparison(
  [
    entry("2025-03-15", "expense", 1_000),
    entry("2025-04-10", "expense", 2_000),
    entry("2026-03-05", "expense", 1_500),
    entry("2026-04-01", "expense", 3_000),
  ],
  {
    metric: "expense",
    span: { start: "2025-01-01", end: "2026-05-01" },
    today: "2026-05-01",
    coverageEnd: "2026-05-01",
  },
);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatAxis = (value: number): string => String(value);

function exactValue(point: TimeSeriesBucketPoint): string {
  return point.amountMinor === null ? "unknown" : `${point.amountMinor} minor`;
}

function exactMovingAverageValue(point: { readonly rawMinor: string | null }): string {
  return point.rawMinor === null ? "unknown" : `${point.rawMinor} minor`;
}

describe("MovingAverageChart", () => {
  it("draws raw and trailing-average lines with a legend", () => {
    const html = renderToStaticMarkup(
      <MovingAverageChart
        result={MA}
        title="Daily expense trend"
        labels={{ raw: "Daily", average: "7-day average" }}
        formatValue={exactMovingAverageValue}
        formatAxis={formatAxis}
      />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("Daily expense trend");
    expect(html).toContain("7-day average");
    expect(html).toContain("<path");
    expect(html).not.toMatch(CJK);
  });

  it("renders the notice instead of a chart when asked", () => {
    const html = renderToStaticMarkup(
      <MovingAverageChart
        result={MA}
        title="Daily expense trend"
        labels={{ raw: "Daily", average: "7-day average" }}
        formatValue={exactMovingAverageValue}
        formatAxis={formatAxis}
        notice="No spending data in this range."
      />,
    );
    expect(html).not.toContain("<svg");
    expect(html).toContain("No spending data in this range.");
    expect(html).not.toMatch(CJK);
  });
});

describe("VolatilityBandChart", () => {
  it("draws the daily line, the mean line and the band", () => {
    const html = renderToStaticMarkup(
      <VolatilityBandChart
        points={DAILY_POINTS}
        variability={VARIABILITY}
        title="Expense variability"
        labels={{ mean: "Mean", band: "Mean ± 1 SD" }}
        formatValue={exactValue}
        formatAxis={formatAxis}
      />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("stroke-dasharray");
    expect(html).toContain('fill-opacity="0.14"');
    expect(html).not.toMatch(CJK);
  });
});

describe("SeasonalComparisonChart", () => {
  it("draws one line per year on a 12-month categorical axis", () => {
    const html = renderToStaticMarkup(
      <SeasonalComparisonChart
        result={SEASONAL}
        title="Seasonal spending"
        monthLabels={MONTHS}
        legend={[
          { label: "2025", colorIndex: 0 },
          { label: "2026", colorIndex: 1 },
        ]}
        formatValue={(cell) => (cell.amountMinor === null ? "unknown" : `${cell.amountMinor} minor`)}
        formatAxis={formatAxis}
      />,
    );
    expect(html).toContain('data-year="2025"');
    expect(html).toContain('data-year="2026"');
    expect(html).toContain("Mar");
    expect(html).not.toMatch(CJK);
  });
});

describe("AnomalyMarkerChart", () => {
  it("marks anomaly dates and shows the method description", () => {
    const html = renderToStaticMarkup(
      <AnomalyMarkerChart
        points={DAILY_POINTS}
        anomaly={ANOMALY}
        title="Expense anomalies"
        label="Unusually high day"
        formatValue={exactValue}
        formatAxis={formatAxis}
        description="Marked days exceed the robust threshold of the previous window."
      />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("data-mark-date=");
    expect(html).toContain("robust threshold");
    expect(html).not.toMatch(CJK);
  });
});
