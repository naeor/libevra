# S-01 共享分析结果协议草案（Agent A 拟定）

- 状态：**【草案 · 未冻结】**（`s01-draft`，2026-10-27）
- 拟定：DS-S17-A-Finance（Agent A）
- 评审：Lead、Claude（财务正确性）、Agent B、Agent C、Agent D、Codex 视觉侧（只读）
- 依据：所有者《S17-Agent-A-完整开发规格-所有者-20261026.md》§2、§3、§4、§20、§21、§24；《S17-模块化财务分析工作台-总需求规格.md》§3、§4；《S17-分析能力目录.md》§10
- 实现位置（草案代码，未接入 UI）：`packages/shared/src/analysis/{types.ts,rational.ts,primitives.ts,context.ts,index.ts}`、`analysis/analyses/{basic.ts,category.ts,statistics.ts}`、`analysis/charts/{numericCard.ts,composition.ts,ranking.ts,extremeCard.ts,index.ts}`（A-1/A-2/A-3 装配层）；测试见同目录 `*.test.ts`
- 最后核对：分支 `deepseek/s17-finance-category`，提交 `f05838f` 之后的工作区改动（A-3 交付前以任务文档 §6.2 为准）

> 本文件只**登记**接口与合同，供 B/C/D 评审与并行开发引用；**冻结前任何一方不得据此固化对外 API**。评审通过后由 Lead 在本文件标注【已冻结 + commit】，并同步索引 §2 的 S-01 行。

---

## 1. 为什么需要这个协议

规格 §4.1 的要求可以概括为一句话：**同一份账务数据，无论画成几种图、放在几种尺寸的卡片里、从卡片点进详情页，金额必须是同一个数，来源必须能回到同一批账目。**

如果每个分析函数直接返回一个 `number`，以下问题都无法回答，而且会在集成时才暴露：

| 会被问的问题 | 裸数字无法回答的后果 |
|---|---|
| 这个数按什么筛选算的？ | 卡片说"本月支出"，用户实际选了"餐饮"分类，数字对不上来源 |
| 用的是哪个区间？含不含今天？ | 90 天统计落入结束月份（审查 F01）同类问题 |
| 原币还是折算？折算缺不缺汇率？ | 把部分可折算的数字叫做"完整总支出" |
| 数据完整吗？ | 空账本显示 0，缺数据也显示 0，用户分不清 |
| 点进去看什么？ | 下钻列表与图表口径不一致，金额对不上 |
| 换尺寸会变吗？ | 卡片小尺寸重新算一遍，金额被"显示用"浮点污染 |

S-01 用一个**结果信封**统一回答这些问题，并允许 B/C 在信封上扩展时间序列/分布/矩阵，而不改标量、分组、构成、极值四种基础形状。

---

## 2. 数据流（单向，不得反向）

```
账目/授权查询（API，按 book + 权限 + 软删 + 日期过滤）
        ↓
财务计算与分组（analysis/primitives.ts：bigint 最小单位，精确求和/排序/比例）
        ↓
标准化结果信封（AnalysisResult：口径 + 完整性 + 来源 + 精确值）
        ↓
图表适配（B：只做坐标/角度/标签等展示派生，不重算权威金额）
        ↓
独立图表组件（CF-A01…CF-A07）→ 工作台卡片（C 外壳/尺寸密度）→ 详情页（D）
```

箭头**不得反向**：图表/布局/分享模板不能回写账务数据，也不能把几何尺寸写进分析定义；展示派生值（角度、条长、归一化刻度）不得反推金额或来源（规格 §4.2、§20.1）。

---

## 3. 金额合同（权威值）

1. **权威金额 = 整数最小单位**（`bigint`）。CNY/USD/EUR/HKD/GBP 为 2 位小数，JPY 为 0 位（`packages/shared/src/money.ts` 的 `CURRENCY_DECIMALS`/`decimalsFor`）。计算层不得把权威值转成 `number` 再累加。
2. **禁止浮点权威累加。** 展示可用浮点（角度、像素、归一化刻度）；金额标签、合计、来源必须来自精确值（规格 §3.3、§20.1）。
3. **原币模式**：结果只包含一个原始币种，不跨币种相加；`resolvedCurrency = { mode: "original", currency }`。
4. **综合模式**：只复用现有 FX 引擎 `aggregateFxAsync`（逐笔 `convertFx`、精确有理数汇率、最多 7 天历史回退、逐笔 `minor-half-away-v1` 舍入）；不得自创汇率算法、不得先合计后折算；`resolvedCurrency = { mode: "aggregate", targetCurrency }`，并且完整性必须反映缺汇率笔数（规格 §3.4）。
5. **平均值/中位数/比例/比率允许高于最小货币单位的中间精度**：用精确有理数 `Ratio`（分子/分母均为 `bigint`，约分，分母恒正，零分母用 `null`）。**不得提前舍入中间结果**；只在显示时按 `minor-half-away-v1` 四舍五入一次。
6. **超过 `Number.MAX_SAFE_INTEGER` 的金额不得错**：接口中金额一律以十进制字符串传输（`MoneyValue.amountMinor`），计算与格式化用 `bigint`（`formatMinorExact`）。
7. **负值语义**：数据库 `amountCents` 现为 `>= 0`（`ledger.ts` 的 `amountCentsSchema`）；差额/比例为负是合法结果，应按 `bigint` 有符号处理，不得用 `abs()` 掩盖方向（规格 §3.2、ACC-10）。退款/冲销/负金额的业务语义**以既有合同为准**，本协议不擅自定义（见 §11 待评审 R-04）。

---

## 4. 日期与区间合同

1. 日期一律为 `YYYY-MM-DD` 字符串（业务日期 = `Transaction.occurredLocalDate`），不使用 `Date` 做分组键，避免服务器/浏览器时区漂移（规格 §3.5）。
2. **业务日期**只取 `occurredLocalDate`；不得用 `occurredAt` 转 UTC 日期、不得用 `createdAt`/`updatedAt`（操作时间）冒充交易日期。
3. 用户语义区间为**闭区间** `[from, to]`；数据库查询使用**半开区间** `[from, to + 1 day)`。`ResolvedPeriod.dayCount = daysBetween(from, to)`（`packages/shared/src/stats.ts`，含两端）。
4. 周起始固定**周一**；"本月/本周/近 30 天"等预设统一由范围解析器解析，不得在卡片里各写一套；对比期优先复用 `comparisonRangeFor`（整月对整月、本月至今对上月同日、滚动窗口对等长前窗）。
5. 统计区间上限沿用现有 `MAX_STATS_DAYS = 400`；超出需明确报错而不是静默截断。

---

## 5. 完整性合同

`AnalysisCompleteness` 为结构化枚举，**不是布尔**（规格 §3.6）：

| 状态 | 含义 | 展示层要求 |
|---|---|---|
| `complete` | 数据完整，值可信 | 正常展示；来源可核对 |
| `no-transactions` | 区间内确实没有符合条件的记录 | 展示真实零/空态，**不得**画成"100% 未分类" |
| `partial` | 部分数据缺失/部分记录不可用 | 明示"部分结果"，不得标完整 |
| `fx-incomplete` | 综合模式有记录缺汇率，未能折算 | 不得把可折算部分重新归一化为 100%；必要时禁用完整构成图 |
| `offline-incomplete` | 离线覆盖不足 | 明示覆盖不足；"无支出记录天数"等覆盖率分析不可视为完整 |
| `loading` | 加载中 | 显示骨架，**不得**先展示错误金额 |
| `request-failed` | 请求失败 | 错误态，不展示旧账本/旧请求的数字 |
| `no-permission` | 无权限（被移除成员/账本归档） | 不展示金额；权限判断只许新增，不得放宽既有 |
| `not-applicable` | 该分析定义在当前数据模型下不适用 | 说明原因，不显示模拟值 |

