/**
 * S-01 draft — the shared analysis result protocol (2026-10-27).
 *
 * Registered by Agent A for review by Lead, Claude, Agent B, Agent C and
 * Agent D. **Not frozen yet** (`ANALYSIS_PROTOCOL_VERSION`). The owner's
 * specification §4 asks for one result envelope that every layer can pass
 * around without re-deriving finance:
 *
 *   query → calculation (exact) → result envelope → chart adapter → component
 *
 * The envelope answers five questions a bare number cannot: which filters were
 * really applied, which period was really used, which currency/aggregation
 * produced the number, how complete the data is, and where the user can see
 * the source records.
 *
 * Rules encoded here (owner specification §3, §4, §20):
 *  * amounts are exact integers in the minor unit, serialised as decimal
 *    strings so no `bigint` ever crosses JSON;
 *  * a share/average is an exact fraction, not a float;
 *  * "no transactions" and "cannot be determined" are different states;
 *  * a result that cannot be trusted carries an `unavailableReason` instead of
 *    a plausible-looking number.
 */

import type { Ratio } from "./rational.js";

/**
 * Version of the result protocol itself.
 *
 * Bumped when a shape changes in a way that breaks consumers. The owner's
 * specification allows the draft to be extended (time series, distribution,
 * matrix) without breaking scalar/grouped results.
 */
export const ANALYSIS_PROTOCOL_VERSION = "s01-draft";

/** Rounding direction of every authoritative amount in this protocol. */
export const ANALYSIS_ROUNDING_POLICY = "minor-half-away-v1";

/**
 * Currency handling of a result.
 *
 * `original`: every amount is in one original currency; cross-currency
 * addition never happened (owner specification §3.4).
 * `aggregate`: the source entries were converted per record by the existing
 * FX engine and summed in `targetCurrency`; completeness tells whether every
 * record could be converted.
 */
export type ResolvedCurrency =
  | { readonly mode: "original"; readonly currency: string }
  | { readonly mode: "aggregate"; readonly targetCurrency: string };

/**
 * The period the calculation really used, resolved from the card's inherited
 * period (owner specification §3.5).
 *
 * `from`/`to` are inclusive business dates (`occurredLocalDate` semantics).
 * The database query behind them is half-open `[from, to + 1 day)`; the UI and
 * the source list use the inclusive pair so "10 days" means ten dates.
 */
export interface ResolvedPeriod {
  readonly from: string;
  readonly to: string;
  /** Number of calendar days, both ends counted. */
  readonly dayCount: number;
}

/**
 * The filters the calculation really applied.
 *
 * `null` means "not restricted by this dimension"; `[]` means "restricted to
 * nothing" — the two are not interchangeable, which is why an empty array is
 * kept instead of collapsing to null.
 */
export interface ResolvedFilters {
  readonly kind: "expense" | "income" | "both";
  readonly categoryIds: readonly string[] | null;
  readonly paymentMethodIds: readonly string[] | null;
  readonly tagIds: readonly string[] | null;
  /** Original currency used for the query, or `null` for aggregate mode. */
  readonly currency: string | null;
}

/** An exact amount in a currency's minor unit. */
export interface MoneyValue {
  /** Decimal string of the integer minor amount — never a JS float. */
  readonly amountMinor: string;
  readonly currency: string;
  /** Minor-unit decimals of `currency` (JPY is 0, most are 2). */
  readonly decimals: number;
}

/**
 * Completeness of the underlying data (owner specification §3.6).
 *
 * Deliberately not a boolean: "zero because nothing was recorded" and "zero
 * because data is missing" must never look the same. Consumers decide whether
 * they may render a number, a partial-results hint or an empty state.
 */
export type AnalysisCompleteness =
  | "complete"
  | "no-transactions"
  | "partial"
  | "fx-incomplete"
  | "offline-incomplete"
  | "loading"
  | "request-failed"
  | "no-permission"
  | "not-applicable";

/**
 * A scalar value that is meaningful without interpretation.
 *
 * Ratios are exact fractions (`Ratio`) with an explicit `scale`; counts and
 * days are integers. The envelope never carries a rounded float, because the
 * display layer is the only place allowed to round.
 */
export type ScalarValue =
  | { readonly kind: "money"; readonly money: MoneyValue }
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "days"; readonly days: number }
  | { readonly kind: "ratio"; readonly ratio: Ratio; readonly scale: "percent-100" | "fraction" };

/** Optional comparison against the comparable previous period. */
export interface ComparisonValue {
  readonly range: { readonly from: string; readonly to: string };
  readonly value: ScalarValue;
  /** Difference in the same unit as `value`, or `null` if not computable. */
  readonly difference: ScalarValue | null;
}

/**
 * How to fetch the records behind a result again (owner specification §3.7).
 *
 * This is a *address*, not a promise that the caller has permission to read
 * them: the query layer re-checks the book role, so tracing a chart can never
 * widen access (owner specification ACC-08/ACC-12).
 */
export interface SourceDescriptor {
  readonly analysisId: string;
  readonly period: ResolvedPeriod;
  readonly filters: ResolvedFilters;
  readonly groupBy: string | null;
  /** Which existing read path the values came from. */
  readonly query: {
    readonly kind: "stats" | "transactions";
    readonly from: string;
    readonly to: string;
    readonly currency: string | null;
    readonly categoryId?: string | null;
    readonly paymentMethodId?: string | null;
  };
  /** Record ids, when the analysis returned individual records. */
  readonly transactionIds?: readonly string[] | undefined;
  /** Data version stamp shared by cards analysing the same definition. */
  readonly dataVersion: string | null;
}

