# S17 · Agent D · D-3.1 记录：独立布局档案与模式迁移引擎（v1）

> 最后核对: `d4e4fd8`（1.16.23 基线）+ 本轮 D-3.1 提交 / 2026-10-27
> 性质：D-3 headless 批次中的「统一/独立布局档案 schema 与迁移引擎」实现记录（对应所有者规格 D-3/D-4 的纯函数部分）。**不接 UI、不接页面/API/路由、不改版本号、不新增迁移**。
> 提交方：`DS-S17-D-Layout`；评审方：Lead；状态：**draft，待 Lead 评审**。
> 代码位置：`packages/shared/src/analysis/layout/`（**仍未接入** `packages/shared/src/index.ts`，接入属集成批次）。
> 相关：[D-0 数据模型](./S17-Agent-D-D0-布局数据模型与接口-v1.md) · [D-1 校验与测试](./S17-Agent-D-D1-布局引擎测试与文档校验-v1.md) · [D-2 前置交互](./S17-Agent-D-D2-前置-交互模型与状态机草案-v1.md) · [D-3 迁移/修复/容器](./S17-Agent-D-D3-跨列迁移-修复顺序-容器语义-v1.md) · [D-4 文档 IO/导入/存储](./S17-Agent-D-D4-前置-文档IO-迁移链-导入-存储契约-v1.md) · [S-03 接口草案 §4.5](./S17-Agent-D-S03-接口草案-布局侧-v1.md) · [D-5 只读预研](./S17-Agent-D-D5-只读预研-W5W6集成与规格对照-v1.md) · 配置与分享方案 §4.5/§5。

---

## 1. 目的与范围

Lead 批准（2026-10-27，D-3 headless 范围）的独立档案部分：

- 统一布局（默认）与独立布局（可选开关）的**数据结构与模式语义**；
- 独立档案的**按需物化**（写时复制）与**解析**（渲染用几何）；
- 档案与主布局之间的**切换/采纳**行为与数据保留规则；
- 与投影、文档校验、内容文档的关系（布局只存几何，卡片/容器身份仍归内容文档）；
- G-12b「未知/较新分析定义版本只读占位」的导入侧纯函数落点；
- 纯函数 + 单测 + 属性测试。

**不做**：OQ-LM-07 跨列编辑写回 UI、OQ-LM-08 宽度档阈值（无所有者裁定前不猜数值）、新增卡片的自动补位/保存时机（属 W5/W6 集成）、服务端同步、页面/路由。

## 2. 交付物

| 交付物 | 位置 | 说明 |
|---|---|---|
| `profiles.ts`（约 470 行） | `packages/shared/src/analysis/layout/` | 档案键派生、解析、物化、模式切换、采纳档案、未放置诊断 |
| `profiles.test.ts`（22 项） | 同上 | 键派生/解析/物化/切换/属性测试（300 场景） |
| `import-pipeline.ts` 扩展 | 同上 | `ShareImportOptions.resolveAnalysisVersion` + G-12b 只读占位问题码 |
| `import-pipeline.test.ts`（+3 项） | 同上 | newer/unknown/current 与向后兼容 |
| 目录 barrel | `index.ts` | 追加 `export * from "./profiles.js"`（仍未接 `packages/shared/src/index.ts`） |

## 3. 模式与解析语义

- `LayoutMode = "unified" | "independent"`；`main` 是**唯一权威主布局**，`profiles[]` 是可选档案（`profileKey` + `geometry`），`previousMain` 仅用于「保留上一个布局」。
- **统一模式**：无论是否存在 `profiles`，渲染几何一律由 `main` 按目标列数投影得到（`source: "main-projection"`）；档案数据不被使用但保留（切回独立不丢数据）。
- **独立模式**：首次（无对应档案）也从主布局投影（`source: "main-projection"`），**不物化**；只有当用户在该档案下保存编辑时才写时复制生成档案条目（`source: "profile"` 之后）。
- `resolveProfile(layout, content, { targetColumns, profileKey?, contracts?, verticalCompact? })`：
  - 返回 `{ targetColumns, profileKey, projection, geometry, source, issues }`；
  - 非法 `targetColumns`（非 1–12 整数）→ 夹到 2 并登记 `invalid-columns`；
  - 空/非法 `profileKey` → 回退派生占位键并登记 `invalid-profile-key`；
  - 投影内部问题以 `projection-<reason>` 前缀登记（如 `projection-orphan-dropped`），不改投影行为；
  - 纯函数：不修改输入布局与内容文档。
- 无档案时**不自动物化**；物化只发生在显式保存（`materializeProfile`），与「编辑会话 = 草稿，完成时原子提交」一致。

## 4. 档案键（占位，OQ-LM-08 未决）

| 派生方式 | 实现 | 当前口径 |
|---|---|---|
| 精确列数 | `profileKeyForColumns(n)` → `cols-<n>`（1–12），越界返回 `null` | **默认占位策略** `PROFILE_KEY_STRATEGY_PLACEHOLDER = "exact-columns"` |
| 宽度档 | `profileKeyForWidth(width, bucketWidths = [])` → `width-<upper>` / `width-over-<last>` | 阈值来源 `PROFILE_WIDTH_BUCKETS_PLACEHOLDER = []`（**未定数值不猜**：空表返回 `null`） |

OQ-LM-08（档案粒度/阈值/分割比例归属/切换）仍待所有者；在裁定前，生产调用应使用精确列数键，或由调用方注入宽度档表并自行登记该阈值来源。档案内容器分割比例当前按内容文档共用（未按档案独立）。

