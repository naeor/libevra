# S17 · Agent B 对 S-01 的时间扩展协议草案（B-0 交付）

> 状态：**草案 v0.1（2026-10-27）**，未冻结；提交 Agent A / Lead / Claude 评审。
> 归属：`packages/shared/src/analysis/types.ts` 由 **Agent A 拥有**。本文件只是 B 对时间类结果形状的**需求与建议**，不改 A 的文件；A 采纳后由其合并，B 在 `packages/shared/src/analysis/time.ts` 提供纯计算实现（B-1 起）。
> 依据：所有者完整开发规格 §3（时间口径）、§4（金额与汇率）、§5.1–5.8（结果形状）、§40（B-0 交付清单）。
> 复用：A 的 S-01 草案 `s01-draft`（`ANALYSIS_PROTOCOL_VERSION`）、`packages/shared/src/analysis/rational.ts`、`types.ts` 与 `rational.ts` 中的 `Ratio`。
> 时间基础：`packages/shared/src/timeCalendar.ts`（B-0 已提交，`TIME_CONTRACT_VERSION = "s17-b-time-v1"`）。

---

## 0. 结论摘要

1. **不另立框架。** 全部时间类结果继承 A 的 `AnalysisResultBase`，只新增 `shape` 与形状专有字段；金额只用 `MoneyValue` / `ScalarValue` / `Ratio`。
2. **新增 7 个结果形状**：`time-series`、`multi-series`、`period-comparison`、`calendar-heatmap`、`moving-average`、`variability`、`anomaly`，对应规格 §5.2–§5.8。
3. **时间桶使用半开 `[start, end)`**（`timeCalendar.ts` 已实现），与 A 的 `ResolvedPeriod`（闭区间）显式转换，不混用。
4. **"零"与"未知"在桶级区分**：桶同时携带 `state`（时间/覆盖状态）与 `completeness`（S-01 枚举），映射规则见 §4。
5. **仍需 A 决定的 11 个对齐问题**见 §7；其中 Q-BA-1/2/3/4 阻塞 A 的 S-01 冻结，其余可与 B-1 并行。

---

## 1. 扩展原则

- **P1 一个结果 = 一次查询。** 时间序列结果自带实际区间、口径、币种、完整性、来源，不允许图表层再查一次或再分组。
- **P2 精确金额。** 任何权威值使用 `MoneyValue`（`amountMinor` 十进制字符串）或 `ScalarValue`；平均值/增长率用 `Ratio` 或 `exact-money`，不得使用 float。
- **P3 桶是日历事实。** 桶边界由 `timeCalendar.ts` 决定：日=自然日、周=周一起自然周、月=自然月；`20xx-Www` 为 ISO 周键。
- **P4 缺失不是零。** 桶值为 `null` 时必须同时给出 `state`/`completeness`/理由；序列的 `total` 只在可全量统计时非空。
- **P5 显示不回头改语义。** 同一结果可画成折线/面积/柱/热力/Sparkline；画法不同不得改变金额、区间、分组、完整性。
- **P6 向后兼容。** 只增形状、只增可选字段；不修改 A 已发布的 `ScalarResult` / `RankedGroupsResult` / `CompositionResult` / `RecordExtremeResult` 字段语义。

---

## 2. 复用 A 的哪些约定

| 需要的东西 | 复用 A 的 | 说明 |
|---|---|---|
| 结果公共信封 | `AnalysisResultBase` | `analysisId/analysisType/metric/resolvedFilters/resolvedPeriod/resolvedCurrency/completeness/unavailableReason/dataVersion/computation/source` |
| 数量/金额/比例 | `MoneyValue`、`ScalarValue`、`Ratio`（`rational.ts`） | 金额整数最小单位；比例精确分数 |
| 区间 | `ResolvedPeriod`（`from`/`to` 闭区间 + `dayCount`） | B 的桶内部用半开，边界转换见 §4.3 |
| 币种口径 | `ResolvedCurrency`（`original` / `aggregate`） | 原币模式单币种；综合模式逐笔 FX |
| 完整性 | `AnalysisCompleteness` 9 态 | 桶级复用同枚举，含义见 §4.2 |
| 来源 | `SourceDescriptor`（含 `query.kind: "stats" \| "transactions"`） | 逐桶来源需要新字段，见 §6 |
| 定义 | `AnalysisDefinition` | 时间继承 `time.mode/preset/fixed/relative`；B 需要 `groupBy: "week" \| "month"`（见 Q-BA-5） |
| 舍入 | `ANALYSIS_ROUNDING_POLICY = "minor-half-away-v1"` | 只允许显示层舍入 |

