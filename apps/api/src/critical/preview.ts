import type { PrismaClient } from "../generated/prisma/client.js";
import { readRestoredCheckpoint } from "./checkpoint.js";
import type { CriticalEventCore } from "./types.js";

export interface RestorePreviewEvent {
  readonly eventId: string;
  readonly seq: number;
  readonly type: string;
  readonly group: "account" | "book" | "membership" | "auth" | "invite_share_admin" | "consent" | "other";
  readonly occurredAt: string;
  readonly actorUserId: string | null;
  readonly actorAccountNumber: string | null;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly bookId: string | null;
  readonly targetLabel: string | null;
  readonly decision: "auto" | "manual" | "missing_target";
  readonly reason: string | null;
  readonly rollbackRisk: boolean;
}

export interface RestorePreview {
  readonly generatedAt: string;
  readonly checkpoint: {
    readonly id: string;
    readonly backupLabel: string | null;
    readonly chainSeq: number;
    readonly chainHash: string | null;
    readonly databaseName: string;
    readonly createdAt: string;
  };
  readonly counts: {
    readonly total: number;
    readonly auto: number;
    readonly manual: number;
    readonly missingTarget: number;
    readonly rollbackRisk: number;
  };
  readonly groups: Readonly<Record<string, { readonly total: number; readonly auto: number; readonly manual: number; readonly missingTarget: number }>>;
  readonly events: readonly RestorePreviewEvent[];
  readonly notes: readonly string[];
}

/**
 * Read-only difference preview for the future local management site.
 *
 * It reads the checkpoint from the restored database, never attaches remote events, never deletes
 * sessions, and never writes anything. The caller supplies the verified remote event list.
 */
export async function previewSafeRestore(
  prisma: PrismaClient,
  events: readonly CriticalEventCore[],
): Promise<RestorePreview> {
  const restored = await readRestoredCheckpoint(prisma);
  const checkpoint = restored.checkpoint;
  const pending = events.filter((event) => event.seq > checkpoint.chainSeq);
  const previewEvents: RestorePreviewEvent[] = [];
  for (const event of pending) {
    const classified = await classifyEvent(prisma, event);
    previewEvents.push({
      eventId: event.eventId,
      seq: event.seq,
      type: event.eventType,
      group: groupOf(event.eventType),
      occurredAt: event.occurredAt,
      actorUserId: event.actorUserId,
      actorAccountNumber: event.actorAccountNumber,
      targetType: event.subjectType,
      targetId: event.subjectId,
      bookId: event.bookId,
      targetLabel: await targetLabel(prisma, event),
      decision: classified.decision,
      reason: classified.reason,
      rollbackRisk: classified.rollbackRisk,
    });
  }
  const counts = {
    total: previewEvents.length,
    auto: previewEvents.filter((event) => event.decision === "auto").length,
    manual: previewEvents.filter((event) => event.decision === "manual").length,
    missingTarget: previewEvents.filter((event) => event.decision === "missing_target").length,
    rollbackRisk: previewEvents.filter((event) => event.rollbackRisk).length,
  };
  const groups: Record<string, { total: number; auto: number; manual: number; missingTarget: number }> = {};
  for (const event of previewEvents) {
    const group = (groups[event.group] ??= { total: 0, auto: 0, manual: 0, missingTarget: 0 });
    group.total += 1;
    if (event.decision === "auto") group.auto += 1;
    if (event.decision === "manual") group.manual += 1;
    if (event.decision === "missing_target") group.missingTarget += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    checkpoint,
    counts,
    groups,
    events: previewEvents,
    notes: [
      "预览不修改目标数据库，也不执行重放。",
      "安全恢复只会自动处理确定目标存在且规则明确的事件；缺失目标和新增管理员授权需人工核验。",
      "恢复旧备份不会恢复备份之后新建的普通账本、交易或其他业务数据。",
      "原始备份直恢复不执行本预览，也不受本预览保护。",
    ],
  };
}

interface Classification {
  readonly decision: "auto" | "manual" | "missing_target";
  readonly reason: string | null;
  readonly rollbackRisk: boolean;
}

