import {
  createNotDuplicateRelationsSchema,
  expandNotDuplicatePairs,
  normalizeNotDuplicatePair,
  notDuplicateRelationListResponseSchema,
  notDuplicateRelationMutationResponseSchema,
  notDuplicateRelationSchema,
  type NotDuplicatePair,
} from "@libellum/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { PrismaClient } from "../db.js";
import type { BookContext } from "../ledger/access.js";
import {
  assertRelationsNotLocked,
  loadRelationTransactions,
  toRelationDto,
  relationView,
  writeRelations,
  type RelationRow,
  type RelationTransactionRow,
} from "../ledger/notDuplicateRelations.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";

/**
 * S15-E3 · 不重复关系 API。
 *
 * 四个动作：列出、确认一批、撤销一条，以及（预留给 E4/E5）按交易过滤。
 * 权限复用既有包装器，**没有改动 `access.ts` 的任何判断**：
 *  - 读：`requireRead`（成员即可，viewer 也能看）；
 *  - 写：`requireAuth`（= `requireBookForWrite`，viewer 被拒）。
 *
 * ⚠️ **账本在路径里，权限在请求头里。** 与 `PATCH /books/:bookId` 相同的处理：
 * 两边不一致就什么都不做（`book_mismatch`），避免"在 A 账里有写权限、却按 B 账的路径写入"。
 *
 * ⚠️ **不是幂等机制的替代品。** 关系写入只影响提示抑制，不改变交易本身的
 * `idempotencyKey` / 唯一约束 / 软删除 / 离线同步语义。
 *
 * ⚠️ **离线不写入**：关系是服务器权威状态，首版不进入离线写队列；离线时创建/撤销
 * 由客户端禁用并说明（见设计决定文档 §离线）。
 */

export interface NotDuplicateRelationRouteOptions {
  readonly prisma: PrismaClient;
  /** = `requireBookForWrite` */
  readonly requireAuth: (request: FastifyRequest) => Promise<void>;
  /** = `requireBookRead` */
  readonly requireRead: (request: FastifyRequest) => Promise<void>;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function readBooleanFlag(value: unknown): boolean {
  const raw = readString(value);
  return raw === "true" || raw === "1";
}

function requireMatchingBook(request: FastifyRequest, bookId: string): BookContext {
  const context = request.book;
  if (context === undefined) {
    throw forbidden("book_forbidden", "无权访问该账本。");
  }
  if (context.bookId !== bookId) {
    throw badRequest("book_mismatch", "这次请求说的账本和当前账本不一致，没有做任何改动。");
  }
  return context;
}

function encodeCursor(row: { decidedAt: Date; id: string }): string {
  return encodeURIComponent(JSON.stringify({ t: row.decidedAt.toISOString(), i: row.id }));
}

function decodeCursor(raw: string): { decidedAt: Date; id: string } {
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.i !== "string") throw new Error("shape");
    const decidedAt = new Date(parsed.t);
    if (!Number.isFinite(decidedAt.getTime())) throw new Error("date");
    return { decidedAt, id: parsed.i };
  } catch {
    throw badRequest("cursor_invalid", "分页游标无效，请重新打开列表。");
  }
}

/** 关系行 → API 形状；需要交易摘要，所以先把涉及到的交易一次读全。 */
async function presentRelations(
  prisma: PrismaClient,
  bookId: string,
  rows: readonly RelationRow[],
  transactions?: ReadonlyMap<string, RelationTransactionRow>,
): Promise<ReturnType<typeof notDuplicateRelationSchema.parse>[]> {
  const ids = rows.flatMap((row) => [row.transactionAId, row.transactionBId]);
  const loaded = transactions ?? (await loadRelationTransactions(prisma, bookId, ids));

  return rows.map((row) => {
    const view = relationView(row, { transactions: loaded });
    return notDuplicateRelationSchema.parse(toRelationDto(row, view));
  });
}

