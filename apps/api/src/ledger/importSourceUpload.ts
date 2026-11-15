/**
 * 1.19.97 · 游客来源分段上传（暂存）。
 *
 * 为什么需要：账本导入原来把整本游客账本作为来源快照随一次请求上传，schema 最多 5000 笔；而增量预览接口
 * 的请求体还受 Fastify 默认 1 MiB 限制，实际上两三千笔的游客账本就传不上来。现在浏览器先把来源分段传到这里
 * 暂存，服务器按段号拼接、完整校验并**重新计算指纹**，与浏览器声明的指纹一致才变为 `ready`；之后增量预览、
 * 导入任务、清理预览都只带暂存 id（`sourceUploadId`）。
 *
 * 不变的规则：
 * - 导入任务创建时把来源复制进任务记录（与随请求上传完全相同的路径与校验），之后不再依赖暂存；
 * - 指纹、增量状态、重复决定、撤销与确认都沿用原流程，暂存只负责“把同一份来源可靠地交给服务器”。
 *
 * 保留与删除：暂存创建后 24 小时到期并被删除（创建新暂存时顺手清掉本人已到期的，另有定时清扫）；同一用户为
 * 同一游客账本新建暂存时，旧的暂存（无论是否传完）一并删除。每人同时最多 5 份。
 */
import { createHash } from "node:crypto";

import {
  SOURCE_UPLOAD_TTL_HOURS,
  fingerprintGuestSource,
  stagedGuestImportSourceSchema,
  type GuestImportSource,
  type GuestImportTransaction,
  type SourceUploadCreateRequest,
  type SourceUploadStatus,
} from "@libellum/shared";

import type { PrismaClient } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { badRequest, conflict, forbidden, gone, notFound, tooManyRequests } from "../lib/errors.js";
import { assertSourceIsSelfConsistent } from "../routes/ledgerImport.js";

type Client = Prisma.TransactionClient | PrismaClient;

/** 每人同时最多保留几份暂存（含未传完的）。 */
export const MAX_ACTIVE_SOURCE_UPLOADS = 5;

interface UploadRow {
  readonly id: string;
  readonly userId: string;
  readonly guestBookId: string;
  readonly status: string;
  readonly sourceFingerprint: string;
  readonly transactionCount: number;
  readonly partCount: number;
  readonly expiresAt: Date;
}

function statusOf(row: UploadRow, receivedParts: readonly number[]): SourceUploadStatus {
  return {
    uploadId: row.id,
    status: row.status === "ready" ? "ready" : "receiving",
    guestBookId: row.guestBookId,
    sourceFingerprint: row.sourceFingerprint,
    transactionCount: row.transactionCount,
    partCount: row.partCount,
    receivedParts: [...receivedParts],
    expiresAt: row.expiresAt.toISOString(),
  };
}

async function receivedPartsOf(client: Client, uploadId: string): Promise<number[]> {
  const rows = await client.ledgerImportSourceUploadPart.findMany({
    where: { uploadId },
    select: { position: true },
    orderBy: { position: "asc" },
  });
  return rows.map((row) => row.position);
}

/** 读一份暂存并核对归属与有效期；不检查是否已完成。 */
async function ownedUpload(client: Client, userId: string, uploadId: string, now = new Date()) {
  const row = await client.ledgerImportSourceUpload.findUnique({ where: { id: uploadId } });
  if (row === null) throw notFound("source_upload_missing", "找不到这份来源上传，可能已经过期，请重新上传。");
  if (row.userId !== userId) throw forbidden("source_upload_forbidden", "这份来源上传不属于当前账号。");
  if (row.expiresAt.getTime() <= now.getTime()) throw gone("source_upload_expired", "来源上传已过期，请重新上传。");
  return row;
}

