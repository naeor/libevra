// 开工简报：把「当前状态 + 本轮硬规则 + 该读哪份」拼成一屏（≤200 行）。
//
// 目的：替代"每次会话先读 878 KB 文档"的做法。
// 内容全部来自单一来源（STATUS.md / AGENTS.md），因此两个 Agent 看到的必然一致。
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const out = [];
const push = (...lines) => out.push(...lines);

push(
  "══════════════════════════════════════════════════════════════",
  " Libevra · 开工简报（由 pnpm agent:brief 生成，勿手工维护）",
  "══════════════════════════════════════════════════════════════",
  "",
);

// --- 1. STATUS 摘要 ---
if (existsSync(join(ROOT, "docs/STATUS.md"))) {
  const status = read("docs/STATUS.md").split("\n");
  const rows = status.filter((l) => /^\| \*\*(最后核对|生产版本|生产 \/health|数据库迁移|当前阶段|本地 HEAD|与远程|工作区)\*\*/.test(l));
  push("【1】当前状态（唯一出处：docs/STATUS.md）", "");
  for (const r of rows) push("  " + r.replace(/\s*\|\s*/g, " | ").replace(/^\|?\s*/, "").replace(/\s*\|$/, ""));
  const nextIdx = status.findIndex((l) => l.startsWith("## 2. 下一步做什么"));
  if (nextIdx >= 0) {
    push("", "【下一步】");
    for (let i = nextIdx + 1; i < status.length && i < nextIdx + 14; i++) {
      if (status[i].startsWith("## ")) break;
      if (status[i].trim()) push("  " + status[i]);
    }
  }
  push("");
} else {
  push("⚠️ 找不到 docs/STATUS.md", "");
}

// --- 2. 铁律 ---
const agents = read("AGENTS.md");
const lawStart = agents.indexOf("## 4. 🔒 铁律");
if (lawStart >= 0) {
  const lawEnd = agents.indexOf("\n## ", lawStart + 5);
  const block = agents.slice(lawStart, lawEnd > 0 ? lawEnd : undefined).split("\n");
  push("【2】本轮硬规则（完整版见 AGENTS.md §4/§5）", "");
  for (const l of block) {
    if (/^\|/.test(l)) continue; // 表格在 AGENTS 里，这里只要正文
    if (l.trim()) push("  " + l.replace(/^#+\s*/, "").replace(/^>\s*/, ""));
    if (out.length > 150) break;
  }
  push("");
}

// --- 3. 文档地图 ---
push(
  "【3】按任务只读对应的一份",
  "  改文案/颜色/布局/海浪 → docs/specs/design/",
  "  管理员/权限/离线/页面结构 → docs/specs/product/",
  "  公告/注销/导入/OCR 概览 → docs/specs/features/",
  "  部署/发布/备份/灾备     → docs/03-运维手册.md + docs/ops/",
  "  某功能做没做            → docs/changelog/",
  "  为什么这么设计          → docs/adr/README.md",
  "  历史（默认不读）        → docs/archive/",
  "",
  "══════════════════════════════════════════════════════════════",
);

const text = out.slice(0, 200).join("\n");
console.log(text);
if (out.length > 200) console.log(`\n（已截断，共 ${out.length} 行）`);
