# S17 · S-01 v2 结构草案（跨 Agent 汇总收敛，`s01-v2-draft`，**未冻结**）

> 最后核对：2026-10-27（本工作区 `1989245`，分支 `deepseek/s17-finance-category`）
> 状态：**结构草案，未冻结，不构成公共接口**；`ANALYSIS_PROTOCOL_VERSION` 仍为 `s01-draft`。
> 目的：以现有 `S17-Agent-A-S01-共享分析结果协议草案.md`（s01-draft，§1–§17）为底，汇总 B 的时间扩展、C 的专业分析形状（QC-10/11/18–25 等）、D 的 S-03 布局侧引用/尺寸契约，形成**一份可评审的 v2 结构骨架**，交 Lead 转 B/C/D 交叉评审，再由所有者批准冻结。
> 边界：**只改文档，不动代码、不实现接口、不冻结协议本体**；不碰 1.16.23 基线、页面、迁移；不 push；不改 B/C/D 任何工作区文件（B/C/D 文档只读引用）。

---

## 0. 标记与负责人约定

- 👍 **已定**：来源文档已明确、可直接进入冻结稿（仍以最终评审为准）。
- 🟡 **待所有者裁定**：口径已登记但有 PI/所有者未决项，冻结前必须回答。
- 🔵 **待实现确认**：形状/字段已登记，但实现细节（字段名、阈值、序列化）需在实现批次确认。
- 负责人：**A**（协议本体/信封/类型）、**B**（时间形状）、**C**（专业分析形状）、**D**（布局引用/尺寸契约）、**Lead**（跨 Agent 裁决与转达）、**所有者**（财务/业务口径最终裁定）。

**计数口径**（2026-10-27 应 C 回执统一；冻结稿起统一使用，评审时不得混算）：

- **结果形状**（进入 `AnalysisResult` 联合、可被布局/详情/图表消费的权威输出）：A 4 + B 7 + C 7 + C draft 8 − `scatter` 合并 1 = **25 种**；其中 `hierarchy` 依赖分类层级模型、`fx-diagnostic` 依赖只读 FX 投影。`sankey` 按 C-2 回执作为 `HierarchyResult` 的**派生投影**，不新增结果形状。
- **输入 DTO**（分析输入/布局引用，不是结果形状）：`AnalysisDefinition`、`ResolvedFilters`、`ResolvedPeriod`、`FXEntry`、`AnalysisReference`、`ObjectSizeContract`、`DraftCategoryRelation`，共 **7 种**。
- **图表输入 / 派生投影**（渲染适配层，不属于结果协议冻结范围）：A 的 4 个图表输入 + 桑基/旭日/Treemap 等层级投影 + CF 家族（编号映射见 G-13）。
- §3.1–§3.4 表共 **27 行**，其中 1 行是 A 的 4 个图表输入合列、1 行是 `scatter` 合并行；旧表述「C 结果形状共 7+7=14」只指 **C 侧**结果形状（7 稳定 + 7 draft），不是全协议总数。

> 本草案只做**结构收敛**：每个形状只列「身份/关键字段/来源映射/状态」，完整字段定义以各来源文档为准，冻结时由 A 合并成 `types.ts` 与正式 S-01 v2 文档。

---

## 1. 汇总来源与版本基线

| 来源 | 文档/代码位置 | 版本/状态 |
|---|---|---|
| A · S-01 s01-draft | `S17-Agent-A-S01-共享分析结果协议草案.md`（§1–§17，本工作区 `1989245`） | `s01-draft`，未冻结 |
| A · 实现基线 | `packages/shared/src/analysis/`（types/rational/primitives/context/analyses/charts/adapters） | 26 项装配 + 图表输入；`s01-draft` |
| B · 时间扩展 | `S17-Agent-B-S01-时间扩展协议草案.md`（B 工作区，只读） | B-0…B-4 已实现；`s17-b-time-v1`，未接 S-01 信封 |
| B · S-01 v2 提案 | `S17-Agent-B-S01-v2提案-汇率逐笔扩展与月键上限.md`（B 工作区 `9d77b06`，只读；提案 B-S01v2-01/02） | draft 提案，**additive**；已汇总至 §4.8/§4.9/§7 G-17（Lead Q-BP-3 统一编号）；未冻结 |
| C · 数据契约/公共协议 | `S17-Agent-C-C0-数据契约与公共协议-20261027.md`（C 工作区，只读） | C-0；QC-01…QC-17 |
| C · 专业分析 | C-1/C-2 交付记录与 `Draft*` 类型（C 工作区，只读） | QC-18…QC-25 新增；`Draft*` 未冻结 |
| D · 布局侧接口 | `S17-Agent-D-S03-接口草案-布局侧-v1.md`（D 工作区，只读） | S-03 draft v0.2；Lead 六问已裁定；数值待 W3 |

**已并入 S-01 draft 的跨 Agent 结论**（见 s01-draft §15–§17）：B 七形状命名归 A、`dataVersion`/`coverageEnd`/`bucket` 语义、半开↔闭区间换算、区间上限两类边界、闰日对齐、A05 默认窗口政策。

---

## 2. 统一结果信封（v2 冻结候选）

沿用 s01-draft `AnalysisResultBase`，v2 只做**只增不改**的扩展：

