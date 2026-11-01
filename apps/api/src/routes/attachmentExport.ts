import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../db.js";
import { forbidden } from "../lib/errors.js";

/** USTAR：原件分块输出，UTF-8 文件名和关联关系存于同目录 JSON，不缓存整个归档。 */
export function attachmentTarHeader(name: string, size: number): Buffer {
  if (!/^[a-zA-Z0-9/._-]{1,99}$/.test(name) || !Number.isSafeInteger(size) || size < 0) throw new Error("invalid_tar_entry");
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "ascii");
  const octal = (offset: number, length: number, value: number) => h.write(value.toString(8).padStart(length - 1, "0") + "\0", offset, length, "ascii");
  octal(100, 8, 0o600); octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, size); octal(136, 12, 0);
  h.fill(32, 148, 156); h[156] = 48; h.write("ustar\0", 257, 6, "ascii"); h.write("00", 263, 2, "ascii");
  const checksum = h.reduce((sum, byte) => sum + byte, 0);
  h.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}
export function registerAttachmentExport(app: FastifyInstance, prisma: PrismaClient, requireSession: (request: FastifyRequest) => Promise<void>): void {
  app.get("/api/v1/account/attachments-export", { preHandler: requireSession }, async (request, reply) => {
    const { bookId } = z.object({ bookId: z.string().uuid().optional() }).parse(request.query);
    const owner = request.currentUser!.id;
    const memberships = await prisma.bookMember.findMany({ where: { userId: owner, leftAt: null, ...(bookId ? { bookId } : {}), book: { purgeStartedAt: null } }, select: { bookId: true } });
    if (bookId && memberships.length === 0) throw forbidden("book_forbidden", "无法访问这本账。");
    const ids = memberships.map(m => m.bookId);
    async function* archive() {
      let cursor: string | undefined;
      const json = function* (name: string, value: unknown) {
        const data = Buffer.from(JSON.stringify(value, (_k, v: unknown) => typeof v === "bigint" ? v.toString() : v, 2));
        yield attachmentTarHeader(name, data.length); yield data;
        if (data.length % 512) yield Buffer.alloc(512 - data.length % 512);
      };
      yield* json("manifest.json", { format: "libevra-attachments/v1", createdAt: new Date().toISOString(), accountId: owner, bookIds: ids, includesRecoverable: true });
      for (;;) {
        const file = await prisma.entryAttachment.findFirst({ where: { bookId: { in: ids }, state: "ready", ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, include: { links: { include: { transaction: { select: { seq: true, deletedAt: true } } } } } });
        if (!file) break;
        cursor = file.id;
        // 导出期间退出则停止提供后续原件，不沿用开始导出时的旧权限。
        if (!await prisma.bookMember.findFirst({ where: { bookId: file.bookId, userId: owner, leftAt: null } })) throw forbidden("book_forbidden", "账本访问权限已变更。");
        const path = `${file.bookId}/${file.id}`;
        yield* json(`${path}.json`, { ...file, receivedBytes: undefined, expiresAt: undefined, originalFile: `${file.id}.bin` });
        yield attachmentTarHeader(`${path}.bin`, Number(file.sizeBytes));
        let position = 0, received = 0n;
        for (;;) {
          const chunk = await prisma.entryAttachmentChunk.findUnique({ where: { attachmentId_position: { attachmentId: file.id, position } } });
          if (!chunk) break;
          received += BigInt(chunk.data.length); position++; yield Buffer.from(chunk.data);
        }
        if (received !== file.sizeBytes) throw new Error("attachment_changed_during_export");
        const tail = Number(file.sizeBytes % 512n); if (tail) yield Buffer.alloc(512 - tail);
      }
      yield Buffer.alloc(1024);
    }
    return reply.header("Content-Type", "application/x-tar").header("Content-Disposition", 'attachment; filename="libevra-attachments.tar"').header("Cache-Control", "private, no-store").send(Readable.from(archive()));
  });
}
