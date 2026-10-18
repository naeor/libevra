import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applySafeRestore } from "../src/critical/apply.js";
import { flushPendingCriticalEvents } from "../src/critical/runtime.js";
import { verifyRemoteLedger } from "../src/critical/remote.js";
import { createPrismaClient } from "../src/db.js";
import { makeApp, prisma, resetDatabase, signUp, testCriticalRuntime } from "./support.js";

const PASSWORD = "correct-horse-battery";
const PG_BIN = process.env["S13I_PG_BIN"] ?? "C:\\Program Files\\PostgreSQL\\17\\bin";
const pgDump = join(PG_BIN, "pg_dump.exe");
const pgRestore = join(PG_BIN, "pg_restore.exe");
const createDb = join(PG_BIN, "createdb.exe");
const dropDb = join(PG_BIN, "dropdb.exe");
const available = [pgDump, pgRestore, createDb, dropDb].every((path) => existsSync(path));

function dbParts(): { url: URL; host: string; port: string; user: string; password: string; name: string } {
  const url = new URL(process.env["DATABASE_URL"]!);
  return {
    url,
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    name: url.pathname.replace(/^\//, ""),
  };
}

function cli(command: string, args: string[]): void {
  const parts = dbParts();
  execFileSync(command, args, {
    env: { ...process.env, PGPASSWORD: parts.password },
    stdio: "pipe",
    windowsHide: true,
  });
}

describe.skipIf(!available)("S13-I full dump/restore safety (local PostgreSQL)", () => {
  const parts = dbParts();
  // Keep this out of both the test and development database names.
  const restoreName = `ledger_test_restore_${process.pid}`;
  const restoreUrl = new URL(parts.url.toString());
  restoreUrl.pathname = `/${restoreName}`;
  const dir = mkdtempSync(join(tmpdir(), "libevra-s13i-restore-"));
  const dumpFile = join(dir, "old.dump");
  let restored: ReturnType<typeof createPrismaClient> | null = null;

  beforeAll(async () => {
    await resetDatabase();
    cli(createDb, ["-h", parts.host, "-p", parts.port, "-U", parts.user, restoreName]);
  });

  afterAll(async () => {
    await restored?.$disconnect();
    try {
      cli(dropDb, ["-h", parts.host, "-p", parts.port, "-U", parts.user, "--if-exists", restoreName]);
    } catch {
      // A failed test may already have dropped it; do not hide the assertion above.
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("restores an old full dump, then safely reapplies delete + close from remote events", async () => {
    const test = testCriticalRuntime();
    const app = makeApp({ criticalEvents: test.runtime });
    try {
      const cookie = await signUp(app, "full_restore_owner");
      const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
      const userId = (me.json() as { user: { id: string } }).user.id;
      const books = await app.inject({ method: "GET", url: "/api/v1/books", headers: { cookie } });
      const bookId = (books.json() as { books: { id: string }[] }).books[0]!.id;

      // This is the old full-database snapshot, taken before the destructive operations.
      cli(pgDump, [
        "-h", parts.host, "-p", parts.port, "-U", parts.user,
        "-d", parts.name, "-Fc", "--file", dumpFile,
      ]);
      const backupAt = new Date();

      const deleted = await app.inject({
        method: "POST",
        url: `/api/v1/books/${bookId}/lifecycle`,
        headers: { cookie },
        payload: { action: "delete" },
      });
      expect(deleted.statusCode).toBe(200);
      const closed = await app.inject({
        method: "POST",
        url: "/api/v1/account/close",
        headers: { cookie },
        payload: {
          password: PASSWORD,
          confirmation: "注销账号",
          method: "close_account",
          decisions: [],
        },
      });
      expect(closed.statusCode).toBe(200);
      await flushPendingCriticalEvents(prisma, test.remote, test.key);
      const verified = await verifyRemoteLedger(test.remote, test.key);

      cli(pgRestore, [
        "-h", parts.host, "-p", parts.port, "-U", parts.user,
        "-d", restoreName, "--exit-on-error", dumpFile,
      ]);
      restored = createPrismaClient(restoreUrl.toString());
      // The raw restored snapshot still contains both objects; that is exactly the danger.
      expect(await restored.book.findUnique({ where: { id: bookId } })).not.toBeNull();
      const report = await applySafeRestore(
        restored,
        verified.events.map((entry) => entry.core),
        backupAt,
      );
      expect(report.manualReview.length).toBe(0);
      expect(await restored.book.findUnique({ where: { id: bookId } })).toBeNull();
      const user = await restored.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.closedAt).not.toBeNull();
      expect(await restored.session.count({ where: { userId } })).toBe(0);
      const chain = await restored.criticalChain.findUniqueOrThrow({ where: { id: "global" } });
      expect(chain.lastSeq).toBe(verified.lastSeq);
      expect(chain.lastHash).toBe(verified.lastHash);
    } finally {
      await app.close();
    }
  }, 120_000);
});
