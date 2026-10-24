/**
 * Connects the guest data adapter to the two stores the account screens already read.
 *
 * ⚠️ **The screens were not rewritten to take data through props.** `DetailPage` already subscribes
 * to `ledgerSnapshotValue` / `pendingEntriesValue` / `deletedEntriesValue`, and `useStats` already
 * computes from `ledgerSnapshotValue`. Those stores are device-local (not the server cache), so the
 * guest adapter publishes into them and **the exact same components render guest entries**. That is
 * the S14-C goal: one UI, two data sources.
 */
import { t } from "../../i18n/index.js";
import { publishDeleted, publishLedger, publishPending } from "../offline/localLedger.js";
import {
  ensureGuestData,
  guestDataValue,
  guestDeletedIds,
  guestTransactions,
  type GuestData,
} from "./data.js";
import { readGuestIdentity } from "./identity.js";
import { guestRuntimeId } from "./runtime.js";

/** Publish a guest snapshot to the shared device stores (ledger / deleted / pending). */
export function publishGuestSnapshot(data?: GuestData | null): void {
  const current = data ?? guestDataValue();
  publishLedger(current === null ? [] : guestTransactions());
  publishDeleted(guestDeletedIds(current));
  publishPending(new Set());
}

/** Load the guest ledger (if needed), publish it, and return the live entries. */
export async function guestReadTransactions(): Promise<ReturnType<typeof guestTransactions>> {
  await ensureGuestData(requireGuestId());
  publishGuestSnapshot();
  return guestTransactions();
}

/** The guest book's id once the store is loaded; `null` before that. */
export function guestBookIdSync(): string | null {
  return guestDataValue()?.book.id ?? null;
}

export function requireGuestId(): string {
  const runtime = guestRuntimeId();
  if (runtime !== null) return runtime;

  const identity = readGuestIdentity();
  if (identity === null) throw new Error(t("account.guest.errors.identityNotReady"));
  return identity.id;
}
