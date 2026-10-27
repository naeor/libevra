import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  AnomalyMark,
  AnomalyResult,
  SeasonalMonthCell,
  SeasonalYear,
  TimeSeriesBucketPoint,
} from "@libellum/shared";
import { ANOMALY_VERSION } from "@libellum/shared";

import { AnomalyPeaksCard } from "./AnomalyPeaksCard.js";
import { SeasonalComparisonCard, type SeasonalMonthComparisonResult } from "./SeasonalComparisonCard.js";

/** Rendered English UI must not contain CJK (same rule as the other card suites). */
const CJK = /[\u3000-\u9fff\uff00-\uffef]/;

function monthCell(
  year: number,
  month: number,
  amountMinor: string | null,
  state: SeasonalMonthCell["state"],
): SeasonalMonthCell {
  return {
    year,
    month,
    monthKey: month,
    amountMinor,
    transactionCount: amountMinor === null ? null : 1,
    state,
    comparable: state === "complete",
    outsideSpan: state === "outside-span",
    clipped: false,
  };
}

function seasonalYear(year: number, completeMonths: number): SeasonalYear {
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    if (index < completeMonths) return monthCell(year, month, String((month + 1) * 1_000), "complete");
    if (year === 2026 && month === 10) return monthCell(year, month, "700", "in-progress");
    if (year === 2026 && month > 10) return monthCell(year, month, null, "unknown");
    return monthCell(year, month, null, "unknown");
  });
  return {
    year,
    months,
    quarters: [],
    totalMinor: null,
    completeMonths,
    inProgressMonths: 1,
    unknownMonths: 2,
    comparableMonths: completeMonths,
    hasCompleteMonths: completeMonths > 0,
  };
}

function seasonalResult(overrides: Partial<SeasonalMonthComparisonResult> = {}): SeasonalMonthComparisonResult {
  return {
    version: "s17-b-seasonal-v1" as SeasonalMonthComparisonResult["version"],
    granularity: "month",
    metric: "expense",
    span: { start: "2025-01-01", end: "2026-11-01" },
    years: [seasonalYear(2025, 12), seasonalYear(2026, 9)],
    comparableYears: [2025, 2026],
    descriptiveOnly: false,
    descriptiveReason: null,
    maxMonths: 36,
    monthCount: 24,
    hasInProgressCells: true,
    ...overrides,
  };
}

function bucketPoint(
  date: string,
  amountMinor: string,
  state: TimeSeriesBucketPoint["bucket"]["state"],
): TimeSeriesBucketPoint {
  return {
    bucket: {
      key: date,
      granularity: "day",
      span: { start: date, end: date },
      naturalSpan: { start: date, end: date },
      state,
      clippedStart: false,
      clippedEnd: false,
    },
    amountMinor,
    transactionCount: 1,
    unknownReason: null,
  };
}

function mark(date: string, amountMinor: string, rank: number): AnomalyMark {
  return {
    date,
    amountMinor,
    deviationScaled: "12345678",
    thresholdScaledMinor: "5000000",
    rank,
  };
}

function anomalyResult(overrides: Partial<AnomalyResult> = {}): AnomalyResult {
  return {
    version: ANOMALY_VERSION,
    method: "mad",
    parameters: {
      method: "mad",
      madMultiplier: "3.5",
      iqrMultiplier: "1.5",
      quantile: "0.95",
      minimumSampleDays: 28,
    },
    baseline: {
      sampleDays: 30,
      median: { numeratorMinor: "1000", denominator: 1 },
      medianAbsoluteDeviationScaledMinor: "0",
      meanScaledMinor: "3966666666",
      zeroDays: 0,
      minMinor: "1000",
      maxMinor: "90000",
    },
    marks: [mark("2026-09-15", "90000", 1)],
    sampleDays: 30,
    sufficientSample: true,
    targetRange: { start: "2026-09-01", end: "2026-10-01" },
    todayExcluded: false,
    formula: {
      mad: "robust-z-score-v1",
      iqr: "tukey-fence-v1",
      quantile: "percentile-threshold-v1",
    },
    ...overrides,
  };
}

