# S17 · Agent D · D-5 只读预研：W5/W6 集成清单与规格对照

> 最后核对: `e73946b` / 2026-10-27（D-5 只读预研提交；代码与测试证据同 D-4 提交 `b9f4d33`/`49eb04a`）
> 性质：**只读预研记录（规划/验收素材）**，本文件不含代码变更、不接页面、不动主工作区；结论提交 Lead 汇总给所有者。
> 提交方：`DS-S17-D-Layout`；批准方：Lead（m00988，D-5 只读预研批准）
> 依据：所有者《Agent D 完整开发规格》§40–§46（归档 `ff09275`）、S-03 草案 v0.3、任务文档、S-01 v2 草案、1.16.23 主工作区候选。
> 相关：[D0](./S17-Agent-D-D0-布局数据模型与接口-v1.md) · [D1](./S17-Agent-D-D1-布局引擎测试与文档校验-v1.md) · [D2 前置](./S17-Agent-D-D2-前置-交互模型与状态机草案-v1.md) · [D3](./S17-Agent-D-D3-跨列迁移-修复顺序-容器语义-v1.md) · [D4](./S17-Agent-D-D4-前置-文档IO-迁移链-导入-存储契约-v1.md) · [S-03 草案](./S17-Agent-D-S03-接口草案-布局侧-v1.md)

---

## 1. 目的、边界与结论摘要

Lead 批准的四项只读预研：

1. W5/W6 集成清单：D-1/D-3/D-4 纯函数接入真实布局引擎/页面/存储的接入点、依赖、风险分级与建议顺序；
2. 规格「永久文档 30 项」（§43）与「最终交付清单」（§45）逐项对照：已完成 / 待集成 / 待所有者 + 证据位置；
3. 1.16.23 候选（主工作区未提交）对 D 层影响面只读核对（预计 rebase 冲突文件与性质）；
4. 只读复核 S-01 v2 中 D 契约条款最新变化。

**边界遵守**：本预研未改任何代码、未 rebase、未接页面/路由、未 push、未改动主工作区与其它 worktree；只读范围限本机工作区与 `docs/specs`。证据截止 `49eb04a`（2026-10-27）。

**结论摘要**：

- D 层 headless 纯函数（`packages/shared/src/analysis/layout/`，34 文件）已覆盖规划中大部分算法与文档能力，全部测试可从 `486c603` 基线增量接入；**尚未接入** `packages/shared/src/index.ts` 与任何页面/存储。
- W5/W6 不是单一集成点，而是 **6 个集成批次**（见 §3）：入口导出与契约冻结 → 只读工作台 → 编辑模式 → 容器/模板 → 本地持久化 → 同步/分享。前 3 个批次不依赖任何未决 OQ，可先做；后 3 个分别依赖所有者裁定（OQ-LM/CF）、Codex 视觉与 W6 批准。
- 永久文档 30 项：**22 项有代码+测试或文档证据**（其中 9 项为“已实现-纯函数，待接入”），5 项待集成，3 项待所有者；最终交付 36 项：**20 项纯函数/文档已完成**，12 项待集成/待批准，4 项待所有者（详见 §4/§5）。
- 1.16.23 影响面：**D 分支相对基线全为新增文件（42 个，0 修改）**，预计 rebase 无文件级冲突；唯一前置是 Lead 先将主工作区候选提交为 1.16.23 发布提交（主工作区当前 12 改+4 新增仍未提交）。
- S-01 v2 中 D 契约条款**无最新变化**：v2 结构草案仍为 `v2-draft` 未冻结，D 的 G-12a/b/c 与 X-01 意见已登记在汇总表（待 C 反馈 → Lead 汇总裁定 → A 一次性修订）；D 侧无新增接口点。

---

## 2. 现状快照（证据基础）

