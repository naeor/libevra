import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type { Transaction } from "@libellum/shared";

import { applyLocale } from "../../i18n/index.js";
import { deriveTimeAnalysis } from "../../lib/analysisData.js";
import { DailyExpenseTrendCard } from "./DailyExpenseTrendCard.js";

let nextId = 1;

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
    occurredAt: "2026-10-02T04:00:00.000Z",
    occurredLocalDate: "2026-10-02",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    ...overrides,
  };
}

const CJK = /[\u4e00-\u9fff]/;

function result(transactions: readonly Transaction[], coverage?: "local-ledger" | "unknown") {
  return deriveTimeAnalysis(transactions, {
    metric: "expense",
    granularity: "day",
    span: { start: "2026-10-01", end: "2026-10-08" },
    today: "2026-10-27",
    ...(coverage === undefined ? {} : { coverage }),
  }).result;
}

function render(overrides: {
  totalText?: string | null;
  caption?: string | null;
  transactions?: readonly Transaction[];
  coverage?: "local-ledger" | "unknown";
} = {}): string {
  const {
    totalText = "¥35.00",
    caption = "设备账本口径，未同步的远端改动不计入",
    transactions = [entry({ amountCents: 3_500 })],
    coverage,
  } = overrides;
  return renderToStaticMarkup(
    <DailyExpenseTrendCard
      title="Daily expense"
      totalText={totalText}
      caption={caption}
      result={result(transactions, coverage)}
      formatAxis={(value) => `¥${String(value)}`}
      formatPoint={(point) =>
        point.amountMinor === null ? "unknown" : `2026-10-02 · ¥${point.amountMinor}`
      }
    />,
  );
}

afterEach(() => {
  applyLocale("zh-CN");
});

describe("DailyExpenseTrendCard", () => {
  it("渲染标题、精确合计与图表（图内不含自算金额）", () => {
    applyLocale("en-US");
    const html = render();
    expect(html).toContain('data-testid="daily-expense-trend-card"');
    expect(html).toContain("Daily expense");
    expect(html).toContain('data-testid="daily-expense-trend-total"');
    expect(html).toContain("¥35.00");
    expect(html).toContain("<svg");
  });

  it("有窗口说明时渲染 caption", () => {
    applyLocale("en-US");
    const html = render({ caption: "Device ledger view; unsynced remote edits are not included" });
    expect(html).toContain('data-testid="daily-expense-trend-caption"');
    expect(html).toContain("unsynced remote edits");
  });

  it("空桶时不画图，但卡片与标题仍在", () => {
    applyLocale("en-US");
    const html = renderToStaticMarkup(
      <DailyExpenseTrendCard
        title="Daily expense"
        totalText={null}
        caption={null}
        result={{
          version: "s17-b-time-series-v1",
          metric: "expense",
          granularity: "day",
          span: { start: "2026-10-01", end: "2026-10-08" },
          buckets: [],
          totalMinor: null,
          totalCount: 0,
          complete: false,
          unknownBucketCount: 0,
          inProgressBucketCount: 0,
          futureBucketCount: 0,
        }}
        formatAxis={(value) => String(value)}
        formatPoint={() => "empty"}
      />,
    );
    expect(html).toContain("Daily expense");
    expect(html).not.toContain("<svg");
  });

  it("未知覆盖时不显示合计，并给出说明", () => {
    applyLocale("en-US");
    const html = render({
      totalText: null,
      caption: "Data coverage is unknown for part of this range",
      coverage: "unknown",
    });
    expect(html).not.toContain('data-testid="daily-expense-trend-total"');
    expect(html).toContain("coverage is unknown");
  });

  it("英文模式下卡片自身文案不含中文（标题/说明由调用方提供）", () => {
    applyLocale("en-US");
    const html = render({ caption: "Device ledger view" });
    expect(CJK.test(html)).toBe(false);
  });
});
