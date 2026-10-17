import {
  classificationUsageResponseSchema,
  ledgerMetaResponseSchema,
  ledgerOperationListResponseSchema,
} from "@libellum/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { PrismaClient } from "../db.js";
import { readHistory } from "../ledger/history.js";
import { readOperations } from "../ledger/operations.js";

export interface LedgerRouteOptions {
  readonly prisma: PrismaClient;
  /**
   * ⚠️ **The write-strength guard**, used by `/ledger` itself — that request carries "which ledger is
   * this and what may I do here", so it is treated as a write (see `app.ts`).
   */
  readonly requireAuth: (request: FastifyRequest) => Promise<void>;
  /**
   * ⚠️ **A read-strength guard, and it was missing until a test caught it.**
   *
   * Every route in this module used to share one guard — the write one — so **`/ledger/history`
   * returned 403 to a viewer.** The owner's rule is that a viewer sees everything except the ability
   * to edit, and *"这笔是谁改的"* is part of seeing it, so that refusal was a real defect rather than
   * a strict-but-fine choice.
   *
   * ⚠️ **A route-level guard cannot be read-versus-write per route**, which is exactly why this is a
   * second parameter instead of a cleverer single one: the distinction is per-route, so it has to be
   * expressible per-route.
   */
  readonly requireRead?: (request: FastifyRequest) => Promise<void>;
}

/**
 * Everything the record-an-entry screen needs, in one request.
 *
 * The form needs the book, both category lists, the payment methods and the
 * tags before it can render. Fetching them separately would mean four round
 * trips on a phone, which is exactly the wrong place to spend them.
 */
