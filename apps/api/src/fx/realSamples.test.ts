import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EcbFrankfurterProvider } from "./provider.js";
import { aggregateFx, convertFx, type FxSnapshot } from "../../../../packages/shared/src/fx.js";
import { FxHistoryService, MemoryFxRepository } from "../../../../packages/shared/src/fxHistory.js";

const directory = new URL("./fixtures/live-20261026/", import.meta.url);
const capture = JSON.parse(readFileSync(new URL("requests.json", directory), "utf8")) as {
  records: { name: string; status: number; body: string; url: string }[];
};
const oracle = JSON.parse(readFileSync(new URL("oracle.json", directory), "utf8")) as {
  officialAndV1Match: boolean;
  cases: { sample: string; date: string; rateDate: string; source: string; target: string; minor: number; expectedMinor: string | null }[];
};
const now = () => Date.parse("2026-10-26T15:00:00Z");
export async function realSnapshot(name: string, date: string): Promise<FxSnapshot> {
  const record = capture.records.find(record => record.name === name)!;
  return new EcbFrankfurterProvider(async () => new Response(record.body, { status: record.status }), now).fetch(date);
}
describe("真实公开响应回归（不联网）", () => {
  it.each([["weekday", "2024-05-15", "2024-05-15"], ["weekend", "2024-05-19", "2024-05-17"],
    ["holiday", "2024-12-25", "2024-12-24"], ["early", "1999-01-04", "1999-01-04"], ["adapter-recent", "2026-10-23", "2026-10-23"]])("%s 保留真实发布日期", async (name, date, actual) => {
    expect((await realSnapshot(name!, date!)).date).toBe(actual);
  });
  it.each(oracle.cases)("$sample $source→$target 与独立 Decimal 参照一致", async row => {
    const snapshot = await realSnapshot(row.sample, row.date);
    const result = convertFx({ id: "synthetic", bookId: "synthetic", currency: row.source, amountCents: row.minor,
      occurredLocalDate: row.date, kind: "expense", categoryId: "test" }, row.target, { status: "available", snapshot, cached: false });
    expect(result.convertedMinor).toBe(row.expectedMinor);
    if (row.expectedMinor === null) expect(result.reason).toBe("missing_rate");
    else if (row.source !== row.target) expect(result.rateDate).toBe(row.rateDate);
  });
  it("v2 ECB 与官方 CSV、v1 的实际同日值一致，混合接口不作为替代源", async () => {
    expect(oracle.officialAndV1Match).toBe(true);
    const ecb = await realSnapshot("weekday", "2024-05-15");
    const blended = JSON.parse(capture.records.find(r => r.name === "blended")!.body) as { quote: string; rate: number }[];
    expect(String(blended.find(r => r.quote === "CNY")!.rate)).not.toBe(ecb.rates["CNY"]);
  });
  it.each([["missing", "1990-01-01", "missing_rate"], ["unsupported", "2024-05-15", "unsupported_currency"]])("%s 真实失败响应", async (name, date, reason) => {
    await expect(realSnapshot(name!, date!)).rejects.toThrow(reason);
  });
  it("真实 v1 对象不能误当 v2 列表，CNY 覆盖边界不能泛化为每日完整", async () => {
    await expect(realSnapshot("v1", "2024-05-15")).rejects.toThrow("invalid_rate");
    const coverage = JSON.parse(capture.records.find(r => r.name === "coverage-cny")!.body);
    expect(coverage).toMatchObject({ providers: ["ECB"], quotes: ["CNY"], start_date: "2000-01-13" });
  });
  it("早期缺少 CNY 的真实数据必须返回不完整小计", async () => {
    const snapshot = await realSnapshot("early", "1999-01-04");
    const entries = ["USD", "CNY"].map(currency => ({ id: currency, bookId: "b", currency, amountCents: 100,
      occurredLocalDate: "1999-01-04", kind: "expense" as const, categoryId: "test" }));
    const result = aggregateFx("a", "b", entries, "EUR", new Map([["1999-01-04", { status: "available", snapshot, cached: false }]]));
    expect(result).toMatchObject({ complete: false, missingCount: 1, convertedCount: 1, shareDenominatorMinor: null });
    expect(result.failures[0]?.id).toBe("CNY");
  });
  it("真实汇率保存后跨实例离线计算一致，数月未复核仍保留有效观察", async () => {
    const snapshot = await realSnapshot("weekday", "2024-05-15");
    const repository = new MemoryFxRepository();
    const provider = { id: snapshot.provider, async fetch() { return snapshot; } };
    const online = await new FxHistoryService(repository, provider, { now }).lookup("2024-05-15");
    const offline = await new FxHistoryService(repository, provider, { now: () => now() + 100 * 86400000 }).lookup("2024-05-15", { offline: true });
    expect(offline).toMatchObject({ status: "available", review: { needsReview: true } });
    const entry = { id: "synthetic", bookId: "b", amountCents: 1, currency: "JPY", occurredLocalDate: "2024-05-15", kind: "income" as const, categoryId: "test" };
    expect(convertFx(entry, "CNY", offline).convertedMinor).toBe(convertFx(entry, "CNY", online).convertedMinor);
  });
});
