/**
 * S-01 draft — resolving an {@link AnalysisDefinition} into a runnable scope,
 * and the factories every result shape is built with.
 *
 * The flow is deliberately one-way (owner specification §3.5, §4.2):
 *
 *   workbench state (period, currency mode, data version)
 *        + definition (time override, filters)
 *        + records the query layer already authorised and fetched
 *        → resolved period / resolved filters / resolved currency
 *        → filtered records
 *        → result envelope
 *
 * Nothing here reads the clock, a database or a network. `today` is passed in
 * because it is the *phone's* calendar date; a server must never decide what
 * day it is for somebody else (`stats.ts` makes the same point).
 */

import { decimalsFor } from "../money.js";
import {
  addDays,
  daysBetween,
  MAX_STATS_DAYS,
  rangeForPreset,
  type StatsRangeKey,
} from "../stats.js";
import {
  assertSingleCurrency,
  entriesInRange,
  liveEntries,
  toMoneyValue,
  type AnalysisEntry,
  type AnalysisKind,
} from "./primitives.js";
import { ratioOf, type Ratio } from "./rational.js";
import type {
  AnalysisCompleteness,
  AnalysisDefinition,
  AnalysisResultBase,
  ComputationMetadata,
  CompositionPart,
  CompositionResult,
  MoneyValue,
  RankedGroup,
  RankedGroupsResult,
  RecordExtremeResult,
  ResolvedCurrency,
  ResolvedFilters,
  ResolvedPeriod,
  ScalarResult,
  ScalarValue,
  SourceDescriptor,
} from "./types.js";
import { ANALYSIS_PROTOCOL_VERSION, ANALYSIS_ROUNDING_POLICY } from "./types.js";

/** The default kind a definition falls back to when it does not filter kind. */
export type DefaultKind = AnalysisKind | "both";

/**
 * What the workbench (the page behind the card) already resolved.
 *
 * `period` is the inherited period; `currency` is the workbench currency mode
 * (a card may not override the currency in the first version — 规格 Q-16).
 */