---

## 3. 类型草案（TS）

> 以下为**建议签名**，A 可调整命名/组织；语义不可放松。

### 3.1 时间桶（所有序列共用）

```ts
import type { Ratio } from "./rational.js";
import type {
  AnalysisCompleteness,
  AnalysisResultBase,
  MoneyValue,
  ResolvedPeriod,
  ScalarValue,
  SourceDescriptor,
} from "./types.js";

/** 与 timeCalendar.ts 的 TimeGranularity 相同；结果层不重复定义语义。 */
export type TimeGranularity = "day" | "week" | "month";

export type TimeBucketState = "complete" | "in-progress" | "future" | "unknown" | "unavailable";

export interface TimeBucket {
  /** 稳定键：`YYYY-MM-DD` / ISO `YYYY-Www` / `YYYY-MM`，跨刷新与跨设备一致。 */
  readonly key: string;
  readonly granularity: TimeGranularity;
  /** 分析区间内实际统计的半开区间，已裁剪。 */
  readonly span: { readonly start: string; readonly end: string };
  /** 自然周期（整日/整周/整月），未裁剪。 */
  readonly naturalSpan: { readonly start: string; readonly end: string };
  /** 分析起点在自然周期内部（如区间从周三开始）。 */
  readonly clippedStart: boolean;
  /** 分析终点在自然周期内部（如区间到周三结束）。 */
  readonly clippedEnd: boolean;
  /** 时间/覆盖状态，见 §4.1。 */
  readonly state: TimeBucketState;
  /** 该桶的权威值；`unknown`/`unavailable` 或不可计算时为 null。 */
  readonly value: ScalarValue | null;
  /** 参与统计的有效记录数；不可知时为 null。 */
  readonly recordCount: number | null;
  /** 数据质量（S-01 枚举），与 state 正交，见 §4.2。 */
  readonly completeness: AnalysisCompleteness;
  /** 逐桶来源；点击桶必须能重建这一桶的过滤与区间（规格 §3.11）。 */
  readonly source: SourceDescriptor;
}
```

### 3.2 单序列结果：`TimeSeriesResult`（规格 §5.2；I06–I10、I19、I20）

```ts
export interface TimeAxisHint {
  readonly format: "day" | "week" | "month";
  /** 业务日期口径：所有日期均为记录发生地的本地日历日，不做时区换算。 */
  readonly timeZoneMode: "business-date";
  /** 周桶固定周一起（所有者决定 Q-07）。 */
  readonly weekStart: "monday";
  /** 标签生成方式提示，不是像素尺寸。 */
  readonly labelKind: "date" | "iso-week" | "month";
}

export interface TimeSeriesResult extends AnalysisResultBase {
  readonly shape: "time-series";
  readonly granularity: TimeGranularity;
  /** "expense" | "income" | "net" | "count" | 扩展指标名。 */
  readonly metric: string;
  readonly unit: "money" | "count";
  readonly currency: string | null;
  readonly buckets: readonly TimeBucket[];
  /** 全部桶的精确合计；任一桶不可全量统计时为 null 并给 completeness。 */
  readonly total: ScalarValue | null;
  /** 有效（complete 或 in-progress）桶数量；unknown/future 不计。 */
  readonly effectiveBucketCount: number;
  /** 累计走势（I10/I19 等）。false 时为逐桶值。 */
  readonly cumulative: boolean;
  readonly axis: TimeAxisHint;
}
```

### 3.3 多序列结果：`MultiSeriesResult`（规格 §5.3；I11–I16、A18 等）

