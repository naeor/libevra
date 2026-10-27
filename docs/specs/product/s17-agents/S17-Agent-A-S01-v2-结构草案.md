# S17 · S-01 v2 结构草案（跨 Agent 汇总收敛，**已冻结 `s01-v2`**，2026-10-27）

> 最后核对：2026-10-27（本工作区 `b39b27a`，分支 `deepseek/s17-finance-category`）
> 状态：**已冻结（`s01-v2`，2026-10-27）**；冻结基线 = r7.2 + G-12a v1.1（`b39b27a` + `782b036`），协议标识统一 `s01-v2`，禁止私有版本。本文件为冻结文本（文档层），不构成对实现进度/发布时间的承诺。
> 目的：以现有 `S17-Agent-A-S01-共享分析结果协议草案.md`（s01-draft，§1–§17）为底，汇总 B 的时间扩展、C 的专业分析形状（QC-10/11/18–25 等）、D 的 S-03 布局侧引用/尺寸契约，形成**一份已冻结的 v2 结构基线**，供 B/C/D/Codex 按冻结标识实现与集成。
> 边界：**只改文档，不动代码、不改迁移**；不碰 1.16.23 基线、页面；不 push；不改 B/C/D 任何工作区文件（B/C/D 文档只读引用）。

---

## 0. 标记与负责人约定

- 👍 **已定**：来源文档已明确、可直接进入冻结稿（仍以最终评审为准）。
- 🟡 **待所有者裁定**：口径已登记但有 PI/所有者未决项，冻结前必须回答。
- 🔵 **待实现确认**：形状/字段已登记，但实现细节（字段名、阈值、序列化）需在实现批次确认。
- 负责人：**A**（协议本体/信封/类型）、**B**（时间形状）、**C**（专业分析形状）、**D**（布局引用/尺寸契约）、**Lead**（跨 Agent 裁决与转达）、**所有者**（财务/业务口径最终裁定）。

**计数口径**（2026-10-27 应 C 回执统一；冻结稿起统一使用，评审时不得混算）：

- **结果形状**（进入 `AnalysisResult` 联合、可被布局/详情/图表消费的权威输出）：A 4 + B 7 + C 7 + C draft 8 − `scatter` 合并 1 = **25 种**；其中 `hierarchy` 依赖分类层级模型、`fx-diagnostic` 依赖只读 FX 投影。`sankey` 按 C-2 回执作为 `HierarchyResult` 的**派生投影**，不新增结果形状。
- **输入 DTO**（分析输入/布局引用，不是结果形状）：`AnalysisDefinition`、`ResolvedFilters`、`ResolvedPeriod`、`FXEntry`、`AnalysisReference`、`ObjectSizeContract`、`DraftCategoryRelation`，共 **7 种**。
- **图表输入 / 派生投影**（渲染适配层，不属于结果协议冻结范围）：A 的 4 个图表输入 + 桑基/旭日/Treemap 等层级投影 + CF 家族（编号映射见 G-13a）。
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
| D · 布局侧接口 | `S17-Agent-D-S03-接口草案-布局侧-v1.md`（D 工作区，只读） | **S-03 draft v0.7**（W3 后随尺寸数值评审升版；未冻结）；Lead 六问已裁定；数值待 W3 |
| D · 正式冲突检查意见（2026-10-27） | `S17-Agent-D-S01-v2-冲突检查意见-20261027.md`（D 工作区，`4891cad`/`2d0c543`，只读；Lead m03109 转发） | 3 🔴 / 5 🟡 / 9 ✅ / 5 🟢；A 在 **r5** 处理：D-V2-01/02/03 全部采纳，D-V2-04…08 一并吸收 |
| B · 正式冲突检查意见（2026-10-27） | `docs/specs/design/S17-B-S01-v2冲突检查意见.md`（B 工作区，提交 `b7daa74`，只读；Lead m02628 转发） | 8 🔴 / 5 🟡 / 8 ✅ / 5 🟢；A 在 **r4** 处理并登记跨 Agent 冲突表 AC-B01…AC-B13；未冻结 |
| 所有者 · 书面裁定（2026-10-27） | `S17-所有者裁定-20261027-S01v2冻结方向与C1常量分类.md`（orchestrator `f215fa9`，只读；Lead m03434 转发） | D 项接受/原则接受、C-1 37 常量分类、Q1–Q8 裁定、四个「特别明确」点；A 在 **r6** 全量落实（§12 常量表、§16、G-12a 发布物、最终冻结核对结果） |
| A · r6 配套文件（2026-10-27） | `S17-Agent-A-G12a-params白名单发布形态-v1.md`、`S17-Agent-A-S01-v2-最终冻结核对结果.md`、`S17-Agent-A-S01-v2-r6-记录.md`（本工作区） | 发布形态 v1 / 一页核对结果 / 逐项记录；分享导入门关闭（`shareImportAllowed=false`） |
| 所有者 · 签认（2026-10-27） | `S17-S01v2-所有者签认-20261027.md`（orchestrator `3760675`，只读；Lead m03659 转发） | 原则认可冻结方向、授权 A 做 **r7**；四项闭合（G-28a、G-30、#3 窗口、σ/CV）；G-24/25/26/27/28b/29 落定；A 在 **r7** 落实（§3.3/§3.4/§5.1/§7/§12/§15/§16.6/§16.7/§16.9） |
| C · r7 冻结前证据回执（2026-10-27） | C 侧 `bf6de96`（Lead 验收登记 `5b5bb0c`，只读；涉及 `currencyComposition.ts`、`fxDiagnostics.ts:385-393`、`pivot.ts:34`、`dimensions.ts:37-45`） | P16 纯函数实际只产生 2 态（`no-transactions`/`complete`）、`partial` 仅 P17/P19/P20 由 `contributionCompleteness` 产生；G-30 枚举逐值实现核对；σ/CV 定点语义；A 在 **r7** 直接引用 |
| A · r7 配套文件（2026-10-27） | `S17-Agent-A-S01-v2-r7-记录.md`（本工作区） | 八项逐项记录（G-24/25/26/27/28a/30/#3/σ-CV）+ 证据 + 待回执 |

**已并入 S-01 draft 的跨 Agent 结论**（见 s01-draft §15–§17）：B 七形状命名归 A、`dataVersion`/`coverageEnd`/`bucket` 语义、半开↔闭区间换算、区间上限两类边界、闰日对齐、A05 默认窗口政策。

---

## 2. 统一结果信封（v2 冻结候选）

沿用 s01-draft `AnalysisResultBase`，v2 只做**只增不改**的扩展：

| 字段 | v2 口径 | 状态 |
|---|---|---|
| `version` | `"s01-v2-draft"`（冻结时定正式版本串） | 🟡 版本号命名待 Lead 定 |
| `analysisId` / `analysisType` / `metric` | 沿用；`analysisType` 命名空间 `<domain>.<name>`，domain ∈ `basic\|category\|time\|dist\|cross\|record\|fx`（开放，**`fx` 由 XC-02 补入**：P16–P20 的 FX 诊断以 `analysisType="fx.*"` 自描述，不依赖单值枚举；未知域允许 `<domain>.<name>` 形式）；**`metric` 允许 `count`**（计数类序列用整数，`MoneyValue` 不适用；也允许 `<domain>.<name>` 形式，未知 metric 必须带 `unavailableReason`，不得静默当 0）——B-V2-05 澄清已采纳 | 👍（B-V2-05、XC-02） |
| `resolvedFilters` / `resolvedPeriod` / `resolvedCurrency` | 沿用；`resolvedPeriod` 仍为**闭区间**；月键比较另带比较键元数据 | 👍 |
| `completeness` | 沿用 9 态，**9 态仅用于整结果层**；**时间桶级使用五态 `state`（不新增桶级枚举）**，与 §4.10/B-V2-04 同一表述；桶级可带 `unavailableReason?`，不得用 9 态覆盖桶状态（**D-V2-01** 采纳，与 §4.10 合并） | 👍（D-V2-01、B-V2-04） |
| `dataVersion` | 书级数据版本令牌，由计算入口提供、A 只透传；**分析结果缓存键**必须包含 `dataVersion`；**布局投影缓存键**由 S-03 §4 作为实现约定定义（不含 `dataVersion`，几何投影不依赖分析结果版本）——**D-V2-04** 澄清。**B-V2-08 澄清**：web 客户端本地计算路径当前无服务端入口，允许 `string \| null`（`null`=客户端本地计算、非权威），取值规则由 **G-10** 裁定；冻结前不得把客户端令牌当权威 | 🟡 G-10（B-V2-08 已登记） |
| `computation` | 增可选 `method`（如 `quantile-type7`/`population-stddev`/`histogram-sturges`；**B-V2-10 补充取值**：`population-stddev`/`sample-cv-fixedpoint`/`mad-median`/`iqr-quantile`，开放字符串、未知值透传不重算；**XC-07/XC-41**：直方图算法名与算法本体待所有者裁定——C 现实现为 `histogram-nice-bin-width`（非 Sturges），分位名 C 用 `type7-linear`，v2 暂登记两候选、冻结前统一）、`sampling?`（仅**视觉层**采样元信息，不可回算；**XC-08/XC-35**：结果层可追溯采样字段（如 `strategy`/`omittedCount`/`sampleCount`/`complete`）为权威，`computation.sampling` 只作视觉标注且不得与结果层冲突）、`coverageEnd?`、**`analysisLimit?`**（`maxAnalysisDays`/`maxMonths` 及 C 的 `MAX_*` 越界可追溯，B 缺口 1 / G-18 / **XC-09**） | 🟡 字段名/是否进冻结待评审（R-09） |
| `source` | `SourceDescriptor.query.kind` 增 `"analysis-records"`、`"fx"`（记录级/FX 只读投影）；`bucket?`（B 时间桶，格式 `{ key, granularity, span: { start, end } }`）；按 B X-02 **删除 `timeBucket?`**，不保留两套桶引用；**B-V2-06 收窄映射见 §4.4**（`stats`/`transactions`/`analysis-records`/`fx`，允许 `kind: string`+可选 `params`，未知 kind 必须报 `unavailableReason`） | 🟡 待裁定（QC-01/QC-13/G-02） |
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
| `time-series` | B04/I06…I16 | `granularity day\|week\|month`、`buckets[]`（半开 span + 闭区间换算）、`axis`；**`total` 口径见 §4.1**（B 实现：`Σ state∈{complete,in-progress}`；任一 `unknown`→`total=null`；`future` 不计入；`complete=(unknown==0&&future==0&&inProgress==0)`；null 时附 `unavailableReason`）；**B-V2-01 已修**：删去旧「只对 complete 桶求和」的矛盾表述 | 👍（B-V2-01 已修） | B |
| `multi-series` | B04 多分组/P14 小多图 | 多序列共用桶轴；`series[]` | 👍 | B |
| `period-comparison` | A01–A05 | 两期 + 差额/增长率；`previous<=0` 给不可用原因；`leapDayFallbacks`/`policyId` | 👍（B-16/B-17 待裁定） | B |
| `calendar-heatmap` | B08/I19（**B-V2-02 更正**：I12 = 每日支出波动 A12；「支出分类构成」= I14；日历 = B08/I19） | 逐日 value/count/state/level；五态；周一起始；只对完整日计算强度 | 🟡 B-17 一致性待裁定（唯一实现归 B 的 `timeCalendar`/`calendarHeatmap`） | B |
| `moving-average` | A13/A14 | 尾随 7/30 日历日；精确分数；窗口不足/含未知→不插值 | 👍 | B |
| `variability` | A12（每日支出波动）/A20（收入稳定性） | 均值精确分数、总体 σ、CV（定点）、均值±σ 带、样本阈值、`judgedState` | 🟡 B-16 A12 口径待裁定 | B |
| `anomaly` | A19 | MAD→IQR→分位退化链、阈值与参数可追溯、今天排除 | 👍 | B |

**B 的不变式（IV-01…IV-14）**：覆盖连续无缺口、ISO 周键稳定、桶和=total（完整桶）、精确金额、币种隔离、复用 FX、缺失≠0、future 不计入、in-progress 保守、来源可复原、同结果内 `dataVersion` 一致、axis 无像素、分母 0→null、只读。→ v2 冻结稿作为「时间形状通用不变式」收录（👍 已定，B 负责）。

### 3.3 C：专业分析七形状（C-0 草案，QC-01 基线）

| 名称 | 来源映射 | 关键字段摘要 | 状态 | 负责人 |
|---|---|---|---|---|
| `ranked-records` | I18/A16 | 记录级排行：recordId/金额/业务日期/分类/支付方式/`share`/`tieCount`/`total`/`sampleComplete` | 🟡 待裁定（QC-01/QC-02） | C（A 收口） |
| `distribution` | A09/A10/A11/P12/P23 | 直方图箱 + 分位（Type 7）+ 总体方差/σ + 离群围栏；`method` 可追溯。**G-24 已裁定（所有者签认 `3760675`）**：默认 `histogram-nice-bin-width`；`histogram-sturges` **只保留为候选算法，未实现不得宣称支持**（不得写入“已支持”的 `method` 枚举集合）。**G-25 已裁定**：分位点必填 P25/P50/P75 + IQR；P10/P90 仅在显式参数时输出，`quantileSet` 可追溯。 | 👍 已裁定（r7，QC-10/QC-11 口径见 §16.6） | C（A 收口） |
| `contribution` | A06/A07/A17/P22/P24 | 两期分类贡献：previous/current/delta/growth/deltaShare + 新增/消失标记；**XC-18**：引用编号更正（本行不引 QC-04，退款/负金额语义与形状无关；growth=null 口径见 QC-17）、**纳入守恒字段** `conservation{rowsDeltaMinor,matchesTotal,matchedBy}`（否则「ΣΔ=Δ总」无法在结果层证明） | 🟡 待裁定（QC-17） | C（A 收口） |
| `matrix` | P01/P02/P03/P04 | 二维交叉表（分类×时间/支付方式）；守恒校验。**XC-19 已裁定（G-26，r7）**：`matrix` 只保留 P01/P02/P03/P04；**P13 四指标交叉表归 `pivot`**，P13 不得双挂 | 👍 已裁定（G-26） | C（A 收口） |
| `hierarchy` | P05/P06/P07 | 层级聚合；**依赖分类层级模型（QC-03 未批准）** → 首版单层退化 + 显式标注；**旭日/桑基是 `HierarchyResult` 的纯派生投影（QC-28，不新增结果形状）**：层级不完整时旭日/桑基**拒绝启用并给原因**，Treemap 退化为单层扁平（面积仍=金额占比）；桑基 ≤4,000 连线、守恒四项。**正式定义见 §14**（C 提供：`DraftCategoryRelation` 输入 DTO、四项守恒、`hierarchyIsUsable` 门控、`MAX_HIERARCHY_NODES=2000`） | 🟡 依赖所有者（QC-03）；输入 DTO/守恒/门控已按 G-16 正式定义并入 | C |
| `scatter` | P10/P11 | 散点/气泡：点数上限策略、`omittedCount`、`complete`。**XC-21/XC-27**：以 C-2 实现 `DraftScatterResult` 字段为准（`strategy:"none"\|"top-amount"`/`omittedCount`/`sampleCount`/`complete`）；C-0 旧草案文本标「已被实现取代」，不再称「两版」 | 🟡 待裁定（QC-19/QC-20） | C（A 收口） |
| `fx-diagnostic` | P16–P20 | **判别联合形态（Lead QC-29 裁定）**：`diagnosticKind: "currency-composition"｜"contribution"｜"rate-trend"｜"coverage"｜"fallback-usage"` 五子形状，公共字段 `targetCurrency?`/`completeness`/`source`；**正式定义见 §15**（C-4 文档 `S17-Agent-C-S01-v2评审-C-4-FX诊断形状与常量定义.md` @ `465d21e`）；P16 笔数份额与 P17 金额份额**不同基**（QC-30，§15.5）；**P16 状态集合为三态 `complete｜no-transactions｜unavailable`（无 `partial`），触发规则见 §5.1-8（r7 闭合）**；只复用权威 FX 引擎，不自造汇率 | 👍 形状族已收口（r7：P16 三态闭合；QC-12 真实只读投影仍待 G-11 批准） | C（A 收口） |

