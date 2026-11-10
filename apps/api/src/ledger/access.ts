import { UNCATEGORISED_NAME, type TransactionKind } from "@libellum/shared";
import type { FastifyRequest } from "fastify";

import type { PrismaClient } from "../db.js";
import type { BookRole } from "../generated/prisma/enums.js";
import { forbidden, gone, notFound, type AppError } from "../lib/errors.js";

/**
 * Authorization for ledger data.
 *
 * The rule, in one line: **permission comes from `book_members` and from
 * nothing else.** A user id, book id or role sent by a client is treated as a
 * hint at most — never as a claim. Every read and every write goes through
 * these helpers first.
 */

/** Throws 403 unless this user is a member of this book. */
export async function requireBookAccess(
  prisma: PrismaClient,
  userId: string,
  bookId: string,
): Promise<void> {
  const membership = await prisma.bookMember.findUnique({
    where: { bookId_userId: { bookId, userId } },
    select: { role: true, leftAt: true },
  });

  if (!membership || membership.leftAt !== null) {
    // 403, not 404: the caller is authenticated and simply has no business
    // here. Returning 404 would leak which book ids exist.
    throw forbidden("book_forbidden", "无权访问该账本。");
  }
}

/**
 * The book this request is about, and what the caller may do in it.
 *
 * ⚠️ **This replaces `currentBookId`, which asked the database "which book does this user
 * have?"** — a question that had exactly one answer while an account could only have one book,
 * and has several now. It returned the *oldest* membership, so with two books every route
 * without a header would quietly operate on whichever book was joined first.
 *
 * ⚠️ **The header is the client's declaration, never its permission.** It says which book the
 * request is about; whether the caller may touch that book is decided here, by looking at
 * `book_members` — the same rule as before: *"permission comes from `book_members` and from
 * nothing else."*
 *
 * ⚠️ **`leftAt: null` is part of the membership test.** A row stays behind when somebody leaves
 * (that is how leaving is recorded), so a membership that exists is not the same as a
 * membership that is current. **Reading `book_members` without this filter would let a person
 * who left a ledger keep writing in it** — the row is still there.
 */
export interface BookContext {
  readonly bookId: string;
  readonly role: BookRole;
}

/**
 * ⚠️ `owner` is not one of the roles any more, but the enum value still exists in the database; it
 * is treated as `editor` (编辑全部) — the safe direction for the rows the migration converted.
 */
const WRITE_ROLES: readonly BookRole[] = ["editor", "owner"];

/**
 * **账本权限分级（所有者 2026-11-10 决定，1.19.56）**：从低到高 只读 `viewer` → 记账 `recorder` →
 * 编辑全部 `editor`；另有每本账一位**管理员**（`Book.managedByUserId`，默认是创建者，本人是编辑全部）。
 *
 * - 只读：查看账目、分析、编辑历史，发留言，导出（导出与查看同一权限）。
 * - 记账：另外可以记账（含拍照、语音、导入），修改 / 删除**自己记的**账目，新增分类、标签、支付方式（不能修改）。
 * - 编辑全部：修改 / 删除所有账目，修改分类、标签、支付方式，改账本名。
 * - 管理员：修改其他成员的权限、移出成员、设置“只有管理员能邀请”。
 * - 邀请：默认所有成员都能邀请，被邀请的人权限不能高于邀请人；管理员打开“只有管理员能邀请”后只有管理员能邀请。
 */
export const ROLE_RANK: Readonly<Record<BookRole, number>> = { viewer: 0, recorder: 1, editor: 2, owner: 2 };
/** 可以分配给成员的三档（管理员不是角色，是账本上的一个位置）。 */
export type AssignableRole = "viewer" | "recorder" | "editor";
export const ASSIGNABLE_ROLES: readonly AssignableRole[] = ["viewer", "recorder", "editor"];

export function canRecord(role: BookRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.recorder;
}

export function canEditAll(role: BookRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.editor;
}

