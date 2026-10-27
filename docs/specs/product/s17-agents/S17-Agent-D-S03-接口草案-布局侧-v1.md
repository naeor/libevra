# S17 · Agent D · S-03 接口草案（布局侧，draft v0.4，**未冻结**）

> 最后核对: `7d9f9fc`（1.16.23 rebase 后）；评审修订记录整理 2026-10-27；D-3.1 档案引擎 2026-10-27
> 状态：**DRAFT v0.4，未冻结**（Lead 六问裁定记录见 §8；OQ-LM 待决项逐条登记见 §8.2；D-3.1 已落地独立档案/模式迁移与 G-12b，见 §4.5/§9；D-4 已落地迁移链/缓存键/分享与存储纯函数，见 §4/§9；数值冻结仍待 W3；本文件不构成公共接口）
> 提交方：`DS-S17-D-Layout`；评审方：Lead（S-03 组织者）、A（计算侧）、Codex（视觉侧）
> 代码位置：`packages/shared/src/analysis/layout/`（**未接入** `packages/shared/src/index.ts`，接入需 S-03 评审通过）
> 相关：[S17-Agent-D-D0-布局数据模型与接口-v1.md](./S17-Agent-D-D0-布局数据模型与接口-v1.md)、[S17-Agent-D-D1-布局引擎测试与文档校验-v1.md](./S17-Agent-D-D1-布局引擎测试与文档校验-v1.md)、[S17-Agent-D-D2-前置-交互模型与状态机草案-v1.md](./S17-Agent-D-D2-前置-交互模型与状态机草案-v1.md)、[S17-Agent-D-D3-跨列迁移-修复顺序-容器语义-v1.md](./S17-Agent-D-D3-跨列迁移-修复顺序-容器语义-v1.md)、[S17-Agent-D-D3-1-独立档案与模式迁移引擎-v1.md](./S17-Agent-D-D3-1-独立档案与模式迁移引擎-v1.md)、图表与卡片规格 §5.6、总需求规格 §4。

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
- 未知 `analysisId`：保留占位（卡片位置保留，显示“暂不可用/请重新选择”），不得静默删除对象；**Lead 裁定（2026-10-27）：一律“只读占位 + 提示更新”，不回写、不删未知字段**；`analysisVersion` 不兼容时同样只读占位，不自动改参数。分享导入的兼容策略待 Q-15 绑定，先登记为 S-03 未决依赖；
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

- **声明方（Lead 裁定 2026-10-27）**：卡片家族在 W3 批 1 声明数值、由原型/真机冻结（OQ-LM-02）；**W3 前只登记占位数值，任何数值不得被其他层发明**；布局层只**执行**，不改卡片内容、不改金额口径。
- `sizeLadder` 顺序即降级顺序（推荐起点；OQ 未定前由家族声明）；布局层过滤掉宽/高小于 `minSize` 的档位。
- 缺契约不阻塞可用性：布局层降级到 **compat 1×1 入口**并记录 `missing-contract`，不得白屏、不得丢卡片。
- 降级/收缩只在“宽度不足”时发生（纵向无限、视口高度不参与投影）；兼容入口不得显示误导性数字（ACC 约束）。
- 密度档（XS–XL，图表与卡片规格 §5.6 阈值候选）是**卡片家族内部**根据真实可用宽高选择的，不在布局文档中持久化；布局层只传真实格子尺寸与形态。
- 容器**暂不拆** `ContainerGeometryContract`（Lead 裁定 2026-10-27）：沿用 `ObjectSizeContract`，容器专属字段（`presentation`/`expandedSize`）留在布局文档的对象级；W5 若复杂度上升再评估拆型。

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

**Lead 裁定（2026-10-27）**：迁移函数签名**纳入** S-03 的版本契约（纯函数、逐版本节点降级规则，见下方签名草案）；缓存键派生规则只作为实现约定登记，**不进冻结契约**。默认迁移策略 `size-first`（S）已按 OQ-LM-01 锁定，`position-first` 仅作对照。

迁移纯函数签名（**D-4 已落地** 在 `migration-chain.ts`；S-03 冻结时以本节语义为准，实现可内部重构但行为不变）：

```ts
type MigrationStatus = "identity" | "migrated" | "degraded" | "failed" | "read-only-newer";
interface MigrationStep<T> {
  readonly from: number;
  readonly to: number;
  migrate(value: unknown): DocumentValidationResult<T>; // 纯函数，不抛异常
}
declare function runMigrationChain<T>(
  value: unknown,
  options: { steps: readonly MigrationStep<T>[]; targetVersion: number; validate(value: unknown): DocumentValidationResult<T> },
): MigrationChainResult<T>;
declare function migrateLayoutDocument(value: unknown): MigrationChainResult<LayoutDocumentV1>;
declare function migrateContentDocument(value: unknown): MigrationChainResult<WorkbenchContentDocumentV1>;
```

