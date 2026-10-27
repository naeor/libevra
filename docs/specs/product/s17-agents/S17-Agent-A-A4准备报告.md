# S17 · Agent A · A-4 准备报告（准备，不是启动）

> 最后核对：2026-10-27（Lead m02628 / m02818；分支 `deepseek/s17-finance-category`，HEAD 以提交回填为准）
> 状态：**A-4 未获批准、未启动**。本文件是 Lead 要求的「准备工作」交付：现有实现盘点、日期/周/月区间键输入适配设计、测试数据与用例、风险清单、可选的向后兼容 scaffolding 范围、启动门禁复核。
> 边界：只做不破坏共享接口的设计/测试准备；不接页面、不改既有契约、不改共享 `barrel` 语义、不新增迁移、不改版本号（1.17.1 由 Lead 在集成侧维护）、不 push。

## 1. 现有实现盘点

### 1.1 计算与装配层（`packages/shared/src/analysis/`）

| 文件 | 内容 | 状态 |
|---|---|---|
| `types.ts` | S-01 v2 前身类型：9 态完整性、四种结果形状、`exact-money`/可空 value、`extremeValue`/`countBreakdown` 等 | A-0/A-3 已提交 |
| `rational.ts` | 精确有理数 `Ratio`、比较/显示一次舍入、`formatMinorExact` | A-0 已提交 |
| `primitives.ts` | 金额/计数/中位数/分位原语、分类/支付方式/日聚合、`peakRecordedDay`、`foldRemainder` | A-0/A-3 已提交 |
| `context.ts` | `WorkbenchState`/`ResolvedPeriod`/`prepareScope`/结果构建器（`makeScalar`/`makeExtreme` 等） | A-1/A-3 已提交 |
| `analyses/basic.ts` | B01–B07 装配 | A-1 已提交 |
| `analyses/category.ts` | B15/B16/I01–I05/I17 装配（含「其他/未指定」折叠） | A-2 已提交 |
| `analyses/statistics.ts` | B08–B14、B17–B20 装配（极值/中位/天数/比例） | A-3 已提交 |
| `charts/numericCard.ts` | CF-A01 数值卡输入协议（三档密度占位） | A-1 已提交 |
| `charts/composition.ts` / `ranking.ts` / `extremeCard.ts` | CF-A03/A04/A05/A07、CF-A02 输入协议 | A-1/A-3 已提交 |
| `fixtures.ts` | 样本 A–O（空账本/单收入/单支出/并列/多币种/大整数/跨月/闰日边界/软删/权限/过滤等） | A-0 已提交 |
| `analyses/*.test.ts`、`charts/*.test.ts`、`primitives.test.ts`、`context.test.ts` | 8 文件 **219 tests** | 全绿 |

- 说明：26 项 = B01–B20（20）+ I01–I05（5）+ I17（1）；纯计算装配已全部就绪（`analysis 219 / shared 638`）。
- 原语层不依赖 Prisma/HTTP；所有金额以 `bigint` 最小单位计算、显示一次舍入（`minor-half-away-v1`）。

### 1.2 只读数据契约（T2，已实现待所有者验收）

| 文件 | 内容 |
|---|---|
| `packages/shared/src/analytics.ts` | `analyticsTransactions(Query/Response)`、`analyticsExtremes` schema 与 `summarisePeakDay`/`summariseMostRecordedDay` 纯函数；金额字符串化；`unit` 字段；tie 规则与 primitives 一致 |
| `packages/shared/src/analysis/adapters/analytics.ts` | `toAnalysisEntry`（bigint）/`toFxEntry`（number，安全整数校验）/批量映射 |
| `apps/api/src/routes/analytics.ts` | `GET /api/v1/analytics/transactions`（区间逐笔、可选多币种/筛选/游标）与 `GET /api/v1/analytics/extremes`（max/min/peak-day/active-days/most-recorded-day）；`requireBookRead`、零写入 |
| 测试 | shared 42 项 + api 集成 14 项（本地 `ledger_test` 25/25 通过） |

### 1.3 总览

- `pnpm --filter @libellum/shared test` → 28 files / **638 passed**；`pnpm --filter @libellum/web test` → **1390 passed**；`analysis` 子集 219 passed。
- `pnpm -r typecheck` / `pnpm check:build` / `check:docs` / `check:status` 均通过（最近一轮 rebase 1.16.23 后复验）。
- 未实现（A-4 范围）：与页面/工作台的数据装配接入、W1 的区间输入/桶轴对接、图表组件渲染（Codex/W3）、详情页与来源跳转（W4）。

## 2. 日期 / 周 / 月区间键输入适配设计（设计稿）

### 2.1 基本约定（不新增日期库）

