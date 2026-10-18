import type { Book, Prisma, User } from "../generated/prisma/client.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import type { PrismaClient } from "../db.js";
import {
  archiveDeadlines,
  RECOVERY_REQUEST_DAYS,
  addDays,
} from "./constants.js";
import { recordLifecycleEvent, type LifecycleActor } from "./events.js";

type Tx = Prisma.TransactionClient;

const LOCKED_BOOK = `SELECT "id" FROM "books" WHERE "id" = $1::uuid FOR UPDATE`;

export interface BookLifecycleSummary {
  readonly id: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly memberCount: number;
  readonly archivedAt: string | null;
  readonly selfRestoreUntil: string | null;
  readonly scheduledPurgeAt: string | null;
  readonly purgeStartedAt: string | null;
  readonly purgeAttempts: number;
  readonly purgeLastError: string | null;
  readonly isManager: boolean;
  readonly isCreator: boolean;
  readonly canLeave: boolean;
  readonly canArchive: boolean;
  readonly canDelete: boolean;
  readonly canSelfRestore: boolean;
  readonly canRequestManualRecovery: boolean;
  readonly needsSuccessor: boolean;
  readonly pendingRecoveryRequest: {
    readonly id: string;
    readonly status: string;
    readonly requestedAt: string;
    readonly deadlineAt: string;
  } | null;
}

export interface ArchiveBookResult {
  readonly summary: BookLifecycleSummary;
  readonly alreadyArchived: boolean;
}

export interface PurgeBookResult {
  readonly bookId: string;
  readonly transactionCount: number;
  readonly memberCount: number;
  readonly archivedAt: Date | null;
}

async function lockBook(tx: Tx, bookId: string): Promise<void> {
  await tx.$queryRawUnsafe(LOCKED_BOOK, bookId);
}

async function activeMemberCount(tx: Tx, bookId: string): Promise<number> {
  return tx.bookMember.count({ where: { bookId, leftAt: null } });
}

async function successorCandidate(
  tx: Tx,
  bookId: string,
  leavingUserId: string,
): Promise<{ userId: string; role: string } | null> {
  return tx.bookMember.findFirst({
    where: {
      bookId,
      userId: { not: leavingUserId },
      leftAt: null,
      role: { in: ["editor", "owner"] },
    },
    orderBy: { joinedAt: "asc" },
    select: { userId: true, role: true },
  });
}

async function accountNumberOf(tx: Tx, userId: string | null): Promise<string | null> {
  if (userId === null) return null;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { accountNumber: true } });
  return user?.accountNumber ?? null;
}

async function actorOf(tx: Tx, userId: string): Promise<LifecycleActor> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { accountNumber: true },
  });
  return { userId, accountNumber: user?.accountNumber ?? null };
}

async function pendingRequestFor(tx: Tx, bookId: string): Promise<{
  id: string;
  status: string;
  requestedAt: Date;
  deadlineAt: Date;
} | null> {
  return tx.bookRecoveryRequest.findFirst({
    where: { bookId, status: "pending" },
    orderBy: { requestedAt: "desc" },
    select: { id: true, status: true, requestedAt: true, deadlineAt: true },
  });
}

