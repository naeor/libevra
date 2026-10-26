# S-01 v2 冻结前核验 · 跨 Agent 冲突检查汇总表

> 状态：**汇总材料（只汇总，不出结论，不能代替所有者确认）**。依据 Lead m02553（所有者原则批准 + 七项决定第 1 条第③项）。
> 用途：B/C/D 分别提交「依赖冲突 / 重复定义 / 不兼容接口」检查意见，A 汇总成一张对照表；**A 不裁定、不替代所有者**；结论列留空或写「待所有者确认」。
> 来源：`S17-Agent-A-S01-v2-评审意见汇总表.md`（X-01…X-08、D-04…D-06、G-16/G-17/G-22/G-23）、v2 结构草案 §7/§8/§13/§14/§15、B 正式冲突检查 `docs/specs/design/S17-B-S01-v2冲突检查意见.md`（`b7daa74`）。

## 1. 已登记的跨 Agent 反馈（来自此前 v2 评审轮次）

| 编号 | 来源 Agent | 检查类别 | 涉及项 | 意见摘要（原话要点） | 状态 | A 汇总备注 |
|---|---|---|---|---|---|---|
| AC-01 | D（S-03 布局侧） | 依赖冲突（已确认无冲突） | `AnalysisReference`、`ObjectSizeContract`、S-01 四接口点 | 合约一致性确认无冲突：与 S-03 v0.2 及代码一致；四接口点认可（只消费引用、`rangePolicy` 归分析定义、尺寸不影响权威金额、版本独立）；缓存键不进冻结契约 | 已登记（X-01） | 仅记录，不作结论 |
| AC-02 | D | 不兼容接口（拆分建议） | G-12 / `analysisVersion` / `params` 白名单 | 建议 G-12 拆 G-12a（白名单发布形态与版本化）、G-12b（未知/较新 `analysisVersion` 只读占位）、G-12c（params 值约束与隐私黑名单）；`aspectRatioHint` 归 OQ-LM-09/W5、`contractVersion` 只作尺寸声明版本 | 已登记（X-01/D-04） | v2 已按建议落位，待所有者确认 |
| AC-03 | B（时间扩展） | 重复定义/事实纠错 | `calendar-heatmap` 来源、§4.2 total 口径、`SourceDescriptor.bucket` | `calendar-heatmap` 来源应为 B08/I19（原引 I12 错）；total 口径收紧（unknown/future 不计入、in-progress 可计入但 complete=false、存在 unknown 时 total=null）；source 只留 `bucket?` 删 `timeBucket?` | 已登记（X-02） | v2 r1 已修正，待确认 |
| AC-04 | C（专业分析） | 依赖冲突/重复定义 | QC-01 扩展（7 形状入 union、`query.kind` 增 `analysis-records`/`fx`、`ComputationMetadata` 增 `method`/`sampling?`） | C 0 §3.1 扩展请求；要求 v2 明确 C 形状接入与计数口径 | 已登记（X-04） | v2 r1 部分落位（计数口径 §0、source kind），其余待冻结确认 |
| AC-05 | C | 重复定义/计数口径 | 形状/输入 DTO/投影计数 | v2 正文「7+7=14」与清单 27 种不一致；要求统一「结果形状/输入 DTO/投影」计数口径并在文档开头写清 | 已登记（X-04） | v2 r1 §0 已加计数口径 |
| AC-06 | C | 依赖冲突 | `DraftCategoryRelation` 编号 | 请求将 `DraftCategoryRelation` 列为 **G-16** 独立输入 DTO 组 | 已登记并已裁定（Lead 统一 G-16=C / G-17=B，v2 §7） | 已落位 v2 §14，待所有者确认 |
| AC-07 | C | 依赖冲突 | `fx-diagnostic` 权威来源 | 要求 v2 引用 C-4 校准文档作为权威定义 | 已登记（X-07） | v2 §15 已引用 C-4 文档（`465d21e` 实现 `2f7a036`） |
| AC-08 | B | 不兼容接口/additive | G-17 FX 逐笔/逐日投影（B-S01v2-01/02） | `FxAggregate` 增加可选 `daily`/`entries` 投影 + 月键 14→36，additive、不破坏现有消费方；Q-BP-1…5 建议 | 已登记并已裁定（Lead m02052/Q-BP，B `7405194`） | v2 §13 已并入正式定义，待所有者确认 |
| AC-09 | A（自检） | 依赖冲突（已解决） | `FxConvertedEntry.kind` 含 `transfer` | 与 S-01 核心仅 income/expense 及规格 §12「转账识别非目标」冲突 | 已裁定（D-05，B `7405194` 删除 `transfer`） | v2 §13 已按裁定更新 |
| AC-10 | A（自检） | 重复定义（已裁定） | QC-29 判别联合 / QC-30 P16 vs P17 不同基 | C-4 建议判别联合；P16 笔数份额与 P17 金额份额不同基，不得同屏合成单一「占比」 | 已裁定（Lead QC-29/QC-30，v2 §15） | 已落位，待所有者确认 |
| AC-B01 | B（正式冲突检查 `b7daa74`） | 依赖冲突/重复定义（🔴） | `time-series.total` 口径（§3.2 vs §4.2/§4.1） | B 实现 `timeSeries.ts` @934680c：`total=Σ(state∈{complete,in-progress})`、任一 unknown→null、future 不计、`complete=(unknown==0&&future==0&&inProgress==0)`；建议删 §3.2 矛盾表述、统一 §4.2 并补 `unavailableReason` | 已登记（X-08） | **r4 已修**：§3.2 行与 §4.1 对齐 B 实现 |
| AC-B02 | B | 事实性错标（🔴） | `calendar-heatmap` 来源括注 | I12=每日支出波动 A12；「支出分类构成」=I14；日历=B08/I19 | 已登记（X-08） | **r4 已修**：§3.2 括注更正 |
| AC-B03 | B | 事实性错标（🔴） | §3.4 C `calendar` 对齐对象 | 应为 B08/I19 `calendarHeatmap.ts`，不是 I12 | 已登记（X-08） | **r4 已修**：§3.4 已更正 |
| AC-B04 | B | 重复定义/语义（🔴） | 五态→9 态映射在桶级丢信息 | 桶对象保留五态 `state`（B 已实现），9 态仅 `result.completeness`，桶级可带 `unavailableReason?` | 已登记（X-08） | **r4 已修**：§4.10 补充 |
| AC-B05 | B | 不兼容接口（🔴） | `metric` 是否允许 `count` | I19 需 count；建议开放 `count` 或 `<domain>.<name>`，count 的 value 为整数、MoneyValue 不适用 | 已登记（X-08） | **r4 已修**：§2 `metric` 行 |
| AC-B06 | B | 依赖冲突（🔴） | `SourceDescriptor.query.kind` 收窄映射缺失 | 建议 §4.4 增映射表（stats/transactions/analysis-records/fx），允许 `kind:string`+params；B W1 原币只用 transactions/stats | 已登记（X-08） | **r4 已修**：§4.4 增映射表 |
| AC-B07 | B | 不兼容接口（🔴） | 桶 `span` 裁剪语义未明确 | `span`=裁剪到分析区间的半开区间；`naturalSpan`=自然桶；`clippedStart/clippedEnd`；`bucket.from/to=bucketToInclusive(span)` | 已登记（X-08） | **r4 已修**：§4.4 第 4.1 条 |
| AC-B08 | B | 依赖冲突（🔴） | `dataVersion` 在 web 客户端计算路径无服务端入口 | 建议 G-10 给原币路径取值规则或允许 `string\|null`；不得把客户端令牌当权威 | 已登记（X-08） | **r4 已登记待裁定**：§7 G-10 + §2 行，待 Lead/所有者 |
| AC-B09 | B | 重复定义（🟡） | 字段名口径 | 以 B 草案 §3.7 为准；v2 冻结时逐字并入 `types.ts`；A 侧不得先改名 | 已登记（X-08） | **r4 已修**：§4 第 11 条 |
| AC-B10 | B | 重复定义（🟡） | `computation.method` 取值 | 至少含 `population-stddev`/`sample-cv-fixedpoint`/`mad-median`/`iqr-quantile` | 已登记（X-08） | **r4 已修**：§2 computation 行 |
| AC-B11 | B | 重复定义（🟡） | §12 缺 B 常量 | `WEEKDAY_MIN_SAMPLE_DAYS=28`、`ANOMALY_MAD_MULTIPLIER=3.5`、`ANOMALY_IQR_MULTIPLIER=1.5`、`SEASONAL_MIN_YEARS=2`、`CALENDAR_HEAT_LEVELS=4`、categorySeries「其他」归并阈值 | 已登记（X-08） | **r4 已补**：§12 新增 6 行；归并阈值待 B 定义（O） |
| AC-B12 | B | 依赖冲突（🟡） | §4.9 `rangeMonths` 状态滞后 | B 已实现 web `rangeMonths` 委托 shared（`13428bd`），页面可见变化 W1 生效 | 已登记（X-08） | **r4 已修**：§4.9 状态更新 |
| AC-B13 | B | 不兼容接口（🟡） | `quarter`/`year`（G-08） | 建议 v2 标注「不纳入、另立提案」 | 已登记（X-08） | **r4 已修**：§4 第 12 条 + G-08 行；最终由 Lead 裁定 |
| AC-B14 | B | 通过项（✅ 8 组） | 无冲突确认 | G-17 §13 与 B §16 D-05 修订版逐条一致（`13428bd`/`1f46664`）；D-05 无 transfer 残留；B-16/B-17 口径；A05 政策；闰日；bucketToInclusive；五态方向；七形状命名/axis | 已登记（X-08） | 仅记录，不作结论 |
| AC-B15 | B | B-W1 待办（🟢 5 项） | B 侧实现待办 | `maxAnalysisDays` 参数化+`analysisLimit`；36 月常量收敛；桶级五态透传；`dataVersion` 可切换；`calendarHeatmap` 派生字段 | 已登记（X-08） | 属 B-W1 实现范围，A 只登记 |
| AC-C01 | C（冻结前交叉核验清单 `fe9b939`） | 冲突（🔴 冻结前） | XC-07 直方图分箱算法 / XC-41 method 串 | C 实现用 nice-bin-width（非 Sturges）；Sturges 与 nice-bin-width 会产生不同箱数/箱宽，属口径决定 | 已登记（X-09） | **r4-C 已登记待所有者**（G-24）；v2 §2/§3.3/§7 标注 |
| AC-C02 | C | 重复（🔴 冻结前） | XC-19 P13 归 `matrix` 还是 `pivot` | 同一 P13 出现在 matrix 与 pivot 两个形状；需明确边界（建议 P13 归 pivot，matrix 只留 P01–P04） | 已登记（X-09） | **r4-C 待所有者/Lead**（G-26），裁定前不双挂 |
| AC-C03 | C | 冲突（🔴 冻结前） | XC-22① P16 `completeness` 三态 vs 四态 | C 实现 `DraftCurrencyCompositionResult.completeness` 为三态（无 partial）；v2 §15 公共字段写四态 | 已登记（X-09） | **r4-C 待所有者**（G-28） |
| AC-C04 | C | 不兼容（🔴 冻结前） | XC-22③ P20 `available` 归属 | C 的 `DraftFxFallbackResult` 无 `available`；门控在 web 适配层 `adapters5.ts` | 已登记（X-09） | **r4-C 待所有者**（G-28） |
| AC-C05 | C | 冲突（🔴 冻结前） | XC-24 C 结果 base 包装形态 | v2 要求 C 形状 `extends AnalysisResultBase`，但未定义最终拼装形态；C draft 目前独立结构 | 已登记（X-09） | **r4-C 接受修订**：§5.1-6 给出 `AnalysisResultBase & {shape} & <C 字段清单>` |
| AC-C06 | C | 不兼容（🔴 冻结前） | XC-04/XC-34 C 三/四态→9 态映射 | 缺 C 映射表；`partial` 对应 `fx-incomplete` 还是新增语义未定 | 已登记（X-09） | **r4-C 已给建议映射**（§5.1-3），**待所有者确认语义**（G-27） |
| AC-C07 | C | 不兼容（🔴 冻结前） | XC-31 small-multiples 多桶轴缺失 | C 结果只有 `bucketKeys/bucketLabels`，无 axis/granularity → 桶口径无法证明 | 已登记（X-09） | **r4-C 接受修订**：要求携带 `granularity` 并复用 B `TimeAxisHint`（G-29） |
| AC-C08 | C | 重复（🔴 冻结前） | XC-32 C `calendar` vs B `calendar-heatmap` | 同一族两处；C 在回执同意 C calendar 为投影 | 已登记（X-09） | **r4-C 接受修订**：v2 只冻结 B calendar-heatmap（G-29） |
| AC-C09 | C | 枚举/常量遗漏（🔴 冻结前） | XC-38/XC-33 枚举/白名单未进 §12 | `ADVANCED_DIMENSIONS`、`PIVOT_METRICS`、`DraftCrossCubeOutcome` 拒绝联合等未登记 → 能力边界空白 | 已登记（X-09） | **r4-C 接受修订**：§12.1 新增枚举与文本常量组（G-30） |
| AC-C10 | C | 重复/不兼容（🔴 集成前） | XC-46/XC-47 Codex `contract/types.ts` 副本 | 为 s01-draft v1 快照副本，与 shared 重复定义；A 不改 Codex 分支 | 已登记（X-09） | **转 Lead/Codex**：集成前决定单一来源（G-31） |
| AC-C11 | C | 依赖冲突（🔴 冻结前） | XC-13/XC-14 `ChartSource`/`complete:boolean` | C 图表输入 source 为四字段子集、`complete` 布尔丢失状态区分 | 已登记（X-09） | **r4-C 接受修订**：ChartSource 为其派生视图；图表输入保留 completeness 枚举（§5.1-2/3） |
| AC-C12 | C | 依赖冲突（🔴 冻结前） | XC-49 C 参数键空间未纳入 G-12a 白名单 | P13 维度/指标、P21 组合、P18 币种区间、P06/P07 层级模式需进 params 白名单 | 已登记（X-09） | **r4-C 接受修订**：纳入 G-12a（G-32） |
| AC-C13 | C | 其余 38 项（XC-01…XC-50 非阻塞） | 版本命名/来源派生/采样/限额/字段名/常量数值等 | 详见 `S17-Agent-A-S01-v2-r4-核验处理记录.md` §2；逐条结论：接受修订/澄清后无冲突/需所有者决策 | 已登记（X-09） | r4-C 已处理；不改变「A 只汇总不出结论」 |