- 迁移步骤失败 → 保留**迁移前最后一个合法文档**（`degraded` + `migration-failed`）；缺步骤 → `failed`；较新 → `read-only-newer` + `schema-newer-readonly`（不回写、不删未知字段）；逐节点降级细则待 v2 形状确定后补（当前步表为空，v1 即最新）。
- 缓存键（实现约定，不进冻结契约）：`(权威布局版本, 算法版本, 目标列数, 约束档版本, 内容版本, 策略)`，D-4 已实现 `deriveProjectionCacheKey`；派生结果永不写回权威布局（无累计漂移）。

---

## 4.5 独立布局档案与模式迁移（D-3.1 实现，仍 draft）

- 模式：`LayoutMode = "unified" | "independent"`；`main` 为唯一权威主布局，`profiles[]`（`{ profileKey, geometry }`）为可选档案；`previousMain` 只用于保留上一个布局。
- 解析：`resolveProfile(layout, content, { targetColumns, profileKey?, contracts?, verticalCompact? })` → `{ targetColumns, profileKey, projection, geometry, source: "profile" | "main-projection", issues }`。
  - 统一模式：始终由 `main` 投影（即使存在档案也不使用）；独立模式：有对应档案用档案几何，无档案从 `main` 投影且**不物化**。
  - 非法 `targetColumns` → 2 + `invalid-columns`；空/非法 `profileKey` → 派生占位键 + `invalid-profile-key`；投影问题映射为 `projection-<reason>`；纯函数，不改输入。
- 物化（写时复制）：`materializeProfile(...)` → `{ layout, created, issues }`；首次保存才写入档案，已有档案幂等返回 `created=false`；档案键不可派生 → `profile-key-unavailable`；结果过 D-1 校验。
- 模式切换：`switchLayoutMode(layout, mode)` 保留 `main`/`profiles` 数据（统一→独立不物化；独立→统一档案保留但不用）；`adoptProfileAsMain(layout, profileKey)` 以档案为新 `main`、`previousMain` 留旧布局、`profiles` 保留；缺档案 → `missing-profile`。
- 诊断：`findUnplacedContentObjects(content, layout)` 列出无几何条目的内容对象（排序），只提示、不自动补位。
- 档案键占位（OQ-LM-08 未决）：默认 `exact-columns`（`cols-<n>`）；宽度档表为空时 `profileKeyForWidth` 返回 `null`，**不猜阈值**；档案内分割比例当前按内容文档共用。
- G-12b：`ShareImportOptions.resolveAnalysisVersion` 返回 `newer`/`unknown` 时导入不失败、保留引用/参数、登记 `analysis-version-readonly`（只读占位），与 `resolveAnalysis`（`analysis-needs-rebind`）互补。
- 明细见 [D-3.1 记录](./S17-Agent-D-D3-1-独立档案与模式迁移引擎-v1.md)。

---

## 5. 容器内部几何占位

- 首版**深度 1**：工作台 → {卡片、Spacer、GridSplit、Carousel} → 卡片；容器内不再嵌容器（`CONTAINER_MAX_DEPTH = 1`）。
- 布局文档只记录容器**外层**几何（锚点/宽高/presentation/expandedSize）；容器**内部结构**（子对象顺序、GridSplit 千分比、Carousel 页）属内容文档（配置与分享方案 §4.5 拆分），由布局层原样保留、从不拆散。
- 内部卡片不参与外层迁移（迁移只处理容器整体）；容器收缩为 1×1 时内部配置逐字节保留，恢复后还原。
- 容器**只表达展开/折叠与占位，不解释内部内容**（Lead 裁定 2026-10-27）：布局层只记录容器外层几何与 `presentation`/`expandedSize`，内部卡片内容、图表配置、筛选与分割比例归内容文档/卡片侧，布局层原样保留、从不拆散。
- 容器详情（查看全部卡片）入口的“当前展示形态”（full/compact/collapsed）是投影派生值，不与用户主动 `presentation` 混淆（OQ-LM-05/06）。
- 待 W5/Codex：容器内卡片按真实内容区选密度；容器分割线像素级行为由视觉规范决定。

---

## 6. Spacer 与紧凑的交互边界

