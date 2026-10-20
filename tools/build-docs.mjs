// 生成阅读版 PDF：只产 PDF，统一输出到 docs/阅读版/（保持相对路径镜像）。
//
// 决策（2026-10-20，所有者确认）：Word 与 PDF 只保留其一 → **留 PDF**。
// 理由：手机/iPad 打开最稳；`docs/*.docx` 容易被误当成"可编辑源"。
//
// 约定：
//   - Markdown 是唯一的源；`docs/阅读版/**` 全部是生成物，**不入库**（见 .gitignore）。
//   - 输出路径镜像源路径：`docs/specs/design/x.md` → `docs/阅读版/specs/design/x.pdf`。
//   - 清理：`docs/阅读版/` 下没有对应源文件的 PDF 会被删掉（陈旧比缺失更糟）。
//   - `docs/恢复码.docx` 没有 md 源、也不由本脚本处理，**不在清理范围内**（它在 docs 根，不在 阅读版/）。
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const OUT = join(DOCS, "阅读版");
const CONVERTER = join(ROOT, "tools", "md2pdf.py");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "阅读版", ".venv", "__pycache__"]);

function pythonCandidates() {
  const list = [];
  if (process.env.PYTHON) list.push(process.env.PYTHON);
  const home = process.env.DSH_HOME;
  if (home) list.push(join(home, "dsh-runtimes", "dsh-primary-runtime", "dependencies", "python", "python.exe"));
  list.push("py", "python3", "python");
  return list;
}
function canImport(interpreter, module) {
  const args = interpreter === "py" ? ["-3", "-c", `import ${module}`] : ["-c", `import ${module}`];
  try { execFileSync(interpreter, args, { stdio: "ignore" }); return true; } catch { return false; }
}
function pythonFor(module) {
  for (const c of pythonCandidates()) {
    try { if (canImport(c, module)) return c; } catch { /* 下一个 */ }
  }
  return null;
}

const pdfPython = pythonFor("fpdf");
if (pdfPython === null) {
  console.error(
    [
      "找不到带 fpdf2 的 Python，阅读版未生成。",
      "在项目里装一次：pip install fpdf2",
      "或用 DSH 自带运行时：$env:PYTHON = \"$env:DSH_HOME\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe\"",
    ].join("\n"),
  );
  process.exit(1);
}
console.log(`PDF 使用解释器：${pdfPython}`);

// ---------- 收集源 ----------
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".md")) out.push(full);
  }
  return out;
}
const sources = walk(DOCS).sort();
console.log(`发现 ${sources.length} 份 Markdown`);

// ---------- 清理：输出目录里没有源的 PDF ----------
const produced = new Set();
for (const from of sources) {
  produced.add(relative(DOCS, from).split("\\").join("/").replace(/\.md$/, ".pdf"));
}
if (existsSync(OUT)) {
  let removed = 0;
  (function clean(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { clean(full); continue; }
      if (!e.name.toLowerCase().endsWith(".pdf")) continue;
      const relOut = relative(OUT, full).split("\\").join("/");
      if (!produced.has(relOut)) { rmSync(full); removed++; }
    }
  })(OUT);
  if (removed) console.log(`清理陈旧 PDF：${removed} 份`);
}

// ---------- 生成 ----------
let ok = 0, failed = 0;
for (const from of sources) {
  const relMd = relative(DOCS, from).split("\\").join("/");
  const relPdf = relMd.replace(/\.md$/, ".pdf");
  const target = join(OUT, relPdf.split("/").join("\\"));
  mkdirSync(dirname(target), { recursive: true });
  const title = relMd.replace(/\.md$/, "").split("/").pop();
  try {
    execFileSync(pdfPython, ["-X", "utf8", CONVERTER, from, target, "--title", title], { stdio: "pipe" });
    ok++;
    console.log(`  ✓ ${relMd}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${relMd} → PDF 生成失败：${String(error?.stderr ?? error).slice(0, 300)}`);
  }
}

console.log(`\n完成：${ok} 份成功${failed ? `，${failed} 份失败` : ""} → docs/阅读版/`);
console.log("提示：阅读版不入库；需要时重跑 pnpm docs:build。");
if (failed) process.exit(1);
