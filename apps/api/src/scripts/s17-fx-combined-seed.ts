/**
 * S17 综合折算验收用的合成数据（只写**本机**专用库，不触碰任何真实数据）。
 *
 * 命令（在 apps/api 下运行，DATABASE_URL 指向本机专用库）：
 *   node --import tsx src/scripts/s17-fx-combined-seed.ts init <stateFile>
 *       建合成账号 / 账本 / 分类 / 支付方式，并写入 12 笔混币种账目 + 上期 2 笔（幂等）。
 *   node --import tsx src/scripts/s17-fx-combined-seed.ts rates constant|varying [gapDate,gapDate…]
 *       清空并重建汇率表。constant = 1 USD = 6.4 CNY、1 HKD = 0.8 CNY、1 JPY = 0.05 CNY（与单元测试手算表一致）；
 *       varying = 每天的汇率不同（用来发现「拿错日期的汇率」）。gapDate 列出的日期整天没有汇率。
 *
 * 账目与 `apps/web/src/statsWorkbench/fxFixture.ts` 的 MIXED_ENTRIES / PREVIOUS_ENTRIES 逐笔一致。
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { Pool } from "pg";

import { buildApp } from "../app.js";
import { createConsentPolicy, requiredDocuments } from "../consent/policy.js";
import { createPrismaClient } from "../db.js";
import { PgFxRepository } from "../fx/repository.js";
import { APP_VERSION } from "@libellum/shared";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || !/^postgresql:\/\/[^/]*@(127\.0\.0\.1|localhost)[:/]/.test(databaseUrl)) {
  throw new Error("只允许连接本机数据库");
}
const [, , command, arg1, arg2] = process.argv;
const PROVIDER = "ecb-via-frankfurter-v2";
const USERNAME = "fx_accept";
const PASSWORD = "Fx-Accept-Local-2026";

const CATEGORIES = {
  food: ["餐饮", "expense"],
  transport: ["交通", "expense"],
  shopping: ["购物", "expense"],
  rent: ["房租", "expense"],
  salary: ["工资", "income"],
  freelance: ["兼职", "income"],
} as const;
type CategoryKey = keyof typeof CATEGORIES;

/** [key, 日期, 方向, 币种, 最小单位金额, 分类, 支付方式] —— 与 MIXED_ENTRIES 一致。 */
const CURRENT: ReadonlyArray<readonly [string, string, "expense" | "income", string, number, CategoryKey, "微信" | "现金" | null]> = [
  ["e01", "2026-10-01", "expense", "CNY", 10000, "food", "微信"],
  ["e02", "2026-10-02", "expense", "USD", 1234, "food", "微信"],
  ["e03", "2026-10-02", "expense", "HKD", 750, "transport", null],
  ["e04", "2026-10-03", "income", "CNY", 500000, "salary", null],
  ["e05", "2026-10-03", "expense", "JPY", 1000, "shopping", null],
  ["e06", "2026-10-05", "expense", "CNY", 2500, "transport", "现金"],
  ["e07", "2026-10-05", "income", "USD", 10000, "freelance", null],
  ["e08", "2026-10-10", "expense", "USD", 1000, "food", "现金"],
  ["e09", "2026-10-10", "expense", "HKD", 1001, "food", null],
  ["e10", "2026-10-15", "expense", "CNY", 30000, "rent", null],
  ["e11", "2026-10-20", "expense", "USD", 50000, "shopping", null],
  ["e12", "2026-10-20", "income", "HKD", 100000, "freelance", null],
  // 上一周期（2026-09-04 ~ 2026-09-30）
  ["p01", "2026-09-10", "expense", "USD", 5000, "food", null],
  ["p02", "2026-09-15", "income", "CNY", 100000, "salary", null],
];

