import { performance } from "node:perf_hooks";
import { aggregateFx, convertFx, FxResultCache, type FxEntry, type FxLookup } from "../../../../packages/shared/src/fx.js";
import { FxHistoryService, MemoryFxRepository } from "../../../../packages/shared/src/fxHistory.js";

const now = Date.parse("2026-10-26T12:00:00Z");
const currencies = ["CNY", "USD", "EUR", "JPY", "HKD", "GBP"];
const results = [];
for (const count of [20, 5000, 50000]) {
  let queries = 0;
  const service = new FxHistoryService(new MemoryFxRepository(), { id: "fixture", async fetch(date) {
    queries++;
    return { base: "EUR", date, provider: "fixture", revision: "v1", fetchedAt: new Date(now).toISOString(),
      rates: { EUR: "1", CNY: "8", USD: "1.1", JPY: "160", HKD: "8.6", GBP: "0.85" } };
  } }, { now: () => now });
  const entries: FxEntry[] = Array.from({ length: count }, (_, i) => ({ id: String(i), bookId: "simulated",
    amountCents: i % 100000, currency: currencies[i % currencies.length]!, occurredLocalDate: `2020-${String(1 + i % 12).padStart(2, "0")}-${String(1 + i % 28).padStart(2, "0")}`,
    kind: i % 7 === 0 ? "income" : "expense", categoryId: String(i % 15) }));
  const rates = new Map<string, FxLookup>();
  const rateStart = performance.now();
  for (const date of new Set(entries.map(e => e.occurredLocalDate))) rates.set(date, await service.lookup(date));
  const rateMs = performance.now() - rateStart;
  const cache = new FxResultCache();
  const execute = (target: string, values = rates) => {
    const start = performance.now(); aggregateFx("simulation", "simulated", entries, target, values, cache);
    return +(performance.now() - start).toFixed(2);
  };
  const directStart = performance.now();
  for (const entry of entries) convertFx(entry, "CNY", rates.get(entry.occurredLocalDate));
  const directMs = +(performance.now() - directStart).toFixed(2);
  const coldMs = execute("CNY"), hotMs = execute("CNY"), switchMs = execute("USD");
  const revised = new Map([...rates].map(([date, lookup]): [string, FxLookup] => [date, lookup.status === "available"
    ? { ...lookup, snapshot: { ...lookup.snapshot, revision: "v2", rates: { ...lookup.snapshot.rates, CNY: "8.1" } } } : lookup]));
  const revisionMs = execute("CNY", revised);
  const sample = entries.slice(-Math.min(count, cache.capacity));
  for (const entry of sample) cache.convert("simulation", "simulated", entry, "CNY", revised.get(entry.occurredLocalDate));
  const warmStart = performance.now(); let hits = 0;
  for (const entry of sample) if (cache.convert("simulation", "simulated", entry, "CNY", revised.get(entry.occurredLocalDate)).resultCached) hits++;
  results.push({ count, dates: rates.size, providerQueries: queries, rateMs: +rateMs.toFixed(2), directMs, coldMs, hotMs, switchMs,
    revisionMs, cachedEntries: cache.size, workingSet: sample.length, hits, workingSetHotMs: +(performance.now() - warmStart).toFixed(2) });
}
console.log(JSON.stringify({ node: process.version, note: "独立模拟数据；providerQueries 为适配器调用次数，无真实网络或数据库查询", results }, null, 2));
