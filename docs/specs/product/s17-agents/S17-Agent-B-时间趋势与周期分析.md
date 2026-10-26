# S17 · Agent B 任务文档：时间、趋势与周期分析

> 本文件是 **DS-S17-B-Time** 的唯一权威任务文档。所有长期有效的职责、接口、进度、问题与交接必须写入本文件，不得只存在于聊天上下文。
> 建立：2026-10-27（Lead 初始化）；维护者：Agent B 自己。
> 当前状态：**已收到所有者完整开发规格，进入正式开发（B-0 时间合同与共享接口）**。
>
> **所有者完整开发规格（权威全文）**：[S17-Agent-B-完整开发规格-所有者-20261027.md](S17-Agent-B-完整开发规格-所有者-20261027.md)（2,937 行；2026-10-27 由 Lead 逐字登记，与所有者原文一致）。开发定义、公式、图表家族、测试矩阵以该文件为准；本文件负责身份、边界、进度与交接。

---

## 1. Agent 身份

| 项 | 值 |
|---|---|
| 名称 | `DS-S17-B-Time` |
| 角色 | S17 时间、趋势与周期分析负责人 |
| 工作区 | `C:\Users\ZhuanZ（无密码）\Desktop\工作\记账程序\记账程序v1-s17-b-time` |
| Git 分支 | `deepseek/s17-time-analysis` |
| 基线 | `486c603`（origin/main = 1.16.22 生产版）；待 1.16.23 发布后统一 rebase（见索引 B-1） |
| 负责模块 | 日/周/月时间序列、收支趋势、累计收支、日历热力图、星期分布、周期比较、同比/环比、移动平均、时间维度波动；对应折线图、面积图、柱状图、热力图；**同时负责本领域的计算函数与绘图函数** |
| 不负责 | 基础分类/支付方式统计（A）、专业统计与复杂图表（C）、网格与布局/配置/分享（D）、视觉设计规范（Codex）、代码审查（Claude）、生产发布 |
| 上级协调 | Lead（`lead`）；不得直接指挥/修改其他 Agent |

### 目标与完成定义（2026-10-27）

> 系统限制：delegated subagent 无法调用 `create_goal`（需要顶层人类直接轮次）。Lead 将在顶层会话为 B 代建目标并回填 id；在此之前以本节为等价记录，上下文丢失后按本节恢复目标。

**总目标**：按所有者完整规格完成 S17 工作台的 24 项时间/趋势/周期分析（I06–I16、I19–I20、A01–A05、A12–A14、A18–A20）的计算函数与绘图函数，按 B-0→B-5 顺序交付并接入统一分析工作台，零财务语义回归。

**完成定义（全部满足才算完成）**：
1. 24 项能力全部实现，逐项通过规格 §37 验收，不得缩减、不得降级为可选。
2. 结果走 S-01 协议（时间形状经 A/Lead 确认合并），日期、金额、汇率、完整性口径与规格 §3–§4 一致。
3. B-5 验收全绿：24 项能力测试、图表一致性、日期边界回归（月初/月末、跨年、闰年、周一起、时区）、多币种回归、完整性检查、多尺寸/中英/主题适配、性能基线、来源一致性。
4. 文档与交接齐全（本文件 §5/§6 持续更新；核查表、协议草案随实现演进）。
5. 不合并 main、不 push、不部署、不改原始账务数据；公共接口未评审前不冻结。

### 工作区纪律（硬约束）

- 只在自己分支与工作区写代码/文档；不得 reset/clean/删除/覆盖他人 worktree（含主工作区未提交的 1.16.23 候选与 Claude 文档工作区，见索引 §1.3）。
- 不合并 main、不 push、不部署、不操作生产环境；未经批准不新增迁移/不改业务数据库。
- 只复用已确认的权威财务计算与分析结果协议（S-01，由 A 主要拟定）；**不得建立与 A 不兼容的另一套统计框架**。
- 公共接口未评审前不得冻结；接口变化登记本文件 §6 并告知 Lead。

---

## 2. 任务范围

### 2.1 负责的能力编号（唯一负责人）

