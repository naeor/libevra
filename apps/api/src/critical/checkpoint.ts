import { execFile } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { Client } from "pg";

import { canonicalJson } from "./canonical.js";

const execFileAsync = promisify(execFile);
const LOCK_SQL = `pg_advisory_lock(hashtext('libevra_critical_backup_checkpoint'))`;

export interface BackupCheckpoint {
  readonly version: 1;
  readonly checkpointId: string;
  readonly backupFile: string;
  readonly backupLabel: string | null;
  readonly sha256: string;
  readonly bytes: number;
  readonly databaseName: string;
  readonly chainSeq: number;
  readonly chainHash: string | null;
  readonly createdAt: string;
}

export interface CheckpointedBackup {
  readonly checkpoint: BackupCheckpoint;
  readonly checkpointFile: string;
}

export interface CreateCheckpointedBackupOptions {
  readonly databaseUrl: string;
  readonly dumpPath: string;
  readonly label?: string;
  readonly pgDumpPath?: string;
  readonly eventKey: Buffer;
}

/**
 * Create a **consistent full database dump plus an exact event-chain checkpoint**.
 *
 * The exclusive advisory lock is held while the checkpoint row is committed, the REPEATABLE READ
 * snapshot is exported, and the chain head is read. Event writers take the shared transaction lock
 * in `recordCriticalEvent`, so they cannot append an event between "the checkpoint head" and "the
 * snapshot the dump sees".
 *
 * `pg_dump --snapshot=<exported id>` is then given that exact snapshot; the checkpoint row itself
 * is in the dump, so a restore can verify which checkpoint belongs to the dump.
 *
 * The plain `pg_dump` / S12-C backup is intentionally not changed or required.
 */