async function toSummary(
  tx: Tx,
  book: Pick<
    Book,
    | "id"
    | "name"
    | "bookNumber"
    | "createdBy"
    | "managedByUserId"
    | "archivedAt"
    | "selfRestoreUntil"
    | "scheduledPurgeAt"
    | "purgeStartedAt"
    | "purgeAttempts"
    | "purgeLastError"
  >,
  userId: string,
  memberCount: number,
  pending: Awaited<ReturnType<typeof pendingRequestFor>>,
  now: Date,
): Promise<BookLifecycleSummary> {
  const isManager = book.managedByUserId === userId;
  const archived = book.archivedAt !== null;
  const canSelfRestore =
    archived &&
    book.purgeStartedAt === null &&
    book.selfRestoreUntil !== null &&
    book.selfRestoreUntil.getTime() > now.getTime();
  const canRequestManualRecovery =
    archived &&
    book.purgeStartedAt === null &&
    book.selfRestoreUntil !== null &&
    book.selfRestoreUntil.getTime() <= now.getTime() &&
    book.scheduledPurgeAt !== null &&
    book.scheduledPurgeAt.getTime() > now.getTime() &&
    pending === null;
  const needsSuccessor =
    !archived &&
    memberCount > 1 &&
    isManager &&
    (await successorCandidate(tx, book.id, userId)) === null;

  return {
    id: book.id,
    name: book.name,
    bookNumber: book.bookNumber,
    memberCount,
    archivedAt: book.archivedAt?.toISOString() ?? null,
    selfRestoreUntil: book.selfRestoreUntil?.toISOString() ?? null,
    scheduledPurgeAt: book.scheduledPurgeAt?.toISOString() ?? null,
    purgeStartedAt: book.purgeStartedAt?.toISOString() ?? null,
    purgeAttempts: book.purgeAttempts,
    purgeLastError: book.purgeLastError,
    isManager,
    isCreator: book.createdBy === userId,
    canLeave: !archived && memberCount > 1 && !needsSuccessor,
    canArchive: !archived && memberCount <= 1,
    canDelete: !archived && memberCount <= 1,
    canSelfRestore,
    canRequestManualRecovery,
    needsSuccessor,
    pendingRecoveryRequest:
      pending === null
        ? null
        : {
            id: pending.id,
            status: pending.status,
            requestedAt: pending.requestedAt.toISOString(),
            deadlineAt: pending.deadlineAt.toISOString(),
          },
  };
}

/** Lifecycle view for one ledger. It intentionally exposes no transaction content. */
export async function getBookLifecycle(
  prisma: PrismaClient,
  bookId: string,
  userId: string,
  now: Date = new Date(),
): Promise<BookLifecycleSummary> {
  return prisma.$transaction(async (tx) => {
    const book = await tx.book.findUnique({ where: { id: bookId } });
    if (book === null) {
      const tombstone = await tx.bookTombstone.findUnique({ where: { bookId } });
      if (tombstone !== null) throw notFound("book_deleted", "这本账已经永久删除。");
      throw notFound("book_missing", "找不到这本账。");
    }

    const membership = await tx.bookMember.findUnique({
      where: { bookId_userId: { bookId, userId } },
      select: { leftAt: true },
    });
    if (membership === null || membership.leftAt !== null) {
      throw forbidden("book_forbidden", "无权访问该账本。");
    }

    return toSummary(
      tx,
      book,
      userId,
      await activeMemberCount(tx, bookId),
      await pendingRequestFor(tx, bookId),
      now,
    );
  });
}

/**
 * Leave a shared ledger. The creator/manager role is transferred inside the same transaction so
 * a shared ledger is never left without somebody able to make lifecycle decisions.
 */
export async function leaveBookSafely(
  prisma: PrismaClient,
  bookId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ readonly left: boolean; readonly managerTransferredTo: string | null }> {
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, bookId);
    const book = await tx.book.findUnique({ where: { id: bookId } });
    if (book === null) throw notFound("book_missing", "找不到这本账。");
    if (book.archivedAt !== null) throw conflict("book_archived", "这本账已经归档。");

    const membership = await tx.bookMember.findUnique({
      where: { bookId_userId: { bookId, userId } },
      select: { leftAt: true },
    });
    if (membership === null || membership.leftAt !== null) {
      throw forbidden("not_a_member", "你不在这本账里。");
    }

    const memberCount = await activeMemberCount(tx, bookId);
    if (memberCount <= 1) {
      throw conflict(
        "book_last_member",
        "这是账本的最后一位成员。请选择归档或永久删除，而不是直接退出。",
      );
    }

    const actor = await actorOf(tx, userId);
    let managerTransferredTo: string | null = null;
    if (book.managedByUserId === userId) {
      const successor = await successorCandidate(tx, bookId, userId);
      if (successor === null) {
        throw conflict(
          "book_needs_successor",
          "这本账还没有其他可管理的编辑者。请先添加成员或设置编辑者，再退出。",
        );
      }
      await tx.book.update({
        where: { id: bookId },
        data: { managedByUserId: successor.userId },
      });
      managerTransferredTo = successor.userId;
      await recordLifecycleEvent(tx, {
        bookId,
        kind: "manager_transferred",
        actor,
        detail: { toUserId: successor.userId },
        at: now,
      });
    }

    await tx.bookMember.update({
      where: { bookId_userId: { bookId, userId } },
      data: { leftAt: now },
    });
    await tx.user.updateMany({
      where: { id: userId, lastBookId: bookId },
      data: { lastBookId: null },
    });
    await recordLifecycleEvent(tx, {
      bookId,
      kind: "left",
      actor,
      detail: { managerTransferredTo },
      at: now,
    });
    return { left: true, managerTransferredTo };
  });
}

