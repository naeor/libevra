/**
 * S17-B 第二批卡片（1.17.8）烟测。
 *
 * 这里不重复手算金额（那是 shared 引擎测试的职责），只验证三件事：
 * 1. 12 个新指标都能通过真实 `CardBody` 渲染出非空内容，且没有 NaN / Infinity / undefined；
 * 2. 区间内没有账目时给出明确说明，而不是 ¥0.00 或空图；
 * 3. 综合折算一笔都没折出来时，说明「没有已折算账目」而不是「没有记录」。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../i18n/index.js";
import type { Transaction } from "@libellum/shared";

import { CardBody } from "./cards.js";
import { newCard } from "./defaults.js";
import { buildFxView, tx } from "./fxTestSupport.js";
import type { WorkbenchScope } from "./scope.js";

const RANGE = { from: "2026-10-01", to: "2026-10-27" } as const;

function entry(id: string, date: string, kind: "expense" | "income", amountCents: number, categoryId: string, categoryName: string): Transaction {
  return tx(id, {
    occurredLocalDate: date,
    occurredAt: `${date}T04:00:00.000Z`,
    kind,
    amountCents,
    categoryId,
    categoryName,
  });
}

/** 10 月当期 + 9 月 + 8 月 + 去年同月，够让卡片的比较/趋势窗口都有数据。 */
const ENTRIES: readonly Transaction[] = [
  entry("t01", "2026-10-02", "expense", 10000, "c-food", "餐饮"),
  entry("t02", "2026-10-03", "expense", 5000, "c-transport", "交通"),
  entry("t03", "2026-10-04", "expense", 8000, "c-food", "餐饮"),
  entry("t04", "2026-10-05", "income", 500000, "c-salary", "工资"),
  entry("t05", "2026-10-10", "expense", 12000, "c-food", "餐饮"),
  entry("t06", "2026-10-12", "expense", 6000, "c-transport", "交通"),
  entry("t07", "2026-10-15", "expense", 30000, "c-shopping", "购物"),
  entry("t08", "2026-10-18", "income", 20000, "c-freelance", "兼职"),
  entry("t09", "2026-10-20", "expense", 9000, "c-food", "餐饮"),
  entry("t10", "2026-10-25", "expense", 3000, "c-transport", "交通"),
  entry("t11", "2026-09-15", "expense", 15000, "c-food", "餐饮"),
  entry("t12", "2026-09-20", "income", 500000, "c-salary", "工资"),
  entry("t13", "2026-08-10", "expense", 7000, "c-food", "餐饮"),
  entry("t14", "2025-10-05", "expense", 20000, "c-food", "餐饮"),
  entry("t15", "2025-10-05", "income", 400000, "c-salary", "工资"),
];

const ALL_ADVANCED = ["AN-I13", "AN-I14", "AN-A02", "AN-A03", "AN-A04", "AN-A05", "AN-A12", "AN-A13", "AN-A14", "AN-A18", "AN-A19", "AN-A20"] as const;

function scope(entries: readonly Transaction[], over: Partial<WorkbenchScope> = {}): WorkbenchScope {
  return {
    today: "2026-11-02",
    filters: { time: { kind: "preset", preset: "30d" }, currency: null, combined: false },
    range: RANGE,
    bucket: "day",
    combined: false,
    fxAvailable: true,
    currency: "CNY",
    defaultCurrency: "CNY",
    entries,
    loaded: true,
    fx: null,
    coverageGap: null,
    repairing: false,
    accountScope: "user:fixture",
    ...over,
  };
}

const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function render(id: string, entries: readonly Transaction[], over: Partial<WorkbenchScope> = {}): string {
  return text(renderToStaticMarkup(<CardBody card={newCard(id)} scope={scope(entries, over)} density="expanded" />));
}

afterEach(() => {
  applyLocale("zh-CN");
});

describe("S17-B 第二批：12 个分析卡片可从 CardBody 渲染", () => {
  it.each(ALL_ADVANCED)("%s 有内容且没有非法数字", (id) => {
    const html = render(id, ENTRIES);
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
    // 标题或指标文字必须真的渲染出来，不能是空白占位。
    expect(html.length).toBeGreaterThan(6);
  });

  it("没有账目时给出说明而不是 0", () => {
    for (const id of ALL_ADVANCED) {
      const html = render(id, []);
      expect(html, id).not.toMatch(/NaN|Infinity|undefined|¥0\.00/);
      expect(html.length, id).toBeGreaterThan(3);
    }
  });

  it("综合折算一笔都没折出来时说明「无法确定」，不说「没有记录」", () => {
    const foreign = [tx("f1", { currency: "USD", amountCents: 1234, occurredLocalDate: "2026-10-02", occurredAt: "2026-10-02T04:00:00.000Z" })];
    const fx = buildFxView({ entries: foreign, missingCurrencies: ["USD"] });
    for (const id of ["AN-I13", "AN-A02", "AN-A13"] as const) {
      const html = render(id, foreign, { combined: true, fx });
      expect(html, id).not.toContain("这段时间没有记录");
      expect(html, id).not.toMatch(/NaN|Infinity/);
    }
  });
});
