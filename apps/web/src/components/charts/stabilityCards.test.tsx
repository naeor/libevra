import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Transaction } from "@libellum/shared";

import {
  deriveDailyExpenseVariability,
  deriveIncomeStability,
  deriveWeekdayAnalysis,
} from "../../lib/analysisData.js";
import { IncomeStabilityCard } from "./IncomeStabilityCard.js";
import { VariabilityCard } from "./VariabilityCard.js";
import { WeekdayPatternCard } from "./WeekdayPatternCard.js";

let nextId = 1;

/** Minimal well-formed transaction: only the fields the analysis layer reads. */
function entry(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `t-${String(nextId++).padStart(3, "0")}`,
    kind: "expense",
    amountCents: 1_000,
    currency: "CNY",
    categoryId: "category-1",
    categoryName: "Food",
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
  entry({ occurredLocalDate: "2026-10-01", amountCents: 30_000 }),
  entry({ occurredLocalDate: "2026-10-02", amountCents: 10_000 }),
  entry({ occurredLocalDate: "2026-10-05", amountCents: 20_000 }),
  entry({ occurredLocalDate: "2026-10-06", amountCents: 20_000 }),
  entry({ kind: "income", occurredLocalDate: "2026-08-05", amountCents: 100_000 }),
];

const span = { start: "2026-10-01", end: "2026-10-27" };

const variabilityView = deriveDailyExpenseVariability(transactions, {
  span,
  today: "2026-10-27",
  coverage: "local-ledger",
});

const incomeView = deriveIncomeStability(transactions, {
  span: { start: "2026-07-01", end: "2026-09-01" },
  today: "2026-10-27",
  coverage: "local-ledger",
  minSampleMonths: 1,
});

const weekdayView = deriveWeekdayAnalysis(transactions, {
  kind: "expense",
  span,
  today: "2026-10-27",
  coverage: "local-ledger",
});

const chartLabels = { mean: "Mean", band: "Mean ± 1σ" };

function renderVariability(overrides: { result?: typeof variabilityView.result } = {}): string {
  return renderToStaticMarkup(
    <VariabilityCard
      result={overrides.result === undefined ? variabilityView.result : overrides.result}
      points={variabilityView.points}
      title="Daily expense variability"
      metrics={[
        { label: "Mean", value: "¥230.77" },
        { label: "Std dev", value: "¥69.65" },
      ]}
      chartLabels={chartLabels}
      formatValue={(point) => (point.amountMinor === null ? "—" : `¥${point.amountMinor}`)}
      formatAxis={(value) => `¥${String(value)}`}
      caption="Device ledger · 26 confirmed days"
      sampleText="26 observed · 0 unknown · 0 running · 0 future"
      emptyText="No confirmed day in this range"
    />,
  );
}

describe("VariabilityCard", () => {
  it("renders the formatted metrics, the band chart and the exact sample statement", () => {
    const html = renderVariability();
    expect(html).toContain('data-testid="variability-card"');
    expect(html).toContain("Daily expense variability");
    expect(html).toContain("¥230.77");
    expect(html).toContain("¥69.65");
    expect(html).toContain("Mean ± 1σ");
    expect(html).toContain("26 observed · 0 unknown · 0 running · 0 future");
    expect(html).toContain("Device ledger · 26 confirmed days");
    expect(html).not.toContain("No confirmed day in this range");
    // No raw CJK leaks into the rendered markup (English locale).
    expect(/[\u4e00-\u9fff]/.test(html)).toBe(false);
  });

  it("shows emptyText instead of fabricated zeros when no day is confirmed", () => {
    const emptyView = deriveDailyExpenseVariability(transactions, {
      span,
      today: "2026-10-27",
      coverage: "unknown",
    });
    expect(emptyView.result).toBeNull();
    const html = renderVariability({ result: null });
    expect(html).toContain('data-testid="variability-card-empty"');
    expect(html).toContain("No confirmed day in this range");
    expect(html).not.toContain('data-testid="variability-metrics"');
  });
});

