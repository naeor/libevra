/**
 * S-01 draft — calculation primitives shared by every basic analysis.
 *
 * These functions are pure: they receive the records a query layer already
 * filtered for book membership, soft deletion and permissions, and they only
 * group and sum. They deliberately do **not** talk to Prisma, HTTP or the FX
 * network — that keeps the finance maths unit-testable without a database and
 * keeps a chart adapter from ever owning a number (owner specification §3.1,
 * §20.1).
 *
 * Amounts are `bigint` minor units. A year of large entries can exceed
 * `Number.MAX_SAFE_INTEGER` in the minor unit (sample G), so no primitive
 * converts an authoritative amount to `number`.
 *
 * The caller must pass entries of a single currency. `assertSingleCurrency`
 * enforces the owner's rule that original amounts never get added across
 * currencies; aggregated results arrive already converted per record by the
 * existing FX engine.
 */

import { decimalsFor } from "../money.js";
import { daysBetween } from "../stats.js";
import { formatMinorExact, ratioOf, type Ratio } from "./rational.js";
import type { MoneyValue } from "./types.js";

export type AnalysisKind = "expense" | "income";

/**
 * The record shape the primitives consume.
 *
 * A deliberate copy of the fields the analyses need from `transactionSchema`,
 * not a re-declaration of the database row: quantities that depend on FX go
 * into `amountMinor` **after** per-record conversion (or stay in the original
 * currency), so the same primitive works for both currency modes without
 * knowing about FX.
 */
export interface AnalysisEntry {
  readonly id: string;
  readonly kind: AnalysisKind;
  /**
   * Effective amount: the original minor amount in `currency`, or the
   * per-record converted minor amount when the result is an aggregate.
   */
  readonly amountMinor: bigint;
  /** Effective currency of `amountMinor`. */
  readonly currency: string;
  /** Business date (`occurredLocalDate`), `YYYY-MM-DD`. */
  readonly occurredLocalDate: string;
  readonly categoryId: string;
  readonly categoryName?: string | undefined;
  readonly categoryIsSystem?: boolean | undefined;
  readonly paymentMethodId?: string | null | undefined;
  readonly paymentMethodName?: string | null | undefined;
  /** Soft-deleted records are never part of a statistic. */
  readonly deletedAt?: string | null | undefined;
}

/** Group id for "no payment method recorded" — a real state, not an error. */
export const UNSPECIFIED_PAYMENT_METHOD_ID = "__unspecified_payment_method__";

/** Display label for {@link UNSPECIFIED_PAYMENT_METHOD_ID}. */
export const UNSPECIFIED_PAYMENT_METHOD_LABEL = "未指定";

/** Totals of a filtered record set. */
export interface KindTotals {
  readonly expenseMinor: bigint;
  readonly incomeMinor: bigint;
  readonly netMinor: bigint;
  readonly expenseCount: number;
  readonly incomeCount: number;
  readonly count: number;
}

/** Aggregated amount per category. */
export interface CategoryAmount {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly isSystem: boolean;
  readonly amountMinor: bigint;
  readonly count: number;
}

/** Aggregated amount per payment method (`null` id = unspecified). */
export interface PaymentMethodAmount {
  readonly paymentMethodId: string | null;
  readonly paymentMethodName: string;
  readonly amountMinor: bigint;
  readonly count: number;
}

/** Per-business-date totals used by heat-map style analyses. */
export interface DayTotal {
  readonly date: string;
  readonly expenseMinor: bigint;
  readonly incomeMinor: bigint;
  readonly expenseCount: number;
  readonly incomeCount: number;
  readonly count: number;
}

/** Highest business date by one kind's total. */
export interface PeakDay {
  readonly date: string;
  readonly totalMinor: bigint;
  readonly count: number;
  /** Number of days sharing the peak value — never let refresh order decide. */
  readonly tieCount: number;
}

/** One extreme record plus how many records tie with it. */
export interface ExtremeRecord {
  readonly entry: AnalysisEntry;
  readonly tieCount: number;
}

/**
 * Soft-deleted and restored-after-delete records are excluded by the same rule
 * the rest of the app uses: `deletedAt` non-null means gone from statistics.
 */
export function isLive(entry: AnalysisEntry): boolean {
  return entry.deletedAt === null || entry.deletedAt === undefined;
}