- Spacer 是**用户主动创建的真实布局对象**：只存在于布局文档，无分析引用、无数据请求、参与迁移；自动紧凑不得把它当作普通空格消除。
- 紧凑：2026-10-27 所有者方向**支持垂直紧凑**，但要求“不得裁切真实内容、空间不足保留展开/详情入口”；已按 D-OQ-03a/b/c 落实内容约束与 Spacer 不被紧凑消除。**组合方式 (a)、默认启用顺序与“明确保存的位置”仍待所有者（DIFF-01）**，因此 D-3 的 `ProjectOptions.verticalCompact` 暂保持默认 `false`，待 DIFF-01 明确后按实现批次调整。
- Spacer 窄屏降级：按 2026-10-27 所有者方向**已落定**（D-OQ-04）：夹宽 + 投影调整显示尺寸/位置，不删除、不写回权威主布局、派生可重复计算且反复切换宽度不漂移；原 OQ-LM-04 候选 a（夹宽）被采纳，候选 b/c 暂不需要。
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

## 8. S-03 评审结果（Lead 裁定，2026-10-27）

| # | 问题 | 裁定 |
|---|---|---|
| 1 | `AnalysisReference`/`ObjectSizeContract` 是否作为 S-03 v1 草案 | **接受**，保持 draft 直至 W3 数值冻结 |
| 2 | 尺寸契约声明方与冻结时点 | **卡片家族 W3 批 1 声明、原型/真机冻结**；W3 前只登记占位数值，其他层不得发明数值 |
| 3 | 是否拆 `ContainerGeometryContract` | **暂不拆**：容器沿用 `ObjectSizeContract`，`presentation`/`expandedSize` 留在布局文档对象级；W5 再评估 |
| 4 | 容器内部几何与 C 侧所有权是否一致 | **一致**；补“容器只表达展开/折叠与占位，不解释内部内容” |
| 5 | 迁移签名与缓存键是否纳入版本契约 | **迁移签名纳入**（纯函数、逐版本节点降级规则）；**缓存键仅实现约定**，不进冻结契约 |
| 6 | 未知 `analysisId`/版本不兼容行为 | **只读占位 + 提示更新**，不回写、不删未知字段；分享导入兼容策略待 Q-15 绑定（S-03 未决依赖） |

补充裁定：OQ-LM-01 默认布局算法**锁定 `size-first`（S）**；`position-first` 仅作对照策略保留，不必等裁定。

### 8.1 裁定版本说明

- 六问裁定针对 **v0.1 初稿**（D-2 前置提交时评审）；此后文档按裁定与实现更新为 v0.2（裁定记录）与 v0.3（D-4 实现记录），**版本递增不改变“保持 draft、未冻结”的性质**。
- 冻结时点：W3 卡片家族尺寸数值由原型/真机冻结后，随 S-03 一并评审升版；在此之前任何字段形状变化仍须同步代码、D0–D4 文档与测试，并在任务文档 §6.2 记录。
- 本文件不代表公共接口已冻结；不存在“保持 v0.1 文本不变”的约束——v0.1 仅作为评审基线在 §9 留痕。

### 8.2 OQ-LM 待决项登记（2026-10-27，Lead 指令整理）

