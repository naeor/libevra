import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../src/db.js";
import { makeApp, prisma, resetDatabase, signUp, testCriticalRuntime } from "./support.js";

const PASSWORD = "correct-horse-battery";
const PG_BIN = process.env["S13I_PG_BIN"] ?? "C:\\Program Files\\PostgreSQL\\17\\bin";
const pgRestore = join(PG_BIN, "pg_restore.exe");
const createDb = join(PG_BIN, "createdb.exe");
const dropDb = join(PG_BIN, "dropdb.exe");
const psql = join(PG_BIN, "psql.exe");
const realPgDump = join(PG_BIN, "pg_dump.exe");
const bash = process.env["S13I_BASH"] ?? "C:\\Program Files\\Git\\bin\\bash.exe";
const available = [pgRestore, createDb, dropDb, psql, realPgDump, bash].every((path) => existsSync(path));

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

describe.skipIf(!available)("S13-I critical-events-backup.sh (isolated local PostgreSQL)", () => {
  const parts = dbParts();
  const restoreName = `ledger_test_shell_restore_${process.pid}`;
  const restoreUrl = new URL(parts.url.toString());
  restoreUrl.pathname = `/${restoreName}`;
  const dir = mkdtempSync(join(tmpdir(), "libevra-s13i-shell-"));
  const outDir = join(dir, "out");
  const pgDumpWrapper = join(dir, "pg_dump_slow.sh");
  const pgDumpStarted = join(dir, "pg_dump_started.marker");
  const envFile = join(dir, "backup.env");
  let restored: ReturnType<typeof createPrismaClient> | null = null;

  beforeAll(async () => {
    await resetDatabase();
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      pgDumpWrapper,
      `#!/usr/bin/env bash\nset -e\ntouch "$S13I_PG_DUMP_STARTED"\nsleep 1\nexec "$S13I_REAL_PG_DUMP" "$@"\n`,
      "utf8",
    );
    chmodSync(pgDumpWrapper, 0o755);
    writeFileSync(
      envFile,
      [
        `POSTGRES_USER='${parts.user}'`,
        `POSTGRES_PASSWORD='${parts.password}'`,
        `POSTGRES_DB='${parts.name}'`,
        `CRITICAL_BACKUP_MODE=local`,
        `PSQL_BIN='${psql}'`,
        `PG_DUMP_BIN='${pgDumpWrapper}'`,
        `PGHOST='${parts.host}'`,
        `PGPORT='${parts.port}'`,
        `CRITICAL_BACKUP_DIR='${outDir}'`,
      ].join("\n"),
      "utf8",
    );
    cli(createDb, ["-h", parts.host, "-p", parts.port, "-U", parts.user, restoreName]);
  });

  afterAll(async () => {
    await restored?.$disconnect();
    try {
      cli(dropDb, ["-h", parts.host, "-p", parts.port, "-U", parts.user, "--if-exists", restoreName]);
    } catch {
      // ignore cleanup failure; assertion results are already recorded
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs the real shell script, snapshots during a delete, and restores its checkpoint", async () => {
    const test = testCriticalRuntime();
    const app = makeApp({ criticalEvents: test.runtime });
    try {
      const cookie = await signUp(app, "shell_backup_owner");
      const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
      const userId = (me.json() as { user: { id: string } }).user.id;
      const books = await app.inject({ method: "GET", url: "/api/v1/books", headers: { cookie } });
      const bookId = (books.json() as { books: { id: string }[] }).books[0]!.id;

      const child = spawn(bash, ["critical-events-backup.sh", "shell-test"], {
        cwd: join(process.cwd(), "..", "..", "deploy"),
        env: {
          ...process.env,
          CRITICAL_BACKUP_ENV_FILE: envFile,
          S13I_REAL_PG_DUMP: realPgDump,
          S13I_PG_DUMP_STARTED: pgDumpStarted,
        },
        stdio: "pipe",
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      // Wait until the exported snapshot is fixed and pg_dump has started, then commit a deletion
      // while the dump is deliberately sleeping. This guarantees the deletion is post-checkpoint.
      for (let attempt = 0; attempt < 200 && !existsSync(pgDumpStarted); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(existsSync(pgDumpStarted), stderr).toBe(true);
      const deleted = await app.inject({
        method: "POST",
        url: `/api/v1/books/${bookId}/lifecycle`,
        headers: { cookie },
        payload: { action: "delete" },
      });
      expect(deleted.statusCode).toBe(200);
      const exitCode = await Promise.race([
        new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1))),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            child.kill();
            reject(new Error(`backup script timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
          }, 20_000),
        ),
      ]);
      expect(exitCode, stderr).toBe(0);

      const dumpName = readdirSync(outDir).find((name) => name.endsWith(".dump"));
      expect(dumpName, stderr).toBeTruthy();
      const dumpFile = join(outDir, dumpName!);
      const sidecarFile = `${dumpFile}.checkpoint.json`;
      expect(existsSync(dumpFile)).toBe(true);
      expect(existsSync(sidecarFile)).toBe(true);
      const sidecarText = readFileSync(sidecarFile, "utf8");
      let sidecar: { checkpointId: string; chainSeq: number; chainHash: string; backupFile: string };
      try {
        sidecar = JSON.parse(sidecarText) as typeof sidecar;
      } catch (error) {
        throw new Error(`invalid sidecar: ${String(error)}\n${sidecarText}`);
      }
      const deletedEvent = await prisma.criticalEvent.findFirstOrThrow({
        where: { eventType: "book.deleted", bookId },
      });
      expect(deletedEvent.seq).toBeGreaterThan(sidecar.chainSeq);
      expect(await prisma.criticalEvent.count({ where: { seq: { lte: sidecar.chainSeq } } })).toBe(sidecar.chainSeq);
      expect(userId).toBeTruthy();

      cli(pgRestore, [
        "-h", parts.host, "-p", parts.port, "-U", parts.user,
        "-d", restoreName, "--exit-on-error", dumpFile,
      ]);
      restored = createPrismaClient(restoreUrl.toString());
      const checkpoint = await restored.criticalBackupCheckpoint.findFirstOrThrow({
        orderBy: { createdAt: "desc" },
      });
      expect(checkpoint.id).toBe(sidecar.checkpointId);
      expect(checkpoint.chainSeq).toBe(sidecar.chainSeq);
      expect(checkpoint.chainHash).toBe(sidecar.chainHash);
      const chain = await restored.criticalChain.findUniqueOrThrow({ where: { id: "global" } });
      expect(chain.lastSeq).toBe(sidecar.chainSeq);
      expect(chain.lastHash).toBe(sidecar.chainHash);
      // The post-snapshot deletion is not in the restored database; safe restore would replay it
      // from the verified remote events. The raw snapshot still has the book.
      expect(await restored.book.findUnique({ where: { id: bookId } })).not.toBeNull();
      expect(stdout).toContain("检查点备份完成");
    } finally {
      await prisma.criticalEvent.updateMany({ data: { deliveryState: "acked", ackedAt: new Date() } });
    }
  }, 30_000);

  it("automates a checkpoint backup and fetches it back from an independent offsite copy", async () => {
    await resetDatabase();
    const remoteDir = join(dir, "offsite");
    const fetchedDir = join(dir, "fetched");
    mkdirSync(remoteDir, { recursive: true });
    const env = {
      ...process.env,
      CRITICAL_BACKUP_ENV_FILE: envFile,
      S13I_REAL_PG_DUMP: realPgDump,
      S13I_PG_DUMP_STARTED: join(dir, "offsite_pg_dump_started.marker"),
      CRITICAL_BACKUP_OFFSITE: "fs",
      CRITICAL_BACKUP_REMOTE_DIR: remoteDir,
    };
    const backup = spawn(bash, ["critical-events-backup-all.sh", "offsite-test"], {
      cwd: join(process.cwd(), "..", "..", "deploy"),
      env,
      stdio: "pipe",
    });
    let out = "";
    backup.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    backup.stderr.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    const backupCode = await new Promise<number>((resolve) => backup.on("exit", (code) => resolve(code ?? 1)));
    expect(backupCode, out).toBe(0);
    expect(readdirSync(remoteDir).some((name) => name.endsWith(".dump"))).toBe(true);
    expect(readdirSync(remoteDir).some((name) => name.endsWith(".checkpoint.json"))).toBe(true);

    const fetch = spawn(bash, ["critical-events-fetch-backup.sh", "--latest", "--out", fetchedDir], {
      cwd: join(process.cwd(), "..", "..", "deploy"),
      env,
      stdio: "pipe",
    });
    let fetchOut = "";
    fetch.stdout.on("data", (chunk: Buffer) => { fetchOut += chunk.toString(); });
    fetch.stderr.on("data", (chunk: Buffer) => { fetchOut += chunk.toString(); });
    const fetchCode = await new Promise<number>((resolve) => fetch.on("exit", (code) => resolve(code ?? 1)));
    expect(fetchCode, fetchOut).toBe(0);
    const fetchedDump = readdirSync(fetchedDir).find((name) => name.endsWith(".dump"));
    expect(fetchedDump).toBeTruthy();
    expect(existsSync(join(fetchedDir, `${fetchedDump!}.checkpoint.json`))).toBe(true);
  }, 30_000);
});