/** 一段账目的内容摘要。zod 解析后的对象键顺序固定，同样的内容得到同样的摘要。 */
function partDigest(transactions: readonly GuestImportTransaction[]): string {
  return createHash("sha256").update(JSON.stringify(transactions)).digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

/**
 * 新建一份暂存（或继续同一 id 的那一份）。
 *
 * ⚠️ 返回的 `uploadId` 可能**不是**请求里的：同一用户、同一游客账本、同一指纹已经有一份 `ready` 的暂存时直接
 * 复用它，浏览器不必再传一遍。调用方必须使用返回值里的 id。
 */
export async function createSourceUpload(
  prisma: PrismaClient,
  userId: string,
  body: SourceUploadCreateRequest,
): Promise<SourceUploadStatus> {
  const now = new Date();
  const existing = await prisma.ledgerImportSourceUpload.findUnique({ where: { id: body.uploadId } });
  if (existing !== null) {
    if (existing.userId !== userId) throw forbidden("source_upload_forbidden", "这份来源上传不属于当前账号。");
    if (existing.expiresAt.getTime() <= now.getTime()) throw gone("source_upload_expired", "来源上传已过期，请重新上传。");
    if (
      existing.sourceFingerprint !== body.sourceFingerprint ||
      existing.transactionCount !== body.transactionCount ||
      existing.partCount !== body.partCount ||
      existing.guestBookId !== body.header.guestBookId
    ) {
      throw conflict("source_upload_conflict", "上传标识已被另一份来源使用。");
    }
    return statusOf(existing, existing.status === "ready" ? [] : await receivedPartsOf(prisma, existing.id));
  }

  return prisma.$transaction(
    async (tx) => {
      // 同一用户的创建串行进行：名额计数与“取代旧暂存”不会被并发请求各算一遍。
      // `::text`：Prisma 不能反序列化 void 列（与 `assert_ledger_write(...)::text` 同理）。
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ledger-import-source-upload:${userId}`}, 0))::text`;
      await tx.ledgerImportSourceUpload.deleteMany({ where: { userId, expiresAt: { lte: now } } });
      const ready = await tx.ledgerImportSourceUpload.findFirst({
        where: {
          userId,
          guestBookId: body.header.guestBookId,
          status: "ready",
          sourceFingerprint: body.sourceFingerprint,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
      });
      if (ready !== null) return statusOf(ready, []);
      // 同一游客账本的旧暂存（内容已变或没传完）由这一份取代。
      await tx.ledgerImportSourceUpload.deleteMany({ where: { userId, guestBookId: body.header.guestBookId } });
      const active = await tx.ledgerImportSourceUpload.count({ where: { userId } });
      if (active >= MAX_ACTIVE_SOURCE_UPLOADS) {
        throw tooManyRequests("source_upload_limit", "同时进行的来源上传太多，请稍后再试。");
      }
      const row = await tx.ledgerImportSourceUpload.create({
        data: {
          id: body.uploadId,
          userId,
          guestBookId: body.header.guestBookId,
          status: "receiving",
          sourceFingerprint: body.sourceFingerprint,
          transactionCount: body.transactionCount,
          partCount: body.partCount,
          header: body.header as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(now.getTime() + SOURCE_UPLOAD_TTL_HOURS * 3600_000),
        },
      });
      return statusOf(row, []);
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/** 收下一段账目。同一段重传：内容完全相同则视为成功，不同则拒绝。 */
export async function putSourceUploadPart(
  prisma: PrismaClient,
  userId: string,
  uploadId: string,
  position: number,
  transactions: readonly GuestImportTransaction[],
): Promise<SourceUploadStatus> {
  const digest = partDigest(transactions);
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ledger_import_source_uploads" WHERE "id" = ${uploadId}::uuid FOR UPDATE`;
      const row = await ownedUpload(tx, userId, uploadId);
      if (row.status === "ready") throw conflict("source_upload_closed", "这份来源已经上传完成，不能再修改。");
      if (position >= row.partCount) throw badRequest("source_upload_part_invalid", "分段编号超出范围。");
      const prior = await tx.ledgerImportSourceUploadPart.findUnique({
        where: { uploadId_position: { uploadId, position } },
        select: { sha256: true },
      });
      if (prior !== null) {
        if (prior.sha256 !== digest) throw conflict("source_upload_part_conflict", "这一段与先前上传的内容不一致。");
      } else {
        /**
         * 累计不能超过声明的笔数（1.19.98 发布前审查补上）：否则一个登录用户可以往一份暂存里塞远超声明的数据，
         * 写满磁盘，或在“完成”一次性读入时撑爆内存。各段内容已按 schema 限长，所以总量随声明笔数有界。
         */
        const counted = await tx.$queryRaw<{ received: number }[]>`
          SELECT COALESCE(SUM(jsonb_array_length("transactions")), 0)::int AS "received"
          FROM "ledger_import_source_upload_parts" WHERE "upload_id" = ${uploadId}::uuid`;
        const received = counted[0]?.received ?? 0;
        if (received + transactions.length > row.transactionCount) {
          throw badRequest("source_upload_too_many", "上传的账目超过了声明的笔数。");
        }
        try {
          await tx.ledgerImportSourceUploadPart.create({
            data: { uploadId, position, sha256: digest, transactions: transactions as unknown as Prisma.InputJsonValue },
          });
        } catch (error) {
          // 上面的行锁已让同一暂存的写入串行；这里只是兜底，把唯一约束冲突说清楚。
          if (isUniqueViolation(error)) throw conflict("source_upload_part_conflict", "这一段与先前上传的内容不一致。");
          throw error;
        }
      }
      return statusOf(row, await receivedPartsOf(tx, uploadId));
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/**
 * 拼接并完整校验。全部段齐了、笔数与声明一致、通过来源 schema 与自洽检查、重新计算的指纹与声明一致，
 * 才保存完整来源并变为 `ready`；各段随即删除。已经 `ready` 的再次调用直接返回现状。
 */
export async function completeSourceUpload(
  prisma: PrismaClient,
  userId: string,
  uploadId: string,
): Promise<SourceUploadStatus> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ledger_import_source_uploads" WHERE "id" = ${uploadId}::uuid FOR UPDATE`;
      const row = await ownedUpload(tx, userId, uploadId);
      if (row.status === "ready") return statusOf(row, []);
      const parts = await tx.ledgerImportSourceUploadPart.findMany({
        where: { uploadId },
        orderBy: { position: "asc" },
      });
      if (parts.length !== row.partCount) {
        const received = new Set(parts.map((part) => part.position));
        const missing = Array.from({ length: row.partCount }, (_, index) => index).filter((index) => !received.has(index));
        throw conflict("source_upload_incomplete", "来源还没有全部上传，请继续上传。", { missing });
      }
      const transactions = parts.flatMap((part) => part.transactions as unknown as GuestImportTransaction[]);
      if (transactions.length !== row.transactionCount) {
        throw badRequest("source_upload_count_mismatch", "上传的账目笔数与声明的不一致，请重新上传。");
      }
      const parsed = stagedGuestImportSourceSchema.safeParse({
        ...(row.header as Record<string, unknown>),
        transactions,
      });
      if (!parsed.success) throw badRequest("source_upload_invalid", "上传的来源格式不正确，请重新上传。");
      const source: GuestImportSource = parsed.data;
      if (new Set(source.transactions.map((item) => item.id)).size !== source.transactions.length) {
        throw badRequest("source_duplicate_id", "来源账目 id 重复。");
      }
      assertSourceIsSelfConsistent(source);
      if ((await fingerprintGuestSource(source)) !== row.sourceFingerprint) {
        throw conflict("source_upload_fingerprint_mismatch", "上传的来源与浏览器里的不一致，请重新上传。");
      }
      await tx.ledgerImportSourceUploadPart.deleteMany({ where: { uploadId } });
      const saved = await tx.ledgerImportSourceUpload.update({
        where: { id: uploadId },
        data: { status: "ready", source: source as unknown as Prisma.InputJsonValue },
      });
      return statusOf(saved, []);
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

/** 取出一份已完成的暂存来源，供增量预览、导入任务、清理预览使用。 */
export async function loadStagedSource(client: Client, userId: string, uploadId: string): Promise<GuestImportSource> {
  const row = await ownedUpload(client, userId, uploadId);
  if (row.status !== "ready" || row.source === null) {
    throw conflict("source_upload_incomplete", "来源还没有全部上传，请继续上传。");
  }
  return row.source as unknown as GuestImportSource;
}

/** 删除全部到期暂存（定时调用）。返回删除的份数。 */
export async function sweepExpiredSourceUploads(prisma: PrismaClient, now = new Date()): Promise<number> {
  const result = await prisma.ledgerImportSourceUpload.deleteMany({ where: { expiresAt: { lte: now } } });
  return result.count;
}
