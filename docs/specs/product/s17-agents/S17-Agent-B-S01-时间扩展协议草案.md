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

**C 侧映射（G-27，2026-10-27 冻结后补）**：C `partial` **仅当根因是 FX 不完整**（汇率缺失/折算失败）→ B `unavailable` + `fx-incomplete`；非 FX 原因 → 按自身原因映射（离线覆盖不全 → `unknown` + `offline-incomplete`，其余保持 `unavailable` 原因细分）。P16 三态（`complete`/`no-transactions`/`unavailable`）**不引入** `partial`；`in-progress` 是周期未完、不是完整性缺失。

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
| B-4 | A12 每日支出波动、A13 七日移动平均、A14 三十日移动平均、A18 季节性消费比较、A19 支出异常高峰提示、A20 收入稳定性 | `VariabilityResult` / `MovingAverageResult` / `MultiSeriesResult`（分类轴）/ `AnomalyResult` |
| B-5 | 性质测试、时间边界矩阵、CF-B12–B15 适配、§37/§44 验收对照 | 不新增结果形状；新增**图表家族能力注册表**（CF-B01–CF-B15）与验收证据文档（见 §14） |

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

---

## 11. B-2 实现映射（2026-10-27，未冻结）

B-2 的四个计算模块 + 五个图表组件完成后，I11–I16 与 S-01 形状的对应关系如下。**它们仍使用 §3 已登记的形状语义**（时间桶、完整性、逐桶来源），但当前只落地为 B 侧的纯函数结果对象；S-01 信封（含 `analysisType` 注册与 `SourceDescriptor.bucket`）待协议冻结后由 A 统一提供。

| 能力 | 计算入口（shared） | 结果对象 | S-01 形状映射 | 图表（web） |
|---|---|---|---|---|
| I11 收入与支出比较 | `computeFlowSeries`（`timeSeries.ts`） | `FlowSeriesResult`：每桶 `incomeMinor`/`expenseMinor`/`differenceMinor`，区间合计与完整性 | `MultiSeriesResult`（两条序列：收入、支出；桶轴共享） | `IncomeExpenseBars`（CF-B04 成对柱） |
| I12 日历热力 | `computeCalendarHeatmap`（`calendarHeatmap.ts`） | `CalendarHeatmapResult`：逐日 `valueMinor`/`transactionCount`/`level`，单月与跨月均按周一起始 | `CalendarHeatmapResult`（§3.5） | `CalendarHeatmapGrid`（CF-B08，DOM 网格） |
| I13 星期分布 | `computeWeekdayPattern`（`weekdayPattern.ts`） | 固定 ISO 1..7（周一→周日）七桶；`total` 精确 minor，`average` 为精确分数 `numeratorMinor/denominatorDays`（只对实际出现的该星期日期求平均） | `TimeSeriesResult` + 7 桶模板轴（A §15 结论，不新增形状） | `WeekdayBars`（CF-B09） |
| I14 分类构成 | `computeCategorySeries`（`categorySeries.ts`） | 每桶每分类精确金额；`totalMinor` 存在未知桶时为 `null`；`includeOther` 追加“其他”序列 | `MultiSeriesResult`（分类为序列） | `CategoryStackedBars`（CF-B05 堆叠柱） |
| I15 分类占比 | `computeCategoryShares`（`categorySeries.ts`） | 每桶每分类 `ShareRatio`（分子/分母均为精确 minor 字符串），分母 = 该桶权威合计；`zero-total`/`unknown`/`future` 桶不给占比 | `MultiSeriesResult` + `Ratio` 占比序列 | `CategoryShareBands`（CF-B06 100% 堆叠带） |
| I16 分类×时间 | `computeCategorySeries` + `topCategoriesByTotal` | 同一长表按时间桶展开；Top N 顺序即图例顺序 | `MultiSeriesResult`（分类×时间桶） | `CategoryStackedBars` / `CategoryShareBands` 复用 |

**实现时固定下来的语义（后续改语义必须升版本号）**：

1. **占比分母**：`share = 该分类金额 / 该桶全部分类合计`，分母来自 `computeCategorySeries.totalMinor`，图表不重算、不改分母（满足规格 §31 兼容性表对“构成”的要求）。
2. **零总额桶**：`state = "zero-total"`，所有 `share = null`；不得写成 0%（0% 会与“没有支出”混淆）。
3. **未知桶**：所有 `share = null` 且桶 `state = "unknown"`；100% 堆叠带在该桶处断开，不补 0、不跨过去连线。
4. **收入/支出成对柱**：`differenceMinor = income − expense`，任何一侧未知时 `differenceMinor = null`（差额不得由半截数据得出）；两侧共用同一套桶边界与零点基线（规格 §11）。
5. **星期桶顺序**：固定 `weekday = 1..7` 表示周一→周日，**不按语言重排**；语言差异只影响标签文案（由组件 props 传入），不改变桶顺序。
6. **日历热力着色**：`level` 为 0–4 分位；只对“完整日”参与分位计算，`unknown`/`future`/`in-progress` 的格子不着色（`level = null`），也不参与 min/max 图例；“已知为 0”的完整日为 `level 0`，与“未知”视觉上可区分。
7. **图表组件不产出文案**：所有标签、标题、图例文字、tooltip 格式由调用方按当前语言传入；组件只输出数字与结构（因此 `sharedMessages` 无需为组件登记中文）。
8. `sharedMessages.ts` 只登记 shared 模块内的用户可见中文提示（`categorySeries.ts`/`weekdayPattern.ts`/`calendarHeatmap.ts` 已加入 `sharedMessages.test.ts` 的 `FULL_FILES`）。

**边界说明**：B-2 仍未接入 `StatsPage.tsx`/`FxStats.tsx`（1.16.23 候选冲突，Lead 指示只读），也未实现完整 hover/touch 读数（图表几何已带 `data-*` 与 `<title>` 精确读出任一；44px 触摸与键盘交互的完整方案随 W3 卡片集成）。

---

## 12. B-3 实现映射（2026-10-27，未冻结）

B-3 覆盖 A01–A05（周期比较族）。**这四个问题是四种不同的问题，不共用“上个月比较”这个含混名字**（规格 §19–§23）。B 侧落地为两个纯函数模块 + 三个图表组件；S-01 信封仍待协议冻结后由 A 统一提供（同 §11 的边界）。

