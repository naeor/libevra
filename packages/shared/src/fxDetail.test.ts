import { describe, expect, it } from "vitest";
import {
  aggregateFxDetailed,
  aggregateFxDetailedAsync,
  convertFx,
  fxRangeMonths,
  FX_MAX_RANGE_MONTHS,
  type FxEntry,
  type FxLookup,
  type FxSnapshot,
} from "./fx.js";

const now = Date.parse("2026-10-26T12:00:00Z");
const snapshot: FxSnapshot = { base: "EUR", date: "2026-10-23", provider: "fixture", revision: "r1",
  fetchedAt: new Date(now).toISOString(), rates: { EUR: "1", USD: "1.25", CNY: "10", JPY: "160", HKD: "10", GBP: "0.8" } };
const lookup: FxLookup = { status: "available", snapshot, cached: false };
const review: FxLookup = { status: "available", snapshot, cached: true,
  review: { checkedAt: new Date(now).toISOString(), needsReview: true, nextCheckAt: new Date(now + 86400000).toISOString() } };

const entry = (id: string, occurredLocalDate: string, kind: FxEntry["kind"] = "expense", amountCents = 2000,
  currency = "USD"): FxEntry => ({ id, bookId: "b", amountCents, currency, occurredLocalDate, kind, categoryId: "c" });

const rates = new Map<string, FxLookup>([
  ["2026-10-25", lookup],
  ["2026-10-24", lookup],
  ["2026-10-23", lookup],
]);

describe("FxAggregate 逐日/逐笔投影（S-01 v2 draft，B-S01v2-01）", () => {
  it("additive：不请求逐笔时 entries 为 null，daily 与 totals 严格守恒", () => {
    const rows = [
      entry("e1", "2026-10-25", "expense"),
      entry("e2", "2026-10-25", "income", 5000),
      entry("e3", "2026-10-24", "expense", 100),
      entry("e4", "2026-10-25", "expense", 1, "CNY"),
    ];
    const result = aggregateFxDetailed("a", "b", rows, "CNY", rates);
    expect(result.detail.entries).toBeNull();
    expect(result.detail.daily["2026-10-25"]).toEqual({ incomeMinor: "40000", expenseMinor: "16001", netMinor: "23999" });
    expect(result.detail.daily["2026-10-24"]).toEqual({ incomeMinor: "0", expenseMinor: "800", netMinor: "-800" });
    const sum = Object.values(result.detail.daily).reduce((acc, totals) => ({
      incomeMinor: (BigInt(acc.incomeMinor) + BigInt(totals.incomeMinor)).toString(),
      expenseMinor: (BigInt(acc.expenseMinor) + BigInt(totals.expenseMinor)).toString(),
      netMinor: (BigInt(acc.netMinor) + BigInt(totals.netMinor)).toString(),
    }), { incomeMinor: "0", expenseMinor: "0", netMinor: "0" });
    expect(sum).toEqual(result.totals);
    expect(result.detail.daily["2026-10-25"]!.expenseMinor).toBe("16001");
    expect(result.complete).toBe(true);
    expect(result.shareDenominatorMinor).toBe(result.totals.expenseMinor);
  });

  it("逐笔投影与 convertFx 逐笔结果一致（同源、不二次舍入）", () => {
    const rows = [entry("e1", "2026-10-25"), entry("e2", "2026-10-24", "income", 77, "JPY"), entry("e3", "2026-10-23", "expense", 0)];
    const result = aggregateFxDetailed("a", "b", rows, "CNY", rates, undefined, { includeEntries: true });
    expect(result.detail.entries).toHaveLength(3);
    for (const [index, row] of rows.entries()) {
      const converted = convertFx(row, "CNY", rates.get(row.occurredLocalDate));
      const projected = result.detail.entries![index]!;
      expect(projected).toMatchObject({
        id: row.id, bookId: "b", date: row.occurredLocalDate, kind: row.kind, categoryId: row.categoryId,
        targetMinor: converted.convertedMinor, originalMinor: row.amountCents, originalCurrency: row.currency,
        rateDate: converted.rateDate, rateCached: converted.rateCached, needsReview: converted.review?.needsReview === true,
      });
    }
    expect(result.convertedCount).toBe(3);
  });

  it("缺失折算不进入 entries/daily（unknown ≠ 0），failures 照常记录", () => {
    const rows = [entry("e1", "2026-10-25"), entry("missing", "2020-01-01"), entry("e2", "2026-10-24")];
    const result = aggregateFxDetailed("a", "b", rows, "CNY", rates, undefined, { includeEntries: true });
    expect(result.complete).toBe(false);
    expect(result.missingCount).toBe(1);
    expect(result.failures.map(failure => failure.id)).toEqual(["missing"]);
    expect(result.detail.entries!.map(row => row.id)).toEqual(["e1", "e2"]);
    expect(result.detail.daily["2020-01-01"]).toBeUndefined();
    expect(Object.keys(result.detail.daily).sort()).toEqual(["2026-10-24", "2026-10-25"]);
  });

  it("逐笔上限不静默：超过 maxEntries 抛 fx_detail_limit，daily 不受影响", () => {
    const rows = [entry("e1", "2026-10-25"), entry("e2", "2026-10-26"), entry("e3", "2026-10-27")];
    expect(() => aggregateFxDetailed("a", "b", rows, "CNY", rates, undefined, { includeEntries: true, maxEntries: 2 }))
      .toThrow("fx_detail_limit");
    expect(() => aggregateFxDetailed("a", "b", rows, "CNY", rates, undefined, { maxEntries: 0 }))
      .toThrow(RangeError);
    const dailyOnly = aggregateFxDetailed("a", "b", rows, "CNY", rates, undefined, { maxEntries: 1 });
    expect(dailyOnly.complete).toBe(false);
    expect(dailyOnly.detail.entries).toBeNull();
  });

  it("作用域/币种合同不变", () => {
    expect(() => aggregateFxDetailed("a", "b", [{ ...entry("e1", "2026-10-25"), bookId: "other" }], "CNY", rates))
      .toThrow("fx_scope_mismatch");
    expect(() => aggregateFxDetailed("a", "b", [], "ABC", rates)).toThrow("unsupported_currency");
  });

  it("review 标记透传到逐笔投影与计数", () => {
    const reviewed = new Map<string, FxLookup>([["2026-10-25", review]]);
    const result = aggregateFxDetailed("a", "b", [entry("e1", "2026-10-25")], "CNY", reviewed, undefined, { includeEntries: true });
    expect(result.reviewNeededCount).toBe(1);
    expect(result.detail.entries![0]!.needsReview).toBe(true);
  });

  it("空输入：daily 为空、complete 为真、entries 视选项为空数组或 null", () => {
    const withDetail = aggregateFxDetailed("a", "b", [], "CNY", rates, undefined, { includeEntries: true });
    expect(withDetail.detail).toEqual({ daily: {}, entries: [] });
    expect(withDetail).toMatchObject({ complete: true, convertedCount: 0, missingCount: 0, shareDenominatorMinor: "0" });
    expect(aggregateFxDetailed("a", "b", [], "CNY", rates).detail.entries).toBeNull();
  });
});

