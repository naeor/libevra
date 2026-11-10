import { createHash, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ATTACHMENT_CHUNK_BYTES, type AttachmentView } from "@libellum/shared";
import type { PrismaClient } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { BookRole } from "../generated/prisma/enums.js";
import { canEditAll, canEditEntry, canRecord, requireBook, requireBookForRecord } from "../ledger/access.js";
import { recordEvent } from "../ledger/events.js";
import { accountStorage, assertStorageGrowth, lockBookStorage, lockAccountStorage, storageDto, storagePolicy } from "../ledger/storage.js";
import { AppError, badRequest, forbidden, notFound, conflict } from "../lib/errors.js";

const uuid = z.string().uuid();
const reserveSchema = z.object({
  id: uuid, accountId: uuid.optional(), name: z.string().trim().min(1).max(255), mediaType: z.string().max(100),
  sizeBytes: z.number().int().positive().max(1_000_000_000), transactionIds: z.array(uuid).min(1).max(100),
});
const include = { links: { include: { transaction: { select: { id: true, seq: true, deletedAt: true } } } } } as const;
type FileRow = Prisma.EntryAttachmentGetPayload<{ include: typeof include }>;
type Tx = Prisma.TransactionClient;

async function uploaderPresent(tx: Tx, file: { bookId: string; uploaderId: string }): Promise<boolean> {
  return (await tx.bookMember.count({ where: { bookId: file.bookId, userId: file.uploaderId, leftAt: null } })) > 0;
}
/**
 * 谁能删除 / 恢复 / 清理一个附件：上传者本人；上传者已经不在账本里时，“编辑全部”的成员也可以（1.19.56：
 * 记账成员只能处理自己上传的附件）。
 */
async function canRemove(tx: Tx, file: FileRow, userId: string, role: BookRole): Promise<boolean> {
  if (!canRecord(role)) return false;
  if (file.uploaderId === userId) return true;
  return canEditAll(role) && !(await uploaderPresent(tx, file));
}
async function view(tx: Tx, row: FileRow, userId: string, role: BookRole): Promise<AttachmentView> {
  return {
    id: row.id, bookId: row.bookId, name: row.name, mediaType: row.mediaType,
    sizeBytes: Number(row.sizeBytes), receivedBytes: Number(row.receivedBytes), state: row.state as "ready" | "uploading",
    uploaderId: row.uploaderId, uploaderName: row.uploaderName, createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null, canDelete: await canRemove(tx, row, userId, role),
    entries: row.links.map((l) => ({ id: l.transaction.id, seq: l.transaction.seq,
      deleted: row.deletedAt !== null || l.deletedAt !== null || l.transaction.deletedAt !== null })),
  };
}

/** 文件内容决定可预览类型，不信任浏览器的 MIME 或扩展名。未知格式拒绝保存。 */
export function attachmentMediaType(head: Buffer, name: string): string | null {
  const hex = head.subarray(0, 12).toString("hex");
  const ascii = head.subarray(0, 16).toString("latin1");
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  if (ascii.startsWith("%PDF-")) return "application/pdf";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") return "audio/wav";
  if (ascii.startsWith("OggS")) return "audio/ogg";
  if (ascii.startsWith("fLaC")) return "audio/flac";
  if (ascii.startsWith("ID3") || (head[0] === 255 && ((head[1] ?? 0) & 224) === 224)) return "audio/mpeg";
  if (ascii.slice(4, 8) === "ftyp") {
    if (/hei[cf]|mif1/.test(ascii.slice(8))) return "image/heic";
    if (/\.m4a$/i.test(name)) return "audio/mp4";
  }
  if (/\.(txt|csv)$/i.test(name) && !head.includes(0)) return "text/plain";
  return null;
}

