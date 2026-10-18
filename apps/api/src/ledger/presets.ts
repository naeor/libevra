import { UNCATEGORISED_NAME, type TransactionKind } from "@libellum/shared";

/**
 * Server-side re-export of the shared ledger presets.
 *
 * ⚠️ **The list moved to `packages/shared/src/presets.ts` in S14-C and this file kept its name.**
 * The guest store seeds a local ledger with exactly the same categories and payment methods as the
 * server, and two copies of the list would drift. Existing server imports
 * (`./ledger/presets.js`) stay valid; only the definition moved.
 */
export {
  DEFAULT_BOOK_NAME,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHOD_NAMES,
  UNCATEGORISED,
  categoriesFor,
  type CategoryPreset,
} from "@libellum/shared";

/** Kept because some callers import this local alias rather than the shared type. */
export type PresetKind = TransactionKind;

/** Unused re-export guard: keeps the historical named import path working if anything imports it. */
export { UNCATEGORISED_NAME };
