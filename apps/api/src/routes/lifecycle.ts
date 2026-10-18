import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { verifyPassword } from "../auth/password.js";
import { LoginThrottle } from "../auth/login-throttle.js";
import { confirmP0 } from "../critical/confirm.js";
import {
  getPublicOperation,
  markOperation,
  OperationAlreadyStartedError,
  operationResponseFields,
  startCriticalOperation,
  unconfirmedOperationError,
  type StartedOperation,
} from "../critical/operations.js";
import type { PrismaClient } from "../db.js";
import { AppError, badRequest, conflict, forbidden, notFound, tooManyRequests } from "../lib/errors.js";
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

function idempotencyKeyOf(request: FastifyRequest): string | undefined {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const key = value.trim();
  if (key.length < 16 || key.length > 128) {
    throw badRequest("idempotency_key_invalid", "幂等键长度必须为 16–128 个字符。");
  }
  return key;
}

async function startOperation(
  prisma: PrismaClient,
  request: FastifyRequest,
  input: {
    readonly kind: string;
    readonly actorUserId: string;
    readonly subjectUserId?: string;
    readonly detail?: Record<string, unknown>;
  },
): Promise<StartedOperation> {
  try {
    return await startCriticalOperation(prisma, {
      ...input,
      idempotencyKey: idempotencyKeyOf(request),
    });
  } catch (error) {
    if (error instanceof OperationAlreadyStartedError) {
      throw conflict("operation_already_started", "这个操作已经受理，请查询原操作结果，不要重复执行。", {
        operationId: error.operationId,
        operationStatusPath: `/api/v1/operations/${error.operationId}`,
        idempotencyKeyUsed: true,
      });
    }
    throw error;
  }
}

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
  // Public, token-protected operation receipt. Deliberately does not require a session:
  // account closure revokes the only session that could otherwise ask whether it committed.
  // -------------------------------------------------------------------------
  app.get("/api/v1/operations/:id", async (request) => {
    const { id } = request.params as { id: string };
    const query = z.object({ token: z.string().min(16).max(128) }).parse(request.query);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw badRequest("operation_invalid", "操作编号不合法。");
    const operation = await getPublicOperation(prisma, id, query.token);
    if (operation === null) throw notFound("operation_not_found", "找不到这条操作。");
    return operation;
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

    const operation = await startOperation(prisma, request, {
      kind: "book.delete",
      actorUserId: userId,
      subjectUserId: userId,
      detail: { bookId },
    });
    let result;
    try {
      result = await purgeBook(prisma, {
        bookId,
        actorUserId: userId,
        actorAccountNumber: request.currentUser!.accountNumber,
        deletionMethod: "self_delete",
        deletionReason: "user_delete",
        requestId: operation.id,
      });
    } catch (error) {
      await markOperation(prisma, operation.id, "failed");
      throw error;
    }
    await markOperation(prisma, operation.id, "committed_unconfirmed");
    try {
      await confirmP0(prisma);
    } catch (error) {
      if (error instanceof AppError) throw unconfirmedOperationError(operation, error);
      throw error;
    }
    await markOperation(prisma, operation.id, "confirmed");
    return { ok: true, ...result, ...operationResponseFields(operation) };
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
    const operation = await startOperation(prisma, request, {
      kind: "account.close",
      actorUserId: userId,
      subjectUserId: userId,
      detail: { decisions: body.decisions },
    });
    let result;
    try {
      result = await closeAccount(prisma, {
        userId,
        method: "close_account",
        decisions: body.decisions.map((decision) => ({
          bookId: decision.bookId,
          action: decision.action as BookDecisionAction,
        })),
        requestId: operation.id,
      });
    } catch (error) {
      await markOperation(prisma, operation.id, "failed");
      throw error;
    }
    await markOperation(prisma, operation.id, "committed_unconfirmed");
    try {
      await confirmP0(prisma);
    } catch (error) {
      if (error instanceof AppError) throw unconfirmedOperationError(operation, error);
      throw error;
    }
    await markOperation(prisma, operation.id, "confirmed");
    return { ...result, ...operationResponseFields(operation) };
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
    const operation = await startOperation(prisma, request, {
      kind: "account.delete_data",
      actorUserId: userId,
      subjectUserId: userId,
      detail: { all: body.all, bookIds: body.bookIds },
    });
    let result;
    try {
      result = await deleteAccountData(prisma, {
        userId,
        all: body.all,
        bookIds: body.bookIds,
        requestId: operation.id,
      });
    } catch (error) {
      await markOperation(prisma, operation.id, "failed");
      throw error;
    }
    await markOperation(prisma, operation.id, "committed_unconfirmed");
    try {
      await confirmP0(prisma);
    } catch (error) {
      if (error instanceof AppError) throw unconfirmedOperationError(operation, error);
      throw error;
    }
    await markOperation(prisma, operation.id, "confirmed");
    return { ...result, ...operationResponseFields(operation) };
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
