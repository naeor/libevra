# S17 · Agent D 任务文档：模块化布局与用户配置

> 本文件是 **DS-S17-D-Layout** 的唯一权威任务文档。所有长期有效的职责、接口、进度、问题与交接必须写入本文件，不得只存在于聊天上下文。
> 建立：2026-10-27（Lead 初始化）；维护者：Agent D 自己。
> 当前状态：**所有者规格已归档；D-0 评审通过（条件性）；D-1 完成；D-2 前置完成（含 S-03 布局侧草案，Lead 评审通过）；D-3 headless 完成且 Lead 验收通过；D-4 前置 headless 完成且 Lead 验收通过（m00988）；D-5 只读预研完成（W5/W6 集成清单、永久文档 30 项与交付 36 项对照、1.16.23 影响面、S-01 v2 复核；17 files / 209 tests 通过），待 Lead 汇总；D-2 UI 等待 Codex 视觉规范**；已按 Lead 指令 rebase 到 1.16.23 基线 `d4e4fd8`（rebase 后 HEAD `7d9f9fc`，复验全绿，2026-10-27）；S-03 布局侧草案评审修订记录已整理（现累计至 draft v0.8，见 §2.2）；2026-10-27 已按所有者八项 OQ 方向完成核对：一致项（OQ-LM-04/06、OQ-CF-05 原则、OQ-CF-07 结构安全）落实为正式决定，部分/不符项列差异（OQ-LM-03/05、OQ-CF-01、OQ-LM-07 未覆盖原问题），见 [S17-Agent-D-OQ落实与差异清单-v1.md](./S17-Agent-D-OQ落实与差异清单-v1.md)；新增 [S17-Agent-D-布局与交互设计稿-v1.md](./S17-Agent-D-布局与交互设计稿-v1.md)（所有者 10 条交互方向，标注已决定/待确认）；无代码改动、未接页面；版本号由 Lead 在集成工作区统一升 1.17.1，本分支不改版本号。2026-10-27 完成 **S-01 v2 r4 的 D 正式冲突检查**（只读评审，🔴 3 / 🟡 5 / ✅ 9 组 / 🟢 5；结论：**有 3 项阻塞冻结**，均为 S-01 冻结稿文字/范围问题、不是 D 侧实现阻塞），见 [S-01 v2 冲突检查意见](./S17-Agent-D-S01-v2-冲突检查意见-20261027.md)；等 A r5 修订后 D 单点复核。2026-10-27 完成 **D-3.1 headless：独立档案与模式迁移引擎**（`profiles.ts` + G-12b 导入只读占位；真实 `typecheck` exit 0、`vitest` **18 files / 234 tests passed**；S-03 升 draft v0.5），仅 headless、未接 UI/页面/入口；所有者已书面裁定 D-V2-01/02/03 全部接受、D-V2-04～08 原则接受（分析结果缓存 vs 布局投影缓存区分、密度正式定义归 Codex、未知分析 ID/不兼容较新版保留+只读占位、G-12a 白名单需成为 A 的正式发布物）；A 最终修订到达后 D 只做针对性复核（等 Lead 清单）。2026-10-27 完成 **D-3.2 headless：容器数据模型/占位语义 + 跨列迁移固定案例**（`containers.ts` + `containers.test.ts` 19 项 + `migration-cases.test.ts` 12 项；真实 `typecheck` exit 0、`vitest` **20 files / 265 tests passed**；S-03 升 draft v0.6），仅 headless、未接 UI/页面/入口。2026-10-27 完成 **S-01 v2 r6 针对性复核**（只读）：按 D 相关 4 项逐条核对，**✅ 无 🔴、无阻塞 S-01 v2 冻结**（D-V2-01…08 无回退；G-12a 发布物 D 侧够用；§16.5 与 S-03 迁移契约不冲突；常量 #21–22/#23–24/#29 无交集）；4 条 🟡 澄清经 Lead 裁定采纳（`AN-B01` 大小写、校验层级用词、`pinnedRange`/`timeFixed` 单一来源 T-8、分享导入门）；Lead 批准 **S-03 v0.7 纯文档同步**（不改代码/契约），见 §2.2。2026-10-27 完成 **D-6 前置 headless：G-12a v1.1 params 白名单校验纯函数 + 分享导入门**（`params-validation.ts` 55 项（含 T-8 `timeFixed` 6 预设枚举）+ `import-pipeline.ts` 门与逐卡校验；真实 `typecheck` exit 0、`vitest` **21 files / 327 tests passed**；分享门仍关闭、等 Lead 放行），见 §2.2 与 D-6 记录文档；D-2 UI 仍等真实 Codex 视觉规范。**Lead 已验收 D-6（`d96f232`）并裁定：分享导入门在本 S-01 v2 冻结周期维持关闭**（未来放行需 A r7 表数据同步 + B/C 核对 + 集成导入真实接线/权限容量测试）。A r7 已发布（`9d82e81`/`76aa278`，仅文档）：**D 单点复核通过、无阻塞**（G-28a/G-27/G-30/#3 三层/σ-CV/未改 S-03 边界；详见 §6.2，2026-10-27）；**A 已补 G-12a v1.1（`782b036`，含 T-8 `timeFixed` 6 预设枚举）与 r7.2（`b39b27a`）；D 已按 Lead m02101 完成 T-8 表数据/用例同步（`params-validation.ts` 55 项、`vitest` 21 files/327 tests；只改表数据/用例、未改校验结构），S-03 升 draft v0.8（纯文档引用同步）**；分享门仍关闭。2026-10-27 **`s01-v2` 已冻结**（Lead m02293 验收 D 的 T-8 同步 `7ec7810`/`d25d28e`，D 进入**待命**）；待命期间只读产出 [S17-Agent-D-D2-集成前检查清单-v1.md](./S17-Agent-D-D2-集成前检查清单-v1.md)（导出面/权限/容量/回退路径；**I-0 未启动**、未改代码/契约/包入口）；D-2 UI 等真实 Codex 视觉规范，**I-0 已按 Lead m02293 完成（2026-10-27）**：`packages/shared/src/index.ts` 新增 S17 布局层 **10 组精选具名导出**（additive、显式 `export type`、约 214 个公开符号；**未使用 `export *` 全量并入**）+ 静态守卫测试 `packages/shared/src/analysis/layout/export-surface.test.ts`（8 项：入口段/无 `export *`/248 标识符重名=0/内部符号不泄漏/精选函数同源/`import type`/生产模块无 I/O-DOM-时钟-随机/投影不写回）；真实 `typecheck` exit 0、shared 全量 `vitest` **40 files / 711 tests passed**、`pnpm check:build` exit 0；未 push、未改 S-01/S-03 契约、未加迁移/页面/API。回退=单提交 revert `index.ts`。

> 2026-10-27 完成 **I-1 待命期只读交叉核对**（Lead m02502）：新增 [S17-Agent-D-I1-集成契约映射-v1.md](./S17-Agent-D-I1-集成契约映射-v1.md)——（a）D/C/A 三方类型可组合性三分法（6 条直接可用、4 条需适配器、4 条缺口登记）；（b）I-1 最小接线顺序（I-1a 纯数据链路可立即启动，I-1b 等 A 信封落地 + Codex，I-1c/1d/1e 依次）；（c）不变量核对结论「无冲突」（I-0 静态守卫、C 唯一读取入口/无部分输出、A `partial` 语义一致，仅 C `ok:false` 与 A `completeness` 双轨表达由适配器统一）。只读：未改 A/B/C/D 代码或契约、未接包入口/页面、未 push。

> 2026-10-27 完成 **I-1a 集成胶水层**（Lead m02598 批准执行）：新建 `packages/shared/src/workbench/pipeline.ts` + `pipeline.test.ts`（本地夹具 21 项，覆盖 `AnalysisReference`→`validateAnalysisParams`→`projectLayout`→文档 serialize/parse/roundTrip 全链路）；真实 `typecheck` exit 0、shared 全量 `vitest` **41 files / 732 tests passed**；未接包入口/页面/路由/API、未改 `analysis/**`、未 push。**方向补充（所有者 m11382，Lead m02654）**：最终工作台 UI 由 **Claude** 在现有分析 Tab 内实现（不再等 Codex Demo）；**D 的布局引擎是唯一实现**，Claude 通过 [I-1 集成契约映射](./S17-Agent-D-I1-集成契约映射-v1.md) 消费布局文档/投影；**D-2 阻塞条件改为「等 Claude 视觉/适配要求 + Lead 验收」**（原「等 Codex 视觉规范」失效，Codex 材料仅历史参考）；I-1b 起含 C draft→A 信封适配；最小集成验收=真实分析 Tab + D 布局能力 + 至少一张 A/B/C 真实数据链路卡片（首选 B 移动平均卡）。

---

## 1. Agent 身份

| 项 | 值 |
|---|---|
| 名称 | `DS-S17-D-Layout` |
| 角色 | S17 模块化布局与用户配置负责人（网格、模板、容器、编辑、配置与分享设计） |
| 工作区 | `C:\Users\ZhuanZ（无密码）\Desktop\工作\记账程序\记账程序v1-s17-d-layout` |
| Git 分支 | `deepseek/s17-layout-engine` |
| 基线 | `d4e4fd8`（`release/1.16.23`，1.16.23 生产版；2026-10-27 已按 Lead 指令 rebase，备份分支 `backup/agent-d-pre-1.16.23-20261027` → `932d4d1`） |
| 负责模块 | 工作台基础网格、行优先格子编号、卡片跨列迁移、占格与尺寸约束、自动补位/碰撞、Spacer、自由分割与滑动抽屉格式模板、1×1 保底收缩、正常/布局编辑模式、拖动吸附与尺寸调整、统一/独立布局、个人配置数据结构、本地优先+服务端同步设计、布局导出/分享/导入设计、算法与配置迁移测试 |
| 不负责 | **财务计算函数与专业图表绘制**（A/B/C）；视觉设计规范（Codex）；财务数据语义；生产发布 |
| 上级协调 | Lead（`lead`）；不得直接指挥/修改其他 Agent |

### 工作区纪律（硬约束）