- 分支 `deepseek/s17-layout-engine`，基线 `486c603`（1.16.22 发布记录，2026-10-26 16:19:26 +0800），HEAD `49eb04a`，工作树 clean，未 push、未 rebase。
- `git diff --name-status 486c603..HEAD`：**42 个文件全部新增（A）**，0 修改。构成：8 个 `docs/specs/product/s17-agents/` 文档 + 34 个 `packages/shared/src/analysis/layout/` 代码/测试文件。
- 测试：`pnpm.cmd --filter @libellum/shared typecheck` exit 0；`pnpm.cmd --filter @libellum/shared exec vitest run src/analysis/layout` → **17 files / 209 tests passed**（含 10,400 属性场景）。
- 模块清单（34 文件）：
  - 类型/常量：`types.ts`
  - 网格：`grid.ts`
  - 投影/迁移：`projection.ts`、`migration.ts`（测试）
  - 紧凑/修复：`compaction.ts`、`repair.ts`
  - 校验/序列化：`validation.ts`
  - 编辑器 headless：`commands.ts`、`focus.ts`、`machine.ts`
  - 文档 IO：`document-io.ts`
  - 版本迁移链/缓存键：`migration-chain.ts`
  - 分享快照/短码：`share-snapshot.ts`
  - 导入管道：`import-pipeline.ts`
  - 本地存储契约：`storage-contract.ts`
  - 测试夹具/PRNG：`test-support.ts`、`test-prng.ts`
  - 测试文件 17 个（grid/projection/commands/focus/machine/migration/compaction/repair/container/fixtures/property/serialization/document-io/migration-chain/share-snapshot/import-pipeline/storage-contract）。

---

## 3. W5/W6 集成清单（接入点、依赖、风险、顺序）

### 3.1 集成批次（建议顺序）

| 批次 | 范围 | 依赖 | 风险级 | 建议时机 |
|---|---|---|---|---|
| I-0 | 包入口导出 layout（`packages/shared/src/index.ts`）+ 静态守卫测试 + 集成冒烟 | S-03 评审通过、Lead 批准 | 中（公共 API 面） | W3 卡片注册表就绪前后，可最先做 |
| I-1 | 工作台只读渲染：宽高测量→列数→`projectLayout`→网格 CSS；卡片占位组件 | W2 schema v1、W3 卡片家族 `minSize/sizeLadder`、Codex 视觉、S-01 v2 冻结 | 标准 | W5 首批（页面首个可见成果） |
| I-2 | 编辑模式 UI：`commands.ts`/`focus.ts`/`machine.ts` 接入 + 撤销/键盘/手势 | Codex 视觉规范（拖拽/高亮/动画）、D-2 UI 批准 | 标准 | W5 第二批（Codex 到位后） |
| I-3 | 容器 UI（GridSplit/Carousel）与 1×1 入口详情页 | Codex 视觉、OQ-LM-05/09、OQ-LM-06 | 标准（不丢内部卡片） | W5 第三批 |
| I-4 | 模板：默认工作台「日常总览」、我的方案、套用/恢复 | W3 卡片清单、模板决策（§9 规格） | 标准 | W5 末 |
| I-5 | 本地持久化：`document-io`+`storage-contract` 适配 `deviceStorageKeys`/IndexedDB；草稿与保存事务 | OQ-CF-02（草稿落本地：先不落）、账号键设计 | 严格（数据丢失） | W5 末 / W6 首 |
| I-6 | 服务端同步：`WorkbenchSyncTransport` 实现 + 服务端 API/迁移 + 冲突合并 | 所有者批准、B-6、OQ-CF-01/03、W6 迁移评审与备份 | 严格（多端数据） | W6（需另行批准） |
| I-7 | 分享导入导出 UI：`exportShareSnapshot`/`prepareShareImport` + 识别码 | B-6 隐私门、OQ-CF-05/06/07/10、服务端快照表 | 严格（导入安全/隐私） | W6（需另行批准） |
| I-8 | 跨设备档案/响应式：`projectLayout` 列数推导 + `profiles` 写时复制 | OQ-LM-07/08 裁定、Codex | 标准 | W6 |
| I-9 | 无障碍/i18n/主题验收：焦点/键盘/读屏 + 七主题深浅中英文 | S-05、Codex | 标准（WCAG AA） | 贯穿 W5/W6 |
| I-10 | 性能与静态守卫：视口外不挂载、拖动不重算、扫描工作台目录写接口引用 | W2/W3 | 中 | W5 起持续 |

### 3.2 关键接入点（文件/层）

