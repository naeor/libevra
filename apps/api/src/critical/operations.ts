import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Prisma } from "../generated/prisma/client.js";
import type { PrismaClient } from "../generated/prisma/client.js";

/**
 * The operation receipt deliberately has two independent states:
 * - business: did the committed business operation succeed?
 * - protection: has the independent event ledger been uploaded/confirmed?
 *
 * A user-visible success is based on `business`, never on `protection`.
 */
export type OperationStatus = "pending" | "completed" | "failed";

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
  readonly businessStatus: OperationStatus;
  readonly protection: {
    readonly state: "pending" | "partial" | "protected" | "failed";
    readonly total: number;
    readonly pending: number;
    readonly acked: number;
    readonly failed: number;
    readonly oldestPendingAt: string | null;
    readonly lastAckedAt: string | null;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly receiptExpiresAt: string | null;
  /** Kept for old clients; identical to protection counts. */
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
  const ttlMs = intEnv("CRITICAL_OPERATION_RECEIPT_TTL_MS", 24 * 60 * 60 * 1000);
  await prisma.criticalOperation.create({
    data: {
      id,
      kind: input.kind,
      status: "pending",
      actorUserId: input.actorUserId,
      subjectUserId: input.subjectUserId ?? input.actorUserId,
      tokenHash: hashToken(token),
      idempotencyKeyHash,
      receiptExpiresAt: new Date(Date.now() + ttlMs),
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
  if (row.receiptExpiresAt.getTime() <= Date.now()) return null;
  const events = await prisma.criticalEvent.findMany({
    where: { batchId: id },
    select: { deliveryState: true, occurredAt: true, ackedAt: true },
  });
  const pending = events.filter((event) => event.deliveryState === "pending").length;
  const acked = events.filter((event) => event.deliveryState === "acked").length;
  const failed = events.filter((event) => event.deliveryState === "failed").length;
  const oldestPending = events
    .filter((event) => event.deliveryState !== "acked")
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())[0];
  const lastAcked = events
    .filter((event) => event.ackedAt !== null)
    .sort((left, right) => right.ackedAt!.getTime() - left.ackedAt!.getTime())[0];
  const protectionState =
    events.length === 0
      ? "pending"
      : acked === events.length
        ? "protected"
        : failed > 0
          ? "failed"
          : acked > 0
            ? "partial"
            : "pending";
  const rawStatus = row.status as string;
  const businessStatus: OperationStatus =
    rawStatus === "committed_unconfirmed" || rawStatus === "confirmed"
      ? "completed"
      : rawStatus === "manual_review"
        ? "completed"
        : (rawStatus as OperationStatus);
  return {
    id: row.id,
    kind: row.kind,
    status: businessStatus,
    businessStatus,
    protection: {
      state: protectionState,
      total: events.length,
      pending,
      acked,
      failed,
      oldestPendingAt: oldestPending?.occurredAt.toISOString() ?? null,
      lastAckedAt: lastAcked?.ackedAt?.toISOString() ?? null,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    receiptExpiresAt: row.receiptExpiresAt.toISOString(),
    events: { total: events.length, pending, acked, failed },
    message: operationMessage(businessStatus, protectionState),
  };
}

function operationMessage(
  status: OperationStatus,
  protection: "pending" | "partial" | "protected" | "failed",
): string {
  switch (status) {
    case "pending":
      return "业务操作正在处理中。";
    case "failed":
      return "业务操作没有完成，或在校验前已拒绝。";
    case "completed":
      if (protection === "protected") return "业务操作已完成，异地事件已确认保存。";
      if (protection === "failed") return "业务操作已完成；异地事件暂未保存，系统会自动重试。";
      return "业务操作已完成；异地事件正在后台上传，这不影响业务结果。";
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

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
