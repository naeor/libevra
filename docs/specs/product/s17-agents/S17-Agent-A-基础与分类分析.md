# S17 · Agent A 任务文档：基础财务与分类分析

> 本文件是 **DS-S17-A-Finance** 的唯一权威任务文档。所有长期有效的职责、接口、进度、问题与交接必须写入本文件，不得只存在于聊天上下文。
> 建立：2026-10-27（Lead 初始化）；维护者：Agent A 自己。
> 当前状态：**A-0 第一交付已完成（2026-10-27）：26 项理解与覆盖清单（§9）、18 问字段映射（§10）、S-01 协议草案（独立文件，未冻结）、计算原语与样本 A–O 测试骨架（`packages/shared/src/analysis/`）；等待 Lead/Claude 评审 S-01，随后进入 A-1。**

---

## 1. Agent 身份

| 项 | 值 |
|---|---|
| 名称 | `DS-S17-A-Finance` |
| 角色 | S17 基础财务与分类分析负责人；公共分析结果协议（S-01）主要拟定人 |
| 工作区 | `C:\Users\ZhuanZ（无密码）\Desktop\工作\记账程序\记账程序v1-s17-a-finance` |
| Git 分支 | `deepseek/s17-finance-category` |
| 基线 | `486c603`（origin/main = 1.16.22 生产版）；待 1.16.23 发布后统一 rebase（见索引 B-1） |
| 负责模块 | 基础收支统计、分类金额与占比、分类排名、支付方式构成、基础数字指标、基础环形图/条形图、基础财务结果协议；**同时负责本领域的计算函数与绘图函数** |
| 不负责 | 时间序列/趋势/周期（B）、专业统计与复杂图表（C）、网格与布局/配置/分享（D）、视觉设计规范（Codex）、代码审查（Claude）、生产发布 |
| 上级协调 | Lead（Harness teammate name：`lead`）；不得直接指挥/修改其他 Agent |

> **长期目标登记（A-Q10）**：本 Agent 是 delegated subagent，`create_goal` 被 harness 拒绝（错误原文：`this goal operation requires a direct human turn on a top-level agent`），**无法自行创建持久目标**，因此没有可登记的 goal id。目标表述为：*按所有者完整规格交付 B01–B20、I01–I05、I17 共 26 项分析的计算与基础图表，并拟定/维护 S-01 公共分析结果协议*。请 Lead 在顶层会话代为创建目标并把 goal id 回填本节；在此之前，以本文件 §5/§6.2/§9 作为进度权威。

### 工作区纪律（硬约束）

- 只在自己分支与工作区写代码/文档；不得 reset/clean/删除/覆盖他人 worktree（含主工作区未提交的 1.16.23 候选与 Claude 文档工作区，见索引 §1.3）。
- 不合并 main、不 push、不部署、不操作生产环境；未经批准不新增迁移/不改业务数据库。
- 公共接口未评审前不得冻结；接口变化必须登记本文件 §6 并告知 Lead。

---

## 2. 任务范围

### 2.1 负责的能力编号（唯一负责人）

- **B01–B20**：20 项基础统计（分析名称、计算逻辑、输入条件、输出数据、图表类型等详细要求由所有者第二轮提供）。
- **I01–I05**：5 项常用分析（基础组）。
- **I17**：1 项常用分析（单列）。
- 合计 **26 项**。定义以所有者完整规格为准（§2.2.1）；本文件不再以“等待详细需求”为状态，改为覆盖清单登记与状态跟踪（§5、§9）。

### 2.2 开发阶段

- **W1 财务统计正确性**：作为 S17 的前置门禁，负责基础财务语义、金额精度与分类/支付方式统计的正确性清理（具体范围以所有者细则与 Q-06 结论为准）。
- **W2 计算与展示分层**：作为 **S-01 公共分析结果协议**的主要拟定人，交付纯计算层契约草案（评审通过前不得冻结）。
- **W3 分析页面与基础卡片**：基础数字指标、环形图、条形图等卡片与图表实现（按所有者清单）。
- 后续阶段（W4–W6）配合卡片接入与集成。

### 2.2.1 所有者完整开发规格（2026-10-26 已下发，权威）

- 权威文件（逐字登记，不可摘要替代）：[`S17-Agent-A-完整开发规格-所有者-20261026.md`](S17-Agent-A-完整开发规格-所有者-20261026.md)（Lead 于 2026-10-26 落盘，提交见 §6.2）。
- 内容覆盖：26 项分析（B01–B20、I01–I05、I17）的完整定义与图表要求；财务合同（金额精度/原币与综合汇率/日期语义/完整性/来源追溯）；统一输入输出协议草案；基础计算原语；图表家族 CF-A01…CF-A07；真实容器尺寸的 Compact/Medium/Expanded 密度；测试样本 A–O 与逐项测试要求；A-0→A-1→A-2→A-3→A-4 实施顺序；交付清单与 14 条正式验收标准；风险分级审核。
- 本 Agent 的强制动作：
  1. 在 §5 状态表与 §6.2 持续记录进度；
  2. 新建并维护「26 项覆盖与验收清单」章节：逐项记录定义摘要、输入/输出、推荐图表、尺寸形态、来源追溯方式、依赖与状态（未开始/等待数据能力/开发中/待测试/已验收）；
  3. 记录本 Agent 对规格的理解（字段映射表 `分析概念 → 实际字段或现有函数 → 使用限制`、协议取舍、图表兼容性矩阵、假设清单）；
  4. 与规格或现有正式文档冲突之处，集中登记 §7 并按阻塞级别排序；
  5. 当前优先任务：**A-0 共享协议与基础正确性**（真实数据模型核查、金额/FX/日期合同、结果协议草案、纯函数与测试骨架）；W1 总范围与 1.16.23 基线门禁仍受 A-Q2 约束。
