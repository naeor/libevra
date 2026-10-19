import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getProtectionStatus } from "../src/critical/status.js";
import { recordCriticalEvent } from "../src/critical/store.js";
import { makeApp, prisma, resetDatabase, signUp, testCriticalRuntime } from "./support.js";

const PASSWORD = "correct-horse-battery";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createAccount(
  app: ReturnType<typeof makeApp>,
  username: string,
): Promise<{ cookie: string; userId: string; bookId: string }> {
  const cookie = await signUp(app, username);
  const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
  const userId = (me.json() as { user: { id: string } }).user.id;
  const books = await app.inject({ method: "GET", url: "/api/v1/books", headers: { cookie } });
  const bookId = (books.json() as { books: { id: string }[] }).books[0]!.id;
  return { cookie, userId, bookId };
}

describe("S13-I immediate relay wake-up and backlog recovery (local PostgreSQL)", () => {
  const dir = mkdtempSync(join(tmpdir(), "libevra-s13i-relay-"));
  let relay: ChildProcessWithoutNullStreams | null = null;
  let relayLog = "";

  async function startRelay(pollMs: number): Promise<void> {
    const test = testCriticalRuntime();
    const child = spawn(process.execPath, ["--import", "tsx", "src/scripts/critical-events-relay.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: process.env["DATABASE_URL"]!,
        CRITICAL_EVENT_REMOTE: "fs",
        CRITICAL_EVENT_REMOTE_DIR: dir,
        CRITICAL_EVENT_KEY: test.key.toString("base64"),
        CRITICAL_EVENTS_RELAY_POLL_MS: String(pollMs),
        CRITICAL_EVENTS_RELAY_RECONNECT_MS: "100",
        PGAPPNAME: "libevra_relay_latency_test",
      },
      stdio: "pipe",
    });
    child.stdout.on("data", (chunk: Buffer) => { relayLog += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { relayLog += chunk.toString(); });
    relay = child;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (relayLog.includes("listening for critical_events_new")) return;
      if (child.exitCode !== null) throw new Error(`relay exited: ${relayLog}`);
      await sleep(50);
    }
    throw new Error(`relay did not become ready: ${relayLog}`);
  }

  async function waitFor(condition: () => Promise<boolean>, timeoutMs = 8_000): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await condition()) return Date.now() - start;
      await sleep(10);
    }
    throw new Error("timeout waiting for relay acknowledgement");
  }

  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    if (relay !== null) {
      relay.kill();
      await new Promise((resolve) => relay!.once("exit", resolve));
    }
    await prisma.$disconnect().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it("wakes immediately on NOTIFY and only uses polling as compensation", async () => {
    await startRelay(10_000);
    const test = testCriticalRuntime();
    const app = makeApp({ criticalEvents: test.runtime });
    const account = await createAccount(app, "relay_latency_owner");
    // Let signup events drain; the relay is up but its polling interval is 10s.
    await waitFor(async () => (await prisma.criticalEvent.count({ where: { deliveryState: { in: ["pending", "failed"] } } })) === 0);
    const bookId = account.bookId;

    const start = Date.now();
    const deleted = await app.inject({
      method: "POST",
      url: `/api/v1/books/${bookId}/lifecycle`,
      headers: { cookie: account.cookie },
      payload: { action: "delete" },
    });
    expect(deleted.statusCode).toBe(200);
    const elapsed = await waitFor(async () =>
      (await prisma.criticalEvent.count({
        where: { eventType: "book.deleted", bookId, deliveryState: "acked" },
      })) === 1,
    );
    console.log(`S13I_RELAY_LATENCY_MS=${String(Date.now() - start)} (ack wait ${String(elapsed)}ms)`);
    // With a 10-second polling interval, an ack within a few seconds proves the NOTIFY path, not
    // the fallback timer.
    expect(Date.now() - start).toBeLessThan(5_000);
  }, 30_000);

  it("reconnects LISTEN after the listener connection is dropped", async () => {
    await waitFor(async () => (await prisma.criticalEvent.count({ where: { deliveryState: { in: ["pending", "failed"] } } })) === 0);
    const listeners = await prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
      WHERE application_name = 'libevra_relay_latency_test' AND query LIKE 'LISTEN%'
    `;
    expect(listeners.length).toBeGreaterThan(0);
    for (const row of listeners) {
      await prisma.$queryRawUnsafe("SELECT pg_terminate_backend($1)", row.pid);
    }
    await sleep(300);
    const appended = await prisma.$transaction((tx) =>
      recordCriticalEvent(tx, {
        type: "book.created",
        subjectType: "system",
        subjectId: "listen-reconnect-test",
        afterState: { reconnect: true },
      }),
    );
    await waitFor(async () => {
      const row = await prisma.criticalEvent.findUniqueOrThrow({ where: { eventId: appended.eventId } });
      return row.deliveryState === "acked";
    }, 8_000);
  }, 30_000);

  it("returns business success while relay is stopped, then drains the backlog on restart", async () => {
    if (relay !== null) {
      relay.kill();
      await new Promise((resolve) => relay!.once("exit", resolve));
      relay = null;
    }
    const test = testCriticalRuntime();
    const app = makeApp({ criticalEvents: test.runtime });
    const owner = await createAccount(app, "relay_stopped_owner");
    const userId = owner.userId;
    const closed = await app.inject({
      method: "POST",
      url: "/api/v1/account/close",
      headers: { cookie: owner.cookie },
      payload: {
        password: PASSWORD,
        confirmation: "注销账号",
        method: "close_account",
        decisions: [{ bookId: owner.bookId, action: "archive" }],
      },
    });
    // No relay at all; the business result still succeeds.
    expect(closed.statusCode).toBe(200);
    expect((closed.json() as { operationId: string }).operationId).toBeTruthy();
    expect(await prisma.criticalEvent.count({ where: { deliveryState: { in: ["pending", "failed"] } } })).toBeGreaterThan(0);
    process.env["CRITICAL_EVENTS_RELAY_STALE_SECONDS"] = "1";
    await sleep(1_100);
    const status = await getProtectionStatus(prisma, "relay");
    expect(status.alarm).toBe(true);
    delete process.env["CRITICAL_EVENTS_RELAY_STALE_SECONDS"];

    // Restarting the relay drains the backlog without any user retry.
    relayLog = "";
    await startRelay(1_000);
    const drained = await waitFor(async () =>
      (await prisma.criticalEvent.count({ where: { deliveryState: { in: ["pending", "failed"] } } })) === 0,
    15_000);
    console.log(`S13I_RELAY_BACKLOG_DRAIN_MS=${String(drained)}`);
    expect(await prisma.criticalEvent.count({ where: { actorUserId: userId, deliveryState: "acked" } })).toBeGreaterThan(0);
    const healthy = await getProtectionStatus(prisma, "relay");
    expect(healthy.alarm).toBe(false);  }, 40_000);
});