| 字段 | v2 口径 | 状态 |
|---|---|---|
| `version` | `"s01-v2-draft"`（冻结时定正式版本串） | 🟡 版本号命名待 Lead 定 |
| `analysisId` / `analysisType` / `metric` | 沿用；`analysisType` 命名空间 `<domain>.<name>`，domain ∈ `basic\|category\|time\|dist\|cross\|record`（domain 可扩） | 👍 |
| `resolvedFilters` / `resolvedPeriod` / `resolvedCurrency` | 沿用；`resolvedPeriod` 仍为**闭区间**；月键比较另带比较键元数据 | 👍 |
| `completeness` | 沿用 9 态；时间桶级**复用**同一枚举（不新增桶级枚举） | 👍 |
| `dataVersion` | 书级数据版本令牌，由计算入口提供、A 只透传；缓存键必须包含 | 👍 |
| `computation` | 增可选 `method`（如 `quantile-type7`/`population-stddev`/`histogram-sturges`）、`sampling?`（视觉采样元信息，不可回算）、`coverageEnd?`、**`analysisLimit?`**（`maxAnalysisDays`/`maxMonths` 越界可追溯，B 缺口 1 / G-18） | 🟡 字段名/是否进冻结待评审（R-09） |
| `source` | `SourceDescriptor.query.kind` 增 `"analysis-records"`、`"fx"`（记录级/FX 只读投影）；`bucket?`（B 时间桶，格式 `{ key, granularity, span: { start, end } }`）；按 B X-02 **删除 `timeBucket?`**，不保留两套桶引用 | 🟡 待裁定（QC-01/QC-13/G-02） |
| `Ratio` 序列化 | 进程内 `bigint`；跨 HTTP 统一 `{ numerator: string; denominator: string }` | 👍 |
| 金额 | `MoneyValue{amountMinor:string,currency,decimals}`；平均值 `exact-money`；禁止浮点权威值 | 👍 |
| 缺失≠0 | 不可计算一律 `null` + `unavailableReason`，禁止补 0 | 👍 |

---

## 3. 形状总表（核心交付）

### 3.1 A：现有四形状（结果）与四个图表输入（适配层）

| 名称 | 内容摘要 | 状态 | 负责人 |
|---|---|---|---|
| `scalar` | 单值：金额/精确金额/计数/天数/比例；`value` 可为 null | 👍 | A |
| `ranked-groups` | 分组排行（分类/支付方式）；`share` 仅完整时可算 | 👍 | A |
| `composition` | 构成（环形/百分比条）；`total` 仅 complete 且 >0 时非 null；「其他」折叠守恒 | 👍 | A |
| `record-extreme` | 极值记录/日；`extremeValue` 承载非金额极值（B20 笔数） | 👍 | A |
| `numeric-card` / `composition-chart` / `ranking-chart` / `extreme-card` | 图表适配层输入（A 的 §14.1–§14.5）；只读映射、渲染不重算 | 👍（视觉阈值待 Codex/D） | A |

### 3.2 B：时间扩展七形状（来源 B-0…B-4）

| 名称 | 来源映射（示例） | 关键字段摘要 | 状态 | 负责人 |
|---|---|---|---|---|
| `time-series` | B04/I06…I16 | `granularity day\|week\|month`、`buckets[]`（半开 span + 闭区间换算）、`axis`、`total` 只对 complete 桶求和 | 👍 | B |
| `multi-series` | B04 多分组/P14 小多图 | 多序列共用桶轴；`series[]` | 👍 | B |
| `period-comparison` | A01–A05 | 两期 + 差额/增长率；`previous<=0` 给不可用原因；`leapDayFallbacks`/`policyId` | 👍（B-16/B-17 待裁定） | B |
| `calendar-heatmap` | B08/I19（**I12 为「支出分类构成」，非日历**） | 逐日 value/count/state/level；五态；周一起始；只对完整日计算强度 | 🟡 B-17 一致性待裁定（唯一实现归 B 的 `timeCalendar`/`calendarHeatmap`） | B |
| `moving-average` | A13/A14 | 尾随 7/30 日历日；精确分数；窗口不足/含未知→不插值 | 👍 | B |
| `variability` | A12（每日支出波动）/A20（收入稳定性） | 均值精确分数、总体 σ、CV（定点）、均值±σ 带、样本阈值、`judgedState` | 🟡 B-16 A12 口径待裁定 | B |
| `anomaly` | A19 | MAD→IQR→分位退化链、阈值与参数可追溯、今天排除 | 👍 | B |

**B 的不变式（IV-01…IV-14）**：覆盖连续无缺口、ISO 周键稳定、桶和=total（完整桶）、精确金额、币种隔离、复用 FX、缺失≠0、future 不计入、in-progress 保守、来源可复原、同结果内 `dataVersion` 一致、axis 无像素、分母 0→null、只读。→ v2 冻结稿作为「时间形状通用不变式」收录（👍 已定，B 负责）。

### 3.3 C：专业分析七形状（C-0 草案，QC-01 基线）

| 名称 | 来源映射 | 关键字段摘要 | 状态 | 负责人 |
|---|---|---|---|---|
| `ranked-records` | I18/A16 | 记录级排行：recordId/金额/业务日期/分类/支付方式/`share`/`tieCount`/`total`/`sampleComplete` | 🟡 待裁定（QC-01/QC-02） | C（A 收口） |
| `distribution` | A09/A10/A11/P12/P23 | 直方图箱 + 分位（Type 7）+ 总体方差/σ + 离群围栏；`method` 可追溯 | 🟡 待裁定（QC-10/QC-11 已登记 §16） | C（A 收口） |
| `contribution` | A06/A07/A17/P22/P24 | 两期分类贡献：previous/current/delta/growth/deltaShare + 新增/消失标记 | 🟡 待裁定（QC-04） | C（A 收口） |
| `matrix` | P01/P02/P03/P13 | 二维交叉表（分类×时间/支付方式）；守恒校验 | 🟡 待裁定（QC-22 边界） | C（A 收口） |
| `hierarchy` | P05/P06/P07 | 层级聚合；**依赖分类层级模型（QC-03 未批准）** → 首版单层退化 + 显式标注；**旭日/桑基是 `HierarchyResult` 的纯派生投影（QC-28，不新增结果形状）**：层级不完整时旭日/桑基**拒绝启用并给原因**，Treemap 退化为单层扁平（面积仍=金额占比）；桑基 ≤4,000 连线、守恒四项 | 🟡 依赖所有者（QC-03）；桑基投影归属已按 C-2 回执登记 | C |
| `scatter` | P10/P11 | 散点/气泡：点数上限策略、`omittedCount`、`complete` | 🟡 待裁定（QC-19/QC-20，含 draft 版本合并） | C（A 收口） |
| `fx-diagnostic` | P16–P20 | FX 诊断：复用 `aggregateFxAsync` 的 failures/reviewDates/完整性，不自造汇率；**消费侧（C-4 校准）已登记本形状**；权威定义来源：`S17-Agent-C-C0-数据契约与公共协议-20261027.md` §3.2.7 `FXDiagnosticResult`（P16–P20、QC-12）；C-4 校准文档名待 C/Lead 提供后补引用 | 🟡 待裁定（QC-12，需只读投影） | C（A 收口） |

