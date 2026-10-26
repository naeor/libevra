# S17 · Agent A · T2 只读扩展提案（已批准 · 已实现）

- 状态：**已批准（所有者 2026-10-27，经 Lead m01003 转达）· 已实现（2026-10-27）**。
  - 所有者原话：「只读扩展允许批准；只要不是修改就行……私钥等私密文件绝对不允许被读取。」
  - 实现位置：`packages/shared/src/analytics.ts`（共享契约）、`packages/shared/src/analysis/adapters/analytics.ts`（DTO → 计算形态）、`apps/api/src/routes/analytics.ts`（两个只读 GET）、`apps/api/src/app.ts`（以 `requireBookRead` 注册，**没有写路由、没有新权限规则**）。
  - 实现提交：`21c0438 feat(s17): Agent A T2 只读扩展（只读端点）`（本地提交，未推送；分支 `deepseek/s17-finance-category`）。
  - 测试：`packages/shared/src/analytics.test.ts`（20）、`packages/shared/src/analysis/adapters/analytics.test.ts`（6）、`apps/api/test/analytics.test.ts`（14，集成测试需 `TEST_DATABASE_URL`，本 worktree 无数据库，见 §9.5）。
  - 实现记录与偏差登记见 §9；任务文档新增 §15 记录批准与实现。
- 提出：DS-S17-A-Finance（Agent A）
- 目的：补齐「来源追溯」与「综合模式逐笔折算」所缺的只读数据入口；对应任务文档 §7 的 A-Q13 / A-Q17
- 依据：所有者《S17-Agent-A-完整开发规格》§21.4（来源一致性）、§24（接口）；《S17-模块化财务分析工作台-总需求规格》ACC-01/ACC-08/ACC-09；《S17-分析能力目录》§2 数据能力 T2 定义（只读扩展查询，无 schema 变更）
- 影响范围：`apps/api`（新增只读路由）+ `packages/shared`（契约类型）；A 侧只消费，不改变既有页面行为

> T2 定义（能力目录原文）：**只读扩展查询**——不新增/修改数据库表结构，不改交易写入路径；必须通过越权测试（跨账本/只读成员/已删除账本）。

---

## 1. 现有能力与缺口（基于本基线实读）

| 现有入口 | 已有 | 缺口（本提案要补的） |
|---|---|---|
| `GET /api/v1/stats`（`apps/api/src/routes/stats.ts`） | 单币种聚合 totals/series/byCategory；`deletedAt:null`；`occurredLocalDate` 闭区间 | 不返回来源交易 ID；无按支付方式分组；`totals.count` 是收入+支出合计（无 per-kind count）；仅 day/month 桶；无周桶 |
| `GET /api/v1/transactions`（`apps/api/src/routes/transactions.ts`） | 分页明细，支持 `month`/`kind`/`categoryId`/`paymentMethodId`/`currency`/`tagId`/`q`/`cursor` | **无任意 `from`/`to`**（只有整月 `month`）；无金额排序；无「最大/最小」查询；不返回按范围聚合 |
| `shared/fx.ts › aggregateFxAsync` | 逐笔折算、逐笔舍入、7 天回退、`complete`/`shareDenominatorMinor` | 需要逐笔 `FxEntry` 输入；现有 API 无法提供任意区间逐笔数据 → 综合模式无法实现 |

因此以下能力当前处于「等待数据能力」：

- **B09/B10/B17**（最大/最小单笔及其来源记录）：需要区间内极值 + 命中记录标识 + 并列计数；
- **B13/B14**（有/无支出记录天数）中的「可成功折算」语义（综合模式）：需要知道哪些记录可折算；
- **I01/I02/I03/I04/I05/I17 的来源追溯**（ACC-08/ACC-09：点击数值 → 同一 from/to 的来源列表）；
- **综合模式（aggregate）**的完整性与 `shareDenominatorMinor`：需要逐笔 `FxEntry{id, bookId, amountCents, currency, occurredLocalDate, kind, categoryId, version}`。

> 未批准前的临时方案（已登记 §7）：B09/B10/B17 仅用服务端聚合结果展示极值（无逐笔来源、不宣称来源完整）；综合模式标 `fx-incomplete`/`unavailableReason`，不伪装完整。**不得**用现有 `month` 分页拼接冒充任意区间来源（月份边界会漏/重，且无金额排序）。