| 集成项 | 目标位置（当前代码基线） | 说明 |
|---|---|---|
| 包入口 | `packages/shared/src/index.ts`（现为扁平导出 billImport/money/presets…，**无 layout**） | 导出 `analysis/layout` 全部公开符号；需 S-03 评审后由 Lead/S-03 统一接入，D 不自接 |
| 工作台页面 | `apps/web/src/pages/`（现约 75 页，**无工作台页**）+ `apps/web/src/App.tsx`（路由） | 新增 Workbench 页面与路由；只读→编辑渐进 |
| 本地键登记 | `apps/web/src/lib/deviceStorageKeys.ts`（已有，含测试） | 本地配置/档案/草稿键必须登记统一谓词，纳入“清除本机数据”清理测试 |
| 运行时库 | `apps/web/src/lib/`（`theme.ts`/`language.ts`/`crossTabSync.ts`/`api.ts`/`queries.ts`/`uuid.ts`/`share.ts`） | 主题/语言复用；跨设备同步走 `api.ts`/`queries.ts`/`crossTabSync.ts`；ID 生成复用 `uuid.ts`；分享页可参考 `share.ts` |
| 卡片注册表 | S-03 定义（A 计算侧、Codex 视觉侧） | 布局层只消费 `AnalysisReference` + `ObjectSizeContract`，不解释分析参数 |
| 服务端 | `apps/api`（Fastify/Prisma，W6 才允许迁移） | `shared_layouts`/个人配置表与接口草图已在配置方案 §6/§8；**W6 需批准+迁移评审+备份** |

### 3.3 依赖与阻塞（按批次）

- **I-0/I-1 无未决 OQ**：列数公式、编号、投影、降级、Spacer、容器收缩均已由规格确认；缺的是 W2 schema v1、W3 卡片尺寸声明、Codex 视觉、S-01 v2 冻结（接口引用字段）。
- **I-2/I-3 阻塞**：Codex 视觉规范（拖拽/高亮/动画/键盘视觉）、OQ-LM-05（1×1 入口完整查看 A/B/C）、OQ-LM-09（容器宽高比/槽位最小可读）、OQ-LM-06（自动 vs 主动收缩表现）。
- **I-5 阻塞**：OQ-CF-02（草稿是否落本地，先不落）、账号键与清理策略（设备级设置不得混入）。
- **I-6/I-7 阻塞**：所有者 W6 批准（新增迁移需评审/备份）、B-6 隐私与分享合规、B-21（短码/隐私门/合并删除语义）、OQ-CF-01/03/05/06/07/10、S-04 权限测试。
- **I-8 阻塞**：OQ-LM-07（统一模式跨列编辑写回 M1/M2/M3）、OQ-LM-08（档案键粒度）。
- 全局：1.16.23 发布提交（Lead 统一 rebase，D 不自行 rebase）；S-03 冻结；S-01 v2 冻结。

### 3.4 风险分级（依规格 §42）

- **严格级（须全量测试+评审）**：I-5 本地持久化（数据丢失）、I-6 同步/冲突（多端）、I-7 分享导入（安全/隐私/权限）、任何 DB 迁移、跨 Agent 接口变更。
- **标准级（迁移/碰撞/拖动/缩放/容器/收缩/Spacer/恢复）**：I-1/I-2/I-3/I-4/I-8/I-9 的交互与算法接入；每项须固定夹具 + 回归。
- **轻量级（视觉细节）**：网格线、高亮动画、过渡；服从 Codex，不改布局语义。

---

## 4. 「永久文档 30 项」逐项对照（规格 §43）

