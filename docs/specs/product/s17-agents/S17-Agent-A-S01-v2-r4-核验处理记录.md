# S17 · Agent A · S-01 v2 修订 r4 核验处理记录

> 最后核对：2026-10-27（Lead m02818；分支 `deepseek/s17-finance-category`）
> 状态：**处理记录，不构成公共接口**；目标文档 `S17-Agent-A-S01-v2-结构草案.md` 仍为 `s01-v2-draft`，未冻结。
> 范围：①B 的正式冲突检查（B worktree `docs/archive/design/S17-B-S01-v2冲突检查意见.md`，提交 `b7daa74`，只读）②C 的冻结前交叉核验清单（C worktree `docs/specs/product/s17-agents/S17-Agent-C-S01-v2冻结前交叉核验清单-20261027.md`，HEAD `fe9b939`，XC-01…XC-50，只读）。
> 判定词：**接受修订**（已直接改 v2）｜**澄清后无冲突**（口径一致，仅登记）｜**需所有者决策**（列入最小问题集，v2 标注待裁定）。
> 说明：本记录只汇总与提出建议，**不代替所有者结论**；A 不改 B/C 工作区文件。

## 1. B 的正式冲突检查逐条处理（13 项 = 8 🔴 + 5 🟡；另有 8 组通过、5 项 B-W1 待办）

| 编号 | B 原意见要点 | A 处理结论 | 落地位置 |
|---|---|---|---|
| B-V2-01（🔴） | `time-series.total` 口径矛盾：§3.2「只对 complete 桶求和」vs §4.2；B 实现 `timeSeries.ts` @934680c：`total=Σ(state∈{complete,in-progress})`、任一 unknown→null、future 不计、`complete=(unknown==0&&future==0&&inProgress==0)` | **接受修订**：删 §3.2 矛盾表述，§3.2 与 §4.1 统一按 B 实现写，null 时附 `unavailableReason` | §3.2、§4 规则 2 |
| B-V2-02（🔴） | §3.2 `calendar-heatmap` 括注把 I12 标成「支出分类构成」 | **接受修订**：更正 I12=每日支出波动 A12、I14=支出分类构成、日历=B08/I19 | §3.2 |
| B-V2-03（🔴） | §3.4 C `calendar` 行仍要求对齐「B I12 日历」 | **接受修订**：改为对齐 B08/I19 `calendarHeatmap.ts` | §3.4 |
| B-V2-04（🔴） | 五态→9 态映射在桶级丢信息 | **接受修订**：桶对象保留五态 `state`，9 态仅结果层 `completeness`，桶可带 `unavailableReason?` | §4.10 补充 |
| B-V2-05（🔴） | `metric` 是否允许 `count`（I19 需 count） | **接受修订**：`metric` 允许 `count` 与 `<domain>.<name>` 开放串；count 用整数、不套 MoneyValue；未知 metric 必带 `unavailableReason` | §2 |
| B-V2-06（🔴） | `SourceDescriptor.query.kind` 收窄映射缺失 | **接受修订**：增映射表 stats/transactions/analysis-records/fx；允许 `kind:string`+`params`；未知 kind 必带 `unavailableReason` | §4 规则 4 |
| B-V2-07（🔴） | 桶 `span` 裁剪语义未明确 | **接受修订**：`span`=裁剪后 `[start,end)`；`naturalSpan`=自然桶；`clippedStart/clippedEnd`；`bucket.from/to=bucketToInclusive(span)` | §4 规则 4.1 |
| B-V2-08（🔴） | `dataVersion` 在 web 客户端计算路径无服务端入口 | **需所有者/Lead 决策**（G-10）：允许 `string|null`（null=客户端本地、非权威）并给原币路径取值规则；v2 已登记为待裁定 | §2、§7 G-10 |
| B-V2-09（🟡） | 字段名以 B §3.7 为准 | **澄清后无冲突**：v2 增规则「冻结时逐字并入 `types.ts`」 | §4 规则 11 |
| B-V2-10（🟡） | `computation.method` 补 B 取值 | **澄清后无冲突**：补 `population-stddev`/`sample-cv-fixedpoint`/`mad-median`/`iqr-quantile`（开放字符串） | §2 |
| B-V2-11（🟡） | §12 缺 B 常量 | **接受修订**：§12 补 6 行（`CALENDAR_HEAT_LEVELS=4`、`WEEKDAY_MIN_SAMPLE_DAYS=28`、`ANOMALY_MAD_MULTIPLIER=3.5`、`ANOMALY_IQR_MULTIPLIER=1.5`、`SEASONAL_MIN_YEARS=2`、categorySeries「其他」归并阈值待 B 定义） | §12 |
| B-V2-12（🟡） | §4.9 `rangeMonths` 状态滞后（B 已实现 `13428bd`） | **澄清后无冲突**：补「B 已实现委托、draft、W1 生效」状态 | §4.9 |
| B-V2-13（🟡） | `quarter/year`（G-08）建议标注 v2 不含 | **澄清后无冲突**：v2 标注「不含 quarter/year、另立提案」 | §4 规则 12、§7 G-08 |