/** The records that count toward a statistic. */
export function liveEntries(entries: readonly AnalysisEntry[]): AnalysisEntry[] {
  return entries.filter(isLive);
}

/** Records whose business date falls inside `[from, to]` (inclusive). */
export function entriesInRange(
  entries: readonly AnalysisEntry[],
  from: string,
  to: string,
): AnalysisEntry[] {
  return entries.filter(
    (entry) => entry.occurredLocalDate >= from && entry.occurredLocalDate <= to,
  );
}

/**
 * The single currency of a record set.
 *
 * Returns `null` for an empty set. Throws when the set mixes currencies —
 * adding CNY and USD minor amounts would be a silent lie, and a thrown error
 * in a pure function is easier to catch in review than a wrong number in a
 * chart (owner specification §3.4).
 */
export function assertSingleCurrency(entries: readonly AnalysisEntry[]): string | null {
  const currencies = new Set(entries.map((entry) => entry.currency));

  if (currencies.size === 0) return null;
  if (currencies.size > 1) {
    throw new RangeError(`mixed_currency:${[...currencies].sort().join(",")}`);
  }

  return [...currencies][0] ?? null;
}

/** Sum of minor amounts; exists so callers never reach for `+` on `number`. */
export function sumMinorExact(amounts: readonly bigint[]): bigint {
  let total = 0n;

  for (const amount of amounts) total += amount;

  return total;
}

/** Sum of one kind's live records, in their single currency. */
export function sumByKind(entries: readonly AnalysisEntry[], kind: AnalysisKind): bigint {
  const live = liveEntries(entries);
  assertSingleCurrency(live);

  return sumMinorExact(live.filter((entry) => entry.kind === kind).map((entry) => entry.amountMinor));
}

/** Number of one kind's live records. */
export function countByKind(entries: readonly AnalysisEntry[], kind: AnalysisKind): number {
  return liveEntries(entries).filter((entry) => entry.kind === kind).length;
}

/** Totals of a live record set: the B01–B03 building block. */
export function totalsOf(entries: readonly AnalysisEntry[]): KindTotals {
  const live = liveEntries(entries);
  assertSingleCurrency(live);

  let expenseMinor = 0n;
  let incomeMinor = 0n;
  let expenseCount = 0;
  let incomeCount = 0;

  for (const entry of live) {
    if (entry.kind === "expense") {
      expenseMinor += entry.amountMinor;
      expenseCount += 1;
    } else {
      incomeMinor += entry.amountMinor;
      incomeCount += 1;
    }
  }

  return {
    expenseMinor,
    incomeMinor,
    netMinor: incomeMinor - expenseMinor,
    expenseCount,
    incomeCount,
    count: expenseCount + incomeCount,
  };
}

/**
 * `total / count` as an exact fraction.
 *
 * `null` when there is nothing to divide by: an average over zero records does
 * not exist (owner specification B07); it is not `0` and must not be shown as
 * `0 元`.
 */
export function averageMinor(total: bigint, count: number): Ratio | null {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("count");
  }

  return ratioOf(total, BigInt(count));
}

/** Sum of several categories' totals (used to prove composition totals). */
export function sumCategoryAmounts(groups: readonly CategoryAmount[]): bigint {
  return sumMinorExact(groups.map((group) => group.amountMinor));
}

/**
 * Median of per-record amounts, exactly (owner specification B08).
 *
 * Odd samples: the middle value. Even samples: the arithmetic mean of the two
 * middle values — which may be half a minor unit, so the answer is a `Ratio`
 * rather than a rounded amount. Sorting uses `bigint` comparison, never floats.
 */
export function medianMinor(amounts: readonly bigint[]): Ratio | null {
  if (amounts.length === 0) return null;

  const sorted = [...amounts].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    const value = sorted[middle];
    if (value === undefined) throw new Error("unreachable_median");
    return ratioOf(value, 1n);
  }

  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) throw new Error("unreachable_median");

  return ratioOf(left + right, 2n);
}

/** Distinct business dates that have at least one live record. */
export function distinctRecordedDays(entries: readonly AnalysisEntry[]): number {
  return new Set(liveEntries(entries).map((entry) => entry.occurredLocalDate)).size;
}

