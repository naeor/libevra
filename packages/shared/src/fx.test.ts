import { describe, expect, it } from "vitest";
import { aggregateFx, convertFx, FxResultCache, fxDate, type FxEntry, type FxLookup, type FxSnapshot } from "./fx.js";
import { FxError, FxHistoryService, MemoryFxRepository, type FxProvider } from "./fxHistory.js";

const now = Date.parse("2026-10-26T12:00:00Z");
const snapshot: FxSnapshot = { base: "EUR", date: "2026-10-23", provider: "fixture", revision: "r1",
  fetchedAt: new Date(now).toISOString(), rates: { EUR: "1", USD: "1.25", CNY: "10", JPY: "160", HKD: "10", GBP: "0.8" } };
const lookup: FxLookup = { status: "available", snapshot, cached: false };
const entry: FxEntry = { id: "e", bookId: "b", amountCents: 2000, currency: "USD", occurredLocalDate: "2026-10-25", kind: "expense", categoryId: "c" };

describe("折算财务语义", () => {
  it("跨币种方向正确且原件不变", () => {
    const original = structuredClone(entry);
    expect(convertFx(Object.freeze(entry), "CNY", lookup).convertedMinor).toBe("16000");
    expect(entry).toEqual(original);
    expect(convertFx({ ...entry, currency: "CNY", amountCents: 16000 }, "USD", lookup).convertedMinor).toBe("2000");
  });
  it("同币种离线无需汇率", () => expect(convertFx(entry, "USD").status).toBe("identity"));
  it.each([0, 1, 1000000000000, Number.MAX_SAFE_INTEGER])("安全整数 %i 不损失精度", amount => {
    expect(convertFx({ ...entry, amountCents: amount }, "USD").convertedMinor).toBe(String(amount));
  });
  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("非法金额 %s 不参与统计", amount => {
    expect(convertFx({ ...entry, amountCents: amount }, "CNY", lookup).reason).toBe("invalid_input");
  });
  it("退款沿用既有非负金额与收入类型，不引入负流水", () => {
    const result = aggregateFx("a", "b", [{ ...entry, kind: "income" }], "CNY", new Map([[entry.occurredLocalDate, lookup]]));
    expect(result.totals.netMinor).toBe("16000");
  });
  it.each(["ABC", "usd", "", "__proto__"])("拒绝不支持币种 %s", currency => {
    expect(convertFx({ ...entry, currency }, "CNY", lookup).reason).toBe("unsupported_currency");
  });
  it.each(["2026-02-30", "2026-13-01", "2026-2-01", "nonsense"])("拒绝不存在日期 %s", date => expect(fxDate(date)).toBe(false));
  it("JPY 0 位与最小金额半入边界", () => {
    expect(convertFx({ ...entry, currency: "EUR", amountCents: 1 }, "JPY", lookup).convertedMinor).toBe("2");
    const half = { ...snapshot, rates: { EUR: "1", JPY: "50" } } as const;
    expect(convertFx({ ...entry, currency: "EUR", amountCents: 1 }, "JPY", { ...lookup, snapshot: half }).convertedMinor).toBe("1");
    expect(convertFx({ ...entry, currency: "JPY", amountCents: 1 }, "EUR", lookup).convertedMinor).toBe("1");
  });
  it.each(["0", "-1", "NaN", "1e2", "0.0000000000001"])("非法汇率 %s 不生成金额", rate => {
    expect(convertFx(entry, "CNY", { ...lookup, snapshot: { ...snapshot, rates: { ...snapshot.rates, CNY: rate } } }).reason).toBe("invalid_rate");
  });
  it("禁止未来汇率及超过七日回退", () => {
    for (const date of ["2026-10-26", "2026-10-17"]) expect(convertFx(entry, "CNY", { ...lookup, snapshot: { ...snapshot, date } }).convertedMinor).toBeNull();
  });
  it("缺失不是零，部分统计包含定位信息且不伪造百分比", () => {
    const rows = [entry, { ...entry, id: "missing", occurredLocalDate: "2020-01-01" }];
    const result = aggregateFx("a", "b", rows, "CNY", new Map([[entry.occurredLocalDate, lookup]]));
    expect(result).toMatchObject({ complete: false, missingCount: 1, convertedCount: 1, shareDenominatorMinor: null, totals: { expenseMinor: "16000" } });
    expect(result.failures[0]).toMatchObject({ id: "missing", reason: "missing_rate", bookId: "b" });
    expect(result.originalByCurrency["USD"]?.expenseMinor).toBe("4000");
  });
  it("合计严格累加逐笔显示值，分类月份一致且支持超过安全整数的合计", () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ ...entry, id: String(i), currency: "EUR", amountCents: 1 }));
    const rates = { ...lookup, snapshot: { ...snapshot, rates: { EUR: "1", USD: "0.5" } } } as FxLookup;
    const result = aggregateFx("a", "b", rows, "USD", new Map([[entry.occurredLocalDate, rates]]));
    expect(result.totals.expenseMinor).toBe("3");
    expect(result.categories["c"]).toEqual(result.totals);
    expect(result.months["2026-10"]).toEqual(result.totals);
    expect(aggregateFx("a", "b", [1, 2].map(id => ({ ...entry, id: String(id), amountCents: Number.MAX_SAFE_INTEGER })), "USD", new Map()).totals.expenseMinor).toBe("18014398509481982");
  });
});

