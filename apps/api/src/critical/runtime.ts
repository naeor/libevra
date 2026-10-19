import type { PrismaClient } from "../generated/prisma/client.js";
import { sha256Hex } from "./canonical.js";
import { coreFromRow, hashCore } from "./store.js";
import {
  RemoteObjectExistsError,
  decryptJson,
  encryptJson,
  eventObjectKey,
  writeManifest,
  type CriticalKey,
  type CriticalRemote,
} from "./remote.js";
import type { CriticalEventCore } from "./types.js";

export class CriticalEventPersistenceError extends Error {
  readonly detail: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = "CriticalEventPersistenceError";
    this.detail = detail;
  }
}

export type CriticalRuntime =
  | {
      readonly kind: "inline";
      readonly remote: CriticalRemote;
      readonly key: CriticalKey;
    }
  | {
      readonly kind: "relay";
      readonly timeoutMs: number;
    }
  | { readonly kind: "disabled" };

let runtime: CriticalRuntime = { kind: "disabled" };

export function configureCriticalEvents(next: CriticalRuntime): void {
  runtime = next;
}

export function getCriticalRuntime(): CriticalRuntime {
  return runtime;
}

/**
 * The local outbox worker body. It is safe to run from the relay sidecar or from a test.
 *
 * Invariant: an event is marked `acked` only after its immutable object and the manifest that
 * proves the chain head have both been accepted. A crash after the PUT but before the DB update is
 * recovered on the next pass by re-reading the existing object and verifying its plaintext hash.
 */
export async function flushPendingCriticalEvents(
  prisma: PrismaClient,
  remote: CriticalRemote,
  key: CriticalKey,
  limit = 100,
): Promise<{ uploaded: number; pending: number; nextAttemptAt: string | null }> {
  /**
   * Preserve chain order: if the oldest pending/failed event is waiting for its retry time, do not
   * upload a later event. Uploading seq N+1 before N would make the remote chain unverifiable.
   */
  const first = await prisma.criticalEvent.findFirst({
    where: { deliveryState: { in: ["pending", "failed"] } },
    orderBy: { seq: "asc" },
    select: { seq: true, nextAttemptAt: true },
  });
  if (first === null) return { uploaded: 0, pending: 0, nextAttemptAt: null };
  if (first.nextAttemptAt !== null && first.nextAttemptAt.getTime() > Date.now()) {
    return {
      uploaded: 0,
      pending: await prisma.criticalEvent.count({
        where: { deliveryState: { in: ["pending", "failed"] } },
      }),
      nextAttemptAt: first.nextAttemptAt.toISOString(),
    };
  }
  const rows = await prisma.criticalEvent.findMany({
    where: { deliveryState: { in: ["pending", "failed"] }, seq: { gte: first.seq } },
    orderBy: { seq: "asc" },
    take: limit,
  });
  if (rows.length === 0) return { uploaded: 0, pending: 0, nextAttemptAt: null };

  const uploaded: CriticalEventCore[] = [];
  let currentEventId: string | null = null;
  try {
    for (const row of rows) {
      currentEventId = row.eventId;
      const core = coreFromRow(row);
      if (hashCore(core) !== row.eventHash) {
        await prisma.criticalEvent.update({
          where: { eventId: row.eventId },
          data: {
            deliveryState: "failed",
            attempts: { increment: 1 },
            lastError: "local_hash_mismatch",
          },
        });
        throw new CriticalEventPersistenceError(`critical_event_local_hash_mismatch:${row.eventId}`);
      }
      const keyName = eventObjectKey(core.seq, core.eventId);
      let etag: string;
      try {
        const result = await remote.putIfAbsent(keyName, encryptJson(core, key), {
          "event-id": core.eventId,
          "event-hash": hashCore(core),
          "schema-version": String(core.schemaVersion),
        });
        etag = result.etag;
      } catch (error) {
        if (!(error instanceof RemoteObjectExistsError)) throw error;
        const head = remote.head === undefined ? null : await remote.head(keyName);
        if (head !== null) {
          if (head.metadata["event-hash"] !== hashCore(core)) {
            throw new CriticalEventPersistenceError(`critical_event_object_collision:${row.eventId}`);
          }
          etag = head.etag;
        } else {
          const existing = await remote.get(keyName);
          if (existing === null) throw new CriticalEventPersistenceError("critical_event_object_missing", error);
          const decoded = decryptJson(existing, key) as CriticalEventCore;
          if (hashCore(decoded) !== hashCore(core)) {
            throw new CriticalEventPersistenceError(`critical_event_object_collision:${row.eventId}`);
          }
          etag = sha256Hex(existing);
        }
      }

      await prisma.criticalEvent.update({
        where: { eventId: row.eventId },
        data: {
          remoteKey: keyName,
          remoteEtag: etag,
          uploadedAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });
      uploaded.push(core);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 480) : String(error).slice(0, 480);
    if (currentEventId !== null) {
      const current = await prisma.criticalEvent.findUnique({
        where: { eventId: currentEventId },
        select: { attempts: true, seq: true },
      });
      if (current !== null) {
        const attempts = current.attempts + 1;
        const nextAttemptAt = new Date(Date.now() + retryDelayMs(attempts));
        await prisma.criticalEvent
          .update({
            where: { eventId: currentEventId },
            data: {
              deliveryState: "failed",
              attempts: { increment: 1 },
              lastError: message,
              lastAttemptAt: new Date(),
              nextAttemptAt,
            },
          })
          .catch(() => undefined);
        // Keep the error attached for the relay log, but this is a protection-layer failure, not a
        // business failure. No API request is waiting for it.
        throw Object.assign(error instanceof Error ? error : new Error(message), {
          criticalNextAttemptAt: nextAttemptAt.toISOString(),
          criticalSeq: current.seq,
        });
      }
    }
    throw error;
  }

  if (uploaded.length > 0) {
    await writeManifest(remote, key, uploaded);
  }

  const now = new Date();
  await prisma.criticalEvent.updateMany({
    where: { eventId: { in: uploaded.map((event) => event.eventId) } },
    data: {
      deliveryState: "acked",
      ackedAt: now,
      nextAttemptAt: null,
      lastAttemptAt: now,
    },
  });

  const pending = await prisma.criticalEvent.count({
    where: { deliveryState: { in: ["pending", "failed"] } },
  });
  return { uploaded: uploaded.length, pending, nextAttemptAt: null };
}

/** Exponential retry for the protection layer: 1s, 2s, 4s … capped at 5 minutes. */
export function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(attempts - 1, 8));
  return Math.min(1_000 * 2 ** exponent, 5 * 60 * 1000);
}

export async function waitForRelayAcks(
  prisma: PrismaClient,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pending = await prisma.criticalEvent.count({
      where: { deliveryState: { in: ["pending", "failed"] } },
    });
    if (pending === 0) return;
    if (Date.now() >= deadline) {
      throw new CriticalEventPersistenceError(`critical_event_remote_ack_timeout:${pending}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * @deprecated Business success no longer waits for the remote ledger. Kept as a no-op for old CLI
 * scripts; they should print the business result and let the relay retry asynchronously. Do not
 * reintroduce waitForRelayAcks in request paths.
 */
export async function confirmCriticalEvents(_prisma: PrismaClient): Promise<void> {
  // Intentionally does not upload, block, or throw.
}
