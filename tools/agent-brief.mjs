// 开工简报：把「当前状态 + 本轮硬规则 + 该读哪份 + 该跑什么检查」拼成一屏（目标 ≤ 80 行）。
//
// 目的：替代"每次会话先读一大堆文档"的做法。
// 内容来自单一来源（STATUS.md / AGENTS.md），因此两个 Agent 看到的必然一致。
// 2026-10-29：STATUS 改为覆盖式短表后同步调整；长单元格截断，避免简报本身变成负担。
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const MAX_CELL = 260;
const clip = (s) => (s.length > MAX_CELL ? s.slice(0, MAX_CELL) + "…（详见 STATUS）" : s);

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
  const status = read("docs/STATUS.md").split(/\r?\n/);
  push("【1】当前状态（唯一出处：docs/STATUS.md）", "");
  const checked = status.find((l) => /^>\s*最后核对/.test(l));
  if (checked) push("  " + clip(checked.replace(/^>\s*/, "")));
  const rows = status.filter((l) => /^\| \*\*(生产版本|本地开发版本|数据库迁移|当前阶段|分支 \/ 远程)\*\*/.test(l));
  for (const r of rows) {
    const cells = r.split("|").map((c) => c.trim()).filter(Boolean);
    push("  " + clip(`${cells[0].replace(/\*\*/g, "")}：${cells.slice(1).join(" | ")}`));
  }
  const nextIdx = status.findIndex((l) => l.startsWith("## 2. 下一步做什么"));
  if (nextIdx >= 0) {
    push("", "【下一步】");
    for (let i = nextIdx + 1; i < status.length && i < nextIdx + 12; i++) {
      if (status[i].startsWith("## ")) break;
      if (status[i].trim()) push("  " + clip(status[i]));
    }
  }
  push("");
} else {
  push("⚠️ 找不到 docs/STATUS.md", "");
}

// --- 2. 铁律（只取正文要点，完整版见 AGENTS §4/§5） ---
const agents = read("AGENTS.md");
const lawStart = agents.indexOf("## 4. 🔒 铁律");
if (lawStart >= 0) {
  const lawEnd = agents.indexOf("\n### 4.1", lawStart + 5);
  const block = agents.slice(lawStart, lawEnd > 0 ? lawEnd : undefined).split(/\r?\n/);
  push("【2】硬规则（完整版见 AGENTS.md §4/§5）", "");
  for (const l of block) {
    if (/^\|/.test(l) || !l.trim() || /^#+\s/.test(l)) continue;
    push("  " + l.replace(/^>\s*/, ""));
  }
  push("  本地默认同步到主工作区 / localhost；GitHub、生产、任何外部服务必须当次批准（§4.1）。", "");
}

// --- 3. 读什么、跑什么、写什么 ---
push(
  "【3】按任务只读对应的一份（AGENTS §3；导航见 docs/00-索引.md）",
  "  必读：AGENTS.md + 本简报（或 STATUS.md）。规划：docs/01-规划.md 顶部「现行路线」。",
  "  规格：docs/specs/（按 AGENTS §3 表）；运维：docs/03-运维手册.md；为什么：docs/adr/。",
  "  默认不读：docs/archive/、changelog 冻结文件、docs/阅读版/、specs/product/s17-agents/ 的过程记录。",
  "",
  "【4】检查分级（AGENTS §6.1；每条命令跑一次，失败修完只重跑失败项）",
  "  日常检查：改动包的 typecheck + 受影响测试；web 有改动跑 check:build（已含 web typecheck）；",
  "            改了文档跑 check:docs，改了版本/迁移/STATUS 跑 check:status。",
  "  交付检查：pnpm check:delivery + 改动包全量测试（动 API/DB 另跑 API 测试与 check:db）。",
  "  验收检查（阶段/发布）：pnpm -r test + pnpm build + check:delivery + check:db + 迁移演练 + 浏览器/真机矩阵。",
  "  金额/数据丢失/权限/迁移/同步/导入导出/安全/配置 schema：至少交付检查 + 对应专项，不得降级。",
  "",
  "【5】文档：只更新 changelog 条目 + STATUS 相关行 + 直接受影响的规格（AGENTS §7）。",
  "  不新建计划 / 实施报告 / 验收报告 / 交接摘要 / 版本总结，除非所有者要求或属于阶段收尾、生产发布。",
  "",
  "══════════════════════════════════════════════════════════════",
);

console.log(out.join("\n"));
if (out.length > 80) console.log(`\n（简报 ${out.length} 行，超过 80 行目标：请精简 STATUS 或 AGENTS §4）`);
