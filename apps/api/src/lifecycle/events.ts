import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";

import type { Prisma } from "../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;

export type LifecycleEventKind =
  | "archived"
  | "restored"
  | "left"
  | "manager_transferred"
  | "recovery_requested"
  | "recovery_approved"
  | "recovery_rejected"
  | "purge_failed"
  | "purged";

export interface LifecycleActor {
  readonly userId: string | null;
  readonly accountNumber: string | null;
}

/** Record a small lifecycle event. It has no FK, so it survives the book being purged. */
export async function recordLifecycleEvent(
  tx: Tx,
  input: {
    readonly bookId: string;
    readonly kind: LifecycleEventKind;
    readonly actor: LifecycleActor;
    readonly detail?: Record<string, unknown> | null;
    readonly at?: Date;
  },
): Promise<void> {
  await tx.bookLifecycleEvent.create({
    data: {
      bookId: input.bookId,
      kind: input.kind,
      actorUserId: input.actor.userId,
      actorAccountNumber: input.actor.accountNumber,
      ...(input.detail === undefined || input.detail === null
        ? {}
        : { detail: input.detail as Prisma.InputJsonValue }),
      ...(input.at === undefined ? {} : { at: input.at }),
    },
  });
}

/** Generate the plaintext credential shown exactly once to a closing account owner. */
export function generateRecoveryCredential(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

/** Only the hash is stored — the same rule as sessions and recovery codes. */
export function hashRecoveryCredential(credential: string): string {
  return createHash("sha256").update(credential.trim().toUpperCase(), "utf8").digest("hex");
}
