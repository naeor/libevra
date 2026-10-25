/**
 * **这台设备上属于 Libevra 的 `localStorage` 键 —— 一处定义，处处使用。**
 *
 * ⚠️ **为什么需要这个模块。** 这些键由若干功能各自写入（留言已读、空间转场引导、共享账本离线策略、
 * 重复检测偏好、语言与主题运行时），却又被两条清理路径统一清除（关闭/删除账号、清除本机全部数据）。
 * 此前每个模块各自保存字面量，清理代码只能按前缀猜测——2026-10-25 的 S16-E 审计发现两处漏清：
 * 新的 `libevra.*` 键（语言/主题/开发伪语言）不在“清除本机全部数据”的范围内，账号级的设备偏好
 * （重复检测、转场引导、留言已读）也没有随账号清理。于是把“哪些键属于本应用”“一个键长什么样”
 * 收进这一个模块，清理代码只依赖它，新增键也不会再漏。
 *
 * ⚠️ **`libellum` 是历史前缀，必须继续被清扫。** 品牌更名为 Libevra 时没有重命名用户设备上已有的
 * 数据，两个前缀都是我们自己的；`current-book` 比两个前缀都早，同样不能漏。
 */

/** 历史品牌前缀——游客身份、OCR 草稿、留言已读、共享账本提示等。 */
export const LIBELLUM_KEY_PREFIX = "libellum";

/** 新品牌前缀——语言、主题、开发伪语言。 */
export const LIBEVRA_KEY_PREFIX = "libevra.";

/** 比两个品牌都早的键：记住当前账本。 */
export const CURRENT_BOOK_KEY = "current-book";

export const MESSAGES_SEEN_PREFIX = "libellum-messages-seen:";
export const PRESENTATION_SEEN_PREFIX = "libellum-presentation-seen";
export const SHARED_LEDGER_PREFIX = "libellum:shared-ledger:";

/** “这条留言板读到哪了”的键（按账本）。 */
export function messagesSeenKey(bookId: string): string {
  return `${MESSAGES_SEEN_PREFIX}${bookId}`;
}

/** “这个账号看过空间转场引导了”的键（按账号，历史格式是前缀 + `:` + id）。 */
export function presentationSeenKey(userId: string): string {
  return `${PRESENTATION_SEEN_PREFIX}:${userId}`;
}

/** “这个账本是共享账本”的离线策略键（按账本，同步写入，写层要立即读到）。 */
export function sharedLedgerKey(bookId: string): string {
  return `${SHARED_LEDGER_PREFIX}${bookId}`;
}

/**
 * 这个键是不是应用自己的（“清除本机全部数据”可以清扫的范围）。
 *
 * ⚠️ 判定只认**前缀全等**：`libellum-`、`libellum.`、`libellum:` 都属于历史前缀；
 * `libevra.` 属于新前缀；`current-book` 单独列出。
 */
export function isAppDeviceStorageKey(key: string): boolean {
  return (
    key.startsWith(LIBELLUM_KEY_PREFIX) ||
    key.startsWith(LIBEVRA_KEY_PREFIX) ||
    key === CURRENT_BOOK_KEY
  );
}
