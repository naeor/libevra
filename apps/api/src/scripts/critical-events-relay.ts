import { Client } from "pg";

import { createPrismaClient } from "../db.js";
import { flushPendingCriticalEvents } from "../critical/runtime.js";
import { createRelayRemoteFromEnv } from "../critical/remote-config.js";

/**
 * Credential-isolated relay: reads the API's local outbox, uploads encrypted immutable objects to
 * the dedicated COS prefix, then marks the rows acknowledged. It has no HTTP listener and is not
 * required for raw backup restore.
 *
 * Trigger model:
 * - **Normal path: PostgreSQL LISTEN/NOTIFY.** `recordCriticalEvent` calls `pg_notify` in the same
 *   transaction as the event row, so the relay is woken at commit and uploads immediately.
 * - **Compensation path: low-frequency polling.** If the relay is restarting, missed a
 *   notification, or the LISTEN connection is down, the next poll catches the pending outbox.
 * - The polling interval is deliberately not the normal path.
 *
 * Usage: `pnpm --filter @libellum/api critical:relay` (loop) or `... -- --once` (one pass).
 */
const once = process.argv.includes("--once");
const prisma = createPrismaClient(process.env["DATABASE_URL"] ?? "");
const { remote, key } = createRelayRemoteFromEnv();
const databaseUrl = process.env["DATABASE_URL"] ?? "";
const pollMs = positiveInt(process.env["CRITICAL_EVENTS_RELAY_POLL_MS"], 1_000);
const reconnectMs = positiveInt(process.env["CRITICAL_EVENTS_RELAY_RECONNECT_MS"], 5_000);

async function pass(): Promise<{ uploaded: number; pending: number }> {
  return flushPendingCriticalEvents(prisma, remote, key);
}

async function heartbeat(
  result: { uploaded: number; pending: number } | null,
  error?: unknown,
): Promise<void> {
  const now = new Date();
  const lastError = error === undefined ? null : String(error).slice(0, 480);
  await prisma.criticalRelayStatus
    .upsert({
      where: { id: "global" },
      create: {
        id: "global",
        lastSeenAt: now,
        lastUploadAt: result !== null && result.uploaded > 0 ? now : null,
        consecutiveFailures: error === undefined ? 0 : 1,
        lastError,
      },
      update: {
        lastSeenAt: now,
        ...(result !== null && result.uploaded > 0 ? { lastUploadAt: now } : {}),
        ...(error !== undefined
          ? { consecutiveFailures: { increment: 1 }, lastError }
          : result === null || result.pending === 0
            ? { consecutiveFailures: 0, lastError: null }
            : {}),
      },
    })
    .catch(() => undefined);
}

if (once) {
  try {
    const result = await pass();
    await heartbeat(result);
    console.log(JSON.stringify({ ok: true, mode: "once", uploaded: result.uploaded, remote: remote.kind }));
    await prisma.$disconnect();
  } catch (error) {
    await heartbeat(null, error);
    console.error("critical-events relay failed", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  }
} else {
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  let listener: Client | null = null;
  let listenerReady = false;
  let lastReconnectAt = 0;
  let woken = false;
  let waiter: (() => void) | null = null;

  function signalWake(): void {
    woken = true;
    if (waiter !== null) {
      const resolve = waiter;
      waiter = null;
      resolve();
    }
  }

  async function waitForWake(timeoutMs: number): Promise<"notify" | "poll"> {
    if (woken) {
      woken = false;
      return "notify";
    }
    const timer = new Promise<"poll">((resolve) => {
      setTimeout(() => resolve("poll"), timeoutMs);
    });
    const notified = new Promise<"notify">((resolve) => {
      waiter = () => resolve("notify");
    });
    const reason = await Promise.race([notified, timer]);
    waiter = null;
    if (reason === "notify") woken = false;
    return reason;
  }

  async function ensureListener(): Promise<void> {
    if (listenerReady || listener !== null || Date.now() - lastReconnectAt < reconnectMs) return;
    lastReconnectAt = Date.now();
    const client = new Client({ connectionString: databaseUrl });
    client.on("notification", signalWake);
    client.on("error", (error) => {
      console.error("critical-events relay LISTEN connection error", error);
      listenerReady = false;
      if (listener === client) listener = null;
      signalWake();
      void client.end().catch(() => undefined);
    });
    client.on("end", () => {
      listenerReady = false;
      if (listener === client) listener = null;
      signalWake();
    });
    try {
      await client.connect();
      await client.query("LISTEN critical_events_new");
      listener = client;
      listenerReady = true;
      console.log("critical-events relay listening for critical_events_new");
    } catch (error) {
      console.error("critical-events relay LISTEN failed; polling compensation remains active", error);
      await client.end().catch(() => undefined);
    }
  }

  // Catch anything committed while the relay was down before entering the wait loop.
  try {
    const result = await pass();
    await heartbeat(result);
    if (result.uploaded > 0) console.log(`critical-events relay uploaded ${String(result.uploaded)} (startup)`);
  } catch (error) {
    await heartbeat(null, error);
    console.error("critical-events relay startup pass failed", error);
  }

  while (!stopping) {
    await ensureListener();
    // A lost LISTEN connection must not turn the compensation path into a full poll interval
    // delay before reconnecting. While disconnected, check/reconnect frequently; while connected,
    // fall back to the configured poll interval for missed notifications.
    const waitMs = listenerReady ? pollMs : Math.min(pollMs, Math.max(100, reconnectMs));
    const reason = await waitForWake(waitMs);
    if (stopping) break;
    try {
      const result = await pass();
      await heartbeat(result);
      if (result.uploaded > 0) console.log(`critical-events relay uploaded ${String(result.uploaded)} (${reason})`);
    } catch (error) {
      await heartbeat(null, error);
      console.error("critical-events relay pass failed", error);
      // If the DB/LISTEN connection is lost, close both and let the next iteration reconnect.
      const current = listener as Client | null;
      if (current !== null) {
        listener = null;
        listenerReady = false;
        await current.end().catch(() => undefined);
      }
    }
  }

  const remaining = listener as Client | null;
  if (remaining !== null) await remaining.end().catch(() => undefined);
  await prisma.$disconnect();
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
