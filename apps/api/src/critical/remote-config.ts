import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { CosCriticalRemote } from "./remote-cos.js";
import { FileSystemCriticalRemote, parseKey, type CriticalRemote } from "./remote.js";

/**
 * The relay is the only process that holds COS **write** credentials. It shares the database with
 * the API but has no public listener. The API's P0 routes wait for this process to set acked_at.
 */
export function createRelayRemoteFromEnv(): { remote: CriticalRemote; key: Buffer } {
  const keyValue = process.env["CRITICAL_EVENT_KEY"];
  if (keyValue === undefined || keyValue === "") {
    throw new Error("CRITICAL_EVENT_KEY is required for the critical-events relay");
  }
  const key = parseKey(keyValue);
  const mode = process.env["CRITICAL_EVENT_REMOTE"] ?? "fs";

  if (mode === "cos") {
    const bucket = process.env["CRITICAL_EVENT_COS_BUCKET"];
    const region = process.env["CRITICAL_EVENT_COS_REGION"];
    const secretId = process.env["CRITICAL_EVENT_COS_SECRET_ID"];
    const secretKey = process.env["CRITICAL_EVENT_COS_SECRET_KEY"];
    if (!bucket || !region || !secretId || !secretKey) {
      throw new Error("critical_event_cos_config_missing");
    }
    const remote = new CosCriticalRemote({
      bucket,
      region,
      secretId,
      secretKey,
      ...(process.env["CRITICAL_EVENT_COS_ENDPOINT"] === undefined
        ? {}
        : { endpoint: process.env["CRITICAL_EVENT_COS_ENDPOINT"] }),
    });
    return { remote, key };
  }

  const dir = process.env["CRITICAL_EVENT_REMOTE_DIR"] ?? resolve("critical-events-data");
  mkdirSync(dir, { recursive: true });
  return { remote: new FileSystemCriticalRemote(dir), key };
}
