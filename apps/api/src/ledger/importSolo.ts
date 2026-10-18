import {
  fingerprintGuestSource,
  fingerprintTargetSnapshot,
  type GuestImportSource,
  type ImportTargetSnapshot,
} from "@libellum/shared";

import type { PrismaClient } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { forbidden, badRequest, gone, notFound } from "../lib/errors.js";
import { loadTargetSnapshot } from "./importTarget.js";

/**
 * S14-D D4：正式账本 B → 正式单人账本 A。
 *
 * ⚠️ 这是**新增**的资格判断，不修改任何既有 S13 权限 helper，也不改变 D2 的游客目标判断。
 * D4 要求 B 和 A 都真正是当前账号独立拥有的单人账本：
 * - `book_members` 中当前（leftAt 为空）只有本人；
 * - 本人是 createdBy；
 * - 没有待接受、仍在有效期内的账本邀请；
 * - 没有仍可使用的分享链接（也是“尚可接受的协作邀请”）；
 * - 账本未归档、未弃置、未进入永久删除。
 *
 * 预览路由在事务外做一次检查；提交事务内会在锁定成员/邀请/分享表与两本账本行之后**重新检查**，
 * 避免预览到提交之间有人接受邀请或新增成员的 TOCTOU。
 */
export type ImportDbClient = Prisma.TransactionClient | PrismaClient;

export interface SoloImportBookSnapshot {
  readonly bookId: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly snapshot: ImportTargetSnapshot;
}

export interface FormalImportPair {
  readonly source: GuestImportSource;
  readonly sourceBookId: string;
  readonly sourceBookName: string;
  readonly sourceBookNumber: string | null;
  readonly sourceFingerprint: string;
  readonly target: ImportTargetSnapshot;
  readonly targetBookId: string;
  readonly targetBookName: string;
  readonly targetBookNumber: string | null;
  readonly targetFingerprint: string;
}

function label(purpose: "来源" | "目标"): string {
  return purpose;
}

function assertNormalBook(
  book: {
    id: string;
    createdBy: string;
    disposedAt: Date | null;
    archivedAt: Date | null;
    purgeStartedAt: Date | null;
  },
  userId: string,
  purpose: "来源" | "目标",
): void {
  if (book.disposedAt !== null || book.purgeStartedAt !== null) {
    throw gone("book_deleted", `${label(purpose)}账本已经被删除，不能参与导入。`);
  }
  if (book.archivedAt !== null) {
    throw forbidden("book_archived", `${label(purpose)}账本已归档，不能参与导入。`);
  }
  if (book.createdBy !== userId) {
    throw forbidden("book_not_owner", `${label(purpose)}账本必须由当前账号创建。`);
  }
}

/**
 * 读取一本账本并验证 D4 单人资格；返回的 snapshot 是服务器此刻的真实状态。
 *
 * 分享链接的“仍有效”按 `createdAt + days`、未撤销、未满员实时计算；邀请按 pending 且
 * `expiresAt > now` 判断。历史成员（leftAt 非空）和已决定/过期邀请不会永久阻止导入。
 */
export async function loadSoloImportBook(
  client: ImportDbClient,
  userId: string,
  bookId: string,
  purpose: "来源" | "目标",
  now: Date = new Date(),
): Promise<SoloImportBookSnapshot> {
  const book = await client.book.findUnique({
    where: { id: bookId },
    select: {
      id: true,
      name: true,
      bookNumber: true,
      createdBy: true,
      archivedAt: true,
      disposedAt: true,
      purgeStartedAt: true,
      members: {
        where: { leftAt: null },
        select: { userId: true, role: true },
      },
      invitations: {
        where: {
          kind: "book_invite",
          status: "pending",
          expiresAt: { gt: now },
        },
        select: { id: true },
      },
      shareLinks: {
        where: { revokedAt: null },
        select: { createdAt: true, days: true, maxUses: true, useCount: true },
      },
    },
  });

  if (book === null) throw notFound("book_not_found", `${label(purpose)}账本不存在。`);
  assertNormalBook(book, userId, purpose);

  const membership = book.members.find((member) => member.userId === userId);
  if (membership === undefined) {
    throw forbidden("book_forbidden", `无权访问${label(purpose)}账本。`);
  }
  if (membership.role === "viewer") {
    throw forbidden("book_read_only", `你对${label(purpose)}账本只有查看权限。`);
  }
  if (book.members.length !== 1 || book.members[0]?.userId !== userId) {
    throw forbidden(
      "book_not_solo",
      `${label(purpose)}账本必须只有当前账号一个有效成员（只读成员也不行）。`,
    );
  }
  if (book.invitations.length > 0) {
    throw forbidden("book_has_pending_invite", `${label(purpose)}账本还有待接受的协作邀请，不能参与导入。`);
  }
  const activeShareLinks = book.shareLinks.filter((link) => {
    const expiresAt = new Date(link.createdAt.getTime() + link.days * 24 * 60 * 60 * 1000);
    return expiresAt.getTime() > now.getTime() && link.useCount < link.maxUses;
  });
  if (activeShareLinks.length > 0) {
    throw forbidden(
      "book_has_active_share_link",
      `${label(purpose)}账本还有可用的分享链接，不能参与导入。请先撤销分享链接。`,
    );
  }

  const snapshot = await loadTargetSnapshot(client, bookId);
  return { bookId: book.id, name: book.name, bookNumber: book.bookNumber, snapshot };
}

