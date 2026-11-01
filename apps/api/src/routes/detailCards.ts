import { detailCardSchema } from "@libellum/shared";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { accountStorage, lockAccountStorage } from "../ledger/storage.js";
import { AppError, conflict, forbidden } from "../lib/errors.js";

type JsonObject = Record<string, unknown>;
const object = (v: unknown): JsonObject => v && typeof v === "object" && !Array.isArray(v) ? v as JsonObject : {};
export const detailRecords = (v: unknown): JsonObject => object(object(v)._detailCards);
export function publicWorkbench(v: unknown): unknown {
  const { _detailCards: _private, ...rest } = object(v);
  return rest;
}
export function preserveDetailCards(next: unknown, previous: unknown): Prisma.InputJsonValue {
  const records = object(previous)._detailCards;
  return { ...object(next), ...(records === undefined ? {} : { _detailCards: records }) } as Prisma.InputJsonValue;
}
/** 个人显示配置，不读取或修改账目；bookId 仅作用户配置的分组键。 */
export function registerDetailCardRoutes(app: FastifyInstance, { prisma, requireAuth }: {
  prisma: PrismaClient; requireAuth: (request: FastifyRequest) => Promise<void>;
}) {
  const params = z.strictObject({ bookId: z.uuid() });
  const scope = (request: FastifyRequest, accountScope: string) => {
    if (accountScope !== `user:${request.currentUser!.id}`) throw forbidden("workbench_account_changed", "账号已切换，请重新打开页面。");
  };
  app.get("/api/v1/detail-cards/:bookId", { preHandler: requireAuth }, async request => {
    const { bookId } = params.parse(request.params);
    scope(request, z.strictObject({ accountScope: z.string() }).parse(request.query).accountScope);
    const row = await prisma.workbenchConfiguration.findUnique({ where: { userId: request.currentUser!.id } });
    return { record: detailRecords(row?.configuration)[bookId] ?? null };
  });
  app.post("/api/v1/detail-cards/:bookId", { preHandler: requireAuth, bodyLimit: 4096, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async request => {
    const { bookId } = params.parse(request.params);
    const input = z.strictObject({ accountScope: z.string(), baseVersion: z.number().int().min(0).max(2147483646), configuration: detailCardSchema }).parse(request.body);
    scope(request, input.accountScope);
    const userId = request.currentUser!.id;
    return prisma.$transaction(async tx => {
      await lockAccountStorage(tx, userId);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.closedAt !== null || user.disabledAt !== null) throw new AppError(401, "unauthorized", "登录状态已失效。");
      const before = await accountStorage(tx, userId);
      const row = await tx.workbenchConfiguration.findUnique({ where: { userId } });
      if (row && row.schemaVersion > 1) throw conflict("workbench_newer", "请更新应用后再保存。");
      const records = detailRecords(row?.configuration), current = object(records[bookId]);
      if ((current.version ?? 0) !== input.baseVersion) throw conflict("workbench_conflict", "其他设备已更新显示方案。", { record: records[bookId] ?? null });
      if (!(bookId in records) && Object.keys(records).length >= 1000) throw new AppError(413, "configuration_limit", "显示方案数量已达上限。");
      const record = { version: input.baseVersion + 1, configuration: input.configuration, updatedAt: new Date().toISOString() };
      const configuration = { ...(row ? object(row.configuration) : { schemaVersion: 1, workspace: null, presets: [] }), _detailCards: { ...records, [bookId]: record } } as Prisma.InputJsonValue;
      if (row) await tx.workbenchConfiguration.update({ where: { userId }, data: { configuration } });
      else await tx.workbenchConfiguration.create({ data: { userId, version: 1, schemaVersion: 1, configuration } });
      const after = await accountStorage(tx, userId);
      if (after.bytes > before.bytes && after.bytes > after.limit) throw new AppError(413, "account_storage_full", "账户空间不足。");
      return { record };
    });
  });
}
