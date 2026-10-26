# S17 · Agent D · D-4 前置记录：文档 IO、迁移链、分享/导入纯函数与本地存储契约（v1）

> 最后核对: `486c603` + 本轮 D-4 提交 / 2026-10-27
> 性质：D-4 前置 headless 实现记录（对应所有者规格 D-4 批次的纯函数与接口占位部分）。**不含**服务端同步、公开分享 API/页面、迁移、动画视觉与隐私开关。
> 提交方：`DS-S17-D-Layout`；评审方：Lead；状态：**draft，待 Lead 评审**。
> 代码位置：`packages/shared/src/analysis/layout/`（**仍未接入** `packages/shared/src/index.ts`，接入属集成批次）。
> 相关：[D-0 数据模型](./S17-Agent-D-D0-布局数据模型与接口-v1.md) · [D-1 校验与测试](./S17-Agent-D-D1-布局引擎测试与文档校验-v1.md) · [D-2 前置交互](./S17-Agent-D-D2-前置-交互模型与状态机草案-v1.md) · [D-3 迁移/修复/容器](./S17-Agent-D-D3-跨列迁移-修复顺序-容器语义-v1.md) · [S-03 接口草案](./S17-Agent-D-S03-接口草案-布局侧-v1.md) · 配置与分享方案 §4/§6/§7。

---

## 1. 目的与批准范围

Lead 批准（2026-10-27）的 D-4 前置范围：

1. 布局文档序列化/反序列化往返与损坏数据容错（复用 D-1 校验器）；
2. 短码/分享导入的纯函数（编码/解码、校验、错误码、大小上限、未知字段保留）；
3. 版本迁移链 vN→vN+1 纯函数签名与缓存键派生原则（S-03 §4 口径，含迁移失败逐节点降级）；
4. 导入导出校验管道端到端（复用 D-1 校验 + D-3 修复顺序）；
5. 本地存储契约草案（写什么/何时写/冲突合并接口占位；服务端同步只登记契约）。

不做（边界）：新增数据库迁移、API、页面/路由、接入 `@libellum/shared` 包入口、公开分享服务端、隐私开关（B-6 门）、服务端同步实现、真实 UI 视觉。

---

## 2. 交付物清单

| 文件 | 内容 | 测试 |
|---|---|---|
| `document-io.ts` | 文档加载/回退、往返一致性 | `document-io.test.ts`（10 项） |
| `migration-chain.ts` | 五种迁移状态、迁移链、缓存键派生 | `migration-chain.test.ts`（12 项） |
| `share-snapshot.ts` | 分享快照白名单构建/校验/解析、短码纯函数 | `share-snapshot.test.ts`（15 项） |
| `import-pipeline.ts` | 导入端到端校验管道（ID 重生成、修复、投影预览） | `import-pipeline.test.ts`（13 项） |
| `storage-contract.ts` | 本地记录、布局/内容合并、同步接口占位 | `storage-contract.test.ts`（9 项） |

目录 barrel `index.ts` 追加以上五模块导出；`packages/shared/src/index.ts` **未改**。新增 59 项测试，累计 **17 files / 209 tests passed**（见 §8）。

---

## 3. 文档 IO 与损坏容错（`document-io.ts`）

| 导出 | 说明 |
|---|---|
| `emptyLayoutDocument()` | `{schemaVersion:1, layoutAlgorithmVersion:1, mode:"unified", main:{baseCols:2, objects:[]}}` |
| `emptyContentDocument()` | `{schemaVersion:1, cards:[], containers:[]}` |
| `loadLayoutDocument(raw)` / `loadContentDocument(raw)` | 返回 `DocumentLoadResult<T>{ok, document, raw, issues, usedFallback}`；解析/校验失败时返回空文档并把**原始字符串保留在 `raw`**、`usedFallback=true` |
| `roundTripLayoutDocument(doc)` / `roundTripContentDocument(doc)` | 序列化→解析→再序列化，断言逐字节一致；不一致返回 `roundtrip-mismatch` |
| `serialize*` / `parse*` / `validate*` | D-1 已有能力，D-4 不重复实现 |

语义：