| 能力 | 计算入口（shared） | 结果对象 | S-01 形状映射 | 图表（web） |
|---|---|---|---|---|
| A01 上期收支比较 | `computePeriodComparison`（`periodComparison.ts`，`kind: "previous-period"`） | `ComparisonResult`：收入/支出各 `currentMinor`/`previousMinor`/`differenceMinor`/`growth`/`complete`，`resolution` 说明上期如何得到 | `PeriodComparisonResult`（§3.7） | `PeriodComparisonBars` + `PeriodComparisonCard`（CF-B10） |
| A02 环比增长率 | 同一 `computePeriodComparison`（`kind: "month-over-month"`） | `GrowthResult = {state:"computed", numeratorMinor, denominatorMinor} \| {state:"unavailable", reason}`；百分比只由调用方格式化 | `PeriodComparisonResult` | `PeriodComparisonCard` / `PeriodComparisonBars` |
| A03 同比增长率 | 同一 `computePeriodComparison`（`kind: "year-over-year"`） | `resolution.leapDayFallbacks` 显式记录 2/29 无对应日时的对齐；`sameLength/comparisonMode` 保留 | `PeriodComparisonResult` | `PeriodComparisonBars` / `PeriodComparisonCard` |
| A04 多个月份比较 | `computeMultiMonthComparison`（`multiMonthComparison.ts`） | `MultiMonthComparisonResult`：每 `YYYY-MM` 自然月一个 `amountMinor`/`state`/`comparable`/`unavailableReason`；`ranking` 只排完整月；`crossYear` | `MultiSeriesResult`（月份为分类，非连续轴）+ 表格 | `MonthComparisonChart`（CF-B04 柱/水平比较） |
| A05 本月至今同期比较 | `computePeriodComparison`（`kind: "month-to-date"`，`monthToDatePolicy` 可选） | `resolution` 明确当前观测区/历史对比区/各自天数/`policyId`；`currentDayInProgress` 标记今天；`sameLength` 与 `previousClipped` 说明窗口关系 | `PeriodComparisonResult` | `PeriodComparisonCard` + `PeriodComparisonBars`（双柱/双折线） |

**实现时固定下来的语义（后续改语义必须升版本号）**：

1. **四种比较不混名**：`ComparisonKind` 有独立 discriminator（`previous-period`/`month-over-month`/`year-over-year`/`month-to-date`），UI 文案由调用方按 kind 给出，不得把同比标成“上个月”。
2. **增长率只给精确分子/分母**：`GrowthResult` 不产出百分比，格式化在 web 层；`previous <= 0` 时给出 `unavailable` 原因（`previous-zero`/`both-zero`/`previous-negative`），不得显示 `+∞%`/`+100%` 之类编造值；金额差额与相对变化分开显示。
3. **A05 的两种窗口政策显式化**：默认 `same-day-index`（本月 1–27 日 ↔ 上月 1–27 日，历史月较短时裁剪并在 `previousClipped` 标注）；可选 `equal-length-window`（等长窗口，可能跨月，`comparisonMode = "equal-length"` 并提示）；`policyId` 写入结果，不让每张卡自行选择。
4. **A03 的 2/29 对齐**：每右移一年若 2/29 在目标年不存在，取该年 2 月最后一天，并逐条写入 `leapDayFallbacks[{date, alignedTo}]`；不静默丢日。
5. **未完成自然期的“上期”取同期窗口而非完整上期**：当前自然月/周尚未结束时，`previous-period` 的对比窗口取上期相同观测天数（如本月 1–27 日 ↔ 上月 1–27 日），`resolution.sameLength`/`previousClipped` 说明真实关系。
6. **覆盖未知不等于零**：任一侧观测窗口数据覆盖未知时，该侧金额为 `null`，差额与增长率随之不可用（`previous-unknown`/`current-unknown`），不得用 0 补齐后计算。
7. **A04 保留月份显式性**：每个被选月份是自然月（`[1 日, 下月 1 日)`），未知/未来月份 `amountMinor = null` 且 `comparable = false`，不参与排行；跨年必须保留年份（`YYYY-MM` 键）；`ranking` 仅包含完整月。
8. `sharedMessages` 只登记 shared 模块中的中文提示；`periodComparison.ts`/`multiMonthComparison.ts` 已加入 `sharedMessages.test.ts` 的 `FULL_FILES`，两者仅复用既有“金额必须是整数（以分为单位）”译文。

---

## 13. B-4 实现映射（2026-10-27，未冻结）

B-4 覆盖 A12–A14、A18–A20（高级趋势与稳定性族）。**本组不引入新的数据来源与汇率路径**：A12/A13/A14/A18/A19 都建立在 B-1 的每日/每月支出投影上，A20 建立在 B-1 的每月收入投影上；共享层只做算术，图表层只做像素映射。

| 能力 | 计算入口（shared） | 结果对象 | S-01 形状映射 | 图表（web） |
|---|---|---|---|---|
| A12 每日支出波动 | `computeDailyExpenseVariability`（`variability.ts`） | `DailyExpenseVariability`：均值（精确分数）/总体标准差/变异系数（定点）/均值±标准差带/min/max/极值日，样本不足时 `sufficientSample=false` | `VariabilityResult`（§3.12） | `VolatilityBandChart`（CF-B13 带宽 + 均值线） |
| A13 七日移动平均 | `computeTrailingMovingAverage(..., {windowDays: 7})`（`movingAverage.ts`） | `MovingAverageResult`：逐日原始值 + 精确分数平均（`numeratorMinor/denominatorDays`）+ `gapReason`（`insufficient-history`/`window-incomplete`） | `MovingAverageResult`（§3.10） | `MovingAverageChart`（CF-B12 原始线 + 平均线） |
| A14 三十日移动平均 | 同上，`windowDays: 30` | 同上（窗口长度不同，语义相同） | `MovingAverageResult` | `MovingAverageChart` |
| A18 季节性消费比较 | `computeSeasonalComparison`（`seasonal.ts`） | `SeasonalComparisonResult`：每自然年 1–12 月（或 1–4 季）`amountMinor`/`state`/`comparable`/`outsideSpan`；`descriptiveOnly` 与原因；月份数上限（默认 36） | `MultiSeriesResult`（月份为分类轴）+ 表格 | `SeasonalComparisonChart`（CF-B14 每年一条线） |
| A19 支出异常高峰 | `detectDailyExpenseAnomalies`（`anomaly.ts`） | `AnomalyResult`：`method`（`mad`/`iqr`/`zero-dispersion-quantile`）+ `parameters` + `baseline` + `marks[{date, amountMinor, deviationScaled, thresholdScaledMinor, rank}]` + `sufficientSample` + `todayExcluded` | `AnomalyResult`（§3.14） | `AnomalyMarkerChart`（CF-B15 折线 + 标记点 + 口径说明） |
| A20 收入稳定性 | `computeIncomeStability`（`variability.ts`） | `IncomeStability`：逐月收入均值/总体标准差/变异系数/零收入月数/正收入月数/`judgedState`（样本不足时明确“样本不足”） | `VariabilityResult`（§3.12） | 复用 `VolatilityBandChart` 或摘要卡（CF-B13 复用，不新增形状） |

**实现时固定下来的语义（后续改语义必须升版本号）**：

