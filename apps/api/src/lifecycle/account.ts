import { randomBytes } from "node:crypto";

import type { Book, Prisma } from "../generated/prisma/client.js";
import type { PrismaClient } from "../db.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { hashPassword } from "../auth/password.js";
import {
  archiveDeadlines,
  addDays,
  RECOVERY_REQUEST_DAYS,
} from "./constants.js";
import {
  generateRecoveryCredential,
  hashRecoveryCredential,
  recordLifecycleEvent,
} from "./events.js";
import { purgeBookInTransaction } from "./book.js";
import { recordCriticalEvent } from "../critical/store.js";

type Tx = Prisma.TransactionClient;

export type CloseMethod = "close_account" | "delete_data";
export type BookDecisionAction = "leave" | "archive" | "delete" | "keep_archived";

export interface BookDecisionInput {
  readonly bookId: string;
  readonly action: BookDecisionAction;
}

export interface AccountBookOption {
  readonly bookId: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly memberCount: number;
  readonly archived: boolean;
  readonly isManager: boolean;
  readonly options: readonly BookDecisionAction[];
  readonly blockedReason: string | null;
  readonly archivedAt: string | null;
  readonly selfRestoreUntil: string | null;
  readonly scheduledPurgeAt: string | null;
}

export interface AccountLifecycleView {
  readonly account: { readonly username: string; readonly accountNumber: string; readonly displayName: string };
  readonly books: readonly AccountBookOption[];
  readonly blockers: readonly string[];
  readonly counts: {
    readonly total: number;
    readonly shared: number;
    readonly single: number;
    readonly archived: number;
  };
}

export interface CloseAccountResult {
  readonly method: CloseMethod;
  readonly closedAt: string;
  readonly recoveryCredential: string | null;
  readonly archivedBookIds: readonly string[];
  readonly deletedBookIds: readonly string[];
  readonly leftBookIds: readonly string[];
  readonly keptArchivedBookIds: readonly string[];
}

export interface DataDeletionBookPreview {
  readonly bookId: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly memberCount: number;
  readonly archived: boolean;
  readonly action: "leave" | "delete";
  readonly blockedReason: string | null;
}

export interface AccountDataDeletionPreview {
  readonly books: readonly DataDeletionBookPreview[];
  readonly counts: { readonly total: number; readonly leave: number; readonly delete: number };
  readonly blockers: readonly string[];
}

export interface AccountDataDeletionResult {
  /** The account is deliberately untouched: no password, session, recovery code or closure change. */
  readonly accountKept: true;
  readonly processed: readonly {
    readonly bookId: string;
    readonly action: "left" | "deleted" | "already_left" | "already_deleted";
  }[];
  readonly remainingBookCount: number;
}

const LOCKED_BOOK = `SELECT "id" FROM "books" WHERE "id" = $1::uuid FOR UPDATE`;

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
): Promise<{ userId: string } | null> {
  return tx.bookMember.findFirst({
    where: {
      bookId,
      userId: { not: leavingUserId },
      leftAt: null,
      role: { in: ["editor", "owner"] },
    },
    orderBy: { joinedAt: "asc" },
    select: { userId: true },
  });
}

/** The account-level preview used by settings and by the consent refusal screen. */
export async function getAccountLifecycle(
  prisma: PrismaClient,
  userId: string,
): Promise<AccountLifecycleView> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { username: true, accountNumber: true, displayName: true, closedAt: true },
    });
    if (user === null) throw notFound("account_not_found", "找不到这个账号。");
    if (user.closedAt !== null) throw conflict("account_closed", "这个账号已经注销。");

    const memberships = await tx.bookMember.findMany({
      where: { userId, leftAt: null },
      include: { book: true },
      orderBy: { joinedAt: "asc" },
    });

    const books: AccountBookOption[] = [];
    const blockers: string[] = [];
    for (const membership of memberships) {
      const book = membership.book;
      const memberCount = await activeMemberCount(tx, book.id);
      const archived = book.archivedAt !== null;
      const isManager = book.managedByUserId === userId;
      let options: BookDecisionAction[];
      let blockedReason: string | null = null;

      if (archived) {
        options = ["keep_archived", "delete"];
        if (book.purgeStartedAt !== null) {
          options = [];
          blockedReason = "这本账正在清理。";
        }
      } else if (memberCount > 1) {
        options = ["leave"];
        if (isManager && (await successorCandidate(tx, book.id, userId)) === null) {
          options = [];
          blockedReason = "你是这本共享账本的管理者，但还没有其他编辑者可以接手。请先添加或设为编辑者，再注销。";
          blockers.push(book.id);
        }
      } else {
        options = ["archive", "delete"];
      }

      books.push({
        bookId: book.id,
        name: book.name,
        bookNumber: book.bookNumber,
        memberCount,
        archived,
        isManager,
        options,
        blockedReason,
        archivedAt: book.archivedAt?.toISOString() ?? null,
        selfRestoreUntil: book.selfRestoreUntil?.toISOString() ?? null,
        scheduledPurgeAt: book.scheduledPurgeAt?.toISOString() ?? null,
      });
    }

    return {
      account: { username: user.username, accountNumber: user.accountNumber, displayName: user.displayName },
      books,
      blockers,
      counts: {
        total: books.length,
        shared: books.filter((book) => !book.archived && book.memberCount > 1).length,
        single: books.filter((book) => !book.archived && book.memberCount <= 1).length,
        archived: books.filter((book) => book.archived).length,
      },
    };
  });
}

