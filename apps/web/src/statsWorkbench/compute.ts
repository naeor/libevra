/**
 * 工作台卡片的计算入口：**只组合已验收的纯函数，不写新的财务公式。**
 *
 * 数据流（总需求规格 §3.1，单向）：
 *
 *   本机当前账本账目（ledger store，与明细页、旧分析页同一来源）
 *     → 按币种筛选（原币绝不跨币种相加，ACC-03）
 *     → Agent A 装配函数 / Agent B 时间序列 / 既有 computeStats
 *     → 卡片只画结果
 *
 * ⚠️ **同一条件只算一次（总需求规格 §4.2 第 3 点 / ACC-02）。** 结果按「账目快照对象 + 条件」缓存：
 * 同屏两张卡片用同一分析定义时拿到的是同一个结果对象，不会出现两张卡片同一指标不同数字。
 * 账目一变（新记一笔、切换账本），ledger store 发布新数组，旧缓存随旧数组一起被丢弃（WeakMap）。
 */
import {
  addDays,
  computeCalendarHeatmap,
  FX_POLICY,
  comparisonRangeFor,
  makePeriod,
  type AnalysisCompleteness,
  type AnalysisEntry,
  type AnalysisResult,
  type CalendarHeatmapResult,
  type DateRange,
  type StatsBucket,
  type StatsResponse,
  type TimeGranularity,
  type Transaction,
} from "@libellum/shared";
import {
  defaultDefinitionFor,
  getAnalysisCatalogEntry,
  type CatalogAnalysisId,
} from "@libellum/shared/analysis/catalog";

import {
  deriveCategoryAnalysis,
  deriveCumulativeAnalysis,
  deriveFlowAnalysis,
  deriveTimeAnalysis,
  localLedgerCoverageEnd,
  rankCategories,
  toTimeSeriesEntries,
  type CategoryAnalysisView,
  type CumulativeAnalysisView,
  type FlowAnalysisView,
  type TimeAnalysisView,
} from "../lib/analysisData.js";
import { computeStats } from "../lib/offline/localStats.js";
import { fxPolicyFor, type FxCardPolicy } from "./fxPolicy.js";
import type { FxProjection } from "./fxProjection.js";

type Cache = Map<string, unknown>;

const caches = new WeakMap<readonly Transaction[], Cache>();

function cached<T>(entries: readonly Transaction[], key: string, make: () => T): T {
  let cache = caches.get(entries);
  if (cache === undefined) {
    cache = new Map();
    caches.set(entries, cache);
  }
  if (cache.has(key)) return cache.get(key) as T;
  const value = make();
  cache.set(key, value);
  return value;
}

const unknownDateIds = new WeakMap<ReadonlySet<string>, number>();
let nextUnknownDateId = 1;

/** 缓存键里代表「未知日期集合」：同一个集合对象恒得同一个键；空集合等同于没有。 */
function unknownKey(dates: ReadonlySet<string> | undefined): string {
  if (dates === undefined || dates.size === 0) return "";
  let id = unknownDateIds.get(dates);
  if (id === undefined) {
    id = nextUnknownDateId;
    nextUnknownDateId += 1;
    unknownDateIds.set(dates, id);
  }
  return `u${String(id)}`;
}

/** 空集合不传给引擎（保持与原币模式逐位相同的路径）。 */
function unknownOf(dates: ReadonlySet<string> | undefined): { readonly unknownDates: ReadonlySet<string> } | Record<string, never> {
  return dates === undefined || dates.size === 0 ? {} : { unknownDates: dates };
}

const mergedPairs = new WeakMap<readonly Transaction[], WeakMap<readonly Transaction[], readonly Transaction[]>>();

