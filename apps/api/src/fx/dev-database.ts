import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parse } from "dotenv";
import { Pool } from "pg";

// 仅生成专用本机环境；从现有测试连接复用本机角色，不打印凭据、不覆盖现有库。
const source = parse(await readFile(new URL("../../../../../记账程序v1/.env", import.meta.url), "utf8"));
const original = new URL(source["TEST_DATABASE_URL"] ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(original.hostname) || !/test/i.test(original.pathname)) throw new Error("只允许本机测试连接");
const pool = new Pool({ connectionString: original.toString() });
try {
  for (const name of ["libevra_fx_s16d_dev", "libevra_fx_s16d_test", "libevra_fx_s16d_restore_test"]) {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${name}`);
    console.log(`${name}: 已确认专用库`);
  }
} finally { await pool.end(); }
const dev = new URL(original); dev.pathname = "/libevra_fx_s16d_dev";
const test = new URL(original); test.pathname = "/libevra_fx_s16d_test";
const values = {
  DATABASE_URL: dev.toString(), TEST_DATABASE_URL: test.toString(), NODE_ENV: "development",
  API_HOST: "127.0.0.1", API_PORT: "3016", WEB_ORIGIN: "http://127.0.0.2:5186", COOKIE_SECURE: "false", REGISTRATION_MODE: "open",
};
await writeFile(new URL("../../../../.env", import.meta.url), Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n");
await mkdir(new URL("../../../../_backups/fx-d4/", import.meta.url), { recursive: true });
console.log("独立 .env 已写入（git ignored），API 3016 / Web 5186");
