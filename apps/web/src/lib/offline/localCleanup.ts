import { clearDuplicateSettings } from "../duplicateSettings.js";
import { fxModeKey, messagesSeenKey, presentationSeenKey, sharedLedgerKey } from "../deviceStorageKeys.js";
import { listKeys, removeValue } from "./storage.js";

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
  const suffix = `:${accountId}:${bookId}`;
  let removed = 0;
  for (const key of await listKeys()) {
    if (!key.endsWith(suffix)) continue;
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
  const needle = `:${accountId}:`;
  let removed = 0;
  for (const key of await listKeys()) {
    if (!key.includes(needle)) continue;
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
    ...bookIds.flatMap((bookId) => [messagesSeenKey(bookId), sharedLedgerKey(bookId)]),
  ]);
  const store = deviceStorage();
  if (store) {
    const prefixes = ["stats-workbench", "stats-workbench-presets", "stats-workbench-sync"].map(kind => `libevra.${kind}:v1:user:${accountId}`);
    const owned: string[] = [];
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index);
      if (key && prefixes.some(prefix => key === prefix || key.startsWith(`${prefix}:`))) owned.push(key);
    }
    removeDeviceKeys(owned);
  }
  return removed;
}
