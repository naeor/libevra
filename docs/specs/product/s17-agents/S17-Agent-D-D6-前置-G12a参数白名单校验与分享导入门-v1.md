# S17 · Agent D · D-6 前置：G-12a 参数白名单校验与分享导入门（v1）

> 最后核对：`d4e4fd8`（1.16.23 基线）+ 本轮 D-6 提交 / 2026-10-27
> 作者：Agent D（DS-S17-D-Layout）；批准：Lead（m01813：继续 headless 批次，避开 UI/Codex 视觉）
> 性质：实现记录 + 测试证据 + 占位/未决登记；**不接包入口、不接页面/路由/API、不加迁移、不改 S-01/S-03 已定契约**。
> 依据：A 工作区（只读）的 `S17-Agent-A-G12a-params白名单发布形态-v1.md`（发布形态 v1，147 行）、S-01 v2 r6 §16.4（G-12a 成为可实施发布物）、S-03 v0.7 §2/§7（G-12a 校验输入与导入门登记）。

---

## 1. 目的与范围

### 1.1 本批目标（D-6）

1. 实现 `AnalysisReference.params` 的 **G-12a v1 白名单校验纯函数**：26 个 analysisId 白名单、通用参数键、值/范围/互斥约束、隐私黑名单、9 个稳定错误码、未知/较新版本的只读占位语义；并逐条覆盖 G-12a §8 的 30 条测试用例。
2. 在**分享导入管道**实现 `shareImportAllowed` 门：门关闭时直接拒绝并返回 `share_import_closed`，不解析客户端输入；门放行后对外部布局/params 仍走同一校验。
3. 登记占位与未决，不自行拍板。

### 1.2 本批不做（防止范围漂移）

- 不接 `@libellum/shared` 包入口、不接页面/路由/API、未实现任何 UI 提示文案/i18n（错误码由 UI 层映射）。
- 不加迁移、不改业务数据库、不实现服务端分享/存储（仍为纯函数/接口占位）。
- 不实现账本存在性/权限校验（`categoryIds` 等“须在当前账本存在”由查询层执行；本层只校验结构/语义/隐私边界）。
- 不实现 `shareImportAllowed` 的放行开关管理（仅接收布尔参数；放行由 Lead 复核后决定）。
- 不改 S-01/S-03 已定契约、不改版本号（1.17.1 由 Lead 在集成工作区维护）。

---

## 2. 交付物

| 文件 | 内容 |
|---|---|
| `packages/shared/src/analysis/layout/params-validation.ts` | G-12a v1 校验纯函数、26 项分析表、通用键/隐私黑名单/取值范围、9 错误码、只读占位、导入门检查 |
| `packages/shared/src/analysis/layout/params-validation.test.ts` | 51 项：G-12a §8 的 30 条逐条编号覆盖 + 附加边界 |
| `packages/shared/src/analysis/layout/import-pipeline.ts` | `ShareImportOptions` 增加 `shareImportAllowed`（必填）、`currentAnalysisVersion?`、`knownAnalysisIds?`；开头导入门；逐卡 params 校验（已由 G-12b 只读占位覆盖的版本差异不重复报告） |
| `packages/shared/src/analysis/layout/import-pipeline.test.ts` | 重写为 23 项：全部原用例补门参数；新增 params 校验 5 项 + 导入门 2 项 |
| `packages/shared/src/analysis/layout/index.ts` | 目录内 barrel 追加 `params-validation` 导出（**仍未接** 包入口） |

---

## 3. G-12a v1 校验实现

### 3.1 公开 API（目录内导出）

```ts
validateAnalysisParams(reference: unknown, options?: AnalysisParamsValidationOptions): AnalysisParamsValidationResult
checkShareImportGate(options?: { shareImportAllowed?: boolean }): ShareImportGateResult
isKnownAnalysisId(analysisId: string): boolean
analysisParamsKeys(analysisId: string): readonly string[]
isAnalysisParamsErrorCode(value: string): value is AnalysisParamsErrorCode
isAcceptableAnalysisReference(reference: AnalysisReference): boolean
isAnalysisReferenceShape(value: unknown): boolean
```

