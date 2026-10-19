import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseKeyRing, MemoryCriticalRemote, FileSystemCriticalRemote } from "./remote.js";
import { configureCriticalEvents, type CriticalRuntime } from "./runtime.js";

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * The API never receives COS credentials. In production it only writes the local outbox and waits
 * for a separate relay sidecar to set `acked_at`; that sidecar holds write-only COS credentials.
 * Development/tests use an in-process filesystem/memory remote so the code path is exercisable
 * without touching COS.
 */
export function createRuntimeFromEnv(): CriticalRuntime {
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  const mode = process.env["CRITICAL_EVENTS_MODE"] ?? (nodeEnv === "production" ? "relay" : "inline");

  if (mode === "relay") {
    return {
      kind: "relay",
      timeoutMs: positiveInt(process.env["CRITICAL_EVENTS_RELAY_TIMEOUT_MS"], 8_000),
    };
  }

  if (nodeEnv === "production") {
    throw new Error("CRITICAL_EVENTS_MODE=relay is required in production");
  }

  const keyValue =
    process.env["CRITICAL_EVENT_KEY"] ??
    Buffer.from("libellum-development-only-critical-events!!").subarray(0, 32).toString("base64");
  const key = parseKeyRing(
    keyValue,
    process.env["CRITICAL_EVENT_KEY_ID"],
    process.env["CRITICAL_EVENT_PREVIOUS_KEYS"],
  );
  if (nodeEnv === "test") {
    return { kind: "inline", remote: new MemoryCriticalRemote(), key };
  }
  const dir =
    process.env["CRITICAL_EVENT_REMOTE_DIR"] ??
    join(tmpdir(), "libevra-critical-events-dev");
  mkdirSync(dir, { recursive: true });
  return { kind: "inline", remote: new FileSystemCriticalRemote(dir), key };
}

export function installRuntimeForTests(runtime: CriticalRuntime): void {
  configureCriticalEvents(runtime);
}
