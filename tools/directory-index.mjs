// 分层目录导航：人工职责说明 + 可复算的直属清单。只读取 Git 可见文件，不遍历私密目录。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const write = process.argv.includes("--write");
const start = "<!-- directory-index:start -->", end = "<!-- directory-index:end -->";
const excluded = /(^|\/)(node_modules|dist|build|generated|__pycache__|\.venv|\.git|阅读版|_backups|tmp|coverage|vendor)(\/|$)|^(promo|design\/avatar-prototypes)\//;
const frozenLeaf = /^(prisma\/migrations\/\d|docs\/archive\/screenshots\/|docs\/archive\/design\/分析页面审查素材\/|docs\/archive\/documentation\/20261108\/)/;
const raw = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 16e6 });
const files = [...new Set(raw.split("\0").filter(f => f && !excluded.test(f) && existsSync(path.join(root, f))))].sort();
const folders = new Set(["."]);
for (const file of files) {
  let d = path.posix.dirname(file);
  while (d !== ".") { if (!frozenLeaf.test(d + "/")) folders.add(d); d = path.posix.dirname(d); }
}
const roles = {
  apps: "应用与服务入口：Web、API、OCR 和语音。", packages: "跨应用共享领域代码。", prisma: "数据库模型与不可重写的迁移序列。",
  tools: "开发、文档、检查与本地辅助工具；执行前阅读工具参数及授权边界。", deploy: "部署配置与运维脚本；生产操作需要当次授权。",
  design: "设计样例与实验材料，不替代现行规格。", experiments: "独立实验与测量；部分模块被正式源码导入，不能按目录名删除。",
  prototype: "对象展开独立演示与共享几何；正式 S19 呈现层导入 geometry.mjs。",
  docs: "文档入口：现行规则、历史记录与导航分开管理。按任务查 00-索引，当前状态查 STATUS。",
  "docs/specs": "产品、设计与功能权威规格；规划中和待确认内容按各文档标记。",
  "docs/ops": "开发、文档维护与运维操作规范；历史操作不能替代当前流程。",
  "docs/changelog": "逐版本技术记录；现行系列入口见 STATUS，旧系列冻结，不作为当前状态。",
  "docs/archive/releases": "历史发布、阶段验收与恢复证据；不授权当前生产操作。",
  "docs/archive/announcements": "历史公告存档；当前公告源在 Web updateAnnouncements.ts。",
  "docs/archive/design": "已完成的设计讨论、审查、草图与实验依据。",
  "docs/archive/documentation": "文档整理前原文、Git 基线和校验清单；不指导当前开发。",
  "docs/archive/logs": "冻结开发日志、旧版本记录与 STATUS 历史快照。",
  "docs/archive/misc": "一次性评审、交流和被取代的草稿。",
  "docs/archive/screenshots": "历史截图证据；不作为当前界面规格。",
  "docs/specs/design": "设计权威规则：字体、布局、颜色、海浪、S19 组件与动效。",
  "docs/specs/features": "功能契约、实现边界与专项验收要求。", "docs/specs/product": "产品边界、长期路线、架构与重要决策。",
  "apps/web": "React/Vite Web 应用与开发实验入口。", "apps/api": "Fastify API、认证授权、数据写入与服务端任务。",
  "apps/ocr": "OCR sidecar 与识别测试；真实样本是本机私密材料。", "apps/voice": "语音识别 sidecar。",
  "apps/web/src/pages": "业务页面；新增行为先定位产品规格与路由契约。",
  "apps/web/src/components": "跨页面共享组件；复用前查 UI 子目录和 Component Gallery。",
  "apps/web/src/lib/offline": "本地存储、操作队列、离线读写与同步；修改按同步专项验收。",
  "apps/web/src/s19": "S19 材质与展示实现，消费现有 Token，不改变业务语义。",
  "apps/web/src/s19/motion": "主 Tab、对象展开、模式入口和次级导航的呈现协调；不能混淆层级。",
  "apps/web/src/workspace": "工作区、面板路由、返回栈与布局。",
  "apps/web/src/statsWorkbench": "分析工作台配置、编辑器、布局与卡片接线。",
  "apps/web/src/desktop": "电脑端外壳与键鼠交互；遵循 desktop-ui skill。",
  "apps/web/src/analysis": "分析查询与展示适配；计算契约位于 shared。",
  "apps/web/src/i18n": "语言控制器、资源和本地化内容。",
  "apps/api/src/routes": "HTTP 路由入口；鉴权、校验、领域操作与错误响应。",
  "apps/api/src/ledger": "账本领域、访问控制与对象操作。",
  "apps/api/src/critical": "关键事件、回执、登记簿与恢复保护。",
  "apps/api/src/import": "账本导入、批次、来源、锁与撤销。",
  "apps/api/src/scripts": "管理和维护命令；运行前确认数据范围及授权。",
  "packages/shared": "共享校验、类型、金额、分析与工作台配置。",
  "packages/shared/src/analysis": "共享财务分析计算与结果契约。",
  "packages/shared/src/analysis/layout": "工作台布局模型、迁移、命令与导入导出。",
  "prisma/migrations": "按目录时间排序的 SQL 迁移单元；不修改已应用迁移，不在每个迁移目录生成 README。",
};
const labels = { src:"源码入口和子模块", lib:"基础逻辑与公共工具", test:"服务测试", tests:"专项测试", ui:"通用界面组件", chart:"图表基础设施", charts:"图表展示组件", auth:"身份认证", admin:"管理授权与规则", fx:"历史汇率与折算", ledger:"账本领域", entry:"记账入口与编辑组件", ocr:"OCR 解析与确认", voice:"语音服务接线", collab:"协作与共享", consent:"协议同意与重大公告", lifecycle:"生命周期与删除恢复", rewards:"特典与奖励", export:"导出", resources:"本地化资源", "en-US":"英文资源", "zh-CN":"简体中文资源", assets:"静态资源", avatars:"头像资源", public:"直接发布的静态资源", systemd:"定时任务与服务单元", e2e:"浏览器验证工具", measurements:"实验测量记录", reports:"实验测量产物", fixtures:"测试夹具", advanced:"深入分析计算", analyses:"分析指标实现", adapters:"分析协议适配", workbench:"共享工作台配置", "component-gallery":"共享组件与状态演示", "optics-lab":"光学材质对照实验", "adaptation-lab":"业务表面适配实验", "avatar-lab":"头像材质实验" };
function purpose(dir) {
  if (roles[dir]) return roles[dir];
  if (dir.startsWith("docs/archive")) return "历史资料与证据；其中的规则、状态与授权仅属于当时语境，不指导当前开发。";
  return roles[dir] ?? (labels[path.posix.basename(dir)] ? labels[path.posix.basename(dir)] + "。" : `本层组织 ${path.posix.basename(dir)} 模块的直属文件；具体契约由任务索引定位。`);
}
function target(from,to) { return encodeURI(path.posix.relative(from === "." ? "" : from,to) || ".").replaceAll("(","%28").replaceAll(")","%29"); }
function describe(file) {
  const name=path.posix.basename(file), ext=path.posix.extname(name);
  if (/\.(test|spec)\./.test(name) || name.startsWith("test_")) return "测试："+name.replace(/\.(test|spec)\.[^.]+$/, "").replace(/^test_/, "");
  if (name === "migration.sql") return "数据库迁移 SQL；按迁移序列执行";
  if (ext === ".md") {
    const first=readFileSync(path.join(root,file),"utf8").match(/^#\s+(.+)$/m)?.[1] ?? "Markdown 文档";
    return first.replaceAll("|"," / ").replaceAll("`", "").slice(0,130);
  }
  if (/\.(tsx?|m?js|py)$/.test(name)) {
    const content=readFileSync(path.join(root,file),"utf8").slice(0,20000);
    const names=[...content.matchAll(/(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|interface|type)|^def|^class)\s+(\w+)/gm)].map(m=>m[1]);
    return (ext === ".tsx" ? "界面模块" : "实现模块") + (names.length ? "；入口/导出："+ [...new Set(names)].slice(0,5).join("、") : "；按文件名定位 "+name);
  }
  return ({".css":"样式与变量", ".json":"结构化配置、资源或夹具", ".sql":"SQL 定义", ".sh":"运维/开发脚本；执行前确认范围", ".cmd":"Windows 本地启动工具", ".html":"网页入口", ".svg":"矢量资源", ".png":"图像资料", ".webp":"图像资源", ".yml":"配置", ".yaml":"配置", ".toml":"配置", ".prisma":"数据库模型"}[ext]) ?? "配置或资料："+name;
}
const problems=[]; let changed=0;
for (const dir of [...folders].sort()) {
  const dest=dir === "." ? "README.md" : dir+"/README.md";
  const direct=files.filter(f=>path.posix.dirname(f)===dir && path.posix.basename(f)!=="README.md");
  const children=[...new Set(files.filter(f=>dir === "." || f.startsWith(dir+"/")).map(f=>(dir === "." ? f : f.slice(dir.length+1)).split("/")[0]).filter(n=>files.some(f=>f.startsWith((dir === "." ? "" : dir+"/")+n+"/"))))].sort();
  const lines=[start,"## 直属目录清单","","本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。","","| 文件 | 用途 / 入口 |","|---|---|"];
  for (const f of direct) lines.push(`| [${path.posix.basename(f)}](${target(dir,f)}) | ${describe(f)} |`);
  if (!direct.length) lines.push("| — | 本层通过子目录组织内容 |");
  if (children.length) {
    lines.push("","| 子目录 | 职责 |","|---|---|");
    for (const child of children) { const d=(dir === "." ? "" : dir+"/")+child; lines.push(`| [${child}/](${target(dir,d+(folders.has(d)?"/README.md":"/"))}) | ${purpose(d)} |`); }
  }
  lines.push(end); const block=lines.join("\n");
  let old=existsSync(path.join(root,dest)) ? readFileSync(path.join(root,dest),"utf8") : "";
  let next;
  if (old.includes(start)) { const a=old.indexOf(start),b=old.indexOf(end,a); if(b<0)throw Error("目录区块缺结束标记："+dest); next=old.slice(0,a)+block+old.slice(b+end.length); }
  else {
    const intro=old.trimEnd() || `# ${dir} · 阅读入口\n\n${purpose(dir)}\n\n优先阅读[任务索引](${target(dir,"docs/00-索引.md")})定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。`;
    next=intro+"\n\n"+block+"\n";
  }
  if (next!==old) { if(write) {writeFileSync(path.join(root,dest),next,"utf8");changed++;} else problems.push(dest); }
}
if (problems.length) { console.error("目录 README 缺失或过期，请运行 pnpm docs:index：\n"+problems.join("\n")); process.exitCode=1; }
else console.log(write?`目录导航：更新 ${changed} 份，覆盖 ${folders.size} 个目录。`:`目录导航通过：${folders.size} 个目录。`);