### 3.4 C：C-2 新增八个 draft 形状（QC-18…QC-25）

| 名称 | 来源 | 关键字段摘要 | 状态 | 负责人 |
|---|---|---|---|---|
| `rank-migration` | P09（QC-18） | 上/本期名次、并列策略、moved/new/removed 计数 | 🟡 待裁定 | C（A 收口） |
| `scatter`（draft 合并） | P10（QC-19） | 与 3.3 的 `scatter` **合并为一个形状**（C 的两版草案需对齐） | 🟡 | C + A |
| `bubble` | P11（QC-20） | count/sum/mean/share；无笔数时 mean/share = null | 🟡 | C |
| `boxplot` | P12（QC-21） | Type 7 分位、1.5×IQR 围栏、`BOXPLOT_MIN_RELIABLE_SAMPLE=5`（待 A 确认）、maxOutliers | 🟡 | C + A |
| `pivot` | P13（QC-22） | 四指标、行列合计、守恒校验、稀疏空=「未发生」非 0、`MAX_PIVOT_CELLS=2500` | 🟡 | C |
| `small-multiples` | P14（QC-23） | `scaleMode`、`topN≤24`、桶键须与 B 时间序列同口径、截断说明 | 🟡 | C + B |
| `calendar` | P15（QC-24） | 五态、`weekIndex` 周一起始、`leapYear/weekCount`、`intensityMin/Max`；**须与 B I12 日历同结果、不另立日历系统** | 🟡 | C + B |
| `cross-cube` | P21（QC-25） | 受控维度/指标白名单、≤3 维、≤5,000 组合、跨币种必须含 currency 维、长表输出、拒绝原因枚举 | 🟡 | C + 后端 |
| `sankey`（QC-28，**纯派生投影，不新增结果形状**） | C-3 P07 | 由 `HierarchyResult` 纯投影派生（`${id}::direct` 直接终端、≤4,000 连线、四项守恒）；层级不完整/未知分类时拒绝启用并给原因 | 👍 投影归属（C-2 回执）/🟡 数值上限 | C |

> 计数：见 §0「计数口径」（结果形状 25、输入 DTO 7、图表输入/投影另计）。旧「C 结果形状共 7+7=14」仅指 C 侧形状；`hierarchy` 依赖模型、`sankey` 为派生投影。C 的 20 个图表家族编号与 Codex/S-02 的 CF 编号映射未定（QC-15）。

---

## 4. B 时间形状的统一规则（v2 冻结候选）

1. **区间**：用户/结果用闭区间 `[from,to]`；桶内部半开 `[start,end)`；`bucketToInclusive(bucket)` 是唯一换算（日粒度 `to = addDays(end,-1)`）。
2. **桶状态**：`complete|in-progress|future|unknown|unavailable` → 复用 `AnalysisCompleteness` 映射（B §4.2，见 §4.10）；`total` 口径：`unknown`/`future` 不计入；`in-progress` 可计入但 `complete=false` 明示；**存在 `unknown` 时 `total=null`**（B X-02 收紧）。
3. **轴**：`TimeAxisHint` 属于结果（业务日期、周一起始、桶粒度）；locale/颜色/像素归渲染层。
4. **来源**：整图级 `SourceDescriptor` + 桶级 `bucket?`；点击桶按 `bucket.from/to`（闭区间）取来源，权限重新校验。
5. **区间上限**：按 s01-draft §17——月键比较不设日上限（月数暂记 ≤36）、日窗口 `maxAnalysisDays` 默认 400、闰日 2 月末对齐逐条记录、A05 默认 `same-day-index` + `policyId`。
6. **A12 波动性口径（B-16 待裁定）**：均值精确分数、**总体** σ、CV 定点表示（位数待定）、均值±σ 带、`sufficientSample=false` 明示（样本阈值 7 天）、今天/进行中桶不入样（`todayExcluded`）、零收入月单独计数、**A20 最小样本 3 个月**（B 评审要求写入 v2）、**极值日 = 偏离均值 > N×总体 σ**（`extremeSigma`，默认 N=2，D-02 待所有者裁定）。→ 与 s01-draft §16.2 一致的部分标 👍，CV 定点位数/阈值/N 值标 🟡。
7. **日历一致性（B-17 待裁定）**：**唯一实现归 B**——`timeCalendar.ts`（日历算术/桶键/五态）+ `calendarHeatmap.ts`（逐日强度分位 0–4、周一起始月矩阵）；`weekCount` = 与 ISO 周交叠的 Monday 起始行数、`leapYear` = 2 月天数；C 的 `calendar`（QC-24）只做投影/适配（`weekIndex` 由 `isoWeekOf` 派生、不重算分位、不另立五态）；强度以 B 分位等级为权威，C 的 `intensityMin/Max` 仅图例显示区间。
8. **综合模式数据源：B-S01v2-01 `FxAggregate` 逐日/逐笔投影（additive，🟡 待裁定）**：B 提案在 `packages/shared/src/fx.ts` **新增**（不改既有函数）`FxDetailedAggregate extends FxAggregate`，含 `detail.daily`（业务日期 → `FxTotals`；只含至少一笔成功折算的日期，缺失日不出现≠0；`Σ daily = totals` 用 BigInt 精确守恒）与 `detail.entries`（`FxConvertedEntry[]`，逐笔金额直接取 `convertFx` 结果、输入序、失败笔不在其中），经 `aggregateFxDetailed`/`aggregateFxDetailedAsync` 暴露；`includeEntries` 默认 `false`，`FX_MAX_DETAIL_ENTRIES = 50_000`，超限抛 `fx_detail_limit`（不截断、不返回部分结果）；异步 `signal` 取消不返回部分结果；`complete=false` 时 `daily` 只表示「已成功折算部分」，时间分析必须把 `failures` 日期映射为 **unknown**（非 0）并降级整体完整性；`aggregateFx`/`aggregateFxAsync` 签名与唯一消费方 `fxView.ts` 零改动。**综合模式的时间/分类/来源分析只能消费该投影，不得在页面层另写一套折算**。
   - **Lead Q-BP 最终裁定（2026-10-27）**：①字段名用可选 `detail`，类型 `FxAggregateDetail`/`FxDetailedAggregate` 保持、不更名；②`maxEntries` 默认 50,000 是**默认上限/保护值**，逐笔明细视图必须**显式传参**，文档须写明「默认值只是保护，不得作为业务契约」；③`maxEntries`(50k) 与 `maxAnalysisDays`(400) 属**不同轴，不强行对齐**，v2 并列登记、各自默认值；④`detail.daily` **恒输出**（稳定图表与守恒检查），`entries` 保持可选；⑤正式定义文本由 B 提供（B 提案 §15/§16），A 合并进 v2 并注明来源；⑥性能规范采纳（异步批次 + `yieldControl`、**不得在渲染帧同步聚合**），引用 B 基线文档 `docs/specs/design/S17-B-性能基线.md`。