/**
 * Calendar days inside the period with **no recorded** transactions of the
 * given set (owner specification B14).
 *
 * This is a statement about the recording, never about spending: a day without
 * records is not a day without purchases. It is only trustworthy when the
 * period's data coverage is complete; the caller decides that and must not
 * render it otherwise.
 */
export function daysWithoutRecords(
  entries: readonly AnalysisEntry[],
  from: string,
  to: string,
): number {
  const calendarDays = daysBetween(from, to);

  return Math.max(0, calendarDays - distinctRecordedDays(entriesInRange(entries, from, to)));
}

/**
 * Per-category totals for one kind, sorted by amount descending then by
 * category id — a deterministic order that does not depend on map insertion,
 * locale or refresh order (owner specification I03 sort rule).
 */
export function categoryTotals(
  entries: readonly AnalysisEntry[],
  kind: AnalysisKind,
): CategoryAmount[] {
  const groups = new Map<string, { name: string; isSystem: boolean; amountMinor: bigint; count: number }>();

  for (const entry of liveEntries(entries)) {
    if (entry.kind !== kind) continue;

    const current = groups.get(entry.categoryId);

    if (current === undefined) {
      groups.set(entry.categoryId, {
        name: entry.categoryName ?? entry.categoryId,
        isSystem: entry.categoryIsSystem === true,
        amountMinor: entry.amountMinor,
        count: 1,
      });
    } else {
      current.amountMinor += entry.amountMinor;
      current.count += 1;
      if (entry.categoryIsSystem === true) current.isSystem = true;
      // Keep the first seen name: the query layer already maps current names.
      if (current.name === entry.categoryId && entry.categoryName !== undefined) {
        current.name = entry.categoryName;
      }
    }
  }

  return [...groups.entries()]
    .map(([categoryId, group]) => ({
      categoryId,
      categoryName: group.name,
      isSystem: group.isSystem,
      amountMinor: group.amountMinor,
      count: group.count,
    }))
    .sort((left, right) => {
      if (left.amountMinor !== right.amountMinor) {
        return left.amountMinor > right.amountMinor ? -1 : 1;
      }

      return left.categoryId < right.categoryId ? -1 : left.categoryId > right.categoryId ? 1 : 0;
    });
}

/**
 * Per-payment-method totals for one kind (owner specification I17).
 *
 * `paymentMethodId === null` is the honest "未指定" group; it is not dropped
 * and not folded into another method.
 */
