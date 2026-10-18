import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getProtectionStatus } from "../src/critical/status.js";
import { recordCriticalEvent } from "../src/critical/store.js";
import { prisma, resetDatabase } from "./support.js";

describe("S13-I protection health thresholds", () => {
  beforeEach(async () => {
    await resetDatabase();
    delete process.env["CRITICAL_EVENTS_PENDING_ALARM"];
    delete process.env["CRITICAL_EVENTS_OLDEST_PENDING_ALARM_SECONDS"];
    delete process.env["CRITICAL_EVENTS_RELAY_STALE_SECONDS"];
    delete process.env["CRITICAL_EVENTS_FAILURE_ALARM"];
  });

  afterEach(async () => {
    await prisma.criticalRelayStatus.deleteMany();
  });

  it("does not alarm on one transient failure while the relay is live and backlog is small", async () => {
    await prisma.criticalRelayStatus.create({
      data: {
        id: "global",
        lastSeenAt: new Date(),
        consecutiveFailures: 1,
        lastError: "transient 503",
      },
    });
    const status = await getProtectionStatus(prisma, "relay");
    expect(status.relay.state).toBe("running");
    expect(status.delivery.pending).toBe(0);
    expect(status.alarm).toBe(false);
  });

  it("alarms on stale relay, old backlog, or repeated failures", async () => {
    await prisma.criticalRelayStatus.create({
      data: {
        id: "global",
        lastSeenAt: new Date(Date.now() - 120_000),
        consecutiveFailures: 5,
        lastError: "COS 503",
      },
    });
    await prisma.$transaction((tx) =>
      recordCriticalEvent(tx, {
        type: "book.created",
        subjectType: "system",
        subjectId: "stale-backlog",
        occurredAt: new Date(Date.now() - 20 * 60 * 1000),
        afterState: { test: true },
      }),
    );
    const status = await getProtectionStatus(prisma, "relay");
    expect(status.alarm).toBe(true);
    expect(status.alarmReasons.join(",")).toContain("relay:stale");
    expect(status.alarmReasons.join(",")).toContain("oldest_pending");
    expect(status.alarmReasons.join(",")).toContain("consecutive_failures");
  });
});