/** Archive a ledger that has only this member. */
export async function archiveBook(
  prisma: PrismaClient,
  input: {
    readonly bookId: string;
    readonly userId: string;
    readonly reason?: "user_archive" | "account_closure" | "last_member";
    readonly now?: Date;
  },
): Promise<ArchiveBookResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, input.bookId);
    const book = await tx.book.findUnique({ where: { id: input.bookId } });
    if (book === null) throw notFound("book_missing", "找不到这本账。");

    const membership = await tx.bookMember.findUnique({
      where: { bookId_userId: { bookId: input.bookId, userId: input.userId } },
      select: { leftAt: true },
    });
    if (membership === null || membership.leftAt !== null) {
      throw forbidden("not_a_member", "你不在这本账里。");
    }
    const memberCount = await activeMemberCount(tx, input.bookId);
    if (memberCount > 1) {
      throw conflict(
        "book_shared_archive_refused",
        "这本账还有其他成员。请先退出协作，不能由一个人归档整本账。",
      );
    }
    if (book.purgeStartedAt !== null) {
      throw conflict("book_purge_in_progress", "这本账正在清理，不能归档。");
    }
    if (book.archivedAt !== null) {
      return {
        alreadyArchived: true,
        summary: await toSummary(
          tx,
          book,
          input.userId,
          memberCount,
          await pendingRequestFor(tx, input.bookId),
          now,
        ),
      };
    }

    const deadlines = archiveDeadlines(now);
    await tx.book.update({
      where: { id: input.bookId },
      data: {
        archivedAt: deadlines.archivedAt,
        archivedByUserId: input.userId,
        archiveReason: input.reason ?? "user_archive",
        selfRestoreUntil: deadlines.selfRestoreUntil,
        scheduledPurgeAt: deadlines.scheduledPurgeAt,
        purgeStartedAt: null,
        purgeAttempts: 0,
        purgeLastError: null,
        managedByUserId: book.managedByUserId ?? input.userId,
      },
    });
    await tx.user.updateMany({
      where: { id: input.userId, lastBookId: input.bookId },
      data: { lastBookId: null },
    });
    await recordLifecycleEvent(tx, {
      bookId: input.bookId,
      kind: "archived",
      actor: await actorOf(tx, input.userId),
      detail: {
        selfRestoreUntil: deadlines.selfRestoreUntil.toISOString(),
        scheduledPurgeAt: deadlines.scheduledPurgeAt.toISOString(),
      },
      at: now,
    });

    const updated = await tx.book.findUniqueOrThrow({ where: { id: input.bookId } });
    return {
      alreadyArchived: false,
      summary: await toSummary(
        tx,
        updated,
        input.userId,
        memberCount,
        null,
        now,
      ),
    };
  });
}

