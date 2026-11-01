import { recordAudit } from "../admin/audit.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../db.js";
import { accountStorage, lockStorage, storagePolicy } from "../ledger/storage.js";
import { notFound } from "../lib/errors.js";

const bytes = z.number().int().positive().max(10_000_000_000_000);
export function registerStorageAdminRoutes(app: FastifyInstance, options: {
  prisma: PrismaClient; requireAdmin: (request: FastifyRequest) => Promise<void>;
}): void {
  const { prisma, requireAdmin } = options;
  const dto = (p: Awaited<ReturnType<typeof storagePolicy>>) => ({ accountBytes: Number(p.accountBytes),
    bookBytes: Number(p.bookBytes), fileBytes: Number(p.fileBytes), entryBytes: Number(p.entryBytes), entryFiles: p.entryFiles });
  app.get("/api/v1/admin/storage-policy", { preHandler: requireAdmin }, async () => dto(await storagePolicy(prisma)));
  app.patch("/api/v1/admin/storage-policy", { preHandler: requireAdmin }, async (request) => {
    const body = z.object({ accountBytes: bytes, bookBytes: bytes, fileBytes: bytes.max(1_000_000_000),
      entryBytes: bytes, entryFiles: z.number().int().min(1).max(100) }).parse(request.body);
    return prisma.$transaction(async (tx) => {
      await lockStorage(tx);
      const before = dto(await storagePolicy(tx));
      const data = { accountBytes: BigInt(body.accountBytes), bookBytes: BigInt(body.bookBytes),
        fileBytes: BigInt(body.fileBytes), entryBytes: BigInt(body.entryBytes), entryFiles: body.entryFiles };
      const result = await tx.storagePolicy.upsert({ where: { id: "global" }, create: { id: "global", ...data }, update: data });
      await recordAudit(tx, { adminUserId: request.adminActor!.userId, adminUsername: request.adminActor!.username,
        action: "storage.policy", outcome: "success", detail: { before, after: body }, requestId: request.id });
      return dto(result);
    });
  });
  app.get("/api/v1/admin/storage-limit", { preHandler: requireAdmin }, async (request) => {
    const query = z.object({ scope: z.enum(["account", "book"]), id: z.string().trim().min(1).max(100) }).parse(request.query);
    const isUuid = z.string().uuid().safeParse(query.id).success;
    if (query.scope === "account") {
      const user = await prisma.user.findFirst({ where: isUuid ? { id: query.id } : { accountNumber: query.id }, select: { id: true, displayName: true } });
      if (!user) throw notFound("storage_target_missing", "找不到指定的账户或账本。");
      const value = await accountStorage(prisma, user.id);
      return { id: user.id, name: user.displayName, bytes: Number(value.bytes), limit: Number(value.limit) };
    }
    const book = await prisma.book.findFirst({ where: isUuid ? { id: query.id } : { bookNumber: query.id }, select: { id: true, bookNumber: true, storageBytes: true, storageLimitBytes: true, pendingStorage: { select: { bytes: true } } } });
    if (!book) throw notFound("storage_target_missing", "找不到指定的账户或账本。");
    return { id: book.id, name: book.bookNumber, bytes: Number(book.storageBytes + (book.pendingStorage?.bytes ?? 0n)), limit: Number(book.storageLimitBytes ?? (await storagePolicy(prisma)).bookBytes) };
  });
  app.patch("/api/v1/admin/storage-limit", { preHandler: requireAdmin }, async (request) => {
    const body = z.object({ scope: z.enum(["account", "book"]), id: z.string().uuid(), limit: bytes.nullable() }).parse(request.body);
    return prisma.$transaction(async (tx) => {
      await lockStorage(tx);
      const target = body.scope === "account" ? await tx.user.findUnique({ where: { id: body.id }, select: { storageLimitBytes: true } })
        : await tx.book.findUnique({ where: { id: body.id }, select: { storageLimitBytes: true } });
      if (!target) throw notFound("storage_target_missing", "找不到指定的账户或账本。");
      const data = { storageLimitBytes: body.limit === null ? null : BigInt(body.limit) };
      if (body.scope === "account") await tx.user.update({ where: { id: body.id }, data });
      else await tx.book.update({ where: { id: body.id }, data });
      await recordAudit(tx, { adminUserId: request.adminActor!.userId, adminUsername: request.adminActor!.username,
        action: "storage.limit", outcome: "success", target: `${body.scope}:${body.id}`,
        detail: { before: target.storageLimitBytes?.toString() ?? null, after: body.limit }, requestId: request.id });
      return { ok: true };
    });
  });
}
