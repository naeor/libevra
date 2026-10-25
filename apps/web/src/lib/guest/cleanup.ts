import { isAppDeviceStorageKey } from "../deviceStorageKeys.js";
import { clearGuestDuplicateSettings } from "../duplicateSettings.js";
import { resetEverything } from "../offline/reset.js";
import { resetGuestDataCache } from "./data.js";
import { clearGuestIdentity } from "./identity.js";
import { clearGuestDatabase } from "./storage.js";

/**
 * Remove the guest identity and every byte of guest data.
 *
 * ⚠️ **This function is the reason the guest store is a separate database.** It deletes
 * `libellum-guest`, the guest identity key, and the guest's device-local duplicate-detection
 * preference (`libellum.duplicate-detection.v1.guest`) — and nothing else. It deliberately does
 * **not** call the account cleanup helpers, does not open/delete the `libellum` database, and does
 * not touch the remembered formal user, the current book, the query cache or the service worker.
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
  // Guest-only preference; the account-scoped keys are untouched. See duplicateSettings.ts.
  clearGuestDuplicateSettings();
  // Drop the in-memory copy with the identity, so a later guest cannot read the previous one's data
  // through a stale module snapshot.
  resetGuestDataCache();

  /**
   * Delete the database *after* the identity: if the browser blocks the delete, the identity is
   * already gone and a later visit creates a fresh guest instead of reopening a half-cleared one.
   */
  const databaseCleared = await clearGuestDatabase();

  return { identityCleared, databaseCleared };
}

/**
 * **Clear everything this device holds for Libevra — both identities, both databases, caches, the
 * service worker and the app's own `localStorage` flags.**
 *
 * ⚠️ **A separate action from both "clear this account's offline copy" and "clear guest data".** The
 * owner asked for the three to be distinguishable, and this is the largest of them: it is only
 * reachable behind **two** confirmations that state the scope, and it still does not touch the
 * server. The session cookie is deliberately left alone (the existing `resetEverything` rule: a
 * data-cleanup button that signs somebody out is a different consent); a reload is expected.
 */
export async function clearAllDeviceData(): Promise<void> {
  clearGuestIdentity();
  await clearGuestDatabase();
  resetGuestDataCache();

  await resetEverything();

  try {
    const storage = globalThis.localStorage;
    if (storage !== undefined) {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key === null) continue;
        // 两个品牌前缀与 `current-book` 都由 deviceStorageKeys.ts 统一定义：清理范围不能各自维护，
        // 否则新增的 `libevra.*` 键会被漏掉（2026-10-25 S16-E 审计修复）。
        if (isAppDeviceStorageKey(key)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable; the databases are already gone, and the caller reloads.
  }
}
