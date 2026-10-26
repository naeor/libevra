import { readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { parse } from "dotenv";
import { Pool } from "pg";
import { createPrismaClient } from "../db.js";
import { buildApp } from "../app.js";
import { createConsentPolicy, requiredDocuments } from "../consent/policy.js";
import { EcbFrankfurterProvider } from "./provider.js";
import { PgFxRepository } from "./repository.js";

const root = new URL("../../../../", import.meta.url), env = parse(await readFile(new URL(".env", root), "utf8"));
const url = new URL(env["DATABASE_URL"]!);
if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== "/libevra_fx_s16d_dev") throw new Error("只允许专用预览库");
const configPath = new URL("_backups/fx-d4/preview.json", root);
let password: string;
try { password = JSON.parse(await readFile(configPath, "utf8")).password; } catch { password = randomBytes(18).toString("base64url"); }
await writeFile(configPath, JSON.stringify({ password, usernames: ["fx_preview", "fx_member", "fx_outsider"], url: "http://127.0.0.2:5186" }, null, 2));
const prisma = createPrismaClient(url.toString()), pool = new Pool({ connectionString: url.toString() });
const app = buildApp({ version: "1.16.20", prisma, checkDatabase: async () => true, cookieSecure: false, registrationMode: "open", consentPolicy: createConsentPolicy(true) });
const agreements = requiredDocuments(createConsentPolicy(true)).map(row => ({ documentId: row.id, documentVersion: row.version, contentHash: row.contentHash }));
const cookies: Record<string, string> = {};
try {
  for (const username of ["fx_preview", "fx_member", "fx_outsider"]) {
    const exists = await prisma.user.findUnique({ where: { username } });
    const response = await app.inject({ method: "POST", url: `/api/v1/auth/${exists ? "login" : "register"}`,
      payload: exists ? { username, password } : { username, password, displayName: username, agreements } });
    if (![200, 201].includes(response.statusCode)) throw new Error(`本地合成账号初始化失败 ${response.statusCode}: ${response.body}`);
    const raw = response.headers["set-cookie"];
    cookies[username] = (Array.isArray(raw) ? raw[0]! : String(raw)).split(";")[0]!;
    for (const agreement of agreements) await app.inject({ method: "POST", url: "/api/v1/account/agreements/accept", headers: { cookie: cookies[username]! }, payload: agreement });
  }
  const owner = (await prisma.user.findUnique({ where: { username: "fx_preview" } }))!;
  const member = (await prisma.user.findUnique({ where: { username: "fx_member" } }))!;
  let book = await prisma.book.findFirst({ where: { createdBy: owner.id, name: "汇率验收共享账本" } });
  if (!book) {
    const created = await app.inject({ method: "POST", url: "/api/v1/books", headers: { cookie: cookies["fx_preview"]! }, payload: { name: "汇率验收共享账本" } });
    if (created.statusCode !== 201) throw new Error(`创建合成账本失败 ${created.body}`);
    book = (await prisma.book.findFirst({ where: { createdBy: owner.id, name: "汇率验收共享账本" } }))!;
  }
  await prisma.bookMember.upsert({ where: { bookId_userId: { bookId: book.id, userId: member.id } }, update: {}, create: { bookId: book.id, userId: member.id, role: "viewer" } });
  await prisma.user.update({ where: { id: member.id }, data: { defaultCurrency: "USD" } });
  const headers = { cookie: cookies["fx_preview"]!, "x-libellum-book": book.id };
  // 仅修正本工具在专用合成库的样本说明；不触碰金额、币种、日期或真实用户数据。
  for (const [before, after] of [["早期美元 · 可折算", "早期美元 · 历史样本"], ["早期人民币 · 缺汇率", "早期人民币 · 原币可用"]] as const) {
    await prisma.transaction.updateMany({ where: { bookId: book.id, note: before }, data: { note: after } });
  }
  const rows = [
    ["超市 · 原币人民币", "CNY", 10000, "expense", "2026-10-23"], ["午餐 · 美元", "USD", 2000, "expense", "2026-10-23"],
    ["咖啡 · 欧元", "EUR", 1000, "expense", "2026-10-23"], ["交通 · 日元", "JPY", 1500, "expense", "2026-10-24"],
    ["茶点 · 港币", "HKD", 8000, "expense", "2026-10-25"], ["书籍 · 英镑", "GBP", 5000, "expense", "2026-10-23"],
    ["工资 · 原币人民币", "CNY", 200000, "income", "2026-10-23"], ["早期美元 · 历史样本", "USD", 10000, "expense", "1999-01-04"],
    ["早期人民币 · 原币可用", "CNY", 10000, "expense", "1999-01-04"],
  ] as const;
  for (const [note, currency, amountCents, kind, date] of rows) {
    if (await prisma.transaction.findFirst({ where: { bookId: book.id, note } })) continue;
    const result = await app.inject({ method: "POST", url: "/api/v1/transactions", headers,
      payload: { id: randomUUID(), amountCents, currency, kind, occurredLocalDate: date, occurredAt: `${date}T04:00:00Z`, occurredTz: "Asia/Shanghai", note, idempotencyKey: randomUUID() } });
    if (result.statusCode !== 201) throw new Error(`合成流水失败 ${result.body}`);
  }
  for (const username of ["fx_preview", "fx_member"]) {
    const result = await app.inject({ method: "POST", url: `/api/v1/books/${book.id}/activate`, headers: { cookie: cookies[username]! } });
    if (result.statusCode !== 200) throw new Error(`选择账本失败 ${result.body}`);
  }
  const capture = JSON.parse(await readFile(new URL("fixtures/live-20261026/requests.json", import.meta.url), "utf8"));
  const repository = new PgFxRepository(pool);
  for (const [sample, date] of [["adapter-recent", "2026-10-23"], ["adapter-recent", "2026-10-24"], ["adapter-recent", "2026-10-25"], ["early", "1999-01-04"]]) {
    const record = capture.records.find((row: { name: string }) => row.name === sample);
    const snapshot = await new EcbFrankfurterProvider(async () => new Response(record.body, { status: record.status }), () => Date.parse(capture.capturedAt)).fetch(date!);
    await repository.save(snapshot.provider, date!, { snapshot, checkedAt: new Date().toISOString() });
  }
  const transactions = await prisma.transaction.findMany({ where: { bookId: book.id }, select: { id: true, note: true, amountCents: true, currency: true, occurredLocalDate: true } });
  await writeFile(configPath, JSON.stringify({ password, usernames: ["fx_preview", "fx_member", "fx_outsider"], url: "http://127.0.0.2:5186", bookId: book.id, ownerId: owner.id, memberId: member.id, transactions }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
  console.log(`预览合成数据已就绪：3 个合成账号、共享账本、${transactions.length} 笔原币记录；凭据只在 ignored preview.json`);
} finally { await app.close(); await prisma.$disconnect(); await pool.end(); }
