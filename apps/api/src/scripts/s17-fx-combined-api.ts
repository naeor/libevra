/**
 * S17 综合折算验收用的**本地隔离 API**（仅用于云端/本机的合成数据验收，不是生产入口）。
 *
 * 与 `apps/api/src/server.ts` 的区别只有两点：
 * 1. 汇率来源是「只读已入库」的桩：库里有的日期照常返回，没有的日期一律 `network` 失败。
 *    这样「缺汇率」是确定的、可重复的，也不会向任何外部汇率服务发请求；
 * 2. 注册开放（仅本进程），并带本地测试协议，便于合成账号走完整的登录流程。
 *
 * 用法（在 apps/api 下）：
 *   DATABASE_URL=… SESSION_SECRET=… node --import tsx src/scripts/s17-fx-combined-api.ts
 */
import { APP_VERSION } from "@libellum/shared";
import { Pool } from "pg";

import { buildApp } from "../app.js";
import { createConsentPolicy } from "../consent/policy.js";
import { createPrismaClient } from "../db.js";
import { PgFxRepository } from "../fx/repository.js";
import { FxError, FxHistoryService, type FxProvider } from "../../../../packages/shared/src/fxHistory.js";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || !/^postgresql:\/\/[^/]*@(127\.0\.0\.1|localhost)[:/]/.test(databaseUrl)) {
  throw new Error("只允许连接本机数据库（DATABASE_URL 必须指向 127.0.0.1 / localhost）");
}
const port = Number(process.env["API_PORT"] ?? "3100");

/** 库里没有就是没有：不联网、不猜测。 */
const storedOnlyProvider: FxProvider = {
  id: "ecb-via-frankfurter-v2",
  async fetch(): Promise<never> {
    throw new FxError("network");
  },
};

const prisma = createPrismaClient(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const fxService = new FxHistoryService(new PgFxRepository(pool), storedOnlyProvider, {});

const app = buildApp({
  fxService,
  version: APP_VERSION,
  logger: { level: "warn" },
  prisma,
  webOrigin: process.env["WEB_ORIGIN"] ?? "http://127.0.0.1:5175",
  cookieSecure: false,
  registrationMode: "open",
  consentPolicy: createConsentPolicy(true),
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  },
});
app.addHook("onClose", async () => {
  await pool.end();
});

async function shutdown(): Promise<void> {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ host: "127.0.0.1", port });
console.log(`s17-fx-combined api listening on 127.0.0.1:${String(port)} (db ${new URL(databaseUrl).pathname})`);
