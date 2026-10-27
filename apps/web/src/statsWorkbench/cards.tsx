/**
 * 卡片内容（C 层）：**只画已经算好的结果**，按卡片自身的真实宽高选择密度。
 *
 * 规则（卡片规格 §3.2、§4.3、§5.4）：
 * - 「没有记录」「无法确定」「暂不支持」「本机不完整」是不同的状态，各有说明，**绝不画成 0**；
 * - 环形图只在分项全部非负、分母完整、至少两项时出现，否则退化为排行条并说明；
 * - 金额不截断、不整体缩放；放不下时减少条目而不是缩小字号，并写明「其它 N 项」；
 * - 卡片内部的图表交互（选中、读数）不会冒泡成「打开详情」。
 */
import {
  addDays,
  comparisonRangeFor,
  endOfMonth,
  startOfMonth,
  type AnalysisResult,
  type CategoryTotal,
  type CompositionResult,
  type DateRange,
  type RankedGroupsResult,
  type RecordExtremeResult,
  type ScalarResult,
  type ScalarValue,
  type TimeBucket,
} from "@libellum/shared";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";
import { Component, createContext, useContext } from "react";

import { CalendarHeatmap } from "../components/charts/CalendarHeatmap.js";
import { CalendarHeatmapGrid } from "../components/charts/CalendarHeatmapGrid.js";
import { CategoryDonut } from "../components/charts/CategoryDonut.js";
import { CategorySeriesChart } from "../components/charts/CategorySeriesChart.js";
import { CategoryShareBands } from "../components/charts/CategoryShareBands.js";
import { CumulativeTrendChart } from "../components/charts/CumulativeTrendChart.js";
import { IncomeExpenseBars } from "../components/charts/IncomeExpenseBars.js";
import { SeriesTrendChart } from "../components/charts/SeriesTrendChart.js";
import { ComparisonPanel } from "../components/charts/SummaryPanel.js";
import { TrendChart } from "../components/charts/TrendChart.js";
import { useI18n } from "../i18n/index.js";
import { bucketLabel, formatAxisAmount, weekBucketLabel } from "../lib/chart/format.js";
import { categoricalColor } from "../lib/chart/theme.js";
import { formatLocalDate } from "../lib/datetime.js";
import { useAnalysisRange } from "../lib/analysisRange.js";
import { useFxRange } from "../lib/fxView.js";
import { displayCategoryName } from "../lib/presetNames.js";
import { cardType, type CardType, type ChartFamily } from "./catalog.js";
import {
  agentAResult,
  categorySeriesFor,
  cumulativeFor,
  heatmapFor,
  entriesInCurrency,
  flowFor,
  granularityFor,
  isAgentAAnalysis,
  statsFor,
  timeSeriesFor,
} from "./compute.js";
import { bucketFor, customRangeProblem } from "./filters.js";
import { FxStatus } from "./FxStatus.js";
import type { WorkbenchScope } from "./scope.js";
import { fxResultBridge, originalCompleteness, timeResultBridge } from "./results.js";
import type { AnalysisResultBase } from "@libellum/shared/workbench/envelope";
import { exactMoneyText, FitAmount, moneyText, ratioFraction, ratioPercentText, type Density } from "./ui.js";

export interface CardBodyProps {
  readonly card: AnalysisCardNode;
  readonly scope: WorkbenchScope;
  readonly density: Density;
  /** 详情页：完整密度，附数据表。 */
  readonly detail?: boolean;
  /** 卡片内容区的真实高度（px）；图表按它取高度，而不是整体缩放或被裁掉。 */
  readonly height?: number;
  readonly width?: number;
}

/** 卡片实际使用的时间范围：卡片自带窗口 > 用户固定的区间 > 顶部筛选。 */
export function cardRange(card: AnalysisCardNode, scope: WorkbenchScope): DateRange {
  const type = cardType(card.analysis.analysisId);
  if (type?.ownWindow === "12m") {
    const thisMonth = startOfMonth(scope.today);
    let from = thisMonth;
    for (let i = 0; i < 11; i += 1) from = startOfMonth(addDays(from, -1));
    return { from, to: scope.today };
  }
  const pinned = card.pinnedRange;
  if (card.rangePolicy === "pinned" && pinned !== undefined && customRangeProblem(pinned.from, pinned.to) === null) {
    return pinned;
  }
  return scope.range;
}

export function familyOf(card: AnalysisCardNode, type: CardType | null): ChartFamily {
  const family = card.chart.chartFamily as ChartFamily;
  if (type === null) return family;
  // 不兼容的展示方式（例如来自旧配置）退回该分析允许的第一种，而不是白屏（卡片规格 §3.2）。
  return type.families.includes(family) ? family : (type.families[0] ?? "number");
}

