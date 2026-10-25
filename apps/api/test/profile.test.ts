import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { AVATAR_IDS } from "@libellum/shared";
import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

let app: FastifyInstance;
let cookie: string;
let id: string;
const patch = (payload: Record<string, unknown>, session = cookie) => app.inject({ method: "PATCH", url: "/api/v1/auth/profile", headers: { cookie: session }, payload });
beforeEach(async () => {
  await resetDatabase(); app = makeApp(); cookie = await signUp(app, "profile_one");
  id = (await prisma.user.findUniqueOrThrow({ where: { username: "profile_one" } })).id;
});
afterEach(async () => { await app.close(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("账户资料：鉴权、并发与身份稳定性", () => {
  it("数据库头像 CHECK 与共享白名单一致", () => {
    const sql = readFileSync(new URL("../../../prisma/migrations/20261025050000_descent_avatar/migration.sql", import.meta.url), "utf8");
    const check = sql.slice(sql.indexOf("CHECK"));
    expect([...check.matchAll(/'([^']+)'/g)].map(m => m[1])).toEqual([...AVATAR_IDS]);
  });
  it("新芽与海浪可保存，旧头像 ID 继续兼容而不被重新映射", async () => {
    let previousValue = "flower";
    for (const value of ["sprout", "wave", "daoxuan-special", "descent-special", "leaf", "boat", "cat", "moon"]) {
      const response = await patch({ field: "avatarId", value, previousValue });
      expect(response.statusCode).toBe(200);
      expect(response.json().user.avatarId).toBe(value);
      previousValue = value;
    }
  });
  it("必须登录；请求只能修改自己的允许字段", async () => {
    expect((await patch({ field: "avatarId", value: "cat", previousValue: "flower" }, "")).statusCode).toBe(401);
    await signUp(app, "profile_two");
    for (const payload of [
      { field: "id", value: "another", previousValue: id },
      { field: "accountNumber", value: "12345678", previousValue: "" },
      { field: "createdAt", value: "2020", previousValue: "" },
      { field: "isAdmin", value: true, previousValue: false },
      { field: "avatarId", value: "cat", previousValue: "flower", userId: "profile_two" },
    ]) expect((await patch(payload)).statusCode).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { username: "profile_two" } })).avatarId).toBe("flower");
  });

  it("头像白名单校验，保存后新会话与成员列表返回正式头像", async () => {
    for (const value of ["unknown", "https://avatar.test/image", "../cat", "", null]) {
      expect((await patch({ field: "avatarId", value, previousValue: "flower" })).statusCode).toBe(400);
    }
    expect((await patch({ field: "avatarId", value: "cat", previousValue: "flower" })).statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
    expect(me.json().user).toMatchObject({ id, avatarId: "cat" });
    const members = await app.inject({ method: "GET", url: "/api/v1/books/members", headers: { cookie } });
    expect(members.json().members).toEqual(expect.arrayContaining([expect.objectContaining({ userId: id, avatarId: "cat" })]));
  });

  it("昵称可重复；用户名字符与长度由服务端校验", async () => {
    await signUp(app, "profile_two");
    expect((await patch({ field: "displayName", value: "profile_two", previousValue: "profile_one" })).statusCode).toBe(200);
    for (const value of ["a", "中文", "user-name", "a".repeat(21), ""]) expect((await patch({ field: "username", value, previousValue: "profile_one" })).statusCode).toBe(400);
    for (const value of [" ", "a".repeat(41)]) expect((await patch({ field: "displayName", value, previousValue: "profile_two" })).statusCode).toBe(400);
  });

  it("重名返回 409，原用户名不变", async () => {
    await signUp(app, "profile_two");
    const response = await patch({ field: "username", value: "profile_two", previousValue: "profile_one" });
    expect(response.statusCode).toBe(409); expect(response.json().code).toBe("username_taken");
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).username).toBe("profile_one");
  });

  it("两个账号并发抢同名，只能一个成功", async () => {
    const other = await signUp(app, "profile_two");
    const results = await Promise.all([
      patch({ field: "username", value: "same_name", previousValue: "profile_one" }),
      patch({ field: "username", value: "same_name", previousValue: "profile_two" }, other),
    ]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
  });

  it("同一字段并发改动返回冲突，不同字段互不覆盖", async () => {
    const results = await Promise.all([
      patch({ field: "avatarId", value: "cat", previousValue: "flower" }),
      patch({ field: "avatarId", value: "moon", previousValue: "flower" }),
    ]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const response = await patch({ field: "displayName", value: "新昵称", previousValue: "profile_one" });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.avatarId).not.toBe("flower");
  });

  it("改用户名后新名字能登录、搜索及邀请，旧名失效；身份和账目归属不变", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id } });
    const originalMembers = await prisma.bookMember.findMany({ where: { userId: id } });
    const ledger = originalMembers[0]!.bookId;
    const created = await app.inject({ method: "POST", url: "/api/v1/transactions", headers: { cookie }, payload: {
      id: randomUUID(), idempotencyKey: randomUUID(), kind: "expense", amountCents: 1250, currency: "CNY",
      occurredAt: "2026-10-25T12:00:00+08:00", occurredLocalDate: "2026-10-25", occurredTz: "Asia/Shanghai", note: "改名前的历史账目",
    } });
    expect(created.statusCode).toBe(201);
    const transactionBefore = await prisma.transaction.findMany({ where: { bookId: ledger } });
    const eventsBefore = await prisma.transactionEvent.findMany({ where: { bookId: ledger } });
    expect(transactionBefore).toHaveLength(1);
    expect(eventsBefore.length).toBeGreaterThan(0);
    const other = await signUp(app, "profile_two");
    expect((await patch({ field: "username", value: "profile_new", previousValue: "profile_one" })).statusCode).toBe(200);
    for (const [username, status] of [["profile_one", 401], ["profile_new", 200]] as const) {
      const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "correct-horse-battery" } });
      expect(response.statusCode).toBe(status);
    }
    const search = await app.inject({ method: "GET", url: "/api/v1/directory/lookup?username=profile_new", headers: { cookie: other } });
    expect(search.statusCode).toBe(200); expect(search.body).toContain(id);
    const invite = await app.inject({ method: "POST", url: "/api/v1/books/invite", headers: { cookie: other }, payload: { username: "profile_new", role: "viewer" } });
    expect(invite.statusCode).toBe(201);
    const after = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ id, accountNumber: before.accountNumber, createdAt: before.createdAt, passwordHash: before.passwordHash, isAdmin: before.isAdmin });
    expect(await prisma.bookMember.findMany({ where: { userId: id } })).toEqual(originalMembers);
    expect(await prisma.transaction.findMany({ where: { bookId: ledger } })).toEqual(transactionBefore);
    expect(await prisma.transactionEvent.findMany({ where: { bookId: ledger } })).toEqual(eventsBefore);
  });

  it("成员列表分别解析每个人的头像，不继承当前登录者", async () => {
    const other = await signUp(app, "profile_two");
    const second = await prisma.user.findUniqueOrThrow({ where: { username: "profile_two" } });
    const own = await prisma.bookMember.findFirstOrThrow({ where: { userId: id } });
    await prisma.bookMember.create({ data: { bookId: own.bookId, userId: second.id, role: "viewer" } });
    await patch({ field: "avatarId", value: "cat", previousValue: "flower" });
    await patch({ field: "avatarId", value: "moon", previousValue: "flower" }, other);
    const members = await app.inject({ method: "GET", url: "/api/v1/books/members", headers: { cookie } });
    expect(members.json().members).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: id, avatarId: "cat" }),
      expect.objectContaining({ userId: second.id, avatarId: "moon" }),
    ]));
  });

  it("改名前发出的邀请仍可接受，协作查看者权限不因改名改变", async () => {
    const other = await signUp(app, "profile_two");
    const invite = await app.inject({ method: "POST", url: "/api/v1/books/invite", headers: { cookie: other }, payload: { username: "profile_one", role: "viewer" } });
    expect(invite.statusCode).toBe(201);
    const pending = await prisma.notification.findFirstOrThrow({ where: { recipientId: id, status: "pending" } });
    await patch({ field: "username", value: "profile_new", previousValue: "profile_one" });
    const accepted = await app.inject({ method: "POST", url: `/api/v1/notifications/${pending.id}/decide`, headers: { cookie }, payload: { decision: "accepted" } });
    expect(accepted.statusCode).toBe(200);
    expect(await prisma.bookMember.findUniqueOrThrow({ where: { bookId_userId: { bookId: pending.bookId!, userId: id } } })).toMatchObject({ role: "viewer", leftAt: null });
    const forbidden = await app.inject({ method: "POST", url: "/api/v1/transactions", headers: { cookie, "x-libellum-book": pending.bookId! }, payload: {
      id: randomUUID(), idempotencyKey: randomUUID(), kind: "expense", amountCents: 100, currency: "CNY", occurredAt: "2026-10-25T12:00:00+08:00", occurredLocalDate: "2026-10-25", occurredTz: "Asia/Shanghai",
    } });
    expect(forbidden.statusCode).toBe(403);
  });
});