规则：**"支出为零"与"无法确定"必须区分**；不完整时结果可携带 `unavailableReason`，此时不得渲染为完整金额卡（ACC-06、ACC-07）。

---

## 6. 来源追溯合同

每个金额分析的结果必须携带 `SourceDescriptor`（规格 §3.7、ACC-08）：

- `analysisId` / `resolvedPeriod` / `resolvedFilters` / `groupBy`：用户点开详情时重新获取来源账目的精确条件；
- `query`：来源读取路径（现有 `GET /api/v1/stats` 或 `GET /api/v1/transactions`）与参数；
- `transactionIds`：本次结果包含的单笔记录（极值/记录级分析必须返回）；
- `dataVersion`：同一 `AnalysisDefinition` 的多张卡片共享的数据版本戳（当前 API 无现成字段，见 §11 R-02/A-Q6）。

**权限边界**：`SourceDescriptor` 只是"地址"，不是授权凭证。详情页每次取数必须重新经过 `apps/api/src/ledger/access.ts` 的 `requireBook`/`requireBookForWrite` 校验；图表/详情/分享模板不得绕过（ACC-12）。**账本敏感数据（金额、备注、成员信息）不得进入布局导出/分享模板**（规格 §4.3）。

---

## 7. 类型定义（登记）

以下为草案实际类型（`packages/shared/src/analysis/types.ts`），评审后如有变更在此同步：

### 7.1 分析定义 `AnalysisDefinition`

```ts
{
  version: "s01-draft";
  analysisId: string;            // 如 AN-B05 / B05（编号映射待定，见 A-Q1）
  analysisType: string;
  metric: string;
  aggregation?: "sum" | "count" | "average" | "median" | "extreme" | "share" | "ratio";
  groupBy?: "category" | "paymentMethod" | "day" | "record";
  filters?: { kind: "expense" | "income" | "both"; categoryIds?: string[]; paymentMethodIds?: string[]; tagIds?: string[] };
  time: { mode: "inherit" | "preset" | "fixed" | "relative"; preset?: "7d"|"30d"|"90d"|"365d"; from?: string; to?: string; days?: number };
  currency: { mode: "inherit" };  // 首版：卡片不得独立覆盖币种（规格 Q-16）
}
```

要点：
- `presentation`（图表类型/颜色/尺寸密度）**不属于**分析定义——同一 `AnalysisDefinition` 在任意图表家族、任意尺寸下结果必须一致（ACC-02）。
- 分析定义**不含金额、不含账本 ID**；账本与权限由查询层上下文提供，不能由定义绕过（规格 §4.1、ACC-12）。
- 类型尽量严格，不使用无校验 `Record`；用户个人配置与请求权限分离。

### 7.2 结果信封 `AnalysisResultBase`

```ts
{
  version: "s01-draft";
  analysisId: string;
  analysisType: string;
  metric: string;
  resolvedFilters: ResolvedFilters;    // 实际生效筛选（null=不限制；[]=限制为空，两者不同）
  resolvedPeriod: { from: string; to: string; dayCount: number };
  resolvedCurrency: { mode: "original"; currency: string } | { mode: "aggregate"; targetCurrency: string };
  completeness: AnalysisCompleteness;
  unavailableReason?: string;
  dataVersion: string | null;
  computation: ComputationMetadata;   // 舍入策略、分子/分母、样本数、并列数、FX 标记
  source: SourceDescriptor;
}
```

### 7.3 四种结果形状

| 形状 | 结构要点 | 使用分析（所有者编号） |
|---|---|---|
| `scalar` | `value: ScalarValue \| null`（**null=不可确定/阻塞态，禁止渲染为 0**）+ 可选 `comparison` | B01–B08、B13–B14、B16、B18–B19 |
| `ranked-groups` | `groups[]{ id, label, primary: ScalarValue, count, share: Ratio\|null, secondary?: ScalarValue, isFolded? }`（`secondary` 供 I05 同时展示笔数与金额） | I03–I05、B15 排行、I17 排行 |
| `composition` | `total: MoneyValue\|null`、`parts[]{ id, label, amount: MoneyValue, count, share: Ratio\|null, isFolded? }` | I01–I02、I17 构成、B13–B14 天数构成 |
| `record-extreme` | `extreme: MoneyValue\|null`（金额类极值）、`occurredLocalDate`、`recordId`、`categoryId/categoryLabel`、`paymentMethodLabel`、`summary`、`tieCount`；A-3 增可选 `extremeValue?: ScalarValue`（**非金额极值**，如 B20 记录数，禁止把笔数装扮成金额）与 `countBreakdown?: {total,income,expense}`（B20 收支笔数拆分） | B09–B12、B15、B17、B20 |

扩展规则：B 需要时间序列、C 需要分布/分位数/交叉矩阵时，**在上述信封上加新 `shape` 或新 `analysisType`**，不得改动四种基础形状字段语义；新形状必须声明其完整性/来源/舍入字段来源（规格 §4.3）。

### 7.4 金额与日期小类型

- `MoneyValue { amountMinor: string; currency: string; decimals: number }`：`amountMinor` 是整数的十进制字符串，跨 JSON 不丢精度；
- `Ratio { numerator: bigint; denominator: bigint }`：只在进程内传递，跨 JSON 时由消费方转十进制文本（`ratioToDecimalText`/`ratioToPercentText`）；**不得**在协议边界放 `number` 比例；
- `ScalarValue`：`money | count | days | ratio(scale: percent-100 | fraction) | exact-money`；
  - `exact-money { numeratorMinor: string; denominator: string; currency: string; decimals: number }`：**精确有理数金额**（B06 日均、B07 单笔平均这类不整除结果），分子/分母都是整数十进制字符串，内部不提前舍入；显示时由 `ratioToDecimalText` 按显示精度做一次 half-away 舍入再 `formatMinorExact`（见 `charts/numericCard.ts › scalarText`）；
- 日期一律 `YYYY-MM-DD` 字符串。

> 复用优先：现有 `summaryResponseSchema`/`statsResponseSchema` 是展示 DTO（`number` 分），**不是** S-01 的权威结果；S-01 在计算层用 `bigint` 重新承载，展示层可继续用现有 DTO 的字段命名习惯。是否合并两套类型待评审（R-01）。

---

## 8. 计算原语（已实现，纯函数，无 Prisma/HTTP 依赖）

`packages/shared/src/analysis/primitives.ts`：