/** 能不能修改 / 删除 / 恢复这一笔：编辑全部可以改所有账目，记账只能改自己记的（`Transaction.userId`）。 */
export function canEditEntry(role: BookRole, userId: string, recorderId: string): boolean {
  return canEditAll(role) || (canRecord(role) && recorderId === userId);
}

export function requireEntryEditable(context: BookContext, userId: string, recorderId: string): void {
  if (canEditEntry(context.role, userId, recorderId)) return;
  if (!canRecord(context.role)) throw forbidden("book_read_only", "你是这本账的只读成员，不能修改账目。");
  throw forbidden("entry_not_yours", "你只能修改自己记的账目。");
}

export function requireEditAll(context: BookContext): void {
  if (canEditAll(context.role)) return;
  if (!canRecord(context.role)) throw forbidden("book_read_only", "你是这本账的只读成员，不能修改它。");
  throw forbidden("book_edit_all_required", "只有“编辑全部”的成员才能这样做。");
}

/**
 * 这本账的管理员：`managedByUserId`；没有记录时（旧数据、管理员账号已不存在）退回创建者。
 * 只认当前仍是成员的人。
 */
export async function bookAdminId(prisma: Pick<PrismaClient, "book" | "bookMember">, bookId: string): Promise<string | null> {
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { managedByUserId: true, createdBy: true } });
  if (book === null) return null;
  const candidate = book.managedByUserId ?? book.createdBy;
  const membership = await prisma.bookMember.findUnique({ where: { bookId_userId: { bookId, userId: candidate } }, select: { leftAt: true } });
  return membership !== null && membership.leftAt === null ? candidate : null;
}

export async function requireBookAdmin(prisma: PrismaClient, request: FastifyRequest, userId: string): Promise<BookContext> {
  const context = await requireBook(prisma, request, userId);
  if ((await bookAdminId(prisma, context.bookId)) !== userId) {
    throw forbidden("book_admin_required", "只有这本账的管理员才能这样做。");
  }
  return context;
}

/**
 * 能不能以 `role` 邀请别人：被邀请的人权限不能高于自己；“只有管理员能邀请”打开时只有管理员可以。
 * 邀请链接与站内邀请在**被接受时**还会再问一次（邀请人已经退出、被降级或规则变了，邀请就不再有效）。
 */
export async function inviteProblem(
  prisma: Pick<PrismaClient, "book" | "bookMember">,
  bookId: string,
  inviterId: string,
  role: AssignableRole,
): Promise<AppError | null> {
  const [book, membership] = await Promise.all([
    prisma.book.findUnique({ where: { id: bookId }, select: { inviteAdminOnly: true } }),
    prisma.bookMember.findUnique({ where: { bookId_userId: { bookId, userId: inviterId } }, select: { role: true, leftAt: true } }),
  ]);
  if (book === null || membership === null || membership.leftAt !== null) {
    return forbidden("invite_not_allowed", "邀请人已经不在这本账里，邀请不再有效。");
  }
  if (book.inviteAdminOnly && (await bookAdminId(prisma, bookId)) !== inviterId) {
    return forbidden("invite_admin_only", "这本账只有管理员能邀请他人。");
  }
  if (ROLE_RANK[role] > ROLE_RANK[membership.role]) {
    return forbidden("invite_role_too_high", "邀请的权限不能高于你自己的权限。");
  }
  return null;
}

export async function requireInvite(prisma: PrismaClient, bookId: string, inviterId: string, role: AssignableRole): Promise<void> {
  const problem = await inviteProblem(prisma, bookId, inviterId, role);
  if (problem !== null) throw problem;
}