- 业务日期一律 `YYYY-MM-DD` 字符串（与 `packages/shared/src/stats.ts`、`occurredLocalDate` 一致），不用 `Date` 做时区推断。
- 用户语义区间 `ResolvedPeriod {from,to,dayCount}` 为**闭区间**（与 s01-draft §4 一致）；时间桶内部为**半开区间** `[bucketStart, bucketEnd)`；两者唯一换算函数 `bucketToInclusive(bucket)`：日粒度 `to = addDays(bucketEnd, -1)`；周/月粒度同理裁到最后一个业务日。
- 查询过滤：T2/原币查询的 `occurredLocalDate` 用闭区间（`gte from, lte to`）；时间桶取数按其 `bucket.from/to`（闭区间）而非半开直接下发——**过滤与计算必须同口径**（ACC-01/ACC-09）。

### 2.2 键格式

| 粒度 | 键格式 | 规则 | 边界 |
|---|---|---|---|
| 日 | `YYYY-MM-DD` | 业务日期（`occurredLocalDate`） | 区间两端含端点 |
| 周 | `YYYY-Www`（ISO 8601 周） | **周一起始**；跨年周按 ISO（如 2026-W01 可能含 2025-12-29） | 年首/年末归属以 ISO 周号为准，不用「1 月 1 日所在周」自造规则 |
| 月 | `YYYY-MM` | 自然月；月首 `YYYY-MM-01`、月末按 `endOfMonth`（含闰年 2 月） | 31→28/29、2 月闰年、跨年 12→1 |

- 区间上限：日窗口 `maxAnalysisDays`（默认 400，调用方显式传入，超限拒绝不截断）；月键比较 `maxMonths` 36（`fxRangeMonths` 已参数化，B `13428bd`/`f958e24`）。两者不同轴、不强行对齐（G-09/G-18）。
- 既有预设 `7d/30d/90d/365d`（`rangeForPreset`）继续作为 `ResolvedPeriod` 生成器；W1 若需要自定义区间，用 `time.mode: "fixed"` 的 `from/to`，不改 preset 语义。
- 闰日对齐（B-Q13）与 A05 窗口政策（`same-day-index` + `policyId`）按 s01-draft §17 执行，A 侧不另造。

### 2.3 适配层建议（仅到「输入」为止）

1. `WorkbenchState.period`（闭区间）→ `resolveDefinitionPeriod`（已有）；
2. 分析定义如需按周/月聚合，输入适配层把 `ResolvedPeriod` 展开为桶键序列（日/ISO 周/月），每个桶给 `{key, span, naturalSpan, clippedStart?, clippedEnd?}`；
3. 桶键序列由查询层取数（T2 逐笔 / 原币 `/stats`），计算层按 `occurredLocalDate` 落桶；不跨桶二次求和、不在渲染层重算；
4. 桶 `state`（五态）与结果 `completeness`（9 态）分层：桶保留五态，结果层 9 态（s01-v2 §4.10 映射，B `timeCalendar.ts` 为唯一实现，A 只复用不再实现一套）。

## 3. 测试数据与用例

### 3.1 复用现有 fixtures A–O

A 空账本 / B 只有收入 / C 只有支出 / D 金额相同（确定性并列）/ E 单分类 / F 大量分类（「其他」折叠与守恒）/ G 大整数（> `MAX_SAFE_INTEGER`）/ H 跨月 / I 多币种 / J 缺汇率 / K 只读共享 / L 离线覆盖不足 / M 软删+恢复 / N 偶数中位与精度 / O 混合过滤。现有 219 条断言已覆盖。

### 3.2 W1 新增建议用例（准备清单，未实现）

| 编号 | 场景 | 断言要点 |
|---|---|---|
| W1-01 | 周日/周一交界 | 同一笔业务日期落周键稳定；`YYYY-Www` 与 ISO 周一致 |
| W1-02 | ISO 周 53 / 跨年周 | 键不重复、不越界；两套年份规则不混用 |
| W1-03 | 月末 31→28/29（闰年） | 月桶裁剪正确；`bucketToInclusive` 得最后业务日 |
| W1-04 | 闰日 2/29 目标年不存在 | 按 s01-draft §17.2 对齐到该年 2 月末并逐条记录（B 实现） |
| W1-05 | 跨年 12→1 | 月键序列连续、无重复 |
| W1-06 | 首尾桶部分覆盖 | `clippedStart/clippedEnd` 有值；数值不按满桶冒充 |
| W1-07 | 空桶 vs 无交易 | 缺失日不伪造 0；`unknown` 映射 `offline-incomplete`/`fx-incomplete` |
| W1-08 | 多币种 + 综合 | 只经 `aggregateFx`/`aggregateFxAsync` 逐笔折算；`shareDenominatorMinor=null` 时不渲染占比 |
| W1-09 | 大整数跨桶求和 | 守恒且无精度损失 |
| W1-10 | `dataVersion`/缓存 | 同数据版本结果一致；切换账本/账号不污染（A-4 集成阶段验证） |
| W1-11 | 只读成员 + T2 端点 | viewer 可读、无写路径（已由 T2 集成测试覆盖） |
| W1-12 | 区间上限 | 日窗口 > `maxAnalysisDays` 拒绝不截断；月数 > 36 拒绝 |

