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
| B · G-17 正式定义（§16） | 同文件 **§16「G-17 正式定义：FX 逐笔/逐日投影」**（B 工作区；首次落盘 `f3bd4d6`／回填 `a2539bd`，**D-05 修订版 `7405194`／回填 `3792ace`，以 `7405194` 为准**；Lead m02149/m02412 转发，只读） | draft；A 已并入 v2 **§13**（含 D-05 裁定：`kind` 仅 `income\|expense`、删除 `transfer`、IV-G17-13、§13.5-4 未来扩展）；未冻结 |
| C · G-16 正式定义 | `S17-Agent-C-S01-v2评审-C-2-分类层级模型正式定义.md`（C 工作区 `465d21e`／回填 `dc91f35`，只读；Lead m02188 转发） | draft；A 已并入 v2 **§14**（`DraftCategoryRelation` + `DraftHierarchyResult` + 桑基投影 + 守恒/门控/常量） |
| C · C-4 FX 诊断定义 | `S17-Agent-C-S01-v2评审-C-4-FX诊断形状与常量定义.md`（C 工作区 `465d21e`；实现 `2f7a036`／回填 `6dfbf82`，只读） | draft；A 已并入 v2 **§15**（5 子形状判别联合 + QC-30 不同基规则 + 常量归属） |
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
| `hierarchy` | P05/P06/P07 | 层级聚合；**依赖分类层级模型（QC-03 未批准）** → 首版单层退化 + 显式标注；**旭日/桑基是 `HierarchyResult` 的纯派生投影（QC-28，不新增结果形状）**：层级不完整时旭日/桑基**拒绝启用并给原因**，Treemap 退化为单层扁平（面积仍=金额占比）；桑基 ≤4,000 连线、守恒四项。**正式定义见 §14**（C 提供：`DraftCategoryRelation` 输入 DTO、四项守恒、`hierarchyIsUsable` 门控、`MAX_HIERARCHY_NODES=2000`） | 🟡 依赖所有者（QC-03）；输入 DTO/守恒/门控已按 G-16 正式定义并入 | C |
| `scatter` | P10/P11 | 散点/气泡：点数上限策略、`omittedCount`、`complete` | 🟡 待裁定（QC-19/QC-20，含 draft 版本合并） | C（A 收口） |
| `fx-diagnostic` | P16–P20 | **判别联合形态（Lead QC-29 裁定）**：`diagnosticKind: "currency-composition"｜"contribution"｜"rate-trend"｜"coverage"｜"fallback-usage"` 五子形状，公共字段 `targetCurrency?`/`completeness`/`source`；**正式定义见 §15**（C-4 文档 `S17-Agent-C-S01-v2评审-C-4-FX诊断形状与常量定义.md` @ `465d21e`）；P16 笔数份额与 P17 金额份额**不同基**（QC-30，§15.5）；只复用权威 FX 引擎，不自造汇率 | 🟡 待裁定（QC-12 真实只读投影；形状族已按 C-4 收口） | C（A 收口） |

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
   - **Lead Q-BP 最终裁定（2026-10-27）**：①字段名用可选 `detail`，类型 `FxAggregateDetail`/`FxDetailedAggregate` 保持、不更名；②`maxEntries` 默认 50,000 是**默认上限/保护值**，逐笔明细视图必须**显式传参**，文档须写明「默认值只是保护，不得作为业务契约」；③`maxEntries`(50k) 与 `maxAnalysisDays`(400) 属**不同轴，不强行对齐**，v2 并列登记、各自默认值；④`detail.daily` **恒输出**（稳定图表与守恒检查），`entries` 保持可选；⑤正式定义**已并入 §13**（B 提案 §16；首次落盘 `f3bd4d6`／回填 `a2539bd`，D-05 修订版 `7405194`／回填 `3792ace`，以 `7405194` 为准）；A 已按 Lead **D-05 裁定**将 `FxConvertedEntry.kind` 收窄为 `"income" | "expense"`、删除 `"transfer"`、补 IV-G17-13 与 §13.5-4 未来扩展条款；⑥性能规范采纳（异步批次 + `yieldControl`、**不得在渲染帧同步聚合**），引用 B 基线文档 `docs/specs/design/S17-B-性能基线.md`。
9. **月键上限常量落位（B-S01v2-02，additive，🟡 待裁定）**：shared `fx.ts` 增 `FX_MAX_RANGE_MONTHS = 36` 与 `fxRangeMonths(from, to, maxMonths = FX_MAX_RANGE_MONTHS)`（含首尾月枚举、超限抛 `fx_range_too_long` 不截断、非法入参抛 `fx_range_invalid`）；web `rangeMonths` 委托 shared、默认上限 14 → 36（draft，W1 接入时生效；15–36 个月不再抛错是唯一行为变化；W1 页面行为由 B 在切分方案中明确）；与 s01-draft §17.1(a)/G-09 一致，日窗口 `maxAnalysisDays` 仍由 analysis 调用方传入；Lead 已批准「15–36 月不再抛错（draft，W1 接入生效）」。**正式定义与默认值表见 §13（B 提案 §16 @ `7405194`，D-05 修订版；首次落盘 `f3bd4d6`）：`fxRangeMonths.maxMonths` 默认 36、范围 1..1200。**
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
| G-16 | **`DraftCategoryRelation` 显式输入 DTO 组**（Lead Q-BP-3 裁定为 G-16；C 评审回执 C-2.2 请求）：作为独立冻结分组登记（父级关系模型未批准时的显式输入占位，QC-27）；**正式定义已并入 §14**（C 文档 @ `465d21e`／回填 `dc91f35`，Lead m02188 转发）：输入 DTO 三字段/输入拒绝行为/四项守恒/`hierarchyIsUsable` 门控/`MAX_HIERARCHY_NODES=2000`/`MAX_SANKEY_LINKS=4000` | C 2026-10-27 回执 | 层级/桑基（P05–P07） | Lead + C |
| G-17 | **FX 逐笔/逐日投影（B-S01v2-01，Lead Q-BP-3 裁定为 G-17）**：`FxConvertedEntry`/`FxDetailOptions`/`FxAggregateDetail`/`FxDetailedAggregate` 类型与 `fxRangeMonths`/`FX_MAX_*` 常量口径；`detail` 为可选字段、类型不更名（Q-BP-1）；`maxEntries` 默认 50,000 仅作保护、逐笔视图必须显式传参（Q-BP-2）；与 `maxAnalysisDays`(400) 不同轴、不强行对齐（Q-BP-4）；`detail.daily` 恒输出、`entries` 可选（Q-BP-5）；超限 `fx_detail_limit` 不截断、异步取消不返回部分结果、Σdaily=totals 守恒、`complete=false` 时失败日期映射 unknown；性能验证计划（36 月×1500 笔=54,000 笔；总耗时 ≤3s、单批阻塞 ≤50ms、内存增量 ≤30MB、daily-only 相对现有 ≤5%；`fxDetail.performance.test.ts` 以 `FX_PERF=1` 门控，数字记入 `docs/specs/design/S17-B-性能基线.md`）；**正式定义已并入 §13**（B 提案 §16；首次落盘 `f3bd4d6`／回填 `a2539bd`，D-05 修订版 `7405194`／回填 `3792ace`，以 `7405194` 为准；Lead m02149/m02412 转发；A 按 Lead **D-05 裁定**将 `kind` 限定为 `income\|expense`、删除 `transfer`，并补 IV-G17-13 与 §13.5-4） | B-S01v2-01 | B 的 `fx.ts`/`fxDetail` | Lead + A + B |
| G-18 | **`analysisLimit?` 统一承载**（B 缺口 1）：`maxAnalysisDays`/`maxMonths` 越界可追溯，进结果基类/`computation`；`maxEntries` 属 FX 投影轴、不同轴不强行对齐（Lead Q-BP-4） | B 评审 | 全部分析 | B + A |
| G-19 | **A05 默认窗口政策**（`same-day-index` + `policyId`）待所有者确认；可选 `equal-length-window` 须显式且标题可见，不得静默切换（B 评审/D-03） | B 评审/§17.3 | A05 期间对比 | 所有者 |
| G-20 | **五态 → 9 态映射表确认**：v2 §4.10 已落可核对映射表（B 草案 §4.2），B 复核后进冻结稿（不得只写「复用」） | B 评审 | 全部时间形状 | Lead + B |
| G-21 | **数值常量清单与冻结/可配置逐项登记**（C 回执要求，见 §12）：`maxAnalysisDays` 400、`maxMonths` 36、`FX_MAX_DETAIL_ENTRIES` 50,000、密度阈值、正态/波动性阈值、C 各项上限（pivot/cross-cube/sankey/boxplot/small-multiples/层级表/序列/Pareto/覆盖率/金额分档等）逐项标 F 冻结 / C 可配置 / O 待裁定 / P 占位；C 回执提及但 v2 尚未定义的常量先登记待 C 定义 | C 2026-10-27 回执 | 全部 | Lead + A + 所有者 |
| G-22 | **QC-29（Lead 已裁定）**：`fx-diagnostic` 采用**判别联合形态**（`diagnosticKind` 5 值），`§3.3`/`§15` 按 C-4 文档更新，不再保留「单形状 + 9 字段等价语义」备选方案；真实 FX 只读投影（QC-12）仍待 G-11 批准 | C-4/QC-29 | `fx-diagnostic` 五子形状 | Lead（已裁定）+ C/A |
| G-23 | **QC-30（Lead 已裁定）**：P16（笔数份额）与 P17（金额份额）**不同基，不得同屏合成单一「占比」**；默认分开呈现并各自标注分母（P16=笔数、P17=仅已折算金额、缺失≠0）；仅同币种同过滤条件允许并排且必须带口径标签；具体文案由 C 在 W3 给模板，v2 只登记规则 | C-4/QC-30 | P16/P17 展示 | Lead（已裁定）+ C/A |

