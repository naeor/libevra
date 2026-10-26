# S17 · Agent C · S-01 v2 评审材料：G-16 分类层级模型正式定义（C-2 / P05–P07）

> 作者：`DS-S17-C-Advanced`（Agent C）；日期：2026-10-27。
> 状态：**DRAFT 正式定义文本**，供 Lead 转 Agent A 合并进 `S17-Agent-A-S01-v2-结构草案.md`（G-16）。
> 权威实现：`packages/shared/src/analysis/advanced/{draftTypes,hierarchy,sankey}.ts`（C-3 交付，rebase 后实现提交 `c633d80`，文档回填 `d8970e1`）。
> 相关 QC：**QC-26**（`HierarchyResult` 结果形状）、**QC-27**（`DraftCategoryRelation` 输入占位 / 依赖数据模型扩展）、**QC-28**（派生桑基形状与门控）。
> 本轮不改 A 文件；本文是 C 侧给出的可引用定义，A 合并后以 A 的 v2 文本为准。

---

## 1. 定义对象与定位

| 项 | 定义 |
|---|---|
| 对象 | `DraftCategoryRelation` —— **分类父子关系输入 DTO**，不是分析结果形状 |
| 定位 | 对应所有者规格 P05/P06/P07 的「真实分类层级」需求；当前 `Category` 模型无 `parentId`（QC-03），本 DTO 是**模型扩展前的显式输入占位**，由未来 `Category.parentId` 或经授权的上层投影提供 |
| 禁止 | 不得根据分类名称、排序、金额或名称相似度**推断**父子关系；无关系输入时必须显式「无真实层级」 |
| 归属 | 输入 DTO（T4 依赖模型扩展）；结果形状是 `HierarchyResult`（QC-26）；桑基是派生投影（QC-28） |

## 2. 形状定义（正式字段文本）

```ts
/** 分类层级关系的一行（占位输入；不是数据模型，见 QC-27）。 */
export interface DraftCategoryRelation {
  /** 分类主键；与账本内 Category.id 同值。唯一，不得重复出现。 */
  readonly categoryId: string;
  /** 展示标签（仅用于图例/表格；允许为「暂无分类」等系统名）。不参与分组主键。 */
  readonly categoryLabel: string;
  /** 父分类主键；`null` = 顶层分类。指向未声明分类时见 §3 孤立处理。 */
  readonly parentCategoryId: string | null;
}
```

约束补充：

- 字段仅此三个；**不得**携带金额、笔数、层级深度、顺序或账本 ID（金额由交易记录提供，避免输入 DTO 与结果双写）。
- `categoryId` / `categoryLabel` 长度与现网 `Category` 约束一致（name ≤ 上限见 `ledger.ts`）；`parentCategoryId` 只允许出现在关系表中已声明的分类上，或按 §3 记为孤立引用。
- 同一账本内关系表必须**完整描述被引用的父子边**；允许「只声明部分分类」——未声明的分类按 §3 显式标记，不推断其父级。

## 3. 输入约束与拒绝行为（实现语义，已测）

| 输入情况 | 处理 | 结果标记 |
|---|---|---|
| 同一 `categoryId` 出现两行（重复声明） | **拒绝**（`RangeError`） | 调用方必须先去重，不静默取其一 |
| `parentCategoryId === categoryId`（自我父级） | **拒绝**（`RangeError`） | — |
| 父子边构成环（A→B→A） | **拒绝**（`RangeError`，带链路） | 不自动断环、不按名称猜 |
| `parentCategoryId` 指向未声明分类（**孤立父引用**） | 该子分类**按顶层处理**并登记 | `orphanRelationCategoryIds` 非空；`isRealHierarchy=false` |
| 交易记录出现关系表中未声明的分类（历史/归档） | 建立 `category` 节点 | 节点 `hasMissingRelation=true`；结果 `hasUnknownCategories=true`；`isRealHierarchy=false` |
| 关系表为空 | 退回**扁平单层** | `isRealHierarchy=false`；`hasUnknownCategories=false` |
| 关系表只有真实父子边且被引用分类全部声明 | 正常层级 | `isRealHierarchy=true`；`hasUnknownCategories=false` |
| 混币 / 负金额 / 非 `expense`/`income` 记录 | **拒绝**（`RangeError` 或显式 `unavailable`） | 不混加、不取绝对值 |
| 零金额子树（子级无任何记录） | 不输出该子树节点（保留合成根） | 避免空节点撑大层级 |

> 「父级不重复计子」的实现：每笔交易只归属**一个**分类节点；节点金额拆成
> `directAmountMinor`（自身直接金额）与 `subtreeAmountMinor`（自己 + 全部后代），
> 父级金额 = 自身直接金额 + Σ 子级子树金额，**不得**把子级金额再加一遍到 direct。

## 4. 不变量（守恒四项，必须成立）

| 不变量 | 形式化定义 | 判定 |
|---|---|---|
| `rootSubtreeAmountMinor` | `root.subtreeAmountMinor = totalAmountMinor`（root 是合成根，`HIERARCHY_ROOT_ID="__root__"`，不作为业务分类展示） | 数值相等 |
| `nodesConserved` | 对每个非根节点：`subtreeAmountMinor = directAmountMinor + Σ children.subtreeAmountMinor` | 布尔 |
| `noDoubleCounting` | `Σ 所有节点 directAmountMinor = root.subtreeAmountMinor`（每笔交易只计入一个节点） | 布尔 |
| `edgesConserved` | 每条金额路径在叶子或 `direct` 终端结束；`Σ root 出边子树 = root.subtree` | 布尔 |