| OQ | 主题 | 状态 | 阻塞阶段 | 当前占位口径 | 裁定方 |
|---|---|---|---|---|---|
| OQ-LM-01 | 行尾放不下/迁移策略（S/P/L） | **已裁定：锁定 `size-first`（S）** | 已解除 | `strategy` 默认 `"size-first"`；`position-first` 仅作对照 | Lead（2026-10-27） |
| OQ-LM-02 | 尺寸降级顺序与最小可读（`minSize`/`sizeLadder`） | 待声明/冻结 | W3 声明 → W5 使用 | 家族 `sizeLadder` 顺序；缺契约→compat 1×1 | A/B/C 卡片家族 + 原型/真机（W3） |
| OQ-LM-03 | 垂直紧凑与投影组合、Spacer 空行、“明确保存位置”含义 | **部分落实（2026-10-27 所有者方向）**：支持紧凑/不裁切/保留入口已落实为 D-OQ-03a/b/c；组合方式与“明确保存位置”仍待所有者（DIFF-01） | 阻塞 W5 | 投影 `verticalCompact` 暂默认 `false`（D-3）；Spacer 锚定不上浮 | 所有者（W5 前） |
| OQ-LM-04 | Spacer 窄屏降级（夹宽/限高/折叠） | **已落实（2026-10-27 所有者方向，D-OQ-04）** | 已解除 | 夹宽 + 投影调整显示尺寸/位置；不删除、不回写权威主布局、派生无漂移 | 所有者已给出方向；D 记录 |
| OQ-LM-05 | 1×1 容器入口 UI 与完整查看（A/B/C 候选） | **部分落实（2026-10-27）**：浏览/编辑分离、Carousel 横滑、展开入口（覆盖层/详情）、编辑态进容器内部、手势冲突原则已落实为 D-OQ-05a–d；1×1 入口 UI 与完整查看选型仍待所有者（DIFF-02 / OQ-UI-12） | 阻塞 W5 | 展开入口采用覆盖层或详情视图、不改变外层几何；UI 未实现 | 所有者 + Codex（原型后） |
| OQ-LM-06 | 自动 vs 主动收缩字段与编辑表现 | **已落实（2026-10-27 所有者方向，D-OQ-06）** | W2 已预留字段；编辑表现待原型 | 不默认全缩 1×1；1×1 与恢复入口必保留；收缩纯展示；`presentation`/`expandedSize`/派生 `form` 语义不变 | 所有者已给出方向；D 记录 |
| OQ-LM-07 | 统一模式跨列编辑写回（M1/M2/M3） | **待所有者（所有者方向未覆盖原问题）**：所给为编辑交互要求，未回答 M1/M2/M3 落点（DIFF-03） | 阻塞 W5 写回 / W6 | 暂用 M1 + 提示作占位，未裁定；写回 UI 未实现 | 所有者（需重新明确跨列写回） |

注：OQ-LM-02/08/09/11/12 等其他未决项见任务文档 §7 与布局规格 §20.2；本表覆盖 Lead 2026-10-27 指令列明的 OQ-LM-01/03/04/05/06/07（01 已锁定、02 作为尺寸契约边界一并登记）。所有者 2026-10-27 八项产品方向的逐条核对与差异（含 OQ-CF）见 [S17-Agent-D-OQ落实与差异清单-v1.md](./S17-Agent-D-OQ落实与差异清单-v1.md)；本表状态按其更新。

## 9. 状态与变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-27 | draft v0.1 | 初稿：引用/尺寸契约/版本迁移/容器占位/Spacer 紧凑边界 + 评审问题 |
| 2026-10-27 | draft v0.2 | 记录 Lead 六问裁定（见 §8）；迁移签名纳入契约、缓存键降为实现约定；暂不拆 `ContainerGeometryContract`；容器只表达展开/折叠与占位；OQ-LM-01 锁定 S |
| 2026-10-27 | draft v0.3 | D-4 落地版本契约实现：迁移链五状态与签名（§4）、缓存键派生、文档 IO、分享快照白名单/短码纯函数、导入校验管道、本地存储合并契约；仍 draft、未接包入口、不含服务端（详见 [D-4 记录](./S17-Agent-D-D4-前置-文档IO-迁移链-导入-存储契约-v1.md)） |

| 2026-10-27 | draft v0.3（评审修订记录整理） | 按 Lead 指令整理 §8：保留六项裁定 + 新增 §8.1 裁定版本说明（裁定针对 v0.1，现内容累计 v0.2/v0.3，性质仍为 draft 未冻结）与 §8.2 OQ-LM 待决项登记表（OQ-LM-01/03/04/05/06/07 的状态/阻塞阶段/占位口径/裁定方）；无接口内容实质变化 |

| 2026-10-27 | draft v0.4 | 记录所有者 2026-10-27 OQ 方向核对结果：OQ-LM-04/06 落实为正式决定（D-OQ-04/06）；OQ-LM-03/05 部分落实并保留差异（DIFF-01/02）；OQ-LM-07 方向未覆盖原问题、保持待所有者（DIFF-03）；§6 紧凑/Spacer 口径同步更新；明细见 [OQ 落实与差异清单](./S17-Agent-D-OQ落实与差异清单-v1.md) |

| 2026-10-27 | draft v0.5 | D-3.1 落地独立档案/模式迁移契约（§4.5）：`resolveProfile`/`materializeProfile`/`switchLayoutMode`/`adoptProfileAsMain`/`findUnplacedContentObjects`、`cols-*` 档案键占位（OQ-LM-08 未决）；导入侧 G-12b `resolveAnalysisVersion` 只读占位（`analysis-version-readonly`）；18 files / 234 tests 通过；明细见 [D-3.1 记录](./S17-Agent-D-D3-1-独立档案与模式迁移引擎-v1.md) |

> 本文件随 S-03 评审更新；任何字段形状变化须同时改代码、D0/D1/D2/D3 文档与测试，并在任务文档 §6.2 记录。