- 门禁（不变）：公共接口评审前不冻结；不合并 main、不 push、不部署；不修改其他 Agent 工作区；不新增迁移/不改业务库。

### 2.3 预期计算函数（登记，待详细需求细化）

- 收支合计 / 支出、收入、结余、笔数等基础数字指标（纯函数，不依赖 UI）。
- 按分类聚合的金额与占比、分类排名、支付方式构成（区分收入/支出/转账语义，不得把支付方式当真实资金账户）。
- 多币种：必须按币种分别汇总，**不同原币不得直接相加**；折算只能复用 S16-D 历史汇率合同（服务端只读汇率 + 客户端折算模式），不得另建一套折算。
- 金额精度：沿用 shared money 合同（最小货币单位整数语义），**不得为了绘图重新定义金额精度**。
- 空数据、缺字段、软删除、退款/转账、跨月归属等边界语义必须与现有 `StatsPage`/API 统计一致（差异需报告，不得静默改变现有语义）。

### 2.4 预期绘图函数（登记，待详细需求细化）

- 基础环形图/饼图（分类占比）。
- 基础条形图/横向条形图（分类排行、支付方式构成）。
- 基础数字指标卡。
- 统一接入共享绘图核心与 Codex 视觉规范（S-02）；不得自创视觉体系或复制多份仅指标不同的图表组件。

### 2.5 依赖接口

- **S-01 分析结果协议由本 Agent 主要拟定**，但必须经 A/B/C/D + Lead + Claude 统一评审；B/C 不得另建不兼容统计框架。
- S-02 图表视觉/绘图核心：由 Codex 与 Lead 统一裁定，本 Agent 不自定。
- S-03 卡片注册协议：与 Lead、D、Codex 对齐。
- S-04 查询与权限：只增量复用现有 `ledger/access.ts` 与 API；不得修改现有权限语义。
- S-06 历史汇率合同（S16-D）：只读复用，不得绕过。
- 数据来源必须可追溯（账本、月份、币种、过滤条件、数据版本），并保留现有 API 的只读查询边界。

### 2.6 测试范围

- 计算函数单元测试：金额精度、零/负值、空账本、单/多币种、软删除、退款、转账、跨月边界、分类缺失、支付方式缺失、分页全量统计一致性。
- 与现有 API/StatsPage 的统计口径对照测试（同账本同月的 totals/categories 等）。
- 绘图函数：只测数据映射与空态/降级，不依赖像素快照；视觉验收交给 Codex/Lead E2E。
- 权限：新增查询必须覆盖成员/只读/非成员/跨账本隔离。
- 所有测试必须能在本工作区独立运行，不依赖其他 Agent 未合并代码。

---

## 3. 输入与输出协议（待统一确认）

> **本轮未冻结任何公共接口。** 下列为登记项，最终以 S-01 统一评审结果为准。

- 输入（预期）：账本 ID、账本成员权限上下文、时间范围/月份、币种与过滤条件、数据版本/快照标识；不得直接读 UI 状态。
- 输出（预期）：纯数据结构（数值 + 币种 + 单位 + 来源追溯 + 空/缺失语义 + 数据版本），不含 DOM/尺寸/布局信息；同一定义在同一数据版本内结果可复用。
- 金额：整数最小货币单位 + 币种代码；百分比与比率明确精度与舍入规则。
- 错误与降级：缺数据不等于 0；数据不完整必须显式标记“不完整/不可比”，不得猜测补零。
- 图表配置：由卡片/图表层从结果协议派生，不在计算层生成颜色/像素。

---

## 4. 财务与安全限制（所有 Agent 共同遵守）

- 不改原始账务数据（不写 transactions/账本业务表）。
- 不更改已有财务计算语义（现有统计口径有变化必须先报告并由所有者决定）。
- 不直接混加不同货币；折算只走 S16-D 合同。
- 不绕过账本权限；新查询必须做权限测试。
- 不把缺失数据视为零（显示“不完整”，不猜测）。
- 不因为显示尺寸影响金额（同一数据在任何卡片尺寸下金额必须一致）。
- 不修改其他用户的个人配置；不读取无权限账本。
- 不得为了凑数量而编造数据、偷换分析定义或把同一指标的多种展示误算成不同计算能力。

---

## 5. 持续进度记录

状态词固定：未开始 / 等待详细需求 / 已确定接口 / 开发中 / 待测试 / 待集成 / 已验收。

