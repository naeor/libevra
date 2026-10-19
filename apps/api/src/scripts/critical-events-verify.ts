import { resolve } from "node:path";

import { verifyRemoteLedger } from "../critical/remote.js";
import { FileSystemCriticalRemote, parseKeyRing } from "../critical/remote.js";

/**
 * Read-only verifier. Point `--dir` at a directory fetched from the dedicated COS prefix with the
 * **restore** identity. It never touches the database and never deletes anything.
 */
const dirArg = process.argv.indexOf("--dir");
const dir = dirArg >= 0 ? process.argv[dirArg + 1] : undefined;
if (dir === undefined) {
  console.error("usage: critical-events:verify --dir <fetched-prefix-directory>");
  process.exit(2);
}
const keyValue = process.env["CRITICAL_EVENT_KEY"];
if (keyValue === undefined || keyValue === "") {
  console.error("CRITICAL_EVENT_KEY is required");
  process.exit(2);
}

const key = parseKeyRing(
  keyValue,
  process.env["CRITICAL_EVENT_KEY_ID"],
  process.env["CRITICAL_EVENT_PREVIOUS_KEYS"],
);
try {
  const result = await verifyRemoteLedger(
    new FileSystemCriticalRemote(resolve(dir)),
    key,
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        events: result.events.length,
        firstSeq: result.events[0]?.core.seq ?? null,
        lastSeq: result.lastSeq,
        lastHash: result.lastHash,
        manifests: result.manifests.length,
        lastEventAt: result.events.at(-1)?.core.occurredAt ?? null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
  process.exitCode = 1;
}
