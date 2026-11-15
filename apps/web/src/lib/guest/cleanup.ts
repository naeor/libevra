import { clearOwnerPreferences, isAppDeviceStorageKey } from "../deviceStorageKeys.js";
import { clearGuestDuplicateSettings } from "../duplicateSettings.js";
import { resetEverything } from "../offline/reset.js";
import { removeAllGuestAttachments } from "./attachments.js";
import { resetGuestDataCache } from "./data.js";
import { clearGuestIdentity, readGuestIdentity } from "./identity.js";
import { clearGuestDatabase } from "./storage.js";

/**
 * Remove the guest identity and every byte of guest data.
 *
 * ⚠️ **This function is the reason the guest store is a separate database.** It deletes
 * `libellum-guest`, the guest identity key, and the current guest's device preferences. It deliberately does
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
  const guest = readGuestIdentity();
  if (guest) clearOwnerPreferences("guest", guest.id, globalThis.localStorage);
  // 游客附件原件在独立库 libevra-attachments-v1（按游客 id 分），不在 libellum-guest 里：要单独清。
  // 只清这个游客 id 的行，不碰正式账号的待上传原件。失败不阻止清除（身份与库照常删）。
  if (guest) await removeAllGuestAttachments(guest.id).catch(() => undefined);
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
 * Clear guest and formal offline ledgers, app preferences, caches and service workers. Formal-account pending
 * attachment originals have their own owner-scoped store and are preserved; the guest's own attachments are removed.
 *
 * ⚠️ **A separate action from both "clear this account's offline copy" and "clear guest data".** The
 * owner asked for the three to be distinguishable, and this is the largest of them: it is only
 * reachable behind **two** confirmations that state the scope, and it still does not touch the
 * server. The session cookie is deliberately left alone (the existing `resetEverything` rule: a
 * data-cleanup button that signs somebody out is a different consent); a reload is expected.
 */
export async function clearAllDeviceData(): Promise<void> {
  const guest = readGuestIdentity();
  // 游客附件跟着游客走；正式账号的待上传原件仍保留。
  if (guest) await removeAllGuestAttachments(guest.id).catch(() => undefined);
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
