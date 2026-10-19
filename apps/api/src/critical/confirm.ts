import type { PrismaClient } from "../generated/prisma/client.js";

/**
 * @deprecated Business success is deliberately **not** coupled to the remote ledger. A committed
 * P0 business transaction succeeds for the user even if the relay or COS is unavailable. The event
 * row is written in the same transaction and `pg_notify` wakes the credential-isolated relay; the
 * relay retries independently.
 *
 * This function is retained as a no-op call site so existing routes keep the explicit seam between
 * "business boundary" and "protection layer", but it must never throw a 503 or wait for an ack.
 */
export async function confirmP0(_prisma: PrismaClient): Promise<void> {
  // Intentionally empty. Do not reintroduce waitForRelayAcks here.
}