- **8 组通过**（B 确认，无需改动）：G-17 §13 与 B §16 D-05 修订版逐条一致（`13428bd`/`1f46664`）；D-05 无 transfer 残留；B-16/B-17 口径；A05 政策；闰日；`bucketToInclusive`；五态方向；七形状命名/axis。
- **5 项 B-W1 待办**（登记，不属 A 修订）：maxAnalysisDays 参数化+analysisLimit、36 月常量收敛、桶级五态透传、dataVersion 可切换、calendarHeatmap 派生字段。→ 已登记 `S17-Agent-A-S01-v2-跨Agent冲突检查汇总表.md`。

## 2. C 的核验清单逐条处理（XC-01…XC-50）

### 2.1 冻结前需解决项（按 C 建议优先级）

| 编号 | 事项 | A 处理结论 | 落地点 |
|---|---|---|---|
| XC-07 | 直方图分箱算法（Sturges vs nice-bin-width）与 `method` 枚举名 | **需所有者决策**（G-24）；C 现实现 `histogram-nice-bin-width`，未裁定前 v2 不得宣称算法权威 | §2、§3.3、§7 G-24、§12 |
| XC-19 | P13 归 `matrix` 还是 `pivot` | **需所有者/Lead 决策**（G-26）；建议 P13 归 `pivot`、matrix 只留 P01–P04；裁定前不双挂 | §3.3、§7 G-26 |
| XC-22① | P16 `completeness` 三态 vs 四态 | **需所有者决策**（G-28）：C 实现三态（partial 不适用） | §7 G-28、§5.1-8 |
| XC-22③ | P20「无折算需求」`available` 归属 | **需所有者决策**（G-28）：当前在 web 适配层；结果层是否加字段待裁定 | §5.1-8、§7 G-28 |
| XC-22② | P19 `rows[]` 遗漏 | **接受修订**：补入 v2 文本（按 C 实现） | §15（P19 行）、§5.1-8 |
| XC-22④ | `FX_DRAFT_AMOUNT_COVERAGE_REASON` 未登记 | **接受修订**：登记为展示文案（不进协议） | §12.1 |
| XC-24 | C 结果 base 包装形态未定义 | **接受修订**：v2 给正式拼装形态 `AnalysisResultBase & {shape:<c-shape>} & <C draft 字段清单>`，字段以 C `draftTypes.ts` 为准、冻结时逐字并入 | §5.1-6 |
| XC-31 | small-multiples 缺 `granularity`/axis | **接受修订**：要求携带 `granularity` 并复用 B `TimeAxisHint`（或引用 `time-series`） | §3.4、§7 G-29 |
| XC-32 | C `calendar` 与 B `calendar-heatmap` 重复 | **接受修订**：v2 只冻结 B `calendar-heatmap`；C `calendar` 为纯投影（C 已同意） | §3.4、§7 G-29 |
| XC-04/XC-34 | C 三/四态 → 9 态缺映射 | **需所有者确认语义**（G-27）；A 已在 §5.1-3 给出建议映射（partial→fx-incomplete 等），不代替所有者 | §5.1-3、§7 G-27 |
| XC-38 | 枚举/白名单未进 §12（`ADVANCED_DIMENSIONS`/`PIVOT_METRICS` 等） | **接受修订**：§12.1 新增「枚举与文本常量组」 | §12.1、§7 G-30 |
| XC-46 | Codex `contract/types.ts` 为 s01-draft 副本 | **需 Lead/Codex 决定**（G-31）：A 不改 Codex 分支；v2 标注「待集成阶段收敛为单一来源」 | §5.1-11、§7 G-31 |