export async function createCheckpointedBackup(
  options: CreateCheckpointedBackupOptions,
): Promise<CheckpointedBackup> {
  const dumpPath = resolve(options.dumpPath);
  await mkdir(dirname(dumpPath), { recursive: true });
  const url = new URL(options.databaseUrl);
  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  const checkpointId = randomUUID();
  const label = options.label ?? null;
  let snapshotTx = false;
  try {
    await client.query(`SELECT ${LOCK_SQL}`);
    const inserted = await client.query<{
      id: string;
      chain_seq: number;
      chain_hash: string | null;
      database_name: string;
      created_at: Date;
    }>(
      `INSERT INTO "critical_backup_checkpoints"
         ("id", "backup_label", "chain_seq", "chain_hash", "database_name")
       SELECT $1::uuid, $2, "last_seq", "last_hash", current_database()
       FROM "critical_chain" WHERE "id" = 'global'
       RETURNING "id", "chain_seq", "chain_hash", "database_name", "created_at"`,
      [checkpointId, label],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error("critical_chain_missing_for_checkpoint");

    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    snapshotTx = true;
    const exported = await client.query<{ snapshot: string }>("SELECT pg_export_snapshot() AS snapshot");
    const snapshot = exported.rows[0]?.snapshot;
    if (snapshot === undefined) throw new Error("critical_checkpoint_snapshot_missing");
    const head = await client.query<{ last_seq: number; last_hash: string | null }>(
      `SELECT "last_seq", "last_hash" FROM "critical_chain" WHERE "id" = 'global'`,
    );
    if (
      Number(head.rows[0]?.last_seq) !== row.chain_seq ||
      (head.rows[0]?.last_hash ?? null) !== row.chain_hash
    ) {
      throw new Error("critical_checkpoint_head_moved_inside_lock");
    }

    // Once the snapshot is exported, event writers may continue: their rows will not be in this
    // dump, and their seq is above the checkpoint head.
    await client.query(
      `SELECT pg_advisory_unlock(hashtext('libevra_critical_backup_checkpoint'))`,
    );

    const pgDump = options.pgDumpPath ?? process.env["PG_DUMP"] ?? "pg_dump";
    const pgPassword = decodeURIComponent(url.password);
    const args = [
      "-h", url.hostname,
      "-p", url.port || "5432",
      "-U", decodeURIComponent(url.username),
      "-d", url.pathname.replace(/^\//, ""),
      "-Fc",
      `--snapshot=${snapshot}`,
      "--file", dumpPath,
    ];
    await execFileAsync(pgDump, args, {
      env: { ...process.env, PGPASSWORD: pgPassword },
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });

    await client.query("COMMIT");
    snapshotTx = false;

    const metadata = await stat(dumpPath);
    const sha256 = createHash("sha256").update(await readFile(dumpPath)).digest("hex");
    const checkpoint: BackupCheckpoint = {
      version: 1,
      checkpointId,
      backupFile: basename(dumpPath),
      backupLabel: label,
      sha256,
      bytes: metadata.size,
      databaseName: row.database_name,
      chainSeq: row.chain_seq,
      chainHash: row.chain_hash,
      createdAt: row.created_at.toISOString(),
    };
    const checkpointFile = `${dumpPath}.checkpoint.json`;
    const hmac = signCheckpoint(checkpoint, options.eventKey);
    await writeFile(
      checkpointFile,
      JSON.stringify({ ...checkpoint, hmac }, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
    return { checkpoint, checkpointFile };
  } catch (error) {
    if (snapshotTx) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    // The session lock is released explicitly after the snapshot; this is a final safety net.
    await client.query(
      `SELECT pg_advisory_unlock(hashtext('libevra_critical_backup_checkpoint'))`,
    ).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

export function checkpointHmacMaterial(checkpoint: BackupCheckpoint): string {
  return canonicalJson({
    version: checkpoint.version,
    checkpointId: checkpoint.checkpointId,
    backupFile: checkpoint.backupFile,
    backupLabel: checkpoint.backupLabel,
    sha256: checkpoint.sha256,
    bytes: checkpoint.bytes,
    databaseName: checkpoint.databaseName,
    chainSeq: checkpoint.chainSeq,
    chainHash: checkpoint.chainHash,
    createdAt: checkpoint.createdAt,
  });
}

export function signCheckpoint(checkpoint: BackupCheckpoint, key: Buffer): string {
  return createHmac("sha256", deriveCheckpointKey(key)).update(checkpointHmacMaterial(checkpoint)).digest("hex");
}

/**
 * Read the newest checkpoint row from a *restored* database and verify that the restored chain
 * head is exactly the checkpoint's head. If the row is missing, safe restore must not guess.
 */
export async function readRestoredCheckpoint(
  prisma: import("../db.js").PrismaClient,
): Promise<{ readonly checkpoint: {
  readonly id: string;
  readonly backupLabel: string | null;
  readonly chainSeq: number;
  readonly chainHash: string | null;
  readonly databaseName: string;
  readonly createdAt: string;
}; readonly chainHash: string | null }> {
  const row = await prisma.criticalBackupCheckpoint.findFirst({
    orderBy: { createdAt: "desc" },
  });
  if (row === null) throw new Error("critical_checkpoint_missing_in_restored_database");
  const chain = await prisma.criticalChain.findUnique({ where: { id: "global" } });
  if (chain === null) throw new Error("critical_chain_missing_in_restored_database");
  if (chain.lastSeq !== row.chainSeq || (chain.lastHash ?? null) !== (row.chainHash ?? null)) {
    throw new Error("critical_checkpoint_does_not_match_restored_chain");
  }
  return {
    checkpoint: {
      id: row.id,
      backupLabel: row.backupLabel,
      chainSeq: row.chainSeq,
      chainHash: row.chainHash,
      databaseName: row.databaseName,
      createdAt: row.createdAt.toISOString(),
    },
    chainHash: chain.lastHash,
  };
}

/** Verify a sidecar against the actual dump bytes before any restore is attempted. */
export async function verifyCheckpointSidecar(
  checkpointFile: string,
  dumpPath: string,
  key: Buffer,
): Promise<BackupCheckpoint> {
  const raw = JSON.parse(await readFile(checkpointFile, "utf8")) as BackupCheckpoint & {
    hmac?: string;
  };
  const expected = signCheckpoint(raw, key);
  if (raw.hmac !== undefined && raw.hmac !== expected) {
    throw new Error("critical_checkpoint_hmac_invalid");
  }
  const bytes = await readFile(dumpPath);
  if (createHash("sha256").update(bytes).digest("hex") !== raw.sha256) {
    throw new Error("critical_checkpoint_dump_hash_mismatch");
  }
  if (bytes.byteLength !== raw.bytes) throw new Error("critical_checkpoint_dump_size_mismatch");
  if (basename(dumpPath) !== raw.backupFile) throw new Error("critical_checkpoint_dump_name_mismatch");
  return raw;
}

export async function verifyRestoredCheckpoint(
  prisma: import("../db.js").PrismaClient,
  checkpointFile: string,
  dumpPath: string,
  key: Buffer,
): Promise<BackupCheckpoint> {
  const sidecar = await verifyCheckpointSidecar(checkpointFile, dumpPath, key);
  const restored = await readRestoredCheckpoint(prisma);
  if (
    restored.checkpoint.id !== sidecar.checkpointId ||
    restored.checkpoint.chainSeq !== sidecar.chainSeq ||
    (restored.checkpoint.chainHash ?? null) !== (sidecar.chainHash ?? null)
  ) {
    throw new Error("critical_checkpoint_sidecar_does_not_match_restored_snapshot");
  }
  return sidecar;
}

function deriveCheckpointKey(key: Buffer): Buffer {
  return createHash("sha256").update("libevra-critical-checkpoint-v1").update(key).digest();
}