/** 上期比较的两个周期的账目合并成一个稳定数组（同一对输入恒得同一个数组，缓存键才稳定）。 */
export function mergedEntries(left: readonly Transaction[], right: readonly Transaction[]): readonly Transaction[] {
  let inner = mergedPairs.get(left);
  if (inner === undefined) {
    inner = new WeakMap();
    mergedPairs.set(left, inner);
  }
  let merged = inner.get(right);
  if (merged === undefined) {
    merged = [...left, ...right];
    inner.set(right, merged);
  }
  return merged;
}

/** 软删除的账目永远不进统计（与 A/B 的筛选规则一致，这里提前一次，省得每张卡各筛一遍）。 */
export function liveEntries(all: readonly Transaction[]): readonly Transaction[] {
  return all.some((entry) => entry.deletedAt !== null && entry.deletedAt !== undefined)
    ? all.filter((entry) => entry.deletedAt === null || entry.deletedAt === undefined)
    : all;
}

/** 只取某一币种的账目（原币模式）；B 的时间序列本身不看币种，所以必须在这里先分开。 */
export function entriesInCurrency(entries: readonly Transaction[], currency: string): readonly Transaction[] {
  return cached(entries, `currency:${currency}`, () => entries.filter((entry) => entry.currency === currency));
}

/** 账本里实际出现过的币种（筛选面板优先列出它们）。 */
export function currenciesUsed(entries: readonly Transaction[]): readonly string[] {
  return cached(entries, "currencies", () => [...new Set(entries.map((entry) => entry.currency))].sort());
}

/** 与旧分析页同一个实现：趋势、分类、日历、上期比较都从这里来。 */
export function statsFor(
  entries: readonly Transaction[],
  range: DateRange,
  currency: string,
  bucket: StatsBucket,
  withComparison = false,
): StatsResponse {
  return cached(entries, `stats:${range.from}:${range.to}:${currency}:${bucket}:${String(withComparison)}`, () => {
    const comparison = withComparison ? comparisonRangeFor(range) : null;
    return computeStats(entries, {
      from: range.from,
      to: range.to,
      bucket,
      currency: currency as StatsResponse["range"]["currency"],
      ...(comparison === null ? {} : { compareFrom: comparison.from, compareTo: comparison.to }),
    });
  });
}

/** 账目 → Agent A 的分析条目（金额转 bigint，分类名随行携带供来源追溯）。 */
export function analysisEntries(entries: readonly Transaction[]): readonly AnalysisEntry[] {
  return cached(entries, "analysis-entries", () =>
    entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      amountMinor: BigInt(entry.amountCents),
      currency: entry.currency,
      occurredLocalDate: entry.occurredLocalDate,
      categoryId: entry.categoryId,
      categoryName: entry.categoryName,
      categoryIsSystem: entry.categoryIsSystem,
      paymentMethodId: entry.paymentMethodId,
      paymentMethodName: entry.paymentMethodName,
      deletedAt: entry.deletedAt ?? null,
    })),
  );
}

export function isAgentAAnalysis(id: string): id is CatalogAnalysisId {
  return getAnalysisCatalogEntry(id) !== null;
}

/**
 * Agent A 的一项分析（原币）。`completeness` 由数据层给（例如本机覆盖不完整），A 自己再判断
 * 「这段时间没有记录」。周期超过 400 天时 A 会拒绝——那是调用方的错误，这里不吞掉。
 */
export function agentAResult(
  entries: readonly Transaction[],
  id: CatalogAnalysisId,
  range: DateRange,
  currency: string,
  today: string,
  completeness: AnalysisCompleteness = "complete",
  unavailableReason?: string,
  /** 综合折算：账目已是目标币种的折算金额，信封写 `aggregate` 而不是 `original`。 */
  aggregate = false,
): AnalysisResult {
  return cached(entries, `a:${id}:${range.from}:${range.to}:${currency}:${completeness}:${unavailableReason ?? ""}:${String(aggregate)}`, () => {
    const entry = getAnalysisCatalogEntry(id);
    if (entry === null) throw new RangeError(`unknown_analysis_id:${id}`);
    // A 的装配层只断言「单一币种」而不替调用方筛选（混币直接拒绝）；原币模式在这里先按币种取账目。
    return entry.assemble(analysisEntries(entriesInCurrency(entries, currency)), defaultDefinitionFor(id), {
      period: makePeriod(range.from, range.to),
      today,
      currency: aggregate ? { mode: "aggregate", targetCurrency: currency } : { mode: "original", currency },
      completeness,
      ...(unavailableReason === undefined ? {} : { unavailableReason }),
    });
  });
}