```ts
export interface TimeSeriesEntry {
  readonly seriesId: string;
  readonly label: string;
  readonly metric: string;
  readonly unit: "money" | "count";
  readonly currency: string | null;
  readonly completeness: AnalysisCompleteness;
  /** 与 axis 的桶逐键对齐；缺桶必须显式 null + state，不允许下标猜测。 */
  readonly points: readonly TimeBucket[];
}

export interface MultiSeriesResult extends AnalysisResultBase {
  readonly shape: "multi-series";
  readonly granularity: TimeGranularity;
  /** 公共时间轴：桶键、区间、状态。所有序列必须按它对齐。 */
  readonly buckets: readonly Omit<TimeBucket, "value" | "recordCount" | "completeness" | "source">[];
  readonly series: readonly TimeSeriesEntry[];
  readonly alignment: "shared-time-buckets";
  readonly axis: TimeAxisHint;
  /** 图例顺序建议，由计算层给出，图表不重排。 */
  readonly legendOrder: readonly string[];
}
```

### 3.4 周期比较结果：`PeriodComparisonResult`（规格 §5.4；A01–A05）

```ts
export interface ComparisonSide {
  readonly period: ResolvedPeriod;
  readonly value: ScalarValue | null;
  readonly completeness: AnalysisCompleteness;
  /** 是否完整自然周期（整月/整周/整年），用于声明可比性。 */
  readonly wholeNaturalPeriod: boolean;
  /** 实际观察到的跨度（天），与 period.dayCount 可能不同（裁剪）。 */
  readonly observedDays: number;
}

export interface PeriodComparisonResult extends AnalysisResultBase {
  readonly shape: "period-comparison";
  readonly metric: string;
  readonly unit: "money" | "count";
  readonly current: ComparisonSide;
  readonly previous: ComparisonSide;
  /** 比较口径解释，见规格 §3.10 / §5.4。 */
  readonly comparisonMode: "whole-period" | "like-for-like" | "rolling-window" | "month-to-date";
  readonly comparisonBasis: "previous-period" | "year-earlier";
  /** 绝对差额，精确；不可计算时 null。 */
  readonly difference: ScalarValue | null;
  /** 增长率；分母为 0 时为 null 并给 reason（规格 §4.5）。 */
  readonly growth: {
    readonly ratio: Ratio | null;
    readonly scale: "percent-100";
    readonly unavailableReason: "previous-zero" | "previous-missing" | "currency-mismatch" | null;
  };
  /** 两侧是否等长观察区间（不是等长自然周期）。 */
  readonly equalObservedLength: boolean;
}
```

### 3.5 日历热力结果：`CalendarHeatmapResult`（规格 §5.5；I12、I14 等）

```ts
export interface CalendarHeatmapDay {
  readonly date: string;
  /** 金额或笔数，由 unit 决定。 */
  readonly value: ScalarValue | null;
  readonly recordCount: number | null;
  readonly state: TimeBucketState;
  readonly completeness: AnalysisCompleteness;
  /** ISO 星期：1=周一 … 7=周日。 */
  readonly weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly monthKey: string;
  /** 在当月网格中的行号（周一起，0 起）。 */
  readonly weekIndexInMonth: number;
  readonly source: SourceDescriptor;
}

export interface CalendarHeatmapResult extends AnalysisResultBase {
  readonly shape: "calendar-heatmap";
  readonly granularity: "day";
  readonly unit: "money" | "count";
  readonly months: readonly {
    readonly monthKey: string;
    readonly weekCount: number;
    readonly firstDate: string;
    readonly lastDate: string;
  }[];
  readonly days: readonly CalendarHeatmapDay[];
  /** 强度映射必须基于精确值（不是归一化后的浮点），并暴露实际范围。 */
  readonly intensity: {
    readonly basis: "value" | "count";
    readonly min: ScalarValue | null;
    readonly max: ScalarValue | null;
  };
  readonly axis: TimeAxisHint;
}
```

### 3.6 移动平均结果：`MovingAverageResult`（规格 §5.6；A12）