| 原语 | 用途 | 关键合同 |
|---|---|---|
| `AnalysisEntry` | 计算输入（记录级） | `amountMinor: bigint`；`currency`；`occurredLocalDate`；`categoryId`；`paymentMethodId?: string\|null`；`deletedAt?` |
| `isLive` / `liveEntries` | 软删除过滤 | `deletedAt === null` 才参与统计 |
| `entriesInRange` | 业务日期闭区间过滤 | `[from, to]` 字符串比较 |
| `assertSingleCurrency` | 拒绝跨币种相加 | 混币抛 `RangeError("mixed_currency:...")`；空集返回 `null` |
| `totalsOf` / `sumByKind` / `countByKind` | B01–B05 基础 | 精确 `bigint` 求和、分 kind 计数 |
| `averageMinor(total, count)` | B06/B07 | 零分母 → `null`（不是 0） |
| `medianMinor(amounts)` | B08 | 偶数样本返回精确半单位 `Ratio`；`bigint` 排序 |
| `distinctRecordedDays` / `daysWithoutRecords` | B13/B14 | 按业务日期去重；"无记录"≠"没花钱" |
| `categoryTotals(entries, kind)` | B15/I01–I05 | 金额降序→分类 id 升序；系统"暂无分类"保留为真实组并标记 `isSystem` |
| `paymentMethodTotals(entries, kind)` | I17 | `paymentMethodId=null` → 显式"未指定"组，不丢弃 |
| `dayTotals` / `peakDay` | B11/B12 | 先按业务日期汇总再取最高；并列计数 |
| `peakRecordedDay(entries)` | B20 | 按业务日期统计**交易笔数**取最高日；返回 `{date,count,incomeCount,expenseCount,tieCount}`；与金额高峰无关 |
| `extremeRecord(entries, kind, "max"\|"min")` | B09/B10/B17 | 金额→日期→记录 id 的确定性并列处理；返回 `tieCount` |
| `foldRemainder(items, maxParts)` | I01「其他」 | 折叠金额守恒、返回被折叠 id；仅展示折叠，不是真实分类 |
| `toMoneyValue` / `formatMoneyForDisplay` | 序列化/显示 | 金额十进制字符串；`bigint` 精确格式化 |

装配层构建器（`packages/shared/src/analysis/context.ts`）：`prepareScope`（解析区间/筛选/完整性）、`makeScalar`/`makeRankedGroups`/`makeComposition`/`makeExtreme`（四种形状信封统一组装，保证 `source`/`completeness`/`computation` 不会各装配函数各写一套）。

`packages/shared/src/analysis/rational.ts`：`ratioOf`（约分/零分母 null）、`compareRatio`（交叉相乘）、`ratioToDecimalText`/`ratioToPercentText`（half away from zero，显示专用）、`ratioToNumber`（仅绘图）、`formatMinorExact`（任意大小 `bigint`）。

测试样本 A–O 骨架：`packages/shared/src/analysis/fixtures.ts`（不入包 barrel）；测试：`rational.test.ts`、`primitives.test.ts`。

---

## 9. 26 项与结果形状映射（草案）

| 编号 | 分析 | 形状 | 关键计算原语/说明 |
|---|---|---|---|
| B01 总支出 | scalar(money) | `totalsOf().expenseMinor`；装配 `assembleTotalExpense`（analyses/basic.ts） |
| B02 总收入 | scalar(money) | `totalsOf().incomeMinor`；装配 `assembleTotalIncome` |
| B03 账目收支差额 | scalar(money) | `totalsOf().netMinor`（收入−支出；不称余额）；装配 `assembleNetAmount` |
| B04 支出笔数 | scalar(count) | `totalsOf().expenseCount`；装配 `assembleExpenseCount` |
| B05 收入笔数 | scalar(count) | `totalsOf().incomeCount`；装配 `assembleIncomeCount` |
| B06 日均支出 | scalar(exact-money) + ratio 元数据 | `averageMinor(total, dayCount)`；分母=自然日非有交易日；装配 `assembleDailyAverageExpense` |
| B07 单笔平均支出 | scalar(exact-money) | `averageMinor(total, expenseCount)`；零笔不可计算；装配 `assembleAverageExpensePerTransaction` |
| B08 单笔支出中位数 | scalar(exact-money) | `medianMinor`（`bigint` 排序、偶数样本精确半单位）；装配 `assembleMedianExpense`（analyses/statistics.ts） |
| B09 最大单笔支出 | record-extreme | `extremeRecord(...,"max")` + tieCount/来源记录；装配 `assembleMaxExpenseTransaction`；`source.transactionIds` 携带该记录 id（记录级取数待 T2，A-Q17） |
| B10 最小单笔支出 | record-extreme | `extremeRecord(...,"min")`；不擅自过滤非正记录（退款/负数语义待 W1 细则，A-Q3）；装配 `assembleMinExpenseTransaction` |
| B11 最高单日支出 | record-extreme | `peakDay(...,"expense")`（单日总额最高，非最大单笔所在日）；装配 `assemblePeakExpenseDay`（`computation.sampleCount`=当日笔数） |
| B12 最高单日收入 | record-extreme | `peakDay(...,"income")`；装配 `assemblePeakIncomeDay` |
| B13 有支出记录天数 | scalar(days) | `distinctRecordedDays`；同日多笔只算一天、不因币种重复计日；装配 `assembleDaysWithExpenseRecords` |
| B14 无支出记录天数 | scalar(days) | `daysWithoutRecords`；仅完整覆盖可信，非 complete 时 `computation.notes` 标 `coverage incomplete`；装配 `assembleDaysWithoutExpenseRecords` |
| B15 最大支出分类 | record-extreme 或 ranked-groups 首项 | `categoryTotals` + 未分类显式；装配 `assembleMaxExpenseCategory`（analyses/category.ts，`tieCount`=同金额组数） |
| B16 分类总数量 | scalar(count) | 真实分类去重；未分类不计入真实分类数；装配 `assembleCategoryCount`（`isSystem` 真实标记判定，notes 记 `realCategories`/`uncategorised-present\|absent`） |
| B17 最大单笔收入 | record-extreme | `extremeRecord(...,"max")`；装配 `assembleMaxIncomeTransaction`；`source.transactionIds` 携带记录 id（待 T2，A-Q17） |
| B18 收支比 | scalar(ratio, percent-100) | `ratioOf(expense, income)`；收入分母零→null（不可计算，不是 0）；>100% 不截断；装配 `assembleExpenseIncomeRatio` |
| B19 账面结余比例 | scalar(ratio, percent-100) | `ratioOf(net, income)`；可负；不称储蓄率；装配 `assembleLedgerSurplusRatio` |
| B20 交易记录最多的一天 | record-extreme | `peakRecordedDay`（业务日期计数，默认收入+支出）；用 `extremeValue`=count + `countBreakdown`，`extreme`（金额字段）为 null，不把笔数装扮成金额；装配 `assembleMostRecordedDay` |
| I01 支出分类构成 | composition | `categoryTotals` + `foldRemainder`；合计守恒；装配 `assembleExpenseCategoryComposition`（`maxParts` 折叠「其他」，total 仅在 complete 且 >0 时非 null） |
| I02 收入分类构成 | composition | 复用 I01 计算/图表核心；装配 `assembleIncomeCategoryComposition` |
| I03 支出分类排行 | ranked-groups | `categoryTotals`（金额降序→id 升序）；装配 `assembleExpenseCategoryRanking`（`topN`） |
| I04 收入分类排行 | ranked-groups | 复用 I03；装配 `assembleIncomeCategoryRanking` |
| I05 分类交易频率 | ranked-groups | 按分类计笔数；不得用 I03 金额排行冒充；装配 `assembleCategoryFrequency`（primary=count、secondary=money、share=count/totalCount） |
| I17 支付方式构成 | composition / ranked-groups | `paymentMethodTotals`；未指定显式分组；装配 `assemblePaymentMethodAnalysis`（`metric: "amount"\|"count"` 为两种受支持参数，不混为同一指标） |

---

## 10. 排序、并列与分组规则（统一，避免各图表各写一套）