/** Restore an archived ledger within its 60-day self-service window. */
export async function restoreArchivedBook(
  prisma: PrismaClient,
  bookId: string,
  userId: string,
  now: Date = new Date(),
): Promise<BookLifecycleSummary> {
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, bookId);
    const book = await tx.book.findUnique({ where: { id: bookId } });
    if (book === null) throw notFound("book_missing", "找不到这本账。");
    const membership = await tx.bookMember.findUnique({
      where: { bookId_userId: { bookId, userId } },
      select: { leftAt: true, role: true },
    });
    if (membership === null || membership.leftAt !== null) {
      throw forbidden("not_a_member", "你不在这本账里。");
    }
    if (book.archivedAt === null) return toSummary(tx, book, userId, 1, null, now);
    if (book.purgeStartedAt !== null) {
      throw conflict("book_purge_in_progress", "这本账正在清理，不能恢复。");
    }
    if (
      book.selfRestoreUntil === null ||
      book.selfRestoreUntil.getTime() <= now.getTime()
    ) {
      const pending = await pendingRequestFor(tx, bookId);
      if (pending !== null) {
        throw conflict("book_restore_window_closed", "自助恢复期已结束，已有待处理的人工恢复申请。");
      }
      throw conflict(
        "book_restore_window_closed",
        "自助恢复期已结束。可以提交人工恢复申请，由管理员核验。",
      );
    }

    await tx.book.update({
      where: { id: bookId },
      data: {
        archivedAt: null,
        archivedByUserId: null,
        archiveReason: null,
        selfRestoreUntil: null,
        scheduledPurgeAt: null,
        purgeStartedAt: null,
        purgeAttempts: 0,
        purgeLastError: null,
      },
    });
    await recordLifecycleEvent(tx, {
      bookId,
      kind: "restored",
      actor: await actorOf(tx, userId),
      at: now,
    });
    const restored = await tx.book.findUniqueOrThrow({ where: { id: bookId } });
    return toSummary(tx, restored, userId, 1, null, now);
  });
}

/** Create an active-account manual recovery request after the self-service window. */
export async function requestManualRecoveryForActiveAccount(
  prisma: PrismaClient,
  bookId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ readonly requestId: string; readonly deadlineAt: string }> {
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, bookId);
    const book = await tx.book.findUnique({ where: { id: bookId } });
    if (book === null) throw notFound("book_missing", "找不到这本账。");
    const membership = await tx.bookMember.findUnique({
      where: { bookId_userId: { bookId, userId } },
      select: { leftAt: true },
    });
    if (membership === null || membership.leftAt !== null) {
      throw forbidden("not_a_member", "你不在这本账里。");
    }
    if (
      book.archivedAt === null ||
      book.selfRestoreUntil === null ||
      book.selfRestoreUntil.getTime() > now.getTime()
    ) {
      throw badRequest("book_self_restore_available", "这本书仍在 60 天自助恢复期内，请直接恢复。");
    }
    if (book.purgeStartedAt !== null || book.scheduledPurgeAt === null || book.scheduledPurgeAt.getTime() <= now.getTime()) {
      throw conflict("book_purge_in_progress", "这本书已经进入清理阶段。");
    }
    const existing = await pendingRequestFor(tx, bookId);
    if (existing !== null) {
      throw conflict("recovery_request_pending", "已经有一条待处理的恢复申请。");
    }

    const deadlineAt = new Date(
      Math.min(
        addDays(now, RECOVERY_REQUEST_DAYS).getTime(),
        book.scheduledPurgeAt.getTime(),
      ),
    );
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { accountNumber: true },
    });
    const request = await tx.bookRecoveryRequest.create({
      data: {
        bookId,
        bookNumber: book.bookNumber,
        requesterUserId: userId,
        requesterAccountNumber: user.accountNumber,
        kind: "active_account",
        status: "pending",
        deadlineAt,
        targetUserId: userId,
        targetAccountNumber: user.accountNumber,
      },
    });
    await recordLifecycleEvent(tx, {
      bookId,
      kind: "recovery_requested",
      actor: { userId, accountNumber: user.accountNumber },
      detail: { requestId: request.id, deadlineAt: deadlineAt.toISOString() },
      at: now,
    });
    return { requestId: request.id, deadlineAt: deadlineAt.toISOString() };
  });
}

