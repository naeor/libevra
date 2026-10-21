import {
  MAX_BILL_IMPORT_BYTES,
  MAX_BILL_IMPORT_ROWS,
  billImportCommitRowSchema,
  billImportCommitSchema,
  billImportPreviewSchema,
  importReportSchema,
  validateDuplicateDetectionSettings,
  type BillImportCommitRow,
  type DuplicateDetectionSettings,
} from "@libellum/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { PrismaClient } from "../db.js";
import { PreviewCache } from "../import/cache.js";
import { createDocumentExtractor, type DocumentExtractor } from "../import/extractor.js";
import { BillImportService } from "../import/service.js";
import { BillParseError } from "../import/types.js";
import { badRequest, serviceUnavailable } from "../lib/errors.js";

export interface BillImportRouteOptions {
  readonly prisma: PrismaClient;
  readonly requireAuth: (request: FastifyRequest) => Promise<void>;
  /** 测试可以注入 stub，避免依赖本机 Python；生产不传则用真实解析器。 */
  readonly extractor?: DocumentExtractor;
}

const recheckRequestSchema = z
  .object({
    previewId: z.string().uuid(),
    rows: z.array(billImportCommitRowSchema).max(MAX_BILL_IMPORT_ROWS),
    settings: z.unknown(),
  })
  .strict();

function requireTimezone(raw: string | null): string {
  const timezone = (raw ?? "").trim();
  if (timezone === "") {
    throw badRequest("missing_timezone", "缺少时区，请重新上传文件。");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw badRequest("invalid_timezone", "时区无效，请检查设备时区设置。");
  }
  return timezone;
}

function requireSettings(raw: string | null): DuplicateDetectionSettings {
  if (raw === null) {
    throw badRequest("missing_settings", "缺少重复检测设置，请刷新页面后重试。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("invalid_settings", "重复检测设置不是有效的 JSON。");
  }
  const result = validateDuplicateDetectionSettings(parsed);
  if (!result.ok) {
    throw badRequest("invalid_settings", "重复检测设置不正确。", result.issues);
  }
  return result.settings;
}

function requireSettingsBody(value: unknown): DuplicateDetectionSettings {
  const result = validateDuplicateDetectionSettings(value);
  if (!result.ok) {
    throw badRequest("invalid_settings", "重复检测设置不正确。", result.issues);
  }
  return result.settings;
}

/**
 * 解析错误只带白名单 code；用户看到的是中文、可操作的提示。
 * Python 不可用/超时属于服务问题，不能伪装成文件错误。
 */
function translateParseError(error: unknown): never {
  if (error instanceof BillParseError) {
    if (
      error.code === "python_unavailable" ||
      error.code === "parser_unavailable" ||
      error.code === "parse_timeout"
    ) {
      throw serviceUnavailable(
        "import_parser_unavailable",
        "文档解析服务暂时不可用，请稍后再试。你的文件没有被保存。",
      );
    }
    throw badRequest(error.code, error.message);
  }
  throw error;
}

interface MultipartFile {
  readonly buffer: Buffer;
  readonly settings: string | null;
  readonly timezone: string | null;
}

async function readPreviewMultipart(request: FastifyRequest): Promise<MultipartFile> {
  let buffer: Buffer | null = null;
  let settings: string | null = null;
  let timezone: string | null = null;

  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        const uploaded = await part.toBuffer();
        if (buffer === null) buffer = uploaded;
        continue;
      }
      if (part.fieldname === "settings") settings = String(part.value);
      if (part.fieldname === "timezone") timezone = String(part.value);
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
      throw badRequest("file_too_large", "文件超过 10MB 上限，请先拆分后再导入。");
    }
    throw error;
  }

  if (buffer === null) {
    throw badRequest("no_file", "请选择要导入的账单文件。");
  }
  if (buffer.length === 0) {
    throw badRequest("empty_file", "账单文件是空的。");
  }
  if (buffer.length > MAX_BILL_IMPORT_BYTES) {
    throw badRequest("file_too_large", "文件超过 10MB 上限，请先拆分后再导入。");
  }
  return { buffer, settings, timezone };
}

/**
 * 账单导入 V2：预览 → 核对 → 提交。
 *
 * 与旧 `/api/v1/import` 并存：旧路由保持 Libevra CSV 的既有行为，新路由支持
 * 微信 XLSX / 支付宝 CSV / BOA PDF / Libevra CSV，并新增预览与判重。
 */
export function registerBillImportRoutes(
  app: FastifyInstance,
  options: BillImportRouteOptions,
): void {
  const service = new BillImportService({
    prisma: options.prisma,
    extractor: options.extractor ?? createDocumentExtractor(),
    cache: new PreviewCache(),
  });
  const requireTarget = async (request: FastifyRequest): Promise<void> => {
    const declared = request.headers["x-libellum-book"];
    if (typeof declared !== "string" || !z.string().uuid().safeParse(declared).success)
      throw badRequest("missing_target_book", "请明确选择导入的目标账本后重试。");
  };

  app.post(
    "/api/v1/import/preview",
    { preHandler: [options.requireAuth, requireTarget] },
    async (request, reply) => {
      if (!request.isMultipart()) {
        throw badRequest("expected_multipart", "请以文件上传的方式提交。");
      }

      try {
        const uploaded = await readPreviewMultipart(request);
        const preview = await service.preview({
          userId: request.currentUser!.id,
          bookId: request.book!.bookId,
          buffer: uploaded.buffer,
          settings: requireSettings(uploaded.settings),
          timezone: requireTimezone(uploaded.timezone),
        });
        return reply.send(billImportPreviewSchema.parse(preview));
      } catch (error) {
        return translateParseError(error);
      }
    },
  );

  app.post(
    "/api/v1/import/recheck",
    { preHandler: [options.requireAuth, requireTarget] },
    async (request, reply) => {
      try {
        const body = recheckRequestSchema.parse(request.body);
        const preview = await service.recheck({
          userId: request.currentUser!.id,
          bookId: request.book!.bookId,
          previewId: body.previewId,
          rows: body.rows as BillImportCommitRow[],
          settings: requireSettingsBody(body.settings),
        });
        return reply.send(billImportPreviewSchema.parse(preview));
      } catch (error) {
        return translateParseError(error);
      }
    },
  );

  app.post(
    "/api/v1/import/commit",
    { preHandler: [options.requireAuth, requireTarget] },
    async (request, reply) => {
      try {
        const body = billImportCommitSchema.parse(request.body);
        const report = await service.commit({
          userId: request.currentUser!.id,
          bookId: request.book!.bookId,
          previewId: body.previewId,
          previewRevision: body.previewRevision,
          rows: body.rows,
          acknowledgeWarnings: body.acknowledgeWarnings,
        });
        return reply.send(importReportSchema.parse(report));
      } catch (error) {
        return translateParseError(error);
      }
    },
  );
}
