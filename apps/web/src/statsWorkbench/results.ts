/**
 * W2/W3 公共元数据桥接：直接使用 A 的冻结基础类型，原生金额与桶载荷保持引用。
 *
 * 这不是新的结果协议，也不把 S16-D FxAggregate / B 的原生 view 假冒为冻结形状。
 * 完整 shape 投影仍待各计算方正式提供；页面先统一消费真实的 completeness。
 */
import { FX_POLICY, makePeriod, type DateRange, type FxAggregate } from "@libellum/shared";
import { getAnalysisCatalogEntry } from "@libellum/shared/analysis/catalog";
import { ANALYSIS_PROTOCOL_VERSION, ANALYSIS_ROUNDING_POLICY, type AnalysisResultBase, type AnalysisCompleteness, type ResolvedFilters } from "@libellum/shared/workbench/envelope";
import type { WorkbenchScope } from "./scope.js";

export interface NativeResultBridge<T> {
  readonly metadata: AnalysisResultBase;
  readonly nativeResult: T;
}

export function originalCompleteness(scope: WorkbenchScope, range: DateRange): AnalysisCompleteness {
  if (scope.rangeReadState !== undefined && scope.rangeReadState !== "complete") return scope.rangeReadState;
  if (!scope.loaded || scope.repairing) return "loading";
  if (scope.rangeSourceComplete === false || range.from !== scope.range.from || range.to !== scope.range.to || scope.coverageGap !== null) return "offline-incomplete";
  return "complete";
}

function metadata(
  id: string,
  scope: WorkbenchScope,
  range: DateRange,
  completeness: AnalysisCompleteness,
  reason: string | undefined,
  descriptor: { readonly analysisType: string; readonly metric: string; readonly kind: ResolvedFilters["kind"]; readonly groupBy: string | null },
): AnalysisResultBase {
  const period = makePeriod(range.from, range.to);
  const filters: ResolvedFilters = { kind: descriptor.kind, categoryIds: null, paymentMethodIds: null, tagIds: null, currency: scope.combined ? null : scope.currency };
  return {
    version: ANALYSIS_PROTOCOL_VERSION,
    analysisId: id,
    analysisType: descriptor.analysisType,
    metric: descriptor.metric,
    resolvedFilters: filters,
    resolvedPeriod: period,
    resolvedCurrency: scope.combined ? { mode: "aggregate", targetCurrency: scope.currency } : { mode: "original", currency: scope.currency },
    completeness,
    ...(reason === undefined ? {} : { unavailableReason: reason }),
    dataVersion: null,
    computation: { rounding: ANALYSIS_ROUNDING_POLICY, ...(scope.combined ? { convertedWithFx: true, fxPolicy: FX_POLICY } : {}) },
    source: { analysisId: id, period, filters, groupBy: descriptor.groupBy, query: { kind: "transactions", from: range.from, to: range.to, currency: filters.currency }, dataVersion: null },
  };
}

/** S16-D 只提供聚合载荷；不填不存在的分类笔数、不重新折算、不建立第二套形状。 */
export function fxResultBridge(id: string, scope: WorkbenchScope, range: DateRange = scope.range): NativeResultBridge<FxAggregate | null> {
  const descriptor = getAnalysisCatalogEntry(id);
  if (descriptor === null) throw new RangeError(`unknown_analysis_id:${id}`);
  const fx = scope.fx;
  const result = fx?.result ?? null;
  let completeness: AnalysisCompleteness;
  let reason: string | undefined;
  if (range.from !== scope.range.from || range.to !== scope.range.to) {
    completeness = "not-applicable"; reason = "fx-card-range-not-loaded";
  } else if (fx === null || fx.loading) {
    completeness = "loading"; reason = "fx-loading";
  } else if (fx.reason === "permission") {
    completeness = "no-permission"; reason = "fx-book-permission-denied";
  } else if (fx.error === true || result === null) {
    completeness = "request-failed"; reason = fx.reason === "capacity" ? "fx-range-capacity" : "fx-read-failed";
  } else if (fx.sourceComplete !== true) {
    completeness = "offline-incomplete"; reason = "fx-source-coverage-missing";
  } else if (!result.complete) {
    completeness = "fx-incomplete"; reason = "fx-rates-missing";
  } else {
    completeness = result.convertedCount === 0 ? "no-transactions" : "complete";
  }
  return { metadata: metadata(id, scope, range, completeness, reason, { ...descriptor, kind: descriptor.defaultKind }), nativeResult: result };
}

interface NativeTimeStatus {
  readonly complete: boolean;
  readonly unknownBucketCount?: number;
  readonly inProgressBucketCount?: number;
  readonly futureBucketCount?: number;
}

/** B 桶五态由 B 保留；整卡映射到 A 的九态，不从金额或像素猜覆盖完整性。 */
export function timeResultBridge<T>(
  id: string, nativeResult: T, status: NativeTimeStatus, scope: WorkbenchScope, range: DateRange,
  descriptor: { readonly metric: string; readonly kind: ResolvedFilters["kind"]; readonly groupBy: string | null },
  noTransactions = false,
  additionalCoverageVerified = true,
  /** 综合折算：影响这张卡片口径的缺汇率账目数；时间段因此未知时整卡是 `fx-incomplete`，不是本机覆盖问题。 */
  fxMissing = 0,
): NativeResultBridge<T> {
  let completeness = originalCompleteness(scope, range);
  let reason: string | undefined = completeness === "loading" ? "local-records-loading" : completeness === "offline-incomplete" ? "local-range-coverage-unverified" : completeness === "no-permission" ? "analysis-book-permission-denied" : completeness === "request-failed" ? "analysis-range-read-failed" : undefined;
  if (completeness === "complete") {
    if (!additionalCoverageVerified) {
      completeness = "offline-incomplete"; reason = "comparison-previous-range-unverified";
    } else if ((status.unknownBucketCount ?? 0) > 0) {
      completeness = fxMissing > 0 ? "fx-incomplete" : "offline-incomplete";
      reason = fxMissing > 0 ? "fx-rates-missing" : "time-bucket-coverage-missing";
    } else if (!status.complete) {
      completeness = "partial"; reason = "time-buckets-in-progress-or-future";
    } else if (noTransactions) {
      completeness = "no-transactions";
    }
  }
  const analysisType = id === "AN-I12" ? "calendar-heatmap" : id === "AN-A01" ? "period-comparison" : descriptor.groupBy === "category" || id === "AN-I11" ? "multi-series" : "time-series";
  return { metadata: metadata(id, scope, range, completeness, reason, { ...descriptor, analysisType }), nativeResult };
}