/**
 * Preview what "delete server data" would do to every ledger currently attached to this account.
 *
 * ⚠️ **This is not account closure.** A shared ledger is left; a private or archived one is
 * permanently deleted. The account itself, its password, sessions and recovery code are untouched.
 */
export async function getDataDeletionPreview(
  prisma: PrismaClient,
  userId: string,
): Promise<AccountDataDeletionPreview> {
  return prisma.$transaction(async (tx) => {
    const memberships = await tx.bookMember.findMany({
      where: { userId, leftAt: null },
      include: { book: true },
      orderBy: { joinedAt: "asc" },
    });
    const books: DataDeletionBookPreview[] = [];
    for (const membership of memberships) {
      const book = membership.book;
      const memberCount = await activeMemberCount(tx, book.id);
      const archived = book.archivedAt !== null;
      const pending = await tx.bookRecoveryRequest.findFirst({
        where: { bookId: book.id, status: "pending", deadlineAt: { gt: new Date() } },
        select: { id: true },
      });
      let action: "leave" | "delete";
      let blockedReason: string | null = null;

      if (archived) {
        action = "delete";
        if (book.purgeStartedAt !== null) blockedReason = "这本账正在清理。";
        else if (pending !== null) blockedReason = "这本归档账本还有待处理的恢复申请。";
      } else if (memberCount > 1) {
        action = "leave";
        if (book.managedByUserId === userId && (await successorCandidate(tx, book.id, userId)) === null) {
          blockedReason = "你是这本共享账本的管理者，但还没有其他编辑者可以接手。";
        }
      } else {
        action = "delete";
      }

      books.push({
        bookId: book.id,
        name: book.name,
        bookNumber: book.bookNumber,
        memberCount,
        archived,
        action,
        blockedReason,
      });
    }
    return {
      books,
      counts: {
        total: books.length,
        leave: books.filter((book) => book.action === "leave").length,
        delete: books.filter((book) => book.action === "delete").length,
      },
      blockers: books.filter((book) => book.blockedReason !== null).map((book) => book.bookId),
    };
  });
}

/**
 * Delete the current account's ledger data without closing the account.
 *
 * All selected books are handled in one transaction. A shared ledger is only left; a private /
 * last-member / archived ledger is purged. There is no session deletion, no password change, no
 * recovery-code change and no account tombstone.
 */
