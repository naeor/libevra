# S17 · Agent D · I-1 集成契约映射（v1）

> 最后核对：2026-10-27（本工作区 `c3d545a`，分支 `deepseek/s17-layout-engine`）
> 只读基线：A `6f72f9f`（S-01 v2 已冻结 + v2.0.1 澄清）、B `78b9d05`（s01-v2 最小批次）、C `a1f792f`（P17–P20 real projection）
> 性质：**只读交叉核对**（集成契约映射文档）。不改代码、不改契约、不接包入口/页面；缺口只登记不实现。
> 相关：D `S17-Agent-D-S03-接口草案-布局侧-v1.md`（draft v0.8）、D-6 文档；A `S17-Agent-A-S01-v2-结构草案.md`（已冻结 `s01-v2`）；C `fxProjection.ts`（`23d3e2b`）

---

## 1. 目的与输入

Lead m02502 要求核对三件事：D（布局层）经 I-0 导出的符号、C 的真实 FX 投影输出、A 的 s01-v2 冻结信封，能否在**类型层**直接组装；给出 I-1 最小接线顺序；核对我方静态守卫与 C/A 的不变量是否冲突。

输入均为只读：A 的冻结结构草案（786 行，信封 §2 L54–69、C-4 形状 §15）、A 代码 `packages/shared/src/analysis/types.ts`（`AnalysisResultBase` L218–232，`ANALYSIS_PROTOCOL_VERSION="s01-draft"` L34）、C 的 `fxProjection.ts`（360 行，`FxRealProjectionSuccess`/`FxRealProjectionResult`）、C 的 `draftTypes.ts`（`DraftFxContributionResult` L639 等）、D 的 `packages/shared/src/index.ts`（I-0 精选导出段）与 `analysis/layout/*`。

## 2. 类型可组合性（直接可用 / 需适配器 / 缺口）

### 2.1 直接可用

| # | 链路 | 证据 |
|---|---|---|
| D-1 | 布局卡片节点持有分析引用：`AnalysisCardNode.analysis: AnalysisReference`，与 S-01 §6.1 的 `AnalysisReference{analysisId,analysisVersion?,params}` 字段逐字一致（S-03 draft v0.8 §2；代码 `layout/types.ts`） | A 冻结 §6.1；D `types.ts` |
| D-2 | 布局投影链路不消费分析结果：`projectLayout(layout: LayoutDocumentV1, content: WorkbenchContentDocumentV1, options)` → `ProjectionResult{columns,objects,issues}` → `projectionToGeometry` → `ObjectGeometry[]` | D `projection.ts`；S-03 §4 |
| D-3 | 尺寸/降级契约链路：`ObjectSizeContract` → `degradedReasons`/`form`（full/compact/collapsed/compat），与 S-01 §6.2 的契约定义逐字一致 | A 冻结 §6.2；D `types.ts` |
| D-4 | 持久化链路：`WorkbenchContentDocumentV1`/`LayoutDocumentV1` → `serializeEmbedded` → `parse*` → `roundTrip*` → `validate*`（纯函数，保留未知字段） | D `document-io.ts`/`validation.ts` |
| D-5 | 缓存键分工：`deriveProjectionCacheKey`（layout/content/algo/targetColumns/constraints/strategy）不含 `dataVersion`；分析结果缓存键含 `dataVersion`（S-01 §2 L64 已按 D-V2-04 澄清） | S-01 §2；D `migration-chain.ts` |
| D-6 | 引用校验链路：`validateAnalysisParams(reference, {currentAnalysisVersion})` 对 `AnalysisReference.params` 做 G-12a v1.1 白名单校验；未知 analysisId/较新版本只读占位 | D `params-validation.ts`；A G-12a v1.1 |

### 2.2 需适配器（负责方在 A/B/C 或展示层，D 只消费）

