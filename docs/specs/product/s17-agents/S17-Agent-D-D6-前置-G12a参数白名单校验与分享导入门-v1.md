# S17 · Agent D · D-6 前置：G-12a 参数白名单校验与分享导入门（v1，含 G-12a v1.1/T-8 同步）

> 最后核对：`d4e4fd8`（1.16.23 基线）+ G-12a v1.1（T-8）同步提交 / 2026-10-27
> 作者：Agent D（DS-S17-D-Layout）；批准：Lead（m01813：继续 headless 批次，避开 UI/Codex 视觉；m02101：G-12a v1.1 T-8 表数据同步）
> 性质：实现记录 + 测试证据 + 占位/未决登记；**不接包入口、不接页面/路由/API、不加迁移、不改 S-01/S-03 已定契约**。
> 依据：A 工作区（只读）的 `S17-Agent-A-G12a-params白名单发布形态-v1.md`（发布形态 v1.1，187 行，含 T-8 `timeFixed` 预设枚举）、S-01 v2 r6 §16.4（G-12a 成为可实施发布物）、S-03 v0.8 §2/§7（G-12a 校验输入与导入门登记）。

---

## 1. 目的与范围

### 1.1 本批目标（D-6）

1. 实现 `AnalysisReference.params` 的 **G-12a v1.1 白名单校验纯函数**：26 个 analysisId 白名单、通用参数键、值/范围/互斥约束、隐私黑名单、9 个稳定错误码、未知/较新版本的只读占位语义；并逐条覆盖 G-12a §8 的 30 条测试用例 + v1.1 新增 #31–35（共 35 条）。
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
| `packages/shared/src/analysis/layout/params-validation.ts` | G-12a v1.1 校验纯函数（T-8 已落：`timeFixed` 6 个预设枚举）、26 项分析表、通用键/隐私黑名单/取值范围、9 错误码、只读占位、导入门检查 |
| `packages/shared/src/analysis/layout/params-validation.test.ts` | 55 项：G-12a §8 的 35 条逐条编号覆盖 + 附加边界 |
| `packages/shared/src/analysis/layout/import-pipeline.ts` | `ShareImportOptions` 增加 `shareImportAllowed`（必填）、`currentAnalysisVersion?`、`knownAnalysisIds?`；开头导入门；逐卡 params 校验（已由 G-12b 只读占位覆盖的版本差异不重复报告） |
| `packages/shared/src/analysis/layout/import-pipeline.test.ts` | 重写为 23 项：全部原用例补门参数；新增 params 校验 5 项 + 导入门 2 项 |
| `packages/shared/src/analysis/layout/index.ts` | 目录内 barrel 追加 `params-validation` 导出（**仍未接** 包入口） |

---

## 3. G-12a v1.1 校验实现（T-8 已落）

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

### 3.2 白名单与约束（G-12a v1.1）

- 26 项分析表：`AN-B01`…`AN-B20`、`AN-I01`…`AN-I05`、`AN-I17`；每项含允许的 `kind` 与额外键（v1.1 未改）。
- 通用键（所有分析可用，共 9 个）：`paramsSchemaVersion`（"1"）、`kind`、`categoryIds`、`paymentMethodIds`、`tagIds`、`timePreset`、`timeRelativeDays`、`timeFixed`、`allowLongRange`、`comparisonPolicy`（其中 `timeFixed` 语义见下条）。
- **T-8（G-12a v1.1）**：`timeFixed` 为 **6 个预设枚举** `this-month`/`last-month`/`this-year`/`last-year`/`last-3-months`/`last-6-months`（相对工作台 `today` 解析、日历对齐、均 ≤366 天；解析真实区间回写结果 `resolvedPeriod`，不回写布局）；**旧绝对日期对象 `{from,to}` 一律拒绝（`params_type`），绝对日期区间只允许卡片级 `pinnedRange`**（`rangePolicy:"pinned"`、标题标区间，互斥由 S-03 层校）。
- 名额上限：键总数 ≤ 12；id 数组去重后 1..50；`timeRelativeDays` 1..400（>400 需 `allowLongRange:true` 且 ≤3660）；`timePreset`/`timeRelativeDays`/`timeFixed` 三者最多一个（否则 `params_conflict`）。
- `allowLongRange` 严格性：为 `true` 但实际相对区间 ≤400 天 → `params_out_of_range`；区间 >400 天却未显式 `allowLongRange:true` → `params_out_of_range`（不自动放行）；`timeFixed`（预设 ≤366 天）叠加 `allowLongRange:true` → `params_out_of_range`。
- 隐私黑名单（大小写不敏感）：36 个键，覆盖账本/成员/金额/结果/标题/展示/几何/视觉字段（`bookId`、`amountMinor`、`title`、`width`、`density`、`chartFamily` 等）；**任何嵌套对象一律拒绝**（含旧 `timeFixed` 对象；`timeFixed` 对象按 `params_type` 拒绝并提示改用 `pinnedRange`，其他键对象 → `params_private_data`）；自由文本值不允许。
- 版本：`paramsSchemaVersion` 未知值拒绝；`analysisVersion` 缺省=当前目录版本；较新 → `readonly`+`params_newer_version`（**保守等值比较**：G-15 版本串/排序未冻结前不做数值比较）。

