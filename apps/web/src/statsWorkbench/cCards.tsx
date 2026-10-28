/**
 * S17-C 深入与专业分析卡片（1.17.10）：把 `cAnalyses.ts` 的结果交给 `AdvancedCharts.tsx` 画。
 *
 * 与 A / B 卡片同一套规则：
 * - 读的是卡片作用域里的账目（W5 筛选之后；综合折算下是逐笔折算后的目标币种账目），不另读数据；
 * - 金额文本从 bigint 最小单位直接格式化（`moneyText`），有理数只在显示时取整；
 * - 没有数据、样本不足、两期不可比、缺汇率时**说明原因**，不画 0、不画貌似完整的图；
 * - 卡片空间小时少画行数并写明「另有 N 项」，详情页给全量。
 */
import { comparisonRangeFor, decimalsFor, type DateRange, type Transaction } from "@libellum/shared";

import {
  BarRows,
  BoxplotChart,
  BubbleChart,
  BumpChart,
  ColumnChart,
  DataTable,
  DivergingRows,
  HeatMatrix,
  ObservationDots,
  ParetoChart,
  ScatterChart,
  SlopeChart,
  SmallMultiplesGrid,
  StackedColumns,
  TreemapChart,
  WaterfallChart,
  YearCalendar,
  type BoxGroup,
} from "../components/charts/AdvancedCharts.js";
import { useI18n } from "../i18n/index.js";
import { formatLocalDate } from "../lib/datetime.js";
import { displayCategoryName } from "../lib/presetNames.js";
import {
  categoryBoxplots,
  categoryBubbles,
  categoryConcentration,
  categoryMatrix,
  categoryMonthPivot,
  categorySmallMultiples,
  categoryTotals,
  convertedByOriginalCurrency,
  currencyCounts,
  expenseDistribution,
  expenseScatter,
  fraction,
  fxCoverage,
  fxFallbackUsage,
  inRange,
  largestExpenses,
  monthlyBoxplots,
  monthlyRanks,
  noExpenseDays,
  paymentOverTime,
  periodChange,
  quartile,
  rateObservations,
  ratio,
  rationalText,
  roundRational,
  shareOfTop,
  toRecords,
  transactionConcentration,
  yearCalendar,
  type FxSourceEntry,
} from "./cAnalyses.js";
import type { ChartFamily } from "./catalog.js";
import { useSlotMode } from "./slotContext.js";
import { entriesInCurrency } from "./compute.js";
import type { FxProjection } from "./fxProjection.js";
import type { WorkbenchScope } from "./scope.js";
import { FitAmount, moneyText, ratioPercentText, type Density } from "./ui.js";

/** 由本文件接线的 S17-C 分析编号（P05、P07 需要分类层级模型、P21 需要维度参数，未登记）。 */
export const C_CARD_IDS: ReadonlySet<string> = new Set([
  "AN-I18", "AN-A06", "AN-A07", "AN-A08", "AN-A09", "AN-A10", "AN-A11", "AN-A15", "AN-A16", "AN-A17",
  "AN-P01", "AN-P02", "AN-P03", "AN-P04", "AN-P06", "AN-P08", "AN-P09", "AN-P10", "AN-P11", "AN-P12",
  "AN-P13", "AN-P14", "AN-P15", "AN-P16", "AN-P17", "AN-P18", "AN-P19", "AN-P20", "AN-P22", "AN-P23", "AN-P24",
]);

type Translate = ReturnType<typeof useI18n>["t"];

export interface CCardProps {
  readonly id: string;
  readonly family: ChartFamily;
  readonly scope: WorkbenchScope;
  readonly range: DateRange;
  readonly density: Density;
  readonly detail: boolean;
  readonly available: number | undefined;
  readonly availableWidth: number | undefined;
  /** 综合折算上下文（缺汇率笔数、上一周期的折算），原币模式为 `undefined`。 */
  readonly fx?: {
    readonly projection: FxProjection;
    readonly missingCount: number;
    readonly unknownDates: ReadonlySet<string> | undefined;
    readonly previous: { readonly status: string; readonly projection?: FxProjection } | null;
  } | undefined;
}

function Notice({ text, tone = "muted" }: { readonly text: string; readonly tone?: "muted" | "warn" }): React.JSX.Element {
  return <p role="status" title={text} className={`text-helper-relaxed ${tone === "warn" ? "text-warn-dark" : "text-muted"}`}>{text}</p>;
}

/**
 * 卡片上方的说明：`notes` 是降级提示（缺汇率、本机覆盖不完整，警示色），`info` 是口径说明（比较的两段日期、
 * 只数笔数等，常规灰色）。组合卡片的小格里各收成一行。
 */
function Shell({ notes, info = [], children }: { readonly notes: readonly (string | null)[]; readonly info?: readonly (string | null)[]; readonly children: React.ReactNode }): React.JSX.Element {
  const mode = useSlotMode();
  const shown = notes.filter((note): note is string => note !== null && note !== "");
  const facts = info.filter((note): note is string => note !== null && note !== "");
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      {shown.map((note) => (
        <p key={note} role="status" title={note} className={`text-helper text-warn-dark ${mode === null ? "" : "truncate"}`}>{note}</p>
      ))}
      {facts.length === 0 ? null : <p title={facts.join(" · ")} className={`text-helper text-muted ${mode === null ? "" : "truncate"}`}>{facts.join(" · ")}</p>}
      <div className="sw-interactive min-h-0 flex-1" onClick={(event) => event.stopPropagation()}>{children}</div>
    </div>
  );
}

