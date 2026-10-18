import { randomBytes } from "node:crypto";
import { createPrismaClient } from "../db.js";
import { hashPassword } from "../auth/password.js";

/**
 * Re-apply permanent deletion and account closure after a whole-database restore.
 *
 * ⚠️ **A restored dump is a snapshot from before the deletion.** Without this step, the restore
 * brings deleted ledgers and closed accounts back to life — a tombstone in the *current* database
 * is destroyed by the restore itself.
 *
 * Run **after** `restore.sh` and **before** starting the API for traffic. This script is deliberately
 * separate from the restore script so it can be reviewed and tested: it only removes data that a
 * `book_tombstones` row says was already purged, and only anonymizes accounts that an
 * `account_tombstones` row says were already closed.
 */
const prisma = createPrismaClient(process.env.DATABASE_URL ?? "");
const LOCK_NAME = "libevra_tombstone_replay";

try {
  const [lock] = await prisma.$queryRawUnsafe<{ locked: boolean }[]>(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
    LOCK_NAME,
  );
  if (!lock?.locked) {
    console.log(JSON.stringify({ ok: false, skipped: "another replay is running" }));
    process.exitCode = 1;
  } else {
    try {
      const books = await prisma.bookTombstone.findMany();
      let bookCount = 0;
      for (const tombstone of books) {
        await prisma.$transaction(async (tx) => {
          const book = await tx.book.findUnique({ where: { id: tombstone.bookId }, select: { id: true } });
          if (book === null) return;
          // Same order as the live purge: entries before categories (RESTRICT).
          await tx.transaction.deleteMany({ where: { bookId: tombstone.bookId } });
          await tx.conflictResolution.deleteMany({ where: { bookId: tombstone.bookId } });
          await tx.book.delete({ where: { id: tombstone.bookId } });
          bookCount += 1;
        });
      }

      const accounts = await prisma.accountTombstone.findMany();
      const unusablePasswordHash = await hashPassword(randomBytes(32).toString("hex"));
      let accountCount = 0;
      for (const tombstone of accounts) {
        const user = await prisma.user.findUnique({ where: { id: tombstone.userId } });
        if (user === null) continue;
        await prisma.$transaction(async (tx) => {
          await tx.session.deleteMany({ where: { userId: user.id } });
          await tx.notificationQuota.deleteMany({ where: { userId: user.id } });
          await tx.adminGrant.deleteMany({ where: { userId: user.id } });
          await tx.adminAllowEntry.deleteMany({ where: { userId: user.id } });
          await tx.user.update({
            where: { id: user.id },
            data: {
              username: `closed_${user.id}`,
              displayName: "已注销账号",
              passwordHash: unusablePasswordHash,
              recoveryCodeHash: null,
              recoveryCodeUsedAt: null,
              disabledAt: tombstone.closedAt,
              disabledBy: "tombstone_replay",
              closedAt: tombstone.closedAt,
              lastBookId: null,
              isAdmin: false,
              referredByUserId: null,
            },
          });
          accountCount += 1;
        });
      }
      console.log(
        JSON.stringify({
          ok: true,
          replayedBookTombstones: bookCount,
          replayedAccountTombstones: accountCount,
          note: "archived kept ledgers remain archived; purge them by scheduled cleanup as usual",
        }),
      );
    } finally {
      await prisma.$queryRawUnsafe("SELECT pg_advisory_unlock(hashtext($1))", LOCK_NAME);
    }
  }
} catch (error) {
  console.error("tombstone replay failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
