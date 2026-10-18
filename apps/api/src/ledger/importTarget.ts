import type { Prisma } from "../generated/prisma/client.js";
import type {
  GuestImportCategory,
  GuestImportPaymentMethod,
  GuestImportTag,
  GuestImportTransaction,
  ImportTargetSnapshot,
} from "@libellum/shared";

import type { PrismaClient } from "../db.js";
import { forbidden, gone, notFound } from "../lib/errors.js";

/**
 * D2 的目标账本快照与权限检查。
 *
 * 只允许“本人创建、当前只有本人一个活跃成员”的单人正式账本；这与 D1 的 UI 过滤一致，但服务端才是
 * 真正的权限边界。D2 不删除目标 A 的任何记录，因此这里只需要读。
 */
export type ImportDbClient = Prisma.TransactionClient | PrismaClient;

function fromDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toCategory(row: {
  id: string;
  name: string;
  kind: "expense" | "income";
  description: string | null;
  sortOrder: number;
  isArchived: boolean;
  isSystem: boolean;
}): GuestImportCategory {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    description: row.description,
    sortOrder: row.sortOrder,
    isArchived: row.isArchived,
    isSystem: row.isSystem,
  };
}

function toPaymentMethod(row: {
  id: string;
  name: string;
  sortOrder: number;
  isArchived: boolean;
}): GuestImportPaymentMethod {
  return { id: row.id, name: row.name, sortOrder: row.sortOrder, isArchived: row.isArchived };
}

function toTag(row: { id: string; name: string; color: string }): GuestImportTag {
  return { id: row.id, name: row.name, color: row.color };
}

/**
 * Read the exact target state the browser saw. **Every field that can affect mapping or duplicate
 * detection is included**, because the fingerprint derived from this is the only thing that stops
 * a stale preview from being submitted after somebody added or edited an entry in another tab.
 */
export async function loadTargetSnapshot(client: ImportDbClient, bookId: string): Promise<ImportTargetSnapshot> {
  const [book, categories, paymentMethods, tags, transactions] = await Promise.all([
    client.book.findUnique({
      where: { id: bookId },
      select: { id: true, name: true, bookNumber: true },
    }),
    client.category.findMany({
      where: { bookId },
      select: {
        id: true,
        name: true,
        kind: true,
        description: true,
        sortOrder: true,
        isArchived: true,
        isSystem: true,
      },
    }),
    client.paymentMethod.findMany({
      where: { bookId },
      select: { id: true, name: true, sortOrder: true, isArchived: true },
    }),
    client.tag.findMany({ where: { bookId }, select: { id: true, name: true, color: true } }),
    client.transaction.findMany({
      where: { bookId, deletedAt: null },
      select: {
        id: true,
        version: true,
        kind: true,
        amountCents: true,
        currency: true,
        categoryId: true,
        paymentMethodId: true,
        occurredAt: true,
        occurredLocalDate: true,
        occurredTz: true,
        note: true,
        tags: { select: { tagId: true } },
      },
    }),
  ]);

  if (book === null) throw notFound("book_not_found", "目标账本不存在。");

  return {
    bookId: book.id,
    name: book.name,
    bookNumber: book.bookNumber,
    categories: categories.map(toCategory),
    paymentMethods: paymentMethods.map(toPaymentMethod),
    tags: tags.map(toTag),
    transactions: transactions.map(
      (row): ImportTargetSnapshot["transactions"][number] => ({
        id: row.id,
        version: row.version,
        kind: row.kind,
        amountCents: Number(row.amountCents),
        currency: row.currency as GuestImportTransaction["currency"],
        categoryId: row.categoryId,
        paymentMethodId: row.paymentMethodId,
        occurredAt: row.occurredAt.toISOString(),
        occurredLocalDate: fromDateOnly(row.occurredLocalDate),
        occurredTz: row.occurredTz,
        note: row.note,
        tagIds: row.tags.map((tag) => tag.tagId),
      }),
    ),
  };
}

export interface SoloBookTarget {
  readonly snapshot: ImportTargetSnapshot;
  readonly transactionCount: number;
}

/**
 * Verify that this account may import into this existing book **as a solo ledger**.
 *
 * Checks, in this order: membership exists and is current; the book is live; the account is the
 * creator; there is exactly one active member and it is this account; the role can write. These are
 * new D2 checks and do not modify any of the existing S13 permission helpers.
 */
export async function loadExistingImportTarget(
  client: ImportDbClient,
  userId: string,
  bookId: string,
): Promise<SoloBookTarget> {
  const book = await client.book.findUnique({
    where: { id: bookId },
    select: {
      id: true,
      createdBy: true,
      archivedAt: true,
      disposedAt: true,
      purgeStartedAt: true,
      members: {
        where: { leftAt: null },
        select: { userId: true, role: true, leftAt: true },
      },
    },
  });

  if (book === null) throw notFound("book_not_found", "目标账本不存在。");
  if (book.disposedAt !== null || book.purgeStartedAt !== null) {
    throw gone("book_deleted", "这本账已经被删除，不能再作为导入目标。");
  }
  if (book.archivedAt !== null) {
    throw forbidden("book_read_only", "这本账已归档，不能作为导入目标。");
  }

  const membership = book.members.find((member) => member.userId === userId);
  if (membership === undefined) {
    throw forbidden("book_forbidden", "无权访问目标账本。");
  }
  if (membership.role === "viewer") {
    throw forbidden("book_read_only", "你没有写入目标账本的权限。");
  }
  if (book.createdBy !== userId || book.members.length !== 1 || book.members[0]?.userId !== userId) {
    throw forbidden("book_not_solo", "目标账本必须是本人拥有的单人账本。");
  }

  const snapshot = await loadTargetSnapshot(client, bookId);
  return { snapshot, transactionCount: snapshot.transactions.length };
}
