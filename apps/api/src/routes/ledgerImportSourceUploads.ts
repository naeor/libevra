import {
  MAX_SOURCE_UPLOAD_PART_TRANSACTIONS,
  MAX_STAGED_IMPORT_TRANSACTIONS,
  sourceUploadCreateRequestSchema,
  sourceUploadPartRequestSchema,
  sourceUploadStatusSchema,
} from "@libellum/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { PrismaClient } from "../db.js";
import {
  completeSourceUpload,
  createSourceUpload,
  putSourceUploadPart,
  sweepExpiredSourceUploads,
} from "../ledger/importSourceUpload.js";
import { forbidden } from "../lib/errors.js";

export interface LedgerImportSourceUploadRouteOptions {
  readonly prisma: PrismaClient;
  readonly requireAuth: (request: FastifyRequest) => Promise<void>;
}

/** 每段最多 2000 笔；单笔最长约 2.5 KB（500 字备注 + 10 个标签），留出余量。 */
const PART_BODY_LIMIT = MAX_SOURCE_UPLOAD_PART_TRANSACTIONS * 4 * 1024;
const SWEEP_INTERVAL_MS = 10 * 60_000;

const params = z.object({ uploadId: z.string().uuid() });
const partParams = z.object({
  uploadId: z.string().uuid(),
  position: z.coerce.number().int().min(0).max(MAX_STAGED_IMPORT_TRANSACTIONS),
});

/**
 * 1.19.97 · 游客来源分段上传（见 `ledger/importSourceUpload.ts`）。
 *
 * 只接收本人的游客来源；暂存不改动任何账本，真正的导入仍走可撤销的分批任务。
 */
export function registerLedgerImportSourceUploadRoutes(
  app: FastifyInstance,
  options: LedgerImportSourceUploadRouteOptions,
): void {
  const timer = setInterval(() => {
    void sweepExpiredSourceUploads(options.prisma).catch((error: unknown) => {
      app.log.warn({ err: error }, "ledger import source upload sweep failed");
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));

  function userOf(request: FastifyRequest): string {
    const userId = request.currentUser?.id;
    if (userId === undefined) throw forbidden("auth_required", "请先登录。");
    return userId;
  }

  app.post(
    "/api/v1/ledger-imports/source-uploads",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = userOf(request);
      const body = sourceUploadCreateRequestSchema.parse(request.body ?? {});
      return sourceUploadStatusSchema.parse(await createSourceUpload(options.prisma, userId, body));
    },
  );

  // 同一段可以重复提交（内容相同即视为成功），语义上是幂等的“放入第 N 段”；用 POST 是因为浏览器的请求封装只有 GET/POST/PATCH/DELETE。
  app.post(
    "/api/v1/ledger-imports/source-uploads/:uploadId/parts/:position",
    {
      preHandler: options.requireAuth,
      bodyLimit: PART_BODY_LIMIT,
      // 2 万笔按 1000 笔一段是 20 段；放宽到每分钟 240 次，重试与多本账连续迁移也不会撞上全局 100 次。
      config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
    },
    async (request) => {
      const userId = userOf(request);
      const { uploadId, position } = partParams.parse(request.params);
      const body = sourceUploadPartRequestSchema.parse(request.body ?? {});
      return sourceUploadStatusSchema.parse(
        await putSourceUploadPart(options.prisma, userId, uploadId, position, body.transactions),
      );
    },
  );

  app.post(
    "/api/v1/ledger-imports/source-uploads/:uploadId/complete",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = userOf(request);
      const { uploadId } = params.parse(request.params);
      return sourceUploadStatusSchema.parse(await completeSourceUpload(options.prisma, userId, uploadId));
    },
  );
}
