/**
 * S17-C 专业分析接入工作台（1.17.10）：**账目 → `@libellum/shared` 的 C 计算 → 展示用模型。**
 *
 * - 数学全部在 shared（`analysis/advanced`：排行、帕累托、分位、直方、归因、矩阵、散点、气泡、透视、
 *   小多图、全年日历、连续段……），本文件只做三件事：把账目转成 C 的记录形状、选口径（支出 / 收入、
 *   时间桶）、把结果里的整数与有理数转成「显示文本所需的整数」和「仅用于几何的 0–1 比例」；
 * - 金额一律 bigint 最小单位，不经过浮点；比例只在画图时才转成 number；
 * - 不足以计算（样本为空、单期无法比较）时返回 `null` 或带原因的状态，**不返回 0**；
 * - 本文件纯函数、无 React，可单独测试。
 */
import { addDays, type DateRange, type Transaction } from "@libellum/shared";
import {
  annualCalendarOf,
  boxplotByCategory,
  bubblesOf,
  buildHistogram,
  buildMatrix,
  contributionBetween,
  currencyCompositionOf,
  iqrFences,
  isoWeekday,
  isoWeekKey,
  noExpenseStreaksOf,
  paretoOf,
  pivotOf,
  rankMigration,
  rankRecords,
  scatterOf,
  shareChangeOf,
  smallMultiplesOf,
  summariseDistribution,
  type AdvancedRecord,
  type DraftBoxplotResult,
  type DraftCalendarResult,
  type DraftConcentration,
  type DraftContributionResult,
  type DraftCurrencyCompositionResult,
  type DraftDistributionSummary,
  type DraftHistogram,
  type DraftMatrixResult,
  type DraftPivotResult,
  type DraftRankingResult,
  type DraftRational,
  type DraftScatterResult,
  type DraftSmallMultiplesResult,
  type NoExpenseDay,
  type NoExpenseStreakResult,
} from "@libellum/shared/analysis/advanced";

/** C 记录形状（金额非负、方向由 kind 表达）。分类名由调用方翻译后传入。 */
export function toRecords(entries: readonly Transaction[], categoryLabel: (entry: Transaction) => string, paymentLabel: (entry: Transaction) => string | null): AdvancedRecord[] {
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    amountMinor: BigInt(Math.trunc(entry.amountCents)),
    currency: entry.currency,
    occurredLocalDate: entry.occurredLocalDate,
    categoryId: entry.categoryId,
    categoryLabel: categoryLabel(entry),
    paymentMethodId: entry.paymentMethodId,
    paymentMethodLabel: entry.paymentMethodId === null ? null : paymentLabel(entry),
  }));
}

export function inRange(records: readonly AdvancedRecord[], range: DateRange, kind?: "expense" | "income"): AdvancedRecord[] {
  return records.filter((record) => record.occurredLocalDate >= range.from && record.occurredLocalDate <= range.to && (kind === undefined || record.kind === kind));
}

/** 只用于画图：精确有理数 → 0–1 之间的 number。 */
export function fraction(value: DraftRational | null | undefined): number {
  if (value === null || value === undefined || value.denominator === 0n) return 0;
  return Number(value.numerator) / Number(value.denominator);
}

/** 只用于画图：两个整数之比。 */
export function ratio(numerator: bigint, denominator: bigint): number {
  return denominator === 0n ? 0 : Number(numerator) / Number(denominator);
}

/** 有理数金额四舍五入（半值远离零）到最小单位——**只在显示时**用。 */
export function roundRational(value: DraftRational): bigint {
  const negative = value.numerator < 0n !== value.denominator < 0n;
  const n = value.numerator < 0n ? -value.numerator : value.numerator;
  const d = value.denominator < 0n ? -value.denominator : value.denominator;
  const rounded = (n * 2n + d) / (d * 2n);
  return negative ? -rounded : rounded;
}