- 读取失败**绝不白屏**：上层拿默认文档继续渲染，同时保留损坏副本（`raw`），供“恢复上一个布局/反馈问题”使用（配置与分享方案 §4）。
- 校验通过时原样返回输入（保留未知字段），旧客户端/未来版本不丢数据；本轮不实现“保留上一个布局”的持久化（W5/W6 存储层）。
- 往返只保证**结构稳定**，不承诺 JSON 键顺序；生产序列化统一走 `serialize*`。

---

## 4. 版本迁移链与缓存键（`migration-chain.ts`）

| 导出 | 说明 |
|---|---|
| `MigrationStep<T>{from,to,migrate}` | 单步迁移；`migrate` 返回 `DocumentValidationResult<T>`（不抛异常） |
| `runMigrationChain(value, options)` | 顺序执行迁移链；`options{steps,targetVersion,validate}` |
| `MigrationChainResult<T>{ok,status,value?,issues,appliedSteps}` | `status`：`identity` / `migrated` / `degraded` / `failed` / `read-only-newer` |
| `readDeclaredSchemaVersion(value)` | 读取声明版本（缺失/非法返回 `null`） |
| `migrateLayoutDocument` / `migrateContentDocument` | 布局/内容文档入口；当前步表 `LAYOUT_MIGRATION_STEPS`/`CONTENT_MIGRATION_STEPS` 为 `[]`（v1 即最新） |
| `deriveProjectionCacheKey(input)` | 投影缓存键：`layout=…\|content=…\|algo=…\|cols=…\|constraints=…\|strategy=…` |

读取规则（与配置与分享方案 §4、S-03 §4 一致）：

- 等于目标版本：严格校验一次即用（`identity`）；
- 较旧：逐步迁移，每步结果都过校验；**任一步失败 → 保留迁移前的最后一个合法文档**，`status=degraded`，记录 `migration-failed` + 该步 issues（不丢卡片、不对半写）；
- 缺步骤：`failed` + `missing-migration-step`（不猜测补迁移）；
- 较新：`read-only-newer` + `schema-newer-readonly`，**不回写、不删未知字段**，上层只读渲染并提示更新（Q-20 / Lead 裁定 6）。

缓存键：五元组（主布局版本、内容版本、算法版本、目标列数、约束版本）+ 策略，**仅实现约定，不进入冻结契约**（Lead 裁定 5）；投影永远可从权威布局重算，缓存只允许加速、不得作为唯一来源（D-3 无漂移用例保证）。

待 W3/W5 在步表注册 v2 时补：字段改名/类型变化的逐节点降级细则（当前 `MigrationStep` 已有逐节点降级位置，但 v1→v2 形状未定，不虚构）。

---

## 5. 分享快照与短码纯函数（`share-snapshot.ts`）

### 5.1 白名单快照

`buildShareSnapshot(content, layout, options)` 只从文档**构造**白名单字段（禁止“复制整份再删”）：

- 允许：`schemaVersion`、分析引用（`AnalysisReference`）、图表家族与展示选项、容器树与几何（整数占格/千分比）、模板名/描述（长度上限 40/200）、语言提示（≤16）。
- 禁止/默认不导出：任何金额/占比/序列化结果、交易/账本/成员标识、自建分类/支付方式/标签名、设备级设置、自定义标题（`includeCustomTitles` 默认 false，preset 标题保留）、`previousMain`、作者身份、缩略图。
- `profiles` 仅在 `mode=independent` 时导出。

### 5.2 校验与上限

- `validateShareSnapshot(value)`：结构/枚举/引用/数量/长度**严格校验**；通过时原样返回（保留未知字段）；不检查 `analysisId` 是否在当前目录（导入侧按待绑定处理）。
- 危险键（`__proto__`/`constructor`/`prototype`）→ `forbidden-key`；`findForbiddenKey` 返回具体路径（如 `$.cards[0].nested.__proto__`）。
- 总字节上限候选 **64KB**（`MAX_SHARE_PAYLOAD_BYTES`，配置与分享方案 §7）；`serializeShareSnapshot` 与 `parseShareSnapshotJson` 两侧都检查，超限 `payload-too-large`。
- `exportShareSnapshot(content, layout, options)`：先走 D-1 两份文档校验，再构建→校验→序列化（导出前不产生半成品）。

### 5.3 短码纯函数

