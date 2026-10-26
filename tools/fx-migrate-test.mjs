import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
const env = parse(readFileSync(new URL("../.env", import.meta.url), "utf8"));
const url = new URL(env.TEST_DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/libevra_fx_s16d_test") throw new Error("仅允许汇率专用测试库");
const result = spawnSync("pnpm", ["db:deploy"], { shell: true, stdio: "inherit", env: { ...process.env, DATABASE_URL: url.toString() } });
process.exitCode = result.status ?? 1;