状态机（`AnalysisParamsStatus`）：

| 状态 | 触发 | 结果字段 |
|---|---|---|
| `valid` | 形状合法、键/值全部通过 | `value` = 原 params（原样，不归一化） |
| `readonly` | 未知 `analysisId`（`params_unknown_analysis`）或较新 `analysisVersion`（`params_newer_version`） | 保留配置、不迁移不删除不回写不改参数；`readonlyReason` 标明原因 |
| `invalid` | 形状/键/值/范围/互斥/隐私问题 | `ok=false` 的导入路径；`issues` 含稳定错误码与字段路径 |

### 3.2 白名单与约束

- 26 项分析表：`AN-B01`…`AN-B20`、`AN-I01`…`AN-I05`、`AN-I17`；每项含允许的 `kind` 与额外键。
- 通用键（所有分析可用）：`paramsSchemaVersion`（"1"）、`kind`、`categoryIds`、`paymentMethodIds`、`tagIds`、`timePreset`、`timeRelativeDays`、`timeFixed`、`allowLongRange`、`comparisonPolicy`。
- 名额上限：键总数 ≤ 12；id 数组去重后 1..50；`timeRelativeDays` 1..400（>400 需 `allowLongRange:true` 且 ≤3660）；`timeFixed` 仅 from/to、合法日历日期、from≤to、天数 ≤400/≤3660；`timePreset`/`timeRelativeDays`/`timeFixed` 三者最多一个（否则 `params_conflict`）。
- `allowLongRange` 严格性：为 `true` 但实际区间 ≤400 天 → `params_out_of_range`；区间 >400 天却未显式 `allowLongRange:true` → `params_out_of_range`（不自动放行）。
- 隐私黑名单（大小写不敏感）：36 个键，覆盖账本/成员/金额/结果/标题/展示/几何/视觉字段（`bookId`、`amountMinor`、`title`、`width`、`density`、`chartFamily` 等）；非 `timeFixed` 的嵌套对象亦拒绝；自由文本值不允许。
- 版本：`paramsSchemaVersion` 未知值拒绝；`analysisVersion` 缺省=当前目录版本；较新 → `readonly`+`params_newer_version`（**保守等值比较**：G-15 版本串/排序未冻结前不做数值比较）。

### 3.3 错误码（9 个）

`params_invalid`、`params_unknown_key`、`params_type`、`params_out_of_range`、`params_conflict`、`params_private_data`、`params_unknown_analysis`、`params_newer_version`、`share_import_closed`。均带 `path`（如 `$.cards[0].analysis.params.title`）与 `detail`，便于 UI 映射用户提示。

---

## 4. 分享导入门

- `ShareImportOptions.shareImportAllowed` 改为**必填**（类型层面强制集成方显式选择），默认不提供放行。
- `prepareShareImport` 第一步即检查门：关闭则返回 `{ ok:false, issues:[share_import_closed] }`，**不解析客户端输入**（避免在门关闭期间处理外部布局/参数）。
- 门放行后：原有快照校验 → ID 重生成 → 修复 → 双文档校验 → 逐卡 `validateAnalysisParams`（`invalid` → 导入失败；`readonly` 仅提示不阻断）。G-12b 的 `resolveAnalysisVersion` 非 `current` 时跳过 params 版本校验，避免重复报同一问题。
- 放行条件（依据 G-12a §9）：D 校验实现 + 30 用例全过（本批完成）、B/C 受影响接口核对、Lead 复核后置 `shareImportAllowed=true`；放行后仍走同一校验。
- **Lead 裁定（2026-10-27，D-6 验收时）：本 S-01 v2 冻结周期不决策放行，`shareImportAllowed=false` 维持关闭。** 未来放行需同时满足：(a) A r7 发布后 G-12a 表数据同步（T-8 `timeFixed`/`pinnedRange` 说明、T-7 C 系列白名单占位）；(b) B/C 对 G-12a v2 的核对；(c) 集成导入真实接线 + 权限/容量测试——三者均不在本冻结范围内。

