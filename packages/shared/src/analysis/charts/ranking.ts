/**
 * A-1 — chart input protocol: the **ranking** chart family
 * (CF-A04 horizontal bars, CF-A07 ranking table, list views).
 *
 * A ranking item carries its exact primary value as a decimal string and its
 * rank; bar length is a drawing-only `fractionOfMax` derived from exact minor
 * units. The authoritative amount/count text is passed separately, so a bar
 * can never be used to reconstruct or override a label (owner specification
 * §20.1, ACC-05).
 *
 * A ranked result whose primary scalar is a count (I05 category frequency,
 * I17 count metric) must stay identifiable as a count ranking — it must never
 * be rendered through the amount ranking of I03 (owner specification §15).
 */

import { ratioOf, ratioToNumber, ratioToPercentText } from "../rational.js";
import type { Ratio } from "../rational.js";
import type { AnalysisCompleteness, RankedGroupsResult, SourceDescriptor } from "../types.js";
import { scalarText } from "./numericCard.js";

/** The metric a ranking is sorted by. */
export type RankingPrimaryKind = "money" | "count";

/** One row of a ranking chart. */
export interface RankingItem {
  /** 1-based rank in the authoritative order (ties are resolved by the result). */
  readonly rank: number;
  readonly id: string;
  readonly label: string;
  readonly primaryKind: RankingPrimaryKind;
  /** Exact primary amount in minor units; `null` for a count ranking. */
  readonly primaryMinor: string | null;
  /** Primary count; `null` for a money ranking. */
  readonly count: number | null;
  /** Authoritative primary text (exact amount or integer count). */
  readonly primaryText: string | null;
  /** Exact secondary text (e.g. the amount behind I05's count ordering). */
  readonly secondaryText: string | null;
  readonly share: Ratio | null;
  readonly shareText: string | null;
  /** Drawing-only bar fraction relative to the largest item; `null` when not drawable. */
  readonly fractionOfMax: number | null;
  /** True when this row is the folded "其他" pseudo-category. */
  readonly isFolded: boolean;
}

/** The complete input contract of a ranking chart. */
export interface RankingChartInput {
  readonly kind: "ranking-chart";
  readonly analysisId: string;
  readonly primaryKind: RankingPrimaryKind;
  /** Largest authoritative primary value (minor units or count) as a string. */
  readonly maxValue: string | null;
  readonly items: readonly RankingItem[];
  readonly completeness: AnalysisCompleteness;
  readonly source: SourceDescriptor;
}

function primaryOf(primary: RankedGroupsResult["groups"][number]["primary"]): {
  kind: RankingPrimaryKind;
  minor: bigint | null;
  count: number | null;
} {
  switch (primary.kind) {
    case "money":
      return { kind: "money", minor: BigInt(primary.money.amountMinor), count: null };
    case "exact-money": {
      const denominator = BigInt(primary.denominator);

      if (denominator === 0n) throw new RangeError("ranking_zero_denominator");

      // Exact averages are not a ranked primary today; keep the row drawable
      // only through its authoritative text, never through a rounded bar.
      return { kind: "money", minor: null, count: null };
    }
    case "count":
      return { kind: "count", minor: null, count: primary.count };
    default:
      return { kind: "count", minor: null, count: null };
  }
}

/**
 * Build the input contract of a ranking chart from an exact ranked result.
 *
 * `fractionOfMax` is `null` if the largest authoritative value is not positive
 * (all-zero / empty results must render an explicit empty state instead of
 * zero-length bars that look like missing data).
 */
export function rankingChartInput(result: RankedGroupsResult): RankingChartInput {
  const first = result.groups[0];
  const primaryKind: RankingPrimaryKind =
    first === undefined ? "money" : primaryOf(first.primary).kind;

  const derived = result.groups.map((group) => {
    const primary = primaryOf(group.primary);
    const text = scalarText(group.primary);
    const secondaryText =
      group.secondary === undefined ? null : scalarText(group.secondary).text;
    const magnitude =
      primary.kind === "money" && primary.minor !== null && primary.minor > 0n
        ? primary.minor
        : primary.count !== null && primary.count > 0
          ? primary.count
          : null;

    return { group, primary, text, secondaryText, magnitude };
  });

  const maxMagnitude = derived.reduce<bigint | null>((max, item) => {
    if (item.magnitude === null) return max;
    const value = typeof item.magnitude === "bigint" ? item.magnitude : BigInt(item.magnitude);

    return max === null || value > max ? value : max;
  }, null);

  const items: RankingItem[] = derived.map((item, index) => {
    const fraction =
      maxMagnitude !== null && maxMagnitude > 0n && item.magnitude !== null
        ? ratioOf(BigInt(item.magnitude), maxMagnitude)
        : null;

    return {
      rank: index + 1,
      id: item.group.id,
      label: item.group.label,
      primaryKind: item.primary.kind,
      primaryMinor: item.primary.minor === null ? null : item.primary.minor.toString(),
      count: item.primary.count,
      primaryText: item.text.text,
      secondaryText: item.secondaryText,
      share: item.group.share,
      shareText: item.group.share === null ? null : ratioToPercentText(item.group.share),
      fractionOfMax: fraction === null ? null : ratioToNumber(fraction),
      isFolded: item.group.isFolded === true,
    };
  });

  return {
    kind: "ranking-chart",
    analysisId: result.analysisId,
    primaryKind,
    maxValue: maxMagnitude === null ? null : maxMagnitude.toString(),
    items,
    completeness: result.completeness,
    source: result.source,
  };
}