### 3.4 C：C-2 新增八个 draft 形状（QC-18…QC-25）

| 名称 | 来源 | 关键字段摘要 | 状态 | 负责人 |
|---|---|---|---|---|
| `rank-migration` | P09（QC-18） | 上/本期名次、并列策略、moved/new/removed 计数；**XC-26**：并列策略常量 `rankingPolicy="amount-desc-id-asc-ties-share-rank"` 补入 §12 枚举常量组（字段名冻结时以 C 实现为准） | 🟡 待裁定 | C（A 收口） |
| `scatter`（draft 合并） | P10（QC-19） | 与 3.3 的 `scatter` **合并为一个形状**（C 的两版草案需对齐） | 🟡 | C + A |
| `bubble` | P11（QC-20） | count/sum/mean/share；无笔数时 mean/share = null | 🟡 | C |
| `boxplot` | P12（QC-21） | Type 7 分位、1.5×IQR 围栏、`BOXPLOT_MIN_RELIABLE_SAMPLE=5`（**G-07 已裁定：5=最低计算门槛，非统计可靠样本；名称/展示标注调整 T-4**）、`maxOutliers`（默认 20，仅展示上限，统计用全样本） | 🟡 阈值已裁（G-07/#31） | C + A |
| `pivot` | P13（QC-22） | 四指标、行列合计、守恒校验、稀疏空=「未发生」非 0、`MAX_PIVOT_CELLS=2500`；`PIVOT_METRICS=["amount","count","average","share"]`（4 值，见 §12，**G-30 已列值 F**）；**G-26 已裁定：P13 归 `pivot`（本行即 P13 正式归属）**，`matrix` 不得再收 P13 | 👍 已裁定（G-26/G-30） | C |
| `small-multiples` | P14（QC-23） | `scaleMode`、`topN≤24`、桶键须与 B 时间序列同口径、截断说明；**XC-31**：结果必须携带 `granularity` 并复用 B 的 `TimeAxisHint`（或直接引用 `time-series` 形状），否则桶口径无法证明；`MAX_SMALL_MULTIPLES_TOP_N=24` 补入 §12（默认 12） | 🟡 待裁定 | C + B |
| `calendar` | P15（QC-24） | 五态、`weekIndex` 周一起始、`leapYear/weekCount`、`intensityMin/Max`；**B-V2-03 更正：须与 B 的 `calendarHeatmap`（B08/I19）同结果、不另立日历系统**（不是 I12；I12 是每日支出波动）。**XC-32**：v2 **只冻结 B 的 `calendar-heatmap`**，C 的 `calendar` 作为纯投影/适配，不单独冻结为结果形状（C 已在回执同意）；A §3.4 行按此调整 | 🟡 归属已澄清（投影）/🟡 数值待 W3 | C + B |
| `cross-cube` | P21（QC-25） | 受控维度/指标白名单、≤3 维、≤5,000 组合、跨币种必须含 currency 维、长表输出、拒绝原因枚举；**G-30 已列值**：`ADVANCED_DIMENSIONS=["category","paymentMethod","kind","currency","month","week","weekday"]`（7 值，见 §12，F）；后端查询依赖属 T2/G-11 批准范围 | 👍 已裁定（G-30） | C + 后端 |
| `sankey`（QC-28，**纯派生投影，不新增结果形状**） | C-3 P07 | 由 `HierarchyResult` 纯投影派生（`${id}::direct` 直接终端、≤4,000 连线、四项守恒）；层级不完整/未知分类时拒绝启用并给原因 | 👍 投影归属（C-2 回执）/🟡 数值上限 | C |

> 计数：见 §0「计数口径」（结果形状 25、输入 DTO 7、图表输入/投影另计）。旧「C 结果形状共 7+7=14」仅指 C 侧形状；`hierarchy` 依赖模型、`sankey` 为派生投影。C 的 20 个图表家族编号与 Codex/S-02 的 CF 编号映射未定（QC-15）。

---

## 4. B 时间形状的统一规则（v2 冻结候选）

1. **区间**：用户/结果用闭区间 `[from,to]`；桶内部半开 `[start,end)`；`bucketToInclusive(bucket)` 是唯一换算（日粒度 `to = addDays(end,-1)`）。
2. **桶状态**：`complete|in-progress|future|unknown|unavailable` → 复用 `AnalysisCompleteness` 映射（B §4.2，见 §4.10）；`total` 口径：**B-V2-01 与 B 实现（`timeSeries.ts` @934680c）对齐**——`total = Σ(state∈{complete,in-progress})`；`future` 不计入；**任一 `unknown` 时 `total=null`**，且必须附 `unavailableReason`，不得补 0；`in-progress` 可计入但结果层 `complete=false` 明示；`complete=(unknown==0 && future==0 && inProgress==0)`；桶对象自身保留五态 `state`（不把 9 态塞进桶，见 §4.10 与 B-V2-04）。
3. **轴**：`TimeAxisHint` 属于结果（业务日期、周一起始、桶粒度）；locale/颜色/像素归渲染层。
4. **来源**：整图级 `SourceDescriptor` + 桶级 `bucket?`；点击桶按 `bucket.from/to`（闭区间）取来源，权限重新校验。**B-V2-06 映射表**：`kind ∈ { stats（原币聚合）, transactions（原币逐笔）, analysis-records（记录级只读投影）, fx（汇率折算投影） }`，允许 `kind: string` + 可选 `params`；未知 kind 必须带 `unavailableReason`，不得静默；B W1 原币只用 `transactions`/`stats`。
4.1 **桶 `span` 裁剪语义（B-V2-07）**：`bucket.span` = 裁剪到分析区间的半开区间 `[start,end)`；`naturalSpan` = 未裁剪的自然桶；`clippedStart/clippedEnd` 标记裁剪边界；`bucket.from/to = bucketToInclusive(span)`；禁止用未裁剪自然桶反推合计或来源。
5. **区间上限**：按 s01-draft §17——月键比较不设日上限（月数暂记 ≤36）、日窗口 `maxAnalysisDays` 默认 400、闰日 2 月末对齐逐条记录、A05 默认 `same-day-index` + `policyId`。
6. **A12 波动性口径（B-16 待裁定）**：均值精确分数、**总体** σ、CV 定点表示（位数待定）、均值±σ 带、`sufficientSample=false` 明示（样本阈值 7 天）、今天/进行中桶不入样（`todayExcluded`）、零收入月单独计数、**A20 最小样本 3 个月**（B 评审要求写入 v2）、**极值日 = 偏离均值 > N×总体 σ**（`extremeSigma`，默认 N=2，D-02 待所有者裁定）。→ 与 s01-draft §16.2 一致的部分标 👍，CV 定点位数/阈值/N 值标 🟡。
7. **日历一致性（B-17 待裁定）**：**唯一实现归 B**——`timeCalendar.ts`（日历算术/桶键/五态）+ `calendarHeatmap.ts`（逐日强度分位 0–4、周一起始月矩阵）；`weekCount` = 与 ISO 周交叠的 Monday 起始行数、`leapYear` = 2 月天数；C 的 `calendar`（QC-24）只做投影/适配（`weekIndex` 由 `isoWeekOf` 派生、不重算分位、不另立五态）；强度以 B 分位等级为权威，C 的 `intensityMin/Max` 仅图例显示区间。
8. **综合模式数据源：B-S01v2-01 `FxAggregate` 逐日/逐笔投影（additive，🟡 待裁定）**：B 提案在 `packages/shared/src/fx.ts` **新增**（不改既有函数）`FxDetailedAggregate extends FxAggregate`，含 `detail.daily`（业务日期 → `FxTotals`；只含至少一笔成功折算的日期，缺失日不出现≠0；`Σ daily = totals` 用 BigInt 精确守恒）与 `detail.entries`（`FxConvertedEntry[]`，逐笔金额直接取 `convertFx` 结果、输入序、失败笔不在其中），经 `aggregateFxDetailed`/`aggregateFxDetailedAsync` 暴露；`includeEntries` 默认 `false`，`FX_MAX_DETAIL_ENTRIES = 50_000`，超限抛 `fx_detail_limit`（不截断、不返回部分结果）；异步 `signal` 取消不返回部分结果；`complete=false` 时 `daily` 只表示「已成功折算部分」，时间分析必须把 `failures` 日期映射为 **unknown**（非 0）并降级整体完整性；`aggregateFx`/`aggregateFxAsync` 签名与唯一消费方 `fxView.ts` 零改动。**综合模式的时间/分类/来源分析只能消费该投影，不得在页面层另写一套折算**。
   - **Lead Q-BP 最终裁定（2026-10-27）**：①字段名用可选 `detail`，类型 `FxAggregateDetail`/`FxDetailedAggregate` 保持、不更名；②`maxEntries` 默认 50,000 是**默认上限/保护值**，逐笔明细视图必须**显式传参**，文档须写明「默认值只是保护，不得作为业务契约」；③`maxEntries`(50k) 与 `maxAnalysisDays`(400) 属**不同轴，不强行对齐**，v2 并列登记、各自默认值；④`detail.daily` **恒输出**（稳定图表与守恒检查），`entries` 保持可选；⑤正式定义**已并入 §13**（B 提案 §16；首次落盘 `f3bd4d6`／回填 `a2539bd`，D-05 修订版 `7405194`／回填 `3792ace`，以 `7405194` 为准）；A 已按 Lead **D-05 裁定**将 `FxConvertedEntry.kind` 收窄为 `"income" | "expense"`、删除 `"transfer"`、补 IV-G17-13 与 §13.5-4 未来扩展条款；⑥性能规范采纳（异步批次 + `yieldControl`、**不得在渲染帧同步聚合**），引用 B 基线文档 `docs/specs/design/S17-B-性能基线.md`。
9. **月键上限常量落位（B-S01v2-02，additive，🟡 待裁定）**：shared `fx.ts` 增 `FX_MAX_RANGE_MONTHS = 36` 与 `fxRangeMonths(from, to, maxMonths = FX_MAX_RANGE_MONTHS)`（含首尾月枚举、超限抛 `fx_range_too_long` 不截断、非法入参抛 `fx_range_invalid`）；web `rangeMonths` 委托 shared、默认上限 14 → 36（draft，W1 接入时生效；15–36 个月不再抛错是唯一行为变化；W1 页面行为由 B 在切分方案中明确）；与 s01-draft §17.1(a)/G-09 一致，日窗口 `maxAnalysisDays` 仍由 analysis 调用方传入；Lead 已批准「15–36 月不再抛错（draft，W1 接入生效）」。**正式定义与默认值表见 §13（B 提案 §16 @ `7405194`，D-05 修订版；首次落盘 `f3bd4d6`）：`fxRangeMonths.maxMonths` 默认 36、范围 1..1200。**（B-V2-12 状态更新：B 已实现 web `rangeMonths` 委托 shared（`13428bd`），当前仍为 draft；页面可见变化在 W1 接入生效，v2 §12 保持 O/draft 状态。）**生产基线（1.16.23）web 汇率读取上限仍为 14 个月（`fxView.ts:61-69`，Lead m03807）；B 分支 draft 已实现 `rangeMonths` 委托 shared `fxRangeMonths`（`FX_MAX_RANGE_MONTHS=36`，提交 `13428bd`）但**未接入生产**，W1 接入生效前生产读取范围不变，不得把「分支已实现」误读为「已生效」。**
10. **五态 → 9 态映射表（G-20，B 草案 §4.2 可核对版）**：

| 时间桶 `state` | `completeness`（9 态） | 说明 |
|---|---|---|
| `complete` | `complete`（无数据时 `no-transactions`） | 桶内数据完整；空桶按「无交易」而非 0 处理 |
| `in-progress` | `no-transactions` 或 `complete`，且结果层 `complete=false` 明示 | 当前进行中桶（今天/本周/本月） |
| `future` | `not-applicable` | 未来桶，不参与合计 |
| `unknown` | `offline-incomplete` | 离线覆盖不足/数据未知；**缺失≠0** |
| `unavailable` | `fx-incomplete` / `request-failed` / `no-permission` | 汇率缺失、请求失败或无权限；按原因细分 |

**B-V2-04 补充**：五态是**桶对象自身的 `state`**（B 已实现，不压缩成 9 态）；9 态 `completeness` 只出现在整结果层；桶级可带 `unavailableReason?` 供消费方解释，不得用 9 态覆盖桶状态。

11. **B 字段名以 B 草案 §3.7 为准（B-V2-09）**：`time-series`/`multi-series`/`period-comparison`/`calendar-heatmap`/`moving-average`/`variability`/`anomaly` 的字段名逐字采用 B 草案 §3.7；v2 冻结时「逐字并入 `types.ts`」，A 侧不得先改名再冻结。
12. **v2 不含 `quarter`/`year` 粒度（B-V2-13）**：G-08 建议 v2 明确标注「不纳入、另立提案」；当前 `granularity: day|week|month` 不变，季度/年度须先补口径再立提案。

---

## 5. C 专业形状的接入规则（v2 冻结候选）

- C 的形状全部 `extends AnalysisResultBase`，金额 `bigint`/JSON 字符串、比例 `Ratio`、缺失≠0（与 A 一致）。
- C 需要的公共扩展（QC-01）：①`AnalysisResult` union 纳入 C 形状（或按 `analysisType` 允许 `c.*` 子联合）；②`SourceDescriptor.query.kind` 增 `analysis-records`/`fx`；③`ComputationMetadata.method`/`sampling?`。→ 均标 🟡，由 A 在 v2 冻结稿收口。
- C 的分位/离散度（QC-10/QC-11）引用 s01-draft §16：Type 7 精确分数算法、总体 σ 默认、`SqrtValue`/`CoefficientsOfVariation`、`varianceKind`。→ 👍（口径已登记，字段名 R-10 待评审）。
- C 的 8 个 draft 形状（QC-18…25）：冻结前需逐项确认是否升为正式形状、字段名与阈值（尤其 `BOXPLOT_MIN_RELIABLE_SAMPLE=5`、`MAX_PIVOT_CELLS=2500`、`topN≤24`、`MAX_*` 上限）。→ 🟡。

### 5.1 C 核验清单（XC-01…XC-50）处理规则（修订 r4）

> 来源：C《S-01 v2 冻结前交叉核验清单》（C worktree `docs/specs/product/s17-agents/S17-Agent-C-S01-v2冻结前交叉核验清单-20261027.md`，HEAD `fe9b939`，只读）；逐条处理记录见 `S17-Agent-A-S01-v2-r4-核验处理记录.md`。下表只收录**已直接改写进 v2 的规则**；需所有者裁定的条目见 §7 G-24…G-33 与「最小待所有者问题集」。