export function registerLedgerRoutes(app: FastifyInstance, options: LedgerRouteOptions): void {
  const { prisma, requireAuth } = options;
  /** ⚠️ Falls back to the write guard, so a caller that forgets it keeps the old behaviour. */
  const requireRead = options.requireRead ?? requireAuth;

  app.get("/api/v1/ledger", { preHandler: requireAuth }, async (request) => {
    /**
     * ⚠️ **The ledger named by the request, not "the one this account has".** The distinction
     * only started to matter when an account could belong to more than one book; before that the
     * two questions had the same answer. See `requireBook` in `ledger/access.ts`.
     */
    const bookId = request.book!.bookId;

    const [book, categories, paymentMethods, tags, memberCount, transactionCount, eventCount] =
      await Promise.all([
      prisma.book.findUniqueOrThrow({
        where: { id: bookId },
        /** ⚠️ `createdAt` included because the ledger's age is part of recognising it. */
        select: { id: true, name: true, bookNumber: true, createdAt: true },
      }),
      prisma.category.findMany({
        where: { bookId },
        orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
        select: {
          id: true,
          name: true,
          kind: true,
          description: true,
          isSystem: true,
          isArchived: true,
          sortOrder: true,
        },
      }),
      prisma.paymentMethod.findMany({
        where: { bookId },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, isArchived: true, sortOrder: true },
      }),
      prisma.tag.findMany({
        where: { bookId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, color: true },
      }),
      /**
       * ⚠️ **Last, not second.** My first attempt inserted this between `book` and `categories`, so
       * the destructuring `[book, categories, …]` silently shifted and **`memberCount` was read as
       * the category list** — a mistake the compiler only caught because the tuple's length was
       * wrong, not because the meaning was.
       */
      prisma.bookMember.count({ where: { bookId, leftAt: null } }),
      /**
       * ⚠️ **`deletedAt: null`, because a tombstone is not an entry.** The screen says "账目数量";
       * counting soft-deleted rows would make the number disagree with the list the person can
       * actually see — **and the list is the thing they will count.**
       */
      prisma.transaction.count({ where: { bookId, deletedAt: null } }),
      prisma.transactionEvent.count({ where: { bookId } }),
    ]);

    /**
     * ⚠️ **`leftAt: null`, or the count includes people who left.** The bottom navigation renames
     * itself on this number (*"只有自己一位成员时，显示「账本」；有两位或以上成员时，显示「协作」"*),
     * and **a ledger somebody walked out of would keep saying 协作** — showing a collaboration screen
     * for a ledger that is back to one person.
     */
    return ledgerMetaResponseSchema.parse({
      book: { ...book, memberCount },
      stats: {
        createdAt: book.createdAt.toISOString(),
        transactionCount,
        eventCount,
      },
      categories,
      paymentMethods,
      tags,
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/ledger/history — what has happened in this ledger
  // ---------------------------------------------------------------------------
  /**
   * ⚠️ **Read-only, so `requireBook` is enough** — knowing what changed is not changing anything,
   * and **a viewer needs this as much as an editor does**: the owner's rule is that a viewer sees
   * everything except the ability to edit, and "who changed this entry" is part of seeing it.
   *
   * ⚠️ **The limit is capped here rather than trusted.** The owner's plan is *"主页面只展示最近几条"*
   * with a full view behind it, and an uncapped `limit` from a client is a request that reads the
   * whole ledger — **which is exactly the "never read everything for one click" rule the export
   * pagination exists for.**
   */
  app.get("/api/v1/ledger/history", { preHandler: requireRead }, async (request) => {
    const userId = request.currentUser!.id;
    const bookId = request.book!.bookId;

    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(request.query ?? {});

    const entries = await readHistory(prisma, bookId, query.limit ?? 20);

    /**
     * ⚠️ **A total alongside the page**, because "最近几条" without a total cannot tell the reader
     * whether they are seeing a quiet ledger or the top of a long list.
     */
    const total = await prisma.transactionEvent.count({ where: { bookId } });

    return { entries, total };
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/ledger/operations — 批量操作摘要（删除 + 历史重关联）
  // ---------------------------------------------------------------------------
  /**
   * ⚠️ **Read-only, and a viewer may call it** — for the same reason as the history above: "这个分类
   * 是谁删的、那几十笔记到哪去了" is part of seeing the ledger, not part of editing it.
   *
   * ⚠️ **It exists because the writer alone would leave the table unread** (AGENTS.md §5: 一个没有
   * 读取者的表会腐烂，而且看起来像"已完成"). S13-E 的批量操作记录就是为了回答用户"历史去哪了"，
   * 没有这条读路径，答案只能从数据库里手工查。
   *
   * ⚠️ **The limit is capped here rather than trusted**, the same rule as `/ledger/history`: an
   * uncapped `limit` from a client is a request that reads the whole ledger.
   */
  app.get("/api/v1/ledger/operations", { preHandler: requireRead }, async (request) => {
    const bookId = request.book!.bookId;

    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(request.query ?? {});

    const { entries, total } = await readOperations(prisma, bookId, query.limit ?? 20);

    return ledgerOperationListResponseSchema.parse({ entries, total });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/ledger/classification-usage — 删除确认框的「有 N 笔历史使用它」
  // ---------------------------------------------------------------------------
  /**
   * ⚠️ **Read-only, so a viewer may call it** — the same rule as the history and the batch
   * summaries above: "这个分类后面有多少笔账" is part of seeing the ledger, not part of editing it.
   *
   * ⚠️ **The dialog cannot count this for itself.** The client holds only the entries it has paged
   * in, so a local count would silently under-report — and the number that decides a permanent
   * delete is exactly the one the server re-checks inside the transaction
   * (`routes/classification.ts`). This is the preview of that number, taken *now*; the delete may
   * see a larger one if entries arrive in between, which is why the server recounts rather than
   * trusting this response.
   *
   * ⚠️ **`deletedAt: null` on every count**, the same rule as the entry list: a tombstone is not an
   * entry the person can open. A dialog saying *"有 N 笔历史记录使用它"* must agree with the list.
   *
   * ⚠️ **No `limit`**, unlike the two routes above: the answer is bounded by the number of
   * categories / payment methods / tags in one ledger — a handful — **not by the number of
   * entries**, so there is nothing here to page. A truncated map would answer "0 笔" for something
   * that is in use, which is the one wrong answer this endpoint must never give.
   */
  app.get(
    "/api/v1/ledger/classification-usage",
    { preHandler: requireRead },
    async (request) => {
      const bookId = request.book!.bookId;

      /**
       * ⚠️ **Grouped in the database, not fetched and counted here**: one row comes back per
       * classification object rather than one row per entry — the same rule the export pagination
       * follows: never read the whole ledger for one click.
       */
      const [categoryRows, paymentMethodRows, tagRows] = await Promise.all([
        prisma.transaction.groupBy({
          by: ["categoryId"],
          where: { bookId, deletedAt: null },
          _count: { _all: true },
        }),
        prisma.transaction.groupBy({
          by: ["paymentMethodId"],
          where: { bookId, deletedAt: null, paymentMethodId: { not: null } },
          _count: { _all: true },
        }),
        prisma.transactionTag.groupBy({
          by: ["tagId"],
          /**
           * ⚠️ **Both sides are pinned to the ledger**, not just the transaction.
           * `transaction_tags` carries no `book_id` of its own, and attaching another ledger's tag
           * is already refused at write time (`resolveTagIds`) — but a read that trusted only one
           * side would surface a foreign tag id the day that invariant is ever broken, and **a
           * count must not be the way a cross-ledger id becomes visible.**
           */
          where: {
            transaction: { bookId, deletedAt: null },
            tag: { bookId },
          },
          _count: { _all: true },
        }),
      ]);

      const categories: Record<string, number> = {};
      for (const row of categoryRows) categories[row.categoryId] = row._count._all;

      const paymentMethods: Record<string, number> = {};
      for (const row of paymentMethodRows) {
        /** 未指定 (`NULL`) is not an object: it has no id and no delete button, so it is not a key. */
        if (row.paymentMethodId !== null) {
          paymentMethods[row.paymentMethodId] = row._count._all;
        }
      }

      const tags: Record<string, number> = {};
      for (const row of tagRows) tags[row.tagId] = row._count._all;

      /**
       * ⚠️ Parsed through the shared schema: the shape the client reads is the shape this module
       * promised, and **an empty object stays a legal answer** (`{}` = nothing uses it yet).
       */
      return classificationUsageResponseSchema.parse({ categories, paymentMethods, tags });
    },
  );
}
