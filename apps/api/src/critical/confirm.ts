import type { PrismaClient } from "../generated/prisma/client.js";
import { serviceUnavailable } from "../lib/errors.js";
import { CriticalEventPersistenceError, confirmCriticalEvents } from "./runtime.js";

/**
 * P0 route boundary: a committed security change is not reported as success until the remote
 * ledger confirms it. The local state may already be committed; the error says so explicitly
 * instead of pretending nothing happened.
 */
export async function confirmP0(prisma: PrismaClient): Promise<void> {
  try {
    await confirmCriticalEvents(prisma);
  } catch (error) {
    const detail = error instanceof CriticalEventPersistenceError ? error.message : "unknown";
    throw serviceUnavailable(
      "critical_event_unconfirmed",
      "本地变更可能已提交，但安全状态登记簿尚未收到异地确认；请稍后重试并核对操作结果。",
      { reason: detail, operationCommitted: "unknown_or_yes" },
    );
  }
}