状态词：**已完成**（有真实实现/测试或正式文档）、**已实现-纯函数（待接入）**、**待集成**、**待所有者**、**未开始**。

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 总任务说明 | 已完成 | 任务文档 §1/§2；D-0 §1；本文件 §1 |
| 2 | 布局对象 schema | 已实现-纯函数（待接入） | `types.ts`；D-0 §3；S-03 §3 |
| 3 | 网格编号规则 | 已完成 | `grid.ts`、`grid.test.ts`；D-0 §4 |
| 4 | 跨列数迁移算法 | 已完成（纯函数） | `projection.ts`、`migration.test.ts`；D-3 §3 |
| 5 | 用户确认的固定迁移示例 | 已完成 | `migration.test.ts`（3→4、4→3、多跳无漂移）；D-3 §3 |
| 6 | 碰撞处理 | 已完成（纯函数） | `grid.ts`（`findEarliestFreeAnchor`/重叠/占格）、投影贪心；TC-06/TC-22 |
| 7 | 尺寸降级 | 已实现-纯函数（待接入） | `projection.ts` forms/ladder/compat；`projection.test.ts`；数值待 W3 |
| 8 | Spacer | 已完成（纯函数） | `types.ts`/`projection.ts`/`compaction.ts`；TC-11/12/20；D-3 |
| 9 | GridSplit | 已实现-纯函数（待接入） | `types.ts`/`projection.ts`/`container.test.ts`；D-3 §4；UI 待 I-3 |
| 10 | Carousel | 已实现-纯函数（待接入） | 同上；D-3 §4 |
| 11 | 1×1 容器收缩 | 已实现-纯函数（待接入） | `projection.ts`（container-narrow/user-collapsed）、`container.test.ts`；D-3 §5 |
| 12 | 容器详情 | 未开始 | 依赖 OQ-LM-05 + Codex；规划见规格 §12/D-3 |
| 13 | 编辑模式 | 已实现-纯函数（待接入） | `commands.ts`/`focus.ts`/`machine.ts` + 测试；D-2 前置文档；UI 待 I-2 |
| 14 | 键盘与无障碍 | 已实现-纯函数（部分） | `focus.ts` 键盘映射、D-2 §无障碍/§键盘清单；真机与 WCAG 验收待集成 |
| 15 | 统一布局 | 已完成（纯函数） | `projectLayout(layout.main, targetColumns)`；D-3 §3 |
| 16 | 独立布局档案 | 已实现-数据结构（待接入） | `LayoutDocumentV1.profiles/previousMain`、`layoutOf`/校验；档案键策略 OQ-LM-08 待 |
| 17 | 本地持久化 | 已实现-契约（待接入） | `document-io.ts`、`storage-contract.ts` + 测试；IndexedDB 适配待 I-5 |
| 18 | 服务端同步 | 未开始（仅契约占位） | `WorkbenchSyncTransport` 类型；W6 需批准+迁移 |
| 19 | 冲突解决 | 部分实现 | `mergeLayoutDocuments`/`mergeContentDocuments` + 测试；删除判定待 OQ-CF-01 |
| 20 | 配置版本迁移 | 已完成框架 | `migration-chain.ts`（五状态/失败降级/较新只读）+ 测试；v2 步表待未来 |
| 21 | 模板 | 未开始 | 规格 §9 已定义；待 W3 卡片清单与模板决策 |
| 22 | 分享码 | 已实现-纯函数（待接入） | `share-snapshot.ts` 识别码/白名单/字节上限 + 测试；服务端快照表 W6 |
| 23 | 导入导出 | 已实现-纯函数（待接入） | `exportShareSnapshot`/`prepareShareImport` + 测试；UI 与服务端待 W6 |
| 24 | 测试矩阵 | 已完成（纯函数部分） | 17 files/209 tests；D-1/D-3/D-4 文档；TC-15/18/19/21/23/24 留集成 |
| 25 | 实际代码位置 | 已完成 | 任务文档 §2.2；D-0 §2；本文件 §2 |
| 26 | 开发进度 | 已完成 | 任务文档 §5/§6.2 |
| 27 | 阶段性提交 | 已完成 | §6.2 记录 `ff09275`→`49eb04a` 全部提交与测试数字 |
| 28 | 已知问题 | 已完成 | 任务文档 §7（D-Q1…D-Q12）+ 各文档 §偏差/待决 |
| 29 | 与其他 Agent 的接口版本 | 进行中（draft） | S-03 draft v0.3；S-01 v2 未冻结（§6） |
| 30 | 下一步任务 | 已完成 | D-4 §10、本文件 §9、任务文档 §7/§8 |

统计：已完成 15 项；已实现-纯函数/待接入 12 项；部分实现 1 项；进行中 1 项；未开始/待所有者 3 项（12/21/18 其中 18 未开始）。合计 30。

---