9. **月键上限常量落位（B-S01v2-02，additive，🟡 待裁定）**：shared `fx.ts` 增 `FX_MAX_RANGE_MONTHS = 36` 与 `fxRangeMonths(from, to, maxMonths = FX_MAX_RANGE_MONTHS)`（含首尾月枚举、超限抛 `fx_range_too_long` 不截断、非法入参抛 `fx_range_invalid`）；web `rangeMonths` 委托 shared、默认上限 14 → 36（draft，W1 接入时生效；15–36 个月不再抛错是唯一行为变化；W1 页面行为由 B 在切分方案中明确）；与 s01-draft §17.1(a)/G-09 一致，日窗口 `maxAnalysisDays` 仍由 analysis 调用方传入；Lead 已批准「15–36 月不再抛错（draft，W1 接入生效）」。
10. **五态 → 9 态映射表（G-20，B 草案 §4.2 可核对版）**：

| 时间桶 `state` | `completeness`（9 态） | 说明 |
|---|---|---|
| `complete` | `complete`（无数据时 `no-transactions`） | 桶内数据完整；空桶按「无交易」而非 0 处理 |
| `in-progress` | `no-transactions` 或 `complete`，且结果层 `complete=false` 明示 | 当前进行中桶（今天/本周/本月） |
| `future` | `not-applicable` | 未来桶，不参与合计 |
| `unknown` | `offline-incomplete` | 离线覆盖不足/数据未知；**缺失≠0** |
| `unavailable` | `fx-incomplete` / `request-failed` / `no-permission` | 汇率缺失、请求失败或无权限；按原因细分 |

---

## 5. C 专业形状的接入规则（v2 冻结候选）

- C 的形状全部 `extends AnalysisResultBase`，金额 `bigint`/JSON 字符串、比例 `Ratio`、缺失≠0（与 A 一致）。
- C 需要的公共扩展（QC-01）：①`AnalysisResult` union 纳入 C 形状（或按 `analysisType` 允许 `c.*` 子联合）；②`SourceDescriptor.query.kind` 增 `analysis-records`/`fx`；③`ComputationMetadata.method`/`sampling?`。→ 均标 🟡，由 A 在 v2 冻结稿收口。
- C 的分位/离散度（QC-10/QC-11）引用 s01-draft §16：Type 7 精确分数算法、总体 σ 默认、`SqrtValue`/`CoefficientsOfVariation`、`varianceKind`。→ 👍（口径已登记，字段名 R-10 待评审）。
- C 的 8 个 draft 形状（QC-18…25）：冻结前需逐项确认是否升为正式形状、字段名与阈值（尤其 `BOXPLOT_MIN_RELIABLE_SAMPLE=5`、`MAX_PIVOT_CELLS=2500`、`topN≤24`、`MAX_*` 上限）。→ 🟡。

---

## 6. 布局侧引用契约（D · S-03 draft v0.2，只引用不拥有）

S-01 v2 与 S-03 的边界：**S-01 负责分析结果/定义；S-03 负责引用与尺寸契约**。v2 结构草案收录 D 的两个契约作为「分析定义在布局中的引用形态」：

### 6.1 `AnalysisReference`（D 草案，已存在于代码）

- 字段：`analysisId`（目录 ID，如 `an-b01`）、`analysisVersion?`、`params: Record<string, unknown>`（规范化参数，相对/预设优先）。
- 规则（D 已裁定）：布局只存引用，不存结果/金额/区间展开值；`params` 只允许白名单键；`pinned` 卡片必须带 `pinnedRange` 且标题可见；未知 `analysisId` → 只读占位 + 提示更新，不回写、不删未知字段；布局层永不按金额/结果改顺序或尺寸。
- D 评审（X-01）补充：`params` 值约束与隐私黑名单（禁账本/交易/成员 ID、自建分类/标签名等私人信息，仅 JSON 标量/枚举/预设键/相对区间）→ 见 **G-12c**；白名单发布形态由 A 出（**G-12a**）；未知/较新 `analysisVersion` 行为见 **G-12b**。
- 状态：👍（draft v0.2，Lead 已评审）；**待定**：目录 ID/版本冻结方式、`params` 白名单是否由 S-01 统一提供（🟡 → 见 G-12a/G-12b/G-12c）。

### 6.2 `ObjectSizeContract`（D 草案，已存在于代码）

