# S17 · Agent D · D-0 布局数据模型与接口清单（v1）

> 性质：**规划与接口登记**（D-0「数据结构与接口准备」交付物）。本文件不承诺 W5/W6 的实现形态，任何未决口径以文末「待决登记」为准。
> 最后核对: `486c603`（分支基线 1.16.22）+ 本轮 D-0 代码提交 / 2026-10-27
> 权威来源：`docs/specs/product/s17-agents/S17-Agent-D-完整开发规格-所有者-20261027.md`（所有者正式下发版）；另参考 Claude 文档工作区（`记账程序v1-s17-docs-20261026`）内的《S17-工作台布局与格式模板规格》与《S17-工作台个人配置与布局分享-方案草案》（只读，不在本仓库）。
> 上级任务文档：[S17-Agent-D-模块化布局与配置.md](./S17-Agent-D-模块化布局与配置.md)

---

## 1. 目的与边界

D-0 交付**布局层的数据结构与纯函数接口**，供 W2 下游（A/B/C 卡片尺寸语义、Codex 视觉、S-03 卡片注册）引用，并作为 W5/W6 的实现底座。

明确边界（所有者规格 §1、总需求规格 §1.3）：

- 布局层**不做任何财务计算**，不读交易金额/分类/汇率，不改变分析结果，不写账务数据。
- 布局层只保存**引用**（分析定义 ID、图表家族 ID）与**几何/结构**；金额、结果、交易原文、账本/成员信息一律不进入布局数据。
- 投影/迁移是纯函数：不读视口高度、时钟、随机数；同一输入永远同一输出；结果不写回权威布局。
- 容器是几何/组织容器，不聚合、不改筛选、不改金额；首版深度 1。

## 2. 代码位置与导出

代码（本批新增，不改动已有文件）：

```
packages/shared/src/analysis/layout/
├── types.ts        # 文档/节点/几何/契约/投影结果类型 + 版本常量
├── grid.ts         # 行优先编号、占格、合法性、碰撞、几何校验
├── projection.ts   # 跨列投影/迁移（单遍优先级贪心、降级、确定性）
├── index.ts        # 目录内汇总导出
├── grid.test.ts
└── projection.test.ts
```

- 本批**不修改** `packages/shared/src/index.ts`，也不从 `@libellum/shared` 入口导出：包 `exports` 只暴露 `"."`，接入 `index.ts` 属于集成批次（Lead/S-03 评审），避免与 A/B/C 的并行改动冲突。
- 目录内测试用 `vitest`，与仓库既有约定一致（测试与源码同目录 `*.test.ts`、相对导入带 `.js` 后缀）。

## 3. 文档模型：内容与几何分离

依据配置与分享方案 §2–§4.5、布局格式模板规格 §18.2。两份文档**各自带版本、分开保存**，靠稳定 `objectId` 关联：

| 文档 | 归属 | 内容 | 不含 |
|---|---|---|---|
| 内容文档 `WorkbenchContentDocumentV1` | 账号共有 | 卡片身份/分析定义引用/图表配置/标题/时间策略/容器树 | 几何位置、Spacer、账务数据、计算结果 |
| 布局文档 `LayoutDocumentV1` | 账号共有 | 主布局几何、独立模式档案、容器 `presentation`/`expandedSize`、`previousMain` | 卡片分析参数、图表配置、任何金额 |

### 3.1 节点类型

| 类型 | 判别字段 | 关键字段 | 说明 |
|---|---|---|---|
| 分析卡片 `AnalysisCardNode` | `type: "analysis-card"` | `objectId`、`analysis`（`analysisId`/`analysisVersion`/`params`）、`chart`（`chartFamily`/`options`）、`title`、`rangePolicy`、`pinnedRange` | `objectId` 同时是布局稳定对象 ID，永不复用；`analysis` 只是引用，不复制 S-01 结果 |
| Spacer `SpacerNode`（仅布局文档） | `objectType: "spacer"` | 几何位置/尺寸 | 用户有意留白，不请求数据、不是卡片 |
| GridSplit 容器 `GridSplitNode` | `type: "grid-split"` | `children`、`split`（`columnSplitPermille`/`rowSplitPermille`，0–1000） | 首版对齐式两贯穿分割线；比例存千分比不存像素 |
| Carousel 容器 `CarouselNode` | `type: "carousel"` | `children`（顺序即页码，2–6 张） | 每页一张卡片；当前页状态不持久化到服务端 |