## 2. 待 B/C/D 正式提交的检查项（占位，收到后补行）

| 编号 | 来源 Agent | 检查类别 | 涉及项 | 意见摘要（原话要点） | 状态 | A 汇总备注 |
|---|---|---|---|---|---|---|
| PENDING-B-1 | B | 依赖冲突 / 重复定义 / 不兼容接口 | B 的时间扩展七形状、IV-01…14、§17 窗口口径 vs S-01 v2 信封/G-17 | **已正式提交并逐条登记为 AC-B01…AC-B15**（B 提交 `b7daa74`，文件 `docs/specs/design/S17-B-S01-v2冲突检查意见.md`；Lead m02628 转发） | 已登记 | r4 已处理，见 AC-B 行 |
| PENDING-C-1 | C | 同上 | C 七形状 + 8 draft 形状（QC-18…QC-28）、C-4 五子形状、常量清单 | —（待 C 正式提交；Lead 称 C/D 正式意见后续转发） | 待提交 | 收到后照录，不推断 |
| PENDING-D-1 | D | 同上 | S-03 布局引用/尺寸契约、`AnalysisReference`/`ObjectSizeContract`、版本/迁移 | —（待 D 正式提交） | 待提交 | 同上 |

## 3. A 汇总规则（防止越权）

1. 本表**只汇总** B/C/D 的意见与已有登记，**不写裁定**、不代替所有者确认；「结论」只能由所有者/Lead 给。
2. A 自检项（AC-09/AC-10）单独标注「A 自检」，不与第三方意见混列。
3. 同一问题重复出现时合并到一行并在备注注明来源编号；冲突意见并列保留、不择一。
4. 冻结前须由 Lead 确认：本表已覆盖 B/C/D 三方正式意见（**B 已正式提交**，见 AC-B01…AC-B15；**C/D 仍为「待提交」占位**，尚未覆盖齐全）。冲突表到齐前 A 不得宣称「可冻结」（Lead m02628）。

## 4. 冻结影响

- 若 B/C/D 正式意见未覆盖而先冻结，视为**核验不完整**（G-01…G-23 门禁不满足），A 不得自行宣布冻结。
- 冻结后所有 Agent 使用同一份 S-01 v2；私有竞争版本一律不接受（Lead m02553 决定 1-⑤）。

> 提交：见任务文档 §6.2 交付行（与常量表/语义清单/C-1 核对表/T2 证据包同批提交，未推送）。
