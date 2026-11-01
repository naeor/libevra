import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp, prisma, resetDatabase, signUp, cookieFrom } from "./support.js";
let app: FastifyInstance, cookie: string, scope: string;
const book = "11111111-1111-4111-8111-111111111111", otherBook = "22222222-2222-4222-8222-222222222222";
const a = { main: "overview", first: "balance", second: "daily" };
const b = { ...a, mainMetrics: ["expenseTrend"] };
const read = (id = book, session = cookie, accountScope = scope) => app.inject({ method: "GET", url: `/api/v1/detail-cards/${id}?accountScope=${encodeURIComponent(accountScope)}`, headers: { cookie: session } });
const write = (baseVersion: number, configuration: unknown = a, id = book) => app.inject({ method: "POST", url: `/api/v1/detail-cards/${id}`, headers: { cookie }, payload: { baseVersion, configuration, accountScope: scope } });
beforeEach(async () => { await resetDatabase(); app = makeApp(); cookie = await signUp(app, "card_owner"); scope = "user:" + (await prisma.user.findFirstOrThrow()).id; });
afterEach(async () => { await app.close(); });
afterAll(async () => { await prisma.$disconnect(); });
describe("个人账本展示配置 API", () => {
  it("同账号跨会话读取，账本与账号各自隔离", async () => {
    expect((await write(0, b)).statusCode).toBe(200);
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "card_owner", password: "correct-horse-battery" } });
    expect((await read(book, cookieFrom(login.headers))).json().record.configuration).toEqual(b);
    expect((await read(otherBook)).json().record).toBeNull();
    const other = await signUp(app, "card_other");
    const otherUser = await prisma.user.findFirstOrThrow({ where: { id: { not: scope.slice(5) } } });
    expect((await read(book, other, "user:" + otherUser.id)).json().record).toBeNull();
    expect((await read(book, other, scope)).statusCode).toBe(403);
  });
  it("旧版本覆盖被拒绝，冲突响应提供远端方案", async () => {
    await write(0, a); const response = await write(0, b);
    expect(response.statusCode).toBe(409); expect(response.json().details.record.configuration).toEqual(a);
    expect((await read()).json().record.configuration).toEqual(a);
  });
  it("分析配置与卡片交错保存互不覆盖", async () => {
    await write(0, b);
    const workspace = { schemaVersion: 1, workspace: null, presets: [] };
    const current = await app.inject({ method: "GET", url: "/api/v1/workbench", headers: { cookie } });
    expect(current.json().record.configuration).toEqual(workspace);
    const saved = await app.inject({ method: "POST", url: "/api/v1/workbench", headers: { cookie }, payload: { baseVersion: current.json().record.version, configuration: workspace } });
    expect(saved.statusCode).toBe(200);
    expect((await read()).json().record.configuration).toEqual(b);
    await write(1, a);
    const after = await app.inject({ method: "GET", url: "/api/v1/workbench", headers: { cookie } });
    expect(after.json().record.configuration).toEqual(workspace);
    expect(after.json().record.version).toBe(saved.json().record.version);
  });
  it("非法容量、未声明类型和未登录请求被拒绝", async () => {
    for (const value of [{ ...b, first: "expenseBars" }, { ...b, mainMetrics: ["incomeTrend", "expenseBars"] }, { ...a, userId: "other" }]) expect((await write(0, value)).statusCode).toBe(400);
    expect((await read(book, "")).statusCode).toBe(401);
    expect((await read()).json().record).toBeNull();
  });
});
