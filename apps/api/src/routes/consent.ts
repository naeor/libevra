import {
  acceptedAgreementSchema,
  type LegalDocument,
  type MajorAnnouncement,
} from "@libellum/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { PrismaClient } from "../db.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  documentWithHash,
  legalContentHash,
  requiredDocuments,
  type ConsentPolicy,
} from "../consent/policy.js";

interface AccountConsentOptions {
  readonly prisma: PrismaClient;
  readonly requireSession: (request: FastifyRequest) => Promise<void>;
  readonly policy: ConsentPolicy;
}

function documentMeta(document: LegalDocument): LegalDocument & { readonly contentHash: string } {
  return documentWithHash(document);
}

function toMajorView(announcement: MajorAnnouncement): MajorAnnouncement {
  return announcement;
}

/**
 * Public, unauthenticated legal-document routes.
 *
 * ⚠️ **A document that is required for registration must be readable before login.** The current
 * production policy has no required documents; the only document here is a local test file. A real
 * terms/privacy document can be added to `packages/shared/src/consent.ts` after owner review.
 */
export function registerLegalRoutes(app: FastifyInstance, policy: ConsentPolicy): void {
  app.get("/api/v1/legal/documents", async () => {
    return {
      documents: requiredDocuments(policy),
    };
  });

  app.get("/api/v1/legal/documents/:id", async (request) => {
    const { id } = request.params as { id: string };
    const document = policy.documents.find((entry) => entry.id === id);
    if (!document) throw notFound("legal_document_missing", "找不到这份协议。");

    return { document: documentMeta(document) };
  });
}

/**
 * Account-level consent endpoints.
 *
 * These are deliberately guarded by the raw session guard, not the consent guard: a restricted
 * account must be able to read its status, accept a document, export its data and sign out.
 */