async function classifyEvent(prisma: PrismaClient, event: CriticalEventCore): Promise<Classification> {
  const userId = event.subjectId;
  switch (event.eventType) {
    case "account.closed":
    case "account.disabled":
    case "account.enabled":
    case "auth.password_changed":
    case "auth.password_reset":
    case "auth.recovery_code_rotated":
    case "auth.recovery_code_used":
    case "auth.sessions_revoked": {
      if (userId === null) return { decision: "manual", reason: "缺少账号 UUID", rollbackRisk: false };
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      return user === null
        ? { decision: "missing_target", reason: "恢复快照中不存在该账号", rollbackRisk: false }
        : { decision: "auto", reason: null, rollbackRisk: event.eventType === "account.enabled" };
    }
    case "book.deleted": {
      if (event.bookId === null) return { decision: "manual", reason: "缺少账本 UUID", rollbackRisk: false };
      const book = await prisma.book.findUnique({ where: { id: event.bookId }, select: { id: true } });
      if (book !== null) return { decision: "auto", reason: null, rollbackRisk: false };
      const tombstone = await prisma.bookTombstone.findUnique({ where: { bookId: event.bookId } });
      return tombstone !== null
        ? { decision: "auto", reason: "快照中已无该账本，无需重复删除", rollbackRisk: false }
        : { decision: "missing_target", reason: "恢复快照中不存在该账本", rollbackRisk: false };
    }
    case "book.archived":
    case "book.restored":
    case "book.recovery_approved":
    case "book.disposed":
    case "book.undisposed": {
      if (event.bookId === null) return { decision: "manual", reason: "缺少账本 UUID", rollbackRisk: false };
      const book = await prisma.book.findUnique({ where: { id: event.bookId }, select: { id: true } });
      if (book === null) return { decision: "missing_target", reason: "恢复快照中不存在该账本", rollbackRisk: false };
      if (event.eventType === "book.recovery_approved") {
        const targetId = (event.afterState as Record<string, unknown> | null)?.["targetUserId"];
        if (typeof targetId !== "string") return { decision: "manual", reason: "恢复审批缺少目标账号", rollbackRisk: false };
        const [target, membership] = await Promise.all([
          prisma.user.findUnique({ where: { id: targetId }, select: { closedAt: true } }),
          prisma.bookMember.findUnique({
            where: { bookId_userId: { bookId: event.bookId, userId: targetId } },
            select: { leftAt: true },
          }),
        ]);
        if (target === null || target.closedAt !== null || membership === null || membership.leftAt !== null) {
          return { decision: "manual", reason: "恢复审批的目标账号或成员关系不可用", rollbackRisk: true };
        }
      }
      return { decision: "auto", reason: null, rollbackRisk: event.eventType === "book.restored" };
    }
    case "book.manager_changed": {
      const managerId = (event.afterState as Record<string, unknown> | null)?.["managedByUserId"];
      if (typeof managerId !== "string") return { decision: "manual", reason: "缺少目标管理者 UUID", rollbackRisk: false };
      const [book, manager, membership] = await Promise.all([
        event.bookId === null ? null : prisma.book.findUnique({ where: { id: event.bookId }, select: { id: true } }),
        prisma.user.findUnique({ where: { id: managerId }, select: { closedAt: true } }),
        event.bookId === null
          ? null
          : prisma.bookMember.findUnique({
              where: { bookId_userId: { bookId: event.bookId, userId: managerId } },
              select: { leftAt: true },
            }),
      ]);
      if (book === null || manager === null || manager.closedAt !== null || membership === null || membership.leftAt !== null) {
        return { decision: "manual", reason: "目标管理者或账本不存在/不可用", rollbackRisk: true };
      }
      return { decision: "auto", reason: null, rollbackRisk: true };
    }
    case "member.left":
    case "member.removed":
    case "member.role_changed":
    case "member.rejoined": {
      const parsed = parseMembership(event.subjectId);
      if (parsed === null) return { decision: "manual", reason: "成员关系标识不完整", rollbackRisk: false };
      const [membership, user, book] = await Promise.all([
        prisma.bookMember.findUnique({
          where: { bookId_userId: { bookId: parsed.bookId, userId: parsed.userId } },
          select: { leftAt: true },
        }),
        prisma.user.findUnique({ where: { id: parsed.userId }, select: { id: true } }),
        prisma.book.findUnique({ where: { id: parsed.bookId }, select: { id: true } }),
      ]);
      if (user === null || book === null) return { decision: "missing_target", reason: "账号或账本不在恢复快照中", rollbackRisk: false };
      if (membership === null) return { decision: "manual", reason: "成员关系不在恢复快照中", rollbackRisk: true };
      return { decision: "auto", reason: null, rollbackRisk: event.eventType === "member.rejoined" || event.eventType === "member.role_changed" };
    }
    case "invite.revoked":
    case "share_link.revoked": {
      const exists =
        event.eventType === "invite.revoked"
          ? event.subjectId === null
            ? null
            : await prisma.registrationInvite.findUnique({ where: { id: event.subjectId }, select: { id: true } })
          : event.subjectId === null
            ? null
            : await prisma.bookShareLink.findUnique({ where: { id: event.subjectId }, select: { id: true } });
      return exists === null
        ? { decision: "auto", reason: "快照中不存在该凭据/链接，无需撤销", rollbackRisk: false }
        : { decision: "auto", reason: null, rollbackRisk: false };
    }
    case "admin.revoked":
      if (userId === null) return { decision: "manual", reason: "缺少账号 UUID", rollbackRisk: false };
      return (await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })) === null
        ? { decision: "missing_target", reason: "恢复快照中不存在该账号", rollbackRisk: false }
        : { decision: "auto", reason: null, rollbackRisk: false };
    case "admin.granted":
    case "admin.allowlist_changed":
      return { decision: "manual", reason: "安全恢复不自动重新授予管理员权限", rollbackRisk: true };
    case "book.created":
    case "account.created":
      return { decision: "missing_target", reason: "恢复快照缺少该对象；不会凭事件重建", rollbackRisk: false };
    case "agreement.accepted":
      return { decision: "manual", reason: "协议接受记录需人工核验", rollbackRisk: false };
    default:
      return { decision: "manual", reason: "未安全支持的 P1 事件，需人工核查", rollbackRisk: true };
  }
}

