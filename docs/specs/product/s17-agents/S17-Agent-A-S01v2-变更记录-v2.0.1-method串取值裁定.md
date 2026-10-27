# S-01 v2.0.1 冻结后澄清：`method` 串取值裁定与 σ `decimalText` 边界

> 状态：**冻结后澄清（v2.0.1，冻结不变）** ｜ 日期：2026-10-27 ｜ 协议标识：`s01-v2`
> 依据：冻结记录 `2b6a869`/`0aee9d8`（`S17-S01v2-冻结核定-20261027.md`）、Lead m04164、B 最小批次 `6a94608`/`78b9d05`（`packages/shared/src/analysisMethod.ts` 的 `canonicalMethod` 引入 `-v1` 规范串）、v2 §2 `computation.method`、§8「已支持」行、§12 `method` 行、§16.6、§16.10
> 性质：**不改结构/字段/状态集合/枚举注册表/26 项 specs**；只钉死既有开放字符串 `method` 的取值口径与 `SqrtValue.decimalText` 的展示派生边界。
> 适用：A/B/C/D 及后续集成。与 v2 正文冲突时以本文为准（**仅限** `method` 取值与 `decimalText` 两处）。

## 1. 背景：B 规范串与冻结登记不一致

- B `canonicalMethod` 引入 `-v1` 规范串：`exact-mean-v1`、`population-standard-deviation-v1`、`coefficient-of-variation-v1`、`mad-median-v1`、`iqr-quantile-v1`、`percentile-threshold-v1`，并声明「对外只写规范串」。
- 冻结登记（v2 §8 已支持行 / §12 `method` 行 / §16.6 旧版映射；`method` 为开放字符串，未知值透传、不重算）：
  - **已支持**：`type7-linear`、`population-stddev`、`histogram-nice-bin-width`
  - **已登记**（B-V2-10）：`population-stddev`、`sample-cv-fixedpoint`、`mad-median`、`iqr-quantile`
  - **仅候选、不列已支持**：`histogram-sturges`
- 冲突点：B 的 `-v1` 新名不在冻结登记内；按冻结后规则不得由单方新增枚举/别名，也不得 A/B/C 各写一套。

## 2. 裁定（v2.0.1）

**R-1（开放字符串 + 冻结登记值逐字使用）**：`ComputationMetadata.method` 保持**开放字符串**（未知值透传、不重算）。但**一切已登记取值必须逐字使用冻结值**——不得加后缀、不得改写；**不得新增未登记枚举值**。

**R-2（B/C 规范名映射，对外唯一写法）**：

| 语义 | 冻结登记值（对外唯一写法） | B `canonicalMethod`（`-v1` 规范串） | 处理 |
|---|---|---|---|
| 总体标准差 | `population-stddev` | `population-standard-deviation-v1` | 直接映射；不得输出后端串 |
| CV（定点） | `sample-cv-fixedpoint` | `coefficient-of-variation-v1` | 直接映射 |
| MAD（中位绝对偏差） | `mad-median` | `mad-median-v1` | 直接映射 |
| IQR/分位离散 | `iqr-quantile` | `iqr-quantile-v1` | 直接映射 |
| Type 7 线性分位 | `type7-linear` | `percentile-threshold-v1`（分位/阈值语义） | 若与 Type 7 分位等价 → `type7-linear`；若为独立阈值算法 → 按 R-3 标开放扩展，不得冒充 `type7-linear` |
| 直方图（已支持） | `histogram-nice-bin-width` | —（B 自有的其它分箱名按 R-3） | 已支持；`histogram-sturges` 仅候选，不得写为已支持 |
| 均值/百分比等 B 自有 | 未登记 | `exact-mean-v1` 等 | 按 R-3 标「开放扩展、不宣称已支持」 |

> `quantile-type7` 仅为冻结前草案示意值、非当前登记；历史数据若出现，只读归一为 `type7-linear` 并在来源/tracing 保留原始串，**不得作为新写入值、不重算**。

**R-3（开放扩展命名与标注）**：未登记方法允许使用 `-v1` 后缀（仅限未登记开放扩展），**必须同时满足**：①文档/来源/UI 标注「B（或 C）开放扩展，未纳入 `s01-v2` 登记，不宣称已支持」；②不得占用冻结登记值名；③不得改变现有已登记值语义；④不参与协议冻结校验（`method` 为开放字符串）。**已登记取值一律不带 `-v1` 后缀。**