1. **未知不等于零、未来不参与统计**：移动平均窗口内任一天未知/未来则该点不可算（`null`，不插值、不按 0 参与平均）；波动性/稳定性统计只纳入 `complete` 桶，并显式给出 `excludedUnknownCount`/`excludedInProgressCount`/`excludedFutureCount`。
2. **今天不算完**：今天所在桶标记 `in-progress`，不参与 A12/A20 的统计、不参与 A19 的基线判定（`todayExcluded`）；图表上该点不画实心、不进入带/阈值。
3. **平均是精确分数，不先转浮点**：`mean` 给 `numerator/denominator`；标准差是**总体标准差**；展示用 `*ScaledMinor` 为向下取整定点，仅用于显示，权威值仍为精确分数/`minor` 整数。
4. **移动平均必须连续日历日**：`computeTrailingMovingAverage` 拒绝不连续的日序列；调用方需要历史窗口时**向外扩展查询区间**，而不是从区间第一天开始算假平均。
5. **A18 是分类轴不是连续日期轴**：每自然年 1–12 月固定顺序；`outsideSpan`（区间外，不是零）、`unknown`（覆盖未知）、`in-progress`（当前期未结束）都不可与其它年份同名月直接比较（`comparable = false`）；跨年保留年份；月份数上限默认 36，越界抛错不截断（S-01 §17）。
6. **A19 阈值全部可追溯**：`method`/`parameters`/`thresholdScaledMinor` 进入结果，UI 展示“按什么口径判定的异常”；MAD=0 时退化为 IQR，再退化为分位阈值（绝不硬编码“超过均值多少倍”）；样本不足时 `marks = []` 并给 `sufficientSample=false`，不得硬报异常。
7. **A20 与 A12 共用 `AmountSummary`**：只是样本维度不同（A12 逐日支出、A20 逐月收入）；`judgedState` 明确“样本不足”，不得用 3 个月以下数据下“稳定/不稳定”结论；零收入月单独计数。
8. **图表层口径**：图表层只消费 shared 结果，不自行判定异常、不自行分组、不自行改完整性；金额格式化仍在 web `format` 层，组件不产中文文案。

---

## 14. B-5 实现映射（2026-10-27，未冻结）

B-5 是验收批次：**不新增结果形状、不改写协议本体**，只补性质测试、时间边界矩阵、图表家族能力声明与验收证据。按 Lead 指示（m01976）：S-01 v2 待所有者裁定后统一冻结，本节只登记 draft 映射。

| 交付 | 位置 | 与 S-01 的关系 |
|---|---|---|
| 性质测试矩阵（§37 的 P-1～P-8） | `packages/shared/src/properties.test.ts`（8 用例） | 验证时间形状不变式 IV-01～IV-14；不改协议 |
| 时间边界矩阵 | `docs/specs/design/S17-B-时间边界矩阵.md` | §3.7–§3.10、§19–§23、§24–§29 的边界证据索引 |
| 性能基线 | `docs/specs/design/S17-B-性能基线.md` + `packages/shared/src/performance.test.ts` | §35.5/§36.12 的可追溯实测；`computation.sampling` 仍仅是渲染元信息 |
| 图表家族能力注册表 | `apps/web/src/lib/chart/chartFamilies.ts`（+ 测试） | CF-B01–CF-B15 的 `resultShape`/`states`/`minSize`/`needsLegend` 能力声明；S-01 v2 的图表家族编号（G-13）以此为 B 侧来源 |
| §37/§44 验收对照 | `docs/archive/design/S17-B-验收对照-37-44.md` | 24 项 → 实现/测试/文档/未完成项的如实索引 |
| 跨 Agent 时间口径（B-17） | `docs/specs/design/S17-B-跨Agent时间口径.md` | 桶键/五态/闰年/周一起始的对外口径；P14 小多图与 P15 日历的复用点 |

**B-5 锁定语义**：

1. **性质测试是协议约束的回归**：分组守恒、桶分区互斥/覆盖、累计一致、比较一致、移动平均一致、确定性、分类合计守恒；任何一条失败视为协议实现回归，不是测试问题。
2. **图表家族声明不引入新形状**：注册表只描述「某个结果形状可以由哪些家族渲染、需要哪些字段、能表达哪些状态、最小可读尺寸」；不得据此在 shared 层新增结果类型。
3. **B-16 参数化**：A12 极值日口径已改为显式参数（`DEFAULT_EXTREME_SIGMA = 2`、`EXTREME_SIGMA_SCALE = 100`，结果记录 `extremeSigma` 与说明），默认值待所有者确认；不在多处硬编码 2σ。
4. **B-17 唯一实现归属（建议）**：日历算术与五态归 `timeCalendar.ts`、日历热力分位与月矩阵归 `calendarHeatmap.ts`；C 的 `calendar`（QC-24）只做字段投影。若 S-01 v2 采纳，本句升为正式冻结语义。
5. **区间上限（S-01 §17）**：本批次不改端点 limit、不加截断；纯函数层保持「越界拒绝、不静默丢数据」的调用方契约（`maxAnalysisDays` 参数化待协议冻结后统一接入）。
6. **不冻结**：`ANALYSIS_PROTOCOL_VERSION` 仍 `s01-draft`；B 的 `analysis/time.ts` 信封与 `SourceDescriptor.bucket` 填充仍待 S-01 v2 冻结后实现。

---

## 15. S-01 v2 B 侧提案（2026-10-27，draft，待 A 汇总进 v2）

> 专项文档：[S17-Agent-B-S01-v2提案-汇率逐笔扩展与月键上限.md](S17-Agent-B-S01-v2提案-汇率逐笔扩展与月键上限.md)

B 向 S-01 v2 提交两项 **additive** 提案（不改已登记形状、不改现有函数行为，唯一消费方 `fxView.ts` 零改动）：

| 编号 | 提案 | 对应 v2 登记 |
|---|---|---|
| **B-S01v2-01** | 综合模式 `FxAggregate` **逐日/逐笔投影**（`aggregateFxDetailed`/`aggregateFxDetailedAsync`，`detail.daily` + 可选 `detail.entries`，逐笔与 `convertFx` 同源、超限 `fx_detail_limit` 不截断、异步取消不返回部分结果） | 新增 **G-17「FX 逐笔/逐日投影」**（Lead 2026-10-27 裁定；G-16 归 C 的 `DraftCategoryRelation`）；与 G-02/G-11 衔接；正式定义见提案文档 §16 |
| **B-S01v2-02** | 月键范围上限落位：`FX_MAX_RANGE_MONTHS = 36` + `fxRangeMonths(from,to,maxMonths)`；web `rangeMonths` 14→36 参数化（draft，W1 前不改页面） | **G-09 增补**；对应 Q-BA-12a（月份上限暂记 36 待所有者确认） |