export interface WorkbenchState {
  /** The period the card inherits when `time.mode` is `"inherit"`. */
  readonly period: ResolvedPeriod;
  /** The phone's calendar date, `YYYY-MM-DD`; only preset/relative need it. */
  readonly today: string;
  readonly currency: ResolvedCurrency;
  /** Data version shared by cards analysing the same definition (A-Q6). */
  readonly dataVersion?: string | null | undefined;
  /**
   * Data-layer completeness, when the caller knows better than the entries:
   * `fx-incomplete`, `offline-incomplete`, `partial`, `loading`,
   * `request-failed` or `no-permission`. Defaults to `"complete"`.
   */
  readonly completeness?: AnalysisCompleteness | undefined;
  readonly unavailableReason?: string | undefined;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Build a validated resolved period (inclusive business dates). */
export function makePeriod(from: string, to: string): ResolvedPeriod {
  if (!CALENDAR_DATE.test(from) || !CALENDAR_DATE.test(to)) {
    throw new RangeError(`calendar_date:${from}/${to}`);
  }

  if (from > to) throw new RangeError(`period_order:${from}/${to}`);

  const dayCount = daysBetween(from, to);

  if (dayCount > MAX_STATS_DAYS) {
    throw new RangeError(`period_too_long:${dayCount}>${MAX_STATS_DAYS}`);
  }

  return { from, to, dayCount };
}

/**
 * Resolve the period a definition asks for.
 *
 * `inherit` keeps the workbench period; `preset` expands the existing
 * `rangeForPreset` presets (ending today, inclusive); `fixed` requires both
 * dates; `relative` counts back from today, inclusive of today.
 */
export function resolveDefinitionPeriod(
  definition: Pick<AnalysisDefinition, "time">,
  workbench: Pick<WorkbenchState, "period" | "today">,
): ResolvedPeriod {
  const time = definition.time;

  if (time.mode === "inherit") {
    return makePeriod(workbench.period.from, workbench.period.to);
  }

  if (time.mode === "preset") {
    if (time.preset === undefined) throw new RangeError("preset_missing");
    const range = rangeForPreset(time.preset satisfies StatsRangeKey, workbench.today);
    return makePeriod(range.from, range.to);
  }

  if (time.mode === "fixed") {
    if (time.from === undefined || time.to === undefined) {
      throw new RangeError("fixed_period_missing");
    }
    return makePeriod(time.from, time.to);
  }

  // relative: `days` calendar days ending today (today counts as one day).
  if (time.days === undefined || !Number.isInteger(time.days) || time.days < 1) {
    throw new RangeError(`relative_days:${String(time.days)}`);
  }

  const from = addDays(workbench.today, -(time.days - 1));
  return makePeriod(from, workbench.today);
}

/**
 * Normalise a definition's filters.
 *
 * `null` means "not restricted"; `[]` means "restricted to nothing" — the two
 * are kept apart because they produce different source lists and must be
 * visible in the envelope.
 */
export function resolveFilters(
  definition: Pick<AnalysisDefinition, "filters">,
  input: { readonly defaultKind: DefaultKind; readonly currency: string | null },
): ResolvedFilters {
  const filters = definition.filters;

  return {
    kind: filters?.kind ?? input.defaultKind,
    categoryIds: filters?.categoryIds === undefined ? null : [...filters.categoryIds],
    paymentMethodIds:
      filters?.paymentMethodIds === undefined ? null : [...filters.paymentMethodIds],
    tagIds: filters?.tagIds === undefined ? null : [...filters.tagIds],
    currency: input.currency,
  };
}

/**
 * Apply the resolved filters to already-fetched records.
 *
 * The query layer is still responsible for book membership, permissions and
 * soft deletion; this is a **defensive second application** so the numbers can
 * never disagree with `resolvedFilters` (owner specification §3.7, ACC-08).
 */
export function filterEntries(
  entries: readonly AnalysisEntry[],
  filters: ResolvedFilters,
  period: ResolvedPeriod,
): AnalysisEntry[] {
  let filtered = entriesInRange(liveEntries(entries), period.from, period.to);

  if (filters.kind !== "both") {
    filtered = filtered.filter((entry) => entry.kind === filters.kind);
  }

  if (filters.categoryIds !== null) {
    const allowed = new Set(filters.categoryIds);
    filtered = filtered.filter((entry) => allowed.has(entry.categoryId));
  }

  if (filters.paymentMethodIds !== null) {
    const allowed = new Set(filters.paymentMethodIds);
    filtered = filtered.filter(
      (entry) =>
        typeof entry.paymentMethodId === "string" && allowed.has(entry.paymentMethodId),
    );
  }

  if (filters.tagIds !== null) {
    const allowed = new Set(filters.tagIds);
    filtered = filtered.filter((entry) =>
      (entry.tagIds ?? []).some((tagId) => allowed.has(tagId)),
    );
  }

  return filtered;
}

/** Data states in which no amount may be computed or rendered at all. */
const BLOCKING_STATES: ReadonlySet<AnalysisCompleteness> = new Set([
  "loading",
  "request-failed",
  "no-permission",
]);

/** True when the data layer says this scope must not be rendered as numbers. */
export function isBlocking(completeness: AnalysisCompleteness): boolean {
  return BLOCKING_STATES.has(completeness);
}

/** Everything an assembler needs, already resolved and filtered. */
export interface PreparedScope {
  readonly period: ResolvedPeriod;
  readonly filters: ResolvedFilters;
  readonly currency: ResolvedCurrency;
  readonly currencyCode: string;
  readonly entries: readonly AnalysisEntry[];
  readonly completeness: AnalysisCompleteness;
  readonly unavailableReason: string | null;
  readonly dataVersion: string | null;
}

/**
 * Resolve + filter in one step.
 *
 * `entries` must be the *complete* set the query layer returned for the period
 * (not a paginated page). Pagination belongs to display; a statistic computed
 * from page one of three is a wrong number, not a partial one.
 */
export function prepareScope(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
  defaultKind: DefaultKind,
): PreparedScope {
  const period = resolveDefinitionPeriod(definition, workbench);
  const expectedCurrency =
    workbench.currency.mode === "original"
      ? workbench.currency.currency
      : workbench.currency.targetCurrency;
  const filters = resolveFilters(definition, {
    defaultKind,
    currency: workbench.currency.mode === "original" ? workbench.currency.currency : null,
  });
  const filtered = filterEntries(entries, filters, period);

  const single = assertSingleCurrency(filtered);

  if (single !== null && single !== expectedCurrency) {
    throw new RangeError(`currency_mismatch:${single}!=${expectedCurrency}`);
  }

  const dataCompleteness = workbench.completeness ?? "complete";
  const completeness: AnalysisCompleteness = isBlocking(dataCompleteness)
    ? dataCompleteness
    : dataCompleteness === "complete" && filtered.length === 0
      ? "no-transactions"
      : dataCompleteness;

  return {
    period,
    filters,
    currency: workbench.currency,
    currencyCode: expectedCurrency,
    entries: filtered,
    completeness,
    unavailableReason:
      workbench.unavailableReason ??
      (completeness === "no-transactions" ? "no_matching_transactions" : null),
    dataVersion: workbench.dataVersion ?? null,
  };
}

/** Computation metadata with the protocol rounding policy already set. */
export function computationOf(
  partial: Omit<ComputationMetadata, "rounding"> = {},
): ComputationMetadata {
  return { rounding: ANALYSIS_ROUNDING_POLICY, ...partial };
}

/** A `MoneyValue` from an exact minor-unit integer. */
export function moneyValueOf(amountMinor: bigint, currency: string): MoneyValue {
  return toMoneyValue(amountMinor, currency);
}

/** A money scalar. Negative net amounts keep their sign (B03, B19). */
export function moneyScalar(amountMinor: bigint, currency: string): ScalarValue {
  return { kind: "money", money: moneyValueOf(amountMinor, currency) };
}

/**
 * A money value whose amount may sit between two minor units (B06/B07).
 * The exact fraction is kept; only the display layer rounds it.
 */
export function exactMoneyScalar(ratio: Ratio, currency: string): ScalarValue {
  return {
    kind: "exact-money",
    numeratorMinor: ratio.numerator.toString(),
    denominator: ratio.denominator.toString(),
    currency,
    decimals: decimalsFor(currency),
  };
}

/** A ratio scalar with its display scale declared. */
export function ratioScalar(
  ratio: Ratio,
  scale: "percent-100" | "fraction" = "fraction",
): ScalarValue {
  return { kind: "ratio", ratio, scale };
}

/** An integer count scalar. */
export function countScalar(count: number): ScalarValue {
  return { kind: "count", count };
}

/** Days scalar. */
export function daysScalar(days: number): ScalarValue {
  return { kind: "days", days };
}

/** The source address every result carries (owner specification §3.7). */
export function sourceOf(
  definition: AnalysisDefinition,
  scope: PreparedScope,
  groupBy: string | null,
  transactionIds?: readonly string[],
): SourceDescriptor {
  const categoryIds = scope.filters.categoryIds;
  const paymentMethodIds = scope.filters.paymentMethodIds;

  return {
    analysisId: definition.analysisId,
    period: scope.period,
    filters: scope.filters,
    groupBy,
    query: {
      kind: "transactions",
      from: scope.period.from,
      to: scope.period.to,
      currency: scope.filters.currency,
      ...(categoryIds !== null && categoryIds.length === 1
        ? { categoryId: categoryIds[0] }
        : {}),
      ...(paymentMethodIds !== null && paymentMethodIds.length === 1
        ? { paymentMethodId: paymentMethodIds[0] }
        : {}),
    },
    ...(transactionIds === undefined ? {} : { transactionIds }),
    dataVersion: scope.dataVersion,
  };
}

/** The envelope fields shared by all four shapes. */
export function makeBase(
  definition: AnalysisDefinition,
  scope: PreparedScope,
  groupBy: string | null,
  computation: ComputationMetadata,
  transactionIds?: readonly string[],
): AnalysisResultBase {
  return {
    version: ANALYSIS_PROTOCOL_VERSION,
    analysisId: definition.analysisId,
    analysisType: definition.analysisType,
    metric: definition.metric,
    resolvedFilters: scope.filters,
    resolvedPeriod: scope.period,
    resolvedCurrency: scope.currency,
    completeness: scope.completeness,
    ...(scope.unavailableReason === null
      ? {}
      : { unavailableReason: scope.unavailableReason }),
    dataVersion: scope.dataVersion,
    computation,
    source: sourceOf(definition, scope, groupBy, transactionIds),
  };
}

/** A `scalar` result. `value: null` means "cannot be determined". */
export function makeScalar(
  definition: AnalysisDefinition,
  scope: PreparedScope,
  value: ScalarValue | null,
  computation: ComputationMetadata = computationOf(),
): ScalarResult {
  return {
    ...makeBase(definition, scope, null, computation),
    shape: "scalar",
    value,
  };
}

/** A `ranked-groups` result. */
export function makeRankedGroups(
  definition: AnalysisDefinition,
  scope: PreparedScope,
  groups: readonly RankedGroup[],
  computation: ComputationMetadata = computationOf(),
  foldedGroupIds?: readonly string[],
): RankedGroupsResult {
  return {
    ...makeBase(definition, scope, definition.groupBy ?? "category", computation),
    shape: "ranked-groups",
    groups,
    ...(foldedGroupIds === undefined ? {} : { foldedGroupIds }),
  };
}

/** A `composition` result. A `null` total forbids drawing 100% of anything. */
export function makeComposition(
  definition: AnalysisDefinition,
  scope: PreparedScope,
  total: MoneyValue | null,
  parts: readonly CompositionPart[],
  computation: ComputationMetadata = computationOf(),
  foldedGroupIds?: readonly string[],
): CompositionResult {
  return {
    ...makeBase(definition, scope, definition.groupBy ?? "category", computation),
    shape: "composition",
    total,
    parts,
    ...(foldedGroupIds === undefined ? {} : { foldedGroupIds }),
  };
}

/** An empty `record-extreme` result, used for empty/blocked scopes. */
export function makeEmptyExtreme(
  definition: AnalysisDefinition,
  scope: PreparedScope,
  computation: ComputationMetadata = computationOf(),
): RecordExtremeResult {
  return {
    ...makeBase(definition, scope, definition.groupBy ?? null, computation),
    shape: "record-extreme",
    extreme: null,
    occurredLocalDate: null,
    recordId: null,
    categoryId: null,
    categoryLabel: null,
    paymentMethodLabel: null,
    summary: null,
    tieCount: 0,
  };
}

/** Build a definition with the protocol version and first-version currency mode. */
export function makeDefinition(
  input: Omit<AnalysisDefinition, "version" | "currency"> & {
    readonly currency?: AnalysisDefinition["currency"] | undefined;
  },
): AnalysisDefinition {
  return {
    version: ANALYSIS_PROTOCOL_VERSION,
    ...input,
    currency: input.currency ?? { mode: "inherit" },
  };
}

/** `amount / total` as an exact share, `null` when the total is zero. */
export function shareOf(amount: bigint, total: bigint): Ratio | null {
  return ratioOf(amount, total);
}