**R-4（单一来源，防三方各写一套）**：本表为 A/B/C 唯一 `method` 取值口径；B/C 不得各自维护私有规范名集合；新增登记须走 v2.x 变更记录（Lead 评审 + 受影响 Agent 回执），不得单方宣布。以 v2 §8「已支持」行为准。

**R-5（不宣称完成）**：`histogram-sturges` 未实现前不得列入「已支持」；B 的未登记方法在验收材料、图表说明、来源元数据中不得宣称协议已支持。

## 3. σ `SqrtValue.decimalText` 边界（R-6）

- 语义：`SqrtValue{radicand:Ratio, decimalText, decimals}` 中 `decimalText` 是**展示派生文本**；权威值为 `radicand`（被开方数精确有理数）与 `decimals`（σ 默认 6）。v2 §16.6 已定「`decimalText` 仅展示派生、不得回写或参与校验」。
- **裁定**：`decimalText` **允许空串 `""` 或 `null`**，含义「未预生成展示串」；**空值不是缺陷，不影响完整性/质量状态**。展示层必须由 `radicand` 展开（`decimals` 位定点，`minor-half-away-v1` 一次舍入），不得因 `decimalText` 缺失标 `unknown`/`incomplete` 或改权威值。
- 若提供非空 `decimalText`：必须与 `decimals` 一致，且与 `radicand` 展开值一致（同一舍入口径）；不一致时以 `radicand` 为准，可记录诊断。调用方不得依赖其存在。
- B 本批未实现精确十进制生成器（空串占位）**可接受**，不阻塞验收；下批可选补生成器。

## 4. 影响范围与不变量

- 改动：新增本文档；v2 §8 `method` 行加注、§16.6 `decimalText` 加注、§16.10 变更记录追加 v2.0.1 条。
- **不变量**：不改任何协议字段/结构/状态集合/信封/25 结果形状；不新增枚举注册值；不改 A 26 项 specs；不改 G-12a 26 项 `ANALYSIS_PARAM_SPECS`；冻结基线 `b39b27a`（v2 r7.2）+`782b036`（G-12a v1.1）不变；**无需重新冻结**。
- 提交：`docs(s17): v2.0.1 冻结后澄清（method 串取值裁定 + σ decimalText 边界）`（本地，不 push）。

## 5. 冻结记录行（供 Lead 代填 orchestrator）

> orchestrator 工作区为 A 只读，A 不写该文件；请 Lead 将下行填入 `S17-S01v2-冻结核定-20261027.md`（建议 §3 冻结后规则下新增「变更记录」小节）：

```markdown
- 2026-10-27 **v2.0.1 冻结后澄清**（A，提交 `<A 提交号>`）：`method` 保持开放字符串，但已登记值必须逐字使用冻结值（`type7-linear`/`population-stddev`/`histogram-nice-bin-width` 已支持；`sample-cv-fixedpoint`/`mad-median`/`iqr-quantile` 已登记；`histogram-sturges` 仅候选）；B `-v1` 规范串映射：`population-standard-deviation-v1→population-stddev`、`coefficient-of-variation-v1→sample-cv-fixedpoint`、`mad-median-v1→mad-median`、`iqr-quantile-v1→iqr-quantile`、分位 `percentile-threshold-v1→type7-linear`（或独立阈值则标开放扩展）、`exact-mean-v1` 等未登记 = B 开放扩展、不宣称已支持；未登记扩展可用 `-v1` 但必须标注。σ `SqrtValue.decimalText` 允许空串/`null`（展示派生，由 `radicand` 展开；非契约必需、非缺陷）。不改结构/字段/枚举/26 项 specs，无需重新冻结；受影响回执：B/C。
```

## 6. 下一步

- B：按 R-2 映射表调整 `canonicalMethod` 输出（已登记值去 `-v1`），未登记方法按 R-3 标注。
- C：核对分位/阈值命名（`type7-linear`）；确认其分析未受 `decimalText` 空值影响。
- Lead：代填 §5 冻结记录行；转 B/C 回执；无需重新冻结。
- A：提交本文 + v2 三处小注，回执提交号。
