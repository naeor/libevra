# S17 · Agent B 任务文档：时间、趋势与周期分析

> 本文件是 **DS-S17-B-Time** 的唯一权威任务文档。所有长期有效的职责、接口、进度、问题与交接必须写入本文件，不得只存在于聊天上下文。
> 建立：2026-10-27（Lead 初始化）；维护者：Agent B 自己。
> 当前状态：**B-0～B-6 已完成；1.16.23 rebase 完成（新基线 `d4e4fd8`，零冲突、18/18 重放）；S-01 v2 B 侧提案已提交（`9d77b06`）并完成 draft 实现（`FxAggregate` 逐日/逐笔投影 + 36 月上限，待协议冻结后 W1 接入）；W1 已获所有者批准，**S0（数据接入与口径统一 + I06 每日支出趋势真实链路卡片）已完成**，下一步 S1 时间趋势接入；未 push**。
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
| 基线 | `d4e4fd8`（`release/1.16.23`，1.16.23 生产版；2026-10-27 由原基线 `486c603` rebase 迁入，备份 `backup/pre-1.16.23-20261027`；索引 B-1 已解除） |
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
- **已实现（B-3）**：`packages/shared/src/periodComparison.ts`
  - `computePeriodComparison(entries, request, options)`：`ComparisonKind = previous-period | month-over-month | year-over-year | month-to-date`；两侧收支 `currentMinor`/`previousMinor`/`differenceMinor`/`growth`/`complete` + `resolution`（观测窗口、天数、同长判定、上期裁剪、政策、闰日对齐记录）。
  - 增长率只给精确分子/分母（`GrowthResult`），`previous <= 0` 给 `unavailable` 原因；A05 默认 `same-day-index`，可选 `equal-length-window`；A03 闰日对齐写入 `leapDayFallbacks`。
  - `packages/shared/src/multiMonthComparison.ts`：`computeMultiMonthComparison`（自然月、跨年、完整性/可比性、只排完整月、`ranking`/`maxMonth`/`minMonth`）。
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
- 后续：移动平均/异常标注（B-4）；周期比较已于 B-3 落地（`PeriodComparisonBars`/`MonthComparisonChart`/`PeriodComparisonCard`）。

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
| B-3 周期比较（A01–A05 + CF-B04 分组柱/CF-B10 对比卡） | **完成（2026-10-27）** | 计算核心 `periodComparison.ts`（previous-period/mom/yoy/month-to-date 四种比较、精确增长率分子分母与不可用原因、A05 双窗口政策、闰日对齐记录）、`multiMonthComparison.ts`（自然月、完整性/可比性、跨年、只排完整月）；图表输入 `apps/web/src/lib/chart/comparisonChart.ts`；组件 `PeriodComparisonBars`/`MonthComparisonChart`/`PeriodComparisonCard`；未改页面、未接 S-01 信封 |
| I06–I16 / I19–I20 | **完成（B-1：I06–I10、I19–I20；B-2：I11–I16）** | 纯函数 + 图表输入层 + 组件；页面集成待 1.16.23 发布后 W1/W3 |
| A01–A05 | **完成（2026-10-27，B-3）** | 四种比较（上期/环比/同比/本月至今同期）+ 多个月份比较；页面集成待 1.16.23 发布后 W1/W3 |
| B-4 高级趋势/稳定性（A12–A14/A18–A20 + CF-B12/B13/B14/B15） | **完成（2026-10-27）** | 计算核心 `movingAverage.ts`（A13/A14 尾随平均，精确分数、连续日历日、窗口不足/未知不下假点）、`variability.ts`（A12 每日支出波动 + A20 收入稳定性，总体标准差/变异系数/带宽/极值日、样本阈值与显式排除计数）、`seasonal.ts`（A18 月度/季度比较，分类轴、`outsideSpan`/`unknown`/`in-progress` 不可比、36 月上限）、`anomaly.ts`（A19 MAD→IQR→分位退化链、阈值与参数可追溯、今天排除）；图表输入 `apps/web/src/lib/chart/advancedChart.ts`；组件 `MovingAverageChart`/`VolatilityBandChart`/`SeasonalComparisonChart`/`AnomalyMarkerChart`；未改页面、未接 S-01 信封 |
| A12–A14 / A18–A20 | **完成（2026-10-27，B-4）** | 对应规格：A12 每日支出波动、A13 七日移动平均、A14 三十日移动平均、A18 季节性消费比较、A19 支出异常高峰提示、A20 收入稳定性；页面集成待 1.16.23 发布后 W1/W3 |
| B-5 性质测试/边界矩阵/CF-B12–B15 适配/§37§44 验收对照 | **完成（2026-10-27）** | ①`properties.test.ts`（8 类性质）+ `performance.test.ts`（50k/10k 实测基线）；②`docs/specs/design/S17-B-时间边界矩阵.md`（T/M/C/D 四组边界→测试映射）；③`chartFamilies.ts`（CF-B01–B15 能力注册表）+ 测试；④`S17-B-验收对照-37-44.md`（24 项×§37/§44 证据，未完成项如实列出）；⑤`S17-B-跨Agent时间口径.md`（B-17，供 C 的 P14/P15）；⑥B-16 A12 极值日阈值参数化（2σ 显式参数） |
| B-6 1.16.23 rebase 冲突面 / W1 页面集成清单 / 候选影响面（只读预研，不改代码） | **完成（2026-10-27）** | 交付 `docs/specs/design/S17-B-B6-1.16.23-rebase与W1集成预研.md`：①1.16.23 已发布上线（`207a5ad`/`d4e4fd8`，无迁移保持 60）；②`merge-tree` 预演 rebase **零冲突**（唯一重叠 `docs/00-索引.md`，行区间分离），附步骤与验证清单；③W1 24 项→接入点/依赖/估 15–22 人日映射（原币先行 8–12 d）；④综合模式 FX 逐笔/逐日输出缺口 + `rangeMonths` 14→36 月限制（R-B6-2 高）；⑤只读核对 1.16.23 候选与我的 67 文件无代码交集，另报主工作区状态异常 |
| 1.16.23 rebase（新基线） | **完成（2026-10-27）** | 备份 `backup/pre-1.16.23-20261027`（本地，不 push）；`git rebase d4e4fd8` 18/18 提交重放**零冲突**（唯一重叠 `docs/00-索引.md` 自动合并：1.16.23 发布行 L7 + B-6 行 L113 并存）；rebase 后验证：shared **32 文件/521 用例**、web **162 文件/1467 用例**、`pnpm typecheck` 三包、`check:docs`、`check:status`（路由 75、代码版本 1.16.23、迁移 60）全绿；HEAD `e61d810` |
| S-01 v2 B 侧提案与 draft 实现（2026-10-27，Lead 验收通过） | **完成 / 已验收**（`9d77b06` 提案、`13428bd` draft 实现、`1f46664` 回填；Q-BP-1～5 已裁定 → 登记 **G-17**） | ①**G-17「FX 逐笔/逐日投影」**正式定义已写入提案文档 §16（形状/12 条不变量/默认值/兼容性），交 A 合并 v2；②`FxAggregate` 逐日/逐笔投影（`aggregateFxDetailed`/`aggregateFxDetailedAsync`，additive，对齐 R-B6-2）与 `FX_MAX_RANGE_MONTHS=36` + `fxRangeMonths` 参数化均已实现（12 正确性用例 + 3 性能用例；web `fxView` 委托、15–36 月不再抛错）；③裁定：`detail` 命名批准、`maxEntries=50,000` 仅保护默认（明细视图必须显式传）、G-17 登记（G-16 归 C）、不与 `maxAnalysisDays=400` 强行对齐（不同轴并列登记）、`daily` 恒输出/`entries` 可选、性能结论（异步批次+`yieldControl`、不在渲染帧聚合）进 v2；④性能基线 `S17-B-性能基线.md` §6；协议草案 §15.1 实现状态；**冻结前不接页面** |
| S-01 参与评审 | 进行中（时间扩展已与 A 对齐，B-5 已补 draft 映射，待评审冻结） | A §15 已答复 Q-BA-1/2/3/4/7/8；Q-BA-12（区间上限）已由 A 登记进 S-01 §17（月键上限 36、日窗口由调用方传 `maxAnalysisDays` 默认 400、越界协议层拒绝不截断，字段名/展示待所有者确认）；B-5 已向 Lead 提交 S-01 v2 交叉评审意见（B 七形状/§4 统一规则/B-16/B-17/归属/G 清单），协议仍 `s01-draft` 未冻结 |
| W1 原币 24 项接入切分方案（2026-10-27） | **方案已完成（纯文档，待所有者批准后实施）** | 交付 `docs/specs/design/S17-B-W1-原币24项接入切分方案.md`：S0 数据/URL 层 → S1 趋势区 → S2 类别区 → S3 比较区 → S4 新增分析区 → S6 集成测试，S5 综合模式另列（依赖 G-17 冻结）；逐项列出 shared 函数/图表组件/页面只读替换点/测试计划/工作量与风险，明确“待所有者批准后实施”；§5 给出 `StatsPage.tsx`/`FxStats.tsx` 只读替换点行号；§7 列待批事项（W1 放行、S-01 信封、G-17 冻结、14→36 月页面行为、R-B-02/04） |
| W1 时间口径核对 | **S0 完成（2026-10-27）** | 偏差/口径集中到 `apps/web/src/lib/analysisData.ts`：业务日期半开区间、400 日上限（S-01 v2 §17）、设备本地 `today`、`transfer`/软删除/未知记录剔除、CSV 多币种不合并；coverage 设备账本口径（W1 原币）与 `unknown`（引擎默认）双策略，见 §7 B-Q17；真实数据 SQL 交叉核验已做（见 §6.2）。下一步 S1 趋势区接入 |
| W3 时间图表/卡片 | 未开始 | 依赖 S-01/S-02/S-03 |