```ts
export interface MovingAverageResult extends AnalysisResultBase {
  readonly shape: "moving-average";
  readonly granularity: TimeGranularity;
  readonly metric: string;
  readonly unit: "money" | "count";
  /** 原始序列（含完整性）。 */
  readonly raw: TimeSeriesEntry;
  /** 窗口长度（桶数），必须是正整数。 */
  readonly window: number;
  /** true=尾随窗口；false=居中窗口。 */
  readonly trailing: boolean;
  /** 平滑值按轴桶对齐；不足窗口或数据不可用时为 null + state。 */
  readonly smoothed: readonly TimeBucket[];
  /** 缺失处理：忽略缺桶 / 要求整窗完整。 */
  readonly gapPolicy: "ignore-missing-window" | "require-full-window";
  /** 实际参与过至少一次平滑的桶数。 */
  readonly effectiveWindowCount: number;
  readonly axis: TimeAxisHint;
}
```

### 3.7 波动结果：`VariabilityResult`（规格 §5.7；A14、A19）

```ts
export interface VariabilityResult extends AnalysisResultBase {
  readonly shape: "variability";
  readonly metric: string;
  readonly unit: "money" | "count";
  /** 有效观察数量（参与统计的桶数，不含 unknown/future）。 */
  readonly observations: number;
  /** 统计使用的样本范围（可能是分析区间的子区间）。 */
  readonly samplePeriod: ResolvedPeriod;
  readonly mean: ScalarValue | null;
  readonly median: ScalarValue | null;
  readonly min: ScalarValue | null;
  readonly max: ScalarValue | null;
  readonly range: ScalarValue | null;
  readonly variability: {
    readonly kind: "standard-deviation" | "iqr" | "coefficient-of-variation";
    readonly value: ScalarValue | null;
    /** 公式说明的 i18n key 与参数；文字由实现层按语言渲染。 */
    readonly formulaKey: string;
    readonly parameters: Readonly<Record<string, string>>;
  };
  readonly sufficientSample: boolean;
}
```

### 3.8 异常结果：`AnomalyResult`（规格 §5.8；A20）

```ts
export interface AnomalyMark {
  readonly date: string;
  readonly value: MoneyValue;
  readonly method: "median-mad" | "median-iqr";
  readonly baselineMedian: MoneyValue;
  readonly spreadMinor: string;
  readonly thresholdMultiplier: string;
  readonly deviationRatio: Ratio | null;
  readonly recordCount: number;
  readonly source: SourceDescriptor;
}

export interface AnomalyResult extends AnalysisResultBase {
  readonly shape: "anomaly";
  readonly metric: string;
  readonly unit: "money";
  readonly marks: readonly AnomalyMark[];
  readonly method: "median-mad" | "median-iqr";
  readonly parameters: {
    readonly thresholdMultiplier: string;
    readonly minimumSample: number;
  };
  readonly sampleCount: number;
  readonly samplePeriod: ResolvedPeriod;
  readonly sufficientSample: boolean;
  /** 中性、准确的算法说明（规格 §5.8：不得夸张宣称）。 */
  readonly disclaimerKey: string;
  readonly axis: TimeAxisHint;
}
```

### 3.9 联合类型与注册

```ts
export type TimeAnalysisResult =
  | TimeSeriesResult
  | MultiSeriesResult
  | PeriodComparisonResult
  | CalendarHeatmapResult
  | MovingAverageResult
  | VariabilityResult
  | AnomalyResult;

// A 的 types.ts 中合并（二选一，推荐 A）：
// export type AnalysisResult =
//   | ScalarResult | RankedGroupsResult | CompositionResult | RecordExtremeResult
//   | TimeAnalysisResult;
```

B-1 起，B 在 `packages/shared/src/analysis/time.ts` 提供构造这些结果的纯函数（输入为已按权威统计口径聚合的桶值），并导出 `TIME_ANALYSIS_SHAPES` 供注册表使用。**B 不新建第二套信封。**

---

## 4. 完整性：三套状态如何对齐

### 4.1 桶的 `state`（时间语义）

| state | 含义 | 由谁判定 |
|---|---|---|
| `complete` | 数据覆盖到该桶分析切片的最后一天；0 是真实 0 | `timeCalendar.classifyBucket` |
| `in-progress` | 自然周期包含"今天"，尚未结束；不得当作完整周期参与历史统计 | `classifyBucket` |
| `future` | 桶开始日期晚于"今天"，不可能有记录 | `classifyBucket` |
| `unknown` | 覆盖未知或不足（离线缓存未下载完整等）；**不得显示为 0** | `classifyBucket`（coverageEnd=null 或不够） |
| `unavailable` | 该桶分析无法执行（汇率缺失/请求失败/无权限） | 计算层显式设置 |

