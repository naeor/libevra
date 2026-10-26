/**
 * A-2 — assembled results for the category and payment-method analyses
 * (owner specification B15, B16, I01–I05, I17).
 *
 * All amounts come from `primitives.categoryTotals` / `paymentMethodTotals`,
 * i.e. exact `bigint` sums over **live** records in a single currency. Nothing
 * here re-sums a chart, and nothing here derives an amount from a percentage:
 * shares are computed from exact amounts and stay exact fractions.
 *
 * The "其他" fold is display-only. It is represented by
 * {@link OTHER_GROUP_ID} and always carries the exact sum and the ids of its
 * members, so a detail page can expand it and the source trace can include it
 * (owner specification I01 "其他" rules).
 */

import {
  categoryTotals,
  foldRemainder,
  paymentMethodTotals,
  sumMinorExact,
  UNSPECIFIED_PAYMENT_METHOD_ID,
  type AnalysisEntry,
  type AnalysisKind,
  type CategoryAmount,
  type PaymentMethodAmount,
} from "../primitives.js";
import {
  computationOf,
  countScalar,
  isBlocking,
  makeComposition,
  makeEmptyExtreme,
  makeRankedGroups,
  makeScalar,
  moneyScalar,
  moneyValueOf,
  prepareScope,
  shareOf,
  type PreparedScope,
  type WorkbenchState,
} from "../context.js";
import type {
  AnalysisDefinition,
  CompositionPart,
  CompositionResult,
  RankedGroup,
  RankedGroupsResult,
  RecordExtremeResult,
  ScalarResult,
} from "../types.js";

/** Group id of the display-only "其他" fold. Never a real category id. */
export const OTHER_GROUP_ID = "__other__";

/** Display label for {@link OTHER_GROUP_ID}. */
export const OTHER_GROUP_LABEL = "其他";

interface AmountGroup {
  readonly id: string;
  readonly label: string;
  readonly amountMinor: bigint;
  readonly count: number;
  /** The system "暂无分类" bucket is a real group but not a real category. */
  readonly isSystem?: boolean | undefined;
}

function categoryGroups(entries: readonly AnalysisEntry[], kind: AnalysisKind): AmountGroup[] {
  return categoryTotals(entries, kind).map(
    (group: CategoryAmount): AmountGroup => ({
      id: group.categoryId,
      label: group.categoryName,
      amountMinor: group.amountMinor,
      count: group.count,
      isSystem: group.isSystem,
    }),
  );
}

function paymentMethodGroups(
  entries: readonly AnalysisEntry[],
  kind: AnalysisKind,
): AmountGroup[] {
  return paymentMethodTotals(entries, kind).map(
    (group: PaymentMethodAmount): AmountGroup => ({
      id: group.paymentMethodId ?? UNSPECIFIED_PAYMENT_METHOD_ID,
      label: group.paymentMethodName,
      amountMinor: group.amountMinor,
      count: group.count,
    }),
  );
}

function compositionPart(
  group: AmountGroup,
  currency: string,
  totalMinor: bigint,
  share: boolean,
  isFolded: boolean,
): CompositionPart {
  return {
    id: group.id,
    label: group.label,
    amount: moneyValueOf(group.amountMinor, currency),
    count: group.count,
    share: share ? shareOf(group.amountMinor, totalMinor) : null,
    ...(isFolded ? { isFolded: true } : {}),
  };
}

/**
 * Turn exact groups into a `composition` result.
 *
 * The total is only claimed when the data is complete: a partial FX conversion
 * or incomplete offline coverage must not be shown as 100% of anything
 * (owner specification §20.2, ACC-07).
 */