const prisma = createPrismaClient(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const app = buildApp({
  version: APP_VERSION,
  prisma,
  checkDatabase: async () => true,
  cookieSecure: false,
  registrationMode: "open",
  consentPolicy: createConsentPolicy(true),
});

function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** 每 EUR 的主币单位数。constant：CNY 8、USD 1.25、HKD 10、JPY 160；varying：随日期变化。 */
function ratesFor(mode: string, date: string): Record<string, string> {
  if (mode === "constant") return { EUR: "1", CNY: "8", USD: "1.25", HKD: "10", JPY: "160" };
  const day = Number(date.slice(8, 10));
  const month = Number(date.slice(5, 7));
  const wobble = (day * 7 + month * 3) % 11; // 0..10
  return {
    EUR: "1",
    CNY: (8 + wobble * 0.01).toFixed(4),
    USD: (1.25 + (wobble % 4) * 0.01).toFixed(4),
    HKD: (10 + (wobble % 3) * 0.02).toFixed(4),
    JPY: (160 + (wobble % 5) * 0.5).toFixed(4),
  };
}

async function init(stateFile: string): Promise<void> {
  const agreements = requiredDocuments(createConsentPolicy(true)).map((row) => ({ documentId: row.id, documentVersion: row.version, contentHash: row.contentHash }));
  const existing = await prisma.user.findUnique({ where: { username: USERNAME } });
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/auth/${existing ? "login" : "register"}`,
    payload: existing ? { username: USERNAME, password: PASSWORD } : { username: USERNAME, password: PASSWORD, displayName: "折算验收", agreements },
  });
  if (![200, 201].includes(response.statusCode)) throw new Error(`账号初始化失败 ${String(response.statusCode)}: ${response.body}`);
  const raw = response.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0]! : String(raw)).split(";")[0]!;
  for (const agreement of agreements) await app.inject({ method: "POST", url: "/api/v1/account/agreements/accept", headers: { cookie }, payload: agreement });
  const user = (await prisma.user.findUnique({ where: { username: USERNAME } }))!;

  let book = await prisma.book.findFirst({ where: { createdBy: user.id, name: "折算验收账本" } });
  if (!book) {
    const created = await app.inject({ method: "POST", url: "/api/v1/books", headers: { cookie }, payload: { name: "折算验收账本" } });
    if (created.statusCode !== 201) throw new Error(`建账本失败 ${created.body}`);
    book = (await prisma.book.findFirst({ where: { createdBy: user.id, name: "折算验收账本" } }))!;
  }
  const activate = await app.inject({ method: "POST", url: `/api/v1/books/${book.id}/activate`, headers: { cookie } });
  if (activate.statusCode !== 200) throw new Error(`选择账本失败 ${activate.body}`);
  const headers = { cookie, "x-libellum-book": book.id };

  const categoryIds: Record<string, string> = {};
  for (const [key, [name, kind]] of Object.entries(CATEGORIES)) {
    const found = await prisma.category.findFirst({ where: { bookId: book.id, name } });
    if (found) { categoryIds[key] = found.id; continue; }
    const created = await app.inject({ method: "POST", url: "/api/v1/categories", headers, payload: { name, kind } });
    if (created.statusCode !== 201) throw new Error(`建分类失败 ${created.body}`);
    categoryIds[key] = JSON.parse(created.body).id ?? JSON.parse(created.body).category?.id;
  }
  const paymentIds: Record<string, string> = {};
  for (const name of ["微信", "现金"]) {
    const found = await prisma.paymentMethod.findFirst({ where: { bookId: book.id, name } });
    if (found) { paymentIds[name] = found.id; continue; }
    const created = await app.inject({ method: "POST", url: "/api/v1/payment-methods", headers, payload: { name } });
    if (created.statusCode !== 201) throw new Error(`建支付方式失败 ${created.body}`);
    paymentIds[name] = JSON.parse(created.body).id ?? JSON.parse(created.body).paymentMethod?.id;
  }

  for (const [key, date, kind, currency, amountCents, category, payment] of CURRENT) {
    const note = `s17-fx:${key}`;
    if (await prisma.transaction.findFirst({ where: { bookId: book.id, note } })) continue;
    const id = randomUUID();
    const result = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers,
      payload: {
        id, idempotencyKey: id, kind, amountCents, currency,
        occurredLocalDate: date, occurredAt: `${date}T04:00:00.000Z`, occurredTz: "Asia/Shanghai",
        categoryId: categoryIds[category], ...(payment === null ? {} : { paymentMethodId: paymentIds[payment] }),
        note, tagIds: [],
      },
    });
    if (result.statusCode !== 201) throw new Error(`建账目 ${key} 失败 ${String(result.statusCode)} ${result.body}`);
  }
  const count = await prisma.transaction.count({ where: { bookId: book.id } });
  writeFileSync(stateFile, JSON.stringify({ username: USERNAME, password: PASSWORD, userId: user.id, bookId: book.id, transactionCount: count }, null, 2));
  console.log(`init ok: user ${user.id} book ${book.id} transactions ${String(count)}`);
}

async function rates(mode: string, gaps: ReadonlySet<string>): Promise<void> {
  if (mode !== "constant" && mode !== "varying") throw new Error("mode 必须是 constant 或 varying");
  await pool.query("DELETE FROM fx_resolutions WHERE provider=$1", [PROVIDER]);
  await pool.query("DELETE FROM fx_snapshots WHERE provider=$1", [PROVIDER]);
  const repository = new PgFxRepository(pool);
  const fetchedAt = new Date(Date.now() - 60_000).toISOString();
  let saved = 0;
  for (const date of dayList("2026-08-01", "2026-10-27")) {
    if (gaps.has(date)) continue;
    const snapshot = { base: "EUR" as const, date, provider: PROVIDER, revision: `s17-${mode}-${date}`, fetchedAt, rates: ratesFor(mode, date) };
    await repository.save(PROVIDER, date, { snapshot, checkedAt: fetchedAt });
    saved += 1;
  }
  console.log(`rates ok: mode=${mode} saved=${String(saved)} gaps=${[...gaps].join(",") || "-"}`);
}

try {
  if (command === "init" && arg1 !== undefined) await init(arg1);
  else if (command === "rates" && arg1 !== undefined) await rates(arg1, new Set((arg2 ?? "").split(",").filter((value) => value !== "")));
  else if (command === "state" && arg1 !== undefined) console.log(readFileSync(arg1, "utf8"));
  else throw new Error("用法: init <stateFile> | rates constant|varying [gapDates]");
} finally {
  await app.close();
  await prisma.$disconnect();
  await pool.end();
}