- **I06–I16**：11 项常用分析（时间组）。
- **I19–I20**：2 项常用分析（时间组）。
- **A01–A05**：5 项深入分析（时间组）。
- **A12–A14**：3 项深入分析（时间组）。
- **A18–A20**：3 项深入分析（时间组）。
- 合计 **24 项**。状态统一为：**开发清单已登记**（定义见所有者规格文件，开发按 B-0→B-5 分批推进）。

### 2.2 开发阶段

- **W1 财务统计正确性**：配合 A 的时间口径清理（月归属、日/周边界、时区语义）与核对（具体范围以所有者细则为准）。
- **W2 计算与展示分层**：作为 S-01 协议的参与评审方；提供时间序列类结果形状需求（路线图 RS-2/RS-4/RS-6/RS-9 等），不另立框架。
- **W3 分析页面与时间卡片**：折线图、面积图、柱状图、日历热力图等（按所有者清单与批次）。
- 后续阶段配合卡片接入、详情页与集成。

### 2.3 计算函数（B-1 已实现，B-2～B-4 追加）

- **已实现（B-1）**：`packages/shared/src/timeSeries.ts`
  - `computeTimeSeries(entries, { metric, granularity, span, today, coverageEnd, countKind })`：按业务日期分桶（日/周/月）× 支出/收入/笔数；金额为 minor 整数，精确；`unknown`（覆盖不足）/`in-progress`（当前周期未结束）/`future`（晚于今天）三态；存在未知桶时 `total` 为 null（不得当 0）。
  - `accumulateSeries(series)`：累计支出/收入（I20/I10 累计语义）；未知向后传播（后续累计不可信）、零变动平台保留、负调整允许（不强制单调）。
  - `isTimeSeriesOptionsValid(options)`：入参校验（区间合法性、metric 与 countKind 匹配）。
- 日/周/月聚合时间序列（支出、收入、结余、笔数），支持自定义起止与账本月份口径。
- 累计收支曲线（running total，含负值、跨月边界）。
- 同比/环比（需明确“去年同月/上月”在部分数据缺失时的语义，不允许把缺失当 0）。
- 移动平均（窗口大小、端点处理、量级保持一致）。
- 星期分布、周期比较、日历热力图数据（按本地日期与账本时区；跨时区交易归属必须明确）。
- 波动指标（标准差/最大最小/区间等——具体定义待所有者清单；注意规格 §5.7 的精确分数要求）。
- 多币种：按币种分别成序列；不得不同原币直接相加；折算只走 S16-D 合同（只读汇率 + 客户端折算）。
- 金额精度沿用 shared money（最小货币单位整数），不得为了绘图另定精度。
- 空数据/缺数据/软删除/退款/转账对时间序列的影响必须显式定义并与现有 API 统计一致（差异报告，不静默改语义）。

### 2.4 绘图函数（B-1 已实现基础图；B-2 起扩展）

- **已实现（B-1）**：`apps/web/src/lib/chart/timeSeriesChart.ts` 产出图表几何模型（柱/线/面积、空态、全零、负值、断线），组件 `SeriesTrendChart`（折线/面积/柱）、`Sparkline`（1×1 迷你趋势）、`CumulativeTrendChart`（累计趋势 + 未知起点标注）。
- 复用共享绘图核心（`ChartFrame/Axis/Legend/theme/scales/geometry/format`）与 Codex 视觉规范（S-02）；不得自创视觉体系；不复制仅指标不同的组件。
- 时间轴、刻度与缺数据断点表现（缺失应可见，不画成 0；未知桶不画、不画 0、不连线）。
- 后续：日历热力图、周期比较、移动平均/异常标注（B-2～B-4）。

### 2.5 依赖接口

- **S-01 分析结果协议**：由 A 主要拟定、统一评审；本 Agent 参与评审与需求输入。
- S-02 图表视觉/绘图核心：Codex + Lead 统一裁定。
- S-03 卡片注册协议：与 Lead、D、Codex 对齐。
- S-04 查询与权限：只增量复用现有 `ledger/access.ts` 与 API；不得修改现有权限语义。
- S-06 历史汇率合同（S16-D）：只读复用，不得绕过。
- 数据来源可追溯（账本、时间范围、时区、口径、币种、数据版本）。

### 2.6 测试范围