function buildComposition(
  definition: AnalysisDefinition,
  scope: PreparedScope,
  groups: readonly AmountGroup[],
  maxParts: number | undefined,
): CompositionResult {
  const complete = scope.completeness === "complete";
  const totalMinor = sumMinorExact(groups.map((group) => group.amountMinor));
  const claimable = complete && totalMinor > 0n;

  let kept = [...groups];
  let folded: AmountGroup[] = [];

  if (maxParts !== undefined) {
    const result = foldRemainder(groups, maxParts);
    kept = result.kept;
    folded = result.folded;
  }

  const parts: CompositionPart[] = kept.map((group) =>
    compositionPart(group, scope.currencyCode, totalMinor, claimable, false),
  );

  if (folded.length > 0) {
    const foldedAmount = sumMinorExact(folded.map((group) => group.amountMinor));
    const foldedCount = folded.reduce((total, group) => total + group.count, 0);

    parts.push(
      compositionPart(
        {
          id: OTHER_GROUP_ID,
          label: OTHER_GROUP_LABEL,
          amountMinor: foldedAmount,
          count: foldedCount,
        },
        scope.currencyCode,
        totalMinor,
        claimable,
        true,
      ),
    );
  }

  return makeComposition(
    definition,
    scope,
    claimable ? moneyValueOf(totalMinor, scope.currencyCode) : null,
    parts,
    computationOf({
      sampleCount: groups.reduce((total, group) => total + group.count, 0),
      notes: [`totalMinor=${totalMinor.toString()}`],
    }),
    folded.length > 0 ? folded.map((group) => group.id) : undefined,
  );
}

/**
 * I01 — expense category composition (`Share(c) = CategoryExpense(c) /
 * TotalExpense`), optionally folding the low share tail into "其他".
 */
export function assembleExpenseCategoryComposition(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
  options: { readonly maxParts?: number | undefined } = {},
): CompositionResult {
  const scope = prepareScope(entries, definition, workbench, "expense");

  if (isBlocking(scope.completeness) || scope.completeness === "no-transactions") {
    return buildComposition(definition, scope, [], options.maxParts);
  }

  return buildComposition(
    definition,
    scope,
    categoryGroups(scope.entries, "expense"),
    options.maxParts,
  );
}

/** I02 — income category composition; reuses the I01 calculation core. */
export function assembleIncomeCategoryComposition(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
  options: { readonly maxParts?: number | undefined } = {},
): CompositionResult {
  const scope = prepareScope(entries, definition, workbench, "income");

  if (isBlocking(scope.completeness) || scope.completeness === "no-transactions") {
    return buildComposition(definition, scope, [], options.maxParts);
  }

  return buildComposition(
    definition,
    scope,
    categoryGroups(scope.entries, "income"),
    options.maxParts,
  );
}

function foldRanked(
  groups: readonly AmountGroup[],
  topN: number | undefined,
): { kept: AmountGroup[]; folded: AmountGroup[] } {
  if (topN === undefined) return { kept: [...groups], folded: [] };

  const result = foldRemainder(groups, topN + 1);

  return { kept: result.kept, folded: result.folded };
}

function foldedRankedGroup(folded: readonly AmountGroup[]): AmountGroup {
  return {
    id: OTHER_GROUP_ID,
    label: OTHER_GROUP_LABEL,
    amountMinor: sumMinorExact(folded.map((group) => group.amountMinor)),
    count: folded.reduce((total, group) => total + group.count, 0),
  };
}

/**
 * I03 — expense category ranking.
 *
 * Deterministic order comes from `categoryTotals`: amount descending, then
 * category id ascending. A chart may only display the first N — the folded
 * remainder keeps its exact amount, so "其他" is never a place where money
 * disappears (owner specification I03).
 */
export function assembleExpenseCategoryRanking(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
  options: { readonly topN?: number | undefined } = {},
): RankedGroupsResult {
  const scope = prepareScope(entries, definition, workbench, "expense");
  const groups = isBlocking(scope.completeness) ? [] : categoryGroups(scope.entries, "expense");

  return buildAmountRanking(definition, scope, groups, options.topN);
}

/** I04 — income category ranking; reuses the I03 calculation core. */
export function assembleIncomeCategoryRanking(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
  options: { readonly topN?: number | undefined } = {},
): RankedGroupsResult {
  const scope = prepareScope(entries, definition, workbench, "income");
  const groups = isBlocking(scope.completeness) ? [] : categoryGroups(scope.entries, "income");

  return buildAmountRanking(definition, scope, groups, options.topN);
}

