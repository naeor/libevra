import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../db.js";
import { requireBook } from "../ledger/access.js";

export function registerEntryNoticeRoutes(app: FastifyInstance, options: {
  prisma: PrismaClient; requireAuth: (request: FastifyRequest) => Promise<void>;
}): void {
  const { prisma, requireAuth } = options;
  async function scoped(request: FastifyRequest) {
    const { bookId } = z.object({ bookId: z.string().uuid() }).parse(request.params);
    return requireBook(prisma, Object.assign(Object.create(request), {
      headers: { ...request.headers, "x-libellum-book": bookId },
    }) as FastifyRequest, request.currentUser!.id);
  }
  const ids = z.object({ ids: z.array(z.string().uuid()).max(200) });
  app.get("/api/v1/book-notices/unread", { preHandler: requireAuth }, async (request) => {
    const rows = await prisma.entryChangeNotice.groupBy({ by: ["bookId"], where: {
      recipientId: request.currentUser!.id, readAt: null,
      book: { archivedAt: null, purgeStartedAt: null, members: { some: { userId: request.currentUser!.id, leftAt: null } } },
    }, _count: { id: true } });
    return { books: Object.fromEntries(rows.map((r) => [r.bookId, r._count.id])) };
  });
  app.get("/api/v1/books/:bookId/notices", { preHandler: requireAuth }, async (request) => {
    const { bookId } = await scoped(request);
    const { cursor } = z.object({ cursor: z.string().uuid().optional() }).parse(request.query);
    const rows = await prisma.entryChangeNotice.findMany({ where: { bookId, recipientId: request.currentUser!.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { event: { select: { id: true, transactionId: true, transactionSeq: true, actorName: true, changes: true, snapshot: true } } },
    });
    return { items: rows.slice(0, 100).map(({ event, ...row }) => ({ ...row,
      transactionId: event.transactionId, transactionSeq: event.transactionSeq, actorName: event.actorName, changes: noticeChanges(event.changes, event.snapshot),
      entry: event.snapshot && typeof event.snapshot === "object" && !Array.isArray(event.snapshot) ? event.snapshot["after"] ?? null : null,
    })), nextCursor: rows.length > 100 ? rows[99]!.id : null };
  });
  app.post("/api/v1/books/:bookId/notices/read", { preHandler: requireAuth }, async (request) => {
    const { bookId } = await scoped(request);
    const body = ids.parse(request.body);
    await prisma.entryChangeNotice.updateMany({ where: { id: { in: body.ids }, bookId,
      recipientId: request.currentUser!.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });
  app.post("/api/v1/notifications/read-visible", { preHandler: requireAuth }, async (request) => {
    const body = ids.parse(request.body);
    await prisma.notification.updateMany({ where: { id: { in: body.ids }, recipientId: request.currentUser!.id, readAt: null,
      kind: { in: ["book_invite", "referral_reminder"] } }, data: { readAt: new Date() } });
    return { ok: true };
  });
}

function noticeChanges(changes: unknown, snapshot: unknown): Record<string, { from: unknown; to: unknown }> {
  const result = { ...(changes as Record<string, { from: unknown; to: unknown }> ?? {}) };
  const values = snapshot as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  for (const [key, relation] of [["categoryId","category"],["paymentMethodId","paymentMethod"]] as const) {
    if (result[key]) result[key] = { from: values?.before?.[relation] ?? result[key].from, to: values?.after?.[relation] ?? result[key].to };
  }
  return result;
}
