import {
  computeMultiMonthComparison,
  computePeriodComparison,
  spanFromInclusiveDates,
  type ComparisonEntry,
} from "@libellum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../../i18n/index.js";
import { MonthComparisonChart } from "./MonthComparisonChart.js";
import { PeriodComparisonBars } from "./PeriodComparisonBars.js";
import { PeriodComparisonCard } from "./PeriodComparisonCard.js";

const CJK = /[\u4e00-\u9fff]/;
const TODAY = "2026-10-27";
const COVERAGE = "2026-10-27";

function entry(
  occurredLocalDate: string,
  kind: "expense" | "income",
  amountMinor: number,
): ComparisonEntry {
  return { occurredLocalDate, kind, amountMinor };
}

const COMPARISON = computePeriodComparison(
  [
    entry("2026-10-03", "expense", 5_000),
    entry("2026-10-05", "income", 20_000),
    entry("2026-09-10", "expense", 4_000),
    entry("2026-09-12", "income", 10_000),
  ],
  { kind: "previous-period", current: spanFromInclusiveDates("2026-10-01", "2026-10-27"), today: TODAY },
  { coverageEnd: COVERAGE },
);

const UNKNOWN = computePeriodComparison(
  [],
  { kind: "previous-period", current: spanFromInclusiveDates("2026-10-01", "2026-10-27"), today: TODAY },
  { coverageEnd: "2026-09-10" },
);

const MONTHS = computeMultiMonthComparison(
  [
    { occurredLocalDate: "2026-01-10", kind: "expense", amountMinor: 1_500 },
    { occurredLocalDate: "2026-03-20", kind: "expense", amountMinor: 2_500 },
  ],
  { months: ["2026-01", "2026-03", "2026-11"], metric: "expense", today: TODAY },
  { coverageEnd: COVERAGE },
);

function bars(): string {
  return renderToStaticMarkup(
    <PeriodComparisonBars
      result={COMPARISON}
      title="Comparison"
      metricLabels={{ expense: "Expense", income: "Income" }}
      valueText={(group, side) => `${side} ${group.metric}`}
      formatAxis={(value) => String(value)}
    />,
  );
}

afterEach(() => {
  applyLocale("zh-CN");
});

describe("PeriodComparisonBars (A01–A03/A05)", () => {
  it("draws one current and one comparison bar per metric group", () => {
    const html = bars();

    expect(html).toContain('data-bar-side="current"');
    expect(html).toContain('data-bar-side="previous"');
    expect(html.match(/data-bar-side="current"/g)).toHaveLength(2);
    expect(html.match(/data-bar-side="previous"/g)).toHaveLength(2);
    expect(html).toContain('data-metric="expense"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Comparison"');
  });

  it("contains no Chinese characters in English mode", () => {
    applyLocale("en-US");
    expect(bars()).not.toMatch(CJK);
  });

  it("shows the empty label instead of a misleading plot when both sides are unknown", () => {
    const html = renderToStaticMarkup(
      <PeriodComparisonBars
        result={UNKNOWN}
        title="Comparison"
        metricLabels={{ expense: "Expense", income: "Income" }}
        valueText={(group, side) => `${side} ${group.metric}`}
        formatAxis={(value) => String(value)}
        emptyLabel="No comparison data in this period."
      />,
    );

    expect(html).toContain("No comparison data in this period.");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("data-bar-side");
  });
});

describe("PeriodComparisonCard (CF-B10)", () => {
  it("shows both real ranges, the exact difference and the unavailable-growth reason", () => {
    const html = renderToStaticMarkup(
      <PeriodComparisonCard
        title="Last month"
        currentRangeText="Oct 1 – Oct 27, 2026"
        previousRangeText="Sep 1 – Sep 27, 2026"
        rangeNoteText="The comparison window is shorter than a full month."
        methodText="Compared with the same days of the previous month."
        metrics={[
          {
            label: "Expense",
            currentText: "¥50.00",
            previousText: "¥40.00",
            differenceText: "+¥10.00",
            growthText: "+25%",
            growthUnavailableText: null,
            complete: true,
          },
          {
            label: "Income",
            currentText: "¥0.00",
            previousText: "¥0.00",
            differenceText: "¥0.00",
            growthText: null,
            growthUnavailableText: "Both periods are zero.",
            complete: true,
          },
        ]}
      />,
    );

    expect(html).toContain("Oct 1 – Oct 27, 2026");
    expect(html).toContain("Sep 1 – Sep 27, 2026");
    expect(html).toContain("+¥10.00");
    expect(html).toContain("+25%");
    expect(html).toContain("Both periods are zero.");
    expect(html).toContain("Compared with the same days of the previous month.");
    expect(html).toContain("The comparison window is shorter than a full month.");
  });

  it("has no semantic good/bad colouring on the numbers", () => {
    const html = renderToStaticMarkup(
      <PeriodComparisonCard
        title="Last month"
        currentRangeText="Oct 1 – Oct 27, 2026"
        previousRangeText={null}
        rangeNoteText={null}
        methodText="No previous period yet."
        metrics={[
          {
            label: "Expense",
            currentText: "¥50.00",
            previousText: null,
            differenceText: null,
            growthText: null,
            growthUnavailableText: "No previous data.",
            complete: false,
          },
        ]}
      />,
    );

    expect(html).not.toContain("text-danger");
    expect(html).not.toContain("text-success");
    expect(html).toContain("No previous data.");
  });
});

describe("MonthComparisonChart (A04)", () => {
  function render(): string {
    return renderToStaticMarkup(
      <MonthComparisonChart
        result={MONTHS}
        title="Selected months"
        valueText={(bar) => bar.monthKey}
        formatAxis={(value) => String(value)}
      />,
    );
  }

  it("draws a bar for each known selected month and keeps the year in the accessible value", () => {
    const html = render();

    expect(html.match(/data-month=/g)).toHaveLength(2);
    expect(html).toContain('data-month="2026-01"');
    expect(html).toContain('data-month="2026-03"');
    expect(html).toContain('data-state="complete"');
    expect(html).toContain('data-comparable="true"');
    // The future month has no bar at all — it is not a zero-height bar.
    expect(html).not.toContain('data-month="2026-11"');
  });

  it("contains no Chinese characters in English mode", () => {
    applyLocale("en-US");
    expect(render()).not.toMatch(CJK);
  });
});