/** What a display layer needs to explain a derived number honestly. */
export interface ComputationMetadata {
  readonly rounding: typeof ANALYSIS_ROUNDING_POLICY;
  /** Exact numerator in the minor unit, when the value is a division. */
  readonly numeratorMinor?: string | undefined;
  readonly denominator?: number | undefined;
  readonly denominatorDays?: number | undefined;
  readonly sampleCount?: number | undefined;
  readonly tieCount?: number | undefined;
  readonly convertedWithFx?: boolean | undefined;
  readonly fxPolicy?: string | undefined;
  readonly notes?: readonly string[] | undefined;
}

/**
 * An analysis definition: what to compute, independent of presentation
 * (owner specification §4.1).
 *
 * Presentation (chart type, density, colour) is deliberately absent: the same
 * definition must be drawable in any family and any size without the numbers
 * changing (owner specification ACC-02).
 */
export interface AnalysisDefinition {
  readonly version: typeof ANALYSIS_PROTOCOL_VERSION;
  readonly analysisId: string;
  readonly analysisType: string;
  readonly metric: string;
  readonly aggregation?: "sum" | "count" | "average" | "median" | "extreme" | "share" | "ratio";
  readonly groupBy?: "category" | "paymentMethod" | "day" | "record";
  readonly filters?: {
    readonly kind: "expense" | "income" | "both";
    readonly categoryIds?: readonly string[];
    readonly paymentMethodIds?: readonly string[];
    readonly tagIds?: readonly string[];
  };
  /** Time inheritance. A card may pin a period, never a currency (first version). */
  readonly time: {
    readonly mode: "inherit" | "preset" | "fixed" | "relative";
    readonly preset?: "7d" | "30d" | "90d" | "365d";
    readonly from?: string;
    readonly to?: string;
    readonly days?: number;
  };
  /** First version: a card always inherits the workbench currency mode. */
  readonly currency: { readonly mode: "inherit" };
}

/** Fields every result carries, regardless of its shape. */
export interface AnalysisResultBase {
  readonly version: typeof ANALYSIS_PROTOCOL_VERSION;
  readonly analysisId: string;
  readonly analysisType: string;
  readonly metric: string;
  readonly resolvedFilters: ResolvedFilters;
  readonly resolvedPeriod: ResolvedPeriod;
  readonly resolvedCurrency: ResolvedCurrency;
  readonly completeness: AnalysisCompleteness;
  /** Present when `completeness` says the value cannot be trusted. */
  readonly unavailableReason?: string | undefined;
  readonly dataVersion: string | null;
  readonly computation: ComputationMetadata;
  readonly source: SourceDescriptor;
}

/**
 * One authoritative number (B01–B08, B13–B14, B16, B18–B19 in the owner
 * specification).
 */
export interface ScalarResult extends AnalysisResultBase {
  readonly shape: "scalar";
  readonly value: ScalarValue;
  readonly comparison?: ComparisonValue | undefined;
}

/** One ranked group: category ranking, payment-method ranking, frequency. */
export interface RankedGroup {
  readonly id: string;
  readonly label: string;
  /** The authoritative value this group is ranked by (money or count). */
  readonly primary: ScalarValue;
  readonly count?: number | undefined;
  /** Exact share of the ranking total; `null` when the total is not usable. */
  readonly share: Ratio | null;
  /** True when this group is a display-only fold ("其他"), not a real entity. */
  readonly isFolded?: boolean | undefined;
}

/**
 * A ranked list (I03–I05, B15 ranking, I17 ranking).
 *
 * `total` is the exact total the shares divide by, so a chart never has to
 * re-sum the groups it was given.
 */
export interface RankedGroupsResult extends AnalysisResultBase {
  readonly shape: "ranked-groups";
  readonly groups: readonly RankedGroup[];
  /** Groups folded into a display-only bucket, by original group id. */
  readonly foldedGroupIds?: readonly string[] | undefined;
}

/** One part of a composition (I01/I02/I17). */
export interface CompositionPart {
  readonly id: string;
  readonly label: string;
  readonly amount: MoneyValue;
  readonly count: number;
  readonly share: Ratio | null;
  readonly isFolded?: boolean | undefined;
}

/**
 * A whole/parts composition (I01/I02/I17, B13–B14 day composition).
 *
 * `total` is `null` when a full composition cannot be claimed (FX incomplete,
 * no transactions) — then `parts` must not be drawn as 100% of anything.
 */
export interface CompositionResult extends AnalysisResultBase {
  readonly shape: "composition";
  readonly total: MoneyValue | null;
  readonly parts: readonly CompositionPart[];
  readonly foldedGroupIds?: readonly string[] | undefined;
}

/**
 * One extreme record (B09–B12, B15, B17, B20).
 *
 * `tieCount` makes equal-value ties explicit and deterministic instead of
 * letting refresh order decide which record is shown.
 */
export interface RecordExtremeResult extends AnalysisResultBase {
  readonly shape: "record-extreme";
  readonly extreme: MoneyValue | null;
  readonly occurredLocalDate: string | null;
  readonly recordId: string | null;
  readonly categoryId: string | null;
  readonly categoryLabel: string | null;
  readonly paymentMethodLabel: string | null;
  /** Safe human-readable summary; never a full note dump. */
  readonly summary: string | null;
  readonly tieCount: number;
}

/** The union every consumer of S-01 may depend on. */
export type AnalysisResult =
  | ScalarResult
  | RankedGroupsResult
  | CompositionResult
  | RecordExtremeResult;
