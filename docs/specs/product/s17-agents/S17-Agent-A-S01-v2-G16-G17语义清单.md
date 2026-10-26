# S-01 v2 冻结前核验 · G-16 / G-17 语义清单

> 状态：**核验材料（交所有者确认，不冻结）**。依据 Lead m02553（所有者原则批准 + 七项决定第 1 条）。
> 来源：v2 结构草案 §13（G-17，B §16 @ `7405194`／首次落盘 `f3bd4d6`）、§14（G-16，C 正式定义 @ `465d21e`／回填 `dc91f35`）、§15（C-4，`465d21e`）。本清单只**整理语义**，不改写来源方定义；实现以来源 Agent 代码/测试为准（G-16：C `packages/shared/src/analysis/advanced/{draftTypes,hierarchy,sankey}.ts`；G-17：B `packages/shared/src/fxDetail.ts`）。

## G-16 · 分类层级模型（`DraftCategoryRelation` → `DraftHierarchyResult` → 桑基投影）

### G16-1 输入（输入 DTO，不是结果形状）

| 字段 | 类型 | 语义与约束 |
|---|---|---|
| `categoryId` | `string` | 分类主键，与账本内 `Category.id` 同值；同一关系表内**唯一**，不得重复出现 |
| `categoryLabel` | `string` | 展示标签（含「暂无分类」等系统名）；**不参与分组主键** |
| `parentCategoryId` | `string \| null` | 父分类主键；`null` = 顶层分类；指向未声明分类时按 G16-3 孤立处理 |

约束：只允许这三个字段；**不得携带**金额、笔数、层级深度、顺序或账本 ID；不得按分类名称/排序/金额/相似度**推断**父子关系；无关系输入时必须显式「无真实层级」；允许只声明部分分类（未声明分类按 G16-3 显式标记，不推断父级）。

### G16-2 输入与输出

- **输出形状**：`DraftHierarchyResult`（QC-26）——`rootId`（恒 `HIERARCHY_ROOT_ID="__root__"`）、`metric:"expense"|"income"`、`currency`、`nodes[]`、`maxDepth`、`isRealHierarchy`、`hasUnknownCategories`、`orphanRelationCategoryIds[]`、`totalAmountMinor: bigint`、`totalCount`、`conservation{rootSubtreeAmountMinor: bigint, nodesConserved, noDoubleCounting, edgesConserved}`、`completeness:"complete"|"no-transactions"|"unavailable"`。
- **节点** `DraftHierarchyNode`：`nodeId`、`parentId`、`depth`、`kind:"root"|"category"|"direct"`、`label`、`directAmountMinor: bigint`、`directCount`、`subtreeAmountMinor: bigint`、`subtreeCount`、`childCount`、`isLeaf`、`hasMissingRelation`。顶层分类 `parentId = "__root__"`（不是 null）；唯一例外：合成根自身 `parentId = null`。
- **桑基投影**（QC-28）：`buildHierarchySankey(result)` 是 `DraftHierarchyResult` 的**纯投影**，不重新聚合金额——连线=合成根→顶层分类（`subtreeAmountMinor`）、父级→子级（子级 `subtreeAmountMinor`）、父级→直接金额终端 `${categoryId}::direct`（`directAmountMinor`，仅当节点既有子级又有直接金额）；禁用以「收入→支付方式→消费」等非层级连线冒充资金流。

### G16-3 空值 / 异常语义与拒绝行为（实现语义，已测）

| 情况 | 处理 | 结果标记 |
|---|---|---|
| 同一 `categoryId` 重复声明 | **拒绝** | 调用方 `RangeError`，不静默取其一 |
| `parentCategoryId === categoryId`（自我父级） | **拒绝** | `RangeError` |
| 父子边成环（A→B→A） | **拒绝**（带链路） | `RangeError`；不自动断环 |
| `parentCategoryId` 指向未声明分类（孤立父引用） | 子分类**按顶层处理**并登记 | `orphanRelationCategoryIds` 非空；`isRealHierarchy=false` |
| 交易出现关系表未声明分类（历史/归档） | 建立 `category` 节点 | 节点 `hasMissingRelation=true`；`hasUnknownCategories=true`；`isRealHierarchy=false` |
| 关系表为空 | 退回**扁平单层** | `isRealHierarchy=false`；`hasUnknownCategories=false` |
| 关系表只有真实边且被引用分类全部声明 | 正常层级 | `isRealHierarchy=true`；`hasUnknownCategories=false` |
| 混币 / 负金额 / 非 `expense|income` 记录 | **拒绝**（`RangeError` 或显式 `unavailable`） | 不混加、不取绝对值 |
| 零金额子树（子级无任何记录） | 不输出该子树节点（保留合成根） | 避免空节点撑大层级 |
| 节点数超 `MAX_HIERARCHY_NODES=2000` | 拒绝启用（结果 `unavailable`/调用方拒绝） | **不静默截断** |