### 4.2 `state × completeness` 映射（写入实现常量 `BUCKET_COMPLETENESS`）

| state | 无记录 | 有记录/值为 0 | 说明 |
|---|---|---|---|
| `complete` | `no-transactions` | `complete` | 真实 0 与"没有交易"可区分 |
| `in-progress` | `no-transactions` | `complete`（数据 OK，周期未完） | 周期未完不是数据问题；UI 用 state 提示 |
| `future` | `not-applicable` | `not-applicable` | 不参与任何历史统计 |
| `unknown` | `offline-incomplete` | `offline-incomplete` | 离线覆盖不足 |
| `unavailable` | 依原因 | 依原因 | `fx-incomplete` / `request-failed` / `no-permission` |

注意：`in-progress` **不等于** `partial`。`partial` 留给"区间内部分数据缺失"（如某些天未下载）；`in-progress` 是日历事实（规格 §3.10）。

### 4.3 半开桶 ↔ 闭区间 `ResolvedPeriod`

- `ResolvedPeriod.from/to` 保持闭区间（A 已定义，勿改）。
- B 的桶内部一律半开；统一转换器为 **`bucketToInclusive(bucket) → {from, to}`**（A §15.1(4) 命名，已实现于 `packages/shared/src/timeCalendar.ts`，日粒度 `to = end-1`，周/月取自然桶末日；`spanToInclusive` 为其底层）。
- 序列总 `total` 必须等于各桶值之和（complete 桶）；unknown/future 桶为 null 且**不计入** total 的分母，total 为 null 时在 `computation.notes` 记录原因。

---

## 5. 不变式（实现与测试必须守住）

- **IV-01 覆盖**：桶序列从分析区间第一天连续到 `end-1`，无缺口、无重叠；首尾桶完整覆盖区间。
- **IV-02 稳定键**：`key` 跨刷新/跨设备一致；周键用 ISO 周（`2026-W44`），闰年与跨年不漂移。
- **IV-03 守恒**：`sum(bucket.value)` 与 `total` 一致（同币种、同一 FX 口径、全部桶可用时）。
- **IV-04 精确性**：权威金额是 `MoneyValue`/`exact-money`，不出现浮点累计。
- **IV-05 币种隔离**：原币模式只含一种币；综合模式逐笔折算后统一 `targetCurrency`，不得混加原币。
- **IV-06 汇率复用**：综合模式使用 S16-D 既有逐笔历史汇率结果（`fx.ts` 的 aggregate），B 不重算。
- **IV-07 缺失≠0**：`unknown`/`fx-incomplete` 桶的 `value` 为 null；图表断点或标注，不得画成 0。
- **IV-08 未来**：`future` 桶不进入历史平均、波动、异常、同比分母。
- **IV-09 未完成周期**：`in-progress` 桶保留 `clippedEnd` 与自然周期边界，比较口径必须显式声明。
- **IV-10 来源可复原**：每个桶的 `source` 指向能精确重建该桶的查询（时间+过滤+币种）。
- **IV-11 数据版本**：同一结果内所有桶的 `dataVersion` 相同；与卡片缓存键一致。
- **IV-12 轴提示无语义外信息**：`axis` 只给格式化提示，不含像素/尺寸/颜色。
- **IV-13 比率分母**：分母 0/缺失 → `Ratio | null` + `unavailableReason`，不得给 `Infinity`/`NaN`。
- **IV-14 只读**：任何时间分析不得创建/修改/删除交易，不得写回财务数据（规格 §4.6）。

---

## 6. 逐桶来源追溯合同（规格 §3.11）

要求：用户点某桶（如 10 月 1–7 日的总支出）→ 来源列表必须精确覆盖该桶，不得扩大到整月。

现状：A 的 `SourceDescriptor.query` 只有 `{kind, from, to, currency, categoryId?, paymentMethodId?}`，没有桶作用域。建议（Q-BA-3）：

