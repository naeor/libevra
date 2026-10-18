import { createPrismaClient } from "../db.js";
import { runDuePurges } from "../lifecycle/book.js";
import { configureCriticalEvents, confirmCriticalEvents } from "../critical/runtime.js";
import { createRuntimeFromEnv } from "../critical/runtime-config.js";

/**
 * The 365-day archive cleanup job.
 *
 * Deliberately a separate process, not an interval inside the API: a restart must not forget the
 * schedule, and two API instances must not run the same purge twice. The deployment unit should
 * run this once a day; `pg_try_advisory_lock` makes overlapping invocations safe.
 */
const prisma = createPrismaClient(process.env.DATABASE_URL ?? "");
const LOCK_NAME = "libevra_lifecycle_purge";

try {
  const [lock] = await prisma.$queryRawUnsafe<{ locked: boolean }[]>(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
    LOCK_NAME,
  );
  if (!lock?.locked) {
    console.log(JSON.stringify({ ok: true, skipped: "another cleanup is running" }));
    process.exitCode = 0;
  } else {
    try {
      const result = await runDuePurges(prisma, new Date(), {
        logger: {
          error: (obj, message) => console.error(message ?? "purge failed", obj),
        },
      });
      if (result.purged > 0) {
        configureCriticalEvents(createRuntimeFromEnv());
        await confirmCriticalEvents(prisma);
      }
      console.log(JSON.stringify({ ok: result.failed === 0, ...result }));
      process.exitCode = result.failed === 0 ? 0 : 1;
    } finally {
      await prisma.$queryRawUnsafe("SELECT pg_advisory_unlock(hashtext($1))", LOCK_NAME);
    }
  }
} catch (error) {
  console.error("lifecycle cleanup failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