### 3.3 错误码（9 个）

`params_invalid`、`params_unknown_key`、`params_type`、`params_out_of_range`、`params_conflict`、`params_private_data`、`params_unknown_analysis`、`params_newer_version`、`share_import_closed`。均带 `path`（如 `$.cards[0].analysis.params.title`）与 `detail`，便于 UI 映射用户提示。

---

## 4. 分享导入门

- `ShareImportOptions.shareImportAllowed` 改为**必填**（类型层面强制集成方显式选择），默认不提供放行。
- `prepareShareImport` 第一步即检查门：关闭则返回 `{ ok:false, issues:[share_import_closed] }`，**不解析客户端输入**（避免在门关闭期间处理外部布局/参数）。
- 门放行后：原有快照校验 → ID 重生成 → 修复 → 双文档校验 → 逐卡 `validateAnalysisParams`（`invalid` → 导入失败；`readonly` 仅提示不阻断）。G-12b 的 `resolveAnalysisVersion` 非 `current` 时跳过 params 版本校验，避免重复报同一问题。
- 放行条件（依据 G-12a v1.1 §9）：D 校验实现 + 35 用例全过（本批完成）、B/C 受影响接口核对、Lead 复核后置 `shareImportAllowed=true`；放行后仍走同一校验。
- **Lead 裁定（2026-10-27，D-6 验收时）：本 S-01 v2 冻结周期不决策放行，`shareImportAllowed=false` 维持关闭。** 未来放行需同时满足：(a) A 发布 G-12a 表数据同步（T-8 已随 G-12a v1.1 落实，D 已于 2026-10-27 同步表数据/用例；T-7 C 系列白名单占位仍待 A）；(b) B/C 对 G-12a v1.1 的核对；(c) 集成导入真实接线 + 权限/容量测试——三者均不在本冻结范围内。

---

## 5. 测试证据（真实执行）

命令与结果（2026-10-27，本工作区；G-12a v1.1/T-8 同步后）：

- `pnpm.cmd --filter @libellum/shared typecheck` → **exit 0**
- `pnpm.cmd --filter @libellum/shared exec vitest run src/analysis/layout` → **21 test files / 327 tests passed**（D-3.2 后 265 + D-6 后新增 62：params-validation 55 + import-pipeline 7），约 1.72s，exit 0。

`params-validation.test.ts` 覆盖：G-12a §8 的 35 条逐条编号用例（空 params、kind 不符、categoryIds 类型/去重、tagIds、unknownKey、隐私键拒绝、timePreset 冲突、相对区间上限与 allowLongRange 组合、`timeFixed` 6 预设通过/枚举外拒绝/旧绝对对象与逆序对象拒绝/与 timePreset 冲突/与 allowLongRange 冲突、maxParts/topN 边界、I17 metric、B16 includeSystemCategories、B03 comparisonPolicy、未知 analysisId/较新版本只读占位、分享门关闭拒绝）+ 附加边界（键数上限、嵌套对象、无效 UUID、I01 不接受 topN、B03 不接受 `kind:"income"`、错误码枚举一致性）。

---

## 6. 与 S-03 / S-01 契约的关系

- 本批只实现已登记输入，**不改 S-03 契约文本**：S-03 v0.8 已把 G-12a v1.1 登记为 D 校验输入与 `shareImportAllowed` 导入门；`paramsSchemaVersion` 独立于 layout `schemaVersion`/`layoutAlgorithmVersion`。
- 绝对区间语义：卡片级 `pinnedRange` 为唯一来源；`params.timeFixed` 现为 6 个预设枚举（Lead 裁定；**冻结包待办 T-8 已随 A 的 G-12a v1.1 落实（2026-10-27）：D 只同步表数据/用例，不改校验器结构/签名/返回类型**）。
- 分析协议版本迁移归 S-01（`S01_PROTOCOL_VERSION`）；本层只做 G-12b 只读占位，不迁移 `analysisVersion` 或参数。

