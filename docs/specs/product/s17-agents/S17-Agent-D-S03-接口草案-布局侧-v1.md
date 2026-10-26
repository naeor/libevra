# S17 · Agent D · S-03 接口草案（布局侧，draft v0.1，**未冻结**）

> 最后核对: `486c603` + 本轮 D-2 前置提交 / 2026-10-27
> 状态：**DRAFT，未冻结**（S-03 由 Lead 组织评审；本文件只是布局侧提交讨论的提案，不构成公共接口）
> 提交方：`DS-S17-D-Layout`；评审方：Lead（S-03 组织者）、A（计算侧）、Codex（视觉侧）
> 代码位置：`packages/shared/src/analysis/layout/`（**未接入** `packages/shared/src/index.ts`，接入需 S-03 评审通过）
> 相关：[S17-Agent-D-D0-布局数据模型与接口-v1.md](./S17-Agent-D-D0-布局数据模型与接口-v1.md)、[S17-Agent-D-D1-布局引擎测试与文档校验-v1.md](./S17-Agent-D-D1-布局引擎测试与文档校验-v1.md)、[S17-Agent-D-D2-前置-交互模型与状态机草案-v1.md](./S17-Agent-D-D2-前置-交互模型与状态机草案-v1.md)、图表与卡片规格 §5.6、总需求规格 §4。

---

## 1. 提案范围

布局层（E 层）与相邻层之间需要固定的接口只有三类：

1. **分析引用**（布局 ↔ A/B/C 分析定义）：布局只保存“引用 + 展示意图”，不解释参数、不携带任何金额/账本数据。
2. **尺寸与形态契约**（布局 ↔ 卡片家族）：卡片家族声明最小尺寸/尺寸档/兼容入口；布局层只执行与降级，不发明数值。
3. **文档版本与迁移契约**（布局 ↔ 存储/同步/未来版本）：版本号、只读降级、迁移纯函数签名、未知结构保留。

另含两个占位：**容器内部几何**（首版深度 1，布局只把容器当单个对象）与 **Spacer/紧凑的交互边界**。

---

## 2. `AnalysisReference`（草案，已存在于代码，未冻结）

```ts
interface AnalysisReference {
  readonly analysisId: string;        // 分析能力目录 ID（如 "an-b01"）
  readonly analysisVersion?: number;  // 目录版本（可选；省略=按当前实现）
  readonly params: Readonly<Record<string, unknown>>; // 规范化参数（相对/预设优先）
}
```

提案规则：

- 布局/内容文档只存引用，**不得**存分析结果、金额、占比、序列或日期区间展开值；
- `params` 只允许分析目录定义的白名单键（校验在内容文档层完成）；区间优先“相对/预设”写法（如近 30 天），绝对区间仅用于 `pinned`；
- `pinned` 卡片（`rangePolicy: "pinned"`）必须带 `pinnedRange`（`from`/`to`），且标题必须可见标明区间（图表与卡片规格 §8）；
- 未知 `analysisId`：保留占位（卡片位置保留，显示“暂不可用/请重新选择”），不得静默删除对象（分享导入待绑定场景同此规则，Q-15）；`analysisVersion` 不兼容时按“只读占位”处理，不自动改参数；
- 布局层**永不**按金额/结果/数据量改变对象顺序或尺寸（投影排序只依赖源位置与稳定 ID）。

待 S-03 确认：目录 ID 与版本的冻结方式；参数规范化（键排序、数字/枚举）是否由 A 的 S-01 统一提供。

---

## 3. `ObjectSizeContract`（草案，已存在于代码，未冻结）

```ts
interface ObjectSizeContract {
  readonly objectId: string;
  readonly minSize: GridSize;             // 最小可读占格（单元格，不是像素）
  readonly sizeLadder: readonly GridSize[]; // 家族声明的降级档（按顺序尝试）
  readonly compatSize?: GridSize;         // 兼容入口尺寸，默认 1×1
  readonly collapsedSize?: GridSize;      // 容器 1×1 保底尺寸，默认 1×1
  readonly minFullCols?: number;          // 容器完整形态所需最小列数
}
```

提案规则：

- **声明方**：A/B/C 与 Codex 在 W3 随卡片家族提出数值（`minSize` 由原型/真机冻结，OQ-LM-02）；布局层只**执行**，不改卡片内容、不改金额口径。
- `sizeLadder` 顺序即降级顺序（推荐起点；OQ 未定前由家族声明）；布局层过滤掉宽/高小于 `minSize` 的档位。
- 缺契约不阻塞可用性：布局层降级到 **compat 1×1 入口**并记录 `missing-contract`，不得白屏、不得丢卡片。
- 降级/收缩只在“宽度不足”时发生（纵向无限、视口高度不参与投影）；兼容入口不得显示误导性数字（ACC 约束）。
- 密度档（XS–XL，图表与卡片规格 §5.6 阈值候选）是**卡片家族内部**根据真实可用宽高选择的，不在布局文档中持久化；布局层只传真实格子尺寸与形态。
- 容器同理使用 `minFullCols`/`collapsedSize` 字段（当前复用同一类型；若 S-03 认为需要独立 `ContainerGeometryContract`，可在 v1 协议中拆型，仍是 draft 变更）。

建议新增（**未实现**，供 S-03 决定）：`contractVersion?: number`、`maxSize?: GridSize`、`aspectRatioHint?`（仅提示，不锁比例）。

---

## 4. 版本与迁移契约（草案）

| 字段 | 当前值 | 含义 |
|---|---|---|
| `schemaVersion` | 1 | 文档结构版本；每个内容/布局文档各带 |
| `layoutAlgorithmVersion` | 1 | 投影/迁移算法版本（用于派生缓存键） |
| `mode` | `unified` \| `independent` | 统一/独立布局模式 |
| profile 键 | `profileKey`（占位） | 独立档案键（宽度档 vs 精确列数，OQ-LM-08 未定） |

