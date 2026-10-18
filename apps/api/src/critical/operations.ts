import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Prisma } from "../generated/prisma/client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { AppError, serviceUnavailable } from "../lib/errors.js";

export type OperationStatus = "pending" | "committed_unconfirmed" | "confirmed" | "failed" | "manual_review";

export interface StartedOperation {
  readonly id: string;
  readonly token: string;
}

export class OperationAlreadyStartedError extends Error {
  constructor(readonly operationId: string) {
    super("operation_already_started");
    this.name = "OperationAlreadyStartedError";
  }
}

export interface PublicOperation {
  readonly id: string;
  readonly kind: string;
  readonly status: OperationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly events: { readonly total: number; readonly pending: number; readonly acked: number; readonly failed: number };
  readonly message: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function startCriticalOperation(
  prisma: PrismaClient,
  input: {
    readonly kind: string;
    readonly actorUserId: string;
    readonly subjectUserId?: string | null;
    readonly detail?: Record<string, unknown>;
    readonly idempotencyKey?: string | undefined;
  },
): Promise<StartedOperation> {
  const id = randomUUID();
  const providedKey = input.idempotencyKey?.trim();
  const idempotencyKeyHash =
    providedKey === undefined || providedKey === "" ? null : hashToken(providedKey);
  if (idempotencyKeyHash !== null) {
    const existing = await prisma.criticalOperation.findUnique({
      where: { idempotencyKeyHash },
      select: { id: true, kind: true },
    });
    if (existing !== null) {
      if (existing.kind !== input.kind) {
        throw new Error("critical_operation_idempotency_key_reused_for_other_kind");
      }
      throw new OperationAlreadyStartedError(existing.id);
    }
  }
  const token = providedKey === undefined || providedKey === "" ? randomBytes(32).toString("hex") : providedKey;
  await prisma.criticalOperation.create({
    data: {
      id,
      kind: input.kind,
      status: "pending",
      actorUserId: input.actorUserId,
      subjectUserId: input.subjectUserId ?? input.actorUserId,
      tokenHash: hashToken(token),
      idempotencyKeyHash,
      ...(input.detail === undefined ? {} : { detail: input.detail as Prisma.InputJsonValue }),
    },
  });
  return { id, token };
}

export async function markOperation(
  prisma: PrismaClient,
  id: string,
  status: OperationStatus,
  detail?: Record<string, unknown>,
): Promise<void> {
  await prisma.criticalOperation
    .update({
      where: { id },
      data: {
        status,
        ...(detail === undefined ? {} : { detail: detail as Prisma.InputJsonValue }),
      },
    })
    .catch(() => undefined);
}

/** Fetch a receipt by public token. This endpoint is intentionally usable after account closure. */
export async function getPublicOperation(
  prisma: PrismaClient,
  id: string,
  token: string,
): Promise<PublicOperation | null> {
  const row = await prisma.criticalOperation.findUnique({ where: { id } });
  if (row === null || row.tokenHash !== hashToken(token)) return null;
  const events = await prisma.criticalEvent.findMany({
    where: { batchId: id },
    select: { deliveryState: true },
  });
  const pending = events.filter((event) => event.deliveryState === "pending").length;
  const acked = events.filter((event) => event.deliveryState === "acked").length;
  const failed = events.filter((event) => event.deliveryState === "failed").length;
  // The relay may finish after the API returned 503. Derive the effective receipt state from the
  // event rows instead of leaving the operation permanently "unconfirmed".
  let status = row.status as OperationStatus;
  if (
    (status === "pending" || status === "committed_unconfirmed") &&
    events.length > 0 &&
    acked === events.length
  ) {
    status = "confirmed";
    await prisma.criticalOperation
      .update({ where: { id: row.id }, data: { status: "confirmed" } })
      .catch(() => undefined);
  } else if (failed > 0) {
    status = "manual_review";
  }
  return {
    id: row.id,
    kind: row.kind,
    status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    events: { total: events.length, pending, acked, failed },
    message: operationMessage(status),
  };
}

function operationMessage(status: OperationStatus): string {
  switch (status) {
    case "pending":
      return "操作正在处理中；数据库变更和异地确认尚未完成。";
    case "committed_unconfirmed":
      return "本地数据变更可能已经提交，但异地安全登记尚未确认；请勿在未核对前重复执行。";
    case "confirmed":
      return "操作已完成并取得异地确认。";
    case "failed":
      return "操作没有完成，或在校验前已拒绝。";
    case "manual_review":
      return "操作需要人工核验。";
  }
}

/**
 * Attach the operation receipt to a P0 success response. Extra fields are ignored by older clients;
 * the 503 path includes the same receipt so a closed-out account can still query it publicly.
 */
export function operationResponseFields(operation: StartedOperation): {
  readonly operationId: string;
  readonly operationReceipt: string;
  readonly operationStatusPath: string;
} {
  return {
    operationId: operation.id,
    operationReceipt: operation.token,
    operationStatusPath: `/api/v1/operations/${operation.id}`,
  };
}

export function unconfirmedOperationError(
  operation: StartedOperation,
  original: AppError,
): AppError {
  const details =
    original.details !== null && typeof original.details === "object"
      ? (original.details as Record<string, unknown>)
      : {};
  return serviceUnavailable(
    "critical_event_unconfirmed",
    "本地变更可能已经提交；请不要直接重复执行不可逆操作，可凭本次返回的 operationReceipt 查询状态。",
    {
      ...details,
      ...operationResponseFields(operation),
      operationCommitted: "yes_or_unknown",
      message: "本地变更可能已经提交；请勿直接重复执行不可逆操作，可凭 operationReceipt 查询状态。",
    },
  );
}
