import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyPassword } from "../auth/password.js";
import { LoginThrottle } from "../auth/login-throttle.js";
import { confirmP0 } from "../critical/confirm.js";
import type { PrismaClient } from "../db.js";
import { badRequest, forbidden, tooManyRequests } from "../lib/errors.js";
import {
  archiveBook,
  getBookLifecycle,
  leaveBookSafely,
  purgeBook,
  requestManualRecoveryForActiveAccount,
  restoreArchivedBook,
} from "../lifecycle/book.js";
import {
  closeAccount,
  createClosedAccountRecoveryRequest,
  deleteAccountData,
  getAccountLifecycle,
  getDataDeletionPreview,
  type BookDecisionAction,
} from "../lifecycle/account.js";

export interface LifecycleRouteOptions {
  readonly prisma: PrismaClient;
  readonly requireSession: (request: FastifyRequest) => Promise<void>;
}

const bookActionSchema = z.enum(["leave", "archive", "delete"]);
const decisionSchema = z.object({
  bookId: z.string().uuid(),
  action: z.enum(["leave", "archive", "delete", "keep_archived"]),
});

/**
 * Account data rights routes intentionally use the raw session guard, not the agreement guard.
 *
 * A person who refuses a new agreement must still be able to export data, remove a ledger and
 * close the account. None of these routes returns ledger content; the only book information is
 * lifecycle metadata.
 */
