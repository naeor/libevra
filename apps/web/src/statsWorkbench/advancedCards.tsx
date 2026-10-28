/**
 * S17-B 第二批卡片内容（2026-10-28，1.17.8）。
 *
 * 这些分析在 `apps/web/src/lib/analysisData.ts` 里已经有正式派生结果，只是此前没有接到
 * 工作台与自定义卡片。这里**只做两件事**：
 * 1. 决定读哪段账目（沿用卡片自己的时间范围与 W5 筛选后的 entries）；
 * 2. 把已算好的结果格式化后交给现成图表组件。
 *
 * 金额、汇率、完整性一律来自 `packages/shared` 的同一份引擎，本文件不重算、不二次舍入。
 * 缺数据/样本不足用文字说明，绝不画成 0。
 */
import { analysisSpan, deriveAnomalyAnalysis, deriveCategoryAnalysis, deriveDailyExpenseVariability, deriveIncomeStability, deriveMovingAverage, deriveMultiMonthComparison, derivePeriodComparison, deriveSeasonalComparison, deriveWeekdayAnalysis } from "../lib/analysisData.js";
import type { AnalysisCoverage } from "../lib/analysisData.js";
import { AnomalyMarkerChart } from "../components/charts/AnomalyMarkerChart.js";
import { CategorySeriesChart } from "../components/charts/CategorySeriesChart.js";
import { MonthComparisonChart } from "../components/charts/MonthComparisonChart.js";
import { MovingAverageChart } from "../components/charts/MovingAverageChart.js";
import { SeasonalComparisonChart } from "../components/charts/SeasonalComparisonChart.js";
import { VolatilityBandChart } from "../components/charts/VolatilityBandChart.js";
import { WeekdayBars } from "../components/charts/WeekdayBars.js";
import { bucketLabel } from "../lib/chart/format.js";
import { formatAxisAmount } from "../lib/chart/format.js";
import { displayCategoryName } from "../lib/presetNames.js";
import { useI18n } from "../i18n/index.js";
import type { ChartFamily } from "./catalog.js";
import { entriesInCurrency, granularityFor } from "./compute.js";
import type { WorkbenchScope } from "./scope.js";
import { useCardSpace } from "./slotContext.js";
import { moneyText, ratioPercentText, type Density } from "./ui.js";
import type { DateRange, TimeBucket, TimeSpan } from "@libellum/shared";

/** 由本文件接线的 12 个分析编号（也是自定义卡片新增可选项）。 */
export const ADVANCED_CARD_IDS: ReadonlySet<string> = new Set([
  "AN-I13",
  "AN-I14",
  "AN-A02",
  "AN-A03",
  "AN-A04",
  "AN-A05",
  "AN-A12",
  "AN-A13",
  "AN-A14",
  "AN-A18",
  "AN-A19",
  "AN-A20",
]);

type Translator = ReturnType<typeof useI18n>["t"];

function titleFor(t: Translator, id: string): string {
  return t(`statsWorkbench.cards.${id as "AN-I13"}.title`);
}

function spanFor(range: DateRange): TimeSpan {
  return analysisSpan({ from: range.from, to: range.to });
}

function ChartNote({ text }: { readonly text: string }): React.JSX.Element {
  return <p role="status" className="text-helper text-muted">{text}</p>;
}

export interface AdvancedCardProps {
  readonly id: string;
  readonly family: ChartFamily;
  readonly scope: WorkbenchScope;
  readonly range: DateRange;
  readonly density: Density;
  readonly detail: boolean;
  /** 卡片内容区可用高度（px）；图表按它取高，不缩放。 */
  readonly available: number | undefined;
  /** 综合折算上下文：缺汇率时不能把「没有已折算账目」说成「没有记录」。 */
  readonly fx?: { readonly missingCount: number } | undefined;
}