- 字段：`objectId`、`minSize`、`sizeLadder`（降级档顺序）、`compatSize?`（默认 1×1）、`collapsedSize?`（容器 1×1）、`minFullCols?`。
- 规则（D 已裁定）：声明方为卡片家族（W3 批 1 声明、原型/真机冻结；W3 前只登记占位数值，其他层不得发明）；布局只执行；缺契约降级到 1×1 并记 `missing-contract`；密度档由卡片家族按真实宽高选择，不持久化；容器沿用同契约（暂不拆 `ContainerGeometryContract`）。
- 状态：👍（draft v0.2）；数值待 W3（🟡）；`contractVersion?`/`maxSize?`/`aspectRatioHint?` 为建议字段（🔵 未实现）。D 评审（X-01）注：`aspectRatioHint` 归 **OQ-LM-09（容器长宽比 / W5 视觉）**，不得在 S-01 冻结时变成布局契约；`contractVersion` 将来只作**尺寸声明版本**、不进权威布局；`contractVersion` 不得替代 S-01 的 `analysisVersion`。

### 6.3 与 S-01 的接口点（v2 需明确）

1. 布局文档中的 `AnalysisReference.analysisId` 与 `params` 只由分析目录/定义消费；S-01 不接收几何信息（D 不把几何写入财务分析定义）。
2. `rangePolicy`（`inherit` 默认 / `pinned` 带预设区间）由分析定义/详情页解析，布局层不改时间筛选、不展开区间。
3. 尺寸/密度契约不影响权威金额：同一 `AnalysisDefinition` 在不同尺寸下结果一致（ACC-02），密度只影响展示。
4. 版本：布局 `schemaVersion`/`layoutAlgorithmVersion` 与 S-01 `version` 相互独立；分享/导出只带引用与配置，不带账务数据。

---

## 7. 冻结检查清单（冻结前必须回答）

> 负责人默认为**所有者**（业务/财务口径）或 **Lead**（跨 Agent）；A 负责把答案写回协议。未回答项不为空泛，均为可验证问题。