| # | 内容 | 缺什么 | 建议适配方向 |
|---|---|---|---|
| A-1 | C draft 投影结果 → S-01 信封。C 输出是 `ok` 判别联合（`FxRealProjectionSuccess` 含 `ok:true`/`provenance`/`records`/`observations` + 5 个子结果），S-01 信封闭包 `AnalysisResultBase` 是扁平 12 字段（无 `ok`/`data`/`calculation`/`provenance`） | 需要一个「投影→信封」适配器：填 `analysisId`/`analysisType="fx.*"`/`metric`、`resolvedPeriod`/`resolvedCurrency`、`completeness`（`DraftFxCompleteness` 4 态 → `AnalysisCompleteness` 9 态，按 §4.10/G-27）、`dataVersion`、`computation.method`（按 v2.0.1 R-2 逐字冻结值）、`source.kind="fx"` | A/C 侧适配层；D 不实现 |
| A-2 | 记录级/观测级数据（`DraftFxRecord`/`DraftFxRateObservation`/`DraftFxRateResolution`，含 id/日期/精确汇率）不进信封 | 信封 `source` 只有描述符 + 可选 bucket；记录级追溯通道未定义（`source.records?` 还是详情页另行取数） | 由 A/详情页契约（W4）定义；D 只登记 |
| A-3 | 卡片实例身份：D 的 `objectId`（布局稳定 ID，同时是卡片实例 ID，见卡片规格）↔ S-01 `analysisId`+`params`（同一分析多处出现需实例区分） | S-01 信封闭包无实例身份字段（按设计不携带）；渲染/缓存需在展示层以 `objectId` 为键 | 展示层以 `objectId` 作实例键即可；不阻塞，登记为约定 |
| A-4 | `AnalysisReference` → `AnalysisDefinition` 的参数解析：D 只存引用与 G-12a 参数（如 `timeFixed` 6 预设），不解析 today→闭区间 | 解析（`timeFixed`/`timePreset` → `ResolvedPeriod`）归分析计算层（A/B/C）；D 只读占位 | 已由 S-03 §2/§6.3 边界约定；直接可用（登记确认） |

### 2.3 缺口（登记，不实现）

| # | 缺口 | 位置 | 影响与建议 |
|---|---|---|---|
| G-1 | 冻结信封表 `version` 行仍写 `"s01-v2-draft"`（§2 L60「冻结时定正式版本串」），与文档头「协议标识统一 `s01-v2`」不一致；Lead m02502 提到的 `ok`/`data`/`calculation` 字段在冻结信封文本中并不存在（实际为 `completeness`/`unavailableReason`/`computation`） | A 冻结 §2 L54–69 | 需 A 在 v2.x 变更记录中钉死版本串，并请 Lead 对齐口径；D 按冻结文本实现信封消费（只读占位渲染），不依赖 `ok` 字段 |
| G-2 | A 代码 `ANALYSIS_PROTOCOL_VERSION = "s01-draft"`（`analysis/types.ts:34`）未随文档冻结升级 | A `types.ts` | 类型层无法 import 到 `s01-v2` 常量；需 A 集成批次更新（A 责任）；D 不实现 |
| G-3 | C 的 `fxProjection`/`draftTypes` 未进入 `@libellum/shared` 包入口（D 的 layout 已由 I-0 导出） | C 工作区 | 跨包类型组装需走子路径或等待 C/Lead 的入口批次；D 侧不新增入口（边界：I-0 已完成，不扩面） |
| G-4 | 记录级来源通道缺失（见 A-2） | S-01 信封闭包 | 1×1 兼容入口/详情页的「来源追溯」需 W4 详情页契约补充；D 只登记 |

## 3. I-1 最小接线顺序建议