export async function deleteAccountData(
  prisma: PrismaClient,
  input: {
    readonly userId: string;
    readonly all: boolean;
    readonly bookIds?: readonly string[];
    readonly now?: Date;
    readonly requestId?: string | null;
  },
): Promise<AccountDataDeletionResult> {
  const now = input.now ?? new Date();
  const requestedIds = input.all ? [] : [...new Set(input.bookIds ?? [])];
  if (!input.all && requestedIds.length === 0) {
    throw badRequest("book_selection_required", "请选择要删除数据的账本。");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT "id" FROM "users" WHERE "id" = $1::uuid FOR UPDATE`, input.userId);
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, accountNumber: true, closedAt: true, lastBookId: true },
    });
    if (user === null) throw notFound("account_not_found", "找不到这个账号。");
    if (user.closedAt !== null) throw conflict("account_closed", "这个账号已经注销。");

    const memberships = await tx.bookMember.findMany({
      where: { userId: input.userId, leftAt: null },
      include: { book: true },
      orderBy: { joinedAt: "asc" },
    });
    const currentById = new Map(memberships.map((membership) => [membership.book.id, membership.book]));

    const selected: Book[] = [];
    const alreadyHandled: { bookId: string; action: "already_left" | "already_deleted" }[] = [];
    if (input.all) {
      selected.push(...memberships.map((membership) => membership.book));
    } else {
      for (const bookId of requestedIds) {
        const book = currentById.get(bookId);
        if (book !== undefined) {
          selected.push(book);
          continue;
        }
        const tombstone = await tx.bookTombstone.findUnique({ where: { bookId }, select: { bookId: true } });
        if (tombstone !== null) {
          alreadyHandled.push({ bookId, action: "already_deleted" });
          continue;
        }
        const previous = await tx.bookMember.findUnique({
          where: { bookId_userId: { bookId, userId: input.userId } },
          select: { leftAt: true },
        });
        if (previous !== null && previous.leftAt !== null) {
          alreadyHandled.push({ bookId, action: "already_left" });
          continue;
        }
        throw badRequest("book_not_in_account", "选中的账本不属于这个账号。");
      }
    }

    for (const book of [...selected].sort((left, right) => left.id.localeCompare(right.id))) {
      await tx.$queryRawUnsafe(`SELECT "id" FROM "books" WHERE "id" = $1::uuid FOR UPDATE`, book.id);
    }

    const blockers: string[] = [];
    const plans = new Map<string, "leave" | "delete">();
    for (const book of selected) {
      const memberCount = await activeMemberCount(tx, book.id);
      const archived = book.archivedAt !== null;
      if (archived) {
        const pending = await tx.bookRecoveryRequest.findFirst({
          where: { bookId: book.id, status: "pending", deadlineAt: { gt: now } },
          select: { id: true },
        });
        if (book.purgeStartedAt !== null || pending !== null) {
          blockers.push(book.id);
          continue;
        }
        plans.set(book.id, "delete");
      } else if (memberCount > 1) {
        if (
          book.managedByUserId === input.userId &&
          (await successorCandidate(tx, book.id, input.userId)) === null
        ) {
          blockers.push(book.id);
          continue;
        }
        plans.set(book.id, "leave");
      } else {
        plans.set(book.id, "delete");
      }
    }
    if (blockers.length > 0) {
      throw conflict(
        "data_deletion_blocked",
        "有账本暂时不能删除数据，整个操作没有执行。请先处理管理者交接或待处理的恢复申请。",
        { bookIds: blockers },
      );
    }

    const processed: {
      bookId: string;
      action: "left" | "deleted";
    }[] = [];
    for (const book of selected) {
      const action = plans.get(book.id);
      if (action === "leave") {
        if (book.managedByUserId === input.userId) {
          const successor = await successorCandidate(tx, book.id, input.userId);
          if (successor === null) {
            throw conflict("book_needs_successor", "共享账本缺少可接手的编辑者。");
          }
          await tx.book.update({
            where: { id: book.id },
            data: { managedByUserId: successor.userId },
          });
          await recordLifecycleEvent(tx, {
            bookId: book.id,
            kind: "manager_transferred",
            actor: { userId: input.userId, accountNumber: user.accountNumber },
            detail: { toUserId: successor.userId },
            at: now,
          });
          await recordCriticalEvent(tx, {
            type: "book.manager_changed",
            actor: { userId: input.userId, accountNumber: user.accountNumber },
            subjectType: "book",
            subjectId: book.id,
            bookId: book.id,
            beforeState: { managedByUserId: input.userId },
            afterState: { managedByUserId: successor.userId },
            occurredAt: now,
          });
        }
        await tx.bookMember.update({
          where: { bookId_userId: { bookId: book.id, userId: input.userId } },
          data: { leftAt: now },
        });
        await recordLifecycleEvent(tx, {
          bookId: book.id,
          kind: "left",
          actor: { userId: input.userId, accountNumber: user.accountNumber },
          detail: { via: "delete_server_data" },
          at: now,
        });
        await recordCriticalEvent(tx, {
          type: "member.left",
          actor: { userId: input.userId, accountNumber: user.accountNumber },
          subjectType: "membership",
          subjectId: `${book.id}:${input.userId}`,
          bookId: book.id,
          beforeState: { leftAt: null },
          afterState: { leftAt: now.toISOString(), via: "delete_server_data" },
          occurredAt: now,
        });
        processed.push({ bookId: book.id, action: "left" });
      } else if (action === "delete") {
        await purgeBookInTransaction(tx, {
          bookId: book.id,
          actorUserId: input.userId,
          actorAccountNumber: user.accountNumber,
          deletionMethod: "self_delete",
          deletionReason: "delete_server_data",
          now,
        });
        processed.push({ bookId: book.id, action: "deleted" });
      }
    }

    if (user.lastBookId !== null && selected.some((book) => book.id === user.lastBookId)) {
      await tx.user.update({ where: { id: input.userId }, data: { lastBookId: null } });
    }
    await recordCriticalEvent(tx, {
      type: "account.data_deleted",
      actor: { userId: input.userId, accountNumber: user.accountNumber },
      subjectType: "account",
      subjectId: input.userId,
      batchId: input.requestId ?? null,
      beforeState: { selectedBookIds: selected.map((book) => book.id) },
      afterState: {
        processed,
        remainingBookCount: await tx.bookMember.count({ where: { userId: input.userId, leftAt: null } }),
      },
      occurredAt: now,
    });
    const remaining = await tx.bookMember.count({ where: { userId: input.userId, leftAt: null } });
    return {
      accountKept: true as const,
      processed: [...alreadyHandled, ...processed],
      remainingBookCount: remaining,
    };
  });
}

/**
 * Close an account and process every ledger in one transaction.
 *
 * The user row is retained and anonymized. A physical `DELETE FROM users` is impossible to do
 * safely in this schema: `books.created_by` and `transactions.user_id` are CASCADE, so it would
 * destroy other people's shared ledgers and their entries. The `AccountTombstone` is the stable
 * record; the retired account can no longer log in or sync.
 */
export async function closeAccount(
  prisma: PrismaClient,
  input: {
    readonly userId: string;
    readonly method: CloseMethod;
    readonly decisions: readonly BookDecisionInput[];
    readonly now?: Date;
    readonly requestId?: string | null;
  },
): Promise<CloseAccountResult> {
  const now = input.now ?? new Date();
  const unusablePasswordHash = await hashPassword(randomBytes(32).toString("hex"));
  const recoveryCredential = generateRecoveryCredential();
  const recoveryCredentialHash = hashRecoveryCredential(recoveryCredential);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT "id" FROM "users" WHERE "id" = $1::uuid FOR UPDATE`, input.userId);
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (user === null) throw notFound("account_not_found", "找不到这个账号。");
    if (user.closedAt !== null) throw conflict("account_closed", "这个账号已经注销。");
    if (user.disabledAt !== null) throw conflict("account_disabled", "这个账号目前不能注销。");

    const memberships = await tx.bookMember.findMany({
      where: { userId: input.userId, leftAt: null },
      include: { book: true },
      orderBy: { joinedAt: "asc" },
    });
    const books = memberships.map((membership) => membership.book);

    // Lock every book in a deterministic order before validating, so two concurrent closes or a
    // leave/close race cannot both see the same final member.
    for (const book of [...books].sort((left, right) => left.id.localeCompare(right.id))) {
      await lockBook(tx, book.id);
    }

    const bookById = new Map(books.map((book) => [book.id, book]));
    const decisionMap = new Map(input.decisions.map((decision) => [decision.bookId, decision.action]));
    if (new Set(input.decisions.map((decision) => decision.bookId)).size !== input.decisions.length) {
      throw badRequest("book_decisions_duplicate", "账本处理方案里有重复的账本。");
    }
    if (input.method === "close_account") {
      const missing = books.filter((book) => !decisionMap.has(book.id));
      const extra = input.decisions.filter((decision) => !bookById.has(decision.bookId));
      if (missing.length > 0 || extra.length > 0) {
        throw badRequest(
          "book_decisions_incomplete",
          "请为每一本账本选择处理方式后再注销。",
          { missingBookIds: missing.map((book) => book.id) },
        );
      }
    }

    const plans = new Map<string, BookDecisionAction>();
    const blockers: string[] = [];
    for (const book of books) {
      const activeCount = await activeMemberCount(tx, book.id);
      const archived = book.archivedAt !== null;
      const isManager = book.managedByUserId === input.userId;
      const requested = decisionMap.get(book.id);
      let action: BookDecisionAction;

      if (input.method === "delete_data") {
        action = archived ? "delete" : activeCount > 1 ? "leave" : "delete";
      } else if (requested === undefined) {
        throw badRequest("book_decisions_incomplete", "请为每一本账本选择处理方式后再注销。");
      } else {
        action = requested;
      }

      if (archived) {
        if (action !== "keep_archived" && action !== "delete") {
          throw badRequest("book_action_invalid", "已归档账本只能保持归档或永久删除。");
        }
        if (book.purgeStartedAt !== null) {
          blockers.push(book.id);
          continue;
        }
      } else if (activeCount > 1) {
        if (action !== "leave") {
          throw badRequest("book_action_invalid", "共享账本只能退出协作，不能由一个人归档或删除。");
        }
        if (isManager && (await successorCandidate(tx, book.id, input.userId)) === null) {
          blockers.push(book.id);
          continue;
        }
      } else if (action !== "archive" && action !== "delete") {
        throw badRequest("book_action_invalid", "单人账本只能归档或永久删除。");
      }

      plans.set(book.id, action);
    }

    if (blockers.length > 0) {
      throw conflict(
        "account_close_blocked",
        "还有账本没有安全的管理者或正在清理，账号没有注销。请先处理这些账本。",
        { bookIds: blockers },
      );
    }

    const archivedBookIds: string[] = [];
    const deletedBookIds: string[] = [];
    const leftBookIds: string[] = [];
    const keptArchivedBookIds: string[] = [];

    for (const book of books) {
      const action = plans.get(book.id);
      if (action === undefined) throw badRequest("book_decisions_incomplete", "账本处理方案不完整。");
      if (action === "leave") {
        if (book.managedByUserId === input.userId) {
          const successor = await successorCandidate(tx, book.id, input.userId);
          if (successor === null) {
            throw conflict("book_needs_successor", "共享账本缺少可接手的编辑者，账号没有注销。");
          }
          await tx.book.update({
            where: { id: book.id },
            data: { managedByUserId: successor.userId },
          });
          await recordLifecycleEvent(tx, {
            bookId: book.id,
            kind: "manager_transferred",
            actor: { userId: input.userId, accountNumber: user.accountNumber },
            detail: { toUserId: successor.userId },
            at: now,
          });
          await recordCriticalEvent(tx, {
            type: "book.manager_changed",
            actor: { userId: input.userId, accountNumber: user.accountNumber },
            subjectType: "book",
            subjectId: book.id,
            bookId: book.id,
            beforeState: { managedByUserId: input.userId },
            afterState: { managedByUserId: successor.userId },
            occurredAt: now,
          });
        }
        await tx.bookMember.update({
          where: { bookId_userId: { bookId: book.id, userId: input.userId } },
          data: { leftAt: now },
        });
        await recordLifecycleEvent(tx, {
          bookId: book.id,
          kind: "left",
          actor: { userId: input.userId, accountNumber: user.accountNumber },
          detail: { via: "account_closure" },
          at: now,
        });
        await recordCriticalEvent(tx, {
          type: "member.left",
          actor: { userId: input.userId, accountNumber: user.accountNumber },
          subjectType: "membership",
          subjectId: `${book.id}:${input.userId}`,
          bookId: book.id,
          beforeState: { leftAt: null },
          afterState: { leftAt: now.toISOString(), via: "account_closure" },
          occurredAt: now,
        });
        leftBookIds.push(book.id);
        continue;
      }

      if (action === "archive") {
        const deadlines = archiveDeadlines(now);
        await tx.book.update({
          where: { id: book.id },
          data: {
            archivedAt: deadlines.archivedAt,
            archivedByUserId: input.userId,
            archiveReason: "account_closure",
            selfRestoreUntil: deadlines.selfRestoreUntil,
            scheduledPurgeAt: deadlines.scheduledPurgeAt,
            purgeStartedAt: null,
            purgeAttempts: 0,
            purgeLastError: null,
            managedByUserId: input.userId,
          },
        });
        await recordLifecycleEvent(tx, {
          bookId: book.id,
          kind: "archived",
          actor: { userId: input.userId, accountNumber: user.accountNumber },
          detail: { reason: "account_closure", scheduledPurgeAt: deadlines.scheduledPurgeAt.toISOString() },
          at: now,
        });
        await recordCriticalEvent(tx, {
          type: "book.archived",
          actor: { userId: input.userId, accountNumber: user.accountNumber },
          subjectType: "book",
          subjectId: book.id,
          bookId: book.id,
          beforeState: { archivedAt: null },
          afterState: {
            archivedAt: deadlines.archivedAt.toISOString(),
            selfRestoreUntil: deadlines.selfRestoreUntil.toISOString(),
            scheduledPurgeAt: deadlines.scheduledPurgeAt.toISOString(),
            archiveReason: "account_closure",
          },
          occurredAt: now,
        });
        archivedBookIds.push(book.id);
        continue;
      }

      if (action === "keep_archived") {
        keptArchivedBookIds.push(book.id);
        continue;
      }

      // delete
      await purgeBookInTransaction(tx, {
        bookId: book.id,
        actorUserId: input.userId,
        actorAccountNumber: user.accountNumber,
        deletionMethod: "account_closure",
        deletionReason: input.method === "delete_data" ? "account_data_deleted" : "account_closure",
        now,
      });
      deletedBookIds.push(book.id);
    }

    /**
     * Account-level resources. Sessions go in the same transaction as everything else, so a
     * failure cannot leave a closed account with a working cookie.
     */
    await tx.session.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.notificationQuota.deleteMany({ where: { userId: input.userId } });
    await tx.notification.deleteMany({ where: { recipientId: input.userId } });
    await tx.notification.deleteMany({
      where: { senderId: input.userId, status: "pending" },
    });
    await tx.bookShareLink.updateMany({
      where: { createdBy: input.userId, revokedAt: null },
      data: { revokedAt: now, revokedBy: input.userId },
    });
    await tx.registrationInvite.updateMany({
      where: { createdByUserId: input.userId, usedByUserId: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.adminGrant.deleteMany({ where: { userId: input.userId } });
    await tx.adminAllowEntry.deleteMany({ where: { userId: input.userId } });
    await tx.user.updateMany({
      where: { referredByUserId: input.userId },
      data: { referredByUserId: null },
    });

    await tx.user.update({
      where: { id: input.userId },
      data: {
        username: `closed_${input.userId}`,
        displayName: "已注销账号",
        passwordHash: unusablePasswordHash,
        recoveryCodeHash: null,
        recoveryCodeUsedAt: null,
        disabledAt: now,
        disabledBy: "self_close",
        closedAt: now,
        lastBookId: null,
        isAdmin: false,
        referredByUserId: null,
      },
    });

    const summary = {
      method: input.method,
      leftBookIds,
      archivedBookIds,
      keptArchivedBookIds,
      deletedBookIds,
      closedAt: now.toISOString(),
    };
    const recoverableArchiveCount = archivedBookIds.length + keptArchivedBookIds.length;
    await tx.accountTombstone.create({
      data: {
        userId: input.userId,
        accountNumber: user.accountNumber,
        originalCreatedAt: user.createdAt,
        closedAt: now,
        closureMethod: input.method,
        summary,
        recoveryCredentialHash:
          recoverableArchiveCount > 0 ? recoveryCredentialHash : null,
        recoveryCredentialCreatedAt: recoverableArchiveCount > 0 ? now : null,
        requestId: input.requestId ?? null,
      },
    });

    await recordCriticalEvent(tx, {
      type: "account.closed",
      actor: { userId: input.userId, accountNumber: user.accountNumber },
      subjectType: "account",
      subjectId: input.userId,
      batchId: input.requestId ?? null,
      beforeState: {
        accountNumber: user.accountNumber,
        isAdmin: user.isAdmin,
        bookCount: leftBookIds.length + archivedBookIds.length + keptArchivedBookIds.length + deletedBookIds.length,
      },
      afterState: {
        ...summary,
        tombstoneRef: "account_tombstones",
        recoverableArchiveCount,
      },
      occurredAt: now,
    });
    await recordCriticalEvent(tx, {
      type: "auth.sessions_revoked",
      actor: { userId: input.userId, accountNumber: user.accountNumber },
      subjectType: "account",
      subjectId: input.userId,
      batchId: input.requestId ?? null,
      beforeState: { reason: "account_closure" },
      afterState: { revokedAt: now.toISOString() },
      occurredAt: now,
    });

    return {
      method: input.method,
      closedAt: now.toISOString(),
      recoveryCredential: recoverableArchiveCount > 0 ? recoveryCredential : null,
      archivedBookIds,
      deletedBookIds,
      leftBookIds,
      keptArchivedBookIds,
    };
  });
}

/** Public request path for an archived ledger whose owner has closed the account. */
export async function createClosedAccountRecoveryRequest(
  prisma: PrismaClient,
  input: {
    readonly accountNumber: string;
    readonly recoveryCredential: string;
    readonly bookNumber: string;
    readonly targetAccountNumber?: string;
    readonly now?: Date;
  },
): Promise<{ readonly requestId: string; readonly deadlineAt: string }> {
  const now = input.now ?? new Date();
  const credentialHash = hashRecoveryCredential(input.recoveryCredential);

  return prisma.$transaction(async (tx) => {
    const tombstone = await tx.accountTombstone.findFirst({
      where: { accountNumber: input.accountNumber },
    });
    /**
     * A missing account and a wrong credential get the same refusal. This endpoint must not
     * become an oracle for "does this account number exist".
     */
    if (
      tombstone === null ||
      tombstone.recoveryCredentialHash === null ||
      tombstone.recoveryCredentialHash !== credentialHash
    ) {
      throw badRequest("recovery_credentials_invalid", "账号编号或恢复凭证不正确。");
    }

    const book = await tx.book.findUnique({
      where: { bookNumber: input.bookNumber },
    });
    if (book === null) throw notFound("book_missing", "找不到这本账。");
    const membership = await tx.bookMember.findUnique({
      where: { bookId_userId: { bookId: book.id, userId: tombstone.userId } },
      select: { leftAt: true },
    });
    if (membership === null) {
      throw badRequest("recovery_not_eligible", "这个账号没有可恢复的这本账。");
    }
    if (book.archivedAt === null || book.purgeStartedAt !== null) {
      throw badRequest("recovery_not_eligible", "这本账当前不能申请恢复。");
    }
    if (book.scheduledPurgeAt === null || book.scheduledPurgeAt.getTime() <= now.getTime()) {
      throw badRequest("recovery_not_eligible", "这本账已经超过归档保留期。");
    }
    const existing = await tx.bookRecoveryRequest.findFirst({
      where: { bookId: book.id, status: "pending" },
      select: { id: true },
    });
    if (existing !== null) {
      throw conflict("recovery_request_pending", "这本账已经有一条待处理的恢复申请。");
    }

    let targetAccountNumber: string | undefined;
    if (input.targetAccountNumber !== undefined) {
      const target = await tx.user.findUnique({
        where: { accountNumber: input.targetAccountNumber },
        select: { accountNumber: true, closedAt: true },
      });
      if (target === null || target.closedAt !== null) {
        throw badRequest("recovery_target_invalid", "接收账本的账号不存在或已经注销。");
      }
      targetAccountNumber = target.accountNumber;
    }

    const deadlineAt = new Date(
      Math.min(addDays(now, RECOVERY_REQUEST_DAYS).getTime(), book.scheduledPurgeAt.getTime()),
    );
    const request = await tx.bookRecoveryRequest.create({
      data: {
        bookId: book.id,
        bookNumber: book.bookNumber,
        requesterUserId: tombstone.userId,
        requesterAccountNumber: tombstone.accountNumber,
        kind: "closed_account",
        status: "pending",
        deadlineAt,
        targetAccountNumber: targetAccountNumber ?? null,
        credentialVerifiedAt: now,
      },
    });
    await recordLifecycleEvent(tx, {
      bookId: book.id,
      kind: "recovery_requested",
      actor: { userId: tombstone.userId, accountNumber: tombstone.accountNumber },
      detail: {
        requestId: request.id,
        kind: "closed_account",
        targetAccountNumber: targetAccountNumber ?? null,
        deadlineAt: deadlineAt.toISOString(),
      },
      at: now,
    });
    await recordCriticalEvent(tx, {
      type: "account.recovery_requested",
      actor: { userId: tombstone.userId, accountNumber: tombstone.accountNumber },
      subjectType: "account",
      subjectId: tombstone.userId,
      bookId: book.id,
      beforeState: { archivedAt: book.archivedAt?.toISOString() ?? null },
      afterState: {
        requestId: request.id,
        deadlineAt: deadlineAt.toISOString(),
        targetAccountNumber: targetAccountNumber ?? null,
      },
      occurredAt: now,
    });
    return { requestId: request.id, deadlineAt: deadlineAt.toISOString() };
  });
}