export function paymentMethodTotals(
  entries: readonly AnalysisEntry[],
  kind: AnalysisKind,
): PaymentMethodAmount[] {
  const groups = new Map<string | null, { name: string; amountMinor: bigint; count: number }>();

  for (const entry of liveEntries(entries)) {
    if (entry.kind !== kind) continue;

    const key = entry.paymentMethodId ?? null;
    const current = groups.get(key);

    if (current === undefined) {
      groups.set(key, {
        name: key === null ? UNSPECIFIED_PAYMENT_METHOD_LABEL : (entry.paymentMethodName ?? key),
        amountMinor: entry.amountMinor,
        count: 1,
      });
    } else {
      current.amountMinor += entry.amountMinor;
      current.count += 1;
    }
  }

  return [...groups.entries()]
    .map(([paymentMethodId, group]) => ({
      paymentMethodId,
      paymentMethodName: group.name,
      amountMinor: group.amountMinor,
      count: group.count,
    }))
    .sort((left, right) => {
      if (left.amountMinor !== right.amountMinor) {
        return left.amountMinor > right.amountMinor ? -1 : 1;
      }

      const leftKey = left.paymentMethodId ?? "\uffff";
      const rightKey = right.paymentMethodId ?? "\uffff";

      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

/** Per-business-date totals, ascending by date. */
export function dayTotals(entries: readonly AnalysisEntry[]): DayTotal[] {
  const groups = new Map<string, { expenseMinor: bigint; incomeMinor: bigint; expenseCount: number; incomeCount: number }>();

  for (const entry of liveEntries(entries)) {
    const current = groups.get(entry.occurredLocalDate);

    if (current === undefined) {
      groups.set(entry.occurredLocalDate, {
        expenseMinor: entry.kind === "expense" ? entry.amountMinor : 0n,
        incomeMinor: entry.kind === "income" ? entry.amountMinor : 0n,
        expenseCount: entry.kind === "expense" ? 1 : 0,
        incomeCount: entry.kind === "income" ? 1 : 0,
      });
    } else if (entry.kind === "expense") {
      current.expenseMinor += entry.amountMinor;
      current.expenseCount += 1;
    } else {
      current.incomeMinor += entry.amountMinor;
      current.incomeCount += 1;
    }
  }

  return [...groups.entries()]
    .map(([date, group]) => ({
      date,
      expenseMinor: group.expenseMinor,
      incomeMinor: group.incomeMinor,
      expenseCount: group.expenseCount,
      incomeCount: group.incomeCount,
      count: group.expenseCount + group.incomeCount,
    }))
    .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
}

/**
 * The business date with the highest total for one kind (owner specification
 * B11/B12).
 *
 * The comparison is between *daily totals*, not between single records: a day
 * with three medium purchases can beat a day with one large one.
 */
export function peakDay(entries: readonly AnalysisEntry[], kind: AnalysisKind): PeakDay | null {
  const days = dayTotals(entries);

  let peak: PeakDay | null = null;

  for (const day of days) {
    const totalMinor = kind === "expense" ? day.expenseMinor : day.incomeMinor;

    if (peak === null || totalMinor > peak.totalMinor) {
      peak = {
        date: day.date,
        totalMinor,
        count: kind === "expense" ? day.expenseCount : day.incomeCount,
        tieCount: 1,
      };
    } else if (totalMinor === peak.totalMinor) {
      peak = {
        date: peak.date,
        totalMinor: peak.totalMinor,
        count: peak.count,
        tieCount: peak.tieCount + 1,
      };
    }
  }

  return peak;
}

/**
 * One extreme record (owner specification B09/B10/B17/B20).
 *
 * Deterministic tie handling: amount first, then business date ascending, then
 * record id. `tieCount` reports how many records share the extreme amount, so a
 * UI can say "并列 2 笔" instead of silently picking one and changing on
 * refresh.
 */
export function extremeRecord(
  entries: readonly AnalysisEntry[],
  kind: AnalysisKind,
  direction: "max" | "min",
): ExtremeRecord | null {
  const candidates = liveEntries(entries).filter((entry) => entry.kind === kind);

  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((left, right) => {
    if (left.amountMinor !== right.amountMinor) {
      const ascending = left.amountMinor < right.amountMinor ? -1 : 1;
      return direction === "max" ? -ascending : ascending;
    }

    if (left.occurredLocalDate !== right.occurredLocalDate) {
      return left.occurredLocalDate < right.occurredLocalDate ? -1 : 1;
    }

    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const first = sorted[0];
  if (first === undefined) return null;

  const tieCount = sorted.filter((entry) => entry.amountMinor === first.amountMinor).length;

  return { entry: first, tieCount };
}

/**
 * Fold everything past the top `maxParts - 1` into a display-only remainder
 * (owner specification I01 "其他" rules).
 *
 * Folding never drops amounts: `kept` and `folded` together are `items`, so a
 * chart can show "其他" whose amount equals the exact sum of its members and
 * whose source trace covers them. The caller decides the label and must keep
 * the folded ids for the source descriptor.
 */
export function foldRemainder<T extends { readonly id: string; readonly amountMinor: bigint }>(
  items: readonly T[],
  maxParts: number,
): { kept: T[]; folded: T[] } {
  if (!Number.isInteger(maxParts) || maxParts < 1) {
    throw new RangeError("maxParts");
  }

  if (items.length <= maxParts) {
    return { kept: [...items], folded: [] };
  }

  if (maxParts === 1) {
    return { kept: [], folded: [...items] };
  }

  const sorted = [...items].sort((left, right) => {
    if (left.amountMinor !== right.amountMinor) {
      return left.amountMinor > right.amountMinor ? -1 : 1;
    }

    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  return {
    kept: sorted.slice(0, maxParts - 1),
    folded: sorted.slice(maxParts - 1),
  };
}

/** A `MoneyValue` with the currency's minor-unit scale. */
export function toMoneyValue(amountMinor: bigint, currency: string): MoneyValue {
  return {
    amountMinor: amountMinor.toString(),
    currency,
    decimals: decimalsFor(currency),
  };
}

/** A display string for an amount, exact for any magnitude. */
export function formatMoneyForDisplay(amountMinor: bigint, currency: string): string {
  return formatMinorExact(amountMinor, decimalsFor(currency));
}