/**
 * 单张卡片出错只影响这一张：例如权威层拒绝了不合法的输入（混币等），这张卡显示「暂时无法计算」，
 * 工作台其余卡片照常显示，不让一张卡把整页带进错误页。
 */
export class CardErrorBoundary extends Component<{ readonly fallback: string; readonly children: React.ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error("[statsWorkbench] card failed", error);
  }

  override render(): React.ReactNode {
    return this.state.failed ? <Note text={this.props.fallback} tone="warn" /> : this.props.children;
  }
}

export function CardBody(props: CardBodyProps): React.JSX.Element {
  const { t } = useI18n();
  const { card, scope } = props;
  const range = cardRange(card, scope);
  const type = cardType(card.analysis.analysisId);
  const needsRange = scope.readRanges === true && type !== null && (!scope.combined || type.combined) &&
    (range.from !== scope.range.from || range.to !== scope.range.to || card.analysis.analysisId === "AN-A01");
  return (
    <CardErrorBoundary key={`${card.objectId}:${scope.range.from}:${scope.range.to}:${scope.currency}:${String(scope.combined)}`} fallback={t("statsWorkbench.states.failed")}>
      {needsRange ? <RangeCardBody {...props} range={range} /> : <CardBodyInner {...props} />}
    </CardErrorBoundary>
  );
}

/** 固定/自带窗口和上期比较按真实日期复用W5原件链，不拿全局范围的金额替代。 */
function RangeCardBody(props: CardBodyProps & { readonly range: DateRange }): React.JSX.Element {
  const { scope, card, range } = props;
  const comparison = card.analysis.analysisId === "AN-A01" && !scope.combined;
  const previousRange = comparisonRangeFor(range);
  const current = useAnalysisRange(range, !scope.combined);
  const previous = useAnalysisRange(previousRange, comparison);
  const fx = useFxRange(range.from, range.to, scope.combined, { enabled: scope.fxAvailable });
  const data = current.data;
  const resolved: WorkbenchScope = scope.combined ? {
    ...scope, range, bucket: bucketFor(range), fx,
    loaded: !fx.loading, repairing: false, coverageGap: null,
    rangeSourceComplete: fx.sourceComplete === true,
  } : {
    ...scope, range, bucket: bucketFor(range), entries: data?.entries ?? [],
    loaded: data !== undefined || current.error, repairing: false, coverageGap: null,
    rangeReadState: current.permissionDenied ? "no-permission" : current.error ? "request-failed" : current.loading ? "loading" : data?.sourceComplete === true ? "complete" : "offline-incomplete",
    rangeSourceComplete: data?.sourceComplete === true,
    ...(comparison ? { comparisonRead: { entries: previous.data?.entries ?? [], verified: !previous.error && previous.data?.sourceComplete === true } } : {}),
  };
  return <><CardBodyInner {...props} scope={resolved} />{props.detail && scope.combined ? <FxStatus fx={fx} /> : null}</>;
}

function CardBodyInner({ card, scope, density, detail = false, height, width }: CardBodyProps): React.JSX.Element {
  const { t } = useI18n();
  const type = cardType(card.analysis.analysisId);
  if (type === null) return <Note text={t("statsWorkbench.card.unknownHint")} />;
  if (scope.rangeReadState === "no-permission") return <Note text={t("errors.api.book_forbidden")} tone="warn" />;
  if (scope.rangeReadState === "request-failed") return <Note text={t("statsWorkbench.states.failed")} tone="warn" />;
  // 本机还没读到、或正在从服务器补齐缺的月份：显示加载，而不是一个看似准确的 0（卡片规格 §4.3）。
  if (!scope.loaded || (scope.repairing && scope.coverageGap !== null)) return <Skeleton />;
  const range = cardRange(card, scope);
  const family = familyOf(card, type);

  if (scope.combined) {
    if (!type.combined) return <CombinedUnsupported />;
    // S16-D 的结果只对应已请求的日期，不能用全局金额冒充固定时间卡片的结果。
    if (range.from !== scope.range.from || range.to !== scope.range.to) {
      return <Note text={t("statsWorkbench.states.fxRangeUnavailable")} tone="warn" />;
    }
    return <CombinedBody type={type} family={family} scope={scope} density={density} detail={detail} />;
  }

  const id = type.id;
  if (isAgentAAnalysis(id)) {
    const completeness = originalCompleteness(scope, range);
    const result = agentAResult(scope.entries, id, range, scope.currency, scope.today, completeness, completeness === "complete" ? undefined : "local-range-coverage-unverified");
    const body = <AgentAView result={result} family={family} density={density} detail={detail} currency={scope.currency} />;
    return result.shape === "composition" || result.shape === "ranked-groups" ? <ResultState metadata={result}>{body}</ResultState> : body;
  }
  return <TimeView id={id} family={family} scope={scope} range={range} density={density} detail={detail} available={height} availableWidth={width} />;
}

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

