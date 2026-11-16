import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp, prisma, resetDatabase, signUp, cookieFrom } from "./support.js";

let app: FastifyInstance;
let cookie: string;

const documents = {
  content: {
    schemaVersion: 1,
    cards: [
      { objectId: "dash-ledger", type: "analysis-card", analysis: { analysisId: "DB-ledger", params: {} }, chart: { chartFamily: "dashboard", options: { native: { bookId: "b1", metric: "income" }, display: { note: "家里的", masked: true } } }, rangePolicy: "inherit" },
      { objectId: "card-1", type: "analysis-card", analysis: { analysisId: "AN-I01", params: {} }, chart: { chartFamily: "donut", options: { source: { bookId: "b2" } } }, rangePolicy: "inherit" },
    ],
    containers: [],
  },
  layout: { schemaVersion: 1, layoutAlgorithmVersion: 1, mode: "unified", main: { baseCols: 4, objects: [
    { objectId: "dash-ledger", objectType: "analysis-card", anchor: 1, colSpan: 2, rowSpan: 2 },
    { objectId: "card-1", objectType: "analysis-card", anchor: 3, colSpan: 2, rowSpan: 3 },
  ] } },
};
const config = () => ({
  schemaVersion: 1,
  pages: [{ id: "main", name: "", documents: structuredClone(documents) }, { id: "page-2", name: "各账本", kind: "per-book", documents: structuredClone(documents) }],
  knownBooks: ["b1", "b2"],
  settings: { time: { kind: "preset", preset: "30d" }, books: "all", combined: true, sidebar: { modules: [{ kind: "quick", methods: ["manual"] }, { kind: "inspector" }] } },
  presets: [{ id: "preset-1", name: "月末", createdAt: "2026-11-16T00:00:00.000Z", documents: structuredClone(documents) }],
  templates: [{ id: "tpl-1", bookId: "b1", name: "午饭", kind: "expense", amountCents: 2500, currency: "CNY", categoryId: "c1", paymentMethodId: null, note: "食堂", tagIds: [] }],
});
const read = (session = cookie) => app.inject({ method: "GET", url: "/api/v1/dashboard-config", headers: { cookie: session } });
const write = (baseVersion: number, configuration: unknown = config(), session = cookie) =>
  app.inject({ method: "POST", url: "/api/v1/dashboard-config", headers: { cookie: session }, payload: { baseVersion, configuration } });

beforeEach(async () => { await resetDatabase(); app = makeApp(); cookie = await signUp(app, "dashboard_owner"); });
afterEach(async () => { await app.close(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("1.19.104 总览跨设备配置 API", () => {
  it("没登录不能读写", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/dashboard-config" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/dashboard-config", payload: { baseVersion: 0, configuration: config() } })).statusCode).toBe(401);
  });

  it("两个会话读写同一份；版本递增并保留前一版", async () => {
    expect((await read()).json().record).toBeNull();
    const first = await write(0);
    expect(first.statusCode).toBe(200);
    expect(first.json().record.version).toBe(1);
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "dashboard_owner", password: "correct-horse-battery" } });
    const second = cookieFrom(login.headers);
    expect((await read(second)).json().record.configuration).toEqual(config());
    const next = { ...config(), knownBooks: ["b1"] };
    expect((await write(1, next, second)).json().record.version).toBe(2);
    const row = await prisma.dashboardConfiguration.findFirstOrThrow();
    expect((row.previousConfiguration as { knownBooks: string[] }).knownBooks).toEqual(["b1", "b2"]);
  });

  it("版本不对返回 409，并带回云端那一份", async () => {
    await write(0);
    const stale = await write(0);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("dashboard_config_conflict");
    expect(stale.json().details.record.version).toBe(1);
  });

  it("不接受夹带的字段、未知的卡片选项、超出上限与重复 id", async () => {
    const extra = { ...config(), secret: "x" };
    expect((await write(0, extra)).statusCode).toBe(400);
    const badOption = config();
    (badOption.pages[0]!.documents.content.cards[0]!.chart.options as Record<string, unknown>)["native"] = { bookId: "b1", amount: 100 };
    expect((await write(0, badOption)).statusCode).toBe(400);
    const tooMany = { ...config(), templates: Array.from({ length: 31 }, (_, index) => ({ ...config().templates[0]!, id: `tpl-${String(index)}` })) };
    expect((await write(0, tooMany)).statusCode).toBe(400);
    const duplicate = { ...config(), pages: [config().pages[0]!, config().pages[0]!] };
    expect((await write(0, duplicate)).statusCode).toBe(400);
    const overlapping = config();
    overlapping.pages[0]!.documents.layout.main.objects[1]!.anchor = 1;
    expect((await write(0, overlapping)).statusCode).toBe(400);
    expect(await prisma.dashboardConfiguration.count()).toBe(0);
  });

  it("只读写自己的：另一个账号看不到这份", async () => {
    await write(0);
    const other = await signUp(app, "dashboard_other");
    expect((await read(other)).json().record).toBeNull();
  });

  it("账号数据导出里包含总览配置", async () => {
    await write(0);
    const exported = await app.inject({ method: "GET", url: "/api/v1/account/export", headers: { cookie } });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().dashboard.configuration.templates[0].name).toBe("午饭");
  });

  // 1.19.105：dashboard_configurations 补上了存储计量触发器（见迁移
  // 20261116130000_dashboard_configurations_storage_meter）。没有它时 413 分支不可达，
  // 这两项测试会失败。
  it("写入计入账号空间；删除后释放", async () => {
    const before = await prisma.user.findFirstOrThrow({ select: { storageBytes: true } });
    expect((await write(0)).statusCode).toBe(200);
    const afterWrite = await prisma.user.findFirstOrThrow({ select: { storageBytes: true } });
    expect(afterWrite.storageBytes > before.storageBytes).toBe(true);
    await prisma.dashboardConfiguration.deleteMany();
    const afterDelete = await prisma.user.findFirstOrThrow({ select: { storageBytes: true } });
    expect(afterDelete.storageBytes).toBe(before.storageBytes);
  });

  it("超出账号空间时返回 413", async () => {
    const before = await prisma.user.findFirstOrThrow({ select: { storageBytes: true } });
    await prisma.user.updateMany({ data: { storageLimitBytes: before.storageBytes + 10n } });
    const result = await write(0);
    expect(result.statusCode).toBe(413);
    expect(result.json().code).toBe("account_storage_full");
    expect(await prisma.dashboardConfiguration.count()).toBe(0);
  });
});
