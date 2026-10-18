import { listKeys, removeValue } from "./storage.js";

/**
 * Remove the local copies that belong to one ledger.
 *
 * ⚠️ **Only keys carrying the exact `account:book` scope are removed.** The offline database is a
 * single key-value store, so a prefix-only cleanup would be able to delete another ledger or
 * another account's months. This is the destructive half of "leave / archive / delete", and the
 * exact-scope match is what keeps it from becoming a cross-account bug.
 */
export async function clearBookLocalData(accountId: string, bookId: string): Promise<number> {
  if (accountId === "" || bookId === "") return 0;
  const suffix = `:${accountId}:${bookId}`;
  let removed = 0;
  for (const key of await listKeys()) {
    if (!key.endsWith(suffix)) continue;
    if (await removeValue(key)) removed += 1;
  }
  return removed;
}

/** Remove every locally stored key belonging to one account, across all its ledgers. */
export async function clearAccountLocalData(accountId: string): Promise<number> {
  if (accountId === "") return 0;
  const needle = `:${accountId}:`;
  let removed = 0;
  for (const key of await listKeys()) {
    if (!key.includes(needle)) continue;
    if (await removeValue(key)) removed += 1;
  }
  return removed;
}