/** 数字形态（A08 / A10 / A11 / A15 / A16）：与 A 的数值卡同样的大号金额与说明，组合卡片里收成单元格。 */
function CNumber({ text, note, density, warn = false }: { readonly text: string; readonly note: string | null; readonly density: Density; readonly warn?: boolean }): React.JSX.Element {
  const mode = useSlotMode();
  if (mode === "inline" || mode === "stacked") {
    return (
      <span className="flex min-w-0 items-center justify-end gap-1">
        {mode === "stacked" ? <span className="min-w-0 flex-1"><FitAmount text={text} start={1} className="text-ink" /></span> : <span title={text} className="sw-amount min-w-0 truncate text-base font-semibold tabular-nums text-ink">{text}</span>}
        {note === null ? null : <span role="img" aria-label={note} title={note} className={`sw-stat-mark ${warn ? "sw-stat-mark-warn" : ""}`}>{warn ? "!" : "i"}</span>}
      </span>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col justify-end gap-1">
      <FitAmount text={text} start={density === "compact" ? 1 : 0} className="text-ink" />
      {note === null ? null : <p className={`text-helper ${warn ? "text-warn-dark" : "text-muted"}`}>{note}</p>}
    </div>
  );
}

export function CCardView({ id, family, scope, range, density, detail, available, availableWidth, fx }: CCardProps): React.JSX.Element {
  const { t } = useI18n();
  const currency = scope.currency;
  const money = (minor: bigint) => moneyText(minor.toString(), currency);
  const percent = (value: { readonly numerator: bigint; readonly denominator: bigint } | null) => (value === null || value.denominator === 0n ? t("statsWorkbench.states.undetermined") : ratioPercentText(value));
  const more = (count: number) => t("statsWorkbench.values.more", { count });
  const height = detail ? 240 : available !== undefined && available > 0 ? Math.max(64, Math.min(320, available - 24)) : density === "expanded" ? 170 : density === "medium" ? 130 : 96;
  const rowsFit = (rowHeight: number) => (detail ? 500 : Math.max(2, Math.floor(((available ?? 140) - 24) / rowHeight)));
  const title = t(`statsWorkbench.cards.${id as "AN-I18"}.title`);
  const unspecified = t("statsWorkbench.cAnalysis.unspecifiedPayment");
  const sourceEntries = scope.entries;
  const records = toRecords(entriesInCurrency(sourceEntries, currency), (entry) => displayCategoryName(entry.categoryName), (entry) => entry.paymentMethodName ?? unspecified).filter((record) => record.occurredLocalDate >= range.from && record.occurredLocalDate <= range.to);
  const partial = scope.rangeSourceComplete === false ? t("statsWorkbench.states.partial") : null;
  const missing = fx?.missingCount ?? 0;
  const fxNote = (key: "fxSubtotal" | "fxUndetermined" | "fxComposition" | "fxRanking" | "fxExtreme" | "fxSubset" | "fxSeries") => (missing > 0 ? t(`statsWorkbench.states.${key}`, { count: missing }) : null);
  const empty = t("statsWorkbench.states.empty");
  // C 的金额分析都只看支出：区间里只有收入时同样是「没有记录」，不能说成缺汇率。
  const hasExpense = records.some((record) => record.kind === "expense");
  const noRecords = !hasExpense && !(scope.combined && missing > 0);
  const monthLabel = (key: string) => formatLocalDate(`${key}-01`, sameYear(range) ? { month: "short" } : { year: "2-digit", month: "short" });

  // 只在综合折算下有意义的汇率诊断：原币模式说明并给出入口，而不是画空图。
  if ((id === "AN-P17" || id === "AN-P18" || id === "AN-P19" || id === "AN-P20") && !scope.combined) {
    return <Notice text={t("statsWorkbench.cAnalysis.combinedOnly")} />;
  }

  switch (id) {
    // ---------------- 排行与集中度 ----------------
    case "AN-I18": {
      const result = largestExpenses(records, detail ? 50 : 20);
      if (result === null) return <Notice text={noRecords ? empty : t("statsWorkbench.states.fxNothingKnown", { count: missing })} />;
      const notes = [partial, fxNote("fxExtreme")];
      if (family === "ranking") {
        const max = result.items[0]?.amountMinor ?? 0n;
        return (
          <Shell notes={notes}>
            {/* 缺汇率时分母只是已折算部分，不显示占比。 */}
            <BarRows title={title} limit={rowsFit(30)} moreText={more} rows={result.items.map((item) => ({ id: item.id, label: `${formatLocalDate(item.occurredLocalDate)} · ${item.categoryLabel}`, valueText: money(item.amountMinor), fraction: ratio(item.amountMinor, max), secondary: item.share === null || missing > 0 ? null : percent(item.share) }))} />
          </Shell>
        );
      }
      return (
        <Shell notes={notes}>
          <DataTable
            title={title}
            limit={rowsFit(22) - 1}
            moreText={more}
            columns={[{ label: "#" }, { label: t("statsWorkbench.cAnalysis.date") }, { label: t("statsWorkbench.cAnalysis.category") }, ...(availableWidth !== undefined && availableWidth < 300 && !detail ? [] : [{ label: t("statsWorkbench.cAnalysis.payment") }]), { label: t("statsWorkbench.cAnalysis.amount"), align: "right" as const }]}
            rows={result.items.map((item) => ({ key: item.id, cells: [String(item.rank), formatLocalDate(item.occurredLocalDate), item.categoryLabel, ...(availableWidth !== undefined && availableWidth < 300 && !detail ? [] : [item.paymentMethodLabel ?? unspecified]), money(item.amountMinor)] }))}
          />
        </Shell>
      );
    }
    case "AN-A08":
    case "AN-P08": {
      if (missing > 0) return <Notice text={t("statsWorkbench.states.fxUndetermined", { count: missing })} tone="warn" />;
      const result = categoryConcentration(records);
      if (result === null) return <Notice text={empty} />;
      if (family === "number") {
        const top3 = shareOfTop(result, 3);
        const top1 = shareOfTop(result, 1);
        // 大号数字只放占比本身（组合卡片的小格也放得下），口径写在说明里。
        return <CNumber density={density} text={top3 === null ? t("statsWorkbench.states.undetermined") : percent(top3.share)} note={[partial, t("statsWorkbench.cAnalysis.topCategories", { count: Math.min(3, result.rows.length) }), top1 === null ? null : t("statsWorkbench.cAnalysis.topOne", { name: result.rows[0]?.label ?? "", share: percent(top1.share) })].filter((part): part is string => part !== null).join(" · ")} warn={partial !== null} />;
      }
      if (family === "table") {
        return (
          <Shell notes={[partial]}>
            <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.category") }, { label: t("statsWorkbench.cAnalysis.amount"), align: "right" }, { label: t("statsWorkbench.cAnalysis.cumulativeShare"), align: "right" }]} rows={result.rows.map((row) => ({ key: row.id, cells: [row.label, money(row.amountMinor), percent(row.cumulativeShare)] }))} />
          </Shell>
        );
      }
      const max = result.rows[0]?.amountMinor ?? 0n;
      return (
        <Shell notes={[partial]}>
          <ParetoChart title={title} height={height - (partial === null ? 0 : 18)} rows={result.rows.slice(0, detail ? 30 : 12).map((row) => ({ id: row.id, label: row.label, valueText: money(row.amountMinor), cumulativeText: percent(row.cumulativeShare), fraction: ratio(row.amountMinor, max), cumulative: fraction(row.cumulativeShare) }))} />
        </Shell>
      );
    }
    case "AN-A16": {
      if (missing > 0) return <Notice text={t("statsWorkbench.states.fxUndetermined", { count: missing })} tone="warn" />;
      const result = transactionConcentration(records);
      if (result === null) return <Notice text={empty} />;
      const top5 = shareOfTop(result, 5);
      if (family === "number") {
        return <CNumber density={density} text={top5 === null ? t("statsWorkbench.states.undetermined") : percent(top5.share)} note={[partial, t("statsWorkbench.cAnalysis.topTransactions", { count: Math.min(5, result.rows.length) }), top5 === null ? null : t("statsWorkbench.cAnalysis.coveredOfTotal", { covered: money(top5.coveredMinor), total: money(result.totalMinor) })].filter((part): part is string => part !== null).join(" · ")} warn={partial !== null} />;
      }
      if (family === "record-table") {
        return (
          <Shell notes={[partial]}>
            <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: "#" }, { label: t("statsWorkbench.cAnalysis.transaction") }, { label: t("statsWorkbench.cAnalysis.amount"), align: "right" }, { label: t("statsWorkbench.cAnalysis.cumulativeShare"), align: "right" }]} rows={result.rows.map((row, index) => ({ key: row.id, cells: [String(index + 1), row.label, money(row.amountMinor), percent(row.cumulativeShare)] }))} />
          </Shell>
        );
      }
      const max = result.rows[0]?.amountMinor ?? 0n;
      return (
        <Shell notes={[partial]}>
          <ParetoChart title={title} height={height - (partial === null ? 0 : 18)} rows={result.rows.slice(0, detail ? 40 : 15).map((row, index) => ({ id: row.id, label: `#${String(index + 1)}`, valueText: `${row.label} · ${money(row.amountMinor)}`, cumulativeText: percent(row.cumulativeShare), fraction: ratio(row.amountMinor, max), cumulative: fraction(row.cumulativeShare) }))} />
        </Shell>
      );
    }

    // ---------------- 分布 ----------------
    case "AN-A09":
    case "AN-A10":
    case "AN-A11": {
      const undetermined = id !== "AN-A09" && missing > 0;
      if (undetermined) return <Notice text={t("statsWorkbench.states.fxUndetermined", { count: missing })} tone="warn" />;
      const result = expenseDistribution(records);
      if (result === null) return <Notice text={noRecords ? empty : t("statsWorkbench.states.fxNothingKnown", { count: missing })} />;
      const { summary, histogram } = result;
      const notes = [partial, id === "AN-A09" ? fxNote("fxSubset") : null];
      if (family === "histogram") {
        const maxCount = histogram.bins.reduce((max, bin) => Math.max(max, bin.count), 0);
        return (
          <Shell notes={notes}>
            <ColumnChart title={title} height={height - 18 * notes.filter((note) => note !== null).length - 16} bars={histogram.bins.map((bin) => ({ id: String(bin.index), label: compactMoney(bin.lowerMinor, currency), valueText: `${money(bin.lowerMinor)} – ${money(bin.upperMinor)} · ${t("statsWorkbench.values.count", { count: bin.count })}`, fraction: maxCount === 0 ? 0 : bin.count / maxCount }))} />
            <p className="truncate text-helper text-muted">{t("statsWorkbench.cAnalysis.histogramSummary", { count: histogram.sampleCount, width: money(histogram.binWidthMinor) })}</p>
          </Shell>
        );
      }
      const median = summary.median;
      const q1 = quartile(summary, 1n, 4n);
      const q3 = quartile(summary, 3n, 4n);
      if (id === "AN-A11") {
        const cv = summary.coefficientOfVariation;
        const sd = summary.standardDeviation;
        const sdText = sd === null ? null : money(roundRational({ numerator: sd.scaled, denominator: 10n ** BigInt(sd.decimals) }));
        return <CNumber density={density} text={cv === null ? t("statsWorkbench.states.undetermined") : percent(cv)} note={[partial, t("statsWorkbench.cAnalysis.cv"), sdText === null ? null : t("statsWorkbench.cAnalysis.sd", { value: sdText }), summary.mean === null ? null : t("statsWorkbench.cAnalysis.mean", { value: money(roundRational(summary.mean)) })].filter((part): part is string => part !== null).join(" · ") || null} warn={partial !== null} />;
      }
      if (family === "number") {
        return <CNumber density={density} text={median === null ? t("statsWorkbench.states.undetermined") : money(roundRational(median))} note={[partial, q1 === null || q3 === null ? null : t("statsWorkbench.cAnalysis.quartiles", { q1: money(roundRational(q1)), q3: money(roundRational(q3)) })].filter((part): part is string => part !== null).join(" · ") || null} warn={partial !== null} />;
      }
      if (median === null || q1 === null || q3 === null || summary.minMinor === null || summary.maxMinor === null) return <Notice text={t("statsWorkbench.advanced.insufficientSample")} />;
      // 数轴取须线（1.5 × IQR 以内的最小 / 最大单笔）：一笔房租这样的离群值不会把箱体压成一条线；
      // 离群值画在两端并在文字里写明个数与最大值。
      // shared 的有理数分母恒为正（`rational.ts` 归一化），可以直接交叉相乘比较。
      const insideFences = (value: bigint) =>
        value * result.upperFence.denominator <= result.upperFence.numerator &&
        value * result.lowerFence.denominator >= result.lowerFence.numerator;
      const inside = records.filter((record) => record.kind === "expense" && insideFences(record.amountMinor)).map((record) => record.amountMinor);
      const low = inside.reduce((value, item) => (item < value ? item : value), inside[0] ?? summary.minMinor);
      const high = inside.reduce((value, item) => (item > value ? item : value), inside[0] ?? summary.maxMinor);
      const span = high - low;
      const at = (value: bigint) => (span === 0n ? 0.5 : ratio(value - low, span));
      const atRational = (value: { readonly numerator: bigint; readonly denominator: bigint }) => (span === 0n ? 0.5 : fraction({ numerator: value.numerator - low * value.denominator, denominator: value.denominator * span }));
      const group: BoxGroup = {
        id: "all",
        label: t("statsWorkbench.cAnalysis.allExpenses"),
        summaryText: t("statsWorkbench.cAnalysis.boxSummary", { count: summary.sampleCount, q1: money(roundRational(q1)), median: money(roundRational(median)), q3: money(roundRational(q3)) }),
        reliable: summary.sampleCount >= 5,
        min: 0,
        q1: atRational(q1),
        median: atRational(median),
        q3: atRational(q3),
        max: 1,
        outliers: result.outliers.map(at),
      };
      const outlierText = result.outliers.length === 0 ? null : t("statsWorkbench.cAnalysis.outliersBeyond", { count: result.outliers.length, max: money(summary.maxMinor) });
      const boxHeight = Math.max(28, (detail ? 140 : available ?? 100) - 20 - (partial === null ? 0 : 18) - (outlierText === null ? 0 : 16));
      return (
        <Shell notes={[partial]} info={[outlierText]}>
          <BoxplotChart title={title} height={boxHeight} groups={[group]} axisText={`${money(low)} – ${money(high)} · ${group.summaryText}`} unreliableText={t("statsWorkbench.cAnalysis.unreliable", { count: 5 })} />
        </Shell>
      );
    }
    case "AN-A15": {
      // 与「无支出的天数」同一口径：只看当前币种（综合折算下是全部账目，金额与此无关）。
      const all = toRecords(entriesInCurrency(sourceEntries, currency), () => "", () => null).filter((record) => record.occurredLocalDate >= range.from && record.occurredLocalDate <= range.to);
      const coverageKnown = scope.rangeSourceComplete !== false;
      const result = noExpenseDays(all, range, scope.today, coverageKnown, fx?.unknownDates);
      const unknownNote = result.unknownDays > 0 ? t("statsWorkbench.cAnalysis.unknownDays", { count: result.unknownDays }) : null;
      if (family === "table") {
        if (result.streaks.length === 0) return <Notice text={t("statsWorkbench.cAnalysis.noStreak")} />;
        return (
          <Shell notes={[unknownNote]}>
            <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.from") }, { label: t("statsWorkbench.cAnalysis.to") }, { label: t("statsWorkbench.cAnalysis.days"), align: "right" }]} rows={result.streaks.map((streak) => ({ key: streak.from, cells: [formatLocalDate(streak.from), formatLocalDate(streak.to), t("statsWorkbench.values.days", { count: streak.days })] }))} />
          </Shell>
        );
      }
      const longest = result.longest;
      // 没有一段能确认的无支出日、但有覆盖未确认的日子：结果未知，不是 0 天。
      return <CNumber density={density} text={longest === null ? (result.unknownDays > 0 ? t("statsWorkbench.states.undetermined") : t("statsWorkbench.values.days", { count: 0 })) : t("statsWorkbench.values.days", { count: longest.days })} note={[longest === null ? t("statsWorkbench.cAnalysis.noStreak") : t("statsWorkbench.cAnalysis.streakRange", { from: formatLocalDate(longest.from), to: formatLocalDate(longest.to) }), result.current === null ? null : t("statsWorkbench.cAnalysis.currentStreak", { count: result.current.days }), unknownNote].filter((part): part is string => part !== null).join(" · ")} warn={unknownNote !== null} />;
    }
    case "AN-P10": {
      const result = expenseScatter(records);
      if (result === null) return <Notice text={noRecords ? empty : t("statsWorkbench.states.fxNothingKnown", { count: missing })} />;
      const days = Math.max(1, dayIndex(range.to, range.from));
      const max = result.points.reduce((value, point) => (point.amountMinor > value ? point.amountMinor : value), 0n);
      const notes = [partial, fxNote("fxSubset")];
      const omitted = result.omittedCount > 0 ? t("statsWorkbench.cAnalysis.scatterOmitted", { total: result.sampleCount, shown: result.plottedCount }) : null;
      return (
        <Shell notes={notes} info={[omitted]}>
          <ScatterChart title={title} height={height - 18 * [...notes, omitted].filter((note) => note !== null).length} maxText={money(max)} points={result.points.map((point) => ({ id: point.id, x: dayIndex(point.occurredLocalDate, range.from) / days, y: ratio(point.amountMinor, max), text: `${formatLocalDate(point.occurredLocalDate)} · ${money(point.amountMinor)}` }))} xLabels={[{ at: 0, label: formatLocalDate(range.from, { month: "numeric", day: "numeric" }) }, { at: 1, label: formatLocalDate(range.to, { month: "numeric", day: "numeric" }) }]} />
        </Shell>
      );
    }
    case "AN-P11": {
      const result = categoryBubbles(records);
      if (result === null) return <Notice text={noRecords ? empty : t("statsWorkbench.states.fxNothingKnown", { count: missing })} />;
      const notes = [partial, fxNote("fxComposition")];
      // 缺汇率时笔数与笔均都只是已折算部分（笔均「无法确定」）：只给分类小计排行，与构成类降级一致。
      if (missing > 0) {
        const maxSum = result.bubbles.reduce((max, bubble) => (bubble.sumMinor > max ? bubble.sumMinor : max), 0n);
        return (
          <Shell notes={notes}>
            <BarRows title={title} limit={rowsFit(30)} moreText={more} rows={result.bubbles.map((bubble) => ({ id: bubble.categoryId, label: bubble.categoryLabel, valueText: money(bubble.sumMinor), fraction: ratio(bubble.sumMinor, maxSum) }))} />
          </Shell>
        );
      }
      if (family === "table") {
        return (
          <Shell notes={notes}>
            <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.category") }, { label: t("statsWorkbench.cAnalysis.amount"), align: "right" }, { label: t("statsWorkbench.cAnalysis.count"), align: "right" }, { label: t("statsWorkbench.cAnalysis.average"), align: "right" }]} rows={result.bubbles.map((bubble) => ({ key: bubble.categoryId, cells: [bubble.categoryLabel, money(bubble.sumMinor), String(bubble.count), bubble.meanMinor === null ? "—" : money(roundRational(bubble.meanMinor))] }))} />
          </Shell>
        );
      }
      const maxCount = result.bubbles.reduce((max, bubble) => Math.max(max, bubble.count), 0);
      const maxMean = result.bubbles.reduce((max, bubble) => Math.max(max, bubble.meanMinor === null ? 0 : fraction(bubble.meanMinor)), 0);
      const maxSum = result.bubbles.reduce((max, bubble) => (bubble.sumMinor > max ? bubble.sumMinor : max), 0n);
      return (
        <Shell notes={notes}>
          <BubbleChart title={title} height={height - 34} xText={t("statsWorkbench.cAnalysis.count")} yText={t("statsWorkbench.cAnalysis.average")} bubbles={result.bubbles.slice(0, 16).map((bubble) => ({ id: bubble.categoryId, label: bubble.categoryLabel, x: maxCount === 0 ? 0 : bubble.count / maxCount, y: bubble.meanMinor === null || maxMean === 0 ? 0 : fraction(bubble.meanMinor) / maxMean, r: Math.sqrt(ratio(bubble.sumMinor, maxSum)), text: `${bubble.categoryLabel} · ${money(bubble.sumMinor)} · ${t("statsWorkbench.values.count", { count: bubble.count })}${bubble.meanMinor === null ? "" : ` · ${t("statsWorkbench.cAnalysis.average")} ${money(roundRational(bubble.meanMinor))}`}` }))} />
        </Shell>
      );
    }
    case "AN-P12":
    case "AN-P23": {
      if (missing > 0) return <Notice text={t("statsWorkbench.states.fxUndetermined", { count: missing })} tone="warn" />;
      const result = id === "AN-P12" ? categoryBoxplots(records) : monthlyBoxplots(records, monthLabel);
      if (result === null || result.groups.length === 0) return <Notice text={empty} />;
      // 放不下全部分组时：分类箱线保留样本最多的前几组（shared 已排序），月度箱线保留**最近**的几个月；
      // 省略的组数写在说明里，详情页显示全部。
      const fitGroups = detail ? 24 : Math.max(1, Math.floor(((available ?? 160) - 48) / 26));
      const groups = id === "AN-P23" ? result.groups.slice(-fitGroups) : result.groups.slice(0, fitGroups);
      const hiddenGroups = result.groups.length - groups.length;
      if (family === "table") {
        return (
          <Shell notes={[partial]}>
            <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: id === "AN-P12" ? t("statsWorkbench.cAnalysis.category") : t("statsWorkbench.cAnalysis.month") }, { label: t("statsWorkbench.cAnalysis.count"), align: "right" }, { label: "Q1", align: "right" }, { label: t("statsWorkbench.cAnalysis.median"), align: "right" }, { label: "Q3", align: "right" }]} rows={result.groups.map((group) => ({ key: group.categoryId, cells: [group.categoryLabel, String(group.sampleCount), money(roundRational(group.q1)), money(roundRational(group.median)), money(roundRational(group.q3))] }))} />
          </Shell>
        );
      }
      let min = groups[0]!.minMinor;
      let max = groups[0]!.maxMinor;
      for (const group of groups) {
        if (group.minMinor < min) min = group.minMinor;
        if (group.maxMinor > max) max = group.maxMinor;
      }
      const span = max - min;
      const at = (value: { readonly numerator: bigint; readonly denominator: bigint }) => (span === 0n ? 0.5 : fraction({ numerator: value.numerator - min * value.denominator, denominator: value.denominator * span }));
      const atMinor = (value: bigint) => (span === 0n ? 0.5 : ratio(value - min, span));
      return (
        <Shell notes={[partial]} info={[hiddenGroups > 0 ? more(hiddenGroups) : null]}>
          <BoxplotChart
            title={title}
            height={Math.max(60, height - 36 - (hiddenGroups > 0 ? 18 : 0))}
            axisText={t("statsWorkbench.cAnalysis.boxAxis", { min: money(min), max: money(max) })}
            unreliableText={t("statsWorkbench.cAnalysis.unreliable", { count: result.minReliableSample })}
            groups={groups.map((group) => ({
              id: group.categoryId,
              label: group.categoryLabel,
              summaryText: t("statsWorkbench.cAnalysis.boxSummary", { count: group.sampleCount, q1: money(roundRational(group.q1)), median: money(roundRational(group.median)), q3: money(roundRational(group.q3)) }),
              reliable: group.reliable,
              min: atMinor(group.minMinor),
              q1: at(group.q1),
              median: at(group.median),
              q3: at(group.q3),
              max: atMinor(group.maxMinor),
              outliers: group.outlierMinors.map(atMinor),
            }))}
          />
        </Shell>
      );
    }

    // ---------------- 矩阵、堆叠、透视 ----------------
    case "AN-P01":
    case "AN-P02":
    case "AN-P03": {
      const column = id === "AN-P01" ? "month" : id === "AN-P02" ? "weekday" : "payment";
      const result = categoryMatrix(records, column, range, unspecified);
      if (result === null) return <Notice text={noRecords ? empty : t("statsWorkbench.states.fxNothingKnown", { count: missing })} />;
      const notes = [partial, fxNote("fxComposition")];
      const weekdays = t("statsWorkbench.values.weekdays").split(",");
      const colLabel = (colId: string) => (column === "month" ? monthLabel(colId) : column === "weekday" ? weekdays[Number(colId) - 1] ?? colId : result.columnLabels.get(colId) ?? colId);
      const cells = new Map(result.matrix.cells.map((cell) => [`${cell.rowId}\u0001${cell.colId}`, cell] as const));
      const maxCell = result.matrix.cells.reduce((max, cell) => (cell.amountMinor > max ? cell.amountMinor : max), 0n);
      if (family === "stacked-bars") {
        const maxTotal = [...result.matrix.colTotals.values()].reduce((max, value) => (value > max ? value : max), 0n);
        const rows = result.matrix.rowIds.slice(0, 6);
        return (
          <Shell notes={notes}>
            <StackedColumns title={title} height={height - 40} series={rows.map((rowId) => ({ id: rowId, label: result.rowLabels.get(rowId) ?? rowId }))} columns={result.matrix.colIds.map((colId) => ({ id: colId, label: colLabel(colId), totalText: money(result.matrix.colTotals.get(colId) ?? 0n), parts: rows.map((rowId) => { const cell = cells.get(`${rowId}\u0001${colId}`); return { seriesId: rowId, fraction: cell === undefined ? 0 : ratio(cell.amountMinor, maxTotal), text: cell === undefined ? "—" : money(cell.amountMinor) }; }) }))} />
          </Shell>
        );
      }
      return (
        <Shell notes={notes}>
          <HeatMatrix
            title={title}
            maxRows={rowsFit(20) - 1}
            moreText={more}
            emptyTitle={t("statsWorkbench.cAnalysis.emptyCell")}
            rows={result.matrix.rowIds.map((rowId) => ({ id: rowId, label: result.rowLabels.get(rowId) ?? rowId, totalText: money(result.matrix.rowTotals.get(rowId) ?? 0n) }))}
            cols={result.matrix.colIds.map((colId) => ({ id: colId, label: colLabel(colId) }))}
            cell={(rowId, colId) => {
              const cell = cells.get(`${rowId}\u0001${colId}`);
              return cell === undefined ? null : { text: compactMoney(cell.amountMinor, currency), intensity: ratio(cell.amountMinor, maxCell), title: `${result.rowLabels.get(rowId) ?? rowId} · ${colLabel(colId)} · ${money(cell.amountMinor)} · ${t("statsWorkbench.values.count", { count: cell.count })}` };
            }}
          />
        </Shell>
      );
    }
    case "AN-P04": {
      const result = paymentOverTime(records, range, unspecified);
      if (result === null) return <Notice text={noRecords ? empty : t("statsWorkbench.states.fxNothingKnown", { count: missing })} />;
      const notes = [partial, fxNote("fxComposition")];
      const cells = new Map(result.matrix.cells.map((cell) => [`${cell.rowId}\u0001${cell.colId}`, cell] as const));
      const label = (rowId: string) => (result.bucket === "month" ? monthLabel(rowId) : rowId.slice(5));
      if (family === "table") {
        return (
          <Shell notes={notes}>
            <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: result.bucket === "month" ? t("statsWorkbench.cAnalysis.month") : t("statsWorkbench.cAnalysis.week") }, ...result.matrix.colIds.slice(0, 4).map((colId) => ({ label: result.seriesLabels.get(colId) ?? colId, align: "right" as const }))]} rows={result.matrix.rowIds.map((rowId) => ({ key: rowId, cells: [label(rowId), ...result.matrix.colIds.slice(0, 4).map((colId) => { const cell = cells.get(`${rowId}\u0001${colId}`); return cell === undefined ? "—" : money(cell.amountMinor); })] }))} />
          </Shell>
        );
      }
      const maxTotal = [...result.matrix.rowTotals.values()].reduce((max, value) => (value > max ? value : max), 0n);
      return (
        <Shell notes={notes}>
          <StackedColumns title={title} height={height - 40} series={result.matrix.colIds.map((colId) => ({ id: colId, label: result.seriesLabels.get(colId) ?? colId }))} columns={result.matrix.rowIds.map((rowId) => ({ id: rowId, label: label(rowId), totalText: money(result.matrix.rowTotals.get(rowId) ?? 0n), parts: result.matrix.colIds.map((colId) => { const cell = cells.get(`${rowId}\u0001${colId}`); return { seriesId: colId, fraction: cell === undefined ? 0 : ratio(cell.amountMinor, maxTotal), text: cell === undefined ? "—" : money(cell.amountMinor) }; }) }))} />
        </Shell>
      );
    }
    case "AN-P13": {
      const result = categoryMonthPivot(records);
      if (result === null) return <Notice text={noRecords ? empty : t("statsWorkbench.states.fxNothingKnown", { count: missing })} />;
      const notes = [partial, fxNote("fxComposition"), result.conservation.amountsMatch && result.conservation.countsMatch ? null : t("statsWorkbench.cAnalysis.notConserved")];
      const cells = new Map(result.cells.map((cell) => [`${cell.rowId}\u0001${cell.colId}`, cell] as const));
      const cols = result.colIds.slice(-(detail ? 24 : Math.max(1, Math.floor(((availableWidth ?? 320) - 90) / 74))));
      return (
        <Shell notes={notes}>
          <DataTable
            title={title}
            limit={rowsFit(22) - 2}
            moreText={more}
            columns={[{ label: t("statsWorkbench.cAnalysis.category") }, ...cols.map((colId) => ({ label: monthLabel(colId), align: "right" as const })), { label: t("statsWorkbench.cAnalysis.total"), align: "right" }]}
            rows={result.rowIds.map((rowId) => ({ key: rowId, cells: [result.rowLabels.get(rowId) ?? rowId, ...cols.map((colId) => { const cell = cells.get(`${rowId}\u0001${colId}`); return cell === undefined ? "—" : money(cell.amountMinor); }), money(result.rowTotals.get(rowId)?.amountMinor ?? 0n)] }))}
            footer={[t("statsWorkbench.cAnalysis.total"), ...cols.map((colId) => money(result.colTotals.get(colId)?.amountMinor ?? 0n)), money(result.grandTotal.amountMinor)]}
          />
        </Shell>
      );
    }
    case "AN-P14": {
      const result = categorySmallMultiples(records, range, detail ? 12 : 6);
      if (result === null) return <Notice text={noRecords ? empty : t("statsWorkbench.states.fxNothingKnown", { count: missing })} />;
      const notes = [partial, fxNote("fxSeries")];
      // 含缺汇率账目的月份是「未知」：折线在那里断开，分类合计不给（与时间序列卡片同一口径）。
      const unknownMonths = new Set([...(fx?.unknownDates ?? [])].map((date) => date.slice(0, 7)));
      const columns = (availableWidth ?? 320) >= 420 || detail ? 3 : 2;
      const rows = Math.ceil(result.panels.length / columns);
      const panelHeight = Math.max(24, Math.min(60, Math.floor(((available ?? 200) - 40) / Math.max(1, rows)) - 22));
      return (
        <Shell notes={notes} info={[t("statsWorkbench.cAnalysis.sharedScale", { max: money(result.sharedMaxMinor) })]}>
          <SmallMultiplesGrid title={title} columns={columns} panelHeight={panelHeight} panels={result.panels.map((panel) => ({ id: panel.categoryId, label: panel.categoryLabel, totalText: unknownMonths.size > 0 ? "—" : money(panel.totalMinor), points: panel.points.map((point) => (unknownMonths.has(point.bucketKey) ? null : ratio(point.valueMinor, result.sharedMaxMinor))) }))} />
        </Shell>
      );
    }
    case "AN-P15": {
      const year = Number(range.to.slice(0, 4));
      const result = yearCalendar(records, year, scope.today, scope.rangeSourceComplete !== false);
      const notes = [fxNote("fxSeries"), result.unknownDayCount > 0 ? t("statsWorkbench.cAnalysis.unknownDays", { count: result.unknownDayCount }) : null];
      const max = result.intensityMaxMinor ?? 0n;
      const unknown = fx?.unknownDates;
      return (
        <Shell notes={notes}>
          <YearCalendar
            title={title}
            height={detail ? 180 : Math.max(48, Math.min(180, (available ?? 140) - 22 - 18 * notes.filter((note) => note !== null).length))}
            weekCount={result.weekCount}
            monthLabels={result.monthStartWeekIndex.map((weekIndex, month) => ({ weekIndex, label: formatLocalDate(`${String(year)}-${String(month + 1).padStart(2, "0")}-01`, { month: "short" }) }))}
            days={result.days.map((day) => {
              const state = unknown?.has(day.date) === true && day.state !== "future" ? "unknown" : day.state;
              return {
                date: day.date,
                weekIndex: day.weekIndex,
                weekday: day.weekday,
                state,
                intensity: ratio(day.valueMinor, max),
                text: `${formatLocalDate(day.date)} · ${state === "complete" || state === "in-progress" ? money(day.valueMinor) : t(`statsWorkbench.cAnalysis.dayState.${state === "no-data" ? "none" : state}`)}`,
              };
            })}
          />
          {/* 有未知日（覆盖未确认或缺汇率）时合计只是已知部分，明确写出不是全年合计。 */}
          <p className="truncate text-helper text-muted">{t(result.unknownDayCount > 0 || missing > 0 ? "statsWorkbench.cAnalysis.yearTotalKnown" : "statsWorkbench.cAnalysis.yearTotal", { year, total: money(result.totalMinor), count: result.totalCount })}</p>
        </Shell>
      );
    }
    case "AN-P06": {
      const totals = categoryTotals(records.filter((record) => record.kind === "expense")).filter((row) => row.minor > 0n);
      if (totals.length === 0) return <Notice text={noRecords ? empty : t("statsWorkbench.states.fxNothingKnown", { count: missing })} />;
      const notes = [partial, fxNote("fxComposition")];
      const max = totals[0]!.minor;
      // 缺汇率时分母不完整：面积会暗示占比，所以退成不带占比的排行。
      if (family === "ranking" || missing > 0) {
        return (
          <Shell notes={notes}>
            <BarRows title={title} limit={rowsFit(30)} moreText={more} rows={totals.map((row) => ({ id: row.id, label: row.label, valueText: money(row.minor), fraction: ratio(row.minor, max) }))} />
          </Shell>
        );
      }
      return (
        <Shell notes={notes} info={[detail ? t("statsWorkbench.cAnalysis.flatHierarchy") : null]}>
          <TreemapChart title={title} height={Math.max(60, height - 40)} items={totals.map((row) => ({ id: row.id, label: row.label, value: Number(row.minor), valueText: money(row.minor) }))} />
        </Shell>
      );
    }
    case "AN-P09": {
      const result = monthlyRanks(records, range, detail ? 8 : 5);
      if (result === null) return <Notice text={!hasExpense ? (missing > 0 ? t("statsWorkbench.states.fxNothingKnown", { count: missing }) : empty) : t("statsWorkbench.cAnalysis.needTwoMonths")} />;
      const notes = [partial, fxNote("fxRanking")];
      if (family === "table") {
        return (
          <Shell notes={notes}>
            <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.category") }, ...result.months.map((month) => ({ label: monthLabel(month), align: "right" as const }))]} rows={result.lines.map((line) => ({ key: line.id, cells: [line.label, ...line.ranks.map((rank) => (rank === null ? "—" : `#${String(rank)}`))] }))} />
          </Shell>
        );
      }
      return (
        <Shell notes={notes}>
          <BumpChart title={title} height={height - 40} periods={result.months.map(monthLabel)} lines={result.lines} maxRank={result.maxRank} />
        </Shell>
      );
    }

    // ---------------- 两期变化（本期 vs 上一可比期） ----------------
    case "AN-A06":
    case "AN-A07":
    case "AN-A17":
    case "AN-P22":
    case "AN-P24": {
      const previousRange = comparisonRangeFor(range);
      let previousEntries: readonly Transaction[];
      if (scope.combined) {
        const previous = fx?.previous ?? null;
        if (previous === null || previous.status === "loading") return <Notice text={t("statsWorkbench.states.fxLoading")} />;
        if (previous.status !== "ready" || previous.projection === undefined || !previous.projection.sourceComplete) return <Notice text={t("statsWorkbench.states.fxComparisonPreviousFailed")} tone="warn" />;
        // 与原币模式同一要求：本期账目覆盖不完整时不比较（与 A01 `compute.ts` 的判断一致）。
        if (partial !== null) return <Notice text={t("statsWorkbench.states.fxComparisonCurrentIncomplete")} tone="warn" />;
        const previousMissing = previous.projection.missingByScope.expense.count;
        if (missing > 0 || previousMissing > 0) return <Notice text={t("statsWorkbench.states.fxComparisonUnavailable", { count: missing + previousMissing })} tone="warn" />;
        previousEntries = previous.projection.converted;
      } else {
        if (scope.comparisonRead !== undefined && !scope.comparisonRead.verified) return <Notice text={t("statsWorkbench.cAnalysis.previousIncomplete")} tone="warn" />;
        if (partial !== null) return <Notice text={t("statsWorkbench.states.fxComparisonCurrentIncomplete")} tone="warn" />;
        previousEntries = scope.comparisonRead?.entries ?? scope.entries;
      }
      const previousRecords = inRange(toRecords(entriesInCurrency(previousEntries, currency), (entry) => displayCategoryName(entry.categoryName), (entry) => entry.paymentMethodName ?? unspecified), previousRange);
      const change = periodChange(previousRecords, records);
      if (change === null) return <Notice text={empty} />;
      const { contribution } = change;
      // 卡片里用短日期（同年省略年份），完整日期在详情页与读屏文字里都能读到。
      const short = (date: string) => formatLocalDate(date, date.slice(0, 4) === scope.today.slice(0, 4) ? { month: "numeric", day: "numeric" } : { year: "numeric", month: "numeric", day: "numeric" });
      const periodText = t("statsWorkbench.cAnalysis.periods", { previous: `${short(previousRange.from)}–${short(previousRange.to)}`, current: `${short(range.from)}–${short(range.to)}` });
      // 上期一笔支出都没有（例如账本从本期才开始记）：归因、份额变化都没有基准，说明而不是画「全部新出现」。
      if (!previousRecords.some((record) => record.kind === "expense")) return <Notice text={t("statsWorkbench.cAnalysis.noPrevious", { range: `${short(previousRange.from)}–${short(previousRange.to)}` })} />;
      if (!contribution.conservation.matchesTotal) return <Notice text={t("statsWorkbench.cAnalysis.notConserved")} tone="warn" />;
      const signed = (minor: bigint) => `${minor > 0n ? "+" : ""}${money(minor)}`;
      const maxDelta = contribution.rows.reduce((max, row) => { const abs = row.deltaMinor < 0n ? -row.deltaMinor : row.deltaMinor; return abs > max ? abs : max; }, 0n);
      const rowsByDelta = [...contribution.rows].sort((a, b) => { const absA = a.deltaMinor < 0n ? -a.deltaMinor : a.deltaMinor; const absB = b.deltaMinor < 0n ? -b.deltaMinor : b.deltaMinor; return absA === absB ? (a.categoryId < b.categoryId ? -1 : 1) : absA > absB ? -1 : 1; });
      const tag = (row: (typeof contribution.rows)[number]) => (row.isNew ? t("statsWorkbench.cAnalysis.newCategory") : row.isRemoved ? t("statsWorkbench.cAnalysis.removedCategory") : null);
      if (id === "AN-A07" || id === "AN-P24") {
        const shares = change.shares;
        if (family === "slope") {
          const maxShare = shares.reduce((max, row) => Math.max(max, fraction(row.previous), fraction(row.current)), 0.0001);
          const shown = [...shares].sort((a, b) => fraction(b.current) - fraction(a.current)).slice(0, detail ? 10 : 6);
          return (
            <Shell notes={[]} info={[periodText]}>
              <SlopeChart title={title} height={height - 54} leftLabel={t("statsWorkbench.cAnalysis.previous")} rightLabel={t("statsWorkbench.cAnalysis.current")} rows={shown.map((row) => ({ id: row.id, label: row.label, left: row.previous === null ? null : fraction(row.previous) / maxShare, right: row.current === null ? null : fraction(row.current) / maxShare, leftText: row.previous === null ? "—" : percent(row.previous), rightText: row.current === null ? "—" : percent(row.current) }))} />
            </Shell>
          );
        }
        if (family === "table") {
          return (
            <Shell notes={[]} info={[periodText]}>
              <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.category") }, { label: t("statsWorkbench.cAnalysis.previous"), align: "right" }, { label: t("statsWorkbench.cAnalysis.current"), align: "right" }, { label: t("statsWorkbench.cAnalysis.shareChange"), align: "right" }]} rows={shares.map((row) => ({ key: row.id, cells: [row.label, row.previous === null ? "—" : percent(row.previous), row.current === null ? "—" : percent(row.current), row.change === null ? "—" : ppText(row.change, t)] }))} />
            </Shell>
          );
        }
        const maxChange = shares.reduce((max, row) => Math.max(max, Math.abs(fraction(row.change))), 0.0001);
        const ordered = [...shares].sort((a, b) => Math.abs(fraction(b.change)) - Math.abs(fraction(a.change)));
        return (
          <Shell notes={[]} info={[periodText]}>
            <DivergingRows title={title} limit={rowsFit(30)} moreText={more} rows={ordered.map((row) => ({ id: row.id, label: row.label, valueText: row.change === null ? "—" : ppText(row.change, t), fraction: fraction(row.change) / maxChange, secondary: row.current === null ? null : percent(row.current) }))} />
          </Shell>
        );
      }
      if (family === "waterfall" || id === "AN-P22") {
        if (family === "table") {
          return (
            <Shell notes={[]} info={[periodText]}>
              <DataTable title={title} limit={rowsFit(22) - 2} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.category") }, { label: t("statsWorkbench.cAnalysis.previous"), align: "right" }, { label: t("statsWorkbench.cAnalysis.current"), align: "right" }, { label: t("statsWorkbench.cAnalysis.change"), align: "right" }]} rows={rowsByDelta.map((row) => ({ key: row.categoryId, cells: [row.categoryLabel, money(row.previousMinor), money(row.currentMinor), signed(row.deltaMinor)] }))} footer={[t("statsWorkbench.cAnalysis.total"), money(contribution.previousTotalMinor), money(contribution.currentTotalMinor), signed(contribution.totalDeltaMinor)]} />
            </Shell>
          );
        }
        const steps = rowsByDelta.filter((row) => row.deltaMinor !== 0n).slice(0, detail ? 12 : 6);
        const rest = rowsByDelta.filter((row) => row.deltaMinor !== 0n).slice(steps.length).reduce((sum, row) => sum + row.deltaMinor, 0n);
        let running = contribution.previousTotalMinor;
        let peak = running > contribution.currentTotalMinor ? running : contribution.currentTotalMinor;
        const path: { id: string; label: string; from: bigint; to: bigint; kind: "start" | "delta" | "total"; valueText: string }[] = [{ id: "start", label: t("statsWorkbench.cAnalysis.previous"), from: 0n, to: running, kind: "start", valueText: money(running) }];
        for (const row of steps) {
          const next = running + row.deltaMinor;
          path.push({ id: row.categoryId, label: row.categoryLabel, from: running, to: next, kind: "delta", valueText: `${row.categoryLabel} ${signed(row.deltaMinor)}` });
          running = next;
          if (running > peak) peak = running;
        }
        if (rest !== 0n) {
          const next = running + rest;
          path.push({ id: "rest", label: t("statsWorkbench.values.other"), from: running, to: next, kind: "delta", valueText: `${t("statsWorkbench.values.other")} ${signed(rest)}` });
          running = next;
          if (running > peak) peak = running;
        }
        path.push({ id: "end", label: t("statsWorkbench.cAnalysis.current"), from: 0n, to: contribution.currentTotalMinor, kind: "total", valueText: money(contribution.currentTotalMinor) });
        return (
          <Shell notes={[]} info={[t("statsWorkbench.cAnalysis.waterfallTotals", { previous: money(contribution.previousTotalMinor), current: money(contribution.currentTotalMinor), change: signed(contribution.totalDeltaMinor) }), periodText]}>
            <WaterfallChart title={title} height={height - 36} bars={path.map((bar) => ({ id: bar.id, label: bar.label, kind: bar.kind, valueText: bar.valueText, from: ratio(bar.from, peak), to: ratio(bar.to, peak) }))} />
          </Shell>
        );
      }
      if (family === "table") {
        return (
          <Shell notes={[]} info={[periodText]}>
            <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.category") }, { label: t("statsWorkbench.cAnalysis.change"), align: "right" }, { label: t("statsWorkbench.cAnalysis.growth"), align: "right" }]} rows={[...contribution.rows].sort((a, b) => (a.deltaMinor === b.deltaMinor ? 0 : a.deltaMinor > b.deltaMinor ? -1 : 1)).map((row) => ({ key: row.categoryId, cells: [row.categoryLabel, signed(row.deltaMinor), row.growth === null ? tag(row) ?? "—" : percent(row.growth)] }))} />
          </Shell>
        );
      }
      const ordered = id === "AN-A17" ? [...contribution.rows].sort((a, b) => (a.deltaMinor === b.deltaMinor ? (a.categoryId < b.categoryId ? -1 : 1) : a.deltaMinor > b.deltaMinor ? -1 : 1)) : rowsByDelta;
      return (
        <Shell notes={[]} info={[t("statsWorkbench.cAnalysis.totalChange", { value: signed(contribution.totalDeltaMinor) }), periodText]}>
          <DivergingRows title={title} limit={rowsFit(30)} moreText={more} rows={ordered.map((row) => ({ id: row.categoryId, label: row.categoryLabel, valueText: signed(row.deltaMinor), fraction: maxDelta === 0n ? 0 : Number(row.deltaMinor) / Number(maxDelta), secondary: id === "AN-A17" ? (row.growth === null ? tag(row) : percent(row.growth)) : tag(row) }))} />
        </Shell>
      );
    }

    // ---------------- 多币种与汇率 ----------------
    case "AN-P16": {
      const entries = scope.combined ? sourceOf(scope) : sourceEntries;
      const result = currencyCounts(entries.filter((entry) => entry.occurredLocalDate >= range.from && entry.occurredLocalDate <= range.to));
      if (result === null) return <Notice text={empty} />;
      const max = result.rows.reduce((value, row) => Math.max(value, row.recordCount), 0);
      if (family === "table") {
        return (
          <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.currency") }, { label: t("statsWorkbench.cAnalysis.count"), align: "right" }, { label: t("common.kind.expense"), align: "right" }, { label: t("common.kind.income"), align: "right" }]} rows={result.rows.map((row) => ({ key: row.currency, cells: [row.currency, String(row.recordCount), String(row.expenseCount), String(row.incomeCount)] }))} />
        );
      }
      return (
        <Shell notes={[]} info={[t("statsWorkbench.cAnalysis.countsOnly")]}>
          <BarRows title={title} limit={rowsFit(30)} moreText={more} rows={result.rows.map((row) => ({ id: row.currency, label: row.currency, valueText: t("statsWorkbench.values.count", { count: row.recordCount }), fraction: max === 0 ? 0 : row.recordCount / max, secondary: row.recordShare === null ? null : percent(row.recordShare) }))} />
        </Shell>
      );
    }
    case "AN-P17": {
      if (fx === undefined) return <Notice text={t("statsWorkbench.cAnalysis.combinedOnly")} />;
      const result = convertedByOriginalCurrency(fx.projection.converted, sourceOf(scope), "expense");
      if (result === null) return <Notice text={missing > 0 ? t("statsWorkbench.states.fxNothingKnown", { count: missing }) : empty} />;
      const complete = missing === 0;
      const notes = [complete ? null : t("statsWorkbench.states.fxComposition", { count: missing })];
      const max = result.rows[0]?.minor ?? 0n;
      if (family === "table") {
        return (
          <Shell notes={notes}>
            <DataTable title={title} limit={rowsFit(22) - 2} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.originalCurrency") }, { label: t("statsWorkbench.cAnalysis.count"), align: "right" }, { label: t("statsWorkbench.cAnalysis.converted", { currency }), align: "right" }]} rows={result.rows.map((row) => ({ key: row.currency, cells: [row.currency, String(row.count), money(row.minor)] }))} footer={[t("statsWorkbench.cAnalysis.total"), String(result.rows.reduce((sum, row) => sum + row.count, 0)), money(result.totalMinor)]} />
          </Shell>
        );
      }
      return (
        <Shell notes={notes}>
          <BarRows title={title} limit={rowsFit(30)} moreText={more} rows={result.rows.map((row) => ({ id: row.currency, label: row.currency, valueText: money(row.minor), fraction: ratio(row.minor, max), secondary: complete && result.totalMinor > 0n ? percent({ numerator: row.minor, denominator: result.totalMinor }) : null }))} />
        </Shell>
      );
    }
    case "AN-P18": {
      const lookups = scope.fx?.lookups;
      const target = fx?.projection.target ?? currency;
      const foreign = topForeignCurrency(sourceOf(scope), target);
      if (lookups === undefined || foreign === null) return <Notice text={t("statsWorkbench.cAnalysis.noForeign")} />;
      const points = rateObservations(lookups, foreign, target);
      if (points.length === 0) return <Notice text={t("statsWorkbench.cAnalysis.noObservations", { currency: foreign })} />;
      const values = points.map((point) => fraction(point.rate));
      const min = Math.min(...values);
      const max = Math.max(...values);
      const first = range.from;
      const span = Math.max(1, dayIndex(range.to, first));
      const pointText = (date: string, rate: { readonly numerator: bigint; readonly denominator: bigint }) => `${formatLocalDate(date)} · ${t("statsWorkbench.cAnalysis.rate", { currency: foreign, rate: rationalText(rate, 4), target })}`;
      if (family === "table") {
        return <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.rateDate") }, { label: `${foreign} → ${target}`, align: "right" }]} rows={[...points].reverse().map((point) => ({ key: point.date, cells: [formatLocalDate(point.date), rationalText(point.rate, 4)] }))} />;
      }
      return (
        <Shell notes={[]} info={[t("statsWorkbench.cAnalysis.observationsOnly", { count: points.length })]}>
          <ObservationDots title={title} height={height - 36} minText={rationalText(points[values.indexOf(min)]!.rate, 4)} maxText={rationalText(points[values.indexOf(max)]!.rate, 4)} points={points.map((point, index) => ({ id: point.date, x: Math.min(1, Math.max(0, dayIndex(point.date, first) / span)), y: max === min ? 0.5 : (values[index]! - min) / (max - min), text: pointText(point.date, point.rate) }))} />
        </Shell>
      );
    }
    case "AN-P19": {
      if (fx === undefined) return <Notice text={t("statsWorkbench.cAnalysis.combinedOnly")} />;
      const rows = fxCoverage(sourceOf(scope), new Set(fx.projection.missing.map((record) => record.id)), fx.projection.target);
      if (rows.length === 0) return <Notice text={t("statsWorkbench.cAnalysis.noForeign")} />;
      const needed = rows.reduce((sum, row) => sum + row.needed, 0);
      const converted = rows.reduce((sum, row) => sum + row.converted, 0);
      const summary = t("statsWorkbench.cAnalysis.coverageSummary", { converted, needed });
      if (family === "matrix") {
        const months = [...new Set(rows.flatMap((row) => [...row.missingByMonth.keys()]))].sort();
        if (months.length === 0) return <Notice text={`${summary} ${t("statsWorkbench.cAnalysis.noMissing")}`} />;
        const maxMissing = rows.reduce((max, row) => Math.max(max, ...row.missingByMonth.values()), 1);
        return (
          <Shell notes={[]} info={[summary]}>
            <HeatMatrix title={title} maxRows={rowsFit(20) - 1} moreText={more} emptyTitle={t("statsWorkbench.cAnalysis.noMissing")} rows={rows.map((row) => ({ id: row.currency, label: row.currency, totalText: `${String(row.missing)}/${String(row.needed)}` }))} cols={months.map((month) => ({ id: month, label: monthLabel(month) }))} cell={(rowId, colId) => { const value = rows.find((row) => row.currency === rowId)?.missingByMonth.get(colId); return value === undefined ? null : { text: String(value), intensity: value / maxMissing, title: `${rowId} · ${monthLabel(colId)} · ${t("statsWorkbench.cAnalysis.missingCount", { count: value })}` }; }} />
          </Shell>
        );
      }
      return (
        <Shell notes={[]} info={[summary, t("statsWorkbench.cAnalysis.countNotAmount")]}>
          <DataTable title={title} limit={rowsFit(22) - 2} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.originalCurrency") }, { label: t("statsWorkbench.cAnalysis.needed"), align: "right" }, { label: t("statsWorkbench.cAnalysis.convertedCount"), align: "right" }, { label: t("statsWorkbench.cAnalysis.missingRate"), align: "right" }]} rows={rows.map((row) => ({ key: row.currency, cells: [row.currency, String(row.needed), String(row.converted), String(row.missing)] }))} />
        </Shell>
      );
    }
    case "AN-P20": {
      const lookups = scope.fx?.lookups;
      const target = fx?.projection.target ?? currency;
      if (lookups === undefined) return <Notice text={t("statsWorkbench.cAnalysis.combinedOnly")} />;
      const usage = fxFallbackUsage(sourceOf(scope).filter((entry) => entry.occurredLocalDate >= range.from && entry.occurredLocalDate <= range.to), lookups as ReadonlyMap<string, never>, target);
      if (usage.needed === 0) return <Notice text={t("statsWorkbench.cAnalysis.noForeign")} />;
      const daysList = [...usage.byDays.keys()].sort((a, b) => a - b);
      const fallbackCount = daysList.filter((days) => days > 0).reduce((sum, days) => sum + (usage.byDays.get(days) ?? 0), 0);
      const summary = t("statsWorkbench.cAnalysis.fallbackSummary", { fallback: fallbackCount, needed: usage.needed, missing: usage.missing });
      const label = (days: number) => (days === 0 ? t("statsWorkbench.cAnalysis.direct") : t("statsWorkbench.cAnalysis.fallbackDays", { count: days }));
      if (family === "table") {
        return (
          <Shell notes={[]} info={[summary]}>
            <DataTable title={title} limit={rowsFit(22) - 1} moreText={more} columns={[{ label: t("statsWorkbench.cAnalysis.rateSource") }, { label: t("statsWorkbench.cAnalysis.count"), align: "right" }]} rows={[...daysList.map((days) => ({ key: String(days), cells: [label(days), String(usage.byDays.get(days) ?? 0)] })), ...(usage.missing > 0 ? [{ key: "missing", cells: [t("statsWorkbench.cAnalysis.missingRate"), String(usage.missing)] }] : [])]} />
          </Shell>
        );
      }
      const bars = [...daysList.map((days) => ({ id: String(days), label: days === 0 ? "0" : `+${String(days)}`, count: usage.byDays.get(days) ?? 0, highlight: false })), ...(usage.missing > 0 ? [{ id: "missing", label: "×", count: usage.missing, highlight: true }] : [])];
      const maxCount = bars.reduce((max, bar) => Math.max(max, bar.count), 1);
      return (
        <Shell notes={[]} info={[summary]}>
          <ColumnChart title={title} height={height - 36} bars={bars.map((bar) => ({ id: bar.id, label: bar.label, valueText: `${bar.id === "missing" ? t("statsWorkbench.cAnalysis.missingRate") : label(Number(bar.id))} · ${t("statsWorkbench.values.count", { count: bar.count })}`, fraction: bar.count / maxCount, highlight: bar.highlight }))} />
        </Shell>
      );
    }
    default:
      return <Notice text={t("statsWorkbench.card.unknownHint")} />;
  }
}