---

## 8. 三类标记统计与冻结门槛

- **已定（👍）**：A 四形状 + 四图表输入；B 七形状中 5 个（time-series/multi-series/period-comparison 的未决项已收、calendar-heatmap 待 B-17、moving-average/anomaly）；C 的分位/σ 口径（§16 已登记）；D 两契约（draft v0.2 已被 Lead 评审接受）。
- **待所有者裁定（🟡）**：B-16/B-17、QC-10/11（字段名 R-10）、QC-18…25、QC-01/02/13、区间上限 G-09、dataVersion/coverageEnd G-10、**B 的 FxAggregate 逐日/逐笔投影（G-17）与月键上限参数化（G-09 增补）** 等（见 §7）。
- **待实现确认（🔵）**：C 形状的实际 `types.ts` 字段、D 的建议字段（`contractVersion?` 等）、图表输入阈值/密度、C 的采样与上限常量。

**冻结门槛**：G-01…G-23 **全部有结论**（允许"不纳入 v2"的明确否决；**G-16/G-17 按 Lead Q-BP-3 裁定为统一组号**，正式定义文本已分别并入 **§14**（C @ `465d21e`／`dc91f35`）与 **§13**（B D-05 修订版 @ `7405194`／`3792ace`，首次落盘 `f3bd4d6`／`a2539bd`）；G-18 为 `analysisLimit?`、G-19 为 A05 窗口政策、G-20 为五态映射、G-21 为常量清单（C 已补 `C_*` 与 `FX_DRAFT_*` 正式定义 → §12 冻结清单 v1）、**G-22=QC-29 判别联合（Lead 已裁定）**、**G-23=QC-30 P16/P17 不同基（Lead 已裁定）**）→ Lead 组织 A/B/C/D 交叉评审 → **A 书面确认「哪些常量冻结、哪些可配置」（C-1 要求，见 §12）** → 所有者批准 → A 发布 `s01-v2` 并同步 `types.ts` 与各 Agent 实现。冻结前另需满足：§0 计数口径与 §12 常量清单已复核、`fx-diagnostic` 权威定义已引用 C-4 文档（C-3）、G-17 的 `kind` 已由 Lead **D-05 裁定**为 `"income" | "expense"`（删除 `transfer`；未来需转账须另立合同并取得所有者批准、新增 G 组，不得以预留值写入冻结稿）。

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
1.4 **B 的 G-17 正式定义（B 提案 §16；首次落盘 `f3bd4d6`／回填 `a2539bd`，D-05 修订版 `7405194`／回填 `3792ace`，以 `7405194` 为准）已并入 §13**：16.1 目的与边界、16.2 TS 契约、16.3 **十三条**不变量 IV-G17-01…13（13 为交易类型域）、16.4 默认值表、16.5 兼容性与冻结规则（含第 4 条未来扩展）。**Lead D-05 裁定（2026-10-27）已应用**：`FxConvertedEntry.kind` 只允许 `"income" | "expense"`，删除 `"transfer"`（S-01 核心与 `TransactionKind` 仅此二者；所有者规格 §12「无转账合同/转账识别属非目标」；B 修订提交 `7405194` 已落实）；如未来需要转账须另立合同并取得所有者批准、新增 G 组，不得以预留值写入冻结稿。评审意见汇总表登记 X-06、D-05（已裁定）。
1.5 **C 的收口材料（2026-10-27，`465d21e`；Lead m02188 转发）已并入**：①G-16 正式定义 → **§14**（`DraftCategoryRelation` 输入 DTO、输入拒绝行为、四项守恒、`hierarchyIsUsable` 门控、`DraftHierarchyResult`、桑基纯投影 QC-28、`HIERARCHY_ROOT_ID="__root__"`/`HIERARCHY_DIRECT_SUFFIX="::direct"`/`MAX_HIERARCHY_NODES=2000`/`MAX_SANKEY_LINKS=4000`）；②C-4 FX 诊断权威定义 → **§15**（5 子形状判别联合、公共子结构、字段映射表、`C_*`/`FX_DRAFT_*` 常量）；③**Lead QC-29 裁定**：采用判别联合（`diagnosticKind` 5 值），§3.3 行与 §15 按此更新，不再保留单形状备选；④**Lead QC-30 裁定**：P16 笔数份额与 P17 金额份额不同基，不得同屏合成单一「占比」，默认分开并各自标注分母；⑤常量按「C 侧展示契约归 C、FX 引擎常量归 B」归属并直接引用 C 给的常量名（§12 冻结清单 v1）。评审意见汇总表登记 X-07 与 G-22/G-23。
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
| 2026-10-27 | **修订 r3（纳入 B 的 G-17 正式定义 + C 的 G-16/C-4 收口材料 + Lead QC-29/QC-30 裁定）**：①**新增 §13**（G-17 正式定义，B 提案 §16（首次落盘 `f3bd4d6`／回填 `a2539bd`；D-05 修订版 `7405194`／回填 `3792ace`）：16.1–16.5 全文 + 12 条 IV-G17 不变量（r3 定稿收口补 IV-G17-13，共 13 条）+ 默认值表；A 备注 `kind:"transfer"` 待裁定，后按 D-05 裁定删除，见 r3a）；②**新增 §14**（G-16 正式定义，C 文档 @ `465d21e`／回填 `dc91f35`：`DraftCategoryRelation`/输入拒绝行为/四项守恒/`hierarchyIsUsable`/`DraftHierarchyResult`/桑基纯投影/常量）；③**新增 §15**（C-4 FX 诊断判别联合，C 文档 @ `465d21e`：5 子形状 + 公共子结构 + 9 项字段映射 + QC-30 不同基规则 + `FX_DRAFT_*`/`C_*` 常量）；④§3.3 `hierarchy`/`fx-diagnostic` 行指向 §14/§15，`fx-diagnostic` 改为判别联合；⑤§7 G-16/G-17 行更新、新增 **G-22（QC-29 已裁定）**/**G-23（QC-30 已裁定）**；⑥§8 冻结门槛扩至 **G-01…G-23** 并注明 G-16/G-17 正式文本已并入、`transfer` 待裁定；⑦§10 新增 1.4（B G-17）/1.5（C 收口 + Lead QC-29/30）；⑧§12 常量清单定稿为**「冻结清单 v1」**并按 Lead 规则标归属（C 侧展示契约归 C、FX 引擎常量归 B/A，直接引用 C 给的常量名）；⑨§1 来源表新增 C 两份材料行；⑩评审意见汇总表登记 X-06/X-07、G-22/G-23，任务文档同步 | `s01-v2-draft` 更新，未冻结 |
| 2026-10-27 | **应用 Lead D-05 裁定（G-17 `FxConvertedEntry.kind`）**：§13.2 `kind` 改为 `"income" \| "expense"`（删除 `"transfer"`），原待裁定备注改为裁定记录（附理由与「未来需转账须另立合同/新增 G 组」规则）；§1/§4.8/§7 G-17/§8/§10 1.4 相关表述同步；评审意见汇总表 D-05 记为「已裁定：删除 transfer」 | `s01-v2-draft` 更新，未冻结 |
| 2026-10-27 | **r3 定稿收口（D-05 修订版并入）**：B 修订版 §16 `7405194`／回填 `3792ace` 已并入 §13——§13 来源引用更新为「B §16 @ `7405194`（含 D-05 修订；首次落盘 `f3bd4d6`）」；§13.2 `kind` 行补「继承交易自身 kind，与 `TransactionKind`（`TRANSACTION_KINDS`）对齐」注释；§13.3 新增 **IV-G17-13 交易类型域**（共 13 条）；§13.5 新增第 4 条「未来扩展（不在 S-01 v2 / 本组合同内）」；§1/§4.8/§4.9/§7 G-17/§8/§10 1.4/§12 表来源同步为 `7405194`；评审意见汇总表 D-05/G-17/X-06 同步 | `s01-v2-draft` → **定稿候选**（未冻结，待所有者批准）；`826c950`（本地提交，未推送） |

---

## 12. 数值常量清单：**冻结清单 v1**（2026-10-27，随 v2 交付，待所有者批准）

> 归属说明：**F=冻结**（进 v2 冻结稿，改动需重新评审）；**C=可配置**（默认值冻结，允许调用方参数覆盖）；**O=待所有者裁定**（未定不冻结）；**P=占位**（待 Codex/D/实现批次定稿）。归属列按 Lead m02188 规则：**C 侧展示契约归 C、FX 引擎常量归 B（S16-D）、分析侧常量归 A、跨 Agent 裁定归 Lead/所有者**；直接引用来源方给定的常量名，不改写为新名。C 回执提及的常量已由 C-4 §5.2（`C_*`）与 C G-16 §7（`HIERARCHY_*`/`MAX_*`）补全定义，不再标「待 C 定义」。

| 常量 | 值 | 单位/适用 | 越界行为 | 归属 | 状态 | 来源 |
|---|---|---|---|---|---|---|
| `maxAnalysisDays`（`MAX_STATS_DAYS`） | 400 天（默认） | 自然日；A/B/C 日窗口默认上限 | 越界拒绝、不截断 | A（s01-draft §17.1）/Lead | O（G-09） | s01-draft §17.1 |
| 日窗口绝对上限 | 3,660 天（候选） | 自然日；是否允许超 400 | 未定前按 400 | A/Lead | O（G-09） | s01-draft §17.1 待所有者 |
| `maxMonths` / `FX_MAX_RANGE_MONTHS` | 36 个月 | 月；月键比较 | 超限 `fx_range_too_long` 不截断；范围 1..1200 | B（G-17）/A（G-09） | O（G-09）；B 已实现 draft | B §16.4 @ `7405194`（D-05 修订版；首次落盘 `f3bd4d6`） |
| `FX_MAX_DETAIL_ENTRIES` | 50,000 | 条；FX 逐笔投影 | 超限 `fx_detail_limit` 不截断；业务视图必须显式传参（默认值≠契约）；与 `maxAnalysisDays` 不同轴 | B（引擎）/Lead（Q-BP-4） | O（G-17；可配置） | B §16.4、Lead Q-BP-4 |
| `detail.includeEntries` | `false` | 布尔；FX 逐笔 | `detail.daily` 恒输出，`entries` 可选 | B | F（G-17） | B §16.4 |
| `aggregateFxDetailedAsync.batchSize` | 200 | 条/批 | 1..1000 越界 `fx_batch_size`；取消不返回部分结果 | B | F（G-17） | B §16.4 |
| `FX_MAX_FALLBACK_DAYS`（权威引擎） | 7 天 | 自然日；S16-D 历史汇率回退 | 超 7 天视为 missing | B/S16-D | F（既有合同） | `packages/shared/src/fx.ts` |
| `FX_POLICY`（权威引擎） | `minor-half-away-v1` | 逐笔舍入政策 | 折算唯一实现 | B/S16-D | F（既有合同） | `fx.ts` |
| `FX_DRAFT_MAX_FALLBACK_DAYS` | 7 | 自然日；P17–P20 诊断夹具 | 超 7 天 → `status="missing"`，不放大回退 | C-4（对齐 S16-D） | F（诊断草案） | C-4 §5.1 @ `465d21e` |
| `FX_DRAFT_RATE_DECIMALS` | 6 | 定点小数位（仅展示） | 权威仍是分数；展示 half-away，不得用于折算 | C-4 | F（诊断草案） | C-4 §5.1 |
| `FX_DRAFT_MAX_TREND_DAYS` | 400 | 自然日；P18 区间 | 超限 `unavailable` 并说明，不静默裁剪 | C-4 | F（诊断草案） | C-4 §5.1 |
| `FX_DRAFT_MAX_MISSING_RECORDS` | 200 | 条；缺失明细 | 超限截断明细并 `missingRecordsTruncated=true`；总数以 `missingCount` 为准 | C-4 | F（诊断草案） | C-4 §5.1 |
| `C_AMOUNT_DISPLAY_TIERS_MINOR` | `[10_000n, 1_000_000n, 100_000_000n, 1_000_000_000n]` | 最小单位；坐标轴/数值卡量级缩写（元/万/百万/千万/亿） | 只影响展示文本；完整值必须在 title/详情/数据表出现；<1e4 用元，≥1e9 用缩写并保留完整值 | C | F（C 展示契约） | C-4 §5.2 @ `465d21e` |
| `C_MAX_VISIBLE_SERIES` | 30 | 个；单图表可见序列/图例/色类上限 | 超出必须合并为「其它」且金额守恒 + `noteText`，不得静默截断；表格不适用 | C | F（C 展示契约） | C-4 §5.2 |
| `C_PARETO_KEY_FEW_SHARE` | 0.3 | 比例；帕累托「关键少数」参考线 | 纯参考线/默认展开提示，不改累计值；>30 类默认折叠其余并 note，展开不变值 | C | F（C 展示契约） | C-4 §5.2 |
| `C_COVERAGE_NEAR_COMPLETE_THRESHOLD` | 0.95 | 比例；P19 文案阈值（记录覆盖率） | ≥0.95 可标「接近完整」，<0.95 必须标「不完整」；不得四舍五入显示 100%，须保留一位小数；缺失仍计数并列出 | C（P19 展示契约） | F（C 展示契约） | C-4 §5.2 |
| `C_SANKEY_MAX_LINKS` | 4000 | 条；与 shared `MAX_SANKEY_LINKS` 对齐 | 图表输入层门控：超限不渲染桑基、退回层级表并给原因；不得截断连线金额 | C（与 C-3 共享） | F（C 展示契约） | C-4 §5.2 |
| `C_HIERARCHY_TABLE_MAX_ROWS` | 500 | 行；层级表可见行上限 | 显示前 500 行 + `rowsTruncated=true` + 「共 N 行，显示前 500」；金额合计仍用 shared 全量 | C（与 C-3 共享） | F（C 展示契约） | C-4 §5.2 |
| `HIERARCHY_ROOT_ID` | `"__root__"` | 合成根节点 ID | 不作为业务分类展示 | C-3（G-16） | F（G-16） | C G-16 §7 @ `465d21e` |
| `HIERARCHY_DIRECT_SUFFIX` | `"::direct"` | 桑基直接金额终端 ID 后缀 | 仅当节点既有子级又有直接金额时产生 | C-3 | F（G-16） | C G-16 §7 |
| `MAX_HIERARCHY_NODES` | 2000 | 节点；层级计算 | 超出拒绝，不静默截断 | C-3 | F（G-16） | C G-16 §7 |
| `MAX_SANKEY_LINKS` | 4000 | 条；桑基连线 | 超限拒绝启用（图表输入层门控），不截断金额 | C-3（与 C 展示契约同值） | F（G-16） | C G-16 §7 |
| `CARD_DENSITY_THRESHOLDS.medium` | 200×120 px | CF-A01 卡片密度阈值（临时） | 仅影响展示密度，不改权威金额 | A（占位） | P（A-Q5，待 Codex/D） | `charts/numericCard.ts` |
| `CARD_DENSITY_THRESHOLDS.expanded` | 320×200 px | 同上 | 同上 | A（占位） | P | 同上 |
| 移动平均窗口 | 7 / 30 日历日 | 自然日；B A13/A14 尾随窗口 | 窗口不足/含未知不插值 | B | F（B-4 已实现） | B-4 |
| 季节性月数上限 | 36 个月 | 月；B 季节分析 | 与 G-09 月键口径一致 | B | O（B-12 提案） | B |
| 波动性最小样本 | 7 天 | 日；B-16 `sufficientSample` | 不足时明示，不推算 | B | O（G-05） | B 评审 |
| A20 最小样本 | 3 个月 | 月；收入稳定性判定 | 不足时明示 | B | O（G-05） | B 评审 |
| `extremeSigma` | 2σ（默认） | 倍；极值日 = 偏离均值 > N×总体 σ | N 待所有者裁定 | B | O（D-02） | B 评审 |
| 离群围栏 | 1.5×IQR | 箱线/分布离群 | 固定规则 | A（§16）/C | F | s01-draft §16、C-0 |
| `BOXPLOT_MIN_RELIABLE_SAMPLE` | 5 | 条；箱线可靠最小样本 | 样本不足时明示 | C | O（G-07） | C-2 |
| `BOXPLOT_DEFAULT_MAX_OUTLIERS` | 20 | 个；箱线默认最多离群点 | 可配置 | C | C（可配置） | C-2 |
| `MAX_PIVOT_CELLS` | 2,500 | 单元格；透视表 | 超出拒绝/折叠并给原因 | C | O（G-07） | C-2 |
| 小多图 TopN | 默认 12 / 上限 24 | 序列；`small-multiples` | 超出折叠为「其它」+ note | C | O（G-07） | C-2 |
| 交叉表维度/组合上限 | ≤3 维 / ≤5,000 组合 | `cross-cube` | 超出拒绝并给原因 | C | O（G-07） | C-2 |
| 日历强度分位 | 0–4 级 | 五态之上的强度等级 | 以 B 分位等级为权威 | B | F（B 实现） | B |
| 星期起始 | 周一 | 时间桶/日历 | 固定 | 所有者（Q-05） | F | 所有者规格 |
| 其他实现层常量 | 待补 | 采样/缓存/渲染阈值 | 缓存 LRU 等不进协议 | 各 Agent | P | — |

> **冻结前动作（C-1 要求）**：A 在 v2 冻结稿书面确认本表每项 F/C/O/P 归属；本清单为「冻结清单 v1」，以 §7 G-21 为准；`FX_DRAFT_*`（C-4 诊断夹具）与权威引擎常量（`FX_MAX_FALLBACK_DAYS`/`FX_POLICY`，B/S16-D）不得混用；Lead 组织逐项复核，所有者批准后随 `s01-v2` 冻结。

---

## 13. G-17 正式定义：FX 逐笔/逐日投影（B 提供，draft，待 S-01 v2 冻结）

> 合并来源：B 的 `S17-Agent-B-S01-v2提案-汇率逐笔扩展与月键上限.md` **§16**（首次落盘 `f3bd4d6`／回填 `a2539bd`；**D-05 修订版提交 `7405194`／回填 `3792ace`，以 `7405194` 为准**；Lead m02149/m02412 转发）。本节由 A 并入 v2 供冻结评审；状态仍 **draft**，待 W1 接入；`G-17` 组名“FX 逐笔/逐日投影”。B 侧实现（`fx.ts` 新 API）在冻结前保持 docstring「draft，待冻结后由 W1 接入」。

### 13.1 目的与边界

综合模式（汇率折算）下，24 项时间/比较/构成分析需要逐日桶与少量逐笔明细；现有 `FxAggregate` 只输出 `totals/months/categories/originalByCurrency/failures`，无法在不重算的前提下派生日序列。G-17 规定：在**同一次权威折算扫描**中额外输出逐日投影（恒输出）与可选逐笔投影，供图表输入层与来源跳转使用；不新增端点、不改变既有聚合语义、不引入二次舍入。

### 13.2 形状（TypeScript 契约，additive）

```ts
// 常量
export const FX_MAX_RANGE_MONTHS = 36;        // 月键比较上限（与 S-01 §17 G-09 增补一致）
export const FX_MAX_DETAIL_ENTRIES = 50_000;  // 逐笔明细默认上限（保护值，见 13.4）

// 逐日投影：只含“至少 1 笔成功折算”的业务日；缺失 ≠ 0
export interface FxAggregateDetail {
  readonly daily: Readonly<Record<string, FxTotals>>;              // key = YYYY-MM-DD（业务日）
  readonly entries: readonly FxConvertedEntry[] | null;            // 未请求时为 null
}

// 逐笔投影：与 convertFx 同源；不含软删/未授权记录（调用方预过滤）
export interface FxConvertedEntry {
  readonly id: string;
  readonly bookId: string;
  readonly date: string;                                           // occurredLocalDate（YYYY-MM-DD）
  readonly kind: "income" | "expense";                             // 继承交易自身 kind，与 TransactionKind（TRANSACTION_KINDS）对齐
  readonly categoryId: string;
  readonly targetMinor: string;                                    // 折算后金额（目标币种最小单位，字符串）
  readonly originalMinor: number;                                  // 原币最小单位（沿用现有合同）
  readonly originalCurrency: string;
  readonly rateDate: string | null;                                // 命中的汇率日；同快照内汇率不可用不可能出现在成功项
  readonly rateCached: boolean;
  readonly needsReview: boolean;
}

export interface FxDetailOptions {
  readonly includeEntries?: boolean;                               // 默认 false
  readonly maxEntries?: number;                                    // 默认 FX_MAX_DETAIL_ENTRIES；显式传值优先
}

export interface FxDetailedAggregate extends FxAggregate {
  readonly detail: FxAggregateDetail;
}

export function aggregateFxDetailed(
  accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: FxRateProvider, cache?: FxResultCache, detail?: FxDetailOptions
): FxDetailedAggregate;

export async function aggregateFxDetailedAsync(
  accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: FxRateProvider,
  options?: { batchSize?: number; signal?: AbortSignal; yieldControl?: () => Promise<void> },
  detail?: FxDetailOptions
): Promise<FxDetailedAggregate>;

// 月键枚举（与 G-09 增补配套）
export function fxRangeMonths(from: string, to: string, maxMonths?: number): string[];
```

> **A 备注（2026-10-27，Lead D-05 裁定已应用；B 修订版 §16 @ `7405194`／回填 `3792ace` 已并入）**：`FxConvertedEntry.kind` 只允许 `"income" | "expense"`，删除 `"transfer"`。依据：S-01 核心与 `TransactionKind` 目前仅 `income`/`expense`；所有者规格 §12 明确「无转账合同、转账识别属非目标」。如未来需要转账语义，须**另立转账数据合同并取得所有者批准**、届时新增 G 组，不得以「预留值」形式写入冻结稿。

### 13.3 不变量（冻结时必须逐条保留）

| 编号 | 不变量 |
|---|---|
| IV-G17-01 | **additive**：`FxAggregate` 既有字段与 `aggregateFx`/`aggregateFxAsync` 行为、类型、返回形状零变化；`FxDetailedAggregate extends FxAggregate` 仅新增 `detail`。 |
| IV-G17-02 | **单次扫描/同源**：`detail.entries[i].targetMinor === convertFx(同一快照下 entries[i]).convertedMinor`；不存在第二次扫描或二次舍入。 |
| IV-G17-03 | **守恒**：`Σ detail.daily.values === totals`（income/expense/net 三值按字符串/整数精确相等）；`daily` 的日期键并集 ⊆ 成功折算笔的业务日集合。 |
| IV-G17-04 | **缺失 ≠ 0**：折算失败/缺汇率笔**不进入** `daily` 与 `entries`；缺失日不伪造 0 桶；`failures`/`missingCount`/`complete`/`reviewDates` 语义与既有 `FxAggregate` 完全一致。 |
| IV-G17-05 | **不截断、不静默**：请求 `includeEntries: true` 且成功笔数（或预过滤后的输入笔数，取协议实现中更严格者）超过 `maxEntries` 时，**抛 `fx_detail_limit`**，不返回部分数组、不静默丢弃；`maxEntries` 非法（非正整数/非安全整数）抛 `fx_detail_max_entries`。 |
| IV-G17-06 | **保护默认值 ≠ 业务契约**：`FX_MAX_DETAIL_ENTRIES = 50_000` 仅作为缺省保护；逐笔明细类视图必须显式传 `maxEntries`（W1 接入清单逐项标注）。 |
| IV-G17-07 | **异步=同步**：`aggregateFxDetailedAsync` 的分批合并结果（含 `daily`/`entries` 顺序=输入序）与同步逐字一致；取消（`signal.aborted`）时 reject 且**不返回部分结果**；`batchSize` 1..1000，越界抛 `fx_batch_size`。 |
| IV-G17-08 | **范围与币种**：`fx_scope_mismatch`/`unsupported_currency`/`FX_MAX_FALLBACK_DAYS=7` 等既有规则不变；`daily` 键为业务日（`occurredLocalDate` 日历日，按记录本地时区语义，不做 UTC 换算）。 |
| IV-G17-09 | **审查投影**：`needsReview`/`rateCached`/`rateDate` 逐笔透传；`reviewNeededCount`/`reviewDates` 仍由既有聚合规则得出。 |
| IV-G17-10 | **月键上限**：`fxRangeMonths(from,to,maxMonths=36)` 含首尾月、跨年连续、月键降序无关；`from>to`/非法日期抛 `fx_range_invalid`；月数 > `maxMonths` 抛 `fx_range_too_long`（**不截断**）；`maxMonths` 默认 36（draft），不得被页面各自写死。 |
| IV-G17-11 | **不做跨轴强行对齐**：本组 `maxEntries=50_000` 与 S-01 §17 的 `maxAnalysisDays=400` 是不同轴（条目 vs 日期窗口），v2 并列登记，互不作为对方的默认值来源。 |
| IV-G17-12 | **性能约束**：daily-only 用于图表取数；`includeEntries` 仅用于详情/导出类视图，且必须异步分批（`yieldControl`）执行；不得在渲染帧同步聚合（基线见 `S17-B-性能基线.md` §6：1M 笔 daily-only 13.6s、200k 笔逐笔 2.7s、10k×36 月 0.54s，≈13–14µs/笔）。 |
| IV-G17-13 | **交易类型域（D-05 修订新增，B §16.3 @ `7405194`）**：`FxConvertedEntry.kind` 仅 `"income" \| "expense"`，继承交易自身 `kind`（`TRANSACTION_KINDS`/`TransactionKind`，见 `packages/shared/src/ledger.ts`）；其它值按既有 `invalid_input` 处理，**不预留任何其它值**（含 `transfer`）。 |

### 13.4 默认值与限制

| 参数 | 默认 | 约束 | 说明 |
|---|---|---|---|
| `detail.includeEntries` | `false` | 视图显式开启 | 缺省只出 `daily`（恒输出） |
| `detail.maxEntries` | `50_000` | 正整数安全整数；业务视图**必须显式传** | 保护值，非契约 |
| `aggregateFxDetailedAsync.batchSize` | `200` | 1..1000 | 与既有 `aggregateFxAsync` 一致 |
| `fxRangeMonths.maxMonths` | `36` | 1..1200 | draft 对齐 S-01 §17 月键上限（G-09 增补） |
| `maxAnalysisDays`（分析层，不同轴） | `400` | 调用方传 | 并列登记，不与 `maxEntries` 互相推导 |

### 13.5 兼容性与冻结规则

1. **兼容性**：纯 additive；现有 4 个消费方（`fxView.ts`、`FxStats`、离线路径、测试）不感知新字段；web `rangeMonths` 15–36 月不再抛错是**唯一行为变化**，标 draft，W1 页面接入时才生效，W1 切分方案需写明。
2. **冻结规则**：S-01 v2 冻结前，`fx.ts` 新 API docstring 保持“draft，待冻结后由 W1 接入”；冻结时本节不变量进 S-01 正文，`fxDetail.test.ts`（12 条）+ `fxPerformance.test.ts`（3 条，`FX_PERF=1` 门控）作为验收证据。
3. **登记结论**：G-17 组名“FX 逐笔/逐日投影”；G-16 为 C 的 `DraftCategoryRelation`；不新开 QC 编号。
4. **未来扩展（不在 S-01 v2 / 本组合同内，B §16.5-4 @ `7405194`）**：转账（`transfer`）不在 S-01 v2 / 本组合同内——当前合同 `TRANSACTION_KINDS = ["expense","income"]`，所有者规格明确“无转账合同、转账识别属非目标”；若未来引入转账，须**另立合同**（含类型、方向、成对语义、汇率与统计口径）并经所有者批准，届时升协议版本，**不得在本联合成员中预留**。D-05 修订版已同步删除原 `transfer` 预留值（见 IV-G17-13）。

---

## 14. G-16 正式定义：分类层级模型（C 提供，draft，待 S-01 v2 冻结）

> 合并来源：C 的 `S17-Agent-C-S01-v2评审-C-2-分类层级模型正式定义.md`（C 工作区，`465d21e`／回填 `dc91f35`，Lead m02188 转发）。本节由 A 按 C 文档并入 v2 供冻结评审；状态仍 **draft**（依赖分类层级数据模型扩展未批准，QC-03/QC-27）；结果实现以 C 的 `packages/shared/src/analysis/advanced/{draftTypes,hierarchy,sankey}.ts` 为准（C-3 `c633d80`）。

### 14.1 定义对象与定位

| 项 | 定义 |
|---|---|
| 对象 | `DraftCategoryRelation` —— **分类父子关系输入 DTO**，不是分析结果形状 |
| 定位 | 对应所有者规格 P05/P06/P07 的「真实分类层级」需求；当前 `Category` 模型无 `parentId`（QC-03），本 DTO 是**模型扩展前的显式输入占位**，由未来 `Category.parentId` 或经授权的上层投影提供 |
| 禁止 | 不得根据分类名称、排序、金额或名称相似度**推断**父子关系；无关系输入时必须显式「无真实层级」 |
| 归属 | 输入 DTO（T4 依赖模型扩展）；结果形状是 `HierarchyResult`（QC-26）；桑基是派生投影（QC-28） |

### 14.2 形状（TypeScript 契约）

```ts
/** 分类层级关系的一行（占位输入；不是数据模型，见 QC-27）。 */
export interface DraftCategoryRelation {
  /** 分类主键；与账本内 Category.id 同值。唯一，不得重复出现。 */
  readonly categoryId: string;
  /** 展示标签（仅用于图例/表格；允许为「暂无分类」等系统名）。不参与分组主键。 */
  readonly categoryLabel: string;
  /** 父分类主键；`null` = 顶层分类。指向未声明分类时见 14.3 孤立处理。 */
  readonly parentCategoryId: string | null;
}
```

约束补充：字段仅此三个；不得携带金额、笔数、层级深度、顺序或账本 ID（金额由交易记录提供，避免输入 DTO 与结果双写）；`categoryId`/`categoryLabel` 长度与现网 `Category` 约束一致；同一账本内关系表必须完整描述被引用的父子边，允许只声明部分分类（未声明分类按 14.3 显式标记，不推断父级）。

### 14.3 输入约束与拒绝行为（实现语义，已测）

| 输入情况 | 处理 | 结果标记 |
|---|---|---|
| 同一 `categoryId` 出现两行（重复声明） | **拒绝**（`RangeError`） | 调用方必须先去重，不静默取其一 |
| `parentCategoryId === categoryId`（自我父级） | **拒绝**（`RangeError`） | — |
| 父子边构成环（A→B→A） | **拒绝**（`RangeError`，带链路） | 不自动断环、不按名称猜 |
| `parentCategoryId` 指向未声明分类（孤立父引用） | 该子分类**按顶层处理**并登记 | `orphanRelationCategoryIds` 非空；`isRealHierarchy=false` |
| 交易出现关系表未声明分类（历史/归档） | 建立 `category` 节点 | 节点 `hasMissingRelation=true`；结果 `hasUnknownCategories=true`；`isRealHierarchy=false` |
| 关系表为空 | 退回**扁平单层** | `isRealHierarchy=false`；`hasUnknownCategories=false` |
| 关系表只有真实父子边且被引用分类全部声明 | 正常层级 | `isRealHierarchy=true`；`hasUnknownCategories=false` |
| 混币 / 负金额 / 非 `expense`/`income` 记录 | **拒绝**（`RangeError` 或显式 `unavailable`） | 不混加、不取绝对值 |
| 零金额子树（子级无任何记录） | 不输出该子树节点（保留合成根） | 避免空节点撑大层级 |

> 「父级不重复计子」：每笔交易只归属**一个**分类节点；节点金额拆成 `directAmountMinor`（自身直接金额）与 `subtreeAmountMinor`（自己 + 全部后代），父级金额 = 自身直接 + Σ 子级子树，**不得**把子级金额再加一遍到 direct。

### 14.4 守恒四项与展示门控

| 不变量 | 形式化定义 | 判定 |
|---|---|---|
| `rootSubtreeAmountMinor` | `root.subtreeAmountMinor = totalAmountMinor`（root 是合成根 `HIERARCHY_ROOT_ID="__root__"`，不作为业务分类展示） | 数值相等 |
| `nodesConserved` | 对每个非根节点：`subtreeAmountMinor = directAmountMinor + Σ children.subtreeAmountMinor` | 布尔 |
| `noDoubleCounting` | `Σ 所有节点 directAmountMinor = root.subtreeAmountMinor`（每笔交易只计入一个节点） | 布尔 |
| `edgesConserved` | 每条金额路径在叶子或 `direct` 终端结束；`Σ root 出边子树 = root.subtree` | 布尔 |

辅助函数：`hierarchyIsConserved(result)`（四项全真）；`hierarchyIsUsable(result)` = **`isRealHierarchy && !hasUnknownCategories && completeness === "complete"`**。展示门控：`hierarchyIsUsable` 为假时，**旭日图与桑基拒绝启用并给出原因**；矩形树图允许退化为单层扁平（面积仍=金额占比，但不得暗示父子关系）；层级表显示扁平清单 + 「当前无分类层级（数据模型依赖）」说明。

### 14.5 结果形状 `DraftHierarchyResult`（QC-26，供 v2 引用）

```ts
export interface DraftHierarchyResult {
  readonly rootId: string;                       // 恒为 HIERARCHY_ROOT_ID
  readonly metric: "expense" | "income";
  readonly currency: string;                     // 单币种；混币在输入层拒绝
  readonly nodes: readonly DraftHierarchyNode[];
  readonly maxDepth: number;
  readonly isRealHierarchy: boolean;
  readonly hasUnknownCategories: boolean;
  readonly orphanRelationCategoryIds: readonly string[];
  readonly totalAmountMinor: bigint;
  readonly totalCount: number;
  readonly conservation: { rootSubtreeAmountMinor: bigint; nodesConserved: boolean; noDoubleCounting: boolean; edgesConserved: boolean };
  readonly completeness: "complete" | "no-transactions" | "unavailable";
}
```

`DraftHierarchyNode`：`nodeId/parentId/depth/kind("root"|"category"|"direct")/label/directAmountMinor/directCount/subtreeAmountMinor/subtreeCount/childCount/isLeaf/hasMissingRelation`；顶层分类的 `parentId = HIERARCHY_ROOT_ID`（不是 null，唯一例外是合成根自身 parentId 为 null）。

### 14.6 与派生桑基（QC-28）的关系

`buildHierarchySankey(result)` 是 `DraftHierarchyResult` 的**纯投影**，不重新聚合金额：连线=合成根→顶层分类（`subtreeAmountMinor`）、父级→子级（子级 `subtreeAmountMinor`）、父级→直接金额终端（`${categoryId}::direct`，`directAmountMinor`，仅当节点既有子级又有直接金额）；桑基节点 `kind` 与层级节点一致；直接终端是叶子；守恒四项：`rootOutflowMatchesTotal`/`allInflowsMatch`/`outflowConserved`/`noNegativeLinks`；连线数上限 `MAX_SANKEY_LINKS = 4000`，超限**不得截断金额**（截断破坏守恒），应交由图表输入层门控（拒绝并退回层级表）；桑基只表示真实层级金额归属，禁止用「收入→支付方式→消费」等非层级连线冒充资金流（owner 规格 §23）。

### 14.7 常量

| 常量 | 值 | 含义 |
|---|---|---|
| `HIERARCHY_ROOT_ID` | `"__root__"` | 合成根节点 ID（不作为业务分类展示） |
| `HIERARCHY_DIRECT_SUFFIX` | `"::direct"` | 桑基直接金额终端 ID 后缀 |
| `MAX_HIERARCHY_NODES` | `2000` | 层级计算节点上限（超出拒绝，不静默截断） |
| `MAX_SANKEY_LINKS` | `4000` | 桑基连线上限（同上；C 侧展示契约为 `C_SANKEY_MAX_LINKS`，同值） |

### 14.8 测试证据与来源

- C 侧测试：shared `analysis/advanced/batch3.test.ts` 15 项（真实层级/扁平/叶/直接终端/循环/自我父级/重复声明/孤立父引用/历史未声明分类/空/混币/负金额 + 桑基 3 项）；web `analysis/{adapters4,geometry4}.test.ts` 31 项（门控原因、层级表、旭日、Treemap 扁平、桑基守恒与布局）。
- 来源：C 文档 `465d21e`／回填 `dc91f35`；A 合并后以本节文本为准，C 侧文件保留为来源不改写。

---

## 15. C-4 FX 诊断形状正式定义（C 提供，draft；Lead QC-29/QC-30 已裁定）

> 合并来源：C 的 `S17-Agent-C-S01-v2评审-C-4-FX诊断形状与常量定义.md`（C 工作区，`465d21e`；实现 `2f7a036`／回填 `6dfbf82`，Lead m02188 转发）。状态 **draft**；`fx-diagnostic` 采用**判别联合**（Lead QC-29），P16/P17 不同基（Lead QC-30）。真实 FX 只读投影（QC-12）登记为「等 S-01 v2 冻结后接真实数据」，本草案用合成汇率夹具验证语义。

### 15.1 范围与边界

覆盖 P16–P20：币种交易构成、综合金额币种贡献、汇率历史趋势、汇率完整性、回退使用。只做 draft 数学 + 图表输入/适配层：不接真实 FX API、不接页面、不改 A 文件、不新增迁移/API。折算语义只复用权威 FX 引擎（S16-D `aggregateFxAsync`：逐笔折算、7 天回退、`minor-half-away-v1` 舍入），本草案用合成汇率观测夹具表达同一语义。金额一律 `bigint` 最小单位；汇率用精确有理数 `numerator/denominator`（展示时才转定点小数）。

### 15.2 公共子结构

```ts
export type DraftFxCompleteness = "complete" | "partial" | "no-transactions" | "unavailable";