| 能力组 | 状态 | 备注 |
|---|---|---|
| B01–B20 | 开发中：A-0 计算原语已实现（`packages/shared/src/analysis/primitives.ts`）；分析装配与数值卡在 A-1/A-3 | 规格 §6–§12；26 项状态见 §9.1 |
| I01–I05、I17 | 开发中：A-0 原语已实现（`categoryTotals`/`paymentMethodTotals`/`foldRemainder`）；环图/条形/排行在 A-2 | 规格 §13–§16；I17 结构化字段已确认（`paymentMethodId` 可空，见 §10 问题 7） |
| W1 财务统计正确性 | 等待所有者细则与基线门禁 | 前置：1.16.23 发布（索引 B-1/A-Q2） |
| S-01 分析结果协议 | 开发中：草案 `s01-draft` 已登记（独立文件，未冻结，待评审） | 评审前不得冻结；评审人 Lead/Claude/B/C/D |
| W3 基础图表/卡片 | 未开始 | 依赖 S-01/S-02/S-03；图表家族 CF-A01…CF-A07 已定义 |

> 每次开发结束必须更新本表 + §6 交接记录。

---

## 6. 开发交接记录

### 6.1 汇报格式（向 Lead）

每次重要开发或阻塞时，向 `lead` 发送结构化汇报：
`状态 / 已完成 / 修改文件 / 相关提交 / 测试命令与结果 / 接口变化 / 已知问题 / 下一步`。
同时在本文档 §6.2 记录同一内容（文档优先，聊天只是通知）。

### 6.2 记录

| 日期 | 内容 | 修改文件 | 提交 | 测试 | 接口变化 | 已知问题 | 下一步 |
|---|---|---|---|---|---|---|---|
| 2026-10-27 | 工作区/分支/任务文档初始化（Lead 创建）；未开发 | 本文件 | 无（随分支初始化提交） | 未运行 | 无 | 见 §7 | 等待所有者第二轮需求（A 优先） |
| 2026-10-27 | 初始化确认：已阅读规格与边界，未开始开发 | 本文件 | `docs(s17): Agent A 初始化确认`（本地提交，未推送） | 未运行（无代码改动） | 无 | 见 §7（A-Q1…A-Q6 均未变） | 等待所有者第二轮详细需求 |
| 2026-10-26 | **Lead 登记所有者完整开发规格**（逐字原件落盘） | `S17-Agent-A-完整开发规格-所有者-20261026.md`、本文件 §2.2.1/§5/§9 | `docs(s17): 登记所有者完整开发规格与 26 项验收清单模板`（本地提交，未推送） | 未运行（无代码改动） | S-01 草案范围已明确（仍待评审冻结） | 见 §7 | Agent A：记录理解 + 填写 §9 覆盖清单，开始 A-0 |
| 2026-10-27 | **A-0 第一交付**：S-01 协议草案（独立文件，`s01-draft` 未冻结）+ §10 字段映射 18 问 + §9 26 项理解/覆盖状态 + 计算原语（rational/primitives）+ 测试样本 A–O 骨架 | 本文件 §1/§5/§6.2/§7/§9/§10；新增 `S17-Agent-A-S01-共享分析结果协议草案.md`；新增 `packages/shared/src/analysis/{types,rational,primitives,fixtures,index}.ts` 与 `rational.test.ts`、`primitives.test.ts`；`packages/shared/src/index.ts` 追加 1 行导出 | 本地提交 `eec074a`（未推送，提交信息 `feat(s17): Agent A A-0 交付 S-01 协议草案与计算原语`） | `pnpm -r typecheck` 通过（shared/api/web；api 需先 `pnpm db:generate` 生成 Prisma 客户端）；`vitest run src/analysis` 72 passed；`pnpm --filter @libellum/shared test` 449 passed；`pnpm --filter @libellum/web test` 1385 passed；`pnpm check:docs`/`check:status` 通过；`apps/api` 集成测试需本机 PostgreSQL 测试库（本 worktree 无 `.env`/数据库，515 项失败为环境缺失，非本次改动；详见汇报） | 新增分析结果类型与计算原语（草案，未冻结；评审前不得据其固化对外 API） | §7 新增 A-Q10…A-Q18；S-01 评审中（R-01…R-08） | 等 Lead/Claude 评审 S-01；评审后进入 A-1（B01–B07 + CF-A01 数值卡） |

---

## 7. 未决问题（Agent A）

