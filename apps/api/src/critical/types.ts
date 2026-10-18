import type { Prisma } from "../generated/prisma/client.js";

/** A server-enforced security/lifecycle event. Do not add ordinary bookkeeping here. */
export const CRITICAL_EVENT_TYPES = [
  // 1. account lifecycle
  "account.created",
  "account.disabled",
  "account.enabled",
  "account.closed",
  "account.recovery_requested",
  "account.recovery_claimed",
  "account.data_deleted",
  // 2. book lifecycle
  "book.created",
  "book.archived",
  "book.restored",
  "book.deleted",
  "book.disposed",
  "book.undisposed",
  "book.recovery_requested",
  "book.recovery_approved",
  "book.recovery_rejected",
  // 3. members and permissions
  "member.joined",
  "member.rejoined",
  "member.left",
  "member.removed",
  "member.role_changed",
  "book.manager_changed",
  // 4. authentication and sessions
  "auth.password_changed",
  "auth.password_reset",
  "auth.recovery_code_rotated",
  "auth.recovery_code_used",
  "auth.sessions_revoked",
  // 5. invitations, sharing, administration
  "invite.created",
  "invite.revoked",
  "invite.used",
  "share_link.created",
  "share_link.revoked",
  "share_link.used",
  "admin.granted",
  "admin.revoked",
  "admin.allowlist_changed",
  // 6. consent and retention policy
  "agreement.accepted",
  "agreement.withdrawn",
  "retention.policy_changed",
] as const;

export type CriticalEventType = (typeof CRITICAL_EVENT_TYPES)[number];

/**
 * P0: the client must not receive a final success response until at least one remote copy is
 * acknowledged. P1: must be recorded before the state change commits, but remote delivery may
 * be asynchronous (a safe restore still treats a gap as a manual-review condition).
 */
export type CriticalSeverity = "P0" | "P1";

const P0 = new Set<CriticalEventType>([
  "account.closed",
  "account.recovery_claimed",
  "book.deleted",
  "book.recovery_approved",
  "member.removed",
  "member.role_changed",
  "book.manager_changed",
  "auth.password_changed",
  "auth.password_reset",
  "auth.recovery_code_rotated",
  "auth.recovery_code_used",
  "auth.sessions_revoked",
  "invite.revoked",
  "share_link.revoked",
  "admin.granted",
  "admin.revoked",
  "admin.allowlist_changed",
]);

export function severityOf(type: CriticalEventType): CriticalSeverity {
  return P0.has(type) ? "P0" : "P1";
}

export interface CriticalActor {
  readonly userId?: string | null;
  readonly accountNumber?: string | null;
}

/**
 * Everything a later safe restore is allowed to know. Callers must pass identifiers and state
 * snapshots only: never password hashes, recovery codes, plaintext tokens or transaction content.
 */
export interface CriticalEventInput {
  readonly type: CriticalEventType;
  readonly actor?: CriticalActor;
  readonly subjectType:
    | "account"
    | "book"
    | "membership"
    | "session"
    | "invite"
    | "share_link"
    | "admin_grant"
    | "agreement"
    | "retention_policy"
    | "system";
  readonly subjectId?: string | null;
  readonly bookId?: string | null;
  readonly batchId?: string | null;
  readonly beforeState?: Prisma.InputJsonValue;
  readonly afterState?: Prisma.InputJsonValue;
  readonly result?: "success" | "failed";
  readonly resourceVersion?: number | null;
  readonly requestId?: string | null;
  readonly occurredAt?: Date;
  readonly schemaVersion?: number;
}

/** The plaintext object stored inside the encrypted remote envelope. */
export interface CriticalEventCore {
  readonly version: 1;
  readonly eventId: string;
  readonly seq: number;
  readonly prevHash: string | null;
  readonly eventType: CriticalEventType;
  readonly schemaVersion: number;
  readonly severity: CriticalSeverity;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actorUserId: string | null;
  readonly actorAccountNumber: string | null;
  readonly subjectType: string;
  readonly subjectId: string | null;
  readonly bookId: string | null;
  readonly batchId: string | null;
  readonly beforeState: unknown;
  readonly afterState: unknown;
  readonly result: string;
  readonly resourceVersion: number | null;
  readonly requestId: string | null;
}