## 5. 「最终交付清单」逐项对照（规格 §45）

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 独立布局对象模型 | 已实现-纯函数（待接入） | `types.ts`（Node/Geometry/Document） |
| 2 | 稳定对象 ID | 已实现-纯函数 | `types.ts` 约定；`repair.ts`/校验重复 ID 处理；导入重生成 |
| 3 | 行优先网格编号 | 已完成 | `grid.ts`；D-0 §4 |
| 4 | 确定性迁移算法 | 已完成（纯函数） | `projection.ts`；`migration.test.ts`；`property.test.ts` 确定性 |
| 5 | 合法矩形占格 | 已完成 | `grid.ts`（`placementFitsColumns`/`placementCells`/`validateGeometry`） |
| 6 | 碰撞检测与重排 | 已完成（纯函数） | `grid.ts` + `projection.ts` 贪心；TC-06/TC-22 |
| 7 | 尺寸降级 | 已实现-纯函数（待接入） | `projection.ts` forms；数值待 W3 |
| 8 | 自动补位 | 已完成（纯函数） | `findEarliestFreeAnchor` |
| 9 | Spacer | 已完成（纯函数） | 同 §4-8 |
| 10 | 显式编辑模式 | 已实现-纯函数（待 UI） | `machine.ts` 状态机/`commands.ts`；D-2 前置 |
| 11 | 卡片拖动 | 已实现-纯函数（待 UI） | `commands.ts` move/move-by；UI 手势待 Codex |
| 12 | 卡片缩放 | 已实现-纯函数（待 UI） | `commands.ts` resize + 最小尺寸校验 |
| 13 | 高亮预览 | 未开始 | Codex 视觉 + 编辑器 UI（I-2） |
| 14 | 自动滚动 | 未开始 | 编辑器 UI（I-2） |
| 15 | 撤销/重做 | 已实现-纯函数（待 UI） | `commands.ts` 历史栈（上限 50）+ 测试 |
| 16 | 保存/取消 | 已实现-纯函数（待 UI/存储） | `machine.ts` commit/cancel + 二次确认；存储 I-5 |
| 17 | GridSplit | 已实现-纯函数（待 UI） | 同 §4-9 |
| 18 | 自由分割比例 | 已实现-纯函数（待 UI） | `GridSplitConfig` 千分比 + 校验；分割线交互待 I-3 |
| 19 | Carousel | 已实现-纯函数（待 UI） | 同 §4-10 |
| 20 | 容器专属详情入口 | 未开始 | 待 OQ-LM-05 裁定 + Codex |
| 21 | 1×1 保底收缩 | 已实现-纯函数（待 UI） | `projection.ts`；`container.test.ts` |
| 22 | 收缩后完整恢复 | 已实现-纯函数（待 UI） | `commands.ts` set-presentation 恢复（expandedSize）；恢复路径待 UI |
| 23 | 统一布局模式 | 已完成（纯函数） | `projectLayout` |
| 24 | 独立布局模式 | 已实现-数据结构（待接入） | `profiles/previousMain`；档案键 OQ-LM-08 |
| 25 | 响应式布局投影 | 已完成（纯函数） | 列数推导公式在 D-0/规格 §5；`projectLayout(targetColumns)` |
| 26 | 账号级个人配置 | 未开始 | W6；本地键契约已备（`storage-contract.ts`） |
| 27 | 本地优先保存 | 已实现-契约（待接入） | `document-io`/`storage-contract`；I-5 |
| 28 | 服务端同步 | 未开始（占位） | `WorkbenchSyncTransport`；W6 批准后 |
| 29 | 多设备冲突处理 | 部分实现 | 合并纯函数；OQ-CF-01/03 待 |
| 30 | 配置版本迁移 | 已完成框架 | `migration-chain.ts`；版本演进待未来 v2 |
| 31 | 预设模板 | 未开始 | 规格 §9；待 W3 卡片清单与决策 |
| 32 | 导出与导入 | 已实现-纯函数（待 UI/服务端） | `share-snapshot.ts`/`import-pipeline.ts` |
| 33 | 短码分享 | 已实现-纯函数（待服务端） | `createShareCode`/`isValidShareCode`（参数候选，OQ-CF-10） |
| 34 | 权限与隐私隔离 | 未开始 | W6；B-6/B-21、S-04 越权测试 |
| 35 | 性能与正确性测试 | 部分完成 | 209 项测试（确定性/属性/不变量）；性能基准待 W2/W5 基准环境 |
| 36 | 完整长期开发文档 | 进行中 | D0/D1/D2/D3/D4/本文件 + S-03；后续批次继续更新 |

统计：已完成 9 项；已实现-纯函数/契约（待接入）16 项；部分实现 3 项；进行中 2 项；未开始 6 项（13/14/20/26/28/31/34 中 6 项为未开始，另 1 项 26 亦未开始——按表逐项计：未开始=13、14、20、26、28、31、34 共 7 项）。合计 36 项。