1. 金额类排序：主值降序，次值用稳定 id（分类 id/支付方式 id/记录 id）升序；**禁止**依赖 Map 插入序、刷新序或语言相关排序。
2. 并列：并列最大值/同金额必须给出 `tieCount` 或确定性首项，不得随机变化（B08/B09/B15/B20）。
3. 未分类：系统分类"暂无分类"是真实分类，必须出现在构成/排行中（可标记系统分类），金额不得丢失（规格 §20.4/§20.5）。
4. 未指定支付方式：`paymentMethodId = null` 是显式"未指定"组，不得丢弃或并入其它方式。
5. 「其他」折叠：只折叠低占比分类，金额=被折叠分类精确合计，可展开，返回被折叠 id，来源追溯到全部成员；不能把大金额类别不合理藏进不可展开的其他（规格 I01）。
6. 颜色稳定：分类颜色按稳定身份（分类 id）映射主题调色板，不按本次金额排序重排（规格 §20.6，视觉令牌待 Codex，A-Q8）。

---

## 11. 待评审问题（登记，不阻塞草案）

| 编号 | 问题 | 建议/现状 | 需谁决定 |
|---|---|---|---|
| R-01 | 现有 `statsResponseSchema` 用 `number` 分（cents），S-01 用 `bigint`+十进制字符串；两套类型并存还是收敛 | 建议并存：现有 API 不改，分析层新增精确路径；收敛需接口变更（涉及 1.16.23 重叠基线，A-Q2） | Lead + Claude + 后端 |
| R-02 | `dataVersion` 数据版本戳在现有 API 无字段（A-Q6） | 短期用"查询参数+返回范围"派生哈希占位，需 Lead 确认取得方式 | Lead |
| R-03 | 综合模式缺逐笔数据入口：现有 stats API 不返回来源交易，`aggregateFxAsync` 需逐笔 `FxEntry` | 建议 T2 只读扩展（新增逐笔范围查询，不改 schema、不改写入），A-Q13 | Lead + 后端 |
| R-04 | 退款/冲销/负金额/零金额在现有合同下的统计语义（B10 最小单笔、差额方向） | 现状 DB 金额 `>= 0`；建议 A-3 前与既有合同对齐，不擅自 `abs()` | 所有者 W1 细则 |
| R-05 | `averagePerDay`（现有）返回整最小单位，与 B06 "中间精度"冲突（A-Q11） | 建议：旧接口保留给现有页面；分析层用精确 `Ratio`，两者不互相替代 | Lead + Claude |
| R-06 | `byCategory.share` 是 float，S-01 权威比例是 `Ratio`（A-Q12） | 建议协议内用 `Ratio`，float 只作旧接口兼容/展示 | Lead + Claude |
| R-07 | 大额（> `Number.MAX_SAFE_INTEGER`）经现有 `number` DTO 会丢精度（A-Q14） | 建议分析层全 `bigint`；API 是否字符串化待评估（涉及 B/C 与后端） | Lead + 后端 |
| R-08 | 离线覆盖范围元信息当前不可得（A-Q16） | 建议先按"本机数据完整"假定并标记 `offline-incomplete` 占位，等同步模块合同 | Lead + 离线模块 |

---

## 12. 与现有代码的事实关系（调研结论，供评审）

| 现有能力 | 位置 | 与 S-01 的关系 |
|---|---|---|
| 日期工具/对比期/区间上限 | `packages/shared/src/stats.ts` | 直接复用 `daysBetween`/`comparisonRangeFor`/`rangeForPreset` 语义；不在分析层重写 |
| 原币统计 | `apps/api/src/routes/stats.ts`（GET /api/v1/stats） | 数据来源之一；但无来源交易 ID、无 per-kind count（`totals.count` 为收支合计）、share 为 float、仅 day/month 桶 |
| 明细查询 | `apps/api/src/routes/transactions.ts`（GET /api/v1/transactions） | 来源追溯/记录级分析的数据来源；当前仅支持 `month` 过滤、无任意 from/to、无金额排序（极值来源需 T2 扩展） |
| 汇率折算 | `packages/shared/src/fx.ts`（`convertFx`/`aggregateFxAsync`/`FxPolicy`） | 综合模式唯一允许的实现；逐笔折算、7 天回退、`minor-half-away-v1`；不完整时 `shareDenominatorMinor=null` |
| 金额工具 | `packages/shared/src/money.ts` | `decimalsFor` 复用；`formatMinor` 只接受 safe `number`，分析层另用 `formatMinorExact(bigint)` |
| 权限 | `apps/api/src/ledger/access.ts` | 查询层负责；协议只携带可再次校验的条件，不携带授权 |
| 数据模型 | `prisma/schema.prisma` | `Transaction.occurredLocalDate` 是分组/筛选唯一依据；`amountCents` BigInt ≥0；`categoryId` 必填（Restrict）、`paymentMethodId` 可空（SetNull）；软删除 `deletedAt`；分类只归档、不物理删除 |

---

## 13. 评审清单（请评审人逐条勾选）

- [ ] 金额合同（BigInt 最小单位、禁止浮点权威累加、原币/综合边界）无异议
- [ ] 日期合同（业务日期 `occurredLocalDate`、闭区间用户语义 + 半开 DB、周一为周首）无异议
- [ ] 完整性 9 状态覆盖 `complete/no-transactions/partial/fx-incomplete/offline-incomplete/loading/request-failed/no-permission/not-applicable` 且不混淆零与不可计算
- [ ] 来源追溯字段足够 B/D 实现下钻且不扩大权限
- [ ] 四种结果形状可覆盖 A 的 26 项，并为 B/C 扩展留出空间
- [ ] `ScalarValue` 新增 `exact-money`（B06/B07 精确平均）且 `ScalarResult.value` 可为 `null`（不可确定，禁止渲染为 0）无异议
- [ ] 图表输入协议（§14：numeric-card / composition-chart / ranking-chart）足够 Codex/B/C/D 直接消费，且绘图数值只从精确值派生
- [ ] 极值摘要卡输入（§14.5 extreme-card）足够 CF-A02 消费；B20 的笔数以 `unit:"count"` 呈现、不装扮成金额
- [ ] `RecordExtremeResult` 新增 `extremeValue?`/`countBreakdown?` 只增不改，不破坏 B09–B12/B15/B17 现有字段语义
- [ ] 与 B 的时间扩展登记（§15：7 形状命名归 A、`dataVersion` 生产方与递增语义、`SourceDescriptor.bucket?`、半开↔闭区间换算、图表输入契约、`coverageEnd` 复用完整性）已评审；R-09/A-Q21 有结论
- [ ] 统计口径登记（§16：Type 7 分位、总体 vs 样本方差/标准差、σ 表示与舍入、CV 定义与零均值边界）已评审；R-10 有结论
- [ ] 区间上限与窗口（§17：月键比较不设日上限、日窗口 `maxAnalysisDays` 默认 400、闰日 2 月末对齐逐条记录、A05 默认 `same-day-index` + `policyId`）已评审；Q-BA-12a/12b/B-Q13/B-Q14 有结论
- [ ] `AnalysisDefinition` 不含 presentation、不含账本 ID、首版币种只能 inherit
- [ ] 与现有 `stats.ts`/`fx.ts`/`money.ts` 复用边界（R-01…R-08）有结论

---

## 14. 图表输入协议（A-1/A-2 装配层，草案）

