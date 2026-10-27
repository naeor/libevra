import { describe, expect, it } from "vitest";
import { aggregateFxDetailed, fxRangeMonths, type FxEntry, type FxLookup, type FxSnapshot } from "./fx.js";

/**
 * FX 逐日/逐笔投影性能基线（S-01 v2 B 侧提案 §5.2）。
 * 默认跳过；`FX_PERF=1 pnpm --filter @libellum/shared exec vitest run src/fxPerformance.test.ts` 运行。
 * 阈值是本机（Windows 单线程 Node）保守上限，用于发现数量级回归，不是验收基准。
 */
const snapshot: FxSnapshot = { base: "EUR", date: "2024-01-01", provider: "fixture", revision: "r1",
  fetchedAt: new Date(Date.parse("2024-01-01T12:00:00Z")).toISOString(),
  rates: { EUR: "1", USD: "1.25", CNY: "10", JPY: "160", HKD: "10", GBP: "0.8" } };
const lookup: FxLookup = { status: "available", snapshot, cached: false };
const DAYS = 730;
const dayOf = (index: number): string => new Date(Date.UTC(2024, 0, 1) + index * 86400000).toISOString().slice(0, 10);
/** 每笔使用“当日快照”（FxService 现实形态：按日缓存快照，回退 ≤7 天）。 */
const dayLookup = (date: string): FxLookup => ({ status: "available", cached: false,
  snapshot: { ...snapshot, date, fetchedAt: new Date(Date.parse(`${date}T12:00:00Z`)).toISOString() } });
const rates = new Map<string, FxLookup>(Array.from({ length: DAYS }, (_, index) => [dayOf(index), dayLookup(dayOf(index))]));

const entriesOf = (count: number): FxEntry[] => Array.from({ length: count }, (_, index) => ({
  id: `e${index}`, bookId: "b", amountCents: 1000 + (index % 997), currency: "USD",
  occurredLocalDate: dayOf(index % DAYS), kind: index % 2 === 0 ? "expense" : "income", categoryId: "c",
}));

const perfEnabled = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FX_PERF === "1";

describe.skipIf(!perfEnabled)("FX 逐日/逐笔投影性能基线（FX_PERF=1）", () => {
  it("1,000,000 笔的逐日投影（不输出逐笔）", () => {
    const entries = entriesOf(1_000_000);
    const started = performance.now();
    const result = aggregateFxDetailed("a", "b", entries, "CNY", rates);
    const elapsed = performance.now() - started;
    console.log(`1,000,000 entries aggregateFxDetailed(daily only): ${elapsed.toFixed(1)}ms`);
    expect(result.convertedCount).toBe(1_000_000);
    expect(result.complete).toBe(true);
    expect(Object.keys(result.detail.daily)).toHaveLength(DAYS);
    expect(elapsed).toBeLessThan(25_000);
  }, 60_000);

  it("200,000 笔的逐笔投影（includeEntries）", () => {
    const entries = entriesOf(200_000);
    const started = performance.now();
    const result = aggregateFxDetailed("a", "b", entries, "CNY", rates, undefined, { includeEntries: true, maxEntries: 200_000 });
    const elapsed = performance.now() - started;
    console.log(`200,000 entries aggregateFxDetailed(includeEntries): ${elapsed.toFixed(1)}ms`);
    expect(result.detail.entries).toHaveLength(200_000);
    expect(elapsed).toBeLessThan(8_000);
  }, 20_000);

  it("月键枚举 36 个月", () => {
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      const months = fxRangeMonths("2024-01-01", "2026-12-31");
      if (months.length !== 36) throw new Error("unexpected month count");
    }
    const elapsed = performance.now() - started;
    console.log(`10,000 × fxRangeMonths(36): ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(2_000);
  }, 10_000);
});
