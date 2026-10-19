import type { Prisma } from "../generated/prisma/client.js";
import type { PrismaClient } from "../db.js";
import { conflict } from "../lib/errors.js";

/**
 * S14-D D5 phase 4: persistent, per-ledger business locks.
 *
 * The lock is a row in `ledger_write_locks`, not a PostgreSQL table lock. Every write trigger
 * (`assert_ledger_write`) checks it, so application code cannot forget the check; the trigger
 * also takes the parent `books` row FOR SHARE, while acquisition takes it FOR UPDATE — that is
 * what closes the check/write TOCTOU window without blocking unrelated ledgers.
 */
export const IMPORT_LOCK_OWNER_PREFIX = "import:";
export const LOCK_OWNER_SETTING = "libevra.ledger_lock_owner";
export const DEFAULT_CONFIRM_TIMEOUT_SECONDS = 600;
export const MIN_CONFIRM_TIMEOUT_SECONDS = 60;
export const MAX_CONFIRM_TIMEOUT_SECONDS = 3_600;

export function importLockOwnerId(jobId: string): string {
  return `${IMPORT_LOCK_OWNER_PREFIX}${jobId}`;
}

export function confirmTimeoutSeconds(
  value = Number(process.env["IMPORT_CONFIRM_TIMEOUT_SECONDS"] ?? ""),
): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_CONFIRM_TIMEOUT_SECONDS;
  return Math.min(MAX_CONFIRM_TIMEOUT_SECONDS, Math.max(MIN_CONFIRM_TIMEOUT_SECONDS, Math.floor(value)));
}

async function lockBooksNow(tx: Prisma.TransactionClient, bookIds: readonly string[]): Promise<void> {
  const ids = [...new Set(bookIds)].sort();
  if (ids.length === 0) return;
  const placeholders = ids.map((_, index) => `$${String(index + 1)}::uuid`).join(", ");
  await tx.$queryRawUnsafe(
    `SELECT "id" FROM "books" WHERE "id" IN (${placeholders}) ORDER BY "id" FOR UPDATE`,
    ...ids,
  );
}

export async function acquireLedgerLocks(
  tx: Prisma.TransactionClient,
  jobId: string,
  bookIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(bookIds)].sort();
  if (ids.length === 0) return;
  const ownerId = importLockOwnerId(jobId);
  await lockBooksNow(tx, ids);

  const placeholders = ids.map((_, index) => `$${String(index + 1)}::uuid`).join(", ");
  const active = await tx.$queryRawUnsafe<{ book_id: string; owner_kind: string; owner_id: string }[]>(
    `SELECT "book_id", "owner_kind", "owner_id"
       FROM "ledger_write_locks"
      WHERE "book_id" IN (${placeholders}) AND "released_at" IS NULL
      FOR UPDATE`,
    ...ids,
  );
  if (active.length > 0) {
    const first = active[0]!;
    throw conflict("book_locked", "目标或来源账本正在被另一项导入/导出操作占用，请稍后再试。", {
      bookId: first.book_id,
      ownerKind: first.owner_kind,
      ownerId: first.owner_id,
    });
  }

  await tx.ledgerWriteLock.createMany({
    data: ids.map((bookId) => ({
      bookId,
      ownerKind: "import",
      ownerId,
      metadata: { jobId },
    })),
  });
}

export async function assertJobLocks(
  tx: Prisma.TransactionClient,
  jobId: string,
  bookIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(bookIds)].sort();
  if (ids.length === 0) return;
  const ownerId = importLockOwnerId(jobId);
  const locks = await tx.ledgerWriteLock.findMany({
    where: { bookId: { in: ids }, ownerId, releasedAt: null },
    select: { bookId: true },
  });
  if (locks.length !== ids.length) {
    throw conflict("book_lock_missing", "导入锁已丢失或已释放，任务不能继续；请重新预览。", {
      expected: ids.length,
      found: locks.length,
    });
  }
}

export async function releaseJobLocks(tx: Prisma.TransactionClient, jobId: string): Promise<number> {
  const result = await tx.ledgerWriteLock.updateMany({
    where: { ownerId: importLockOwnerId(jobId), releasedAt: null },
    data: { releasedAt: new Date() },
  });
  return result.count;
}

