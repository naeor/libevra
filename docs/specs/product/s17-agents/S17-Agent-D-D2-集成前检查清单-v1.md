# S17 · Agent D · D-2 集成前检查清单（v1）

> 最后核对: `d25d28e`（`deepseek/s17-layout-engine`）/ 2026-10-27
> 提交方：Agent D（DS-S17-D-Layout）｜接收方：Lead、S-03 集成方
> 状态：**只读准备材料（待命期间产出）**；**不启动 I-0**，不改代码、不改契约、不改包入口
> 批准来源：Lead m02293（`s01-v2` 冻结后 D 进入待命；允许「最多一份 D-2 集成前检查清单（导出面/权限/容量/回退路径）」）

## 1. 目的与边界

本清单为 **I-0（包入口导出 + 静态守卫）** 开工前的最小检查准备，只做只读核对与登记：

- 不放宽任何约束：不写代码、不改 `packages/shared/src/index.ts`、不改 S-01 `s01-v2`/S-03 draft v0.8 契约、不碰页面/路由/API、不加迁移、不 push。
- I-0 本身仍未启动：需 Lead 批准导出面与不变量后再开工（本清单 §3 给出建议导出面供评审）。
- 依赖：I-0 评审方=Lead + S-03；D-2 UI 等真实 Codex 视觉规范；编辑器命令扩展等交互/校验契约另行确认。

## 2. 基线快照（只读核对，2026-10-27）

| 项 | 现状 |
| --- | --- |
| 分支 / HEAD | `deepseek/s17-layout-engine` @ `d25d28e`，工作树 clean，未 push |
| 布局目录 | `packages/shared/src/analysis/layout/`：**41 个文件**（25 个源文件 + 16 个测试文件） |
| 测试文件 | 21 个（含既有目录内测试；`vitest run src/analysis/layout`） |
| 测试证据 | **21 files / 327 tests passed**（T-8 同步后实测，exit 0） |
| 类型检查 | `pnpm --filter @libellum/shared typecheck` exit 0（T-8 同步后实测） |
| 目录 barrel | `packages/shared/src/analysis/layout/index.ts`：17 个 `export *`（types/grid/projection/validation/commands/focus/machine/compaction/repair/profiles/containers/document-io/migration-chain/share-snapshot/import-pipeline/storage-contract/params-validation） |
| 包入口 | `packages/shared/src/index.ts` **未包含** layout（`@libellum/shared` 入口仍为扁平既有模块） |
| 契约状态 | S-01 `s01-v2` 已冻结（2026-10-27 09:30 CST）；S-03 为 **draft v0.8**（未冻结，布局契约以 S-03 为准）；`shareImportAllowed=false` 维持关闭 |

## 3. 导出面检查（I-0 待批）

### 3.1 现状

- 目录 barrel 全量 `export *`，共提取到 **248 个导出标识符**（函数/常量/类型/接口）。
- 包入口 `@libellum/shared` 目前零 layout 导出；接入改动只应是 `packages/shared/src/index.ts`（+ 必要时 barrel 注释），不改布局目录结构。
- 已做候选名冲突核对：对 31 个高频名称（`LayoutMode`/`RangePolicy`/`DisplayForm`/`GridSize`/`AnalysisReference`/`ObjectSizeContract`/`DocumentValidationResult`/`MigrationStatus`/`ChartPresentation`/`CardTitleSpec`/各节点与文档类型/`ProjectionResult`/`ProjectOptions`/`LAYOUT_*` 常量等）与 `packages/shared/src/*.ts` 既有扁平导出比对 → **发现 0 个重名冲突**。
- 待办：I-0 时应对全部 248 个标识符跑一次自动检查（建议脚本：从 layout barrel 提取导出名，与 `packages/shared/src/index.ts` 及其间接导出名比对，断言无重名/Escaped reserved word）。

### 3.2 建议导出面（供 Lead / S-03 评审，非最终决定）