export function Skeleton(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t("statsWorkbench.states.loading")} className="flex h-full flex-col justify-end gap-2">
      <span className="sw-skeleton h-6 w-2/3" />
      <span className="sw-skeleton h-3 w-1/2" />
    </div>
  );
}

/**
 * 卡片可以触发的页面级动作。由分析页 / 详情页提供；没有提供（如静态渲染测试）时，卡片只显示说明、不显示按钮。
 * 动作只改**生效筛选**（地址栏），不碰布局文档与账目。
 */
export interface CardActions {
  /** 从综合折算切回原币（默认币种），让暂不支持的卡片立刻可看。 */
  readonly showOriginalCurrency?: () => void;
}

export const CardActionsContext = createContext<CardActions>({});

function CombinedUnsupported(): React.JSX.Element {
  const { t } = useI18n();
  const actions = useContext(CardActionsContext);
  return (
    <div className="flex flex-col items-start gap-2">
      <Note text={t("statsWorkbench.states.combinedUnsupported")} />
      {actions.showOriginalCurrency === undefined ? null : (
        <button type="button" className="sw-link" onClick={actions.showOriginalCurrency}>
          {t("statsWorkbench.states.showOriginal")}
        </button>
      )}
    </div>
  );
}

export function Note({ text, tone = "muted" }: { readonly text: string; readonly tone?: "muted" | "warn" }): React.JSX.Element {
  return (
    <p role="status" className={`text-helper-relaxed ${tone === "warn" ? "text-warn-dark" : "text-muted"}`}>
      {text}
    </p>
  );
}

/** 卡片统一消费 A 的完整性字段；B 的原生桶状态不在展示层重算。 */
function ResultState({ metadata, children }: { readonly metadata: AnalysisResultBase; readonly children: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  if (metadata.completeness === "loading") return <Skeleton />;
  if (metadata.completeness === "no-transactions") return <Note text={t("statsWorkbench.states.empty")} />;
  if (metadata.completeness === "request-failed" || metadata.completeness === "no-permission" || metadata.completeness === "not-applicable") return <Note text={t("statsWorkbench.states.undetermined")} tone="warn" />;
  return <div className="flex h-full min-h-0 flex-col gap-1">{metadata.completeness === "complete" ? null : <Note text={t("statsWorkbench.states.partial")} tone="warn" />}{children}</div>;
}

function completenessNote(result: AnalysisResult, t: ReturnType<typeof useI18n>["t"]): string | null {
  switch (result.completeness) {
    case "complete":
      return null;
    case "no-transactions":
      return t("statsWorkbench.states.empty");
    case "offline-incomplete":
    case "partial":
    case "fx-incomplete":
      return t("statsWorkbench.states.partial");
    default:
      return t("statsWorkbench.states.undetermined");
  }
}

// ---------------------------------------------------------------------------
// Agent A：标量 / 极值 / 构成 / 排行
// ---------------------------------------------------------------------------

function AgentAView({
  result,
  family,
  density,
  detail,
  currency,
}: {
  readonly result: AnalysisResult;
  readonly family: ChartFamily;
  readonly density: Density;
  readonly detail: boolean;
  readonly currency: string;
}): React.JSX.Element {
  const { t } = useI18n();
  switch (result.shape) {
    case "scalar":
      return <ScalarView result={result} density={density} />;
    case "record-extreme":
      return <ExtremeView result={result} density={density} />;
    case "composition": {
      if (result.completeness === "no-transactions") return <Note text={t("statsWorkbench.states.empty")} />;
      const rows = result.parts.map((part) => ({
        id: part.id,
        label: displayCategoryName(part.label),
        value: moneyText(part.amount.amountMinor, part.amount.currency),
        share: part.share,
        minor: part.amount.amountMinor,
      }));
      return <PartsView rows={rows} family={family} density={density} detail={detail} currency={currency} total={result.total?.amountMinor ?? null} kind={result.resolvedFilters.kind === "income" ? "income" : "expense"} />;
    }
    case "ranked-groups": {
      if (result.completeness === "no-transactions") return <Note text={t("statsWorkbench.states.empty")} />;
      const rows = result.groups.map((group) => ({
        id: group.id,
        label: displayCategoryName(group.label),
        value: scalarText(group.primary, t),
        share: group.share,
        minor: group.primary.kind === "money" ? group.primary.money.amountMinor : null,
      }));
      return <PartsView rows={rows} family={family === "donut" ? "ranking" : family} density={density} detail={detail} currency={currency} total={null} kind="expense" />;
    }
  }
}

export function scalarText(value: ScalarValue | null, t: ReturnType<typeof useI18n>["t"]): string {
  if (value === null) return t("statsWorkbench.states.undetermined");
  switch (value.kind) {
    case "money":
      return moneyText(value.money.amountMinor, value.money.currency);
    case "exact-money":
      return exactMoneyText(value.numeratorMinor, value.denominator, value.currency);
    case "count":
      return t("statsWorkbench.values.count", { count: value.count });
    case "days":
      return t("statsWorkbench.values.days", { count: value.days });
    case "ratio":
      return value.scale === "percent-100" ? ratioPercentText(value.ratio) : ratioPercentText(value.ratio);
  }
}

function ScalarView({ result, density }: { readonly result: ScalarResult; readonly density: Density }): React.JSX.Element {
  const { t } = useI18n();
  const note = completenessNote(result, t);
  const negative = result.value?.kind === "money" && result.value.money.amountMinor.startsWith("-");
  return (
    <div className="flex h-full min-h-0 flex-col justify-end gap-1">
      <FitAmount text={scalarText(result.value, t)} start={density === "compact" ? 1 : 0} className={negative ? "text-data-expense" : "text-ink"} />
      {note === null ? null : <p className="text-helper text-muted">{note}</p>}
    </div>
  );
}

function ExtremeView({ result, density }: { readonly result: RecordExtremeResult; readonly density: Density }): React.JSX.Element {
  const { t } = useI18n();
  if (result.completeness === "no-transactions" || (result.extreme === null && result.extremeValue === undefined)) {
    return <Note text={completenessNote(result, t) ?? t("statsWorkbench.states.empty")} />;
  }
  const value =
    result.extreme !== null
      ? moneyText(result.extreme.amountMinor, result.extreme.currency)
      : scalarText(result.extremeValue ?? null, t);
  const where = [
    result.occurredLocalDate === null ? null : formatLocalDate(result.occurredLocalDate),
    result.categoryLabel === null ? null : displayCategoryName(result.categoryLabel),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return (
    <div className="flex h-full min-h-0 flex-col justify-end gap-1">
      <FitAmount text={value} start={density === "compact" ? 1 : 0} className="text-ink" />
      {where === "" ? null : <p className="truncate text-helper text-muted">{where}</p>}
      {result.tieCount > 1 ? <p className="text-helper text-muted">{t("statsWorkbench.values.tie", { count: result.tieCount })}</p> : null}
    </div>
  );
}

interface PartRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly share: { readonly numerator: bigint; readonly denominator: bigint } | null;
  readonly minor: string | null;
}

/** 分类色由稳定 ID 决定：排行变化不换色；颜色只是辅助，名称始终显示。 */
export function colorFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return categoricalColor(hash % 8);
}