**冻结前规则**：新 API 在 docstring 标 “S-01 v2 draft”；W1 页面接入必须在 S-01 v2 冻结之后；B 不因此新增结果形状、不扩展只读端点（T2/G-11 不变）。性能验证计划见提案 §4（54,000 笔 / 36 月基准、`FX_PERF=1` 门控、单批 ≤50ms、`daily` 模式差异 ≤5%）。

### 15.1 实现状态（2026-10-27，draft，已在本分支实现并验证）

**已落地**（`packages/shared/src/fx.ts`，提交 `13428bd`；提案提交 `9d77b06`）：

- `FX_MAX_RANGE_MONTHS = 36`、`FX_MAX_DETAIL_ENTRIES = 50_000`；
- `FxConvertedEntry`/`FxDetailOptions`/`FxAggregateDetail`/`FxDetailedAggregate`；
- `aggregateFxDetailed`/`aggregateFxDetailedAsync`（`detail.daily` 恒输出、`detail.entries` 可选，逐笔与 `convertFx` 同源、`daily = Σ success` 严格守恒、失败笔不进入投影、超限 `fx_detail_limit` 不截断、异步取消不返回部分结果）；
- `fxRangeMonths(from, to, maxMonths = 36)`（含首尾月、跨年连续、非法日期 `fx_range_invalid`、超限 `fx_range_too_long` 不截断）；
- `apps/web/src/lib/fxView.ts` 的 `rangeMonths` 委托 `fxRangeMonths`（14→36，默认参数向后兼容；唯一消费方，页面未改）。

**实测性能（`FX_PERF=1`，本机 Windows/Node，仅作回归对比）**：1,000,000 笔 daily-only **13.6 s**；200,000 笔 includeEntries **2.7 s**；10,000 次 × 36 月枚举 **0.54 s**；单笔约 13–14 µs（逐笔投影与 daily 同扫描，无二次折算）。

**W1 接入建议（冻结前不接页面）**：普通图表只请求 `daily`（≤36 个月）；逐笔明细仅在详情/导出视图请求并显式 `maxEntries`（默认 50,000，>50k 走异步批次 + `yieldControl`）；UI 侧不得在渲染帧同步执行 200k 以上聚合。

**证据**：`packages/shared/src/fxDetail.test.ts`（12 用例）、`fxPerformance.test.ts`（3 用例，默认 skip）、web `fxView.test.tsx`（8 用例）；`pnpm --filter @libellum/shared test` 533 passed + 3 skipped；shared/web typecheck 0。

### 15.2 G-17 登记与 Q-BP 裁定（2026-10-27，Lead 最终口径）

- **G-17** = 「FX 逐笔/逐日投影」；**G-16** = `DraftCategoryRelation`（C 提供正式定义，不归 B）。正式定义（形状/12 条不变量/默认值/冻结规则）见提案文档 §16，交 A 合并进 v2；不另开 QC 编号。
- Q-BP-1：`detail`/`daily`/`entries` 短名与 4 个类型名批准，不更名。
- Q-BP-2：`maxEntries = 50_000` 为**保护默认值**；逐笔明细类视图必须显式传；S-01 文档写明“默认值只是保护，不得作为业务契约”。
- Q-BP-4：`maxEntries=50_000` 与 `maxAnalysisDays=400` **不同轴，不作强行对齐**，v2 并列登记。
- Q-BP-5：`daily` 恒输出（保证图表稳定与守恒检查），`entries` 可选。
- 性能结论（异步批次 + `yieldControl`、不在渲染帧同步聚合）作为规范写入 v2，并引用 `S17-B-性能基线.md` §6。

---

## 17. W1-S1 消费层映射（2026-10-27，draft；不新增形状）

S1 不新增 S-01 形状，也不改动 §3.7 的七个时间形状：它把已存在的形状**从"纯函数"接到"卡片"**，并且只走 `apps/web/src/lib/analysisData.ts` 这一个入口（S0 已确立）。因此本节的映射是消费层契约，不是新协议。

| 能力 | 生成入口（web，S0/S1） | 复用形状 | 卡片组件 | 说明 |
|---|---|---|---|---|
| I06 每日支出趋势 | `deriveTimeAnalysis`（metric=expense, day） | `TimeSeriesResult` | `DailyExpenseTrendCard`（S0） | 既有 S0 链路 |
| I07 每日收入趋势 | `deriveTimeAnalysis`（metric=income, day） | `TimeSeriesResult` | `TimeSeriesCard` | 与 I06 同一引擎、同一口径，仅 metric 不同 |
| I08 每周支出趋势 | `deriveTimeAnalysis`（week）+ `trailingWeekWindow` | `TimeSeriesResult` | `TimeSeriesCard`（bar/line） | 桶为周一起自然周，末桶裁剪并标 in-progress |
| I09 每月支出趋势 | `deriveTimeAnalysis`（month）+ `trailingMonthWindow` | `TimeSeriesResult` | `TimeSeriesCard`（bar/line） | 自然月，跨年保留年份 |
| I10 每月收入趋势 | `deriveTimeAnalysis`（month, income） | `TimeSeriesResult` | `TimeSeriesCard` | 复用 I09 核心 |
| I19 每日交易笔数 | `deriveTimeAnalysis`（metric=count） | `TimeSeriesResult` | `TimeSeriesCard`（line/bar） | 笔数轴；不混入金额轴（金额与笔数不同轴原则见规格 §34.2） |
| I20 累计支出 | `deriveCumulativeAnalysis` | `CumulativeResult`（由 `accumulateSeries` 派生） | `CumulativeExpenseCard` | 从区间起点累计；未知桶后全部 null、不画自信线 |
| I11 收支对比 | `deriveFlowAnalysis` + `useFlowAnalysis` | `FlowSeriesResult`（`computeFlowSeries`） | `IncomeExpenseCard` | 收入/支出同轴同桶；两个独立总额不合并为"结余" |

**S1 锁定语义**：

1. 窗口函数只决定**区间**（`trailingWeekWindow` 周一起、`trailingMonthWindow` 自然月），分桶与裁剪仍由 `computeTimeSeries`/`timeCalendar` 决定，web 层不重算桶边界。
2. 所有卡片只渲染传入的权威结果：总额、说明、格式化函数由调用方从同一结果生成；组件不重算金额、不补零、不折算汇率。
3. 累计（I20）与移动平均（I13/I14，B-4）是不同分析：前者从区间起点累计，后者是固定窗口的尾随平均；不得互相替代或共用同一张卡片的语义标签。
4. I11 不把收入−支出画成"结余趋势"（那是 I12 之外的另一个能力）；本批只画同轴收支与两个独立总额。
5. 设备本地 `today`、账本口径、`coverageEnd` 双策略均沿用 S0/B-Q17；卡片 caption 必须能说明"设备账本口径"与"进行中"。
6. 页面接线（`StatsPage.tsx`/`FxStats.tsx`）仍由 Lead 在集成 worktree 统一完成；S1 只交付适配层、hooks、卡片与单测。