## 5. 物化、切换与采纳

- `materializeProfile(layout, content, { targetColumns, profileKey?, contracts?, verticalCompact? })` → `{ layout, created, issues }`：
  - 已有档案 → `created=false` 且原样返回（幂等，不重算、不覆盖）；
  - 档案键不可派生 → `profile-key-unavailable`（不静默用错误键）；
  - 否则把**当时的投影几何**写入 `profiles[]`（写时复制），结果再过 D-1 文档校验；
  - 不修改输入布局。
- `switchLayoutMode(layout, mode)` → `{ layout, changed, issues }`：
  - `unified → independent`：保留 `main` 与既有 `profiles`，不物化任何档案；
  - `independent → unified`：`profiles` 保留但不再使用（可随时切回），不会静默丢弃；
  - 非法模式 → `invalid-mode`，布局不变。
- `adoptProfileAsMain(layout, profileKey)` → `{ ok, layout?, issues }`（「以当前档案作为统一主布局」）：
  - 新 `main` = 档案几何副本，`mode = "unified"`，`previousMain` = 旧 `main`（保留上一个布局），`profiles` 保留；
  - 档案不存在 → `missing-profile`，布局不变。

## 6. 与内容文档、投影的关系

- 布局文档只存几何与 `presentation`/`expandedSize`；卡片/容器身份、分析引用、图表配置、容器内部结构均在内容文档，由投影按 `objectId` 关联。
- 内容删除后，档案中残留的几何条目会由投影丢弃（`projection-orphan-dropped`），**不会写回**档案；下一次保存时由集成层清理（与配置与分享方案 §4.5 一致）。
- `findUnplacedContentObjects(content, layout)` 返回「在主布局与所有档案中都没有几何条目」的内容对象（按 `objectId` 排序），供集成层提示/补位；**本函数不自行补位、不修改文档**。
- 投影缓存键由 `deriveProjectionCacheKey`（D-4）派生，包含目标列数与内容版本；档案解析不另立缓存语义。

## 7. G-12b：未知/较新分析定义版本只读占位

- `ShareImportOptions.resolveAnalysisVersion?: (reference) => "current" | "newer" | "unknown"`；
- 返回 `newer`/`unknown` 时导入**不失败、不删卡片、不自动改版本**，只登记问题码 `analysis-version-readonly`（`detail` 区分“较新/未知”），引用与参数原样保留（导入为独立副本，不改现有工作台）；
- 与 `resolveAnalysis`（未知 `analysisId` → `analysis-needs-rebind`）互补：前者管**版本**，后者管**是否存在**；
- 该行为按 Lead 裁定的 G-12b 口径落地（S-01 v2 §6.1；分享导入兼容仍待 Q-15 绑定）。

## 8. 测试与验证（真实执行）

| 命令 | 结果 |
|---|---|
| `pnpm.cmd --filter @libellum/shared typecheck` | exit 0 |
| `pnpm.cmd --filter @libellum/shared exec vitest run src/analysis/layout` | **18 files / 234 tests passed**（D-4 后 209 + D-3.1 新增 25：profiles 22、import-pipeline +3） |

`profiles.test.ts` 关键用例：档案键派生（`cols-*`、宽度档空表 null、非法输入）、统一模式忽略档案、独立有档案用档案几何（与主布局投影可区分）、独立无档案不物化、显式档案键跨列确定性、非法列数/键回退、纯函数不改输入、孤儿丢弃、物化幂等/一致性、模式切换数据保留、采纳档案（`previousMain`/`missing-profile`）、未放置诊断；属性测试 300 场景（固定种子 0x5f17d1a1，确定性/布局不变/几何合法/profileHits > 100）。

## 9. 占位与未决登记

| 项 | 状态 | 出处 |
|---|---|---|
| OQ-LM-08 档案粒度（精确列数 vs 宽度档）与阈值 | **未定**：`exact-columns` 为占位默认，宽度档表为空 | 布局规格 §18.4 / 任务文档 §7 |
| OQ-LM-07 统一模式跨列编辑写回（M1/M2/M3） | **未定**：写回仍占位 `read-only-until-OQ-LM-07`；编辑 UI 未实现 | 布局规格 §18.3 |
| 档案内分割比例是否独立于内容文档 | **未定**：当前共用（与配置方案一致） | 配置与分享方案 §5 |
| 新增卡片在各档案的自动补位/保存时机 | 本批只提供 `findUnplacedContentObjects` 诊断 | D-5 集成批次 I-8 |
| 档案物化的持久化/同步粒度 | W6（本地优先 + 服务端同步需批准） | 配置与分享方案 §4.5 |

## 10. 偏差与未做项

- **未实现**：档案切换 UI、编辑时选择「作用于主布局还是档案」的交互（OQ-LM-07）、宽度档阈值、档案级分割比例、自动补位、服务端同步。
- `profiles.ts` 的档案键策略与宽度档均为占位常量；在所有者裁定前，调用方不应把宽度档视为正式契约。
- 本批不改 `packages/shared/src/index.ts`、不新增迁移、不升级版本号（1.17.1 由 Lead 在集成 worktree 统一维护）。

## 11. 下一步

1. Lead 评审本批（尤其 §3 写时复制语义、§4 档案键占位、§7 G-12b 口径）；
2. 待 OQ-LM-07/08 裁定后，替换占位常量并补编辑写回/宽度档；
3. 集成批次（D-5 I-8）接入本地持久化与服务端同步；
4. 待真实 Codex 视觉规范后进入 D-2 UI（另行批准）。
