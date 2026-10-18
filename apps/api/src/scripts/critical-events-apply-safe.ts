import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { applySafeRestore } from "../critical/apply.js";
import { verifyRestoredCheckpoint } from "../critical/checkpoint.js";
import { verifyRemoteLedger } from "../critical/remote.js";
import { FileSystemCriticalRemote, parseKey } from "../critical/remote.js";
import { createPrismaClient } from "../db.js";

/**
 * Safe restore (step 3-6 of the runbook). It must be run against an isolated restored database
 * after the raw backup has been pg_restore'd there and migrations deployed.
 *
 * The event boundary comes from the checkpoint sidecar and the checkpoint row inside the restored
 * dump — never from a wall-clock "backup finished" time.
 *
 * usage:
 *   critical-events:apply-safe --dir <remote> --dump <backup.dump> \
 *     --checkpoint <backup.dump.checkpoint.json> [--report <file>]
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dir = arg("--dir");
const dumpPath = arg("--dump");
const checkpointFile = arg("--checkpoint");
const reportPath = arg("--report");
if (dir === undefined || dumpPath === undefined || checkpointFile === undefined) {
  console.error(
    "usage: critical-events:apply-safe --dir <dir> --dump <dump> --checkpoint <sidecar> [--report <file>]",
  );
  process.exit(2);
}
const keyValue = process.env["CRITICAL_EVENT_KEY"];
if (keyValue === undefined || keyValue === "") {
  console.error("CRITICAL_EVENT_KEY is required");
  process.exit(2);
}
const key = parseKey(keyValue);
const prisma = createPrismaClient(process.env["DATABASE_URL"] ?? "");
try {
  const checkpoint = await verifyRestoredCheckpoint(prisma, resolve(checkpointFile), resolve(dumpPath), key);
  const verified = await verifyRemoteLedger(
    new FileSystemCriticalRemote(resolve(dir)),
    key,
  );
  const report = await applySafeRestore(
    prisma,
    verified.events.map((entry) => entry.core),
    { afterSeq: checkpoint.chainSeq },
  );
  const withCheckpoint = { ...report, checkpoint };
  if (reportPath !== undefined) writeFileSync(resolve(reportPath), JSON.stringify(withCheckpoint, null, 2));
  console.log(JSON.stringify(withCheckpoint, null, 2));
  if (report.manualReview.length > 0) process.exitCode = 3;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
