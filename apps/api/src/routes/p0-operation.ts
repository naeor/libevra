import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "../db.js";
import {
  OperationAlreadyStartedError,
  markOperation,
  operationResponseFields,
  startCriticalOperation,
  type StartedOperation,
} from "../critical/operations.js";
import { badRequest, conflict } from "../lib/errors.js";

export function idempotencyKeyOf(request: FastifyRequest): string | undefined {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const key = value.trim();
  if (key.length < 16 || key.length > 128) {
    throw badRequest("idempotency_key_invalid", "幂等键长度必须为 16–128 个字符。");
  }
  return key;
}

export async function beginP0Operation(
  prisma: PrismaClient,
  request: FastifyRequest,
  input: {
    readonly kind: string;
    readonly actorUserId: string;
    readonly subjectUserId?: string;
    readonly detail?: Record<string, unknown>;
  },
): Promise<StartedOperation> {
  try {
    return await startCriticalOperation(prisma, {
      ...input,
      idempotencyKey: idempotencyKeyOf(request),
    });
  } catch (error) {
    if (error instanceof OperationAlreadyStartedError) {
      throw conflict("operation_already_started", "这个操作已经受理，请查询原操作结果，不要重复执行。", {
        operationId: error.operationId,
        operationStatusPath: `/api/v1/operations/${error.operationId}`,
        idempotencyKeyUsed: true,
      });
    }
    throw error;
  }
}

/**
 * Run a P0 business transaction and return the normal business success as soon as it commits.
 * The operation receipt reflects business success; remote-ledger protection is reported separately
 * via `GET /api/v1/operations/:id` and is never allowed to turn this response into a 503.
 */
export async function runP0Operation<T>(
  prisma: PrismaClient,
  request: FastifyRequest,
  input: {
    readonly kind: string;
    readonly actorUserId: string;
    readonly subjectUserId?: string;
    readonly detail?: Record<string, unknown>;
  },
  execute: (operationId: string) => Promise<T>,
): Promise<T & ReturnType<typeof operationResponseFields>> {
  const operation = await beginP0Operation(prisma, request, input);
  let result: T;
  try {
    result = await execute(operation.id);
  } catch (error) {
    await markOperation(prisma, operation.id, "failed");
    throw error;
  }
  await markOperation(prisma, operation.id, "completed");
  return { ...result, ...operationResponseFields(operation) };
}