describe("缓存隔离与重建", () => {
  it("命中、编辑、日期、目标、账号、账本、版本、汇率内容均进入键", () => {
    const cache = new FxResultCache();
    expect(cache.convert("a", "b", entry, "CNY", lookup).resultCached).toBe(false);
    expect(cache.convert("a", "b", entry, "CNY", lookup).resultCached).toBe(true);
    for (const updated of [{ amountCents: 1 }, { occurredLocalDate: "2026-10-24" }, { version: 2 }])
      expect(cache.convert("a", "b", { ...entry, ...updated }, "CNY", lookup).resultCached).toBe(false);
    expect(cache.convert("other", "b", entry, "CNY", lookup).resultCached).toBe(false);
    expect(cache.convert("a", "other", { ...entry, bookId: "other" }, "CNY", lookup).resultCached).toBe(false);
    expect(cache.convert("a", "b", entry, "JPY", lookup).resultCached).toBe(false);
    expect(cache.convert("a", "b", entry, "CNY", { ...lookup, snapshot: { ...snapshot, revision: "r2" } }).resultCached).toBe(false);
    const revised = cache.convert("a", "b", entry, "CNY", { ...lookup, snapshot: { ...snapshot, rates: { ...snapshot.rates, CNY: "11" } } });
    expect(revised).toMatchObject({ resultCached: false, convertedMinor: "17600" });
    expect(() => cache.convert("a", "wrong", entry, "USD")).toThrow("fx_scope_mismatch");
    expect(() => aggregateFx("a", "b", [{ ...entry, bookId: "other" }], "USD", new Map())).toThrow("fx_scope_mismatch");
    cache.clear(); expect(cache.size).toBe(0);
    expect(cache.convert("a", "b", entry, "CNY", lookup).convertedMinor).toBe("16000");
  });
  it("有界淘汰，不缓存失败", () => {
    const cache = new FxResultCache(1);
    cache.convert("a", "b", entry, "CNY"); expect(cache.size).toBe(0);
    cache.convert("a", "b", entry, "USD"); cache.convert("a", "b", { ...entry, id: "e2" }, "USD");
    expect(cache.size).toBe(1); expect(cache.convert("a", "b", entry, "USD").resultCached).toBe(false);
  });
  it("调用方修改返回值不能污染缓存", () => {
    const cache = new FxResultCache();
    const result = cache.convert("a", "b", entry, "CNY", lookup);
    (result.rate as { numerator: string }).numerator = "999";
    expect(cache.convert("a", "b", entry, "CNY", lookup).rate?.numerator).not.toBe("999");
  });
  it("大批量直接计算不淘汰已有单笔缓存", () => {
    const cache = new FxResultCache(1);
    cache.convert("a", "b", entry, "USD");
    aggregateFx("a", "b", [entry, { ...entry, id: "e2" }], "USD", new Map(), cache);
    expect(cache.convert("a", "b", entry, "USD").resultCached).toBe(true);
  });
});