---

## 2. 提案原则（T2 只读）

1. **零写入**：只新增 `GET` 路由；不新增/修改 `prisma/schema.prisma`、不新增迁移、不改 `POST/PATCH/DELETE` 与导入/恢复逻辑。
2. **权限一致**：全部复用 `requireBook(prisma, request, userId)`（`apps/api/src/ledger/access.ts`）——`viewer` 可读、无成员 403、已删/删除中 410、已归档 403；绝不跨账本（`bookId` 只来自查询层上下文，不接受客户端传入）。
3. **口径一致**：查询 `where` 与 `GET /stats` 相同——`{ bookId, deletedAt: null, currency, occurredLocalDate: { gte: from, lte: to } }`；分组/筛选只用 `occurredLocalDate`。
4. **上限保护**：`from..to` ≤ 400 天（复用 `MAX_STATS_DAYS`）；分页 `limit ≤ 500`；排序确定性（`occurredLocalDate desc, createdAt desc, id desc`）。
5. **契约优先**：共享类型放 `packages/shared/src`（新增文件，不改既有 DTO 语义）；现有 `/stats`、`/summary`、`/transactions` 响应**保持不变**（避免影响 1.16.23 基线与现有页面）。
6. **金额精度**：新端点返回的金额字段以**十进制字符串**表示最小单位（字符串化），避免 `> Number.MAX_SAFE_INTEGER` 丢精度（A-Q14）；若评审不同意字符串化，则退化为沿用现有 `number` 并在文档标注精度限制——需要 Lead/后端二选一。
7. **只读审计**：新路由需有对应越权/软删/边界测试（见 §5）。

---

## 3. 建议端点（两个，均 `GET`，均挂 `requireAuth` + `requireBook`）

### 3.1 `GET /api/v1/analytics/transactions` — 区间逐笔查询（供综合 FX 与来源追溯）

用途：为 `aggregateFxAsync` 提供逐笔 `FxEntry`；为 I01/I02/I03/I04/I05/I17 的「点击来源」提供 transaction id 列表。

查询参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `from`, `to` | 是 | `YYYY-MM-DD`，业务日期闭区间；`from <= to`；最长 400 天；与 `/stats` 同语义 |
| `currency` | 否 | 指定币种过滤；**省略 = 返回多币种**（综合模式需要），每行带 `currency` |
| `kind` | 否 | `income` / `expense`；省略 = 两者 |
| `categoryId` / `paymentMethodId` / `tagId` | 否 | 与现有明细查询同义；`paymentMethodId=__unspecified__` 表示「未指定」（是否支持该哨兵值待评审 T2-Q1） |
| `limit` | 否 | 默认 200，最大 500 |
| `cursor` | 否 | 与现有 `/transactions` 相同的不透明游标 |

响应（草案，字段来自现有 `transactionSchema` 的可安全子集）：

```ts
{
  items: Array<{
    id: string;            // 客户端 uuid，用于 FX 缓存键与来源追溯
    bookId: string;
    kind: "income" | "expense";
    amountMinor: string;   // 字符串化最小单位（见 §2.6）
    currency: string;
    occurredLocalDate: string;   // YYYY-MM-DD，业务日期
    categoryId: string;
    categoryName: string;
    paymentMethodId: string | null;
    paymentMethodName: string | null;
    version: number;       // FxResultCache 需要 entry.version
    deletedAt: null;       // 只返回未删除
  }>;
  nextCursor: string | null;
  range: { from: string; to: string };
}
```

不返回：`note`、`tags`、`valueHistory`、`userId`、`occurredTz` 等非分析必需字段（最小暴露原则；如来源详情需要 note，另由 `GET /transactions/:id` 提供）。

### 3.2 `GET /api/v1/analytics/extremes` — 区间极值与天数聚合（服务端聚合）

用途：B09/B10/B17（最大/最小单笔）、B11/B12（最高单日）、B13/B14（有/无记录天数）、B20（记录最多的一天）的来源与并列信息；避免「先拉全量再客户端排序」的泄漏面与性能风险。