### 3.2 几何

- `ObjectGeometry`：`objectId`、`objectType`、`anchor`（行优先位置编号，1 起）、`colSpan`、`rowSpan`、可选 `presentation`（容器用户意图 `full`/`collapsed`）与 `expandedSize`（用户主动收缩前的完整尺寸）。
- `LayoutGeometry`：`baseCols` + `objects`。**位置只存编号**，行列由 `baseCols` 推导；不保存互相矛盾的权威行列字段（所有者规格 §3）。
- `LayoutDocumentV1`：`schemaVersion`、`layoutAlgorithmVersion`、`mode`（`unified`/`independent`）、`main`、`profiles?`（独立模式，写时复制）、`previousMain?`（「上一个布局」恢复副本）。
- `LayoutMode` 只有两种；统一模式是默认，也是唯一权威主布局；独立模式按真实可用宽度推出的列数分档案（都不是设备名）。

### 3.3 版本

| 版本字段 | 位置 | 作用 |
|---|---|---|
| `schemaVersion`（整数） | 内容文档、布局文档 | 结构升级；旧版本由迁移函数链处理，未知字段保留 |
| `layoutAlgorithmVersion`（整数） | `types.ts` 常量、布局文档 | 投影/迁移行为版本；缓存键成分 |
| `workspaceVersion` | W6 同步（未实现） | 乐观并发基版本，见配置与分享方案 §4.5 |
| `presetVersion` | W6 模板（未实现） | 模板默认版本演进 |

本批常量：`LAYOUT_SCHEMA_VERSION = 1`、`LAYOUT_ALGORITHM_VERSION = 1`。**任何结构变化必须递增并补迁移样例**。

## 4. 行优先编号与几何不变量

公式（所有者规格 §4；`row`/`col` 从 0 起、位置编号从 1 起）：

```
position = row × columns + col + 1
row      = floor((position − 1) / columns)
col      = (position − 1) mod columns
```

- 位置取对象**左上角**格子编号；尺寸独立记 `colSpan × rowSpan`（记法 `宽×高`）。
- 编号只有配合 `baseCols` 才有意义；不同列数的编号不可直接比较（布局格式模板规格 §12）。
- 合法性：`col + colSpan − 1 ≤ columns`；行方向无限（可滚动），单对象 `rowSpan` 上限 `MAX_ROW_SPAN = 8`（候选值，W5 校准）。
- 对象占格为集合 `anchor + i × columns + j`，不是连续区间。
- 不变量（在 `validateGeometry` 中校验）：对象 ID 唯一；占格合法；互不重叠；全部对象可被访问。

## 5. 投影 / 跨列迁移（D-1 纯函数骨架）

函数：`projectLayout(layout, content, { targetColumns, contracts?, strategy? }) → ProjectionResult`。

阶段（所有者规格 §5–§6、布局格式模板规格 §13–§15）：

1. **验证/规范化**：非法列数、无效编号、无效尺寸、超上限修正并记录 issue；重复 `objectId` 只保留首个；内容文档中不存在的卡片/容器视为孤儿并忽略；Spacer 只存在于布局文档。
2. **定优先级**：排序键 `(源行, 源列, objectId)` 升序；无有效位置的排最后（只按 `objectId`）。排序只来自布局规则，**不得**依据金额/分析结果/数据量改变。
3. **依次放置（单遍优先级贪心）**：每个对象先试原编号格（合法且空闲）；被占则从编号 1 起找最早合法空位；宽度实在放不下才按形态序列降级：
   - 卡片：原尺寸（full）→ `sizeLadder`（compact）→ 1×1 兼容入口（compat）；
   - 容器：完整（full）→ 紧凑档（compact）→ 1×1 收缩（collapsed）；
   - Spacer：夹宽 `min(colSpan, 目标列数)`（OQ-LM-04 暂用 a）。
4. **校验不变量**：投影结果再次跑 `validateGeometry`，失败记录为 issue。

关键性质（已实现并有测试）：

- **确定性**：同一输入同一输出；对象数组顺序不影响结果。
- **单遍贪心**：不回溯、不两遍；同锚点损坏按先到者占位（TC-06）。
- **宽度才降级**：纵向无限，被占从不触发尺寸降级。
- **每次从权威布局重算**：支持 3→4→2→3 不链式漂移（TC-17）；同列数二次投影幂等（TC-26）。
- 投影结果可缓存（键含 `schemaVersion`/`layoutAlgorithmVersion`/目标列数/约束版本），但**绝不写回**权威布局。

