import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { Pool } from "pg";
import { PgFxRepository } from "./repository.js";
import type { FxSnapshot } from "../../../../packages/shared/src/fx.js";

// 显式开启；只允许回环地址的测试库，只操作随机 schema，不清空现有表。
const enabled = process.env["FX_PG_TEST"] === "1";
describe.skipIf(!enabled)("PostgreSQL 独立 schema 迁移与存储", () => {
  let admin: Pool, pool: Pool, repository: PgFxRepository, migration: string;
  const schema = `fx_test_${randomBytes(8).toString("hex")}`;
  let originalCount = "";
  const snapshot: FxSnapshot = { base: "EUR", date: "2026-10-23", provider: "fixture", revision: "r1",
    fetchedAt: "2026-10-26T12:00:00Z", rates: { EUR: "1", USD: "1.25", CNY: "10" } };
  beforeAll(async () => {
    if (process.env["FX_TEST_ENV_FILE"]) config({ path: process.env["FX_TEST_ENV_FILE"], quiet: true });
    const connectionString = process.env["TEST_DATABASE_URL"];
    if (!connectionString) throw new Error("缺少 TEST_DATABASE_URL");
    const url = new URL(connectionString);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/test/i.test(url.pathname)) throw new Error("仅允许本机测试库");
    admin = new Pool({ connectionString });
    originalCount = (await admin.query<{ count: string }>("SELECT count(*)::text AS count FROM public.transactions")).rows[0]!.count;
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    repository = new PgFxRepository(pool);
    migration = await readFile(new URL("../../../../prisma/pending/s16-d/migration.sql", import.meta.url), "utf8");
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      const count = (await admin.query<{ count: string }>("SELECT count(*)::text AS count FROM public.transactions")).rows[0]!.count;
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
      expect(count).toBe(originalCount);
    }
  });
  it("迁移失败/事务回退不留下半张表，然后可成功增量安装", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query(migration);
      await expect(client.query(migration)).rejects.toThrow();
      await client.query("ROLLBACK");
      const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema=$1", [schema]);
      expect(count.rows[0]?.count).toBe("0");
      await client.query(migration);
    } finally { client.release(); }
  });
  it("持久保存、进程实例重建、同日修订传播与冲突拒绝", async () => {
    await repository.save("fixture", "2026-10-25", { snapshot, checkedAt: snapshot.fetchedAt });
    expect((await new PgFxRepository(pool).get("fixture", "2026-10-25"))?.snapshot).toEqual({ ...snapshot, fetchedAt: new Date(snapshot.fetchedAt).toISOString() });
    const revised = { ...snapshot, revision: "r2", fetchedAt: "2026-10-26T12:01:00Z", rates: { ...snapshot.rates, USD: "1.3" } };
    await repository.save("fixture", "2026-10-24", { snapshot: revised, checkedAt: revised.fetchedAt });
    expect((await repository.get("fixture", "2026-10-25"))?.snapshot.revision).toBe("r2");
    await expect(repository.save("fixture", "2026-10-25", { snapshot, checkedAt: snapshot.fetchedAt })).rejects.toThrow("conflict");
    await expect(repository.save("fixture", "2026-10-25", { snapshot: { ...revised, rates: { ...revised.rates, USD: "1.4" } }, checkedAt: revised.fetchedAt })).rejects.toThrow("conflict");
    expect((await repository.get("fixture", "2026-10-25"))?.snapshot.rates["USD"]).toBe("1.3");
    expect((await pool.query("SELECT * FROM fx_snapshots")).rowCount).toBe(2);
  });
  it("数据库约束拦截未来回退日期，事务不留脏数据", async () => {
    await expect(pool.query(`INSERT INTO fx_resolutions(provider,requested_date,rate_date,checked_at)
      VALUES ('fixture','2020-01-01','2020-01-02',now())`)).rejects.toThrow();
    expect(await repository.get("fixture", "2020-01-01")).toBeNull();
  });
});
