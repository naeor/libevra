import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { EcbFrankfurterProvider } from "./provider.js";
import { registerFxRoutes } from "./routes.js";
import { FxHistoryService, MemoryFxRepository } from "../../../../packages/shared/src/fxHistory.js";

const now = () => Date.parse("2026-10-26T12:00:00Z");
const row = { date: "2026-10-23", base: "EUR", quote: "USD", rate: 1.25 };
const reply = (body: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(body), { status });

describe("ECB 单源适配器（无联网）", () => {
  it("请求仅发送公共币种和日期，回退并生成稳定内容版本", async () => {
    let requested: URL | undefined;
    const provider = new EcbFrankfurterProvider(async (url) => {
      requested = new URL(String(url)); return new Response(JSON.stringify([row]));
    }, now);
    const first = await provider.fetch("2026-10-25");
    const second = await provider.fetch("2026-10-25");
    expect(requested?.pathname).toBe("/v2/providers/ecb/rates");
    expect([...requested!.searchParams.keys()].sort()).toEqual(["base", "from", "quotes", "to"]);
    expect(first).toMatchObject({ date: "2026-10-23", rates: { EUR: "1", USD: "1.25" } });
    expect(first.revision).toBe(second.revision);
    const revised = await new EcbFrankfurterProvider(reply([{ ...row, rate: 1.26 }]), now).fetch("2026-10-25");
    expect(revised.revision).not.toBe(first.revision);
  });
  it.each([[404, "missing_rate"], [422, "unsupported_currency"], [500, "api_error"], [429, "api_error"]])("HTTP %s 保留明确状态", async (status, reason) => {
    await expect(new EcbFrankfurterProvider(reply({}, status as number), now).fetch("2026-10-25")).rejects.toThrow(String(reason));
  });
  it("超时覆盖响应体读取和忽略 AbortSignal 的请求", async () => {
    const stalled: typeof fetch = () => new Promise(() => undefined);
    await expect(new EcbFrankfurterProvider(stalled, now, 5).fetch("2026-10-25")).rejects.toThrow("timeout");
  });
  it("连接失败", async () => {
    await expect(new EcbFrankfurterProvider(async () => { throw new Error("connection"); }, now).fetch("2026-10-25")).rejects.toThrow("network");
  });
  it("JSON 数字保留完整上游十进制字面量，不先经过 double 舍入", async () => {
    const request: typeof fetch = async () => new Response('[{"date":"2026-10-23","base":"EUR","quote":"USD","rate":123456789012.123456789012}]');
    const result = await new EcbFrankfurterProvider(request, now).fetch("2026-10-25");
    expect(result.rates["USD"]).toBe("123456789012.123456789012");
  });
  it.each([[], [{ ...row, date: "2026-10-26" }], [{ ...row, rate: 0 }], [{ ...row, rate: -1 }], [{ ...row, date: "2026-02-30" }], [{ ...row, quote: "ABC" }], {}, [null]])("拒绝空缺/非法上游 %j", async body => {
    await expect(new EcbFrankfurterProvider(reply(body), now).fetch("2026-10-25")).rejects.toThrow();
  });
  it("冲突观测不能悄悄取最后一条", async () => {
    await expect(new EcbFrankfurterProvider(reply([row, { ...row, rate: 2 }]), now).fetch("2026-10-25")).rejects.toThrow("conflict");
  });
  it("节假日取过去日期，不能拼接不同日期币种", async () => {
    const result = await new EcbFrankfurterProvider(reply([row, { ...row, date: "2026-10-22", quote: "CNY", rate: 8 }]), now).fetch("2026-10-25");
    expect(result.date).toBe("2026-10-23"); expect(result.rates["CNY"]).toBeUndefined();
  });
});

describe("未启用的公共汇率路由插件", () => {
  it("鉴权先执行，参数严格限制且不接受私有财务输入", async () => {
    const app = Fastify(); let calls = 0;
    const service = new FxHistoryService(new MemoryFxRepository(), {
      id: "fixture", async fetch(date) { calls++; return { base: "EUR", provider: "fixture", date, revision: "r", rates: { EUR: "1" }, fetchedAt: new Date(now()).toISOString() }; },
    }, { now });
    await registerFxRoutes(app, { service, requireAuth: async request => {
      if (request.headers.authorization !== "test-session") throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    } });
    try {
      expect((await app.inject({ url: "/api/v1/fx/rates?date=2026-10-25" })).statusCode).toBe(401);
      expect(calls).toBe(0);
      for (const query of ["date=2026-02-30", "date=2026-10-25&amount=20", "", "date=2026-10-25&date=2026-10-24"]) {
        expect((await app.inject({ url: `/api/v1/fx/rates?${query}`, headers: { authorization: "test-session" } })).statusCode).toBe(400);
      }
      const response = await app.inject({ url: "/api/v1/fx/rates?date=2026-10-25", headers: { authorization: "test-session" } });
      expect(response.json()).toMatchObject({ status: "available" }); expect(calls).toBe(1);
    } finally { await app.close(); }
  });
});