**测试证据**：`apps/web/src/lib/analysisData.test.ts`（23 用例）、`apps/web/src/components/charts/timeSeriesCards.test.tsx`（5 用例）、`useTimeAnalysis.test.ts`（8 用例）；web 全量 166 文件/1508 用例。

## 18. W1-S2 消费层映射（2026-10-27，draft；不新增形状）

S2 同 S1：**不新增、不修改任何 S-01 形状**。I14–I16 直接消费 B-2 已交付的 `CategorySeriesResult` / `CategoryShareResult`（`computeCategorySeries` / `computeCategoryShares`），经 `apps/web/src/lib/analysisData.ts` 一个入口适配为卡片可渲染的数据。

| 能力 | 生成入口（web，S2） | 复用形状 | 卡片组件 | 说明 |
|---|---|---|---|---|
| I14 单分类历史趋势 | `deriveCategoryTrend`（单 `categoryId` × 粒度） | `CategorySeriesResult`（单分类） | `CategoryCompositionCard` / `CategoryTrendsCard` | 与 I15 同一引擎：单分类趋势的每桶金额 = 多分类结果里该分类的对应点（有测试断言） |
| I15 多分类金额对比 | `deriveCategoryAnalysis` | `CategorySeriesResult` | `CategoryTrendsCard`（多折线/分组柱）、`CategoryCompositionCard`（堆叠） | 分类身份只用稳定 `categoryId`；未知桶不画点/不画段 |
| I16 分类占比 | `computeCategoryShares`（复用 §11 的 `CategoryShareResult`）+ `deriveCategoryAnalysis` | `CategoryShareResult` | `CategoryShareCard`（100% 带）、`CategoryDataTable`（占比/金额表格） | 占比分母 = 权威桶总额；不重算、不重归一化 |

**S2 锁定语义**：

1. **"其他"不是推断分类**：`includeOther` 时 `__other__ = 桶总额 − 选中分类合计`，选中分类 + 其他 = 权威总额；`__other__` 不进入排行、不可点击钻取（不知道具体分类）。
2. **占比分母永远用权威桶总额**：部分分类未选中时（`partial`）占比照常以总额为分母，不把"选中合计"当 100%；未知桶的占比为 `null`（不是 0），零总额桶 `state = "zero-total"` 且占比为 `null`——**不得伪造 0%**（B-2 的 `computeCategoryShares` 已守住，S2 只渲染）。
3. **I14 与 I15 数字必须互相对得上**：单分类趋势的桶金额与多分类序列中该分类的点逐桶相等（`analysisData.test.ts` 有断言）。
4. **排行**：按区间总额降序；并列共享排名（1、1、3）；`limit` 在"其他"剔除后生效；份额 = 该分类总额 / 权威总额。
5. 卡片只渲染传入结果，不重算金额、不补零、不折算汇率；未知/未来由权威 `state` 决定渲染（未知不画、未来不画）。
6. 页面接线仍由 Lead 在集成 worktree 统一完成；本批不接页面、不改 API/版本、不碰 `StatsPage.tsx`/`FxStats.tsx`。

**测试证据**：`analysisData.test.ts`（S2 新增 7 用例）、`categoryChart.test.ts`（多分类模型 3 用例）、`categoryCards.test.tsx`（7 用例）；web 全量 167 文件/1526 用例、`tsc -b` exit 0。

## 19. W1-S3 消费层映射（2026-10-27，draft；不新增形状）

S3 同 S1/S2：**不新增、不修改任何 S-01 形状**。A01–A05 直接消费 B-3 已交付的 `ComparisonResult`（`computePeriodComparison`/`resolveComparison`）与 `MultiMonthComparisonResult`（`computeMultiMonthComparison`），经 `apps/web/src/lib/analysisData.ts` 一个入口适配；比较卡与双柱/月份柱复用 B-3 组件（`PeriodComparisonCard`/`PeriodComparisonBars`/`MonthComparisonChart`），本批仅新增 A04 的卡框架 `MonthComparisonCard`。

| 能力 | 生成入口（web，S3） | 复用形状 | 卡片组件 | 说明 |
|---|---|---|---|---|
| A01 上期收支比较 | `derivePeriodComparison`（`kind: "previous-period"`） | `PeriodComparisonResult` | `PeriodComparisonCard` + `PeriodComparisonBars` | 上期窗口（同日数滚动）与 `sameLength`/`previousClipped` 由 shared `resolution` 决定 |
| A02 环比增长率 | 同一入口（`month-over-month`） | `PeriodComparisonResult` | `PeriodComparisonCard` | 只给精确 `numeratorMinor/denominatorMinor`；百分比由调用方格式化 |
| A03 同比增长率 | 同一入口（`year-over-year`） | `PeriodComparisonResult` | `PeriodComparisonBars` / `PeriodComparisonCard` | `leapDayFallbacks` 随结果上传，卡片必须显示对齐口径 |
| A04 多个月份比较 | `deriveMultiMonthComparison` | `MultiMonthComparisonResult` | `MonthComparisonCard`（新卡框架）+ `MonthComparisonChart` | 月份键 `YYYY-MM` 保序、去重；排行只含完整月；未完成月金额 `null` |
| A05 本月至今同期 | 同一入口（`month-to-date`，`monthToDatePolicy` 可选） | `PeriodComparisonResult` | `PeriodComparisonCard` + `PeriodComparisonBars` | 默认 `same-day-index`；`currentDayInProgress`/`policyId` 进结果 |

**S3 锁定语义**：

1. **“不可比/不完整”不得被装作完整**：任一侧覆盖未知时该侧金额 `null`、差额与增长率 `unavailable`；覆盖未知的适配规则是“只声明覆盖到最早窗口的前一天”（shared 的 `coverageEnd: null` 表示“无约束”，不能表达 unknown），因此绝不会出现看似完整的数字。
2. **A04 的月份数与上限**：`assertComparisonMonthCount` 在适配层按 S-01 v2 §17 draft 限制 36 个唯一月份，越界抛 `AnalysisRangeError('analysis-range-too-long')`，不截断、不静默丢月份。
3. **A04 总额只在全部月份完整时才显示**：含进行中/未知月时 `totalMinor = null`，卡片 `totalText` 必须传 `null`；不显示“只覆盖完整月”的小计。
4. **比较窗口与 kind 一一对应**：文案由调用方按 `result.kind` 给出，不把同比标成“上个月”；`resolution` 中的真实区间、`sameLength`、`previousClipped`、`policyId` 必须可展示。
5. 卡片只渲染传入结果，不重算金额、不补零、不折算汇率；页面接线仍由 Lead 在集成 worktree 统一完成；本批不接页面、不改 API/版本、不碰 `StatsPage.tsx`/`FxStats.tsx`。