| 层级 | 接线链路 | 依赖 | 风险 | 建议时机 |
|---|---|---|---|---|
| I-1a | `AnalysisReference` → `validateAnalysisParams` → `projectLayout` → `WorkbenchContentDocumentV1`/`LayoutDocumentV1`（序列化+往返+校验），无查询、无 UI | D 自身纯函数（I-0 已导出）+ S-03 v0.8 + G-12a v1.1 | **低**（纯数据链路，可类型层直接组装） | **可立即启动**（不等 Codex/OQ） |
| I-1b | 卡片结果信封接线：引用 → 计算入口（A/B/C）→ 信封 → 卡片壳渲染 | G-1/G-2 收口 + A 常量更新 + C 适配器 + Codex S-02 展示合同 | 中（信封字段/版本、适配器、视觉合同） | 等 A 集成批次 + Codex |
| I-1c | FX P17–P20 卡片（C 投影 → 信封 → 图表） | I-1b + G-4 记录级来源 + C 适配 | 中高 | I-1b 之后 |
| I-1d | 编辑模式/容器 1×1/容器详情（D-2/D-3 UI） | Codex 视觉/交互 + OQ-LM-05/06/07 裁定 + W4 详情契约 | 高 | 等 Codex 与 OQ |
| I-1e | 分享/同步（`shareImportAllowed` 放行、服务端同步） | A r7.2 + G-12a v1.1 + B/C 核对 + Lead 放行 + W6 批准 | 高（安全/隐私门） | 最后 |

建议顺序：**I-1a 现在做** → I-1b（信封冻结落地后）→ I-1c → I-1d（Codex 到位）→ I-1e。I-1a 与 I-1d 之间可并行做 D 的 D-2 前置编辑器纯逻辑（已有 commands/focus/machine）。

## 4. 不变量核对（I-0 守卫 / C 唯一读取入口 / A partial 语义）

1) **I-0 静态守卫 vs C `fxProjection`**：无冲突。I-0 守卫禁止生产模块出现 I/O/DOM/网络/时钟/随机/框架依赖；C 的 `projectFxDiagnostics` 是纯函数，`rates`（`ReadonlyMap`）与 `rangeGuard` 均由调用方注入，异常统一转 `ok:false`，符合「随机/IO 由调用方注入」原则。
2) **C 唯一读取入口/无部分输出 vs A 信封闭包**：无冲突，但存在**双轨表达**——C 用 `ok:false` 判别联合表达拒绝（`fx_range_too_long`/`unsupported_currency`/`invalid_input`），A 信封闭包用 `completeness` 9 态 + `unavailableReason` 表达不可信结果。适配器需把 rejection 映射为对应 9 态（如 `request-failed`），**不得把 rejection 渲染成空态**；该映射在 A-1 适配层完成，D 只在卡片壳按 `completeness` 分支（S-02 合同）。
3) **A `partial` 语义 vs C `DraftFxCompleteness.partial`**：无冲突。A 的 9 态 `partial` 只在整结果层（桶级五态另行）；C 的 `partial` 仅由 P17/P19/P20 `missingCount>0` 产生（fallback 成功不计入），且 G-27 已定：`partial→fx-incomplete` 必须限定「明确因汇率缺失」，其他原因不得误映射；`no-transactions`/`unavailable` 语义两侧一致。
4) **结论**：三方不变量**无冲突**。唯一需要统一的是双轨表达（C `ok:false` 与 A `completeness`），属 A/C 适配器职责，D 层不新增逻辑。

## 5. 边界与下一步

- 本文只读产出：未改 A/B/C/D 任何代码或契约、未接包入口/页面、未新增迁移/版本号。
- 给 Lead 的建议：①由 A 收口 G-1（版本串）与 G-2（代码常量）；②由 C/Lead 决定 G-3（C 入口批次）；③G-4 并入 W4 详情页契约；④D 可在当前待命期启动 **I-1a**（纯数据链路，不依赖 Codex/OQ）。
- D 继续待命：D-2 UI 等真实 Codex 视觉规范；OQ-LM-03/05/06/07 等裁定未到前不写 UI。

---

变更记录：
- v1（2026-10-27）：首版只读交叉核对；§2 三分法、§3 接线顺序、§4 不变量结论「无冲突」。
