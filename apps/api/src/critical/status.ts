import type { PrismaClient } from "../generated/prisma/client.js";
import type { CriticalRuntime } from "./runtime.js";

export interface ProtectionStatus {
  readonly generatedAt: string;
  readonly runtime: CriticalRuntime["kind"];
  readonly relay: {
    readonly state: "running" | "stale" | "never_seen";
    readonly lastSeenAt: string | null;
    readonly lastUploadAt: string | null;
    readonly consecutiveFailures: number;
    readonly lastError: string | null;
  };
  readonly chain: {
    readonly lastSeq: number;
    readonly lastHash: string | null;
    readonly localEvents: number;
    /** false means sequence 1..lastSeq is not fully present locally. */
    readonly complete: boolean;
  };
  readonly delivery: {
    readonly pending: number;
    readonly failed: number;
    readonly oldestPendingAt: string | null;
    readonly oldestPendingAgeSeconds: number | null;
    readonly lastAckedAt: string | null;
  };
  readonly thresholds: {
    readonly pending: number;
    readonly oldestPendingSeconds: number;
    readonly relayStaleSeconds: number;
    readonly consecutiveFailures: number;
  };
  readonly alarm: boolean;
  readonly alarmReasons: readonly string[];
}

/**
 * Read-only protection health. This is **not** a business health signal: pending events do not
 * make P0 operations fail. It exists so admins/monitoring can see that the backup enhancement is
 * degraded while normal service and S12-C backups continue.
 */
export async function getProtectionStatus(
  prisma: PrismaClient,
  runtimeKind: CriticalRuntime["kind"],
  now: Date = new Date(),
): Promise<ProtectionStatus> {
  const thresholds = {
    pending: intEnv("CRITICAL_EVENTS_PENDING_ALARM", 100),
    oldestPendingSeconds: intEnv("CRITICAL_EVENTS_OLDEST_PENDING_ALARM_SECONDS", 15 * 60),
    relayStaleSeconds: intEnv("CRITICAL_EVENTS_RELAY_STALE_SECONDS", 30),
    consecutiveFailures: intEnv("CRITICAL_EVENTS_FAILURE_ALARM", 5),
  };
  const [chain, relay, pending, failed, oldestPending, lastAcked, localEvents] = await Promise.all([
    prisma.criticalChain.findUnique({ where: { id: "global" } }),
    prisma.criticalRelayStatus.findUnique({ where: { id: "global" } }),
    prisma.criticalEvent.count({ where: { deliveryState: "pending" } }),
    prisma.criticalEvent.count({ where: { deliveryState: "failed" } }),
    prisma.criticalEvent.findFirst({
      where: { deliveryState: { in: ["pending", "failed"] } },
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    }),
    prisma.criticalEvent.findFirst({
      where: { deliveryState: "acked" },
      orderBy: { ackedAt: "desc" },
      select: { ackedAt: true },
    }),
    prisma.criticalEvent.count(),
  ]);
  const lastSeenAt = relay?.lastSeenAt ?? null;
  const relayState =
    lastSeenAt === null
      ? "never_seen"
      : now.getTime() - lastSeenAt.getTime() <= thresholds.relayStaleSeconds * 1000
        ? "running"
        : "stale";
  const oldestPendingAgeSeconds =
    oldestPending === null
      ? null
      : Math.max(0, Math.round((now.getTime() - oldestPending.occurredAt.getTime()) / 1000));
  const lastSeq = chain?.lastSeq ?? 0;
  const chainComplete = localEvents === lastSeq;
  const alarmReasons: string[] = [];
  if (runtimeKind === "relay" && relayState !== "running") alarmReasons.push(`relay:${relayState}`);
  if (pending > thresholds.pending) alarmReasons.push(`pending:${String(pending)}`);
  if (oldestPendingAgeSeconds !== null && oldestPendingAgeSeconds > thresholds.oldestPendingSeconds) {
    alarmReasons.push(`oldest_pending:${String(oldestPendingAgeSeconds)}s`);
  }
  if ((relay?.consecutiveFailures ?? 0) >= thresholds.consecutiveFailures) {
    alarmReasons.push(`consecutive_failures:${String(relay?.consecutiveFailures ?? 0)}`);
  }
  if (!chainComplete) alarmReasons.push("chain:sequence_gap");
  return {
    generatedAt: now.toISOString(),
    runtime: runtimeKind,
    relay: {
      state: relayState,
      lastSeenAt: lastSeenAt?.toISOString() ?? null,
      lastUploadAt: relay?.lastUploadAt?.toISOString() ?? lastAcked?.ackedAt?.toISOString() ?? null,
      consecutiveFailures: relay?.consecutiveFailures ?? 0,
      lastError: relay?.lastError ?? null,
    },
    chain: {
      lastSeq,
      lastHash: chain?.lastHash ?? null,
      localEvents,
      complete: chainComplete,
    },
    delivery: {
      pending,
      failed,
      oldestPendingAt: oldestPending?.occurredAt.toISOString() ?? null,
      oldestPendingAgeSeconds,
      lastAckedAt: lastAcked?.ackedAt?.toISOString() ?? null,
    },
    thresholds,
    alarm: alarmReasons.length > 0,
    alarmReasons,
  };
}

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
