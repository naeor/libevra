import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Transaction } from "@libellum/shared";

import {
  analysisSpan,
  deriveMultiMonthComparison,
  derivePeriodComparison,
} from "../../lib/analysisData.js";
import { MonthComparisonCard } from "./MonthComparisonCard.js";
import { PeriodComparisonBars } from "./PeriodComparisonBars.js";
import { PeriodComparisonCard } from "./PeriodComparisonCard.js";

let nextId = 1;

/** Minimal well-formed transaction: only the fields the analysis layer reads. */
function entry(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `t-${String(nextId++).padStart(3, "0")}`,
    kind: "expense",
    amountCents: 1_000,
    currency: "CNY",
    categoryId: "category-1",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: null,
    paymentMethodName: null,
    occurredAt: "2026-10-20T04:00:00.000Z",
    occurredLocalDate: "2026-10-20",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    ...overrides,
  };
}

const transactions = [
  entry({ occurredLocalDate: "2026-09-10", amountCents: 500 }),
  entry({ occurredLocalDate: "2026-10-10", amountCents: 800 }),
];

function comparison() {
  return derivePeriodComparison(transactions, {
    kind: "month-over-month",
    current: analysisSpan({ from: "2026-10-01", to: "2026-10-27" }),
    today: "2026-10-27",
    coverage: "local-ledger",
  });
}

function monthView(months: readonly string[]) {
  return deriveMultiMonthComparison(transactions, {
    months,
    metric: "expense",
    today: "2026-10-07",
    coverage: "local-ledger",
  });
}

const valueText = (group: { metric: string }, side: string): string =>
  `${group.metric}:${side}`;

const monthValueText = (bar: { monthKey: string }): string => `month:${bar.monthKey}`;

describe("PeriodComparisonBars（S3 复用 B-3 双柱，CF-B10）", () => {
  it("两组指标各画出本期/上期两根柱，数值来自权威结果", () => {
    const { result } = comparison();
    const html = renderToStaticMarkup(
      <PeriodComparisonBars
        result={result}
        title="本期与上期"
        metricLabels={{ expense: "支出", income: "收入" }}
        valueText={valueText}
        formatAxis={(value) => String(value)}
      />,
    );

    expect(html).toContain('data-group="expense"');
    expect(html).toContain('data-group="income"');
    expect(html.match(/data-bar-side="current"/g)?.length).toBe(2);
    expect(html.match(/data-bar-side="previous"/g)?.length).toBe(2);
  });

  it("数据覆盖未知时不画柱，只给出空状态文字", () => {
    const { result } = derivePeriodComparison(transactions, {
      kind: "month-over-month",
      current: analysisSpan({ from: "2026-10-01", to: "2026-10-27" }),
      today: "2026-10-27",
      coverage: "unknown",
    });
    const html = renderToStaticMarkup(
      <PeriodComparisonBars
        result={result}
        title="本期与上期"
        metricLabels={{ expense: "支出", income: "收入" }}
        valueText={valueText}
        formatAxis={(value) => String(value)}
        emptyLabel="暂无可用数据"
      />,
    );

    expect(html).not.toContain('data-bar-side="current"');
    expect(html).toContain("暂无可用数据");
  });
});

describe("PeriodComparisonCard（S3 复用 B-3 比较卡，CF-B10）", () => {
  it("展示真实区间与本期/上期金额；增长率不可用时给出原因而不是空白", () => {
    const html = renderToStaticMarkup(
      <PeriodComparisonCard
        title="本月支出"
        currentRangeText="10月1日–10月27日"
        previousRangeText="9月1日–9月27日"
        rangeNoteText={null}
        methodText="上月同期"
        metrics={[
          {
            label: "支出",
            currentText: "¥800.00",
            previousText: "¥500.00",
            differenceText: "+¥300.00",
            growthText: null,
            growthUnavailableText: "本期与上期都为 0，无法计算",
            complete: true,
          },
        ]}
      />,
    );

    expect(html).toContain("10月1日–10月27日");
    expect(html).toContain("上月同期");
    expect(html).toContain("¥800.00");
    expect(html).toContain("本期与上期都为 0，无法计算");
  });
});

describe("MonthComparisonCard（S3 新卡框架 + B-3 月份柱图，A04）", () => {
  it("全部为完整月时给出确认总额，并画出每根柱", () => {
    const { result } = monthView(["2026-07", "2026-08"]);
    expect(result.complete).toBe(true);
    expect(result.totalMinor).not.toBeNull();
    const html = renderToStaticMarkup(
      <MonthComparisonCard
        result={result}
        title="多个月份比较"
        valueText={monthValueText}
        formatAxis={(value) => String(value)}
        totalText="¥0.00"
        caption="2 个完整自然月"
        notesText={["跨年时保留年份"]}
      />,
    );

    expect(html).toContain('data-testid="month-comparison-card"');
    expect(html).toContain('data-testid="month-comparison-card-total"');
    expect(html).toContain("¥0.00");
    expect(html).toContain("2 个完整自然月");
    expect(html).toContain('data-month="2026-07"');
    expect(html).toContain('data-month="2026-08"');
  });

  it("含进行中的自然月时总额为未确认（不显示小计），该月低透明度且不可比", () => {
    const { result } = monthView(["2026-07", "2026-10"]);
    expect(result.totalMinor).toBeNull();

    const html = renderToStaticMarkup(
      <MonthComparisonCard
        result={result}
        title="多个月份比较"
        valueText={monthValueText}
        formatAxis={(value) => String(value)}
        totalText={null}
        caption="1 个完整月，1 个进行中"
      />,
    );

    expect(html).not.toContain('data-testid="month-comparison-card-total"');
    // The running month has no confirmed amount, so it gets an axis label but no bar
    // (an unknown month must never be drawn as a zero-height value).
    expect(html).not.toContain('data-month="2026-10"');
    expect(html).toContain("10月");
    expect(html).toContain("1 个完整月，1 个进行中");
  });

  it("覆盖未知时所有月份都不显示金额，只显示空状态", () => {
    const { result } = deriveMultiMonthComparison(transactions, {
      months: ["2026-07", "2026-09"],
      metric: "expense",
      today: "2026-10-07",
      coverage: "unknown",
    });
    const html = renderToStaticMarkup(
      <MonthComparisonCard
        result={result}
        title="多个月份比较"
        valueText={monthValueText}
        formatAxis={(value) => String(value)}
        totalText={null}
        caption="数据覆盖未知，金额不展示"
        notice="数据覆盖未知"
      />,
    );

    expect(html).not.toContain('data-testid="month-comparison-card-total"');
    expect(html).toContain("数据覆盖未知");
  });
});
