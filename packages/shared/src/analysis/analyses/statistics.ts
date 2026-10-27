/**
 * A-3 — assembled results for the statistical and extreme analyses (owner
 * specification B08–B14, B17–B20).
 *
 * Same three inputs as the A-1/A-2 assemblers: already-authorised records,
 * the analysis definition and the resolved workbench state. Nothing here talks
 * to Prisma, HTTP, the FX network or the clock, and no authoritative value is
 * rounded: averages and ratios stay exact, extremes keep a deterministic tie
 * break, and a non-existent value is `null` — never `0`.
 */

import {
  countByKind,
  daysWithoutRecords,
  distinctRecordedDays,
  extremeRecord,
  medianMinor,
  peakDay,
  peakRecordedDay,
  totalsOf,
  type AnalysisEntry,
  type AnalysisKind,
} from "../primitives.js";
import {
  computationOf,
  countScalar,
  daysScalar,
  exactMoneyScalar,
  isBlocking,
  makeExtreme,
  makeScalar,
  moneyValueOf,
  prepareScope,
  ratioScalar,
  type WorkbenchState,
} from "../context.js";
import { ratioOf } from "../rational.js";
import type { AnalysisDefinition, RecordExtremeResult, ScalarResult } from "../types.js";

/* ------------------------------------------------------------------ *
 * B08 — median of the per-transaction expense amounts
 * ------------------------------------------------------------------ */

/**
 * B08 — 单笔支出中位数.
 *
 * The sample is the single transactions (not daily totals). Odd samples take
 * the middle amount; even samples take `(left + right) / 2`, which may be half
 * a minor unit — hence an `exact-money` scalar rather than a rounded amount.
 * Sorting is `bigint` comparison, never floating point.
 */
export function assembleMedianExpense(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  const scope = prepareScope(entries, definition, workbench, "expense");

  if (isBlocking(scope.completeness)) return makeScalar(definition, scope, null);

  const amounts = scope.entries.map((entry) => entry.amountMinor);
  const median = medianMinor(amounts);

  return makeScalar(
    definition,
    scope,
    median === null ? null : exactMoneyScalar(median, scope.currencyCode),
    computationOf({
      sampleCount: amounts.length,
      notes: [
        "median of per-transaction expense amounts",
        "even samples may land on half a minor unit; display rounds once",
      ],
    }),
  );
}

/* ------------------------------------------------------------------ *
 * B09/B10/B17 — the single largest / smallest record of one kind
 * ------------------------------------------------------------------ */

function assembleExtremeKind(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
  kind: AnalysisKind,
  direction: "max" | "min",
  notes: readonly string[],
): RecordExtremeResult {
  const scope = prepareScope(entries, definition, workbench, kind);
  const computation = computationOf({ notes });

  if (isBlocking(scope.completeness)) {
    return makeExtreme(definition, scope, "record", { extreme: null }, computation);
  }

  const extreme = extremeRecord(scope.entries, kind, direction);

  if (extreme === null) {
    return makeExtreme(definition, scope, "record", { extreme: null }, computation);
  }

  const { entry, tieCount } = extreme;

  /*
   * Record-level sources: the extreme carries the record id, and the source
   * descriptor lists it in `transactionIds`. Fetching the full record needs the
   * T2 read-only extension (A-Q17) — until it is approved this is only an
   * address, never a silent re-query.
   */
  return makeExtreme(
    definition,
    scope,
    "record",
    {
      extreme: moneyValueOf(entry.amountMinor, scope.currencyCode),
      occurredLocalDate: entry.occurredLocalDate,
      recordId: entry.id,
      categoryId: entry.categoryId,
      categoryLabel: entry.categoryName ?? null,
      paymentMethodLabel: entry.paymentMethodName ?? null,
      summary: null,
      tieCount,
      sourceRecordIds: [entry.id],
    },
    computationOf({
      sampleCount: countByKind(scope.entries, kind),
      tieCount,
      notes,
    }),
  );
}

/** B09 — 最大单笔支出. */
export function assembleMaxExpenseTransaction(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): RecordExtremeResult {
  return assembleExtremeKind(entries, definition, workbench, "expense", "max", [
    "largest expense transaction by exact amount",
    "tie break: amount desc, then business date ascending, then record id",
    "record source id included; record fetch pending T2 (A-Q17)",
  ]);
}