> 错误语义总则：G-16 是**输入 DTO + 纯函数**，输入错误用 `RangeError` 表达（调用方错误）；不可用/门控用结果 `completeness:"unavailable"` + 原因；协议层只冻结「拒绝/降级/标记」语义，具体异常消息不是协议内容。

### G16-4 守恒与展示门控

- 守恒四项（定义见 v2 §14.4）：`rootSubtreeAmountMinor = totalAmountMinor`；`nodesConserved`：`subtreeAmountMinor = directAmountMinor + Σ children.subtreeAmountMinor`；`noDoubleCounting`：`Σ directAmountMinor = root.subtreeAmountMinor`；`edgesConserved`：金额路径止于叶子或 `direct` 终端。
- `hierarchyIsConserved(result)`：四项全真；`hierarchyIsUsable(result)` = `isRealHierarchy && !hasUnknownCategories && completeness === "complete"`。
- 展示门控：`hierarchyIsUsable` 为假时——**旭日图与桑基拒绝启用并给出原因**；矩形树图允许退化为**单层扁平**（面积仍=金额占比，不得暗示父子关系）；层级表显示扁平清单 + 「当前无分类层级（数据模型依赖）」说明。

### G16-5 币种与精度

- `currency` 为**单币种**；混币在输入层拒绝，不折算、不跨币种相加。
- 金额一律 `bigint` 最小单位（与 S-01 主合同一致）；层级/桑基只做**整数加减**，无舍入。
- 桑基连线数与层级表行数是展示上限：`MAX_SANKEY_LINKS=4000`、`C_HIERARCHY_TABLE_MAX_ROWS=500`；超限由图表输入层门控（拒绝/截断**行**但金额合计仍用全量），**不得截断金额或连线金额**。

### G16-6 依赖与冻结影响

- 依赖 `Category.parentId` 数据模型扩展（QC-03/QC-27，未批准）——本组为「模型扩展前的显式输入占位」，冻结不代表批准迁移。
- 常量（v2 §14.7）：`HIERARCHY_ROOT_ID="__root__"`、`HIERARCHY_DIRECT_SUFFIX="::direct"`、`MAX_HIERARCHY_NODES=2000`、`MAX_SANKEY_LINKS=4000`（已入常量汇总表 #19–#22）。

---

## G-17 · 综合模式 FX 逐笔/逐日投影（`FxDetailedAggregate`）

### G17-1 输入与输出

- **输入**：调用方**已按权限/软删/日期预过滤**的 `FxEntry[]`（`packages/shared/src/fx.ts` 既有类型）、目标币种 `target`、汇率快照 `rates`、可选 `cache`、`FxDetailOptions{includeEntries?: boolean (默认 false), maxEntries?: number}`。
- **输出**：`FxDetailedAggregate extends FxAggregate { detail: FxAggregateDetail }`；`FxAggregateDetail { daily: Readonly<Record<string, FxTotals>>; entries: readonly FxConvertedEntry[] | null }`；`FxConvertedEntry { id, bookId, date(occurredLocalDate), kind:"income"|"expense"（D-05 裁掉 transfer）, categoryId, targetMinor:string, originalMinor:number, originalCurrency, rateDate:string|null, rateCached:boolean, needsReview:boolean }`。
- 入口：`aggregateFxDetailed(accountId, bookId, entries, target, rates, cache?, detail?)`、`aggregateFxDetailedAsync(...)`；月键 `fxRangeMonths(from, to, maxMonths = 36)`。
- **不新增端点、不改既有 `FxAggregate`/`aggregateFx`/`aggregateFxAsync`**（纯 additive；唯一消费方 `apps/web/src/lib/fxView.ts` 零改动）。

### G17-2 空值语义

| 情形 | 语义 |
|---|---|
| `detail.entries` | `includeEntries=false` 时 `null`；`true` 时按**输入序**返回逐笔数组 |
| `rateDate` | 折算成功时=命中汇率日；**identity（原币=目标币）时为 `null`**；同快照内不可用不会出现在成功项 |
| 缺失/失败笔 | **不进入** `daily` 与 `entries`；只计入 `FxAggregate.failures`/`missingCount`，**不得当 0** |
| 缺失日 | `daily` 中**不出现**该日期键（≠0），调用方按 `unknown` 处理 |
| `entries` 未请求 | `null`，不是 `[]`（区分「未请求」与「空结果」） |