1. **版本/命名（XC-01/XC-05/XC-06/XC-40）**：C 的 `ADVANCED_DRAFT_VERSION="c1-draft"`、`DraftRational` 等 draft 名不进协议；冻结后统一引用 S-01 v2 的 `version`，C 类型去 `Draft` 前缀时把 `DraftRational` 改名为 `Ratio`（不保留别名）；金额一律 bigint（进程内），C 结果不得出现金额 number。
2. **来源结构（XC-03/XC-13/XC-15）**：C 结果经 `AnalysisResultBase` 获得 `source: SourceDescriptor`；C 的 `ChartSource{analysisId,title,currency,complete}` 是 `SourceDescriptor` 的**派生视图**，图表输入由适配层从结果注入 `source`，不得两套并存；旭日/桑基/Treemap 的「拒绝原因」属图表输入层，由 S-02/Codex 渲染，不写回结果金额。
3. **完整性映射（XC-04/XC-34，C 三/四态 → 9 态；G-27 已裁定，r7 写入限定）**：`DraftCompleteness`：`complete`→`complete`（无数据→`no-transactions`）、`no-transactions`→`no-transactions`、`unavailable`→按原因 `fx-incomplete`/`request-failed`/`no-permission`/`not-applicable`。**`DraftFxCompleteness.partial → fx-incomplete` 只适用于「不完整明确由汇率缺失造成」的情形**（判断依据：FX 权威引擎 `failures` 非空 / 某笔 `rate resolution.status="missing"` / `missingCount>0` 且无其他阻断原因）；**其他原因的不完整必须按自身原因映射，不得误标为 FX 问题**。反例：①请求超时或多笔查询失败 → `request-failed`；②只读成员无权限 → `no-permission`；③离线覆盖不足/数据版本未知 → `unknown`（或按 §4.10 五态映射）；④P19 记录覆盖率不足但汇率全部命中 → 不可标 `fx-incomplete`（应按覆盖原因标注并在 `unavailableReason` 写明）。混合原因按阻断优先级 `no-permission > request-failed > fx-incomplete > unknown` 取最上游原因，并在 `unavailableReason` 记录明细；C 回执确认 `DraftFxCompleteness.partial` 语义。图表输入不得退化为 `complete:boolean`，保留 `completeness` 枚举或 `availabilityReason`（XC-14/XC-25）。
4. **采样（XC-08/XC-35）**：结果层可追溯字段（`strategy`/`omittedCount`/`sampleCount`/`complete`）为权威；`computation.sampling?` 仅标注「视觉层采样」，不得与结果层冲突（同一事实单一来源）。
5. **限额（XC-09）**：`analysisLimit?` 覆盖 C 的 `FX_DRAFT_MAX_TREND_DAYS=400`、`MAX_PIVOT_CELLS=2500`、`MAX_CUBE_*`、`MAX_SANKEY_LINKS`、`C_HIERARCHY_TABLE_MAX_ROWS=500` 等；超限必须显式携带 limit 原因（如 P18 超 400 天→`unavailable` + 原因），不得只靠适配层 note。
6. **base 包装形态（XC-24）**：C 正式类型 = `AnalysisResultBase & { shape: "<c-shape>" } & <C draft 字段清单>`；字段清单以 C 实现 `draftTypes.ts` 为准、冻结时逐字并入 `types.ts`；v2 不重新发明 C 字段名。
7. **矩阵/透视（XC-19）**：`matrix` 仅 P01/P02/P03/P04；P13 归属 `pivot` 或 `matrix` 待裁定（G-26），裁定前不双挂。
8. **P16/P20 状态（XC-22①③；G-28a 已闭合 / G-28b 已裁定，r7）**：
   - **P16（`currency-composition`）真实状态集合（三态，无 `partial`）**：`completeness: DraftCompleteness`（`"complete" | "no-transactions" | "unavailable"`）。**触发规则**：①`rows.length > 0` → `complete`（每个币种都有记录；P16 不折算，无需汇率，不因缺汇率而不完整）；②`rows.length === 0`（输入记录为空集）→ `no-transactions`；③上游数据不可用（权威原因列表见 §15.2：`no-permission`/`request-failed`/`not-applicable` 等；离线覆盖不足属结果层映射 `unknown→offline-incomplete`，不归 `not-applicable`）→ `unavailable`，由结果信封按 §5.1-3 映射到 9 态，**纯函数 `currencyCompositionOf` 不返回 `partial`**。实现证据（C `currencyComposition.ts` @ `465d21e`）：`const completeness: DraftCompleteness = rows.length === 0 ? "no-transactions" : "complete"`，函数内无 `partial` 分支；测试 `batch4.test.ts` 覆盖空输入→`no-transactions`、非法记录→`RangeError`。**矛盾已删除**：P16 恒无 `partial`；`DraftFxCompleteness.partial` 只属于需要折算的 P17–P20，且按 G-27 仅在汇率缺失根因下映射为 `fx-incomplete`。
   - **P20 `available` 归属（G-28b 已裁定：进结果层）**：P20 结果增加 `available: boolean`（「无折算需求」时 `false`）与可选 `unavailableReason`；web 适配层 `adapters5.ts` 改为只消费结果层字段，不再独立推导（派生视图可保留作展示，但不得作为权威来源）。语义不变：无折算需求时不得显示「0 次回退」的可靠结论。
   - P19 补 `rows[]`、`FX_DRAFT_AMOUNT_COVERAGE_REASON` 补登 §12（已按 C 实现）。
9. **分位点集合（XC-17；G-25 已裁定，r7）**：distribution **必填 P25/P50/P75 + IQR**；**P10/P90 仅在显式参数时输出**（`quantileSet` 含 `p10`/`p90`，并在结果中可追溯）；不得两个 Agent 给出不同分位集合；直方图算法见 G-24（默认 `histogram-nice-bin-width`，`histogram-sturges` 仅保留候选、未实现不得宣称）。
10. **枚举/常量（XC-26/30/33/37/38/39/41/42/44/45）**：见 §12「枚举与文本常量组」：`PIVOT_METRICS`、`ADVANCED_DIMENSIONS`、`diagnosticKind` 5 值、`DraftHierarchyNodeKind`、`rankingPolicy`、`C_SANKEY_MAX_LINKS`/`MAX_SANKEY_LINKS` 同值别名、`MAX_SMALL_MULTIPLES_TOP_N`；展示文案（`WEEKDAY_LABELS`/`UNSPECIFIED_PAYMENT_METHOD_LABEL`/`DIRECT_LABEL_SUFFIX` 等）**不进协议**，只登记归属；方法串（`type7-linear`/`population-stddev`/`histogram-nice-bin-width`）已随 G-24 统一为 F；**`histogram-sturges` 不列入「已支持」**，仅登记候选、未实现不得宣称。
11. **Codex 合同副本（XC-46/XC-47/XC-48）**：`apps/web/src/workbench/contract/types.ts` 是 s01-draft v1 快照副本，**A 不改 Codex 分支**；集成阶段由 Lead 决定单一来源（从 shared 导入 v2 类型并删除副本，或标「预览专用、不冻结」），v2 标注「待收敛」。C 图表输入 → Codex props 映射属 W3（S-02）。
12. **参数键空间（XC-49）**：`AnalysisReference.params` 白名单（G-12a）须纳入 C 的参数键（P13 维度/指标、P21 维度组合、P18 币种/区间、P06/P07 层级模式），只允许枚举/预设键/相对区间，禁私人信息；由 A 出发布形态、D 按形态校验。
13. **尺寸（XC-50）**：`ObjectSizeContract` 的三档密度数值待 W3（Codex/D）；C 的降级策略（如桑基极小退层级表）随密度档位后在 W3 定；A 的 `CARD_DENSITY_THRESHOLDS` 仍为占位（P，**D-V2-05**：非布局契约、不纳入 S-01 冻结数值；单一来源=图表与卡片规格/S-02，W3 由卡片家族声明、S-03 承接、D 只接收真实格子尺寸与形态）。
14. **`fx-diagnostic` 域（XC-02）**：`analysisType` 已补 `fx` 域（§2），`analysisType="fx.*"` 自描述、不依赖单值枚举。
15. **dataVersion/coverageEnd（XC-10）**：draft 结果未包信封属预期差异，冻结后由 base 提供，无需额外设计。

---

## 6. 布局侧引用契约（D · S-03 draft v0.7，非规范性引用）

> **非规范性引用声明（D-V2-02，Lead 裁定采纳 A+B 组合）**：本节为**非规范性引用**，权威定义 = S-03 `S17-Agent-D-S03-接口草案-布局侧-v1.md`（draft **v0.4**，W3 后随尺寸数值评审升版）；**S-01 冻结不冻结 S-03 契约文本**，字段形状如有差异**以 S-03 为准**。本节仅用于说明「分析定义在布局中的引用形态」，不构成布局契约的第二份规范副本。

S-01 v2 与 S-03 的边界：**S-01 负责分析结果/定义；S-03 负责引用与尺寸契约**。v2 结构草案收录 D 的两个契约作为「分析定义在布局中的引用形态」：

### 6.1 `AnalysisReference`（D 草案，已存在于代码）

- 字段：`analysisId`（目录 ID，如 `an-b01`）、`analysisVersion?`、`params: Record<string, unknown>`（规范化参数，相对/预设优先）。
- 规则（D 已裁定）：布局只存引用，不存结果/金额/区间展开值；`params` 只允许白名单键；`pinned` 卡片必须带 `pinnedRange` 且标题可见；未知 `analysisId` → 只读占位 + 提示更新，不回写、不删未知字段；布局层永不按金额/结果改顺序或尺寸。
- **D-V2-06 采纳**：**未知/较新 `analysisVersion`** → 只读占位 + 提示更新，**不回写、不删未知字段、不自动改参数**（缺省=跟随当前目录版本）；该规则同时见 G-12b，与 S-03 §2 同义。
- D 评审（X-01）补充：`params` 值约束与隐私黑名单（禁账本/交易/成员 ID、自建分类/标签名等私人信息，仅 JSON 标量/枚举/预设键/相对区间）→ 见 **G-12c**；白名单发布形态由 A 出（**G-12a**）；未知/较新 `analysisVersion` 行为见 **G-12b**。
- 状态：👍（S-03 draft v0.7 引用形态，Lead 已评审；S-01 仅非规范性引用）；**待定**：目录 ID/版本冻结方式、`params` 白名单是否由 S-01 统一提供（🟡 → 见 G-12a/G-12b/G-12c）。

### 6.2 `ObjectSizeContract`（D 草案，已存在于代码）

- 字段：`objectId`、`minSize`、`sizeLadder`（降级档顺序）、`compatSize?`（默认 1×1）、`collapsedSize?`（容器 1×1）、`minFullCols?`。
- 规则（D 已裁定）：声明方为卡片家族（W3 批 1 声明、原型/真机冻结；W3 前只登记占位数值，其他层不得发明）；布局只执行；缺契约降级到 1×1 并记 `missing-contract`；密度档由卡片家族按真实宽高选择，不持久化；容器沿用同契约（暂不拆 `ContainerGeometryContract`）。
- 状态：👍（S-03 draft v0.7 引用形态，非规范性引用）；数值待 W3（🟡）；`contractVersion?`/`maxSize?`/`aspectRatioHint?` 为建议字段（🔵 未实现）。D 评审（X-01）注：`aspectRatioHint` 归 **OQ-LM-09（容器长宽比 / W5 视觉）**，不得在 S-01 冻结时变成布局契约；`contractVersion` 将来只作**尺寸声明版本**、不进权威布局；`contractVersion` 不得替代 S-01 的 `analysisVersion`。

### 6.3 与 S-01 的接口点（v2 需明确）

1. 布局文档中的 `AnalysisReference.analysisId` 与 `params` 只由分析目录/定义消费；S-01 不接收几何信息（D 不把几何写入财务分析定义）。
2. `rangePolicy`（`inherit` 默认 / `pinned` 带预设区间）由分析定义/详情页解析，布局层不改时间筛选、不展开区间。
3. 尺寸/密度契约不影响权威金额：同一 `AnalysisDefinition` 在不同尺寸下结果一致（ACC-02），密度只影响展示。
4. 版本：布局 `schemaVersion`/`layoutAlgorithmVersion` 与 S-01 `version` 相互独立；分享/导出只带引用与配置，不带账务数据。

---

## 7. 冻结检查清单（冻结前必须回答）

> 负责人默认为**所有者**（业务/财务口径）或 **Lead**（跨 Agent）；A 负责把答案写回协议。未回答项不为空泛，均为可验证问题。
>
> **r6 注（2026-10-27，依据所有者裁定 `f215fa9`）**：**G-15（版本命名/差异/迁移）与 G-33（常量 F/C/O/P 归类）已由所有者裁定解决**（→ §16.3 Q5/Q7、§16.5、§12）；**G-09 部分解决**（400 天确认；3,660 天=C 需显式请求+性能保护；36 月默认确认，可配置上限待定）；**G-04/G-19 语义已裁定**（σ/CV → §16.6；A05 → §16.7）；**G-16/G-17 字段与测试核对通过**（→ §16.8），待 D 针对性复核与 B/C 受影响接口核对。其余 O 项（G-24…G-32）仍按 §16.9 最小清单待裁，不得视为已冻结。