查询参数：`from`, `to`（必填，同上）、`currency`（必填，原币模式；综合模式由 §3.1 逐笔+FX 处理）、`kind`（必填 `income|expense`）、`metric`（必填）：

| `metric` | 返回 |
|---|---|
| `max` / `min` | 极值金额（字符串）、命中记录安全摘要（id、发生日、分类名、支付方式名）、`tieCount`（同金额记录数） |
| `peak-day` | 单日汇总最高值（金额）、日期、当日笔数、`tieCount`（并列日期数） |
| `active-days` | 有记录的业务日期去重数（`count`） |
| `most-recorded-day` | 笔数最多的日期、总笔数、收入笔数、支出笔数、`tieCount` |

响应（草案）：

```ts
{
  metric: "max" | "min" | "peak-day" | "active-days" | "most-recorded-day";
  kind: "income" | "expense";
  range: { from: string; to: string };
  value: string | null;              // 金额最小单位字符串或天数/笔数；null = 无数据
  occurredLocalDate: string | null;
  record: {                          // max/min 时返回（安全摘要）
    id: string; categoryId: string; categoryName: string;
    paymentMethodId: string | null; paymentMethodName: string | null;
  } | null;
  count: number | null;              // 当日笔数 / 总笔数等，取决于 metric
  incomeCount?: number;
  expenseCount?: number;
  tieCount: number;                  // 并列命中数（无并列 = 1）
  completeness: "complete" | "no-transactions" | "fx-incomplete";
}
```

### 3.3 未采用方案（留档）

- **改造现有 `/stats` 响应**（加 per-kind count、byPaymentMethod、transactionIds）：会改变既有 DTO，影响 web 现有页面与 1.16.23 基线，违反「不改既有语义」；不采用。
- **客户端拉全量再排序**：400 天 × 大量记录会放大响应与泄漏面，且排序/并列规则要在多处重复；不采用。
- **新增数据库表/物化视图**：属 T3（需新数据模型），明确不在本提案。

---

## 4. 只读约束核对清单（评审用）

- [ ] 只有 `GET`，无 `POST/PATCH/DELETE`
- [ ] 无 Prisma 写入、无 migration、无 schema 变更
- [ ] 复用 `requireBook`；跨账本/只读成员/已删账本行为与现有一致
- [ ] `where` 与 `/stats` 完全一致（`bookId` + `deletedAt:null` + `currency` + `occurredLocalDate` 区间）
- [ ] 区间 ≤ 400 天、`limit ≤ 500`、排序确定性
- [ ] 不返回 `note`/`tags`/`valueHistory` 等非分析字段
- [ ] 金额字符串化（或按 §2.6 备选方案标注精度限制）
- [ ] 响应保持兼容：不修改任何现有端点

---

## 5. 测试要求（后端实现；A 提供契约样本与断言）

1. **权限**：非成员 403 `book_forbidden`；`viewer` 可读；已删 410/归档 403；跨账本查询返回 403（header 账本与请求不符）。
2. **软删**：`deletedAt` 记录的区间查询/极值/天数均不出现；恢复后重新出现。
3. **边界**：`from == to` 单日；跨月/跨年/闰月；`from > to` 拒绝；> 400 天拒绝；空区间返回 `no-transactions`。
4. **确定性**：同金额/同笔数并列返回 `tieCount` 与稳定首项（金额→日期→id）。
5. **金额精度**：> `Number.MAX_SAFE_INTEGER` 的最小单位在字符串化下无损（样本 G）。
6. **口径一致**：`active-days`/`peak-day` 与 `GET /stats` 的 `series`/`totals` 对同一区间可逐项核对（A 在 A-3 提供对照用例）。
7. **性能**：400 天、万级记录分页响应时间有上限（后端自定阈值并记录）。

A 侧落地（已实现，2026-10-27）：`packages/shared/src/analysis/adapters/analytics.ts` 提供 DTO → `AnalysisEntry`/`FxEntry` 映射，`apps/api/src/routes/analytics.ts` 提供两个只读端点，**不改**现有 `stats.ts`/`fx.ts`；来源筛选仍由 S-01 `SourceDescriptor.query` 表达。

---

