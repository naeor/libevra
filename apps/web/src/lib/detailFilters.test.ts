import { describe, expect, it } from "vitest";
import type { Category, Transaction } from "@libellum/shared";
import { activeFilterDimensions, clearFilterDimension, detailFilterPredicate, emptyDetailFilters, readDetailFilters, validDetailDates, validFilterDate, writeDetailFilters } from "./detailFilters.js";
import { summaryFor } from "./offline/localStats.js";
import { presentEntries } from "../components/EntrySortControls.js";

const categories = [{ id: "food", parentId: null }, { id: "dinner", parentId: "food" }, { id: "travel", parentId: null }] as Category[];
const base = emptyDetailFilters("2026-10");
function entry(id: string, patch: Partial<Transaction> = {}): Transaction {
  return { id, kind: "expense", amountCents: 1200, currency: "CNY", categoryId: "food", categoryName: "餐饮", categoryIsSystem: false, paymentMethodId: "ali", paymentMethodName: "支付宝", occurredAt: "2026-10-10T10:00:00Z", occurredLocalDate: "2026-10-10", occurredTz: "Asia/Shanghai", tags: [], note: null, version: 1, ...patch };
}
describe("明细组合筛选", () => {
  it("按维度计数，多值不重复计数，全部时间不计数", () => {
    expect(activeFilterDimensions(base)).toEqual(["time"]);
    expect(activeFilterDimensions({ ...base, month: "all", payments: ["ali", "cash"] })).toEqual(["payments"]);
    expect(activeFilterDimensions({ ...base, payments: ["ali"], type: "image/", minMB: "1" })).toEqual(["time", "payments", "attachments"]);
  });
  it("保留时间，组内任一命中，组间同时命中", () => {
    const filter = detailFilterPredicate({ ...base, categories: ["food", "travel"], payments: ["ali", "cash"], tags: ["trip", "family"] }, categories);
    const tag = { id: "trip", name: "出差", color: "blue" };
    expect(filter(entry("yes", { tags: [tag] }))).toBe(true);
    expect(filter(entry("no-tag"))).toBe(false);
    expect(filter(entry("nov", { tags: [tag], occurredLocalDate: "2026-11-01" }))).toBe(false);
    expect(filter(entry("card", { tags: [tag], paymentMethodId: "card" }))).toBe(false);
  });
  it("分类默认精确匹配，只有明确选择才包含后代", () => {
    const child = entry("child", { categoryId: "dinner" });
    expect(detailFilterPredicate({ ...base, categories: ["food"] }, categories)(child)).toBe(false);
    expect(detailFilterPredicate({ ...base, categories: ["food"], branches: ["food"] }, categories)(child)).toBe(true);
    expect(clearFilterDimension({ ...base, categories: ["food"], branches: ["food"] }, "categories").branches).toEqual([]);
  });
  it("兼容旧分类直达链接，并保留其它 URL 状态", () => {
    const params = new URLSearchParams("categoryId=food&categoryScope=branch&entry=one&shell=wide");
    const value = readDetailFilters(params, "all");
    expect(value.categories).toEqual(["food"]); expect(value.branches).toEqual(["food"]);
    const encoded = writeDetailFilters(params, { ...value, payments: ["ali", "cash"], tags: ["family"] });
    expect(encoded.get("entry")).toBe("one"); expect(encoded.get("shell")).toBe("wide"); expect(encoded.has("categoryId")).toBe(false);
    expect(readDetailFilters(encoded, "all").payments).toEqual(["ali", "cash"]);
    expect(readDetailFilters(new URLSearchParams("f.branches=food"), "all").branches).toEqual([]);
  });
  it("日期按账目本地日期比较，起止均包含", () => {
    const filter = detailFilterPredicate({ ...base, month: "all", from: "2026-09-30", to: "2026-10-02" }, categories);
    expect(["2026-09-29", "2026-09-30", "2026-10-02", "2026-10-03"].map(date => filter(entry(date, { occurredLocalDate: date })))).toEqual([false, true, true, false]);
    expect(readDetailFilters(new URLSearchParams("f.from=2026-09-01&f.to=2026-09-30"), "2026-10").from).toBe("");
  });
  it("拒绝不存在、缺失或倒置的日期", () => {
    expect(validFilterDate("2024-02-29")).toBe(true);
    for (const date of ["2026-02-29", "2026-13-01", "2026-01-32", "2026-1-1", "hello"]) expect(validFilterDate(date)).toBe(false);
    expect(validDetailDates({ ...base, month: "all", from: "2026-01-01", to: "" })).toBe(false);
    expect(validDetailDates({ ...base, month: "all", from: "2026-02-01", to: "2026-01-01" })).toBe(false);
  });
  it("未指定支付方式可筛选，币种独立过滤", () => {
    const filter = detailFilterPredicate({ ...base, payments: ["none"], currencies: ["USD"] }, categories);
    expect(filter(entry("yes", { paymentMethodId: null, currency: "USD" }))).toBe(true);
    expect(filter(entry("no", { paymentMethodId: null }))).toBe(false);
  });
  it("附件条件同时生效，空间边界含等值", () => {
    const filter = detailFilterPredicate({ ...base, attachment: "has", type: "image/", minMB: "1", maxMB: "2" }, categories);
    expect(filter(entry("yes", { attachmentCount: 1, attachmentTypes: ["image/png"], storageBytes: 1e6 }))).toBe(true);
    expect(filter(entry("large", { attachmentCount: 1, attachmentTypes: ["image/png"], storageBytes: 2e6 + 1 }))).toBe(false);
    expect(filter(entry("pdf", { attachmentCount: 1, attachmentTypes: ["application/pdf"], storageBytes: 1e6 }))).toBe(false);
  });
  it("先筛选后排序，摘要仅统计命中项，币种不混加", () => {
    const rows = [entry("a"), entry("b", { amountCents: 3450 }), entry("other", { paymentMethodId: "cash", amountCents: 999999 }), entry("usd", { currency: "USD", amountCents: 500 })];
    const filtered = rows.filter(detailFilterPredicate({ ...base, payments: ["ali"] }, categories));
    const totals = summaryFor(filtered, base.month, { from: "2026-10-01", to: "2026-10-31" }).currencies;
    expect(totals.find(c => c.currency === "CNY")?.expenseCents).toBe(4650);
    expect(totals.find(c => c.currency === "USD")?.expenseCents).toBe(500);
    expect(presentEntries(filtered, { order: "amountDesc", attachment: "any", type: "", minMB: "", maxMB: "" }).map(e => e.id)).toEqual(["b", "a", "usd"]);
  });
  it("移除一项不清除其它筛选", () => {
    const next = clearFilterDimension({ ...base, payments: ["ali"], attachment: "has", type: "image/", minMB: "1" }, "attachments");
    expect(next.payments).toEqual(["ali"]); expect(next.month).toBe("2026-10"); expect(next.type).toBe(""); expect(next.minMB).toBe("");
  });
});