| 编号 | 必须回答的问题 | 来源 | 阻塞对象 | 负责人 |
|---|---|---|---|---|
| G-01 | S-01 v2 union 是否纳入 B 七 + C 七 + C draft 8（或允许 `c.*` 子联合）？命名归属与 discriminator 名单确定 | QC-01/G-01 | 全部结果形状 | 所有者/Lead |
| G-02 | C 的 `SourceDescriptor.query.kind`（`analysis-records`/`fx`）与逐桶 `bucket?` 是否纳入；按 B X-02 **删去 `timeBucket?`**，桶引用格式统一为 `{ key, granularity, span: { start, end } }` | QC-01/§15/B X-02 | C-1 起来源追溯 | Lead |
| G-03 | Type 7 分位最终确认（已登记 s01-draft §16.1；`medianMinor` = p=1/2 等价） | QC-10 | Distribution/Boxplot | 所有者 |
| G-04 | σ/CV 表示确认：`SqrtValue`/`CoefficientsOfVariation`、CV 定点位数、`varianceKind` 默认 population | QC-11/R-10 | A12/A20/Distribution | 所有者 |
| G-05 | B-16 A12 波动性口径：总体 σ + CV 定点位数 + 样本阈值 7 天 + 今天排除 + 零收入月计数的最终确认 | B-16 | B 的 variability/VariabilityResult | 所有者/Lead |
| G-06 | B-17 日历一致性：B 日历热力与 C `calendar`（P15）同结果/同五态/周一起始/`weekCount`/强度归一化，唯一实现归属 | B-17/QC-24 | B-2/C-2 日历 | Lead/A+B |
| G-07 | QC-21…QC-25 映射：Boxplot/Pivot/SmallMultiples/Calendar/CrossCube 是否升正式形状；`BOXPLOT_MIN_RELIABLE_SAMPLE=5`、`MAX_PIVOT_CELLS=2500`、`topN≤24`、组合上限等阈值确认 | QC-21…25 | C-2 后半 | 所有者/Lead |
| G-08 | `timeGranularity` 是否增加 `quarter`/`year`（Q-BC-1）；与 §15 的 `timeGranularity?` 建议合并；**B-V2-13 建议 v2 明确「不含 quarter/year、另立提案」** | Q-BC-1/QC-05/B-V2-13 | B/C 时间定义 | Lead |
| G-09 | 区间上限确认：月键比较月数上限（暂记 36）、日窗口 `maxAnalysisDays` 默认 400、是否调 3660；**B-S01v2-02 月键常量落位**：`FX_MAX_RANGE_MONTHS = 36`、`fxRangeMonths(from,to,maxMonths=36)` 参数化、web `rangeMonths` 委托 shared（默认 14→36）**所有者签认 `3760675`（r7）+ Lead m03807 事实修正**：分析窗口 `maxMonths` 默认 36/上限 60；**生产基线（1.16.23）web 汇率读取上限 = 14 个月**（`apps/web/src/lib/fxView.ts:61-69`，超限 `fx_range_too_long`），**B 提案 `FX_MAX_RANGE_MONTHS=36` 仍为 draft、W1 接入生效前**生产基线（1.16.23）** web 读取上限仍 14（B 分支 draft 已委托 shared `fxRangeMonths` 但未接入生产，不得把「分支已实现」误读为「已生效」）**；折算模式不得超当时生效读取上限，超限显式拒绝或整结果 `fx-incomplete`+可追溯原因，禁止静默部分结果（§16.7）。 | Q-BA-12/§17/B-S01v2-02 | A/B/C 长区间 | 所有者 |
| G-10 | `dataVersion` 生产方/递增语义与 `coverageEnd` 合同（离线）；**B-V2-08**：web 客户端本地计算路径无服务端入口，需给原币路径取值规则或显式允许 `string\|null`（null=客户端本地、非权威），不得把客户端令牌当权威 | QC-06/07/B-V2-08 | 全部完整性 | Lead/离线模块 |
| G-11 | 记录级/FX 只读投影范围与权限（A 的 T2 端点当前只读范围：逐笔不含 note/tags/userId；极值 limited metrics）——C 的 I18/A16/P10/P12/P23 是否够用 | QC-02/QC-13/T2 | C 来源追溯 | Lead + 所有者 |
| G-12a | **`AnalysisReference.params` 白名单发布形态与版本化**（D 评审拆项）：分析目录为每个 `analysisId` 给出 params 键白名单（键集合 + 值类型 + 必填/可选 + 相对区间写法），随目录/`analysisVersion` 演进；**A 出发布形态，D 按形态校验** | S-03/D X-01 | 布局/内容文档 | Lead + A/D |
| G-12b | **未知/较新 `analysisVersion` 行为**（D 评审拆项）：缺省=跟随当前目录版本；接收者目录较旧/不识别 → 只读占位 + 提示更新、不回写、不删未知字段（原草案只写未知 `analysisId`） | S-03/D X-01 | 布局/内容文档 | Lead + A/D |
| G-12c | **params 值约束与隐私黑名单**（D 评审拆项）：只允许 JSON 标量、枚举/预设键、相对区间；禁止含账本/交易/成员 ID、自建分类/标签名等私人信息；A+Lead 确认键空间约束，禁止项部分需所有者确认 | S-03/D X-01 | 分享/导入隐私 | Lead + A + 所有者 |
| G-13a | **图表家族编号映射（C 的 20 家族 ⇄ CF 编号 ⇄ Codex S-02）——可随 S-01 冻结**（D-V2-03 拆分）：命名映射与家族清单随协议冻结；不涉及尺寸数值 | QC-15/S-02/D-V2-03 | W3 卡片家族 | Lead/Codex（D 按映射校验） |
| G-13b | **三档密度 / 最小尺寸——P 占位，不纳入 S-01 冻结门槛**（D-V2-03 拆分）：由卡片家族在 W3 批 1 声明、原型/真机冻结，S-03 `ObjectSizeContract` 承接、D 只执行；§12 保持 P 并指向 S-03；与 OQ-LM-01/09 无关 | D-V2-03/S-03 §3 | W3 卡片家族 | Codex/D（W3 冻结；非 S-01 门槛） |
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
| G-24 | **直方图分箱算法（已裁定，r7）**：所有者签认 `3760675`——默认 **`histogram-nice-bin-width`**（C 现实现）；**Sturges 只作保留方案，未实现前不得宣称「已支持」**；`method` 枚举/文档中的 `histogram-sturges` 仅登记候选；分位算法名 `type7-linear` 维持 | C XC-07/XC-41 | Distribution/Boxplot/P12 | **已裁定（所有者 2026-10-27）** |
| G-25 | **distribution 分位点集合（已裁定，r7）**：必填 **P25/P50/P75 + IQR**；P10/P90 仅在显式参数时输出；不得两个 Agent 使用不同集合 | C XC-17 | Distribution / P12 | **已裁定（所有者 2026-10-27）** |
| G-26 | **P13 交叉表归属（已裁定，r7）**：**P13 归 `pivot`**；`matrix` 只保留 P01–P04；P13 不得双挂 | C XC-19 | C-2 后半形状归属 | **已裁定（所有者 2026-10-27）** |
| G-27 | **C 完整性映射（有条件同意，r7 已写入规则）**：`DraftFxCompleteness.partial → fx-incomplete` **仅限明确由汇率缺失造成**（FX 引擎 `failures` / 某笔 `resolution.status="missing"` / `missingCount>0` 且无其他阻断）；其他原因按自身映射（`request-failed`/`no-permission`/`unknown`/`not-applicable`），不得误标 FX；反例与阻断优先级见 §5.1-3；C 回执确认 `DraftFxCompleteness.partial` 语义 | C XC-04/XC-34 | C 全部形状 | **有条件同意（规则已落，C 确认）** |
| G-28a | **P16 状态集合（已闭合，r7）**：三态 **`complete｜no-transactions｜unavailable`（无 `partial`）** + 触发规则（`rows>0`→complete；空集→no-transactions；上游不可用→unavailable，由信封映射 9 态）；删除「三态包含 partial」矛盾表述；C 回执确认与实现一致 | C XC-22① | `fx-diagnostic` P16 | **已闭合（待 C 回执）** |
| G-28b | **P20 `available` 归属（已裁定，r7）**：**进结果层**（`available:boolean` + 可选 `unavailableReason`）；web 适配层只消费、不独立推导；无折算需求时不得显示「0 次回退」 | C XC-22③ | `fx-diagnostic` P20 | **已裁定（所有者 2026-10-27）** |
| G-29 | **B/C 时间与日历归属（已裁定，r7）**：**B 维护唯一日历基础实现**（`calendar-heatmap` 为唯一冻结形状）；C `calendar` 为纯投影；C `small-multiples` 必须携带 `granularity` 并复用 B `TimeAxisHint`（或直接引用 `time-series`） | C XC-31/XC-32 | B/C 时间形状 | **已裁定（B/C 回执确认）** |
| G-30 | **枚举/能力边界常量（原则同意，r7 列值）**：`PIVOT_METRICS=["amount","count","average","share"]`（4 值）；`ADVANCED_DIMENSIONS=["category","paymentMethod","kind","currency","month","week","weekday"]`（7 值）；`diagnosticKind` 5 值、`DraftHierarchyNodeKind` 3 值、`rankingPolicy` 单值沿用；**无重复、不得把未实现项列为可用**（C 逐值实现核对回执后随冻结生效） | C XC-26/XC-30/XC-33/XC-37/XC-38 | C 形状能力边界 | **原则同意（待 C 逐值核对回执）** |
| G-31 | **Codex 合同单一来源（XC-46/XC-47，Lead 决定）**：`记账程序v1-s17-codex-ui` 的 `contract/types.ts` 为 s01-draft v1 副本；集成前由 Lead 决定「改为从 shared 导入 v2 类型并删除副本」或「标预览专用、不冻结」；A 不改 Codex 分支 | C XC-46/47 | Workbench 预览集成 | Lead/Codex |
| G-32 | **C 参数键空间纳入 G-12a（XC-49）**：`AnalysisReference.params` 白名单须含 P13 维度/指标、P21 维度组合、P18 币种/区间、P06/P07 层级模式；只允许枚举/预设/相对区间、禁私人信息；A 出发布形态、D 校验 | C XC-49 | 布局引用 C 卡片 | Lead + A/D |
| G-33 | **常量 F/C/O/P 最终归类（XC-36/XC-43/XC-44/XC-45）**：§12 冻结清单 v1 的 O 项（3660 上限、36 月、50k、boxplot 5、topN 12/24、cube 5000、sankey 4000、层级 2000/500 等）由所有者逐项确认；A 只书面确认文档内 F/C/O/P 标记 | C XC-36…45 / G-21 | 冻结稿 | 所有者（+A 书面确认） |

---

## 8. 三类标记统计与冻结门槛

- **已定（👍）**：A 四形状 + 四图表输入；B 七形状中 5 个（time-series/multi-series/period-comparison 的未决项已收、calendar-heatmap 待 B-17、moving-average/anomaly）；C 的分位/σ 口径（§16 已登记）；D 两契约（**S-03 draft v0.7 引用形态，非规范性引用**，已被 Lead 评审接受）。B 的正式冲突检查（`b7daa74`）另确认 **8 组通过**：G-17 与 B §16 D-05 修订版逐条一致、D-05 无 transfer 残留、B-16/B-17 口径、A05 政策、闰日、bucketToInclusive、五态方向、七形状命名/axis。
- **待所有者裁定（🟡）**：B-16/B-17、QC-10/11（字段名 R-10）、QC-18…25、QC-01/02/13、区间上限 G-09、dataVersion/coverageEnd G-10、**B 的 FxAggregate 逐日/逐笔投影（G-17）与月键上限参数化（G-09 增补）** 等（见 §7）。
- **待实现确认（🔵）**：C 形状的实际 `types.ts` 字段、D 的建议字段（`contractVersion?` 等）、图表输入阈值/密度、C 的采样与上限常量。

**冻结门槛**：G-01…G-33 **全部有结论**（允许"不纳入 v2"的明确否决；**G-13 按 G-13a 计**——家族编号映射随 S-01 冻结，**G-13b（三档密度/最小尺寸）为 P 占位、不纳入 S-01 冻结门槛**，由卡片家族 W3 声明、S-03 `ObjectSizeContract` 承接、D 执行（D-V2-03）；**G-12a 结论形态**——A 在 S-01 冻结后补发布《params 白名单发布形态 v1》（键集合 + 值类型 + 必填/可选 + 相对区间写法），D 按形态校验；该发布物不重新冻结协议（D-V2-08）；**G-16/G-17 按 Lead Q-BP-3 裁定为统一组号**，正式定义文本已分别并入 **§14**（C @ `465d21e`／`dc91f35`）与 **§13**（B D-05 修订版 @ `7405194`／`3792ace`，首次落盘 `f3bd4d6`／`a2539bd`）；G-18 为 `analysisLimit?`、G-19 为 A05 窗口政策、G-20 为五态映射、G-21 为常量清单（C 已补 `C_*` 与 `FX_DRAFT_*` 正式定义 → §12 冻结清单 v1）、**G-22=QC-29 判别联合（Lead 已裁定）**、**G-23=QC-30 P16/P17 不同基（Lead 已裁定）**、**G-24…G-33 = C 核验清单（XC-01…XC-50）中需所有者/Lead 拍板或登记的条目**（G-24 直方图算法、G-25 分位点集合、G-26 P13 归属、G-27 C 完整性映射语义、G-28 P16/P20、G-29 B/C 时间与日历归属、G-30 枚举/能力边界常量、G-31 Codex 合同单一来源、G-32 C 参数键空间、G-33 常量 F/C/O/P 归类））→ Lead 组织 A/B/C/D 交叉评审 → **A 书面确认「哪些常量冻结、哪些可配置」（C-1 要求，见 §12）** → 所有者批准 → A 发布 `s01-v2` 并同步 `types.ts` 与各 Agent 实现。冻结前另需满足：§0 计数口径与 §12 常量清单已复核、`fx-diagnostic` 权威定义已引用 C-4 文档（C-3）、G-17 的 `kind` 已由 Lead **D-05 裁定**为 `"income" | "expense"`（删除 `transfer`；未来需转账须另立合同并取得所有者批准、新增 G 组，不得以预留值写入冻结稿）、**C 正式冲突/核验清单已处理并回执（r4-C，见 `S17-Agent-A-S01-v2-r4-核验处理记录.md`）、D 正式冲突意见已到并处理（r5，3🔴 全部采纳，D-V2-04…08 已吸收；见 `S17-Agent-A-S01-v2-r5-核验处理记录.md`，D 待单点复核）**；冲突表到齐且 D 复核「无阻塞」后方可宣称可冻结。

**r6 进展（2026-10-27，所有者裁定 `f215fa9` 后）**：D 单点复核已通过（「无阻塞，可提交所有者签认冻结」）；所有者已书面裁定 D-V2-01…08、C-1 37 常量（§12 已更新 F/C/O/P）、Q1–Q8（§16.3–§16.8）、四个「特别明确」点（§16.4）；**G-15/G-33 已解决**、**G-16/G-17 字段与测试核对通过**（§16.8）、**G-12a 正式发布物已产出**（分享导入门关闭，待 D 实现+测试后放行）；仍待裁定的最小集为 **G-24…G-32**（C 侧形状/枚举/归属）+ #3 月窗口可配置上限 + #13 金额缩写 + T2 所有者签认（§16.9）。以上待所有者/Lead 给出结论后，A 出 r7（如需）→ D 针对性复核 → B/C 受影响接口核对 → 所有者签认 → Lead 正式冻结。

