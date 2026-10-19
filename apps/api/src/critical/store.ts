import { randomUUID } from "node:crypto";

import type { Prisma } from "../generated/prisma/client.js";
import { canonicalJson, sha256Hex } from "./canonical.js";
import {
  severityOf,
  type CriticalEventCore,
  type CriticalEventInput,
  type CriticalEventType,
} from "./types.js";

export interface AppendedCriticalEvent {
  readonly eventId: string;
  readonly seq: number;
}

/**
 * Append one event to the local hash chain **inside the caller's transaction**.
 *
 * The chain row is locked so concurrent security writes cannot both read the same predecessor.
 * This is intentionally a global order rather than a per-account one: the safe-restore verifier
 * only has to check one chain, and the write volume is a handful of security events per day.
 *
 * ⚠️ This proves only that the event committed with the state change. It does **not** prove that
 * COS has accepted a copy; that is a later, separately visible state (`deliveryState`).
 */
export async function recordCriticalEvent(
  tx: Prisma.TransactionClient,
  input: CriticalEventInput,
): Promise<AppendedCriticalEvent> {
  /**
   * The backup checkpoint takes the matching exclusive session lock, inserts its marker and
   * exports the dump snapshot while holding it. Event writers take a transaction-scoped shared
   * lock, so an event can be in neither "before the checkpoint head but missing from the dump"
   * nor "after the checkpoint head but included in the dump".
   */
  await tx.$queryRawUnsafe(
    `SELECT pg_advisory_xact_lock_shared(hashtext('libevra_critical_backup_checkpoint'))::text AS locked`,
  );
  const chainRows = await tx.$queryRaw<{ lastSeq: number; lastHash: string | null }[]>`
    SELECT "last_seq" AS "lastSeq", "last_hash" AS "lastHash"
    FROM "critical_chain"
    WHERE "id" = 'global'
    FOR UPDATE
  `;
  const chain = chainRows[0];
  if (chain === undefined) throw new Error("critical_chain_missing");

  const eventId = randomUUID();
  const seq = Number(chain.lastSeq) + 1;
  const prevHash = chain.lastHash;
  const occurredAt = input.occurredAt ?? new Date();
  const recordedAt = new Date();
  const schemaVersion = input.schemaVersion ?? 1;
  const core: CriticalEventCore = {
    version: 1,
    eventId,
    seq,
    prevHash,
    eventType: input.type,
    schemaVersion,
    severity: severityOf(input.type),
    occurredAt: occurredAt.toISOString(),
    recordedAt: recordedAt.toISOString(),
    actorUserId: input.actor?.userId ?? null,
    actorAccountNumber: input.actor?.accountNumber ?? null,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    bookId: input.bookId ?? null,
    batchId: input.batchId ?? input.requestId ?? null,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    result: input.result ?? "success",
    resourceVersion: input.resourceVersion ?? null,
    requestId: input.requestId ?? null,
  };
  const eventHash = hashCore(core);

  const fieldLengths = {
    eventType: core.eventType.length,
    subjectType: core.subjectType.length,
    subjectId: core.subjectId?.length ?? 0,
    requestId: core.requestId?.length ?? 0,
    eventHash: eventHash.length,
    prevHash: core.prevHash?.length ?? 0,
    actorAccountNumber: core.actorAccountNumber?.length ?? 0,
    batchId: core.batchId?.length ?? 0,
    result: core.result.length,
  };
  if (
    Object.entries(fieldLengths).some(
      ([name, length]) => name !== "eventHash" && name !== "prevHash" && length > 128,
    )
  ) {
    throw new Error(`critical_event_field_too_long:${JSON.stringify(fieldLengths)}`);
  }

  await tx.criticalEvent.create({
    data: {
      eventId,
      seq,
      prevHash,
      eventHash,
      eventType: input.type,
      schemaVersion,
      severity: core.severity,
      occurredAt,
      recordedAt,
      actorUserId: core.actorUserId,
      actorAccountNumber: core.actorAccountNumber,
      subjectType: core.subjectType,
      subjectId: core.subjectId,
      bookId: core.bookId,
      batchId: core.batchId,
      ...(core.beforeState === null ? {} : { beforeState: core.beforeState as Prisma.InputJsonValue }),
      ...(core.afterState === null ? {} : { afterState: core.afterState as Prisma.InputJsonValue }),
      result: core.result,
      resourceVersion: core.resourceVersion,
      requestId: core.requestId,
      deliveryState: "pending",
    },
  });
  await tx.criticalChain.update({
    where: { id: "global" },
    data: { lastSeq: seq, lastHash: eventHash },
  });

  /**
   * Wake a PostgreSQL LISTEN-ing relay immediately. `pg_notify` is transactional: a rolled-back
   * event never produces a notification, and a committed event produces exactly one at commit.
   * Polling remains only a compensation path for a missed connection, restarting relay or lost
   * notification.
   */
  await tx.$queryRawUnsafe(
    `SELECT pg_notify('critical_events_new', $1)::text AS notified`,
    `${eventId}:${String(seq)}`,
  );

  return { eventId, seq };
}

export function hashCore(core: CriticalEventCore): string {
  return sha256Hex(`${core.prevHash ?? ""}\n${canonicalJson(core)}`);
}

export function coreFromRow(row: {
  eventId: string;
  seq: number;
  prevHash: string | null;
  eventHash: string;
  eventType: string;
  schemaVersion: number;
  severity: string;
  occurredAt: Date;
  recordedAt: Date;
  actorUserId: string | null;
  actorAccountNumber: string | null;
  subjectType: string;
  subjectId: string | null;
  bookId: string | null;
  batchId: string | null;
  beforeState: unknown;
  afterState: unknown;
  result: string;
  resourceVersion: number | null;
  requestId: string | null;
}): CriticalEventCore {
  return {
    version: 1,
    eventId: row.eventId,
    seq: row.seq,
    prevHash: row.prevHash,
    eventType: row.eventType as CriticalEventType,
    schemaVersion: row.schemaVersion,
    severity: row.severity as "P0" | "P1",
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    actorUserId: row.actorUserId,
    actorAccountNumber: row.actorAccountNumber,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    bookId: row.bookId,
    batchId: row.batchId,
    beforeState: row.beforeState,
    afterState: row.afterState,
    result: row.result,
    resourceVersion: row.resourceVersion,
    requestId: row.requestId,
  };
}