- `SHARE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"`（去歧义，无 `0/O/1/I`）；长度候选 8–10，默认 8（OQ-CF-10 未定，参数可配置，不视为冻结）。
- `createShareCode(random, length=8)`：随机源**注入**（生产由服务端 `crypto` 提供；测试用固定种子 PRNG）；长度非法或随机字节不足返回空串（调用方拒绝发放）。
- `normalizeShareCode` / `isValidShareCode`：去空白/大小写归一化，拒绝歧义字符与非法字符。
- 明确**不做**：码→快照的存储、防枚举、限速、撤销、配额、内容审核、作者匿名之外的身份处理——均属 W6 服务端与 B-6 隐私门。

---

## 6. 导入管道（`import-pipeline.ts`）

`prepareShareImport(input: string | unknown, options)` 端到端纯函数，顺序固定：

1. 输入为字符串 → 先按 64KB 上限与 JSON 解析（`invalid-json`/`payload-too-large`）；
2. `validateShareSnapshot` 结构校验（失败即返回 `ok=false`，不产生文档）；
3. **ID 全量重生成**：所有卡片/容器/Spacer 的 `objectId` 用注入的 `generateObjectId` 重生成，同步重写容器 `children` 与布局几何；工厂返回空/重复分别记 `invalid-generated-id`/`duplicate-object-id`；
4. `repairLayoutGeometry` 修复主布局与各档案（纵深防御；合法的自产快照通常无修复，测试断言无 `repaired-*`）；
5. D-1 双文档校验 + 跨文档一致性（布局对象须有内容来源，Spacer 豁免）→ `orphan-layout-object`；
6. 分析引用解析：`resolveAnalysis` 不认识 → `analysis-needs-rebind`（**不删卡片**，交 Q-15 待绑定占位）；
7. 图表家族：`knownChartFamilies` 未知 → `unknown-chart-family`（只提示，降级交卡片/图表侧 CF-10）；
8. 可选 dry-run：给定 `targetColumns` 跑 `projectLayout` 生成 `ImportPreview{cards,containers,spacers,rebindRequests,projectionIssueCount,targetColumns}`；非法列数 `invalid-columns`，预览 `targetColumns=null`。

返回 `ShareImportResult{ok, content?, layout?, issues, rebindRequests, preview?}`；`ok=true` 仅表示“校验通过且可生成文档”，待绑定/家族提示不阻断导入。`isWithinImportLimits(snapshot)` 用于对象数量快速上限检查。

---

## 7. 本地存储契约草案（`storage-contract.ts`）

### 7.1 写什么

`WorkbenchLocalRecordV1{storeSchemaVersion, userId, content, layout, updatedAt, pendingSync}`：

- 内容文档与布局文档分开存放（配置与分享方案 §4.5）；设备级设置（主题/语言/综合折算开关）**不进**工作台记录；
- 本地记录键必须含 `userId`（个人隔离）；`WORKBENCH_LOCAL_STORE_SCHEMA_VERSION=1` 为本地记录结构版本，独立于内容/布局文档 `schemaVersion`；
- 编辑草稿是否落本地：**待 OQ-CF-02**，本轮不实现（编辑会话仍在内存）。

### 7.2 何时写

- 编辑只改内存草稿；「完成」时一次性原子写本地记录（配置与分享方案 §4.5、布局规格 §10）；
- 服务端同步成功后再清 `pendingSync`——本轮只登记接口，不实现。

### 7.3 冲突合并接口

| 函数 | 规则 |
|---|---|
| `mergeLayoutDocuments(local, remote)` | 整体替换：`version` 高者胜，平局 `remote` 胜；内容不同时败方 `main` 存入 `previousMain`（保留上一个布局）；结果过 D-1 校验否则 `ok=false` |
| `mergeContentDocuments(local, remote)` | 按 `objectId`：相同保留；双方都改则 `version` 高者胜（平局 `remote`），败方记录到 `conflicts`（含 `alternative`）；单侧新增保守并入（并集），删除判定待 **OQ-CF-01 合并粒度**（base 版本纳入后才可判删） |

### 7.4 占位接口（只签名，不实现）

`WorkbenchLocalStore{read,write,clear}`、`WorkbenchSyncTransport{push,pull}`、`SyncPushResult`/`SyncPullResult`。服务端同步属 W6：需迁移评审、备份、所有者批准，并受 B-6 隐私门约束；本轮不写数据库/接口/路由。