**r7 进展（2026-10-27，所有者签认 `3760675` 后，Lead m03659）**：所有者原则认可冻结方向并授权 A 做 r7；**四项闭合已完成**——① **G-28a 闭合**：P16 状态集合重写为三态 `complete｜no-transactions｜unavailable`（无 `partial`）+ 触发规则，删除原「三态含 partial」矛盾表述（§5.1-8、§15.3）；② **G-30 列值**：`PIVOT_METRICS` 4 值、`ADVANCED_DIMENSIONS` 7 值写入 §12/§3.4（C 已回执 `bf6de96` 逐值核对：无重复、全实现）；③ **#3 窗口闭合**：`maxMonths` 默认 36、可配置上限 60（**分析窗口**），并按 Lead m03807 修正为三层区分——**生产基线（1.16.23）web 汇率读取上限 14 个月**（`apps/web/src/lib/fxView.ts:61-69` 显式拒绝 `fx_range_too_long`）、**B 提案 `FX_MAX_RANGE_MONTHS=36` 仍为 draft、W1 接入生效前**生产基线（1.16.23）** web 读取上限仍 14（B 分支 draft 已实现 `rangeMonths` 委托 shared `fxRangeMonths` 但未接入生产，不得把「分支已实现」误读为「已生效」）**、**分析窗口（36/60）与 FX 读取范围不同轴**；折算模式不得超过**当时生效**的读取上限（当前 14；W1 后 36），超限显式拒绝或整结果 `fx-incomplete`+可追溯原因，禁止静默部分结果（§16.7，B/C 检查）；④ **σ/CV 精度与单位语义闭合**：σ（货币单位，按币种小数位展示）与 CV（无量纲定点，`percent-100` 1 位小数）分开规定，明确不得把货币最小单位舍入套用到 CV（§16.6）。同时落地 G-24（默认 `nice-bin-width`、Sturges 仅候选）、G-25（P25/P50/P75+IQR 必填、P10/P90 显式）、G-26（P13 归 `pivot`）、G-27（`partial→fx-incomplete` 仅汇率缺失根因 + 反例/优先级）、G-28b（P20 `available` 进结果层）、G-29（B 唯一日历实现、C calendar 纯投影）。**剩余门禁**：D 单点复核、B 受影响接口核对（#3 窗口规则与 §16.7；C 已回执 `bf6de96`）、#13 保持 O、G-31 集成期执行、G-32 待 D 实现 G-12a；全部回执后由 Lead 标记 `s01-v2`。r7 不改协议字段、仅文档，未 push。

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
1.6 **B 的正式冲突检查意见（2026-10-27，提交 `b7daa74`）已到并处理（修订 r4）**：8 🔴 全部在本草案落地——B-V2-01 `time-series.total` 口径与 §4.1 对齐 B 实现（`timeSeries.ts` @934680c）；B-V2-02/B-V2-03 日历来源更正为 B08/I19（I12=每日支出波动、I14=支出分类构成）；B-V2-04 桶级保留五态、9 态仅结果层并补 `unavailableReason?`；B-V2-05 `metric` 允许 `count`/开放字符串；B-V2-06 `SourceDescriptor.query.kind` 收窄映射表（§4.4）；B-V2-07 桶 `span` 裁剪语义（§4.4 第 4.1 条）；B-V2-08 `dataVersion` 客户端路径转 **G-10** 待裁定。5 🟡 文本类已处理：B-V2-09 字段名以 B §3.7 为准；B-V2-10 `computation.method` 补 B 取值；B-V2-11 §12 补 B 常量（`WEEKDAY_MIN_SAMPLE_DAYS`/`ANOMALY_MAD_MULTIPLIER`/`ANOMALY_IQR_MULTIPLIER`/`SEASONAL_MIN_YEARS`/`CALENDAR_HEAT_LEVELS`，categorySeries 归并阈值待 B 定义）；B-V2-12 `rangeMonths` 状态更新（B `13428bd` 已实现委托，W1 生效）；B-V2-13 v2 标注不含 `quarter`/`year`（G-08 另立提案）。冲突登记见 `S17-Agent-A-S01-v2-跨Agent冲突检查汇总表.md` AC-B01…AC-B13；C/D 正式冲突意见未到，冲突表到齐前不宣称可冻结。
1.7 **C 的《S-01 v2 冻结前交叉核验清单》（2026-10-27，C worktree HEAD `fe9b939`，XC-01…XC-50）已到并处理（修订 r4-C）**：已直接改写进 v2 的规则见 **§5.1**（版本/命名、来源结构、完整性映射、采样单一来源、限额、base 包装形态、矩阵/透视、P16/P20、分位集合、枚举常量、Codex 合同、参数键空间、尺寸、fx 域、dataVersion）；需拍板项登记为 **G-24…G-33**，并另出「最小待所有者问题集」（10 条，见 `S17-Agent-A-S01-v2-r4-核验处理记录.md`）。逐条处理见 `S17-Agent-A-S01-v2-r4-核验处理记录.md`（XC-01…XC-50 全表 + B 的 13 项处理 + 最小问题集）。**B 的正式冲突检查已于 1.6/r4 处理完毕；C 的核验清单已回执；D 的正式冲突意见已到并处理（r5，见 1.8）**，冲突表到齐前不宣称可冻结。
1.8 **D 的正式冲突检查意见（2026-10-27，D worktree `4891cad`/`2d0c543`，Lead m03109 转发）已到并处理（修订 r5）**：3 🔴 全部采纳——D-V2-01 §2 桶级 `completeness` 改为「9 态仅整结果层、桶级五态 `state`、桶级可带 `unavailableReason?`」并与 §4.10 合并为同一表述；D-V2-02 §6 增加「**非规范性引用**」声明（权威=S-03 draft v0.7；S-01 冻结**不冻结** S-03 契约文本；字段差异**以 S-03 为准**），S-03 版本引用 v0.2→v0.4（§1/§6/§8）；D-V2-03 G-13 拆分：**G-13a 图表家族编号映射随 S-01 冻结**、**G-13b 三档密度/最小尺寸为 P 占位、不纳入 S-01 冻结门槛**（W3 卡片家族声明、S-03 承接、D 执行），§8 门槛按 G-13a 计。5 🟡 一并吸收：D-V2-04 §2 `dataVersion` 限定「**分析结果缓存键**」（布局投影缓存键由 S-03 §4 定义、不含 `dataVersion`）；D-V2-05 §12 `CARD_DENSITY_THRESHOLDS` 标注「非布局契约、不纳入 S-01 冻结数值、单一来源 S-02（Codex）」，`charts/numericCard.ts` 改为「实现参考（临时）」；D-V2-06 §6.1 补「未知/较新 `analysisVersion` → 只读占位、不回写、不删未知字段、不自动改参数（G-12b）」正文规则；D-V2-07 S-03 引用统一为 draft v0.4；D-V2-08 §8 写清 G-12a 发布物形态与 G-12b/c「已登记/待发布」结论（不阻塞计数）。逐条处理见 `S17-Agent-A-S01-v2-r5-核验处理记录.md`；D 待单点复核 3🔴 + 2 处澄清。
1.9 **所有者书面裁定（2026-10-27，orchestrator `f215fa9`，Lead m03434 转发）已落实（修订 r6）**：D-V2-01/02/03 接受、D-V2-04…08 原则接受（r5 已修正，r6 只核对位置不重做）；C-1 37 项常量逐项分类更新（§12 F/C/O/P，**O/P 不再虚构冻结**）；Q1–Q8 落点（§16.3–§16.8）；四个「特别明确」点（§16.4：结果缓存/布局投影缓存区分、密度归 Codex、未知/较新版本只读占位、G-12a 正式发布物+分享导入关闭）；**G-12a 正式发布物已产出** `S17-Agent-A-G12a-params白名单发布形态-v1.md`（26 项逐 analysisId 白名单、校验规则、9 错误码、30 条测试、放行条件）；G-16/G-17 字段与测试核对通过（§16.8）；最终冻结核对结果 `S17-Agent-A-S01-v2-最终冻结核对结果.md`；逐项记录 `S17-Agent-A-S01-v2-r6-记录.md`。§7 加 r6 注、§8 冻结门槛补 r6 进展、§10 本项、§11 变更记录、§12 常量表同步。
1.10 **所有者签认（2026-10-27，orchestrator `3760675`，Lead m03659 转发）已落实（修订 r7）**：授权 A 完成 r7，四项闭合——①**G-28a**：P16 状态集合重写为三态 `complete｜no-transactions｜unavailable`（纯函数实际只产生 2 态，`unavailable` 仅上游产生，无 `partial`），删除「三态含 partial」矛盾（§5.1-8、§15.2/§15.3）；②**G-30**：`PIVOT_METRICS` 4 值、`ADVANCED_DIMENSIONS` 7 值逐值写入（§12、§3.4），C 已回执逐值实现核对（`pivot.ts:34`、`dimensions.ts:37-45`，无重复）；③**#3 窗口**：`maxMonths` 默认 36、可配置上限 60（分析窗口）；**生产基线（1.16.23）web 汇率读取上限 = 14 个月**（`fxView.ts:61-69`，超限 `fx_range_too_long`）、B 分支 draft `FX_MAX_RANGE_MONTHS=36`（已委托 shared `fxRangeMonths`、**未接入生产**；W1 接入生效前**生产基线（1.16.23）** web 读取上限仍 14，不得把「分支已实现」误读为「已生效」），二者与「分析窗口」不同轴；折算模式不得超过当时生效读取上限，超限显式拒绝（`fx_range_too_long`/`analysisLimit`）或整结果 `fx-incomplete`+可追溯原因+UI 显式标记，禁止静默部分结果（§16.7）；④**σ/CV**：σ=最小单位定点（`standardDeviationScaled`，6 位）、CV=无量纲 `Ratio`（`coefficientOfVariation`）；金额缩略/`formatRatioMinorText` 只用于金额，CV 走 `formatRatioPercent` 不套货币舍入（§16.6）。同步落定 G-24（默认 `nice-bin-width`、Sturges 仅候选）、G-25（P25/P50/P75+IQR 必填、P10/P90 显式）、G-26（P13 归 `pivot`）、G-27（`partial→fx-incomplete` 仅汇率缺失/折算失败根因；fallback 成功不计入 missing）、G-28b（P20 `available` 进结果层）、G-29（B 唯一日历、C calendar 纯投影）。C 回执证据（C `bf6de96`，Lead 验收 `5b5bb0c`）已在 r7 引用；记录 `S17-Agent-A-S01-v2-r7-记录.md`，最终核对表同步 r7 版；剩余门禁只有 D 单点复核与 B/C 受影响接口核对（→ Lead 标记 `s01-v2`）。
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
| 2026-10-27 | **修订 r4（纳入 B 的正式冲突检查意见，B 提交 `b7daa74`）**：8 🔴 全部落地——§3.2 `time-series.total` 与 §4.1 对齐 B 实现（`timeSeries.ts` @934680c：Σ complete+in-progress、任一 unknown→null、future 不计、`complete` 公式、`unavailableReason`）；§3.2 `calendar-heatmap` 与 §3.4 C `calendar` 来源更正为 **B08/I19**（I12=每日支出波动 A12、I14=支出分类构成）；§4.10 补「桶级保留五态、9 态仅结果层、桶级 `unavailableReason?`」；§2 `metric` 允许 `count`/开放字符串；§4.4 增 `SourceDescriptor.query.kind` 映射表（stats/transactions/analysis-records/fx）；§4.4 新增第 4.1 条桶 `span` 裁剪语义；§7 G-10 登记 B-V2-08（客户端 `dataVersion` 可为 null、待裁定）。5 🟡：§4 新增第 11/12 条（字段名逐字采用 B §3.7；v2 不含 quarter/year→G-08）；§2 `computation.method` 补 B 取值；§12 补 B 常量 6 行；§4.9 补 rangeMonths 状态；§1/§10 1.6 登记。评审意见汇总表登记 X-08；跨 Agent 冲突表登记 AC-B01…AC-B13 | `s01-v2-draft` 更新，未冻结 |
| 2026-10-27 | **修订 r4-C（纳入 C 的冻结前交叉核验清单 XC-01…XC-50，C worktree `fe9b939`，Lead m02818 转达）**：§2 `analysisType` 增 `fx` 域（XC-02）、`computation` 补 XC-07/XC-08/XC-09 注（算法待裁、采样单一来源、analysisLimit 覆盖 C 限额）；§3.3/§3.4 逐行补 XC 处理（XC-07/17/18/19/21/26/30/31/32/33）；新增 **§5.1「C 核验清单处理规则」**（15 条：版本命名、来源派生、完整性映射表、采样权威、限额、base 包装形态、矩阵/透视、P16/P20、分位集合、枚举/常量、Codex 合同、参数键空间、尺寸、fx 域、dataVersion）；§7 新增 **G-24…G-33**（直方图算法、分位集合、P13 归属、C 完整性映射、P16/P20、B/C 时间与日历归属、枚举常量、Codex 单一来源、C 参数键空间、常量 F/C/O/P 归类）；§8 冻结门槛扩至 **G-01…G-33**；§10 新增 1.7（C 核验清单已处理）；§12 补枚举与文本常量组（`PIVOT_METRICS`/`ADVANCED_DIMENSIONS`/`rankingPolicy`/`MAX_SMALL_MULTIPLES_TOP_N`/`diagnosticKind` 等，展示文案不进协议）；逐条处理记录见 `S17-Agent-A-S01-v2-r4-核验处理记录.md`；评审意见汇总表登记 X-09；跨 Agent 冲突表登记 AC-C01…AC-C50（摘要） | `s01-v2-draft` 更新，未冻结 |
| 2026-10-27 | **修订 r5（纳入 D 的正式冲突检查意见，D worktree `4891cad`/`2d0c543`，Lead m03109 转达）**：**3 🔴 全部采纳**——D-V2-01 §2 `completeness` 行改为「9 态仅整结果层；时间桶级用五态 `state`（不新增桶级枚举）；桶级可带 `unavailableReason?`」，与 §4.10/B-V2-04 合并同一表述；D-V2-02 §6 增加「**非规范性引用**」声明（权威=S-03 draft v0.7，S-01 冻结不冻结 S-03 契约文本、字段差异以 S-03 为准），S-03 版本引用 v0.2→v0.4（§1 来源行、§6 标题/6.1/6.2 状态、§8 已定条目）；D-V2-03 §7 G-13 拆分为 **G-13a 图表家族编号映射（随 S-01 冻结）** 与 **G-13b 三档密度/最小尺寸（P 占位、不纳入 S-01 冻结门槛；W3 卡片家族声明、S-03 `ObjectSizeContract` 承接、D 执行）**，§8 冻结门槛按 G-13a 计。**5 🟡 一并吸收**——D-V2-04 §2 `dataVersion` 限定「分析结果缓存键」（布局投影缓存键归 S-03 §4、不含 `dataVersion`）；D-V2-05 §12 `CARD_DENSITY_THRESHOLDS` 两行标注「非布局契约、不纳入 S-01 冻结数值、单一来源=图表与卡片规格/S-02（Codex），W3 卡片家族声明、S-03 承接、D 只执行」，来源列改「实现参考（临时）」，§5.1-13 同步；D-V2-06 §6.1 规则补「未知/较新 `analysisVersion` → 只读占位 + 提示更新、不回写、不删未知字段、不自动改参数（G-12b）」；D-V2-07 S-03 引用统一为 draft v0.4；D-V2-08 §8 写清 G-12a 发布物形态（冻结后补发布《params 白名单发布形态 v1》、不重新冻结协议）与 G-12b/c「已登记/待发布」结论。§10 新增 1.8、§1 来源表新增 D 正式冲突检查行；逐条处理见 `S17-Agent-A-S01-v2-r5-核验处理记录.md`；评审意见汇总表登记 X-10、跨 Agent 冲突表登记 AC-D01…AC-D13  | `s01-v2-draft` 更新，未冻结；本地提交 `261da3c`（未推送） |
| 2026-10-27 | **修订 r6（纳入所有者书面裁定，orchestrator `f215fa9`，Lead m03434 转发）**：①§12 常量表按 C-1 37 项裁定更新 F/C/O/P 分类与标注（20 F / 4 C / 约 11 O / 2 P；**O/P 不再虚构冻结**；#2 3,660 天=C 显式请求+性能保护；#3 36 月默认 F+可配置上限 O 建议 60；#4 50,000 F；#13 金额缩写 O 暂缓；#14 30=C 技术上限；#21–22 桑基常量统一来源 shared `MAX_SANKEY_LINKS`；#23–24 密度保留 P 不冻结；#25–28 F；#29 2σ C 默认；#31 5=最低计算门槛 F+标注调整；#32 C；#33–35 F；#36–37 F）；②**新增 §16**（16.1 D 项复核、16.2 C-1 落实、16.3 Q1–Q8 落点、16.4 四特别明确点、16.5 版本差异与兼容迁移、16.6 σ/CV 定义/单位/小数位/旧版映射、16.7 A05/闰日边界、16.8 G-16/G-17 字段与测试核对通过、16.9 最小待确认清单 12 项、16.10 变更记录）；③§7 加 r6 注（G-15/G-33 已解决、G-09 部分、G-16/G-17 核对通过）；④§8 补 r6 进展；⑤§10 新增 1.9；⑥§11 本行；⑦新增配套文件 `S17-Agent-A-G12a-params白名单发布形态-v1.md`、`S17-Agent-A-S01-v2-最终冻结核对结果.md`、`S17-Agent-A-S01-v2-r6-记录.md`。**分享导入门关闭（`shareImportAllowed=false`）**，待 D 实现+测试后由 Lead 放行 | `s01-v2-draft` 更新，未冻结；本地提交 `486addf`（未推送） |
| 2026-10-27 | **修订 r7（纳入所有者签认 `3760675` + Lead m03659 四项闭合 + C 回执 `bf6de96`/Lead 验收 `5b5bb0c`）**：①**G-28a 闭合**：P16 三态 `complete｜no-transactions｜unavailable`、纯函数实际只产生 2 态、`unavailable` 仅上游原因、无 `partial`；删除「三态含 partial」矛盾（§3.3/§5.1-8/§15.2/§15.3/§15.4）；②**G-24/25/26/27/28b/29 落定**：直方图默认 `nice-bin-width`、Sturges 仅候选且不得宣称已支持；分位 P25/P50/P75+IQR 必填、P10/P90 显式；P13 归 `pivot`；`partial→fx-incomplete` 仅汇率缺失/折算失败根因（`contributionCompleteness`，仅 P17/P19/P20，fallback 成功不计 missing），其他原因按自身映射；P20 `available` 进结果层；B 唯一日历实现、C calendar 纯投影；③**G-30 列值**：`PIVOT_METRICS` 4 值、`ADVANCED_DIMENSIONS` 7 值、`rankingPolicy`、`MAX_SMALL_MULTIPLES_TOP_N`、`method` 串写入 §12/§3.4（C 已逐值实现核对）；④**#3 窗口闭合**：`maxMonths` 默认 36、上限 60（分析窗口）；按 Lead m03807 修正为三层——**生产基线（1.16.23）web 读取上限 14 个月**（`fxView.ts:61-69`）、**B 提案 draft `FX_MAX_RANGE_MONTHS=36`（W1 接入生效前不宣称已生效）**、**分析窗口 36/60（不同轴）**；折算不得超当时生效读取上限、超限拒绝或整结果 `fx-incomplete`+可追溯原因、禁止静默部分结果（§16.7）；⑤**σ/CV 闭合**：σ=最小单位定点（6 位）、CV=无量纲 `Ratio`；CV 走 `formatRatioPercent`、不套货币最小单位/`formatRatioMinorText`（§16.6）；⑥§7 G-24…G-30 八行重写、§8 补 r7 进展、§10 新增 1.10、§12 枚举行更新、§16.9 改为 r7 闭合状态；⑦新增 `S17-Agent-A-S01-v2-r7-记录.md`，更新最终冻结核对结果 r7 版。**剩余门禁：D 单点复核 + B/C 受影响接口核对 → Lead 标记 `s01-v2`** | `s01-v2-draft` 更新，未冻结；本地提交待回填 |