export interface DraftFxRecord { readonly id: string; readonly kind: "expense" | "income"; readonly amountMinor: bigint; readonly currency: string; readonly occurredLocalDate: string; }

export interface DraftFxRateObservation { readonly provider: string; readonly baseCurrency: string; readonly quoteCurrency: string; readonly rateDate: string; readonly rateNumerator: bigint; readonly rateDenominator: bigint; }

export interface DraftFxRateResolution {
  readonly currency: string; readonly targetCurrency: string; readonly requestedDate: string;
  readonly rateDate: string | null;
  readonly fallbackDays: number | null;   // 0=直接命中；null=缺失；>0=回退天数
  readonly provider: string | null; readonly rateNumerator: bigint | null; readonly rateDenominator: bigint | null;
  readonly status: "identity" | "exact" | "fallback" | "missing";
}
```

### 15.3 五个子形状（判别联合，QC-29）

| `diagnosticKind` | 来源 | 关键字段（摘要） | 恒定约束 |
|---|---|---|---|
| `"currency-composition"`（P16） | C-4 §3.1 | `rows{currency,recordCount,incomeCount,expenseCount,incomeAmountMinor,expenseAmountMinor,recordShare}[]`、`totalRecordCount`、`currencyCount`、`completeness` | 只比较**笔数**；各币种金额只在该币种内合计与显示，不折算、不跨币种相加；`recordShare` 分母=总记录数 |
| `"contribution"`（P17） | C-4 §3.2 | `targetCurrency`、`rows{currency,originalSumMinor,convertedMinor,convertedCount,missingCount,fallbackCount,shareOfConverted}[]`、`totalConvertedMinor`、`convertedCount`、`identityCount`、`fallbackCount`、`missingCount`、`sharesOverConvertedOnly:true`、`missingRecords[]`、`missingRecordsTruncated`、`completeness` | `Σ rows.convertedMinor = totalConvertedMinor`；**缺汇率记录不计入分母**（份额分母只覆盖已折算部分，展示层必须写明）；缺失记录显式列出，不做 0 处理 |
| `"rate-trend"`（P18） | C-4 §3.3 | `currency`、`targetCurrency`、`points{currency,targetCurrency,rateDate,provider,rateNumerator,rateDenominator,rateScaled{scaled,decimals}}[]`、`from`、`to`、`observationCount`、`missingDateCount`、`missingDates`、`interpolation:"none"`、`change: Rational | null`、`minPoint`、`maxPoint`、`completeness` | 只画系统实际持有的**离散观测**；`missingDateCount`=区间内无观测的自然日数；**不得插值/补点**；`change` 少于两个观测时为 null |
| `"coverage"`（P19） | C-4 §3.4 | `targetCurrency`、`currencies`、`dates`、`cells{currency,date,status:"exact"｜"fallback"｜"missing"｜"not-needed",recordCount}[]`、`needsConversionCount`、`convertedCount`、`missingCount`、`exactCount`、`fallbackCount`、`notNeededCount`、`coverageRatio`、`amountCoverageAvailable:false`、`amountCoverageReason`、`missingCombinations[]`、`completeness` | 覆盖率=**记录覆盖率**（`convertedCount / needsConversionCount`），不是金额覆盖率；首版 `amountCoverageAvailable=false` 且给原因，**不得用「记录覆盖 95%」暗示「金额覆盖 95%」**；缺失组合逐条列出 |
| `"fallback-usage"`（P20） | C-4 §3.5 | `targetCurrency`、`fallbackRecordCount`、`needsConversionCount`、`maxFallbackDays`、`fallbackDaysDistribution{fallbackDays,count}[]`、`rows{currency,directCount,fallbackCount,missingCount,fallbackDays}[]`、`providers[]`、`dates[]`、`missingRateCount`、`completeness` | 只统计传入的**权威回退元数据**；无折算需求时整族显式 `available=false`（不得显示「0 次回退」的可靠结论）；没有元数据不得反推「一定没用过回退」 |

公共字段：`targetCurrency?`（P16 不适用）、`completeness: DraftFxCompleteness`、`source: SourceDescriptor`；判别字段 `diagnosticKind` 五值（`"currency-composition" | "contribution" | "rate-trend" | "coverage" | "fallback-usage"`）。`fx-diagnostic` 作为 `AnalysisResult` 的 **C-4 子联合**（v2 计数口径见 §0：C 结果为 7 稳定 + 8 draft，本族为 fx 诊断 5 子形状的判别联合，不另计 5 个结果形状；已在 §0 注）。

### 15.4 字段映射（owner 规格 §6.7 要求 → C-4 对应，9 项）

| owner 规格 §6.7 要求字段 | C-4 对应 |
|---|---|
| 原始币种 | `rows[].currency`（P16/P17/P19/P20）；`FxRateTrendResult.currency`（P18） |
| 目标币种（适用时） | `targetCurrency`（P17–P20；P16 不适用） |
| 汇率日期 | `DraftFxRateResolution.rateDate`；`FxRateTrendResult.points[].rateDate` |
| 实际汇率来源（如有） | `provider`（观测/解析/回退） |
| 实际折算状态 | `DraftFxRateResolution.status`（identity/exact/fallback/missing） |
| 可折算/不可折算记录数量 | `convertedCount` / `missingCount`（P17/P19）；`fallbackRecordCount`（P20） |
| 统计完整性 | `DraftFxCompleteness`（complete/partial/no-transactions/unavailable） |
| 适用来源 | `completeness` + `missingRecords`/`missingCombinations`（可追溯） |
| 与权威 FX 引擎的可追溯关联 | `status`/`fallbackDays`/`provider` + 复用 S16-D 折算语义（不另立引擎） |

### 15.5 QC-30：P16 笔数份额 vs P17 金额份额（不同基，已裁定）

- P16 的 `recordShare` **分母 = 总记录数**（含未折算记录，因为 P16 不折算）；P17 的 `shareOfConverted` **分母 = 仅已折算金额**（`sharesOverConvertedOnly:true`，缺失记录不计入分母），两者**不同基**。
- 默认分开呈现并各自标注分母（P16=笔数、P17=仅已折算金额、缺失≠0）；仅同币种同过滤条件允许并排，且必须带口径标签（`basisNote`/`sharesOverConvertedOnly`/`missingText`）；**不得同屏合成单一「占比」**。具体文案由 C 在 W3 给模板，v2 只登记规则（Lead QC-30）。

### 15.6 常量（C-4 §5，归属按 Lead「C 侧展示契约归 C、FX 引擎常量归 B」）

| 常量 | 值 | 单位/适用 | 越界行为 | 归属 |
|---|---|---|---|---|
| `FX_DRAFT_MAX_FALLBACK_DAYS` | 7 | 自然日，P17–P20 | 回退超过 7 天 → `status="missing"`，不放大回退 | C-4（对齐 S16-D 引擎；权威引擎常量归 B，见 §12） |
| `FX_DRAFT_RATE_DECIMALS` | 6 | 定点小数位（仅展示） | 权威仍是分数；展示舍入按 `minor-half-away-v1`，不得用于折算 | C-4 |
| `FX_DRAFT_MAX_TREND_DAYS` | 400 | 自然日，P18 区间 | 超限 → `unavailable` 并说明，不静默裁剪 | C-4（与 `MAX_STATS_DAYS` 对齐） |
| `FX_DRAFT_MAX_MISSING_RECORDS` | 200 | 条，缺失明细 | 超出截断明细并置 `missingRecordsTruncated=true`；总数仍以 `missingCount` 为准 | C-4 |
| `C_AMOUNT_DISPLAY_TIERS_MINOR` | `[10_000n, 1_000_000n, 100_000_000n, 1_000_000_000n]` | 最小单位；坐标轴/数值卡量级缩写（元/万/百万/千万/亿） | 只影响展示文本；完整值必须另处出现；<1e4 用元，≥1e9 用缩写并保留完整值 | C（展示契约） |
| `C_MAX_VISIBLE_SERIES` | 30 | 个；单图表可见序列/图例/色类上限 | 超出必须合并为「其它」且金额守恒 + `noteText`，不得静默截断；表格不适用 | C |
| `C_PARETO_KEY_FEW_SHARE` | 0.3 | 比例；帕累托「关键少数」参考线 | 纯参考线/默认展开提示，不改累计值；>30 类默认折叠其余并 note，展开不变值 | C |
| `C_COVERAGE_NEAR_COMPLETE_THRESHOLD` | 0.95 | 比例；P19 文案阈值（记录覆盖率） | ≥0.95 可标「接近完整」，<0.95 必须标「不完整」；不得四舍五入显示 100%，须保留一位小数；缺失仍计数并列出 | C（P19 展示契约） |
| `C_SANKEY_MAX_LINKS` | 4000 | 条；与 shared `MAX_SANKEY_LINKS` 对齐 | 图表输入层门控：超限不渲染桑基、退回层级表并给原因；不得截断连线金额 | C（与 C-3 共享） |
| `C_HIERARCHY_TABLE_MAX_ROWS` | 500 | 行；层级表可见行上限 | 显示前 500 行 + `rowsTruncated=true` + 「共 N 行，显示前 500」；金额合计仍用 shared 全量 | C（与 C-3 共享） |

> 归属声明：`FX_DRAFT_*` 为 C-4 诊断夹具常量（草案）；**权威 FX 引擎常量**仍是 S16-D/B 的 `FX_MAX_FALLBACK_DAYS=7`、`FX_POLICY="minor-half-away-v1"`（见 §12），两者不得混用；`C_*` 是 C 侧图表输入/展示契约，W3 图表家族与 Codex 视觉组件实现时必须落成代码常量，如需不同取值走 S-01 v2 评审，不得各家族自行改。

### 15.7 不变量与测试证据

- 不变量：每笔交易只计一次折算（`Σ convertedMinor = totalConvertedMinor`）；缺失 ≠ 0；份额分母只含已折算；P16 不跨币种求和；P18 观测数 ≤ 区间自然日数且不插值；P19 覆盖率口径=记录；混币/负金额/非法日期在输入层拒绝。
- C 侧测试：shared `batch4.test.ts` 20 项（合成汇率夹具覆盖 direct/fallback/missing/失败、日期算术、贡献守恒、趋势缺失、完整性、回退分布）；web `adapters5.test.ts` 12 项（五类图表输入的文本/份额/门控/不可用原因）。
- QC-12（真实 FX 只读投影字段与权限）登记为「等 S-01 v2 冻结后接真实数据」，不阻塞本草案；与 G-11/T2 读取范围保持一致，不扩大。
