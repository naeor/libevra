import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  computeCalendarHeatmap,
  computeCategorySeries,
  computeCategoryShares,
  computeFlowSeries,
  computeWeekdayPattern,
  spanFromInclusiveDates,
  type TimeSeriesEntry,
} from "@libellum/shared";

import { CalendarHeatmapGrid } from "./CalendarHeatmapGrid.js";
import { CategoryShareBands } from "./CategoryShareBands.js";
import { CategoryStackedBars } from "./CategoryStackedBars.js";
import { IncomeExpenseBars } from "./IncomeExpenseBars.js";
import { WeekdayBars } from "./WeekdayBars.js";

const CJK = /[\u4e00-\u9fff]/;
const TODAY = "2026-10-27";
const COVERAGE = "2026-10-31";
const OCTOBER = spanFromInclusiveDates("2026-10-01", "2026-10-31");

function entry(occurredLocalDate: string, kind: "expense" | "income", amountMinor: number): TimeSeriesEntry {
  return { occurredLocalDate, kind, amountMinor };
}

const FLOW = computeFlowSeries(
  [entry("2026-10-01", "income", 100_000), entry("2026-10-05", "expense", 30_000)],
  { granularity: "month", span: OCTOBER, today: TODAY, coverageEnd: COVERAGE },
);

const CATEGORY_SERIES = computeCategorySeries(
  [
    { occurredLocalDate: "2026-10-05", kind: "expense", amountMinor: 6_000, categoryId: "c1" },
    { occurredLocalDate: "2026-10-06", kind: "expense", amountMinor: 2_000, categoryId: "c2" },
    { occurredLocalDate: "2026-10-07", kind: "expense", amountMinor: 4_000, categoryId: "c1" },
  ],
  {
    kind: "expense",
    categoryIds: ["c1", "c2"],
    granularity: "month",
    span: OCTOBER,
    today: TODAY,
    coverageEnd: COVERAGE,
    includeOther: true,
  },
);
const SHARES = computeCategoryShares(CATEGORY_SERIES);

const WEEKDAY = computeWeekdayPattern(
  [entry("2026-09-07", "expense", 3_000), entry("2026-10-05", "expense", 1_000)],
  {
    kind: "expense",
    span: spanFromInclusiveDates("2026-09-07", "2026-10-04"),
    today: TODAY,
    coverageEnd: COVERAGE,
  },
);

const HEATMAP = computeCalendarHeatmap(
  [entry("2026-10-01", "expense", 1_000), entry("2026-10-02", "expense", 5_000)],
  { metric: "expense", span: OCTOBER, today: TODAY, coverageEnd: "2026-10-26" },
);

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const axis = (value: number): string => value.toFixed(0);
const exact = (minor: string): string => minor;
const dayLabel = (bucket: { readonly key: string }): string => bucket.key;
const label = (id: string): string => id;
const share = (fraction: number): string => `${String(Math.round(fraction * 100))}%`;
const formatDay = (cell: { readonly date: string; readonly valueMinor: string | null }): string =>
  `${cell.date} ${cell.valueMinor ?? "unknown"}`;

describe("B-2 chart components", () => {
  it("draws the income/expense pair for every covered bucket", () => {
    const html = renderToStaticMarkup(
      <IncomeExpenseBars
        buckets={FLOW.buckets}
        title="Income and expense"
        incomeLabel="Income"
        expenseLabel="Expense"
        formatAxis={axis}
        labelFor={dayLabel}
      />,
    );

    expect(html).toContain('data-series="income"');
    expect(html).toContain('data-series="expense"');
    expect(html).toContain("Income");
    expect(CJK.test(html)).toBe(false);
  });

  it("draws stacked category segments and a legend", () => {
    const html = renderToStaticMarkup(
      <CategoryStackedBars
        buckets={CATEGORY_SERIES.buckets}
        title="Category composition"
        categoryLabel={label}
        formatAxis={axis}
        labelFor={dayLabel}
      />,
    );

    expect(html).toContain('data-category="c1"');
    expect(html).toContain('data-category="c2"');
    expect(html).toContain("__other__");
    expect(CJK.test(html)).toBe(false);
  });

  it("draws share bands with percent gridlines", () => {
    const html = renderToStaticMarkup(
      <CategoryShareBands
        shares={SHARES}
        title="Category share"
        categoryLabel={label}
        formatShare={share}
        labelFor={dayLabel}
      />,
    );

    expect(html).toContain('data-category="c1"');
    expect(html).toContain("100%");
    expect(CJK.test(html)).toBe(false);
  });

  it("draws seven weekday bars and a sample note", () => {
    const html = renderToStaticMarkup(
      <WeekdayBars
        pattern={WEEKDAY}
        mode="total"
        weekdayLabels={DAY_LABELS}
        title="Spending by weekday"
        formatAxis={axis}
        formatValue={exact}
        note="Not enough days yet to compare."
      />,
    );

    expect((html.match(/data-weekday=/g) ?? []).length).toBe(7);
    expect(html).toContain("Not enough days yet to compare.");
    expect(CJK.test(html)).toBe(false);
  });

  it("renders every calendar day cell and leaves unknown days uncoloured", () => {
    const html = renderToStaticMarkup(
      <CalendarHeatmapGrid
        heatmap={HEATMAP}
        title="Daily spending calendar"
        monthLabel={() => "October 2026"}
        weekdayLabels={DAY_LABELS}
        formatDay={formatDay}
      />,
    );

    expect(html).toContain('data-date="2026-10-01"');
    expect(html).toContain('data-date="2026-10-31"');
    // 今天（10-27）是当前未结束的一天；10-28 起是未来，两者都没有 data-level。
    expect(html).toContain('data-date="2026-10-27" data-state="in-progress"');
    expect(html).toContain('data-date="2026-10-28" data-state="future"');
    expect(html).toContain("October 2026");
    expect(CJK.test(html)).toBe(false);
  });
});