describe("历史服务与离线", () => {
  function fixture() {
    let calls = 0;
    let next = snapshot;
    const repository = new MemoryFxRepository();
    const provider: FxProvider = { id: snapshot.provider, async fetch() { calls++; return next; } };
    const service = new FxHistoryService(repository, provider, { now: () => now });
    return { service, repository, provider, calls: () => calls, revise: (s: FxSnapshot) => { next = s; } };
  }
  it("周末回退、冷热缓存、离线一致、恢复联网补齐", async () => {
    const f = fixture();
    expect(await f.service.lookup(entry.occurredLocalDate, { offline: true })).toMatchObject({ reason: "missing_rate" });
    const online = await f.service.lookup(entry.occurredLocalDate);
    const offline = await f.service.lookup(entry.occurredLocalDate, { offline: true });
    expect(convertFx(entry, "CNY", online).convertedMinor).toBe(convertFx(entry, "CNY", offline).convertedMinor);
    expect(offline).toMatchObject({ cached: true, snapshot: { date: "2026-10-23" } });
    await f.service.lookup(entry.occurredLocalDate); expect(f.calls()).toBe(1);
  });
  it("同日期并发只抓取一次", async () => {
    const f = fixture(); await Promise.all(Array.from({ length: 20 }, () => f.service.lookup(entry.occurredLocalDate)));
    expect(f.calls()).toBe(1);
  });
  it("修订使旧日期解析也获得新版本；拒绝同版本冲突与乱序覆盖", async () => {
    const f = fixture(); await f.service.lookup(entry.occurredLocalDate);
    const revised = { ...snapshot, fetchedAt: "2026-10-26T12:00:01Z", revision: "r2", rates: { ...snapshot.rates, USD: "1.3" } };
    await f.repository.save(snapshot.provider, "2026-10-24", { snapshot: revised, checkedAt: revised.fetchedAt });
    expect((await f.repository.get(snapshot.provider, entry.occurredLocalDate))?.snapshot.revision).toBe("r2");
    await expect(f.repository.save(snapshot.provider, "2026-10-24", { snapshot, checkedAt: snapshot.fetchedAt })).rejects.toThrow("conflict");
    await expect(f.repository.save(snapshot.provider, "2026-10-24", { snapshot: { ...revised, rates: { ...revised.rates, USD: "1.4" } }, checkedAt: revised.fetchedAt })).rejects.toThrow("conflict");
  });
  it("过期缓存明确不可用，不按交易年代清除", async () => {
    const f = fixture(); await f.service.lookup(entry.occurredLocalDate);
    const later = new FxHistoryService(f.repository, f.provider, { now: () => now + 31 * 86400000 });
    expect(await later.lookup(entry.occurredLocalDate, { offline: true })).toMatchObject({ reason: "stale_rate" });
    expect((await f.repository.get(snapshot.provider, entry.occurredLocalDate))?.snapshot.date).toBe(snapshot.date);
  });
  it("同日修订异常跳变隔离，旧数据仍保留", async () => {
    const f = fixture(); await f.service.lookup(entry.occurredLocalDate);
    f.revise({ ...snapshot, revision: "bad", rates: { ...snapshot.rates, USD: "100" } });
    expect(await f.service.lookup(entry.occurredLocalDate, { refresh: true })).toMatchObject({ reason: "anomaly" });
    expect((await f.repository.get(snapshot.provider, entry.occurredLocalDate))?.snapshot.revision).toBe("r1");
  });
  it.each(["timeout", "network", "api_error", "unsupported_currency", "missing_rate"] as const)("保留来源错误 %s", async reason => {
    const service = new FxHistoryService(new MemoryFxRepository(), { id: "fixture", async fetch() { throw new FxError(reason); } }, { now: () => now });
    expect(await service.lookup(entry.occurredLocalDate)).toEqual({ status: "unavailable", reason });
  });
  it("未来日期、未来汇率、非法数据不入库", async () => {
    const f = fixture(); expect(await f.service.lookup("2026-10-27")).toMatchObject({ reason: "invalid_input" });
    f.revise({ ...snapshot, date: "2026-10-26" });
    expect(await f.service.lookup(entry.occurredLocalDate)).toMatchObject({ reason: "missing_rate" });
    f.revise({ ...snapshot, rates: { EUR: "1", USD: "0" } });
    expect(await f.service.lookup(entry.occurredLocalDate)).toMatchObject({ reason: "invalid_rate" });
    expect(await f.repository.get(snapshot.provider, entry.occurredLocalDate)).toBeNull();
  });
});