interface Options { prisma: PrismaClient; requireAuth: (r: FastifyRequest) => Promise<void> }
export function registerAttachmentRoutes(app: FastifyInstance, { prisma, requireAuth }: Options): void {
  // 每次只接收一块；全文件始终分块传输，不借用 OCR 的内存上传通道。
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: ATTACHMENT_CHUNK_BYTES }, (_req, body, done) => done(null, body));
  async function access(request: FastifyRequest, write = false, db: PrismaClient | Tx = prisma) {
    const path = request.params as { bookId?: string };
    const scoped = path.bookId ? Object.assign(Object.create(request), {
      headers: { ...request.headers, "x-libellum-book": uuid.parse(path.bookId) },
    }) as FastifyRequest : request;
    /** 1.19.56：上传附件属于记账（记账及以上），挂到哪些账目上再按“能不能改这笔”判断。 */
    return (write ? requireBookForRecord : requireBook)(db as PrismaClient, scoped, request.currentUser!.id);
  }
  async function find(tx: Tx, id: string, bookId: string) {
    const file = await tx.entryAttachment.findFirst({ where: { id: uuid.parse(id), bookId }, include });
    if (!file) throw notFound("attachment_missing", "找不到附件。");
    return file;
  }
  async function expired() {
    // 仅清理到期且尚未完成的临时上传；可恢复附件和备份不受影响。
    const rows = await prisma.entryAttachment.findMany({ where: { state: "uploading", expiresAt: { lt: new Date() } }, select: { id: true, bookId: true }, take: 100 });
    for (const row of rows) await prisma.$transaction(async tx => { await lockBookStorage(tx, row.bookId); await tx.entryAttachment.deleteMany({ where: { id: row.id, state: "uploading", expiresAt: { lt: new Date() } } }); });
  }
  const timer = setInterval(() => { void expired().catch((error: unknown) => app.log.error(error)); }, 60_000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));

  app.get("/api/v1/storage", { preHandler: requireAuth }, async (request) => storageDto(await accountStorage(prisma, request.currentUser!.id)));
  app.get("/api/v1/books/:bookId/storage", { preHandler: requireAuth }, async (request) => {
    const { bookId } = await access(request);
    const [book, files, policy] = await Promise.all([
      prisma.book.findUniqueOrThrow({ where: { id: bookId }, include: { pendingStorage: true } }),
      prisma.entryAttachment.findMany({ where: { bookId }, include }), storagePolicy(prisma),
    ]);
    const ready = files.filter((f) => f.state === "ready");
    return { bytes: Number(book.storageBytes + (book.pendingStorage?.bytes ?? 0n)), limit: Number(book.storageLimitBytes ?? policy.bookBytes),
      reservedBytes: files.filter((f) => f.state === "uploading").reduce((n, f) => n + Number(f.sizeBytes), 0),
      attachmentBytes: ready.reduce((n, f) => n + Number(f.sizeBytes), 0), attachmentCount: ready.length,
      recoverableBytes: ready.filter((f) => f.deletedAt || f.links.every((l) => l.deletedAt || l.transaction.deletedAt)).reduce((n, f) => n + Number(f.sizeBytes), 0),
      limits: { accountBytes: Number(policy.accountBytes), bookBytes: Number(policy.bookBytes),
        fileBytes: Number(policy.fileBytes), entryBytes: Number(policy.entryBytes), entryFiles: policy.entryFiles } };
  });
  app.get("/api/v1/books/:bookId/attachments", { preHandler: requireAuth }, async (request) => {
    const { bookId, role } = await access(request);
    const query = z.object({ entry: uuid.optional(), cursor: uuid.optional(), search: z.string().max(200).optional(),
      state: z.enum(["active", "recoverable", "all"]).default("active"), sort: z.enum(["newest", "oldest", "largest", "smallest"]).default("newest"), type: z.string().max(100).optional() }).parse(request.query);
    const rows = await prisma.entryAttachment.findMany({ where: {
      bookId, state: "ready", ...(query.entry ? { links: { some: { transactionId: query.entry } } } : {}),
      ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
      ...(query.type ? { mediaType: { startsWith: query.type } } : {}),
      ...(query.state === "active" ? { deletedAt: null, links: { some: { ...(query.entry ? { transactionId: query.entry } : {}), deletedAt: null, transaction: { deletedAt: null } } } } : {}),
      ...(query.state === "recoverable" ? { OR: [{ deletedAt: { not: null } }, { links: { none: { deletedAt: null, transaction: { deletedAt: null } } } }] } : {}),
    }, orderBy: query.sort === "largest" || query.sort === "smallest" ? [{ sizeBytes: query.sort === "largest" ? "desc" : "asc" }, { id: "asc" }] : [{ createdAt: query.sort === "oldest" ? "asc" : "desc" }, { id: "desc" }], ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), take: 101, include });
    const page = rows.slice(0, 100);
    return { items: await Promise.all(page.map((row) => view(prisma, row, request.currentUser!.id, role))),
      nextCursor: rows.length > 100 ? page.at(-1)!.id : null };
  });

  app.post("/api/v1/books/:bookId/attachments", { preHandler: requireAuth }, async (request) => {
    const { bookId, role } = await access(request, true);
    const body = reserveSchema.parse(request.body);
    if (body.accountId && body.accountId !== request.currentUser!.id) throw forbidden("attachment_account_changed", "账户已切换，请登录文件所属账户后重试。");
    body.name = body.name.replace(/[\x00-\x1f\x7f/\\]/g, "_");
    const ids = [...new Set(body.transactionIds)];
    const user = request.currentUser!;
    const file = await prisma.$transaction(async (tx) => {
      await lockBookStorage(tx, bookId);
      await tx.$queryRaw`SELECT assert_ledger_write(${bookId}::uuid)::text`;
      await lockAccountStorage(tx, request.currentUser!.id);
      await access(request, true, tx);
      let existing = await tx.entryAttachment.findUnique({ where: { id: body.id }, include });
      if (existing?.state === "uploading" && existing.expiresAt && existing.expiresAt.getTime() <= Date.now() && existing.uploaderId === user.id && existing.bookId === bookId) {
        await tx.entryAttachment.delete({ where: { id: existing.id } }); existing = null;
      }
      if (existing) {
        if (existing.bookId !== bookId || existing.uploaderId !== user.id || existing.sizeBytes !== BigInt(body.sizeBytes)
          || existing.name !== body.name || existing.links.map((l) => l.transactionId).sort().join() !== ids.sort().join()) {
          throw conflict("attachment_id_conflict", "上传标识已被使用。");
        }
        return existing;
      }
      const policy = await storagePolicy(tx);
      if (BigInt(body.sizeBytes) > policy.fileBytes) throw new AppError(413, "attachment_too_large", "文件超过单个附件的大小限制。");
      const entries = await tx.transaction.findMany({ where: { id: { in: ids }, bookId, deletedAt: null }, include: { _count: { select: { attachmentLinks: true } } } });
      if (entries.length !== ids.length) throw notFound("transaction_missing", "部分账目已不可用。");
      if (entries.some((e) => !canEditEntry(role, user.id, e.userId))) throw forbidden("entry_not_yours", "你只能给自己记的账目添加附件。");
      for (const e of entries) {
        if (e._count.attachmentLinks >= policy.entryFiles) throw new AppError(413, "entry_attachment_count", "账目的附件数量已达上限，含可恢复附件。");
        if (e.storageBytes + BigInt(body.sizeBytes) > policy.entryBytes) throw new AppError(413, "entry_storage_full", "附件将超过单笔账目的空间上限。");
      }
      await assertStorageGrowth(tx, user.id, bookId, BigInt(body.sizeBytes));
      const row = await tx.entryAttachment.create({ data: {
        id: body.id, bookId, uploaderId: user.id, uploaderName: user.displayName,
        name: body.name.replace(/[\x00-\x1f\x7f/\\]/g, "_"), mediaType: body.mediaType,
        sizeBytes: BigInt(body.sizeBytes), expiresAt: new Date(Date.now() + 60 * 60_000),
        links: { create: ids.map((transactionId) => ({ transactionId })) },
      }, include });
      await assertStorageGrowth(tx, user.id, bookId, 0n);
      const storedEntries = await tx.transaction.findMany({ where: { id: { in: ids } }, select: { storageBytes: true } });
      if (storedEntries.some(e => e.storageBytes > policy.entryBytes)) throw new AppError(413, "entry_storage_full", "附件将超过单笔账目的空间上限。");
      return row;
    });
    return view(prisma, file, user.id, role);
  });

  app.put("/api/v1/books/:bookId/attachments/:id/chunks/:position", { preHandler: requireAuth, bodyLimit: ATTACHMENT_CHUNK_BYTES }, async (request) => {
    const { bookId } = await access(request, true);
    const { id, position } = z.object({ id: uuid, position: z.coerce.number().int().min(0).max(1000) }).parse(request.params);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw badRequest("attachment_chunk_invalid", "文件分块无效。");
    const data = request.body;
    return prisma.$transaction(async (tx) => {
      await lockBookStorage(tx, bookId);
      await tx.$queryRaw`SELECT assert_ledger_write(${bookId}::uuid)::text`;
      await lockAccountStorage(tx, request.currentUser!.id);
      await access(request, true, tx);
      await tx.$queryRaw`SELECT id FROM entry_attachments WHERE id=${id}::uuid FOR UPDATE`;
      const row = await find(tx, id, bookId);
      if (row.uploaderId !== request.currentUser!.id) throw forbidden("attachment_upload_forbidden", "只能继续自己的上传。");
      if (row.state !== "uploading" || !row.expiresAt || row.expiresAt.getTime() <= Date.now()) throw conflict("attachment_upload_expired", "上传已结束或过期，请重试。");
      const prior = await tx.entryAttachmentChunk.findUnique({ where: { attachmentId_position: { attachmentId: id, position } } });
      if (prior) {
        if (prior.data.length !== data.length || !timingSafeEqual(Buffer.from(prior.data), data)) throw conflict("attachment_chunk_conflict", "文件分块与先前上传不一致。");
        return { receivedBytes: Number(row.receivedBytes) };
      }
      if (row.receivedBytes + BigInt(data.length) > row.sizeBytes || BigInt(position * ATTACHMENT_CHUNK_BYTES) !== row.receivedBytes) throw badRequest("attachment_chunk_order", "文件分块顺序或大小不正确。");
      if (row.receivedBytes + BigInt(data.length) < row.sizeBytes && data.length !== ATTACHMENT_CHUNK_BYTES) throw badRequest("attachment_chunk_size", "文件分块大小不正确。");
      await tx.entryAttachmentChunk.create({ data: { attachmentId: id, position, data: new Uint8Array(data) } });
      const saved = await tx.entryAttachment.update({ where: { id }, data: { receivedBytes: { increment: data.length } } });
      return { receivedBytes: Number(saved.receivedBytes) };
    });
  });

  app.post("/api/v1/books/:bookId/attachments/:id/complete", { preHandler: requireAuth }, async (request) => {
    const { bookId, role } = await access(request, true);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const file = await prisma.$transaction(async (tx) => {
      await lockBookStorage(tx, bookId);
      await tx.$queryRaw`SELECT assert_ledger_write(${bookId}::uuid)::text`;
      await lockAccountStorage(tx, request.currentUser!.id);
      await access(request, true, tx);
      await tx.$queryRaw`SELECT id FROM entry_attachments WHERE id=${id}::uuid FOR UPDATE`;
      const row = await find(tx, id, bookId);
      if (row.uploaderId !== request.currentUser!.id) throw forbidden("attachment_upload_forbidden", "只能完成自己的上传。");
      if (row.state === "ready") return row;
      if (row.receivedBytes !== row.sizeBytes || !row.expiresAt || row.expiresAt.getTime() <= Date.now()) throw conflict("attachment_incomplete", "文件尚未上传完整或上传已过期。");
      if (row.links.some(link => link.transaction.deletedAt !== null)) throw conflict("transaction_deleted", "关联账目已删除，请恢复账目后重试。");
      // 管理员调低额度或并发增加内容时，尚未完成的上传不能绕过当前限额。
      await assertStorageGrowth(tx, request.currentUser!.id, bookId, 0n);
      const hash = createHash("sha256");
      let mediaType: string | null = null;
      for (let position = 0; position * ATTACHMENT_CHUNK_BYTES < Number(row.sizeBytes); position++) {
        const chunk = await tx.entryAttachmentChunk.findUniqueOrThrow({ where: { attachmentId_position: { attachmentId: id, position } } });
        const data = Buffer.from(chunk.data);
        if (position === 0) mediaType = attachmentMediaType(data, row.name);
        hash.update(data);
      }
      if (!mediaType) throw badRequest("attachment_type_unsupported", "支持照片、PDF、音频和文本文件。");
      const saved = await tx.entryAttachment.update({ where: { id }, data: { state: "ready", mediaType, sha256: hash.digest("hex"), expiresAt: null }, include });
      for (const link of saved.links) await recordEvent(tx, { bookId, transactionId: link.transactionId,
        transactionSeq: link.transaction.seq, actorId: request.currentUser!.id, actorName: request.currentUser!.displayName,
        kind: "updated", changes: { attachments: { from: null, to: { id, name: saved.name, bytes: Number(saved.sizeBytes) } } } });
      await assertStorageGrowth(tx, request.currentUser!.id, bookId, 0n);
      const policy = await storagePolicy(tx);
      if (saved.sizeBytes > policy.fileBytes) throw new AppError(413, "attachment_too_large", "文件超过单个附件的大小限制。");
      const stored = await tx.transaction.findMany({ where: { id: { in: saved.links.map(l => l.transactionId) } }, select: { storageBytes: true, _count: { select: { attachmentLinks: true } } } });
      if (stored.some(e => e._count.attachmentLinks > policy.entryFiles)) throw new AppError(413, "entry_attachment_count", "账目的附件数量已达上限，含可恢复附件。");
      if (stored.some(e => e.storageBytes > policy.entryBytes)) throw new AppError(413, "entry_storage_full", "附件将超过单笔账目的空间上限。");
      return saved;
    }, { timeout: 60_000 });
    return view(prisma, file, request.currentUser!.id, role);
  });

  app.delete("/api/v1/books/:bookId/attachments/:id", { preHandler: requireAuth }, async (request) => {
    const { bookId, role } = await access(request, true);
    const { id } = z.object({ id: uuid }).parse(request.params);
    await prisma.$transaction(async (tx) => {
      await lockBookStorage(tx, bookId);
      await tx.$queryRaw`SELECT assert_ledger_write(${bookId}::uuid)::text`;
      await lockAccountStorage(tx, request.currentUser!.id);
      await access(request, true, tx);
      const row = await find(tx, id, bookId);
      if (!(await canRemove(tx, row, request.currentUser!.id, role))) throw forbidden("attachment_delete_forbidden", "只能由上传者删除此附件。");
      if (row.state === "uploading") { await tx.entryAttachment.delete({ where: { id } }); return; }
      if (row.deletedAt) return;
      await tx.entryAttachment.update({ where: { id }, data: { deletedAt: new Date() } });
      for (const link of row.links) await recordEvent(tx, { bookId, transactionId: link.transactionId, transactionSeq: link.transaction.seq,
        actorId: request.currentUser!.id, actorName: request.currentUser!.displayName, kind: "updated",
        changes: { attachments: { from: { id, name: row.name }, to: null } } });
    });
    return { ok: true };
  });
  app.post("/api/v1/books/:bookId/attachments/:id/restore", { preHandler: requireAuth }, async (request) => {
    const { bookId, role } = await access(request, true);
    const { id } = z.object({ id: uuid }).parse(request.params);
    return prisma.$transaction(async (tx) => {
      await lockBookStorage(tx, bookId);
      await tx.$queryRaw`SELECT assert_ledger_write(${bookId}::uuid)::text`;
      await lockAccountStorage(tx, request.currentUser!.id);
      await access(request, true, tx);
      const row = await find(tx, id, bookId);
      if (!(await canRemove(tx, row, request.currentUser!.id, role))) throw forbidden("attachment_delete_forbidden", "只能由上传者恢复此附件。");
      if (row.deletedAt) {
        await tx.entryAttachment.update({ where: { id }, data: { deletedAt: null } });
        for (const link of row.links) await recordEvent(tx, { bookId, transactionId: link.transactionId, transactionSeq: link.transaction.seq,
          actorId: request.currentUser!.id, actorName: request.currentUser!.displayName, kind: "updated",
          changes: { attachments: { from: null, to: { id, name: row.name, restored: true } } } });
      }
      return { ok: true };
    });
  });

  app.delete("/api/v1/books/:bookId/attachments/:id/permanent", { preHandler: requireAuth }, async (request) => {
    const { bookId, role } = await access(request, true);
    const { id } = z.object({ id: uuid }).parse(request.params);
    await prisma.$transaction(async tx => {
      await lockBookStorage(tx, bookId);
      await tx.$queryRaw`SELECT assert_ledger_write(${bookId}::uuid)::text`;
      await lockAccountStorage(tx, request.currentUser!.id);
      await access(request, true, tx);
      const row = await find(tx, id, bookId);
      if (!(await canRemove(tx, row, request.currentUser!.id, role))) throw forbidden("attachment_delete_forbidden", "只能由上传者清理此附件。");
      if (!row.deletedAt && row.links.some(l => !l.deletedAt && !l.transaction.deletedAt)) throw conflict("attachment_still_active", "请先删除附件，再永久清理。");
      for (const link of row.links) await recordEvent(tx, { bookId, transactionId: link.transactionId, transactionSeq: link.transaction.seq,
        actorId: request.currentUser!.id, actorName: request.currentUser!.displayName, kind: "updated",
        changes: { attachments: { from: { id, name: row.name }, to: { permanentlyDeleted: true } } } });
      await tx.entryAttachment.delete({ where: { id } });
    });
    return { ok: true };
  });

  app.get("/api/v1/books/:bookId/attachments/:id/content", { preHandler: requireAuth }, async (request, reply) => {
    const { bookId } = await access(request);
    const { id } = z.object({ id: uuid }).parse(request.params);
    const row = await find(prisma, id, bookId);
    if (row.state !== "ready") throw conflict("attachment_incomplete", "附件尚未上传完成。");
    const size = Number(row.sizeBytes);
    let start = 0, end = size - 1;
    if (request.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!range || (!range[1] && !range[2])) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
      reply.code(206).header("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    const download = (request.query as { download?: string }).download === "1";
    reply.header("Content-Type", row.mediaType).header("Content-Length", end - start + 1)
      .header("Accept-Ranges", "bytes").header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "sandbox")
      .header("Content-Disposition", `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.name)}`);
    async function* chunks() {
      for (let position = Math.floor(start / ATTACHMENT_CHUNK_BYTES); position <= Math.floor(end / ATTACHMENT_CHUNK_BYTES); position++) {
        const chunk = await prisma.entryAttachmentChunk.findUniqueOrThrow({ where: { attachmentId_position: { attachmentId: id, position } } });
        yield Buffer.from(chunk.data).subarray(Math.max(0, start - position * ATTACHMENT_CHUNK_BYTES), Math.min(chunk.data.length, end + 1 - position * ATTACHMENT_CHUNK_BYTES));
      }
    }
    return reply.send(Readable.from(chunks()));
  });
}