- 只在自己分支与工作区写代码/文档；不得 reset/clean/删除/覆盖他人 worktree（含主工作区未提交的 1.16.23 候选与 Claude 文档工作区，见索引 §1.3）。
- 不合并 main、不 push、不部署、不操作生产环境；未经批准不新增迁移/不改业务数据库。
- **本阶段主要开发归属是 S17-W5/W6，但布局数据结构约束需在 W2 提前确定**（供 A/B/C 卡片尺寸语义使用）。
- 公共接口未评审前不得冻结；接口变化登记本文件 §6 并告知 Lead。

---

## 2. 任务范围

### 2.1 负责的能力（所有者第二轮提供布局/配置能力清单；不涉及财务分析编号）

- S17-W2：布局数据结构约束（网格、占格、最小尺寸、跨列迁移规则、稳定 ID、Spacer 契约、配置 schema 雏形）与对应测试。
- S17-W5：工作台基础网格、行优先格子编号、卡片占格与尺寸约束、自动补位与碰撞处理、Spacer 空白占位、自由分割格式模板、滑动抽屉格式模板、容器 1×1 保底收缩形态、正常模式与布局编辑模式、拖动/吸附/尺寸调整、统一布局与独立布局模式。
- S17-W6：个人配置数据结构、本地优先与服务端同步设计、布局导出/分享/导入设计、配置迁移测试。
- 状态统一为：**等待详细需求**；具体形态以所有者在第二轮提供的清单与规格为准（现行规格见 Claude 文档工作区，见索引 §1.2）。

### 2.2 预期实现与函数（登记，待详细需求细化）

- 网格模型：`row-major` 格子编号（从 1 起，自上而下再自左而右）、稳定卡片 ID、占格 `宽×高`、基准列数、位置=左上角格子编号。
- 布局操作：放置/移动/跨列/尺寸调整；碰撞检测与自动补位；不可见/被遮挡时的降级；确定性垂直压缩。
- Spacer：空白占位对象（不可放数据、可参与布局编辑）。
- 模板：自由分割（GridSplit）与滑动抽屉（Sliding Drawer）容器；首版不嵌套；容器必须具备 1×1 保底收缩形态。
- 模式：正常模式与布局编辑模式严格分离（编辑模式不触发财务交互）。
- 配置：内容（卡片清单/参数）与几何（布局）分开的文档结构，各自带版本号与稳定 ID；迁移/降级规则；跨设备（共同内容 + 自动布局迁移 + 可选独立档案）。
- 分享：导出/导入与短分享码的设计（合法性校验、权限、隐私合规评审）；服务端同步的存储模型设计（若需要迁移，由所有者批准）。
- 测试：布局算法（碰撞/补位/收缩/迁移）与配置迁移的单元/属性测试；跨分辨率/横屏/平板/桌面适配的回归（与 S18 边界另行确认）。
- **D-0 交付物（2026-10-27）**：`packages/shared/src/analysis/layout/` 的类型/网格/投影纯函数 + 单元测试，以及 [S17-Agent-D-D0-布局数据模型与接口-v1.md](./S17-Agent-D-D0-布局数据模型与接口-v1.md)（数据模型、编号与几何、迁移阶段、尺寸契约、接口清单、待决登记）。代码尚未从 `@libellum/shared` 入口导出，接入属集成批次。
- **D-1 交付物（2026-10-27）**：同一目录新增 `validation.ts`（文档校验/序列化/解析）、`test-prng.ts`/`test-support.ts`（测试专用 PRNG 与夹具构造器），新增 `property.test.ts`（4 组×2,600 = 10,400 场景）、`fixtures.test.ts`（TC-07…26 中不依赖 UI 的夹具）、`serialization.test.ts`；修复投影 `findEarliestFreeAnchor` 行尾起点越界崩溃。记录与口径见 [S17-Agent-D-D1-布局引擎测试与文档校验-v1.md](./S17-Agent-D-D1-布局引擎测试与文档校验-v1.md)。
- **D-2 前置交付物（2026-10-27，Lead 批准范围：不依赖 Codex 视觉规范的部分）**：
  - 同一目录新增 `commands.ts`（headless 编辑器状态、`applyCommand` 命令集与撤销栈）、`focus.ts`（焦点导航与键盘映射）、`machine.ts`（浏览/编辑状态机），及对应单元测试；目录 barrel 追加三个模块（**仍未接** `@libellum/shared` 包入口）。
  - [S17-Agent-D-D2-前置-交互模型与状态机草案-v1.md](./S17-Agent-D-D2-前置-交互模型与状态机草案-v1.md)：模式与入口、编辑会话生命周期、命令表与失败码、焦点/键盘映射、拖拽与键盘并行、触摸 vs 鼠标、无障碍清单、待决项。
  - [S17-Agent-D-S03-接口草案-布局侧-v1.md](./S17-Agent-D-S03-接口草案-布局侧-v1.md)：**draft v0.8，未冻结**（初版 v0.3；评审修订与后续实现记录见 §8/§9）；Lead 六问裁定记录见 §8，OQ-LM-01/03/04/05/06/07 待决项逐条登记见 §8.2（2026-10-27 评审修订记录整理；裁定针对 v0.1，现内容累计 v0.2/v0.3，性质仍为 draft）；裁定要点：接受两类型为 draft、尺寸 W3 声明并在原型/真机冻结、暂不拆 `ContainerGeometryContract`、迁移签名纳入契约而缓存键仅实现约定、容器内部几何归内容文档、未知 `analysisId` 只读占位、OQ-LM-01 锁定 size-first。
- **D-3 headless 交付物（2026-10-27，Lead 批准范围：不依赖 Codex 视觉）**：
  - 同一目录新增 `compaction.ts`（垂直紧凑纯函数；默认不启用）、`repair.ts`（几何确定性修复与 `GEOMETRY_REPAIR_ORDER`）；`projection.ts` 接入可选 `ProjectOptions.verticalCompact`（默认 `false`）；`types.ts` 增该开关并锁定 size-first 注释。
  - 新增 `migration.test.ts`（18 项：3→4/4→3、列数矩阵、容器、Spacer、多跳无漂移、冲突贪心、非法输入）、`compaction.test.ts`（8 项含 800 场景属性测试）、`repair.test.ts`（10 项）、`container.test.ts`（12 项：折叠↔展开、expandedSize、撤销/重做、投影形态）。
  - [S17-Agent-D-D3-跨列迁移-修复顺序-容器语义-v1.md](./S17-Agent-D-D3-跨列迁移-修复顺序-容器语义-v1.md)：迁移矩阵、修复顺序与失败码、Spacer/紧凑边界、容器语义、测试结果、偏差与待决。
- **D-4 前置交付物（2026-10-27，Lead 批准范围：不依赖 Codex 视觉/隐私裁决的部分）**：
  - 同一目录新增 `document-io.ts`（加载/回退/往返一致性）、`migration-chain.ts`（五种迁移状态、迁移链、缓存键派生）、`share-snapshot.ts`（分享快照白名单构建/校验/解析、短码纯函数）、`import-pipeline.ts`（导入端到端校验管道：ID 重生成→修复→校验→待绑定→预览）、`storage-contract.ts`（本地记录结构、布局/内容合并纯函数、同步接口占位），及对应 5 个测试文件（59 项）；目录 barrel 追加五模块（**仍未接** `@libellum/shared` 包入口）。
  - [S17-Agent-D-D4-前置-文档IO-迁移链-导入-存储契约-v1.md](./S17-Agent-D-D4-前置-文档IO-迁移链-导入-存储契约-v1.md)：IO/迁移/分享/导入/存储契约、失败码、测试矩阵、偏差与待决。
  - S-03 布局侧接口草案同步升级 **draft v0.3**（此后随 D-3.1/D-3.2/r6 复核累计至 v0.8，见后续条目；迁移签名已落地、缓存键仍为实现约定、仍不冻结）。
- **D-5 只读预研交付物（2026-10-27，Lead 批准范围：只读核对，不改代码/不 rebase/不接页面/不 push）**：
  - [S17-Agent-D-D5-只读预研-W5W6集成与规格对照-v1.md](./S17-Agent-D-D5-只读预研-W5W6集成与规格对照-v1.md)：W5/W6 集成批次与接入点（10 批次 I-0…I-10，含依赖/风险分级/建议顺序）、规格 §43 永久文档 30 项与 §45 最终交付清单 36 项逐项对照（状态+证据）、1.16.23 候选影响面（主工作区未提交候选、发布快照、预计 rebase 冲突为零）、S-01 v2 中 D 契约条款复核（无变化，G-12a/b/c 与 X-01 已登记）。
  - 结论：D 层 headless 纯函数已覆盖规划的大部分算法与文档能力，尚未接包入口/页面/存储；前 3 个集成批次（入口导出、只读工作台、编辑模式 UI）不依赖未决 OQ，后 3 个依赖所有者裁定/Codex 视觉/W6 批准。
- **OQ 落实与交互设计（2026-10-27，文档，Lead 任务 m01207；不改代码/不接页面）**：
  - [S17-Agent-D-OQ落实与差异清单-v1.md](./S17-Agent-D-OQ落实与差异清单-v1.md)：把所有者八项产品方向逐条对照原始 OQ 定义与候选——OQ-LM-04/06 一致并落实为正式决定（D-OQ-04/06）；OQ-LM-03/05 部分落实（内容约束/展开入口/内部编辑等）并保留差异（DIFF-01/02）；OQ-CF-05 原则落实、实现待数据模型批准；OQ-CF-07 白名单与结构安全落实、审核流程仍待所有者；OQ-LM-07 方向与原始问题语义不符，不裁定（DIFF-03）；OQ-CF-01 布局文档合并粒度与“避免整份覆盖”冲突（DIFF-04）。含 7 项差异清单与证据行号。
  - [S17-Agent-D-布局与交互设计稿-v1.md](./S17-Agent-D-布局与交互设计稿-v1.md)：按所有者 10 条交互方向建立 D 侧设计稿——B/F/E 三态 + C 容器内部子作用域、10 条逐项决定等级、编辑规则（拖放预览/合法高亮/非法不静默丢/触控替代/撤销/保存取消）、容器与手势优先级、D 引擎接口差距（待扩展命令清单）、待所有者确认清单、Codex 工作区只读参考消化要点（S-01 快照≠布局合同、S-02 展示合同 v0.1、第一轮预览边界、集成条件）。
