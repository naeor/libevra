import type { PrismaClient } from "../db.js";
import { recordCriticalEvent } from "../critical/store.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { bookAdminId, type AssignableRole } from "../ledger/access.js";

/**
 * Members of one ledger: who is in it, what they may do, and how somebody leaves.
 *
 * ⚠️ **This is a ledger relationship, not a social one.** The owner drew that line himself:
 * *"这里的关系**始终是账本成员关系**，而不是微信或 QQ 那样的**全局社交好友关系**"* and
 * *"**成员管理必须明确属于当前账本。** 用户可能同时参与几本不同的共享账本，而每本账的成员都可能不同."*
 *
 * ⚠️ **So everything here takes a `bookId` and answers about that book only.** A "collaborator"
 * (account-level) is a different thing with a different list — see `routes/collab.ts`.
 */

export type MemberRole = "owner" | "editor" | "recorder" | "viewer";

export interface MemberView {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarId: string;
  readonly username: string;
  readonly accountNumber: string;
  readonly role: MemberRole;
  readonly isCreator: boolean;
  /** 1.19.56：这本账的管理员（只有一位）。管理员不能被移出，权限固定为“编辑全部”。 */
  readonly isAdmin: boolean;
}

export async function listMembers(prisma: PrismaClient, bookId: string): Promise<MemberView[]> {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { createdBy: true },
  });

  if (!book) throw notFound("book_missing", "找不到这本账。");

  /**
   * ⚠️ **`leftAt: null`, or the list includes people who left.** The same filter the permission
   * guard uses — **a member list that shows somebody the guard refuses is a list that lies about
   * what they can do.**
   */
  const rows = await prisma.bookMember.findMany({
    where: { bookId, leftAt: null },
    orderBy: { joinedAt: "asc" },
    select: {
      role: true,
      user: { select: { id: true, displayName: true, avatarId: true, username: true, accountNumber: true } },
    },
  });

  const admin = await bookAdminId(prisma, bookId);

  return rows.map((row) => ({
    userId: row.user.id,
    displayName: row.user.displayName,
    avatarId: row.user.avatarId,
    username: row.user.username,
    accountNumber: row.user.accountNumber,
    role: row.role,
    isCreator: row.user.id === book.createdBy,
    isAdmin: row.user.id === admin,
  }));
}

/**
 * Change what one member may do.
 *
 * ⚠️ **1.19.56：只有管理员能调用（路由用 `requireBookAdmin`），管理员自己的权限不能改**——管理员固定是
 * “编辑全部”。原来“创建者不能被降为仅查看”的保护换成管理员：管理员默认就是创建者，管理员在，这本账就有人能管理。
 */
export async function changeMemberRole(
  prisma: PrismaClient,
  bookId: string,
  targetUserId: string,
  role: AssignableRole,
  options: { readonly requestId?: string | null } = {},
): Promise<{ readonly changed: boolean; readonly previousRole: MemberRole }> {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { createdBy: true } });
  if (!book) throw notFound("book_missing", "找不到这本账。");

  if ((await bookAdminId(prisma, bookId)) === targetUserId) {
    throw badRequest("admin_role_fixed", "管理员的权限固定为“编辑全部”，不能修改。");
  }

  const membership = await prisma.bookMember.findUnique({
    where: { bookId_userId: { bookId, userId: targetUserId } },
    select: { role: true, leftAt: true },
  });

  if (!membership || membership.leftAt !== null) {
    throw notFound("member_missing", "这个人不在这本账里。");
  }

  if (membership.role === role) return { changed: false, previousRole: membership.role };

  return prisma.$transaction(async (tx) => {
    await tx.bookMember.update({
      where: { bookId_userId: { bookId, userId: targetUserId } },
      data: { role },
    });
    await recordCriticalEvent(tx, {
      type: "member.role_changed",
      actor: { userId: null },
      subjectType: "membership",
      subjectId: `${bookId}:${targetUserId}`,
      bookId,
      beforeState: { role: membership.role },
      afterState: { role },
      requestId: options.requestId ?? null,
    });
    return { changed: true, previousRole: membership.role };
  });
}

/**
 * Remove somebody from a ledger.
 *
 * ⚠️ **A `leftAt` timestamp, not a deleted row** — identical to `leaveBook`. The row is what the
 * permission guard checks, and it is also the record that **this person was once here**, which is
 * what answers "why are their old entries still in my ledger".
 *
 * ⚠️ **The admin cannot be removed** (1.19.56; this used to protect the creator, who is the admin
 * by default): a ledger must always have someone who can manage its members.
 *
 * ⚠️ **Removing yourself is refused too**, and the reason is not symmetry: *"leave"* is a thing a
 * person does to themselves from their own screen, and **doing it through the member list means one
 * tap has no confirmation path.** The route for it is `POST /books/:bookId/leave`.
 */
export async function removeMember(
  prisma: PrismaClient,
  bookId: string,
  targetUserId: string,
  actorId: string,
  now: Date = new Date(),
  requestId?: string | null,
): Promise<{ readonly removed: boolean }> {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { createdBy: true } });
  if (!book) throw notFound("book_missing", "找不到这本账。");

  /** 1.19.56：管理员不能被移出（原来保护的是创建者；管理员默认就是创建者）。 */
  if ((await bookAdminId(prisma, bookId)) === targetUserId) {
    throw badRequest("admin_cannot_be_removed", "管理员不能被移出这本账。");
  }

  if (targetUserId === actorId) {
    throw badRequest("remove_self", "不能用移除的方式让自己离开，请用「退出这本账」。");
  }

  const membership = await prisma.bookMember.findUnique({
    where: { bookId_userId: { bookId, userId: targetUserId } },
    select: { leftAt: true },
  });

  if (!membership || membership.leftAt !== null) {
    throw forbidden("member_missing", "这个人不在这本账里。");
  }

  await prisma.$transaction(async (tx) => {
    await tx.bookMember.update({
      where: { bookId_userId: { bookId, userId: targetUserId } },
      data: { leftAt: now },
    });
    await recordCriticalEvent(tx, {
      type: "member.removed",
      actor: { userId: actorId },
      subjectType: "membership",
      subjectId: `${bookId}:${targetUserId}`,
      bookId,
      beforeState: { leftAt: null },
      afterState: { leftAt: now.toISOString(), removedBy: actorId },
      requestId: requestId ?? null,
    });
  });

  return { removed: true };
}