### 2.2 其余条目处理

| 编号 | 结论 | 说明 |
|---|---|---|
| XC-01/XC-40 | 澄清后无冲突 | C 的 `c1-draft` 为内部草案串，非协议版本；冻结后统一引用 S-01 v2 `version` |
| XC-02 | 接受修订 | `analysisType` 增 `fx` 域（开放 `<domain>.<name>`） |
| XC-03/XC-13 | 接受修订 | C 结果经 base 获得 `source`；`ChartSource` 为 `SourceDescriptor` 派生视图，不两套并存 |
| XC-05 | 澄清后无冲突 | 正式类型统一 `Ratio`，C 去 `Draft` 前缀时改名，不留别名 |
| XC-06 | 澄清后无冲突 | 金额进程内 bigint、跨层字符串；C 结果不得出现金额 number |
| XC-08/XC-35 | 接受修订 | 结果层采样字段为权威；`computation.sampling` 仅视觉标注 |
| XC-09 | 接受修订 | `analysisLimit?` 覆盖 C 各限额；超限显式原因 |
| XC-10 | 澄清后无冲突 | draft 结果无信封属预期，冻结后由 base 提供 |
| XC-11/XC-16 | 澄清后无冲突 | `ranked-records` 语义一致；字段名以 C 实现候选，冻结时逐字确认 |
| XC-12 | 澄清后无冲突 | 图表输入按家族归属：A 基础四族、C 专业族；命名由 S-02 统一 |
| XC-14/XC-25 | 接受修订 | 图表输入不得退化为 `complete:boolean`，保留 `completeness` 枚举/availability 原因 |
| XC-15 | 澄清后无冲突 | 门控原因属图表输入层，不写回金额 |
| XC-17 | **需所有者决策**（G-25） | 建议 P25/P50/P75+IQR 必填、P10/P90 显式可选 |
| XC-18 | 接受修订 | 更正 QC 引用（QC-17），纳入 `conservation` 守恒字段 |
| XC-20 | 澄清后无冲突 | 与 §14 G-16 正式定义一致 |
| XC-21/XC-27 | 接受修订 | 采用 C-2 `DraftScatterResult` 字段；C-0 旧文本标「已被实现取代」 |
| XC-23 | 澄清后无冲突 | sankey 为派生投影（不新增结果形状），§0 计数口径已注 |
| XC-26 | 接受修订 | `rankingPolicy` 常量补 §12.1 |
| XC-28 | 澄清后无冲突 | bubble 字段 `meanMinor`/`shareOfTotal` 为候选，冻结时确认 |
| XC-29 | 需所有者决策 | `BOXPLOT_MIN_RELIABLE_SAMPLE=5` 等阈值（G-07/G-33） |
| XC-30 | 接受修订 | `PIVOT_METRICS` 补 §12.1；归属随 G-26 |
| XC-33 | 接受修订 | 拒绝联合/`ADVANCED_DIMENSIONS` 补 §12.1；后端依赖属 T2/G-11 |
| XC-36/XC-37 | 澄清后无冲突 | 常量数值一致；同值别名保留一个主值 |
| XC-39 | 澄清后无冲突 | 展示文案不进协议（归 i18n/S-02），§12.1 已登记 |
| XC-41/XC-42 | 接受修订 | method 串待 G-24 统一；`FX_DRAFT_AMOUNT_COVERAGE_REASON` 登记为展示文案 |
| XC-43/XC-44/XC-45 | 登记 | `MAX_SMALL_MULTIPLES_TOP_N`、`BOXPLOT_DEFAULT_MAX_OUTLIERS`、`C_COVERAGE_NEAR_COMPLETE_THRESHOLD` 已在 §12/§12.1 |
| XC-47/XC-48 | 澄清后无冲突 | Codex 副本随 G-31；C→props 映射属 W3（S-02） |
| XC-49 | 接受修订 | C 参数键空间纳入 G-12a 白名单（枚举/预设/相对区间；禁私人信息） |
| XC-50 | 澄清后无冲突 | 尺寸/密度数值待 W3（W3 前 A 阈值仍为占位 P） |