- **S-01 v2 正式冲突检查意见（2026-10-27，Lead 加急只读任务 m01311）**：
  - [S17-Agent-D-S01-v2-冲突检查意见-20261027.md](./S17-Agent-D-S01-v2-冲突检查意见-20261027.md)：对 A 的 `S01-v2-结构草案` r4（A worktree HEAD `4939efd`）做 D 侧四项检查（S-03 布局契约 / 结果形状使用 / OQ-LM 口径 / D 六问覆盖），输出 **🔴 3**（D-V2-01 §2 桶级 `completeness` 与 §4.10/B-V2-04 自相矛盾、D-V2-02 §6 布局契约与 S-03 权威/冻结范围重叠、D-V2-03 G-13「三档密度/最小尺寸」进 S-01 冻结门槛）、**🟡 5**（缓存键域、`CARD_DENSITY_THRESHOLDS` 归属、§6.1 缺 `analysisVersion` 规则、S-03 版本引用过期、G-12a 发布形态）、**✅ 9 组**、**🟢 5 项 D 侧待办**；结论「有 3 项阻塞冻结，均为 S-01 冻结稿文字/范围问题，不是 D 侧实现阻塞」。只读 A 工作区，未改 A 分支/A 代码/版本号，未 push。

- **D-3.1 headless 交付物（2026-10-27，Lead 批准继续 D-3 范围）**：
  - 同一目录新增 `profiles.ts`（统一/独立档案解析 `resolveProfile`、写时复制物化 `materializeProfile`、模式切换 `switchLayoutMode`、采纳档案 `adoptProfileAsMain`、未放置诊断 `findUnplacedContentObjects`；`cols-<n>` 档案键占位、宽度档表为空不猜阈值）、`profiles.test.ts`（22 项，含 300 场景属性测试）；`import-pipeline.ts` 增加 G-12b `resolveAnalysisVersion` 与 `analysis-version-readonly` 只读占位（`import-pipeline.test.ts` +3 项）；目录 barrel 追加 profiles（**仍未接** `@libellum/shared` 包入口）。
  - [S17-Agent-D-D3-1-独立档案与模式迁移引擎-v1.md](./S17-Agent-D-D3-1-独立档案与模式迁移引擎-v1.md)：模式/解析语义、写时复制、切换与采纳、档案键占位、G-12b、测试证据、占位与未决登记、偏差与下一步。
  - S-03 布局侧接口草案升 **draft v0.5**（新增 §4.5 独立档案与模式迁移契约、§9 v0.5 变更行；仍不冻结）。

- **D-3.2 headless 交付物（2026-10-27，Lead 批准继续 D-3 范围：跨列迁移/容器模型）**：
  - 同一目录新增 `containers.ts`：GridSplit 千分比归一化与槽位语义、容器子树结构校验失败码（数量/重复/引用/嵌套）、展示形态派生 `deriveContainerDisplay`（full/compact/collapsed + 原因）、1×1 折叠↔恢复纯数据函数（`collapseContainerGeometry`/`restoreContainerGeometry`，幂等、保留 `expandedSize`）；不做视觉与容器内编辑。
  - 新增 `containers.test.ts`（19 项：比例/槽位/结构校验/形态派生/折叠恢复/200 场景属性测试）、`migration-cases.test.ts`（12 项：所有者固定案例 3→4/4→3、3→2、冲突贪心、非法锚点/行跨超限、尺寸降级、容器完整/收缩、Spacer 夹宽、无漂移）；目录 barrel 追加 containers（**仍未接** `@libellum/shared` 包入口）。
  - [S17-Agent-D-D3-2-容器数据模型与迁移固定案例-v1.md](./S17-Agent-D-D3-2-容器数据模型与迁移固定案例-v1.md)：数据模型、占位/恢复语义、迁移固定案例回归表、测试证据、占位与未决、偏差与下一步。
  - S-03 布局侧接口草案升 **draft v0.6**（§5 补 D-3.2 数据模型落地说明、§9 追加 v0.6 变更行；仍不冻结）。

- **S-01 v2 r6 针对性复核（2026-10-27，只读，Lead 加急）**：对 A r6（HEAD `edc626c`）按 D 相关 4 项逐条核对——①D-V2-01…08 无回退/无新增冲突（✅）；②G-12a params 发布物 D 侧够用且无契约冲突（✅，4 条 🟡 澄清：`analysisId` 大小写、校验层级用词、`pinnedRange`/`timeFixed` 双入口、分享门未登记）；③§16.5 版本/迁移与 S-03 契约不冲突（✅，建议补 2 条边界注）；④常量 #21–22/#23–24/#29 与 S-03 无交集（✅，无需契约升版）。结论「**D 侧无阻塞 S-01 v2 冻结**」；Lead 已接受并裁定 4 条 🟡（统一 `AN-B01`、措辞「D 在内容文档层实现纯函数校验；布局层只引用/只读占位」、绝对区间走 `pinnedRange` 且 T-8 由 A r7 微调、S-03 §7 与 D-4 补分享导入门）。
- **S-03 v0.7 纯文档同步（2026-10-27，Lead 批准；不改代码/契约）**：[S-03 文档](./S17-Agent-D-S03-接口草案-布局侧-v1.md) 升 **draft v0.7**：§2 `analysisId` 示例统一 `AN-B01`（大小写敏感、以目录发布字面为准）；§2/§7 登记 G-12a v1 为 D 校验输入与 `shareImportAllowed=false` 导入门；§2 绝对区间走卡片级 `pinnedRange`、`params.timeFixed` 仅相对/预设语义（T-8）；§4 补「分析协议版本/迁移归 S-01」「G-12a 版本化以 A 发布物为准」两条边界注；header 状态修正为 DRAFT v0.7；D-4 文档补集成导入门登记。

- **D-6 前置 headless 交付物（2026-10-27，Lead 批准继续 headless 批次 m01813；避开 UI/Codex 视觉）**：
  - 本批范围（开工前后登记）：实现 G-12a v1.1 `AnalysisReference.params` 白名单校验纯函数（26 个 analysisId 白名单、通用键/值/范围/互斥、隐私黑名单、9 错误码、未知/较新版本只读占位；**T-8：`timeFixed` 6 预设枚举、绝对区间只走卡片级 `pinnedRange`**）并逐条覆盖 G-12a §8 的 35 条测试（含 v1.1 新增 #31–35）；在分享导入管道实现 `shareImportAllowed` 门（关闭时 `share_import_closed` 直接拒绝、不解析客户端输入；放行后仍走同一校验）；文档与任务文档状态清理。
  - 本批不做：不接包入口/页面/路由/API、不加迁移、不改 S-01/S-03 已定契约、不实现 UI 提示文案/i18n、不实现账本存在性/权限查询（由查询层执行）、不实现放行开关管理、不改版本号。
  - 同一目录新增 `params-validation.ts`（常量/9 错误码/状态机/26 项表/隐私黑名单/严格 `allowLongRange`/版本保守等值比较/`validateAnalysisParams`/`checkShareImportGate`）与 `params-validation.test.ts`（55 项）；`import-pipeline.ts` 增必填 `shareImportAllowed`、`currentAnalysisVersion?`、`knownAnalysisIds?`，开头门拒绝 + 逐卡 params 校验（`invalid` 失败、`readonly` 仅提示，G-12b 已覆盖的版本差异不重复报告），`import-pipeline.test.ts` 重写为 23 项；目录 barrel 追加 params-validation（**仍未接** `@libellum/shared` 包入口）。
  - [S17-Agent-D-D6-前置-G12a参数白名单校验与分享导入门-v1.md](./S17-Agent-D-D6-前置-G12a参数白名单校验与分享导入门-v1.md)：API/状态机、白名单与约束、错误码、导入门、测试证据、与 S-01/S-03 契约关系、占位与未决（G-15 版本排序、T-8、账本权限、放行、G-12a 表变更同步、UI 文案）、偏差与下一步。

- **G-12a v1.1（T-8）表数据/用例同步（2026-10-27，Lead m02101；A 提交 `782b036` v1.1 / `b39b27a` r7.2）**：
  - 只改 `params-validation.ts` 表数据/用例、**不改校验器结构/签名/返回类型**：`timeFixed` 由 `{from,to}` 对象改为 6 个预设枚举（`this-month`/`last-month`/`this-year`/`last-year`/`last-3-months`/`last-6-months`，相对 `today` 解析、日历对齐）；旧绝对日期对象一律拒绝（`params_type`），绝对区间只走卡片级 `pinnedRange`；嵌套对象规则收紧（`timeFixed` 对象→`params_type`、其他对象→`params_private_data`）；`allowLongRange` 仅相对区间 >400 天有效。
  - `params-validation.test.ts` 51→55 项（#19/#20 改预设通过，新增 #31–35：旧绝对对象/逆序对象/枚举外→`params_type`、timeFixed+timePreset→`params_conflict`、timeFixed+allowLongRange→`params_out_of_range`）。
  - 真实 `typecheck` exit 0；`vitest` **21 files / 327 tests passed**；S-03 升 **draft v0.8**（纯文档引用同步，不改契约）；D-6 记录文档同步更新（§10 T-8 同步记录）。

- **D-2 集成前检查清单（2026-10-27 待命期间只读准备，Lead m02293 允许）**：[S17-Agent-D-D2-集成前检查清单-v1.md](./S17-Agent-D-D2-集成前检查清单-v1.md)——基线快照（布局目录 41 文件、21 测试文件、327 tests、`typecheck` exit 0）、导出面检查（目录 barrel 17 个 `export *`、248 个导出标识符、候选名冲突 0、建议最小导出面与 I-0 不变量）、权限检查、容量检查、回退路径、待确认与不启动声明；**不启动 I-0**，不改代码/契约/包入口。

