import { importJobRequestSchema, importJobStatusSchema, formalSourceDispositionSchema } from "@libellum/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { PrismaClient } from "../db.js";
import {
  cancelImportJob,
  confirmImportJob,
  createImportJob,
  getImportJob,
  prepareImportJobWorker,
  refreshImportJobActivity,
  resumeImportJob,
  undoImportJob,
} from "../ledger/importJob.js";
import { forbidden } from "../lib/errors.js";
import { getFormalSourceDisposition } from "../ledger/importCleanup.js";

export interface LedgerImportJobRouteOptions {
  readonly prisma: PrismaClient;
  readonly requireAuth: (request: FastifyRequest) => Promise<void>;
}

/**
 * S14-D D5 分批导入任务。
 *
 * 创建任务只持久化“用户已确认的完整计划”，真正的写入由后台逐批事务执行；查询进度
 * 永远读服务端已提交状态，不依赖前端动画。页面关掉、进程重启后仍可通过同一个 job id 恢复。
 */
export function registerLedgerImportJobRoutes(
  app: FastifyInstance,
  options: LedgerImportJobRouteOptions,
): void {
  /**
   * 恢复中断任务和定期清扫。只在 app ready 后启动，测试/多实例时进程退出由 onClose 清理。
   */
  let stopWorker: (() => void) | null = null;
  app.addHook("onReady", async () => {
    stopWorker = prepareImportJobWorker(options.prisma);
  });
  app.addHook("onClose", async () => {
    stopWorker?.();
    stopWorker = null;
  });

  app.post(
    "/api/v1/ledger-imports/jobs",
    { preHandler: options.requireAuth, bodyLimit: 20 * 1024 * 1024 },
    async (request, reply) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const body = importJobRequestSchema.parse(request.body ?? {});
      const job = await createImportJob(options.prisma, userId, body);
      void reply.code(202);
      return importJobStatusSchema.parse(job);
    },
  );

  app.get(
    "/api/v1/ledger-imports/jobs/:jobId",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const { jobId } = request.params as { jobId: string };
      return importJobStatusSchema.parse(await getImportJob(options.prisma, userId, jobId));
    },
  );

  app.post(
    "/api/v1/ledger-imports/jobs/:jobId/resume",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const { jobId } = request.params as { jobId: string };
      return importJobStatusSchema.parse(await resumeImportJob(options.prisma, userId, jobId));
    },
  );

  app.post(
    "/api/v1/ledger-imports/jobs/:jobId/cancel",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const { jobId } = request.params as { jobId: string };
      return importJobStatusSchema.parse(await cancelImportJob(options.prisma, userId, jobId));
    },
  );

  app.post(
    "/api/v1/ledger-imports/jobs/:jobId/confirm",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const { jobId } = request.params as { jobId: string };
      return importJobStatusSchema.parse(await confirmImportJob(options.prisma, userId, jobId));
    },
  );

  app.post(
    "/api/v1/ledger-imports/jobs/:jobId/undo",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const { jobId } = request.params as { jobId: string };
      return importJobStatusSchema.parse(await undoImportJob(options.prisma, userId, jobId));
    },
  );

  app.post(
    "/api/v1/ledger-imports/jobs/:jobId/activity",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const { jobId } = request.params as { jobId: string };
      return importJobStatusSchema.parse(await refreshImportJobActivity(options.prisma, userId, jobId));
    },
  );

  app.get(
    "/api/v1/ledger-imports/jobs/:jobId/source-disposition",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const { jobId } = request.params as { jobId: string };
      return formalSourceDispositionSchema.parse(
        await getFormalSourceDisposition(options.prisma, userId, jobId),
      );
    },
  );
}
