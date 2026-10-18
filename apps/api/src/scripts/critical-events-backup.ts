import { resolve } from "node:path";

import { createCheckpointedBackup } from "../critical/checkpoint.js";
import { parseKey } from "../critical/remote.js";

/**
 * Create a checkpointed full dump. This is **not** a replacement for S12-C backup.sh: it is the
 * opt-in input for safe restore. The plain S12-C dump remains independent and can always be used
 * for raw restore, but only a checkpointed dump can prove the exact event boundary.
 *
 * Usage:
 *   critical:backup-checkpoint --out <path.dump> [--label <name>]
 *   PG_DUMP=/path/to/pg_dump CRITICAL_EVENT_KEY=... DATABASE_URL=...
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const out = arg("--out");
if (out === undefined) {
  console.error("usage: critical:backup-checkpoint --out <path.dump> [--label <name>]");
  process.exit(2);
}
const keyValue = process.env["CRITICAL_EVENT_KEY"];
if (keyValue === undefined || keyValue === "") {
  console.error("CRITICAL_EVENT_KEY is required (the checkpoint sidecar is HMAC-protected)");
  process.exit(2);
}
const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl === "") {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

try {
  const result = await createCheckpointedBackup({
    databaseUrl,
    dumpPath: resolve(out),
    eventKey: parseKey(keyValue),
    ...(arg("--label") === undefined ? {} : { label: arg("--label")! }),
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
  process.exitCode = 1;
}