- **I-0 包入口精选导出 + 静态守卫（2026-10-27，Lead m02293 批准）**：
  - `packages/shared/src/index.ts` 在 `fxHistory` 导出后追加 `// ---- S17 工作台布局层（Agent D · I-0 …）` 段与 **10 组精选具名导出**（`export { ... }` / `export type { ... }`）：文档模型与常量、尺寸契约/投影类型、网格与投影函数、文档 IO 与校验、迁移链、独立档案、容器/紧凑/修复、编辑器命令/焦点/状态机、G-12a params 校验、分享快照/导入管道/存储合并契约；约 214 个公开符号，低层辅助与测试符号不导出、不泄漏。
  - 新增 `packages/shared/src/analysis/layout/export-surface.test.ts`（8 项静态守卫）：入口含 layout 精选段且无 `export *` 全量并入；布局 248 个标识符与既有 shared 导出重名=0、reserved word=0；内部符号不在包入口；21 个精选函数与目录 barrel 同源 + 关键常量；导出类型可 `import type`；生产模块（17 个）无 I/O/DOM/网络/时钟/随机/框架依赖、不反向 import 包入口；投影不写回权威布局且确定性。
  - 验证：真实 `typecheck` exit 0；shared 全量 `vitest` **40 files / 711 tests passed**；`pnpm check:build` exit 0（真实 web 构建通过）；未 push、未改布局源文件/S-01/S-03 契约、未加迁移/页面/API、不改版本号。回退=单提交 revert `packages/shared/src/index.ts`。

- **I-1 集成契约映射（2026-10-27 待命期只读交叉核对，Lead m02502）**：[S17-Agent-D-I1-集成契约映射-v1.md](./S17-Agent-D-I1-集成契约映射-v1.md)（1–2 页）：
  - §2 类型可组合性：**直接可用 6 条**（引用链、布局投影、尺寸契约、持久化、缓存键分工、G-12a 校验）；**需适配器 4 条**（C draft `ok` 判别联合→A 扁平信封、记录级/观测级数据通道、`objectId` 实例身份约定、`AnalysisReference`→`AnalysisDefinition` 参数解析归计算层）；**缺口 4 条**（G-1 冻结信封 `version` 串与头部不一致 + Lead 消息提到的 `ok`/`data`/`calculation` 字段在冻结文本中不存在；G-2 A 代码常量仍 `s01-draft`；G-3 C 的 `fxProjection`/`draftTypes` 未进包入口；G-4 记录级来源通道缺失）——只登记不实现。
  - §3 I-1 最小接线顺序：**I-1a**（`AnalysisReference`→`validateAnalysisParams`→`projectLayout`→文档序列化/往返/校验，纯数据、无查询无 UI，**可立即启动、不依赖 Codex/OQ**）→ **I-1b**（信封接线，等 G-1/G-2 收口 + C 适配 + Codex S-02）→ **I-1c**（FX P17–P20 卡片）→ **I-1d**（编辑/容器 1×1/详情 UI，等 Codex + OQ-LM-05/06/07）→ **I-1e**（分享/同步，最后）。
  - §4 不变量核对：**无冲突**——I-0 静态守卫与 C 纯函数/注入式 rangeGuard 一致；C 唯一读取入口/无部分输出与 A `completeness`/`unavailableReason` 语义一致（双轨表达由 A-1 适配器统一，D 不实现）；A `partial`（整结果层 9 态）与 C `DraftFxCompleteness.partial`（P17/P19/P20 missingCount>0）映射规则 G-27 已定。
  - 边界：只读 A/B/C 工作区（A `6f72f9f`、B `78b9d05`、C `a1f792f`），未改任何代码/契约、未接包入口/页面、未 push。

- **I-1a 集成胶水层（2026-10-27，Lead m02598 批准；纯数据链路，无查询无 UI）**：
  - 新建 `packages/shared/src/workbench/pipeline.ts`：`runLayoutPipeline(input, options)` 把「`AnalysisReference`→`validateAnalysisParams`→`projectLayout`→文档 serialize/parse/validate/roundTrip」串成纯函数管道。步骤：文档加载（JSON 字符串→D-1 parser；对象→validator；错误路径加 `content.`/`layout.` 前缀）→ 逐卡分析引用校验（`invalid`→error；`readonly`→warning `pipeline-readonly-analysis`）→ 跨文档一致性（重复布局对象 / spacer 与内容同 ID / 孤儿 / 类型不一致 / 内容未放置 warning）→ 目标列数 1–12 校验 → `projectLayout(layout.main, content, …)` → 双文档序列化与 roundTrip；`ok=无 error`、输入不修改、不写回。
  - 新建 `pipeline.test.ts`（21 项，本地夹具，不依赖 `analysis/layout/test-support`）：合法链路/文档往返/输入不变/确定性/JSON 输入/空文档；内容/布局文档非法（路径前缀）与损坏 JSON；非法 params/未知 analysisId/较新版本/白名单外键；孤儿、spacer 同 ID、类型不一致、未放置 warning、GridSplit 容器投影；目标列数非法（error 且安全 2 列投影）、跨列 2/3/4 稳定、独立模式 `profiles` 序列化保留。**21/21 通过**。
  - 验证：真实 `pnpm.cmd --filter @libellum/shared typecheck` exit 0；shared 全量 `vitest` **41 files / 732 tests passed**；`pnpm.cmd -r exec tsc -b` 仅 `apps/api` 因未生成 Prisma client（`apps/api/src/generated` 不存在）与既有测试隐式 any 失败（与本批无关；`--filter @libellum/shared exec tsc -b` exit 0）。
  - 边界：未改 `packages/shared/src/index.ts` 顶层公开面、未改 `analysis/**` 既有文件/契约、未接 `apps/web`/路由/API/迁移、未 push。回退=删除 `packages/shared/src/workbench/`（或单提交 revert）。
  - 方向补充（所有者 m11382，Lead m02654）：最终工作台 UI 由 Claude 接管、D-2 不再等 Codex 视觉；**D-2 阻塞条件改为「等 Claude 视觉/适配要求 + Lead 验收」**；布局引擎唯一实现=Agent D，Claude 通过 I-1 文档消费布局能力；I-1b 起含 C draft→A 信封适配。

### 2.3 不负责（明确）

- 不实现任何财务计算函数或图表绘制（金额、统计、趋势、汇率折算等均由 A/B/C 负责）。
- 分析卡片与容器必须保持独立：布局只能组织和展示卡片，不得在布局层隐式计算或修改财务语义。
- 不得修改账务数据；任何布局操作不得写业务表。

### 2.4 依赖接口

- S-03 卡片注册与 AnalysisDefinition 协议：与 Lead、A、Claude（工作台 UI 实现方）对齐；D 提供尺寸/布局侧契约。
- 需要 A/B/C 提供卡片的“最小尺寸/推荐尺寸/内容密度”声明；D 不替他们定义财务内容。
- 视觉规范（所有者 m11382 / Lead m02654 更新）：最终工作台 UI 由 **Claude** 接管，视觉规范改为 **Claude 正式页面视觉 + 卡片适配要求**（不再等 Codex Demo；Codex 材料仅历史参考）；D 不自创视觉体系，且 D 的布局引擎是唯一实现——Claude 通过 I-1 集成契约映射文档消费布局文档/投影。
- 个人配置存储：本地优先（现有 IndexedDB/持久化风格）→ 服务端同步方案需所有者批准；隐私与合规（OQ privacy gate）。
- 分享短码：需要随机、不可枚举、限流与失效策略；禁止泄露账务数据。

### 2.5 测试范围

- 网格算法：行优先编号、占格冲突、自动补位、跨列迁移、1×1 收缩、Spacer 参与、确定性压缩。
- 配置迁移：旧结构 → 新结构的升级/降级、未知字段处理、损坏配置降级不崩页。
- 编辑模式：拖动/吸附/尺寸调整的边界；编辑不触发财务交互；取消恢复。
- 跨设备：共同内容 + 自动布局迁移；独立档案不互串。
- 分享/导入：非法/超限/恶意数据校验；权限不越界；不泄露账务数据。
- 不得以 UI 截图替代布局算法的确定性测试。

---

## 3. 输入与输出协议（待统一确认）

> **本轮未冻结任何公共接口。** 以下为登记，最终以 S-03/统一评审为准。

- 输入（预期）：卡片清单（含最小/推荐尺寸）、布局配置文档（版本化）、设备真实尺寸、编辑操作；不得直接读账务数据内容。
- 输出（预期）：布局结果（卡片 ID → 占格/位置/尺寸/可见性）、Spacer 列表、容器模板实例；不改变卡片内部数据。
- 配置文档：内容与几何分离、版本化、稳定 ID、迁移函数纯函数化（可测试）。
- 尺寸语义由 D 提供给 A/B/C；A/B/C 卡片必须在给定真实尺寸下保持金额一致。

---

## 4. 财务与安全限制（所有 Agent 共同遵守）

- 不改原始账务数据；布局操作不得修改账务数据。
- 不更改已有财务计算语义。
- 不直接混加不同货币（本 Agent 不涉及金额计算，但不得以布局/汇总方式隐式混加）。
- 不绕过账本权限；不读取/展示无权限账本内容。
- 不把缺失数据视为零。
- 不因为显示尺寸影响金额。
- 不修改其他用户的个人配置；分享不得泄露他人数据。

---

## 5. 持续进度记录