export async function requireBook(
  prisma: PrismaClient,
  request: FastifyRequest,
  userId: string,
): Promise<BookContext> {
  const declared = readDeclaredBookId(request);

  if (declared === null) return fallbackBook(prisma, userId);

  const membership = await prisma.bookMember.findUnique({
    where: { bookId_userId: { bookId: declared, userId } },
    select: {
      role: true,
      leftAt: true,
      book: {
        select: { archivedAt: true, purgeStartedAt: true },
      },
    },
  });

  /**
   * 403 and not 404, for the reason the old guard already gave: the caller is authenticated and
   * simply has no business here, and answering 404 would tell them which book ids exist.
   *
   * A deleted ledger is deliberately different: 410 `book_deleted` lets an old device stop
   * retrying a queued write and clear that ledger's local copy. The tombstone is the only reason
   * this question can be answered after the book row is gone.
   */
  if (!membership || membership.leftAt !== null) {
    const tombstone = await prisma.bookTombstone.findUnique({
      where: { bookId: declared },
      select: { bookId: true },
    });
    if (tombstone !== null) {
      throw gone("book_deleted", "这本账已经被永久删除。");
    }
    throw forbidden("book_forbidden", "无权访问该账本。");
  }

  if (membership.book.purgeStartedAt !== null) {
    throw gone("book_deleting", "这本账正在永久删除，不能继续同步。");
  }

  if (membership.book.archivedAt !== null) {
    throw forbidden("book_archived", "这本账已经归档，普通账目访问已关闭。");
  }

  return { bookId: declared, role: membership.role };
}

/**
 * The same thing, for a route that changes data.
 *
 * ⚠️ **The check lives on the server because the client's is only a courtesy.** The owner put
 * it plainly: *"即使 viewer 通过某种方式发起了更改，服务器的数据也不会被污染."* A viewer's UI
 * hides the buttons; this is what makes the hiding irrelevant.
 */
export async function requireBookForWrite(
  prisma: PrismaClient,
  request: FastifyRequest,
  userId: string,
): Promise<BookContext> {
  const context = await requireBook(prisma, request, userId);

  if (!WRITE_ROLES.includes(context.role)) {
    if (canRecord(context.role)) throw forbidden("book_edit_all_required", "只有“编辑全部”的成员才能这样做。");
    throw forbidden("book_read_only", "你是这本账的查看者，不能修改它。");
  }

  return context;
}

/** 记账强度（1.19.56）：记账、编辑全部可以；只读不可以。新增账目、导入、语音、新增分类 / 标签 / 支付方式用它。 */
export async function requireBookForRecord(
  prisma: PrismaClient,
  request: FastifyRequest,
  userId: string,
): Promise<BookContext> {
  const context = await requireBook(prisma, request, userId);
  if (!canRecord(context.role)) throw forbidden("book_read_only", "你是这本账的只读成员，不能记账。");
  return context;
}

/**
 * The ledger id the client declared, or `null` when it declared none.
 *
 * ⚠️ **A header rather than a path segment**, which the owner chose deliberately: the ledger a
 * change belongs to has to be fixed *when the change is made*, and a header is written by the
 * one shared client wrapper, so no screen can forget it. See `apps/web/src/lib/api.ts`.
 */
function readDeclaredBookId(request: FastifyRequest): string | null {
  const raw = request.headers["x-libellum-book"];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * What to do when the client declared no ledger.
 *
 * ⚠️ **This is a compatibility path, and it is deliberately temporary.** Every client that
 * exists today sends the header, so in practice this is only reached by an old cached bundle or
 * by a test that deliberately omits it. Until the ledger list ships, refusing the request would
 * break the whole application; answering with the oldest membership is exactly what the code
 * did before, so **nothing changes for the accounts that exist today.**
 *
 * ⚠️ **It falls back rather than guessing silently, and the request is logged.** When this path
 * is exercised in production it means a client is out of date, and that is worth seeing.
 */
async function fallbackBook(prisma: PrismaClient, userId: string): Promise<BookContext> {
  const membership = await prisma.bookMember.findFirst({
    where: {
      userId,
      leftAt: null,
      book: { is: { archivedAt: null, purgeStartedAt: null } },
    },
    orderBy: { joinedAt: "asc" },
    select: { bookId: true, role: true },
  });

  if (!membership) throw notFound("book_missing", "找不到你的账本。");

  return { bookId: membership.bookId, role: membership.role };
}

/**
 * The book this account owns.
 *
 * @deprecated Superseded by `requireBook`, which answers the same question with the ledger the
 * request actually named. Kept only while the last callers are migrated; **do not add new ones**
 * — with more than one book this returns the oldest membership, which is a silent wrong answer.
 */
export async function currentBookId(prisma: PrismaClient, userId: string): Promise<string> {
  const membership = await prisma.bookMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    select: { bookId: true },
  });

  if (!membership) {
    throw notFound("book_missing", "找不到你的账本。");
  }

  return membership.bookId;
}