- 时间边界：月初/月末、跨年、2 月/闰年、周起始日、时区切换、DST 语义（如涉及）。
- 累计/移动平均的端点与空窗；同比/环比的缺失语义；软删除/退款/转账对序列的影响。
- 与现有 API（`/summary`、`/stats`、历史等）同口径对照；多币种分币种校验。
- 权限：成员/只读/非成员/跨账本隔离。
- 绘图：数据映射、缺数据断点、空态；视觉验收交给 Codex/Lead E2E。

---

## 3. 输入与输出协议（S-01 已对齐，待冻结）

> **S-01 仍未冻结（`s01-draft`）。** B 的时间扩展已与 A 对齐（A §15，2026-10-27），结论见协议草案 §7；最终以 Lead/Claude/所有者评审冻结为准。

- 输入（预期）：账本 ID、权限上下文、时间范围/粒度（日/周/月）、时区口径（业务日期以记录 `occurredLocalDate` 为准，不做 UTC 转换）、币种/过滤、`dataVersion`（由数据层透传，B 不自造）。
- 输出（预期）：时间序列结构（桶 + 值 + 币种 + 单位 + 未知/未来/未完成标记 + 来源追溯 + 数据版本），不含 DOM/尺寸/布局。
- 时间桶内部半开 `[start,end)`；对外/来源跳转用 `bucketToInclusive` 转闭区间；不新增日期类型。
- 时间点必须显式包含“无数据”与“数据不完整”的区分；不得用 0 静默填充。
- 同一定义同数据版本内结果可复用；图表层不得重算。

---

## 4. 财务与安全限制（所有 Agent 共同遵守）

- 不改原始账务数据；不更改已有财务计算语义。
- 不直接混加不同货币；折算只走 S16-D 合同。
- 不绕过账本权限；新查询必须做权限测试。
- 不把缺失数据视为零。
- 不因为显示尺寸影响金额。
- 不修改其他用户的个人配置；不读取无权限账本。
- 不得为了凑数量而编造数据或偷换分析定义。

---

## 5. 持续进度记录

| 能力组 | 状态 | 备注 |
|---|---|---|
| 所有者完整规格登记 | 完成（2026-10-27） | 2,937 行规格已落盘并引用 |
| B-0 时间合同与共享接口 | **完成（2026-10-27）** | 交付：`packages/shared/src/timeCalendar.ts`（+18 测试）、20 项时间与财务合同核查表、S-01 时间扩展协议草案；待 A 对齐后进入 B-1 |
| B-1 基础趋势与对应图表（I06–I10、I19–I20 + 折线/面积/柱/Sparkline/累计） | **完成（2026-10-27）** | 计算核心 `packages/shared/src/timeSeries.ts`（day/week/month × expense/income/count + 累计）；图表输入 `apps/web/src/lib/chart/timeSeriesChart.ts`；组件 `SeriesTrendChart`/`Sparkline`/`CumulativeTrendChart`；未改任何页面（不碰 1.16.23 冲突文件） |
| B-2 构成/比较/热力/星期（I11–I16 + CF-B04/B05/B06/B08/B09） | **完成（2026-10-27）** | 计算核心 `flowSeries`（`timeSeries.ts` 扩展）/`categorySeries.ts`/`weekdayPattern.ts`/`calendarHeatmap.ts`；图表输入 `apps/web/src/lib/chart/categoryChart.ts`；组件 `IncomeExpenseBars`/`CategoryStackedBars`/`CategoryShareBands`/`WeekdayBars`/`CalendarHeatmapGrid`；未改页面、未接 S-01 信封 |
| I06–I16 / I19–I20 | **完成（B-1：I06–I10、I19–I20；B-2：I11–I16）** | 纯函数 + 图表输入层 + 组件；页面集成待 1.16.23 发布后 W1/W3 |
| A01–A05 / A12–A14 / A18–A20 | 未开始（已入开发清单） | 按 B-3/B-4 分批 |
| S-01 参与评审 | 进行中（时间扩展已与 A 对齐，待评审冻结） | A §15 已答复 Q-BA-1/2/3/4/7/8；剩余 Q-BA-12（区间上限）待登记 |
| W1 时间口径核对 | 未开始 | 前置：1.16.23 发布（索引 B-1）；B-0 核查表已提供口径证据 |
| W3 时间图表/卡片 | 未开始 | 依赖 S-01/S-02/S-03 |

---

## 6. 开发交接记录

