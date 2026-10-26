import { readFile, writeFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
import { Pool } from "pg";
const root = new URL("../../../../", import.meta.url);
const env = parse(await readFile(new URL(".env", root), "utf8"));
const url = new URL(env["DATABASE_URL"]!);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/libevra_fx_s16d_dev") throw new Error("拒绝非专用开发库");
const directory = new URL("_backups/fx-d4/", root);
const dump = new URL("before-fx.dump", directory);
const childEnv = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
const run = (exe: string, args: string[]) => {
  const result = spawnSync(`C:/Program Files/PostgreSQL/17/bin/${exe}.exe`, args, { env: childEnv, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${exe} 失败：${result.stderr}`);
};
const target = new URL(url); target.pathname = "/libevra_fx_s16d_restore_test";
const sourcePool = new Pool({ connectionString: url.toString() }), restored = new Pool({ connectionString: target.toString() });
async function counts(pool: Pool) {
  const tables = await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result: Record<string, string> = {};
  for (const { tablename } of tables.rows) result[tablename] = (await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."${tablename.replaceAll('"', '""')}"`)).rows[0]!.count;
  return result;
}
try {
  const before = await counts(sourcePool);
  if (before["_prisma_migrations"] !== "58") throw new Error("基线必须为 58 迁移，禁止跳过核对");
  if (Object.keys(await counts(restored)).length) throw new Error("恢复演练库不为空；不自动覆盖");
  const { fileURLToPath } = await import("node:url");
  run("pg_dump", ["--format=custom", "--file", fileURLToPath(dump), "--dbname", "libevra_fx_s16d_dev"]);
  run("pg_restore", ["--no-owner", "--dbname", "libevra_fx_s16d_restore_test", fileURLToPath(dump)]);
  const after = await counts(restored);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("恢复行数不一致");
  await copyFile(new URL("prisma/schema.prisma", root), new URL("schema-before.prisma", directory));
  await writeFile(new URL("backup-proof.json", directory), JSON.stringify({ checkedAt: new Date().toISOString(), dump: "before-fx.dump", restoreOk: true, tables: Object.keys(before).length, before, after }, null, 2));
  console.log(`独立库备份/恢复验证通过：${Object.keys(before).length} 表行数一致，58 迁移；未访问主开发库`);
} finally { await sourcePool.end(); await restored.end(); }