| 能力组 | 状态 | 备注 |
|---|---|---|
| W2 布局数据结构约束 | D-0 首提交完成，Lead 评审通过（条件性）；D-1 完成（属性测试/夹具/序列化/损坏配置）；D-2 前置完成（交互模型/状态机草案 + S-03 布局侧草案 + 编辑器命令/焦点/状态机，Lead 评审通过）；D-3 headless 完成且 Lead 验收通过；**D-4 前置 headless 完成且 Lead 验收通过（m00988）**；**D-5 只读预研完成，待 Lead 汇总（集成清单/30+36 项对照/1.16.23 影响面/S-01 v2 复核）**；**D-6 前置 headless 完成并 Lead 验收（G-12a v1.1 params 白名单校验 + 分享导入门，21 files/327 tests；T-8 已落）** | 真实 `typecheck` exit 0；`vitest run src/analysis/layout` **21 files / 327 tests passed**（含 10,400 属性场景、编辑逻辑、D-3 迁移/修复/紧凑/容器、D-4 文档 IO/迁移链/分享/导入/合并）；尺寸数值与 OQ-LM 仍待上游；D-2 UI 待 Codex 视觉；1.16.23 已发布（`release/1.16.23` @ `d4e4fd8`），Lead 指令 D-5 提交后 rebase；2026-10-27 所有者八项 OQ 方向核对完成（OQ-LM-04/06 等落实为正式决定；OQ-LM-03/05 部分落实；OQ-LM-07 方向未覆盖原问题；差异 7 项见 [OQ 落实与差异清单](./S17-Agent-D-OQ落实与差异清单-v1.md)），新增 [布局与交互设计稿](./S17-Agent-D-布局与交互设计稿-v1.md)（10 条交互方向），仅文档未改代码；2026-10-27 D-3.1 独立档案/模式迁移引擎完成（`profiles.ts` 22 项 + G-12b 3 项；18 files / 234 tests；S-03 draft v0.5）；2026-10-27 D-3.2 容器数据模型/占位语义与迁移固定案例完成（`containers.ts` 19 项 + `migration-cases.test.ts` 12 项；20 files / 265 tests；S-03 draft v0.6）；2026-10-27 S-01 v2 r6 针对性复核（只读，D 侧无阻塞）+ S-03 v0.7 纯文档同步（不改代码/契约）；2026-10-27 D-6 G-12a v1 params 白名单校验纯函数 + 分享导入门实现（`params-validation.ts` 51 项 + `import-pipeline.ts` 门与逐卡校验；21 files / 323 tests；仍未接包入口、分享门不放行、不改 S-01/S-03 契约）；Lead 验收 D-6（`d96f232`）并裁定分享导入门本冻结周期维持关闭；2026-10-27 A 发布 G-12a v1.1（T-8）与 r7.2，D 完成 T-8 表数据/用例同步（`params-validation.ts` 55 项、21 files / 327 tests；只改表数据/用例、不改校验结构；S-03 升 draft v0.8）；**I-0 完成（2026-10-27，Lead m02293 批准）：包入口 10 组精选具名导出 + 静态守卫测试，shared 全量 40 files / 711 tests、`check:build` exit 0，仍未接页面/未加迁移、未改契约；**I-1a 完成（2026-10-27，Lead m02598 批准）：`packages/shared/src/workbench/pipeline.ts` + `pipeline.test.ts` 21 项，shared 全量 41 files / 732 tests、`typecheck` exit 0，仍未接页面/包入口顶层/迁移** |
| W5 网格/模板/容器/编辑 | 未开始 | 依赖 Claude 视觉/适配要求（所有者 m11382 起工作台 UI 由 Claude 接管；原 Codex 视觉规范不再作为阻塞）、S-03 与卡片清单；OQ-LM-03/04/05/06/07 仍待所有者（OQ-LM-01 已锁定 size-first） |
| W6 配置/同步/分享 | 未开始 | 依赖同步与隐私合规决策；W2 已预留档案键/引用槽占位字段 |
| 布局算法测试 | D-1 完成（属性测试 ≥10⁴、TC-07…26 纯算法部分、序列化与损坏配置）；D-3 新增迁移矩阵/修复顺序/紧凑/容器用例；D-4 新增文档 IO/迁移链/分享快照与短码/导入管道/合并契约用例（59 项）；D-3.1 新增独立档案/模式迁移与 G-12b 用例（25 项）；D-3.2 新增容器数据模型/占位语义与迁移固定案例用例（31 项）；D-6 新增 G-12a params 白名单校验（51 项 → T-8 同步后 55 项）与分享导入门用例（7 项）；I-1a 新增 `src/workbench/pipeline.test.ts` 21 项 | 累计 `src/analysis/layout` 21 files / 327 tests；shared 全量（含 `src/workbench`）41 files / 732 tests；非纯算法用例（TC-15/18/19/21/23/24）留集成/UI 批次；服务端同步与公开分享不测（未实现） |

---

## 6. 开发交接记录

### 6.1 汇报格式（向 Lead）

`状态 / 已完成 / 修改文件 / 相关提交 / 测试命令与结果 / 接口变化 / 已知问题 / 下一步`；同时在 §6.2 记录。

### 6.2 记录