export function AdvancedCardView({ id, family, scope, range, density, detail, available, fx }: AdvancedCardProps): React.JSX.Element {
  const { t } = useI18n();
  const space = useCardSpace();
  const currency = scope.currency;
  const title = titleFor(t, id);
  const span = spanFor(range);
  const coverage: AnalysisCoverage = "local-ledger";
  const entries = entriesInCurrency(scope.entries, currency);
  const today = scope.today;
  const axis = (value: number) => formatAxisAmount(value, currency);
  const amountText = (minor: string | null | undefined) => (minor === null || minor === undefined ? t("statsWorkbench.states.undetermined") : moneyText(minor, currency));
  const partial = scope.rangeSourceComplete === false ? t("statsWorkbench.states.partial") : null;
  const empty = t("statsWorkbench.states.empty");
  /**
   * 综合折算缺汇率时，折算结果里可能一笔可用金额都没有，但原始账目是有的：
   * 这时不能说「这段时间没有记录」（调用方最在意的静默错误），要说「没有可用的完整记录」。
   */
  const noDataText = scope.entries.length > 0 ? partial ?? t("statsWorkbench.advanced.unavailable") : empty;
  const fxMissing = fx?.missingCount ?? 0;
  /**
   * 综合折算缺汇率时，`scope.entries` 只含成功折算的账目：一笔都没有不代表「没有记录」，
   * 要明确说「没有任何已折算的账目，无法确定」。
   */
  if (scope.combined && entries.length === 0 && fxMissing > 0) {
    return <ChartNote text={t("statsWorkbench.states.fxNothingKnown", { count: fxMissing })} />;
  }
  /** 区间内一笔可展示的账目都没有：说清楚，不用一条 0 折线装作「金额为 0」。 */
  if (entries.length === 0) {
    return <ChartNote text={noDataText} />;
  }
  const insufficient = t("statsWorkbench.advanced.insufficientSample");
  // 窄于 300px 时多分类图例会折成两行（多约 22px），按实测扣掉，避免图例被卡片裁掉。
  const narrowLegend = !detail && (space?.width ?? 400) < 300 ? 22 : 0;
  const height = detail ? 240 : available !== undefined && available > 0 ? Math.max(72, Math.min(260, available - 30 - narrowLegend)) : density === "expanded" ? 170 : density === "medium" ? 130 : 96;

  switch (id) {
    case "AN-I13": {
      const view = deriveWeekdayAnalysis(entries, { kind: "expense", span, today, coverage });
      if (view.result.observedDayCount === 0) return <ChartNote text={noDataText} />;
      const labels = t("statsWorkbench.values.weekdays").split(",").map((label) => t("statsWorkbench.advanced.weekdayPrefix", { label }));
      return (
        <WeekdayBars
          pattern={view.result}
          mode="total"
          weekdayLabels={labels}
          title={title}
          formatAxis={axis}
          formatValue={(minor) => amountText(minor)}
          height={height}
          notice={partial}
          note={view.result.sufficientSample ? null : insufficient}
        />
      );
    }
    case "AN-I14": {
      const totals = new Map<string, bigint>();
      const names = new Map<string, string>();
      for (const entry of entries) {
        if (entry.kind !== "expense") continue;
        totals.set(entry.categoryId, (totals.get(entry.categoryId) ?? 0n) + BigInt(entry.amountCents));
        names.set(entry.categoryId, entry.categoryName);
      }
      const top = [...totals.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, 5).map(([categoryId]) => categoryId);
      if (top.length === 0) return <ChartNote text={scope.combined ? t("statsWorkbench.advanced.unavailable") : empty} />;
      const view = deriveCategoryAnalysis(entries, { kind: "expense", categoryIds: top, granularity: granularityFor(scope.bucket), span, today, coverage });
      return (
        <CategorySeriesChart
          series={view.result}
          title={title}
          categoryLabel={(categoryId) => displayCategoryName(names.get(categoryId) ?? categoryId)}
          formatAxis={axis}
          labelFor={(bucket: TimeBucket) => bucketLabel(bucket.key, bucket.granularity === "month" ? "month" : "day")}
          kind="lines"
          height={height}
          notice={partial}
          formatValue={(minor) => amountText(minor)}
        />
      );
    }
    case "AN-A04": {
      const months: string[] = [];
      const lastMonth = range.to.slice(0, 7);
      let cursor = startMonth(range.from);
      while (cursor <= lastMonth) {
        months.push(cursor);
        cursor = nextMonth(cursor);
      }
      if (months.length === 0) return <ChartNote text={empty} />;
      const view = deriveMultiMonthComparison(entries, { months, metric: "expense", today, coverage });
      return (
        <MonthComparisonChart
          result={view.result}
          title={title}
          valueText={(bar) => amountText(bar.valueMinor)}
          formatAxis={axis}
          height={height}
          notice={partial}
          emptyLabel={empty}
        />
      );
    }
    case "AN-A02":
    case "AN-A03":
    case "AN-A05": {
      const kind = id === "AN-A02" ? "month-over-month" : id === "AN-A03" ? "year-over-year" : "month-to-date";
      const view = derivePeriodComparison(entries, { kind, today, coverage, ...(kind === "month-to-date" ? {} : { current: span }) });
      return <ComparisonNumber result={view.result} density={density} currency={currency} />;
    }
    case "AN-A12": {
      const view = deriveDailyExpenseVariability(entries, { span, today, coverage });
      if (view.result === null) return <ChartNote text={view.unavailableReason === "no-complete-observations" ? noDataText : t("statsWorkbench.advanced.unavailable")} />;
      return (
        <VolatilityBandChart
          points={view.points}
          variability={view.result}
          title={title}
          labels={{ mean: t("statsWorkbench.advanced.mean"), band: t("statsWorkbench.advanced.band") }}
          formatValue={(point) => amountText(point.amountMinor ?? null)}
          formatAxis={axis}
          height={height}
          notice={partial}
        />
      );
    }
    case "AN-A13":
    case "AN-A14": {
      const windowDays = id === "AN-A13" ? 7 : 30;
      const view = deriveMovingAverage(entries, { span, today, windowDays, coverage });
      if (view.result.points.length === 0) return <ChartNote text={noDataText} />;
      return (
        <MovingAverageChart
          result={view.result}
          title={title}
          labels={{ raw: t("statsWorkbench.advanced.raw"), average: t("statsWorkbench.advanced.average") }}
          formatValue={(point) => amountText(point.averageScaledMinor === null ? null : scaledToMinor(point.averageScaledMinor, view.result.scale))}
          formatAxis={axis}
          height={height}
          notice={partial ?? (view.unavailableReason === "no-complete-observations" ? insufficient : null)}
        />
      );
    }
    case "AN-A18": {
      const view = deriveSeasonalComparison(entries, { span, today, coverage });
      const monthLabels = Array.from({ length: 12 }, (_, index) => t("statsWorkbench.advanced.monthLabel", { month: index + 1 }));
      const legend = view.result.years.map((year, index) => ({ label: String(year.year), colorIndex: index }));
      return (
        <SeasonalComparisonChart
          result={view.result}
          title={title}
          monthLabels={monthLabels}
          legend={legend}
          formatValue={(cell) => amountText(cell.amountMinor)}
          formatAxis={axis}
          height={height}
          notice={partial}
        />
      );
    }
    case "AN-A19": {
      const view = deriveAnomalyAnalysis(entries, { span, today, coverage });
      if (view.observedDays === 0) return <ChartNote text={noDataText} />;
      return (
        <AnomalyMarkerChart
          points={view.points}
          anomaly={view.result}
          title={title}
          label={t("statsWorkbench.advanced.anomalyLabel")}
          formatValue={(point) => amountText(point.amountMinor ?? null)}
          formatAxis={axis}
          height={height}
          notice={partial}
        />
      );
    }
    case "AN-A20": {
      const view = deriveIncomeStability(entries, { span, today, coverage });
      if (view.result === null) return <ChartNote text={noDataText} />;
      const result = view.result;
      const stateText = result.judgedState === "computed" ? t("statsWorkbench.advanced.stable") : insufficient;
      return (
        <div className="flex h-full flex-col justify-end gap-1">
          <p className="text-helper text-muted">{stateText}</p>
          <p className="text-helper text-muted">
            {t("statsWorkbench.advanced.sampleMonths", { count: result.positiveMonths + result.zeroMonths })}
            {result.zeroMonths > 0 ? ` · ${t("statsWorkbench.advanced.zeroMonths", { count: result.zeroMonths })}` : ""}
          </p>
        </div>
      );
    }
    default:
      return <ChartNote text={empty} />;
  }
}

