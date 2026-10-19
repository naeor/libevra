import type { Prisma } from "../generated/prisma/client.js";
import { conflict } from "../lib/errors.js";

type Tx = Prisma.TransactionClient;

/**
 * S14-D5 phase 4: inverse-operation journal.
 *
 * Each committed import batch writes one journal row in the SAME transaction. Undo applies the
 * rows in reverse order; every operation is idempotent at the row level and a failed undo keeps
 * the lock and the journal, so the server can retry instead of pretending success.
 */
export type UndoOp =
  | { readonly kind: "delete_created_transaction"; readonly transactionId: string }
  | {
      readonly kind: "restore_transaction";
      readonly transactionId: string;
      readonly expectedVersion: number;
      readonly before: TransactionBefore;
    }
  | {
      readonly kind: "restore_source_state";
      readonly targetBookId: string;
      readonly sourceBookKey: string;
      readonly sourceTransactionId: string;
      readonly before: SourceStateBefore | null;
    }
  | {
      readonly kind: "delete_created_taxonomy";
      readonly entity: "category" | "paymentMethod" | "tag";
      readonly id: string;
    };

export interface TransactionBefore {
  readonly id: string;
  readonly seq: number;
  readonly version: number;
  readonly kind: "expense" | "income";
  readonly amountCents: string;
  readonly currency: string;
  readonly categoryId: string;
  readonly paymentMethodId: string | null;
  readonly occurredAt: string;
  readonly occurredLocalDate: string;
  readonly occurredTz: string;
  readonly note: string | null;
  readonly sourceRef: string | null;
  readonly sourceNamespace: string;
  readonly tagIds: readonly string[];
}

export interface SourceStateBefore {
  readonly sourceKind: string;
  readonly sourceBookId: string | null;
  readonly sourceBookKey: string;
  readonly sourceTransactionId: string;
  readonly sourceFingerprint: string;
  readonly decision: string;
  readonly targetTransactionId: string | null;
  readonly targetVersion: number | null;
  readonly lastImportJobId: string | null;
}

export interface StoredUndoBatch {
  readonly version: 1;
  readonly ops: readonly UndoOp[];
}

export function readUndoBatch(payload: unknown): StoredUndoBatch {
  const parsed = payload as StoredUndoBatch;
  if (parsed === null || typeof parsed !== "object" || parsed.version !== 1 || !Array.isArray(parsed.ops)) {
    throw new Error("撤销日志格式无效。");
  }
  return parsed;
}