/** Owner transactions must set this transaction-local claim so the write triggers allow them. */
export async function setLedgerLockOwner(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<void> {
  await tx.$queryRawUnsafe(
    `SELECT set_config($1, $2, true)`,
    LOCK_OWNER_SETTING,
    importLockOwnerId(jobId),
  );
}

export async function bookLockInfo(
  client: Prisma.TransactionClient | PrismaClient,
  bookId: string,
): Promise<{ ownerKind: string; ownerId: string; since: Date } | null> {
  const lock = await client.ledgerWriteLock.findFirst({
    where: { bookId, releasedAt: null },
    select: { ownerKind: true, ownerId: true, createdAt: true },
  });
  return lock === null
    ? null
    : { ownerKind: lock.ownerKind, ownerId: lock.ownerId, since: lock.createdAt };
}

/** Read-only operations (normal export) refuse to expose a half-finished import. */
export async function assertBookReadableForExport(
  client: Prisma.TransactionClient | PrismaClient,
  bookId: string,
): Promise<void> {
  const lock = await bookLockInfo(client, bookId);
  if (lock !== null) {
    throw conflict(
      "ledger_locked",
      "账本正在进行导入或导出，暂时不能导出；请等待确认或撤销完成后再试。",
      { bookId, ownerKind: lock.ownerKind },
    );
  }
}

/**
 * Startup/backup-restore reconciliation.
 *
 * A normal server restart already has both the job and its lock rows. A restored backup is the
 * tricky case: transient lock rows may be absent or may survive without a matching active job.
 * This function releases orphan/terminal locks and reacquires missing locks for still-active
 * phase-4 jobs, so a restore cannot silently leave a ledger unlocked under an import or locked
 * forever without an owner.
 */
export async function reconcileLedgerLocks(
  prisma: PrismaClient,
): Promise<{ readonly released: number; readonly reclaimed: number }> {
  let released = 0;
  let reclaimed = 0;
  const terminal = new Set([
    "confirmed",
    "completed",
    "undone",
    "cancelled",
    "expired",
    "failed",
  ]);
  const active = await prisma.ledgerWriteLock.findMany({
    where: { releasedAt: null },
    select: { id: true, bookId: true, ownerId: true },
  });
  for (const lock of active) {
    if (!lock.ownerId.startsWith(IMPORT_LOCK_OWNER_PREFIX)) {
      // Export/special locks are not part of the import lifecycle; leave them to their owner.
      continue;
    }
    const jobId = lock.ownerId.slice(IMPORT_LOCK_OWNER_PREFIX.length);
    const job = await prisma.ledgerImportJob.findUnique({
      where: { id: jobId },
      select: { phase: true, status: true, targetBookId: true, sourceBookId: true },
    });
    if (job === null || job.phase < 4 || terminal.has(job.status)) {
      const updated = await prisma.ledgerWriteLock.updateMany({
        where: { id: lock.id, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      released += updated.count;
    }
  }

  const activeJobs = await prisma.ledgerImportJob.findMany({
    where: {
      phase: { gte: 4 },
      status: {
        in: [
          "queued",
          "running",
          "finalizing",
          "awaiting_confirmation",
          "confirming",
          "paused",
          "undoing",
          "undo_failed",
        ],
      },
    },
    select: { id: true, targetBookId: true, sourceBookId: true },
  });
  for (const job of activeJobs) {
    const expected = job.sourceBookId === null
      ? [job.targetBookId]
      : [job.targetBookId, job.sourceBookId];
    const existing = await prisma.ledgerWriteLock.findMany({
      where: {
        bookId: { in: expected },
        ownerId: importLockOwnerId(job.id),
        releasedAt: null,
      },
      select: { bookId: true },
    });
    const have = new Set(existing.map((lock) => lock.bookId));
    const missing = expected.filter((bookId) => !have.has(bookId));
    if (missing.length === 0) continue;
    try {
      await prisma.$transaction(async (tx) => {
        await acquireLedgerLocks(tx, job.id, missing);
      });
      reclaimed += missing.length;
    } catch {
      // Another live lock exists on one of the books. Surface the state instead of stealing it;
      // the timeout sweep will auto-undo the job once its deadline passes.
      await prisma.ledgerImportJob.updateMany({
        where: {
          id: job.id,
          status: {
            in: [
              "queued",
              "running",
              "finalizing",
              "awaiting_confirmation",
              "confirming",
              "undo_failed",
            ],
          },
        },
        data: {
          status: "paused",
          lastErrorCode: "book_lock_conflict",
          lastErrorMessage: "恢复后发现账本锁归属冲突，已暂停；超时后会安全撤销。",
          confirmationDeadline: new Date(Date.now() + 600_000),
        },
      });
    }
  }
  return { released, reclaimed };
}
