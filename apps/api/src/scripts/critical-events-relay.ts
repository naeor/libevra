import { createPrismaClient } from "../db.js";
import { flushPendingCriticalEvents } from "../critical/runtime.js";
import { createRelayRemoteFromEnv } from "../critical/remote-config.js";

/**
 * Credential-isolated relay: reads the API's local outbox, uploads encrypted immutable objects to
 * the dedicated COS prefix, then marks the rows acknowledged. It has no HTTP listener and is not
 * required for raw backup restore.
 *
 * Usage: `pnpm --filter @libellum/api critical:relay` (loop) or `... -- --once` (one pass).
 */
const once = process.argv.includes("--once");
const prisma = createPrismaClient(process.env["DATABASE_URL"] ?? "");
const { remote, key } = createRelayRemoteFromEnv();

async function pass(): Promise<number> {
  const result = await flushPendingCriticalEvents(prisma, remote, key);
  return result.uploaded;
}

if (once) {
  try {
    const uploaded = await pass();
    console.log(JSON.stringify({ ok: true, mode: "once", uploaded, remote: remote.kind }));
    await prisma.$disconnect();
  } catch (error) {
    console.error("critical-events relay failed", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  }
} else {
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  while (!stopping) {
    try {
      const uploaded = await pass();
      if (uploaded > 0) console.log(`critical-events relay uploaded ${String(uploaded)}`);
    } catch (error) {
      console.error("critical-events relay pass failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  await prisma.$disconnect();
}