export function registerNotDuplicateRelationRoutes(
  app: FastifyInstance,
  options: NotDuplicateRelationRouteOptions,
): void {
  const { prisma, requireAuth, requireRead } = options;

  // -------------------------------------------------------------------------
  // GET /api/v1/books/:bookId/not-duplicate-relations
  // -------------------------------------------------------------------------
  /**
   * 列出一本账里用户确认过的「不是同一笔」。
   *
   * 默认只返回**当前生效**的关系（未撤销、快照未过期、两侧交易都还在）；
   * `includeRevoked=true` 用于管理页的「已撤销」视图。
   *
   * `transactionId=` 过滤"和这一笔有关的对"，这是留给 E4/E5 的查询形状：
   * 新增交易前问"这笔和我已确认过不重复的哪些记录有关"。
   */
  app.get("/api/v1/books/:bookId/not-duplicate-relations", { preHandler: requireRead }, async (request) => {
    const { bookId } = request.params as { bookId: string };
    requireMatchingBook(request, bookId);

    const query = request.query as Record<string, unknown>;
    const includeRevoked = readBooleanFlag(query["includeRevoked"]);

    const transactionId = readString(query["transactionId"])?.trim();
    if (transactionId !== undefined && transactionId !== "" && !UUID_PATTERN.test(transactionId)) {
      throw badRequest("transaction_id_invalid", "transactionId 必须是交易 UUID。");
    }

    const limitRaw = Number(readString(query["limit"]) ?? DEFAULT_PAGE_SIZE);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    const where: Record<string, unknown> = { bookId };
    if (!includeRevoked) where["revokedAt"] = null;
    if (transactionId !== undefined && transactionId !== "") {
      where["OR"] = [{ transactionAId: transactionId }, { transactionBId: transactionId }];
    }

    const cursorRaw = readString(query["cursor"]);
    if (cursorRaw !== undefined && cursorRaw !== "") {
      const cursor = decodeCursor(cursorRaw);
      where["AND"] = [
        {
          OR: [
            { decidedAt: { lt: cursor.decidedAt } },
            { decidedAt: cursor.decidedAt, id: { lt: cursor.id } },
          ],
        },
      ];
    }

    const rows = await prisma.transactionNotDuplicateRelation.findMany({
      where,
      orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await presentRelations(prisma, bookId, page);
    const last = page.at(-1);

    return notDuplicateRelationListResponseSchema.parse({
      // 默认列表不把 stale / 撤销的行算进来；`includeRevoked` 才原样展示。
      items: includeRevoked ? items : items.filter((item) => item.effective),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/books/:bookId/not-duplicate-relations
  // -------------------------------------------------------------------------
  /**
   * 记下一批「这两笔不是同一笔」。
   *
   * ⚠️ **只能来自用户明确确认**：
   *  - `pairs` 是逐对确认；
   *  - `transactionIds` 是用户把一整组标为"都不是同一笔"时，服务端按两两展开。
   *    **这不是传递性推导**——每一个对都来自用户点名的那一组；A–B、B–C 永远不会
   *    自动推出 A–C（那需要用户再确认一次 A 与 C）。
   *
   * ⚠️ **幂等**：已生效且未失效的对原样返回；撤销过的对原地重激活；重复请求不会写第二行
   * （唯一约束 `(book_id, a, b)`）。
   */
  app.post(
    "/api/v1/books/:bookId/not-duplicate-relations",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.currentUser!.id;
      const displayName = request.currentUser!.displayName;
      const { bookId } = request.params as { bookId: string };
      requireMatchingBook(request, bookId);

      const body = createNotDuplicateRelationsSchema.parse(request.body ?? {});

      const pairs = new Map<string, NotDuplicatePair>();

      for (const raw of body.pairs ?? []) {
        const normalized = normalizeNotDuplicatePair(raw.transactionIdA, raw.transactionIdB);
        if (!normalized.ok) {
          throw badRequest(normalized.error.code, normalized.error.message);
        }
        pairs.set(
          `${normalized.pair.transactionAId}\u0000${normalized.pair.transactionBId}`,
          normalized.pair,
        );
      }

      const groupIds = body.transactionIds ?? [];
      if (groupIds.length > 0) {
        for (const pair of expandNotDuplicatePairs(groupIds)) {
          pairs.set(`${pair.transactionAId}\u0000${pair.transactionBId}`, pair);
        }
      }

      const plan = [...pairs.values()];
      if (plan.length === 0) {
        throw badRequest(
          "not_duplicate_pairs_empty",
          "没有可以确认的交易对：同一组里至少需要两笔不同的交易。",
        );
      }

      const ids = [...new Set(plan.flatMap((pair) => [pair.transactionAId, pair.transactionBId]))];
      const transactions = await loadRelationTransactions(prisma, bookId, ids);

      const missing = ids.filter((id) => !transactions.has(id));
      if (missing.length > 0) {
        // 跨账本 / 已被永久清理：都不写入任何一行。
        throw forbidden(
          "transaction_not_in_book",
          "有一笔交易不在这本账里，或已被永久清理，没有记录任何关系。",
        );
      }

      // 可读的锁提示；数据库触发器是第二层兜底。
      await assertRelationsNotLocked(prisma, bookId);

      const decisionSource =
        body.decisionSource ?? (new Set(groupIds.map((id) => id.trim())).size > 1 ? "review_group" : "manual");
      const now = new Date();

      const outcome = await prisma.$transaction(async (tx) =>
        writeRelations(
          tx,
          {
            bookId,
            decidedBy: userId,
            decidedByName: displayName,
            decisionSource,
            now,
          },
          plan,
          transactions,
        ),
      );

      const rows = await prisma.transactionNotDuplicateRelation.findMany({
        where: { id: { in: [...outcome.ids] }, bookId },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const ordered = outcome.ids
        .map((id) => byId.get(id))
        .filter((row): row is (typeof rows)[number] => row !== undefined);

      const items = await presentRelations(prisma, bookId, ordered, transactions);

      // 新建了至少一行才 201；否则是幂等重放（全部已生效/已撤销后重激活也算写入）。
      reply.status(outcome.created > 0 ? 201 : 200);
      return notDuplicateRelationMutationResponseSchema.parse({
        items,
        created: outcome.created,
        reactivated: outcome.reactivated,
        unchanged: outcome.unchanged,
      });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/books/:bookId/not-duplicate-relations/:id
  // -------------------------------------------------------------------------
  /**
   * 撤销一条「不是同一笔」。
   *
   * 软撤销：`revoked_at` 置位，行保留；撤销后该对**重新进入候选**（E2 检测层按
   * "生效关系"过滤，撤销的行不会再抑制提示）。
   *
   * 重复撤销是幂等的：已经撤销的关系原样返回 200，不会报错、也不会改时间。
   */
  app.delete(
    "/api/v1/books/:bookId/not-duplicate-relations/:relationId",
    { preHandler: requireAuth },
    async (request) => {
      const userId = request.currentUser!.id;
      const displayName = request.currentUser!.displayName;
      const { bookId, relationId } = request.params as { bookId: string; relationId: string };
      requireMatchingBook(request, bookId);

      const existing = await prisma.transactionNotDuplicateRelation.findFirst({
        where: { id: relationId, bookId },
      });

      if (existing === null) throw notFound("not_duplicate_relation_missing", "找不到这条「不重复」判断。");

      if (existing.revokedAt === null) {
        await assertRelationsNotLocked(prisma, bookId);

        await prisma.transactionNotDuplicateRelation.update({
          where: { id: existing.id },
          data: {
            revokedAt: new Date(),
            revokedBy: userId,
            revokedByName: displayName,
            revocationReason: "user_revoked",
          },
        });
      }

      const rows = await prisma.transactionNotDuplicateRelation.findMany({
        where: { id: existing.id, bookId },
      });

      const [item] = await presentRelations(prisma, bookId, rows);

      return notDuplicateRelationMutationResponseSchema.parse({
        items: item === undefined ? [] : [item],
        created: 0,
        reactivated: 0,
        unchanged: existing.revokedAt === null ? 0 : 1,
      });
    },
  );
}
