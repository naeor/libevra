import { clearClosedAccountAttachments } from "../pendingAttachments.js";
import { clearAccountImportTasks } from "../ledgerImport/journal.js";
import { b2GlassStorageKey, B2_GLASS_LEGACY_OWNER_KEY } from "../../s19/b2Glass.js";
import { clearDuplicateSettings } from "../duplicateSettings.js";
import { clearOwnerPreferences, consentStatusKey, fxModeKey, messagesSeenKey, presentationSeenKey, sharedLedgerKey } from "../deviceStorageKeys.js";
import { listKeys, readValue, removeValue } from "./storage.js";

/** `localStorage` 在 Node 测试与隐私模式下可能不存在、访问即抛错；清理路径必须容忍。 */
function deviceStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function removeDeviceKeys(keys: readonly string[]): void {
  const storage = deviceStorage();
  if (storage === null) return;
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      /** ⚠️ 隐私模式可能拒绝写入；数据库副本已删，这里失败不阻断清理。 */
    }
  }
}

/**
 * Remove the local copies that belong to one ledger.
 *
 * ⚠️ **Only keys carrying the exact `account:book` scope are removed.** The offline database is a
 * single key-value store, so a prefix-only cleanup would be able to delete another ledger or
 * another account's months. This is the destructive half of "leave / archive / delete", and the
 * exact-scope match is what keeps it from becoming a cross-account bug.
 *
 * ⚠️ **`localStorage` 里按账本存放的偏好同样必须清除**（留言已读、共享账本提示）。否则删除账本后
 * 同一 id 再次出现会继承旧状态——2026-10-25 S16-E 审计修复。
 */
export async function clearBookLocalData(accountId: string, bookId: string): Promise<number> {
  if (accountId === "" || bookId === "") return 0;
  let removed = 0;
  for (const key of await listKeys()) {
    if (!key.endsWith(`:${accountId}:${bookId}`)) continue;
    if (await removeValue(key)) removed += 1;
  }
  removeDeviceKeys([messagesSeenKey(bookId), sharedLedgerKey(bookId)]);
  return removed;
}

/**
 * Remove every locally stored key belonging to one account, across all its ledgers.
 *
 * ⚠️ **账号级的设备偏好也要清**：重复检测设置、空间转场引导已看标记，以及调用方传入的每个账本
 * 对应的留言已读/共享账本提示。关闭或删除账号后这些本机残留会让同一账号重建时看到旧状态——
 * 2026-10-25 S16-E 审计修复。`bookIds` 是可选的：关闭账号时调用方从服务端数据里取全部账本 id。
 */
export async function clearAccountLocalData(
  accountId: string,
  bookIds: readonly string[] = [],
): Promise<number> {
  if (accountId === "") return 0;
  let removed = 0;
  for (const key of await listKeys()) {
    if (key.split(":")[1] !== accountId) continue;
    if (await removeValue(key)) removed += 1;
  }
  try {
    // 显式传入存储：清理不能依赖 `window` 别名（Node 测试与某些内嵌环境没有 window），
    // 也不该再解析一次 localStorage 是否可用——这里已经判断过了。
    clearDuplicateSettings({ kind: "account", userId: accountId }, deviceStorage());
  } catch {
    /** 存储不可用时忽略：服务端数据已删，本机偏好会在下次设置时覆盖。 */
  }
  removeDeviceKeys([
    fxModeKey(accountId),
    presentationSeenKey(accountId),
    consentStatusKey(accountId),
    ...bookIds.flatMap((bookId) => [messagesSeenKey(bookId), sharedLedgerKey(bookId)]),
  ]);
  const store = deviceStorage();
  clearOwnerPreferences("user", accountId, store);
  removeDeviceKeys([b2GlassStorageKey(accountId)]);
  // Keep the migration claimed after closure, without retaining the deleted account id.
  try {
    if (store?.getItem(B2_GLASS_LEGACY_OWNER_KEY) === accountId) store.setItem(B2_GLASS_LEGACY_OWNER_KEY, "retired");
  } catch { /* Preference storage may be blocked. */ }
  return removed;
}