/**
 * B10 — 最小单笔支出.
 *
 * The default semantics are the minimum of the *valid expense transactions*
 * as stored. Refund / reversal / non-positive semantics are still pending the
 * data contract (A-Q3), so nothing is filtered out to force a "positive"
 * answer; a separate "最小正向支出" definition stays a candidate, not a
 * replacement of B10.
 */
export function assembleMinExpenseTransaction(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): RecordExtremeResult {
  return assembleExtremeKind(entries, definition, workbench, "expense", "min", [
    "smallest expense transaction by exact amount",
    "tie break: amount asc, then business date ascending, then record id",
    "refund / non-positive semantics pending data contract (A-Q3)",
    "record source id included; record fetch pending T2 (A-Q17)",
  ]);
}

/** B17 — 最大单笔收入. */
export function assembleMaxIncomeTransaction(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): RecordExtremeResult {
  return assembleExtremeKind(entries, definition, workbench, "income", "max", [
    "largest income transaction by exact amount",
    "tie break: amount desc, then business date ascending, then record id",
    "record source id included; record fetch pending T2 (A-Q17)",
  ]);
}

/* ------------------------------------------------------------------ *
 * B11/B12 — the peak business day by one kind's daily total
 * ------------------------------------------------------------------ */

function assemblePeakDay(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
  kind: AnalysisKind,
): RecordExtremeResult {
  const scope = prepareScope(entries, definition, workbench, kind);
  const notes = [
    kind === "expense"
      ? "peak of daily expense totals, grouped by business date"
      : "peak of daily income totals, grouped by business date",
    "count = records of this kind on the peak date; ties keep the earliest date",
  ];
  const computation = computationOf({ notes });

  if (isBlocking(scope.completeness)) {
    return makeExtreme(definition, scope, "day", { extreme: null }, computation);
  }

  const peak = peakDay(scope.entries, kind);

  if (peak === null) {
    return makeExtreme(definition, scope, "day", { extreme: null }, computation);
  }

  return makeExtreme(
    definition,
    scope,
    "day",
    {
      extreme: moneyValueOf(peak.totalMinor, scope.currencyCode),
      occurredLocalDate: peak.date,
      tieCount: peak.tieCount,
    },
    computationOf({
      sampleCount: peak.count,
      tieCount: peak.tieCount,
      notes,
    }),
  );
}

/** B11 — 最高单日支出 (total of the day, not the day of the largest record). */
export function assemblePeakExpenseDay(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): RecordExtremeResult {
  return assemblePeakDay(entries, definition, workbench, "expense");
}

/** B12 — 最高单日收入. */
export function assemblePeakIncomeDay(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): RecordExtremeResult {
  return assemblePeakDay(entries, definition, workbench, "income");
}

/* ------------------------------------------------------------------ *
 * B13/B14 — recorded days and days without expense records
 * ------------------------------------------------------------------ */

/**
 * B13 — 有支出记录天数: distinct business dates with at least one expense
 * record. Ten records on the same day count as one day; currencies never
 * multiply the day count. Missing rates do not erase a recorded day, but the
 * result's completeness still reports the FX state.
 */
export function assembleDaysWithExpenseRecords(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  const scope = prepareScope(entries, definition, workbench, "expense");

  if (isBlocking(scope.completeness)) return makeScalar(definition, scope, null);

  const days = distinctRecordedDays(scope.entries);

  return makeScalar(
    definition,
    scope,
    daysScalar(days),
    computationOf({
      sampleCount: days,
      notes: ["distinct business dates with at least one expense record"],
    }),
  );
}

/**
 * B14 — 无支出记录天数 = calendar days of the period − days with an expense
 * record.
 *
 * The label must stay "无支出记录天数": a day without records is not a day
 * without purchases (owner specification B14). The value is only trustworthy
 * when the period coverage is complete; incomplete coverage keeps its
 * completeness state and this computation adds an explicit note so a card can
 * never present it as a full-coverage statement.
 */
export function assembleDaysWithoutExpenseRecords(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  const scope = prepareScope(entries, definition, workbench, "expense");
  const notes = [
    "calendar days − days with at least one expense record",
    "a day without records is not a day without spending",
  ];

  if (isBlocking(scope.completeness)) {
    return makeScalar(
      definition,
      scope,
      null,
      computationOf({ denominatorDays: scope.period.dayCount, notes }),
    );
  }

  const days = daysWithoutRecords(scope.entries, scope.period.from, scope.period.to);
  const coverageNote =
    scope.completeness === "complete" || scope.completeness === "no-transactions"
      ? []
      : ["coverage incomplete: the value only describes the fetched data"];

  return makeScalar(
    definition,
    scope,
    daysScalar(days),
    computationOf({
      denominatorDays: scope.period.dayCount,
      notes: [...notes, ...coverageNote],
    }),
  );
}