**测试证据**：`analysisData.test.ts`（S3 新增 6 用例，含 unknown/上限/闰日对齐）、`comparisonCards.test.tsx`（6 用例，覆盖双柱空状态、比较卡、A04 卡进行中/未知）；定向 2 文件 46 用例、web 全量见本批报告。

## 20. W1-S4a 消费层映射（2026-10-27，draft；不新增形状）

S4a 同 S1–S3：**不新增、不修改任何 S-01 形状**。I12/A12、A20、I13 直接消费 B-4 已交付的共享引擎——`computeDailyExpenseVariability`（`AmountSummary`/`DailyExpenseVariability`）、`computeIncomeStability`（`IncomeStabilityResult`）、`computeWeekdayPattern`（`WeekdayPatternResult`），经 `apps/web/src/lib/analysisData.ts` 一个入口适配；卡片为 `VariabilityCard`（内嵌 `VolatilityBandChart`）、`IncomeStabilityCard`、`WeekdayPatternCard`（内嵌 `WeekdayBars`）。

| 能力 | 生成入口（web，S4a） | 复用形状 | 卡片组件 | 说明 |
|---|---|---|---|---|
| I12 / A12 每日支出波动 | `deriveDailyExpenseVariability`（先 `computeTimeSeries` day 取桶，再 `computeDailyExpenseVariability`） | `DailyExpenseVariability`（含 `AmountSummary`） | `VariabilityCard` + `VolatilityBandChart` | σ 用 B-4 的总体标准差（`scale=6` 的缩放整数）；`extremeSigma` 默认 2、可配置 |
| A20 收入稳定性 | `deriveIncomeStability`（month 粒度） | `IncomeStabilityResult` | `IncomeStabilityCard` | 月样本数低于 `minSampleMonths` 时 `judgedState = "insufficient-sample"`，卡片必须显示样本句 |
| I13 星期分布 | `deriveWeekdayAnalysis`（入口 `computeWeekdayPattern`，`kind` 可 all/expense/income） | `WeekdayPatternResult` | `WeekdayPatternCard` + `WeekdayBars` | `mode: "total" \| "average"` 由调用方决定，卡片 `data-mode` 明示；平均分母 = 区间内该星期出现的自然日数 |

**S4a 锁定语义**：

1. **无完整观测不造数**：`result` 为 `null` 时卡片只渲染 `emptyText`，`unavailableReason` 仅 `"no-complete-observations"`；覆盖未知的适配规则与 S3 相同（`coverageEnd = 区间起点前一天`），shared `coverageEnd: null`（无约束）不得被当成 unknown。
2. **样本必须可见**：`VariabilityCard` 必传 `sampleText`/`stateText`；`IncomeStabilityCard` 必传 `sampleText`/`stateText`（`positiveMonths`/`minSampleMonths` 由调用方拼句）；`WeekdayPatternCard` 必显 `observedDayCount`、`sufficientSample` 与 σ 口径。
3. **σ/CV 口径**：S4a 只用 B-4 自有总体标准差（缩放整数、`formula.stdDev = "population-standard-deviation-v1"`），**不引用** S-01 v2 §16.6 中 A 侧的 σ/CV 字段；在 v2 冻结前如需跨 Agent 对比，一律标「待冻结核对」，不得互相换算。
4. **mode 不混用**：星期分布 `total` 与 `average` 是两种展示，同一卡片一次只画一种，`data-mode` 明示；平均值的分母是“该星期在区间内出现的自然日数”，不是“有支出的天数”。
5. **时间口径**：半开区间、自然周周一起、自然月；进行中的今天桶不进入波动/稳定性统计（只取 complete 桶）；卡片 caption 必须能说明“设备账本口径/进行中”。
6. 卡片只渲染传入结果，不重算统计量、不补零、不折算汇率；页面接线由 Lead 在集成 worktree 统一完成；本批不接页面、不改 API/版本、不碰 `StatsPage.tsx`/`FxStats.tsx`。

**测试证据**：`s4a.analysisData.test.ts`（8 用例，含 unknown 覆盖、样本不足、非法 `extremeSigma`）、`stabilityCards.test.tsx`（6 用例，含空状态、样本句、mode 渲染）；web 全量 170 文件/1556 用例、`tsc -b` exit 0。

## 21. W1-S4b 消费层映射（2026-10-27，draft；不新增形状）

S4b 同 S1–S4a：**不新增、不修改任何 S-01 形状**。A13/A14 消费 B-4 已交付的 `computeTrailingMovingAverage`（`MovingAverageResult`），经 `apps/web/src/lib/analysisData.ts` 的 `deriveMovingAverage` 适配；卡片为 `MovingAverageCard`（内嵌 `MovingAverageChart`，原始折线 + 移动平均折线/点）。

| 能力 | 生成入口（web，S4b） | 复用形状 | 卡片组件 | 说明 |
|---|---|---|---|---|
| A13 七日移动平均 | `deriveMovingAverage({ windowDays: 7 })` | `MovingAverageResult`（`trailing: true`、`granularity: "day"`、`gapPolicy: "require-complete-window"`） | `MovingAverageCard` + `MovingAverageChart` | 尾随 7 个**日历日**；读取区间向历史扩展 `windowDays-1` 天（用户可见区间不变），扩展后第一个可见点即可计算 |
| A14 三十日移动平均 | `deriveMovingAverage({ windowDays: 30 })` | 同上 | 同上，`data-window={30}` | 不是“最近一个自然月”，也不等于固定四周；与 A13 同图时复用两份已算结果，不重复分桶 |

**S4b 锁定语义**：

1. **历史扩展只改读取范围，不改可见范围**：`readSpan = [span.start-(windowDays-1), span.end)`；`result.points`、计数与 `visibleFrom` 全部裁剪回可见区间，并在视图层重算 `observedDays/computablePoints/unknownWindowPoints/missingHistoryPoints/complete`——不造数、不改变任何点的值。
2. **窗口必须完整**：含未知/未来日的窗口 `average = null`、`gapReason = "window-incomplete"`；距序列起点不足一个窗口的可见点 `insufficient-history`；不填 0、不插值、不跨缺口平均。
3. **进行中的今天不入窗口样本（B-Q20 裁定，2026-10-27）**：适配层把 `state === "in-progress"` 的桶按未知（`amountMinor = null`、`transactionCount = null`）喂给 shared 引擎；含该日的窗口明确 `gapReason = "window-incomplete"`，不补零、不插值，完整日窗口的 `numeratorMinor/denominatorDays` 不变。`MovingAverageAnalysisView` 用 `todayExcluded`/`excludedInProgressDays` 上报排除事实，卡片在 `excludedInProgress` 时**必须**渲染 `excludedTodayText`（不得只靠缺口暗示）。该口径为 Lead 裁定：统计类分析统一“进行中桶不入样本”（与 S-01 v2 A12 `todayExcluded` 一致），S4a 波动/稳定性原本只取 complete 桶、口径一致。S-01 v2 文字由 A 在冻结后最小批次补一行，B 不改 A 文档。
4. **精确分数**：均值为 `numeratorMinor / denominatorDays`，`averageScaledMinor` 只是展示用定点展开；卡片与图例不得把缩放值当权威金额，提示/无障碍名称用 `formatValue` 提供的精确展示。
5. **窗口身份**：`data-window` 明示 7/30；A13/A14 各自一张卡，不把 7 日结果渲染成 30 日。
6. 卡片只渲染传入结果，不重算平均、不补零、不折算汇率；页面接线由 Lead 在集成 worktree 统一完成；本批不接页面、不改 API/版本、不碰 `StatsPage.tsx`/`FxStats.tsx`。