/** 综合折算下一张 Agent A 卡片的结果，附带「缺汇率对这张卡片意味着什么」。 */
export interface FxAgentAOutcome {
  readonly result: AnalysisResult;
  readonly policy: FxCardPolicy;
  /** 影响这张卡片口径的缺汇率账目数；0 表示这张卡片的数字不受汇率缺失影响。 */
  readonly missingCount: number;
  /** 有缺汇率账目、且该口径下没有任何一笔成功折算：什么都不能说，不显示 0。 */
  readonly nothingKnown: boolean;
}

const fxOutcomes = new WeakMap<FxProjection, Map<string, FxAgentAOutcome>>();

function nullifyValue(result: AnalysisResult): AnalysisResult {
  return result.shape === "scalar" ? { ...result, value: null } : result;
}

/** 计数类排行不暴露「次要金额」：其中未折算账目是占位 0，不是真实小计。 */
function withoutSecondary(result: AnalysisResult): AnalysisResult {
  if (result.shape !== "ranked-groups") return result;
  return { ...result, groups: result.groups.map(({ secondary: _secondary, ...group }) => group) };
}

/**
 * 综合折算的 Agent A 入口：**统一适配层 → 已验收的 A 装配函数**，不写任何新公式。
 *
 * - `count` 类用全部账目（精确，不受汇率影响）；其余用已成功折算的账目。
 * - 数据层完整性优先：本机覆盖不全等状态原样透传；只有数据层是 `complete` 时才叠加 `fx-incomplete`。
 * - `undetermined` 类缺汇率时把数值置空（A 的「无法确定」语义），不拿部分数据的比值冒充结果。
 */
export function fxAgentAResult(
  projection: FxProjection,
  id: CatalogAnalysisId,
  range: DateRange,
  today: string,
  dataCompleteness: AnalysisCompleteness,
  unavailableReason?: string,
): FxAgentAOutcome {
  const policy = fxPolicyFor(id);
  if (policy === null) throw new RangeError(`fx_policy_missing:${id}`);
  const key = `${id}:${range.from}:${range.to}:${today}:${dataCompleteness}:${unavailableReason ?? ""}`;
  let byKey = fxOutcomes.get(projection);
  if (byKey === undefined) {
    byKey = new Map();
    fxOutcomes.set(projection, byKey);
  }
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;

  const missingCount = projection.missingByScope[policy.kinds].count;
  const known = policy.kinds === "none" || projection.converted.some((entry) => policy.kinds === "both" || entry.kind === policy.kinds);
  const nothingKnown = missingCount > 0 && !known;
  const completeness: AnalysisCompleteness = dataCompleteness !== "complete" ? dataCompleteness : missingCount > 0 ? "fx-incomplete" : "complete";
  const reason = unavailableReason ?? (completeness === "fx-incomplete" ? "fx-rates-missing" : undefined);
  let result = agentAResult(policy.class === "count" ? projection.all : projection.converted, id, range, projection.target, today, completeness, reason, true);
  if (policy.class === "count") result = withoutSecondary(result);
  else result = { ...result, computation: { ...result.computation, convertedWithFx: true, fxPolicy: FX_POLICY } };
  if (policy.class === "undetermined" && missingCount > 0) result = nullifyValue(result);
  const outcome: FxAgentAOutcome = { result, policy, missingCount, nothingKnown };
  byKey.set(key, outcome);
  return outcome;
}