/* ------------------------------------------------------------------ *
 * B18/B19 — ratios
 * ------------------------------------------------------------------ */

/**
 * B18 — 收支比: total expense ÷ total income, shown as a percentage and never
 * truncated at 100%. A zero (or negative) income denominator means the ratio
 * does not exist, so the value is `null`, not `0` or `∞`.
 */
export function assembleExpenseIncomeRatio(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  const scope = prepareScope(entries, definition, workbench, "both");

  if (isBlocking(scope.completeness)) return makeScalar(definition, scope, null);

  const totals = totalsOf(scope.entries);
  const ratio =
    totals.incomeMinor > 0n ? ratioOf(totals.expenseMinor, totals.incomeMinor) : null;

  return makeScalar(
    definition,
    scope,
    ratio === null ? null : ratioScalar(ratio, "percent-100"),
    computationOf({
      sampleCount: totals.count,
      notes: [
        "ExpenseIncomeRatio = total expense / total income",
        "income = 0 means the ratio does not exist (not 0 and not infinity)",
        "can exceed 100% when expense > income; never truncated",
        "not a budget usage rate (Libevra has no budget model)",
        `incomeMinor=${totals.incomeMinor.toString()}`,
        `expenseMinor=${totals.expenseMinor.toString()}`,
      ],
    }),
  );
}

/**
 * B19 — 账面结余比例: `(income − expense) / income`, which can be negative.
 *
 * It is deliberately not called a "savings rate": Libevra has no account,
 * transfer or asset/liability model, so this ratio is not a real cash saving
 * rate (owner specification B19, ACC-10).
 */
export function assembleLedgerSurplusRatio(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  const scope = prepareScope(entries, definition, workbench, "both");

  if (isBlocking(scope.completeness)) return makeScalar(definition, scope, null);

  const totals = totalsOf(scope.entries);
  const ratio =
    totals.incomeMinor > 0n ? ratioOf(totals.netMinor, totals.incomeMinor) : null;

  return makeScalar(
    definition,
    scope,
    ratio === null ? null : ratioScalar(ratio, "percent-100"),
    computationOf({
      sampleCount: totals.count,
      notes: [
        "LedgerSurplusRatio = (total income − total expense) / total income",
        "may be negative; zero income means the ratio does not exist",
        "not a savings rate: no account / transfer / asset model exists",
        `incomeMinor=${totals.incomeMinor.toString()}`,
        `expenseMinor=${totals.expenseMinor.toString()}`,
        `netMinor=${totals.netMinor.toString()}`,
      ],
    }),
  );
}

/* ------------------------------------------------------------------ *
 * B20 — the business day with the most recorded transactions
 * ------------------------------------------------------------------ */

/**
 * B20 — 交易记录最多的一天.
 *
 * Counts records per business date (income + expense by default), not money
 * and not "the day the app was used most". Ties keep the earliest date and
 * report `tieCount`; the result carries an explicit income/expense breakdown so
 * a card can explain what the peak was made of.
 */
export function assembleMostRecordedDay(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): RecordExtremeResult {
  const scope = prepareScope(entries, definition, workbench, "both");
  const notes = [
    "peak of per-business-date record counts (income + expense)",
    "count is a record count; ties keep the earliest date",
  ];
  const computation = computationOf({ notes });

  if (isBlocking(scope.completeness)) {
    return makeExtreme(definition, scope, "day", { extreme: null }, computation);
  }

  const peak = peakRecordedDay(scope.entries);

  if (peak === null) {
    return makeExtreme(definition, scope, "day", { extreme: null }, computation);
  }

  return makeExtreme(
    definition,
    scope,
    "day",
    {
      extreme: null,
      extremeValue: countScalar(peak.count),
      countBreakdown: {
        total: peak.count,
        income: peak.incomeCount,
        expense: peak.expenseCount,
      },
      occurredLocalDate: peak.date,
      tieCount: peak.tieCount,
    },
    computationOf({
      sampleCount: peak.count,
      tieCount: peak.tieCount,
      notes,
    }),
  );
}
