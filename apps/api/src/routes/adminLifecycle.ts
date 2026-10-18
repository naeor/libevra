import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AdminActor } from "../admin/guard.js";
import { recordAudit, recordRefusal } from "../admin/audit.js";
import { createReauthVerifier } from "../admin/reauth.js";
import type { PrismaClient } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { approveRecoveryRequest, rejectRecoveryRequest } from "../lifecycle/book.js";
import { runDuePurges } from "../lifecycle/book.js";

export interface AdminLifecycleRouteOptions {
  readonly prisma: PrismaClient;
  readonly requireAdmin: (request: FastifyRequest) => Promise<void>;
}

/**
 * Admin recovery and cleanup routes.
 *
 * ⚠️ **An administrator never gets ledger content here.** A request exposes the book number,
 * account numbers and lifecycle state only; approving moves a membership / clears an archive flag
 * and does not return a transaction, a note or a ledger name.
 */
export function registerAdminLifecycleRoutes(
  app: FastifyInstance,
  options: AdminLifecycleRouteOptions,
): void {
  const { prisma, requireAdmin } = options;
  const reauth = createReauthVerifier(prisma);

  async function requirePassword(
    request: FastifyRequest,
    actor: AdminActor,
    password: string,
    action: "book.recovery.approve" | "book.recovery.reject",
    target: string,
  ): Promise<void> {
    try {
      await reauth.verify(actor.userId, password);
    } catch (error) {
      await recordRefusal(prisma, request.log, {
        adminUserId: actor.userId,
        adminUsername: actor.username,
        action,
        target,
        outcome: "failed",
        detail: { reason: "reauth_failed" },
        requestId: request.id,
      });
      throw error;
    }
  }

  app.get(
    "/api/v1/admin/lifecycle/requests",
    { preHandler: requireAdmin },
    async (request) => {
      const query = z
        .object({ status: z.string().optional() })
        .parse(request.query ?? {});
      const requests = await prisma.bookRecoveryRequest.findMany({
        where: query.status === undefined ? {} : { status: query.status },
        orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
        take: 200,
        select: {
          id: true,
          bookId: true,
          bookNumber: true,
          requesterAccountNumber: true,
          kind: true,
          status: true,
          requestedAt: true,
          deadlineAt: true,
          decidedAt: true,
          decidedByName: true,
          decisionNote: true,
          targetAccountNumber: true,
        },
      });
      return {
        requests: requests.map((entry) => ({
          ...entry,
          requestedAt: entry.requestedAt.toISOString(),
          deadlineAt: entry.deadlineAt.toISOString(),
          decidedAt: entry.decidedAt?.toISOString() ?? null,
        })),
      };
    },
  );

  app.post(
    "/api/v1/admin/lifecycle/requests/:id/decide",
    { preHandler: requireAdmin },
    async (request) => {
      const actor = request.adminActor!;
      const { id } = request.params as { id: string };
      const body = z
        .object({
          password: z.string().min(1),
          action: z.enum(["approve", "reject"]),
          targetAccountNumber: z.string().trim().regex(/^[0-9]{8}$/).optional(),
          note: z.string().trim().max(500).optional(),
        })
        .parse(request.body);

      const existing = await prisma.bookRecoveryRequest.findUnique({ where: { id } });
      if (existing === null) throw notFound("recovery_request_missing", "找不到这条恢复申请。");
      await requirePassword(
        request,
        actor,
        body.password,
        body.action === "approve" ? "book.recovery.approve" : "book.recovery.reject",
        `request:${id}`,
      );

      if (body.action === "approve") {
        const result = await approveRecoveryRequest(prisma, {
          requestId: id,
          adminUserId: actor.userId,
          adminName: actor.username,
          ...(body.targetAccountNumber === undefined
            ? {}
            : { targetAccountNumber: body.targetAccountNumber }),
          ...(body.note === undefined ? {} : { note: body.note }),
        });
        await recordAuditSafe(prisma, request, {
          adminUserId: actor.userId,
          adminUsername: actor.username,
          action: "book.recovery.approve",
          target: `book:${result.bookId}`,
          outcome: "success",
          detail: { requestId: id, targetUserId: result.targetUserId },
        });
        return { ok: true, ...result };
      }

      await rejectRecoveryRequest(prisma, {
        requestId: id,
        adminUserId: actor.userId,
        adminName: actor.username,
        ...(body.note === undefined ? {} : { note: body.note }),
      });
      await recordAuditSafe(prisma, request, {
        adminUserId: actor.userId,
        adminUsername: actor.username,
        action: "book.recovery.reject",
        target: `request:${id}`,
        outcome: "success",
        detail: { note: body.note ?? null },
      });
      return { ok: true };
    },
  );

  app.post("/api/v1/admin/lifecycle/purge", { preHandler: requireAdmin }, async (request) => {
    const actor = request.adminActor!;
    const body = z.object({ password: z.string().min(1) }).parse(request.body);
    await reauth.verify(actor.userId, body.password);
    const result = await runDuePurges(prisma, new Date(), { logger: request.log });
    await recordAuditSafe(prisma, request, {
      adminUserId: actor.userId,
      adminUsername: actor.username,
      action: "book.purge",
      target: "lifecycle:purge",
      outcome: result.failed === 0 ? "success" : "failed",
      detail: result,
    });
    return result;
  });
}

async function recordAuditSafe(
  prisma: PrismaClient,
  request: FastifyRequest,
  input: {
    adminUserId: string;
    adminUsername: string;
    action: "book.recovery.approve" | "book.recovery.reject" | "book.purge";
    target: string;
    outcome: "success" | "failed";
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await recordAudit(prisma, {
      ...input,
      requestId: request.id,
    });
  } catch (error) {
    request.log.error({ err: error, audit: input.action }, "管理员审计写入失败");
  }
}
