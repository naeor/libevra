/**
 * 游客账本“转正式账号”的上限，以及游客导入账单提交步骤的提醒（1.19.96；1.19.97 起整本上限 2 万笔）。
 *
 * 单独成一个小模块：导入页静态引用它，而本机导入引擎（`billImport.ts`，含解析器与浏览器端抽取）按需加载，
 * 登录用户的导入页不必带上那一块。
 *
 * 上限来自 `packages/shared/src/ledgerImport.ts`（不在这里改）：
 * - 整本：`MAX_STAGED_IMPORT_TRANSACTIONS`（2 万笔）、200 个标签；
 * - 每笔：`guestImportTransactionSchema` 备注 ≤ 500 字、标签 ≤ 10 个；`guestImportTagSchema` 标签名 ≤ 20 字。
 *
 * **现状（1.19.97）**：大的游客账本先分段上传到服务器暂存（`lib/ledgerImport/sourceUpload.ts`），整本上限从 5000 笔
 * 提到 2 万笔；超过的仍迁不过去，所以这里提醒。每笔的长度上限没变，本机导入在提交前就把它们挡住
 * （`billImport.ts` 的 `guestMigrationIssues`）。
 */
import { MAX_STAGED_IMPORT_TRANSACTIONS } from "@libellum/shared";

export const GUEST_MIGRATION_LIMITS = {
  transactions: MAX_STAGED_IMPORT_TRANSACTIONS,
  tags: 200,
  noteLength: 500,
  tagsPerEntry: 10,
  tagNameLength: 20,
} as const;

export interface GuestMigrationReminder {
  /** 导入后这本账的账目数。 */
  readonly transactions: number;
  /** 导入后这本账的标签数。 */
  readonly tags: number;
  readonly overTransactions: boolean;
  readonly overTags: boolean;
}

/** 导入后这本游客账本是否超过“转正式账号”的整本上限；没超过返回 `null`。 */
export function guestMigrationReminder(input: {
  readonly existingTransactions: number;
  readonly importable: number;
  readonly existingTagNames: readonly string[];
  readonly importTagNames: readonly string[];
}): GuestMigrationReminder | null {
  const transactions = input.existingTransactions + input.importable;
  const known = new Set(input.existingTagNames);
  const tags = known.size + new Set(input.importTagNames.filter((name) => !known.has(name))).size;
  const overTransactions = transactions > GUEST_MIGRATION_LIMITS.transactions;
  const overTags = tags > GUEST_MIGRATION_LIMITS.tags;
  return overTransactions || overTags ? { transactions, tags, overTransactions, overTags } : null;
}
