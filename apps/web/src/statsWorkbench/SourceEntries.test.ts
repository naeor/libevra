import { describe, expect, it } from "vitest";
import type { Transaction } from "@libellum/shared";
import { newCard } from "./defaults.js";
import { sourceEntriesFor } from "./SourceEntries.js";
import type { WorkbenchScope } from "./scope.js";

const row = (id: string, extra: Partial<Transaction> = {}): Transaction => ({ id, kind: "expense", amountCents: 100, currency: "CNY", categoryId: "food", categoryName: "food", categoryIsSystem: false, paymentMethodId: "cash", paymentMethodName: "cash", occurredAt: "2026-10-02T04:00:00.000Z", occurredLocalDate: "2026-10-02", occurredTz: "Asia/Shanghai", note: null, tags: [], version: 1, ...extra });
const scope: WorkbenchScope = { today: "2026-10-29", filters: { time: { kind: "preset", preset: "30d" }, combined: false, currency: "CNY" }, range: { from: "2026-09-30", to: "2026-10-29" }, bucket: "day", combined: false, fxAvailable: false, currency: "CNY", defaultCurrency: "CNY", entries: [], loaded: true, fx: null, coverageGap: null, repairing: false, accountScope: "user:test" };
describe("详情来源区间账目", () => {
  it("按业务日期、币种、收支过滤并排除软删除；不从 UTC 字符串猜日期", () => {
    const rows = [row("expense"), row("income", { kind: "income" }), row("usd", { currency: "USD" }), row("deleted", { deletedAt: "2026-10-03T00:00:00Z" }), row("outside", { occurredLocalDate: "2026-09-01" })];
    expect(sourceEntriesFor(newCard("AN-B01"), scope, rows).map(r => r.id)).toEqual(["expense"]);
    expect(sourceEntriesFor(newCard("AN-B02"), scope, rows).map(r => r.id)).toEqual(["income"]);
  });
  it("固定区间优先于顶部区间，维度空集不能冒充不限", () => {
    const card = { ...newCard("AN-B01"), rangePolicy: "pinned" as const, pinnedRange: { from: "2026-09-01", to: "2026-09-30" } };
    const rows = [row("old", { occurredLocalDate: "2026-09-15" }), row("current")];
    expect(sourceEntriesFor(card, scope, rows).map(r => r.id)).toEqual(["old"]);
    expect(sourceEntriesFor(card, { ...scope, filters: { ...scope.filters, categoryIds: [] } }, rows)).toEqual([]);
  });
  it("综合模式保留原始币种，分类与支付方式沿用同一筛选", () => {
    const rows = [row("cny"), row("usd", { currency: "USD" }), row("other", { paymentMethodId: "bank" })];
    const selected = { ...scope, combined: true, filters: { ...scope.filters, combined: true, categoryIds: ["food"], paymentMethodIds: ["cash"] } };
    expect(sourceEntriesFor(newCard("AN-B01"), selected, rows).map(r => r.id)).toEqual(["cny", "usd"]);
    expect(rows[1]?.currency).toBe("USD");
  });
});