**测试证据**：`s4b.analysisData.test.ts`（8 用例：历史扩展、可见计数、30 日窗口、B-Q20 今天排除 + 无进行中行为不变、unknown 覆盖、scale、非法窗口）、`movingAverageCards.test.tsx`（4 用例：双序列图例与样本行、`data-window=30` 区分、B-Q20 排除说明、空状态）；web 全量 172 文件/1566 用例、`tsc -b` exit 0（B-Q20 修正后定向 2 文件 12 用例全过）。

## 22. W1-S4c 消费层映射（2026-10-27，draft；不新增形状）

S4c 同 S1–S4b：**不新增、不修改任何 S-01 形状**。A18/A19 消费 B-4 已交付的 `computeSeasonalComparison`（`SeasonalComparisonResult`）与 `detectDailyExpenseAnomalies`（`AnomalyResult`），经 `apps/web/src/lib/analysisData.ts` 的 `deriveSeasonalComparison`/`deriveAnomalyAnalysis` 适配；卡片为 `SeasonalComparisonCard`（内嵌 `SeasonalComparisonChart`，跨年同月分类轴）与 `AnomalyPeaksCard`（内嵌 `AnomalyMarkerChart`，异常标记 + 排行列表）。

| 能力 | 生成入口（web，S4c） | 复用形状 | 卡片组件 | 说明 |
|---|---|---|---|---|
| A18 季节性消费比较 | `deriveSeasonalComparison`（`computeTimeSeries` 逐月桶 → `computeSeasonalComparison`） | `SeasonalComparisonResult` | `SeasonalComparisonCard` + `SeasonalComparisonChart` | 自然年 × 1–12 月分类轴；月份上限 `SEASONAL_MAX_MONTHS = 36`，越界拒绝不截断 |
| A19 支出异常高峰 | `deriveAnomalyAnalysis`（`computeTimeSeries` day 桶 → `detectDailyExpenseAnomalies`） | `AnomalyResult` | `AnomalyPeaksCard` + `AnomalyMarkerChart` | 只用 `complete` 日建基线；进行中的今天 `todayExcluded` 且从不成为标记；样本不足 `marks = []` |

**S4c 锁定语义**：

1. **上限显式、越界拒绝**：`deriveSeasonalComparison` 先按自然月跨度预检（默认 `SEASONAL_MAX_MONTHS = 36`，可传 `maxMonths`），超限抛 `AnalysisRangeError("analysis-range-too-long")`；shared 引擎同样拒绝 >36，适配层不截断、不静默丢月。
2. **A18 只做描述性比较**：`descriptiveOnly`/`descriptiveReason` 由 shared 结果给出，卡片用 `data-descriptive-only` 明示并可显示调用方 `descriptiveText`；区间外（`outside-span`）、未知、进行中的月 `comparable = false`。进行中的当前月保留“已确认部分金额”（`amountMinor` 非空），卡片不得把它当完整月与其它年份直接对比。
3. **A18 卡片只画月视图**：`SeasonalComparisonCard` 的 result 类型收窄为 `SeasonalMonthComparisonResult`（`granularity: "month"`）；按季分组由 shared 支持并有适配层测试，本批不单独出季视图卡片，避免把季度结果画成 12 个月。
4. **A19 的样本与今天**：检测器只吃 `complete` 日；进行中的今天只上报 `todayExcluded`，永不进入基线或标记；`sufficientSample = false` 时 `marks = []`（不硬报异常）；`baseline = null` 时卡片只渲染 `emptyText`，不画图、不造基线。
5. **判定口径全部来自 shared**：`method`/`parameters`/`thresholdScaledMinor`/`rank` 随结果上传，卡片不自行判定异常、不重算阈值；“按什么口径判定”的说明由调用方按 `method`/`parameters` 提供（图表 `description`）。
6. 卡片只渲染传入结果，不重算金额、不补零、不折算汇率；页面接线由 Lead 在集成 worktree 统一完成；本批不接页面、不改 API/版本、不碰 `StatsPage.tsx`/`FxStats.tsx`；σ/CV 与 `method` 串仍标「待冻结核对」。

**测试证据**：`s4c.analysisData.test.ts`（9 用例：跨年同月、单年描述性、unknown 覆盖、"当前月保留部分金额且不可比"、36 月上限、按季分组、MAD 标记、今天不入样本、样本不足、无 complete 日）；`seasonalAnomalyCards.test.tsx`（5 用例：月视图卡、描述性说明、标记 + 排行、无基线空状态、无异常日文案）；web 全量 174 文件/1582 用例、`tsc -b` exit 0。

## 23. s01-v2 冻结后 B 侧对齐（2026-10-27；只做表示法/串对齐，不新增、不修改任何形状）

**依据**：`s01-v2` 冻结（Lead m05153）+ 业主签认的两件映射/范围问题（Lead m05018）与 r7.2（`b39b27a`）；本批严格按 A §16.6 与 r7.2 口径实现，未改任何财务数值语义。

### 23.1 σ/CV 表示法映射（`SqrtValue` / `Ratio` / `CoefficientsOfVariation`）

`packages/shared/src/variability.ts` 在既有 `stdDevScaledMinor`/`stdDev` 之外**追加**冻结字段（不删除、不改既有字段值，保持向后兼容）：