/** Apply a recovery request's approval; the book must still be archived. */
export async function approveRecoveryRequest(
  prisma: PrismaClient,
  input: {
    readonly requestId: string;
    readonly adminUserId: string;
    readonly adminName: string;
    readonly targetAccountNumber?: string;
    readonly note?: string;
    readonly now?: Date;
  },
): Promise<{ readonly bookId: string; readonly targetUserId: string }> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      `SELECT "id" FROM "book_recovery_requests" WHERE "id" = $1::uuid FOR UPDATE`,
      input.requestId,
    );
    const request = await tx.bookRecoveryRequest.findUnique({ where: { id: input.requestId } });
    if (request === null) throw notFound("recovery_request_missing", "找不到这条恢复申请。");
    if (request.status !== "pending") {
      throw conflict("recovery_request_decided", "这条申请已经处理过。");
    }
    if (request.deadlineAt.getTime() <= now.getTime()) {
      throw conflict("recovery_request_expired", "这条申请已经超过审核期限。");
    }

    await lockBook(tx, request.bookId);
    const book = await tx.book.findUnique({ where: { id: request.bookId } });
    if (book === null) {
      const tombstone = await tx.bookTombstone.findUnique({ where: { bookId: request.bookId } });
      if (tombstone !== null) {
        throw conflict("book_already_purged", "这本账已经永久删除，无法恢复。");
      }
      throw notFound("book_missing", "找不到这本账。");
    }
    if (book.archivedAt === null) throw conflict("book_not_archived", "这本账已经不在归档状态。");
    if (book.purgeStartedAt !== null) {
      throw conflict("book_purge_in_progress", "这本账正在清理，不能再恢复。");
    }

    const targetUserId =
      request.kind === "active_account" ? request.requesterUserId : null;
    let target: Pick<User, "id" | "accountNumber" | "closedAt"> | null = null;
    if (targetUserId !== null) {
      target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, accountNumber: true, closedAt: true },
      });
    } else {
      const accountNumber = input.targetAccountNumber ?? request.targetAccountNumber;
      if (accountNumber === undefined || accountNumber === null) {
        throw badRequest("recovery_target_required", "关闭账号的恢复申请必须指定接收账本的有效账号。");
      }
      target = await tx.user.findUnique({
        where: { accountNumber },
        select: { id: true, accountNumber: true, closedAt: true },
      });
    }
    if (target === null || target.closedAt !== null) {
      throw badRequest("recovery_target_invalid", "接收账本的账号不存在或已经注销。");
    }

    await tx.bookMember.upsert({
      where: { bookId_userId: { bookId: request.bookId, userId: target.id } },
      create: { bookId: request.bookId, userId: target.id, role: "editor" },
      update: { leftAt: null, role: "editor" },
    });
    if (request.requesterUserId !== null && request.requesterUserId !== target.id) {
      await tx.bookMember.updateMany({
        where: { bookId: request.bookId, userId: request.requesterUserId },
        data: { leftAt: now },
      });
    }
    await tx.book.update({
      where: { id: request.bookId },
      data: {
        archivedAt: null,
        archivedByUserId: null,
        archiveReason: null,
        selfRestoreUntil: null,
        scheduledPurgeAt: null,
        purgeStartedAt: null,
        purgeAttempts: 0,
        purgeLastError: null,
        managedByUserId: target.id,
      },
    });
    await tx.bookRecoveryRequest.update({
      where: { id: request.id },
      data: {
        status: "approved",
        decidedAt: now,
        decidedByUserId: input.adminUserId,
        decidedByName: input.adminName,
        decisionNote: input.note ?? null,
        targetUserId: target.id,
        targetAccountNumber: target.accountNumber,
      },
    });
    await recordLifecycleEvent(tx, {
      bookId: request.bookId,
      kind: "recovery_approved",
      actor: { userId: input.adminUserId, accountNumber: null },
      detail: { requestId: request.id, targetUserId: target.id },
      at: now,
    });
    return { bookId: request.bookId, targetUserId: target.id };
  });
}