export function registerAccountConsentRoutes(
  app: FastifyInstance,
  { prisma, requireSession, policy }: AccountConsentOptions,
): void {
  // -------------------------------------------------------------------------
  // GET /api/v1/account/consent
  // -------------------------------------------------------------------------
  app.get("/api/v1/account/consent", { preHandler: requireSession }, async (request) => {
    const user = request.currentUser!;
    const documents = requiredDocuments(policy);

    const acceptedRows =
      documents.length === 0
        ? []
        : await prisma.agreementAcceptance.findMany({
            where: {
              userId: user.id,
              OR: documents.map((document) => ({
                documentId: document.id,
                documentVersion: document.version,
                contentHash: document.contentHash,
              })),
            },
            select: { documentId: true, documentVersion: true, contentHash: true },
          });

    const acceptedDocuments = documents.filter((document) =>
      acceptedRows.some(
        (row) =>
          row.documentId === document.id &&
          row.documentVersion === document.version &&
          row.contentHash === document.contentHash,
      ),
    );

    const missing = documents.filter(
      (document) => !acceptedDocuments.some((accepted) => accepted.id === document.id),
    );

    /**
     * ⚠️ **Agreement wins over announcements.** While an agreement is missing the response tells
     * the client not to show a major announcement; the two-popup stack is exactly what the owner
     * asked us to avoid.
     */
    let majorAnnouncement: MajorAnnouncement | null = null;
    if (missing.length === 0) {
      majorAnnouncement = await pendingMajorAnnouncement(prisma, policy, user.id, user.createdAt);
    }

    return {
      requiredDocuments: documents.map((document) => ({
        ...document,
        accepted: acceptedDocuments.some((accepted) => accepted.id === document.id),
      })),
      missingDocumentIds: missing.map((document) => document.id),
      majorAnnouncement: majorAnnouncement === null ? null : toMajorView(majorAnnouncement),
    };
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/account/agreements/accept
  // -------------------------------------------------------------------------
  app.post("/api/v1/account/agreements/accept", { preHandler: requireSession }, async (request) => {
    const body = acceptedAgreementSchema.parse(request.body);
    const document = requiredDocuments(policy).find((entry) => entry.id === body.documentId);

    if (!document) throw notFound("legal_document_missing", "这份协议当前不需要确认。");
    if (document.version !== body.documentVersion) {
      throw conflict("legal_document_changed", "协议版本已经更新，请刷新后重新确认。");
    }
    if (document.contentHash !== body.contentHash) {
      throw conflict("legal_document_changed", "协议内容已经更新，请刷新后重新确认。");
    }

    const userId = request.currentUser!.id;
    await prisma.agreementAcceptance.upsert({
      where: {
        userId_documentId_documentVersion: {
          userId,
          documentId: document.id,
          documentVersion: document.version,
        },
      },
      create: {
        userId,
        documentId: document.id,
        documentVersion: document.version,
        contentHash: legalContentHash(document),
        action: "accept",
      },
      update: {},
    });

    return { ok: true, documentId: document.id, documentVersion: document.version };
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/account/major-announcements/:id/ack
  // -------------------------------------------------------------------------
  app.post(
    "/api/v1/account/major-announcements/:id/ack",
    { preHandler: requireSession },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({ version: z.string().min(1), action: z.enum(["acknowledged", "opened_details", "dismissed"]) })
        .parse(request.body);

      const announcement = policy.majorAnnouncements.find((entry) => entry.id === id);
      if (!announcement) throw notFound("announcement_missing", "找不到这条公告。");
      if (announcement.version !== body.version) {
        throw conflict("announcement_changed", "公告版本已经更新，请刷新后重试。");
      }

      const user = request.currentUser!;
      if (new Date(announcement.publishedAt).getTime() <= new Date(user.createdAt).getTime()) {
        // New accounts must not be asked to acknowledge historical announcements.
        return { ok: true, skipped: "historical" };
      }

      await prisma.majorAnnouncementAck.upsert({
        where: { userId_announcementId: { userId: user.id, announcementId: announcement.id } },
        create: {
          userId: user.id,
          announcementId: announcement.id,
          announcementVersion: announcement.version,
          action: body.action,
        },
        update: {},
      });

      return { ok: true, announcementId: announcement.id, action: body.action };
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/account/export — account-level data export while restricted
  // -------------------------------------------------------------------------
  app.get("/api/v1/account/export", { preHandler: requireSession }, async (request, reply) => {
    const userId = request.currentUser!.id;

    const memberships = await prisma.bookMember.findMany({
      where: { userId, leftAt: null },
      include: { book: true },
      orderBy: { joinedAt: "asc" },
    });

    const bookIds = memberships.map((membership) => membership.bookId);
    if (bookIds.length === 0) {
      return reply.send(emptyAccountExport(request.currentUser!));
    }

    const total = await prisma.transaction.count({ where: { bookId: { in: bookIds } } });
    if (total > 50_000) {
      throw badRequest(
        "account_export_too_large",
        "可导出的账目超过 50000 条，请联系所有者后再尝试导出。",
      );
    }

    const transactions = await prisma.transaction.findMany({
      where: { bookId: { in: bookIds } },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    });

    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header(
        "content-disposition",
        'attachment; filename="libevra-account-export.json"; filename*=UTF-8\'\'libevra-account-export.json',
      )
      .send({
        format: "libevra-account-export/v1",
        generatedAt: new Date().toISOString(),
        scope:
          "本文件包含账号资料，以及该账号当前可访问账本中的全部账目（包含共享账本中其他成员记录的账目和软删除条目）。它不是仅包含单一成员记录的子集。",
        account: {
          id: request.currentUser!.id,
          username: request.currentUser!.username,
          displayName: request.currentUser!.displayName,
          accountNumber: request.currentUser!.accountNumber,
          createdAt: request.currentUser!.createdAt,
          defaultCurrency: request.currentUser!.defaultCurrency,
        },
        ledgers: memberships.map((membership) => ({
          book: {
            id: membership.book.id,
            name: membership.book.name,
            bookNumber: membership.book.bookNumber,
            createdAt: membership.book.createdAt.toISOString(),
            disposedAt: membership.book.disposedAt?.toISOString() ?? null,
          },
          membership: {
            role: membership.role,
            joinedAt: membership.joinedAt.toISOString(),
          },
          transactions: transactions
            .filter((transaction) => transaction.bookId === membership.bookId)
            .map((transaction) => ({
              id: transaction.id,
              seq: transaction.seq,
              kind: transaction.kind,
              amountCents: Number(transaction.amountCents),
              currency: transaction.currency,
              occurredAt: transaction.occurredAt.toISOString(),
              occurredTz: transaction.occurredTz,
              categoryId: transaction.categoryId,
              paymentMethodId: transaction.paymentMethodId,
              note: transaction.note,
              deletedAt: transaction.deletedAt?.toISOString() ?? null,
              createdAt: transaction.createdAt.toISOString(),
              userId: transaction.userId,
            })),
        })),
      });
  });
}

function emptyAccountExport(user: {
  id: string;
  username: string;
  displayName: string;
  accountNumber: string;
  createdAt: string;
  defaultCurrency: string;
}): unknown {
  return {
    format: "libevra-account-export/v1",
    generatedAt: new Date().toISOString(),
    scope: "本文件包含账号资料；当前账号没有可访问的账本。",
    account: user,
    ledgers: [],
  };
}

async function pendingMajorAnnouncement(
  prisma: PrismaClient,
  policy: ConsentPolicy,
  userId: string,
  createdAt: string,
): Promise<MajorAnnouncement | null> {
  const accountCreated = new Date(createdAt).getTime();
  const applicable = policy.majorAnnouncements
    .filter((announcement) => new Date(announcement.publishedAt).getTime() > accountCreated)
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));

  if (applicable.length === 0) return null;

  const acknowledged = await prisma.majorAnnouncementAck.findMany({
    where: {
      userId,
      announcementId: { in: applicable.map((announcement) => announcement.id) },
    },
    select: { announcementId: true },
  });
  const acknowledgedIds = new Set(acknowledged.map((row) => row.announcementId));

  return applicable.find((announcement) => !acknowledgedIds.has(announcement.id)) ?? null;
}