---

## 12. 数值常量清单：**冻结清单 v1**（2026-10-27，随 v2 交付，待所有者批准）

> **r6 更新（2026-10-27，依据所有者书面裁定）**：所有者已对 37 项 C-1 常量逐项给出裁定（来源：`S17-所有者裁定-20261027-S01v2冻结方向与C1常量分类.md`，orchestrator `f215fa9`；Lead m03434 转发）。本表已按裁定更新 F/C/O/P 分类与标注：**O/P 不再虚构冻结**，未获明确裁定的项保留 O；视觉数值（#23–24 卡片密度/最小尺寸）保留 P，由 Codex 在 W3 真机验收后决定。逐项裁定映射见 §16.2。
>
> 归属说明：**F=冻结**（进 v2 冻结稿，改动需重新评审）；**C=可配置**（默认值冻结，允许调用方参数覆盖）；**O=待所有者裁定**（未定不冻结）；**P=占位**（待 Codex/D/实现批次定稿）。归属列按 Lead m02188 规则：**C 侧展示契约归 C、FX 引擎常量归 B（S16-D）、分析侧常量归 A、跨 Agent 裁定归 Lead/所有者**；直接引用来源方给定的常量名，不改写为新名。C 回执提及的常量已由 C-4 §5.2（`C_*`）与 C G-16 §7（`HIERARCHY_*`/`MAX_*`）补全定义，不再标「待 C 定义」。

| 常量 | 值 | 单位/适用 | 越界行为 | 归属 | 状态 | 来源 |
|---|---|---|---|---|---|---|
| `maxAnalysisDays`（`MAX_STATS_DAYS`） | 400 天（默认） | 自然日；A/B/C 日窗口默认上限 | 越界拒绝、不截断 | A（s01-draft §17.1）/Lead | **F（所有者确认）** | s01-draft §17.1；C-1 #1 |
| 日窗口绝对上限 | 3,660 天（候选，可配置） | 自然日；是否允许超 400 | **必须显式请求 + 性能保护**；未显式请求时按 400 | A/Lead | **C（所有者原则接受；显式请求+性能保护；实现待办 T-1）** | s01-draft §17.1；C-1 #2 |
| `maxMonths`（分析窗口）/ `FX_MAX_RANGE_MONTHS`（B 提案，draft） | 分析窗口默认 **36** 个月、可配置上限 **60**（所有者签认 #3）；B 提案 `FX_MAX_RANGE_MONTHS=36`（draft，**未生效**） | 月；月键比较 / 分析窗口 | **三层区分（Lead m03807）**：①**生产基线（1.16.23）web 汇率读取上限 = 14 个月**（`apps/web/src/lib/fxView.ts:61-69` 显式拒绝 `fx_range_too_long`，`useFxRange` 调用）；②**B 分支 draft `FX_MAX_RANGE_MONTHS=36`**（已委托 shared `fxRangeMonths`、**未接入生产**），W1 接入生效前 web 读取上限仍 14，**不得把「分支已实现」误读为「已生效」、不得宣称 36 已生效**；③**分析窗口**默认 36/上限 60，与「FX 读取范围」不同轴。**折算模式不得超过当时生效的 FX 读取上限**（当前 14；W1 接入后 36），超限必须显式拒绝（`fx_range_too_long`/`analysisLimit`）或整结果 `fx-incomplete`+可追溯原因，禁止静默部分结果；UI 明示读取上限来源（现状/计划） | B（G-17）/A（G-09） | **F（分析窗口默认 36/上限 60）/ 注：FX 读取上限现状归 S16-D（14）、B draft 36 未生效（勿混为同一常量）** | B §16.4 @ `7405194`；C-1 #3；所有者签认 `3760675`；Lead m03807；`fxView.ts:61-69` |
| `FX_MAX_DETAIL_ENTRIES` | 50,000 | 条；FX 逐笔投影 | 超限 `fx_detail_limit` 不截断；业务视图必须显式传参（默认值≠契约）；**输出截断后金额不得当作完整统计**；与 `maxAnalysisDays` 不同轴 | B（引擎）/Lead（Q-BP-4） | **F（所有者确认；显式传参保护值）** | B §16.4、Lead Q-BP-4、C-1 #4 |
| `detail.includeEntries` | `false` | 布尔；FX 逐笔 | `detail.daily` 恒输出，`entries` 可选 | B | F（G-17） | B §16.4 |
| `aggregateFxDetailedAsync.batchSize` | 200 | 条/批 | 1..1000 越界 `fx_batch_size`；取消不返回部分结果 | B | F（G-17） | B §16.4 |
| `FX_MAX_FALLBACK_DAYS`（权威引擎） | 7 天 | 自然日；S16-D 历史汇率回退 | 超 7 天视为 missing | B/S16-D | F（既有合同） | `packages/shared/src/fx.ts` |
| `FX_POLICY`（权威引擎） | `minor-half-away-v1` | 逐笔舍入政策 | 折算唯一实现 | B/S16-D | F（既有合同） | `fx.ts` |
| `FX_DRAFT_MAX_FALLBACK_DAYS` | 7 | 自然日；P17–P20 诊断夹具 | 超 7 天 → `status="missing"`，不放大回退 | C-4（对齐 S16-D） | F（诊断草案） | C-4 §5.1 @ `465d21e` |
| `FX_DRAFT_RATE_DECIMALS` | 6 | 定点小数位（仅展示） | 权威仍是分数；展示 half-away，不得用于折算 | C-4 | F（诊断草案） | C-4 §5.1 |
| `FX_DRAFT_MAX_TREND_DAYS` | 400 | 自然日；P18 区间 | 超限 `unavailable` 并说明，不静默裁剪 | C-4 | F（诊断草案） | C-4 §5.1 |
| `FX_DRAFT_MAX_MISSING_RECORDS` | 200 | 条；缺失明细 | 超限截断明细并 `missingRecordsTruncated=true`；总数以 `missingCount` 为准 | C-4 | F（诊断草案） | C-4 §5.1 |
| `C_AMOUNT_DISPLAY_TIERS_MINOR` | `[10_000n, 1_000_000n, 100_000_000n, 1_000_000_000n]` | 最小单位；坐标轴/数值卡量级缩写（元/万/百万/千万/亿） | 只影响展示文本；完整值必须在 title/详情/数据表出现 | C | **O（所有者裁定：暂缓冻结，先确认单位定义/多币种小数位/显示格式；实现待办 T-3）** | C-4 §5.2；C-1 #13 |
| `C_MAX_VISIBLE_SERIES` | 30 | 个；单图表可见序列/图例/色类**技术上限** | 超出必须合并为「其它」且金额守恒 + `noteText`，不得静默截断；**默认展示条数由图表层决定，不等于默认显示 30 条**；表格不适用 | C | **C（技术上限已确认；默认展示数由图表层定）** | C-4 §5.2；C-1 #14 |
| `C_PARETO_KEY_FEW_SHARE` | 0.3 | 比例；帕累托「关键少数」参考线 | **纯参考线，不构成强制财务结论**；不改累计值；>30 类默认折叠其余并 note，展开不变值 | C | F（C 展示契约；C-1 #15） | C-4 §5.2 |
| `C_COVERAGE_NEAR_COMPLETE_THRESHOLD` | 0.95 | 比例；P19 文案阈值（记录覆盖率） | ≥0.95 可标「接近完整」，<0.95 必须标「不完整」；**不能替代完整性判定**；不得四舍五入显示 100%，须保留一位小数；缺失仍计数并列出 | C（P19 展示契约） | F（C 展示契约；C-1 #16） | C-4 §5.2 |
| `C_SANKEY_MAX_LINKS` | 4000 | 条；桑基连线 | **与 shared `MAX_SANKEY_LINKS` 统一来源（C 侧只引用、不重复定义）**；图表输入层门控：超限不渲染桑基、退回层级表并给原因；不得截断连线金额 | C（引用 shared 单一来源） | **F（统一来源=shared `MAX_SANKEY_LINKS`；C-1 #21–22）** | C-4 §5.2、C-3 §7 |
| `C_HIERARCHY_TABLE_MAX_ROWS` | 500 | 行；层级表可见行上限 | 显示前 500 行 + `rowsTruncated=true` + 「共 N 行，显示前 500」；金额合计仍用 shared 全量；展示层分页/虚拟化由图表层定 | C（与 C-3 共享） | F（C 展示契约） | C-4 §5.2 |
| `HIERARCHY_ROOT_ID` | `"__root__"` | 合成根节点 ID | 不作为业务分类展示 | C-3（G-16） | F（G-16） | C G-16 §7 @ `465d21e` |
| `HIERARCHY_DIRECT_SUFFIX` | `"::direct"` | 桑基直接金额终端 ID 后缀 | 仅当节点既有子级又有直接金额时产生 | C-3 | F（G-16） | C G-16 §7 |
| `MAX_HIERARCHY_NODES` | 2000 | 节点；层级计算 | 超出拒绝，不静默截断 | C-3 | F（G-16） | C G-16 §7 |
| `MAX_SANKEY_LINKS` | 4000 | 条；桑基连线 | **唯一权威来源（shared 计算层）**；C 侧 `C_SANKEY_MAX_LINKS` 只引用本常量，不得另定义不同值；超限拒绝启用（图表输入层门控），不截断金额 | C-3（shared 计算层权威） | **F（唯一来源；C-1 #21–22）** | C G-16 §7 |
| `CARD_DENSITY_THRESHOLDS.medium` | 200×120 px | CF-A01 卡片展示密度阈值（临时；**非布局契约**） | 仅影响展示密度，不改权威金额；**正式定义归 Codex 图表与卡片视觉规范（S-02）**；单一来源=S-02，W3 卡片家族声明、S-03 `ObjectSizeContract` 承接、D 只执行；**不纳入 S-01 冻结数值** | A（实现参考，临时） | **P（所有者裁定：保留占位、不冻结；Codex W3 视觉+真机验收后决定）** | `charts/numericCard.ts`（实现参考，临时）；C-1 #23–24 |
| `CARD_DENSITY_THRESHOLDS.expanded` | 320×200 px | 同上 | 同上 | A（实现参考，临时） | **P（同上，不冻结）** | 同上 |
| 移动平均窗口 | 7 / 30 日历日 | 自然日；B A13/A14 尾随窗口 | 窗口不足/含未知不插值 | B | F（B-4 已实现） | B-4 |
| 季节性月数上限 | 36 个月 | 月；B 季节分析 | 与 G-09 月键口径一致 | B | **F（所有者确认 C-1 #25–26）** | B |
| 波动性最小样本 | 7 个有效日 | 日；B-16 `sufficientSample` | 不足时明示，不推算；**必须区分缺失日与真实零支出日** | B | **F（所有者确认 C-1 #27）** | B 评审 |
| A20 最小样本 | 3 个月 | 月；收入稳定性判定 | 不足时明示；**不得据此直接宣称收入稳定** | B | **F（所有者确认 C-1 #28）** | B 评审 |
| `extremeSigma` | 2σ（默认） | 倍；极值日 = 偏离均值 > N×总体 σ | 2σ 默认；允许配置；结果描述为**极值/异常波动候选**，非财务结论 | B | **C（默认 2σ 冻结；Q3 批准；可配置）** | B 评审；C-1 #29、Q3 |
| 离群围栏 | 1.5×IQR | 箱线/分布离群 | 固定规则 | A（§16）/C | F | s01-draft §16、C-0 |
| `BOXPLOT_MIN_RELIABLE_SAMPLE` | 5 | 条；箱线**最低计算门槛**（非统计可靠样本） | 样本不足时明示；**名称与展示标注不得把「计算可行」等同「统计可靠」**（展示文案调整待办 T-4；常量名保留兼容，改名需 C 确认） | C | **F（所有者裁定：5=最低计算门槛，标注调整；C-1 #31）** | C-2 |
| `BOXPLOT_DEFAULT_MAX_OUTLIERS` | 20 | 个；箱线默认最多离群点展示 | 可配置；**仅展示上限，统计计算仍用全部有效样本** | C | C（可配置；C-1 #32） | C-2 |
| `MAX_PIVOT_CELLS` | 2,500 | 单元格；透视表计算上限 | 超出拒绝/折叠并给原因；展示层分页/折叠/虚拟化 | C | **F（计算上限确认；C-1 #33–35）** | C-2 |
| 小多图 TopN | 默认 12 / 上限 24 | 序列；`small-multiples` | 超出折叠为「其它」+ note；展示层按设备/性能调整 | C | **F（计算上限确认；C-1 #33–35）** | C-2 |
| 交叉表维度/组合上限 | ≤3 维 / ≤5,000 组合 | `cross-cube` 计算上限 | 超出拒绝并给原因；展示层分页/虚拟化 | C | **F（计算上限确认；C-1 #33–35）** | C-2 |
| 日历强度分位 | 0–4 级 | 五态之上的强度等级 | 以 B 分位等级为权威；**缺失记录与真实零值分开处理** | B | **F（所有者确认；C-1 #36）** | B |
| `CALENDAR_HEAT_LEVELS` | 4 | 级；B 日历强度分位（0–4） | 与「日历强度分位 0–4 级」同值，作为常量名登记 | B | F（B 实现） | B 草案（B-V2-11） |
| `WEEKDAY_MIN_SAMPLE_DAYS` | 28 | 天；B 星期分布最小样本 | 不足时明示，不推算 | B | F（B 实现） | B 草案 `weekdayPattern.ts:32`（B-V2-11） |
| `ANOMALY_MAD_MULTIPLIER` | 3.5 | 倍；B MAD 异常阈值 | 与退化链一致、可追溯 | B | F（B 实现） | B 草案（B-V2-11） |
| `ANOMALY_IQR_MULTIPLIER` | 1.5 | 倍；B IQR 异常阈值 | 与退化链一致、可追溯 | B | F（B 实现） | B 草案（B-V2-11） |
| `SEASONAL_MIN_YEARS` | 2 | 年；B 季节性最小样本 | 不足时明示，不推算 | B | F（B 实现） | B 草案（B-V2-11）；与「季节性月数上限 36」并列 |
| categorySeries「其他」归并阈值 | 待 B 定义 | 比例/条数；B 分类序列折叠 | 未定前按「金额守恒 + 可展开」处理，不得静默丢金额 | B | O（B-V2-11 待 B 定义） | B 正式冲突检查意见 `b7daa74` |
| 星期起始 | 周一 | 时间桶/日历 | 固定 | 所有者（Q-05） | F | 所有者规格 |
| 其他实现层常量 | 待补 | 采样/缓存/渲染阈值 | 缓存 LRU 等不进协议 | 各 Agent | P | — |