> 说明（依规格 §45 要求）：表中“已完成”仅指有真实实现+测试或正式文档的条目；所有纯函数能力均标注“待接入”，不以静态演示冒充生产功能；未实现项不得标为完成。

---

## 6. 1.16.23 候选对 D 层影响面（只读核对）

### 6.1 主工作区候选状态（只读）

- 主工作区 `记账程序v1`：分支 `release/s16-1.16.05`，HEAD `335da77`（2026-10-26 14:37:59 +0800，docs: 修正指向本机未入库目录的链接，恢复 CI 文档检查）。
- 未提交候选（`git status --short` 16 项）：修改 12 个文件——`apps/web/src/components/FxDisplay.tsx`、`FxStats.tsx`、`apps/web/src/detail-motion.css`、`apps/web/src/i18n/resources/{en-US,zh-CN}/fx.ts`、`apps/web/src/lib/fxView.test.tsx`、`apps/web/src/pages/DetailPage.tsx`、`StatsPage.tsx`、`docs/00-索引.md`、`docs/STATUS.md`、`docs/changelog/1.16.md`、`packages/shared/src/version.ts`；未跟踪 4 项——统计页新增 lib 文件 2 个（`statsView` 实现与其测试，尚未提交入库）、设计文档《分析页面全面升级-现状审查与方案提案》与「分析页面审查素材」目录（均未跟踪）。
- `git diff --stat` = 12 files +125/−46；`version.ts`：`APP_VERSION` 1.16.21→1.16.23。
- 候选性质：FX/统计页 UI 修复 + 分析页面审查文档 + 版本号；**不含布局层、不含 s17-agents 目录**。

### 6.2 发布快照

- `记账程序v1-release-1.16.23-20261027` 的 `.git` 为悬空 gitfile（指向 `/sessions/...` 不存在路径），`git -C` 报 `fatal: not a git repository: (NULL)` → **是快照副本，不是可用 worktree**；其中无 `docs/specs/product/s17-agents`、无 `packages/shared/src/analysis/layout`；根 `package.json` version=0.1.0（工作区根）。
- 其 `docs/STATUS.md` 显示：最后核对 `207a5ad` / 2026-10-27 05:30 CST，**1.16.23 已上线**（部署 `207a5ad`、60 迁移、2026-10-27 05:28 CST），主工作区仍有未提交候选与 R4 头像 stash 等。

### 6.3 预计 rebase 冲突与性质

- D 分支相对 `486c603` 的 42 个文件**全部为新增**，未修改任何既有文件；`486c603` 是 `release/1.16.23` 的祖先（`git branch --contains` 已确认）。→ **预计 rebase 无文件级冲突**。
- 需 Lead 先完成前置：把主工作区未提交候选提交为 1.16.23 发布提交（或指定 rebase 目标 commit），再统一为各 Agent 分支 rebase；D 不自行 rebase。
- rebase 后 D 侧必跑：`pnpm.cmd --filter @libellum/shared typecheck`、`pnpm.cmd --filter @libellum/shared exec vitest run src/analysis/layout`、`node tools/check-links.mjs`、`node tools/doc-audit.mjs`、`node tools/check-status.mjs`。
- 风险点（低）：
  1. 主候选修改 `docs/STATUS.md`/`docs/00-索引.md`/`docs/changelog/1.16.md`，D 不修改这些文件 → 不冲突；但 D 文档中的链接若指向这些文件应保持相对路径稳定（现无依赖）。
  2. `packages/shared/src/version.ts` 由主候选改到 1.16.23，D 不修改 version.ts → 不冲突；doc-audit 的“版本号与代码一致”检查在 rebase 后需以新版本为准（D 文档不含硬编码版本号）。
  3. `packages/shared/src/index.ts`：主候选未修改，但 D 未来接入出口时会改动 → 与 W2/W3 的接入顺序需 Lead 协调（I-0）。

---

## 7. S-01 v2 中 D 契约条款复核（只读，2026-10-27）