> 目的：把「权威分析结果」适配成「图表组件可直接消费的输入」，使 Codex/后续渲染层**不需要也不允许重算金额**（规格 §4.2、§24、ACC-02/ACC-08）。
> 原则：输入里的每个数值文本都来自精确结果；绘图用 `number` 比例只作归一化，**不得**用比例反推金额；尺寸/密度只影响展示项，不改变权威值（ACC-02）。
> 实现：`packages/shared/src/analysis/charts/{numericCard.ts,composition.ts,ranking.ts,extremeCard.ts}`；测试 `charts/charts.test.ts`、`charts/extremeCard.test.ts`。

### 14.1 数值指标卡 `NumericCardInput`（CF-A01，B01–B08/B13–B14/B16/B18–B19）

```ts
{
  kind: "numeric-card";
  analysisId: string;
  density: "compact" | "medium" | "expanded";   // 由真实容器尺寸 chooseCardDensity(w,h) 决定
  title: string;
  valueText: string | null;                     // null = 不可确定（加载/失败/无权限），禁止显示 0
  unit: "currency" | "count" | "days" | "percent" | "fraction";
  currency: string | null;
  sign: "positive" | "negative" | "zero" | "unknown";
  auxiliary: { id: "count" | "days" | "total" | "comparison"; valueText: string }[];
  completeness: AnalysisCompleteness;
  unavailableReason?: string;
  source: SourceDescriptor;
}
```

- 密度阈值（**临时占位，A-Q5 待 Codex 定稿**）：`CARD_DENSITY_THRESHOLDS.medium = {minWidth:200,minHeight:120}`、`expanded = {minWidth:320,minHeight:200}`；compact 不展示辅助项、medium 最多 1 条、expanded 展示全部。
- `valueText` 在三种密度下必须完全相同（同定义不同尺寸数值一致，ACC-02）。

### 14.2 构成图 `CompositionChartInput`（CF-A03/A04/A05，I01/I02/I17）

```ts
{
  kind: "composition-chart";
  analysisId: string;
  currency: string | null;
  totalMinor: string | null;     // 精确最小单位；null = 不完整/无数据
  totalText: string | null;
  segments: {
    id: string; label: string;
    amountMinor: string;         // 权威金额（精确）
    amountText: string;
    share: Ratio | null;         // 权威比例（精确）；不完整时 null
    shareText: string | null;    // 显示用（可四舍五入，但不得反向改金额）
    fractionOfTotal: number | null;  // 仅供绘图归一化；仅 drawable 时非 null
    isFolded: boolean;           // 「其他」折叠段
  }[];
  completeness: AnalysisCompleteness;
  drawable: boolean;             // complete && total!==null && total>0n：缺汇率/无数据时不得伪装完整构成
  source: SourceDescriptor;
}
```

### 14.3 排行图 `RankingChartInput`（CF-A04/A07，I03–I05/I17/B15）

```ts
{
  kind: "ranking-chart";
  analysisId: string;
  primaryKind: "money" | "count";
  maxValue: string | null;       // 最大主值（精确，绘制归一化基准）
  items: {
    rank: number; id: string; label: string;
    primaryKind: "money" | "count";
    primaryMinor: string | null; // money 主值的精确最小单位；exact-money 主值不参与条形绘制（null）
    count: number | null;
    primaryText: string | null;
    secondaryText: string | null;   // I05：笔数 + 金额同时呈现
    share: Ratio | null;
    shareText: string | null;
    fractionOfMax: number | null;   // 仅供绘图归一化
    isFolded: boolean;
  }[];
  completeness: AnalysisCompleteness;
  source: SourceDescriptor;
}
```

- `maxValue` 必须来自精确主值；条形长度 = 精确值比例，**不得**对非零截断或把极小值放大（规格 I03 规则）。
- 折叠段（「其他」）同样携带精确金额与 `isFolded=true`，点击可展开到 `foldedGroupIds`（由结果形状提供）。

### 14.4 与 CF 家族/尺寸的关系

- 图表输入只描述**内容**（值/标签/份额/完整性/来源）；具体图表类型（环形/横向条/排行表/百分比条）、颜色、圆角、动画属于视觉与渲染层（Codex/S-02），不在本协议内。
- 尺寸自适应：调用方按真实宽高选择 `NumericCardInput.density`；构成/排行图在容器过小或数据不可绘制时，由卡片层回退到摘要形态，**不得**缩小字号硬塞完整图表（规格 §18）。

### 14.5 极值摘要卡 `ExtremeCardInput`（CF-A02，B09–B12/B15/B17/B20）

```ts
{
  kind: "extreme-card";
  analysisId: string;
  density: "compact" | "medium" | "expanded";
  title: string;
  valueText: string | null;        // 主值（金额或笔数）；null = 不可确定，禁止显示 0
  unit: "currency" | "count" | "days" | "percent" | "fraction" | null;
  currency: string | null;         // 非金额极值（B20）为 null
  sign: "positive" | "negative" | "zero" | "unknown";
  occurredLocalDate: string | null;
  categoryLabel: string | null;
  paymentMethodLabel: string | null;
  tieCount: number;                // 并列数；1 = 无并列
  countBreakdown?: { total: number; income: number; expense: number }; // B20
  auxiliary: { id: "date" | "tie" | "category" | "income-count" | "expense-count"; valueText: string }[];
  completeness: AnalysisCompleteness;
  unavailableReason?: string;
  source: SourceDescriptor;
}
```

- 密度：compact 只保证主值 + 1 条最必要辅助（业务日期）；medium 前 2 条；expanded 全部。辅助项顺序固定 `date → tie(>1) → category → income-count → expense-count`，**不依赖语言或本地化排序**。
- `valueText` 三种密度下必须完全相同（ACC-02）；B20 的「笔数」必须以 `unit:"count"` 呈现，不得塞进金额字段借金额卡伪装。
- 记录级极值（B09/B10/B17）同时给出 `recordId` 与可再次校验的 `source`；记录详情取数受 T2 与权限约束，卡片只显示安全摘要，不扩大权限面（ACC-12）。
- 与 `NumericCardInput` 的关系：同为 CF-A02/A01 的输入适配层，均复用 `chooseCardDensity`/`scalarText`；两者都不改变权威值。

## 15. 与 Agent B 的时间扩展对齐（登记，不冻结）

> 背景：Agent B 的 B-0 草案 `S17-Agent-B-S01-时间扩展协议草案.md`（459 行，提交 `b23311c`，未 push）提出 7 个时间结果形状与 Q-BA-1…11；Lead 要求 A 在 S-01 内登记答复。以下全部为**登记项**，不改变已登记四形状语义；S-01 冻结前仍需 Lead/Claude/所有者评审。
> 边界：A 只在自己的协议草案与任务文档登记结论，**不修改 B 的工作区/文件**；B 的异议经 Lead 转达。

### 15.1 Lead 六问逐条答复

