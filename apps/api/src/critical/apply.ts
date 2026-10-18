import { randomBytes } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.js";
import { hashPassword } from "../auth/password.js";
import { hashCore } from "./store.js";
import type { CriticalEventCore } from "./types.js";

export interface SafeRestoreReport {
  readonly generatedAt: string;
  readonly backupAt: string;
  readonly selected: number;
  readonly applied: number;
  readonly alreadyApplied: number;
  readonly manualReview: { readonly eventId: string; readonly seq: number; readonly type: string; readonly reason: string }[];
  readonly notes: string[];
}

export type SafeRestoreBoundary = Date | { readonly afterSeq: number };

/**
 * Apply only the events whose target already exists in the restored snapshot. Missing targets are
 * reported, never fabricated. Password/credential changes are conservative: the old credentials
 * are made unusable and the account needs an administrator reset, because the event ledger has no
 * right to contain (and does not contain) the new password hash.
 *
 * A `{afterSeq}` boundary comes from the exact backup checkpoint. A `Date` form exists only for
 * tests/legacy callers; the CLI requires a checkpoint sidecar.
 */
export async function applySafeRestore(
  prisma: PrismaClient,
  events: readonly CriticalEventCore[],
  boundary: SafeRestoreBoundary,
): Promise<SafeRestoreReport> {
  const database = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  const name = database[0]?.name ?? "";
  if (!/(test|restore|verify|isolated|rehearsal)/i.test(name)) {
    throw new Error(`refusing safe restore against non-isolated database: ${name}`);
  }

  // The restored snapshot's local chain ends at the backup. Re-attach the verified remote events
  // and advance the head, otherwise the next live event would reuse a sequence/event hash that
  // already exists remotely. This is a local metadata merge, not a second copy of the ledger.
  await attachRemoteEvents(prisma, events);

  // Conservative baseline: every session in the restored snapshot is invalid, even if the event
  // ledger is incomplete. This is deliberately broader than the events.
  await prisma.session.deleteMany();

  const manualReview: SafeRestoreReport["manualReview"][number][] = [];
  const notes: string[] = [];
  let applied = 0;
  let alreadyApplied = 0;

  for (const event of events.filter((entry) => afterBoundary(entry, boundary))) {
    const existing = await prisma.criticalEventApplied.findUnique({ where: { eventId: event.eventId } });
    if (existing !== null) {
      alreadyApplied += 1;
      continue;
    }
    try {
      const result = await applyOne(prisma, event);
      if (result.manual === undefined) {
        await prisma.criticalEventApplied.create({
          data: { eventId: event.eventId, note: result.note ?? null },
        });
        applied += 1;
        if (result.note !== undefined) notes.push(result.note);
      } else {
        manualReview.push({
          eventId: event.eventId,
          seq: event.seq,
          type: event.eventType,
          reason: result.manual,
        });
      }
    } catch (error) {
      manualReview.push({
        eventId: event.eventId,
        seq: event.seq,
        type: event.eventType,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await prisma.session.deleteMany();
  notes.push("所有恢复快照中的会话已撤销；凭据变更的账号需管理员重置密码。");
  return {
    generatedAt: new Date().toISOString(),
    backupAt: boundary instanceof Date ? boundary.toISOString() : `afterSeq:${String(boundary.afterSeq)}`,
    selected: events.filter((entry) => afterBoundary(entry, boundary)).length,
    applied,
    alreadyApplied,
    manualReview,
    notes,
  };
}

function afterBoundary(event: CriticalEventCore, boundary: SafeRestoreBoundary): boolean {
  return boundary instanceof Date
    ? new Date(event.occurredAt).getTime() > boundary.getTime()
    : event.seq > boundary.afterSeq;
}

/**
 * Merge verified remote event metadata into the restored DB and move the local hash-chain head.
 * Without this, the next live event would collide with an object already in COS.
 */
async function attachRemoteEvents(
  prisma: PrismaClient,
  events: readonly CriticalEventCore[],
): Promise<void> {
  if (events.length === 0) return;
  const latest = events[events.length - 1]!;
  await prisma.$transaction(async (tx) => {
    for (const core of events) {
      const hash = hashCore(core);
      const existing = await tx.criticalEvent.findUnique({ where: { eventId: core.eventId } });
      if (existing !== null) {
        if (existing.eventHash !== hash) throw new Error(`critical_event_hash_mismatch:${core.eventId}`);
        continue;
      }
      await tx.criticalEvent.create({
        data: {
          eventId: core.eventId,
          seq: core.seq,
          prevHash: core.prevHash,
          eventHash: hash,
          eventType: core.eventType,
          schemaVersion: core.schemaVersion,
          severity: core.severity,
          occurredAt: new Date(core.occurredAt),
          recordedAt: new Date(core.recordedAt),
          actorUserId: core.actorUserId,
          actorAccountNumber: core.actorAccountNumber,
          subjectType: core.subjectType,
          subjectId: core.subjectId,
          bookId: core.bookId,
          batchId: core.batchId,
          ...(core.beforeState === null ? {} : { beforeState: core.beforeState as object }),
          ...(core.afterState === null ? {} : { afterState: core.afterState as object }),
          result: core.result,
          resourceVersion: core.resourceVersion,
          requestId: core.requestId,
          deliveryState: "acked",
          uploadedAt: new Date(),
          ackedAt: new Date(),
        },
      });
    }
    const chain = await tx.criticalChain.findUnique({ where: { id: "global" } });
    if (chain !== null && chain.lastSeq > latest.seq) {
      throw new Error("critical_event_remote_head_behind_restored_snapshot");
    }
    await tx.criticalChain.upsert({
      where: { id: "global" },
      create: { id: "global", lastSeq: latest.seq, lastHash: hashCore(latest) },
      update: { lastSeq: latest.seq, lastHash: hashCore(latest) },
    });
  });
}

interface ApplyResult {
  readonly note?: string;
  readonly manual?: string;
}

async function applyOne(prisma: PrismaClient, event: CriticalEventCore): Promise<ApplyResult> {
  const after = (event.afterState ?? {}) as Record<string, unknown>;
  const before = (event.beforeState ?? {}) as Record<string, unknown>;

  switch (event.eventType) {
    case "account.closed": {
      const user = await prisma.user.findUnique({ where: { id: event.subjectId ?? "" } });
      if (user === null) return { manual: "恢复快照中不存在该账号" };
      const closedAt = new Date(event.occurredAt);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            closedAt,
            disabledAt: closedAt,
            disabledBy: "safe_restore_tombstone",
            passwordHash: await hashPassword(randomBytes(32).toString("hex")),
            recoveryCodeHash: null,
            isAdmin: false,
            lastBookId: null,
          },
        });
        await tx.session.deleteMany({ where: { userId: user.id } });
        await tx.adminGrant.deleteMany({ where: { userId: user.id } });
        await tx.adminAllowEntry.deleteMany({ where: { userId: user.id } });
      });
      return { note: `account closed: ${user.id}` };
    }
    case "account.disabled": {
      if (event.subjectId === null) return { manual: "缺少账号 UUID" };
      const user = await prisma.user.findUnique({ where: { id: event.subjectId } });
      if (user === null) return { manual: "恢复快照中不存在该账号" };
      await prisma.user.update({
        where: { id: user.id },
        data: { disabledAt: new Date(event.occurredAt), disabledBy: "safe_restore_event" },
      });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      return {};
    }
    case "account.enabled": {
      if (event.subjectId === null) return { manual: "缺少账号 UUID" };
      const user = await prisma.user.findUnique({ where: { id: event.subjectId } });
      if (user === null) return { manual: "恢复快照中不存在该账号" };
      // A later closure wins over an older re-enable.
      if (user.closedAt !== null) return { manual: "账号在快照中已注销，拒绝重新启用" };
      await prisma.user.update({ where: { id: user.id }, data: { disabledAt: null, disabledBy: null } });
      return {};
    }
    case "book.deleted": {
      const book = await prisma.book.findUnique({ where: { id: event.bookId ?? "" } });
      if (book === null) {
        const tombstone = await prisma.bookTombstone.findUnique({ where: { bookId: event.bookId ?? "" } });
        if (tombstone !== null) return { note: "账本已删除" };
        return { manual: "恢复快照中不存在该账本" };
      }
      await prisma.$transaction(async (tx) => {
        await tx.transaction.deleteMany({ where: { bookId: book.id } });
        await tx.conflictResolution.deleteMany({ where: { bookId: book.id } });
        await tx.book.delete({ where: { id: book.id } });
      });
      return { note: `book deleted: ${book.id}` };
    }
    case "book.archived": {
      const book = await prisma.book.findUnique({ where: { id: event.bookId ?? "" } });
      if (book === null) return { manual: "恢复快照中不存在该账本" };
      const archivedAt = stringDate(after["archivedAt"]) ?? new Date(event.occurredAt);
      await prisma.book.update({
        where: { id: book.id },
        data: {
          archivedAt,
          archivedByUserId: event.actorUserId,
          archiveReason: typeof after["archiveReason"] === "string" ? after["archiveReason"] : "restored_event",
          selfRestoreUntil: stringDate(after["selfRestoreUntil"]),
          scheduledPurgeAt: stringDate(after["scheduledPurgeAt"]),
          purgeStartedAt: null,
        },
      });
      return {};
    }
    case "book.restored": {
      const book = await prisma.book.findUnique({ where: { id: event.bookId ?? "" } });
      if (book === null) return { manual: "恢复快照中不存在该账本" };
      await prisma.book.update({
        where: { id: book.id },
        data: {
          archivedAt: null,
          archivedByUserId: null,
          archiveReason: null,
          selfRestoreUntil: null,
          scheduledPurgeAt: null,
          purgeStartedAt: null,
          purgeAttempts: 0,
          purgeLastError: null,
        },
      });
      return {};
    }
    case "book.recovery_approved": {
      const book = await prisma.book.findUnique({ where: { id: event.bookId ?? "" } });
      if (book === null) return { manual: "恢复快照中不存在该账本" };
      const targetId = after["targetUserId"];
      if (typeof targetId === "string") {
        const [target, membership] = await Promise.all([
          prisma.user.findUnique({ where: { id: targetId } }),
          prisma.bookMember.findUnique({ where: { bookId_userId: { bookId: book.id, userId: targetId } } }),
        ]);
        if (target === null || target.closedAt !== null || membership === null || membership.leftAt !== null) {
          return { manual: "恢复审批的目标账号或成员关系在快照中不可用，需人工核验" };
        }
        await prisma.book.update({
          where: { id: book.id },
          data: {
            archivedAt: null,
            archivedByUserId: null,
            archiveReason: null,
            selfRestoreUntil: null,
            scheduledPurgeAt: null,
            managedByUserId: targetId,
          },
        });
        return {};
      }
      return { manual: "恢复审批缺少目标账号，需人工核验" };
    }
    case "book.disposed":
    case "book.undisposed": {
      const book = await prisma.book.findUnique({ where: { id: event.bookId ?? "" } });
      if (book === null) return { manual: "恢复快照中不存在该账本" };
      await prisma.book.update({
        where: { id: book.id },
        data: { disposedAt: event.eventType === "book.disposed" ? new Date(event.occurredAt) : null },
      });
      return {};
    }
    case "book.manager_changed": {
      const managerId = after["managedByUserId"];
      if (typeof managerId !== "string") return { manual: "缺少目标管理者 UUID" };
      const [book, manager] = await Promise.all([
        prisma.book.findUnique({ where: { id: event.bookId ?? "" } }),
        prisma.user.findUnique({ where: { id: managerId } }),
      ]);
      if (book === null) return { manual: "恢复快照中不存在该账本" };
      if (manager === null || manager.closedAt !== null) return { manual: "目标管理者不存在或已注销，拒绝移交" };
      const membership = await prisma.bookMember.findUnique({
        where: { bookId_userId: { bookId: book.id, userId: managerId } },
      });
      if (membership === null || membership.leftAt !== null) return { manual: "目标管理者已不在账本中，拒绝移交" };
      await prisma.book.update({ where: { id: book.id }, data: { managedByUserId: managerId } });
      return {};
    }
    case "member.left":
    case "member.removed": {
      const ids = parseMembership(event.subjectId);
      if (ids === null) return { manual: "成员关系标识不完整" };
      const membership = await prisma.bookMember.findUnique({
        where: { bookId_userId: { bookId: ids.bookId, userId: ids.userId } },
      });
      if (membership === null) return { manual: "恢复快照中不存在该成员关系" };
      await prisma.bookMember.update({
        where: { bookId_userId: { bookId: ids.bookId, userId: ids.userId } },
        data: { leftAt: new Date(event.occurredAt) },
      });
      return {};
    }
    case "member.role_changed": {
      const ids = parseMembership(event.subjectId);
      const role = after["role"];
      if (ids === null || (role !== "editor" && role !== "viewer")) return { manual: "角色事件缺少成员或角色" };
      const membership = await prisma.bookMember.findUnique({
        where: { bookId_userId: { bookId: ids.bookId, userId: ids.userId } },
      });
      if (membership === null) return { manual: "恢复快照中不存在该成员关系" };
      await prisma.bookMember.update({
        where: { bookId_userId: { bookId: ids.bookId, userId: ids.userId } },
        data: { role },
      });
      return {};
    }
    case "auth.password_changed":
    case "auth.password_reset":
    case "auth.recovery_code_rotated":
    case "auth.recovery_code_used": {
      if (event.subjectId === null) return { manual: "凭据事件缺少账号 UUID" };
      const user = await prisma.user.findUnique({ where: { id: event.subjectId } });
      if (user === null) return { manual: "恢复快照中不存在该账号" };
      // Never guess the new credential. Make the old one unusable; an administrator must reset it.
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(randomBytes(32).toString("hex")),
          recoveryCodeHash: null,
          recoveryCodeUsedAt: null,
        },
      });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      return { note: `credentials quarantined: ${user.id}` };
    }
    case "auth.sessions_revoked": {
      if (event.subjectId === null) return { manual: "会话撤销事件缺少账号 UUID" };
      await prisma.session.deleteMany({ where: { userId: event.subjectId } });
      return {};
    }
    case "admin.revoked": {
      if (event.subjectId === null) return { manual: "管理员撤销事件缺少账号 UUID" };
      const user = await prisma.user.findUnique({ where: { id: event.subjectId } });
      if (user === null) return { manual: "恢复快照中不存在该账号" };
      await prisma.$transaction(async (tx) => {
        await tx.adminGrant.deleteMany({ where: { userId: user.id } });
        await tx.adminAllowEntry.deleteMany({ where: { userId: user.id } });
        await tx.user.update({ where: { id: user.id }, data: { isAdmin: false } });
      });
      return {};
    }
    case "admin.granted":
    case "admin.allowlist_changed":
      return { manual: "安全恢复不自动重新授予管理员权限，需人工核验" };
    case "invite.revoked": {
      if (event.subjectId === null) return { manual: "邀请事件缺少 ID" };
      const invite = await prisma.registrationInvite.findUnique({ where: { id: event.subjectId } });
      if (invite === null) return { note: "邀请码不存在，无需撤销" };
      await prisma.registrationInvite.update({
        where: { id: invite.id },
        data: { revokedAt: new Date(event.occurredAt) },
      });
      return {};
    }
    case "share_link.revoked": {
      if (event.subjectId === null) return { manual: "分享链接事件缺少 ID" };
      const link = await prisma.bookShareLink.findUnique({ where: { id: event.subjectId } });
      if (link === null) return { note: "分享链接不存在，无需撤销" };
      await prisma.bookShareLink.update({
        where: { id: link.id },
        data: { revokedAt: new Date(event.occurredAt), revokedBy: before["revokedBy"] as string | undefined ?? null },
      });
      return {};
    }
    case "member.joined":
    case "member.rejoined": {
      const ids = parseMembership(event.subjectId);
      const role = after["role"];
      if (ids === null || (role !== "editor" && role !== "viewer")) {
        return { manual: "成员加入事件缺少成员关系或角色" };
      }
      const [book, user, membership] = await Promise.all([
        prisma.book.findUnique({ where: { id: ids.bookId } }),
        prisma.user.findUnique({ where: { id: ids.userId } }),
        prisma.bookMember.findUnique({
          where: { bookId_userId: { bookId: ids.bookId, userId: ids.userId } },
        }),
      ]);
      if (book === null || user === null) {
        return { manual: "恢复快照中不存在对应账本或账号，拒绝凭事件重建关系" };
      }
      if (membership === null) {
        return { manual: "恢复快照中不存在该成员关系，拒绝凭事件直接授予访问" };
      }
      if (event.eventType === "member.rejoined") {
        await prisma.bookMember.update({
          where: { bookId_userId: { bookId: ids.bookId, userId: ids.userId } },
          data: { leftAt: null, role },
        });
      }
      return { note: "成员关系已在快照中存在；只处理可确定的重新加入" };
    }
    case "book.created":
    case "account.created":
      return { manual: "恢复快照缺少该对象；安全恢复不会凭事件重建账本或账号" };
    default:
      return { manual: "未安全支持的事件类型，需人工核查" };
  }
}

function stringDate(value: unknown): Date | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value) : null;
}

function parseMembership(value: string | null): { bookId: string; userId: string } | null {
  if (value === null) return null;
  const [bookId, userId] = value.split(":");
  return bookId && userId ? { bookId, userId } : null;
}