### 6.1 汇报格式（向 Lead）

`状态 / 已完成 / 修改文件 / 相关提交 / 测试命令与结果 / 接口变化 / 已知问题 / 下一步`；同时在 §6.2 记录。

### 6.2 记录

| 日期 | 内容 | 修改文件 | 提交 | 测试 | 接口变化 | 已知问题 | 下一步 |
|---|---|---|---|---|---|---|---|
| 2026-10-27 | 工作区/分支/任务文档初始化（Lead 创建）；未开发 | 本文件 | 随初始化提交 | 未运行 | 无 | 见 §7 | 等待所有者第二轮需求；先评审 A 的 S-01 草案 |
| 2026-10-27 | 收到所有者完整开发规格（24 项、48 节、图表家族 CF-B01–B15、B-0～B-5 顺序、风险分级审核、永久文档要求）；已逐字落盘并开始 B-0 | 本文件 + 规格文件 | 随本次提交（待提交） | 尚未运行 | 无（尚未定义接口） | 基线仍为 486c603；W1 待 1.16.23 | 开始 B-0：时间合同核查 + 时间桶/结果协议草案 + 与 A 对齐 S-01 |
| 2026-10-27 | **B-0 完成**：①时间合同实现（半开区间/周一起自然周/ISO 周键/自然月/桶枚举/完整性状态）；②20 项时间与财务数据合同核查表；③S-01 时间扩展协议草案（7 形状 + 11 个对齐问题）；④未开始任何业务分析（24 项仍 0 实现） | `packages/shared/src/timeCalendar.ts`、`timeCalendar.test.ts`、`packages/shared/src/index.ts`、`apps/web/src/i18n/sharedMessages*.ts`、核查表、协议草案、本文件、`docs/00-索引.md` | `b23311c`（本地；未 push） | `pnpm --filter @libellum/shared test` 395/395；web `vitest run` 152 文件/1385 用例全过；`pnpm typecheck` 三包全过；`pnpm check:docs` 通过（195 文/970 链接）；API 集成 611/612（唯一失败为本地库迁移落后 2 个版本的 `profile` 头像用例，与本分支改动无关，已在报告中说明） | 新增公共导出 `timeCalendar`（v1，未冻结）及 `TimeBucket/BucketState/TimeSpan` 等类型；S-01 时间形状仅为草案（A 未合并） | R-B-02 离线覆盖元数据、R-B-04 stats 失效/dataVersion；Q-BA-1/2/3/4/7/8 待 A | 向 Lead 首份 B-0 报告；A 对齐后进入 B-1（I06–I10、I19–I20 + 折线/面积/柱/Sparkline/累计） |
| 2026-10-27 | B-0 验证结果与索引回填（`docs/00-索引.md` 增加 4 条 S17 文档入口） | 本文件、`docs/00-索引.md` | 随本次提交 | 同上 | 无 | 无 | 等待 A 对协议草案的回复；准备 B-1 开发清单 |
| 2026-10-27 | **B-1 完成**：①shared 计算核心 `timeSeries.ts`（按业务日期分桶：day/week/month × 支出/收入/笔数，精确 minor 金额，unknown/future/in-progress 三态，累计 `accumulateSeries` 未知向后传播、零变动平台不断线）；②图表只读适配层 `timeSeriesChart.ts`（柱/线/面积模型、空态、Y 轴 nice domain、全部为 0 判定，不反写权威值）；③组件 `SeriesTrendChart`/`Sparkline`/`CumulativeTrendChart`（复用 `ChartFrame/Axis/Legend/theme/scales`，44px 触摸目标、键盘 Arrow/Home/End、24px 触控高度、缺数据断线不得画 0）；④i18n 登记（`sharedMessages` 增加 `timeSeries.ts` 归类与 2 句译文）；⑤`bucketToInclusive`（A §15.1(4) 定名）接入 | `packages/shared/src/timeSeries.ts`、`timeSeries.test.ts`、`apps/web/src/lib/chart/timeSeriesChart.ts`、`timeSeriesChart.test.ts`、`apps/web/src/components/charts/SeriesTrendChart.tsx`、`Sparkline.tsx`、`CumulativeTrendChart.tsx`、`timeSeriesCharts.test.tsx`、`apps/web/src/lib/chart/format.ts`（`weekBucketLabel`）、`apps/web/src/i18n/sharedMessages*.ts`、`packages/shared/src/index.ts`、本文件、协议草案 | `f4da5f8`（本地；未 push） | `pnpm --filter @libellum/shared test`：20 文件/414 用例全过（含 `timeCalendar` 19、`timeSeries` 18）；web `vitest run`：154 文件/1405 用例全过（新增 27）；`pnpm --filter @libellum/shared typecheck` 0；`pnpm --filter @libellum/web typecheck` 0；`pnpm check:docs` 通过 | 新增公共导出 `timeSeries`（v1，未冻结）与 `bucketToInclusive`/`InclusivePeriod`；新增 web 图表适配层（非 S-01 信封）；未新增 HTTP/API 接口 | 已知：S-01 信封层 `analysis/time.ts` 与 `SourceDescriptor.bucket` 待协议冻结/合并后补；`MAX_STATS_DAYS=400` 与 I09 36 个月区间冲突待 A/Lead 登记（协议草案 Q-BA-12） | 跑全量 shared+web 测试后提交；发 B-1 结构化报告 Lead；准备 B-2（I11–I16） |
| 2026-10-27 | **S-01 时间扩展对齐收敛**：A §15（`655ea14`/`5faaac1`）逐条答复 Q-BA-1/2/3/4/7/8；B 按结论更新协议草案 §7/§4.3/§8/§9（7 形状登记进 union、`bucketToInclusive`、`SourceDescriptor.bucket?`、dataVersion 由数据层透传、`timeGranularity?`=A-Q21、R-09 coverageEnd 展示元数据），并新增待评审项 Q-BA-12（分析区间上限） | `docs/specs/product/s17-agents/S17-Agent-B-S01-时间扩展协议草案.md`、本文件 | `f4da5f8`（本地；未 push） | 文档变更，无需单测 | 协议草案状态由“待 A 回复”改为“已对齐（待评审冻结）”；未冻结仍为 `s01-draft` | S-01 冻结由 Lead/Claude/所有者评审 | B-2 按对齐结论实现；协议冻结后补 `analysis/time.ts` 信封 |
| 2026-10-27 | **B-2 完成**：①`flowSeries` 收支成对桶（差额 `differenceMinor` 仅两侧已知时给出）；②`categorySeries` 分类×时间（Top N + 其他、未知桶不补 0）；③`category shares` 桶内占比（分母=桶权威合计、零总额/未知不给占比）；④`weekdayPattern` 周一起 ISO 1..7 固定顺序、精确分数平均；⑤`calendarHeatmap` 日格子（分位 0–4、未知/未来不着色）；⑥`categoryChart.ts` 图表输入层（不重算金额）；⑦组件 `IncomeExpenseBars`/`CategoryStackedBars`/`CategoryShareBands`/`WeekdayBars`/`CalendarHeatmapGrid`；⑧协议草案新增 §11 映射与语义锁定 | `packages/shared/src/{categorySeries,weekdayPattern,calendarHeatmap}.ts`、`timeSeries.ts`（扩展）、`packages/shared/src/index.ts`、对应测试 3 个、`apps/web/src/lib/chart/categoryChart.ts`（+测试）、组件 5 个 + `categoryCharts.test.tsx`、本文件、协议草案 | 随本次提交（本地；未 push） | `pnpm --filter @libellum/shared test`：**444/444** 全过（23 文件，含新增 30 余用例）；web `vitest run`：**156 文件/1422 用例**全过（新增 12 模型 + 5 组件）；`pnpm --filter @libellum/web typecheck` 0；`sharedMessages` 归类测试 7/7；图表 i18n 测试 3/3；`pnpm check:docs` 通过 | 新增公共导出 `categorySeries`/`weekdayPattern`/`calendarHeatmap`/`flowSeries`（均为 v1，未冻结）；未新增 HTTP/API；S-01 信封仍未接 | 图表完整 hover/touch 读数、44px 触摸与页面集成随 W3；S-01 冻结后补 `analysis/time.ts` 与 `SourceDescriptor.bucket` | 发 B-2 结构化报告 Lead；B-3（A01–A05）随后 |