**当前策略口径（待所有者确认）**：默认 `size-first`（S，保尺寸换位置）；`position-first`（P，保位置降尺寸）已实现用于对照，`L`（同行左移）未实现。见 OQ-LM-01。

**垂直紧凑**：本批不自动紧凑（保持源位置），OQ-LM-03 待所有者确认后再实现；Spacer 锚定、容器整体上浮的语义届时补测试。

## 6. 图表尺寸契约（D 对 A/B/C 的接口）

卡片/容器只**声明**约束，布局层只**执行**。类型见 `ObjectSizeContract`（`types.ts`）：

| 字段 | 适用 | 含义 | 数值状态 |
|---|---|---|---|
| `minSize` | 卡片 | 可读最小占格，投影绝不低于 | 待 W3 由 A/B/C 随卡片家族声明（OQ-LM-02） |
| `sizeLadder` | 卡片/容器 | 尺寸档序列（由大到小），布局层按顺序尝试 | 同上 |
| `compatSize` | 卡片 | 1×1 兼容入口尺寸 | 待定（行为已确认，样式 OQ-LM-11） |
| `collapsedSize` | 容器 | 1×1 收缩入口尺寸 | 暂 1×1 |
| `minFullCols` | 容器 | 完整形态所需最小列数，目标列数小于它只能收缩 | 待 W5 原型（OQ-LM-09） |

约束（与 S-01/图表与卡片规格 §5.6 一致）：

- 布局层**不读**交易金额/分类，不决定图表内容；密度档由卡片按**真实可用宽高**选择，布局层只给尺寸。
- 降级不改数字口径、不因为尺寸影响金额；兼容入口受 ACC 约束，不显示误导数字。
- 卡片 `minSize` 具体数值由卡片家族在 W3 提出，**本层不虚构**；缺失契约时按 1×1 占位并记录 `missing-contract`。

## 7. 接口清单（D-0 交付）

### 7.1 对 A / B / C

- 布局只读取卡片实例的 `objectId`、`analysis`（引用）、`chart`（家族 ID）、`title`、`rangePolicy`/`pinnedRange`；不读取分析结果内部字段。
- 卡片必须声明 `minSize`/`sizeLadder`/`compatSize`（字段名以本文件 §6 为准；数值 W3 提出）。
- 卡片点击进入详情、加载/错误/缺数据状态由卡片自己处理；布局层只保证「可访问全部对象 + 返回路径」。
- 与 S-01 的对接：布局层保留 `analysisVersion` 占位，但**不复制** `dataVersion`/结果信封；派生数据不写回。待 S-01 冻结后由 Lead/S-03 对齐字段名。

### 7.2 对 Codex（视觉）

- 可渲染数据 = 投影结果：`{ columns, objects: [{ objectId, objectType, anchor, colSpan, rowSpan, form, degradedReasons }], issues }`；只给几何与形态，不含金额。
- 容器状态：`form: "full" | "compact" | "collapsed"`；收缩入口需可打开容器详情（全部卡片可访问、返回保留滚动/筛选）。
- 拖动/尺寸调整事件、高亮动画、Spacer 编辑态视觉由 W5 提供接口契约（本批未实现）。
- 本批不定义像素、颜色、间距；视觉规范由 Codex 冻结。

### 7.3 对 Lead / Harness

- 导出接入：集成批次在 `packages/shared/src/index.ts` 增加 `export * from "./analysis/layout/index.js"`（本批刻意未改）。
- 布局算法版本变化必须同步 `LAYOUT_ALGORITHM_VERSION` 与文档/测试。
- 任何涉及页面集成的批次（D-2/D-3）合入前需 Lead 统一 rebase 到 1.16.23 发布提交。

## 8. 测试矩阵与当前状态

已覆盖（`grid.test.ts`、`projection.test.ts`）：

| 类别 | 用例 |
|---|---|
| 编号/几何 | 行优先公式、行列互逆、占格集合、越界判定、碰撞、几何校验 |
| 所有者示例 | TC-02（3→4，C@6→C@4）、TC-03（4→3，C@4→C@6）、TC-05（3→6 保位） |
| 损坏数据 | TC-06 同锚点单遍贪心、重复 `objectId`、孤儿、锚点缺失排最后、行跨度超限 |
| 降级 | 4→2 宽度降级（sizeLadder）、无契约 → 1×1 兼容、容器 `minFullCols` 收缩、用户主动收缩 |
| Spacer | 夹宽（OQ-LM-04 a） |
| 策略对照 | `size-first`（S）vs `position-first`（P）差异 |
| 确定性与漂移 | 数组顺序无关、重复投影幂等（TC-26）、无累计漂移（TC-17） |

