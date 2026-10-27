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
  type AnalysisCompleteness,
  type AnalysisResult,
  type CategoryTotal,
  type CompositionResult,
  type DateRange,
  type RankedGroupsResult,
  type RecordExtremeResult,
  type ScalarResult,
  type ScalarValue,
  type TimeBucket,
  type Transaction,
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
import { defaultKindFor } from "@libellum/shared/analysis/catalog";
import { ADVANCED_CARD_IDS, AdvancedCardView } from "./advancedCards.js";
import { cardType, type CardType, type ChartFamily } from "./catalog.js";
import {
  agentAResult,
  categorySeriesFor,
  cumulativeFor,
  heatmapFor,
  entriesInCurrency,
  flowFor,
  fxAgentAResult,
  fxComparisonModel,
  granularityFor,
  isAgentAAnalysis,
  statsFor,
  timeSeriesFor,
  type FxAgentAOutcome,
} from "./compute.js";
import { bucketFor, customRangeProblem, filterKey, filterWorkbenchEntries, matchesWorkbenchFilters } from "./filters.js";
import { fxPolicyFor, type FxCardPolicy } from "./fxPolicy.js";
import { projectFxCached, type FxProjection, type FxProjectionState } from "./fxProjection.js";
import { FxStatus } from "./FxStatus.js";
import type { FxRangeView, WorkbenchScope } from "./scope.js";
import { fxResultBridge, originalCompleteness, scopeResolvedFilters, timeResultBridge } from "./results.js";
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
  const isComparison = card.analysis.analysisId === "AN-A01";
  const comparison = isComparison && !scope.combined;
  const previousRange = comparisonRangeFor(range);
  const current = useAnalysisRange(range, !scope.combined);
  const previous = useAnalysisRange(previousRange, comparison);
  /**
   * ⚠️ **W5：卡片自己读取的范围也必须应用同一组维度筛选**（固定窗口、上期比较、综合折算），
   * 否则顶部筛了分类却只对全局范围生效，固定窗口卡会算进被排除的账目（任务 §6.2/§6.3）。
   */
  const fxFilter = (entry: Transaction & { readonly bookId: string }) => matchesWorkbenchFilters(entry, scope.filters);
  const fxKey = filterKey(scope.filters);
  const fx = useFxRange(range.from, range.to, scope.combined, { enabled: scope.fxAvailable, filter: fxFilter, filterKey: fxKey });
  // 综合折算的「上期比较」要读上一周期自己的折算：当期的金额不能替代它，也不能拿全局范围冒充。
  const previousFx = useFxRange(previousRange.from, previousRange.to, scope.combined && isComparison, { enabled: scope.fxAvailable, filter: fxFilter, filterKey: fxKey });
  const data = current.data;
  const currentEntries = filterWorkbenchEntries(data?.entries ?? [], scope.filters);
  const previousEntries = filterWorkbenchEntries(previous.data?.entries ?? [], scope.filters);
  const resolved: WorkbenchScope = scope.combined ? {
    ...scope, range, bucket: bucketFor(range), fx, previousFx: isComparison ? previousFx : null,
    loaded: !fx.loading, repairing: false, coverageGap: null,
    rangeSourceComplete: fx.sourceComplete === true,
  } : {
    ...scope, range, bucket: bucketFor(range), entries: currentEntries,
    loaded: data !== undefined || current.error, repairing: false, coverageGap: null,
    rangeReadState: current.permissionDenied ? "no-permission" : current.error ? "request-failed" : current.loading ? "loading" : data?.sourceComplete === true ? "complete" : "offline-incomplete",
    rangeSourceComplete: data?.sourceComplete === true,
    ...(comparison ? { comparisonRead: { entries: previousEntries, verified: !previous.error && previous.data?.sourceComplete === true } } : {}),
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
    // 折算结果只对应它请求过的日期：固定窗口 / 上期比较由 `RangeCardBody` 为这张卡片自己读取；
    // 走到这里范围却对不上，说明接线有错——显式失败，绝不拿全局金额冒充。
    if (range.from !== scope.range.from || range.to !== scope.range.to) {
      return <Note text={t("statsWorkbench.states.fxRangeNotRead")} tone="warn" />;
    }
    return <CombinedCard type={type} family={family} scope={scope} range={range} density={density} detail={detail} height={height} width={width} />;
  }

  const id = type.id;
  if (isAgentAAnalysis(id)) {
    const completeness = originalCompleteness(scope, range);
    const result = agentAResult(scope.entries, id, range, scope.currency, scope.today, completeness, completeness === "complete" ? undefined : "local-range-coverage-unverified", false, scopeResolvedFilters(scope, defaultKindFor(id)));
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

/**
 * 卡片统一消费 A 的完整性字段；B 的原生桶状态不在展示层重算。
 * `partialText`：综合折算下缺汇率时用更具体的说明替换通用的「数据不完整」。
 */
function ResultState({ metadata, children, partialText }: { readonly metadata: AnalysisResultBase; readonly children: React.ReactNode; readonly partialText?: string | null | undefined }): React.JSX.Element {
  const { t } = useI18n();
  if (metadata.completeness === "loading") return <Skeleton />;
  if (metadata.completeness === "no-transactions") return <Note text={t("statsWorkbench.states.empty")} />;
  if (metadata.completeness === "request-failed" || metadata.completeness === "no-permission" || metadata.completeness === "not-applicable") return <Note text={t("statsWorkbench.states.undetermined")} tone="warn" />;
  const note = metadata.completeness === "complete" ? null : partialText ?? t("statsWorkbench.states.partial");
  return <div className="flex h-full min-h-0 flex-col gap-1">{note === null ? null : <Note text={note} tone="warn" />}{children}</div>;
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

export function scalarText(value: ScalarValue | null, t: ReturnType<typeof useI18n>["t"], analysisId?: string): string {
  if (value === null) return t("statsWorkbench.states.undetermined");
  switch (value.kind) {
    case "money":
      return moneyText(value.money.amountMinor, value.money.currency);
    case "exact-money":
      return exactMoneyText(value.numeratorMinor, value.denominator, value.currency);
    case "count":
      return analysisId === "AN-B16"
        ? t("statsWorkbench.values.categories", { count: value.count })
        : t("statsWorkbench.values.count", { count: value.count });
    case "days":
      return t("statsWorkbench.values.days", { count: value.days });
    case "ratio":
      return value.scale === "percent-100" ? ratioPercentText(value.ratio) : ratioPercentText(value.ratio);
  }
}

function ScalarView({ result, density, note: noteOverride }: { readonly result: ScalarResult; readonly density: Density; readonly note?: string | null }): React.JSX.Element {
  const { t } = useI18n();
  const note = noteOverride === undefined ? completenessNote(result, t) : noteOverride;
  const negative = result.value?.kind === "money" && result.value.money.amountMinor.startsWith("-");
  return (
    <div className="flex h-full min-h-0 flex-col justify-end gap-1">
      <FitAmount text={scalarText(result.value, t, result.analysisId)} start={density === "compact" ? 1 : 0} className={negative ? "text-data-expense" : "text-ink"} />
      {note === null ? null : <p className="text-helper text-muted">{note}</p>}
    </div>
  );
}

function ExtremeView({ result, density, note }: { readonly result: RecordExtremeResult; readonly density: Density; readonly note?: string | null }): React.JSX.Element {
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
      {note === undefined || note === null ? null : <p className="text-helper text-warn-dark">{note}</p>}
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
  // 缺汇率时没有占比：条形长度改按小计的相对大小画（只是几何，不代表占比，也不显示百分比）。
  const byAmount = rows.length > 0 && rows.every((row) => row.share === null && row.minor !== null && /^\d+$/.test(row.minor));
  const weightOf = (row: PartRow): number => (byAmount ? Number(row.minor) : ratioFraction(row.share));
  const maxShare = Math.max(...rows.map(weightOf), 0.0001);
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
                <span style={{ width: `${String(Math.max(2, (weightOf(row) / maxShare) * 100))}%`, backgroundColor: colorFor(row.id) }} />
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

/** 综合折算下时间类卡片需要的额外信息。 */
interface FxTimeContext {
  readonly projection: FxProjection;
  readonly policy: FxCardPolicy;
  /** 含缺汇率账目的日期（按本卡片的口径）；`undefined` = 此卡片不受汇率缺失影响。 */
  readonly unknownDates: ReadonlySet<string> | undefined;
  readonly missingCount: number;
  /** 仅「上期比较」使用：上一周期的折算状态。 */
  readonly previous: FxProjectionState | null;
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
  fx,
}: {
  readonly id: string;
  readonly family: ChartFamily;
  readonly scope: WorkbenchScope;
  readonly range: DateRange;
  readonly density: Density;
  readonly detail: boolean;
  readonly available: number | undefined;
  readonly availableWidth: number | undefined;
  /** 综合折算：`scope.entries` 已是目标币种的折算账目；这里带上缺汇率信息，其余路径与原币完全一致。 */
  readonly fx?: FxTimeContext;
}): React.JSX.Element {
  const { t } = useI18n();
  const currency = scope.currency;
  const fxMissing = fx?.missingCount ?? 0;
  const unknownDates = fx?.unknownDates;
  const seriesNote = (completeness: string): string | undefined =>
    completeness === "fx-incomplete" ? t("statsWorkbench.states.fxSeries", { count: fxMissing }) : undefined;
  const emptyOrPartial = (completeness: string, emptyStates: readonly string[]): string =>
    emptyStates.includes(completeness) ? t("statsWorkbench.states.empty") : seriesNote(completeness) ?? t("statsWorkbench.states.partial");
  const entries = entriesInCurrency(scope.entries, currency);
  const height = heightFor(density, detail, available);
  const axis = (value: number) => formatAxisAmount(value, currency);
  const chartKind = family === "area" ? "area" : family === "bar" ? "bar" : "line";
  // S17-B 第二批：这些分析自己的派生层已经算好结果，只需选择数据范围与格式化。
  if (ADVANCED_CARD_IDS.has(id)) {
    return <AdvancedCardView id={id} family={family} scope={scope} range={range} density={density} detail={detail} available={available} fx={fx} />;
  }
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
      const native = timeSeriesFor(entries, metric, granularity, range, scope.today, unknownDates);
      const bridge = timeResultBridge(id, native, native.result, scope, range, { metric, kind: metric === "count" ? "both" : metric, groupBy: granularity }, native.result.totalCount === 0, true, fxMissing);
      const view = bridge.nativeResult;
      const total = view.result.totalMinor;
      if (view.result.buckets.every((point) => point.transactionCount === 0 || point.transactionCount === null) && metric !== "count") {
        return <Note text={emptyOrPartial(bridge.metadata.completeness, ["complete", "no-transactions"])} />;
      }
      return (
        <ResultState metadata={bridge.metadata} partialText={seriesNote(bridge.metadata.completeness)}><div className="flex min-h-0 flex-col gap-1">
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
      // 折线图画不出「未知」的时间段，缺汇率时改用能标示未知的柱状图并说明，而不是把缺失画成 0。
      const lineFallback = family === "flow-lines" && unknownDates !== undefined && unknownDates.size > 0;
      if (family === "flow-lines" && !lineFallback) {
        const native = statsFor(entries, range, currency, scope.bucket);
        const bridge = timeResultBridge(id, native, { complete: true }, scope, range, { metric: "income-expense", kind: "both", groupBy: granularityFor(scope.bucket) }, native.totals.count === 0);
        const stats = bridge.nativeResult;
        return (
          <ResultState metadata={bridge.metadata}><div className="sw-interactive min-h-0" onClick={stop}>
            <TrendChart points={stats.series} currency={currency} bucket={scope.bucket} hasEntries={stats.totals.count > 0} />
          </div></ResultState>
        );
      }
      const native = flowFor(entries, granularityFor(scope.bucket), range, scope.today, unknownDates);
      const bridge = timeResultBridge(id, native, native.result, scope, range, { metric: "income-expense", kind: "both", groupBy: granularityFor(scope.bucket) }, false, true, fxMissing);
      const view = bridge.nativeResult;
      // 整段都没有收支记录：说「没有记录」，不画一张刻度全是 0 的空图。
      if (view.result.buckets.every((point) => (point.incomeCount ?? 0) === 0 && (point.expenseCount ?? 0) === 0)) {
        return <Note text={emptyOrPartial(bridge.metadata.completeness, ["complete"])} />;
      }
      return (
        <ResultState metadata={bridge.metadata} partialText={seriesNote(bridge.metadata.completeness)}>{lineFallback ? <Note text={t("statsWorkbench.states.fxChartFallback")} /> : null}<div className="sw-interactive min-h-0" onClick={stop}>
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
      // 详情页的旧版热力图画不出「未知」的日子：这个月里有缺汇率的日期时，详情也用能标示未知的日历格。
      const spanHasUnknown = unknownDates !== undefined && [...unknownDates].some((date) => date >= span.from && date <= span.to);
      if (detail && !spanHasUnknown) {
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
      const native = heatmapFor(entries, span, scope.today, unknownDates);
      const bridge = timeResultBridge(id, native, { complete: native.complete, unknownBucketCount: native.unknownDayCount, inProgressBucketCount: native.inProgressDayCount, futureBucketCount: native.futureDayCount }, scope, span, { metric: "expense", kind: "expense", groupBy: "day" }, false, true, fxMissing);
      const heatmap = bridge.nativeResult;
      const weeks = heatmap.months.reduce((sum, month) => sum + month.weeks.length, 0);
      const rows = weeks + 2;
      const fromHeight = available === undefined ? 40 : (available - rows * 4 - 28) / (weeks + 1);
      const fromWidth = availableWidth === undefined ? 40 : (availableWidth - 24) / 7;
      const cell = Math.max(14, Math.floor(Math.min(fromHeight, fromWidth)));
      const weekdays = t("statsWorkbench.values.weekdays").split(",");
      return (
        <ResultState metadata={bridge.metadata} partialText={seriesNote(bridge.metadata.completeness)}><div className="sw-interactive mx-auto min-h-0" style={{ maxWidth: cell * 7 + 24 }} onClick={stop}>
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
      const native = categorySeriesFor(entries, granularityFor(scope.bucket), range, scope.today, 4, unknownDates);
      const bridge = timeResultBridge(id, native, native.result, scope, range, { metric: "expense", kind: "expense", groupBy: "category" }, false, true, fxMissing);
      const view = bridge.nativeResult;
      if (view.result.categoryIds.length === 0) return <Note text={emptyOrPartial(bridge.metadata.completeness, ["complete"])} />;
      return (
        <ResultState metadata={bridge.metadata} partialText={seriesNote(bridge.metadata.completeness)}><div className="sw-interactive min-h-0" onClick={stop}>
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
      const native = categorySeriesFor(entries, granularityFor(scope.bucket), range, scope.today, 4, unknownDates);
      const bridge = timeResultBridge(id, native, native.result, scope, range, { metric: "expense", kind: "expense", groupBy: "category" }, false, true, fxMissing);
      const view = bridge.nativeResult;
      if (view.result.categoryIds.length === 0) return <Note text={emptyOrPartial(bridge.metadata.completeness, ["complete"])} />;
      return (
        <ResultState metadata={bridge.metadata} partialText={seriesNote(bridge.metadata.completeness)}><div className="sw-interactive min-h-0" onClick={stop}>
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
      const native = cumulativeFor(entries, range, scope.today, unknownDates);
      const bridge = timeResultBridge(id, native, native.series, scope, range, { metric: "expense", kind: "expense", groupBy: granularityFor(scope.bucket) }, native.series.totalCount === 0, true, fxMissing);
      const view = bridge.nativeResult;
      if (view.series.totalCount === 0) return <Note text={emptyOrPartial(bridge.metadata.completeness, ["complete", "no-transactions"])} />;
      return (
        <ResultState metadata={bridge.metadata} partialText={seriesNote(bridge.metadata.completeness)}><div className="flex min-h-0 flex-col gap-1">
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
      if (fx !== undefined) return <FxComparisonView id={id} scope={scope} range={range} detail={detail} fx={fx} />;
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

/**
 * 综合折算的「上期比较」：当期与上一周期各自读取并折算；任意一期缺汇率或不完整，都不显示增减
 * （不拿残缺的一期去比完整的一期，更不编造增长率）。当期自己的数字只要完整就照常显示。
 */
function FxComparisonView({
  id,
  scope,
  range,
  detail,
  fx,
}: {
  readonly id: string;
  readonly scope: WorkbenchScope;
  readonly range: DateRange;
  readonly detail: boolean;
  readonly fx: FxTimeContext;
}): React.JSX.Element {
  const { t } = useI18n();
  const previousState = fx.previous;
  if (previousState === null) return <Note text={t("statsWorkbench.states.fxProjectionInvalid")} tone="warn" />;
  if (previousState.status === "loading") return <Note text={t("statsWorkbench.states.fxLoading")} />;
  const previous = previousState.status === "ready" ? previousState.projection : null;
  const currency = scope.currency;
  const model = fxComparisonModel(scope.entries, fx.projection, previous, range, scope.bucket, currency, scope.rangeSourceComplete === true);
  const { native, currentMissing, previousTotals, previousIssue } = model;
  // 对比面板用的是整数 number：任何合计超出安全整数就不显示，而不是显示被舍入的数字。
  if (!model.safe) return <Note text={t("statsWorkbench.states.undetermined")} tone="warn" />;
  const bridge = timeResultBridge(id, native, { complete: currentMissing === 0, unknownBucketCount: currentMissing > 0 ? 1 : 0 }, scope, range, { metric: "income-expense", kind: "both", groupBy: null }, false, true, currentMissing);
  const stats = bridge.nativeResult;
  const previousNote =
    previousIssue === null
      ? undefined
      : previousIssue === "previous-unusable"
        ? t("statsWorkbench.states.fxComparisonPreviousFailed")
        : previousIssue === "current-incomplete"
          ? t("statsWorkbench.states.fxComparisonCurrentIncomplete")
          : t("statsWorkbench.states.fxComparisonUnavailable", { count: model.currentMissing + model.previousMissing });
  return (
    <ResultState metadata={bridge.metadata} partialText={bridge.metadata.completeness === "fx-incomplete" ? t("statsWorkbench.states.fxSubtotal", { count: currentMissing }) : undefined}>
      <div className={`min-h-0 ${detail ? "" : "sw-compare-compact"}`}>
        <ComparisonPanel
          current={stats.totals}
          previous={previousTotals}
          monthToDate={range.to < endOfMonth(range.to)}
          currentDays={stats.range.days}
          previousDays={previousTotals === null || stats.comparison === null ? 0 : daysIn(stats.comparison.range)}
          currency={currency}
          {...(previousNote === undefined ? {} : { previousNote })}
        />
      </div>
    </ResultState>
  );
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
// 综合折算：统一适配层（fxProjection）→ 已验收的 A / B 计算入口
// ---------------------------------------------------------------------------

/** 逐笔条数超出上限时，这些卡片仍可由 S16-D 的聚合结果（不依赖逐笔投影）给出，行为与适配前一致。 */
const FX_AGGREGATE_ONLY: ReadonlySet<string> = new Set(["AN-B01", "AN-B02", "AN-B03", "AN-I01", "AN-I02", "AN-I03", "AN-I04"]);

type Translate = ReturnType<typeof useI18n>["t"];

/** 缺汇率对这张卡片的数字意味着什么，用一句话说清；与金额无关的计数类、或不受影响时为 `null`。 */
export function fxNoteFor(policy: FxCardPolicy, missing: number, t: Translate): string | null {
  if (missing <= 0) return null;
  switch (policy.class) {
    case "sum":
      return t("statsWorkbench.states.fxSubtotal", { count: missing });
    case "partial":
      return t("statsWorkbench.states.fxPartialAverage", { count: missing });
    case "undetermined":
      return t("statsWorkbench.states.fxUndetermined", { count: missing });
    case "extreme":
      return t("statsWorkbench.states.fxExtreme", { count: missing });
    case "composition":
      return t("statsWorkbench.states.fxComposition", { count: missing });
    case "ranking":
      return t("statsWorkbench.states.fxRanking", { count: missing });
    case "series":
      return t("statsWorkbench.states.fxSeries", { count: missing });
    case "count":
      return null;
  }
}

function RetryNote({ text, onRetry }: { readonly text: string; readonly onRetry: (() => void) | undefined }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-start gap-2">
      <Note text={text} tone="warn" />
      {onRetry === undefined ? null : (
        <button type="button" className="sw-link" onClick={(event) => { event.stopPropagation(); onRetry(); }}>
          {t("statsWorkbench.states.retry")}
        </button>
      )}
    </div>
  );
}

function CombinedCard({
  type,
  family,
  scope,
  range,
  density,
  detail,
  height,
  width,
}: {
  readonly type: CardType;
  readonly family: ChartFamily;
  readonly scope: WorkbenchScope;
  readonly range: DateRange;
  readonly density: Density;
  readonly detail: boolean;
  readonly height: number | undefined;
  readonly width: number | undefined;
}): React.JSX.Element {
  const { t } = useI18n();
  const fx = scope.fx;
  const policy = fxPolicyFor(type.id);
  if (fx === null || policy === null) return <CombinedUnsupported />;
  const state = projectFxCached(fx);
  switch (state.status) {
    case "loading":
      return <Note text={t("statsWorkbench.states.fxLoading")} />;
    case "no-permission":
      return <Note text={t("errors.api.book_forbidden")} tone="warn" />;
    case "request-failed":
      return <RetryNote text={t("statsWorkbench.states.fxError")} onRetry={fx.refresh} />;
    case "invalid":
      return <RetryNote text={t("statsWorkbench.states.fxProjectionInvalid")} onRetry={fx.refresh} />;
    case "entry-limit":
      // 不截断、不提高上限：逐笔分析显式失败；仅靠聚合就能精确给出的卡片照旧显示。
      return FX_AGGREGATE_ONLY.has(type.id)
        ? <CombinedAggregateBody type={type} family={family} scope={scope} density={density} detail={detail} />
        : <Note text={t("statsWorkbench.states.fxEntryLimit", { limit: state.limit })} tone="warn" />;
    case "ready":
      break;
  }
  const projection = state.projection;
  const dataCompleteness: AnalysisCompleteness = fx.sourceComplete === true ? "complete" : "offline-incomplete";
  const missing = projection.missingByScope[policy.kinds];

  if (isAgentAAnalysis(type.id)) {
    const outcome = fxAgentAResult(projection, type.id, range, scope.today, dataCompleteness, dataCompleteness === "complete" ? undefined : "fx-source-coverage-missing", scopeResolvedFilters(scope, defaultKindFor(type.id)));
    return <FxAgentAView outcome={outcome} family={family} density={density} detail={detail} currency={projection.target} />;
  }

  // B 的时间类：账目换成目标币种的折算账目，范围覆盖与原币模式一样由数据层给；缺汇率的日期传给引擎标为未知。
  const fxScope: WorkbenchScope = {
    ...scope,
    entries: policy.class === "count" ? projection.all : projection.converted,
    currency: projection.target,
    loaded: true,
    repairing: false,
    coverageGap: null,
    rangeReadState: dataCompleteness,
    rangeSourceComplete: fx.sourceComplete === true,
  };
  const previous = type.id === "AN-A01" ? (scope.previousFx === undefined || scope.previousFx === null ? null : projectFxCached(scope.previousFx)) : null;
  return (
    <TimeView
      id={type.id}
      family={family}
      scope={fxScope}
      range={range}
      density={density}
      detail={detail}
      available={height}
      availableWidth={width}
      fx={{ projection, policy, unknownDates: missing.count > 0 ? missing.dates : undefined, missingCount: missing.count, previous }}
    />
  );
}

/** Agent A 结果的综合折算展示：标量 / 极值 / 构成 / 排行，缺汇率时按卡片类别如实说明。 */
function FxAgentAView({
  outcome,
  family,
  density,
  detail,
  currency,
}: {
  readonly outcome: FxAgentAOutcome;
  readonly family: ChartFamily;
  readonly density: Density;
  readonly detail: boolean;
  readonly currency: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const { result, policy, missingCount, nothingKnown } = outcome;
  if (nothingKnown) return <Note text={t("statsWorkbench.states.fxNothingKnown", { count: missingCount })} tone="warn" />;
  // 这段时间确实没有记录：说「没有记录」，不在综合折算下摆出一个看似结果的 0（与适配前的综合卡片一致）。
  if (result.completeness === "no-transactions") return <Note text={t("statsWorkbench.states.empty")} />;
  const fxText = fxNoteFor(policy, missingCount, t);
  const body = <AgentAView result={result} family={family} density={density} detail={detail} currency={currency} />;
  switch (result.shape) {
    case "scalar": {
      // 数据层不完整（本机覆盖不足）与缺汇率可以同时存在：两句都说。
      const base = result.completeness === "fx-incomplete" ? null : completenessNote(result, t);
      const note = [base, fxText].filter((part): part is string => part !== null).join(" ");
      return <ScalarView result={result} density={density} note={note === "" ? null : note} />;
    }
    case "record-extreme": {
      // 极值同样要说清「本机覆盖不全」与「缺汇率」两件事；原币模式的极值卡不变。
      const base = result.completeness === "fx-incomplete" ? null : completenessNote(result, t);
      const note = [base, fxText].filter((part): part is string => part !== null).join(" ");
      return <ExtremeView result={result} density={density} note={note === "" ? null : note} />;
    }
    default:
      return <ResultState metadata={result} partialText={result.completeness === "fx-incomplete" ? fxText : undefined}>{body}</ResultState>;
  }
}

/** 逐笔条数超限时的聚合路径（S16-D `FxAggregate`，与改造前一致）。 */
function CombinedAggregateBody({
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
