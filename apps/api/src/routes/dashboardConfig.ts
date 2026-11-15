/**
 * 电脑版总览的跨设备配置（1.19.104）：`GET / POST /api/v1/dashboard-config`。
 *
 * - 账号级：只读写当前登录账号自己的一行；请求里不接受 userId / bookId，也不读取任何账本数据。
 * - 版本保护（与分析工作台同一套）：提交带 `baseVersion`，与库里版本不同就 409，并把云端那份带回去让客户端处理。
 * - 校验：`@libellum/shared/dashboard/configuration`（复杂度上限、strict 形状、布局管线、几何）。
 * - 写入计入账号空间（与工作台配置一样，超出上限 413）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { DASHBOARD_MAX_BYTES, DASHBOARD_SCHEMA_VERSION, parseDashboardConfiguration } from "@libellum/shared/dashboard/configuration";

import type { PrismaClient } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { accountStorage, lockAccountStorage } from "../ledger/storage.js";
import { AppError, badRequest, conflict } from "../lib/errors.js";

export function registerDashboardConfigRoutes(app: FastifyInstance, { prisma, requireAuth }: {
  readonly prisma: PrismaClient; readonly requireAuth: (request: FastifyRequest) => Promise<void>;
}): void {
  const view = (record: { version: number; schemaVersion: number; updatedAt: Date; configuration: unknown } | null) => record === null ? null : ({
    version: record.version, schemaVersion: record.schemaVersion, updatedAt: record.updatedAt.toISOString(), configuration: record.configuration,
  });

  app.get("/api/v1/dashboard-config", { preHandler: requireAuth }, async (request) => {
    return { record: view(await prisma.dashboardConfiguration.findUnique({ where: { userId: request.currentUser!.id } })) };
  });

  app.post("/api/v1/dashboard-config", { preHandler: requireAuth, bodyLimit: DASHBOARD_MAX_BYTES + 1024, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const input = z.strictObject({ baseVersion: z.number().int().min(0).max(2147483646), configuration: z.unknown() }).parse(request.body);
    let configuration;
    try { configuration = parseDashboardConfiguration(input.configuration); }
    catch { throw badRequest("dashboard_config_invalid", "总览配置格式无效或版本不受支持。"); }
    const userId = request.currentUser!.id;
    return prisma.$transaction(async (tx) => {
      await lockAccountStorage(tx, userId);
      const beforeUsage = await accountStorage(tx, userId);
      // 锁账号行：注销与首次创建在同一序列里，注销后的会话不能再写。
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.closedAt !== null || user.disabledAt !== null) throw new AppError(401, "unauthorized", "登录状态已失效。");
      const current = await tx.dashboardConfiguration.findUnique({ where: { userId } });
      if (current !== null && current.schemaVersion > DASHBOARD_SCHEMA_VERSION) throw conflict("dashboard_config_newer", "云端的总览配置来自更新的版本，请更新应用后再保存。");
      if ((current?.version ?? 0) !== input.baseVersion) throw conflict("dashboard_config_conflict", "另一台设备已经更新了总览。", { record: view(current) });
      const data = { schemaVersion: DASHBOARD_SCHEMA_VERSION, configuration: configuration as unknown as Prisma.InputJsonValue, updatedAt: new Date() };
      const saved = current === null
        ? await tx.dashboardConfiguration.create({ data: { userId, version: 1, ...data } })
        : await tx.dashboardConfiguration.update({ where: { userId }, data: { ...data, version: current.version + 1, previousConfiguration: current.configuration as Prisma.InputJsonValue } });
      const afterUsage = await accountStorage(tx, userId);
      if (afterUsage.bytes > beforeUsage.bytes && afterUsage.bytes > afterUsage.limit) throw new AppError(413, "account_storage_full", "账户空间不足。");
      return { record: view(saved) };
    });
  });
}
