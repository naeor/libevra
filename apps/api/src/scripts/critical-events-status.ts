import { createPrismaClient } from "../db.js";
import { createRuntimeFromEnv } from "../critical/runtime-config.js";
import { getProtectionStatus } from "../critical/status.js";

/**
 * Read-only protection health for monitoring/timers. Exit code 1 means the **protection layer** is
 * degraded (relay stale, backlog too old/large, repeated failures, local chain gap). Business
 * operations and S12-C backups are independent and must not be restarted because of this exit code.
 *
 * Configure the runtime from the same environment the API uses. Without this, a fresh CLI process
 * reports `runtime: "disabled"` and silently skips the relay-staleness alarm even when the
 * production API is in relay mode.
 */
const runtime = createRuntimeFromEnv();
const prisma = createPrismaClient(process.env["DATABASE_URL"] ?? "");
try {
  const status = await getProtectionStatus(prisma, runtime.kind);
  console.log(JSON.stringify(status, null, 2));
  if (status.alarm) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
  process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
