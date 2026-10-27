/**
 * A-1 — chart input protocol: the **CF-A01 numeric card**.
 *
 * This is the "assembly layer" between an exact {@link ScalarResult} and a
 * visual numeric card (owner specification §17 CF-A01, §18 density rules):
 * a card receives display text, a unit, a sign, optional auxiliary values and
 * the completeness state — never a float it could use to re-derive money.
 *
 * Density is chosen from the **real container size**, not from a screen model
 * or a grid cell count. The thresholds below are provisional protocol values;
 * Codex owns the final visual tokens and may tune them without changing the
 * model (A-Q5). Compact/Medium/Expanded are content densities, not grid
 * positions: the same definition must produce the same authoritative value at
 * every size (owner specification ACC-02).
 */

import { decimalsFor } from "../../money.js";
import { formatMinorExact, ratioOf, ratioToDecimalText, ratioToPercentText } from "../rational.js";
import type { Ratio } from "../rational.js";
import type {
  AnalysisCompleteness,
  ScalarResult,
  ScalarValue,
  SourceDescriptor,
} from "../types.js";

/** Content density of a card, decided by its real pixel size. */
export type CardDensity = "compact" | "medium" | "expanded";

/** Real available size of the card body (not the grid cell). */
export interface CardSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Provisional density thresholds (protocol-level, not final design tokens).
 * Minimum readable width/height for one auxiliary value; below `medium` only
 * the title, the primary value and the unit are shown.
 */
export const CARD_DENSITY_THRESHOLDS = {
  medium: { minWidth: 200, minHeight: 120 },
  expanded: { minWidth: 320, minHeight: 200 },
} as const;

/** Pick a content density from the real container size. */
export function chooseCardDensity(size: CardSize): CardDensity {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new RangeError(`card_size:${String(size.width)}x${String(size.height)}`);
  }

  const thresholds = CARD_DENSITY_THRESHOLDS;

  if (
    size.width >= thresholds.expanded.minWidth &&
    size.height >= thresholds.expanded.minHeight
  ) {
    return "expanded";
  }

  if (
    size.width >= thresholds.medium.minWidth &&
    size.height >= thresholds.medium.minHeight
  ) {
    return "medium";
  }

  return "compact";
}

/** The unit a scalar is displayed in. */
export type ScalarUnit = "currency" | "count" | "days" | "percent" | "fraction";

/** Sign information a card needs to style a value — colour is never the only cue. */
export type ScalarSign = "positive" | "negative" | "zero" | "unknown";

/** Display text and unit of one exact scalar. */
export interface ScalarText {
  /** `null` when the value does not exist ("cannot be determined"). */
  readonly text: string | null;
  readonly unit: ScalarUnit | null;
  readonly currency: string | null;
  readonly sign: ScalarSign;
  /** Exact fraction used for drawing, when the value is a money average. */
  readonly ratio: Ratio | null;
}

function signOf(minor: bigint): ScalarSign {
  return minor > 0n ? "positive" : minor < 0n ? "negative" : "zero";
}

/**
 * Turn an exact scalar into display text.
 *
 * Rounding happens here and only here: the card shows `minor-half-away-v1`
 * text, while the exact fraction stays available for drawing and for the
 * detail page. A `null` scalar returns `null` text — "cannot be determined"
 * must never be rendered as `0`.
 */