## 4. 风险清单

| 风险 | 说明 | 缓解 |
|---|---|---|
| R-1 破坏共享接口 | W1 若改 `AnalysisResult`/`AnalysisDefinition` 现有字段语义，B/C 无法消费 | 只新增可选字段/新文件；共享接口变更须登记并等 Lead/评审 |
| R-2 draft 字段未冻结 | v2 仍 `s01-v2-draft`；G-24…G-33 待所有者/Lead 结论 | W1 准备只做不依赖未定字段的适配设计；不宣称可冻结 |
| R-3 冻结门禁未满足 | S-01 v2 冻结需 B/C/D 冲突表齐 + 所有者批准 | 不提前冻结、不实现依赖未定项 |
| R-4 T2 读取范围 | W1 若需要 note/tags/userId 等，超出 G-11/已批准 T2 范围 | 只用已批准字段；新需求登记待批 |
| R-5 合并/基线冲突 | 1.16.23 rebase 已完成；集成分支可能继续变化 | 保持分支干净、不 push；冲突以 rebase 处理 |
| R-6 页面/视觉未定 | Codex 视觉与卡片尺寸未定稿，A 不应先接页面 | 只输出图表输入协议（§14），不渲染 |
| R-7 版本号 | 1.17.1 由 Lead 在集成分支统一维护 | 本分支不改 `version.ts` |
| R-8 性能 | 36 月×1500 笔等上限场景 | 复用 `aggregateFxAsync` 分批/让出；W1 接入后跑 B 性能基线 |

## 5. 可选 scaffolding 范围（**需 Lead 批准才做，当前未做**）

只做向后兼容、纯新增、不接页面的脚手架：

1. `packages/shared/src/analysis/timeKeys.ts`（新文件，纯函数，不导出到共享 barrel 之外新增语义）：`dayKey`/`isoWeekKey`/`monthKey`、`resolvedPeriodToBuckets(period, granularity)`、`bucketToInclusive`、`clipSpanToPeriod`；输入只用 `YYYY-MM-DD` 字符串；不新增第三方依赖。
2. `packages/shared/src/analysis/fixtures.ts` 追加 W1-01…W1-12 样本（只追加、不破坏现有 A–O 断言；fixtures 不进 barrel）。
3. 纯新增测试 `timeKeys.test.ts`（不触网、不依赖未冻结字段）。
4. 明确不做：不改 `types.ts` 现有字段语义、不改 `AnalysisDefinition` 必填项、不改共享 `index.ts` 的既有导出形状、不接页面、不改 `/transactions` 等契约。

## 6. A-4 启动门禁复核（G1–G7）

| 门禁 | 状态 | 说明 |
|---|---|---|
| G1 S-01 v2 冻结评审 | ⏳ 未满足 | 等 B/C/D 冲突表齐 + 所有者确认（C 核验 12 项、B 8+5 项已处理待裁定） |
| G2 1.16.23 发布后 rebase | ✅ 已满足 | 已 rebase `d4e4fd8`（26 提交零冲突），备份分支保留 |
| G3 T2 验收口径 | ⏳ 条件验收中 | 6 条件证据包已交；最终由所有者签认（不合并主线） |
| G4 集成测试环境 | ⏳ 部分满足 | 本地 `ledger_test` 已可用；正式隔离库/Ledger 由 Lead 在 W1 统一提供 |
| G5 Codex/D 视觉与尺寸定稿 | ⏳ 未满足 | 密度阈值仍为占位（200×120/320×200 待定稿） |
| G6 Claude 财务正确性复核 | ⏳ 未开始 | 26 项计算需 Claude 独立复核（Lead 安排） |
| G7 所有者对 A-4 范围书面批准 | ⏳ 未满足 | **A-4 未获批准**；本文件仅为准备 |

## 7. 下一步请求（交 Lead）

1. 是否批准 **§5 的纯新增 scaffolding**（`timeKeys.ts` + fixtures + 测试）？批准前 A 不改任何代码。
2. 待 S-01 v2 冻结后，W1 页面接入属于 A-4 正式实施，需 Lead 明确范围与集成分支协作方式（A 只在本人 worktree 产出，不合并）。
3. 集成测试环境、Codex 视觉、Claude 复核、所有者批准四项门禁由 Lead 推进后通知 A。

## 8. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-27 | 初版：A-4 准备报告（现有实现盘点、区间键适配设计、W1 用例准备、风险、scaffolding 范围、门禁 G1–G7 复核） |