export function registerLifecycleRoutes(app: FastifyInstance, options: LifecycleRouteOptions): void {
  const { prisma, requireSession } = options;
  const closureThrottle = new LoginThrottle({
    maxFailures: 5,
    lockoutMs: 5 * 60_000,
    windowMs: 15 * 60_000,
  });

  async function verifyOwnPassword(userId: string, password: string, scope: string): Promise<void> {
    const key = `${scope}:${userId}`;
    const retryAfter = closureThrottle.retryAfterSeconds([key]);
    if (retryAfter > 0) {
      throw tooManyRequests(
        "password_throttled",
        `密码尝试次数过多，请 ${String(retryAfter)} 秒后再试。`,
      );
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (user === null || !(await verifyPassword(user.passwordHash, password))) {
      closureThrottle.recordFailure([key]);
      throw forbidden("password_invalid", "密码不正确，操作没有执行。");
    }
    closureThrottle.recordSuccess([key]);
  }

  // -------------------------------------------------------------------------
  // Account data overview
  // -------------------------------------------------------------------------
  app.get("/api/v1/account/lifecycle", { preHandler: requireSession }, async (request) => {
    return getAccountLifecycle(prisma, request.currentUser!.id);
  });

  // -------------------------------------------------------------------------
  // One ledger's lifecycle summary
  // -------------------------------------------------------------------------
  app.get("/api/v1/books/:bookId/lifecycle", { preHandler: requireSession }, async (request) => {
    const { bookId } = request.params as { bookId: string };
    return getBookLifecycle(prisma, bookId, request.currentUser!.id);
  });

  // -------------------------------------------------------------------------
  // Leave / archive / permanently delete one ledger
  // -------------------------------------------------------------------------
  app.post("/api/v1/books/:bookId/lifecycle", { preHandler: requireSession }, async (request) => {
    const userId = request.currentUser!.id;
    const { bookId } = request.params as { bookId: string };
    const body = z.object({ action: bookActionSchema }).parse(request.body);
    const summary = await getBookLifecycle(prisma, bookId, userId);

    if (body.action === "leave") {
      if (!summary.canLeave) {
        throw badRequest(
          summary.needsSuccessor ? "book_needs_successor" : "book_last_member",
          summary.needsSuccessor
            ? "这本账还没有其他可接手的编辑者。请先添加成员或设置编辑者，再退出。"
            : "这是账本的最后一位成员。请选择归档或永久删除。",
        );
      }
      const result = await leaveBookSafely(prisma, bookId, userId);
      await confirmP0(prisma);
      return result;
    }

    if (body.action === "archive") {
      if (!summary.canArchive) {
        throw badRequest("book_shared_archive_refused", "共享账本不能由一个人归档。");
      }
      return archiveBook(prisma, { bookId, userId, reason: "user_archive" });
    }

    if (!summary.canDelete) {
      throw badRequest(
        summary.memberCount > 1 ? "book_shared_delete_refused" : "book_delete_refused",
        summary.memberCount > 1
          ? "这本账还有其他成员，不能由一个人永久删除。请先退出协作。"
          : "当前状态不能永久删除这本账。",
      );
    }

    const result = await purgeBook(prisma, {
      bookId,
      actorUserId: userId,
      actorAccountNumber: request.currentUser!.accountNumber,
      deletionMethod: "self_delete",
      deletionReason: "user_delete",
    });
    await confirmP0(prisma);
    return { ok: true, ...result };
  });

  // -------------------------------------------------------------------------
  // Restore an archived ledger (60-day self-service)
  // -------------------------------------------------------------------------
  app.post(
    "/api/v1/account/archives/:bookId/restore",
    { preHandler: requireSession },
    async (request) => {
      const { bookId } = request.params as { bookId: string };
      return restoreArchivedBook(prisma, bookId, request.currentUser!.id);
    },
  );

  // -------------------------------------------------------------------------
  // Request manual recovery after the 60-day window
  // -------------------------------------------------------------------------
  app.post(
    "/api/v1/account/archives/:bookId/recovery-request",
    { preHandler: requireSession },
    async (request) => {
      const { bookId } = request.params as { bookId: string };
      return requestManualRecoveryForActiveAccount(prisma, bookId, request.currentUser!.id);
    },
  );

  // -------------------------------------------------------------------------
  // Close account, with per-ledger decisions
  // -------------------------------------------------------------------------
  app.post("/api/v1/account/close", { preHandler: requireSession }, async (request) => {
    const userId = request.currentUser!.id;
    const body = z
      .object({
        password: z.string().min(1),
        confirmation: z.string(),
        method: z.literal("close_account").default("close_account"),
        decisions: z.array(decisionSchema).default([]),
      })
      .parse(request.body);

    const expected = "注销账号";
    if (body.confirmation !== expected) {
      throw badRequest("confirmation_mismatch", `请输入「${expected}」确认这次操作。`);
    }
    await verifyOwnPassword(userId, body.password, "account-close");

    const result = await closeAccount(prisma, {
      userId,
      method: "close_account",
      decisions: body.decisions.map((decision) => ({
        bookId: decision.bookId,
        action: decision.action as BookDecisionAction,
      })),
      requestId: request.id,
    });
    await confirmP0(prisma);
    return result;
  });

  // -------------------------------------------------------------------------
  // Delete server-side ledger data without closing the account
  // -------------------------------------------------------------------------
  app.get(
    "/api/v1/account/data-deletion/preview",
    { preHandler: requireSession },
    async (request) => {
      return getDataDeletionPreview(prisma, request.currentUser!.id);
    },
  );

  app.post("/api/v1/account/delete-data", { preHandler: requireSession }, async (request) => {
    const userId = request.currentUser!.id;
    const body = z
      .object({
        password: z.string().min(1),
        confirmation: z.string(),
        all: z.boolean().default(false),
        bookIds: z.array(z.string().uuid()).default([]),
      })
      .parse(request.body);
    if (body.confirmation !== "删除服务器数据") {
      throw badRequest("confirmation_mismatch", "请输入「删除服务器数据」确认这次操作。");
    }
    await verifyOwnPassword(userId, body.password, "account-delete-data");
    const result = await deleteAccountData(prisma, {
      userId,
      all: body.all,
      bookIds: body.bookIds,
      requestId: request.id,
    });
    await confirmP0(prisma);
    return result;
  });

  // -------------------------------------------------------------------------
  // Public request path for a closed account's kept archive
  // -------------------------------------------------------------------------
  app.post("/api/v1/account-recovery/request", async (request, reply) => {
    const body = z
      .object({
        accountNumber: z.string().regex(/^[0-9]{8}$/, "账号编号应为 8 位数字"),
        recoveryCredential: z.string().trim().min(16).max(64),
        bookNumber: z.string().trim().regex(/^[0-9]{8}$/, "账本编号应为 8 位数字"),
        targetAccountNumber: z.string().trim().regex(/^[0-9]{8}$/).optional(),
      })
      .parse(request.body);
    const result = await createClosedAccountRecoveryRequest(prisma, {
      accountNumber: body.accountNumber,
      recoveryCredential: body.recoveryCredential,
      bookNumber: body.bookNumber,
      ...(body.targetAccountNumber === undefined
        ? {}
        : { targetAccountNumber: body.targetAccountNumber }),
    });
    void reply.code(201);
    return result;
  });
}
