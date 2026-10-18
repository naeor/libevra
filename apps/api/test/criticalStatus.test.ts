import { spawn } from "node:child_process";

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

  it("status CLI configures relay mode and alarms on a stale relay", async () => {
    await prisma.criticalRelayStatus.create({
      data: { id: "global", lastSeenAt: new Date(Date.now() - 120_000), consecutiveFailures: 1 },
    });
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "src/scripts/critical-events-status.ts"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "production",
          CRITICAL_EVENTS_MODE: "relay",
        },
        stdio: "pipe",
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, stdout, stderr }));
    });
    expect(result.code, result.stderr).toBe(1);
    const parsed = JSON.parse(result.stdout) as { runtime: string; alarm: boolean; alarmReasons: string[] };
    expect(parsed.runtime).toBe("relay");
    expect(parsed.alarm).toBe(true);
    expect(parsed.alarmReasons.some((reason) => reason.startsWith("relay:stale"))).toBe(true);
  }, 20_000);
});