- 正式运行命令（需 `node_modules`）：`pnpm --filter @libellum/shared test`（= `vitest run`）与 `pnpm --filter @libellum/shared typecheck`。
- **环境限制**：本 worktree 无 `node_modules`，上述命令**本批未运行**（不得声称跑过）。已用 Node v24.20.0 原生类型剥离在临时副本上执行 19 项逻辑冒烟（全部通过，副本已删除），仅证明算法行为，不等于 vitest 正式通过。
- 属性测试（≥10⁴ 用例、INV-1…6 + 打乱顺序相同）属 D-1 正式交付，本批未做。

## 9. 待决登记（本层不得虚构数值）

| 编号 | 问题 | 当前占位口径 | 阻塞阶段 | 决定人 |
|---|---|---|---|---|
| OQ-LM-01 | 行尾/冲突策略 S/P/L 及是否按家族/用户配置 | S：`size-first`（已实现）；P 已实现对照；L 未实现 | W5 | 所有者 |
| OQ-LM-02 | 卡片 `minSize`/`sizeLadder` 数值与密度档 | 缺失即 1×1 占位 + `missing-contract` | W3 | A/B/C + 原型 |
| OQ-LM-03 | 垂直紧凑与投影组合、Spacer 空行、「明确保存位置」 | 不自动紧凑 | W5 | 所有者 |
| OQ-LM-04 | Spacer 窄屏降级（夹宽/限高/折叠/不处理） | 夹宽到目标列数 | W5 | 所有者 |
| OQ-LM-05 | 收缩容器入口 UI 与完整查看 A/B/C | 未实现 UI（仅数据 `collapsed`） | W5 | 所有者 + 原型 |
| OQ-LM-06 | 自动/主动收缩字段与编辑表现 | `presentation`=用户意图；自动收缩只在投影 | W2 预留 / W5 | 所有者 |
| OQ-LM-07 | 统一模式跨列编辑写回 M1/M2/M3 | 未实现写回 | W5/W6 | 所有者 |
| OQ-LM-08 | 独立档案粒度/门槛/分割比例归属/切换 | `profiles[].profileKey` 只留占位字符串 | W6 | 所有者/部分研究 |
| OQ-LM-09 | 容器长宽比/槽位最小可读/紧凑档 | 未定义，`sizeLadder` 空 | W5 | 原型 |
| OQ-LM-11 | 卡片兼容形态样式 | `compatSize` 1×1，仅数据形态 | W3 起 | 所有者/Codex |
| OQ-LM-12 | 损坏修复细节 | 本文件 §5 阶段 1 的推荐口径 | W2 冻结 | 所有者/原型 |

配置/同步/分享类未决（OQ-CF-01…10）见 `S17-工作台个人配置与布局分享-方案草案.md` §10；本批只预留字段，不实现。

## 10. 偏离与说明

1. **容器内部几何未建模**：本批容器只保存外层位置尺寸 + `children`/`split`；内部卡片布局（GridSplit 槽位、Carousel 页）属 D-3。
2. **未实现垂直紧凑**（OQ-LM-03 待决），未实现写回逻辑（OQ-LM-07 待决）。
3. **`profileKey` 只是字符串占位**，宽度档具体阈值/格式待 OQ-LM-08。
4. `ObjectSizeContract` 是布局层单方面提出的接口草案，需 S-03/卡片清单评审后冻结；字段变化会同步 `LAYOUT_SCHEMA_VERSION`。
5. 未改 `packages/shared/src/index.ts`（见 §2），接入时需一次小改动 + 集成评审。

## 11. 下一步（D-1）

- 补属性测试（≥10⁴ 组合、INV-1…6、打乱顺序相同、参考模型对照）。
- 补 TC-07/08/09/10/11/12/13/14/16/20/22 等网格夹具（其中依赖 OQ 的用例标注待决）。
- 序列化/反序列化往返测试（`JSON` → 校验 → 投影同一结果）。
- 与 S-03/卡片清单对齐 `ObjectSizeContract` 字段与命名。