| 编号 | 级别 | 问题 | 影响 | 需要谁决定 | 现状/临时方案 |
|---|---|---|---|---|---|
| A-Q1 | 重要 | 所有者编号 B01–B20/I01–I17 与现行能力目录 `AN-Bxx/AN-Axx/AN-Pxx` 的映射未定 | 明细对齐 | 所有者/Lead（索引 B-3） | 本文件 §9 暂用所有者编号；协议 `analysisId` 先写 `B01` 形式，保留 AN-xxx 映射位 |
| A-Q2 | 阻塞 | W1 基线要求 1.16.23 发布，但该版本目前是主工作区未提交候选 | 不能按规格启动 W1；与 1.16.23 重叠文件不得改 | 所有者（索引 B-1） | 本 Agent 先做纯计算层/新文件（不受门禁）；`FxDisplay.tsx`/`FxStats.tsx`/`StatsPage.tsx`/`DetailPage.tsx`/`fxView*`/`version.ts` 未触碰 |
| A-Q3 | 重要 | 支付方式构成中转账/退款单边语义、账户 vs 支付方式的边界 | 影响 I17/B10 统计定义 | 所有者 W1 细则 | I17 只做"描述性支付方式"统计，未指定显式分组；不推导余额/负债/转账 |
| A-Q4 | 重要 | 分析结果协议与现有 `shared/money`、S16-D 汇率契约的复用边界需统一评审 | 接口冻结 | Lead + Claude 评审 | 草案 R-01/R-05/R-06：复用 `decimalsFor`/FX，新增精确有理数路径，二者并存待评审 |
| A-Q5 | 重要 | 卡片尺寸与图表的真实尺寸语义由 D 提供、视觉由 Codex 定，当前均未定 | W3 无法开工 | Lead 协调 | A-0 只交付数据形状；图表适配层待 S-02/S-03 |
| A-Q6 | 阻塞 | 数据版本/快照标识在现有 API 中如何取得（用于结果复用与一致性） | 协议 `dataVersion` 无法确定 | Lead + 现有代码调研 | 协议字段保留 `string \| null`；短期用查询参数派生占位并标注（R-02） |
| A-Q7 | 重要 | A-0/A-1 的纯计算层是否需要在 1.16.23 发布前就合入主线（或等基线 rebase 后再提交集成） | 影响集成节奏 | Lead（结合索引 B-1） | 当前只在本人分支提交，不 push；等 Lead 指示 |
| A-Q8 | 一般 | 图表颜色与密度 token 的接口：Codex 视觉规范未下发前，先用现有设计 token 占位并标注可替换 | W3 视觉集成 | Lead/Codex | 颜色稳定策略写进协议 §10（按分类 id 映射），token 待接 |
| A-Q9 | 一般 | 26 项与能力目录 `AN-xxx` 编号的映射细则（A-Q1 的子问题：名称/口径是否允许差异） | 验收对齐 | 所有者/Lead | 同 A-Q1 |
| A-Q10 | 阻塞（流程） | 本 Agent 是 delegated subagent，`create_goal` 被拒绝（`this goal operation requires a direct human turn on a top-level agent`），无法创建持久目标 | 长期目标无法自动续跑 | **Lead** | 目标表述已登记 §1；请 Lead 在顶层会话代建并把 goal id 回填 |
| A-Q11 | 重要 | 现有 `averagePerDay`（`packages/shared/src/stats.ts`）返回**整最小单位**（`Math.round`），与 B06「日均允许高于最小单位中间精度」冲突 | 直接复用会提前舍入 | Lead + Claude | 建议旧接口保留给现有页面；分析层用 `averageMinor` 精确 `Ratio`，不互相替代（R-05） |
| A-Q12 | 重要 | 现有 `byCategory.share` 是 **JS float**，S-01 权威比例用精确 `Ratio` | 权威比例无法从现有字段取得 | Lead + Claude | 协议内部一律 `Ratio`；旧 float 仅兼容/展示（R-06） |
| A-Q13 | 阻塞 | 综合模式缺逐笔数据入口：现有 `GET /api/v1/stats` 不返回来源交易，而 `aggregateFxAsync` 需要逐笔 `FxEntry` | 综合模式完整性与来源无法实现 | Lead + 后端 | 建议 T2 只读扩展（新增逐笔范围查询，不改 schema、不改写入），待批准（R-03） |
| A-Q14 | 重要 | 大额 > `Number.MAX_SAFE_INTEGER` 经现有 `number` DTO 会丢精度（样本 G） | 极大金额验收 | Lead + 后端 | 分析层全 `bigint`；API 是否字符串化待评估（涉及 1.16.23 基线，R-07） |
| A-Q15 | 一般 | 分类/支付方式删除后的历史引用：`Transaction.categoryId` 对 Category 为 `onDelete: Restrict`，分类只归档；需确认统计命名与未分类归属的既有语义 | B15/B16/I01 显示名 | 后端/所有者 W1 细则 | 按需 join 当前分类名；缺失显示「—」；系统「暂无分类」保留为真实组（§10 问题 5/6） |
| A-Q16 | 重要 | 离线数据覆盖范围元信息当前不可得 | L 样本/「无支出记录天数」完整性 | Lead + 离线模块 | 协议先按 `offline-incomplete` 占位，等同步模块合同（R-08） |
| A-Q17 | 重要 | 下钻来源不足：`GET /api/v1/transactions` 仅支持 `month` 过滤、无任意 from/to、无金额排序；B09/B10/B17 与 I 类来源需扩展 | 来源追溯/极值 | Lead + 后端 | 同 A-Q13 的 T2 只读扩展；未批准前极值先由服务端聚合（不含逐笔来源） |
| A-Q18 | 一般 | 分类颜色稳定映射（分类 id→主题调色板）需要 Codex 视觉令牌配合 | 环形图/图例 | Lead/Codex（与 A-Q8 合并） | 协议 §10 已定"按稳定分类身份"原则 |

---

## 8. 恢复步骤（上下文丢失时）

1. 读仓库 `AGENTS.md` → `docs/STATUS.md` → 索引 `S17-DeepSeek多Agent任务分配与集成索引.md` → 本文件。
2. 检查工作区：`git -C <本工作区> status --short`、`git -C <本工作区> log --oneline -5`；与 §6.2 最后记录核对，不一致立即停手并报告 Lead。
3. 只在本分支工作；禁止触碰索引 §1.3 的受保护工作区。
4. 向 `lead` 发送恢复报告（身份/状态/已完成/未决/下一步），并确认是否需要先 rebase 到最新基线。

---

## 9. 26 项覆盖与验收清单（Agent A 维护）