---

## 6.3 所有者完整开发规格索引（2026-10-27）

全文见 [S17-Agent-B-完整开发规格-所有者-20261027.md](S17-Agent-B-完整开发规格-所有者-20261027.md)，关键结构：

| 规格章节 | 内容 | 开发对应 |
|---|---|---|
| §0–§2 | 24 项清单、工作边界、与 A/C/Codex 协作 | 全程 |
| §3 | 业务日期/自然周（周一起）/自然月/完整性/未来日期/来源追溯 | B-0 时间合同 |
| §4 | 精确金额、原币/综合汇率、不完整折算、增长率精度 | 复用 A/S16-D |
| §5 | 时间桶与 TimeSeries/MultiSeries/PeriodComparison/CalendarHeatmap/MovingAverage/Variability/Anomaly 结果协议 | B-0 协议草案 |
| §6–§16 | I06–I16、I19–I20 分析定义与图表/尺寸规则 | B-1、B-2 |
| §17–§18 | I20、I19 细节 | B-1 |
| §19–§29 | A01–A05、A12–A14、A18–A20 | B-3、B-4 |
| §30–§31 | 图表家族 CF-B01–CF-B15 与兼容性表 | B-1～B-4 绘图核心 |
| §32–§34 | 容器尺寸/交互/坐标系统 | W3 卡片、Codex 集成 |
| §35 | 缓存与性能（基础时间投影、失效规则） | B-0/B-5 |
| §36–§37 | 时间边界测试矩阵 + 性质测试（分组守恒等） | B-5 验收 |
| §38–§39 | 详情页接口、与 D 布局容器关系 | 集成 |
| §40 | 开发顺序 B-0→B-5 | 立即执行 |
| §41–§43 | 风险分级审核、永久文档、交接要求 | 全程 |
| §44–§45 | 最终验收条件与执行顺序（24 项不得缩减） | 验收 |