export function scalarText(value: ScalarValue | null): ScalarText {
  if (value === null) {
    return { text: null, unit: null, currency: null, sign: "unknown", ratio: null };
  }

  switch (value.kind) {
    case "money": {
      const minor = BigInt(value.money.amountMinor);

      return {
        text: formatMinorExact(minor, value.money.decimals),
        unit: "currency",
        currency: value.money.currency,
        sign: signOf(minor),
        ratio: null,
      };
    }
    case "exact-money": {
      const denominator = BigInt(value.denominator);

      if (denominator === 0n) {
        throw new RangeError("exact_money_zero_denominator");
      }

      const ratio = ratioOf(BigInt(value.numeratorMinor), denominator);

      if (ratio === null) throw new RangeError("exact_money_zero_denominator");

      // Round to a whole minor unit once, then insert the currency scale.
      const roundedMinor = BigInt(ratioToDecimalText(ratio, 0));

      return {
        text: formatMinorExact(roundedMinor, value.decimals),
        unit: "currency",
        currency: value.currency,
        sign: signOf(roundedMinor),
        ratio,
      };
    }
    case "count":
      return {
        text: String(value.count),
        unit: "count",
        currency: null,
        sign: value.count === 0 ? "zero" : "positive",
        ratio: null,
      };
    case "days":
      return {
        text: String(value.days),
        unit: "days",
        currency: null,
        sign: value.days === 0 ? "zero" : "positive",
        ratio: null,
      };
    case "ratio": {
      const text =
        value.scale === "percent-100"
          ? ratioToPercentText(value.ratio)
          : ratioToDecimalText(value.ratio, 4);

      return {
        text,
        unit: value.scale === "percent-100" ? "percent" : "fraction",
        currency: null,
        sign: signOf(value.ratio.numerator),
        ratio: value.ratio,
      };
    }
  }
}

/** Auxiliary values a card may show, by protocol id (i18n lives in the app). */
export type NumericCardAuxId = "count" | "days" | "total" | "comparison";

/** One auxiliary line of a numeric card. */
export interface NumericCardAux {
  readonly id: NumericCardAuxId;
  readonly valueText: string;
}

/** The complete input contract of a CF-A01 numeric card. */
export interface NumericCardInput {
  readonly kind: "numeric-card";
  readonly analysisId: string;
  readonly density: CardDensity;
  /** Caller-provided title (i18n key resolved by the app). */
  readonly title: string;
  readonly valueText: string | null;
  readonly unit: ScalarUnit | null;
  readonly currency: string | null;
  readonly sign: ScalarSign;
  readonly auxiliary: readonly NumericCardAux[];
  readonly completeness: AnalysisCompleteness;
  readonly unavailableReason?: string | undefined;
  /** Re-fetch address for the detail page (permission re-checked there). */
  readonly source: SourceDescriptor;
}

function currencyOf(result: ScalarResult): string {
  return result.resolvedCurrency.mode === "original"
    ? result.resolvedCurrency.currency
    : result.resolvedCurrency.targetCurrency;
}

function auxiliaryOf(result: ScalarResult): NumericCardAux[] {
  const auxiliary: NumericCardAux[] = [];
  const computation = result.computation;
  const value = result.value;
  const currency = currencyOf(result);

  const countCandidate =
    computation.sampleCount ??
    (computation.denominatorDays === undefined ? computation.denominator : undefined);

  if (countCandidate !== undefined) {
    auxiliary.push({ id: "count", valueText: String(countCandidate) });
  }

  if (computation.denominatorDays !== undefined) {
    auxiliary.push({ id: "days", valueText: String(computation.denominatorDays) });
  }

  if (computation.numeratorMinor !== undefined && value?.kind === "exact-money") {
    auxiliary.push({
      id: "total",
      valueText: formatMinorExact(BigInt(computation.numeratorMinor), decimalsFor(currency)),
    });
  }

  if (result.comparison !== undefined) {
    const comparisonText = scalarText(result.comparison.value).text;

    if (comparisonText !== null) {
      auxiliary.push({ id: "comparison", valueText: comparisonText });
    }
  }

  return auxiliary;
}

/**
 * Build the input contract of a numeric card (CF-A01).
 *
 * `size` is the card's real inner size. The authoritative value does not depend
 * on it — only how many auxiliary lines are shown (owner specification §18).
 */
export function numericCardInput(
  result: ScalarResult,
  options: { readonly title: string; readonly size: CardSize },
): NumericCardInput {
  const density = chooseCardDensity(options.size);
  const text = scalarText(result.value);
  const auxiliary = auxiliaryOf(result);
  const shown =
    density === "compact" ? [] : density === "medium" ? auxiliary.slice(0, 1) : auxiliary;

  return {
    kind: "numeric-card",
    analysisId: result.analysisId,
    density,
    title: options.title,
    valueText: text.text,
    unit: text.unit,
    currency: text.currency,
    sign: text.sign,
    auxiliary: shown,
    completeness: result.completeness,
    ...(result.unavailableReason === undefined
      ? {}
      : { unavailableReason: result.unavailableReason }),
    source: result.source,
  };
}