> 本表是所有者规格 §26「交付清单与验收条件」的落地跟踪表。Agent A 必须逐项补充：定义摘要、输入/输出、推荐图表（CF-Axx）、尺寸形态、来源追溯方式、依赖、状态与偏差登记。
> 状态词：未开始 / 等待数据能力 / 开发中 / 待测试 / 待集成 / 已验收 / 阻塞（写明阻塞原因）。
> 说明：`等待数据能力` 必须同时给出所需数据合同；不得以模拟数据宣称完成（规格 §26）。

### 9.1 B 类（B01–B20）

| 编号 | 名称 | 图表家族 | 状态 | 实现位置 | 测试 | 偏差/问题 |
|---|---|---|---|---|---|---|
| B01 | 总支出 | CF-A01 | 开发中（A-0 原语完成） | `analysis/primitives.ts › totalsOf().expenseMinor` | `primitives.test.ts`（totalsOf/sample C、A、G） | 精确 `bigint`；空账本为真实零 |
| B02 | 总收入 | CF-A01 | 开发中（A-0 原语完成） | `totalsOf().incomeMinor` | `primitives.test.ts`（sample B） | 与支出严格分开，不混淆退款语义 |
| B03 | 账目收支差额 | CF-A01/CF-A06 | 开发中（A-0 原语完成） | `totalsOf().netMinor` | `primitives.test.ts`（sample C） | 收入−支出；不称余额；可负 |
| B04 | 支出交易笔数 | CF-A01 | 开发中（A-0 原语完成） | `totalsOf().expenseCount` / `countByKind` | `primitives.test.ts`（sample C/O） | 整数；不得用分类组数代替 |
| B05 | 收入交易笔数 | CF-A01 | 开发中（A-0 原语完成） | `totalsOf().incomeCount` | `primitives.test.ts`（sample B/O） | 同上 |
| B06 | 日均支出 | CF-A01 | 开发中（A-0 原语完成；装配待 A-1） | `averageMinor(total, dayCount)`；`dayCount = daysBetween(from,to)` | `primitives.test.ts`（averageMinor） | 分母=自然日（`daysBetween` 含两端）；不整除用精确 `Ratio` |
| B07 | 单笔平均支出 | CF-A01 | 开发中（A-0 原语完成） | `averageMinor(total, expenseCount)` | `primitives.test.ts`（averageMinor） | 零笔 → `null`（不可计算，不是 0） |
| B08 | 单笔支出中位数 | CF-A01 | 开发中（A-0 原语完成） | `medianMinor(amounts)` | `primitives.test.ts`（medianMinor/sample N） | 偶数样本精确半单位 `Ratio`；`bigint` 排序 |
| B09 | 最大单笔支出 | CF-A02 | 开发中（A-0 原语完成） | `extremeRecord(entries,"expense","max")` | `primitives.test.ts`（extremeRecord/sample D） | 金额→日期→id 确定性；`tieCount` |
| B10 | 最小单笔支出 | CF-A02 | 开发中（A-0 原语完成） | `extremeRecord(entries,"expense","min")` | `primitives.test.ts`（extremeRecord） | 退款/负数/零金额语义待核查（A-Q3）；不得擅自过滤非正记录 |
| B11 | 最高单日支出 | CF-A02 | 开发中（A-0 原语完成） | `peakDay(entries,"expense")` + `dayTotals` | `primitives.test.ts`（peakDay） | 先按业务日期汇总再取最高；并列计数 |
| B12 | 最高单日收入 | CF-A02 | 开发中（A-0 原语完成） | `peakDay(entries,"income")` | `primitives.test.ts`（peakDay） | 同 B11 |
| B13 | 有支出记录的天数 | CF-A01/CF-A05 | 开发中（A-0 原语完成） | `distinctRecordedDays(entries)` | `primitives.test.ts`（distinctRecordedDays） | 按业务日期去重；缺汇率时区分原始/可折算 |
| B14 | 无支出记录的天数 | CF-A01/CF-A05 | 开发中（A-0 原语完成） | `daysWithoutRecords(entries,from,to)` | `primitives.test.ts`（sample L） | 必须称"无记录"，覆盖不足时不完整（A-Q16） |
| B15 | 最大支出分类 | CF-A02 | 开发中（A-0 原语完成；装配待 A-1） | `categoryTotals(entries,"expense")` 首项 | `primitives.test.ts`（categoryTotals） | 未分类显式入组、金额不丢（A-Q15） |
| B16 | 分类总数量 | CF-A01 | 开发中（A-0 原语完成；装配待 A-1） | `categoryTotals().length`（真实分类去重） | `primitives.test.ts`（categoryTotals） | 未分类不计入真实分类数；系统分类标记 `isSystem` |
| B17 | 最大单笔收入 | CF-A02 | 开发中（A-0 原语完成） | `extremeRecord(entries,"income","max")` | `primitives.test.ts`（extremeRecord） | 同 B09 |
| B18 | 收支比 | CF-A01/CF-A05 | 开发中（A-0 原语完成） | `ratioOf(expenseMinor, incomeMinor)` | `primitives.test.ts` + `rational.test.ts` | 分母零 `null`；可 >100% 不截断 |
| B19 | 账面结余比例 | CF-A06 | 开发中（A-0 原语完成） | `ratioOf(netMinor, incomeMinor)` | `rational.test.ts` | 可负；不称储蓄率 |
| B20 | 交易记录最多的一天 | CF-A02 | 开发中（A-0 原语完成；count 排序待 A-1 补原语） | `dayTotals` + 笔数排序（`peakDay` 按金额，不适用） | `primitives.test.ts`（dayTotals/sample O） | 业务日期；默认收入+支出；并列计数 |

