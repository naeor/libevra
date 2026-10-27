import { renderToStaticMarkup } from "react-dom/server";
import type { Transaction } from "@libellum/shared";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../i18n/index.js";
import { CardBody, cardSubtitle, cardTitle } from "./cards.js";
import { newCard } from "./defaults.js";
import type { WorkbenchScope } from "./scope.js";
import { t } from "../i18n/index.js";

function entry(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `t-${Math.random().toString(16).slice(2)}`,
    kind: "expense",
    amountCents: 123_456,
    currency: "CNY",
    categoryId: "c-food",
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

function scope(overrides: Partial<WorkbenchScope> = {}): WorkbenchScope {
  return {
    today: "2026-10-27",
    filters: { time: { kind: "preset", preset: "30d" }, currency: null, combined: false },
    range: { from: "2026-09-28", to: "2026-10-27" },
    bucket: "day",
    combined: false,
    fxAvailable: false,
    currency: "CNY",
    defaultCurrency: "CNY",
    entries: [entry(), entry({ amountCents: 44, currency: "USD" })],
    loaded: true,
    fx: null,
    coverageGap: null,
    repairing: false,
    accountScope: "user:test",
    ...overrides,
  };
}

afterEach(() => {
  applyLocale("zh-CN");
});

describe("卡片内容", () => {
  it("数字卡显示精确金额，只算所选币种", () => {
    const html = renderToStaticMarkup(<CardBody card={newCard("AN-B01")} scope={scope()} density="medium" />);
    expect(html).toContain("¥1,234.56");
    expect(html).not.toContain("0.44");
  });

  it("没有记录时说明「没有记录」，不画成一个看似完整的图表", () => {
    const html = renderToStaticMarkup(<CardBody card={newCard("AN-I03")} scope={scope({ entries: [] })} density="expanded" />);
    expect(html).toContain("这段时间没有记录");
  });

  it("本机还没读到账目、或正在补齐缺的月份时显示加载，而不是 0", () => {
    const html = renderToStaticMarkup(
      <CardBody card={newCard("AN-B01")} scope={scope({ entries: [], repairing: true, coverageGap: { server: 3, local: 0 } })} density="medium" />,
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain("¥0.00");
  });

  it("综合折算下没有权威综合结果的卡片明确说明暂不支持", () => {
    const html = renderToStaticMarkup(<CardBody card={newCard("AN-I06")} scope={scope({ combined: true, fxAvailable: true })} density="expanded" />);
    expect(html).toContain("综合折算下暂不支持这张卡片");
  });

  it("来自新版本的未知卡片只读占位，不报错", () => {
    const card = { ...newCard("AN-B01"), analysis: { analysisId: "AN-Z99", params: {} } };
    const html = renderToStaticMarkup(<CardBody card={card} scope={scope()} density="medium" />);
    expect(html).toContain("更新应用后即可显示");
  });

  it("预置标题随界面语言，自定义标题原样显示；固定区间写在副标题", () => {
    applyLocale("en-US");
    expect(cardTitle(newCard("AN-B01"), t)).toBe("Total expense");
    const custom = { ...newCard("AN-B01"), title: { kind: "custom" as const, text: "本月开销" } };
    expect(cardTitle(custom, t)).toBe("本月开销");
    const pinned = { ...newCard("AN-B01"), rangePolicy: "pinned" as const, pinnedRange: { from: "2026-10-01", to: "2026-10-31" } };
    expect(cardSubtitle(pinned, scope(), t)).toContain("Fixed");
  });
});
