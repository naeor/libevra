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
// 本机候选版本可以领先生产；没有本地版本行的旧文档仍校验生产版本。
const localVersion = status.match(/本地开发版本\*\*\s*\|\s*\*\*`?(\d+\.\d+\.\d+)`?\*\*/);
const m = status.match(/数据库迁移\*\*\s*\|\s*\*\*(\d+)\*\*/);

if (!v) problems.push("STATUS.md 里找不到「生产版本」行（格式应为 | **生产版本** | **`X.Y.Z`** |）");
if (!m) problems.push("STATUS.md 里找不到「数据库迁移」行（格式应为 | **数据库迁移** | **N** 个…）");

const declaredCodeVersion = localVersion?.[1] ?? v?.[1];
if (declaredCodeVersion && declaredCodeVersion !== codeVersion) {
  problems.push(`版本号不一致：STATUS本地=${declaredCodeVersion}，代码=${codeVersion}`);
}
if (m && Number(m[1]) !== migrationCount) {
  problems.push(`迁移数不一致：STATUS=${m[1]}，仓库=${migrationCount}`);
}

// --- 其它硬性检查 ---
if (!/最后核对/.test(status)) problems.push("STATUS.md 缺少「最后核对」行");

// ---- STATUS 必须覆盖式更新，不能变回历史日志（2026-10-29 新增）----
// 整理前的 STATUS 堆了 5 段「最后核对补充」、单元格里写满历次分支流水，长到 45 KB，
// 每个 Agent 开工都要读一遍。现在只允许一行「最后核对」，并给体量设上限；历史写 changelog / archive。
const checkedLines = status.split(/\r?\n/).filter((l) => /^\s*(>\s*)?(\|\s*)?\**最后核对/.test(l));
if (checkedLines.length > 1) {
  problems.push(`STATUS.md 有 ${checkedLines.length} 行「最后核对」——只保留一行并覆盖旧值（历史进 changelog / archive）`);
}
const STATUS_MAX_BYTES = 20000;
const statusBytes = Buffer.byteLength(status, "utf8");
if (statusBytes > STATUS_MAX_BYTES) {
  problems.push(`STATUS.md 有 ${statusBytes} 字节，超过 ${STATUS_MAX_BYTES}：把过程、证据与历史移到 changelog / archive，表格单元格只写当前值`);
}

// 唯一性：其它文档不应再声明"当前版本 = x.y.z"
const mdFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "_backups", ".venv", "__pycache__", "阅读版"].includes(e.name)) continue;
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

// ---- 路由条数断言：文档写的条数必须等于 App.tsx 实测 ----
// 2026-10-20 之前点击树文档写"50 条"，而代码已有 67 条，且没人会发现。
const APP_TSX = join(ROOT, "apps", "web", "src", "App.tsx");
if (existsSync(APP_TSX)) {
  const app = readFileSync(APP_TSX, "utf8");
  const actualRoutes = (app.match(/<Route\b/g) || []).length;
  for (const f of mdFiles) {
    const rel = f.slice(ROOT.length + 1).split("\\").join("/");
    // 历史记录里的旧路由条数是当时的事实，不是对现在的声明（2026-10-29）。
    if (rel.startsWith("docs/archive/") || rel.startsWith("docs/changelog/")) continue;
    const text = readFileSync(f, "utf8");
    const m = text.match(/路由总表（(\d+)\s*条/);
    if (m && Number(m[1]) !== actualRoutes) {
      problems.push(`路由条数过期：${rel} 写「${m[1]} 条」，App.tsx 实测 ${actualRoutes} 条`);
    }
  }
  notes.push(`路由 ${actualRoutes} 条`);
}
if (offenders.length) problems.push("以下文档仍在写「当前版本」（应改为指向 STATUS.md）：\n  - " + offenders.join("\n  - "));

notes.push(`代码版本 ${codeVersion}；迁移 ${migrationCount} 个；STATUS ${Math.round(statusBytes / 1000)} KB`);

if (problems.length) {
  console.error("✗ check:status 失败：");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("✅ check:status 通过：" + notes.join("；") + "（STATUS 与代码一致）");