/** Only a matching server receipt proves which account's originals can be discarded.
 * Older servers still get ordinary sign-out cleanup, with unsynced originals preserved. */
export async function clearAfterAccountClosure(
  accountId: string | undefined,
  closedAccountId: string | undefined,
  bookIds: readonly string[] = [],
): Promise<boolean> {
  if (!accountId) return false;
  if (!closedAccountId) {
    await clearSignedOutAccountData(accountId);
    return false;
  }
  if (accountId !== closedAccountId) return false;
  const cleanup = await Promise.allSettled([
    clearAccountLocalData(accountId, bookIds),
    clearClosedAccountAttachments(accountId),
    Promise.resolve().then(() => clearAccountImportTasks(accountId)),
  ]);
  return cleanup.every(result => result.status === "fulfilled");
}

/**
 * **退出登录 / 会话结束时，清掉这个账号留在本机的账目副本**（BUG-007，1.19.83；所有者 2026-11-15“很严重的 bug，立刻修”）。
 *
 * 原来退出只删一个**不带账号的旧键** `query-cache`，而副本早已按“账号:账本”分开存放（`query-cache:<账号>:<账本>`、
 * `ledger-months:…`、`ledger-marks:…`、`offline-fill-partial-months:…`、`offline-isolation:…`），所以退出后账目、备注、
 * 成员名都还留在浏览器里，共用设备上能打开开发者工具的人可以读到（数据流向调查 H1）。
 *
 * 现在按账本逐个处理这个账号的全部本机副本：
 * - **没有未同步改动的账本**：这个账本的所有本机键全部删除；
 * - **还有未同步改动的账本**（标记仍待投递、删除尚未确认或标记无法读取）：只删查询缓存，账目月份、标记与隔离标记保留——
 *   未同步的记录就存在这些月份与标记里，删掉就是悄悄丢掉用户还没送到服务器的账（`clearQueryCache` 当初不清整个库也是这个原因）。
 *   下次同一账号登录后照常同步。返回值列出这些账本，供调用方提示。
 * - 账号级的设备偏好（筛选、外币显示方式、同意状态等 localStorage 键）不动：退出不是注销，它们不含账目内容。
 *
 * ⚠️ 按键的账号段准确匹配，与 `clearAccountLocalData` 相同，不会碰到别的账号或游客的数据。
 */
export async function clearSignedOutAccountData(accountId: string): Promise<{ readonly removed: number; readonly keptBooks: readonly string[] }> {
  if (accountId === "") return { removed: 0, keptBooks: [] };
  const keys = (await listKeys()).filter((key) => key.split(":")[1] === accountId);
  const bookOf = (key: string): string => key.split(":")[2] ?? "";
  const unsynced = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith("ledger-marks:")) continue;
    const marks = await readValue<Record<string, { readonly pending?: boolean; readonly deleted?: boolean; readonly synced?: boolean } | null>>(key);
    // A listed marks key that cannot be read, or a legacy deletion without an acknowledgment,
    // cannot establish that the original is safe to discard.
    if (marks === null || typeof marks !== "object" || Array.isArray(marks) || Object.values(marks).some(mark =>
      mark?.pending === true || (mark?.deleted === true && !(mark.pending === false && mark.synced === true))
    )) unsynced.add(bookOf(key));
  }
  let removed = 0;
  for (const key of keys) {
    if (unsynced.has(bookOf(key)) && !key.startsWith("query-cache:")) continue;
    if (await removeValue(key)) removed += 1;
  }
  return { removed, keptBooks: [...unsynced] };
}

/**
 * 查询缓存的落盘有 1 秒节流：退出前刚排上的一次写入，可能在清理之后才按原来的“账号:账本”地址写下去。
 * 退出后再清一次这个账号的查询缓存（只清查询缓存，不碰月份与标记）。
 */
export async function clearSignedOutQueryCache(accountId: string): Promise<number> {
  if (accountId === "") return 0;
  let removed = 0;
  for (const key of await listKeys()) {
    if (!key.startsWith("query-cache:") || key.split(":")[1] !== accountId) continue;
    if (await removeValue(key)) removed += 1;
  }
  return removed;
}
