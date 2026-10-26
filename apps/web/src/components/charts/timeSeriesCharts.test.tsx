import {
  accumulateSeries,
  computeTimeSeries,
  spanFromInclusiveDates,
  type TimeSeriesBucketPoint,
} from "@libellum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CumulativeTrendChart } from "./CumulativeTrendChart.js";
import { SeriesTrendChart } from "./SeriesTrendChart.js";
import { Sparkline } from "./Sparkline.js";

const CJK = /[㐀-鿿]/;

function series(overrides: { coverageEnd?: string | null } = {}): readonly TimeSeriesBucketPoint[] {
  return computeTimeSeries(
    [
      { occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 1_000n },
      { occurredLocalDate: "2026-10-03", kind: "expense", amountMinor: 2_500n },
    ],
    {
      metric: "expense",
      granularity: "day",
      span: spanFromInclusiveDates("2026-10-01", "2026-10-07"),
      today: "2026-10-31",
      coverageEnd: overrides.coverageEnd === undefined ? "2026-10-07" : overrides.coverageEnd,
    },
  ).buckets;
}

const valueText = (point: TimeSeriesBucketPoint): string =>
  `Expense ${point.amountMinor ?? "—"}`;
const formatAxis = (value: number): string => String(value);

describe("SeriesTrendChart", () => {
  it("draws one line per segment, breaking at missing days", () => {
    const html = renderToStaticMarkup(
      <SeriesTrendChart
        points={series({ coverageEnd: "2026-10-02" })}
        metric="expense"
        granularity="day"
        chartKind="line"
        title="Daily spending"
        valueText={valueText}
        formatAxis={formatAxis}
      />,
    );

    // 10-01..10-02 known: one segment; the unknown days are not zero-filled.
    expect(html).toContain("<svg");
    const paths = (html.match(/<path/g) ?? []).length;
    expect(paths).toBe(1);
    expect(html).toContain('aria-label="Daily spending"');
    expect(html).toContain('role="slider"');
    expect(html).toMatch(/tabindex="0"/i);
  });

  it("draws bars only for known buckets and marks the running one", () => {
    const html = renderToStaticMarkup(
      <SeriesTrendChart
        points={series()}
        metric="expense"
        granularity="day"
        chartKind="bar"
        title="Daily spending"
        valueText={valueText}
        formatAxis={formatAxis}
      />,
    );

    expect((html.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(html).toContain('data-state="complete"');
  });

  it("fills the area under a known area chart", () => {
    const html = renderToStaticMarkup(
      <SeriesTrendChart
        points={series()}
        metric="expense"
        granularity="day"
        chartKind="area"
        title="Daily spending"
        valueText={valueText}
        formatAxis={formatAxis}
      />,
    );

    expect(html).toContain('fill-opacity="0.12"');
  });

  it("explains itself instead of drawing an empty plot", () => {
    const html = renderToStaticMarkup(
      <SeriesTrendChart
        points={[]}
        metric="expense"
        granularity="day"
        chartKind="line"
        title="Daily spending"
        valueText={valueText}
        formatAxis={formatAxis}
        notice="No spending recorded in this period."
      />,
    );

    expect(html).toContain("No spending recorded in this period.");
    expect(html).not.toContain("<svg");
  });

  it("uses the caller's language and never the chart's own", () => {
    const html = renderToStaticMarkup(
      <SeriesTrendChart
        points={series()}
        metric="count"
        granularity="week"
        chartKind="bar"
        title="Weekly entries"
        valueText={(point) => `${String(point.transactionCount ?? 0)} entries`}
        formatAxis={formatAxis}
      />,
    );

    expect(html).not.toMatch(CJK);
    expect(html).toContain("Weekly entries");
  });
});

describe("Sparkline", () => {
  it("draws a line and a final marker without labels or axes", () => {
    const html = renderToStaticMarkup(
      <Sparkline points={series()} metric="expense" title="Trend" height={40} />,
    );

    expect(html).toContain("<svg");
    expect(html).toContain("<circle");
    expect(html).not.toContain("<text");
    expect(html).not.toMatch(CJK);
  });
});

describe("CumulativeTrendChart", () => {
  it("shows where the cumulative line stops being confirmable", () => {
    const cumulative = accumulateSeries(
      computeTimeSeries([{ occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 1_000n }], {
        metric: "expense",
        granularity: "day",
        span: spanFromInclusiveDates("2026-10-01", "2026-10-07"),
        today: "2026-10-31",
        coverageEnd: "2026-10-02",
      }),
    );

    const html = renderToStaticMarkup(
      <CumulativeTrendChart
        points={cumulative.points}
        title="Cumulative spending"
        valueText={(point) => `Cumulative ${point.cumulativeMinor ?? "unknown"}`}
        formatAxis={formatAxis}
      />,
    );

    expect(html).toContain("<svg");
    expect(html).toContain('data-unknown-from="2026-10-03"');
    expect(html).toContain("Cumulative spending");
  });

  it("keeps a zero-change plateau inside one segment", () => {
    const cumulative = accumulateSeries(
      computeTimeSeries(
        [
          { occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 1_000n },
          { occurredLocalDate: "2026-10-02", kind: "expense", amountMinor: 0n },
        ],
        {
          metric: "expense",
          granularity: "day",
          span: spanFromInclusiveDates("2026-10-01", "2026-10-03"),
          today: "2026-10-31",
          coverageEnd: "2026-10-03",
        },
      ),
    );

    const html = renderToStaticMarkup(
      <CumulativeTrendChart
        points={cumulative.points}
        title="Cumulative spending"
        valueText={(point) => `Cumulative ${point.cumulativeMinor ?? "unknown"}`}
        formatAxis={formatAxis}
      />,
    );

    const paths = (html.match(/<path/g) ?? []).length;
    // One area + one line for the single contiguous segment.
    expect(paths).toBe(2);
  });
});