辅助函数：`hierarchyIsConserved(result)`（四项全真）；`hierarchyIsUsable(result)` = **`isRealHierarchy && !hasUnknownCategories && completeness === "complete"`**。
展示门控：`hierarchyIsUsable` 为假时，**旭日图与桑基拒绝启用并给出原因**；矩形树图允许退化为单层扁平（面积仍 = 金额占比，但不得暗示父子关系）；层级表显示扁平清单 + 「当前无分类层级（数据模型依赖）」说明。

## 5. 结果形状 `DraftHierarchyResult`（QC-26，供 v2 引用）

```ts
export interface DraftHierarchyResult {
  readonly rootId: string;                       // 恒为 HIERARCHY_ROOT_ID
  readonly metric: "expense" | "income";
  readonly currency: string;                     // 单币种；混币在输入层拒绝
  readonly nodes: readonly DraftHierarchyNode[];
  readonly maxDepth: number;                     // 最深节点深度（含 direct 终端）
  readonly isRealHierarchy: boolean;
  readonly hasUnknownCategories: boolean;
  readonly orphanRelationCategoryIds: readonly string[];
  readonly totalAmountMinor: bigint;             // 与 root.subtreeAmountMinor 相等
  readonly totalCount: number;                   // 笔数（金额是权威，笔数附带）
  readonly conservation: {
    readonly rootSubtreeAmountMinor: bigint;
    readonly nodesConserved: boolean;
    readonly noDoubleCounting: boolean;
    readonly edgesConserved: boolean;
  };
  readonly completeness: "complete" | "no-transactions" | "unavailable";
}
```

`DraftHierarchyNode`：`nodeId/parentId/depth/kind("root"|"category"|"direct")/label/directAmountMinor/directCount/subtreeAmountMinor/subtreeCount/childCount/isLeaf/hasMissingRelation`；顶层分类的 `parentId = HIERARCHY_ROOT_ID`（**不是 null**，唯一例外是合成根自身的 parentId 为 `null`）。

## 6. 与派生桑基（QC-28）的关系

`buildHierarchySankey(result)` 是 `DraftHierarchyResult` 的**纯投影**，不重新聚合金额：

- 连线：合成根 → 顶层分类（`subtreeAmountMinor`）＝父级 → 子级（子级 `subtreeAmountMinor`）＝父级 → 「直接金额」终端（`${categoryId}::direct`，`directAmountMinor`，仅当该节点既有子级又有直接金额时产生）；
- 桑基节点 `kind` 与层级节点一致；直接终端是叶子；
- 守恒四项：`rootOutflowMatchesTotal`、`allInflowsMatch`、`outflowConserved`、`noNegativeLinks`；
- 连线数上限 `MAX_SANKEY_LINKS = 4000`：超限**不得截断金额**（截断破坏守恒），应交由图表输入层门控（拒绝并退回层级表）；
- 桑基只表示**真实层级金额归属**；禁止用「收入→支付方式→消费」等非层级连线冒充资金流（owner 规格 §23）。

## 7. 常量

| 常量 | 值 | 含义 |
|---|---|---|
| `HIERARCHY_ROOT_ID` | `"__root__"` | 合成根节点 ID（不作为业务分类展示） |
| `HIERARCHY_DIRECT_SUFFIX` | `"::direct"` | 桑基直接金额终端 ID 后缀 |
| `MAX_HIERARCHY_NODES` | `2000` | 层级计算节点上限（超出拒绝，不静默截断） |
| `MAX_SANKEY_LINKS` | `4000` | 桑基连线上限（同上） |

## 8. 测试证据

- shared `packages/shared/src/analysis/advanced/batch3.test.ts`：15 项（真实层级/扁平/叶/直接终端/循环/自我父级/重复声明/孤立父引用/历史未声明分类/空/混币/负金额 + 桑基 3 项）；
- web `apps/web/src/analysis/{adapters4,geometry4}.test.ts`：31 项（门控原因、层级表、旭日、Treemap 扁平、桑基守恒与布局）；
- 当前 HEAD `6dfbf82`：shared typecheck 0、26 文件/473 测试；web typecheck 0、162 文件/1502 测试。

## 9. 给 A 合并进 S-01 v2 的建议文本（G-16）

> **G-16（分类层级输入 DTO）**：`CategoryRelation{categoryId, categoryLabel, parentCategoryId: string | null}` 为 C 侧 P05/P06/P07 的**显式输入占位**（当前模型无 `parentId`，属数据模型扩展依赖，QC-27）；不得由名称/顺序/金额推断。结果形状 `HierarchyResult` 见 QC-26（含 `isRealHierarchy`/`hasUnknownCategories`/`orphanRelationCategoryIds` + 四项守恒）；派生桑基 `SankeyResult` 见 QC-28（纯投影、四项守恒、≤4000 连线、`!isRealHierarchy` 时拒绝启用）。无模型批准时结果必须 `isRealHierarchy=false`，图表门控见 QC-26/QC-28。

## 10. 维护与提交号

- 本文与代码的权威路径：`docs/specs/product/s17-agents/S17-Agent-C-S01-v2评审-C-2-分类层级模型正式定义.md`、`packages/shared/src/analysis/advanced/{draftTypes,hierarchy,sankey}.ts`；
- 相关提交：C-3 实现 `11b31bb`（rebase 后 `c633d80`）、回填 `d8970e1`；本文所在提交见 §6.2 与 Lead 报告（不 push）。
- 维护规则：A 合并进 v2 后，本文件保留为「C 侧来源」，不随 v2 修改而改写；差异由 v2 文本负责。
