import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { parseWorkspaceConfiguration, WORKSPACE_MAX_BYTES, WORKSPACE_SCHEMA_VERSION } from "@libellum/shared/workbench/configuration";
import type { PrismaClient } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { AppError, badRequest, conflict, forbidden } from "../lib/errors.js";

/** 账号级配置；请求里不接受 userId / bookId，也不读取任何账本数据。 */
export function registerWorkbenchRoutes(app: FastifyInstance, { prisma, requireAuth }: {
  readonly prisma: PrismaClient; readonly requireAuth: (request: FastifyRequest) => Promise<void>;
}): void {
  const view = (record: { version: number; schemaVersion: number; updatedAt: Date; configuration: unknown } | null) => record === null ? null : ({
    version: record.version, schemaVersion: record.schemaVersion, updatedAt: record.updatedAt.toISOString(), configuration: record.configuration,
  });
  app.get("/api/v1/workbench", { preHandler: requireAuth }, async request => {
    const query = z.strictObject({ accountScope: z.string().optional() }).parse(request.query);
    if (query.accountScope !== undefined && query.accountScope !== `user:${request.currentUser!.id}`) throw forbidden("workbench_account_changed", "账号已切换，请重新打开工作台。");
    return { record: view(await prisma.workbenchConfiguration.findUnique({ where: { userId: request.currentUser!.id } })) };
  });
  app.post("/api/v1/workbench", { preHandler: requireAuth, bodyLimit: WORKSPACE_MAX_BYTES + 1024, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async request => {
    const input = z.strictObject({ baseVersion: z.number().int().min(0).max(2147483646), configuration: z.unknown(), accountScope: z.string().optional() }).parse(request.body);
    if (input.accountScope !== undefined && input.accountScope !== `user:${request.currentUser!.id}`) throw forbidden("workbench_account_changed", "账号已切换，请重新打开工作台。");
    let configuration;
    try { configuration = parseWorkspaceConfiguration(input.configuration); }
    catch { throw badRequest("workbench_invalid", "工作台配置格式无效或版本不受支持。"); }
    const userId = request.currentUser!.id;
    try {
      return await prisma.$transaction(async tx => {
        // 锁账号行，把注销和首次创建也纳入同一序列；账号级数据不复用账本锁。
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (user.closedAt !== null || user.disabledAt !== null) throw new AppError(401, "unauthorized", "登录状态已失效。");
        const current = await tx.workbenchConfiguration.findUnique({ where: { userId } });
        if (current !== null && current.schemaVersion > WORKSPACE_SCHEMA_VERSION) throw conflict("workbench_newer", "云端配置来自更新版本，请更新应用后再保存。");
        if ((current?.version ?? 0) !== input.baseVersion) throw conflict("workbench_conflict", "其他设备已更新工作台，请选择要保留的配置。", { record: view(current) });
        const data = { schemaVersion: WORKSPACE_SCHEMA_VERSION, configuration: configuration as unknown as Prisma.InputJsonValue, updatedAt: new Date() };
        const saved = current === null
          ? await tx.workbenchConfiguration.create({ data: { userId, version: 1, ...data } })
          : await tx.workbenchConfiguration.update({ where: { userId }, data: { ...data, version: current.version + 1, previousConfiguration: current.configuration as Prisma.InputJsonValue } });
        return { record: view(saved) };
      });
    } catch (error) {
      // 保留原错误，不把冲突误报成网络成功。
      throw error;
    }
  });
}