> **冻结前动作（C-1 要求）**：A 在 v2 冻结稿书面确认本表每项 F/C/O/P 归属；本清单为「冻结清单 v1」，以 §7 G-21 为准；`FX_DRAFT_*`（C-4 诊断夹具）与权威引擎常量（`FX_MAX_FALLBACK_DAYS`/`FX_POLICY`，B/S16-D）不得混用；Lead 组织逐项复核，所有者批准后随 `s01-v2` 冻结。

### 12.1 枚举与文本常量组（r4-C 补登：XC-26/30/33/37/38/39/41/42/44/45）

> 规则：**枚举/能力边界常量进协议**（C 实现已支持、v2 未授权会造成空白）；**展示文案不进协议**（只登记归属，由 S-02/Codex 与 i18n 负责）。状态列同一约定：F/C/O/P。

| 常量/枚举 | 值（C 实现为准） | 归属 | 状态 | 来源 |
|---|---|---|---|---|
| `PIVOT_METRICS` | `["amount","count","average","share"]`（4 值） | C | **F（所有者签认列值；C 已核对（`bf6de96`）无重复、全实现，随冻结生效）** | XC-30/XC-38/G-30 |
| `ADVANCED_DIMENSIONS` | `["category","paymentMethod","kind","currency","month","week","weekday"]`（7 值） | C | **F（所有者签认列值；C 已核对（`bf6de96`）无重复、全实现，随冻结生效）** | XC-33/XC-38/G-30 |
| `diagnosticKind` | `["currency-composition","contribution","rate-trend","coverage","fallback-usage"]` | C | F（Lead QC-29 已裁定判别联合） | XC-38/§15 |
| `DraftHierarchyNodeKind` | `["root","category","direct"]` | C | F（G-16 正式定义） | XC-38/§14 |
| `rankingPolicy` | `"amount-desc-id-asc-ties-share-rank"` | C | F（G-30 原则同意；C 回执确认值） | XC-26/G-30 |
| `MAX_SMALL_MULTIPLES_TOP_N` | `24`（默认 12） | C | F（G-30 原则同意；C 回执确认值） | XC-43/G-30 |
| `C_SANKEY_MAX_LINKS` / `MAX_SANKEY_LINKS` | `4000`（同值双名） | C / shared 计算 | F | XC-37 |
| `method` 字符串 | `type7-linear`、`population-stddev`、`histogram-nice-bin-width`（**已支持**）；`histogram-sturges` **仅候选、不列入已支持**；**v2.0.1 澄清**：已登记值必须逐字使用冻结值、不得加后缀；B `-v1` 规范串映射见 `S17-Agent-A-S01v2-变更记录-v2.0.1-method串取值裁定.md` | A/C | **F（G-24 已裁定；`histogram-sturges` 不得宣称已支持；v2.0.1 澄清）** | XC-41/G-24 |
| `FX_DRAFT_AMOUNT_COVERAGE_REASON` | C 的 P19 文案常量 | C（展示） | 不进协议（登记为展示文案） | XC-42 |
| `WEEKDAY_LABELS` / `UNSPECIFIED_PAYMENT_METHOD_LABEL` / `DIRECT_LABEL_SUFFIX` | C/web 展示文案 | C/B | 不进协议（归 i18n/S-02） | XC-39 |
| `BOXPLOT_DEFAULT_MAX_OUTLIERS` | `20` | C | C（可配置） | XC-44 |
| `C_COVERAGE_NEAR_COMPLETE_THRESHOLD` | `0.95`（§15.6 已登记；§15.3 已引用） | C | F | XC-45 |
| `ADVANCED_DRAFT_VERSION` / `c1-draft` | C 内部草案串 | C | **不进协议**（冻结后删除，XC-01/XC-40） | XC-01/XC-40 |


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
| IV-G17-10 | **月键上限**：`fxRangeMonths(from,to,maxMonths=36)` 含首尾月、跨年连续、月键降序无关；`from>to`/非法日期抛 `fx_range_invalid`；月数 > `maxMonths` 抛 `fx_range_too_long`（**不截断**）；`maxMonths` 默认 36（**B 提案 draft；生产基线（1.16.23）web 读取上限仍 14 个月，W1 接入后 36 生效，不得把 36 当已生效**），不得被页面各自写死。 |
| IV-G17-11 | **不做跨轴强行对齐**：本组 `maxEntries=50_000` 与 S-01 §17 的 `maxAnalysisDays=400` 是不同轴（条目 vs 日期窗口），v2 并列登记，互不作为对方的默认值来源。 |
| IV-G17-12 | **性能约束**：daily-only 用于图表取数；`includeEntries` 仅用于详情/导出类视图，且必须异步分批（`yieldControl`）执行；不得在渲染帧同步聚合（基线见 `S17-B-性能基线.md` §6：1M 笔 daily-only 13.6s、200k 笔逐笔 2.7s、10k×36 月 0.54s，≈13–14µs/笔）。 |
| IV-G17-13 | **交易类型域（D-05 修订新增，B §16.3 @ `7405194`）**：`FxConvertedEntry.kind` 仅 `"income" \| "expense"`，继承交易自身 `kind`（`TRANSACTION_KINDS`/`TransactionKind`，见 `packages/shared/src/ledger.ts`）；其它值按既有 `invalid_input` 处理，**不预留任何其它值**（含 `transfer`）。 |

### 13.4 默认值与限制

| 参数 | 默认 | 约束 | 说明 |
|---|---|---|---|
| `detail.includeEntries` | `false` | 视图显式开启 | 缺省只出 `daily`（恒输出） |
| `detail.maxEntries` | `50_000` | 正整数安全整数；业务视图**必须显式传** | 保护值，非契约 |
| `aggregateFxDetailedAsync.batchSize` | `200` | 1..1000 | 与既有 `aggregateFxAsync` 一致 |
| `fxRangeMonths.maxMonths` | `36` | 1..1200 | B 提案 draft，对齐 S-01 §17 月键上限（G-09 增补）；**生产基线（1.16.23）web 读取上限仍 14 个月（`fxView.ts:61-69`），36 未生效，不得宣称** |
| `maxAnalysisDays`（分析层，不同轴） | `400` | 调用方传 | 并列登记，不与 `maxEntries` 互相推导 |

### 13.5 兼容性与冻结规则

1. **兼容性**：纯 additive；现有 4 个消费方（`fxView.ts`、`FxStats`、离线路径、测试）不感知新字段；web `rangeMonths` 15–36 月不再抛错是**唯一行为变化**，标 draft，W1 页面接入时才生效，W1 切分方案需写明。**现状读取上限仍是 14 个月**（`fxView.ts:61-69`），W1 接入生效前不得把 36 当已生效读取范围（Lead m03807）。
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
/** 全局四态；`partial` 只可能出现在需要折算的 P17/P19/P20（来源 `contributionCompleteness(recordCount, missingCount)`：0 笔→`no-transactions`、`missingCount>0`→`partial`、否则 `complete`；**fallback 成功不计入 missing**；调用点仅 P17/P19/P20）。
 *  **P16 不适用 `partial`**：`currency-composition` 用三态 `DraftCompleteness`（`complete | no-transactions | unavailable`），纯函数只产生前两态（rows 非空→`complete`、空集→`no-transactions`），`unavailable` 仅由上游取数层产生；**上游原因权威列表：`no-permission`/`request-failed`/`not-applicable`**（离线覆盖不足按 §4.10 映射为 `unknown→offline-incomplete`，不入 `not-applicable`）；P16 不折算、每笔必有币种，`recordShare` 分母=总记录数（空集 `null`）。P17 之外：P18 无 `partial`（无观测→`unavailable`），P15/P16 均无 `partial`。 */
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
| `"currency-composition"`（P16） | C-4 §3.1 | `rows{currency,recordCount,incomeCount,expenseCount,incomeAmountMinor,expenseAmountMinor,recordShare}[]`、`totalRecordCount`、`currencyCount`、`completeness` | 只比较**笔数**；各币种金额只在该币种内合计与显示，不折算、不跨币种相加；`recordShare` 分母=总记录数（空集 `null`）；**状态三态 `DraftCompleteness`（无 `partial`）：非空→`complete`、空集→`no-transactions`、`unavailable` 仅上游原因（`no-permission`/`request-failed`/`not-applicable`）；P16 不折算，无需汇率，不因缺汇率而不完整**（r7 闭合，C `bf6de96`，实现 `currencyComposition.ts` 第 91 行） |
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
| 统计完整性 | **P16 用三态 `DraftCompleteness`（`complete | no-transactions | unavailable`）**：纯函数 `currencyCompositionOf` 只产生 `complete`/`no-transactions`，`unavailable` 仅上游；**无 `partial`**。**P17/P19/P20 用四态 `DraftFxCompleteness`**，其中 `partial` 仅由汇率缺失/折算失败产生（`contributionCompleteness`；fallback 成功不计入 missing），`partial→fx-incomplete` 只在该根因下映射（G-27）。P18 四态但无 `partial`（无观测→`unavailable`）。 |
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

---

## 16. 所有者裁定 2026-10-27 落实（r6，增量修订；来源 `f215fa9`）

> 来源：`C:\Users\ZhuanZ（无密码）\Desktop\工作\记账程序\记账程序v1-s17-orchestrator\docs\specs\product\s17-agents\S17-所有者裁定-20261027-S01v2冻结方向与C1常量分类.md`（orchestrator `f215fa9`；Lead m03434 转发）。性质：**增量修订**，不重写 r5；r6 仍 `s01-v2-draft`，**未冻结**。逐项处理记录见 `S17-Agent-A-S01-v2-r6-记录.md`；冻结前核对结果见 `S17-Agent-A-S01-v2-最终冻结核对结果.md`。

### 16.1 D 冲突项复核（r5 已修正，不重做）

| 项 | 所有者裁定 | r5 已落位置（r6 复核确认） |
|---|---|---|
| D-V2-01 | 接受：整结果九态 + 时间桶五态 | §2 `completeness` 行、§4.10 桶级五态/`unavailableReason?` |
| D-V2-02 | 接受 A+B：布局部分非规范性引用，S-03 唯一权威 | §6 标题与块引用声明、S-03 v0.4 引用（§1/§6/§8） |
| D-V2-03 | 接受：G-13a 可进冻结、G-13b 由 W3 真机验收决定 | §7 G-13a/G-13b、§8 门槛按 G-13a |
| D-V2-04 | 原则接受：分析结果缓存 ≠ 布局投影缓存 | §2 `dataVersion` 行、§6.1/§6.3 |
| D-V2-05 | 原则接受：密度正式定义归 Codex | §12 密度两行（P，不冻结） |
| D-V2-06 | 原则接受：未知/较新版本保留配置+只读占位 | §6.1 G-12b 正文规则 |
| D-V2-07 | 原则接受：S-03 引用版本更新 | §1/§6 标题/§8（v0.4） |
| D-V2-08 | 原则接受：G-12a 成为可实施发布物 | §8 门槛 + 本文件 `S17-Agent-A-G12a-params白名单发布形态-v1.md` |

### 16.2 C-1 37 项常量分类落实（→ §12 表逐行更新）

- **F（冻结）**：`maxAnalysisDays=400`、`FX_POLICY`、`FX_MAX_FALLBACK_DAYS=7`、`MAX_SANKEY_LINKS=4000`（**唯一来源**）、`HIERARCHY_ROOT_ID`/`HIERARCHY_DIRECT_SUFFIX`、`MAX_HIERARCHY_NODES`、移动平均 7/30 天、季节性 36 个月、波动性 7 个有效日、A20 3 个月、1.5×IQR、箱线 5=最低计算门槛（标注调整 T-4）、`MAX_PIVOT_CELLS`/小多图 TopN/交叉表计算上限、日历强度 0–4、周一起始、`FX_MAX_DETAIL_ENTRIES=50,000`（保护值，显式传参）、**`maxMonths` 默认 36、可配置上限 60**（#3 签认，**分析窗口**；与 生产基线（1.16.23）web 读取上限 14 个月、B draft 36 未生效 三层区分见 §16.7）、`detail.includeEntries=false`、`batchSize=200`、**`PIVOT_METRICS` 4 值**、**`ADVANCED_DIMENSIONS` 7 值**、`rankingPolicy`、`MAX_SMALL_MULTIPLES_TOP_N`、`method` 串（`type7-linear`/`population-stddev`/`histogram-nice-bin-width`；`histogram-sturges` **仅候选、不列已支持**）——G-24/G-25/G-26/G-30 已随签认落定，C 逐值实现核对回执（C `bf6de96`）确认无重复、无未实现却宣称可用。
- **C（可配置，4 项）**：日窗口绝对上限 3,660（**显式请求 + 性能保护**；实现待办 T-1）、`extremeSigma=2σ`（默认可配置）、`BOXPLOT_DEFAULT_MAX_OUTLIERS=20`（仅展示上限，统计用全样本）、`C_MAX_VISIBLE_SERIES=30`（技术上限，非默认展示数）。
- **O（未定不冻结，2 项）**：`C_AMOUNT_DISPLAY_TIERS_MINOR`（**暂缓冻结**：#13 保持 O，先确认单位定义/多币种小数位/显示格式，不写具体数值）、Codex 单一契约来源（G-31，集成期由 Lead/Codex 消除竞争性定义）；另 `categorySeries` 其他分类归并阈值（B 待定义）。`maxMonths` 可配置上限已由所有者签认为 60（F），不再列 O。
- **P（占位，2 项）**：`CARD_DENSITY_THRESHOLDS.medium=200×120`/`expanded=320×200`（**保留不冻结**，Codex W3 视觉+真机验收后决定，D 只执行 S-03 `ObjectSizeContract`）、其他实现层常量。
- 实现待办（不阻塞冻结，登记于 r6/r7 记录）：T-1 3,660 天显式请求+性能保护；T-2 `maxMonths=60` 可配置上限实现落地（分析窗口默认 36；**与 生产基线（1.16.23）web 读取上限 14 个月区分**、B draft 36 未生效、折算不得超当时生效读取上限、拒绝/`fx-incomplete` 规则见 §16.7）；T-3 金额缩写单位/小数位/格式提案（保持 O 不写数值）；T-4 箱线「可靠样本」文案/名称调整；T-5 桑基常量统一来源落地检查；T-6 展示层分页/折叠/虚拟化。

### 16.3 Q1–Q8 裁定落点

- **Q1（σ/CV）**：字段语义按 §16.6；单位/小数位/旧版映射见该节；正式字段名**待所有者批准**，A 不自行改名。
- **Q2（区间/闰日）**：36 个月默认；2/29 目标年不存在 → 映射目标年 2 月末（§17.2 既有）；A05 暂用 `same-day-index`；算法行为与边界见 §16.7。
- **Q3（2σ）**：批准，默认 2σ 可配置（§12 `extremeSigma`）。
- **Q4（A05 policyId）**：默认 `same-day-index`，**必须保留 `policyId`**；其他比较策略不得静默混用（§17.3 既有）。
- **Q5（版本标识）**：`s01-v2` 标识原则接受；需旧版差异+兼容迁移策略+未知/较新配置安全降级 → §16.5。
- **Q6（G-16/G-17）**：原则认可；字段与测试核对结论见 §16.9（核对通过，待 D/B/C 受影响接口核对后随冻结生效）。
- **Q7（F/C/O/P）**：按 §16.2 调整后的分类执行（§12 已更新）。
- **Q8（唯一权威）**：批准；**冻结后只保留一份 S-01 权威协议**，各 Agent 不得维护私有竞争版本。