1. **7 个时间形状是否进 `AnalysisResult` union：是，登记。** 冻结版本的 union = 现有四形状 + `time-series` / `multi-series` / `period-comparison` / `calendar-heatmap` / `moving-average` / `variability` / `anomaly`。**命名归 A**（A 维护 `types.ts` 与 S-01）：采纳 B 建议的 discriminator 英文名逐字不变，A 在 `types.ts` 统一声明；B 不改名，若确需改名走 Lead 裁决。实现状态：仅登记，代码待 B-1，A 不预先实现 B 的形状。
2. **`dataVersion` 属于 S-01：是，已在 `AnalysisResultBase.dataVersion: string|null`。** 语义：由**计算入口**（工作台数据层/查询入口）生成并传入的「书级数据版本令牌」；同一 snapshot 内所有卡片/结果必须相同；数据变化（新增/修改/删除/恢复/导入、影响显示的分类/支付方式改名或归档）时递增；格式为不透明字符串（`"<epochMillis>-<seq>"` 或内容哈希，由 W1/W2 与后端定，A-Q6）；缓存键必须包含它；`null` 只允许用于无持久化的一次性预览。生产方**不是** A 的纯计算函数（A 只透传），也不是渲染层；B/C/D 不得自行递增或伪造。与 B 的 Q-BA-4 一致。
3. **逐桶来源追溯：需要，登记 `SourceDescriptor.bucket?` 可选字段**：`{ key; granularity:"day"|"week"|"month"; from; to（闭区间换算后）; clippedStart?; clippedEnd? }`。整图级 descriptor 不带 `bucket`；桶级 descriptor 必须与该桶计算口径一致（同一 filters/period/currency）；点桶下钻按 `bucket.from/to` 用闭区间查询，权限重新校验（ACC-12）。与 B 的 Q-BA-3 一致。
4. **半开桶 ↔ 闭区间 `ResolvedPeriod`：统一规则** —— 结果与用户可见区间继续用闭区间 `[from,to]`；时间桶内部用半开 `[start,end)`；换算函数 `bucketToInclusive(bucket): { from; to }`（日粒度 `to = addDays(end,-1)`；周/月粒度取自然桶末日）；`clippedStart/clippedEnd` 记录与工作台区间裁剪的边界，裁剪后闭区间仍可还原。**不新增日期类型**，在 `types.ts` 注释与 B 的 `analysis/time.ts` 声明同一转换语义。与 B 的 Q-BA-2 一致。
5. **7 形状与 CF 图表输入的衔接（一句话契约）**：「结果形状 = 权威口径（精确值 + 完整性 + 来源）；图表输入 = 只读适配层（把同一结果映射为渲染可直接消费的字段，含仅供绘图的 `number` 比例）；渲染层不得重算金额、不得改变完整性状态。」B 的时间图表（折线/柱状/热力/移动平均等）按同一模式在 S-01 §14 增补「time-chart 输入」登记位（**§14.6 预留**，由 B 提草案、A 登记、Codex 视觉确认），不得把 axis/label 等展示派生写回结果。
6. **`coverageEnd` 如何表达：复用 `AnalysisCompleteness`，不新增状态枚举。** 离线覆盖不足时 B 的桶 `state:"unknown"` 按 B §4.2 映射为结果/桶 `completeness:"offline-incomplete"`；`coverageEnd` 本身是**计算输入**（B 的 `classifyBucket` 参数），不是新状态。若卡片需显示「数据截至 X」，建议（未冻结，**R-09**）在 `ComputationMetadata` 增可选 `coverageEnd?: string|null` 作展示元数据；完整性判定只认 `completeness`，不得用「有 coverageEnd 即完整」反推。等离线模块合同（A-Q16/R-08）明确后再冻结。

### 15.2 其余 Q-BA 合并结论（A 侧登记）

| 编号 | B 的建议 | A 的登记结论 |
|---|---|---|
| Q-BA-5 | `groupBy` 增 `"week"\|"month"` | **不在 `AnalysisDefinition.groupBy` 混入时间粒度**（避免混淆「按分类分组」与「按时间分桶」）；建议新增可选 `timeGranularity?: "day"\|"week"\|"month"`（登记 **A-Q21**，S-01 冻结时一并定）；B 的时间定义用 `analysisType` + 该字段表达 |
| Q-BA-6 | `analysisType` 命名空间 `time.*` | 同意并扩为规则 `<domain>.<name>`，domain ∈ `basic\|category\|time\|dist\|cross\|record`；A 侧按 A-4 统一，B 用 `time.*` 不阻塞 |
| Q-BA-7 | 桶级复用 `AnalysisCompleteness` | 同意：桶级复用同一枚举，映射按 B §4.2；不新增桶级枚举（桶 `state` 是 B 内部时间语义） |
| Q-BA-8 | `Ratio` 的 JSON 传输 | 进程内 `bigint`；跨 HTTP 统一序列化为 `{ numerator: string; denominator: string }`（整数十进制字符串，不丢精度、不转 `number`）；A 在 S-01 冻结版登记，B/C 照此实现 |
| Q-BA-9 | `TimeAxisHint` 属于结果 | 同意：轴属于计算口径（business-date、周一起、桶粒度），归结果；locale/颜色/像素宽度归渲染层 |
| Q-BA-10 | FX 完整性直接引用 | 同意：综合模式引用 `aggregateFx` 的 `complete/missingCount/reviewDates`，按 S-01 §5 映射完整性，不重算 |
| Q-BA-11 | I13 星期分布用 7 桶模板轴 | 不阻塞：先用 `TimeSeriesResult` + `weekday` 7 桶模板轴表达；若后续 B 需要独立形状再走 S-01 扩展登记 |

### 15.3 对 S-01 冻结的影响

- Q-BA-1/2/3/4/7/8 在 A 侧已有明确登记结论（§15.1、§15.2），B 可据此继续 B-1；**S-01 仍为 `s01-draft`**，上述登记需与 S-01 一并经 Lead/Claude/所有者评审后冻结。
- 新增待评审项：**R-09**（`ComputationMetadata.coverageEnd?` 展示元数据）、**A-Q21**（`timeGranularity?` 字段）；A 不据此实现 B 的形状，也不修改 B 的工作区。

> 评审通过后：Lead 在本文件标注【已冻结（commit）】→ 通知 B/C/D/Codex → 索引 §2 S-01 行同步 → Agent A 按最终类型实现 A-1…A-4。

## 16. 统计口径：分位数与离散度（登记，不冻结，2026-10-27 应 Lead m01444 补）

> 背景：Agent C 的 C-1 已按《S17-Agent-A-完整开发规格》§5 实现 **Type 7 分位**与**总体方差/总体标准差（σ）/CV**（提交 `0a51ac3`，C 分支，未 push）。Lead m01444 要求 A 在 S-01 中登记统一口径，避免 A/B/C 三方各写一套。
> 边界：本节只登记口径，**不改 A 侧代码/测试，不改变已登记四形状语义**；S-01 仍 `s01-draft`。C 的 7 类高级结果形状（RankedRecords/Distribution/Contribution/Matrix/Hierarchy/Scatter/FXDiagnostic）未来进 S-01 v2，由 Lead 汇总，本节不预先登记它们的结构。

### 16.1 分位数：Type 7（线性插值，R 默认 / Hyndman-Fan Type 7）

**定义（1-based 排序）**：样本 `x₁ ≤ x₂ ≤ … ≤ xₙ`（按精确最小单位 `bigint` 排序；**不得**转 `number` 排序），概率 `p ∈ [0,1]`：

- `h = (n − 1)·p + 1`
- `k = floor(h)`，`γ = h − k`
- `Q(p) = xₖ + γ·(xₖ₊₁ − xₖ)`；边界：`k = n` 或 `p = 1` 时 `Q(p) = xₙ`，`p = 0` 时 `Q(0) = x₁`
- `n = 0`：**不可计算**（`null`），不补 0；`n = 1`：`Q(p) = x₁`（任意 p）

**精确实现要求（禁止浮点权威值）**：

