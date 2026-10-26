/**
 * A-3 — chart input protocol: the **CF-A02 extreme summary card**.
 *
 * The card receives the exact extreme value (money, or the record count of a
 * peak day), its business date, its category / payment-method labels, the tie
 * count and a source address. It never receives a float it could use to
 * re-derive an amount and it never re-groups records.
 *
 * Density follows the **real container size** (owner specification §18):
 * Compact shows the core result, Medium adds the date / tie, Expanded may add
 * the labels and the income/expense record breakdown. The authoritative value
 * is identical at every density.
 *
 * The distance to A-4 is not visual: the remaining work is review gates
 * (S-01 freeze, T2 approval) plus the A-4 regression sweep.
 */

import {
  chooseCardDensity,
  scalarText,
  type CardDensity,
  type CardSize,
  type ScalarSign,
  type ScalarUnit,
} from "./numericCard.js";
import type {
  AnalysisCompleteness,
  RecordExtremeResult,
  ScalarValue,
  SourceDescriptor,
} from "../types.js";

/** Auxiliary lines a CF-A02 card may show, by protocol id (i18n in the app). */
export type ExtremeCardAuxId =
  | "date"
  | "tie"
  | "category"
  | "income-count"
  | "expense-count";

/** One auxiliary line of an extreme summary card. */
export interface ExtremeCardAux {
  readonly id: ExtremeCardAuxId;
  readonly valueText: string;
}

/** The complete input contract of a CF-A02 extreme summary card. */
export interface ExtremeCardInput {
  readonly kind: "extreme-card";
  readonly analysisId: string;
  readonly density: CardDensity;
  /** Caller-provided title (i18n key resolved by the app). */
  readonly title: string;
  readonly valueText: string | null;
  readonly unit: ScalarUnit | null;
  readonly currency: string | null;
  readonly sign: ScalarSign;
  readonly occurredLocalDate: string | null;
  readonly categoryLabel: string | null;
  readonly paymentMethodLabel: string | null;
  readonly tieCount: number;
  readonly countBreakdown?:
    | {
        readonly total: number;
        readonly income: number;
        readonly expense: number;
      }
    | undefined;
  readonly auxiliary: readonly ExtremeCardAux[];
  readonly completeness: AnalysisCompleteness;
  readonly unavailableReason?: string | undefined;
  /** Re-fetch address for the detail page (permission re-checked there). */
  readonly source: SourceDescriptor;
}

/** The exact authoritative value of an extreme result. */
function extremeScalar(result: RecordExtremeResult): ScalarValue | null {
  if (result.extreme !== null) return { kind: "money", money: result.extreme };

  return result.extremeValue ?? null;
}

function auxiliaryOf(result: RecordExtremeResult): ExtremeCardAux[] {
  const auxiliary: ExtremeCardAux[] = [];

  if (result.occurredLocalDate !== null) {
    auxiliary.push({ id: "date", valueText: result.occurredLocalDate });
  }

  if (result.tieCount > 1) {
    auxiliary.push({ id: "tie", valueText: String(result.tieCount) });
  }

  if (result.categoryLabel !== null) {
    auxiliary.push({ id: "category", valueText: result.categoryLabel });
  }

  if (result.countBreakdown !== undefined) {
    auxiliary.push({ id: "income-count", valueText: String(result.countBreakdown.income) });
    auxiliary.push({ id: "expense-count", valueText: String(result.countBreakdown.expense) });
  }

  return auxiliary;
}

/**
 * Build the input contract of an extreme summary card (CF-A02).
 *
 * `size` is the card's real inner size; only the amount of auxiliary detail
 * depends on it (owner specification §18, ACC-02).
 */
export function extremeCardInput(
  result: RecordExtremeResult,
  options: { readonly title: string; readonly size: CardSize },
): ExtremeCardInput {
  const density = chooseCardDensity(options.size);
  const text = scalarText(extremeScalar(result));
  const auxiliary = auxiliaryOf(result);
  const shown =
    density === "compact" ? auxiliary.slice(0, 1) : density === "medium" ? auxiliary.slice(0, 2) : auxiliary;

  return {
    kind: "extreme-card",
    analysisId: result.analysisId,
    density,
    title: options.title,
    valueText: text.text,
    unit: text.unit,
    currency: text.currency,
    sign: text.sign,
    occurredLocalDate: result.occurredLocalDate,
    categoryLabel: result.categoryLabel,
    paymentMethodLabel: result.paymentMethodLabel,
    tieCount: result.tieCount,
    ...(result.countBreakdown === undefined
      ? {}
      : { countBreakdown: result.countBreakdown }),
    auxiliary: shown,
    completeness: result.completeness,
    ...(result.unavailableReason === undefined
      ? {}
      : { unavailableReason: result.unavailableReason }),
    source: result.source,
  };
}