### 9.2 I 类（I01–I05、I17）

| 编号 | 名称 | 图表家族 | 状态 | 实现位置 | 测试 | 偏差/问题 |
|---|---|---|---|---|---|---|
| I01 | 支出分类构成 | CF-A03/CF-A04/CF-A05/CF-A07 | 开发中（A-0 原语完成；结果装配待 A-2） | `analysis/primitives.ts › categoryTotals` + `foldRemainder` | `primitives.test.ts`（categoryTotals/foldRemainder/sample C、F） | “其他”可展开、金额守恒；份额为精确 `Ratio` |
| I02 | 收入分类构成 | CF-A03/CF-A04/CF-A07 | 开发中（A-0 原语完成；复用 I01 待 A-2） | `categoryTotals(entries,"income")` | `primitives.test.ts`（sample B） | 复用 I01 核心，不复制另一套 |
| I03 | 支出分类排行 | CF-A04/CF-A07 | 开发中（A-0 原语完成；结果装配待 A-2） | `analysis/primitives.ts › categoryTotals`（金额降序→id 升序） | `primitives.test.ts`（categoryTotals） | 零基线、同值稳定排序 |
| I04 | 收入分类排行 | CF-A04/CF-A07 | 开发中（A-0 原语完成；结果装配待 A-2） | `categoryTotals(entries,"income")` | `primitives.test.ts` | 复用 I03 核心 |
| I05 | 分类交易频率 | CF-A04/CF-A07 | 开发中（A-0 原语提供 count；计数排序待 A-2 补） | `analysis/primitives.ts › categoryTotals().count` | `primitives.test.ts`（categoryTotals） | 与金额排行不同指标，不能复用 I03 冒充 |
| I17 | 支付方式构成 | CF-A03/CF-A04 | 开发中（A-0 原语完成；字段能力已确认） | `analysis/primitives.ts › paymentMethodTotals`（null→未指定） | `primitives.test.ts`（paymentMethodTotals/sample O） | `paymentMethodId` 可空，未指定显式分组；不推导余额/负债（A-Q3） |

### 9.3 交付物跟踪

| 交付物 | 状态 | 位置 | 备注 |
|---|---|---|---|
| 真实字段映射表 | 已完成（A-0） | 本文档 §10 | 18 问逐条作答；缺字段单列 10.3 |
| 标准分析结果协议（S-01 草案） | 草案已登记（未冻结） | `S17-Agent-A-S01-共享分析结果协议草案.md` + `packages/shared/src/analysis/types.ts` | `s01-draft`，待 Lead/Claude/B/C/D 评审 |
| 基础计算原语 | 开发中（A-0 已完成首批） | `packages/shared/src/analysis/{rational,primitives}.ts` | 精确金额/分组/排序/比例/日期聚合；`rational.test.ts` 20 + `primitives.test.ts` 52 |
| 图表家族 CF-A01…CF-A07 | 未开始（A-2/A-3） | 待定 | 与 Codex 视觉规范对齐（A-Q8） |
| 尺寸密度（Compact/Medium/Expanded） | 未开始（W3） | 待定 | 真实容器尺寸优先 |
| 测试样本 A–O | 骨架已完成（A-0） | `packages/shared/src/analysis/fixtures.ts` | 15 个样本，不入 barrel；图表断言待 A-2 |
| 性能测量记录 | 未开始（A-4） | 待定 | 规格 §22 |
| 给 B/C/D/Codex/Lead 的接口交接说明 | 待建（协议评审通过后） | 待建 | 规格 §24 |

## §10 字段映射表（A-0 产出，逐条回答规格 §2 的 18 个问题）

> 口径：**分析概念 → 实际字段或现有函数 → 使用限制**。字段来源标注：`DB`=prisma schema、`shared`=packages/shared、`api`=apps/api、`web`=apps/web。结论来自本基线（HEAD `2a4368e`）实读，不来自猜测；缺失项一律标「等待数据能力」，不造替代数据。

### 10.1 数据模型总览（一句话）

账本隔离的 `Transaction` 表是唯一账目事实源：金额 `BigInt` 最小单位且**非负**、币种 `char(3)`、业务日期 `occurredLocalDate @db.Date`、收/支由 `kind` 快照区分、`categoryId` 必填、`paymentMethodId` 可空、软删 `deletedAt`、账本与权限由 `bookId` + `book_members` 决定。

### 10.2 18 问逐条