/** A02/A03/A05：两行「本期 + 增长率」；没有可比数据时明确说明，不显示 ∞%。 */
function ComparisonNumber({ result, density, currency }: { readonly result: { readonly income: { readonly currentMinor: string | null; readonly growth: GrowthText }; readonly expense: { readonly currentMinor: string | null; readonly growth: GrowthText } }; readonly density: Density; readonly currency: string }): React.JSX.Element {
  const { t } = useI18n();
  const rows = [
    { label: t("statsWorkbench.advanced.expense"), side: result.expense },
    { label: t("statsWorkbench.advanced.income"), side: result.income },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col justify-end gap-1">
      {rows.map((row) => (
        <p key={row.label} className="flex items-baseline justify-between gap-2 text-helper text-muted">
          <span>{row.label}</span>
          <span className={density === "compact" ? "text-sm" : "text-base"}>
            {row.side.currentMinor === null ? t("statsWorkbench.states.undetermined") : moneyText(row.side.currentMinor, currency)}
            {growthText(row.side.growth, t)}
          </span>
        </p>
      ))}
    </div>
  );
}

type GrowthText = { readonly state: "computed"; readonly numeratorMinor: string; readonly denominatorMinor: string } | { readonly state: "unavailable"; readonly reason: string };

function growthText(growth: GrowthText, t: Translator): string {
  if (growth.state !== "computed") return ` · ${t("statsWorkbench.advanced.noComparison")}`;
  return ` · ${ratioPercentText({ numerator: BigInt(growth.numeratorMinor), denominator: BigInt(growth.denominatorMinor) })}`;
}

/** `averageScaledMinor` 是定点放大值；只有展示时才还原成 minor units。 */
function scaledToMinor(scaled: string, scale: number): string {
  const negative = scaled.startsWith("-");
  const digits = negative ? scaled.slice(1) : scaled;
  const padded = digits.padStart(scale + 1, "0");
  const integer = padded.slice(0, padded.length - scale);
  const fraction = padded.slice(padded.length - scale);
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}

/** 自然月键（`YYYY-MM`），与 `deriveMultiMonthComparison` 的 month 键一致。 */
function startMonth(date: string): string {
  return date.slice(0, 7);
}

function nextMonth(monthKey: string): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return month === 12 ? `${String(year + 1)}-01` : `${monthKey.slice(0, 5)}${String(month + 1).padStart(2, "0")}`;
}