/** 区间内的自然月键（`YYYY-MM`），升序。 */
export function monthsIn(range: DateRange): string[] {
  const months: string[] = [];
  let year = Number(range.from.slice(0, 4));
  let month = Number(range.from.slice(5, 7));
  const last = range.to.slice(0, 7);
  for (let guard = 0; guard < 240; guard += 1) {
    const key = `${String(year)}-${String(month).padStart(2, "0")}`;
    if (key > last) break;
    months.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** 区间内的日期（含两端），最多 400 天。 */
export function datesIn(range: DateRange): string[] {
  const dates: string[] = [];
  for (let date = range.from; date <= range.to && dates.length < 400; date = addDays(date, 1)) dates.push(date);
  return dates;
}

interface CategoryTotal {
  readonly id: string;
  readonly label: string;
  readonly minor: bigint;
  readonly count: number;
}

export function categoryTotals(records: readonly AdvancedRecord[]): CategoryTotal[] {
  const totals = new Map<string, { label: string; minor: bigint; count: number }>();
  for (const record of records) {
    const current = totals.get(record.categoryId);
    if (current === undefined) totals.set(record.categoryId, { label: record.categoryLabel, minor: record.amountMinor, count: 1 });
    else {
      current.minor += record.amountMinor;
      current.count += 1;
    }
  }
  return [...totals.entries()]
    .map(([id, value]) => ({ id, label: value.label, minor: value.minor, count: value.count }))
    .sort((a, b) => (a.minor === b.minor ? (a.id < b.id ? -1 : 1) : a.minor > b.minor ? -1 : 1));
}

// ---------------------------------------------------------------------------
// 单期分析
// ---------------------------------------------------------------------------

/** I18：支出单笔排行（并列同名次；份额分母 = 期内支出合计）。 */
export function largestExpenses(records: readonly AdvancedRecord[], limit = 20): DraftRankingResult | null {
  const expenses = records.filter((record) => record.kind === "expense");
  if (expenses.length === 0) return null;
  const total = expenses.reduce((sum, record) => sum + record.amountMinor, 0n);
  return rankRecords(expenses, { totalMinor: total, limit });
}

/** A08 / P08：分类集中度（帕累托）。 */
export function categoryConcentration(records: readonly AdvancedRecord[]): DraftConcentration | null {
  const totals = categoryTotals(records.filter((record) => record.kind === "expense")).filter((row) => row.minor > 0n);
  if (totals.length === 0) return null;
  return paretoOf(totals.map((row) => ({ id: row.id, label: row.label, minor: row.minor })), { topNs: [1, 3, 5] });
}

/** A16：单笔交易集中度（前 N 笔占全部支出；按单笔，不按分类）。 */
export function transactionConcentration(records: readonly AdvancedRecord[]): DraftConcentration | null {
  const expenses = records.filter((record) => record.kind === "expense" && record.amountMinor > 0n);
  if (expenses.length === 0) return null;
  return paretoOf(expenses.map((record) => ({ id: record.id, label: `${record.occurredLocalDate} ${record.categoryLabel}`, minor: record.amountMinor })), { topNs: [1, 3, 5, 10] });
}

export function shareOfTop(concentration: DraftConcentration, topN: number): { readonly share: DraftRational; readonly coveredMinor: bigint } | null {
  return concentration.ratios.find((item) => item.topN === topN) ?? null;
}

/** A09 / A10 / A11：单笔支出金额分布。 */
export function expenseDistribution(records: readonly AdvancedRecord[]): { readonly summary: DraftDistributionSummary; readonly histogram: DraftHistogram; readonly upperFence: DraftRational; readonly lowerFence: DraftRational; readonly outliers: readonly bigint[] } | null {
  const values = records.filter((record) => record.kind === "expense").map((record) => record.amountMinor);
  if (values.length === 0) return null;
  const summary = summariseDistribution(values);
  const histogram = buildHistogram(values, { targetBins: 10 });
  const fences = iqrFences(values);
  return { summary, histogram, upperFence: fences.upperFence, lowerFence: fences.lowerFence, outliers: fences.outliers };
}

export function quartile(summary: DraftDistributionSummary, numerator: bigint, denominator: bigint): DraftRational | null {
  return summary.quantiles.find((item) => item.p.numerator * denominator === numerator * item.p.denominator)?.valueMinor ?? null;
}

/** A15：区间内每天是否确认没有支出记录；本机覆盖未确认或缺汇率的日子是「未知」，不是「没有」。 */
export function noExpenseDays(records: readonly AdvancedRecord[], range: DateRange, today: string, coverageKnown: boolean, unknownDates: ReadonlySet<string> | undefined): NoExpenseStreakResult {
  const spent = new Set(records.filter((record) => record.kind === "expense").map((record) => record.occurredLocalDate));
  const days: NoExpenseDay[] = datesIn(range).map((date) => ({
    date,
    state: date > today ? "future" : spent.has(date) ? "spent" : !coverageKnown || unknownDates?.has(date) === true ? "unknown" : "none",
  }));
  return noExpenseStreaksOf(days, 5);
}

/** P01 / P02 / P03：分类 × 月份 / 星期 / 支付方式 的支出矩阵（行合计 = 列合计 = 总计，shared 守恒）。 */
export function categoryMatrix(records: readonly AdvancedRecord[], column: "month" | "weekday" | "payment", range: DateRange, unspecifiedLabel = ""): { readonly matrix: DraftMatrixResult; readonly columnLabels: ReadonlyMap<string, string>; readonly rowLabels: ReadonlyMap<string, string> } | null {
  const expenses = records.filter((record) => record.kind === "expense");
  if (expenses.length === 0) return null;
  const columnLabels = new Map<string, string>();
  const rowLabels = new Map<string, string>();
  const cells = new Map<string, { rowId: string; colId: string; amountMinor: bigint; count: number }>();
  for (const record of expenses) {
    const colId = column === "month" ? record.occurredLocalDate.slice(0, 7) : column === "weekday" ? String(isoWeekday(record.occurredLocalDate)) : record.paymentMethodId ?? "__unspecified__";
    if (column === "payment") columnLabels.set(colId, record.paymentMethodLabel ?? unspecifiedLabel);
    rowLabels.set(record.categoryId, record.categoryLabel);
    const key = `${record.categoryId}\u0001${colId}`;
    const current = cells.get(key);
    if (current === undefined) cells.set(key, { rowId: record.categoryId, colId, amountMinor: record.amountMinor, count: 1 });
    else {
      current.amountMinor += record.amountMinor;
      current.count += 1;
    }
  }
  const rowOrder = categoryTotals(expenses).map((row) => row.id);
  const colOrder = column === "month" ? monthsIn(range) : column === "weekday" ? ["1", "2", "3", "4", "5", "6", "7"] : undefined;
  const matrix = buildMatrix([...cells.values()], { rowOrder, ...(colOrder === undefined ? {} : { colOrder }) });
  return { matrix, columnLabels, rowLabels };
}

/** P04：时间 × 支付方式（区间跨两个月以上按月，否则按 ISO 周）。 */
export function paymentOverTime(records: readonly AdvancedRecord[], range: DateRange, unspecifiedLabel = ""): { readonly matrix: DraftMatrixResult; readonly bucket: "month" | "week"; readonly seriesLabels: ReadonlyMap<string, string> } | null {
  const expenses = records.filter((record) => record.kind === "expense");
  if (expenses.length === 0) return null;
  const bucket: "month" | "week" = monthsIn(range).length >= 2 ? "month" : "week";
  const seriesLabels = new Map<string, string>();
  const cells = new Map<string, { rowId: string; colId: string; amountMinor: bigint; count: number }>();
  for (const record of expenses) {
    const rowId = bucket === "month" ? record.occurredLocalDate.slice(0, 7) : isoWeekKey(record.occurredLocalDate);
    const colId = record.paymentMethodId ?? "__unspecified__";
    seriesLabels.set(colId, record.paymentMethodLabel ?? unspecifiedLabel);
    const key = `${rowId}\u0001${colId}`;
    const current = cells.get(key);
    if (current === undefined) cells.set(key, { rowId, colId, amountMinor: record.amountMinor, count: 1 });
    else {
      current.amountMinor += record.amountMinor;
      current.count += 1;
    }
  }
  // 时间桶按时间顺序；月桶列出区间内每个月（没有支出的月份是空柱，不是 0 金额的结论）。
  const rows = [...new Set([...cells.values()].map((cell) => cell.rowId))].sort();
  const matrix = buildMatrix([...cells.values()], { rowOrder: bucket === "month" ? monthsIn(range) : rows });
  return { matrix, bucket, seriesLabels };
}

/** P10：单笔支出 × 日期散点（超过上限时只画金额最大的点，并如实给出省略数）。 */
export function expenseScatter(records: readonly AdvancedRecord[]): DraftScatterResult | null {
  const expenses = records.filter((record) => record.kind === "expense");
  if (expenses.length === 0) return null;
  return scatterOf(expenses.map((record) => ({ id: record.id, occurredLocalDate: record.occurredLocalDate, amountMinor: record.amountMinor, categoryId: record.categoryId })), { maxPoints: 400 });
}

/** P11：分类的金额（气泡大小）× 笔数（横轴）× 平均每笔（纵轴）。 */
export function categoryBubbles(records: readonly AdvancedRecord[]): ReturnType<typeof bubblesOf> | null {
  const totals = categoryTotals(records.filter((record) => record.kind === "expense"));
  if (totals.length === 0) return null;
  return bubblesOf(totals.map((row) => ({ categoryId: row.id, categoryLabel: row.label, count: row.count, sumMinor: row.minor })));
}

/** P12：各分类单笔支出的箱线（Type 7 分位，与 A10 同一方法）。 */
export function categoryBoxplots(records: readonly AdvancedRecord[]): DraftBoxplotResult | null {
  const expenses = records.filter((record) => record.kind === "expense");
  if (expenses.length === 0) return null;
  return boxplotByCategory(expenses, { kind: "expense", maxOutliersPerGroup: 10 });
}

/** P23：各月单笔支出的分位比较——同一分位方法（把「组」设为月份，复用 shared 的箱线计算）。 */
export function monthlyBoxplots(records: readonly AdvancedRecord[], monthLabel: (month: string) => string): DraftBoxplotResult | null {
  const expenses = records.filter((record) => record.kind === "expense");
  if (expenses.length === 0) return null;
  const grouped = expenses.map((record) => ({ ...record, categoryId: record.occurredLocalDate.slice(0, 7), categoryLabel: monthLabel(record.occurredLocalDate.slice(0, 7)) }));
  const result = boxplotByCategory(grouped, { kind: "expense", maxOutliersPerGroup: 10 });
  // 月份按时间顺序比较，而不是按金额。
  return { ...result, groups: [...result.groups].sort((a, b) => (a.categoryId < b.categoryId ? -1 : 1)) };
}

/** P13：分类 × 月份 的支出交叉表（行列合计由 shared 给出并自检守恒）。 */
export function categoryMonthPivot(records: readonly AdvancedRecord[]): DraftPivotResult | null {
  const expenses = records.filter((record) => record.kind === "expense");
  if (expenses.length === 0) return null;
  return pivotOf(expenses, { rowDimension: "category", colDimension: "month", metric: "amount", kind: "expense" });
}

/** P14：支出最多的几个分类，按月份的小多图（默认共享纵轴）。 */
export function categorySmallMultiples(records: readonly AdvancedRecord[], range: DateRange, topN = 6): DraftSmallMultiplesResult | null {
  const expenses = records.filter((record) => record.kind === "expense");
  if (expenses.length === 0) return null;
  return smallMultiplesOf(expenses, { kind: "expense", topN, months: monthsIn(range), scaleMode: "shared" });
}

/** P15：全年日历（年份 = 读取窗口所在年份；覆盖未确认时过去日期为「未知」）。 */
export function yearCalendar(records: readonly AdvancedRecord[], year: number, today: string, coverageKnown: boolean): DraftCalendarResult {
  return annualCalendarOf(records, { year, metric: "expense", today, coverageKnown });
}

/** P16：按原始币种统计笔数（只比较数量，不把不同币种金额相加）。 */
export function currencyCounts(entries: readonly Transaction[]): DraftCurrencyCompositionResult | null {
  if (entries.length === 0) return null;
  return currencyCompositionOf(entries.map((entry) => ({ id: entry.id, kind: entry.kind, amountMinor: BigInt(Math.trunc(entry.amountCents)), currency: entry.currency, occurredLocalDate: entry.occurredLocalDate })));
}

/** P09：分类名次随月份变化（每月按精确金额排名，并列同名次；名次来自 shared 的正式排名规则）。 */
export function monthlyRanks(records: readonly AdvancedRecord[], range: DateRange, topN = 6): { readonly months: readonly string[]; readonly lines: readonly { readonly id: string; readonly label: string; readonly ranks: readonly (number | null)[] }[]; readonly maxRank: number } | null {
  const expenses = records.filter((record) => record.kind === "expense");
  const months = monthsIn(range);
  if (expenses.length === 0 || months.length < 2) return null;
  const snapshots = months.map((month) => categoryTotals(expenses.filter((record) => record.occurredLocalDate.startsWith(month))).filter((row) => row.minor > 0n).map((row) => ({ id: row.id, label: row.label, minor: row.minor })));
  const ranksByMonth: Map<string, number>[] = [];
  for (let index = 0; index < months.length; index += 1) {
    const result = rankMigration(index === 0 ? [] : snapshots[index - 1]!, snapshots[index]!);
    ranksByMonth.push(new Map(result.rows.filter((row) => row.currentRank !== null).map((row) => [row.id, row.currentRank!] as const)));
  }
  const overall = categoryTotals(expenses).slice(0, topN);
  const lines = overall.map((row) => ({ id: row.id, label: row.label, ranks: ranksByMonth.map((ranks) => ranks.get(row.id) ?? null) }));
  const maxRank = Math.max(2, ...lines.flatMap((line) => line.ranks.filter((rank): rank is number => rank !== null)));
  return { months, lines, maxRank };
}

// ---------------------------------------------------------------------------
// 两期分析（本期 vs 上一可比期；两期都必须是同一筛选、同一币种口径）
// ---------------------------------------------------------------------------

export interface PeriodChange {
  readonly contribution: DraftContributionResult;
  /** 每个分类的两期占比（分母为各自期间的支出合计；合计为 0 时为 null）。 */
  readonly shares: readonly { readonly id: string; readonly label: string; readonly previous: DraftRational | null; readonly current: DraftRational | null; readonly change: DraftRational | null }[];
}

/** A06 / A07 / A17 / P22 / P24：两期分类支出的变化归因（Σ 分类变化 = 总变化，shared 自检）。 */
export function periodChange(previous: readonly AdvancedRecord[], current: readonly AdvancedRecord[]): PeriodChange | null {
  const before = categoryTotals(previous.filter((record) => record.kind === "expense"));
  const after = categoryTotals(current.filter((record) => record.kind === "expense"));
  if (before.length === 0 && after.length === 0) return null;
  const contribution = contributionBetween(
    before.map((row) => ({ categoryId: row.id, categoryLabel: row.label, minor: row.minor })),
    after.map((row) => ({ categoryId: row.id, categoryLabel: row.label, minor: row.minor })),
  );
  const shares = contribution.rows.map((row) => ({
    id: row.categoryId,
    label: row.categoryLabel,
    previous: contribution.previousTotalMinor > 0n ? { numerator: row.previousMinor, denominator: contribution.previousTotalMinor } : null,
    current: contribution.currentTotalMinor > 0n ? { numerator: row.currentMinor, denominator: contribution.currentTotalMinor } : null,
    change: shareChangeOf(row, contribution.previousTotalMinor, contribution.currentTotalMinor),
  }));
  return { contribution, shares };
}

// ---------------------------------------------------------------------------
// 多币种与汇率（只在综合折算下有意义）：全部来自权威折算引擎的逐笔结果与它实际使用的汇率快照，
// 这里只做分组计数，不重新折算、不补汇率、不插值。
// ---------------------------------------------------------------------------

export interface FxSourceEntry {
  readonly id: string;
  readonly kind: "expense" | "income";
  readonly currency: string;
  readonly occurredLocalDate: string;
  readonly amountCents: number;
}

/** P17：已折算金额按**原始币种**分组（各组之和 = 已折算合计；缺汇率账目单列，不计入任何一组）。 */
export function convertedByOriginalCurrency(
  converted: readonly Transaction[],
  sources: readonly FxSourceEntry[],
  kind: "expense" | "income",
): { readonly rows: readonly { readonly currency: string; readonly minor: bigint; readonly count: number }[]; readonly totalMinor: bigint } | null {
  const originalOf = new Map(sources.map((entry) => [entry.id, entry.currency] as const));
  const groups = new Map<string, { minor: bigint; count: number }>();
  let totalMinor = 0n;
  for (const entry of converted) {
    if (entry.kind !== kind) continue;
    const currency = originalOf.get(entry.id);
    if (currency === undefined) continue;
    const amount = BigInt(Math.trunc(entry.amountCents));
    totalMinor += amount;
    const current = groups.get(currency);
    if (current === undefined) groups.set(currency, { minor: amount, count: 1 });
    else {
      current.minor += amount;
      current.count += 1;
    }
  }
  if (groups.size === 0) return null;
  const rows = [...groups.entries()].map(([currency, value]) => ({ currency, minor: value.minor, count: value.count })).sort((a, b) => (a.minor === b.minor ? (a.currency < b.currency ? -1 : 1) : a.minor > b.minor ? -1 : 1));
  return { rows, totalMinor };
}

export interface FxCoverageRow {
  readonly currency: string;
  /** 需要折算（原币 ≠ 目标币）的笔数。 */
  readonly needed: number;
  readonly converted: number;
  readonly missing: number;
  /** 按月份的缺汇率笔数（只列出有缺失的月份）。 */
  readonly missingByMonth: ReadonlyMap<string, number>;
}

/** P19：哪些账目能按系统汇率合同折算——按原始币种统计「需要 / 已折算 / 缺失」笔数（笔数口径，不推断金额覆盖率）。 */
export function fxCoverage(sources: readonly FxSourceEntry[], missingIds: ReadonlySet<string>, target: string): readonly FxCoverageRow[] {
  const rows = new Map<string, { needed: number; converted: number; missing: number; months: Map<string, number> }>();
  for (const entry of sources) {
    if (entry.currency === target) continue;
    const row = rows.get(entry.currency) ?? { needed: 0, converted: 0, missing: 0, months: new Map<string, number>() };
    row.needed += 1;
    if (missingIds.has(entry.id)) {
      row.missing += 1;
      const month = entry.occurredLocalDate.slice(0, 7);
      row.months.set(month, (row.months.get(month) ?? 0) + 1);
    } else row.converted += 1;
    rows.set(entry.currency, row);
  }
  return [...rows.entries()].map(([currency, row]) => ({ currency, needed: row.needed, converted: row.converted, missing: row.missing, missingByMonth: row.months })).sort((a, b) => b.needed - a.needed || (a.currency < b.currency ? -1 : 1));
}

export interface FxLookupLike {
  readonly status: "available" | "unavailable";
  readonly snapshot?: { readonly date: string; readonly rates: Readonly<Record<string, string>> };
}

/**
 * P20：实际使用的汇率日期与交易日期之差（0 = 当天直接命中，1–7 = 回退天数）——读的是引擎实际返回的
 * 汇率快照日期，不是从最终数字反推；没有快照的账目计为缺失。
 */
export function fxFallbackUsage(sources: readonly FxSourceEntry[], lookups: ReadonlyMap<string, FxLookupLike>, target: string): { readonly byDays: ReadonlyMap<number, number>; readonly missing: number; readonly needed: number; readonly currencies: readonly string[] } {
  const byDays = new Map<number, number>();
  let missing = 0;
  let needed = 0;
  const currencies = new Set<string>();
  for (const entry of sources) {
    if (entry.currency === target) continue;
    needed += 1;
    const lookup = lookups.get(entry.occurredLocalDate);
    const rateDate = lookup?.status === "available" ? lookup.snapshot?.date : undefined;
    if (rateDate === undefined || lookup?.snapshot?.rates[entry.currency] === undefined || lookup.snapshot.rates[target] === undefined) {
      missing += 1;
      continue;
    }
    const days = Math.round((Date.parse(`${entry.occurredLocalDate}T00:00:00Z`) - Date.parse(`${rateDate}T00:00:00Z`)) / 86_400_000);
    byDays.set(days, (byDays.get(days) ?? 0) + 1);
    if (days > 0) currencies.add(entry.currency);
  }
  return { byDays, missing, needed, currencies: [...currencies].sort() };
}

/**
 * P18：系统实际持有的汇率观测（每个快照日期一个点；同一快照被多个交易日回退使用时只算一次）。
 * 汇率 = 1 单位原币折合多少目标币，精确有理数（目标币对基准币的报价 ÷ 原币对基准币的报价）。
 */
export function rateObservations(lookups: ReadonlyMap<string, FxLookupLike>, currency: string, target: string): readonly { readonly date: string; readonly rate: DraftRational }[] {
  const byDate = new Map<string, DraftRational>();
  for (const lookup of lookups.values()) {
    if (lookup.status !== "available" || lookup.snapshot === undefined) continue;
    const from = lookup.snapshot.rates[currency];
    const to = lookup.snapshot.rates[target];
    if (from === undefined || to === undefined) continue;
    const numerator = decimalRational(to);
    const denominator = decimalRational(from);
    if (numerator === null || denominator === null || denominator.numerator === 0n) continue;
    byDate.set(lookup.snapshot.date, { numerator: numerator.numerator * denominator.denominator, denominator: numerator.denominator * denominator.numerator });
  }
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, rate]) => ({ date, rate }));
}

function decimalRational(text: string): DraftRational | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (match === null) return null;
  const decimals = match[2] ?? "";
  return { numerator: BigInt(`${match[1]!}${decimals}`), denominator: 10n ** BigInt(decimals.length) };
}

/** 有理数 → 定点小数文本（只用于显示，四舍五入）。 */
export function rationalText(value: DraftRational, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const rounded = roundRational({ numerator: value.numerator * scale, denominator: value.denominator });
  const negative = rounded < 0n;
  const digits = (negative ? -rounded : rounded).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fractionPart = decimals === 0 ? "" : `.${digits.slice(digits.length - decimals)}`;
  return `${negative ? "−" : ""}${whole}${fractionPart}`;
}
