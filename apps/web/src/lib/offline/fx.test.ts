import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => new Map<string, unknown>());
const scope = vi.hoisted(() => ({ value: "a:b" }));
vi.mock("./scope.js", () => ({ offlineScope: () => scope.value }));
vi.mock("./storage.js", () => ({
  readValue: vi.fn(async (key: string) => structuredClone(storage.get(key) ?? null)),
  writeValue: vi.fn(async (key: string, value: unknown) => { storage.set(key, structuredClone(value)); return true; }),
}));
import { createOfflineFxService, OfflineFxCalculator, OfflineFxRepository, refillFxDates } from "./fx.js";
import { convertFx, type FxSnapshot } from "../../../../../packages/shared/src/fx.js";
import { readValue, writeValue } from "./storage.js";

const snapshot: FxSnapshot = { base: "EUR", date: "2020-01-03", provider: "fixture", revision: "r1", fetchedAt: new Date().toISOString(), rates: { EUR: "1", USD: "1.25", CNY: "10" } };
beforeEach(() => { storage.clear(); scope.value = "a:b"; });
describe("复用 IndexedDB kv 适配层", () => {
  it("多年前所需日期仍可离线计算，切换账号只共用公共汇率", async () => {
    const provider = { id: "fixture", fetch: vi.fn(async () => snapshot) };
    const first = createOfflineFxService(provider);
    expect(await first.lookup("2020-01-05", { offline: true })).toMatchObject({ reason: "missing_rate" });
    await refillFxDates(first, ["2020-01-05", "2020-01-05"]);
    const second = createOfflineFxService(provider);
    const offline = await second.lookup("2020-01-05", { offline: true });
    expect(offline).toMatchObject({ status: "available", cached: true });
    expect(convertFx({ id: "e", bookId: "b", amountCents: 1, currency: "USD", occurredLocalDate: "2020-01-05", kind: "expense", categoryId: "c" }, "CNY", offline).convertedMinor).toBe("8");
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...storage.values()])).not.toMatch(/amountCents|bookId|accountId|categoryId|convertedMinor/);
  });
  it("容量淘汰只删除公共缓存项，不碰原始账目", async () => {
    storage.set("ledger-months:a:b", { sentinel: true });
    const repo = new OfflineFxRepository(1);
    await repo.save("fixture", "2020-01-04", { snapshot, checkedAt: snapshot.fetchedAt });
    await repo.save("fixture", "2020-01-05", { snapshot, checkedAt: snapshot.fetchedAt });
    expect(await repo.get("fixture", "2020-01-04")).toBeNull();
    expect(storage.get("ledger-months:a:b")).toEqual({ sentinel: true });
  });
  it("损坏本地缓存降级缺失，不影响记账", async () => {
    storage.set("fx-public-rates-v1", { values: { '["fixture","2020-01-05"]': { snapshot: { rates: { USD: "0" } } } } });
    expect(await new OfflineFxRepository().get("fixture", "2020-01-05")).toBeNull();
    await new OfflineFxRepository().save("fixture", "2020-01-05", { snapshot, checkedAt: snapshot.fetchedAt });
    expect((await new OfflineFxRepository().get("fixture", "2020-01-05"))?.snapshot.revision).toBe("r1");
  });
  it("IndexedDB 无响应有界退出，下一次读取仍可恢复", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(readValue).mockReturnValueOnce(new Promise<never>(() => undefined));
      const pending = expect(new OfflineFxRepository().get("fixture", "2020-01-05")).rejects.toThrow("fx_storage_timeout");
      await vi.advanceTimersByTimeAsync(1600);
      await pending;
      expect(await new OfflineFxRepository().get("fixture", "2020-01-05")).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("容量/写入失败明确返回存储错误且不污染原件，恢复后可以补齐", async () => {
    storage.set("ledger-months:a:b", { sentinel: true });
    vi.mocked(writeValue).mockResolvedValueOnce(false);
    const provider = { id: "fixture", async fetch() { return snapshot; } };
    const service = createOfflineFxService(provider);
    expect(await service.lookup("2020-01-05")).toMatchObject({ status: "unavailable", reason: "storage_error" });
    expect(storage.get("ledger-months:a:b")).toEqual({ sentinel: true });
    expect(await service.lookup("2020-01-05")).toMatchObject({ status: "available" });
  });
  it("跨实例串行保存不丢日期，同日修订更新已有假日解析", async () => {
    const one = new OfflineFxRepository(), two = new OfflineFxRepository();
    await Promise.all([one.save("fixture", "2020-01-04", { snapshot, checkedAt: snapshot.fetchedAt }), two.save("fixture", "2020-01-05", { snapshot, checkedAt: snapshot.fetchedAt })]);
    const revised = { ...snapshot, revision: "r2", fetchedAt: new Date(Date.parse(snapshot.fetchedAt) + 1000).toISOString(), rates: { ...snapshot.rates, USD: "1.3" } };
    await two.save("fixture", "2020-01-05", { snapshot: revised, checkedAt: revised.fetchedAt });
    expect((await one.get("fixture", "2020-01-04"))?.snapshot.revision).toBe("r2");
    await expect(one.save("fixture", "2020-01-05", { snapshot, checkedAt: snapshot.fetchedAt })).rejects.toThrow("fx_revision_conflict");
  });
  it("公共持久层白名单剔除误传的交易字段", async () => {
    const repo = new OfflineFxRepository();
    await repo.save("fixture", "2020-01-05", { snapshot: { ...snapshot, accountId: "secret", amountCents: 88 } as FxSnapshot, checkedAt: snapshot.fetchedAt });
    expect(JSON.stringify([...storage.values()])).not.toMatch(/secret|accountId|amountCents/);
  });
  it("账号和账本切换校验当前作用域，退出后拒绝计算", () => {
    const calculator = new OfflineFxCalculator();
    const entry = { id: "e", bookId: "b", amountCents: 100, currency: "USD", occurredLocalDate: "2020-01-05", kind: "expense" as const, categoryId: "c" };
    expect(calculator.aggregate([entry], "USD", new Map()).totals.expenseMinor).toBe("100");
    scope.value = "other:b";
    expect(calculator.aggregate([entry], "USD", new Map()).totals.expenseMinor).toBe("100");
    scope.value = "other:another";
    expect(() => calculator.aggregate([entry], "USD", new Map())).toThrow("fx_scope_mismatch");
    scope.value = "";
    expect(() => calculator.aggregate([entry], "USD", new Map())).toThrow("fx_scope_unresolved");
  });
  it("异步汇总途中切换账号/账本不返回旧财务结果", async () => {
    const entry = { id: "e", bookId: "b", amountCents: 100, currency: "USD", occurredLocalDate: "2020-01-05", kind: "expense" as const, categoryId: "c" };
    const calculator = new OfflineFxCalculator();
    await expect(calculator.aggregateAsync([entry, entry], "USD", new Map(), { batchSize: 1,
      yieldControl: async () => { scope.value = "other:another"; } })).rejects.toThrow("fx_scope_changed");
  });
  it("新目标币种请求或主动清理会废弃旧异步请求", async () => {
    const entry = { id: "e", bookId: "b", amountCents: 100, currency: "USD", occurredLocalDate: "2020-01-05", kind: "expense" as const, categoryId: "c" };
    const calculator = new OfflineFxCalculator();
    await expect(calculator.aggregateAsync([entry, entry], "USD", new Map(), { batchSize: 1,
      yieldControl: async () => { calculator.aggregate([entry], "CNY", new Map()); } })).rejects.toThrow("fx_request_superseded");
    await expect(calculator.aggregateAsync([entry, entry], "USD", new Map(), { batchSize: 1,
      yieldControl: async () => { calculator.clear(); } })).rejects.toThrow("fx_request_superseded");
  });
});