---

## 5. 测试证据（真实执行）

命令与结果（2026-10-27，本工作区）：

- `pnpm.cmd --filter @libellum/shared typecheck` → **exit 0**
- `pnpm.cmd --filter @libellum/shared exec vitest run src/analysis/layout` → **21 test files / 323 tests passed**（D-3.2 后 265 + 本批新增 58：params-validation 51 + import-pipeline 7），约 1.46s，exit 0。

`params-validation.test.ts` 覆盖：G-12a §8 的 30 条逐条编号用例（空 params、kind 不符、categoryIds 类型/去重、tagIds、unknownKey、隐私键拒绝、timePreset 冲突、绝对/相对区间上限与 allowLongRange 组合、timeFixed 逆序/非法日期、maxParts/topN 边界、I17 metric、B16 includeSystemCategories、B03 comparisonPolicy、未知 analysisId/较新版本只读占位、分享门关闭拒绝）+ 附加边界（键数上限、嵌套对象、无效日期、无效 UUID、I01 不接受 topN、B03 不接受 `kind:"income"`、错误码枚举一致性）。

---

## 6. 与 S-03 / S-01 契约的关系

- 本批只实现已登记输入，**不改 S-03 契约文本**：S-03 v0.7 已把 G-12a v1 登记为 D 校验输入与 `shareImportAllowed` 导入门；`paramsSchemaVersion` 独立于 layout `schemaVersion`/`layoutAlgorithmVersion`。
- 绝对区间语义：卡片级 `pinnedRange` 为唯一来源；`params.timeFixed` 仅相对/预设语义（Lead 裁定；冻结包待办 T-8 由 A r7 微调 G-12a v1 说明，不改校验结构）。
- 分析协议版本迁移归 S-01（`S01_PROTOCOL_VERSION`）；本层只做 G-12b 只读占位，不迁移 `analysisVersion` 或参数。

---

## 7. 占位与未决

| 项 | 现状 | 待决方 |
|---|---|---|
| `analysisVersion` 排序 | 仅等值比较（G-15 版本串/排序未冻结前的保守占位） | S-01 冻结（Lead/A） |
| `timeFixed` 语义 | 按 G-12a v1 现值实现；T-8 由 A r7 微调说明 | A r7 / Lead |
| 账本存在性与权限 | 本层不查（只校验 UUID 形状），由查询层 `requireBook` 执行 | B/C + 集成 |
| 分享放行 | **维持关闭**（Lead 2026-10-27 裁定：本冻结周期不决策放行；放行三条件见 §4）；D 不会自行放行 | Lead（A r7 + B/C 核对 + 集成接线后） |
| G-12a 表变更同步 | A 发布 v2 时 D 只更新表数据，不改校验结构；新增键=新 analysisVersion | A / Lead |
| UI 提示文案/i18n | 未实现（错误码→文案映射属 UI 批次） | Codex/集成 |

---

## 8. 偏差记录

- 错误结构复用 D-1 的 `DocumentValidationIssue{path,code,detail}` 形状（未新造一套），导入管道中直接以该结构返回，减少跨模块转换。
- 导入管道中 params `readonly` 状态**不阻断**导入（`ok=true` + 提示），`invalid` 才失败——与“只读占位、保留配置”裁定一致。
- `import-pipeline.test.ts` 因 `shareImportAllowed` 变为必填而整体重写，原 18 处调用补参数；行为未变。
- 未新增独立错误类型/未接包入口；未改 S-03 版本（仍 v0.7）。

---

## 9. 下一步

1. 分享导入门：**维持关闭**（Lead 2026-10-27 裁定，本冻结周期不决策放行）。
2. 等 A r7 发布后做参数白名单表数据/枚举引用的**小同步**（T-8 说明、T-7 C 系列白名单占位；不改校验结构、不改 params 表结构）。
3. 继续等待真实 Codex 视觉规范与 Lead 对 D-2 UI/后续 headless 批次的批准；不自行接页面/入口。