export async function rejectRecoveryRequest(
  prisma: PrismaClient,
  input: {
    readonly requestId: string;
    readonly adminUserId: string;
    readonly adminName: string;
    readonly note?: string;
    readonly now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  await prisma.$transaction(async (tx) => {
    const request = await tx.bookRecoveryRequest.findUnique({ where: { id: input.requestId } });
    if (request === null) throw notFound("recovery_request_missing", "找不到这条恢复申请。");
    if (request.status !== "pending") {
      throw conflict("recovery_request_decided", "这条申请已经处理过。");
    }
    await tx.bookRecoveryRequest.update({
      where: { id: request.id },
      data: {
        status: "rejected",
        decidedAt: now,
        decidedByUserId: input.adminUserId,
        decidedByName: input.adminName,
        decisionNote: input.note ?? null,
      },
    });
    await recordLifecycleEvent(tx, {
      bookId: request.bookId,
      kind: "recovery_rejected",
      actor: { userId: input.adminUserId, accountNumber: null },
      detail: { requestId: request.id, reason: input.note ?? null },
      at: now,
    });
  });
}

async function purgeLockedBook(
  tx: Tx,
  book: Book,
  input: {
    readonly deletionMethod: "self_delete" | "account_closure" | "auto_purge" | "admin_purge";
    readonly deletionReason?: string | null;
    readonly actorUserId: string | null;
    readonly actorAccountNumber: string | null;
    readonly now: Date;
    readonly requestId?: string | null;
  },
): Promise<PurgeBookResult> {
  const memberCount = await activeMemberCount(tx, book.id);
  const transactionCount = await tx.transaction.count({ where: { bookId: book.id } });
  const creator = await tx.user.findUnique({
    where: { id: book.createdBy },
    select: { accountNumber: true },
  });

  await tx.bookTombstone.create({
    data: {
      bookId: book.id,
      bookNumber: book.bookNumber,
      originalCreatedAt: book.createdAt,
      createdByUserId: book.createdBy,
      createdByAccountNumber: creator?.accountNumber ?? null,
      archivedAt: book.archivedAt,
      selfRestoreUntil: book.selfRestoreUntil,
      scheduledPurgeAt: book.scheduledPurgeAt,
      purgedAt: input.now,
      deletionMethod: input.deletionMethod,
      deletionReason: input.deletionReason ?? null,
      deletedByUserId: input.actorUserId,
      deletedByAccountNumber: input.actorAccountNumber,
      memberCount,
      transactionCount,
      detail: {
        managerUserId: book.managedByUserId,
        archiveReason: book.archiveReason,
        purgeAttempts: book.purgeAttempts,
      },
      requestId: input.requestId ?? null,
    },
  });

  /**
   * ⚠️ **Transactions first.**
   * `transactions.category_id` is ON DELETE RESTRICT, so deleting categories or the book before
   * its entries exists in a race with a FK refusal. Resetting tests already documents this order.
   */
  await tx.transaction.deleteMany({ where: { bookId: book.id } });
  await tx.conflictResolution.deleteMany({ where: { bookId: book.id } });
  await tx.book.delete({ where: { id: book.id } });
  await recordLifecycleEvent(tx, {
    bookId: book.id,
    kind: "purged",
    actor: { userId: input.actorUserId, accountNumber: input.actorAccountNumber },
    detail: {
      deletionMethod: input.deletionMethod,
      transactionCount,
      memberCount,
    },
    at: input.now,
  });
  return {
    bookId: book.id,
    transactionCount,
    memberCount,
    archivedAt: book.archivedAt,
  };
}

/**
 * Purge inside an existing account-closure transaction. The caller must already hold the book
 * lock; this is what makes "close account" all-or-nothing across every ledger decision.
 */
export async function purgeBookInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly bookId: string;
    readonly actorUserId: string | null;
    readonly actorAccountNumber: string | null;
    readonly deletionMethod: "self_delete" | "account_closure" | "auto_purge" | "admin_purge";
    readonly deletionReason?: string | null;
    readonly now: Date;
  },
): Promise<PurgeBookResult> {
  await tx.$queryRawUnsafe(LOCKED_BOOK, input.bookId);
  const book = await tx.book.findUnique({ where: { id: input.bookId } });
  if (book === null) throw notFound("book_missing", "找不到这本账。");
  if (book.purgeStartedAt !== null) {
    throw conflict("book_purge_in_progress", "这本账正在清理。");
  }
  const memberCount = await activeMemberCount(tx, book.id);
  if (memberCount > 1) {
    throw conflict(
      "book_shared_delete_refused",
      "这本账还有其他成员，不能由一个人永久删除。请先退出协作。",
    );
  }
  const pending = await pendingRequestFor(tx, book.id);
  if (pending !== null && pending.deadlineAt.getTime() > input.now.getTime()) {
    throw conflict("book_recovery_pending", "这本账还有待处理的恢复申请，暂时不能删除。");
  }
  return purgeLockedBook(tx, book, {
    deletionMethod: input.deletionMethod,
    deletionReason: input.deletionReason ?? null,
    actorUserId: input.actorUserId,
    actorAccountNumber: input.actorAccountNumber,
    now: input.now,
  });
}

