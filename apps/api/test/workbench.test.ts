import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp, prisma, resetDatabase, signUp, cookieFrom } from "./support.js";

let app: FastifyInstance;
let cookie: string;
const documents = {
  content: { schemaVersion: 1, cards: [{ objectId: "card-1", type: "analysis-card", analysis: { analysisId: "AN-B01", params: {} }, chart: { chartFamily: "number" }, rangePolicy: "inherit" }], containers: [] },
  layout: { schemaVersion: 1, layoutAlgorithmVersion: 1, mode: "unified", main: { baseCols: 2, objects: [{ objectId: "card-1", objectType: "analysis-card", anchor: 1, colSpan: 1, rowSpan: 1 }] } },
};
const config = () => ({ schemaVersion: 1, workspace: structuredClone(documents), presets: [] });
const read = (session = cookie) => app.inject({ method: "GET", url: "/api/v1/workbench", headers: { cookie: session } });
const write = (baseVersion: number, configuration: unknown = config(), session = cookie) => app.inject({ method: "POST", url: "/api/v1/workbench", headers: { cookie: session }, payload: { baseVersion, configuration } });
beforeEach(async () => { await resetDatabase(); app = makeApp(); cookie = await signUp(app, "workspace_owner"); });
afterEach(async () => { await app.close(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("W6 真实数据库个人配置 API", () => {
  it("两个独立会话读写同一配置；版本递增且保留前一版", async () => {
    expect((await read()).json().record).toBeNull();
    const first = await write(0); expect(first.statusCode).toBe(200); expect(first.json().record.version).toBe(1);
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "workspace_owner", password: "correct-horse-battery" } });
    const secondCookie = cookieFrom(login.headers);
    expect((await read(secondCookie)).json().record.configuration).toEqual(config());
    const second = await write(1, { schemaVersion: 1, workspace: null, presets: [] }, secondCookie);
    expect(second.statusCode).toBe(200); expect(second.json().record.version).toBe(2);
    const saved = await prisma.workbenchConfiguration.findFirstOrThrow();
    expect(saved.previousConfiguration).toEqual(config());
  });
  it("并行 CAS 只能成功一份，拒绝旧版本与伪造身份字段", async () => {
    await write(0);
    const results = await Promise.all([write(1), write(1, { schemaVersion: 1, workspace: null, presets: [] })]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect((await write(0)).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/v1/workbench", headers: { cookie }, payload: { baseVersion: 2, configuration: config(), userId: "other-user" } })).statusCode).toBe(400);
  });
  it("两个账号互相隔离，伪造账本头不改变配置归属；匿名与过期会话拒绝", async () => {
    await write(0);
    const other = await signUp(app, "workspace_other");
    expect((await read(other)).json().record).toBeNull();
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { username: "workspace_other" } });
    expect((await app.inject({ method: "GET", url: "/api/v1/workbench", headers: { cookie: other, "x-libellum-book": "ffffffff-ffff-ffff-ffff-ffffffffffff" } })).json().record).toBeNull();
    expect((await read("")).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/workbench?accountScope=user:another-user", headers: { cookie } })).statusCode).toBe(403);
    expect((await write(0, config(), "libellum_session=expired")).statusCode).toBe(401);
    expect(await prisma.workbenchConfiguration.findUnique({ where: { userId: otherUser.id } })).toBeNull();
  });
  it("损坏、重复、未知字段与较新 schema 不写入；旧客户端不能覆盖较新云端", async () => {
    for (const configuration of [{ ...config(), transactions: [] }, { ...config(), schemaVersion: 99 }, { ...config(), workspace: { ...documents, amountCents: 100 } }]) {
      expect((await write(0, configuration)).statusCode).toBe(400);
    }
    expect(await prisma.workbenchConfiguration.count()).toBe(0);
    await write(0);
    await prisma.workbenchConfiguration.updateMany({ data: { schemaVersion: 99 } });
    expect((await write(1)).statusCode).toBe(409);
    expect((await read()).json().record.schemaVersion).toBe(99);
  });
  it("个人预设新增和删除参与同一个并发版本，不允许旧列表复活删除", async () => {
    const preset = { id: "preset-1", name: "月度复盘", description: "", documents, filters: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const withPreset = { ...config(), presets: [preset] };
    expect((await write(0, withPreset)).statusCode).toBe(200);
    expect((await write(1)).statusCode).toBe(200);
    expect((await write(1, withPreset)).statusCode).toBe(409);
    expect((await read()).json().record.configuration.presets).toHaveLength(0);
  });
  it("账号数据导出包含配置；注销清理服务端配置并撤销旧会话", async () => {
    await write(0);
    const exported = await app.inject({ method: "GET", url: "/api/v1/account/export", headers: { cookie } });
    expect(exported.statusCode).toBe(200); expect(exported.json().workbench.configuration).toEqual(config());
    const books = (await app.inject({ method: "GET", url: "/api/v1/books", headers: { cookie } })).json().books;
    const closed = await app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie }, payload: {
      password: "correct-horse-battery", confirmation: "注销账号", method: "close_account", decisions: books.map((book: { id: string }) => ({ bookId: book.id, action: "delete" })),
    } });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(await prisma.workbenchConfiguration.count()).toBe(0);
    expect((await read()).statusCode).toBe(401);
  });
});