function snapshotToGuestSource(name: string, snapshot: ImportTargetSnapshot): GuestImportSource {
  return {
    name,
    categories: snapshot.categories.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      description: item.description,
      sortOrder: item.sortOrder,
      isArchived: item.isArchived,
      isSystem: item.isSystem,
    })),
    paymentMethods: snapshot.paymentMethods.map((item) => ({
      id: item.id,
      name: item.name,
      sortOrder: item.sortOrder,
      isArchived: item.isArchived,
    })),
    tags: snapshot.tags.map((item) => ({ id: item.id, name: item.name, color: item.color })),
    transactions: snapshot.transactions.map((item) => ({
      id: item.id,
      kind: item.kind,
      amountCents: item.amountCents,
      currency: item.currency,
      categoryId: item.categoryId,
      paymentMethodId: item.paymentMethodId,
      occurredAt: item.occurredAt,
      occurredLocalDate: item.occurredLocalDate,
      occurredTz: item.occurredTz,
      note: item.note,
      tagIds: item.tagIds,
    })),
  };
}

/**
 * 读取并校验 D4 的两本正式账本，计算与浏览器预览使用同一套 canonical 指纹。
 *
 * ⚠️ 来源也由服务器读取，客户端只拿 fingerprint；提交时客户端传 sourceBookId，服务端再读一次，
 * 不信任浏览器里的旧来源快照。
 */
export async function loadFormalImportPair(
  client: ImportDbClient,
  userId: string,
  sourceBookId: string,
  targetBookId: string,
  now: Date = new Date(),
): Promise<FormalImportPair> {
  if (sourceBookId === targetBookId) {
    throw badRequest("book_source_same_as_target", "来源账本和目标账本不能相同。");
  }

  const [sourceBook, targetBook] = await Promise.all([
    loadSoloImportBook(client, userId, sourceBookId, "来源", now),
    loadSoloImportBook(client, userId, targetBookId, "目标", now),
  ]);

  const source = snapshotToGuestSource(sourceBook.name, sourceBook.snapshot);
  const sourceFingerprint = await fingerprintGuestSource(source);
  const targetFingerprint = await fingerprintTargetSnapshot(targetBook.snapshot);

  return {
    source,
    sourceBookId: sourceBook.bookId,
    sourceBookName: sourceBook.name,
    sourceBookNumber: sourceBook.bookNumber,
    sourceFingerprint,
    target: targetBook.snapshot,
    targetBookId: targetBook.bookId,
    targetBookName: targetBook.name,
    targetBookNumber: targetBook.bookNumber,
    targetFingerprint,
  };
}

/**
 * 提交事务内使用的 TOCTOU 防护。
 *
 * ⚠️ 只锁 `book_members` / `notifications` / `book_share_links` 三张表，并锁住两本账本行；
 * 这样在导入事务进行期间，接受邀请、加入、移除成员、生成/撤销分享链接都会被阻塞；事务结束自动释放。
 * 这里不修改既有邀请/权限代码，只让并发写等一会儿。代价是这些表的写入在整个导入事务期间会排队，
 * 这是为 D4 选择的安全优先方案。
 */
export async function lockFormalImportPair(
  tx: Prisma.TransactionClient,
  sourceBookId: string,
  targetBookId: string,
): Promise<void> {
  await tx.$executeRawUnsafe(
    'LOCK TABLE "book_members", "notifications", "book_share_links" IN SHARE ROW EXCLUSIVE MODE',
  );
  await tx.$queryRaw`
    SELECT "id"
    FROM "books"
    WHERE "id" IN (${sourceBookId}::uuid, ${targetBookId}::uuid)
    ORDER BY "id"
    FOR UPDATE
  `;
  /**
   * 锁住两本账本现有的有效账目行（FOR SHARE：本事务稍后软删除 A 时仍可自己升级写锁）。
   * 这样来源/目标账目在导入事务内的编辑、删除会被阻塞；新账目需要更新 books.next_transaction_seq，
   * 已被上面的账本行锁阻塞。分类/标签的并发编辑仍由指纹校验兜底，不在首个 D4 版本扩大锁范围。
   */
  await tx.$queryRaw`
    SELECT "id"
    FROM "transactions"
    WHERE "book_id" IN (${sourceBookId}::uuid, ${targetBookId}::uuid)
      AND "deleted_at" IS NULL
    ORDER BY "book_id", "id"
    FOR SHARE
  `;
}

/** D4 的预览响应；不写任何数据。 */
export async function loadFormalImportPreview(
  client: ImportDbClient,
  userId: string,
  sourceBookId: string,
  targetBookId: string,
): Promise<{
  sourceBook: { id: string; name: string; bookNumber: string | null };
  targetBook: { id: string; name: string; bookNumber: string | null };
  source: GuestImportSource;
  sourceFingerprint: string;
  target: ImportTargetSnapshot;
  targetFingerprint: string;
}> {
  const pair = await loadFormalImportPair(client, userId, sourceBookId, targetBookId);
  return {
    sourceBook: { id: pair.sourceBookId, name: pair.sourceBookName, bookNumber: pair.sourceBookNumber },
    targetBook: { id: pair.targetBookId, name: pair.targetBookName, bookNumber: pair.targetBookNumber },
    source: pair.source,
    sourceFingerprint: pair.sourceFingerprint,
    target: pair.target,
    targetFingerprint: pair.targetFingerprint,
  };
}