describe("异步逐日/逐笔投影", () => {
  it("异步与同步结果一致（分批合并守恒）", async () => {
    const rows = Array.from({ length: 7 }, (_, index) => entry(`e${index}`, index % 2 === 0 ? "2026-10-25" : "2026-10-24",
      index % 3 === 0 ? "income" : "expense", 1000 + index));
    const sync = aggregateFxDetailed("a", "b", rows, "CNY", rates, undefined, { includeEntries: true });
    const async = await aggregateFxDetailedAsync("a", "b", rows, "CNY", rates, { batchSize: 2 }, { includeEntries: true });
    expect(async.totals).toEqual(sync.totals);
    expect(async.detail.daily).toEqual(sync.detail.daily);
    expect(async.detail.entries).toEqual(sync.detail.entries);
    expect(async.failures).toEqual(sync.failures);
    expect(async).toMatchObject({ complete: sync.complete, convertedCount: sync.convertedCount, missingCount: sync.missingCount });
  });

  it("取消不返回部分结果；batchSize 与上限校验先于扫描", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(aggregateFxDetailedAsync("a", "b", [entry("e1", "2026-10-25")], "CNY", rates,
      { signal: controller.signal }, { includeEntries: true })).rejects.toThrow();
    await expect(aggregateFxDetailedAsync("a", "b", [entry("e1", "2026-10-25")], "CNY", rates, { batchSize: 1001 }))
      .rejects.toThrow("fx_batch_size");
    await expect(aggregateFxDetailedAsync("a", "b", [entry("e1", "2026-10-25"), entry("e2", "2026-10-24")], "CNY", rates,
      {}, { includeEntries: true, maxEntries: 1 })).rejects.toThrow("fx_detail_limit");
  });
});

describe("月键枚举 fxRangeMonths（S-01 v2 draft，B-S01v2-02）", () => {
  it("含首尾月份、跨年连续", () => {
    expect(fxRangeMonths("2025-12-20", "2026-02-01")).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(fxRangeMonths("2026-10-27", "2026-10-27")).toEqual(["2026-10"]);
  });

  it("默认上限 36 个月；超限抛 fx_range_too_long 不截断", () => {
    expect(fxRangeMonths("2024-01-01", "2026-12-31")).toHaveLength(FX_MAX_RANGE_MONTHS);
    expect(() => fxRangeMonths("2024-01-01", "2027-01-01")).toThrow("fx_range_too_long");
    expect(() => fxRangeMonths("2024-01-01", "2026-12-31", 35)).toThrow("fx_range_too_long");
    expect(fxRangeMonths("2024-01-01", "2024-03-01", 3)).toHaveLength(3);
  });

  it("非法日期/顺序/参数显式报错", () => {
    expect(() => fxRangeMonths("2026-13-01", "2026-12-01")).toThrow("fx_range_invalid");
    expect(() => fxRangeMonths("2026-02-30", "2026-03-01")).toThrow("fx_range_invalid");
    expect(() => fxRangeMonths("2026-03-01", "2026-01-01")).toThrow("fx_range_invalid");
    expect(() => fxRangeMonths("2026-01-01", "2026-02-01", 0)).toThrow(RangeError);
  });
});