| 日期 | 内容 | 修改文件 | 提交 | 测试 | 接口变化 | 已知问题 | 下一步 |
|---|---|---|---|---|---|---|---|
| 2026-10-27 | 工作区/分支/任务文档初始化（Lead 创建）；未开发 | 本文件 | 随初始化提交 | 未运行 | 无 | 见 §7 | 等待所有者第二轮需求；先交付 W2 布局数据结构约束草案 |
| 2026-10-27 | 初始化确认：已阅读规格与边界，未开始开发 | 本文件 | 本轮本地提交 | 未运行（未开发） | 无 | 见 §7 | 等待所有者第二轮详细需求；W2 先交付布局数据结构约束草案 |
| 2026-10-27 | 所有者完整开发规格下发（Lead 归档，3207 行）并提交进本分支永久文档；任务文档记录「规格已下发、D-0 启动」 | `docs/specs/product/s17-agents/S17-Agent-D-完整开发规格-所有者-20261027.md` | `ff09275` | 未运行（文档） | 新增本分支权威规格引用源 | D-Q1 已解除；文档校验（check-links / doc-audit / check-status）随后统一执行 | 按规格 §40 执行 D-0 |
| 2026-10-27 | D-0 首提交：布局数据模型与纯函数（types/grid/projection + 单测）+ D-0 模型与接口文档；未接包入口、未加迁移 | `packages/shared/src/analysis/layout/*`、本文件、D-0 文档 | `32bb563` | Node v24.20.0 类型剥离冒烟 19/19 通过；**正式 vitest/tsc 未运行（环境限制：无 pnpm 依赖）** | 新增 `ObjectSizeContract` 草案与目录内导出（未接 `@libellum/shared` 入口） | 环境限制无 `node_modules`；OQ-LM 数值待上游；见 D-0 文档 §9/§10 | D-1：属性测试、TC-07…22、序列化往返、与 S-03 对齐契约 |
| 2026-10-27 | D-0 评审通过（条件性：先装依赖跑真实测试）；`pnpm install --frozen-lockfile --prefer-offline` 成功（313 包，lockfile 未改、node_modules 已忽略）；真实 typecheck 与 vitest 通过 | `node_modules/`（已忽略）、本文件 | `77f9796` | `pnpm --filter @libellum/shared typecheck` exit 0；`vitest run src/analysis/layout` 2 files/29 tests passed | 无 | 无 | D-1：属性测试 ≥10⁴、TC-07…22、序列化往返、损坏配置、S-03 对齐 |
| 2026-10-27 | D-1 完成：新增 validation（校验/序列化/解析）、测试 PRNG 与夹具、属性测试 10,400 场景、TC-07…26 纯算法夹具、序列化/损坏数据测试；修复 `findEarliestFreeAnchor` 行尾起点越界崩溃；新增 D-1 记录文档 | `packages/shared/src/analysis/layout/*`、本文件、D-1 文档 | `77f9796` | 真实 `typecheck` exit 0；`vitest run src/analysis/layout` **5 files / 65 tests passed**（含 10,400 属性场景），exit 0 | 目录内 barrel 追加 validation 导出；**仍未接** `@libellum/shared` 包入口，未冻结公共接口 | 非纯算法 TC-15/18/19/21/23/24 留集成/UI 批次；OQ-LM-01/03/04/05/06/07 仍待所有者；尺寸数值待 W3 | 等待 Codex 视觉规范与 D-2 接口澄清；把 `AnalysisReference`/`ObjectSizeContract` 草案提交 S-03 评审 |
| 2026-10-27 | D-2 前置完成（Lead 批准范围：不依赖 Codex 视觉）：`commands.ts`/`focus.ts`/`machine.ts` + 测试；D-2 前置交互模型与状态机草案；S-03 布局侧接口草案（draft v0.1，未冻结）；D-2 UI 待 Codex 视觉规范另行批准 | `packages/shared/src/analysis/layout/*`、本文件、两份新文档 | `ddd2b9d` | 真实 `typecheck` exit 0；`vitest run src/analysis/layout` **8 files / 102 tests passed**（新增 37 项），exit 0 | 目录内 barrel 追加 commands/focus/machine；**仍未接** `@libellum/shared` 入口；S-03 侧仅 draft，未冻结 | 未实现垂直紧凑/写回/容器内部几何（OQ-LM-03/06/07/08 占位）；手势/视觉细节待 Codex；iOS Safari/PWA 真机未验证 | 待 Lead 评审两份文档；Codex 视觉规范后进入 D-2 UI；W5 前需所有者决定 OQ-LM-01/03/04/05/06/07 |
| 2026-10-27 | D-4 前置 headless 完成（Lead 批准：文档 IO/迁移链与缓存键/分享快照与短码/导入管道/本地存储契约）：新增 `document-io.ts`/`migration-chain.ts`/`share-snapshot.ts`/`import-pipeline.ts`/`storage-contract.ts` 与 5 个测试文件（59 项）；S-03 草案升级 v0.3；新增 D-4 记录文档 | `packages/shared/src/analysis/layout/*`、本文件、S-03 草案、D-4 文档 | `b9f4d33`（+ 本记录提交） | 真实 `typecheck` exit 0；`vitest run src/analysis/layout` **17 files / 209 tests passed**，exit 0 | 目录 barrel 追加五模块 + `parseShareSnapshot`；**仍未接** `@libellum/shared` 入口；S-03 仍 draft v0.3 | OQ-CF-10 短码参数、OQ-CF-01 删除语义、OQ-CF-02 草稿落本地、B-6 隐私门未定；服务端同步仅接口占位 | 待 Lead 评审 D-4；Codex 视觉后 D-2 UI；W6 服务端同步需批准+迁移评审 |
| 2026-10-27 | D-5 只读预研完成（Lead 批准 m00988）：W5/W6 集成批次与接入点清单（10 批次）、永久文档 30 项与最终交付 36 项逐项对照、1.16.23 候选影响面（主工作区/发布快照/预计零 rebase 文件冲突）、S-01 v2 中 D 契约条款复核（无变化）；新增 D-5 记录文档；未改代码、未 rebase、未接页面、未 push | 本文件、`docs/specs/product/s17-agents/S17-Agent-D-D5-只读预研-W5W6集成与规格对照-v1.md` | `e73946b` | 只读核对 + 文档检查（check-links/doc-audit/check-status）与 `typecheck`/`vitest` 复验（17 files / 209 tests） | 无接口变化（S-03 仍 draft v0.3） | 1.16.23 已发布（`release/1.16.23` @ `d4e4fd8`）；待 Lead 汇总预研结论；OQ-LM/OQ-CF 与 Codex 视觉仍待上游 | D-5 提交后按 Lead 指令 rebase 到 `d4e4fd8` 并复验；Codex 视觉后进入 D-2 UI；按 I-0…I-10 批次推进集成 |
| 2026-10-27 | 按 Lead 指令 rebase 到 1.16.23 基线 `d4e4fd8`（`release/1.16.23`）：D 备份分支 `backup/agent-d-pre-1.16.23-20261027`（→ `932d4d1`）；15 个提交全部重放、**零冲突**；`docs/00-索引.md` 无重叠 | 无文件差异（仅基线变化） | HEAD `61c1855`（rebase 后） | `typecheck` exit 0；`vitest run src/analysis/layout` **17 files / 209 tests passed**；`check-links` 201 份/1006 链接失效 0；`doc-audit` 仅 4 条既存缺失路径告警；`check-status` 通过（**版本 1.16.23、迁移 60**） | 无接口变化（S-03 仍 draft v0.3） | Lead 建议的备份分支名 `pre-1.16.23-20261027` 已存在且属 Agent A（指向 A 提交 `6077d8d`），D 改用 `backup/agent-d-pre-1.16.23-20261027` | 向 Lead 报告 D-5 交付 + rebase 结果；等 Lead 汇总与 Codex 视觉；按 I-0…I-10 集成 |
| 2026-10-27 | S-03 布局侧草案评审修订记录整理（Lead 指令 m01153）：§8 保留六问裁定并新增 §8.1 裁定版本说明与 §8.2 OQ-LM-01/03/04/05/06/07 待决项登记表（状态/阻塞阶段/占位口径/裁定方）；§9 变更记录追加整理行；仅文档，不改代码 | S-03 文档、本文件 | `39f1723` | 未运行（纯文档；rebase 后全量校验见上一行） | 无接口内容变化（仍 draft v0.3 未冻结） | OQ-LM 数值与裁定仍待所有者；Codex 真实视觉规范未到位（外部 W4 报告已核实不可复核，不作为规范） | D-2 UI 继续等待 Codex 真实规范；I-0 入口导出等 S-03 冻结与 OQ 裁定后再启动 |
| 2026-10-27 | 所有者 2026-10-27 八项 OQ 方向核对与落实（仅文档）：一致项落实为正式决定（OQ-LM-04/06、OQ-CF-05 原则、OQ-CF-07 结构安全）；部分/不符项列差异（OQ-LM-03/05、OQ-CF-01/07）；OQ-LM-07 方向未覆盖原问题不裁定；新增 OQ 落实与差异清单（7 项差异）+ 布局与交互设计稿（所有者 10 条交互方向）；S-03 升 draft v0.4；未改代码、未接页面、未改版本号（1.17.1 由 Lead 在集成工作区统一提升） | 本文件、`S17-Agent-D-OQ落实与差异清单-v1.md`、`S17-Agent-D-布局与交互设计稿-v1.md`、S-03 文档 | `d3cfca6` | 未运行（纯文档）；文档检查见本轮结果 | 无接口变化（S-03 仍 draft v0.4 未冻结） | 7 项差异待 Lead 汇总给所有者（OQ-LM-03 组合/默认、OQ-LM-05 选型、OQ-LM-07 语义不符、OQ-CF-01 布局合并冲突、OQ-CF-05 键形态、OQ-CF-07 审核流程、同步架构前提）；视觉仍等 Codex 正式规范 | 等 Lead 汇总与差异答复；按 OQ 结论与 Codex 视觉后再进入 D-2 UI / I-2 / I-3 |
| 2026-10-27 | S-01 v2 r4 D 正式冲突检查（只读评审，Lead 加急 m01311）：新增冲突检查意见文档；🔴 3（§2 桶级 completeness 矛盾、§6 布局契约冻结范围、G-13 密度/最小尺寸门槛）+ 🟡 5 + ✅ 9 组 + 🟢 5；结论=3 项阻塞冻结、均为 S-01 文字/范围问题；未改代码/A 分支/版本，未 push | `docs/specs/product/s17-agents/S17-Agent-D-S01-v2-冲突检查意见-20261027.md`、本文件 | `4891cad` | 未运行（纯文档）；仅读 A 工作区与 docs 工作区 | 无接口变化；D 侧两项部分覆盖（缓存键域、analysisVersion 正文规则）已登记 | A r5 修订 D-V2-01/02/03 后 D 单点复核即可给无阻塞意见；D-2 UI 仍等 Codex 视觉 | 等 A r5 修订；恢复 D-2 UI/D-3 等待状态 |
| 2026-10-27 | D-3.1 headless 独立档案与模式迁移引擎：新增 `profiles.ts`（档案键占位/解析/写时复制物化/模式切换/采纳档案/未放置诊断）与 `profiles.test.ts`（22 项含 300 场景属性）；`import-pipeline.ts` 增加 G-12b `resolveAnalysisVersion` 与 `analysis-version-readonly` 只读占位（测试 +3）；barrel 追加 profiles；新增 D-3.1 记录文档；S-03 升 draft v0.5（§4.5 + §9 变更行）；未接包入口/未接 UI/页面、未 push、未改版本号 | `packages/shared/src/analysis/layout/{profiles.ts,profiles.test.ts,import-pipeline.ts,import-pipeline.test.ts,index.ts}`、本文件、S-03 文档、D-3.1 文档 | 本轮提交 `2f0dd5e`（+ 本记录提交） | 真实 `typecheck` exit 0；`vitest run src/analysis/layout` **18 files / 234 tests passed**（D-4 后 209 + 新增 25），exit 0 | 新增 profiles 导出与 `ShareImportOptions.resolveAnalysisVersion`（目录内 barrel，仍未接 `@libellum/shared`）；S-03 仍 draft v0.5 未冻结 | OQ-LM-07 写回、OQ-LM-08 宽度档、档案内分割比例归属仍待所有者；所有者已裁定 D-V2-01/02/03 接受、G-13b 归 W3；G-12a 正式发布物待 A | 等 A 最终修订后按 Lead 清单做针对性复核（D-V2-01/02/03、G-12b/G-12a/G-13a、S-03 引用一致性）；继续 D-3 headless 后续批次；D-2 UI 等 Codex 视觉 |
| 2026-10-27 | D-3.2 headless 容器数据模型/占位语义与跨列迁移固定案例：新增 `containers.ts`（GridSplit 比例归一化/槽位语义、子树结构校验失败码、展示形态派生、1×1 折叠↔恢复纯数据函数）与 `containers.test.ts`（19 项）+ `migration-cases.test.ts`（12 项：3→4/4→3 所有者案例、冲突/退化/降级/容器/Spacer/无漂移）；barrel 追加 containers；新增 D-3.2 记录文档；S-03 升 draft v0.6；未接包入口/UI/页面、未 push、未改版本号 | `packages/shared/src/analysis/layout/{containers.ts,containers.test.ts,migration-cases.test.ts,index.ts}`、本文件、S-03 文档、D-3.2 文档 | `92452cb`（+ 本记录提交） | 真实 `typecheck` exit 0；`vitest run src/analysis/layout` **20 files / 265 tests passed**（D-3.1 后 234 + 新增 31），exit 0 | 新增 containers 导出（目录内 barrel，仍未接 `@libellum/shared`）；S-03 仍 draft v0.6 未冻结 | 容器槽位与 children 分配策略、容器内编辑命令、OQ-LM-03/05/09 细节仍待 W5/Codex/所有者；`deriveContainerDisplay` 与投影引擎为两处实现（口径由测试锚定） | 等 A 最终修订后按 Lead 清单做针对性复核；继续等待 Codex 真实视觉规范与 Lead 对 D-3 后续批次的批准。 |
| 2026-10-27 | S-01 v2 r6 针对性复核（只读，Lead 加急 m01688）：对 A r6（HEAD `edc626c`）核对 D 相关 4 项——D-V2-01…08 无回退、G-12a 发布物 D 侧够用、§16.5 与 S-03 迁移契约不冲突、常量 #21–22/#23–24/#29 无交集；**✅ 无 🔴、无阻塞冻结**；提 4 条 🟡 澄清（analysisId 大小写、校验层级用词、`pinnedRange`/`timeFixed` 双入口、分享导入门未登记）。未改文件、未提交（只读） | 无 | 无（只读） | 未运行（只读核对） | 无 | 4 条 🟡 待 Lead 裁定 | 按 Lead 裁定做 S-03 v0.7 纯文档同步 |
| 2026-10-27 | S-03 v0.7 纯文档同步（Lead 批准）：§2 analysisId 统一 `AN-B01`；§2/§7 登记 G-12a v1 校验输入与 `shareImportAllowed=false` 导入门；§2 绝对区间走 `pinnedRange`（T-8）；§4 两条边界注；§9 v0.7 行；header 修正 DRAFT v0.7；D-4 文档补导入门；任务文档同步。仅文档，不改代码/契约，不影响 S-01 v2 冻结 | S-03 文档、D-4 文档、本文件 | `231af67`（+ 本记录提交） | 未运行（纯文档）；文档检查见本轮结果 | 无接口内容变化（仍 draft v0.7 未冻结） | G-12a v1 D 校验实现与 30 用例待后续批次；A r7 微调 T-8 说明 | 回 Lead「v0.7 已提交 + commit」；继续待命/下一 headless 批次，D-2 UI 等 Codex 视觉 |
| 2026-10-27 | D-6 前置 headless：G-12a v1 params 白名单校验纯函数 + 分享导入门（Lead 批准 m01813）。新增 `params-validation.ts`（26 项分析表/通用键/隐私黑名单/9 错误码/只读占位/严格 allowLongRange/保守版本比较）与 `params-validation.test.ts`（51 项，含 G-12a §8 的 30 条逐条覆盖）；`import-pipeline.ts` 增必填 `shareImportAllowed`、`currentAnalysisVersion?`、`knownAnalysisIds?`，开头门拒绝 + 逐卡 params 校验（invalid 失败、readonly 仅提示、G-12b 已覆盖版本差异不重复报告），`import-pipeline.test.ts` 重写为 23 项；barrel 追加 params-validation；新增 D-6 记录文档；未接包入口/页面/API、未加迁移、未改 S-01/S-03 契约、未 push、未改版本号；分享门仍关闭 | `packages/shared/src/analysis/layout/{params-validation.ts,params-validation.test.ts,import-pipeline.ts,import-pipeline.test.ts,index.ts}`、本文件、D-6 文档 | `ac4fd47`（+ 本记录提交） | 真实 `typecheck` exit 0；`vitest run src/analysis/layout` **21 files / 323 tests passed**（D-3.2 后 265 + 新增 58），exit 0 | 新增 params-validation 导出（目录内 barrel，仍未接 `@libellum/shared`）；`ShareImportOptions.shareImportAllowed` 变为必填（集成方须显式选择） | `shareImportAllowed` 未放行（等 G-12a §9 检查单：Lead 复核 + B/C 核对）；`analysisVersion` 仅保守等值比较（G-15）；`timeFixed` 语义随 A r7 T-8 微调；账本存在性/权限不在本层；UI 错误文案未做 | 等 Lead 复核 D-6 并决定分享门放行；A r7 后同步 G-12a 表数据；继续等 Codex 真实视觉规范与下一 headless 批次批准 |
| 2026-10-27 | D-6 验收与分享导入门裁定记录（Lead m01945）：D-6 验收通过（登记 `d96f232`；实测 21 files/323 tests、typecheck exit 0）；Lead 裁定**分享导入门本 S-01 v2 冻结周期维持关闭**（放行需 A r7 G-12a 表同步 + B/C 核对 + 集成接线/权限容量测试，均不在冻结范围）；记录到 D-6 文档 §4/§7/§9 与任务文档。A r7 尚未发布（A 工作区 HEAD 仍 `edc626c`/clean），等 r7 后做表数据/枚举引用小同步（不改结构） | 本文件、D-6 文档 | 本轮文档提交 | 未运行（纯文档；D-6 测试见上一行） | 无（仅记录裁定） | 分享门维持关闭；A r7 未发布；D-2 UI 等 Codex 只读参考范围 | 等 A r7 后做 G-12a 表数据小同步；继续待命/可提前 headless 不碰 params 表结构 |
| 2026-10-27 | **A r7 单点复核（Lead m01850/m01851，只读）**：对 A r7（`9d82e81`/`76aa278`）逐项核对 D 相关项——G-28a P16 三态 `complete｜no-transactions｜unavailable`（无 `partial`、触发规则、矛盾表述已删）；G-27 `partial→fx-incomplete` 仅汇率缺失/折算失败根因（反例+混合优先级）；G-30 `PIVOT_METRICS` 4 值 + `ADVANCED_DIMENSIONS` 7 值准确、无重复、Sturges 仅候选；#3 三层事实（S16-D 现状 14 个月 / B draft `FX_MAX_RANGE_MONTHS=36` 未生效 / 分析窗口 36–60 不同轴；超限显式拒绝或整结果 `fx-incomplete`+原因+UI，禁止静默部分；C 无第二读取入口）；σ/CV（σ 定点 6 位、按币种小数一次 `minor-half-away-v1`；CV 无量纲 `percent-100` 1 位 `formatRatioPercent`，不套货币舍入）；未改 S-03 契约边界（§6 仍为非规范性引用）→ **D 单点复核通过（A r7 `9d82e81`），无阻塞**。**G-12a 表数据同步=无需变更**：G-12a 发布物未随 r7 更新（`11645` 字节/`8:19` 未变、r7 记录与草案均无 T-8 提及，`timeFixed` 仍允许绝对日期区间），D 的 `ANALYSIS_PARAM_SPECS` 26 项表/通用键/隐私键与 G-12a v1 逐项一致 → 本批无代码/表数据改动，仅记录。另观察：A 工作区有 1 处未提交修改（§5.1-8 P16 上游原因措辞），非 r7 内容 | 本文件 | 本轮文档提交 | 真实 `typecheck` exit 0；`vitest run src/analysis/layout` 21 files / 323 tests passed | 无（未改代码；S-03 仍 draft v0.7、G-12a 仍 v1） | T-8 未随 r7 落实（G-12a 仍含 `timeFixed` 绝对区间）→ 待 A 补 G-12a v1.1；A 未提交修改建议提交；§6 仍引 S-03 draft v0.4（非规范性引用，D-V2-07 已接受） | 回 Lead 回执「D 单点复核通过（A r7 9d82e81）」+ G-12a 同步结论；等 A 补 T-8 后 D 只做表数据同步 |
| 2026-10-27 | A r7.1 delta 快速确认（只读，Lead m02090）：`5a6d055` 相对 `9d82e81` 仅结构草案 1 file +16/−16 纯措辞（「S16-D 现状」→「生产基线（1.16.23）web 读取上限仍 14 个月」、P16 上游原因权威列表、σ/CV 命名说明、§16.9/§16.10 措辞）；未改协议字段/代码/枚举/S-03 引用（§6 未动）；A 工作区 clean。已回 Lead「r7.1 delta 无异议」 | 无 | 无（只读） | 未运行（只读） | 无 | 无 | 等 A 发布 G-12a v1.1（T-8）后同步表数据 |
| 2026-10-27 | **G-12a v1.1（T-8）D 侧表数据/用例同步（Lead m02101）**：`timeFixed` 由 `{from,to}` 对象改为 6 个预设枚举（`this-month`/`last-month`/`this-year`/`last-year`/`last-3-months`/`last-6-months`）；旧绝对日期对象一律拒绝（`params_type`），绝对区间只走卡片级 `pinnedRange`；嵌套对象规则收紧；`allowLongRange` 仅相对区间 >400 天有效；`params-validation.ts` 表数据/用例 51→55 项；**只改表数据/用例，不改校验器结构/签名/返回类型**；D-6 文档同步（§10 记录）；S-03 升 draft v0.8（纯文档引用同步）；未接包入口/页面/API、未 push、未改版本号；分享门仍关闭 | `packages/shared/src/analysis/layout/{params-validation.ts,params-validation.test.ts}`、D-6 文档、S-03 文档、本文件 | `7ec7810` + 本记录提交 | 真实 `typecheck` exit 0；`vitest run src/analysis/layout` **21 files / 327 tests passed** | 无接口形状变化（校验器签名/返回类型未变；S-03 仍 draft v0.8 未冻结） | `timeFixed` 旧绝对输入被拒（需 UI 提示改用 `pinnedRange`）；分享门仍未放行；T-7 C 系列白名单占位待 A | 回 Lead「T-8 同步完成 + 提交号 + 327 tests」；等 Lead 标记 `s01-v2` 与后续批次 |
| 2026-10-27 | **D-2 集成前检查清单（待命期间只读准备，Lead m02293）**：`s01-v2` 已冻结（Lead 验收 T-8 同步）后 D 进入待命；产出只读准备清单：基线（布局目录 41 文件 / 21 测试文件 / 327 tests / typecheck exit 0）、导出面（barrel 17 个 `export *`、**248 个导出标识符**、候选名冲突 0、建议最小导出面与 I-0 不变量）、权限检查（不做鉴权/不加权限/静态守卫属 I-0）、容量检查（列 1–12、卡片 40、容器 12、深度 1、params 键 ≤12、快照 ≤64KB 等）、回退路径（仅包入口单提交 revert，无数据/迁移/服务端变更）、待确认与不启动声明（I-0、D-2 UI、命令扩展均不启动）；未改代码/契约/包入口、未 push | 新增 `S17-Agent-D-D2-集成前检查清单-v1.md` + 本文件 | `37644d5` + 本记录提交 | 未运行（纯文档；引用 T-8 后实测 21 files/327 tests） | 无 | 无（I-0 未启动；B-6 分享门仍关闭） | 报 Lead：s01-v2 验收确认 + 待命准备清单已提交；继续待命（D-2 UI 等真实 Codex 视觉；I-0 待 Lead 批准） |
| 2026-10-27 | **I-0 包入口精选导出 + 静态守卫（Lead m02293 批准）**：`packages/shared/src/index.ts` 在 `fxHistory` 导出后追加 10 组精选具名导出（additive、显式 `export type`、约 214 个公开符号，**未用 `export *` 全量并入**；低层占位常量/调试函数/测试辅助不导出）；新增 `packages/shared/src/analysis/layout/export-surface.test.ts` 8 项静态守卫（入口段与无全量 export*/布局 248 标识符重名=0 与 reserved word=0/内部符号不泄漏/21 个函数与目录 barrel 同源/`import type` 可用/生产模块 17 个无 I/O-DOM-网络-时钟-随机-框架依赖且不反向 import 包入口/投影不写回且确定）；未改布局源文件、未改 S-01/S-03 契约、未加迁移/页面/API、未改版本号、未 push | `packages/shared/src/index.ts`、`packages/shared/src/analysis/layout/export-surface.test.ts`、本文件 | `005046d`（+ 本记录提交） | 真实 `typecheck` exit 0；shared 全量 `vitest` **40 files / 711 tests passed**；`pnpm check:build` exit 0（真实 web 构建通过） | 包入口新增约 214 个 layout 公开符号（additive，既有导出签名/行为未改；内部辅助不导出，回退=单提交 revert `index.ts`） | 重名/保留字检查 0 冲突；`apps/web` 侧尚未 import 这些符号（I-1+ 批次再接）；测试文件使用 `/// <reference types="node" />` 仅为守卫测试自身需求 | 回执 Lead（导出组清单/守卫用例/验证证据/提交号/回退说明）；等 Lead 批准后续集成批次；D-2 UI 仍等真实 Codex 视觉规范 |
| 2026-10-27 | **I-1 待命期只读交叉核对（Lead m02502）**：新增 `S17-Agent-D-I1-集成契约映射-v1.md`——D/C/A 三方类型可组合性三分法（直接可用 6 / 需适配器 4 / 缺口 4：信封 version 串、A 代码常量 `s01-draft`、C 未进包入口、记录级来源通道）、I-1 最小接线顺序（I-1a 可立即启动；I-1b/c/d/e 依次等 A 信封/Codex 视觉/分享放行）、不变量核对结论「**无冲突**」（I-0 守卫 vs C 纯函数、C `ok:false` vs A `completeness` 双轨由适配器统一、A `partial` vs C `DraftFxCompleteness.partial` 按 G-27 映射）。只读 A/B/C 工作区（A `6f72f9f`/B `78b9d05`/C `a1f792f`），未改代码/契约、未接包入口/页面、未 push | 新增 I-1 文档 + 本文件 | `47eae0c` | 未运行（只读文档核对）；`check-links` 209 份/1038 链接失效 0、`doc-audit` exit 0、`check-status` 通过（1.16.23/60） | 无接口变化 | 缺口 G-1…G-4 已登记（不实现）；I-1a 建议可启动但需 Lead 批准；D-2 UI 等 Codex | 回 Lead 提交号 + 摘要；等 Lead 决定 I-1a 启动与缺口收口责任 |
| 2026-10-27 | **I-1a 集成胶水层（Lead m02598 批准；纯数据链路）**：新建 `packages/shared/src/workbench/pipeline.ts`（`runLayoutPipeline`：文档加载/校验→逐卡 `validateAnalysisParams`→跨文档一致性→`projectLayout`→序列化/roundTrip；`ok=无 error`、输入不修改）与 `pipeline.test.ts`（本地夹具 21 项）；未改 `analysis/**`、未接 `packages/shared/src/index.ts` 顶层公开面、未接 apps/web/路由/API/迁移；所有者 m11382 方向补充：工作台 UI 由 Claude 接管、D-2 阻塞条件改为「等 Claude 视觉/适配要求 + Lead 验收」 | 新建 `packages/shared/src/workbench/*` + 本文件 | 本轮 feat 提交（待回填） | 真实 `typecheck` exit 0；shared 全量 `vitest` **41 files / 732 tests passed**；`pnpm.cmd -r exec tsc -b` 仅 `apps/api` 因未生成 Prisma client 与既有测试隐式 any 失败（与本批无关；shared 单包 `tsc -b` exit 0） | 新增 API 仅 `packages/shared/src/workbench/pipeline.ts`（未接包入口）；夹具本地构造未新增 test-support | 缺口 G-1…G-4 未变；I-1b 需 G-1/G-2 收口 + C→A 适配 + Claude 视觉；D-2 不再等 Codex | 回执 Lead（文件清单/API/测试证据/提交号/链路对应/I-1b 前置判断）；等 Lead 安排 I-1b 与 Claude 视觉对接 |