function PartsView({
  rows,
  family,
  density,
  detail,
  currency,
  total,
  kind,
}: {
  readonly rows: readonly PartRow[];
  readonly family: ChartFamily;
  readonly density: Density;
  readonly detail: boolean;
  readonly currency: string;
  readonly total: string | null;
  readonly kind: "expense" | "income";
}): React.JSX.Element {
  const { t } = useI18n();
  const donutAllowed =
    family === "donut" &&
    total !== null &&
    rows.length >= 2 &&
    rows.every((row) => row.minor !== null && /^\d+$/.test(row.minor) && Number.isSafeInteger(Number(row.minor)));

  if (family === "donut" && donutAllowed && density !== "compact") {
    const totals: CategoryTotal[] = rows.map((row) => ({
      categoryId: row.id,
      name: row.label,
      kind,
      minor: Number(row.minor),
      share: ratioFraction(row.share),
    }));
    return (
      <div className="sw-interactive min-h-0" onClick={(event) => event.stopPropagation()}>
        <CategoryDonut totals={totals} currency={currency} />
      </div>
    );
  }

  const limit = detail ? rows.length : density === "compact" ? 2 : density === "medium" ? 4 : 6;
  const shown = rows.slice(0, limit);
  const hidden = rows.length - shown.length;
  const maxShare = Math.max(...rows.map((row) => ratioFraction(row.share)), 0.0001);
  const table = family === "table";
  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      {family === "donut" && !donutAllowed && rows.length > 0 ? (
        <p className="text-helper text-muted">{t("statsWorkbench.states.donutFallback")}</p>
      ) : null}
      <ol className="flex min-h-0 flex-col gap-1.5">
        {shown.map((row) => (
          <li key={row.id} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 text-helper">
              <span className="flex min-w-0 items-center gap-1.5 text-ink">
                <span className="sw-dot" style={{ backgroundColor: colorFor(row.id) }} aria-hidden="true" />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-ink">
                {row.value}
                {row.share === null ? null : <span className="ml-1 text-muted">{ratioPercentText(row.share)}</span>}
              </span>
            </div>
            {table ? null : (
              <span className="sw-bar mt-1 block" aria-hidden="true">
                <span style={{ width: `${String(Math.max(2, (ratioFraction(row.share) / maxShare) * 100))}%`, backgroundColor: colorFor(row.id) }} />
              </span>
            )}
          </li>
        ))}
      </ol>
      {hidden > 0 ? <p className="text-helper text-muted">{t("statsWorkbench.values.more", { count: hidden })}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 时间序列（Agent B）与既有统计图（旧分析页同一实现）
// ---------------------------------------------------------------------------

function heightFor(density: Density, detail: boolean, available: number | undefined): number {
  if (detail) return 240;
  // 留出合计一行（约 28px）；其余高度全部给图表，最低 72px。
  if (available !== undefined && available > 0) return Math.max(72, Math.min(260, available - 30));
  return density === "expanded" ? 170 : density === "medium" ? 130 : 96;
}

function labelFor(bucket: TimeBucket): string {
  if (bucket.granularity === "week") return weekBucketLabel(bucket.span);
  return bucketLabel(bucket.key, bucket.granularity === "month" ? "month" : "day");
}

function TimeView({
  id,
  family,
  scope,
  range,
  density,
  detail,
  available,
  availableWidth,
}: {
  readonly id: string;
  readonly family: ChartFamily;
  readonly scope: WorkbenchScope;
  readonly range: DateRange;
  readonly density: Density;
  readonly detail: boolean;
  readonly available: number | undefined;
  readonly availableWidth: number | undefined;
}): React.JSX.Element {
  const { t } = useI18n();
  const currency = scope.currency;
  const entries = entriesInCurrency(scope.entries, currency);
  const height = heightFor(density, detail, available);
  const axis = (value: number) => formatAxisAmount(value, currency);
  const chartKind = family === "area" ? "area" : family === "bar" ? "bar" : "line";
  const stop = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  switch (id) {
    case "AN-I06":
    case "AN-I07":
    case "AN-I08":
    case "AN-I09":
    case "AN-I10":
    case "AN-I19": {
      const metric = id === "AN-I07" || id === "AN-I10" ? "income" : id === "AN-I19" ? "count" : "expense";
      const granularity = id === "AN-I08" ? "week" : id === "AN-I09" || id === "AN-I10" ? "month" : granularityFor(scope.bucket);
      const native = timeSeriesFor(entries, metric, granularity, range, scope.today);
      const bridge = timeResultBridge(id, native, native.result, scope, range, { metric, kind: metric === "count" ? "both" : metric, groupBy: granularity }, native.result.totalCount === 0);
      const view = bridge.nativeResult;
      const total = view.result.totalMinor;
      if (view.result.buckets.every((point) => point.transactionCount === 0 || point.transactionCount === null) && metric !== "count") {
        return <Note text={t(bridge.metadata.completeness === "complete" || bridge.metadata.completeness === "no-transactions" ? "statsWorkbench.states.empty" : "statsWorkbench.states.partial")} />;
      }
      return (
        <ResultState metadata={bridge.metadata}><div className="flex min-h-0 flex-col gap-1">
          {total === null || metric === "count" ? null : (
            <p className="sw-amount text-base font-semibold tabular-nums text-ink">{moneyText(total, currency)}</p>
          )}
          <div className="sw-interactive min-h-0" onClick={stop}>
            <SeriesTrendChart
              points={view.result.buckets}
              metric={metric}
              granularity={granularity}
              chartKind={chartKind}
              title={t(`statsWorkbench.cards.${id as "AN-I06"}.title`)}
              valueText={(point) =>
                point.amountMinor === null
                  ? t("statsWorkbench.states.undetermined")
                  : metric === "count"
                    ? `${labelFor(point.bucket)} · ${t("statsWorkbench.values.count", { count: point.transactionCount ?? 0 })}`
                    : `${labelFor(point.bucket)} · ${moneyText(point.amountMinor, currency)}`
              }
              formatAxis={metric === "count" ? (value) => String(Math.round(value)) : axis}
              height={height}
            />
          </div>
        </div></ResultState>
      );
    }
    case "AN-I11": {
      if (family === "flow-lines") {
        const native = statsFor(entries, range, currency, scope.bucket);
        const bridge = timeResultBridge(id, native, { complete: true }, scope, range, { metric: "income-expense", kind: "both", groupBy: granularityFor(scope.bucket) }, native.totals.count === 0);
        const stats = bridge.nativeResult;
        return (
          <ResultState metadata={bridge.metadata}><div className="sw-interactive min-h-0" onClick={stop}>
            <TrendChart points={stats.series} currency={currency} bucket={scope.bucket} hasEntries={stats.totals.count > 0} />
          </div></ResultState>
        );
      }
      const native = flowFor(entries, granularityFor(scope.bucket), range, scope.today);
      const bridge = timeResultBridge(id, native, native.result, scope, range, { metric: "income-expense", kind: "both", groupBy: granularityFor(scope.bucket) });
      const view = bridge.nativeResult;
      // 整段都没有收支记录：说「没有记录」，不画一张刻度全是 0 的空图。
      if (view.result.buckets.every((point) => (point.incomeCount ?? 0) === 0 && (point.expenseCount ?? 0) === 0)) {
        return <Note text={t(bridge.metadata.completeness === "complete" ? "statsWorkbench.states.empty" : "statsWorkbench.states.partial")} />;
      }
      return (
        <ResultState metadata={bridge.metadata}><div className="sw-interactive min-h-0" onClick={stop}>
          <IncomeExpenseBars
            buckets={view.result.buckets}
            title={t("statsWorkbench.cards.AN-I11.title")}
            incomeLabel={t("common.kind.income")}
            expenseLabel={t("common.kind.expense")}
            formatAxis={axis}
            labelFor={labelFor}
            height={height}
          />
        </div></ResultState>
      );
    }
    case "AN-I12": {
      // 日历热力只画一个月的格子：区间超过 6 周时取结束日所在的月份（在副标题写明实际日期）。
      const span = heatmapRange(range);
      if (detail) {
        const native = statsFor(entries, span, currency, "day");
        const bridge = timeResultBridge(id, native, { complete: true }, scope, span, { metric: "expense", kind: "expense", groupBy: "day" }, native.totals.count === 0);
        const stats = bridge.nativeResult;
        return (
          <ResultState metadata={bridge.metadata}><div className="sw-interactive min-h-0" onClick={stop}>
            <CalendarHeatmap days={stats.series} currency={currency} hasEntries={stats.totals.count > 0} />
          </div></ResultState>
        );
      }
      // 卡片里用 Agent B 的日历格（I12）：按卡片真实高度算格子边长，整月放得下，不裁切、不缩放文字。
      const native = heatmapFor(entries, span, scope.today);
      const bridge = timeResultBridge(id, native, { complete: native.complete, unknownBucketCount: native.unknownDayCount, inProgressBucketCount: native.inProgressDayCount, futureBucketCount: native.futureDayCount }, scope, span, { metric: "expense", kind: "expense", groupBy: "day" });
      const heatmap = bridge.nativeResult;
      const weeks = heatmap.months.reduce((sum, month) => sum + month.weeks.length, 0);
      const rows = weeks + 2;
      const fromHeight = available === undefined ? 40 : (available - rows * 4 - 28) / (weeks + 1);
      const fromWidth = availableWidth === undefined ? 40 : (availableWidth - 24) / 7;
      const cell = Math.max(14, Math.floor(Math.min(fromHeight, fromWidth)));
      const weekdays = t("statsWorkbench.values.weekdays").split(",");
      return (
        <ResultState metadata={bridge.metadata}><div className="sw-interactive mx-auto min-h-0" style={{ maxWidth: cell * 7 + 24 }} onClick={stop}>
          <CalendarHeatmapGrid
            heatmap={heatmap}
            title={t("statsWorkbench.cards.AN-I12.title")}
            monthLabel={(monthKey) => formatLocalDate(`${monthKey}-01`, { year: "numeric", month: "long" })}
            weekdayLabels={weekdays}
            formatDay={(cell) =>
              cell.valueMinor === null
                ? `${formatLocalDate(cell.date)} · ${t("statsWorkbench.states.undetermined")}`
                : `${formatLocalDate(cell.date)} · ${moneyText(cell.valueMinor, currency)}`
            }
          />
        </div></ResultState>
      );
    }
    case "AN-I15": {
      const native = categorySeriesFor(entries, granularityFor(scope.bucket), range, scope.today);
      const bridge = timeResultBridge(id, native, native.result, scope, range, { metric: "expense", kind: "expense", groupBy: "category" });
      const view = bridge.nativeResult;
      if (view.result.categoryIds.length === 0) return <Note text={t(bridge.metadata.completeness === "complete" ? "statsWorkbench.states.empty" : "statsWorkbench.states.partial")} />;
      return (
        <ResultState metadata={bridge.metadata}><div className="sw-interactive min-h-0" onClick={stop}>
          <CategorySeriesChart
            series={view.result}
            title={t("statsWorkbench.cards.AN-I15.title")}
            categoryLabel={(categoryId) => categoryName(scope, categoryId, t)}
            formatAxis={axis}
            labelFor={labelFor}
            kind={family === "line" ? "lines" : "area"}
            height={height}
            formatValue={(amountMinor) => moneyText(amountMinor, currency)}
          />
        </div></ResultState>
      );
    }
    case "AN-I16": {
      const native = categorySeriesFor(entries, granularityFor(scope.bucket), range, scope.today);
      const bridge = timeResultBridge(id, native, native.result, scope, range, { metric: "expense", kind: "expense", groupBy: "category" });
      const view = bridge.nativeResult;
      if (view.result.categoryIds.length === 0) return <Note text={t(bridge.metadata.completeness === "complete" ? "statsWorkbench.states.empty" : "statsWorkbench.states.partial")} />;
      return (
        <ResultState metadata={bridge.metadata}><div className="sw-interactive min-h-0" onClick={stop}>
          <CategoryShareBands
            shares={view.shares}
            title={t("statsWorkbench.cards.AN-I16.title")}
            categoryLabel={(categoryId) => categoryName(scope, categoryId, t)}
            formatShare={(fraction) => `${(fraction * 100).toFixed(0)}%`}
            labelFor={labelFor}
            height={height}
          />
        </div></ResultState>
      );
    }
    case "AN-I20": {
      const native = cumulativeFor(entries, range, scope.today);
      const bridge = timeResultBridge(id, native, native.series, scope, range, { metric: "expense", kind: "expense", groupBy: granularityFor(scope.bucket) }, native.series.totalCount === 0);
      const view = bridge.nativeResult;
      if (view.series.totalCount === 0) return <Note text={t(bridge.metadata.completeness === "complete" || bridge.metadata.completeness === "no-transactions" ? "statsWorkbench.states.empty" : "statsWorkbench.states.partial")} />;
      return (
        <ResultState metadata={bridge.metadata}><div className="flex min-h-0 flex-col gap-1">
          {view.result.totalMinor === null ? null : (
            <p className="sw-amount text-base font-semibold tabular-nums text-ink">{moneyText(view.result.totalMinor, currency)}</p>
          )}
          <div className="sw-interactive min-h-0" onClick={stop}>
            <CumulativeTrendChart
              points={view.result.points}
              title={t("statsWorkbench.cards.AN-I20.title")}
              valueText={(point) =>
                point.cumulativeMinor === null ? t("statsWorkbench.states.undetermined") : `${labelFor(point.bucket)} · ${moneyText(point.cumulativeMinor, currency)}`
              }
              formatAxis={axis}
              height={height}
            />
          </div>
        </div></ResultState>
      );
    }
    case "AN-A01": {
      const comparisonEntries = scope.comparisonRead === undefined ? entries : entriesInCurrency([...new Map([...scope.comparisonRead.entries, ...scope.entries].map(entry => [entry.id, entry])).values()], currency);
      const native = statsFor(comparisonEntries, range, currency, scope.bucket, true);
      const bridge = timeResultBridge(id, native, { complete: true }, scope, range, { metric: "income-expense", kind: "both", groupBy: null }, false, scope.comparisonRead?.verified === true || scope.accountScope?.startsWith("guest:") === true);
      const stats = bridge.nativeResult;
      const previous = stats.comparison;
      // 对比面板本身没有可点的东西：卡片里点它就是打开详情；说明文字在卡片里最多两行，详情页完整显示。
      return (
        <ResultState metadata={bridge.metadata}><div className={`min-h-0 ${detail ? "" : "sw-compare-compact"}`}>
          <ComparisonPanel
            current={stats.totals}
            previous={bridge.metadata.completeness === "complete" ? previous?.totals ?? null : null}
            monthToDate={range.to < endOfMonth(range.to)}
            currentDays={stats.range.days}
            previousDays={previous === null ? 0 : daysIn(previous.range)}
            currency={currency}
          />
        </div></ResultState>
      );
    }
    default:
      return <Note text={t("statsWorkbench.card.unknownHint")} />;
  }
}

function daysIn(range: DateRange): number {
  let days = 0;
  for (let date = range.from; date <= range.to && days < 1000; date = addDays(date, 1)) days += 1;
  return days;
}

/** 日历卡片画哪一段：区间跨月时取结束日所在月份（与区间的交集），副标题写明实际日期。 */
export function heatmapRange(range: DateRange): DateRange {
  const from = startOfMonth(range.to);
  return { from: from < range.from ? range.from : from, to: range.to };
}

function categoryName(scope: WorkbenchScope, categoryId: string, t: ReturnType<typeof useI18n>["t"]): string {
  if (categoryId === "__other__") return t("statsWorkbench.values.other");
  const entry = scope.entries.find((item) => item.categoryId === categoryId);
  return entry === undefined ? categoryId : displayCategoryName(entry.categoryName);
}

// ---------------------------------------------------------------------------
// 综合折算（S16-D 既有路径）
// ---------------------------------------------------------------------------

function CombinedBody({
  type,
  family,
  scope,
  density,
  detail,
}: {
  readonly type: CardType;
  readonly family: ChartFamily;
  readonly scope: WorkbenchScope;
  readonly density: Density;
  readonly detail: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const fx = scope.fx;
  const bridge = fxResultBridge(type.id, scope);
  const state = bridge.metadata.completeness;
  if (state === "loading") return <Note text={t("statsWorkbench.states.fxLoading")} />;
  if (state === "no-permission") return <Note text={t("errors.api.book_forbidden")} tone="warn" />;
  if (state === "no-transactions") return <Note text={t("statsWorkbench.states.empty")} />;
  if (state === "request-failed" || bridge.nativeResult === null) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Note text={t("statsWorkbench.states.fxError")} tone="warn" />
        <button type="button" className="sw-link" onClick={(event) => { event.stopPropagation(); fx?.refresh(); }}>
          {t("statsWorkbench.states.retry")}
        </button>
      </div>
    );
  }
  const result = bridge.nativeResult;
  const complete = state === "complete";
  const target = result.targetCurrency;
  const warning = complete ? null : (
    <p className="text-helper text-warn-dark">{result.missingCount > 0 ? t("statsWorkbench.states.fxIncomplete", { count: result.missingCount }) : t("fx.dataIncomplete")}</p>
  );

  if (!complete && result.convertedCount === 0) {
    return <div className="flex flex-col gap-1">{warning}<Note text={t("statsWorkbench.states.undetermined")} tone="warn" /></div>;
  }

  if (type.id === "AN-B01" || type.id === "AN-B02" || type.id === "AN-B03") {
    const key = type.id === "AN-B01" ? "expenseMinor" : type.id === "AN-B02" ? "incomeMinor" : "netMinor";
    return (
      <div className="flex h-full min-h-0 flex-col justify-end gap-1">
        <FitAmount text={moneyText(result.totals[key], target)} start={density === "compact" ? 1 : 0} className="text-ink" />
        {warning}
      </div>
    );
  }

  const kind = type.id === "AN-I02" || type.id === "AN-I04" ? "income" : "expense";
  const field = kind === "income" ? "incomeMinor" : "expenseMinor";
  const names = new Map(scope.entries.map((entry) => [entry.categoryId, displayCategoryName(entry.categoryName)] as const));
  const sorted = Object.entries(result.categories)
    .filter(([, totals]) => BigInt(totals[field]) > 0n)
    .sort((a, b) => (BigInt(a[1][field]) > BigInt(b[1][field]) ? -1 : 1));
  // 分母直接来自S16-D权威汇总，展示层不再把分类重新累加成另一份总额。
  const sum = BigInt(result.totals[field]);
  if (sorted.length === 0) return <div className="flex flex-col gap-1">{warning}<Note text={t(complete ? "statsWorkbench.states.empty" : "statsWorkbench.states.undetermined")} /></div>;
  // ACC-07：缺汇率时只给小计，不给占比（share = null）。
  const rows: PartRow[] = sorted.map(([id, totals]) => ({
    id,
    label: names.get(id) ?? id,
    value: moneyText(totals[field], target),
    share: complete && sum > 0n ? { numerator: BigInt(totals[field]), denominator: sum } : null,
    minor: totals[field],
  }));
  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      {warning}
      <PartsView rows={rows} family={complete ? family : "ranking"} density={density} detail={detail} currency={target} total={complete ? sum.toString() : null} kind={kind} />
    </div>
  );
}