---

## 8. 测试矩阵与真实结果

```text
pnpm.cmd --filter @libellum/shared typecheck                       → exit 0
pnpm.cmd --filter @libellum/shared exec vitest run src/analysis/layout
  → 17 test files / 209 tests passed, exit 0（本轮新增 59 项）
```

本轮覆盖：

- 文档 IO：往返逐字节一致、独立档案 + `previousMain`、未知字段保留、非法文档拒绝、损坏 JSON/结构回退（`raw` 保留）；
- 迁移链：五种状态、步骤链、`appliedSteps`、v1 入口 `identity`、损坏输入不抛异常、缓存键确定性与各输入敏感性；
- 分享快照：白名单（自定义标题默认不导出/`includeCustomTitles`/`previousMain`/`profiles`）、模板与语言、往返、未知字段保留、长度与字节上限、危险键、`child-not-found`、短码（可复现、长度、随机源不足、歧义字符）；
- 导入管道：ID 全量重生成与引用重写、输入快照不变、独立档案 + Spacer、待绑定、未知家族提示、重复/空 ID、非法输入、预览列数、数量上限；
- 存储契约：空记录结构（不含设备级设置）、布局/内容合并规则与冲突记录、`previousMain` 保留、非法合并 `ok=false`。

---

## 9. 偏差、观察与待决

偏差（相对“完整实现”，均属本轮边界）：

1. 导入管道中的 `repairLayoutGeometry` 是**纵深防御**：自产快照与 D-1 校验已保证结构，正常路径不会产生修复项；恶意/未来版本数据才有价值。
2. 短码位数/字母表为**候选值**（8–10 位去歧义），OQ-CF-10 未定；服务端发放、限速、撤销、配额均未实现。
3. 本地存储契约只有类型与纯函数合并，**未实现** IndexedDB/离线队列/服务端同步；`pendingSync` 仅标记位。
4. 内容合并的“删除语义”需要 base 版本（OQ-CF-01），当前保守并集可能导致已删对象复现——首版合并规则已登记风险，W6 前定。
5. 观察（投影现状）：容器因宽度不足回退 `collapsed` 时，`ProjectedObject.degradedReasons` 可能为空（投影层不记“纯宽度回退 collapsed”的原因，只在 `container-narrow`/`user-collapsed` 等条件记录）；D-4 导入预览的 `projectionIssueCount` 只统计硬 issues，故此场景为 0。是否补记由 W5 UI/预览需求决定（不阻塞）。
6. `parseShareSnapshot` 是 D-4 新增的别名导出（`import-pipeline` 依赖），已加入目录 barrel。

待决：

| 编号 | 问题 | 影响 | 需要谁 |
|---|---|---|---|
| OQ-CF-10 | 分享码位数/字符集/限速/唯一性重试 | 服务端发放与分享上线 | 所有者（W6） |
| OQ-CF-01 | 内容文档合并粒度与删除判定（base 版本） | 多设备合并正确性 | 所有者（W6） |
| OQ-CF-02 | 编辑草稿是否落本地 | 本地记录字段与清理逻辑 | 所有者（W5） |
| OQ-CF-03 | 服务端上一个布局保留数量/期限 | `previousMain` 生命周期 | 所有者（W6） |
| OQ-CF-07 / B-6 | 分享内容审核与隐私合规门 | 公开分享上线 | 所有者（W6） |
| G-13 / S17-A-01 | 隐私政策与数据处理清单 | 分享/同步对外能力 | 所有者 |

---

## 10. 下一步

- 待 Lead 评审本批与 S-03 v0.3；D-2 UI 等 Codex 视觉规范后另行批准。
- 集成批次（Lead/S-03）：接入 `packages/shared/src/index.ts`、静态守卫测试（布局目录不得引用交易/账本写接口）、性能基线、真实存储适配。
- W6（需批准）：服务端同步（迁移/备份/权限/越权测试）、公开分享（分享码发放、限速、撤销、隐私政策）、跨设备回归。
- 另：S-01 v2 交叉评审已完成并经 Lead 验收（合约一致性确认 + G-12 三项补充转 A 汇总），D 侧无需再动。
