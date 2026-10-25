import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createPrismaClient } from "../src/db.js";
import { DEFAULT_BOOK_NAME_EN, defaultBookNameFor } from "../src/ledger/defaultName.js";
import { resetDatabase as resetAllTables } from "./support.js";

const prisma = createPrismaClient(process.env["DATABASE_URL"] ?? "");

const INVITE_CODE = "TESTINVITE01";
const REGISTER_BODY = {
  inviteCode: INVITE_CODE,
  username: "mama",
  displayName: "妈妈",
  password: "correct-horse-battery",
};

function makeApp(): FastifyInstance {
  return buildApp({
    version: "0.1.0-test",
    checkDatabase: async () => true,
    prisma,
    webOrigin: "http://localhost:5173",
    cookieSecure: false,
  });
}

function cookieFrom(headers: Record<string, unknown>): string {
  const raw = headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value !== "string") {
    throw new Error("response did not set a cookie");
  }

  return value.split(";")[0] ?? "";
}

async function seedInvite(code: string = INVITE_CODE): Promise<void> {
  await prisma.registrationInvite.create({ data: { code } });
}

async function defaultBookNameOf(username: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  const book = await prisma.book.findFirstOrThrow({
    where: { members: { some: { userId: user.id } } },
    select: { name: true },
  });
  return book.name;
}

let app: FastifyInstance;

beforeEach(async () => {
  await resetAllTables();
  app = makeApp();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("defaultBookNameFor", () => {
  it("英文请求得到英文默认名", () => {
    expect(defaultBookNameFor("en-US")).toBe(DEFAULT_BOOK_NAME_EN);
    expect(defaultBookNameFor("en")).toBe(DEFAULT_BOOK_NAME_EN);
    expect(defaultBookNameFor("en-GB,en;q=0.9")).toBe(DEFAULT_BOOK_NAME_EN);
  });

  it("中文请求、缺失与无法识别的请求都得到中文默认名", () => {
    expect(defaultBookNameFor("zh-CN")).toBe("我的账本");
    expect(defaultBookNameFor("zh-CN,zh;q=0.9,en;q=0.8")).toBe("我的账本");
    expect(defaultBookNameFor(undefined)).toBe("我的账本");
    expect(defaultBookNameFor("")).toBe("我的账本");
    expect(defaultBookNameFor("fr-FR,de;q=0.8")).toBe("我的账本");
    expect(defaultBookNameFor(";;;")).toBe("我的账本");
  });

  it("按请求头顺序取第一个支持的语言", () => {
    expect(defaultBookNameFor("en-US,zh-CN;q=0.9")).toBe(DEFAULT_BOOK_NAME_EN);
    expect(defaultBookNameFor("zh-CN,en-US;q=0.9")).toBe("我的账本");
  });
});

describe("注册时创建的默认账本名", () => {
  it("英文界面注册，第一本账叫 My Ledger", async () => {
    await seedInvite();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "accept-language": "en-US" },
      payload: REGISTER_BODY,
    });

    expect(response.statusCode).toBe(201);
    expect(await defaultBookNameOf(REGISTER_BODY.username)).toBe("My Ledger");
  });

  it("没有语言头时保持中文默认名", async () => {
    await seedInvite();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: REGISTER_BODY,
    });

    expect(response.statusCode).toBe(201);
    expect(await defaultBookNameOf(REGISTER_BODY.username)).toBe("我的账本");
  });
});

describe("新建第二本账的默认名", () => {
  it("英文界面新建且未填名称时跟随请求语言", async () => {
    await seedInvite();
    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: REGISTER_BODY,
    });
    const cookie = cookieFrom(registered.headers);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/books",
      headers: { cookie, "accept-language": "en-US" },
      payload: {},
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "My Ledger" });
  });
});