| 编号 | 必须回答的问题 | 来源 | 阻塞对象 | 负责人 |
|---|---|---|---|---|
| G-01 | S-01 v2 union 是否纳入 B 七 + C 七 + C draft 8（或允许 `c.*` 子联合）？命名归属与 discriminator 名单确定 | QC-01/G-01 | 全部结果形状 | 所有者/Lead |
| G-02 | C 的 `SourceDescriptor.query.kind`（`analysis-records`/`fx`）与逐桶 `bucket?` 是否纳入；按 B X-02 **删去 `timeBucket?`**，桶引用格式统一为 `{ key, granularity, span: { start, end } }` | QC-01/§15/B X-02 | C-1 起来源追溯 | Lead |
| G-03 | Type 7 分位最终确认（已登记 s01-draft §16.1；`medianMinor` = p=1/2 等价） | QC-10 | Distribution/Boxplot | 所有者 |
| G-04 | σ/CV 表示确认：`SqrtValue`/`CoefficientsOfVariation`、CV 定点位数、`varianceKind` 默认 population | QC-11/R-10 | A12/A20/Distribution | 所有者 |
| G-05 | B-16 A12 波动性口径：总体 σ + CV 定点位数 + 样本阈值 7 天 + 今天排除 + 零收入月计数的最终确认 | B-16 | B 的 variability/VariabilityResult | 所有者/Lead |
| G-06 | B-17 日历一致性：B 日历热力与 C `calendar`（P15）同结果/同五态/周一起始/`weekCount`/强度归一化，唯一实现归属 | B-17/QC-24 | B-2/C-2 日历 | Lead/A+B |
| G-07 | QC-21…QC-25 映射：Boxplot/Pivot/SmallMultiples/Calendar/CrossCube 是否升正式形状；`BOXPLOT_MIN_RELIABLE_SAMPLE=5`、`MAX_PIVOT_CELLS=2500`、`topN≤24`、组合上限等阈值确认 | QC-21…25 | C-2 后半 | 所有者/Lead |
| G-08 | `timeGranularity` 是否增加 `quarter`/`year`（Q-BC-1）；与 §15 的 `timeGranularity?` 建议合并 | Q-BC-1/QC-05 | B/C 时间定义 | Lead |
| G-09 | 区间上限确认：月键比较月数上限（暂记 36）、日窗口 `maxAnalysisDays` 默认 400、是否调 3660；**B-S01v2-02 月键常量落位**：`FX_MAX_RANGE_MONTHS = 36`、`fxRangeMonths(from,to,maxMonths=36)` 参数化、web `rangeMonths` 委托 shared（默认 14→36） | Q-BA-12/§17/B-S01v2-02 | A/B/C 长区间 | 所有者 |
| G-10 | `dataVersion` 生产方/递增语义与 `coverageEnd` 合同（离线） | QC-06/07 | 全部完整性 | Lead/离线模块 |
| G-11 | 记录级/FX 只读投影范围与权限（A 的 T2 端点当前只读范围：逐笔不含 note/tags/userId；极值 limited metrics）——C 的 I18/A16/P10/P12/P23 是否够用 | QC-02/QC-13/T2 | C 来源追溯 | Lead + 所有者 |
| G-12a | **`AnalysisReference.params` 白名单发布形态与版本化**（D 评审拆项）：分析目录为每个 `analysisId` 给出 params 键白名单（键集合 + 值类型 + 必填/可选 + 相对区间写法），随目录/`analysisVersion` 演进；**A 出发布形态，D 按形态校验** | S-03/D X-01 | 布局/内容文档 | Lead + A/D |
| G-12b | **未知/较新 `analysisVersion` 行为**（D 评审拆项）：缺省=跟随当前目录版本；接收者目录较旧/不识别 → 只读占位 + 提示更新、不回写、不删未知字段（原草案只写未知 `analysisId`） | S-03/D X-01 | 布局/内容文档 | Lead + A/D |
| G-12c | **params 值约束与隐私黑名单**（D 评审拆项）：只允许 JSON 标量、枚举/预设键、相对区间；禁止含账本/交易/成员 ID、自建分类/标签名等私人信息；A+Lead 确认键空间约束，禁止项部分需所有者确认 | S-03/D X-01 | 分享/导入隐私 | Lead + A + 所有者 |
| G-13 | 图表家族编号映射：C 的 20 家族 ⇄ CF 编号 ⇄ Codex S-02，及三档密度/最小尺寸 | QC-15/S-02 | W3 卡片家族 | Lead/Codex |
| G-14 | 现有 R-01…R-10 收尾（DTO 收敛、float 比例、大额字符串化、离线、`coverageEnd?`、σ 字段名等） | s01-draft §11/§16 | 冻结稿 | Lead + Claude |
| G-15 | 冻结版本命名与向后兼容：`s01-v2` 正式版本串、与 `s01-draft` 的差异清单、旧 draft 字段废除策略 | A | 冻结发布 | Lead |
| G-16 | **`DraftCategoryRelation` 显式输入 DTO 组**（Lead Q-BP-3 裁定为 G-16；C 评审回执 C-2.2 请求）：作为独立冻结分组登记（父级关系模型未批准时的显式输入占位，QC-27）；**C 将提供正式定义文本** | C 2026-10-27 回执 | 层级/桑基（P05–P07） | Lead + C |
| G-17 | **FX 逐笔/逐日投影（B-S01v2-01，Lead Q-BP-3 裁定为 G-17）**：`FxConvertedEntry`/`FxDetailOptions`/`FxAggregateDetail`/`FxDetailedAggregate` 类型与 `fxRangeMonths`/`FX_MAX_*` 常量口径；`detail` 为可选字段、类型不更名（Q-BP-1）；`maxEntries` 默认 50,000 仅作保护、逐笔视图必须显式传参（Q-BP-2）；与 `maxAnalysisDays`(400) 不同轴、不强行对齐（Q-BP-4）；`detail.daily` 恒输出、`entries` 可选（Q-BP-5）；超限 `fx_detail_limit` 不截断、异步取消不返回部分结果、Σdaily=totals 守恒、`complete=false` 时失败日期映射 unknown；性能验证计划（36 月×1500 笔=54,000 笔；总耗时 ≤3s、单批阻塞 ≤50ms、内存增量 ≤30MB、daily-only 相对现有 ≤5%；`fxDetail.performance.test.ts` 以 `FX_PERF=1` 门控，数字记入 `docs/specs/design/S17-B-性能基线.md`）；**正式定义文本由 B 提供**（B 提案 §15/§16），A 合并进 v2 并注明来源 | B-S01v2-01 | B 的 `fx.ts`/`fxDetail` | Lead + A + B |
| G-18 | **`analysisLimit?` 统一承载**（B 缺口 1）：`maxAnalysisDays`/`maxMonths` 越界可追溯，进结果基类/`computation`；`maxEntries` 属 FX 投影轴、不同轴不强行对齐（Lead Q-BP-4） | B 评审 | 全部分析 | B + A |
| G-19 | **A05 默认窗口政策**（`same-day-index` + `policyId`）待所有者确认；可选 `equal-length-window` 须显式且标题可见，不得静默切换（B 评审/D-03） | B 评审/§17.3 | A05 期间对比 | 所有者 |
| G-20 | **五态 → 9 态映射表确认**：v2 §4.10 已落可核对映射表（B 草案 §4.2），B 复核后进冻结稿（不得只写「复用」） | B 评审 | 全部时间形状 | Lead + B |
| G-21 | **数值常量清单与冻结/可配置逐项登记**（C 回执要求，见 §12）：`maxAnalysisDays` 400、`maxMonths` 36、`FX_MAX_DETAIL_ENTRIES` 50,000、密度阈值、正态/波动性阈值、C 各项上限（pivot/cross-cube/sankey/boxplot/small-multiples/层级表/序列/Pareto/覆盖率/金额分档等）逐项标 F 冻结 / C 可配置 / O 待裁定 / P 占位；C 回执提及但 v2 尚未定义的常量先登记待 C 定义 | C 2026-10-27 回执 | 全部 | Lead + A + 所有者 |

---

## 8. 三类标记统计与冻结门槛

- **已定（👍）**：A 四形状 + 四图表输入；B 七形状中 5 个（time-series/multi-series/period-comparison 的未决项已收、calendar-heatmap 待 B-17、moving-average/anomaly）；C 的分位/σ 口径（§16 已登记）；D 两契约（draft v0.2 已被 Lead 评审接受）。
- **待所有者裁定（🟡）**：B-16/B-17、QC-10/11（字段名 R-10）、QC-18…25、QC-01/02/13、区间上限 G-09、dataVersion/coverageEnd G-10、**B 的 FxAggregate 逐日/逐笔投影（G-17）与月键上限参数化（G-09 增补）** 等（见 §7）。
- **待实现确认（🔵）**：C 形状的实际 `types.ts` 字段、D 的建议字段（`contractVersion?` 等）、图表输入阈值/密度、C 的采样与上限常量。

**冻结门槛**：G-01…G-21 **全部有结论**（允许"不纳入 v2"的明确否决；**G-16/G-17 按 Lead Q-BP-3 裁定为统一组号**，分别由 C/B 提供正式定义文本；G-18 为 `analysisLimit?`、G-19 为 A05 窗口政策、G-20 为五态映射、G-21 为常量清单）→ Lead 组织 A/B/C/D 交叉评审 → **A 书面确认「哪些常量冻结、哪些可配置」（C-1 要求，见 §12）** → 所有者批准 → A 发布 `s01-v2` 并同步 `types.ts` 与各 Agent 实现。冻结前另需满足：§0 计数口径与 §12 常量清单已复核、`fx-diagnostic` 权威定义来源已引用（C-3）。

---

## 9. 与实现/代码的关系