```ts
export interface SourceDescriptor {
  // …A 现有字段不变…
  /** 时间桶来源：点击桶时优先使用；不改变整体分析的 period 语义。 */
  readonly bucket?: {
    readonly key: string;
    readonly granularity: TimeGranularity;
    readonly from: string;
    readonly to: string;
    /** 该桶被裁剪时标记，来源列表必须按实际切片过滤。 */
    readonly clippedStart: boolean;
    readonly clippedEnd: boolean;
  } | undefined;
}
```

- 桶 `source.bucket` 存在时，来源页以 `bucket.from/to`（闭区间转换后）为准。
- 过滤条件必须包含分类/支付方式/标签/币种/收支类型（与计算时一致）。
- 来源查询仍走现有 `GET /stats` 或 `GET /transactions`，权限由 `requireAuth` + `request.book` 重新校验，不扩大访问（ACC-08/ACC-12）。

---

## 7. 与 Agent A 的对齐问题（2026-10-27 已收敛，登记于 A §15）

A 已在 `docs/specs/product/s17-agents/S17-Agent-A-S01-共享分析结果协议草案.md` §15 逐条答复（A 分支 `655ea14`/`5faaac1`，只读参考）。S-01 仍为 `s01-draft`，待 Lead/Claude/所有者评审冻结。

| 编号 | 结论（A §15） | B 的落地 |
|---|---|---|
| Q-BA-1 | 7 形状**登记进** `AnalysisResult` union；命名归 A，`time-series` 等 discriminator 逐字不变；B 负责 data/dev 实现；A 不预先实现 B 的形状 | B-1 已完成时间类计算结果与图表输入层；`analysis/time.ts` 的 S-01 信封构造待 A 的协议合并后补（不阻塞 B-1） |
| Q-BA-2 | 结果/用户区间保持闭区间 `ResolvedPeriod`；桶内部半开；统一转换器命名 **`bucketToInclusive`**；不新增日期类型 | 已实现 `timeCalendar.bucketToInclusive(bucket) → {from,to}`（含单测）；`spanToInclusive` 为底层 |
| Q-BA-3 | `SourceDescriptor.bucket?` 可选字段 `{key, granularity, from, to(闭区间), clippedStart?, clippedEnd?}`；A 扩字段、B 填 | 本文件 §6 已按此收敛；待协议合并后由结果构造层填充 |
| Q-BA-4 | `dataVersion` 属 S-01：由工作台数据层/查询入口生成并透传（`WorkbenchState.dataVersion` → `prepareScope`），格式由 W1/W2 定；B/C/D 不得自造 | B 不生成、不携带；由信封层负责 |
| Q-BA-5 | 不在 `groupBy` 混入时间粒度；建议新增 `timeGranularity?: "day"\|"week"\|"month"`（A-Q21，冻结时定） | 时间分析用 `analysisType: time.*` + `timeGranularity` 表达；`computeTimeSeries` 的 `granularity` 即其来源 |
| Q-BA-6 | 同意 `time.*`，扩为 `<domain>.<name>`（domain ∈ basic\|category\|time\|dist\|cross\|record） | 已按 `time.*` 命名（如 `time.daily-expense-trend`） |
| Q-BA-7 | 桶级复用 `AnalysisCompleteness`，不新增枚举；映射按 B §4.2 | 已按本文件 §4.2 映射（`BUCKET_COMPLETENESS` 常量属信封层） |
| Q-BA-8 | `Ratio` 进程内 bigint；跨 HTTP 序列化 `{numerator: string; denominator: string}` | B 不新增 Ratio 传输格式，照此实现 |
| Q-BA-9 | `TimeAxisHint` 属于结果 | 本文件 §3 已按此声明 |
| Q-BA-10 | 综合模式直接引用 FX 聚合完整性，不重算 | B-1 只做原币；综合模式沿用 `aggregateFx` |
| Q-BA-11 | I13 星期分布先用 `TimeSeriesResult` + weekday 7 桶模板轴，不新增形状 | B-2 实现时采用 |

### 7.1 新增待评审项（B 提出，待 A/Lead 登记）

