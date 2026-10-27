import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  accumulateSeries,
  computeFlowSeries,
  computeTimeSeries,
  spanFromInclusiveDates,
  type TimeSeriesEntry,
} from "@libellum/shared";

import { CumulativeExpenseCard } from "./CumulativeExpenseCard.js";
import { IncomeExpenseCard } from "./IncomeExpenseCard.js";
import { TimeSeriesCard } from "./TimeSeriesCard.js";

const CJK = /[\u4e00-\u9fff]/;
const TODAY = "2026-10-27";
const OCTOBER = spanFromInclusiveDates("2026-10-01", "2026-10-27");

function entry(
  occurredLocalDate: string,
  kind: "expense" | "income",
  amountMinor: number,
): TimeSeriesEntry {
  return { occurredLocalDate, kind, amountMinor };
}

const INCOME = computeTimeSeries(
  [entry("2026-10-01", "income", 500_000), entry("2026-10-03", "income", 250_000)],
  { metric: "income", granularity: "day", span: OCTOBER, today: TODAY, coverageEnd: "2026-10-31" },
);

const UNKNOWN = computeTimeSeries([], {
  metric: "expense",
  granularity: "day",
  span: OCTOBER,
  today: TODAY,
  coverageEnd: null,
});

const CUMULATIVE = accumulateSeries(INCOME);
const CUMULATIVE_UNKNOWN = accumulateSeries(UNKNOWN);

const FLOW = computeFlowSeries(
  [entry("2026-10-01", "income", 500_000), entry("2026-10-02", "expense", 120_000)],
  { granularity: "day", span: OCTOBER, today: TODAY, coverageEnd: "2026-10-31" },
);

const axis = (value: number): string => value.toFixed(0);
const point = (value: { readonly bucket: { readonly key: string } }): string => value.bucket.key;
const bucketLabel = (bucket: { readonly key: string }): string => bucket.key;

describe("S1 time-trend cards", () => {
  it("renders a single series, its exact total and the caption", () => {
    const html = renderToStaticMarkup(
      <TimeSeriesCard
        title="Income trend"
        metric="income"
        totalText="7500.00"
        caption="Device ledger · 2026-10-01 → 2026-10-27"
        result={INCOME}
        formatAxis={axis}
        formatPoint={point}
        testId="income-trend"
      />,
    );
    expect(html).toContain("Income trend");
    expect(html).toContain("7500.00");
    expect(html).toContain("Device ledger");
    expect(html).toContain("<svg");
    expect(html).not.toMatch(CJK);
  });

  it("renders no total when the total is unknown", () => {
    const html = renderToStaticMarkup(
      <TimeSeriesCard
        title="Income trend"
        metric="income"
        totalText={null}
        caption="Coverage unknown"
        result={UNKNOWN}
        formatAxis={axis}
        formatPoint={point}
        testId="income-trend"
      />,
    );
    expect(html).not.toContain('data-testid="income-trend-total"');
    expect(html).toContain("Coverage unknown");
  });

  it("cumulative card draws the accumulated line and marks the first unknown bucket", () => {
    const html = renderToStaticMarkup(
      <CumulativeExpenseCard
        title="Cumulative expense"
        totalText="36.00"
        caption="From 2026-10-01"
        result={CUMULATIVE}
        formatAxis={axis}
        formatPoint={point}
        testId="cumulative"
      />,
    );
    expect(html).toContain("Cumulative expense");
    expect(html).toContain("36.00");
    expect(html).toContain("<svg");
    expect(html).not.toMatch(CJK);

    const unknownHtml = renderToStaticMarkup(
      <CumulativeExpenseCard
        title="Cumulative expense"
        totalText={null}
        caption="Coverage unknown"
        result={CUMULATIVE_UNKNOWN}
        formatAxis={axis}
        formatPoint={point}
        testId="cumulative"
      />,
    );
    expect(unknownHtml).toContain("data-unknown-from");
  });

  it("keeps income and expense totals as two values, not one balance", () => {
    const html = renderToStaticMarkup(
      <IncomeExpenseCard
        title="Income vs expense"
        incomeLabel="Income"
        expenseLabel="Expense"
        incomeText="5000.00"
        expenseText="1200.00"
        caption="Device ledger"
        result={FLOW}
        formatAxis={axis}
        labelFor={bucketLabel}
        testId="flow"
      />,
    );
    expect(html).toContain("Income");
    expect(html).toContain("Expense");
    expect(html).toContain("5000.00");
    expect(html).toContain("1200.00");
    expect(html).toContain("data-testid=\"flow-income\"");
    expect(html).toContain("data-testid=\"flow-expense\"");
    expect(html).not.toMatch(CJK);
  });

  it("formats every label through the caller (no hard-coded Chinese)", () => {
    const html = renderToStaticMarkup(
      <IncomeExpenseCard
        title="Income vs expense"
        incomeLabel="In"
        expenseLabel="Out"
        incomeText={null}
        expenseText={null}
        caption={null}
        result={FLOW}
        formatAxis={axis}
        labelFor={bucketLabel}
        testId="flow"
      />,
    );
    expect(html).not.toMatch(CJK);
  });
});