describe("IncomeStabilityCard", () => {
  it("renders judged state, sample and metrics", () => {
    expect(incomeView.result).not.toBeNull();
    const html = renderToStaticMarkup(
      <IncomeStabilityCard
        result={incomeView.result}
        title="Income stability"
        metrics={[
          { label: "Mean month", value: "¥1,000.00" },
          { label: "CV", value: "0.0%" },
        ]}
        stateText="2 complete months — a stability conclusion is available."
        sampleText="2 complete natural months, running month excluded"
        emptyText="No confirmed month in this range"
        caption="Device ledger · Aug running month excluded"
      />,
    );
    expect(html).toContain('data-testid="income-stability-card"');
    expect(html).toContain('data-judged-state="computed"');
    expect(html).toContain("¥1,000.00");
    expect(html).toContain("0.0%");
    expect(html).toContain("2 complete natural months, running month excluded");
    expect(html).toContain("Income stability");
    expect(/[\u4e00-\u9fff]/.test(html)).toBe(false);
  });

  it("shows the insufficient-sample state verbatim and can be empty", () => {
    const shortView = deriveIncomeStability(
      [entry({ kind: "income", occurredLocalDate: "2026-08-05", amountCents: 100_000 })],
      {
        span: { start: "2026-08-01", end: "2026-10-01" },
        today: "2026-10-27",
        coverage: "local-ledger",
      },
    );
    expect(shortView.result?.judgedState).toBe("insufficient-sample");
    const html = renderToStaticMarkup(
      <IncomeStabilityCard
        result={shortView.result}
        title="Income stability"
        stateText="Not enough complete months to describe stability."
        sampleText="1 positive month, 1 zero month"
        emptyText="No confirmed month in this range"
      />,
    );
    expect(html).toContain('data-judged-state="insufficient-sample"');
    expect(html).toContain("Not enough complete months to describe stability.");

    const emptyHtml = renderToStaticMarkup(
      <IncomeStabilityCard
        result={null}
        title="Income stability"
        stateText="Not enough complete months to describe stability."
        sampleText=""
        emptyText="No confirmed month in this range"
      />,
    );
    expect(emptyHtml).toContain('data-testid="income-stability-empty"');
    expect(emptyHtml).not.toContain("data-judged-state");
  });
});

describe("WeekdayPatternCard", () => {
  it("renders seven weekday buckets and keeps total/average mode visible", () => {
    const html = renderToStaticMarkup(
      <WeekdayPatternCard
        result={weekdayView.result}
        title="Spending by weekday"
        mode="total"
        weekdayLabels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
        metrics={[
          { label: "Total", value: "¥800.00" },
          { label: "Busiest day", value: "Monday" },
        ]}
        formatAxis={(value) => `¥${String(value)}`}
        formatValue={(minor) => `¥${minor}`}
        sampleText="26 observed days · 0 unknown · 0 future"
        caption="Device ledger · weekday shown by natural date"
      />,
    );
    expect(html).toContain('data-testid="weekday-pattern-card"');
    expect(html).toContain('data-mode="total"');
    expect(html).toContain("Mon");
    expect(html).toContain("Sun");
    expect(html).toContain("¥800.00");
    expect(html).toContain("26 observed days · 0 unknown · 0 future");
    expect(/[\u4e00-\u9fff]/.test(html)).toBe(false);
  });

  it("keeps the average mode distinct (never merged into the total)", () => {
    const html = renderToStaticMarkup(
      <WeekdayPatternCard
        result={weekdayView.result}
        title="Spending by weekday"
        mode="average"
        weekdayLabels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
        metrics={[{ label: "Average day", value: "¥30.77" }]}
        formatAxis={(value) => `¥${String(value)}`}
        formatValue={(minor) => `¥${minor}`}
        sampleText="26 observed days"
      />,
    );
    expect(html).toContain('data-mode="average"');
    expect(html).toContain("Average day");
    expect(html).toContain("¥30.77");
  });
});
