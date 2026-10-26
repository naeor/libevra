/**
 * A-1 — assembled results for the basic scalar analyses (owner specification
 * B01–B07, A-1: "核心基础计算 + 数值卡").
 *
 * Every function takes three things:
 *
 *  * `entries` — the complete record set the query layer fetched for the
 *    period after book-membership, permission and soft-delete filtering;
 *  * `definition` — what the card asks for (kind, time override, filters);
 *  * `workbench` — the page's resolved period/currency/data version.
 *
 * and returns the S-01 envelope. No function talks to Prisma, HTTP or the FX
 * network, and none rounds an authoritative value: averages stay exact
 * fractions so a numeric card can label them without ever owning the number.
 */

import {
  averageMinor,
  countByKind,
  totalsOf,
  type AnalysisEntry,
  type AnalysisKind,
} from "../primitives.js";
import {
  computationOf,
  countScalar,
  exactMoneyScalar,
  isBlocking,
  makeScalar,
  moneyScalar,
  prepareScope,
  type WorkbenchState,
} from "../context.js";
import type { AnalysisDefinition, ScalarResult } from "../types.js";

/**
 * B01 / B02 — total expense or income.
 *
 * Built from exact integer sums; an empty scope is a *real* zero with the
 * `no-transactions` completeness state, never a fabricated amount.
 */
function assembleKindAmount(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
  kind: AnalysisKind,
  metric: "expenseMinor" | "incomeMinor",
): ScalarResult {
  const scope = prepareScope(entries, definition, workbench, kind);

  if (isBlocking(scope.completeness)) return makeScalar(definition, scope, null);

  const totals = totalsOf(scope.entries);
  const amount = metric === "expenseMinor" ? totals.expenseMinor : totals.incomeMinor;
  const count = metric === "expenseMinor" ? totals.expenseCount : totals.incomeCount;

  return makeScalar(
    definition,
    scope,
    moneyScalar(amount, scope.currencyCode),
    computationOf({ sampleCount: count }),
  );
}

/** B01 — total expense (Σ of the qualifying expense amounts). */
export function assembleTotalExpense(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  return assembleKindAmount(entries, definition, workbench, "expense", "expenseMinor");
}

/** B02 — total income. */
export function assembleTotalIncome(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  return assembleKindAmount(entries, definition, workbench, "income", "incomeMinor");
}

/**
 * B03 — 账目收支差额: `total income − total expense`, with a sign.
 *
 * It is deliberately not named "balance", "assets" or "net worth": Libevra has
 * no account balance model (owner specification B03, ACC-10). A negative value
 * is a valid answer and keeps its sign; it is never `abs()`-ed.
 */
export function assembleNetAmount(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  const scope = prepareScope(entries, definition, workbench, "both");

  if (isBlocking(scope.completeness)) return makeScalar(definition, scope, null);

  const totals = totalsOf(scope.entries);

  return makeScalar(
    definition,
    scope,
    moneyScalar(totals.netMinor, scope.currencyCode),
    computationOf({
      sampleCount: totals.count,
      notes: [
        `incomeMinor=${totals.incomeMinor.toString()}`,
        `expenseMinor=${totals.expenseMinor.toString()}`,
        "net = income - expense",
      ],
    }),
  );
}

/** B04 — expense transaction count (an integer, never a category count). */
export function assembleExpenseCount(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  const scope = prepareScope(entries, definition, workbench, "expense");

  if (isBlocking(scope.completeness)) return makeScalar(definition, scope, null);

  const count = countByKind(scope.entries, "expense");

  return makeScalar(
    definition,
    scope,
    countScalar(count),
    computationOf({ sampleCount: count }),
  );
}

/** B05 — income transaction count. */
export function assembleIncomeCount(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  const scope = prepareScope(entries, definition, workbench, "income");

  if (isBlocking(scope.completeness)) return makeScalar(definition, scope, null);

  const count = countByKind(scope.entries, "income");

  return makeScalar(
    definition,
    scope,
    countScalar(count),
    computationOf({ sampleCount: count }),
  );
}

/**
 * B06 — 日均支出: total expense ÷ **calendar days of the resolved period**.
 *
 * The denominator is the number of dates in the period, not the number of days
 * that happened to have a transaction (owner specification B06: 10 days, 500
 * spent, 2 days with records → 50 per day). The quotient is kept exact; a
 * display layer rounds once.
 */
export function assembleDailyAverageExpense(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  const scope = prepareScope(entries, definition, workbench, "expense");

  const computation = computationOf({
    denominatorDays: scope.period.dayCount,
    notes: ["denominator = calendar days in the resolved period"],
  });

  if (isBlocking(scope.completeness)) return makeScalar(definition, scope, null, computation);

  const totals = totalsOf(scope.entries);
  const average = averageMinor(totals.expenseMinor, scope.period.dayCount);

  return makeScalar(
    definition,
    scope,
    average === null ? null : exactMoneyScalar(average, scope.currencyCode),
    computationOf({
      numeratorMinor: totals.expenseMinor.toString(),
      denominatorDays: scope.period.dayCount,
      notes: ["denominator = calendar days in the resolved period"],
    }),
  );
}

/**
 * B07 — 单笔平均支出: total expense ÷ expense transaction count.
 *
 * Zero expense records means "no average exists" (`null`), not "0 元"
 * (owner specification B07). The exact quotient stays a fraction.
 */
export function assembleAverageExpensePerTransaction(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): ScalarResult {
  const scope = prepareScope(entries, definition, workbench, "expense");

  if (isBlocking(scope.completeness)) return makeScalar(definition, scope, null);

  const totals = totalsOf(scope.entries);
  const average = averageMinor(totals.expenseMinor, totals.expenseCount);

  return makeScalar(
    definition,
    scope,
    average === null ? null : exactMoneyScalar(average, scope.currencyCode),
    computationOf({
      numeratorMinor: totals.expenseMinor.toString(),
      denominator: totals.expenseCount,
      notes: ["denominator = expense transactions"],
    }),
  );
}
