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
      "本地变更可能已经提交，但异地安全确认尚未完成；请勿直接重复执行不可逆操作，请稍后核对操作结果或联系管理员。",
      { reason: detail, operationCommitted: "unknown_or_yes" },
    );
  }
}