### G17-3 币种语义

- `targetMinor`：**目标币种最小单位字符串**（十进制），由权威 `convertFx` 给出；`originalMinor`+`originalCurrency`：原币最小单位与币种。
- `daily` 的键=**业务日（`occurredLocalDate`，手机日历日）**，不是 UTC/服务器日期。
- 不跨币种相加、不先合计后折算、不二次折算；综合模式只允许通过本投影复用 S16-D 引擎（`FX_POLICY="minor-half-away-v1"`、`FX_MAX_FALLBACK_DAYS=7`）。

### G17-4 精度与舍入

- 逐笔：`convertedMinor = convertFx(entry, target, lookup).convertedMinor`（精确有理数汇率 + `minor-half-away-v1` **一次**舍入）；本投影**不再舍入/不反推显示文本**。
- 聚合：`Σ daily[d].{incomeMinor,expenseMinor,netMinor} === totals.{...}` 三条 **BigInt 严格守恒**（`daily` 只含成功折算日期）。
- 展示：`targetMinor` 十进制字符串；渲染层只用展示派生值，不得回写/参与校验。

### G17-5 错误码与错误语义

| 错误码 | 触发 | 语义 |
|---|---|---|
| `fx_detail_limit` | `entries.length > maxEntries` | **不截断/不省略/不返回部分结果**；提升上限或缩小查询 |
| `fx_detail_max_entries` | `maxEntries` 非法（非正/非整数/超安全整数） | 调用方参数错误 |
| `fx_batch_size` | 异步 `batchSize` 越界（1..1000） | 调用方参数错误 |
| `fx_scope_mismatch` | `bookId` 与 entry 不一致 | 越权/作用域错误（不改权限模型） |
| `fx_range_invalid` | `fxRangeMonths` 非法日期/顺序 | 调用方参数错误 |
| `fx_range_too_long` | 月数超 `maxMonths`（默认 36） | 不截断；需缩小区间 |
| `unsupported_currency` | 不支持币种 | 沿用既有 FX 错误语义 |
| `invalid_input` | 含非法字段值（如 `kind="transfer"`） | D-05：只允许 income/expense，其它值按 `invalid_input` |
| 取消（`signal`） | 异步中止 | **reject，不返回部分结果** |

> 约束：`maxEntries=50,000` 是**默认保护值/上限**，逐笔明细视图必须**显式传参**；默认值不得作为业务契约（Lead Q-BP-4）。`maxEntries` 与 `maxAnalysisDays=400` 不同轴、不强行对齐。

### G17-6 完整性与时间分析衔接

- `complete`/`missingCount`/`shareDenominatorMinor` 语义**不变**；`complete=false` 时 `daily` 只表示**已成功折算部分**，时间分析必须把失败日期映射为 **unknown（非 0）**并按 S-01 §5 降级完整性。
- 来源追溯：成功的 `entries[].id` 可填 `SourceDescriptor.transactionIds`（G-02/G-11 不变，不扩 T2 读取范围）。
- 与 S-01 v2 关系：G-17 是 **additive 投影**，不新增结果形状、不改四形状/9 态完整性语义；若未来引入转账，须另立合同+所有者批准、升协议版本，不得在 `kind` 联合中预留（D-05 / B §16.5-4）。

### G17-7 性能与验收证据（B 侧）

- 异步分批（默认 `batchSize=200`）+ `yieldControl`，不在渲染帧同步聚合；基线见 `docs/specs/design/S17-B-性能基线.md` §6（1M 笔 daily-only 13.6s、200k 笔逐笔 2.7s、10k×36 月 0.54s，≈13–14µs/笔）。
- 验收：`fxDetail.test.ts`（12 条）+ `fxPerformance.test.ts`（3 条，`FX_PERF=1` 门控）为冻结证据；来源 B `7405194`／`3792ace`。

---

## 冻结前待所有者确认点（本清单相关）

1. G-16 依赖的数据模型扩展（`Category.parentId` / QC-03）本轮**不申请**，冻结只冻结语义、不批准迁移；
2. G-16 的展示门控（旭日/桑基拒绝、Treemap 退化扁平）是否按 v2 §14.4 定稿；
3. G-17 的 `maxEntries=50,000` 默认保护值与「明细视图必须显式传参」口径；
4. G-17 的 `transfer` 值已删除（D-05，B `7405194`），未来转账必须另立合同——需所有者书面确认该边界。