---

## 7. 占位与未决

| 项 | 现状 | 待决方 |
|---|---|---|
| `analysisVersion` 排序 | 仅等值比较（G-15 版本串/排序未冻结前的保守占位） | S-01 冻结（Lead/A） |
| `timeFixed` 语义 | **已按 G-12a v1.1 落为 6 个预设枚举（T-8 已落，2026-10-27）**；旧绝对 `{from,to}` 拒绝、绝对区间走卡片级 `pinnedRange` | 已完成（A G-12a v1.1 + Lead 裁定） |
| 账本存在性与权限 | 本层不查（只校验 UUID 形状），由查询层 `requireBook` 执行 | B/C + 集成 |
| 分享放行 | **维持关闭**（Lead 2026-10-27 裁定：本冻结周期不决策放行；放行三条件见 §4）；D 不会自行放行 | Lead（T-8 已落 + B/C 核对 + 集成接线后） |
| G-12a 表变更同步 | A 后续升版时 D 只更新表数据/用例，不改校验结构；新增键=新 analysisVersion；T-7（C 系列白名单占位）待 A 补充后再同步 | A / Lead |
| UI 提示文案/i18n | 未实现（错误码→文案映射属 UI 批次） | Codex/集成 |

---

## 8. 偏差记录

- 错误结构复用 D-1 的 `DocumentValidationIssue{path,code,detail}` 形状（未新造一套），导入管道中直接以该结构返回，减少跨模块转换。
- 导入管道中 params `readonly` 状态**不阻断**导入（`ok=true` + 提示），`invalid` 才失败——与“只读占位、保留配置”裁定一致。
- `import-pipeline.test.ts` 因 `shareImportAllowed` 变为必填而整体重写，原 18 处调用补参数；行为未变。
- T-8 同步（G-12a v1.1）只改表数据/用例：`timeFixed` 由 `{from,to}` 对象改为 6 个预设枚举，删除旧日期解析辅助函数；校验器结构/签名/返回类型、26 项分析表、9 个通用键名称/顺序、36 个隐私键、9 个错误码均未变。
- 未新增独立错误类型/未接包入口；S-03 仅文档升版至 v0.8（引用更新，不改契约）。

---

## 9. 下一步

1. 分享导入门：**维持关闭**（Lead 2026-10-27 裁定，本冻结周期不决策放行）。
2. T-8（G-12a v1.1）D 侧表数据/用例同步**已完成**（2026-10-27）；后续 A 发布新表数据差异清单时，D 只同步表数据（不改结构/校验逻辑）。
3. 继续等待真实 Codex 视觉规范与 Lead 对 D-2 UI/后续 headless 批次的批准；不自行接页面/入口。

---

## 10. G-12a v1.1（T-8）同步记录（2026-10-27，Lead m02101）

- **依据**：A 的 `S17-Agent-A-G12a-params白名单发布形态-v1.md` v1.1（A 提交 `782b036`；r7.2 `b39b27a`；Lead 登记 `a6bf9aa`）。要求 D 只改表数据/用例，不改校验器结构/签名/返回类型。
- **代码变更**：`TIME_FIXED_PRESETS`（6 值）/`TimeFixedPreset`/`isTimeFixedPreset` 新增；删除 `DATE_PATTERN`/`isValidCalendarDate`/`inclusiveDayCount`/`validateTimeFixed` 与 `fixedDays` 检查；`timeFixed` 分支改枚举校验；嵌套对象规则收紧（`timeFixed` 对象 → `params_type`，其他对象 → `params_private_data`）；`allowLongRange` 仅相对区间 >400 天有效。
- **测试变更**：`params-validation.test.ts` 由 51 项 → 55 项（#19/#20 改预设通过；新增 #31–35：旧合法绝对对象→`params_type`、旧逆序对象→`params_type`、枚举外→`params_type`、timeFixed+timePreset→`params_conflict`、timeFixed+allowLongRange→`params_out_of_range`；删除过期绝对区间边界用例）。
- **真实结果**：`typecheck` exit 0；`vitest run src/analysis/layout` **21 files / 327 tests passed**。
- **接口/契约**：无接口形状变化；`shareImportAllowed` 维持关闭；S-03 由 v0.7 升 v0.8（纯文档引用同步）。
- **提交**：`7ec7810`（feat(s17): Agent D 同步 G-12a v1.1（T-8）参数表数据与用例（headless），5 files +178/−171），`docs(s17)` 记录提交（本记录提交）。