/**
 * Permanently delete one ledger. Only a ledger with at most one active member may reach here;
 * shared ledgers are never destroyed on behalf of one member.
 */
export async function purgeBook(
  prisma: PrismaClient,
  input: {
    readonly bookId: string;
    readonly actorUserId: string | null;
    readonly actorAccountNumber: string | null;
    readonly deletionMethod: "self_delete" | "account_closure" | "auto_purge" | "admin_purge";
    readonly deletionReason?: string | null;
    readonly now?: Date;
    readonly ignorePendingRequest?: boolean;
    readonly requestId?: string | null;
  },
): Promise<PurgeBookResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, input.bookId);
    const book = await tx.book.findUnique({ where: { id: input.bookId } });
    if (book === null) throw notFound("book_missing", "找不到这本账。");
    if (book.purgeStartedAt !== null) {
      throw conflict("book_purge_in_progress", "这本账正在清理。");
    }
    const memberCount = await activeMemberCount(tx, book.id);
    if (memberCount > 1) {
      throw conflict(
        "book_shared_delete_refused",
        "这本账还有其他成员，不能由一个人永久删除。请先退出协作。",
      );
    }
    if (input.ignorePendingRequest !== true) {
      const pending = await pendingRequestFor(tx, book.id);
      if (pending !== null && pending.deadlineAt.getTime() > now.getTime()) {
        throw conflict("book_recovery_pending", "这本账还有待处理的恢复申请，暂时不能删除。");
      }
    }
    return purgeLockedBook(tx, book, {
      deletionMethod: input.deletionMethod,
      deletionReason: input.deletionReason ?? null,
      actorUserId: input.actorUserId,
      actorAccountNumber: input.actorAccountNumber,
      now,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    });
  });
}

/** Background cleanup: due archives, bounded by pending recovery-request deadlines. */
export async function runDuePurges(
  prisma: PrismaClient,
  now: Date = new Date(),
  options: { readonly limit?: number; readonly logger?: { error(obj: unknown, message?: string): void } } = {},
): Promise<{ readonly purged: number; readonly skipped: number; readonly failed: number }> {
  const due = await prisma.book.findMany({
    where: {
      archivedAt: { not: null },
      purgeStartedAt: null,
      scheduledPurgeAt: { lte: now },
    },
    select: { id: true },
    orderBy: { scheduledPurgeAt: "asc" },
    take: options.limit ?? 50,
  });

  let purged = 0;
  let skipped = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        await lockBook(tx, id);
        const book = await tx.book.findUnique({ where: { id } });
        if (
          book === null ||
          book.archivedAt === null ||
          book.purgeStartedAt !== null ||
          book.scheduledPurgeAt === null ||
          book.scheduledPurgeAt.getTime() > now.getTime()
        ) {
          return "skip" as const;
        }
        const pending = await pendingRequestFor(tx, id);
        if (pending !== null) {
          if (pending.deadlineAt.getTime() > now.getTime()) return "skip" as const;
          await tx.bookRecoveryRequest.update({
            where: { id: pending.id },
            data: { status: "expired", decidedAt: now },
          });
        }
        await tx.book.update({ where: { id }, data: { purgeStartedAt: now } });
        await purgeLockedBook(tx, book, {
          deletionMethod: "auto_purge",
          deletionReason: "archive_retention_expired",
          actorUserId: null,
          actorAccountNumber: null,
          now,
        });
        return "purged" as const;
      });
      if (outcome === "purged") purged += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      await prisma.book.updateMany({
        where: { id, archivedAt: { not: null } },
        data: {
          purgeAttempts: { increment: 1 },
          purgeLastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          purgeStartedAt: null,
        },
      });
      options.logger?.error({ err: error, bookId: id }, "归档账本自动清理失败，等待重试");
    }
  }
  return { purged, skipped, failed };
}