- `p` 以精确分数 `p = a/b` 传入（`b > 0`，`0 ≤ a ≤ b`）；`h` 的分子 `H = (n−1)·a + b`、分母 `b`；`k = H div b`，余数 `r = H mod b`，`γ = r/b`。
- `Q(p) = (xₖ·b + r·(xₖ₊₁ − xₖ)) / b`，结果为精确有理数（`Ratio{ numerator: bigint; denominator: bigint }`，自动约分）。金额标签显示时**一次性**按 `minor-half-away-v1` 舍入（与 §3/§7.4 一致），不得提前舍入中间量。
- 等价关系：`p = 1/2` 的 Type 7 结果与 A 的 `medianMinor`（奇数取中、偶数取两中位数均值）**完全一致**（B08 即此口径）；两者不得互相替代实现另一套算法。
- 原币/综合：样本必须同一币种同一折算口径；原币模式不跨币种；综合模式用 `aggregateFxAsync` 逐笔折算后的精确最小单位序列，**不得**用显示文本或 `number` 反推。
- 排序稳定性：金额相同按「金额 → 业务日期 → 交易 id」稳定排序（与 §10 一致），保证分位可复现；分位本身对相同值不敏感，但分组/来源过滤需一致。
- 支持范围：首版支持 **p ∈ [0,1] 的精确分数**（如 0.25=1/4、0.9=9/10、0.95=19/20）；不支持加权分位；如后续需要 P25/P50/P75/P90/P95/P99 固定档，用对应分数，不引入浮点参数。非法 `p`（<0、>1、分母 0）属**协议层错误**（拒绝请求），不得静默返回 0 或空。

**A/B/C 分工**：A 的 B08 中位数已符合本节（`Ratio` 精确）；B 的时间分析若用分位（如移动分位/分布桶）须引用本节；C 的分布类分析（`Distribution` 形状）在 S-01 v2 登记时引用本节，不改定义。

### 16.2 方差、标准差与 CV：总体 vs 样本

只对同一币种/同一折算口径的精确最小单位序列 `x₁…xₙ`（`bigint`）计算；`n = 0` 不可计算；`n = 1` 时方差为 0（总体定义），标准差 0，CV 仍按均值判定（见下）。

| 量 | 总体（population，**C-1 已实现、默认口径**） | 样本（sample，仅显式要求时） |
|---|---|---|
| 均值 | `μ = (Σxᵢ)/n`（精确 `Ratio`） | 同左 |
| 方差 | `σ² = Σ(xᵢ − μ)² / n` | `s² = Σ(xᵢ − μ)² / (n − 1)`（`n ≥ 2`） |
| 标准差 | `σ = √(σ²)` | `s = √(s²)` |
| 适用 | 统计期内全部符合条件交易，视作完整总体（Libevra 分析场景默认） | 仅当分析定义明确声明“样本估计”时；不得与总体混用 |

**区分与命名（强制）**：

- 结果必须带显式口径字段：`varianceKind: "population"`（默认）或 `"sample"`；同一结果内 σ/σ²/CV 必须同一口径。
- 名称不得混用：`populationVariance`/`populationStandardDeviation`（σ）/`sampleVariance`/`sampleStandardDeviation`（s）不得互换；中文「总体方差/总体标准差」「样本方差/样本标准差」与之一一对应。
- σ 记号：正文用 **σ**（U+03C3）与 **σ²**；代码/字段用 `populationStandardDeviation`、`populationVariance`，避免 `SD`、`std`、`stdev` 等多种缩写。

**数值表示（关键，禁止浮点冒充权威值）**：

- 均值 `μ`、方差 `σ²`/`s²`：精确有理数 `Ratio`（`σ²` 的单位是「最小单位²」；跨 HTTP 按 §15.2 Q-BA-8 序列化为 `{ numerator: string; denominator: string }`）。
- 标准差 `σ`/`s` 含开方，一般**无理数**，不能用一个有理数精确表示；登记表示：

  ```ts
  interface SqrtValue {
    readonly radicand: Ratio;      // σ² 或 s² 的精确有理数
    readonly decimalText: string;  // 按显示规则一次性舍入后的十进制文本（带符号，不含单位符号）
    readonly decimals: number;     // 显示小数位
  }
  ```

  - `radicand` 是权威值；`decimalText` 是**展示派生**，由 `radicand` 开方后一次性 half-away-from-zero 舍入得到；**不得**把 `decimalText` 回写 `radicand`，不得用 `decimalText` 参与金额校验。
  - 显示位数默认：金额单位用 `decimalsFor(currency)`（JPY 为 0），比率类按 CF 家族规定；协议冻结时由 Lead/Claude 确认统一位数（登记 **R-10**）。
- CV（变异系数）= **总体 σ ÷ μ**（同一口径；若 `varianceKind:"sample"` 则用 `s ÷ μ`）：

  ```ts
  interface CoefficientsOfVariation {
    readonly standardDeviation: SqrtValue; // 与 varianceKind 一致
    readonly mean: Ratio;                  // 同一批样本的精确均值
    readonly scale: "fraction" | "percent-100";
    readonly decimalText: string;          // 显示派生，一次性舍入
  }
  ```

  - **仅当 `μ > 0` 时 CV 可计算**；`μ = 0` → `null`（不得显示 ∞、0 或 NaN）；`μ < 0` 在金额场景不应出现（账目金额非负、同 kind），若出现按既有财务合同处理并标不可计算/异常，不得用绝对值掩盖符号。
  - CV 只表达相对离散程度，**不表示金额**，不得渲染为货币金额卡；单位显示按 `scale`（百分比或小数），默认 `percent-100`、1 位小数（显示派生）。
  - CV 与均值/σ 必须来自同一数据版本戳（`dataVersion`）与同一 `resolvedFilters`/`resolvedPeriod`；跨期比较时不得各自用不同分母。

### 16.3 与现有实现/其他 Agent 的关系

- **A**：`medianMinor`（B08）与 §16.1 的 `p=1/2` 一致；A 的 26 项中没有方差/σ/CV 结果，**不新增代码**（Lead m01444：只登记口径）。
- **B**：时间序列/波动性（`Variability` 形状）若输出方差/σ/CV，必须引用 §16.2 的 `varianceKind` 与 `SqrtValue`，不得把 σ 直接当金额 `MoneyValue`。
- **C**：C-1 已实现总体口径（Type 7 分位 + 总体 σ/CV），对应 C 侧问题编号 **QC-10**（分位口径）与 **QC-11**（总体方差/标准差 σ/CV）；本节与 QC-10/QC-11 的交叉引用关系**保持登记**：以本节为 S-01 侧统一口径，C 的 `Distribution`/`RankedRecords` 等形状在 S-01 v2 登记时引用本节；C 可继续用当前实现，待 S-01 冻结后核对字段命名。
- **S-01 v2 收口**：C 的 QC-10/QC-11 与 B 的 `Variability` 对本节的引用关系，由 Lead 在 S-01 v2 统一汇总；本节暂不据此改动 A/B/C 任何实现。
- **渲染**：图表输入（§14）只接收 §16.2 的展示派生文本与 `fractionOf*` 绘图数值；渲染层不得自行开方或重算方差。

### 16.4 待评审（R-10，登记）

- **R-10**：`SqrtValue`/`CoefficientsOfVariation` 的字段命名、`decimalText` 位数默认（金额 vs 比率）、CV 的 `scale` 默认值；以及「分位参数 p 的输入形式（精确分数 vs 分子/分母二元组）」——由 Lead/Claude/C 评审后随 S-01 冻结一并确定。
- 本节为**登记项**：不修改 A 侧代码/测试（保持 A-4 未启动），不修改 C/B 工作区；S-01 保持 `s01-draft`。