/** 综合折算读到的原币账目（id、原始币种、日期）；原币模式下就是作用域里的账目。 */
function sourceOf(scope: WorkbenchScope): readonly (Transaction & FxSourceEntry)[] {
  return (scope.fx?.sourceEntries ?? scope.entries) as readonly (Transaction & FxSourceEntry)[];
}

function topForeignCurrency(entries: readonly FxSourceEntry[], target: string): string | null {
  const counts = new Map<string, number>();
  for (const entry of entries) if (entry.currency !== target) counts.set(entry.currency, (counts.get(entry.currency) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
}

function sameYear(range: DateRange): boolean {
  return range.from.slice(0, 4) === range.to.slice(0, 4);
}

function dayIndex(date: string, from: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 份额变化（有理数，0.0123 = 1.23 个百分点）→「+1.2 个百分点」。 */
function ppText(change: { readonly numerator: bigint; readonly denominator: bigint }, t: Translate): string {
  const value = ratioPercentText(change).replace("%", "");
  return t("statsWorkbench.cAnalysis.pp", { value: change.numerator > 0n === change.denominator > 0n && change.numerator !== 0n ? `+${value}` : value });
}

/** 矩阵格子与直方图刻度用的短金额（只用于标签；完整金额在每格的读数里）。 */
function compactMoney(minor: bigint, currency: string): string {
  const full = moneyText(minor.toString(), currency);
  const symbol = full.match(/^[^\d−-]*/)?.[0] ?? "";
  // 最小单位按币种的小数位换算（JPY 0 位、多数币种 2 位、少数 3 位）。
  const units = Number(minor) / 10 ** decimalsFor(currency);
  const abs = Math.abs(units);
  if (abs >= 1_000_000) return `${symbol}${(units / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${symbol}${(units / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `${symbol}${(units / 1_000).toFixed(1)}k`;
  return `${symbol}${units.toFixed(0)}`;
}