function buildAmountRanking(
  definition: AnalysisDefinition,
  scope: PreparedScope,
  allGroups: readonly AmountGroup[],
  topN: number | undefined,
): RankedGroupsResult {
  const complete = scope.completeness === "complete";
  const totalMinor = sumMinorExact(allGroups.map((group) => group.amountMinor));
  const { kept, folded } = foldRanked(allGroups, topN);
  const groups: RankedGroup[] = kept.map((group) => ({
    id: group.id,
    label: group.label,
    primary: moneyScalar(group.amountMinor, scope.currencyCode),
    count: group.count,
    share: complete ? shareOf(group.amountMinor, totalMinor) : null,
  }));

  if (folded.length > 0) {
    const foldedGroup = foldedRankedGroup(folded);

    groups.push({
      id: foldedGroup.id,
      label: foldedGroup.label,
      primary: moneyScalar(foldedGroup.amountMinor, scope.currencyCode),
      count: foldedGroup.count,
      share: complete ? shareOf(foldedGroup.amountMinor, totalMinor) : null,
      isFolded: true,
    });
  }

  return makeRankedGroups(
    definition,
    scope,
    groups,
    computationOf({
      sampleCount: allGroups.reduce((total, group) => total + group.count, 0),
      notes: [`totalMinor=${totalMinor.toString()}`],
    }),
    folded.length > 0 ? folded.map((group) => group.id) : undefined,
  );
}

/**
 * I05 — transaction count per category.
 *
 * Ranked by count, not by amount: "餐饮 20 笔 200 元" beats "电子产品 1 笔
 * 2 000 元" here while losing I03 (owner specification I05). The exact amount
 * is kept as a secondary value so the card can show both.
 */
