# S17 · Agent B 任务文档：时间、趋势与周期分析

> 本文件是 **DS-S17-B-Time** 的唯一权威任务文档。所有长期有效的职责、接口、进度、问题与交接必须写入本文件，不得只存在于聊天上下文。
> 建立：2026-10-27（Lead 初始化）；维护者：Agent B 自己。
> 当前状态：**B-0～B-6 已完成；1.16.23 rebase 完成（新基线 `d4e4fd8`，零冲突、18/18 重放）；S-01 v2 B 侧提案已提交（`9d77b06`）并完成 draft 实现（`FxAggregate` 逐日/逐笔投影 + 36 月上限，待协议冻结后 W1 接入）；W1 已获所有者批准，**S0（数据接入与口径统一 + I06 每日支出趋势真实链路卡片）已完成**，**S1 时间趋势族（I07–I10/I19/I20 的适配层、卡片与单测；I11 收支对比）已完成**，**S2 类别区（I14 单分类趋势、I15 多分类对比、I16 占比与排行的适配层、图表模型、卡片与单测）已完成**；未 push**。
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
| B-6 1.16.23 rebase 冲突面 / W1 页面集成清单 / 候选影响面（只读预研，不改代码） | **完成（2026-10-27）** | 交付 `docs/archive/design/S17-B-B6-1.16.23-rebase与W1集成预研.md`：①1.16.23 已发布上线（`207a5ad`/`d4e4fd8`，无迁移保持 60）；②`merge-tree` 预演 rebase **零冲突**（唯一重叠 `docs/00-索引.md`，行区间分离），附步骤与验证清单；③W1 24 项→接入点/依赖/估 15–22 人日映射（原币先行 8–12 d）；④综合模式 FX 逐笔/逐日输出缺口 + `rangeMonths` 14→36 月限制（R-B6-2 高）；⑤只读核对 1.16.23 候选与我的 67 文件无代码交集，另报主工作区状态异常 |
| 1.16.23 rebase（新基线） | **完成（2026-10-27）** | 备份 `backup/pre-1.16.23-20261027`（本地，不 push）；`git rebase d4e4fd8` 18/18 提交重放**零冲突**（唯一重叠 `docs/00-索引.md` 自动合并：1.16.23 发布行 L7 + B-6 行 L113 并存）；rebase 后验证：shared **32 文件/521 用例**、web **162 文件/1467 用例**、`pnpm typecheck` 三包、`check:docs`、`check:status`（路由 75、代码版本 1.16.23、迁移 60）全绿；HEAD `e61d810` |
| S-01 v2 B 侧提案与 draft 实现（2026-10-27，Lead 验收通过） | **完成 / 已验收**（`9d77b06` 提案、`13428bd` draft 实现、`1f46664` 回填；Q-BP-1～5 已裁定 → 登记 **G-17**） | ①**G-17「FX 逐笔/逐日投影」**正式定义已写入提案文档 §16（形状/12 条不变量/默认值/兼容性），交 A 合并 v2；②`FxAggregate` 逐日/逐笔投影（`aggregateFxDetailed`/`aggregateFxDetailedAsync`，additive，对齐 R-B6-2）与 `FX_MAX_RANGE_MONTHS=36` + `fxRangeMonths` 参数化均已实现（12 正确性用例 + 3 性能用例；web `fxView` 委托、15–36 月不再抛错）；③裁定：`detail` 命名批准、`maxEntries=50,000` 仅保护默认（明细视图必须显式传）、G-17 登记（G-16 归 C）、不与 `maxAnalysisDays=400` 强行对齐（不同轴并列登记）、`daily` 恒输出/`entries` 可选、性能结论（异步批次+`yieldControl`、不在渲染帧聚合）进 v2；④性能基线 `S17-B-性能基线.md` §6；协议草案 §15.1 实现状态；**冻结前不接页面** |
| S-01 参与评审 | 进行中（时间扩展已与 A 对齐，B-5 已补 draft 映射，待评审冻结） | A §15 已答复 Q-BA-1/2/3/4/7/8；Q-BA-12（区间上限）已由 A 登记进 S-01 §17（月键上限 36、日窗口由调用方传 `maxAnalysisDays` 默认 400、越界协议层拒绝不截断，字段名/展示待所有者确认）；B-5 已向 Lead 提交 S-01 v2 交叉评审意见（B 七形状/§4 统一规则/B-16/B-17/归属/G 清单），协议仍 `s01-draft` 未冻结 |
| W1 原币 24 项接入切分方案（2026-10-27） | **方案已完成（纯文档，待所有者批准后实施）** | 交付 `docs/archive/design/S17-B-W1-原币24项接入切分方案.md`：S0 数据/URL 层 → S1 趋势区 → S2 类别区 → S3 比较区 → S4 新增分析区 → S6 集成测试，S5 综合模式另列（依赖 G-17 冻结）；逐项列出 shared 函数/图表组件/页面只读替换点/测试计划/工作量与风险，明确“待所有者批准后实施”；§5 给出 `StatsPage.tsx`/`FxStats.tsx` 只读替换点行号；§7 列待批事项（W1 放行、S-01 信封、G-17 冻结、14→36 月页面行为、R-B-02/04） |
| W1 时间口径核对 | **S0 完成（2026-10-27）** | 偏差/口径集中到 `apps/web/src/lib/analysisData.ts`：业务日期半开区间、400 日上限（S-01 v2 §17）、设备本地 `today`、`transfer`/软删除/未知记录剔除、CSV 多币种不合并；coverage 设备账本口径（W1 原币）与 `unknown`（引擎默认）双策略，见 §7 B-Q17；真实数据 SQL 交叉核验已做（见 §6.2）。下一步 S1 趋势区接入 |
| W1-S1 时间趋势 | **完成（2026-10-27）** | 适配层 `trailingWeekWindow`/`trailingMonthWindow`（周一起自然周/自然月、跨年正确）+ `deriveCumulativeAnalysis`（I20 累计，未知向后传播）+ `deriveFlowAnalysis`（I11 收支共用桶边界）；hooks `useCumulativeAnalysis`/`useFlowAnalysis`；卡片 `TimeSeriesCard`（I07/I08/I09/I10/I19 通用，line/area/bar）、`CumulativeExpenseCard`（I20）、`IncomeExpenseCard`（I11）；未接页面、不改 API/版本、不碰 `StatsPage.tsx`/`FxStats.tsx`；下一步 S2 类别区 |
| W1-S2 类别区 | **完成（2026-10-27）** | 适配层 `deriveCategoryAnalysis`（I15：kind 过滤、稳定分类 ID 聚合、`__other__ = 桶总额 − 选中合计`、占比分母用权威桶总额）/ `deriveCategoryTrend`（I14，单分类趋势与 I15 逐桶一致）/ `rankCategories`（I16 排行：区间总额降序、并列共享名次、`limit` 在“其他”剔除后生效、份额分母权威总额）；图表模型 `buildCategorySeriesModel`（多折线/分组柱/面积共用权威结果、未知断线不补零）；卡片 `CategorySeriesChart`、`CategoryCompositionCard`（I15 堆叠）、`CategoryShareCard`（I16 100% 带，零总额不伪造 0%）、`CategoryTrendsCard`、`CategoryDataTable`（金额/占比表格）；未接页面、不改 API/版本、不碰 `StatsPage.tsx`/`FxStats.tsx`；下一步 S3 比较区 |
| W1-S3 比较区 | **完成（2026-10-27）** | 适配层 `derivePeriodComparison`（A01/A02/A03/A05，四种 `ComparisonKind` 复用 shared resolver；覆盖未知时金额/差额/增长率一律 null）/ `deriveMultiMonthComparison`（A04，`assertComparisonMonthCount` 按 S-01 v2 §17 draft 限 36 月、越界抛 `analysis-range-too-long` 不截断）/ `ComparisonAnalysisView`/`MultiMonthAnalysisView`；hooks `usePeriodComparison`/`useMultiMonthComparison`；卡框架 `MonthComparisonCard`（A04 新卡壳，复用 B-3 `MonthComparisonChart`；`totalText` 只在全部月份完整时传非 null）；复用 B-3 `PeriodComparisonCard`/`PeriodComparisonBars`；未新增/修改 S-01 形状、未接页面、不改 API/版本、不碰 `StatsPage.tsx`/`FxStats.tsx`；下一步 S4 新增分析区 |
| W1-S4a 新增分析区（I12/A12 波动、A20 收入稳定、I13 星期分布） | **完成（2026-10-27）** | 适配层 `analysisData.ts`：`deriveDailyExpenseVariability`（I12/A12，先 `computeTimeSeries` day 再 `computeDailyExpenseVariability`，`extremeSigma` 可配）、`deriveIncomeStability`（A20，month、`minSampleMonths`）、`deriveWeekdayAnalysis`（I13，`computeWeekdayPattern`，kind all/expense/income）；新增 `AnalysisCoverage`/`coverageEndFor`/`hasCompleteObservation`，unknown 覆盖按“区间起点前一天”收窄；hooks `useDailyExpenseVariability`/`useIncomeStability`/`useWeekdayAnalysis`；卡片 `VariabilityCard`（内嵌 `VolatilityBandChart`，result 可 null + 样本句）、`IncomeStabilityCard`（`judgedState`/样本句必显）、`WeekdayPatternCard`（total/average 双模式、`data-mode` 明示）；协议草案 §20；未改 shared、未接页面、不碰 `StatsPage.tsx`/`FxStats.tsx`；下一步 S4b（A13/A14） |
| W1-S4b 移动平均（A13/A14） | **完成（2026-10-27）** | 适配层 `analysisData.ts`：`deriveMovingAverage`（`windowDays` 7/30，读取区间向历史扩展 `windowDays-1` 天、可见区间不变，`visibleMovingAverage` 把 points/计数裁剪回可见范围；`MOVING_AVERAGE_WINDOWS`）；`analysisData` 校验正整数窗口抛 `AnalysisRangeError("analysis-range-invalid")`；hook `useMovingAverage`；卡片 `MovingAverageCard`（内嵌 B-4 `MovingAverageChart`，原始 + 平均双序列，`data-window` 明示 7/30，result 可 null + `sampleText` 必显）；协议草案 §21；**B-Q20 裁定后修正**：进行中今天不入样本、`todayExcluded`/`excludedInProgressDays` + 卡片 `excludedTodayText`（独立小提交）；未改 shared、未接页面、不碰 `StatsPage.tsx`/`FxStats.tsx`；下一步 S4c（A18/A19） |
| W1-S4c 季节性/异常峰值（A18/A19） | **完成（2026-10-27）** | 适配层 `analysisData.ts`：`SEASONAL_MAX_MONTHS = 36`、`SeasonalAnalysisQuery`/`SeasonalAnalysisView` + `deriveSeasonalComparison`（按自然月跨度预检 36 月、越界抛 `AnalysisRangeError("analysis-range-too-long")` 不截断；`coverageEndFor` 收窄未知覆盖；消费 shared `computeSeasonalComparison` month view）；`AnomalyAnalysisQuery`/`AnomalyAnalysisView` + `deriveAnomalyAnalysis`（`assertAnalysisSpan` 400 日上限、只取 complete 日喂 `detectDailyExpenseAnomalies`、`unavailableReason = "no-complete-observations"` 当 observedDays=0）；hooks `useSeasonalAnalysis`/`useAnomalyAnalysis`；卡片 `SeasonalComparisonCard`（内嵌 `SeasonalComparisonChart`，`data-descriptive-only` 明示描述性、进行中月保留部分金额但不可比、只画月视图）、`AnomalyPeaksCard`（内嵌 `AnomalyMarkerChart` + 排行列表，无基线空状态、无异常日文案）；协议草案 §22；未改 shared、未接页面、不碰 `StatsPage.tsx`/`FxStats.tsx`；下一步待命（S-01 v2 冻结后最小批次） |
| s01-v2 冻结后最小批次（σ/CV 映射 + method 串统一 + G-27 文档行） | **完成（2026-10-27）** | ①`packages/shared/src/variability.ts` 追加 `Ratio`/`SqrtValue`/`VarianceKind`/`CoefficientsOfVariation` 与 `standardDeviation`/`varianceKind`/`coefficientsOfVariation`/`standardDeviationScaled`（additive；不再使用的旧字段 `stdDevScaledMinor`/`coefficientOfVariationScaled` 保留兼容），σ 保持总体口径精确有理数、μ=0/n=0 → `null`（不补 0）、CV 无量纲 `fraction` 不套货币舍入；②新增 `packages/shared/src/analysisMethod.ts`：规范串（`exact-mean-v1`/`population-standard-deviation-v1`/`coefficient-of-variation-v1`/`mad-median-v1`/`iqr-quantile-v1`/`percentile-threshold-v1`）+ 旧串别名归一 + `anomalyMethodString`；`anomaly.ts` 结果增 `methodString`（`mad-median-v1` 等）；③协议 §4.2 补 G-27 一行（C `partial` 仅 FX 不完整 → `unavailable`/`fx-incomplete`，非 FX 按自身原因，P16 三态不引入 `partial`）+ 新增 §23 表示法映射与「本批未做」；④未改任何形状/字段语义、未改版本串、未接页面、不碰 `StatsPage.tsx`/`FxStats.tsx`；shared 34 文件/543 用例（+新增）全过、web 174 文件/1582 用例全过、`tsc -b` 0；下一步待命（等下一批指令或 W3） |
| s01-v2 v2.0.1 修正（method 串三层 / type7 不冒充 / decimalText 不强制） | **完成（2026-10-27）** | 按 Lead m05439 暂停批次并修正：①`analysisMethod.ts` 改三层——`ANALYSIS_METHOD` 内部 id（结果 `formula` 用）、`FROZEN_METHODS` 冻结登记值（`population-stddev`/`sample-cv-fixedpoint`/`mad-median`/`iqr-quantile`）、`OPEN_EXTENSION_METHODS` 开放扩展（`exact-mean-v1`/`robust-z-score-v1`/`tukey-fence-v1`/`quantile-threshold`/`abs-deviation-gt-sigma-multiple-v1`），`canonicalMethodString` 只输出冻结值或标注扩展、未知串原样，新增 `methodSupport`/`isFrozenMethod`；②`type7-linear` 不冒充（B 分位阈值是 nearest-rank `ceil(n·q)−1`，登记 `unregistered`）；③`SqrtValue.decimalText` 不强制（允许 null/空串，若提供必须 `decimals=6` 一次 half-away，不用浮点）；④协议草案 §23.2/§23.4/§23.5 同步；未改任何形状/财务数值语义；shared 34 文件/546 用例 + 3 skipped、`tsc -b` 0 |
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
| 2026-10-27 | **B-6 完成**（只读预研，不改代码/不 rebase/不 push）：①1.16.23 发布事实核对（生产已上线 `207a5ad`，发布记录 `d4e4fd8`，无迁移保持 60，未推 GitHub）；②rebase 冲突面清单：`release/1.16.23` 相对基线仅 16 文件，与我的 67 文件无代码交集，唯一重叠 `docs/00-索引.md` 行区间分离，`git merge-tree --write-tree` 预演 exit 0（tree `124e796`），附 rebase 步骤+验证清单+风险分级；③W1 集成清单：1.16.23 后 `StatsPage.tsx`（349 行，URL 状态 + 月份选择器）与 `FxStats.tsx`（57 行）接入点、24 项能力→组件/落点/依赖/工作量（合计 15–22 人日，原币先行 8–12 d）映射、URL 参数扩展建议、详情页来源跳转可复用点；④只读核对 1.16.23 候选对 B 层影响：仅 `version.ts` 变更、无 shared 契约/我的文件被覆盖；⑤上报 3 个决策请求（批准 rebase / FX 逐笔输出扩展与 14→36 月限制 / W1 切片与 S-01 v2 冻结时点）与 R-B6-1～R-B6-6 | `docs/archive/design/S17-B-B6-1.16.23-rebase与W1集成预研.md`（新增）、本文件、`docs/00-索引.md` | `e35fe7b`（本地；不 push） | 文档变更无单测；`pnpm check:docs`/`check-status` 复核（见提交报告） | 无接口/代码变化；设计文档新增 | R-B6-2 综合模式无逐日/逐笔 FX 输出（高）、R-B6-3 14 vs 36 月限制、R-B6-5 主工作区状态异常（`335da77` + 已发布候选副本） | 2026-10-27 | **rebase 完成**：按 Lead 批准以 `release/1.16.23`（`d4e4fd8`）为新基线；备份分支 `backup/pre-1.16.23-20261027`（本地，不 push）；18 个提交重放**零冲突**，唯一重叠 `docs/00-索引.md` 自动合并；rebase 后全量验证全绿 | 本文件 | `07a0a10`（本地；不 push） | shared **32 文件/521 用例**全过；web **162 文件/1467 用例**全过；`pnpm typecheck` 三包 exit 0；`check:docs` exit 0；`check:status` 通过（路由 75、代码版本 1.16.23、迁移 60） | 无（代码未改，仅提交链重放；版本号随 1.16.23 变为 1.16.23） | 无冲突；主工作区 R-B6-5 由 Lead 汇总处理 | 发 rebase 报告 Lead；等 W1 启动切分；随后 `FxAggregate` 可选扩展 + `rangeMonths` 14→≤36 提案（②批准） |
| 2026-10-27 | **S-01 v2 B 侧提案提交**（additive，draft）：①**B-S01v2-01** 综合模式 `FxAggregate` 逐日/逐笔投影——`FxConvertedEntry`/`FxDetailOptions`/`FxAggregateDetail`/`FxDetailedAggregate` + `aggregateFxDetailed`/`aggregateFxDetailedAsync`（`detail.daily`、可选 `detail.entries`，逐笔与 `convertFx` 同源、daily=Σtotals 守恒、失败笔与成功笔互斥、超限抛 `fx_detail_limit` 不截断、异步取消不返回部分结果），现有 `aggregateFx`/`aggregateFxAsync`/`FxAggregate` 零改动；②**B-S01v2-02** 月键上限落位——`FX_MAX_RANGE_MONTHS = 36` + `fxRangeMonths(from,to,maxMonths)`，web `rangeMonths` 14→36 参数化（draft，W1 前不改页面）；③性能验证计划（54,000 笔/36 月基准、`FX_PERF=1` 门控、单批 ≤50ms、daily 模式差异 ≤5%）与兼容性影响表；④开放问题 Q-BP-1～5；⑤协议草案新增 §15 指针 | 提案文档（新增）、协议草案 §15、本文件 | `9d77b06` | 文档变更，无需单测；`check:docs` 随后验证 | 无接口变化（提案）；提案内新 API 待实现标 draft | 唯一行为变化提案：web `rangeMonths` 15–36 月不再抛错（draft，W1 接入时生效）；Q-BP-5 默认值待 A/Lead 确认 | 提案提交后实现 P-FX-1/P-FX-2 并标注 draft；等 A 汇总进 v2；W1 启动切分后接入 |
| 2026-10-27 | **S-01 v2 B 侧 draft 实现**（additive；待协议冻结后 W1 接入）：①`fx.ts` 增 `FX_MAX_RANGE_MONTHS=36`/`FX_MAX_DETAIL_ENTRIES=50_000`、`FxConvertedEntry`/`FxDetailOptions`/`FxAggregateDetail`/`FxDetailedAggregate`、`aggregateFxDetailed`/`aggregateFxDetailedAsync`（`daily` 恒输出=Σ成功笔、`entries` 可选且与 `convertFx` 同源、失败笔不投影、超限 `fx_detail_limit` 不截断、异步取消不返回部分结果）；②`fxRangeMonths`（含首尾月/跨年连续/非法日期 `fx_range_invalid`/超限 `fx_range_too_long` 不截断）；③web `fxView.rangeMonths` 委托（14→36 参数化，页面零改动）；④测试 `fxDetail.test.ts` 12、`fxPerformance.test.ts` 3（`FX_PERF=1` 门控）、web `fxView.test.tsx` 8；⑤协议草案 §15.1 实现状态 + `S17-B-性能基线.md` §6 实测数据 | `packages/shared/src/fx.ts`、`fxDetail.test.ts`、`fxPerformance.test.ts`、`apps/web/src/lib/fxView.ts`、`packages/shared/src/index.ts`、协议草案 §15.1、性能基线 §6、本文件 | `13428bd` | shared：**533 passed / 3 skipped（性能门控）**、typecheck 0；web `fxView` 8/8、`typecheck` 0；`check:docs`/`check:status` 见报告 | 新增 draft 导出（`aggregateFxDetailed*`、`fxRangeMonths`、`FX_MAX_*` 与 4 类型）；既有 `aggregateFx`/`aggregateFxAsync`/`FxAggregate` 行为与形状不变；`rangeMonths` 15–36 月不再抛错（draft，W1 生效） | 性能实测：1M daily-only 13.6s、200k entries 2.7s、10k×36 月 0.54s → 逐笔仅详情/导出视图 + `maxEntries`，200k+ 走异步批次；Q-BP-1～5 待 A/Lead；冻结前不接页面 | 发该实现结构化 B 报告 Lead；等 A 汇总进 S-01 v2；W1 启动切分后接入 |
| 2026-10-27 | **G-17 正式定义 + W1 原币 24 项接入切分方案（纯文档）**：①按 Lead 裁定把 G-17「FX 逐笔/逐日投影」正式定义（形状/12 条不变量 IV-G17-01～12/默认值表/兼容性与冻结规则）写入 S-01 v2 提案文档 §16，交 A 合并进 v2；②新增 `S17-B-W1-原币24项接入切分方案.md`（S0 数据/URL 层、S1 趋势区、S2 类别区、S3 比较区、S4 新增分析区、S6 集成测试、S5 综合模式另列），逐项列 shared 函数/图表组件/页面只读替换点/测试计划/工作量/风险，标注“待所有者批准后实施”；③任务文档 §5/§6.2/§6.4/§7 与本提交同步回填。**未改任何代码/页面** | 提案文档 §16、`docs/archive/design/S17-B-W1-原币24项接入切分方案.md`（新增）、协议草案 §15.2、本文件、`docs/00-索引.md` | `f3bd4d6`（本地；不 push） | 文档变更：`pnpm check:docs` exit 0、`check:status` 通过（路由 75/版本 1.16.23/迁移 60） | 无代码/接口变化 | W1 未放行、S-01 v2 未冻结；`StatsPage.tsx`/`FxStats.tsx` 仍只读 | 等 Lead 转 A 合并 G-17；等所有者批准 W1 后按 S1→S4 实施；S5 待 G-17 冻结 |
| 2026-10-27 | **D-05 修订（G-17 §16，按 Lead 裁定）**：删除 §16.2 `FxConvertedEntry.kind` 的 `transfer` 预留值，改为 `"income" \| "expense"`（继承 `TransactionKind`/`TRANSACTION_KINDS`，与 S-01 核心一致）；新增 IV-G17-13「交易类型域」（只允许两种 kind，其它值按既有 `invalid_input` 处理）；§16.5 增「未来扩展」注记——转账不在 S-01 v2/本组合同内，若未来引入须另立合同并经所有者批准，不得作为联合成员预留。W1 切分方案未改、未接页面、未改代码 | 提案文档 §16（kind/IV-G17-13/§16.5）、本文件 | `7405194`（docs；D-05：移除 transfer 预留值） | 无代码变更；`pnpm check:docs` 复核 | 无接口变化（`fx.ts` 实现本就仅 income/expense，与修订后一致） | 无 | 把新提交号 + §16 位置报 Lead，转 A 更新 v2 §13 来源引用；W1 继续等所有者放行 |
| 2026-10-27 | **W1 获批 + S-01 v2 冲突检查意见（B 侧）**：①所有者正式批准 W1（S0 数据/URL 层 → S1 趋势 → S2 类别 → S3 比较 → S4 新增分析；真实数据链路优先，先出一张可验收真实卡片；专用集成 worktree `s17/integration`，版本 1.17.1，不 push/不合并主工作区）；②按 Lead 要求只读 A 的 S-01 v2 定稿候选（A `3c5b59a`，r3，未冻结），产出 B 侧冲突检查意见：**🔴 8 项需 A 修订/裁定**（B-V2-01 §3.2 表 `total` “只对 complete 求和”与 §4.2 矛盾；B-V2-02 §3.2 `calendar-heatmap` 括注把 I12 错标为“支出分类构成”（I12=每日支出波动、I14=分类构成）；B-V2-03 §3.4 `calendar` 行仍要求对齐“B I12 日历”；B-V2-04 桶级五态→9 态映射丢失 in-progress/unknown 信息；B-V2-05 `metric` 是否允许 `count`；B-V2-06 `SourceDescriptor.query.kind` 收窄后无 `stats`/`transactions` 映射；B-V2-07 桶 `span` 未明确“裁剪后”语义；B-V2-08 客户端原币路径 `dataVersion` 无来源）、**🟡 5 项澄清**（字段名以 B 草案 §3.7 为准/method 取值/§12 常量补登（周一起最小样本 28、异常 3.5σ·1.5IQR、季节 2 年、热力 4 级）/rangeMonths 实现状态/quarter-year 粒度）、**✅ 8 组核对通过**（G-17 §13 与 D-05、B-16/B-17、A05、闰日、bucketToInclusive、五态方向、七形状命名、axis 语义）、**🟢 5 项 B-W1 待办**（maxAnalysisDays 参数化+analysisLimit、36 常量收敛、五态透传、dataVersion 方案、日历派生字段）；③未改任何代码/页面 | 新增 `docs/archive/design/S17-B-S01-v2冲突检查意见.md`、`docs/00-索引.md`、本文件 | 本提交（docs；不 push） | 文档变更；`pnpm check:docs` 复核 | 无代码/接口改动 | 集成 worktree 未就绪；S0 数据层未开工；A 对 r4 修订未回 | 发 Lead 转 A；随后按 S0→S4 推进 W1，先做真实数据链路最小卡片 |
| 2026-10-27 | **W1-S0 夹具真实数据 E2E（验收证据）**：①环境：夹具库 `libevra_s17_w1_fixture`（脱敏、195 笔；主账本 `22222222-2222-4222-8222-222222222222`；隔离账本 `44444444-4444-4444-8444-444444444444` 5 笔，仅作权限/多账本隔离回归）；②链路：本地 API（3032，`DATABASE_URL` 指向夹具库）+ web dev（5192）+ 登录 `s17_fixture_owner`，临时 harness（`apps/web/src/dev/E2eS0Harness.tsx`，未入库、验证后删除）经 `ChartLabPage` 入口渲染真实 I06 卡片；③对账（数字级）：最近 30 天（2026-09-28→2026-10-27）SQL 逐日 `SUM(amount_cents)/COUNT(*)` 与浏览器 `computeTimeSeries` 逐桶金额/笔数**19 个有数据日 0 差异**，合计 **739,427 分 = 7,394.27**；其中 CNY 715,797、HKD 8,600、USD 15,030（原币口径不折算，与卡片“原币，未折算汇率”一致，与 CNY-only 的差额 23,630 已逐币解释）；④完整性：末桶 2026-10-27 为 `in-progress`（今日未结束）→ `complete=false`、unknown=0（与引擎五态一致）；⑤边界：主账本软删除 0 行、窗口内 kind 仅 income/expense（enum 无 transfer，与 D-05 一致）、隔离账本窗口内 0 笔；⑥截图 `_backups/w1-s0-e2e-zh.png`（中文亮色）、`_backups/w1-s0-e2e-dark.png`（暗色），数据 `_backups/w1s0-buckets.json`、`_backups/w1s0-sql-daily.csv`（均 gitignored，不入库）；⑦未改 `StatsPage.tsx`/`FxStats.tsx`/API/端点/版本号，临时入口已还原（工作区 clean） | 本文件；`_backups/*`（gitignored，不入库）；临时 `apps/web/src/dev/E2eS0Harness.tsx` 与 `ChartLabPage.tsx` 入口已还原 | `d28823a` | 夹具库只读 SELECT + CDP 截图证据；S0 自动化单测此前已全过 | 无代码/接口变化 | E2E 采用设备账本 coverage 假设（B-Q17 待确认）；页面接线仍由 Lead 在集成 worktree 统一完成 | 发 Lead 验收；随后 S1 时间趋势（I07–I10/I19/I20/I11） |
| 2026-10-27 | **W1-S1 时间趋势族完成**（I07 日收入趋势、I08 周支出趋势、I09 月支出趋势、I10 月收入趋势、I19 日笔数、I20 累计支出、I11 收支对比）：①适配层 `apps/web/src/lib/analysisData.ts` 新增 `trailingWeekWindow`（周一起自然周，末桶裁剪到 today）/`trailingMonthWindow`（自然月，跨年）/`deriveCumulativeAnalysis`（复用 `accumulateSeries`，未知桶向后传播、平台保留）/`deriveFlowAnalysis`（收支共用 span 与桶边界）与 `CumulativeAnalysisView`/`FlowAnalysisQuery`/`FlowAnalysisView` 类型；②hooks `useTimeAnalysis.ts` 新增 `useCumulativeAnalysis`/`useFlowAnalysis`（复用同一 ledger store 读取）；③卡片 `TimeSeriesCard`（通用单序列，line/area/bar，未知/进行中沿用 `SeriesTrendChart` 语义）、`CumulativeExpenseCard`（I20，复用 `CumulativeTrendChart`，首个未知桶断线）、`IncomeExpenseCard`（I11，复用 `IncomeExpenseBars`，收入/支出两个独立总额不合并成"结余"）；④全部文案/数值格式由调用方传入（组件不产中文）；⑤未接页面、未改 `StatsPage.tsx`/`FxStats.tsx`、未改 API/版本号/迁移 | `apps/web/src/lib/analysisData.ts`（扩展）、`analysisData.test.ts`（+9，共 23）、`apps/web/src/lib/useTimeAnalysis.ts`（+2 hooks）、`apps/web/src/components/charts/TimeSeriesCard.tsx`、`CumulativeExpenseCard.tsx`、`IncomeExpenseCard.tsx`、`timeSeriesCards.test.tsx`（新，5）、本文件、协议草案 §17 | `b8f24ce`（本地；不 push） | `pnpm --filter @libellum/web exec vitest run src/lib/analysisData.test.ts src/lib/useTimeAnalysis.test.ts src/components/charts/timeSeriesCards.test.tsx` → 3 文件/36 用例全过；`apps/web` 全量 `pnpm test` → **166 文件/1508 用例全过**；`pnpm --filter @libellum/web exec tsc -b` exit 0；无 shared 改动（无需重跑 shared） | 无公共接口变化；仅新增 web 层适配函数/hooks/组件（S0 已确立的 `analysisData` 单一入口，未接 S-01 信封） | I 编号口径：Lead 建议顺序与本规格编号不同（Lead 已明确"以你 spec 编号为准"），见 §7 B-Q18；S-01 v2 r5 未冻结，本批未触及 G-16/G-17 形状 | 发 S1 结构化报告 Lead（文件/提交/测试/对账/问题/下一步）；随后 S2 类别区（I14–I16）接入 |
| 2026-10-27 | **W1-S2 类别区完成**（I14 单分类历史趋势、I15 多分类金额对比/堆叠、I16 分类占比与排行）：①适配层 `apps/web/src/lib/analysisData.ts` 新增 `toCategoryEntries`（保留 kind，排除 transfer/软删除/未知分类）、`deriveCategoryAnalysis`（I15：`kind` 过滤 + 稳定 `categoryId` 聚合 + 缺省补 0 但未知不补零；`includeOther` 时 `__other__ = 桶总额 − 选中合计`，由 `computeCategoryShares` 的 `partial` 保证不被重归一化）、`deriveCategoryTrend`（I14，复用同一分类序列，单分类趋势 = 序列中该分类逐桶点）、`rankCategories`（I16：区间总额降序、并列共享名次 `1,1,3`、`limit` 在“其他”外生效、份额 = 分类总额 / 权威总额）、类型 `CategoryAnalysisQuery`/`CategoryAnalysisView`/`CategoryTrendQuery`/`CategoryRankingRow`；②图表模型 `apps/web/src/lib/chart/categoryChart.ts` 新增 `buildCategorySeriesModel`（`lines`/`area`/`grouped-bars` 三形态共用权威 `CategorySeriesResult`；未知桶断线、零点画点、柱高至少 1px、共同零基线）；③卡片 `apps/web/src/components/charts/CategorySeriesChart.tsx`、`CategoryCompositionCard.tsx`（I15 堆叠）、`CategoryShareCard.tsx`（I16 100% 占比带，零总额/未知不绘制）、`CategoryTrendsCard.tsx`（多折线/分组柱）、`CategoryDataTable.tsx`（金额/占比表格，未知显示“—”）；④全部文案/标签/格式化由 props 传入（组件不产中文；`CategoryDataTable` 滚动容器按仓库规则隐藏原生滚动条）| `apps/web/src/lib/analysisData.ts`（扩展）、`analysisData.test.ts`（S2 +7，共 30）、`apps/web/src/lib/chart/categoryChart.ts`（+90）、`categoryChart.test.ts`（+3）、`apps/web/src/components/charts/CategorySeriesChart.tsx`、`CategoryCompositionCard.tsx`、`CategoryShareCard.tsx`、`CategoryTrendsCard.tsx`、`CategoryDataTable.tsx`、`categoryCards.test.tsx`（新，7）、本文件、协议草案 §18 | `0674776`（本地；不 push） | `pnpm --filter @libellum/web exec vitest run src/lib/analysisData.test.ts src/lib/chart/categoryChart.test.ts src/components/charts/categoryCards.test.tsx` → 3 文件/53 用例全过；`apps/web` 全量 `vitest run` → **167 文件/1526 用例全过**；`pnpm --filter @libellum/web exec tsc -b` exit 0；无 shared 改动（无需重跑 shared） | 无公共接口变化；仅新增 web 层适配函数/图表模型/组件（S0 单一入口，未接 S-01 信封，未新增/修改任何 S-01 形状） | S-01 v2 仅剩所有者签认（A r5 已通过 D 复核，m03761）；本批只做消费层，冻结后按 Lead 的受影响接口清单核对；页面接线仍由 Lead 在集成 worktree 统一做 | 发 S2 结构化报告 Lead（文件/提交/测试/接口/问题/下一步）；随后 S3 比较区（A01–A05 卡片化接入） |
| 2026-10-27 | **W1-S3 比较区完成**（A01 上期收支比较、A02 环比增长率、A03 同比增长率、A04 多个月份比较、A05 本月至今同期比较）：①适配层 `apps/web/src/lib/analysisData.ts` 新增 `derivePeriodComparison`（A01/A02/A03/A05：消费 shared `computePeriodComparison`，覆盖未知时把 `coverageEnd` 收窄到最早窗口前一天使金额/差额/增长率一律 null；`assertComparisonSpan` 参数化 400 日上限；结果带 `ComparisonAnalysisView` 暴露 `side`、按 kind 的真实区间文案素材）/ `deriveMultiMonthComparison`（A04：消费 `computeMultiMonthComparison`，月份键保序去重、`assertComparisonMonthCount` 按 S-01 v2 §17 draft 限制 36 月、越界抛 `AnalysisRangeError('analysis-range-too-long')` 不截断、`readMultiMonthTotal()` 只在全部月份完整时给总额）；②hooks `usePeriodComparison`/`useMultiMonthComparison`（复用同一 ledger store 读取）；③卡框架 `MonthComparisonCard`（A04 新卡壳：标题/总额/说明/caption/notes/双柱图，复用 B-3 `MonthComparisonChart`；含进行中/未知月时 `totalText` 必须为 null，不显示小计）；④复用 B-3 已验收 `PeriodComparisonCard`/`PeriodComparisonBars`（零改动）；⑤所有文案/数值格式由调用方传入（组件不产中文）；⑥不新增/修改任何 S-01 形状、未接页面、未改 `StatsPage.tsx`/`FxStats.tsx`/API/版本号 | `apps/web/src/lib/analysisData.ts`（扩展）、`analysisData.test.ts`（S3 +6，共 40）、`apps/web/src/lib/useTimeAnalysis.ts`（+2 hooks）、`apps/web/src/components/charts/MonthComparisonCard.tsx`、`comparisonCards.test.tsx`（新，6）、本文件、协议草案 §19 | `32d90c7`（本地；不 push） | `pnpm --filter @libellum/web exec vitest run src/lib/analysisData.test.ts src/components/charts/comparisonCards.test.tsx` → 2 文件/46 用例全过；`apps/web` 全量 vitest、`tsc -b`、`check:docs` 见本批报告；无 shared 改动（无需重跑 shared） | 无公共接口变化；仅新增 web 层适配函数/hooks/卡框架（S0 单一入口，未接 S-01 信封） | S-01 v2 未冻结（D 复核通过、待所有者签认），本批未触及 G-16/G-17 形状；A04 的 36 月上限为 S-01 v2 §17 draft；页面接线仍由 Lead 在集成 worktree 统一做 | 发 S3 结构化报告 Lead（文件/提交/测试/接口/问题/下一步）；随后 S4 新增分析区（I12/I13/A12/A13/A14/A18/A19/A20 卡片化接入） |
| 2026-10-27 | **W1-S4b B-Q20 修正**（Lead 裁定「今天/进行中桶不入统计样本」落地）：`analysisData.deriveMovingAverage` 把 `state === "in-progress"` 桶按未知（`amountMinor=null`、`transactionCount=null`）喂给 shared 引擎，含该日窗口明确 `window-incomplete`、不补零；`MovingAverageAnalysisView` 新增 `todayExcluded`/`excludedInProgressDays`；`MovingAverageCard` 新增 `excludedInProgress`/`excludedTodayText`（排除时强制渲染）；协议 §21 第 3 条改写；测试 ①今天进行中→样本不含今天且说明必显 ②无进行中→行为不变 | `apps/web/src/lib/analysisData.ts`、`components/charts/MovingAverageCard.tsx`、`lib/s4b.analysisData.test.ts`、`components/charts/movingAverageCards.test.tsx`、本文件、协议草案 §21 | `07f1be5` | `s4b.analysisData.test.ts` 8/8；`movingAverageCards.test.tsx` 4/4；定向 2 文件 12/12；`tsc -b` exit 0；`apps/web` 全量 vitest **172 文件/1568 用例全过** | 仅新增 view/卡片可选字段（向后兼容；旧调用不传 `excludedInProgress` 时行为不变） | 完整日窗口数值不变；仅排除进行中桶后受影响窗口转 unknown；S-01 v2 文字由 A 在冻结后最小批次补 | 发 Lead；随后 S4c（A18/A19） |
| 2026-10-27 | **W1-S4b 完成**（A13 七日移动平均、A14 三十日移动平均卡片化）：①`analysisData` 新增 `MOVING_AVERAGE_WINDOWS`（7/30）、`MovingAverageAnalysisQuery`/`MovingAverageAnalysisView`、`deriveMovingAverage`（读取区间向历史扩展 `windowDays-1` 天、`visibleMovingAverage` 裁剪回可见区间并重算 `observedDays/computablePoints/unknownWindowPoints/missingHistoryPoints/complete`；非正整数窗口抛 `AnalysisRangeError("analysis-range-invalid")`）、`useMovingAverage` hook；②卡片 `MovingAverageCard`（内嵌 B-4 `MovingAverageChart`，原始 + 移动平均双序列，`data-window` 明示 7/30，`result` 可 null 只渲空状态、`sampleText` 必显）；③协议草案 §21 锁定语义（历史扩展只改读取不改可见、窗口必须完整不补零不插值、精确分数、A13/A14 各自一卡、页面接线归 Lead） | `apps/web/src/lib/analysisData.ts`、`useTimeAnalysis.ts`、`components/charts/MovingAverageCard.tsx`、`lib/s4b.analysisData.test.ts`、`components/charts/movingAverageCards.test.tsx`、本文件、协议草案 §21 | `3484321` | `s4b.analysisData.test.ts` 7/7；`movingAverageCards.test.tsx` 3/3；`tsc -b` exit 0；`apps/web` 全量 vitest **172 文件/1566 用例全过** | 无公共接口变化；仅新增 web 层适配/hook/卡片（S0 单一入口，未接 S-01 信封；不新增/修改形状） | 进行中今天原按 shared 部分日口径参与；已被 B-Q20 裁定修正（见上一行）；页面接线归 Lead | 发 S4b 结构化报告 Lead；随后 S4c（A18/A19） |
| 2026-10-27 | **W1-S4c 完成**（A18 季节性描述性比较、A19 支出异常峰值卡片化）：①`analysisData` 新增 `SEASONAL_MAX_MONTHS = 36`、`SeasonalAnalysisQuery`/`SeasonalAnalysisView`/`deriveSeasonalComparison`（自然月跨度预检、越界 `analysis-range-too-long` 不截断；month view；`descriptiveOnly`/`descriptiveReason` 随 shared 结果透出）；`AnomalyAnalysisQuery`/`AnomalyAnalysisView`/`deriveAnomalyAnalysis`（400 日上限、只取 complete 日、`todayExcluded`/`sufficientSample`、样本不足空 marks）；②`useTimeAnalysis` 新增 `useSeasonalAnalysis`/`useAnomalyAnalysis`；③卡片 `SeasonalComparisonCard`（`SeasonalComparisonChart` 跨年同月轴、`data-descriptive-only`、进行中月保留部分金额但不可比）、`AnomalyPeaksCard`（`AnomalyMarkerChart` 标记 + 排行列表、无基线空状态、无异常日文案）；④协议草案 §22 锁定语义（只描述不推断、上限显式拒绝、只画月视图、今天不入样本、判定口径全部来自 shared、页面接线归 Lead） | `apps/web/src/lib/analysisData.ts`、`apps/web/src/lib/useTimeAnalysis.ts`、`apps/web/src/components/charts/SeasonalComparisonCard.tsx`、`AnomalyPeaksCard.tsx`、`apps/web/src/lib/s4c.analysisData.test.ts`、`apps/web/src/components/charts/seasonalAnomalyCards.test.tsx`、本文件、协议草案 §22 | `041d7ec` | `s4c.analysisData.test.ts` 9/9；`seasonalAnomalyCards.test.tsx` 5/5；`tsc -b` exit 0；`apps/web` 全量 vitest **174 文件/1582 用例全过** | 无公共接口变化；仅新增 web 层适配/hooks/卡片（S0 单一入口，未接 S-01 信封；不新增/修改形状） | A18 本批只出月视图卡（季度分组 shared 支持但不出卡）；A19 基线只用完整日、进行中今天永不成为标记；σ/CV 与 method 串仍标「待冻结核对」；页面接线归 Lead | 发 S4c 结构化报告 Lead；之后待命，等 S-01 v2 冻结后最小批次（σ/CV 映射 + method 串统一） |
| 2026-10-27 | **s01-v2 冻结后最小批次完成**（B 侧表示法/串对齐，additive；不改任何财务数值语义）：①`variability.ts` 追加 `Ratio`/`SqrtValue`/`VarianceKind`/`CoefficientsOfVariation` 与 `standardDeviation`/`varianceKind`/`coefficientsOfVariation`/`standardDeviationScaled`（σ 总体口径精确有理数、`decimalText` 展示用、μ=0/n=0 → `null` 不补 0；CV 无量纲 `fraction`；旧 `stdDevScaledMinor`/`coefficientOfVariationScaled` 保留兼容）；②新增 `analysisMethod.ts`（9 个规范串 + 旧串别名输入归一 + `anomalyMethodString`），`anomaly.ts` 结果增 `methodString`（`mad-median-v1`/`iqr-quantile-v1`/`percentile-threshold-v1`，`method` 不变）；③协议草案 §4.2 补 G-27 一行（C `partial` 仅 FX 不完整 → `unavailable`/`fx-incomplete`；非 FX → 按自身原因；P16 三态不引入 `partial`），新增 §23 表示法与 method 串映射；④未改形状/字段语义/版本串/页面/API | `packages/shared/src/variability.ts`、`variability.test.ts`、`analysisMethod.ts`、`analysisMethod.test.ts`、`anomaly.ts`、`anomaly.test.ts`、`packages/shared/src/index.ts`、`apps/web/src/i18n/sharedMessages.test.ts`、协议草案 §4.2/§23、本文件 | `6a94608` | shared 34 文件/**543 用例全过**（3 skipped，FX_PERF 门控）；web 全量 **174 文件/1582 用例全过**；`tsc -b packages/shared apps/web` exit 0；`check:docs`/`check:status` 通过 | 新增公共导出：`analysisMethod`（`ANALYSIS_METHOD`/`canonicalMethod`/`anomalyMethodString`/别名表）与 variability 的 `Ratio`/`SqrtValue`/`CoefficientsOfVariation`/`VarianceKind` 字段；全部为新增，未删/未改既有语义；`S01_PROTOCOL_VERSION` 未改（由 Lead 统一发布） | 未实现 `SqrtValue.decimalText` 精确十进制生成器（现由调用方/展示层按 `radicand` 展开，`decimalText` 允许空串占位）；完整 method 注册表待与 A 下一批对齐；页面接线归 Lead | 待命（等下一批指令/W3）；W3 依赖 S-01/S-02/S-03 |
| 2026-10-27 | **s01-v2 v2.0.1 修正完成**（回应 Lead m05439；暂停批次后按 A `492b1b6`/`6f72f9f` 澄清重做 method 串口径，不改任何形状/财务语义）：①`analysisMethod.ts` 重写为三层——`ANALYSIS_METHOD`（内部 id，`formula` 字段用）/`FROZEN_METHODS`（冻结登记值 `population-stddev`/`sample-cv-fixedpoint`/`mad-median`/`iqr-quantile`）/`OPEN_EXTENSION_METHODS`（开放扩展，标注不宣称已支持）；`canonicalMethodString` 同一方法的历史形态统一输出冻结值，未知串原样；新增 `methodSupport`（`frozen`/`open-extension`/`unregistered`）与 `isFrozenMethod`；②`type7-linear` 明确不冒充（B 分位阈值是 nearest-rank，非 Type 7 线性插值；输入原样返回、登记 `unregistered`）；③`SqrtValue.decimalText` 按 v2.0.1 不强制（允许 null/空串；若提供必须 `decimals=6` 一次 `minor-half-away-v1`，不得浮点/二次舍入）；④`anomalyMethodString` 输出冻结值（`mad-median`/`iqr-quantile`/`quantile-threshold`），`AnomalyResult.method`/`methodString` 既有形状不变；⑤协议草案 §23.2/§23.4 更新并新增 §23.5 | `packages/shared/src/analysisMethod.ts`、`analysisMethod.test.ts`、协议草案 §23.2/§23.4/§23.5、本文件 | `aef325d` | `analysisMethod.test.ts` 7/7（冻结字面量逐字、三层分表、type7 不冒充、未知串原样）；shared 全量 **34 文件/546 用例 + 3 skipped**；`tsc -b packages/shared` exit 0 | 未新增/修改公共形状与字段语义；`ANALYSIS_METHOD`/`canonicalMethodString`/`anomalyMethodString` 仍导出（语义按 v2.0.1 收紧：输出冻结值纯字面量）；`S01_PROTOCOL_VERSION` 未改 | 完整 method 注册表扩展开放扩展仍待与 A 对齐；冻结值只用于对外宣称/展示，内部 `formula` 不变 | 回执 Lead（暂停后修正 + 证据）；之后待命 |

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
| B-5 验收对照（§37/§44） | `docs/archive/design/S17-B-验收对照-37-44.md` | 24 项能力×实现/测试/图表家族；§44 的 17 条验收条件逐条标注完成/部分/外部依赖 |
| B-5 跨 Agent 口径（B-17） | `docs/specs/design/S17-B-跨Agent时间口径.md` | 桶键格式（日/ISO 周/月/年）、五态、闰年/周一起始、P14/P15 对齐点、对外 API 清单；供 C 直接复用 |
| B-5 协议映射与语义锁定 | 协议草案 §14 | B-5 不新增形状；性质测试=协议回归、家族声明不引入新形状、B-16 参数化、B-17 唯一实现归属建议、区间上限调用方契约、不冻结 |
| B-6 rebase/W1 预研 | `docs/archive/design/S17-B-B6-1.16.23-rebase与W1集成预研.md` | 1.16.23 发布事实（`207a5ad`/`d4e4fd8`）；rebase 冲突面清单与 0 冲突预演（tree `124e796`）+ 步骤/验证/风险分级；W1 24 项接入点、依赖、工作量（15–22 人日）、URL 状态扩展、详情页来源跳转；综合模式 FX 扩展提案与 14→36 月限制；R-B6-1～R-B6-6 与三条决策请求 |

| S-01 v2 B 侧提案（draft） | `docs/specs/product/s17-agents/S17-Agent-B-S01-v2提案-汇率逐笔扩展与月键上限.md` | `B-S01v2-01` 逐日/逐笔投影 additive 提案 + `B-S01v2-02` 36 月上限；性能验证计划、兼容性影响、Q-BP-1～5；已提交 A 汇总（`9d77b06`），draft 实现见协议草案 §15.1 |
| FX 逐日/逐笔扩展（draft 实现） | `packages/shared/src/fx.ts`、`fxDetail.test.ts`、`fxPerformance.test.ts` | `aggregateFxDetailed`/`aggregateFxDetailedAsync`（daily 恒输出、entries 可选、同源且不二次舍入、超限/取消规则）、`fxRangeMonths`/`FX_MAX_RANGE_MONTHS=36`、`FX_MAX_DETAIL_ENTRIES=50_000`；`FX_PERF=1` 门控性能用例；web `fxView.rangeMonths` 14→36 参数化（唯一消费方、页面未改） |
| FX 扩展实现状态与性能 | 协议草案 §15.1、`docs/specs/design/S17-B-性能基线.md` §6 | 实现状态、实测数字（1M daily 13.6s / 200k entries 2.7s / 10k×36 月 0.54s）、W1 接入建议（daily-only 图表、逐笔仅详情视图 + `maxEntries`、200k+ 异步批次） |
| G-17 正式定义（S-01 v2 G 组） | `docs/specs/product/s17-agents/S17-Agent-B-S01-v2提案-汇率逐笔扩展与月键上限.md` §16 | 「FX 逐笔/逐日投影」正式定义：形状（`FxAggregateDetail`/`FxConvertedEntry`/`FxDetailOptions`/`FxDetailedAggregate`/`aggregateFxDetailed*`/`fxRangeMonths`）、12 条不变量（additive/同源/守恒/缺失≠0/不截断/保护默认/异步=同步/范围币种/审查投影/月键上限/不同轴/性能）、默认值表与冻结规则；供 A 合并进 v2（G-16 归 C 的 `DraftCategoryRelation`） |
| W1 原币 24 项接入切分方案（规划，未实施） | `docs/archive/design/S17-B-W1-原币24项接入切分方案.md` | S0 数据/URL 层（`statsView` 扩展、`useAnalysis` hooks、`localAnalysis` 离线、失效联动）→ S1 趋势（I06–I10/I19count/I20/I11）→ S2 类别（I14–I16）→ S3 比较（A01–A05）→ S4 新增分析（I12/I13/A12/A13/A14/A18/A19/A20）→ S6 集成测试；S5 综合模式另列（依赖 G-17 冻结）；每项列 shared 函数/组件/页面只读替换点/测试计划/工作量/风险；§5 给 `StatsPage.tsx`/`FxStats.tsx` 替换点行号（343/57 行，只读）；§7 待批事项（W1 放行、S-01 信封、G-17 冻结、14→36 月页面行为、R-B-02/04） |
| W1-S0 适配层与首张时间卡片（已实施，`b5a8e55`） | `apps/web/src/lib/analysisData.ts`、`apps/web/src/lib/useTimeAnalysis.ts`、`apps/web/src/components/charts/DailyExpenseTrendCard.tsx` 及 3 个测试文件 | S0 数据接入与口径统一：半开区间/400 日上限/设备本地 `today`/剔除 transfer 与软删除/CSV 多币种不合并/coverage 双策略/query key `["analysis", query]`；I06 每日支出趋势最小卡片（真实数据验证）；未接页面、未新增 API |
| W1-S0 夹具真实数据 E2E 证据（2026-10-27） | `_backups/w1-s0-e2e-zh.png`、`_backups/w1-s0-e2e-dark.png`、`_backups/w1s0-buckets.json`、`_backups/w1s0-sql-daily.csv`（均 gitignored） | 夹具库脱敏数据：19 个有数据日逐桶金额/笔数与 SQL 全币种聚合完全一致（合计 739,427 分 = 7,394.27；CNY 715,797 + HKD 8,600 + USD 15,030）；今日桶 in-progress → complete=false；中文亮色 + 暗色两张截图；临时 harness 已删除、工作区 clean |
| W1-S1 时间趋势适配层（2026-10-27） | `apps/web/src/lib/analysisData.ts`（扩展）、`apps/web/src/lib/useTimeAnalysis.ts` | 新增 `trailingWeekWindow`（周一起自然周，末桶裁剪）、`trailingMonthWindow`（自然月，跨年）、`deriveCumulativeAnalysis`（I20，未知向后传播）、`deriveFlowAnalysis`（I11，收支同轴）；类型 `CumulativeAnalysisView`/`FlowAnalysisQuery`/`FlowAnalysisView`；hooks `useCumulativeAnalysis`/`useFlowAnalysis`；全部复用 S0 的 400 日上限/设备本地 today/coverage 双策略 |
| W1-S1 时间趋势卡片（2026-10-27） | `apps/web/src/components/charts/TimeSeriesCard.tsx`、`CumulativeExpenseCard.tsx`、`IncomeExpenseCard.tsx` | `TimeSeriesCard` 覆盖 I07/I08/I09/I10/I19（line/area/bar，未知/进行中沿用 `SeriesTrendChart`）；`CumulativeExpenseCard` 覆盖 I20（首个未知桶断线、平台保留）；`IncomeExpenseCard` 覆盖 I11（收入/支出独立总额、同轴双序列）；文案/格式全部 props 传入，组件不产中文 |
| W1-S1 测试（2026-10-27） | `apps/web/src/lib/analysisData.test.ts`（23 用例）、`apps/web/src/components/charts/timeSeriesCards.test.tsx`（5 用例） | 新增窗口（周/月、跨年、非法参数）、累计（精确累加、未知断链）、收支同轴（总额、覆盖未知不冒充已知）、卡片（总额/说明/累计断点/两独立总额/英文无 CJK） |
| W1-S2 类别区适配层（2026-10-27） | `apps/web/src/lib/analysisData.ts`（扩展） | `toCategoryEntries`（保留 kind，排除 transfer/软删除/未知分类）、`deriveCategoryAnalysis`（I15，`kind` 过滤 + 稳定 `categoryId` 聚合 + `includeOther` 的 `__other__` 派生）、`deriveCategoryTrend`（I14）、`rankCategories`（I16 排行，并列共享名次、`limit` 在“其他”外生效）；类型 `CategoryAnalysisQuery`/`CategoryAnalysisView`/`CategoryTrendQuery`/`CategoryRankingRow` |
| W1-S2 类别区图表（2026-10-27） | `apps/web/src/lib/chart/categoryChart.ts`（扩展）、`apps/web/src/components/charts/CategorySeriesChart.tsx`、`CategoryCompositionCard.tsx`、`CategoryShareCard.tsx`、`CategoryTrendsCard.tsx`、`CategoryDataTable.tsx` | `buildCategorySeriesModel`（多折线/面积/分组柱，未知断线、零点画点、柱高 ≥1px、共同零基线）；`CategoryCompositionCard` 覆盖 I15 堆叠；`CategoryShareCard` 覆盖 I16 100% 占比带（零总额/未知不绘制）；`CategoryTrendsCard` 覆盖 I15 多折线/分组柱；`CategoryDataTable` 覆盖金额/占比表格（未知显示“—”，滚动条按仓库规则隐藏）；文案/标签/格式化全部 props 传入 |
| W1-S2 测试（2026-10-27） | `apps/web/src/lib/analysisData.test.ts`（30 用例）、`apps/web/src/lib/chart/categoryChart.test.ts`（+3）、`apps/web/src/components/charts/categoryCards.test.tsx`（新，7 用例） | 新增 kind 过滤/`__other__` 守恒/占比分母/未知不补零/I14 与 I15 逐桶一致/排行并列与 limit、模型 3 形态与断线、卡片渲染 5 组件（英文无 CJK、未知“—”、零总额不伪造 0%） |
| W1-S3 比较区适配层（2026-10-27） | `apps/web/src/lib/analysisData.ts`（扩展）、`apps/web/src/lib/useTimeAnalysis.ts` | `derivePeriodComparison`（A01/A02/A03/A05：`ComparisonAnalysisView`，`assertComparisonSpan` 400 日上限参数化，覆盖未知时 `coverageEnd` 收窄到最早窗口前一天，金额/差额/增长率 null）/ `deriveMultiMonthComparison`（A04：`assertComparisonMonthCount` 36 月 draft 上限、越界抛 `analysis-range-too-long`、`readMultiMonthTotal` 只在全部月份完整时给总额）；hooks `usePeriodComparison`/`useMultiMonthComparison`；类型 `ComparisonAnalysisQuery`/`ComparisonAnalysisView`/`MultiMonthAnalysisQuery`/`MultiMonthAnalysisView` |
| W1-S3 比较区卡框架（2026-10-27） | `apps/web/src/components/charts/MonthComparisonCard.tsx`（新）；复用 B-3 `PeriodComparisonCard.tsx`、`PeriodComparisonBars.tsx` | `MonthComparisonCard`：标题/总额（全部月完整才显示）/说明/caption/notes/双柱图（复用 `MonthComparisonChart`）；含进行中/未知月时 `totalText` 必须为 null；所有文案/数值格式由 props 传入，组件不产中文 |
| W1-S3 测试（2026-10-27） | `apps/web/src/lib/analysisData.test.ts`（40 用例）、`apps/web/src/components/charts/comparisonCards.test.tsx`（新，6 用例） | S3 +6：四种比较 kind、覆盖未知全 null、36 月上限抛错、闰日对齐透传、多月份总额/进行中不可比；卡片 6：双柱两组、覆盖未知空状态、比较卡真实区间/增长率不可用原因、A04 确认总额/进行中无小计+仍显示轴标签/未知空状态 |
| W1-S3 协议映射（2026-10-27） | 协议草案 §19 | A01–A05 消费层映射；不新增/修改 S-01 形状；不可比/未知不装作完整、36 月上限 draft、A04 总额只在全完整时显示、比较 kind 不混名、卡不重算金额 |
| W1-S4a 波动/收入稳定/星期分布适配层（2026-10-27） | `apps/web/src/lib/analysisData.ts`（扩展）、`apps/web/src/lib/useTimeAnalysis.ts` | `AnalysisCoverage`（`local-ledger`/`unknown`）、`coverageEndFor`（unknown → 区间起点前一天）、`hasCompleteObservation`；`deriveDailyExpenseVariability`（I12/A12，先 day 序列再 `computeDailyExpenseVariability`，`extremeSigma` 可配）、`deriveIncomeStability`（A20，month、`minSampleMonths`）、`deriveWeekdayAnalysis`（I13，`computeWeekdayPattern`，kind all/expense/income）；hooks `useDailyExpenseVariability`/`useIncomeStability`/`useWeekdayAnalysis` |
| W1-S4a 卡片（2026-10-27） | `apps/web/src/components/charts/VariabilityCard.tsx`、`IncomeStabilityCard.tsx`、`WeekdayPatternCard.tsx` | `VariabilityCard` 内嵌 `VolatilityBandChart`，`result` 可 null、`sampleText`/`stateText` 必传；`IncomeStabilityCard` 显示 `judgedState` 与样本句；`WeekdayPatternCard` 内嵌 `WeekdayBars`，`mode: "total" \| "average"` 由调用方决定并以 `data-mode` 明示；文案/格式化全部 props 传入，组件不产中文、不算统计量 |
| W1-S4a 协议映射（2026-10-27） | 协议草案 §20 | I12/A12、A20、I13 消费层映射；不新增/修改 S-01 形状；无完整观测不造数、样本必须可见、σ/CV 待冻结核对、total/average 不混用、半开区间/进行中今天不入样、页面接线归 Lead |
| W1-S4a 测试（2026-10-27） | `apps/web/src/lib/s4a.analysisData.test.ts`（8 用例）、`apps/web/src/components/charts/stabilityCards.test.tsx`（6 用例） | 覆盖：波动统计量（observedCount/sum/min/max/极值日/scale=6 均值）、unknown 覆盖 result=null、非法 `extremeSigma` 抛错、收入稳定 `judgedState`/样本不足、星期分布 observedDays/average 分母/unknown 全 null、卡片空状态与样本句/mode 渲染 |
| W1-S4b 移动平均适配层（2026-10-27） | `apps/web/src/lib/analysisData.ts`（扩展）、`apps/web/src/lib/useTimeAnalysis.ts` | `MOVING_AVERAGE_WINDOWS = [7, 30]`；`MovingAverageAnalysisQuery`/`MovingAverageAnalysisView`；`deriveMovingAverage`（向历史扩展 `windowDays-1` 天后把 points/计数裁剪回可见区间，`visibleFrom`/`historyDays` 明示；非正整数抛 `AnalysisRangeError("analysis-range-invalid")`）；`useMovingAverage` hook。**不新增 S-01 形状**，只消费 shared `MovingAverageResult` |
| W1-S4b 卡片（2026-10-27） | `apps/web/src/components/charts/MovingAverageCard.tsx` | 内嵌 B-4 `MovingAverageChart`（原始折线 + 平均折线/点）；`windowDays` → `data-window` 明示 7/30；`result` 可 null 时只渲 `emptyText`、`sampleText` 必传；图例/提示/格式化全部 props 传入，组件不产中文、不算平均、不补零 |
| W1-S4b 协议映射（2026-10-27） | 协议草案 §21 | A13/A14 消费层映射；历史扩展只改读取范围不改可见范围、窗口必须完整（`window-incomplete`/`insufficient-history` 不补零不插值）、**进行中今天不入样本**（B-Q20：桶按未知喂引擎、`todayExcluded`/`excludedInProgressDays` 上报、卡片 `excludedTodayText` 强制说明）、精确分数与 `averageScaledMinor` 仅展示、A13/A14 各自一卡、页面接线归 Lead |
| W1-S4b 测试（2026-10-27） | `apps/web/src/lib/s4b.analysisData.test.ts`（8 用例）、`apps/web/src/components/charts/movingAverageCards.test.tsx`（4 用例） | 覆盖：历史扩展后首可见点可算（分子含区间前历史）、可见计数不含补读历史、30 日窗口、B-Q20 今天排除（尾点 `window-incomplete`、完整日分子不变）+ 无进行中行为不变、unknown 覆盖全不可算、`scale` 只影响展示、非法窗口抛错；卡片双序列图例/样本行、`data-window` 区分、排除今天说明、空状态 |
| W1-S4b B-Q20 修正（2026-10-27） | `apps/web/src/lib/analysisData.ts`、`components/charts/MovingAverageCard.tsx` | 进行中桶按 `amountMinor=null` 喂 shared 引擎；view 增 `todayExcluded`/`excludedInProgressDays`；卡片增 `excludedInProgress`/`excludedTodayText` 并在排除时渲染 `data-testid="moving-average-card-excluded-today"`；完整日窗口数值不变 |
| W1-S4c 季节性/异常适配层（2026-10-27） | `apps/web/src/lib/analysisData.ts`（扩展）、`apps/web/src/lib/useTimeAnalysis.ts` | `SEASONAL_MAX_MONTHS = 36`；`SeasonalAnalysisQuery`/`SeasonalAnalysisView`（`deriveSeasonalComparison`：自然月跨度 `monthCount` 预检，>36 抛 `AnalysisRangeError("analysis-range-too-long")` 不截断；`coverageEndFor`；month view 收窄）；`AnomalyAnalysisQuery`/`AnomalyAnalysisView`（`deriveAnomalyAnalysis`：`assertAnalysisSpan` 400 日、day 桶、`detectDailyExpenseAnomalies`、`observedDays`=complete 桶数、无完整日时 `result=null`）；hooks `useSeasonalAnalysis`/`useAnomalyAnalysis`。**不新增 S-01 形状**，只消费 shared `SeasonalComparisonResult`/`AnomalyResult` |
| W1-S4c 卡片（2026-10-27） | `apps/web/src/components/charts/SeasonalComparisonCard.tsx`、`AnomalyPeaksCard.tsx` | 内嵌 B-4 `SeasonalComparisonChart`（12 月分类轴、跨年同月）与 `AnomalyMarkerChart`（标记 + 折线）；`data-descriptive-only` 明示描述性；进行中月保留“已确认部分金额”（`data-partial`）但标注不可比；无基线只渲 `emptyText`、样本不足/无异常用调用方文案；标记/阈值/排名全部来自 shared，组件不判异、不产中文 |
| W1-S4c 协议映射（2026-10-27） | 协议草案 §22 | A18/A19 消费层映射；上限显式拒绝不截断、只描述不推断、进行中月不可比、只画月视图、今天不入样本（`todayExcluded`）、判定口径全部来自 shared、页面接线归 Lead |
| W1-S4c 测试（2026-10-27） | `apps/web/src/lib/s4c.analysisData.test.ts`（9 用例）、`apps/web/src/components/charts/seasonalAnomalyCards.test.tsx`（5 用例） | 覆盖：跨年同月 14 月、单年描述性、unknown 覆盖、当前月保留部分金额不可比、36 月上限、按季分组、MAD 标记、今天不入样本、样本不足空 marks、无 complete 日、卡片月视图/描述性说明/空状态/无异常文案/排行 |
| s01-v2 σ/CV 表示法（2026-10-27） | `packages/shared/src/variability.ts`（扩展）、`variability.test.ts`（+3 用例） | `Ratio { numerator, denominator }`、`SqrtValue { radicand, decimalText, decimals }`、`VarianceKind = "population"`、`CoefficientsOfVariation { standardDeviation, mean, scale: "fraction", decimalText }`；`AmountSummary.standardDeviation/varianceKind/coefficientsOfVariation/standardDeviationScaled` 新增（旧 `stdDevScaledMinor`/`coefficientOfVariationScaled` 保留）；σ² 精确有理数、μ=0/n=0 → null、不补 0、不出现浮点 |
| analysisMethod 三层口径（2026-10-27，v2.0.1 修正后） | `packages/shared/src/analysisMethod.ts`（新）、`analysisMethod.test.ts`（新，7 用例）、`packages/shared/src/index.ts` | `ANALYSIS_METHOD`（B 内部 id，`formula` 用）/`FROZEN_METHODS`（冻结登记值 `population-stddev`/`sample-cv-fixedpoint`/`mad-median`/`iqr-quantile`）/`OPEN_EXTENSION_METHODS`（开放扩展，不宣称已支持）三层分表；`canonicalMethodString` 历史形态统一输出冻结值、未知串原样；`methodSupport`/`isFrozenMethod`；`type7-linear` 登记 `unregistered`（B 分位为 nearest-rank，不得冒充）；`index.ts` 导出块 |
| anomaly methodString（2026-10-27，v2.0.1 修正后） | `packages/shared/src/anomaly.ts`、`anomaly.test.ts` | `AnomalyResult.methodString` 新增（`method` 与 `methodString` 并存、不同源）；输出冻结值：`mad`→`mad-median`、`iqr`→`iqr-quantile`、`zero-dispersion-quantile`→`quantile-threshold`（开放扩展） |
| v2.0.1 澄清对齐（2026-10-27） | 协议草案 §23.2（重写）/§23.4（decimalText）/§23.5（新） | 冻结 method 字面量逐字、内部 id 不外泄、`type7-linear` 不冒充、`decimalText` 不强制（若提供 `decimals=6` 一次 half-away）；三层结构记录 + 本批修正依据（Lead m05439、A `492b1b6`/`6f72f9f`） |
| s01-v2 协议映射（2026-10-27） | 协议草案 §4.2（G-27 一行）、§23（新） | §4.2 补 C `partial` 仅 FX 不完整 → `unavailable`/`fx-incomplete`、非 FX 按自身原因、P16 三态不引入 `partial`；§23 记录 23.1 σ/CV 表、23.2 method 串与别名表、23.3 G-27 指针、23.4 本批未做 |
| s01-v2 归类登记（2026-10-27） | `apps/web/src/i18n/sharedMessages.test.ts` | `FULL_FILES` 加 `analysisMethod.ts`（仅注释中文，扫描器跳过注释，无需新译文） |
| 移动平均卡接口说明（2026-10-27，给 Claude 前端适配层） | `docs/specs/product/s17-agents/S17-Agent-B-移动平均卡接口说明-20261027.md`（新，只读文档） | 卡片 props 表 + DOM 契约、`deriveMovingAverage` 输入输出与 8 条不变式、`useMovingAverage` 数据源/查询键、冻结契约 vs UI 投影、3 个真实数据示例（来源 `s4b.analysisData.test.ts`）、最小集成验收挂载点与检查清单、明确不做 FX/不重算/不改 DOM 契约；**不改代码/形状/API** |

**环境说明（本地验证）**：本 worktree 首次使用需 `pnpm install --offline`（本地 pnpm store 已具备依赖）；Prisma 7 的 `prisma.config.ts` 要求 `DATABASE_URL` 环境变量存在，生成客户端用 `DATABASE_URL=postgresql://... pnpm db:generate`（生成不连库，生成物 `apps/api/src/generated/prisma/**` 被 gitignore）。API 集成测试需要根目录 `.env` 的 `TEST_DATABASE_URL`（测试库名必须含 `test`，见 `apps/api/test/setup.ts` 的守卫）；本工作区 `.env` 为本地开发文件，**不入库**。Windows 下若 PowerShell 执行策略拦截 `pnpm.ps1`，改用 `$pnpm = Join-Path $env:APPDATA "npm\pnpm.cmd"; & $pnpm ...`。API 集成测试当前 611/612：唯一失败是本地测试库迁移落后 1.16.22 基线（`profile` 头像用例），与本分支改动无关，1.16.23 发布后统一 rebase 再跑（Lead 已确认）。

---

## 6.5 冻结前回执（2026-10-27，回应 Lead m05018；只读核对/文档级，未改实现）

**结论先行**：三项均**不需要改代码**；第 2 项需在协议 §4.2 补一行 C→B 映射说明（文档级，不影响字段）。

### 6.5.1 60 个月分析窗口 vs S16-D `FX_MAX_RANGE_MONTHS = 36`（G-18/#3）

- **B 的 W1 分析全部是原币路径**：`apps/web/src/lib/analysisData.ts:9` 注释「原币 first」，适配层只从 `toTimeSeriesEntries(transactions)` 读交易行，**不 import** `aggregateFx`/`useFxRange`/`fxView`。因此 60 个月的原币窗口不受 FX 读取上限约束（仅受分析自身上限：日窗口 `MAX_ANALYSIS_DAYS = 400`、季节性 `SEASONAL_MAX_MONTHS = 36`）。
- **折算模式唯一入口是 `useFxRange`**（`apps/web/src/lib/fxView.ts:80`）：月枚举 `rangeMonths`（`fxView.ts:62`）→ `fxRangeMonths`（`packages/shared/src/fx.ts:90`），超过 36 个月抛 `fx_range_too_long`（`fx.ts:96`）——**现状是显式拒绝，不是静默返回不完整数据**。`useFxRange` 另上报 `sourceComplete`（`fxView.ts:98/120/128`）表示离线设备数据不全，但当前**没有逐月 `fx-incomplete` 标记**。
- **未来 converted 接入（S5/折算模式，非本批）需要改的适配点**：① 请求 >36 月时捕获 `fx_range_too_long`，映射为 `fx-incomplete`/`analysisLimit` 显式原因，**不得降级成 36 月冒充完整**；② 消费 `sourceComplete` 与 `fxMonthCovered`（`fxView.ts:70`）→ 覆盖不足的月映射 `fx-incomplete`，卡片 `sampleText` 明示覆盖月数与截止月；③ 结果带 `analysisLimit` 记录实际折算月数。
- **协议级建议**（写入 S-01 v2，B 侧 §22 可加一句）：折算分析上限 = S16-D 的 36 月；超过必须显式拒绝或不完整并给可追溯原因；原币分析上限仍按 S-01 §17（400 日/36 月）。与所有者「不得静默返回不完整财务数据」要求一致。

### 6.5.2 G-27 `partial`→`fx-incomplete` 限定与 G-28a P16 状态

- B 的五态映射表在协议草案 §4.2（`S17-Agent-B-S01-时间扩展协议草案.md:344-356`）：`unavailable` 的 completeness 依原因细分为 `fx-incomplete`/`request-failed`/`no-permission`；`unknown` 统一 `offline-incomplete`；`in-progress` ≠ `partial`，`partial` 留给「区间内部分数据缺失」（该注在 §4.2 表下）。
- **确认与 B 映射一致**：`partial` 仅当原因来自 FX 不完整时 → B `unavailable` + `fx-incomplete`；其他原因（离线覆盖不全）→ B `unknown` + `offline-incomplete`；两者都要求 value = null、不计入 total（IV-07）。B 侧没有独立 `partial` 状态，不会把普通缺失误标 `fx-incomplete`。
- **需补的文档级说明**（B 侧，§4.2 可加一行）：`C partial(FX) → unavailable/fx-incomplete`、`C partial(非 FX) → unknown/offline-incomplete`；P16 三态（`complete`/`no-transactions`/`unavailable`，A 草案 `S17-Agent-A-S01-v2-结构草案.md:169/174`）不引入 `partial`；`in-progress` 是周期未完、不是完整性缺失。冻结后随最小批次补文档行，不改字段/形状/代码。

### 6.5.3 σ/CV 展示精度

- A12 结果（`packages/shared/src/variability.ts:189-235`）：`stdDevScaledMinor` = 币种最小单位 × `10^scale`（`DEFAULT_SCALE = 6`，`variability.ts:96/189`）；`coefficientOfVariationScaled` = **无量纲** fraction × `10^scale`（`cvScaled = sqrt(variance × scale²) / sum`，`variability.ts:204-205`；`scale` 可传，默认 6）。CV 不是货币最小单位，展示**不得**套用货币小数位舍入。
- σ 展示：按货币最小单位格式（现有 half-away 一次舍入的 `formatExactAmount` 路径）；CV 展示：按 `percent-100` 1 位小数（与 A r6 §16.6 一致）。`VariabilityCard` 只接收调用方格式化好的 `metrics: {label, value, note?}[]`（`VariabilityCard.tsx:6/22/85`），卡片内无任何舍入逻辑，因此展示调整只发生在页面/metric 组装层，**B 侧无实现差异**。
- 附：`formula.stdDev = "population-standard-deviation-v1"`、`formula.coefficientOfVariation = "coefficient-of-variation-v1"`（`variability.ts:234-235`），与 Lead 采纳的规范 method 串一致。

### 6.5.4 r7 受影响接口核对（2026-10-27，A r7 `9d82e81`）

**结论：B 受影响接口核对通过（r7 `9d82e81`）。** 仅核对 r7 涉及 B 的三项，未完整重评。

1. **#3 窗口三层事实（§16.7/§12/§7 G-09）→ ✅ 一致**：
   - r7 三层（S16-D 现状 14 月 → B draft 36 未生效 → 分析窗口默认 36/上限 60）与 B 实现/回执一致。逐点核对：①生产 1.16.23 基线 `apps/web/src/lib/fxView.ts:62-70`（`rangeMonths` 硬编码 `result.length > 14` 抛 `fx_range_too_long`，git `d4e4fd8` 版本）——r7 引「`fxView.ts:61-69`」行号指生产基线，事实正确；②B 工作分支 draft 已把 `rangeMonths` 委托 shared（`fxView.ts:62-64` → `fxRangeMonths`，`FX_MAX_RANGE_MONTHS=36`，`packages/shared/src/fx.ts:8/90-104`），未接入生产，与「draft 未生效」一致；③原币模式不受 FX 读取上限约束（B W1 全原币路径，见 §6.5.1）；④折算超当时生效上限必须显式拒绝（`fx_range_too_long`/`analysisLimit`）或整结果 `fx-incomplete`，禁止静默部分——与 B §6.5.1 回执、`fx.ts:96` 实现一致。
   - **文档级备注（非冲突）**：r7 行文中「web 实际仍 14」指 1.16.23 生产基线；B 工作分支（draft、未接入）中该函数已参数化为 36。建议 r7 补「生产基线」字样，避免与 B draft 分支混淆。
2. **G-27 映射行 → ✅ 一致**：r7「`partial→fx-incomplete` 仅汇率缺失/折算失败根因；fallback 成功不计 missing；P15/P16/P18 无 `partial`」与 B 五态映射（协议草案 §4.2：`unavailable` 依原因细分 `fx-incomplete`/`request-failed`/`no-permission`；`unknown`→`offline-incomplete`；`in-progress≠partial`）无冲突。B 侧唯一待补仍是 §4.2 一行 C→B 映射说明（冻结后最小批次）。
3. **σ/CV（§16.6）→ ✅ 口径一致，表示法备注**：r7「σ 最小单位定点（6 位小数）、CV 无量纲 `Ratio`；σ 按币种小数位一次 `minor-half-away-v1`、CV `percent-100` 1 位、不套货币舍入」与 B `variability.ts:189-235`（σ=`stdDevScaledMinor` scale 6；CV=`coefficientOfVariationScaled` fraction×10^scale，无量纲）一致。**表示法备注（非冲突）**：B 的 A12 结果用 `coefficientOfVariationScaled`（定点字符串）而非 `Ratio` 对象；r7 引用的 `formatRatioPercent`/`formatRatioMinorText` 在 B 仓库当前不存在（web 等价 `apps/web/src/lib/chart/format.ts:57 formatPercent(ratio,digits)`）——符号统一属 Codex 单一来源（G-31）/冻结后最小批次，展示口径一致。

### 6.5.5 T-8（`params.timeFixed` 枚举 / `resolvedPeriod`）快速回执（2026-10-27，A G-12a v1.1 `782b036` / r7.2 `b39b27a`）

1. **无影响**：B 仓库对 `timeFixed`/`pinnedRange`/`analysisDefinition`/`params_type` **零引用**（检索 `packages/shared/src`、`apps/web/src/lib`、`apps/web/src/components/charts`、`apps/web/src/pages` 无命中）；B 的 W1 分析由调用方直接传 `TimeSpan`（`analysisData.ts` 的 `AnalysisSpan`/`trailingWindow`/`assertAnalysisSpan`），**不经 analysisDefinition params、不自算卡片区间**，因此不依赖旧绝对 `timeFixed` 解析口径，无迁移/兼容动作。
2. **`resolvedPeriod` 暂无消费方，不阻塞**：B 时间序列结果使用自身 `span: TimeSpan` + 半开桶 key（`timeSeries.ts`），未消费结果级 `resolvedPeriod` 字段。B 已有只读对齐工具：`spanToInclusive(span) → {from,to}`（`packages/shared/src/timeCalendar.ts:189`，index 导出 `:112`）与 `bucketToInclusive(bucket)`（`:214`，index `:95`）；冻结后如需把 B 桶映射为 A 的 `ResolvedPeriod`（闭区间），可直接复用，**无需新增/修改 S-01 形状**。

> 证据均为只读核对（2026-10-27，HEAD 工作区）；本回执未改任何实现代码、未冻结任何接口。

### 6.6 s01-v2 冻结后最小批次（2026-10-27，B 侧表示法/串对齐；不改财务语义）

**依据**：Lead m05153（`s01-v2` 冻结 + 最小批次）与 m05203（批准范围）——只做三件：①σ/CV 表示法映射到 `SqrtValue`；②method 串以 B 的规范串为准、旧串改名；③G-27 文档行。**不新增/不修改任何 S-01 形状、不接页面、不改版本串、不碰 `StatsPage.tsx`/`FxStats.tsx`/API/Prisma。**

**1. σ/CV 表示法（`packages/shared/src/variability.ts`，additive）**

| 字段 | 类型 | 规则 |
|---|---|---|
| `standardDeviation` | `SqrtValue \| null` | `radicand = { numerator: bigint, denominator: bigint }` = 总体方差 `Σ(xᵢ−μ)²/n` 精确有理数；`decimalText` 展示用；`decimals`；μ=0 或 n=0 → `null`（不补 0） |
| `varianceKind` | `"population"` | 只实现总体口径；样本口径（n−1）需后续显式请求，本批不做 |
| `coefficientsOfVariation` | `CoefficientsOfVariation \| null` | `{ standardDeviation: Ratio, mean: Ratio, scale: "fraction", decimalText }`；无量纲，展示默认 `percent-100` 1 位小数由展示层换算，**不套货币最小单位舍入** |
| `standardDeviationScaled` | `string` | 兼容别名（与 `stdDevScaledMinor` 同值）；权威值以上表为准 |

旧字段 `stdDevScaledMinor`/`coefficientOfVariationScaled` **保留**（不删除、不改语义），避免既有消费方破坏；新字段全部 additive。`decimalText` 按 v2.0.1 **不强制**：允许 `null`/空串占位；如提供必须等于 `radicand` 按 `decimals = 6` 一次 `minor-half-away-v1` 展开（不得浮点、不得二次舍入），本批不生成精确长展开（见 §6.6.4）。

**2. method 串统一（`packages/shared/src/analysisMethod.ts`，新；v2.0.1 修正见 §6.6.4）**

- 三层分表：`ANALYSIS_METHOD`（B 内部 id，仅结果 `formula` 使用）、`FROZEN_METHODS`（冻结登记值，可对外宣称）、`OPEN_EXTENSION_METHODS`（B 开放扩展，标注不宣称已支持）。
- `canonicalMethodString(value)`：同一方法的历史形态（内部 id / 冻结别名）统一输出冻结值；未知串原样返回、不抛错；`methodSupport` 返回 `frozen`/`open-extension`/`unregistered`，`isFrozenMethod` 便捷判断。
- `anomalyMethodString(method)`：`mad`→`mad-median`、`iqr`→`iqr-quantile`、`zero-dispersion-quantile`→`quantile-threshold`（开放扩展）；`AnomalyResult.methodString` 新增（`method` 保留原枚举值，二者并存）。
- 未做：完整注册表扩展待与 A 下一批对齐；A 的旧版映射表对应关系由 A 更新（B 不改 A 文档）。

**3. G-27 文档行（协议草案 §4.2，文档级）**

`C partial` **仅当根因是 FX 不完整** → B `unavailable` + `fx-incomplete`；非 FX 原因 → 按自身原因（`unknown`/`offline-incomplete` 等）；P16 三态（`complete`/`no-transactions`/`unavailable`）**不引入** `partial`；`in-progress` 是周期未完、不是完整性缺失。B 的 W1 适配层走原币路径、不消费 FX 聚合，故**无代码改动**；未来 converted 模式 >36 月须显式 `fx-incomplete`/`analysisLimit`（见 §6.5.1）。协议草案 §4.2 与 §23 记录完整映射与「本批未做」。

**4. v2.0.1 修正（2026-10-27，回应 Lead m05439；暂停批次后重做）**

A 发布 s01-v2 v2.0.1（`492b1b6`/`6f72f9f`）澄清后，Lead 条件接收并要求暂停修正；本批按澄清重做 `analysisMethod.ts`（不新增/修改任何形状、不改财务数值语义）：

1. **method 字面量规范化**：对外支持值严格为 `population-stddev`/`sample-cv-fixedpoint`/`mad-median`/`iqr-quantile`；B 内部 id（`population-standard-deviation-v1` 等，含先前误作对外值的 `mad-median-v1`/`iqr-quantile-v1`/`percentile-threshold-v1`）只用于结果 `formula`，不得输出到对外字段。
2. **`type7-linear` 禁止冒充**：B 的 A19 分位阈值实现是 nearest-rank（`ceil(n·q)−1`），与 Type 7 线性插值不等价；`type7-linear` 不计入已实现方法（输入原样返回、登记 `unregistered`），`quantile-threshold` 标注为开放扩展、不与冻结值混列。
3. **`SqrtValue.decimalText` 不强制**：允许 `null`/空串；如提供必须按 `decimals = 6` 一次 `minor-half-away-v1` 展开（不得浮点/二次舍入）。

同步：协议草案 §23.2 重写、§23.4 更新、§23.5 记录本修正；`analysisMethod.test.ts` 重写为 7 用例（冻结字面量逐字、三层分表、type7 不冒充、未知串原样、开放扩展/未注册标记）。

**验证与边界（v2.0.1 修正后）**

- `pnpm --filter @libellum/shared test` → **34 文件/546 用例通过，3 skipped**（`fxPerformance.test.ts` 按 `FX_PERF` 门控）；`tsc -b packages/shared` exit 0。
- web 全量复跑、`check:docs`/`check:status` 见回执报告。
- 边界：未接页面、未改 `StatsPage.tsx`/`FxStats.tsx`/API/Prisma/版本号；未 merge/push/部署。
- 提交：`6a94608`（首提）→ v2.0.1 修正 **`aef325d`**（4 文件 +220/−72）；本回填提交仅改文档（提交号/统计口径）。

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
| B-Q18 | W1-S1 的 I 编号口径与交付顺序：Lead 建议顺序使用其编号（I07 收入趋势 I08 分类趋势 I09 收支对比 I10 累计 I19 笔数 I20 净额 I11 细化），与本规格编号（I06 日支出 / I07 日收入 / I08 周支出 / I09 月支出 / I10 月收入 / I19 笔数 / I20 累计支出 / I11 收支对比）不一致 | **已解决（2026-10-27，Lead）**：Lead 明确"按你 spec 编号为准，若与你任务文档排期冲突以你的为准并说明"。S1 按规格 §6–§18 实现 I06–I10/I19/I20/I11 全部时间序列；编号/顺序差异只影响页面排布，不改变分析定义，集成时按组件标题区分 | 已解决（Lead 说明） |
| B-Q19 | S-01 v2 r6 §16.6 的 σ/CV 定义（定义/单位/小数位/旧版映射）与 B-4 自有 `variability.ts`/`anomaly.ts` 是否同名同义；A r6 常量分类（36 月 F 默认 + 可配置 O 上限、`maxAnalysisDays=400` F、`FX_MAX_FALLBACK_DAYS=7`、#29 2σ→C 默认可配置、#31 样本阈值 5→F）对 B 的 W1 适配层是否有实质影响 | **部分待定（2026-10-27）**：W1-S4a 只消费 B-4 自有总体标准差（`scale=6` 缩放整数、`formula.stdDev = "population-standard-deviation-v1"`），不引用 A 侧 σ/CV 字段；跨 Agent 对比与常量对齐按 r6 口径标「待冻结核对」，冻结前不换算、不造数据。r6 §16.5/§14/§13、G-12a params、G-16/G-17 形状的受影响接口核对待回 Lead | A/Lead（r6 冻结前核对） |
| B-Q20 | 「进行中的今天」在 A13/A14 移动平均窗口中的口径：shared B-4 的 `computeTimeSeries` 把包含 today 的桶视为部分日（有金额、可计算），而 S4a 波动/收入稳定/星期分布只取 complete 桶（进行中今天不入样）。两套口径并存是否需统一或由页面文案区分 | **已裁定（2026-10-27，Lead）**：统计类分析统一「今天/进行中桶不入统计样本」（理由：S-01 v2 A12 已定 `todayExcluded`；避免进行中部分日拉低均线尾点）。落地：①A13/A14 适配层把 `state === "in-progress"` 桶按未知（`amountMinor = null`）喂给 shared 引擎，含该日窗口明确 `window-incomplete`、不补零；②`MovingAverageAnalysisView` 新增 `todayExcluded`/`excludedInProgressDays`，卡片新增 `excludedInProgress`/`excludedTodayText` 并在排除时强制渲染说明；③补测试：今天进行中 → 样本不含今天且 `sampleText`/`excludedTodayText` 明示；无进行中时行为不变；④S-01 v2 文字补一行由 A 在冻结后最小批次处理。已修入 `3484321` 后独立提交 `07f1be5`（见 §6.2） | 已解决（Lead 裁定 + B 落地） |

---

## 8. 恢复步骤（上下文丢失时）

1. 读仓库 `AGENTS.md` → `docs/STATUS.md` → 索引 → 本文件。
2. 检查工作区 `git status --short`、`git log --oneline -5`，与 §6.2 核对；不一致立即停手报告 Lead。
3. 只在本分支工作；禁止触碰索引 §1.3 受保护工作区。
4. 向 `lead` 发送恢复报告（身份/状态/已完成/未决/下一步）。
