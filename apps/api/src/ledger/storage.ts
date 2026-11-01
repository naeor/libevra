import type { Prisma } from "../generated/prisma/client.js";
import type { PrismaClient } from "../db.js";
import { AppError, notFound } from "../lib/errors.js";

type Tx = Prisma.TransactionClient;
export const STORAGE_DEFAULTS = {
  accountBytes: 1_000_000_000n, bookBytes: 500_000_000n,
  fileBytes: 100_000_000n, entryBytes: 200_000_000n, entryFiles: 10,
};

export async function storagePolicy(tx: Tx) {
  return (await tx.storagePolicy.findUnique({ where: { id: "global" } })) ?? STORAGE_DEFAULTS;
}

/** 限额校验和容量预留在同一事务里串行；小范围汇总账本计数，不扫描账目。 */
export async function lockStorage(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(171119, 20261101)::text`;
}

/** 写账本时先锁账本、再锁操作者额度。其它成员超额不参与校验。 */
export async function lockBookStorage(tx: Tx, bookId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM books WHERE id=${bookId}::uuid FOR UPDATE`;
}
export async function lockAccountStorage(tx: Tx, actorId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'libevra-storage:' + actorId}, 0))::text`;
}
export async function withStorageGrowth<T>(db: PrismaClient, actorId: string, bookId: string, write: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async tx => {
    await lockBookStorage(tx, bookId);
    await lockAccountStorage(tx, actorId);
    const result = await write(tx);
    await assertStorageGrowth(tx, actorId, bookId, 0n);
    return result;
  });
}

export async function accountStorage(tx: Tx, userId: string) {
  const [user, memberships, policy] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { storageBytes: true, storageLimitBytes: true } }),
    tx.bookMember.findMany({ where: { userId, leftAt: null }, select: {
      book: { select: { id: true, name: true, storageBytes: true, storageLimitBytes: true,
        archivedAt: true, pendingStorage: { select: { bytes: true } }, _count: { select: { members: { where: { leftAt: null } } } } } },
    } }),
    storagePolicy(tx),
  ]);
  if (!user) throw notFound("account_missing", "找不到账户。");
  const bytes = memberships.reduce((sum, { book }) => sum + book.storageBytes + (book.pendingStorage?.bytes ?? 0n), user.storageBytes);
  const limit = user.storageLimitBytes ?? policy.accountBytes;
  return { bytes, limit, ownBytes: user.storageBytes, overLimit: bytes > limit, books: memberships.map(({ book }) => ({
    id: book.id, name: book.name, bytes: Number(book.storageBytes + (book.pendingStorage?.bytes ?? 0n)),
    limit: Number(book.storageLimitBytes ?? policy.bookBytes), shared: book._count.members > 1,
    archived: book.archivedAt !== null,
  })) };
}

export async function assertStorageGrowth(tx: Tx, actorId: string, bookId: string, growth: bigint): Promise<void> {
  await lockAccountStorage(tx, actorId);
  const [account, book, policy] = await Promise.all([
    accountStorage(tx, actorId),
    tx.book.findUnique({ where: { id: bookId }, select: { storageBytes: true, storageLimitBytes: true, pendingStorage: { select: { bytes: true } } } }),
    storagePolicy(tx),
  ]);
  if (!book) throw notFound("book_missing", "找不到账本。");
  if (account.bytes + growth > account.limit) throw new AppError(413, "account_storage_full", "账户空间不足。仍可更正已有账目、下载和清理数据。");
  if (book.storageBytes + (book.pendingStorage?.bytes ?? 0n) + growth > (book.storageLimitBytes ?? policy.bookBytes)) throw new AppError(413, "book_storage_full", "账本空间不足。仍可更正已有账目、下载和清理数据。");
}

export function storageDto(value: Awaited<ReturnType<typeof accountStorage>>) {
  return { ...value, bytes: Number(value.bytes), limit: Number(value.limit), ownBytes: Number(value.ownBytes) };
}