读取规则（与配置与分享方案 §4 一致，提案）：

1. **等于**当前版本：严格校验后使用；
2. **较旧**：纯函数迁移链 vN→vN+1；任一节点失败则该节点降级（保留可用部分/回退默认），**不丢卡片**；
3. **较新**：只读尽力渲染、**不回写**、不删未知字段、提示更新（旧客户端不得覆盖新版）；
4. **校验失败/超限**：回退默认工作台 + 保留原始损坏副本为“上一个布局”，绝不白屏。

建议迁移纯函数签名（**未实现**，W2 契约冻结时补）：

```ts
type MigrateResult<T> = { ok: true; value: T } | { ok: false; issues: readonly DocumentValidationIssue[] };
declare function migrateLayoutDocumentV(input: unknown): MigrateResult<LayoutDocumentV1>;
declare function migrateContentDocumentV(input: unknown): MigrateResult<WorkbenchContentDocumentV1>;
```

缓存键提案：`(权威布局版本, 算法版本, 目标列数, 约束档版本, 内容版本)`；派生结果永不写回权威布局（无累计漂移）。

---

## 5. 容器内部几何占位

- 首版**深度 1**：工作台 → {卡片、Spacer、GridSplit、Carousel} → 卡片；容器内不再嵌容器（`CONTAINER_MAX_DEPTH = 1`）。
- 布局文档只记录容器**外层**几何（锚点/宽高/presentation/expandedSize）；容器**内部结构**（子对象顺序、GridSplit 千分比、Carousel 页）属内容文档（配置与分享方案 §4.5 拆分），由布局层原样保留、从不拆散。
- 内部卡片不参与外层迁移（迁移只处理容器整体）；容器收缩为 1×1 时内部配置逐字节保留，恢复后还原。
- 容器详情（查看全部卡片）入口的“当前展示形态”（full/compact/collapsed）是投影派生值，不与用户主动 `presentation` 混淆（OQ-LM-05/06）。
- 待 W5/Codex：容器内卡片按真实内容区选密度；容器分割线像素级行为由视觉规范决定。

---

## 6. Spacer 与紧凑的交互边界

- Spacer 是**用户主动创建的真实布局对象**：只存在于布局文档，无分析引用、无数据请求、参与迁移；自动紧凑不得把它当作普通空格消除。
- 投影默认**不做垂直紧凑**（OQ-LM-03 未定），因此当前 Spacer 位置稳定；未来紧凑实现必须遵守：Spacer 锚定不上浮、不被穿过、不得因紧凑删除/永久降级（OQ-LM-04 暂用“夹宽”）。
- Spacer 的临时不展示（空间不足）只能写派生标记（`shrunk`/`suppressed`），永不写回权威布局；用户删除才产生删除记录。

---

## 7. 给 A/B/C 与 Codex 的对接清单

**A（分析/结果协议）**
- 布局只消费 `analysisId`(+/`analysisVersion`) 与 `params`；不消费 `AnalysisResult`；`dataVersion` 由计算入口生成，布局不得伪造/缓存替代。
- 布局层不读交易表、不调用统计函数（`packages/shared/src/analysis/layout/` 的静态守卫测试在集成批次加）。

**B（时间/区间）**
- `rangePolicy`：`inherit`（默认，跟随工作台全局筛选）或 `pinned`（必须带相对/预设区间；标题标明）。
- 布局层不改时间筛选、不展开区间；区间解析与校验归 B/详情页。

**C（图表家族）**
- `ChartPresentation.chartFamily` 由卡片/图表侧校验；不兼容时由图表侧降级（CF-10 兜底），布局层不参与家族选择。
- 布局层只保证“给定真实尺寸可渲染”，不承载图表配置语义。

**Codex（视觉）**
- 可从布局层拿：`ProjectionResult`（对象 ID、锚点、宽高、形态、降级原因）、容器状态、选中/焦点、编辑命令应用结果（成功/失败码）。
- 视觉层不得依赖布局内部实现（行优先公式/贪心细节）；动画/手柄/网格线由 Codex 定，逻辑层只给合法/非法判定。

**Lead / 集成**
- 本目录只从目录内 barrel 导出；接入 `packages/shared/src/index.ts`、页面与路由由集成批次（Lead/S-03）执行。
- 静态守卫、性能预算、跨设备回归在集成批次补。

---

## 8. S-03 评审请求（具体问题）

1. 是否接受上述 `AnalysisReference`/`ObjectSizeContract` 作为 S-03 v1 草案（保持 draft 直至 W3 数值冻结）？
2. 卡片尺寸契约的**声明方与冻结时点**：W3 随批 1 家族声明、原型/真机冻结，是否符合 S-03 计划？
3. 是否需要拆出 `ContainerGeometryContract`（容器专属字段）而不是复用 `ObjectSizeContract`？
4. 容器内部几何（深度 1、内部结构归内容文档）是否与 S-01/C 侧卡片配置所有权一致？
5. 迁移函数签名与缓存键（§4）是否纳入 S-03 的版本契约？
6. 未知 `analysisId`/版本不兼容的“只读占位”行为是否与分享导入（Q-15 待绑定）统一？

## 9. 状态与变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-27 | draft v0.1 | 初稿：引用/尺寸契约/版本迁移/容器占位/Spacer 紧凑边界 + 评审问题 |

> 本文件随 S-03 评审更新；任何字段形状变化须同时改代码、D0/D1/D2 文档与测试，并在任务文档 §6.2 记录。