- **Q-BA-12（影响 B-3 长区间）**：A 的 `makePeriod` 用 `MAX_STATS_DAYS = 400` 限制区间；但 I09 要求 12/24/36 个月、A01 同比需跨 ≥1 年、A12/A14 需长样本。建议 S-01 增 `MAX_ANALYSIS_DAYS`（如 3660，覆盖 10 年日粒度），或允许时间分析定义自带上限。B 的 `computeTimeSeries` 不设上限（由调用方按定义校验），请在 S-01 冻结前定。
- **R-09**：`ComputationMetadata.coverageEnd?` 为展示元数据（A 已登记）；B 的 `BucketContext.coverageEnd` 是计算输入，不写入结果信封。
- **A-Q21**：`AnalysisDefinition.timeGranularity?`（A 已登记，冻结时定）。
- **S-01 §14.6（A 已预留）**：B 的 `apps/web/src/lib/chart/timeSeriesChart.ts` 即时间图表的只读适配层（允许字段裁剪/提升用于渲染，不重算金额、不改完整性状态），待协议合并后登记。

**下一步**：B-1 实现不依赖 S-01 冻结（已按上述结论落地）；协议冻结由 Lead/Claude/所有者评审后通知，B 再补 `analysis/time.ts` 信封构造与 `SourceDescriptor.bucket` 填充。

---

## 8. 24 项 → 结果形状（B-1 起的实现映射）

| 批次 | 能力 | 形状 |
|---|---|---|
| B-1 | I06 每日支出、I07 每日收入、I08 每周支出、I09 每月支出、I10 每月收入、I19 交易频次、I20 累计支出 | `computeTimeSeries`（day/week/month × expense/income/count）+ `accumulateSeries`；图表输入 `timeSeriesChart.ts`：折线/面积/柱/Sparkline/累计 |
| B-2 | I11–I16（构成、星期、热力、分类×时间） | `MultiSeriesResult` / `CalendarHeatmapResult` / `TimeSeriesResult` |
| B-3 | A01–A05（同比、环比、周期比较） | `PeriodComparisonResult` |
| B-4 | A12 移动平均、A13 累计节奏、A14 波动、A18 季节性、A19 收入稳定性、A20 异常 | `MovingAverageResult` / `TimeSeriesResult` / `VariabilityResult` / `MultiSeriesResult` / `AnomalyResult` |

（能力编号与所有者规格一致；`AN-xxx` 旧目录映射仅参考，不改变所有者编号。）

---

## 9. 版本与冻结建议

- **状态（2026-10-27）**：已与 A 对齐（A §15 逐条答复）；S-01 仍为 `s01-draft`，待 Lead/Claude/所有者评审冻结。B-1 按对齐结论落地，不等待冻结。
- 本草案基于 `ANALYSIS_PROTOCOL_VERSION = "s01-draft"`。A 合并后建议升为 `"s01-freeze-1"` 或 `"s01-v1"`，并写明"时间形状已并入"。
- 冻结后 B 的 `timeCalendar.ts` 语义不得轻改；如需改语义，必须升 `TIME_CONTRACT_VERSION` 并重跑 B-5 日期边界矩阵。
- 本文件 B-0 提交、B-1 对齐后更新；冻结时由 A 标注【已冻结（commit）】并通知。

---

## 10. 参考

- 所有者规格：`docs/specs/product/s17-agents/S17-Agent-B-完整开发规格-所有者-20261027.md` §3、§4、§5、§35、§37、§40
- A 的 S-01 草案：`packages/shared/src/analysis/types.ts`、`rational.ts`、`context.ts`（A 工作区 `deepseek/s17-finance-analysis`，未合并；A §15 审计结论 commit `655ea14`/`5faaac1`）
- B 的时间合同：`packages/shared/src/timeCalendar.ts`、`timeCalendar.test.ts`
- B 的时间序列计算与图表输入：`packages/shared/src/timeSeries.ts`、`apps/web/src/lib/chart/timeSeriesChart.ts`
- 现有统计：`packages/shared/src/stats.ts`、`apps/api/src/routes/stats.ts`、`apps/web/src/lib/offline/localStats.ts`
- 核查表：`docs/specs/design/S17-B-时间与财务数据合同核查表.md`
