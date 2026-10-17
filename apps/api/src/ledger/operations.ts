import type {
  LedgerOperation,
  LedgerOperationAction,
  LedgerOperationObjectType,
} from "@libellum/shared";

import type { PrismaClient } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";

/**
 * 批量操作的摘要：**一次"删除 + 历史重关联"只写一行。**
 *
 * ⚠️ **The owner's rule is the whole reason this module exists** (S13-E Q4, 2026-10-17):
 * *"要记录一次批量操作及操作者；但不必为每一笔交易制造大量独立事件。"* 删掉一个已经被用过的
 * 分类，可能一次改动上百笔账目 —— 一百条 `transaction_events` 会把编辑历史淹掉，而"谁把这个分类
 * 删了、历史记到了哪里"其实只有一个答案，所以**一行**就够，而且必须只有一行。
 *
 * ⚠️ **Every write takes the transaction client**, for the same reason `recordEvent` does: 一条
 * 摘要如果写在导致它的那个事务之外，**回滚之后它会留下来** ——「有人做过一次批量操作」而没有任何
 * 操作发生过。反过来，操作成功而摘要丢了，用户就再也查不到历史去哪了。
 */

type Tx = Prisma.TransactionClient;

export interface RecordOperationInput {
  readonly bookId: string;
  /** Null is not produced by today's callers; it exists because the column does. */
  readonly actorId: string | null;
  /** ⚠️ A snapshot of the display name, so a closed account's action still reads as a person's. */
  readonly actorName: string;
  readonly action: LedgerOperationAction;
  readonly objectType: LedgerOperationObjectType;
  readonly objectId: string;
  readonly objectName: string;
  /**
   * ⚠️ **The number the user was shown** — live entries only (`deleted_at IS NULL`).
   * 被重连的墓碑行数放在 `detail.movedRows` 里；两个数不同是正常的，见 `classification.ts`。
   */
  readonly affectedCount: number;
  /** 历史去了哪里、怎么去的。形状随动作变化，所以是 JSONB 而不是一堆可空列。 */
  readonly detail: Record<string, unknown>;
}

/** Append one batch summary and return its id. */
export async function recordOperation(tx: Tx, input: RecordOperationInput): Promise<string> {
  const row = await tx.ledgerOperationLog.create({
    data: {
      bookId: input.bookId,
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      objectName: input.objectName,
      affectedCount: input.affectedCount,
      detail: input.detail as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return row.id;
}

/**
 * Read a ledger's batch summaries back, newest first.
 *
 * ⚠️ **This read exists because a table nobody reads rots** (AGENTS.md §5: *"不留没有使用者的东西"*).
 * The writer alone would be enough for the tests, but not enough for a person: the row is written so
 * that *"我把这个分类删了，历史去哪了"* has an answer, and an answer nobody can fetch is not one.
 *
 * ⚠️ **A viewer may read this.** Knowing who deleted a category is part of seeing the ledger — the
 * same rule `/ledger/history` follows.
 */
export async function readOperations(
  prisma: PrismaClient,
  bookId: string,
  limit: number,
): Promise<{ entries: LedgerOperation[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.ledgerOperationLog.findMany({
      where: { bookId },
      orderBy: { at: "desc" },
      take: limit,
      select: {
        id: true,
        action: true,
        objectType: true,
        objectId: true,
        objectName: true,
        affectedCount: true,
        actorName: true,
        at: true,
        detail: true,
      },
    }),
    prisma.ledgerOperationLog.count({ where: { bookId } }),
  ]);

  return {
    /**
     * ⚠️ **`as` rather than a parse.** The two columns are CHECK-constrained to exactly the values
     * `LEDGER_OPERATION_ACTIONS` / `LEDGER_OPERATION_OBJECT_TYPES` list (and a test pins the two
     * copies together), so a bad value cannot be stored — a runtime parse here would only turn a
     * database that has been edited by hand into a 500.
     */
    entries: rows.map((row) => ({
      id: row.id,
      action: row.action as LedgerOperationAction,
      objectType: row.objectType as LedgerOperationObjectType,
      objectId: row.objectId,
      objectName: row.objectName,
      affectedCount: row.affectedCount,
      actorName: row.actorName,
      at: row.at.toISOString(),
      detail: row.detail,
    })),
    total,
  };
}