function groupOf(type: string): RestorePreviewEvent["group"] {
  if (type.startsWith("account.")) return "account";
  if (type.startsWith("book.")) return "book";
  if (type.startsWith("member.")) return "membership";
  if (type.startsWith("auth.")) return "auth";
  if (type.startsWith("invite.") || type.startsWith("share_link.") || type.startsWith("admin.")) return "invite_share_admin";
  if (type.startsWith("agreement.") || type.startsWith("retention.")) return "consent";
  return "other";
}

async function targetLabel(prisma: PrismaClient, event: CriticalEventCore): Promise<string | null> {
  if (event.bookId !== null) {
    const book = await prisma.book.findUnique({ where: { id: event.bookId }, select: { bookNumber: true } });
    if (book?.bookNumber != null) return `book:${book.bookNumber}`;
  }
  const parsed = parseMembership(event.subjectId);
  if (parsed !== null) {
    const user = await prisma.user.findUnique({ where: { id: parsed.userId }, select: { accountNumber: true } });
    if (user?.accountNumber != null) return `account:${user.accountNumber}`;
  }
  if (event.subjectId !== null && /^[0-9a-f-]{36}$/.test(event.subjectId)) {
    const user = await prisma.user.findUnique({ where: { id: event.subjectId }, select: { accountNumber: true } });
    if (user?.accountNumber != null) return `account:${user.accountNumber}`;
  }
  return null;
}

function parseMembership(value: string | null): { bookId: string; userId: string } | null {
  if (value === null) return null;
  const [bookId, userId] = value.split(":");
  return bookId && userId ? { bookId, userId } : null;
}