/** 卡片标题：自定义标题原样显示；预置标题随界面语言。 */
export function cardTitle(card: AnalysisCardNode, t: ReturnType<typeof useI18n>["t"]): string {
  if (card.title?.kind === "custom" && card.title.text !== undefined && card.title.text.trim() !== "") return card.title.text;
  const type = cardType(card.analysis.analysisId);
  return type === null ? t("statsWorkbench.card.unknown") : t(`statsWorkbench.cards.${type.id as "AN-B01"}.title`);
}

/** 副标题：说明这张卡片**实际**用的时间与币种（固定区间必须可见标明，卡片规格 §4.4）。 */
export function cardSubtitle(card: AnalysisCardNode, scope: WorkbenchScope, t: ReturnType<typeof useI18n>["t"]): string {
  const type = cardType(card.analysis.analysisId);
  if (type === null) return "";
  const parts: string[] = [];
  if (type.ownWindow === "12m") parts.push(t("statsWorkbench.card.ownWindow12m"));
  else if (card.rangePolicy === "pinned" && card.pinnedRange !== undefined) {
    parts.push(t("statsWorkbench.card.pinned", { from: formatLocalDate(card.pinnedRange.from), to: formatLocalDate(card.pinnedRange.to) }));
  } else if (type.id === "AN-I12") {
    const span = heatmapRange(scope.range);
    if (span.from !== scope.range.from) parts.push(`${formatLocalDate(span.from)} – ${formatLocalDate(span.to)}`);
  }
  // 币种与统计方式已写在页面顶部的条件摘要里，卡片不再逐张重复；只有与摘要不同的条件才写出来。
  return parts.join(" · ");
}

export type { CompositionResult, RankedGroupsResult };
