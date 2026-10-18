import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { applySafeRestore } from "../critical/apply.js";
import { verifyRemoteLedger } from "../critical/remote.js";
import { FileSystemCriticalRemote, parseKey } from "../critical/remote.js";
import { createPrismaClient } from "../db.js";

/**
 * Safe restore (step 3-6 of the runbook). It must be run against an **isolated restored database**
 * after the raw backup has been pg_restore'd there and migrations deployed. It never calls
 * restore.sh and never opens production traffic.
 *
 * usage:
 *   critical-events:apply-safe --dir <fetched-prefix> --backup-at <ISO> [--report <file>]
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dir = arg("--dir");
const backupAtRaw = arg("--backup-at");
const reportPath = arg("--report");
if (dir === undefined || backupAtRaw === undefined) {
  console.error("usage: critical-events:apply-safe --dir <dir> --backup-at <ISO> [--report <file>]");
  process.exit(2);
}
const backupAt = new Date(backupAtRaw);
if (Number.isNaN(backupAt.getTime())) {
  console.error("--backup-at must be an ISO timestamp");
  process.exit(2);
}
const keyValue = process.env["CRITICAL_EVENT_KEY"];
if (keyValue === undefined || keyValue === "") {
  console.error("CRITICAL_EVENT_KEY is required");
  process.exit(2);
}

const prisma = createPrismaClient(process.env["DATABASE_URL"] ?? "");
try {
  const verified = await verifyRemoteLedger(
    new FileSystemCriticalRemote(resolve(dir)),
    parseKey(keyValue),
  );
  const report = await applySafeRestore(
    prisma,
    verified.events.map((entry) => entry.core),
    backupAt,
  );
  if (reportPath !== undefined) writeFileSync(resolve(reportPath), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.manualReview.length > 0) process.exitCode = 3;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