- 本草案**不新增/不修改任何代码**；现有 `packages/shared/src/analysis/` 仍按 `s01-draft` 实现，不受本草案影响。
- B 的 `packages/shared/src/{periodComparison,multiMonthComparison,movingAverage,variability,seasonal,anomaly}.ts`、C 的 `analysis/advanced/` `Draft*` 类型均为**未冻结实现**，冻结后按本草案调整（由各自负责人执行，A 只提供协议）。
- B 的 `S01 v2 提案`（B-S01v2-01/02）为 **additive draft**：`packages/shared/src/fx.ts` 计划新增 `aggregateFxDetailed`/`aggregateFxDetailedAsync`/`FX_MAX_DETAIL_ENTRIES`/`FX_MAX_RANGE_MONTHS`/`fxRangeMonths`，既有 `FxAggregate`/`aggregateFx`/`aggregateFxAsync` 与唯一消费方 `fxView.ts` 零改动；由 B 在 v2 冻结后实现，A 不实现、不扩展 T2 读取范围。
- D 的 `packages/shared/src/analysis/layout/` 未接入 `index.ts`，接入需 S-03 评审（Lead）。
- T2 只读扩展（`/analytics/transactions`、`/analytics/extremes`）为本协议来源追溯的读取基础，保持「已实现，待所有者验收（暂不合并）」；本草案不扩大其读取范围，G-11 若需要扩展须另行批准。

---

## 10. 评审路径与下一步

1. Lead 把本草案转 **B/C/D 交叉评审**（各 Agent 只确认与自己形状/契约有关的部分，指出冲突与遗漏）。
1.1 B 的 `S01 v2 提案`（G-17 / G-09 增补）已汇总进 §4.8/§4.9/§7；A 审阅意见（additive 边界、守恒/失败互斥、超限不截断、取消不返回部分结果、性能门控）已记录到评审意见汇总表 X-03。
1.2 **C 的交叉评审回执（2026-10-27）已到**：C-1 高层无结构性问题、C-2 三点（桑基/旭日为 `HierarchyResult` 纯投影、`DraftCategoryRelation` 独立输入组、形状/输入/投影计数口径）、C-3 `fx-diagnostic` 权威来源与常量清单要求——已全部修订进本草案（§0 计数口径、§3.3/§3.4 投影归属、§4.10 映射表、§7 G-16/G-21、§8 冻结门槛、§12 常量清单），并在评审意见汇总表登记为 X-04 / G-16 / G-21。
1.3 **Lead Q-BP-1～5 最终裁定（2026-10-27）已并入**：§4.8/§4.9 附「Lead Q-BP 最终裁定」要点、§7 G-17 行更新、G-16/G-17 统一组号（G-16 = `DraftCategoryRelation`、G-17 = FX 投影）、A05 窗口政策与五态映射顺延为 G-19/G-20；性能规范（异步批次 + `yieldControl`、不在渲染帧同步聚合）采纳并引用 `docs/specs/design/S17-B-性能基线.md`；评审意见汇总表登记 X-05（Lead 裁定）。
2. A 汇总意见 → 修订本草案（仍 `s01-v2-draft`）。
3. Lead 报所有者批准 §7 检查清单（重点 G-01/G-03/G-04/G-07/G-09/G-11/G-16/G-17/G-21）。
4. 冻结：A 发布正式 S-01 v2（版本串、`types.ts` 调整清单、差异说明），Lead 同步索引；之后各 Agent 按 v2 实现/接入。
5. 在 A-4 启动门禁（S-01 冻结、1.16.23 rebase、T2 验收、Codex 视觉、Claude 复核）全部满足前，A 仍不启动 A-4、不 push。

---

## 11. 变更记录

| 日期 | 变更 | 状态 |
|---|---|---|
| 2026-10-27 | 初版：汇总 A s01-draft + B 时间七形状 + C 专业形状（含 QC-18…25 draft）+ D S-03 两契约；§7 冻结检查清单 15 项 | `s01-v2-draft`，未冻结 |
| 2026-10-27 | 汇总 B 的 `S01 v2 提案`（B-S01v2-01 `FxAggregate` 逐日/逐笔投影 additive、B-S01v2-02 月键上限 14→36 参数化）：§1 来源表、§4.8/§4.9 规则、§7 G-09 增补与新增 G-19（后按 Lead Q-BP-3 统一调整为 **G-17**）、§9 实现关系、§10 评审路径；均标 additive、draft、未冻结 | `s01-v2-draft` 更新，未冻结 |
| 2026-10-27 | **修订 r1（纳入 C 评审回执 2026-10-27 + B/D 已登记意见）**：§0 计数口径（结果形状 25 / 输入 DTO 7 / 图表输入与投影另计）；§2 `analysisLimit?` 与 source 删 `timeBucket?`；§3.2 `calendar-heatmap` 来源改 B08/I19、§3.3 层级/桑基纯投影与 `fx-diagnostic` 权威来源引用、§3.4 新增 sankey 投影行；§4.2 total 口径收紧、§4.6 波动性补 A20/`extremeSigma`、§4.7 日历唯一实现归 B、§4.10 五态→9 态映射表；§6 D 契约加 X-01 注；§7 新增 G-16（A05 窗口）、G-17（五态映射）、G-20（`DraftCategoryRelation`）、G-21（常量清单）（**该轮编号后在 r2 按 Lead Q-BP-3 统一调整**：G-16=`DraftCategoryRelation`、G-17=FX 投影、A05→G-19、五态→G-20）；§8 冻结门槛 G-01…G-21 + C-1 常量书面确认；§10 评审路径更新；新增 §12 数值常量清单（冻结/可配置登记） | `s01-v2-draft` 更新，未冻结 |
| 2026-10-27 | **修订 r2（纳入 Lead 的 B FX 提案最终裁定 Q-BP-1～5）**：§4.8 增「Lead Q-BP 最终裁定」要点（`detail` 可选、类型不更名；`maxEntries` 50,000 仅保护值、逐笔视图显式传参；`maxEntries` 与 `maxAnalysisDays` 不同轴不强行对齐；`detail.daily` 恒输出、`entries` 可选；异步批次 + `yieldControl`、不在渲染帧同步聚合、引用 B 性能基线文档）；§4.9 增 Lead 批准「15–36 月不再抛错（draft，W1 接入生效）、W1 页面行为由 B 切分方案明确」；§7 统一组号（G-16=`DraftCategoryRelation`、G-17=FX 逐笔/逐日投影、G-18=`analysisLimit?`、G-19=A05 窗口政策、G-20=五态→9 态、G-21=常量清单）；§8 冻结门槛与 §10 评审路径同步；§12 常量清单补 FX 常量口径（36 月、50,000 条目、不同轴说明）；评审意见汇总表新增 X-05（Lead 裁定）、D-04 结论更新 | `s01-v2-draft` 更新，未冻结 |