/**
 * Pick the category an entry should be filed under.
 *
 * A chosen category must belong to the same book and the same kind — otherwise
 * an income entry could be filed under 餐饮, and totals per category would be
 * nonsense.
 *
 * **An empty value is not an error.** "Not chosen" is the ordinary case, and the
 * owner put the reason plainly: 暂无分类 is itself a category, so an entry with
 * no choice still belongs in the ledger. It falls back to the book's hidden
 * system category for that kind, which is why `category_id` can stay mandatory.
 *
 * The two failure modes are reported **separately**, and that came from a real
 * complaint. One message used to cover both: "分类不存在或不属于该账本". When the
 * actual problem was that a ¥ expense category had been sent with an income
 * entry, that message was simply untrue — the category existed, and it did
 * belong to the book — and it sent the reader looking for a permissions problem
 * that was not there. A message that describes the wrong fault is worse than no
 * message, because it is believed.
 */
export async function resolveCategoryId(
  prisma: PrismaClient,
  bookId: string,
  kind: TransactionKind,
  requested: string | null | undefined,
): Promise<string> {
  // `""` means the same as absent. A `<select>` with an empty option hands back
  // an empty string, and the client should not have to know that.
  if (requested !== null && requested !== undefined && requested !== "") {
    const category = await prisma.category.findFirst({
      where: { id: requested, bookId },
      select: { id: true, kind: true, name: true, isSystem: true },
    });

    if (category === null) {
      throw forbidden("category_invalid", "这个分类不在这本账里，可能已被删除。");
    }

    if (category.kind !== kind) {
      // The other kind's 暂无分类 is not a mismatch worth failing over: the
      // person did not choose a category at all, so there is nothing to correct.
      // Anything else is a genuine inconsistency between the type and the
      // category, and it is named as such.
      const wantIncome = category.kind === "income";

      if (!category.isSystem) {
        throw forbidden(
          "category_kind_mismatch",
          `「${category.name}」属于${wantIncome ? "收入" : "支出"}分类，和这笔记账的收支类型不一致。`,
        );
      }
    } else {
      return category.id;
    }
  }

  const fallback = await prisma.category.findFirst({
    where: { bookId, kind, name: UNCATEGORISED_NAME, isSystem: true },
    select: { id: true },
  });

  if (!fallback) throw notFound("uncategorised_missing", "账本数据不完整，缺少默认分类。");

  return fallback.id;
}

/** A payment method must belong to the book it is used in. */
export async function resolvePaymentMethodId(
  prisma: PrismaClient,
  bookId: string,
  requested: string | null | undefined,
): Promise<string | null> {
  if (!requested) return null;

  const method = await prisma.paymentMethod.findFirst({
    where: { id: requested, bookId },
    select: { id: true },
  });

  if (!method) throw forbidden("payment_method_invalid", "支付方式不存在或不属于该账本。");

  return method.id;
}

/** Every tag must belong to the book; tags are deduplicated first. */
export async function resolveTagIds(
  prisma: PrismaClient,
  bookId: string,
  requested: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(requested)];

  if (unique.length === 0) return [];

  const found = await prisma.tag.findMany({
    where: { id: { in: unique }, bookId },
    select: { id: true },
  });

  if (found.length !== unique.length) {
    throw forbidden("tag_invalid", "标签不存在或不属于该账本。");
  }

  return unique;
}