**即时结论**：①开发顺序按 B-0 → B-5；②B-0 可立即开始（时间合同核查、时间桶/结果协议草案、与 A 的 S-01 对齐）；③W1 正式落地仍依赖 1.16.23 发布，登记为环境条件（索引 B-1），不阻塞 B-0 的只读核查与纯算法工作；④24 项能力编号与所有者规格一致（I06–I16、I19–I20、A01–A05、A12–A14、A18–A20），此前 `AN-xxx` 目录映射仅为参考，不改变所有者编号。

### 6.4 交付物索引（B-0 2026-10-27；B-1/B-2 追加）

| 交付物 | 路径 | 说明 |
|---|---|---|
| 时间合同实现 | `packages/shared/src/timeCalendar.ts` | `TIME_CONTRACT_VERSION = "s17-b-time-v1"`；半开 `[start,end)`、周一起自然周、ISO 周键、自然月、桶枚举/裁剪、`BucketState` 完整性状态、`bucketToInclusive`（A §15 定名） |
| 时间合同测试 | `packages/shared/src/timeCalendar.test.ts` | 19 个用例：ISO 周/周跨月跨年、闰年 2 月、半开边界、桶裁剪与连续性、future/in-progress/unknown/complete 判定、桶→闭区间换算 |
| 时间序列计算核心（B-1） | `packages/shared/src/timeSeries.ts` | `TIME_SERIES_VERSION = "s17-b-time-series-v1"`；`computeTimeSeries`（day/week/month × 支出/收入/笔数，金额为 minor 整数，`unknown/in-progress/future` 三态，`total` 在存在未知桶时为 null）、`accumulateSeries`（累计语义：未知向后传播、零变动平台、负调整允许）、`isTimeSeriesOptionsValid` |
| 时间序列测试 | `packages/shared/src/timeSeries.test.ts` | 18 个用例：日/周/月分桶、跨年与闰月、当前月未结束、未来桶、覆盖不足 unknown、大整数、笔数、累计传播/平台/负值、参数校验 |
| 图表只读适配层（B-1） | `apps/web/src/lib/chart/timeSeriesChart.ts` | `buildTimeSeriesModel`/`buildCumulativeModel`：只做显示派生（像素比例、柱/线/面积几何、Y 轴 nice domain、全零/空态），**不重算金额、不改完整性**；`timeSeriesChart.test.ts` 12 用例 |
| 时间图表组件（B-1） | `apps/web/src/components/charts/SeriesTrendChart.tsx`、`Sparkline.tsx`、`CumulativeTrendChart.tsx` | 复用 `ChartFrame/Axis/Legend/theme/scales/geometry/format`；缺数据断线不画 0；未来/未知态；键盘 Arrow/Home/End；累计图标注“未知起点”；`timeSeriesCharts.test.tsx` 8 用例 |
| 公共导出 | `packages/shared/src/index.ts` | 新增 `timeCalendar`、`timeSeries` 值/类型导出块（均未冻结） |
| 20 项核查表 | `docs/specs/design/S17-B-时间与财务数据合同核查表.md` | 对应规格 §2；含 T-01–T-20、可复用清单、风险 R-B-01–R-B-06 |
| S-01 时间扩展草案 | `docs/specs/product/s17-agents/S17-Agent-B-S01-时间扩展协议草案.md` | 7 个结果形状、完整性映射、不变式 IV-01–IV-14、逐桶来源合同；§7 已按 A §15 收敛（已对齐、待冻结） |
| i18n 登记 | `apps/web/src/i18n/sharedMessages.ts`（+ `sharedMessages.test.ts` 文件归类） | `timeCalendar.ts`/`timeSeries.ts` 的中文提示登记英文译文；测试扫描 `packages/shared` 全部源文件的 CJK 提示归类 |
| 现金流计算核心（B-2） | `packages/shared/src/timeSeries.ts`（扩展） | `FLOW_SERIES_VERSION = "s17-b-flow-series-v1"`；`computeFlowSeries`（收支共用桶边界、`differenceMinor` 仅两侧已知时给出、未知不补 0）；测试在 `flowSeries.test.ts` |
| 分类×时间计算核心（B-2） | `packages/shared/src/categorySeries.ts` | `CATEGORY_SERIES_VERSION = "s17-b-category-series-v1"`；`computeCategorySeries`（Top N + `includeOther`，`OTHER_CATEGORY_KEY`，未知桶 `totalMinor = null`）、`computeCategoryShares`（分母=桶权威合计、`ShareRatio` 分子/分母字符串、`zero-total`/`unknown`/`future` 不给占比）、`topCategoriesByTotal` |
| 星期分布计算核心（B-2） | `packages/shared/src/weekdayPattern.ts` | `WEEKDAY_PATTERN_VERSION = "s17-b-weekday-pattern-v1"`；ISO 1..7（周一→周日）固定顺序；`average = 精确分数 / observedDays`（只除以实际出现的天数）；`WEEKDAY_MIN_SAMPLE_DAYS = 28` 样本阈值与 `sufficientSample` |
| 日历热力计算核心（B-2） | `packages/shared/src/calendarHeatmap.ts` | `CALENDAR_HEATMAP_VERSION = "s17-b-calendar-heatmap-v1"`；逐日 `valueMinor`/`transactionCount`/`state`/`level`；分位 0–4 只对完整日计算，`unknown`/`future` 的 `level = null`；按自然月、周一起始分组 |
| 分类图表输入层（B-2） | `apps/web/src/lib/chart/categoryChart.ts` | `buildFlowBarModel`/`buildStackedBarModel`/`buildShareStackModel`/`buildWeekdayModel`/`buildCalendarGridModel`：只把权威数字放到像素上，未知无几何，不重算分母/金额；`categoryChart.test.ts` 12 用例 |
| 构成图表组件（B-2） | `apps/web/src/components/charts/IncomeExpenseBars.tsx`、`CategoryStackedBars.tsx`、`CategoryShareBands.tsx`、`WeekdayBars.tsx`、`CalendarHeatmapGrid.tsx` | 复用 `ChartFrame/Axis/Legend/theme/scales`；文案全部由 props 传入（组件不产中文）；`categoryCharts.test.tsx` 5 用例 |
| B-2 协议映射与语义锁定 | `docs/specs/product/s17-agents/S17-Agent-B-S01-时间扩展协议草案.md` §11 | I11–I16 → S-01 形状映射；占比分母/零总额/未知桶/收支差额/星期顺序/热力着色的锁定语义 |