| 组 | 建议公开（代表符号） | 用途 |
| --- | --- | --- |
| 文档模型 | `WorkbenchContentDocumentV1`、`LayoutDocumentV1`、`LayoutProfile`、`ObjectGeometry`、`LayoutGeometry` | 集成层持久化/传输 |
| 投影与几何 | `projectLayout`、`projectionToGeometry`、`positionToRowCol`、`rowColToPosition`、`validateGeometry` | 工作台渲染入口 |
| 文档 IO | `validateLayoutDocumentV1`、`validateContentDocumentV1`、`parse*`、`serialize*`、`load*Document`、`roundTrip*` | 存储读写/损坏容错 |
| 迁移 | `runMigrationChain`、`migrateLayoutDocument`、`migrateContentDocument`、`deriveProjectionCacheKey` | 版本兼容 |
| 档案 | `resolveProfile`、`materializeProfile`、`switchLayoutMode`、`adoptProfileAsMain` | 统一/独立布局 |
| 容器/紧凑 | `deriveContainerDisplay`、`collapseContainerGeometry`、`restoreContainerGeometry`、`compactVertically` | 1×1 与紧凑 |
| 编辑 | `createEditorState`、`applyCommand`、`transitionEditorMachine`、`commandForKey`、`findDirectionalNeighbor` | 编辑器集成 |
| 校验 | `validateAnalysisParams`、`checkShareImportGate` | G-12a v1.1 与导入门 |
| 分享/存储 | `buildShareSnapshot`、`parseShareSnapshotJson`、`prepareShareImport`、`mergeLayoutDocuments`、`mergeContentDocuments` | W6 集成占位 |
| 尺寸契约 | `ObjectSizeContract`、`ProjectedObject`、`DisplayForm` | A/B/C 卡片接入 |

建议：**不要直接把 248 个符号用 `export *` 全部并入包入口**；优先选上述组 + 显式 `export type`，把测试期内部符号（`test-prng`/`test-support` 不在 barrel，且不应导出）和低层辅助函数留在子路径，降低包入口污染与重名风险。

### 3.3 导出后必须保持的不变量（I-0 验收）

1. 纯函数/纯数据：布局模块无 I/O、无 DOM、无时钟、无随机数（分享码/导入 ID 的随机源由调用方注入），顶层无副作用（tree-shaking 友好）。
2. 不写回权威布局：投影/紧凑/收缩结果永不持久化（§14 / §17 已定）。
3. 不改变既有导出行为：接入只做新增导出，不改 `packages/shared` 既有模块的签名/行为。
4. 类型可用：`apps/web` 能 `import type` 通过 `tsc --noEmit`（I-0 时由 Lead 批准后再接）。
5. 文档同步：导出面变化须在 S-03、D-5 集成清单与任务文档 §6.2 同步记录（一次只改一件事）。

## 4. 权限检查

- 布局层**不做鉴权**：`requireBook`/权限过滤仍在查询层；布局只消费 `AnalysisReference` 与只读占位状态（G-12b）。
- 不加敏感权限判断（仓库规则：敏感权限只许新增、本批不新增）；不读写账务数据；静态守卫测试见 D-5 §3（I-0 交付物之一）。
- 分享/同步：`shareImportAllowed=false` 保持；服务端同步、隐私开关、分享审核均为 W6 且需所有者/Lead 批准（B-6 门未开）。
- 数据边界：`params-validation` 隐私黑名单 36 键仍生效；`share-snapshot` 白名单构建（不含金额/账本标识/自定义标题默认不导出）不因 I-0 改变。

## 5. 容量检查（现有常量与测试证据）

| 类别 | 上限/证据 |
| --- | --- |
| 网格 | 列数 1–12；`rowSpan` ≤ 8；纵向无上限（`MAX_COLUMNS`/`MAX_ROW_SPAN`） |
| 对象 | 每工作台卡片 ≤ 40、容器 ≤ 12、容器深度 1；GridSplit 2–4 子、Carousel 2–6 页 |
| 参数 | G-12a `params` 键数 ≤ 12；id 数组 1–50；相对区间默认 ≤ 400 天（上限 3660，需显式 `allowLongRange`）；`timeFixed` 6 预设 |
| 分享/导入 | 快照 ≤ 64KB、卡片 ≤ 40、容器 ≤ 12/深度 ≤ 2（导入侧）、标题 ≤ 40/描述 ≤ 200 |
| 测试 | 属性测试 10⁴ 场景（网格不变量）、D-3.1 300 场景、D-3.2 200/800 场景、T-8 55 项参数用例；`vitest run src/analysis/layout` 21 files / 327 tests |
| 性能 | 拖拽/缩放只更新几何、不重算财务（§11）；基准预算属 W5（D-5 §3 I-10），I-0 只做类型/bundle 检查，不做真机性能承诺 |

