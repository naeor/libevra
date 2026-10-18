import type { PrismaClient } from "../generated/prisma/client.js";
import { sha256Hex } from "./canonical.js";
import { coreFromRow, hashCore } from "./store.js";
import {
  RemoteObjectExistsError,
  decryptJson,
  encryptJson,
  eventObjectKey,
  writeManifest,
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
      readonly key: Buffer;
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
  key: Buffer,
  limit = 100,
): Promise<{ uploaded: number; pending: number }> {
  const rows = await prisma.criticalEvent.findMany({
    where: { deliveryState: { in: ["pending", "failed"] } },
    orderBy: { seq: "asc" },
    take: limit,
  });
  if (rows.length === 0) return { uploaded: 0, pending: 0 };

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
      await prisma.criticalEvent
        .update({
          where: { eventId: currentEventId },
          data: { deliveryState: "failed", attempts: { increment: 1 }, lastError: message },
        })
        .catch(() => undefined);
    }
    throw error;
  }

  if (uploaded.length > 0) {
    await writeManifest(remote, key, uploaded);
  }

  const now = new Date();
  await prisma.criticalEvent.updateMany({
    where: { eventId: { in: uploaded.map((event) => event.eventId) } },
    data: { deliveryState: "acked", ackedAt: now },
  });

  const pending = await prisma.criticalEvent.count({
    where: { deliveryState: { in: ["pending", "failed"] } },
  });
  return { uploaded: uploaded.length, pending };
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
 * Called by P0 routes before their final success response.
 *
 * Inline mode (tests/dev) performs the upload here. Relay mode only waits for the separate,
 * credential-isolated relay to acknowledge rows. Neither mode can turn an unknown remote state
 * into a success.
 */
export async function confirmCriticalEvents(prisma: PrismaClient): Promise<void> {
  try {
    if (runtime.kind === "disabled") {
      throw new CriticalEventPersistenceError("critical_event_remote_not_configured");
    }
    if (runtime.kind === "inline") {
      await flushPendingCriticalEvents(prisma, runtime.remote, runtime.key);
      return;
    }
    await waitForRelayAcks(prisma, runtime.timeoutMs);
  } catch (error) {
    if (error instanceof CriticalEventPersistenceError) throw error;
    throw new CriticalEventPersistenceError("critical_event_remote_unconfirmed", error);
  }
}