## 6. 未决问题（T2-Q，需评审）

| 编号 | 问题 | 建议 |
|---|---|---|
| T2-Q1 | 逐笔查询省略 `currency` 是否允许返回多币种（综合模式必需），以及 `paymentMethodId` 是否需要「未指定」哨兵值 | 建议允许省略=多币种；未指定用 `paymentMethodId` 缺失语义+前端区分，或新增 `unspecified=true`，二选一 |
| T2-Q2 | 极值 `max/min` 并列时是否返回全部命中记录 id 列表 | 建议只返回 `tieCount` + 稳定首项；完整并列列表由 §3.1 区间查询按条件获取（避免响应膨胀） |
| T2-Q3 | 金额字段字符串化是否可作为新端点约定（不改现有端点） | 建议可以；若后端要求全局统一，需单独评审（A-Q14/R-07） |
| T2-Q4 | 是否允许「综合模式」查询币种与折算目标币种作为参数（服务端折算） | 建议**不**在服务端折算：服务端只给逐笔原币数据，折算仍由 `shared/fx.ts` 统一（避免第二套汇率实现） |
| T2-Q5 | 端点命名与版本（`/api/v1/analytics/*` vs `/api/v1/stats/*`） | 建议独立 `/analytics/*` 命名空间，避免和现有统计 DTO 混淆 |
| T2-Q6 | 实现归属：后端实现 or 授权 A 在本分支实现只读路由 | 建议后端实现；A 只写共享契约与适配器（A 不改后端写入/权限代码） |

---

## 7. 若批准 / 若不批准的影响

**批准**：A-3 可完成 B09/B10/B11/B12/B13/B14/B17/B20 的逐笔来源与并列信息；综合模式（aggregate）可端到端实现（逐笔 `FxEntry` → `aggregateFxAsync` → 完整性/`shareDenominatorMinor`）；I 类「点击来源」达到 ACC-08/ACC-09。

**不批准**：A 继续用 `/stats` 聚合覆盖原币模式的金额类分析；B09/B10/B17 与 I 类来源追溯、综合模式在 §9 标记「等待数据能力」，并在任务文档 §7 A-Q13/A-Q17 保持阻塞登记；**不以模拟数据或分页拼接冒充完成**。

---

## 8. 维护

- 本提案批准/驳回后，由 Agent A 在任务文档 §7（A-Q13/A-Q17）与 §9 对应行更新状态；批准后另起实现任务。
- 变更记录：2026-10-27 初稿（基于基线 `f05838f` 工作区 + 1.16.22 生产代码实读）。

---

## 9. 实现记录（2026-10-27，所有者批准后由 Agent A 实施）

### 9.1 已实现端点

**`GET /api/v1/analytics/transactions`** — 区间逐笔（只读）

- 参数：`from`、`to`（必填 `YYYY-MM-DD`，≤ 400 天）；`currency`（**省略 = 多币种返回**，供综合模式逐笔折算）；`kind` / `categoryId` / `paymentMethodId` / `tagId`（可选）；`limit`（默认 200，最大 500）；`cursor`（keyset 分页）。
- 响应：`{items[{id,bookId,kind,amountMinor(十进制字符串),currency,occurredLocalDate,categoryId,categoryName,paymentMethodId,paymentMethodName,version}],nextCursor,range}`。
- 口径：`where` 与 `/stats` 一致（`bookId` 来自查询层上下文、`deletedAt:null`、`occurredLocalDate` 闭区间）；排序 `occurredLocalDate desc, createdAt desc, id desc`。
- 最小暴露：不返回 `note`/`tags`/`valueHistory`/`userId`/`occurredTz`。

**`GET /api/v1/analytics/extremes`** — 极值与天数聚合（只读）

- 参数：`from`、`to`、`currency`、`metric`（`max`/`min`/`peak-day`/`active-days`/`most-recorded-day`）、`kind`（`max`/`min`/`peak-day`/`active-days` 必须为 `income|expense`；`most-recorded-day` 可省略或 `both`）。
- 响应：`{metric,kind,range,currency,unit("money"|"count"|"days"),value(字符串|null),occurredLocalDate,record{id,categoryId,categoryName,paymentMethodId,paymentMethodName}|null,count,incomeCount,expenseCount,tieCount,completeness("complete"|"no-transactions")}`。
- 并列规则与 `packages/shared/src/analysis/primitives.ts` 完全一致：`max/min` 按「金额 → 业务日期升序 → id 升序」取稳定首项；`peak-day` 并列保留最早日期；`tieCount` 为并列数量。空区间返回 `no-transactions` 且 `value:null`，**不补 0**。