### 16.4 特别明确的四个点（r5 复核 + r6 落位）

1. **分析结果缓存与布局投影缓存必须区分**：§2 `dataVersion` 行（结果缓存键含 dataVersion；布局投影缓存键由 S-03 §4 定义、不含 dataVersion）；§6.1/§6.3 同步。
2. **卡片密度正式定义归 Codex 图表与卡片视觉规范**：§12 密度两行标 P、不冻结；D 只执行 S-03 `ObjectSizeContract`。
3. **未知分析 ID / 较新版本：保留配置 + 只读占位，不迁移不删除**：§6.1 G-12b 规则（保留未知字段、不回写、不自动改参数、提示更新）。
4. **G-12a params 白名单必须成为可实施正式发布物；未完成校验与测试前不开放分享导入**：发布物 `S17-Agent-A-G12a-params白名单发布形态-v1.md`（含逐 analysisId 白名单、校验规则、错误码、测试用例表）；**分享导入门保持关闭**（`shareImportAllowed=false`），待 D 实现+校验测试通过后由 Lead 放行。

### 16.5 版本差异与兼容迁移（Q5）

- **版本标识**：冻结后 `S01_PROTOCOL_VERSION = "s01-v2"`（冻结时由 Lead 统一给出最终串，A 不提前定名）。
- **与 s01-draft / s01-v2-draft 差异清单**：新增形状（B 7、C 7 + C-2 8、C-4 5 子形状 + 诊断判别联合）、新增可选字段（`extremeValue`/`countBreakdown`/`secondary`/`analysisLimit?`/`coverageEnd?`/`bucket?`/`method`/`sampling?`）、`completeness` 语义收紧（桶级五态）、G-17/G-16 正式定义、D 契约引用 v0.4、常量分类（§12）、σ/CV（§16.6）。
- **兼容迁移策略**：s01-draft 数据（无版本串）按 `s01-v2-draft` 兼容读取（必填字段校验通过即接受）；`s01-v2-draft` → `s01-v2` 只做版本串升级；旧字段废除采用「先只读后移除」窗；`s01-draft` 与 `s01-v2-draft` **不并行维护**。
- **未知/较新版本安全降级**：版本未知 → 只读占位 + 提示更新；较新版本 → 保留配置、不迁移/不删除、不回写、不自动改参数（§6.1 G-12b）。
- **G-12a 发布物版本化**：params 白名单随分析目录/`analysisVersion` 演进，发布物带自身版本号；D 按形态校验，不重新冻结协议。

### 16.6 σ/CV 字段定义、单位、小数位、旧版映射（Q1）

- **定义**：总体方差 `σ² = Σ(xᵢ−μ)²/n`；总体标准差 `σ = √σ²`；变异系数 `CV = σ ÷ μ`（同口径、同单位抵消）。**样本方差/样本标准差**仅在显式要求时提供（`varianceKind="sample"`，分母 n−1）。
- **实现与量纲（C 回执 `bf6de96`，`fxDiagnostics.ts`）**：σ 以**最小单位定点**表示（`standardDeviationScaled`，6 位小数，`{scaled,decimals:6}`）；CV 为**无量纲 `Ratio`**（`coefficientOfVariation`；μ>0 才可算）。σ/CV 均为**派生展示量**，不回写权威金额/统计。
- **展示精度与单位（r7 闭合）**：σ 为货币/计数单位，展示按币种小数位（`CURRENCY_DECIMALS`；JPY 0 位）由定点值一次 `minor-half-away-v1` 舍入；跨币种展示需先归一到统计币种（归 W3 图表层，不在协议层做）。**CV 无量纲**，按 `percent-100` **1 位小数**展示（`formatRatioPercent`）；**不得把货币最小单位舍入套用到 CV，不得用 `formatRatioMinorText`**（该函数只用于最小单位量纲的有理数金额）。比例类文本一律走 `formatRatioPercent`；`C_AMOUNT_DISPLAY_TIERS_MINOR` 类金额缩略只用于金额。**命名说明（r7.1，B 核对）**：上述 `formatRatioPercent`/`formatRatioMinorText` 函数名以 C/web 现有实现为参照，集成时（G-31）统一命名；B 侧 `coefficientOfVariationScaled` 为定点字符串表示，与本文 CV 口径等价（仅命名/表示差异，不动口径）。B/C 在展示层核对。
- **旧版映射**：s01-draft 无 σ/CV 字段；`s01-v2-draft` 的 `ComputationMetadata.method` 扩展值为 `population-stddev`/`sample-cv-fixedpoint`；旧工具读取时缺失即 `null`，不得补 0。
- **表示**：σ 精确开方不可有理数表示时使用 `SqrtValue{radicand:Ratio, decimalText, decimals}`（§16.6 沿用 s01-draft §16.2）；`decimalText` 仅展示派生、不得回写或参与校验。**字段名待所有者批准（Q1 明确暂不盲目定名）**。**v2.0.1 澄清（Lead m04164）**：`decimalText` **允许空串 `""` 或 `null`**（表示未预生成展示串；**非契约必需、非缺陷**，不影响完整性/质量状态）；展示层必须由 `radicand` 按 `decimals`（σ 默认 6）一次 `minor-half-away-v1` 展开，不得因缺失改权威值；若提供非空值，必须与 `radicand` 展开一致（同一舍入口径），否则以 `radicand` 为准。详见 `S17-Agent-A-S01v2-变更记录-v2.0.1-method串取值裁定.md` §3。

### 16.7 A05 默认窗口与闰日算法边界（Q2/Q4）

- A05 默认 `same-day-index`（本月至今 ↔ 上月同日；历史月较短时裁剪并标 `previousClipped`）；可选 `equal-length-window` 必须显式设置并写 `comparisonMode="equal-length"`，**不得静默切换**。
- 结果必须保留 `policyId`（`same-day-index` / `equal-length-window`），来源与详情页展示同口径。
- 闰日跨年比较：目标年无 2/29 → 映射该年 2 月末，逐条记录 `leapDayFallbacks:[{date,alignedTo}]`，不得相加/静默丢日。
- 区间上限：日窗口默认 400 天；月键比较默认 36 个月（已入 §12 F）。**`maxMonths` 可配置上限 60（所有者签认 #3，分析窗口）**。**三层区分（Lead m03807 事实修正）**：①**生产基线（1.16.23）web 汇率读取上限 = 14 个月**（`apps/web/src/lib/fxView.ts:61-69` 的 `rangeMonths` 上限，超限抛 `fx_range_too_long`，`useFxRange` `:102` 调用）——这是**生产现状**的汇率读取范围；②**B 分支 draft（S-01 v2 additive）`FX_MAX_RANGE_MONTHS=36`** 已由 `fx.ts` 新增，并由 B 分支把 web `rangeMonths` 委托 shared `fxRangeMonths`（B 提交 `13428bd`），**但未接入生产**；W1 接入后生产基线 web 读取上限计划 14→36，**生效前不得把「分支已实现」误读为「已生效」、不得宣称 36 已生效**；③**分析窗口**默认 36/上限 60，与「FX 读取范围」不同轴。**折算模式规则**：不得超过**当时生效**的 FX 读取上限（当前 14；W1 接入后 36）；超限必须显式拒绝（`fx_range_too_long`/`analysisLimit` 给原因）或整结果 `fx-incomplete` + 可追溯原因（`missingCount`/失败明细）+ UI 显式标记，**禁止静默返回部分结果**；原币模式不受 FX 读取上限约束（可用满 60 个月）。B（`rangeMonths` 参数化）与 C（各分析）各自检查，**不得把「部分可折算」冒充完整财务数据**。C 侧 FX 诊断 P16–P20 为**纯函数、无独立折算读取入口**（汇率观测由调用方注入，`draftTypes.ts:578`）；real projection 接入必须经 `useFxRange`/`fxRangeMonths`，**C 不新增第二读取入口**。

### 16.8 G-16/G-17 字段与测试核对结论（Q6）

- **G-17（FX 逐笔/逐日投影）**：字段契约与 B 提交 `7405194`（D-05 修订版）§16.2 逐字一致（含 `kind:"income"|"expense"`、无 transfer）；不变量 13 条已并入 §13.3；测试证据：B `fxDetail.test.ts` 12 条 + `fxPerformance.test.ts` 3 条（`FX_PERF=1` 门控）— 核对通过。
- **G-16（分类层级模型）**：字段与 C 提交 `465d21e`（回填 `dc91f35`）正式定义一致（`DraftCategoryRelation`/`DraftHierarchyResult`/守恒四项/门控）；测试证据：C 侧实现与测试清单（r6 记录引用）— 核对通过。
- 结论：**字段与测试核对通过**（细节见 `S17-Agent-A-S01-v2-r6-记录.md` §3）；最终冻结待 D 针对性复核 + B/C 受影响接口核对（Lead 安排）。

### 16.9 r7 闭合状态与剩余门禁（不重复已裁定项）

| 项 | 状态（r7，所有者签认 `3760675`） | 位置/证据 |
|---|---|---|
| G-24 直方图分箱 | **已裁定**：默认 `nice-bin-width`；Sturges 仅保留候选、不得宣称已支持 | §3.3、§5.1-10、§12 |
| G-25 分位点集合 | **已裁定**：P25/P50/P75+IQR 必填，P10/P90 显式 | §5.1-9、§3.3 |
| G-26 P13 归属 | **已裁定**：归 `pivot`，matrix 只留 P01–P04 | §3.3/§3.4、§12 |
| G-27 partial 语义 | **规则已落 + C 回执**：`partial` 仅 P17/P19/P20 由 `contributionCompleteness` 产生；`partial→fx-incomplete` 仅汇率缺失/折算失败根因；fallback 成功不计 missing | §5.1-3、§15.2；C `bf6de96` |
| G-28a P16 状态 | **已闭合**：三态 `complete｜no-transactions｜unavailable`；纯函数只产生 2 态；`unavailable` 仅上游；无 `partial`；删除矛盾表述 | §5.1-8、§15.2/§15.3/§15.4；C `bf6de96` |
| G-28b P20 `available` | **已裁定**：进结果层 | §5.1-8、§7 |
| G-29 B/C 日历归属 | **已裁定**：B 唯一日历实现；C calendar 纯投影 | §4.7、§3.4、§7 |
| G-30 枚举 | **已列值 + C 逐值实现核对**：`PIVOT_METRICS` 4 值、`ADVANCED_DIMENSIONS` 7 值，无重复、无未实现却宣称可用 | §12、§3.4；C `pivot.ts:34`/`dimensions.ts:37-45` |
| #3 `maxMonths` | **已签认**：默认 36、上限 60（分析窗口）；**三层区分**——生产基线（1.16.23）web 汇率读取上限 14 个月（`fxView.ts:61-69`，超限 `fx_range_too_long`）、B 提案 `FX_MAX_RANGE_MONTHS=36` 仍 draft（W1 生效前不宣称）、分析窗口 36/60 不同轴；折算不得超当时生效读取上限、不得静默部分结果（拒绝或整结果 `fx-incomplete`+可追溯+UI 标记） | §16.7、§12、§7 G-09；Lead m03807 |
| #13 金额缩写 | **保持 O**（所有者签认：暂不冻结数值，后续提案） | §12、§16.2 |
| G-31 Codex 单一契约 | 集成期由 Lead/Codex 消除竞争性定义（非 A 可单独闭合） | §16.4 |
| G-32 G-12a 实现 | D 实现 + 30 条校验测试通过后由 Lead 放行分享导入（当前 `shareImportAllowed=false`） | G-12a 发布物 §9 |
| T2 只读扩展 | 已实现、待所有者签认（暂不合并、不改权限/财务数据） | T2 证据包 |

> **剩余门禁（r7 后）**：①D 单点复核（针对 r7 增量）；②B/C 受影响接口核对回执（C 已回 G-27/G-30/σ-CV 证据；B 待确认 #3 窗口规则与 §16.7）；③所有者签认后由 Lead 标记 `s01-v2`。**在此之前本文件保持 `s01-v2-draft`，不冻结、不发布。**

### 16.10 变更记录

- 2026-10-27 r6：依据所有者裁定（`f215fa9`）更新 §12 常量分类（F/C/O/P）、§16 新增（D 项复核、C-1 落实、Q1–Q8 落点、四特别明确点、版本差异/迁移、σ/CV 定义、A05/闰日边界、G-16/G-17 核对、最小待确认清单）；新增 `S17-Agent-A-G12a-params白名单发布形态-v1.md`、`S17-Agent-A-S01-v2-r6-记录.md`、`S17-Agent-A-S01-v2-最终冻结核对结果.md`。
- 2026-10-27 r7：依据所有者签认（`3760675`，Lead m03659 / m03807 事实修正）与 C 回执（`bf6de96`/Lead 验收 `5b5bb0c`）——闭合 G-28a（P16 三态/无 partial/触发规则）、G-30（4+7 枚举列值 + C 逐值核对）、#3（分析窗口 36/60 与 **生产基线（1.16.23）web 读取上限 14 个月**/B draft 36 未生效 三层区分 +「不得静默部分结果」规则）、σ/CV（最小单位定点 vs 无量纲 `Ratio` 展示规则）；落定 G-24/G-25/G-26/G-27/G-28b/G-29；更新 §1（所有者签认/C 回执/r7 配套文件三行）、§3.3/§3.4、§5.1-3/-8/-9/-10、§7 G-09/G-24…G-30、§8 r7 进展、§10 1.10、§12 枚举与常量状态、§13.4/§13.5、§15.2/§15.3/§15.4、§16.2/§16.6/§16.7/§16.9；新增 `S17-Agent-A-S01-v2-r7-记录.md`，更新最终冻结核对结果 r7 版。r7 仅文档、不改协议字段、未 push、未冻结。
- 2026-10-27 **v2.0.1（冻结后澄清，依据 Lead m04164 + B 最小批次 `6a94608`/`78b9d05` 的 `canonicalMethod` `-v1` 规范串；本地提交 `492b1b6`）**：①`method` 保持开放字符串（未知值透传、不重算），但**已登记取值必须逐字使用冻结值、不得加后缀、不得新增未登记枚举值**——已支持 `type7-linear`/`population-stddev`/`histogram-nice-bin-width`；已登记 `sample-cv-fixedpoint`/`mad-median`/`iqr-quantile`；`histogram-sturges` 仅候选、不列已支持；B `-v1` 规范串映射（`population-standard-deviation-v1→population-stddev`、`coefficient-of-variation-v1→sample-cv-fixedpoint`、`mad-median-v1→mad-median`、`iqr-quantile-v1→iqr-quantile`、分位 `percentile-threshold-v1→type7-linear` 或按独立阈值标开放扩展、`exact-mean-v1` 等未登记=B 开放扩展不宣称已支持）；未登记扩展可用 `-v1` 但必须标注（§8 `method` 行已加注）。②σ `SqrtValue.decimalText` 允许空串/`null`（展示派生、由 `radicand` 按 `decimals` 展开，非契约必需、非缺陷；§16.6 已加注）。③新增 `S17-Agent-A-S01v2-变更记录-v2.0.1-method串取值裁定.md`（含映射表、R-1…R-6、冻结记录行供 Lead 代填）。**不改结构/字段/枚举/26 项 specs，冻结基线 `b39b27a`+`782b036` 不变，无需重新冻结。**
