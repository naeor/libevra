// 校验 docs/STATUS.md 与代码/仓库一致：版本号、迁移数。
// 不一致 → 退出码 1，CI 与本地都能拦住。
//
// 为什么需要：文档最容易"静默过期"——没有任何测试会因为版本号写错而失败。
// 这个脚本把 STATUS 的三处关键数字钉到唯一的 ground truth 上。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATUS = join(ROOT, "docs", "STATUS.md");
const VERSION_TS = join(ROOT, "packages", "shared", "src", "version.ts");
const MIGRATIONS = join(ROOT, "prisma", "migrations");

const problems = [];
const notes = [];

if (!existsSync(STATUS)) {
  console.error("✗ 找不到 docs/STATUS.md");
  process.exit(1);
}
const status = readFileSync(STATUS, "utf8");

// --- ground truth ---
const versionSrc = readFileSync(VERSION_TS, "utf8");
const versionMatch = versionSrc.match(/APP_VERSION\s*=\s*"([^"]+)"/);
if (!versionMatch) { console.error("✗ 无法从 packages/shared/src/version.ts 读到 APP_VERSION"); process.exit(1); }
const codeVersion = versionMatch[1];

const migrationCount = existsSync(MIGRATIONS)
  ? readdirSync(MIGRATIONS, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d{8,}/.test(e.name)).length
  : -1;

// --- STATUS 里声明的值 ---
const v = status.match(/生产版本\*\*\s*\|\s*\*\*`?(\d+\.\d+\.\d+)`?\*\*/);
const m = status.match(/数据库迁移\*\*\s*\|\s*\*\*(\d+)\*\*/);

if (!v) problems.push("STATUS.md 里找不到「生产版本」行（格式应为 | **生产版本** | **`X.Y.Z`** |）");
if (!m) problems.push("STATUS.md 里找不到「数据库迁移」行（格式应为 | **数据库迁移** | **N** 个…）");

if (v && v[1] !== codeVersion) {
  problems.push(`版本号不一致：STATUS=${v[1]}，代码=${codeVersion}`);
}
if (m && Number(m[1]) !== migrationCount) {
  problems.push(`迁移数不一致：STATUS=${m[1]}，仓库=${migrationCount}`);
}

// --- 其它硬性检查 ---
if (!/最后核对/.test(status)) problems.push("STATUS.md 缺少「最后核对」行");

// 唯一性：其它文档不应再声明"当前版本 = x.y.z"
const mdFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "_backups", ".venv", "__pycache__"].includes(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith(".md")) mdFiles.push(full);
  }
})(join(ROOT, "docs"));

const offenders = [];
for (const f of mdFiles) {
  if (f.endsWith("STATUS.md")) continue;
  const rel = f.slice(ROOT.length + 1).split("\\").join("/");
  if (rel.startsWith("docs/archive/") || rel.startsWith("docs/changelog/")) continue; // 历史允许旧值
  const text = readFileSync(f, "utf8");
  if (/当前版本\s*[:：|]\s*`?1\.\d+\.\d+/.test(text)) offenders.push(rel);
}
if (offenders.length) problems.push("以下文档仍在写「当前版本」（应改为指向 STATUS.md）：\n  - " + offenders.join("\n  - "));

notes.push(`代码版本 ${codeVersion}；迁移 ${migrationCount} 个`);

if (problems.length) {
  console.error("✗ check:status 失败：");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("✅ check:status 通过：" + notes.join("；") + "（STATUS 与代码一致）");
