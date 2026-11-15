/**
 * 游客账本“转正式账号”的上限，以及游客导入账单提交步骤的提醒（1.19.96）。
 *
 * 单独成一个小模块：导入页静态引用它，而本机导入引擎（`billImport.ts`，含解析器与浏览器端抽取）按需加载，
 * 登录用户的导入页不必带上那一块。
 *
 * 上限来自 `packages/shared/src/ledgerImport.ts`（不在这里改）：
 * - 整本：`guestImportSourceSchema` 最多 5000 笔账目、200 个标签；
 * - 每笔：`guestImportTransactionSchema` 备注 ≤ 500 字、标签 ≤ 10 个；`guestImportTagSchema` 标签名 ≤ 20 字。
 *
 * **现状（1.19.96 核对）**：账本导入页把一本游客账本**整本**作为来源快照随请求上传
 * （`ledgerImportRequestSchema.source` / `importJobRequestSchema`）；`DEFAULT_IMPORT_BATCH_SIZE`（200）与
 * `IMPORT_BATCH_THRESHOLD` 的分批只发生在服务器收到快照**之后**的写入阶段，不会把来源拆成几次上传。
 * 所以超过整本上限的游客账本目前迁不过去（服务器按 schema 拒绝整次请求）；每笔的长度上限同理，所以本机导入在
 * 提交前就把它们挡住（`billImport.ts` 的 `guestMigrationIssues`），整本的上限只提醒。
 */
import { MAX_IMPORT_TRANSACTIONS } from "@libellum/shared";

export const GUEST_MIGRATION_LIMITS = {
  transactions: MAX_IMPORT_TRANSACTIONS,
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