### 9.2 实现文件

| 层 | 文件 |
|---|---|
| 共享契约 | `packages/shared/src/analytics.ts`（schema + 类型 + `summarisePeakDay`/`summariseMostRecordedDay`） |
| 适配器 | `packages/shared/src/analysis/adapters/analytics.ts`（`toAnalysisEntry`/`toFxEntry`/批量版本，非 safe integer 抛 `RangeError`） |
| API 路由 | `apps/api/src/routes/analytics.ts`（两个 GET；游标与 `/transactions` 同形） |
| 注册 | `apps/api/src/app.ts`（`requireBookRead`，无写路由/无新权限规则） |
| 测试 | `packages/shared/src/analytics.test.ts`（20）、`packages/shared/src/analysis/adapters/analytics.test.ts`（6）、`apps/api/test/analytics.test.ts`（14，集成） |

- 实现提交：`21c0438 feat(s17): Agent A T2 只读扩展（只读端点）`（本地提交，未推送；分支 `deepseek/s17-finance-category`）。

### 9.3 与提案的偏差（评审可见）

| 项 | 提案 | 实现 | 理由 |
|---|---|---|---|
| `unit` 字段 | 未列 | 极值响应新增 `unit` | 客户端不该根据 metric 名猜字符串含义 |
| `kind=both` | 未列 | `most-recorded-day` 允许省略/both | B20 按「收入+支出」合计计数，与单侧指标语义不同 |
| `active-days` 形状 | 定义未细化 | `value`=日数、`count:null` | 与「天数」语义一致，避免 count 与 value 重复 |
| 未指定支付方式哨兵 | T2-Q1 二选一 | **未实现**，`paymentMethodId` 只做精确 id | 待评审；不影响 I17（「未指定」组来自数据本身 `paymentMethodId=null`） |
| 服务端折算 | T2-Q4 建议不折算 | 未折算 | 复用 `shared/fx.ts` 唯一实现，避免第二套汇率 |
| 集成测试 | 要求 | `apps/api/test/analytics.test.ts` 已写；需 `TEST_DATABASE_URL` | 本 worktree 无本地数据库（环境限制，非跳过断言） |

### 9.4 T2-Q 结论（实现口径）

- T2-Q1：允许省略 `currency` = 多币种（已实现）；「未指定支付方式」哨兵未做，保留待评审。
- T2-Q2：只返回 `tieCount` + 稳定首项（已实现）。
- T2-Q3：新端点金额字符串化（已实现；既有端点响应不变）。
- T2-Q4：服务端不折算（已实现）。
- T2-Q5：独立 `/analytics/*` 命名空间（已实现）。
- T2-Q6：由 Agent A 在本分支实现只读路由（所有者批准即授权）；A 不改写入/权限代码，只注册既有 `requireBookRead`。

### 9.5 只读核对

- [x] 只新增 `GET` 路由，无 `POST/PATCH/DELETE`。
- [x] 未改 `prisma/schema.prisma`、未新增迁移。
- [x] 未改交易写入/导入/恢复逻辑。
- [x] 未改 `/stats`、`/summary`、`/transactions` 的既有响应。
- [x] 权限复用 `requireBook`（`write:false`）：viewer 可读、非成员 403、已删/删除中 410、归档 403。
- [x] 不返回敏感字段（见 9.1）。
- [x] 金额字符串化，`> Number.MAX_SAFE_INTEGER` 无损（适配器另有 safe-integer 校验）。
- [ ] 集成测试在带 `TEST_DATABASE_URL` 的环境执行（本 worktree 无数据库，见 9.3）。

### 9.6 变更记录

- 2026-10-27 批准并实现（所有者经 Lead m01003 转达；Lead 要求严格只读、不改写入语义、不加迁移、加权限/越权/只读测试）。