| # | 分析概念 | 实际字段 / 现有函数 | 使用限制 |
|---|---|---|---|
| 1 | 账目主键与账本关联 | `DB`：`Transaction.id`（客户端 uuid）、`bookId`、`seq`；`api`：`requireBook` 返回 `{bookId,role}` | 限本账本；绝不跨账本聚合；`seq` 仅展示编号，不作分析主键 |
| 2 | 收入/支出区分 | `DB`：`Transaction.kind`（`income`/`expense` 存储快照，与分类 kind 并存）；`shared`：`TRANSACTION_KINDS` | `amountCents` 恒非负（`convertFx` 注释「退款不擅自引入负流水」）；**不得假设存在负金额/用 `abs()`**；退款/冲销语义未建模，B10 口径待 A-Q3 |
| 3 | DB/前端金额表示 | `DB`：`amountCents BigInt`；`api`/`shared`：JSON `number`（`amountCentsSchema` int 0..`MAX_AMOUNT_CENTS`=1e12）；`shared/money.ts`：最小单位整数 | 前端 `number` 超 `MAX_SAFE_INTEGER` 会失真（A-Q14，样本 G）；分析层内部一律 `bigint` |
| 4 | 原始币种 | `DB`：`Transaction.currency char(3)`；`shared`：`CURRENCIES`（CNY/USD/EUR/JPY/HKD/GBP）、`decimalsFor` | 原币统计按单币种过滤，不跨币种相加；JPY 小数位 0 |
| 5 | 分类与分类 ID | `DB`：`Transaction.categoryId`（必填）→ `Category.id`；`Category.name/kind/isArchived/isSystem/sortOrder`；`api` 统计 join 名称，缺失显示「—」 | 按稳定 `categoryId` 分组，名称仅显示；分类只归档不删除（`onDelete: Restrict`）；系统「暂无分类」是真实分类（`UNCATEGORISED_NAME`） |
| 6 | 分类父子结构 | **不存在** `parentId`/二级分类；`Category` 为一级平铺 + `sortOrder` | 分类构成/排行只能到一级；B16 口径按一级（A-Q15） |
| 7 | 支付方式是否结构化 | `DB`：`Transaction.paymentMethodId` 可空 → `PaymentMethod{id,name,icon?,sortOrder,isArchived}`；删除时 `onDelete: SetNull`；`shared`：`paymentMethodTotals` | **有结构化字段**（I17 不再是"等待数据能力"）；描述性维度：不推导账户余额/信用卡债务/转账/实际资产；`null` → 显式「未指定」组，不丢弃 |
| 8 | 交易日期存储与解释 | `DB`：`occurredLocalDate @db.Date`（**分组/筛选唯一依据**，用户手机日历日）、`occurredAt timestamptz`、`occurredTz`；`shared`：`calendarDateSchema`、`addDays`、`daysBetween`（含两端） | 统计/分组只用 `occurredLocalDate`；不把 UTC/服务器时区/浏览器时区当业务日期；用户语义闭区间与 DB 半开区间转换集中在分析层 |
| 9 | 交易实际日期 vs 创建时间 | `DB`：`createdAt`/`updatedAt` 存在但**不是**业务日期；`valueHistory json` 记录值变更 | 不得用 `createdAt` 做日/月分组；B20「交易记录最多的一天」必须用 `occurredLocalDate` |
| 10 | 编辑/删除/恢复后过滤 | `DB`：`deletedAt` 软删、`version` 乐观并发、`valueHistory`；`api`：`DELETE` 软删、`POST /:id/restore`、`GET /:id` 可含已删除行；统计 where 固定 `deletedAt:null` | 统计口径与来源口径必须一致（同 where）；恢复后应重新出现；来源追溯不得显示已删记录而统计算入 |
| 11 | 可见性与共享权限 | `DB`：`BookMember{bookId,userId,role}`（`owner` 遗留 / `editor` 唯一可写 / `viewer` 只读，`leftAt` null 为现成员）；`api`：`requireBook`/`requireBookForWrite`/`readDeclaredBookId`/fallbackBook；错误码 403 `book_forbidden`、410 `book_deleted`、410 `book_deleting`、403 `book_archived`、403 `book_read_only` | 权限判断只在查询层，分析层不自拼；只读成员不因图表/详情页扩大数据范围；账本头 `x-libellum-book` |
| 12 | 原币统计路径 | `api`：`GET /api/v1/stats`（`routes/stats.ts`，3 个 groupBy/findFirst）；`shared`：`statsQuerySchema`/`StatsResponse`/`PeriodTotals`/`fillSeriesGaps` | 单币种必填（currency）；`totals.count` 是收+支合计（无 per-kind count）；无 paymentMethod 分组、无来源交易 ID、无周桶 |
| 13 | 汇率综合统计路径 | `shared/fx.ts`：`convertFx`（逐笔）+ `aggregateFx`/`aggregateFxAsync`；`FxSnapshot`（base EUR）/`FxEntry`/`FxResult`/`FxAggregate` | 逐笔折算后累加；`complete=false`/`missingCount>0` 时 `shareDenominatorMinor=null`，不造虚假分母；需逐笔 `FxEntry` 数据（现有 stats API 不给，A-Q13） |
| 14 | 历史汇率与逐笔舍入 | `shared/fx.ts`：`FX_POLICY="minor-half-away-v1"`、`FX_MAX_FALLBACK_DAYS=7`、`FxResult.rate{numerator,denominator}`（精确有理数）、rounding `(n*2n+d)/(2n*d)`、`FxResultCache`（含 entry version） | 不得用平均汇率或先汇总后折算；不得改舍入政策；`rate n/d` 已是权威分数，不转 float 做金额 |
| 15 | 离线数据覆盖 | `web`：S16 同步/离线模块（本 Agent 未获得覆盖范围元信息合同） | 标的 `offline-incomplete` 状态先占位；不得把离线不足标成完整（A-Q16，样本 L） |
| 16 | 统计查询与下钻接口 | `api`：`GET /stats`（聚合）、`GET /transactions`（仅 `month`，无任意 from/to、无金额排序、无 max 查询）、`GET /summary`（按币种月汇总）、`GET /transactions/:id` | 来源追溯/极值需 T2 只读扩展（A-Q13/A-Q17）；未批准前极值先由服务端聚合，不宣称逐笔来源完整 |
| 17 | 既有 P0 修复是否合入 | 基线 `2a4368e` 基于 1.16.22 生产代码（`486c603`），含 S16 已发布修复 | 1.16.23 候选未合入（A-Q2 门禁）：`FxDisplay.tsx`/`FxStats.tsx`/`StatsPage.tsx`/`DetailPage.tsx`/`fxView*`/`version.ts` 未触碰 |
| 18 | 已有可复用统计能力 | `shared/stats.ts`：`comparisonRangeFor`/`rangeForPreset`/`bucketForPreset`/`fillSeriesGaps`/`daysBetween`/`startOfMonth`/`endOfMonth`；`shared/money.ts`：`parseAmountToMinor`/`formatMinor`/`sumMinor`/`decimalsFor`；`shared/fx.ts`：`convertFx`/`aggregateFx`；`routes/stats.ts` 的 groupBy 模式 | `averagePerDay` 用 `Math.round` 到整最小单位，不能直接服务 B06（A-Q11）；`byCategory.share` 是 float，不能作权威比例（A-Q12）→ 分析层用 `analysis/rational.ts` 精确 `Ratio` |