/** 闭区间 → B 的半开区间 `[from, to + 1)`。 */
function span(range: DateRange): { readonly start: string; readonly end: string } {
  return { start: range.from, end: addDays(range.to, 1) };
}

export function timeSeriesFor(
  entries: readonly Transaction[],
  metric: "expense" | "income" | "count",
  granularity: TimeGranularity,
  range: DateRange,
  today: string,
  unknownDates?: ReadonlySet<string>,
): TimeAnalysisView {
  return cached(entries, `ts:${metric}:${granularity}:${range.from}:${range.to}:${today}:${unknownKey(unknownDates)}`, () =>
    deriveTimeAnalysis(entries, {
      metric,
      granularity,
      span: span(range),
      today,
      ...(metric === "count" ? { countKind: "all" as const } : {}),
      ...unknownOf(unknownDates),
    }),
  );
}

export function cumulativeFor(
  entries: readonly Transaction[],
  range: DateRange,
  today: string,
  unknownDates?: ReadonlySet<string>,
): CumulativeAnalysisView {
  return cached(entries, `cum:${range.from}:${range.to}:${today}:${unknownKey(unknownDates)}`, () =>
    deriveCumulativeAnalysis(entries, { metric: "expense", granularity: "day", span: span(range), today, ...unknownOf(unknownDates) }),
  );
}

export function flowFor(
  entries: readonly Transaction[],
  granularity: TimeGranularity,
  range: DateRange,
  today: string,
  unknownDates?: ReadonlySet<string>,
): FlowAnalysisView {
  return cached(entries, `flow:${granularity}:${range.from}:${range.to}:${today}:${unknownKey(unknownDates)}`, () =>
    deriveFlowAnalysis(entries, { granularity, span: span(range), today, ...unknownOf(unknownDates) }),
  );
}

/**
 * 多分类时间对比（I15/I16）：取区间内支出最多的前 `top` 个分类，其余折入「其它」——
 * 选哪几个分类由 B 的权威排行决定，不按名称或像素猜。
 */
export function categorySeriesFor(
  entries: readonly Transaction[],
  granularity: TimeGranularity,
  range: DateRange,
  today: string,
  top = 4,
  unknownDates?: ReadonlySet<string>,
): CategoryAnalysisView {
  return cached(entries, `cat:${granularity}:${range.from}:${range.to}:${today}:${String(top)}:${unknownKey(unknownDates)}`, () => {
    const all = deriveCategoryAnalysis(entries, {
      kind: "expense",
      categoryIds: [...new Set(entries.filter((entry) => entry.kind === "expense").map((entry) => entry.categoryId))],
      includeOther: false,
      granularity,
      span: span(range),
      today,
      ...unknownOf(unknownDates),
    });
    const ranked = rankCategories(all, top).map((row) => row.categoryId);
    return deriveCategoryAnalysis(entries, {
      kind: "expense",
      categoryIds: ranked,
      includeOther: true,
      granularity,
      span: span(range),
      today,
      ...unknownOf(unknownDates),
    });
  });
}

/** 日历热力（Agent B，I12）：支出按日；本机账本口径的覆盖终点与 B 的时间序列一致。 */
export function heatmapFor(
  entries: readonly Transaction[],
  range: DateRange,
  today: string,
  unknownDates?: ReadonlySet<string>,
): CalendarHeatmapResult {
  return cached(entries, `heat:${range.from}:${range.to}:${today}:${unknownKey(unknownDates)}`, () => {
    const half = span(range);
    return computeCalendarHeatmap(toTimeSeriesEntries(entries), {
      metric: "expense",
      span: half,
      today,
      coverageEnd: localLedgerCoverageEnd(half, today),
      ...unknownOf(unknownDates),
    });
  });
}

/** 时间序列卡片的粒度：沿用旧页规则（>120 天按月），周卡片固定按周。 */
export function granularityFor(bucket: StatsBucket): TimeGranularity {
  return bucket === "month" ? "month" : "day";
}