---

## 6. 开发交接记录

### 6.1 汇报格式（向 Lead）

`状态 / 已完成 / 修改文件 / 相关提交 / 测试命令与结果 / 接口变化 / 已知问题 / 下一步`；同时在 §6.2 记录。

### 6.2 记录

| 日期 | 内容 | 修改文件 | 提交 | 测试 | 接口变化 | 已知问题 | 下一步 |
|---|---|---|---|---|---|---|---|
| 2026-10-27 | 工作区/分支/任务文档初始化（Lead 创建）；未开发 | 本文件 | `ed44758`（初始化提交） | 未运行 | 无 | 见 §7 | 等待所有者第二轮需求；先评审 A 的 S-01 草案 |
| 2026-10-27 | 收到所有者完整开发规格（24 项、48 节、图表家族 CF-B01–B15、B-0～B-5 顺序、风险分级审核、永久文档要求）；已逐字落盘并开始 B-0 | 本文件 + 规格文件 | `bb84e6e` | 尚未运行 | 无（尚未定义接口） | 基线仍为 486c603；W1 待 1.16.23 | 开始 B-0：时间合同核查 + 时间桶/结果协议草案 + 与 A 对齐 S-01 |
| 2026-10-27 | **B-0 完成**：①时间合同实现（半开区间/周一起自然周/ISO 周键/自然月/桶枚举/完整性状态）；②20 项时间与财务数据合同核查表；③S-01 时间扩展协议草案（7 形状 + 11 个对齐问题）；④未开始任何业务分析（24 项仍 0 实现） | `packages/shared/src/timeCalendar.ts`、`timeCalendar.test.ts`、`packages/shared/src/index.ts`、`apps/web/src/i18n/sharedMessages*.ts`、核查表、协议草案、本文件、`docs/00-索引.md` | `b23311c`（本地；未 push） | `pnpm --filter @libellum/shared test` 395/395；web `vitest run` 152 文件/1385 用例全过；`pnpm typecheck` 三包全过；`pnpm check:docs` 通过（195 文/970 链接）；API 集成 611/612（唯一失败为本地库迁移落后 2 个版本的 `profile` 头像用例，与本分支改动无关，已在报告中说明） | 新增公共导出 `timeCalendar`（v1，未冻结）及 `TimeBucket/BucketState/TimeSpan` 等类型；S-01 时间形状仅为草案（A 未合并） | R-B-02 离线覆盖元数据、R-B-04 stats 失效/dataVersion；Q-BA-1/2/3/4/7/8 待 A | 向 Lead 首份 B-0 报告；A 对齐后进入 B-1（I06–I10、I19–I20 + 折线/面积/柱/Sparkline/累计） |
| 2026-10-27 | B-0 验证结果与索引回填（`docs/00-索引.md` 增加 4 条 S17 文档入口） | 本文件、`docs/00-索引.md` | `d2166ee` | 同上 | 无 | 无 | 等待 A 对协议草案的回复；准备 B-1 开发清单 |
| 2026-10-27 | **B-1 完成**：①shared 计算核心 `timeSeries.ts`（按业务日期分桶：day/week/month × 支出/收入/笔数，精确 minor 金额，unknown/future/in-progress 三态，累计 `accumulateSeries` 未知向后传播、零变动平台不断线）；②图表只读适配层 `timeSeriesChart.ts`（柱/线/面积模型、空态、Y 轴 nice domain、全部为 0 判定，不反写权威值）；③组件 `SeriesTrendChart`/`Sparkline`/`CumulativeTrendChart`（复用 `ChartFrame/Axis/Legend/theme/scales`，44px 触摸目标、键盘 Arrow/Home/End、24px 触控高度、缺数据断线不得画 0）；④i18n 登记（`sharedMessages` 增加 `timeSeries.ts` 归类与 2 句译文）；⑤`bucketToInclusive`（A §15.1(4) 定名）接入 | `packages/shared/src/timeSeries.ts`、`timeSeries.test.ts`、`apps/web/src/lib/chart/timeSeriesChart.ts`、`timeSeriesChart.test.ts`、`apps/web/src/components/charts/SeriesTrendChart.tsx`、`Sparkline.tsx`、`CumulativeTrendChart.tsx`、`timeSeriesCharts.test.tsx`、`apps/web/src/lib/chart/format.ts`（`weekBucketLabel`）、`apps/web/src/i18n/sharedMessages*.ts`、`packages/shared/src/index.ts`、本文件、协议草案 | `f4da5f8`（本地；未 push） | `pnpm --filter @libellum/shared test`：20 文件/414 用例全过（含 `timeCalendar` 19、`timeSeries` 18）；web `vitest run`：154 文件/1405 用例全过（新增 27）；`pnpm --filter @libellum/shared typecheck` 0；`pnpm --filter @libellum/web typecheck` 0；`pnpm check:docs` 通过 | 新增公共导出 `timeSeries`（v1，未冻结）与 `bucketToInclusive`/`InclusivePeriod`；新增 web 图表适配层（非 S-01 信封）；未新增 HTTP/API 接口 | 已知：S-01 信封层 `analysis/time.ts` 与 `SourceDescriptor.bucket` 待协议冻结/合并后补；`MAX_STATS_DAYS=400` 与 I09 36 个月区间冲突待 A/Lead 登记（协议草案 Q-BA-12） | 跑全量 shared+web 测试后提交；发 B-1 结构化报告 Lead；准备 B-2（I11–I16） |
| 2026-10-27 | **S-01 时间扩展对齐收敛**：A §15（`655ea14`/`5faaac1`）逐条答复 Q-BA-1/2/3/4/7/8；B 按结论更新协议草案 §7/§4.3/§8/§9（7 形状登记进 union、`bucketToInclusive`、`SourceDescriptor.bucket?`、dataVersion 由数据层透传、`timeGranularity?`=A-Q21、R-09 coverageEnd 展示元数据），并新增待评审项 Q-BA-12（分析区间上限） | `docs/specs/product/s17-agents/S17-Agent-B-S01-时间扩展协议草案.md`、本文件 | `f4da5f8`（本地；未 push） | 文档变更，无需单测 | 协议草案状态由“待 A 回复”改为“已对齐（待评审冻结）”；未冻结仍为 `s01-draft` | S-01 冻结由 Lead/Claude/所有者评审 | B-2 按对齐结论实现；协议冻结后补 `analysis/time.ts` 信封 |
| 2026-10-27 | **B-2 完成**：①`flowSeries` 收支成对桶（差额 `differenceMinor` 仅两侧已知时给出）；②`categorySeries` 分类×时间（Top N + 其他、未知桶不补 0）；③`category shares` 桶内占比（分母=桶权威合计、零总额/未知不给占比）；④`weekdayPattern` 周一起 ISO 1..7 固定顺序、精确分数平均；⑤`calendarHeatmap` 日格子（分位 0–4、未知/未来不着色）；⑥`categoryChart.ts` 图表输入层（不重算金额）；⑦组件 `IncomeExpenseBars`/`CategoryStackedBars`/`CategoryShareBands`/`WeekdayBars`/`CalendarHeatmapGrid`；⑧协议草案新增 §11 映射与语义锁定 | `packages/shared/src/{categorySeries,weekdayPattern,calendarHeatmap}.ts`、`timeSeries.ts`（扩展）、`packages/shared/src/index.ts`、对应测试 3 个、`apps/web/src/lib/chart/categoryChart.ts`（+测试）、组件 5 个 + `categoryCharts.test.tsx`、本文件、协议草案 | `888b62b`（本地；未 push） | `pnpm --filter @libellum/shared test`：**444/444** 全过（23 文件，含新增 30 余用例）；web `vitest run`：**156 文件/1422 用例**全过（新增 12 模型 + 5 组件）；`pnpm --filter @libellum/web typecheck` 0；`sharedMessages` 归类测试 7/7；图表 i18n 测试 3/3；`pnpm check:docs` 通过 | 新增公共导出 `categorySeries`/`weekdayPattern`/`calendarHeatmap`/`flowSeries`（均为 v1，未冻结）；未新增 HTTP/API；S-01 信封仍未接 | 图表完整 hover/touch 读数、44px 触摸与页面集成随 W3；S-01 冻结后补 `analysis/time.ts` 与 `SourceDescriptor.bucket` | 发 B-2 结构化报告 Lead；B-3（A01–A05）随后 |
| 2026-10-27 | **B-3 完成**（A01–A05 周期比较族）：①`periodComparison.ts` 四种比较（previous-period/mom/yoy/month-to-date）共用 resolver；增长率只给精确分子/分母，`previous<=0` 给不可用原因；A05 默认 `same-day-index`、可选 `equal-length-window` 且 `policyId` 入结果；A03 闰日对齐记 `leapDayFallbacks`；未完成自然期的上期取同期窗口；覆盖未知时金额/差额/增长率一律 null。②`multiMonthComparison.ts`：自然月键/跨年/每选中月显式/未知与未来不可比/`ranking` 只排完整月。③图表输入 `comparisonChart.ts`（未知侧不画柱、两侧共用 y 轴、不完整月不填色）+ 组件 `PeriodComparisonBars`/`MonthComparisonChart`/`PeriodComparisonCard`。④协议草案 §12 映射与 8 条锁定语义。⑤未改任何页面、未接 S-01 信封 | `packages/shared/src/{periodComparison,multiMonthComparison}.ts`（+测试 2 个）、`apps/web/src/lib/chart/comparisonChart.ts`（+测试）、组件 3 个 + `comparisonCharts.test.tsx`、`apps/web/src/i18n/sharedMessages*.ts`、`packages/shared/src/index.ts`、本文件、协议草案 | `8bd14dd`（本地；未 push） | shared：26 文件/**476 用例全过**（B-3 新增 18）；web：**158 文件/1438 用例全过**（新增 16）；shared/web `typecheck` 均 0；`check:docs`、`check:status` 通过 | 新增公共导出 `periodComparison`/`multiMonthComparison`（v1，未冻结）；新增 web 输入层 `comparisonChart.ts`（非 S-01 信封）；未新增 HTTP/API | A03 闰日对齐与 A05 默认政策已实现并登记 B-Q13/B-Q14 待所有者/A 确认；S-01 信封待冻结 | 发 B-3 结构化报告 Lead；B-4（A12/A13/A14/A18/A19/A20）待 Lead 批准 |
| 2026-10-27 | **B-4 完成**（A12–A14、A18–A20 高级趋势与稳定性族）：①`movingAverage.ts`（A13/A14 尾随 7/30 日平均：连续日历日校验、精确分数 `numeratorMinor/denominatorDays`、窗口含未知/未来即 `window-incomplete`、不足窗口 `insufficient-history`，不插值不按 0）；②`variability.ts`（A12 每日支出波动 + A20 收入稳定性：总体标准差/变异系数/均值±标准差带/极值日/零收入月数，`complete` 桶才入样并显式给三类排除计数，`sufficientSample`/`judgedState` 样本不足明示）；③`seasonal.ts`（A18 月度/季度：自然年 1–12 月分类轴、`outsideSpan`/`unknown`/`in-progress` 不可比、跨年保留年份、月份上限默认 36 越界抛错）；④`anomaly.ts`（A19：MAD→IQR→zero-dispersion-quantile 退化链，`method`/`parameters`/`thresholdScaledMinor` 可追溯，今天排除、样本不足不硬报异常）；⑤图表输入 `advancedChart.ts`（4 个模型：平均线/波动带/季节多线/异常标记，只做像素映射不重算）；⑥组件 `MovingAverageChart`/`VolatilityBandChart`/`SeasonalComparisonChart`/`AnomalyMarkerChart`；⑦协议草案新增 §13 映射与 8 条锁定语义 | `packages/shared/src/{movingAverage,variability,seasonal,anomaly}.ts`（+测试 4 个）、`packages/shared/src/index.ts`、`apps/web/src/lib/chart/advancedChart.ts`（+测试）、组件 4 个 + `advancedCharts.test.tsx`、`apps/web/src/i18n/sharedMessages.test.ts`、本文件、协议草案 | `07a4dc1`（本地；未 push） | shared：30 文件/**508 用例全过**（B-4 新增 32）；web：**160 文件/1453 用例全过**（新增 15）；`shared`/`web` `typecheck` 均 0；`pnpm check:docs` 通过 | 新增公共导出 `movingAverage`/`variability`/`seasonal`/`anomaly`（均为 v1，未冻结）；新增 web 输入层 `advancedChart.ts`（非 S-01 信封）；未新增 HTTP/API | 图表完整 hover/touch 读数与 A20 摘要卡随 W3；S-01 信封待冻结；A12 的“极值日”口径（>2σ）已实现待所有者确认 | 发 B-4 结构化报告 Lead；B-5（性质测试、时间边界矩阵、验收对照）待 Lead 批准 |
| 2026-10-27 | **B-5 完成**（性质测试/时间边界矩阵/CF-B12–B15 适配/§37§44 验收对照，B-5 不新增业务形状）：①`properties.test.ts` 8 类性质（分组守恒/来源一致/桶分区互斥覆盖/累计一致/比较一致/移动平均一致/确定性/分类守恒）；②`performance.test.ts` 50k+10k 实测基线（303.3ms/46.9ms，2,922 日桶），配套 `S17-B-性能基线.md`；③`timeCalendar`/`timeSeries` 边界与五态证据矩阵 `S17-B-时间边界矩阵.md`（T/M/C/D 四组）；④图表家族能力注册表 `chartFamilies.ts`（CF-B01–CF-B15 的 resultShape/requires/states/minSize/legend/supportsNegative 显式化，含 B-17 归属建议）；⑤`S17-B-验收对照-37-44.md`（24 项×§37/§44，未完成项如实列：W1/W3 页面集成、S-01 冻结、B-16 默认值、R-B-02/04、API 测试库迁移）；⑥`S17-B-跨Agent时间口径.md`（桶键/五态/闰年/周一起始 + P14/P15 对齐点）；⑦B-16：A12 极值日阈值参数化为 `DEFAULT_EXTREME_SIGMA=2`/`EXTREME_SIGMA_SCALE=100` 并入结果；⑧修正 `categorySeries.ts` `totals` 未含 `other` 的守恒缺陷；⑨S-01 v2 草案交叉评审意见已提交 Lead（B 七形状/§4 规则/B-16/B-17 归属/G 清单） | `packages/shared/src/{variability.ts,variability.test.ts,categorySeries.ts,properties.test.ts,performance.test.ts}`、`apps/web/src/lib/chart/chartFamilies.ts`（+测试）、`docs/specs/design/S17-B-时间边界矩阵.md`、`S17-B-验收对照-37-44.md`、`S17-B-跨Agent时间口径.md`、`S17-B-性能基线.md`、协议草案 §14、本文件、`docs/00-索引.md` | `25b812f`（本地提交，未 push） | shared：32 文件/**521 用例全过**（新增 properties 8 + performance 2 + variability B-16 增量）；shared `typecheck` 0；web：161 文件/**1462 用例全过**、`typecheck` 0；`check:docs` exit 0（197 链接，最多 6 个月段与 CSV 导出说明均未改）；`chartFamilies` 专项 9 用例全过 | 无新增 shared 业务形状/导出变更（仅 `chartFamilies.ts` 为 web 图表层新模块 + 对 `categorySeries` 的守恒修正；`index.ts` 导出不重排） | B-5 不碰 StatsPage/FxStats/prisma/迁移/端点 limit；S-01 仍 `s01-draft`；B-16/A05 默认值待所有者裁定；R-B-02/R-B-04 按 Lead 指示仅记录 | 发 B-5 结构化报告 Lead；等待 B-6 / 1.16.23 rebase / S-01 v2 冻结后接入 |
| 2026-10-27 | **B-6 完成**（只读预研，不改代码/不 rebase/不 push）：①1.16.23 发布事实核对（生产已上线 `207a5ad`，发布记录 `d4e4fd8`，无迁移保持 60，未推 GitHub）；②rebase 冲突面清单：`release/1.16.23` 相对基线仅 16 文件，与我的 67 文件无代码交集，唯一重叠 `docs/00-索引.md` 行区间分离，`git merge-tree --write-tree` 预演 exit 0（tree `124e796`），附 rebase 步骤+验证清单+风险分级；③W1 集成清单：1.16.23 后 `StatsPage.tsx`（349 行，URL 状态 + 月份选择器）与 `FxStats.tsx`（57 行）接入点、24 项能力→组件/落点/依赖/工作量（合计 15–22 人日，原币先行 8–12 d）映射、URL 参数扩展建议、详情页来源跳转可复用点；④只读核对 1.16.23 候选对 B 层影响：仅 `version.ts` 变更、无 shared 契约/我的文件被覆盖；⑤上报 3 个决策请求（批准 rebase / FX 逐笔输出扩展与 14→36 月限制 / W1 切片与 S-01 v2 冻结时点）与 R-B6-1～R-B6-6 | `docs/specs/design/S17-B-B6-1.16.23-rebase与W1集成预研.md`（新增）、本文件、`docs/00-索引.md` | `e35fe7b`（本地；不 push） | 文档变更无单测；`pnpm check:docs`/`check-status` 复核（见提交报告） | 无接口/代码变化；设计文档新增 | R-B6-2 综合模式无逐日/逐笔 FX 输出（高）、R-B6-3 14 vs 36 月限制、R-B6-5 主工作区状态异常（`335da77` + 已发布候选副本） | 2026-10-27 | **rebase 完成**：按 Lead 批准以 `release/1.16.23`（`d4e4fd8`）为新基线；备份分支 `backup/pre-1.16.23-20261027`（本地，不 push）；18 个提交重放**零冲突**，唯一重叠 `docs/00-索引.md` 自动合并；rebase 后全量验证全绿 | 本文件 | `07a0a10`（本地；不 push） | shared **32 文件/521 用例**全过；web **162 文件/1467 用例**全过；`pnpm typecheck` 三包 exit 0；`check:docs` exit 0；`check:status` 通过（路由 75、代码版本 1.16.23、迁移 60） | 无（代码未改，仅提交链重放；版本号随 1.16.23 变为 1.16.23） | 无冲突；主工作区 R-B6-5 由 Lead 汇总处理 | 发 rebase 报告 Lead；等 W1 启动切分；随后 `FxAggregate` 可选扩展 + `rangeMonths` 14→≤36 提案（②批准） |
| 2026-10-27 | **S-01 v2 B 侧提案提交**（additive，draft）：①**B-S01v2-01** 综合模式 `FxAggregate` 逐日/逐笔投影——`FxConvertedEntry`/`FxDetailOptions`/`FxAggregateDetail`/`FxDetailedAggregate` + `aggregateFxDetailed`/`aggregateFxDetailedAsync`（`detail.daily`、可选 `detail.entries`，逐笔与 `convertFx` 同源、daily=Σtotals 守恒、失败笔与成功笔互斥、超限抛 `fx_detail_limit` 不截断、异步取消不返回部分结果），现有 `aggregateFx`/`aggregateFxAsync`/`FxAggregate` 零改动；②**B-S01v2-02** 月键上限落位——`FX_MAX_RANGE_MONTHS = 36` + `fxRangeMonths(from,to,maxMonths)`，web `rangeMonths` 14→36 参数化（draft，W1 前不改页面）；③性能验证计划（54,000 笔/36 月基准、`FX_PERF=1` 门控、单批 ≤50ms、daily 模式差异 ≤5%）与兼容性影响表；④开放问题 Q-BP-1～5；⑤协议草案新增 §15 指针 | 提案文档（新增）、协议草案 §15、本文件 | `9d77b06` | 文档变更，无需单测；`check:docs` 随后验证 | 无接口变化（提案）；提案内新 API 待实现标 draft | 唯一行为变化提案：web `rangeMonths` 15–36 月不再抛错（draft，W1 接入时生效）；Q-BP-5 默认值待 A/Lead 确认 | 提案提交后实现 P-FX-1/P-FX-2 并标注 draft；等 A 汇总进 v2；W1 启动切分后接入 |
| 2026-10-27 | **S-01 v2 B 侧 draft 实现**（additive；待协议冻结后 W1 接入）：①`fx.ts` 增 `FX_MAX_RANGE_MONTHS=36`/`FX_MAX_DETAIL_ENTRIES=50_000`、`FxConvertedEntry`/`FxDetailOptions`/`FxAggregateDetail`/`FxDetailedAggregate`、`aggregateFxDetailed`/`aggregateFxDetailedAsync`（`daily` 恒输出=Σ成功笔、`entries` 可选且与 `convertFx` 同源、失败笔不投影、超限 `fx_detail_limit` 不截断、异步取消不返回部分结果）；②`fxRangeMonths`（含首尾月/跨年连续/非法日期 `fx_range_invalid`/超限 `fx_range_too_long` 不截断）；③web `fxView.rangeMonths` 委托（14→36 参数化，页面零改动）；④测试 `fxDetail.test.ts` 12、`fxPerformance.test.ts` 3（`FX_PERF=1` 门控）、web `fxView.test.tsx` 8；⑤协议草案 §15.1 实现状态 + `S17-B-性能基线.md` §6 实测数据 | `packages/shared/src/fx.ts`、`fxDetail.test.ts`、`fxPerformance.test.ts`、`apps/web/src/lib/fxView.ts`、`packages/shared/src/index.ts`、协议草案 §15.1、性能基线 §6、本文件 | `13428bd` | shared：**533 passed / 3 skipped（性能门控）**、typecheck 0；web `fxView` 8/8、`typecheck` 0；`check:docs`/`check:status` 见报告 | 新增 draft 导出（`aggregateFxDetailed*`、`fxRangeMonths`、`FX_MAX_*` 与 4 类型）；既有 `aggregateFx`/`aggregateFxAsync`/`FxAggregate` 行为与形状不变；`rangeMonths` 15–36 月不再抛错（draft，W1 生效） | 性能实测：1M daily-only 13.6s、200k entries 2.7s、10k×36 月 0.54s → 逐笔仅详情/导出视图 + `maxEntries`，200k+ 走异步批次；Q-BP-1～5 待 A/Lead；冻结前不接页面 | 发该实现结构化 B 报告 Lead；等 A 汇总进 S-01 v2；W1 启动切分后接入 |
| 2026-10-27 | **G-17 正式定义 + W1 原币 24 项接入切分方案（纯文档）**：①按 Lead 裁定把 G-17「FX 逐笔/逐日投影」正式定义（形状/12 条不变量 IV-G17-01～12/默认值表/兼容性与冻结规则）写入 S-01 v2 提案文档 §16，交 A 合并进 v2；②新增 `S17-B-W1-原币24项接入切分方案.md`（S0 数据/URL 层、S1 趋势区、S2 类别区、S3 比较区、S4 新增分析区、S6 集成测试、S5 综合模式另列），逐项列 shared 函数/图表组件/页面只读替换点/测试计划/工作量/风险，标注“待所有者批准后实施”；③任务文档 §5/§6.2/§6.4/§7 与本提交同步回填。**未改任何代码/页面** | 提案文档 §16、`docs/specs/design/S17-B-W1-原币24项接入切分方案.md`（新增）、协议草案 §15.2、本文件、`docs/00-索引.md` | `f3bd4d6`（本地；不 push） | 文档变更：`pnpm check:docs` exit 0、`check:status` 通过（路由 75/版本 1.16.23/迁移 60） | 无代码/接口变化 | W1 未放行、S-01 v2 未冻结；`StatsPage.tsx`/`FxStats.tsx` 仍只读 | 等 Lead 转 A 合并 G-17；等所有者批准 W1 后按 S1→S4 实施；S5 待 G-17 冻结 |
| 2026-10-27 | **D-05 修订（G-17 §16，按 Lead 裁定）**：删除 §16.2 `FxConvertedEntry.kind` 的 `transfer` 预留值，改为 `"income" \| "expense"`（继承 `TransactionKind`/`TRANSACTION_KINDS`，与 S-01 核心一致）；新增 IV-G17-13「交易类型域」（只允许两种 kind，其它值按既有 `invalid_input` 处理）；§16.5 增「未来扩展」注记——转账不在 S-01 v2/本组合同内，若未来引入须另立合同并经所有者批准，不得作为联合成员预留。W1 切分方案未改、未接页面、未改代码 | 提案文档 §16（kind/IV-G17-13/§16.5）、本文件 | `7405194`（docs；D-05：移除 transfer 预留值） | 无代码变更；`pnpm check:docs` 复核 | 无接口变化（`fx.ts` 实现本就仅 income/expense，与修订后一致） | 无 | 把新提交号 + §16 位置报 Lead，转 A 更新 v2 §13 来源引用；W1 继续等所有者放行 |
| 2026-10-27 | **W1 获批 + S-01 v2 冲突检查意见（B 侧）**：①所有者正式批准 W1（S0 数据/URL 层 → S1 趋势 → S2 类别 → S3 比较 → S4 新增分析；真实数据链路优先，先出一张可验收真实卡片；专用集成 worktree `s17/integration`，版本 1.17.1，不 push/不合并主工作区）；②按 Lead 要求只读 A 的 S-01 v2 定稿候选（A `3c5b59a`，r3，未冻结），产出 B 侧冲突检查意见：**🔴 8 项需 A 修订/裁定**（B-V2-01 §3.2 表 `total` “只对 complete 求和”与 §4.2 矛盾；B-V2-02 §3.2 `calendar-heatmap` 括注把 I12 错标为“支出分类构成”（I12=每日支出波动、I14=分类构成）；B-V2-03 §3.4 `calendar` 行仍要求对齐“B I12 日历”；B-V2-04 桶级五态→9 态映射丢失 in-progress/unknown 信息；B-V2-05 `metric` 是否允许 `count`；B-V2-06 `SourceDescriptor.query.kind` 收窄后无 `stats`/`transactions` 映射；B-V2-07 桶 `span` 未明确“裁剪后”语义；B-V2-08 客户端原币路径 `dataVersion` 无来源）、**🟡 5 项澄清**（字段名以 B 草案 §3.7 为准/method 取值/§12 常量补登（周一起最小样本 28、异常 3.5σ·1.5IQR、季节 2 年、热力 4 级）/rangeMonths 实现状态/quarter-year 粒度）、**✅ 8 组核对通过**（G-17 §13 与 D-05、B-16/B-17、A05、闰日、bucketToInclusive、五态方向、七形状命名、axis 语义）、**🟢 5 项 B-W1 待办**（maxAnalysisDays 参数化+analysisLimit、36 常量收敛、五态透传、dataVersion 方案、日历派生字段）；③未改任何代码/页面 | 新增 `docs/specs/design/S17-B-S01-v2冲突检查意见.md`、`docs/00-索引.md`、本文件 | 本提交（docs；不 push） | 文档变更；`pnpm check:docs` 复核 | 无代码/接口改动 | 集成 worktree 未就绪；S0 数据层未开工；A 对 r4 修订未回 | 发 Lead 转 A；随后按 S0→S4 推进 W1，先做真实数据链路最小卡片 |

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
| 周期比较计算核心（B-3） | `packages/shared/src/periodComparison.ts` | `PERIOD_COMPARISON_VERSION = "s17-b-period-comparison-v1"`；`computePeriodComparison` 四种 `ComparisonKind` 共用 resolver；`GrowthResult` 只给精确分子/分母（`previous <= 0` 给 `unavailable` 原因）；A05 `same-day-index`（默认）/`equal-length-window` 政策与 `policyId`；A03 `leapDayFallbacks`；`resolution` 记录观测窗口/天数/同长/裁剪 |
| 多月份比较计算核心（B-3） | `packages/shared/src/multiMonthComparison.ts` | `MULTI_MONTH_COMPARISON_VERSION = "s17-b-multi-month-comparison-v1"`；`computeMultiMonthComparison`：自然月（`YYYY-MM` 键、保留年份）、跨年、每选中月显式、未知/未来不可比、`ranking` 只含完整月、`maxMonth`/`minMonth` |
| 周期比较测试（B-3） | `packages/shared/src/periodComparison.test.ts`、`multiMonthComparison.test.ts` | 10 + 8 用例：四种比较的窗口推导/增长率边界（previous 为零/负/两侧为零）/A05 裁剪与加长窗口/闰日对齐/多月份完整性、跨年、排序与未知月 |
| 比较图表输入层（B-3） | `apps/web/src/lib/chart/comparisonChart.ts` | `buildComparisonBarsModel`/`buildMonthComparisonModel`/`comparisonBarRect`/`monthBarRect`：未知侧不画柱（不是 0 高柱）、两侧共用 y 轴（含 0）、不完整月不填色；`comparisonChart.test.ts` 9 用例 |
| 比较图表组件（B-3） | `apps/web/src/components/charts/PeriodComparisonBars.tsx`、`MonthComparisonChart.tsx`、`PeriodComparisonCard.tsx` | 复用 `ChartFrame/Axis/theme`；文案/数值格式全部 props 传入（组件不产中文）；`comparisonCharts.test.tsx` 7 用例 |
| B-3 协议映射与语义锁定 | 协议草案 §12 | A01–A05 → S-01 形状映射；四类比较不混名、增长率精确分子分母、A05 双窗口政策、A03 闰日对齐、未完成期上期取同期、覆盖未知不算零、A04 月份显式性 |
| 移动平均计算核心（B-4） | `packages/shared/src/movingAverage.ts` | `MOVING_AVERAGE_VERSION = "s17-b-moving-average-v1"`；`computeTrailingMovingAverage`（A13/A14，窗口 7/30 日历日、连续性校验、精确分数平均 + `averageScaledMinor` 展示值、`gapReason` 二态、`gapPolicy = "require-complete-window"`）、`movingAverageSeries`（原始+平均成对序列） |
| 波动性/收入稳定性计算核心（B-4） | `packages/shared/src/variability.ts` | `VARIABILITY_VERSION = "s17-b-variability-v1"`；`computeDailyExpenseVariability`（A12：均值精确分数、总体标准差、变异系数、均值±标准差带、min/max/极值日、样本阈值 7 天）与 `computeIncomeStability`（A20：月度收入、零收入月数、`judgedState` 样本不足明示、最小 3 月）共用 `AmountSummary` |
| 季节性比较计算核心（B-4） | `packages/shared/src/seasonal.ts` | `SEASONAL_COMPARISON_VERSION = "s17-b-seasonal-comparison-v1"`；`computeSeasonalComparison`（A18：自然年 1–12 月/季度分类轴、`outsideSpan` 与 `unknown` 与 `in-progress` 均不可比、跨年保留年份、月份上限默认 36 越界抛错、`descriptiveOnly`） |
| 异常检测计算核心（B-4） | `packages/shared/src/anomaly.ts` | `ANOMALY_VERSION = "s17-b-anomaly-v1"`；`detectDailyExpenseAnomalies`（A19：MAD→IQR→zero-dispersion-quantile 退化链、`parameters` 与 `thresholdScaledMinor` 可追溯、今天 `in-progress` 排除、样本不足 `marks = []`）；`anomalyThresholdReference` |
| B-4 测试 | `packages/shared/src/{movingAverage,variability,seasonal,anomaly}.test.ts` | 32 个用例：窗口不足/含未知/连续日校验、精确分数与缩放值、总体标准差与带状、零收入与样本阈值、季节性跨年与不可比、MAD/IQR/分位退化与今天排除、阈值可追溯 |
| 高级图表输入层（B-4） | `apps/web/src/lib/chart/advancedChart.ts` | `buildMovingAverageModel`/`buildVolatilityModel`/`buildSeasonalModel`/`buildAnomalyModel`：只做像素映射（平均线/均值线/带宽/12 月槽位/异常标记），未知不画、0 不代替、不重算统计；`advancedChart.test.ts` 10 用例 |
| 高级图表组件（B-4） | `apps/web/src/components/charts/MovingAverageChart.tsx`、`VolatilityBandChart.tsx`、`SeasonalComparisonChart.tsx`、`AnomalyMarkerChart.tsx` | 复用 `ChartFrame/Axis/theme/scales/geometry`；文案/数值格式全部 props 传入（组件不产中文）；`advancedCharts.test.tsx` 5 用例（含 notice 空态与英文无 CJK） |
| B-4 协议映射与语义锁定 | 协议草案 §13 | A12–A14/A18–A20 → S-01 形状映射；未知与未来不入样、今天排除、精确分数、连续日历日、分类轴不可比、阈值可追溯、A20 样本不足明示 |
| B-5 性质测试（§37） | `packages/shared/src/properties.test.ts` | 8 类性质：分组守恒、来源一致、桶分区互斥且覆盖、累计一致、比较一致、移动平均一致、确定性、分类合计守恒（B-5 修正 `categorySeries` 的 `totals` 含 `other`，使 3141 条分类合计=总额） |
| B-5 性能基线（§36.12） | `packages/shared/src/performance.test.ts`、`docs/specs/design/S17-B-性能基线.md` | 50k 条：日序列+累计+7 日平均 303.3ms；10k 条：46.9ms；2,922 日桶；断言仅 5s 上限，真实数字记录于文档 |
| B-5 时间边界矩阵 | `docs/specs/design/S17-B-时间边界矩阵.md` | 日历/周期（T1–T10）、五态、金额（M1–M5）、比较对齐（C1–C6）、区间上限、确定性（D1–D3）逐条映射到测试 |
| B-5 图表家族注册表 | `apps/web/src/lib/chart/chartFamilies.ts`（+`chartFamilies.test.ts`） | CF-B01–CF-B15 的 resultShape/requires/states/minSize/needsLegend/supportsNegative/supportsMultiSeries 显式声明；`chartFamily`/`familiesForShape`/`familiesFittingBox`/`assertFamilyShape`；B-5 适配 CF-B12–B15 归属显式化 |
| B-5 验收对照（§37/§44） | `docs/specs/design/S17-B-验收对照-37-44.md` | 24 项能力×实现/测试/图表家族；§44 的 17 条验收条件逐条标注完成/部分/外部依赖 |
| B-5 跨 Agent 口径（B-17） | `docs/specs/design/S17-B-跨Agent时间口径.md` | 桶键格式（日/ISO 周/月/年）、五态、闰年/周一起始、P14/P15 对齐点、对外 API 清单；供 C 直接复用 |
| B-5 协议映射与语义锁定 | 协议草案 §14 | B-5 不新增形状；性质测试=协议回归、家族声明不引入新形状、B-16 参数化、B-17 唯一实现归属建议、区间上限调用方契约、不冻结 |
| B-6 rebase/W1 预研 | `docs/specs/design/S17-B-B6-1.16.23-rebase与W1集成预研.md` | 1.16.23 发布事实（`207a5ad`/`d4e4fd8`）；rebase 冲突面清单与 0 冲突预演（tree `124e796`）+ 步骤/验证/风险分级；W1 24 项接入点、依赖、工作量（15–22 人日）、URL 状态扩展、详情页来源跳转；综合模式 FX 扩展提案与 14→36 月限制；R-B6-1～R-B6-6 与三条决策请求 |

| S-01 v2 B 侧提案（draft） | `docs/specs/product/s17-agents/S17-Agent-B-S01-v2提案-汇率逐笔扩展与月键上限.md` | `B-S01v2-01` 逐日/逐笔投影 additive 提案 + `B-S01v2-02` 36 月上限；性能验证计划、兼容性影响、Q-BP-1～5；已提交 A 汇总（`9d77b06`），draft 实现见协议草案 §15.1 |
| FX 逐日/逐笔扩展（draft 实现） | `packages/shared/src/fx.ts`、`fxDetail.test.ts`、`fxPerformance.test.ts` | `aggregateFxDetailed`/`aggregateFxDetailedAsync`（daily 恒输出、entries 可选、同源且不二次舍入、超限/取消规则）、`fxRangeMonths`/`FX_MAX_RANGE_MONTHS=36`、`FX_MAX_DETAIL_ENTRIES=50_000`；`FX_PERF=1` 门控性能用例；web `fxView.rangeMonths` 14→36 参数化（唯一消费方、页面未改） |
| FX 扩展实现状态与性能 | 协议草案 §15.1、`docs/specs/design/S17-B-性能基线.md` §6 | 实现状态、实测数字（1M daily 13.6s / 200k entries 2.7s / 10k×36 月 0.54s）、W1 接入建议（daily-only 图表、逐笔仅详情视图 + `maxEntries`、200k+ 异步批次） |
| G-17 正式定义（S-01 v2 G 组） | `docs/specs/product/s17-agents/S17-Agent-B-S01-v2提案-汇率逐笔扩展与月键上限.md` §16 | 「FX 逐笔/逐日投影」正式定义：形状（`FxAggregateDetail`/`FxConvertedEntry`/`FxDetailOptions`/`FxDetailedAggregate`/`aggregateFxDetailed*`/`fxRangeMonths`）、12 条不变量（additive/同源/守恒/缺失≠0/不截断/保护默认/异步=同步/范围币种/审查投影/月键上限/不同轴/性能）、默认值表与冻结规则；供 A 合并进 v2（G-16 归 C 的 `DraftCategoryRelation`） |
| W1 原币 24 项接入切分方案（规划，未实施） | `docs/specs/design/S17-B-W1-原币24项接入切分方案.md` | S0 数据/URL 层（`statsView` 扩展、`useAnalysis` hooks、`localAnalysis` 离线、失效联动）→ S1 趋势（I06–I10/I19count/I20/I11）→ S2 类别（I14–I16）→ S3 比较（A01–A05）→ S4 新增分析（I12/I13/A12/A13/A14/A18/A19/A20）→ S6 集成测试；S5 综合模式另列（依赖 G-17 冻结）；每项列 shared 函数/组件/页面只读替换点/测试计划/工作量/风险；§5 给 `StatsPage.tsx`/`FxStats.tsx` 替换点行号（343/57 行，只读）；§7 待批事项（W1 放行、S-01 信封、G-17 冻结、14→36 月页面行为、R-B-02/04） |
| W1-S0 适配层与首张时间卡片（已实施，`b5a8e55`） | `apps/web/src/lib/analysisData.ts`、`apps/web/src/lib/useTimeAnalysis.ts`、`apps/web/src/components/charts/DailyExpenseTrendCard.tsx` 及 3 个测试文件 | S0 数据接入与口径统一：半开区间/400 日上限/设备本地 `today`/剔除 transfer 与软删除/CSV 多币种不合并/coverage 双策略/query key `["analysis", query]`；I06 每日支出趋势最小卡片（真实数据验证）；未接页面、未新增 API |
| 2026-10-27 | **W1-S0 完成**（数据接入与口径统一 + I06 每日支出趋势真实链路最小卡片；未接页面、未改 `StatsPage.tsx`/`FxStats.tsx`/API/端点 limit/版本号）：①`apps/web/src/lib/analysisData.ts` 数据适配层——`analysisSpan/assertAnalysisSpan`（半开区间校验 + S-01 v2 §17 日窗口 400 上限 `MAX_ANALYSIS_DAYS`，越界抛 `analysis-range-limit` 不截断）、`trailingWindow/trailingMonthWindow`（缺省 30 天/12 月）、`toTimeSeriesEntries`（真实 `Transaction`→`TimeSeriesEntry`：仅 `occurredLocalDate` 日历日、`transfer` 与软删除剔除、金额 `string`→`bigint`、CSV 多币种不合并）、`coverageOf`（R-B-02 默认 unknown）与 `localLedgerCoverageEnd`（W1 原币设备账本口径，注释声明为 stated assumption）、`analysisDataVersion=null`（G-10 待定）、`buildAnalysisInput`、`deriveTimeAnalysis`；②`useTimeAnalysis` hook（`useSyncExternalStore` + `readLocalTransactions`，query key 命名空间 `["analysis", query]` 不写 `["stats"]`）；③首张卡片 `DailyExpenseTrendCard.tsx`（I06 每日支出趋势：`SeriesTrendChart` 折线/面积/柱、`Sparkline` 迷你趋势、金额/笔数切换、进度/未知状态、无数据空态、设备账本口径说明）；④测试：`analysisData.test.ts`（真实 `Transaction` 形状 14 用例）、`useTimeAnalysis.test.ts`（8 用例）、`DailyExpenseTrendCard.test.tsx`（5 用例）；⑤真实数据只读核验（`ledger_dev` SELECT-only，主候选账本 `ff252fa7-…`：184 笔、2026-08-03→2026-10-20、3 币种、income 23 笔/expense 161 笔；SQL `GROUP BY occurred_local_date,kind` 与 TS `computeTimeSeries` 逐桶金额/笔数数字级一致；报告只给聚合，未写原始行；夹具库 `libevra_s17_w1_fixture`（195 笔脱敏）由 Lead 提供，供后续最小真实卡片 E2E 用） | 新增 `apps/web/src/lib/analysisData.ts`、`useTimeAnalysis.ts`、`apps/web/src/components/charts/DailyExpenseTrendCard.tsx` 及 3 个测试文件；任务文档 | `b5a8e55` | shared **533 passed/3 skipped**；web 全量 `vitest run` 通过；`pnpm --filter @libellum/web typecheck` 0；真实数据交叉核验（SQL sum vs TS 输出一致，见报告）；`check:docs` 绿 | 新增 web 内部模块与 hook（非 S-01 信封、非 HTTP/API）；本地查询键 `["analysis", query]`；**未**新增/修改端点 | R-B-02 由 W1 原币设备账本口径显式替代（B-Q17 待 Lead/所有者确认）；W1 页面接线由 Lead 在集成 worktree 完成；FX 综合模式与后端信封不在 S0 | 等 Lead 验收 S0；随后 S1 时间趋势（I07–I10/I19/I20/I11）接入；每日/每周覆盖率继续按 R-B-02 记录 |

**环境说明（本地验证）**：本 worktree 首次使用需 `pnpm install --offline`（本地 pnpm store 已具备依赖）；Prisma 7 的 `prisma.config.ts` 要求 `DATABASE_URL` 环境变量存在，生成客户端用 `DATABASE_URL=postgresql://... pnpm db:generate`（生成不连库，生成物 `apps/api/src/generated/prisma/**` 被 gitignore）。API 集成测试需要根目录 `.env` 的 `TEST_DATABASE_URL`（测试库名必须含 `test`，见 `apps/api/test/setup.ts` 的守卫）；本工作区 `.env` 为本地开发文件，**不入库**。Windows 下若 PowerShell 执行策略拦截 `pnpm.ps1`，改用 `$pnpm = Join-Path $env:APPDATA "npm\pnpm.cmd"; & $pnpm ...`。API 集成测试当前 611/612：唯一失败是本地测试库迁移落后 1.16.22 基线（`profile` 头像用例），与本分支改动无关，1.16.23 发布后统一 rebase 再跑（Lead 已确认）。

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
| B-Q15 | 综合模式 FX 逐日/逐笔投影（`aggregateFxDetailed`）与 36 月上限是否进 S-01 v2（Q-BP-1～5） | **已裁定（2026-10-27，Lead）**：①Q-BP-1 `detail` 命名批准；②Q-BP-2 `maxEntries=50,000` 为保护默认值，逐笔明细视图必须显式传，S-01 写明“默认值只是保护、不得作为业务契约”；③Q-BP-3 登记为 **G-17「FX 逐笔/逐日投影」**（G-16 = C 的 `DraftCategoryRelation`），正式定义见提案文档 §16；④Q-BP-4 与 `maxAnalysisDays=400` **不强对齐**（不同轴并列登记）；⑤Q-BP-5 `daily` 恒输出、`entries` 可选；`fxRangeMonths` 15–36 月不再抛错批准为 draft；性能结论（异步批次 + `yieldControl`、不在渲染帧聚合）写入 v2 | 已裁定；待 A 合并进 v2 draft |
| B-Q16 | W1 原币 24 项启动时间、切片顺序，以及 24 项是否统一走 S-01 `analysis/time.ts` 信封（影响 B 的 `useAnalysis` hooks 是“自算”还是“薄封装”） | W1 无法开工；钩子形态未定 | 所有者（W1 放行）+ Lead/A（S-01 冻结与端点归属）；切分方案 §7 已列 6 条待批事项 |
| B-Q17 | W1 原币分析卡片的 coverage 口径：R-B-02 规定离线 `coverageEnd` 未知时按 `unknown`，但那样所有历史桶都无金额、真实卡片无法显示 | **S0 采用双策略（2026-10-27）**：引擎默认 `unknown`；W1 原币卡片显式用 `localLedgerCoverageEnd(span, today)`（设备账本为权威副本，与现有 `useStats`/`computeStats` 同假设），并在结果说明/卡片 caption 写明；综合模式与远端未同步月份仍按 R-B-02 记录，待离线覆盖元数据 | Lead/所有者确认该假设；D/S16 补离线覆盖元数据 |
| B-Q7 | S-01 时间扩展对齐：桶半开区间、`dataVersion` 定义、逐桶来源、7 个形状命名（草案 §7 的 Q-BA-1～Q-BA-4、Q-BA-7/Q-BA-8） | **已解决（2026-10-27）**：A §15 逐条答复——7 形状登记进 union（命名归 A 逐字不变）、`bucketToInclusive` 定名、`SourceDescriptor.bucket?` 由 A 扩字段、dataVersion 由数据层透传、桶级复用 `AnalysisCompleteness`、Ratio 跨 HTTP 用分子分母字符串；S-01 仍 `s01-draft` 待评审冻结 | 已解决（A + Lead） |
| B-Q8 | 离线数据覆盖元数据（`BucketContext.coverageEnd` 的真实来源） | Lead 指示：记录即可，B-1 按 `unknown` 处理；W1/集成阶段统一（R-B-02） | D/S16 + Lead |
| B-Q9 | 写后 `["stats"]` 失效策略与 `dataVersion` 生产方 | Lead 指示：记录即可，W1/集成阶段统一处理（R-B-04）；A §15 定 dataVersion 由数据层透传 | D/S16 + A + Lead |
| B-Q10 | I13 星期分布等无专用 shape 的呈现方式（用哪一图与尺寸组合） | **已实现（2026-10-27，B-2）**：按 A §15 结论用 7 桶模板轴（不新增 shape），`WeekdayBars` 提供 total/average 两口径；卡片尺寸组合仍待 C/Codex | 已实现；尺寸组合待 C/Codex |
| B-Q11 | 1.16.23 候选未合并期间是否允许改 `StatsPage.tsx` 等冲突文件 | **已解决（2026-10-27）**：Lead 指示严格只读，B-1 只做纯函数与图表输入层；等 1.16.23 发布后统一 rebase 再改页面 | 已解决（Lead） |
| B-Q12 | 分析区间上限：A 的 `makePeriod` 限制 `MAX_STATS_DAYS = 400`，与 I09（12/24/36 个月）、A01 同比、A12/A14 长样本冲突 | **已登记（2026-10-27）**：A 已在 S-01 §17 登记——月键比较不设日上限（月数暂记 ≤36）、日窗口由调用方传 `maxAnalysisDays`（默认 400）、越界协议层拒绝不截断；默认值/字段名待所有者确认（S-01 v2 G-09）。B 纯函数层参数化待冻结后统一接入（B-5 不改端点 limit） | A + Lead（协议草案 Q-BA-12 / S-01 §17） |
| B-Q13 | A03 同比的 2 月 29 日边界对齐规则 | **已按规格 §21 实现（2026-10-27）**：目标年无 2/29 时取该年 2 月最后一天并在 `resolution.leapDayFallbacks` 逐条记录（不静默丢日）；待所有者/A 确认“显式可测”的对齐是否符合预期 | 所有者/A |
| B-Q14 | A05 本月至今同步比较的默认窗口政策 | **已实现（2026-10-27）**：默认 `same-day-index`（历史月较短时裁剪并在 `resolution.previousClipped` 标注），可选 `equal-length-window`（可能跨月、`comparisonMode = "equal-length"` 并提示）；规格 §23 要求第一版至少一个官方政策经所有者确认 | 所有者/A |
| B-16 | A12「极值日」判定倍数（规格只说平均值 + 2σ，未给具体口径/舍入/是否排除极端日自身） | **已参数化（2026-10-27，B-5）**：`DEFAULT_EXTREME_SIGMA = 2`、`EXTREME_SIGMA_SCALE = 100`，结果记录 `extremeSigma`（basisPoints + sigmaLabel）与说明，不在多处硬编码；默认 2σ 待所有者裁定，若改默认只需改常量+测试 | 所有者/Lead |

---

## 8. 恢复步骤（上下文丢失时）

1. 读仓库 `AGENTS.md` → `docs/STATUS.md` → 索引 → 本文件。
2. 检查工作区 `git status --short`、`git log --oneline -5`，与 §6.2 核对；不一致立即停手报告 Lead。
3. 只在本分支工作；禁止触碰索引 §1.3 受保护工作区。
4. 向 `lead` 发送恢复报告（身份/状态/已完成/未决/下一步）。