## 6. 回退路径（I-0 若出问题）

1. 回退面：I-0 只应改 `packages/shared/src/index.ts`（+ 可能的注释）；**不含数据/迁移/服务端变更**，布局目录本身不删不改。
2. 回退方式：单个 revert 提交（`git revert <I-0提交>`），恢复包入口后 `pnpm --filter @libellum/shared typecheck` + `vitest run src/analysis/layout` 全绿即可；apps 侧因新增导出被撤回，编译应恢复。
3. 无需回退数据：无数据库迁移、无本地存储格式变更、无服务端调用；`shareImportAllowed` 保持 false 不受影响。
4. 回退需 Lead 批准（涉包入口）；回退后按 S-03/任务文档 §6.2 记录。

## 7. 待确认与不启动声明

- 待 Lead/S-03 确认：I-0 导出面（§3.2 建议 vs 全量）、导出名冲突自动检查脚本是否随 I-0 提交、bundle 体积阈值（若有）。
- **不启动**：I-0 未开工；D-2 UI 等真实 Codex 视觉规范；编辑器命令扩展（insert-container/内部编辑/整组复制/删除语义拆分等）等交互与校验契约确认；W5/W6 服务端、同步、分享放行均未启动。
- 若无安全可做批次，D 将报「无可做批次」并继续待命，不凑工作量。

## 8. 证据与校验记录

- 只读命令：`Get-ChildItem packages/shared/src/analysis/layout`（41 files）；提取 barrel 导出标识符=248；候选名冲突检查=0 冲突；`git status --short` clean（2026-10-27）。
- 测试/类型证据引用自 T-8 同步提交 `7ec7810` 后的实测：`typecheck` exit 0、`vitest` 21 files / 327 tests；本轮未重跑（纯文档准备，不改代码）。
- 文档检查（本清单提交前）：`node tools/check-links.mjs`、`node tools/doc-audit.mjs`、`node tools/check-status.mjs`。

## 9. 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1 | 2026-10-27 | 首版：待命期间只读准备；导出面/权限/容量/回退路径检查清单（D-2 集成前，I-0 待 Lead 批准） |

## 10. I-0 执行结果（2026-10-27，Lead m02293 批准后落地）

- **导出面**：`packages/shared/src/index.ts` 已按 §3.2 十组精选追加 layout 导出（additive、显式 `export type`、约 214 个公开符号；**禁止项已守住**：无 `export *` 全量并入、低层占位常量/调试函数/测试辅助不导出）。原 248 个候选标识符中重名=0、reserved word=0。
- **守卫交付物**：`packages/shared/src/analysis/layout/export-surface.test.ts`（8 项）——入口段与无全量 export*、全量标识符重名/保留字、内部符号不泄漏、精选函数与目录 barrel 同源、`import type` 可用、生产模块无 I/O-DOM-网络-时钟-随机/框架依赖且不反向 import 包入口、投影不写回权威布局且确定性。
- **真实验证**：`pnpm --filter @libellum/shared typecheck` exit 0；shared 全量 `vitest` **40 files / 711 tests passed**；文档检查通过；`pnpm check:build` exit 0（真实 web 构建通过）。
- **回退**：单提交 revert `packages/shared/src/index.ts`（无数据/迁移/服务端变更）。
- **未做**：未接页面/路由/API、未改布局目录源文件、未改 S-01/S-03 契约、未加迁移、未改版本号、未 push；`apps/web` 侧 import 留 I-1+ 批次。