**环境说明（本地验证）**：本 worktree 首次使用需 `pnpm install --offline`（本地 pnpm store 已具备依赖）；Prisma 7 的 `prisma.config.ts` 要求 `DATABASE_URL` 环境变量存在，生成客户端用 `DATABASE_URL=postgresql://... pnpm db:generate`（生成不连库，生成物被 gitignore）。API 集成测试需要根目录 `.env` 的 `TEST_DATABASE_URL`（测试库名必须含 `test`，见 `apps/api/test/setup.ts` 的守卫）；本工作区 `.env` 为本地开发文件，**不入库**。

---

## 7. 未决问题（Agent B）

| 编号 | 问题 | 影响 | 需要谁决定 |
|---|---|---|---|
| B-Q1 | 所有者编号 I/A 与现行能力目录 `AN-xxx` 的映射未定 | 明细对齐 | 所有者/Lead（索引 B-3） |
| B-Q2 | W1 基线要求 1.16.23 发布，目前为未提交候选；B-0（时间合同核查、纯算法、结果协议草案）不依赖该发布，可先做 | W1 正式落地受限 | 所有者（索引 B-1）；Lead 在发布后统一 rebase |
| B-Q3 | 时区/账本月份口径与“日/周”定义（本地日期 vs 账本时区）需与 A 统一 | 时间序列口径 | 所有者细则 + A/Lead |
| B-Q4 | 同比/环比在缺月、部分数据缺失时的显示语义 | 指标可信度 | 所有者细则 |
| B-Q5 | 时间序列结果形状如何纳入 S-01（等距/非等距、空点表达） | 协议冻结 | Lead + A |
| B-Q6 | 卡片尺寸/视觉规范未定（D/Codex） | W3 无法开工 | Lead 协调 |
| B-Q7 | S-01 时间扩展对齐：桶半开区间、`dataVersion` 定义、逐桶来源、7 个形状命名（草案 §7 的 Q-BA-1～Q-BA-4、Q-BA-7/Q-BA-8） | **已解决（2026-10-27）**：A §15 逐条答复——7 形状登记进 union（命名归 A 逐字不变）、`bucketToInclusive` 定名、`SourceDescriptor.bucket?` 由 A 扩字段、dataVersion 由数据层透传、桶级复用 `AnalysisCompleteness`、Ratio 跨 HTTP 用分子分母字符串；S-01 仍 `s01-draft` 待评审冻结 | 已解决（A + Lead） |
| B-Q8 | 离线数据覆盖元数据（`BucketContext.coverageEnd` 的真实来源） | Lead 指示：记录即可，B-1 按 `unknown` 处理；W1/集成阶段统一（R-B-02） | D/S16 + Lead |
| B-Q9 | 写后 `["stats"]` 失效策略与 `dataVersion` 生产方 | Lead 指示：记录即可，W1/集成阶段统一处理（R-B-04）；A §15 定 dataVersion 由数据层透传 | D/S16 + A + Lead |
| B-Q10 | I13 星期分布等无专用 shape 的呈现方式（用哪一图与尺寸组合） | **已实现（2026-10-27，B-2）**：按 A §15 结论用 7 桶模板轴（不新增 shape），`WeekdayBars` 提供 total/average 两口径；卡片尺寸组合仍待 C/Codex | 已实现；尺寸组合待 C/Codex |
| B-Q11 | 1.16.23 候选未合并期间是否允许改 `StatsPage.tsx` 等冲突文件 | **已解决（2026-10-27）**：Lead 指示严格只读，B-1 只做纯函数与图表输入层；等 1.16.23 发布后统一 rebase 再改页面 | 已解决（Lead） |
| B-Q12 | 分析区间上限：A 的 `makePeriod` 限制 `MAX_STATS_DAYS = 400`，与 I09（12/24/36 个月）、A01 同比、A12/A14 长样本冲突 | B-3 长区间可能被信封层拒绝；建议 S-01 增 `MAX_ANALYSIS_DAYS`（如 3660）或按分析类型给上限 | A + Lead（协议草案 Q-BA-12） |

---

## 8. 恢复步骤（上下文丢失时）

1. 读仓库 `AGENTS.md` → `docs/STATUS.md` → 索引 → 本文件。
2. 检查工作区 `git status --short`、`git log --oneline -5`，与 §6.2 核对；不一致立即停手报告 Lead。
3. 只在本分支工作；禁止触碰索引 §1.3 受保护工作区。
4. 向 `lead` 发送恢复报告（身份/状态/已完成/未决/下一步）。