- A 工作区 `记账程序v1-s17-a-finance`（git clean）最新日志：`6077d8d` 登记 B 评审提交号回填、`2f6c076` 登记 B 的 S-01 v2 评审意见、`281756c` 登记 D 评审提交号回填、`b82db18` 登记 D 的 S-01 v2 评审意见。
- **v2 结构草案内容未变**（仍 `s01-v2-draft`，未冻结；评审期间不改草案，Lead 汇总裁定后 A 一次性修订并出 `v2-draft-r1` 修订记录）。
- §6 布局侧引用契约三条（`AnalysisReference` draft v0.2、`ObjectSizeContract`、接口点：布局只消费 analysisId/params；S-01 不接收几何；布局 schemaVersion/layoutAlgorithmVersion 与 S-01 version 相互独立；分享只带引用与配置）。
- D 意见已登记：G-12a（白名单发布形态与版本化）、G-12b（未知/较新 analysisVersion 只读占位+提示更新+不回写不删未知字段）、G-12c（params 值约束与隐私黑名单）；X-01（合约一致性确认无冲突；`contractVersion?`/`maxSize?`/`aspectRatioHint?` 保持未实现）。§3 分歧 D-01 空；D-02/D-03 待所有者。**C 反馈未到**。
- 对 D 的结论：S-01 v2 对 D 契约**无新增/变化条款**；D 侧无需动作，等待 v2 冻结后再更新 `AnalysisReference` 正式版本（S-03 v0.3 引用仍有效）。

---

## 8. 未决与建议（给 Lead 汇总，供提交所有者）

| # | 事项 | 影响批次 | 建议 |
|---|---|---|---|
| 1 | 1.16.23 发布提交（主工作区候选仍未提交；release 快照 STATUS 称已上线 `207a5ad`） | 所有集成批次前置 | Lead 提交/确认 1.16.23 发布提交，明确 rebase 目标，统一为各分支 rebase |
| 2 | S-03 草案冻结（当前 v0.3 draft） | I-0/I-1 | Lead 组织 A/Codex 会签后冻结 v1 |
| 3 | S-01 v2 冻结（C 未反馈；G-12a/b/c 待裁定） | I-1/I-4 | Lead 汇总裁定后 A 出 `v2-draft-r1` |
| 4 | Codex 视觉规范（编辑器/网格/高亮/容器/入口/动画） | I-2/I-3/I-9 | 到位后 Lead 批准 D-2 UI |
| 5 | OQ-LM-03/04/05/06/07/08/09 | I-2/I-3/I-8 | W5 开工前所有者裁定（规格 §4.4/§4.5 已列建议起点） |
| 6 | OQ-CF-01/02/03/05/06/07/10 + B-6/B-21 | I-5/I-6/I-7 | W6 前所有者裁定 + 隐私合规闭合 |
| 7 | W3 卡片尺寸声明（`minSize`/`sizeLadder`/`compatSize`） | I-1/I-3 | A/B/C 于 W3 批 1 声明，原型/真机冻结 |
| 8 | W6 新增迁移与服务端同步批准 | I-6/I-7 | 按 AGENTS §5/§6 走评审+备份+所有者批准 |

---

## 9. 下一步（D 侧）

1. 等 Lead 汇总本预研给所有者；`I-0`（入口导出）可在 S-03 冻结后由 Lead/S-03 统一接入。
2. Codex 视觉规范到位后，按 Lead 批准范围进入 D-2 UI（编辑器视觉与交互）。
3. 继续按 W5/W6 批次推进；每批按规格 §43 更新完成项/测试/提交/接口/风险到任务文档 §5/§6.2 与对应记录文档。
4. 不主动 rebase、不接页面、不 push，直到 Lead 明确批准。

---

## 10. 证据与校验记录

- 分支/HEAD：`deepseek/s17-layout-engine` @ `49eb04a`；工作树 clean；相对基线 `486c603`：42 个新增文件、0 修改。
- 真实命令：`pnpm.cmd --filter @libellum/shared typecheck` → exit 0；`pnpm.cmd --filter @libellum/shared exec vitest run src/analysis/layout` → 17 files / 209 tests passed。
- 文档校验（本轮收尾时执行）：`node tools/check-links.mjs`、`node tools/doc-audit.mjs`、`node tools/check-status.mjs`。
- 只读核对来源：主工作区 `记账程序v1`、发布快照 `记账程序v1-release-1.16.23-20261027`、A 工作区 `记账程序v1-s17-a-finance`（S-01 v2 草案与评审汇总表）、本工作区代码与文档。
- 本预研未产生代码改动；本文件与任务文档 §5/§6.2/§2.2/§7 的记录随本轮本地提交入库（不 push）。