export function assembleCategoryFrequency(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
  options: { readonly topN?: number | undefined } = {},
): RankedGroupsResult {
  const scope = prepareScope(entries, definition, workbench, "expense");
  const groups = isBlocking(scope.completeness) ? [] : categoryGroups(scope.entries, "expense");
  const totalCount = groups.reduce((total, group) => total + group.count, 0);
  const complete = scope.completeness === "complete";

  const sorted = [...groups].sort((left, right) => {
    if (left.count !== right.count) return left.count > right.count ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const { kept, folded } = foldRanked(sorted, options.topN);
  const ranked: RankedGroup[] = kept.map((group) => ({
    id: group.id,
    label: group.label,
    primary: countScalar(group.count),
    secondary: moneyScalar(group.amountMinor, scope.currencyCode),
    count: group.count,
    share: complete ? shareOf(BigInt(group.count), BigInt(totalCount)) : null,
  }));

  if (folded.length > 0) {
    const foldedGroup = foldedRankedGroup(folded);

    ranked.push({
      id: foldedGroup.id,
      label: foldedGroup.label,
      primary: countScalar(foldedGroup.count),
      secondary: moneyScalar(foldedGroup.amountMinor, scope.currencyCode),
      count: foldedGroup.count,
      share: complete ? shareOf(BigInt(foldedGroup.count), BigInt(totalCount)) : null,
      isFolded: true,
    });
  }

  return makeRankedGroups(
    definition,
    scope,
    ranked,
    computationOf({ sampleCount: totalCount }),
    folded.length > 0 ? folded.map((group) => group.id) : undefined,
  );
}

/**
 * I17 — payment-method composition.
 *
 * `metric = "amount"` returns a composition of expense or income amounts;
 * `metric = "count"` returns a count ranking. They are two separate metrics on
 * purpose: the owner specification forbids mixing amount and count in one
 * indicator. `paymentMethodId = null` becomes the explicit "未指定" group and is
 * never dropped. Payment methods stay descriptive — nothing here infers a
 * balance, a debt or a transfer (owner specification I17).
 */
export function assemblePaymentMethodAnalysis(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
  options: {
    readonly kind?: AnalysisKind | undefined;
    readonly metric?: "amount" | "count" | undefined;
    readonly maxParts?: number | undefined;
  } = {},
): CompositionResult | RankedGroupsResult {
  const kind: AnalysisKind = options.kind ?? "expense";
  const metric = options.metric ?? "amount";
  const scope = prepareScope(entries, definition, workbench, kind);
  const allGroups = isBlocking(scope.completeness)
    ? []
    : paymentMethodGroups(scope.entries, kind);

  if (metric === "amount") {
    return buildComposition(definition, scope, allGroups, options.maxParts);
  }

  return buildPaymentCountRanking(definition, scope, allGroups);
}

function buildPaymentCountRanking(
  definition: AnalysisDefinition,
  scope: PreparedScope,
  allGroups: readonly AmountGroup[],
): RankedGroupsResult {
  const totalCount = allGroups.reduce((total, group) => total + group.count, 0);
  const complete = scope.completeness === "complete";

  const sorted = [...allGroups].sort((left, right) => {
    if (left.count !== right.count) return left.count > right.count ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const groups: RankedGroup[] = sorted.map((group) => ({
    id: group.id,
    label: group.label,
    primary: countScalar(group.count),
    secondary: moneyScalar(group.amountMinor, scope.currencyCode),
    count: group.count,
    share: complete ? shareOf(BigInt(group.count), BigInt(totalCount)) : null,
  }));

  return makeRankedGroups(
    definition,
    scope,
    groups,
    computationOf({ sampleCount: totalCount }),
  );
}

/**
 * B15 — the category with the highest expense total.
 *
 * Ties are reported through `tieCount` and resolved deterministically by
 * `categoryTotals` (amount desc, then id asc), so a refresh cannot silently
 * swap which category is "the biggest". The system "暂无分类" category is a real
 * group and competes normally (owner specification §20.4, B15).
 */
export function assembleMaxExpenseCategory(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
): RecordExtremeResult {
  const scope = prepareScope(entries, definition, workbench, "expense");

  if (isBlocking(scope.completeness) || scope.completeness === "no-transactions") {
    return makeEmptyExtreme(definition, scope);
  }

  const groups = categoryGroups(scope.entries, "expense");
  const first = groups[0];

  if (first === undefined) return makeEmptyExtreme(definition, scope);

  const tieCount = groups.filter((group) => group.amountMinor === first.amountMinor).length;

  return {
    ...makeEmptyExtreme(definition, scope, computationOf({ tieCount })),
    shape: "record-extreme",
    extreme: moneyValueOf(first.amountMinor, scope.currencyCode),
    occurredLocalDate: null,
    recordId: null,
    categoryId: first.id,
    categoryLabel: first.label,
    paymentMethodLabel: null,
    summary: null,
    tieCount,
  };
}

/**
 * B16 — number of distinct real categories in scope.
 *
 * The system "暂无分类" bucket is not a real category: it is excluded from the
 * count but its presence is reported in `computation.notes` so a card can say
 * "另有一笔未分类" without inflating the category count (owner specification
 * B16). Call `includeSystemCategories: true` only for a definition that
 * explicitly counts buckets.
 */
export function assembleCategoryCount(
  entries: readonly AnalysisEntry[],
  definition: AnalysisDefinition,
  workbench: WorkbenchState,
  options: {
    readonly kind?: AnalysisKind | "both" | undefined;
    readonly includeSystemCategories?: boolean | undefined;
  } = {},
): ScalarResult {
  const kind: AnalysisKind | "both" = options.kind ?? "expense";
  const scope = prepareScope(entries, definition, workbench, kind);

  if (isBlocking(scope.completeness)) return makeScalar(definition, scope, null);

  const groups =
    kind === "both"
      ? [
          ...categoryGroups(scope.entries, "expense"),
          ...categoryGroups(scope.entries, "income"),
        ]
      : categoryGroups(scope.entries, kind);
  const unique = new Map(groups.map((group) => [group.id, group]));
  const all = [...unique.values()];
  const systems = all.filter((group) => group.isSystem === true);
  const real = all.filter((group) => group.isSystem !== true);
  const counted = options.includeSystemCategories === true ? all : real;

  return makeScalar(
    definition,
    scope,
    countScalar(counted.length),
    computationOf({
      sampleCount: counted.length,
      notes: [
        `realCategories=${real.length}`,
        systems.length > 0 ? "uncategorised-present" : "uncategorised-absent",
      ],
    }),
  );
}
