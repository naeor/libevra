import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FxHistoryService, MemoryFxRepository } from "@libellum/shared";
import { makeApp, prisma, signUp, resetDatabase } from "./support.js";

function service() {
  const now = Date.now();
  return new FxHistoryService(new MemoryFxRepository(), { id: "test-ecb", async fetch(date) {
    return { base: "EUR", date, provider: "test-ecb", revision: "test-1", fetchedAt: new Date(now).toISOString(), rates: { EUR: "1", USD: "1.1193", CNY: "7.466", JPY: "175.51", HKD: "8.7793", GBP: "0.83728" } };
  } }, { now: () => now });
}
beforeEach(resetDatabase);
afterAll(async () => { await prisma.$disconnect(); });
describe("正式 app 汇率接入边界", () => {
  it("真实鉴权、严格参数、公共响应不含财务与身份数据", async () => {
    const app = makeApp({ fxService: service() });
    try {
      expect((await app.inject({ url: "/api/v1/fx/rates?date=2026-10-23" })).statusCode).toBe(401);
      const cookie = await signUp(app, "fx_api_owner");
      const response = await app.inject({ url: "/api/v1/fx/rates?date=2026-10-23", headers: { cookie } });
      expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ status: "available" });
      expect(response.body).not.toMatch(/amountCents|bookId|userId|accountNumber/);
      expect((await app.inject({ url: "/api/v1/fx/rates?date=2026-10-23&amount=1", headers: { cookie } })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
  it("公共汇率不构成账本授权，外人仍不能读取或修改账本", async () => {
    const app = makeApp({ fxService: service() });
    try {
      const ownerCookie = await signUp(app, "fx_book_owner");
      const otherCookie = await signUp(app, "fx_book_outsider");
      const book = await prisma.book.findFirst({ where: { creator: { username: "fx_book_owner" } } });
      expect(book).not.toBeNull();
      expect((await app.inject({ url: "/api/v1/fx/rates?date=2026-10-23", headers: { cookie: otherCookie } })).statusCode).toBe(200);
      expect((await app.inject({ url: "/api/v1/transactions", headers: { cookie: otherCookie, "x-libellum-book": book!.id } })).statusCode).toBe(403);
      expect((await app.inject({ url: "/api/v1/transactions", headers: { cookie: ownerCookie, "x-libellum-book": book!.id } })).statusCode).toBe(200);
      const other = (await prisma.user.findUnique({ where: { username: "fx_book_outsider" } }))!;
      await prisma.bookMember.create({ data: { bookId: book!.id, userId: other.id, role: "viewer" } });
      expect((await app.inject({ url: "/api/v1/transactions", headers: { cookie: otherCookie, "x-libellum-book": book!.id } })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/api/v1/transactions", headers: { cookie: otherCookie, "x-libellum-book": book!.id }, payload: {} })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
  it("注册在主 app 的路由受单独限流", async () => {
    const app = makeApp({ fxService: service() });
    try {
      const cookie = await signUp(app, "fx_rate_limit");
      let status = 200;
      for (let i = 0; i < 600; i++) status = (await app.inject({ url: "/api/v1/fx/rates?date=2026-10-23", headers: { cookie } })).statusCode;
      expect(status).toBe(200);
      status = (await app.inject({ url: "/api/v1/fx/rates?date=2026-10-23", headers: { cookie } })).statusCode;
      expect(status).toBe(429);
    } finally { await app.close(); }
  });
});