---

## 12. 数值常量清单（冻结/可配置登记，C 回执要求随 v2 交付）

> 归属说明：**F=冻结**（进 v2 冻结稿，改动需重新评审）；**C=可配置**（默认值冻结，允许调用方参数覆盖）；**O=待所有者裁定**（未定不冻结）；**P=占位**（待 Codex/D/实现批次定稿）。C 回执提及但 v2 正文尚未定义的常量先登记为「待 C 定义」，A 不臆造语义。

| 常量 | 值 | 含义/归属 | 状态 | 来源 |
|---|---|---|---|---|
| `maxAnalysisDays`（`MAX_STATS_DAYS`） | 400 天（默认） | A/B/C 日窗口默认上限；越界拒绝不截断 | O（G-09） | s01-draft §17.1 |
| 日窗口绝对上限 | 3,660 天（候选） | 是否允许超 400 的绝对边界 | O（G-09） | s01-draft §17.1 待所有者 |
| `maxMonths` / `FX_MAX_RANGE_MONTHS` | 36 个月 | 月键比较月数上限（B-S01v2-02 落位 shared） | O（G-09） | s01-draft §17、B 提案 |
| `FX_MAX_DETAIL_ENTRIES` | 50,000 | `aggregateFxDetailed` 逐笔投影**默认保护上限**；逐笔明细视图必须**显式传参**（默认值不得作为业务契约）；超限报错不截断（低端设备调用方传 10,000）；与 `maxAnalysisDays`(400) 属不同轴、不强行对齐（Lead Q-BP-4） | O（G-17；可配置） | B 提案 Q-BP-2/3、Lead Q-BP-4 |
| `FX_MAX_FALLBACK_DAYS` | 7 天 | 历史汇率回退窗口 | F（S16-D 既有合同） | `fx.ts` |
| `FX_POLICY` | `minor-half-away-v1` | 逐笔舍入政策 | F（S16-D 既有合同） | `fx.ts` |
| `CARD_DENSITY_THRESHOLDS.medium` | 200×120 px | CF-A01 卡片密度阈值（临时） | P（Codex/D 定稿，A-Q5） | `charts/numericCard.ts` |
| `CARD_DENSITY_THRESHOLDS.expanded` | 320×200 px | 同上 | P | 同上 |
| 移动平均窗口 | 7 / 30 日历日 | B A13/A14 尾随窗口 | F（B-4 已实现） | B-4 |
| 季节性月数上限 | 36 个月 | B 季节分析（14→36 提案） | O（B-12 提案） | B |
| 波动性最小样本 | 7 天 | B-16 `sufficientSample` 阈值 | O（G-05） | B 评审 |
| A20 最小样本 | 3 个月 | 收入稳定性判定 | O（G-05） | B 评审 |
| `extremeSigma` | 2σ（默认） | 极值日 = 偏离均值 > N×总体 σ | O（D-02） | B 评审 |
| 离群围栏 | 1.5×IQR | 箱线/分布离群 | F（§16 已定） | s01-draft §16、C-0 |
| `BOXPLOT_MIN_RELIABLE_SAMPLE` | 5 | 箱线可靠最小样本 | O（G-07） | C |
| `BOXPLOT_DEFAULT_MAX_OUTLIERS` | 20 | 箱线默认最多离群点 | C（可配置） | C |
| `MAX_PIVOT_CELLS` | 2,500 | 透视表最大单元格数 | O（G-07） | C |
| 小多图 TopN | 默认 12 / 上限 24 | `small-multiples` 截断 | O（G-07） | C |
| 交叉表维度/组合上限 | ≤3 维 / ≤5,000 组合 | `cross-cube` | O（G-07） | C |
| 桑基连线上限 | 4,000 | QC-28 派生投影 | O（G-07） | C |
| 日历强度分位 | 0–4 级 | 五态之上的强度等级 | F（B 实现） | B |
| 星期起始 | 周一 | 时间桶/日历 | F（所有者 Q-05） | 所有者规格 |
| 层级表行数上限 | 500 行（C 回执提及） | 待 C 给出语义与默认 | O（待 C 定义） | C 回执 |
| 序列数上限 | 30 条（C 回执提及） | 待 C 给出语义 | O（待 C 定义） | C 回执 |
| Pareto 阈值 | 0.3（C 回执提及） | 帕累托累计占比阈值 | O（待 C 定义） | C 回执 |
| 覆盖率阈值 | 95%（C 回执提及） | 数据覆盖率门槛 | O（待 C 定义） | C 回执 |
| 金额分档阈值 | 1e4 / 1e6 / 1e8 / 1e9（C 回执提及） | 分档展示阈值，是否进协议待 C 给出语义 | O（待 C 定义） | C 回执 |
| 其他实现层常量 | 待补 | 采样/缓存/渲染阈值（缓存 LRU 等不进协议） | P | 各 Agent |

> **冻结前动作（C-1 要求）**：A 在 v2 冻结稿书面确认本表每项 F/C/O/P 归属；C 回执提及但未定义的常量由 C 提供正式定义文本后补全；Lead 组织逐项复核。