| s01-v2 字段 | B 实现（`variability.ts`） | 规则 |
|---|---|---|
| `standardDeviation` | `standardDeviation: SqrtValue \| null` | 总体方差 `Σ(xᵢ−μ)²/n` 保持精确：`radicand = { numerator, denominator }` 为方差有理数；`decimalText` 为展示用十进制展开；μ=0 或 n=0 → `null`（不补 0） |
| `varianceKind` | `varianceKind: "population"` | 仅总体口径；样本口径（`sample`，n−1）只允许后续显式请求，本批不实现 |
| `coefficientsOfVariation` | `coefficientsOfVariation: CoefficientsOfVariation \| null` | `standardDeviation`、`mean` 均为精确有理数；`scale: "fraction"`（无量纲比例）、`decimalText`；CV 展示默认 `percent-100` 由展示层换算，契约值不套货币最小单位舍入 |
| 兼容别名 | `standardDeviationScaled: string` | 与既有 `stdDevScaledMinor` 同值（保留给旧消费方），**权威值以上表 `SqrtValue`/`CoefficientsOfVariation` 为准** |

**不变量**：σ 与数据同单位（货币最小单位），CV 无量纲；中间值全程整数/有理数，不出现 IEEE754 浮点；`decimalText` 仅展示、不参与计算；sample 方差不得冒充总体方差。

### 23.2 method 串统一（`packages/shared/src/analysisMethod.ts`）

s01-v2 v2.0.1（A `492b1b6`/`6f72f9f`）把方法串口径澄清为**三层、不得混用**：

1. **`ANALYSIS_METHOD`（B 内部 id）**：结果 `formula` 字段使用（如 `population-standard-deviation-v1`），**不是**对外支持列表；
2. **`FROZEN_METHODS`（冻结登记值，可对外宣称）**：逐字 `population-stddev`/`sample-cv-fixedpoint`/`mad-median`/`iqr-quantile`；`canonicalMethodString` 对这些方法只输出冻结值；
3. **`OPEN_EXTENSION_METHODS`（B 开放扩展，不宣称已支持）**：`exact-mean-v1`、`robust-z-score-v1`、`tukey-fence-v1`、`quantile-threshold`、`abs-deviation-gt-sigma-multiple-v1`，集中标注、与冻结值分表。

| 输入形态（B 内部 id / 冻结别名） | 对外输出（冻结值） |
|---|---|
| `population-standard-deviation-v1`、`population-stddev` | `population-stddev` |
| `coefficient-of-variation-v1`、`sample-cv-fixedpoint` | `sample-cv-fixedpoint` |
| `robust-z-score-v1`、`mad-median` | `mad-median` |
| `tukey-fence-v1`、`iqr-quantile` | `iqr-quantile` |
| `percentile-threshold-v1`、`quantile-threshold` | `quantile-threshold`（开放扩展） |
| `exact-mean-v1`、`abs-deviation-gt-sigma-multiple-v1` 等 | 原样（开放扩展，标注不宣称已支持） |
| `type7-linear` | **未实现**：B 分位阈值是 nearest-rank（`ceil(n·q)−1`），非 Type 7 线性插值，**不得冒充**；输入 `type7-linear` 原样返回、登记状态 `unregistered` |
| 未知开放串（如 `histogram-nice-bin-width`） | 原样返回（不拒绝、不静默替换） |

规则：①对外输出只用冻结值或标注后的开放扩展名；②`canonicalMethodString(value)` 只做输入解析归一（同一方法的所有历史形态→同一输出），未知串原样；③`methodSupport(value)` 返回 `frozen`/`open-extension`/`unregistered`，`isFrozenMethod` 便捷判断；④`AnomalyResult.methodString` 由 `anomalyMethodString(method)` 给出：`mad`→`mad-median`、`iqr`→`iqr-quantile`、`zero-dispersion-quantile`→`quantile-threshold`（开放扩展）；⑤完整注册表扩展待下一批与 A 对齐，本批不自行新增口径。

### 23.3 G-27 映射（文档级，写入 §4.2）

见 §4.2 末尾「C 侧映射（G-27）」：C `partial` 仅 FX 不完整 → B `unavailable` + `fx-incomplete`；非 FX 原因按自身原因；P16 三态不引入 `partial`。B 的 W1 适配层走原币路径、不消费 FX 聚合，故本批无代码改动；未来 converted 模式 >36 月须显式 `fx-incomplete`/`analysisLimit`，不得静默返回不完整折算结果（§6.5.1 回执）。

### 23.4 本批未做（显式声明）

- 未改任何 `TimeSeriesResult`/`VariabilityResult`/`AnomalyResult` 的既有字段语义与数值；新字段均为 additive。
- `SqrtValue.decimalText` 按 v2.0.1 **不强制**：允许 `null`/空串占位；如提供非空值，必须等于 `radicand` 按 `decimals = 6` 一次 `minor-half-away-v1` 展开（不得用浮点、不得二次舍入），本批不生成精确长展开。
- 未改 `S01_PROTOCOL_VERSION`（版本串由 Lead 统一发布），未接页面、未碰 `StatsPage.tsx`/`FxStats.tsx`。

**测试证据**：`packages/shared/src/analysisMethod.test.ts`（7 用例：内部 id 与冻结值分表、冻结字面量逐字、旧串归一、`type7-linear` 不冒充、开放扩展与未注册标记、`anomalyMethodString`、别名表只含冻结输出）；`variability.test.ts` 新增精确 σ/CV 用例（总体方差 66666666.67 → radicand 精确、μ=0 → `standardDeviation = null`、`varianceKind = "population"`）；`anomaly.test.ts` 新增 `methodString` 对应；shared 全量 **34 文件/546 用例通过，3 skipped**（`FX_PERF` 门控）；web 全量 **174 文件/1582 用例通过**；`tsc -b packages/shared apps/web` exit 0。

### 23.5 v2.0.1 澄清对齐（2026-10-27，A `492b1b6`/`6f72f9f`；回应 Lead m05439）

A 发布 s01-v2 v2.0.1 澄清后，B 暂停批次，逐条核对并修正 `analysisMethod.ts`（不新增/修改任何形状，不改财务数值语义）：

1. **冻结 method 字面量**：对外支持值严格为 `population-stddev` / `sample-cv-fixedpoint` / `mad-median` / `iqr-quantile`；B 内部 `formula` id（`population-standard-deviation-v1` 等）与冻结值**分表**，不得输出到对外字段。
2. **`type7-linear` 禁止冒充**：B 的 A19 分位阈值实现是 nearest-rank（`ceil(n·q)−1`），与 Type 7 线性插值不等价，故 `type7-linear` **不计入已实现方法**（状态 `unregistered`，原样返回），`quantile-threshold` 明确标注为开放扩展，不与冻结值混列。
3. **`SqrtValue.decimalText` 不强制**：见 §23.4；如提供必须按 `decimals=6` 一次 half-away 展开。
4. 冻结值只出现在对外宣称/展示层；B 结果内部字段（`formula`/`methodString`）保持既有形状，`methodString` 仍为 `"mad"`/`"iqr"`/`"zero-dispersion-quantile"`。
5. 修正后 shared 全量、`tsc -b` 与 web 全量重跑为唯一验收证据；提交号见任务文档 §6.6 回填行。