export async function writeUndoBatch(
  tx: Tx,
  jobId: string,
  batchIndex: number,
  ops: readonly UndoOp[],
): Promise<void> {
  const payload: StoredUndoBatch = { version: 1, ops };
  await tx.ledgerImportUndoBatch.create({
    data: {
      jobId,
      batchIndex,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function getSourceStateBefore(
  tx: Tx,
  targetBookId: string,
  sourceBookKey: string,
  sourceTransactionId: string,
): Promise<SourceStateBefore | null> {
  const row = await tx.ledgerImportSourceState.findUnique({
    where: {
      targetBookId_sourceBookKey_sourceTransactionId: {
        targetBookId,
        sourceBookKey,
        sourceTransactionId,
      },
    },
  });
  if (row === null) return null;
  return {
    sourceKind: row.sourceKind,
    sourceBookId: row.sourceBookId,
    sourceBookKey: row.sourceBookKey,
    sourceTransactionId: row.sourceTransactionId,
    sourceFingerprint: row.sourceFingerprint,
    decision: row.decision,
    targetTransactionId: row.targetTransactionId,
    targetVersion: row.targetVersion,
    lastImportJobId: row.lastImportJobId,
  };
}

export async function readTransactionBefore(tx: Tx, transactionId: string): Promise<TransactionBefore | null> {
  const row = await tx.transaction.findFirst({
    where: { id: transactionId },
    select: {
      id: true,
      seq: true,
      version: true,
      kind: true,
      amountCents: true,
      currency: true,
      categoryId: true,
      paymentMethodId: true,
      occurredAt: true,
      occurredLocalDate: true,
      occurredTz: true,
      note: true,
      sourceRef: true,
      sourceNamespace: true,
      tags: { select: { tagId: true } },
    },
  });
  if (row === null) return null;
  return {
    id: row.id,
    seq: row.seq,
    version: row.version,
    kind: row.kind,
    amountCents: row.amountCents.toString(),
    currency: row.currency,
    categoryId: row.categoryId,
    paymentMethodId: row.paymentMethodId,
    occurredAt: row.occurredAt.toISOString(),
    occurredLocalDate: row.occurredLocalDate.toISOString().slice(0, 10),
    occurredTz: row.occurredTz,
    note: row.note,
    sourceRef: row.sourceRef,
    sourceNamespace: row.sourceNamespace,
    tagIds: row.tags.map((tag) => tag.tagId).sort(),
  };
}

export async function applyUndoOps(
  tx: Tx,
  job: { readonly id: string; readonly targetBookId: string; readonly userId: string; readonly importRef: string },
  ops: readonly UndoOp[],
): Promise<void> {
  for (const op of ops) {
    if (op.kind === "delete_created_transaction") {
      const row = await tx.transaction.findUnique({
        where: { id: op.transactionId },
        select: { bookId: true, importRef: true, sourceRef: true },
      });
      if (row === null) continue;
      if (row.bookId !== job.targetBookId || row.importRef !== job.importRef) {
        throw conflict("undo_target_mismatch", "撤销时发现目标账目已不属于本任务，已停止并保留锁。");
      }
      // This row did not exist before the task. A hard delete is exact because the persistent
      // lock has prevented any other editor from touching it while the task was reversible.
      await tx.transaction.delete({ where: { id: op.transactionId } });
      continue;
    }

    if (op.kind === "restore_transaction") {
      const current = await tx.transaction.findFirst({
        where: { id: op.transactionId, bookId: job.targetBookId },
        select: { version: true, deletedAt: true },
      });
      if (current === null) {
        throw conflict("undo_target_missing", "撤销时找不到需要恢复的目标账目，已停止并保留锁。");
      }
      if (current.deletedAt !== null || current.version !== op.expectedVersion) {
        throw conflict("undo_target_changed", "目标账目在等待确认期间被改动，撤销已停止并保留锁。");
      }
      const before = op.before;
      await tx.transaction.update({
        where: { id: op.transactionId },
        data: {
          kind: before.kind,
          amountCents: BigInt(before.amountCents),
          currency: before.currency,
          categoryId: before.categoryId,
          paymentMethodId: before.paymentMethodId,
          occurredAt: new Date(before.occurredAt),
          occurredLocalDate: new Date(`${before.occurredLocalDate}T00:00:00.000Z`),
          occurredTz: before.occurredTz,
          note: before.note,
          sourceRef: before.sourceRef,
          sourceNamespace: before.sourceNamespace,
          version: before.version + 1,
          tags: {
            deleteMany: {},
            create: before.tagIds.map((tagId) => ({ tagId })),
          },
        },
      });
      continue;
    }

    if (op.kind === "restore_source_state") {
      const current = await tx.ledgerImportSourceState.findUnique({
        where: {
          targetBookId_sourceBookKey_sourceTransactionId: {
            targetBookId: op.targetBookId,
            sourceBookKey: op.sourceBookKey,
            sourceTransactionId: op.sourceTransactionId,
          },
        },
      });
      if (current !== null && current.lastImportJobId !== job.id) {
        throw conflict("undo_state_changed", "来源状态在撤销前被其他任务改动，已停止并保留锁。");
      }
      if (op.before === null) {
        await tx.ledgerImportSourceState.deleteMany({
          where: {
            targetBookId: op.targetBookId,
            sourceBookKey: op.sourceBookKey,
            sourceTransactionId: op.sourceTransactionId,
            lastImportJobId: job.id,
          },
        });
      } else {
        await tx.ledgerImportSourceState.upsert({
          where: {
            targetBookId_sourceBookKey_sourceTransactionId: {
              targetBookId: op.targetBookId,
              sourceBookKey: op.sourceBookKey,
              sourceTransactionId: op.sourceTransactionId,
            },
          },
          create: {
            targetBookId: op.targetBookId,
            sourceKind: op.before.sourceKind,
            sourceBookId: op.before.sourceBookId,
            sourceBookKey: op.before.sourceBookKey,
            sourceTransactionId: op.before.sourceTransactionId,
            sourceFingerprint: op.before.sourceFingerprint,
            decision: op.before.decision,
            targetTransactionId: op.before.targetTransactionId,
            targetVersion: op.before.targetVersion,
            lastImportJobId: op.before.lastImportJobId,
          },
          update: {
            sourceKind: op.before.sourceKind,
            sourceBookId: op.before.sourceBookId,
            sourceFingerprint: op.before.sourceFingerprint,
            decision: op.before.decision,
            targetTransactionId: op.before.targetTransactionId,
            targetVersion: op.before.targetVersion,
            lastImportJobId: op.before.lastImportJobId,
          },
        });
      }
      continue;
    }

    // Taxonomy created solely by this batch. Remove only when no remaining transaction references it.
    const anyReference =
      op.entity === "category"
        ? await tx.transaction.count({ where: { categoryId: op.id } })
        : op.entity === "paymentMethod"
          ? await tx.transaction.count({ where: { paymentMethodId: op.id } })
          : await tx.transactionTag.count({ where: { tagId: op.id } });
    if (anyReference > 0) {
      throw conflict("undo_taxonomy_in_use", "导入创建的分类/标签仍被账目使用，撤销已停止并保留锁。");
    }
    if (op.entity === "category") await tx.category.deleteMany({ where: { id: op.id, bookId: job.targetBookId } });
    else if (op.entity === "paymentMethod") {
      await tx.paymentMethod.deleteMany({ where: { id: op.id, bookId: job.targetBookId } });
    } else {
      await tx.tag.deleteMany({ where: { id: op.id, bookId: job.targetBookId } });
    }
  }
}
