/**
 * A-1 — chart input protocol: the **composition** chart family
 * (CF-A03 ring / CF-A05 percent bar / stacked parts).
 *
 * The composition chart receives exact parts and a drawing-only fraction. The
 * fraction is derived from the exact minor-unit amounts, never from an
 * already-rounded percentage, and the authoritative amount strings are passed
 * separately so labels can never be recomputed from the drawing geometry
 * (owner specification §20.1/§20.2, ACC-05).
 *
 * `drawable` is `false` unless the result is `complete` **and** the exact total
 * is positive: an incomplete composition must not be renormalised into a
 * 100% ring, and an empty book must not look like "100% uncategorised"
 * (owner specification §20.2/§20.3, ACC-07).
 */

import { formatMinorExact, ratioOf, ratioToNumber, ratioToPercentText } from "../rational.js";
import type { Ratio } from "../rational.js";
import type { AnalysisCompleteness, CompositionResult, SourceDescriptor } from "../types.js";

/** One segment of a composition chart. */
export interface CompositionSegment {
  readonly id: string;
  readonly label: string;
  /** Exact amount in minor units (decimal string, BigInt-safe). */
  readonly amountMinor: string;
  /** Exact amount rendered with the currency scale (authoritative label). */
  readonly amountText: string;
  readonly share: Ratio | null;
  readonly shareText: string | null;
  /** Drawing-only fraction of the total; `null` when the chart is not drawable. */
  readonly fractionOfTotal: number | null;
  /** True when this is the folded "其他" pseudo-category (not a real category). */
  readonly isFolded: boolean;
}

/** The complete input contract of a composition chart. */
export interface CompositionChartInput {
  readonly kind: "composition-chart";
  readonly analysisId: string;
  readonly currency: string;
  readonly totalMinor: string | null;
  readonly totalText: string | null;
  readonly segments: readonly CompositionSegment[];
  readonly completeness: AnalysisCompleteness;
  /** False when the definition must not be rendered as a full composition. */
  readonly drawable: boolean;
  readonly source: SourceDescriptor;
}

/**
 * Build the input contract of a composition chart from an exact result.
 *
 * The returned segments keep the exact amount text and share text, while
 * `fractionOfTotal` exists only for the drawing layer.
 */
export function compositionChartInput(result: CompositionResult): CompositionChartInput {
  const totalMinor = result.total === null ? null : result.total.amountMinor;
  const total = totalMinor === null ? null : BigInt(totalMinor);
  const drawable = result.completeness === "complete" && total !== null && total > 0n;
  const currency =
    result.total !== null
      ? result.total.currency
      : result.parts.length > 0
        ? (result.parts[0]?.amount.currency ?? "")
        : "";

  const segments: CompositionSegment[] = result.parts.map((part) => {
    const amountMinor = BigInt(part.amount.amountMinor);
    const fraction = drawable && total !== null ? ratioOf(amountMinor, total) : null;

    return {
      id: part.id,
      label: part.label,
      amountMinor: part.amount.amountMinor,
      amountText: formatMinorExact(amountMinor, part.amount.decimals),
      share: part.share,
      shareText: part.share === null ? null : ratioToPercentText(part.share),
      fractionOfTotal: fraction === null ? null : ratioToNumber(fraction),
      isFolded: part.isFolded === true,
    };
  });

  return {
    kind: "composition-chart",
    analysisId: result.analysisId,
    currency,
    totalMinor,
    totalText:
      result.total === null
        ? null
        : formatMinorExact(BigInt(result.total.amountMinor), result.total.decimals),
    segments,
    completeness: result.completeness,
    drawable,
    source: result.source,
  };
}