---

## 7. 未决问题（Agent D）

| 编号 | 问题 | 影响 | 需要谁决定 |
|---|---|---|---|
| D-Q1 | 布局/配置能力清单与细则未提供 | ~~无法开工~~ **已解决（2026-10-27）**：所有者规格已下发并归档（`ff09275`），按规格执行 | 已解除 |
| D-Q2 | W1/基线与 1.16.23 发布提交 | **已解除（2026-10-27）**：1.16.23 已发布（`release/1.16.23` @ `d4e4fd8`，无迁移）；D 已按 Lead 指令 rebase（15 提交零冲突，rebase 后 HEAD `7d9f9fc`；备份分支 `backup/agent-d-pre-1.16.23-20261027` → `932d4d1`；建议名 `pre-1.16.23-20261027` 已被 Agent A 占用）；页面集成批次仍由 Lead 统一协调 | 已解除 |
| D-Q3 | 服务端同步的存储模型/隐私合规未决策（OQ privacy gate） | W6 分享能力 | 所有者 |
| D-Q4 | 卡片最小/推荐尺寸需要 A/B/C 与 Codex 共同确认 | 已在 D-0 提出 `ObjectSizeContract` 草案；数值待 W3 | Lead 协调（S-03） |
| D-Q5 | 跨设备布局迁移与“统一/独立布局”交互细节需所有者确认 | W6（OQ-LM-07/08） | 所有者 |
| D-Q6 | 与 S18（跨屏幕适配）的边界：布局响应式 vs S18 全站适配 | 范围重叠 | 所有者 / Lead |
| D-Q7 | OQ-LM-03/04/05/06/07 状态（2026-10-27 所有者方向核对后） | OQ-LM-04/06 **已落实为正式决定**（D-OQ-04/06）；OQ-LM-03/05 **部分落实**、余项待所有者（DIFF-01/02）；OQ-LM-07 所给方向未覆盖原 M1/M2/M3 问题（DIFF-03），需重新明确；明细见 [OQ 落实与差异清单](./S17-Agent-D-OQ落实与差异清单-v1.md) 与 S-03 §8.2 | 所有者（差异答复） |
| D-Q8 | 卡片 `minSize`/`sizeLadder`/`compatSize`、Codex 视觉规范、S-01 冻结仍待上游 | 阻塞尺寸契约冻结、D-2 UI 与 S-03 对齐 | Lead / A/B/C / Codex |
| D-Q9 | 索引 B-14（D 规格未下发）状态 | ~~仅索引一致性问题~~ **已解除（2026-10-27）**：Lead 已更新 orchestrator 索引（`3fc42db`） | 已解除 |
| D-Q10 | D-3 headless 与 S-03 v0.2 待 Lead 评审；D-2 UI 待 Codex 视觉规范 | ~~阻塞~~ **D-3 与 S-03 v0.2 已解除（2026-10-27，Lead 验收通过并批准 D-4 前置）**；**D-2 UI 阻塞条件已更新（所有者 m11382，Lead m02654）：等 Claude 视觉/适配要求 + Lead 验收**（工作台 UI 由 Claude 接管；D 布局引擎是唯一实现，Claude 通过 I-1 文档消费；不再等 Codex 视觉规范） | Lead / Claude |
| D-Q12 | 分享短码参数（位数/字符集/限速/唯一性）与公开分享隐私合规（OQ-CF-10 / B-6） | 阻塞 W6 公开分享上线；D-4 已按候选 8–10 位去歧义字母表实现纯函数，参数可配置、未冻结 | 所有者（W6） |
| D-Q11 | OQ-LM-01 默认迁移策略 | **已裁定（2026-10-27）**：锁定 `size-first`（S）；`position-first` 仅作对照保留 | 已解除 |
| D-Q13 | OQ-CF-01 布局文档合并粒度：所有者要求“避免整份覆盖、尽量安全合并”，与现行“布局文档整体替换 + `previousMain`”冲突（DIFF-04） | W6 同步合并实现与验收 | 所有者（W6 前；在此之前维持推荐口径并标注待定） |
| D-Q14 | OQ-CF-05 稳定预置分类键形态：新增内部 key 字段属数据模型/迁移变更（DIFF-05） | W6 分享导入与分类引用回绑 | 所有者（数据模型变更批准） |
| D-Q15 | OQ-CF-07 分享模板审核流程（字符集/违禁词/举报下架/与 S17-A-01 隐私政策关系）未覆盖（DIFF-06） | W6 公开分享上线 | 所有者 / 法务 |
| D-Q16 | “对照已有同步架构”前提不成立：W6 服务端同步尚未实现（仅契约占位）（DIFF-07） | OQ-CF-01 最小可行实现只能到契约级 | Lead（W6 批准后组织实现评审） |
| D-Q17 | S-01 v2 冻结依赖 A 修订 D 侧 3 项阻塞项（D-V2-01 §2 桶级 completeness 文字、D-V2-02 §6 布局契约权威/冻结范围、D-V2-03 G-13 密度/最小尺寸门槛）；另 2 项部分覆盖（D-V2-04 缓存键域、D-V2-06 analysisVersion 正文规则）建议同轮文字修订 | **已裁定（2026-10-27 所有者书面裁定 `f215fa9`）**：D-V2-01/02/03 全部接受（桶级五态、S-01 布局部分非规范性引用/S-03 唯一权威、G-13a 进冻结/G-13b 归 W3）；D-V2-04～08 原则接受。A 最终修订到达后 D 只做针对性复核（等 Lead 复核清单） | A 最终修订 + Lead 清单（D 单点复核）；A r6 已到达，D 针对性复核四项 ✅、无阻塞（2026-10-27），Lead 接受 4 条 🟡 裁定 → **本项已解除（2026-10-27；A r7 如需仅微调 T-8 说明）** |
| D-Q18 | G-12a params 白名单**正式发布物**与 G-13b 密度/最小尺寸数值 | 所有者裁定：G-12a 要成为可供 D 实施的正式发布物（A 负责出，未完成校验测试前分享导入关闭）；G-13b 由 W3 原型+真机决定；卡片密度正式定义归 Codex 视觉规范 | A（发布物，已产出 v1）/ W3 / Codex；G-12a v1 已产出（draft 随 S-01 v2），D 已在 S-03 v0.7 登记为校验输入与导入门；**D-6 已于 2026-10-27 实现 G-12a v1 校验纯函数（51 项测试，含 30 条逐条覆盖）与 `shareImportAllowed` 导入门**，待 B/C 核对与 Lead 复核后放行；G-12a 升版时 D 只同步表数据、不改校验结构；**Lead 2026-10-27 裁定：分享导入门本冻结周期维持关闭、不决策放行**（放行需 A r7 表同步 + B/C 核对 + 集成导入真实接线/权限容量测试）；D-6 已完成 G-12a v1 校验实现与 51 项测试，等 r7 做表数据小同步（不改结构）。**2026-10-27 A 已补 G-12a v1.1（`782b036`）与 r7.2（`b39b27a`）；D 同日完成 T-8 表数据/用例同步（`timeFixed` 6 预设枚举、旧绝对对象拒绝；`params-validation.test.ts` 55 项、21 files/327 tests），只改表数据/用例、未改校验结构 → 本项已解除（剩分享门放行待 Lead/B/C 核对与集成接线）** |
| D-Q19 | 容器槽位与 children 的分配策略（GridSplit 哪个子对象进哪个槽位）、容器内部编辑命令、1×1 入口最终 UI | 已由 D-3.2 落地数据语义与占位/恢复；分配策略与内部编辑属 W5/编辑器批次（**依 Claude 视觉/适配要求**，所有者 m11382 起 UI 由 Claude 接管；原 Codex 视觉不再作为阻塞） | Lead / Claude（W5） |

---

## 8. 恢复步骤（上下文丢失时）

1. 读仓库 `AGENTS.md` → `docs/STATUS.md` → 索引 → 本文件。
2. 检查工作区 `git status --short`、`git log --oneline -5`，与 §6.2 核对；不一致立即停手报告 Lead。
3. 只在本分支工作；禁止触碰索引 §1.3 受保护工作区。
4. 向 `lead` 发送恢复报告（身份/状态/已完成/未决/下一步）。