## 3. 最小待所有者确认问题集（10 条，只列真正需所有者拍板的）

1. **G-24 / XC-07**：直方图分箱算法采用 **Sturges** 还是 **nice-bin-width**（C 现实现后者）？`method` 枚举名统一为哪个？会改变箱数/显示分布，属口径决定。
2. **G-25 / XC-17**：`distribution` 必须提供哪些分位点——**P25/P50/P75 + IQR** 是否足够？是否纳入 P10/P90（纳入须显式参数）。
3. **G-26 / XC-19**：P13 四指标交叉表归 `pivot` 还是 `matrix`（建议 pivot；matrix 只留 P01–P04）。
4. **G-27 / XC-04**：C 三/四态 → 9 态映射中 `partial → fx-incomplete` 是否成立（其余按 A 建议表）。
5. **G-28 / XC-22①**：P16 `completeness` 用三态（C 实现）还是四态。
6. **G-28 / XC-22③**：P20「无折算需求」的 `available` 放结果层还是适配层（当前 web 适配层）。
7. **G-29 / XC-31/XC-32**：确认「只冻结 B `calendar-heatmap`、C calendar 为投影；small-multiples 复用 B `TimeAxisHint`」（C 已同意，需所有者/Lead 确认归属）。
8. **G-33 / G-21**：§12 冻结清单 v1 中 O 项（3660 上限、36 月、50k、boxplot 5、topN 12/24、cube 5000、sankey 4000、层级 2000/500 等）逐项 **F/C/O/P 归类**。
9. **G-30 / XC-38**：`PIVOT_METRICS`、`ADVANCED_DIMENSIONS`、`rankingPolicy` 等枚举/白名单是否按 C 实现冻结为协议枚举（能力边界）。
10. **G-15**：正式冻结版本串命名（`s01-v2`）与旧 draft 字段废除策略（`s01-v2` vs `s01-draft` 差异清单）。

> 不列入所有者问题集（由 Lead/A 技术裁定）：G-31 Codex 合同单一来源（Lead/Codex）、G-32 C 参数键空间落地（A+D）、R-10 字段名细节（A 取默认并记录）、dataVersion 规则（G-10，Lead/离线模块）。

## 4. 依赖关系

- **D 的正式冲突意见仍未到**（Lead 会转）；冲突表到齐前不宣称可冻结。
- B 的 8 组通过、5 项 B-W1 待办已登记跨 Agent 冲突表。
- C 的 XC-01…XC-50 已处理并回执；C 若后续修订正式文本，只同步对应 v2 章节。
- `_local/` 集成测试脚本与日志不提交；T2 测试仅允许 `ledger_test`。

## 5. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-27 | 初版：登记 B 的 13 项处理、C 的 XC-01…XC-50 处理结论、最小待所有者问题集 10 条（应 Lead m02818） |
