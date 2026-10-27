import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Transaction } from "@libellum/shared";

import { deriveMovingAverage } from "../../lib/analysisData.js";
import { MovingAverageCard } from "./MovingAverageCard.js";

let nextId = 1;

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
  entry({ occurredLocalDate: "2026-10-01", amountCents: 70_000 }),
  entry({ occurredLocalDate: "2026-10-05", amountCents: 20_000 }),
];

const weekly = deriveMovingAverage(transactions, {
  span: { start: "2026-10-07", end: "2026-10-10" },
  today: "2026-10-27",
  windowDays: 7,
  coverage: "local-ledger",
});

const monthly = deriveMovingAverage(transactions, {
  span: { start: "2026-10-30", end: "2026-11-02" },
  today: "2026-11-02",
  windowDays: 30,
  coverage: "local-ledger",
});

const labels = { raw: "Daily expense", average: "7-day average" };

function renderWeekly(overrides: { result?: typeof weekly.result | null } = {}): string {
  return renderToStaticMarkup(
    <MovingAverageCard
      windowDays={7}
      title="Daily expense and 7-day average"
      result={overrides.result === undefined ? weekly.result : overrides.result}
      labels={labels}
      metrics={[
        { label: "Latest 7-day average", value: "¥0.00" },
        { label: "Computable days", value: "3 / 3" },
      ]}
      formatValue={(point) =>
        point.rawMinor === null ? "no confirmed amount" : `¥${point.rawMinor}`
      }
      formatAxis={(value) => `¥${String(value)}`}
      caption="7 calendar days · 6 history days read before the range"
      sampleText="3 visible days · 0 unknown-window · 0 missing-history · 0 running"
      emptyText="No confirmed day in this range"
    />,
  );
}

describe("MovingAverageCard（S4b A13/A14）", () => {
  it("渲染窗口标记、指标、双序列图例与精确样本行", () => {
    const html = renderWeekly();
    expect(html).toContain('data-testid="moving-average-card"');
    expect(html).toContain('data-window="7"');
    expect(html).toContain("Daily expense and 7-day average");
    expect(html).toContain("Latest 7-day average");
    expect(html).toContain("¥0.00");
    expect(html).toContain("Daily expense");
    expect(html).toContain("7-day average");
    expect(html).toContain("7 calendar days · 6 history days read before the range");
    expect(html).toContain("3 visible days · 0 unknown-window · 0 missing-history · 0 running");
    expect(html).not.toContain("No confirmed day in this range");
    // 英文 locale 下不得漏出原始中文。
    expect(/[\u4e00-\u9fff]/.test(html)).toBe(false);
  });

  it("A14 的 30 日窗口是另一张卡，不把 7 日结果复用为 30 日", () => {
    const html = renderToStaticMarkup(
      <MovingAverageCard
        windowDays={30}
        title="Daily expense and 30-day average"
        result={monthly.result}
        labels={{ raw: "Daily expense", average: "30-day average" }}
        formatValue={(point) => (point.rawMinor === null ? "no confirmed amount" : `¥${point.rawMinor}`)}
        formatAxis={(value) => `¥${String(value)}`}
        sampleText="2 visible days · 0 unknown-window · 0 missing-history · 0 running"
        emptyText="No confirmed day in this range"
      />,
    );
    expect(html).toContain('data-window="30"');
    expect(html).toContain("30-day average");
    expect(html).not.toContain('data-window="7"');
  });

  it("无确认日期时显示 emptyText，不伪造平均线或零值指标", () => {
    const html = renderWeekly({ result: null });
    expect(html).toContain('data-testid="moving-average-card-empty"');
    expect(html).toContain("No confirmed day in this range");
    expect(html).not.toContain('data-testid="moving-average-metrics"');
    expect(html).not.toContain("<svg");
  });
});
