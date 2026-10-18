import { clearGuestIdentity } from "./identity.js";
import { clearGuestDatabase } from "./storage.js";

/**
 * Remove the guest identity and every byte of guest data.
 *
 * ⚠️ **This function is the reason the guest store is a separate database.** It deletes
 * `libellum-guest` and the guest identity key — and nothing else. It deliberately does **not**
 * call the account cleanup helpers, does not open/delete the `libellum` database, and does not
 * touch the remembered formal user, the current book, the query cache or the service worker.
 * Clearing guest data must be incapable of damaging a formal account's offline copy on the same
 * browser, and a smaller cleanup is the only way to guarantee that.
 *
 * ⚠️ **Only reachable through an explicit confirmation in the guest workspace** — never on an
 * error path, a startup path, or a sign-out.
 */
export interface ClearGuestDataResult {
  readonly identityCleared: boolean;
  readonly databaseCleared: boolean;
}

export async function clearGuestData(): Promise<ClearGuestDataResult> {
  const identityCleared = clearGuestIdentity();

  /**
   * Delete the database *after* the identity: if the browser blocks the delete, the identity is
   * already gone and a later visit creates a fresh guest instead of reopening a half-cleared one.
   */
  const databaseCleared = await clearGuestDatabase();

  return { identityCleared, databaseCleared };
}