## 17. 区间上限与窗口（登记，不冻结，2026-10-27 应 Lead m01545 补）

> 背景：Agent B 的 B-3 已交付，登记了 **Q-BA-12（区间上限）**、**B-Q13（闰日对齐）**、**B-Q14（A05 默认窗口政策）** 三个待决口径；Lead 给出暂定裁定，要求 A 在 S-01 登记。
> 边界：本节只登记口径，**不改 A 代码/测试、不改 B 工作区、不改变已登记四形状语义**；S-01 仍 `s01-draft`；以下均为 draft 口径并列入 §17.4「待所有者确认」。

### 17.1 分析区间上限：两类边界（回答 Q-BA-12）

现有 `packages/shared/src/stats.ts` 的 `MAX_STATS_DAYS = 400` 只约束**统计端点的单次日窗口**，不应直接套到「按月键比较」的分析上（I09 需要 12/24/36 个月、A01 同比需跨 ≥1 年、A12/A14 需长样本）。S-01 登记两类边界：

**(a) 月键比较（month-key）——不设日上限，月份数量另限**

- 适用：以「月」或「周」为比较键的分析（A04 多月比较、I09 多月趋势、A12 年度/多年汇总、A14 长样本等）。
- 边界语义：按**月键**表达（`YYYY-MM`；周键 `YYYY-Www`）比较，**不设日上限**（不得把「36 个月」换算成 1095 天后再被 400 天拒绝）；月份数量上限**另定**（暂记 **36**，与 A04 规格上限一致；是否允许更大/可配置待所有者确认）。
- 实现约束：即使月键比较也不得把多月拼成一次超过查询端点上限的单区间请求——调用方按月拆分/月粒度查询后合并；每月的闭区间 `[from,to]` 仍按 §4 合同表达。
- 结果必须声明覆盖的首末日期（闭区间，供展示/来源）与比较键类型；`resolvedPeriod` 仍为日期闭区间，月键解释作为比较语义元数据登记（字段名待评审，不预先实现）。

**(b) 日窗口比较（day-window）——调用方传 `maxAnalysisDays`，暂默认 400**

- 适用：以日为窗口的分析（A01/A02/A03/A05 的日粒度、B04 趋势、B08 热力、A 侧按日窗口的统计等）。
- 边界语义：单次分析日窗口上限由**调用方传入 `maxAnalysisDays`**（不是每张卡/每个分析定义硬编码），**暂默认 400**（沿用 `MAX_STATS_DAYS`，与现有统计端点一致）；超出上限属**协议层错误**（拒绝请求），**不截断、不静默丢弃数据**。
- 该上限为计算入口参数（与 `dataVersion` 同层），A 侧纯函数只做校验与报错；具体 API 的分页/条数上限（如 T2 逐笔端点 ≤400 天且 ≤500 条）仍由各端点自行实现，不因本节放宽。
- 未来若调整为更大值（如 B 建议的 `MAX_ANALYSIS_DAYS = 3660`，覆盖 10 年日粒度），需所有者确认，并**同时评估**后端查询/分页/性能与前端多卡并发，不默认放宽。

**(c) 边界清单**

| 公式/场景 | 边界类型 | 上限口径 |
|---|---|---|
| 单次日窗口统计 / 逐笔范围查询 | day-window | `maxAnalysisDays`（默认 400），越界拒绝 |
| 多月比较（A04/I09，12/24/36 个月） | month-key | 无日上限；月份数暂记 ≤36（待确认） |
| 同比/去年同期（A03/A01） | day-window + 逐条对齐 | 每个窗口按 day-window；对齐见 §17.2 |
| 长样本/移动平均/波动性（B 的 Variability 等） | day-window 或自带上限 | 按分析定义声明；默认 `maxAnalysisDays`，需扩展时走 S-01 v2 |

### 17.2 B-Q13：闰日对齐（draft 口径，Lead 暂定批准）

- 适用：同比（year-over-year）及任何「同月同日」对齐（B 的 A03 / A01 等）。
- **2/29 在目标年不存在时**：取该年 **2 月最后一天**（非闰年即 2/28）对齐，**不静默丢日**。
- **逐条记录**：每处回退必须逐条写入 `leapDayFallbacks: [{ date, alignedTo }]`（B 草案字段名 `resolution.leapDayFallbacks`）；A/S-01 侧建议在结果的比较元数据（或 `ComputationMetadata.notes`）中登记同一信息（字段名待评审，不预先实现）。
- **不得相加**：不得把 2/29 与 2/28 两天的金额相加后再比较；按实际对齐后的记录/日期逐条计算，口径与展示一致。
- 分母/样本数按对齐后的实际记录数计算并标 draft 口径；显示层不得隐藏回退标记，来源追溯沿用 §6（来源必须可复原对齐关系）。

### 17.3 B-Q14：A05 默认窗口政策（draft 口径，Lead 暂定批准）

- **默认 `policyId = "same-day-index"`**：本月第 N 天 ↔ 上/同期第 N 天（如本月 1–27 日 ↔ 上月 1–27 日）；历史月较短时**裁剪**并在 `previousClipped` 标注（不补齐、不重复计数）。
- **可选 `policyId = "equal-length-window"`**：等长窗口对齐（窗口长度相同，可能跨自然月），结果必须标 `comparisonMode: "equal-length"` 并给出提示字段/文案；**不得静默切换**默认政策。
- **`policyId` 写入结果**（比较结果的可选字段或 `ComputationMetadata`，字段名待评审），不允许每张卡片自行选择；默认值（`same-day-index`）待所有者确认。
- 两种政策均复用 §3 金额合同（精确、原币/综合隔离、FX 完整性映射）与 §17.1(b) 的日窗口上限。

### 17.4 待所有者确认清单（本节新增，draft）

| 编号 | 事项 | 暂定口径（Lead m01545 暂定裁定） | 待确认 |
|---|---|---|---|
| Q-BA-12a | 月键比较的月份数量上限 | 暂记 36（对齐 A04 规格上限），不设日上限 | 是否允许更大/按分析可配置 |
| Q-BA-12b | 日窗口 `maxAnalysisDays` 默认值 | 400（沿用 `MAX_STATS_DAYS`），越界拒绝 | 是否调到 3660 或按分析类型分档；由谁传入 |
| B-Q13 | 闰日对齐 | 取目标年 2 月末；逐条记 `leapDayFallbacks`；不相加、不静默丢日 | 字段名与展示方式；来源追溯如何表达对齐 |
| B-Q14 | A05 默认窗口政策 | 默认 `same-day-index`；可选 `equal-length-window`；`policyId` 写入结果 | 默认值是否维持；`previousClipped`/提示字段名 |

- 既有的 S-01 待评审项（R-01…R-10、A-Q20…A-Q24）仍以 §11/§15/§16 为准；本节新增项随 S-01 冻结一并评审。

### 17.5 对 S-01 冻结的影响

- 本节为**登记项**：不修改 A 代码/测试（A-4 未启动），不修改 B 工作区，不改变现有四形状语义；S-01 保持 `s01-draft`。
- 待 Lead 在 S-01 v2 收口时把本节与 B 的 Q-BA-12/B-Q13/B-Q14、C 的 QC-10/QC-11 一并汇总评审。