describe("SeasonalComparisonCard (S4c A18)", () => {
  it("renders the comparison chart, sample statement and no CJK", () => {
    const html = renderToStaticMarkup(
      <SeasonalComparisonCard
        result={seasonalResult()}
        title="Same-month comparison"
        monthLabels={Array.from({ length: 12 }, (_, index) => `M${index + 1}`)}
        legend={[
          { label: "2025", colorIndex: 0 },
          { label: "2026", colorIndex: 1 },
        ]}
        formatValue={(cell) => `$${cell.amountMinor ?? "-"}`}
        formatAxis={(value) => String(value)}
        caption="Device ledger · 2025-01 → 2026-10"
        sampleText="2 years compared · 21 complete months"
      />,
    );

    expect(html).toContain('data-testid="seasonal-comparison-card"');
    expect(html).toContain('data-descriptive-only="false"');
    expect(html).toContain("Same-month comparison");
    expect(html).toContain("21 complete months");
    expect(html).not.toMatch(CJK);
  });

  it("shows the descriptive note instead of implying statistical seasonality", () => {
    const html = renderToStaticMarkup(
      <SeasonalComparisonCard
        result={seasonalResult({
          years: [seasonalYear(2026, 9)],
          comparableYears: [2026],
          descriptiveOnly: true,
          descriptiveReason: "fewer-than-two-years",
        })}
        title="Same-month comparison"
        monthLabels={Array.from({ length: 12 }, (_, index) => `M${index + 1}`)}
        legend={[{ label: "2026", colorIndex: 0 }]}
        formatValue={(cell) => `$${cell.amountMinor ?? "-"}`}
        formatAxis={(value) => String(value)}
        sampleText="1 year compared"
        descriptiveText="Not enough history for a seasonality statement"
      />,
    );

    expect(html).toContain('data-descriptive-only="true"');
    expect(html).toContain("Not enough history for a seasonality statement");
    expect(html).not.toMatch(CJK);
  });
});

describe("AnomalyPeaksCard (S4c A19)", () => {
  it("renders the marker chart and the ranked peak list", () => {
    const html = renderToStaticMarkup(
      <AnomalyPeaksCard
        result={anomalyResult()}
        points={[
          bucketPoint("2026-09-14", "1000", "complete"),
          bucketPoint("2026-09-15", "90000", "complete"),
        ]}
        title="Unusual spending days"
        label="Unusual day"
        formatValue={(point) => `$${point.amountMinor ?? "-"}`}
        formatAxis={(value) => String(value)}
        formatMark={(peak) => ({ date: peak.date, amount: `$${peak.amountMinor}` })}
        description="Median + 3.5×MAD"
        caption="Device ledger · 2026-09"
        sampleText="30 complete days sampled · minimum 28"
        emptyText="No complete day yet"
        noneText="No unusual day in this range"
      />,
    );

    expect(html).toContain('data-state="ready"');
    expect(html).toContain('data-testid="anomaly-peaks-list"');
    expect(html).toContain('data-rank="1"');
    expect(html).toContain("2026-09-15");
    expect(html).toContain("Median + 3.5×MAD");
    expect(html).toContain("30 complete days sampled");
    expect(html).not.toMatch(CJK);
  });

  it("shows the empty state when no complete day exists", () => {
    const html = renderToStaticMarkup(
      <AnomalyPeaksCard
        result={anomalyResult({ baseline: null, marks: [], sampleDays: 0, sufficientSample: false })}
        points={[]}
        title="Unusual spending days"
        label="Unusual day"
        formatValue={() => "-"}
        formatAxis={(value) => String(value)}
        formatMark={(peak) => ({ date: peak.date, amount: `$${peak.amountMinor}` })}
        sampleText="0 complete days sampled"
        emptyText="No complete day yet"
        noneText="No unusual day in this range"
      />,
    );

    expect(html).toContain('data-state="empty"');
    expect(html).toContain("No complete day yet");
    expect(html).toContain("0 complete days sampled");
    expect(html).not.toMatch(CJK);
  });

  it("says no day was unusual without hiding the sample", () => {
    const html = renderToStaticMarkup(
      <AnomalyPeaksCard
        result={anomalyResult({ marks: [] })}
        points={[bucketPoint("2026-09-14", "1000", "complete")]}
        title="Unusual spending days"
        label="Unusual day"
        formatValue={() => "-"}
        formatAxis={(value) => String(value)}
        formatMark={(peak) => ({ date: peak.date, amount: `$${peak.amountMinor}` })}
        sampleText="30 complete days sampled"
        emptyText="No complete day yet"
        noneText="No unusual day in this range"
      />,
    );

    expect(html).toContain('data-testid="anomaly-peaks-none"');
    expect(html).toContain("No unusual day in this range");
    expect(html).not.toMatch(CJK);
  });
});
