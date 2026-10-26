# S-01 共享分析结果协议草案（Agent A 拟定）

- 状态：**【草案 · 未冻结】**（`s01-draft`，2026-10-27）
- 拟定：DS-S17-A-Finance（Agent A）
- 评审：Lead、Claude（财务正确性）、Agent B、Agent C、Agent D、Codex 视觉侧（只读）
- 依据：所有者《S17-Agent-A-完整开发规格-所有者-20261026.md》§2、§3、§4、§20、§21、§24；《S17-模块化财务分析工作台-总需求规格.md》§3、§4；《S17-分析能力目录.md》§10
- 实现位置（草案代码，未接入 UI）：`packages/shared/src/analysis/{types.ts,rational.ts,primitives.ts,index.ts}`
- 最后核对：分支 `deepseek/s17-finance-category`，提交 `2a4368e` 之后的工作区改动（见任务文档 §6.2）

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
| `scalar` | `value: ScalarValue`（money/count/days/ratio 四选一）+ 可选 `comparison` | B01–B08、B13–B14、B16、B18–B19 |
| `ranked-groups` | `groups[]{ id, label, primary: ScalarValue, count, share: Ratio\|null, isFolded? }` | I03–I05、B15 排行、I17 排行 |
| `composition` | `total: MoneyValue\|null`、`parts[]{ id, label, amount: MoneyValue, count, share: Ratio\|null, isFolded? }` | I01–I02、I17 构成、B13–B14 天数构成 |
| `record-extreme` | 极值金额、业务日期、记录 id、分类、支付方式、安全摘要、`tieCount` | B09–B12、B15、B17、B20 |

扩展规则：B 需要时间序列、C 需要分布/分位数/交叉矩阵时，**在上述信封上加新 `shape` 或新 `analysisType`**，不得改动四种基础形状字段语义；新形状必须声明其完整性/来源/舍入字段来源（规格 §4.3）。

### 7.4 金额与日期小类型

- `MoneyValue { amountMinor: string; currency: string; decimals: number }`：`amountMinor` 是整数的十进制字符串，跨 JSON 不丢精度；
- `Ratio { numerator: bigint; denominator: bigint }`：只在进程内传递，跨 JSON 时由消费方转十进制文本（`ratioToDecimalText`/`ratioToPercentText`）；**不得**在协议边界放 `number` 比例；
- `ScalarValue`：`money | count | days | ratio(scale: percent-100 | fraction)`；
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
| `extremeRecord(entries, kind, "max"\|"min")` | B09/B10/B17 | 金额→日期→记录 id 的确定性并列处理；返回 `tieCount` |
| `foldRemainder(items, maxParts)` | I01「其他」 | 折叠金额守恒、返回被折叠 id；仅展示折叠，不是真实分类 |
| `toMoneyValue` / `formatMoneyForDisplay` | 序列化/显示 | 金额十进制字符串；`bigint` 精确格式化 |

`packages/shared/src/analysis/rational.ts`：`ratioOf`（约分/零分母 null）、`compareRatio`（交叉相乘）、`ratioToDecimalText`/`ratioToPercentText`（half away from zero，显示专用）、`ratioToNumber`（仅绘图）、`formatMinorExact`（任意大小 `bigint`）。

测试样本 A–O 骨架：`packages/shared/src/analysis/fixtures.ts`（不入包 barrel）；测试：`rational.test.ts`、`primitives.test.ts`。

---

## 9. 26 项与结果形状映射（草案）

| 编号 | 分析 | 形状 | 关键计算原语/说明 |
|---|---|---|---|
| B01 总支出 | scalar(money) | `totalsOf().expenseMinor` |
| B02 总收入 | scalar(money) | `totalsOf().incomeMinor` |
| B03 账目收支差额 | scalar(money) | `totalsOf().netMinor`（收入−支出；不称余额） |
| B04 支出笔数 | scalar(count) | `totalsOf().expenseCount` |
| B05 收入笔数 | scalar(count) | `totalsOf().incomeCount` |
| B06 日均支出 | scalar(money 精确) + ratio 元数据 | `averageMinor(total, dayCount)`；分母=自然日非有交易日 |
| B07 单笔平均支出 | scalar | `averageMinor(total, expenseCount)`；零笔不可计算 |
| B08 单笔支出中位数 | scalar | `medianMinor`（`bigint` 排序、偶数半单位） |
| B09 最大单笔支出 | record-extreme | `extremeRecord(...,"max")` + tieCount/来源记录 |
| B10 最小单笔支出 | record-extreme | `extremeRecord(...,"min")`；退款/负数语义待核查（A-Q3） |
| B11 最高单日支出 | record-extreme | `peakDay(...,"expense")` |
| B12 最高单日收入 | record-extreme | `peakDay(...,"income")` |
| B13 有支出记录天数 | scalar(days) | `distinctRecordedDays`；缺汇率区分原始/可折算 |
| B14 无支出记录天数 | scalar(days) | `daysWithoutRecords`；仅完整覆盖可信 |
| B15 最大支出分类 | record-extreme 或 ranked-groups 首项 | `categoryTotals` + 未分类显式 |
| B16 分类总数量 | scalar(count) | 真实分类去重；未分类不计入真实分类数 |
| B17 最大单笔收入 | record-extreme | `extremeRecord(...,"max")` |
| B18 收支比 | scalar(ratio) | `ratioOf(expense, income)`；分母零 null；>100% 不截断 |
| B19 账面结余比例 | scalar(ratio) | `ratioOf(net, income)`；可负；不称储蓄率 |
| B20 交易记录最多的一天 | record-extreme | 业务日期计数（默认收入+支出） |
| I01 支出分类构成 | composition | `categoryTotals` + `foldRemainder`；合计守恒 |
| I02 收入分类构成 | composition | 复用 I01 计算/图表核心 |
| I03 支出分类排行 | ranked-groups | `categoryTotals`（金额降序→id 升序） |
| I04 收入分类排行 | ranked-groups | 复用 I03 |
| I05 分类交易频率 | ranked-groups | 按分类计笔数；不得用 I03 金额排行冒充 |
| I17 支付方式构成 | composition / ranked-groups | `paymentMethodTotals`；未指定显式分组 |

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
- [ ] `AnalysisDefinition` 不含 presentation、不含账本 ID、首版币种只能 inherit
- [ ] 与现有 `stats.ts`/`fx.ts`/`money.ts` 复用边界（R-01…R-08）有结论

> 评审通过后：Lead 在本文件标注【已冻结（commit）】→ 通知 B/C/D/Codex → 索引 §2 S-01 行同步 → Agent A 按最终类型实现 A-1…A-4。