### 10.3 缺字段 / 需新增数据能力（不得造替代数据）

| 缺失能力 | 影响的 A 项 | 现状 | 需要的决定 |
|---|---|---|---|
| 来源交易 ID 列表（stats 响应不含） | B09/B10/B17 来源、I01 点击来源 | 阻塞（等待数据能力） | T2 只读扩展（不改 schema）→ Lead/后端批准（A-Q13/A-Q17） |
| 任意 from/to 交易查询、金额排序/极值查询 | B09/B10/B17、下钻 | 阻塞 | 同上 T2 |
| 商户/收款方、交易作者、二级分类 | 目录层已列 T4/待研究 | 不存在 | 不排期；不得以备注文本冒充 |
| 转账合同、资金账户/余额/净资产 | B19 等口径边界 | 不存在 | 所有者业务规则；不得推导 |
| 预算/目标 | B18 名称边界 | 不存在 | 不得称「预算使用率」 |
| 离线覆盖范围元信息 | B14、所有完整性 | 待合同 | 离线/同步模块（A-Q16） |
| 统一数据版本戳 | 协议 `dataVersion`、结果复用 | 无统一字段 | Lead（A-Q6） |
| 周桶（周一起） | 周维度分析 | 现有只 day/month | **不阻塞**：分析层按 `occurredLocalDate` 自行按周一起聚合 |

### 10.4 复用边界（只复用、不重写）

- **金额**：复用 `shared/money.ts`（`decimalsFor`/`formatMinor`/`sumMinor`）；精确比例用新增 `analysis/rational.ts`，**不改** `money.ts` 既有语义。
- **汇率**：只用 `shared/fx.ts` 的 `convertFx`/`aggregateFxAsync` 与 S16-D 合同，不自造汇率、不改舍入政策。
- **日期区间**：复用 `stats.ts` 的 `comparisonRangeFor`/`rangeForPreset`/`daysBetween`；分析层只新增范围解析包装，不改 `stats.ts`。
- **权限**：只经 `requireBook`/`requireBookForWrite` 与查询层；分析层不拼 SQL、不自行判断角色。
- **统计聚合**：优先复用 `GET /stats`；A 层扩展时必须保持同一 where 语义：`bookId` + `deletedAt:null` + `currency`（原币）+ `occurredLocalDate` 区间。

### 10.5 分析定义 → 结果字段 → 查询条件（S-01 落地对照）

| `AnalysisDefinition` | `ResolvedFilters` / `ResolvedPeriod` | 对应查询/字段 |
|---|---|---|
| `filters.kind` | `ResolvedFilters.kind`（expense/income/both） | `Transaction.kind` |
| `filters.categoryIds` | `ResolvedFilters.categoryIds`（null=不限、[]=空集） | `categoryId IN (...)` |
| `filters.paymentMethodIds` | 同名字段 | `paymentMethodId IN (...)`（含 null 表示未指定） |
| `filters.tagIds` | 同名字段 | `tags` 关联 `Tag` |
| `filters.currency` | `ResolvedFilters.currency`（原币模式必填） | `Transaction.currency` |
| `time.mode/from/to/preset` | `ResolvedPeriod{from,to,dayCount}`（用户闭区间；DB 用 `[from,to]`，跨月折算半开 `[start, endExclusive)`） | `occurredLocalDate >= from AND <= to` |
| `currency.mode="inherit"` | `ResolvedCurrency{mode:"original",currency}` 或 `{mode:"aggregate",targetCurrency}` | 原币：单币种 where；综合：逐笔 `FxEntry` + `aggregateFxAsync` |
| 结果 `computation.rounding` | — | `ANALYSIS_ROUNDING_POLICY="minor-half-away-v1"`；显示舍入 `ratioToDecimalText` |


