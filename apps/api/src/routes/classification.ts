import {
  UNCATEGORISED_NAME,
  classificationDeleteResponseSchema,
  createCategorySchema,
  createPaymentMethodSchema,
  createTagSchema,
  permanentDeleteCategorySchema,
  permanentDeletePaymentMethodSchema,
  updateCategorySchema,
  updatePaymentMethodSchema,
  updateTagSchema,
  type TransactionKind,
} from "@libellum/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { PrismaClient } from "../db.js";
import { randomUUID } from "node:crypto";
import { checkCategoryTree, checkCategoryWriter, lockCategoryTree } from "../ledger/categoryTree.js";
import type { Prisma } from "../generated/prisma/client.js";
import { recordOperation } from "../ledger/operations.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";

export interface ClassificationRouteOptions {
  readonly prisma: PrismaClient;
  readonly requireAuth: (request: FastifyRequest) => Promise<void>;
}

const CATEGORY_FIELDS = {
  parentId: true, icon: true, color: true,
  id: true,
  name: true,
  kind: true,
  description: true,
  isSystem: true,
  isArchived: true,
  sortOrder: true,
} as const;

const PAYMENT_METHOD_FIELDS = {
  id: true,
  name: true,
  isArchived: true,
  sortOrder: true,
} as const;

const TAG_FIELDS = { id: true, name: true, color: true } as const;

type Tx = Prisma.TransactionClient;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * ⚠️ **`P2003` is the foreign key refusing the delete, and it is not a bug.**
 *
 * `transactions.category_id` is `ON DELETE RESTRICT` on purpose: an entry that points at a category
 * is the reason a category may not simply vanish. The route re-points every row first, so the only
 * way to still meet this is **an entry created concurrently, while the transaction was running** —
 * a real race, not a programming error. It must therefore become a named 409 that the client can
 * retry, **not a 500** (the owner's rule for this batch: 并发下"至少不能 500").
 */
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2003";
}

interface CategoryChoice {
  readonly id: string;
  readonly name: string;
  readonly kind: TransactionKind;
}

/**
 * Which category the history should move to.
 *
 * ⚠️ **The default is the system `暂无分类`, not a preset called 其他.** Both were in the owner's
 * sentence (*"分类 → 其他/暂无分类"*), and the system one is the right reading: it **always exists**
 * (every ledger is created with one per kind, see `ledger/bootstrap.ts`), it is hidden from the
 * picker, and its meaning is exactly "no category was chosen" — which is what an automatic
 * re-point is. Choosing a user-visible 其他 would silently put entries into a category the user
 * believes they emptied.
 *
 * ⚠️ **If there is no default, this refuses rather than guessing.** The owner's instruction was
 * explicit: *"若没有合适的默认分类则返回明确 4xx，不要瞎删"*. A ledger whose system category is
 * missing is inconsistent data; deleting into nothing would destroy the only link those entries have.
 */
async function resolveReplacementCategory(
  tx: Tx,
  options: {
    readonly bookId: string;
    readonly selfId: string;
    readonly kind: TransactionKind;
    /** `null` means "the client did not choose" — fall back to the default. */
    readonly requested: string | null;
    /** Whether anything actually points at the category (live entries *or* tombstones). */
    readonly needed: boolean;
  },
): Promise<CategoryChoice | null> {
  if (options.requested !== null) {
    const replacement = await tx.category.findFirst({
      where: { id: options.requested, bookId: options.bookId },
      select: { id: true, name: true, kind: true },
    });

    /**
     * ⚠️ **A replacement from another ledger is refused as a permission problem, not as a 404.**
     * The caller is authenticated and is trying to reach into somebody else's classification —
     * answering "this id does not exist" would be a lie the caller could detect by retrying.
     * The message still says nothing about which ledger the id belongs to.
     */
    if (!replacement) {
      throw forbidden("replacement_invalid", "替换用的分类不在这本账里，可能已被删除。");
    }

    if (replacement.id === options.selfId) {
      throw badRequest("replacement_invalid", "不能把这个分类替换成它自己。");
    }

    /**
     * ⚠️ **Kind must match, even for a system category.** `access.ts` tolerates the other kind's
     * `暂无分类` because there the user chose nothing at all; here a *re-point* is a claim about
     * where those entries now belong, and putting 支出 entries under an income category would make
     * every per-category total disagree with the entry's own `kind`.
     */
    if (replacement.kind !== options.kind) {
      throw badRequest(
        "replacement_invalid",
        `「${replacement.name}」属于${replacement.kind === "income" ? "收入" : "支出"}分类，和要删除的分类类型不一致。`,
      );
    }

    return replacement;
  }

  // Nothing points at it, so there is nothing to re-point and no default is needed.
  if (!options.needed) return null;

  const fallback = await tx.category.findFirst({
    where: {
      bookId: options.bookId,
      kind: options.kind,
      isSystem: true,
      name: UNCATEGORISED_NAME,
    },
    select: { id: true, name: true, kind: true },
  });

  if (!fallback) {
    throw badRequest(
      "category_replacement_missing",
      "这本账没有默认分类可以接收历史账目，请先选择一个替换分类。",
    );
  }

  return fallback;
}

/**
 * Managing the three things that organise entries: categories, payment methods
 * and tags.
 *
 * The shared rule, and the reason all three live in one file: **nothing here
 * is really deleted.** A category or payment method is archived, because
 * past entries still point at it and must keep rendering; a tag may be removed
 * outright, because removing a label does not change any amount.
 *
 * ⚠️ **S13-E added a second, explicitly destructive action**, and it is a **different endpoint**
 * (`POST …/permanent-delete`) rather than a new meaning for `DELETE`: 归档是"以后别再出现"，
 * 永久删除是"把历史改记到别处，然后真的把它删掉"。两者都保留，因为既有调用（以及用户已经
 * 习惯的"删除"）仍然必须有归档这一层。所有者把这套动作定义在 S13-E Q4/Q5（2026-10-17）：
 * **删除已被使用的对象先让用户选替换；不选才按默认；重关联在服务端事务里完成；只记一条批量摘要。**
 */
export function registerClassificationRoutes(
  app: FastifyInstance,
  options: ClassificationRouteOptions,
): void {
  const { prisma, requireAuth } = options;

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------
  app.post("/api/v1/categories", { preHandler: requireAuth }, async (request, reply) => {
    const body = createCategorySchema.parse(request.body);
    const bookId = request.book!.bookId;

    // New items go last unless the client says otherwise.
    const highest = await prisma.category.aggregate({
      where: { bookId, kind: body.kind },
      _max: { sortOrder: true },
    });

    try {
      const created = await prisma.$transaction(async tx => {
        await lockCategoryTree(tx, bookId);
        await checkCategoryWriter(tx,bookId,request.currentUser!.id);
        const id = randomUUID();
        await checkCategoryTree(tx, bookId, { id, name: body.name, kind: body.kind, parentId: body.parentId ?? null });
        return tx.category.create({
        data: {
          id, parentId: body.parentId ?? null, icon: body.icon ?? null, color: body.color ?? null,
          bookId,
          name: body.name,
          kind: body.kind,
          sortOrder: body.sortOrder ?? (highest._max.sortOrder ?? -1) + 1,
        },
        select: CATEGORY_FIELDS,
      }); });

      reply.status(201);
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("category_exists", "同类型下已经有同名分类了。");
      }
      throw error;
    }
  });

  app.patch("/api/v1/categories/:id", { preHandler: requireAuth }, async (request) => {
    const body = updateCategorySchema.parse(request.body);
    const bookId = request.book!.bookId;
    const { id } = request.params as { id: string };

    const existing = await prisma.category.findFirst({
      where: { id, bookId },
      select: { id: true, isSystem: true },
    });

    if (!existing) throw notFound("category_missing", "找不到该分类。");
    // 暂无分类 is infrastructure, not user data.
    if (existing.isSystem) throw forbidden("category_system", "系统分类不可修改。");

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      data["name"] = body.name;
      // The preset explanation belongs to the preset. Once the user renames a
      // category it is theirs, and the ⓘ disappears with it.
      data["description"] = null;
    }
    if (body.sortOrder !== undefined) data["sortOrder"] = body.sortOrder;
    if (body.isArchived !== undefined) data["isArchived"] = body.isArchived;
    if (body.parentId !== undefined) data["parentId"] = body.parentId;
    if (body.icon !== undefined) data["icon"] = body.icon;
    if (body.color !== undefined) data["color"] = body.color;

    try {
      return await prisma.$transaction(async tx => {
        await lockCategoryTree(tx, bookId);
        await checkCategoryWriter(tx,bookId,request.currentUser!.id);
        const current = await tx.category.findFirst({where:{id,bookId}});
        if (!current) throw notFound("category_missing", "找不到该分类。");
        if (current.isSystem) throw forbidden("category_system", "系统分类不可修改。");
        await checkCategoryTree(tx, bookId, {id, ...(body.parentId === undefined ? {} : {parentId:body.parentId}), ...(body.name === undefined ? {} : {name:body.name})});
        return tx.category.update({ where: { id }, data, select: CATEGORY_FIELDS });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("category_exists", "同类型下已经有同名分类了。");
      }
      throw error;
    }
  });

  /**
   * Archiving, not deleting: entries recorded months ago still reference this
   * category and must keep showing its name.
   */
  app.delete("/api/v1/categories/:id", { preHandler: requireAuth }, async (request, reply) => {
    const bookId = request.book!.bookId;
    const { id } = request.params as { id: string };

    const existing = await prisma.category.findFirst({
      where: { id, bookId },
      select: { id: true, isSystem: true },
    });

    if (!existing) throw notFound("category_missing", "找不到该分类。");
    if (existing.isSystem) throw forbidden("category_system", "系统分类不可删除。");

    await prisma.category.update({ where: { id }, data: { isArchived: true } });

    reply.status(204);
    return null;
  });

  /**
   * **Permanently deleting a category, and moving its history somewhere else.**
   *
   * The sequence is the whole design, and every step is inside one transaction:
   *
   * 1. re-read the category *inside* the transaction — the owner's rule is that the reference count
   *    is recomputed there (**"重新统计引用数"**), never trusted from the confirmation dialog;
   * 2. validate the replacement (same ledger, same kind, not itself);
   * 3. `updateMany` every entry that points at it, **tombstones included**;
   * 4. delete the row, and write **one** batch summary.
   *
   * ⚠️ **Step 3 must cover tombstones, and that is not scope creep.** `transactions.category_id` is
   * `ON DELETE RESTRICT`: a soft-deleted entry still holds the foreign key, so re-pointing only live
   * entries would make the delete fail. `affectedEntries` in the response deliberately counts **live
   * entries only** — that is the number the user was shown and the number the entry list would agree
   * with — while the summary records the real row count as `detail.movedRows`. **The two numbers are
   * allowed to differ, and they must, because "an entry" and "a row" stopped being the same thing
   * when deletion became a tombstone.**
   *
   * ⚠️ **A repeat or concurrent request is safe.** If the row is already gone, `deleteMany` returns
   * 0 and the transaction is aborted — including any re-pointing it had just done — so the second
   * caller gets a plain 404 and **cannot overwrite the first caller's choice of replacement**.
   */
  app.post(
    "/api/v1/categories/:id/permanent-delete",
    { preHandler: requireAuth },
    async (request) => {
      const body = permanentDeleteCategorySchema.parse(request.body ?? {});
      /** `undefined` (no choice), `""` and `null` all mean "you choose the default". */
      const requested = body.replacementCategoryId ?? null;
      const bookId = request.book!.bookId;
      const { id } = request.params as { id: string };
      const actorId = request.currentUser!.id;
      const actorName = request.currentUser!.displayName;

      try {
        const result = await prisma.$transaction(async (tx) => {
          await lockCategoryTree(tx, bookId);
          await checkCategoryWriter(tx,bookId,request.currentUser!.id);
          const target = await tx.category.findFirst({
            where: { id, bookId },
            select: { id: true, name: true, kind: true, isSystem: true, parentId: true },
          });

          if (!target) throw notFound("category_missing", "找不到该分类。");
          // 系统分类是账本的基础设施 —— 保护规则在永久删除上同样生效。
          if (target.isSystem) throw forbidden("category_system", "系统分类不可删除。");
          const children = await tx.category.findMany({where:{parentId:id}});
          if (children.length && body.childrenPolicy !== "promote") throw conflict("category_children", "请先移动子分类，或确认将子分类提升到上一级。");
          for (const child of children) {
            await checkCategoryTree(tx, bookId, {id:child.id,parentId:target.parentId});
            await tx.category.update({where:{id:child.id},data:{parentId:target.parentId}});
          }

          /** What the user is told: live entries only, the same rule the list uses. */
          const affectedEntries = await tx.transaction.count({
            where: { categoryId: id, deletedAt: null },
          });
          /** What the foreign key requires: every row, tombstones included. */
          const referencingRows = await tx.transaction.count({ where: { categoryId: id } });

          const replacement = await resolveReplacementCategory(tx, {
            bookId,
            selfId: id,
            kind: target.kind,
            requested,
            needed: referencingRows > 0,
          });

          let movedRows = 0;

          if (replacement !== null) {
            const moved = await tx.transaction.updateMany({
              where: { categoryId: id },
              data: { categoryId: replacement.id },
            });
            movedRows = moved.count;
          }

          const removed = await tx.category.deleteMany({ where: { id, bookId } });

          if (removed.count === 0) {
            /**
             * ⚠️ **The row vanished between the read and the delete — a concurrent request won.**
             * Throwing aborts the transaction, so the re-pointing above is rolled back: **the loser
             * must not get to re-point entries that the winner already moved to a different
             * replacement**, or the user's confirmed choice would be silently replaced by the other
             * request's.
             */
            throw notFound("category_missing", "找不到该分类。");
          }

          const operationId = await recordOperation(tx, {
            bookId,
            actorId,
            actorName,
            action: "category.permanent_delete",
            objectType: "category",
            objectId: target.id,
            objectName: target.name,
            affectedCount: affectedEntries,
            detail: {
              mode:
                replacement === null
                  ? "none"
                  : requested === null
                    ? "default"
                    : "replacement",
              replacementCategoryId: replacement?.id ?? null,
              replacementCategoryName: replacement?.name ?? null,
              replacementCategoryKind: replacement?.kind ?? null,
              movedRows,
            },
          });

          return { affectedEntries, operationId, replacement };
        });

        return classificationDeleteResponseSchema.parse({
          affectedEntries: result.affectedEntries,
          replacementId: result.replacement?.id ?? null,
          replacementName: result.replacement?.name ?? null,
          operationId: result.operationId,
        });
      } catch (error) {
        if (error instanceof AppError) throw error;

        /**
         * ⚠️ An entry created while the transaction was running still points at the category, so
         * `RESTRICT` refuses the delete. That is a **conflict**, not a server fault: the client can
         * show "刚刚有新的账目用了它，请重试" and retry, and the transaction has been rolled back, so
         * nothing is half-done.
         */
        if (isForeignKeyViolation(error)) {
          throw conflict("category_in_use", "刚刚有新的账目用了这个分类，请刷新后重试。");
        }

        throw error;
      }
    },
  );

  // -------------------------------------------------------------------------
  // Payment methods
  // -------------------------------------------------------------------------
  app.post("/api/v1/payment-methods", { preHandler: requireAuth }, async (request, reply) => {
    const body = createPaymentMethodSchema.parse(request.body);
    const bookId = request.book!.bookId;

    const highest = await prisma.paymentMethod.aggregate({
      where: { bookId },
      _max: { sortOrder: true },
    });

    try {
      const created = await prisma.paymentMethod.create({
        data: {
          bookId,
          name: body.name,
          sortOrder: body.sortOrder ?? (highest._max.sortOrder ?? -1) + 1,
        },
        select: PAYMENT_METHOD_FIELDS,
      });

      reply.status(201);
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("payment_method_exists", "已经有同名支付方式了。");
      }
      throw error;
    }
  });

  app.patch("/api/v1/payment-methods/:id", { preHandler: requireAuth }, async (request) => {
    const body = updatePaymentMethodSchema.parse(request.body);
    const bookId = request.book!.bookId;
    const { id } = request.params as { id: string };

    const existing = await prisma.paymentMethod.findFirst({ where: { id, bookId }, select: { id: true } });
    if (!existing) throw notFound("payment_method_missing", "找不到该支付方式。");

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data["name"] = body.name;
    if (body.sortOrder !== undefined) data["sortOrder"] = body.sortOrder;
    if (body.isArchived !== undefined) data["isArchived"] = body.isArchived;

    try {
      return await prisma.paymentMethod.update({ where: { id }, data, select: PAYMENT_METHOD_FIELDS });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("payment_method_exists", "已经有同名支付方式了。");
      }
      throw error;
    }
  });

  app.delete("/api/v1/payment-methods/:id", { preHandler: requireAuth }, async (request, reply) => {
    const bookId = request.book!.bookId;
    const { id } = request.params as { id: string };

    const existing = await prisma.paymentMethod.findFirst({ where: { id, bookId }, select: { id: true } });
    if (!existing) throw notFound("payment_method_missing", "找不到该支付方式。");

    await prisma.paymentMethod.update({ where: { id }, data: { isArchived: true } });

    reply.status(204);
    return null;
  });

  /**
   * **Permanently deleting a payment method.**
   *
   * ⚠️ **"Not specified" is a real answer here, not a fallback.** The owner's rule (Q5) is
   * 支付方式 → 未指定: a payment method is a *label* on how something was paid, and `NULL` already
   * means "not recorded" everywhere else (`transactions.payment_method_id` is nullable, and the DTO
   * renders it as 未指定). So passing no replacement **nulls the column for the history** instead of
   * inventing an "其他" method — the ledger deliberately does not grow a row the user did not make.
   *
   * ⚠️ **Tombstones are re-pointed too**, for consistency rather than necessity here
   * (`ON DELETE SET NULL` would have made the delete succeed anyway) — **an entry both sides have
   * already agreed to call "cash" should not change what it says just because the method was
   * removed later**, and restoring a deleted entry should bring back its payment method if it was
   * replaced rather than cleared.
   */
  app.post(
    "/api/v1/payment-methods/:id/permanent-delete",
    { preHandler: requireAuth },
    async (request) => {
      const body = permanentDeletePaymentMethodSchema.parse(request.body ?? {});
      /** `undefined` / `""` / `null` all mean 未指定 — there is no "其他" payment method to fall back to. */
      const requested = body.replacementPaymentMethodId ?? null;
      const bookId = request.book!.bookId;
      const { id } = request.params as { id: string };
      const actorId = request.currentUser!.id;
      const actorName = request.currentUser!.displayName;

      const result = await prisma.$transaction(async (tx) => {
        const target = await tx.paymentMethod.findFirst({
          where: { id, bookId },
          select: { id: true, name: true },
        });

        if (!target) throw notFound("payment_method_missing", "找不到该支付方式。");

        const affectedEntries = await tx.transaction.count({
          where: { paymentMethodId: id, deletedAt: null },
        });

        let replacement: { readonly id: string; readonly name: string } | null = null;

        if (requested !== null) {
          replacement = await tx.paymentMethod.findFirst({
            where: { id: requested, bookId },
            select: { id: true, name: true },
          });

          if (!replacement) {
            throw forbidden("replacement_invalid", "替换用的支付方式不在这本账里，可能已被删除。");
          }

          if (replacement.id === id) {
            throw badRequest("replacement_invalid", "不能把这个支付方式替换成它自己。");
          }
        }

        const moved = await tx.transaction.updateMany({
          where: { paymentMethodId: id },
          data: { paymentMethodId: replacement?.id ?? null },
        });

        const removed = await tx.paymentMethod.deleteMany({ where: { id, bookId } });

        if (removed.count === 0) {
          // Same race as the category route: abort, so the loser cannot overwrite the winner's choice.
          throw notFound("payment_method_missing", "找不到该支付方式。");
        }

        const operationId = await recordOperation(tx, {
          bookId,
          actorId,
          actorName,
          action: "payment_method.permanent_delete",
          objectType: "payment_method",
          objectId: target.id,
          objectName: target.name,
          affectedCount: affectedEntries,
          detail: {
            mode: replacement === null ? "unspecified" : "replacement",
            replacementPaymentMethodId: replacement?.id ?? null,
            replacementPaymentMethodName: replacement?.name ?? null,
            movedRows: moved.count,
          },
        });

        return { affectedEntries, operationId, replacement };
      });

      return classificationDeleteResponseSchema.parse({
        affectedEntries: result.affectedEntries,
        replacementId: result.replacement?.id ?? null,
        replacementName: result.replacement?.name ?? null,
        operationId: result.operationId,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------
  app.post("/api/v1/tags", { preHandler: requireAuth }, async (request, reply) => {
    const body = createTagSchema.parse(request.body);
    const bookId = request.book!.bookId;

    try {
      const created = await prisma.tag.create({
        data: { bookId, name: body.name, color: body.color },
        select: TAG_FIELDS,
      });

      reply.status(201);
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("tag_exists", "已经有同名标签了。");
      throw error;
    }
  });

  app.patch("/api/v1/tags/:id", { preHandler: requireAuth }, async (request) => {
    const body = updateTagSchema.parse(request.body);
    const bookId = request.book!.bookId;
    const { id } = request.params as { id: string };

    const existing = await prisma.tag.findFirst({ where: { id, bookId }, select: { id: true } });
    if (!existing) throw notFound("tag_missing", "找不到该标签。");

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data["name"] = body.name;
    if (body.color !== undefined) data["color"] = body.color;

    try {
      return await prisma.tag.update({ where: { id }, data, select: TAG_FIELDS });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("tag_exists", "已经有同名标签了。");
      throw error;
    }
  });

  /**
   * A tag really is deleted — removing a label does not alter any amount, so
   * there is nothing to preserve. The entries themselves are untouched; only
   * the links go. The count comes back so the interface can say how many
   * entries were affected before the user commits.
   *
   * ⚠️ **Now one transaction, and one batch summary** (S13-E). It used to be two independent
   * statements — `count` then `delete` — which meant the number the user was shown could already be
   * wrong by the time the row went, and there was no record of the operation at all. The rule is
   * the owner's: *"删除与历史记录重关联必须在服务端事务中完成"*.
   *
   * ⚠️ There is no "其他标签" to re-point to: deleting a tag **unlinks** it (Q5 标签 → 解除关联),
   * which is exactly what `transaction_tags`' `ON DELETE CASCADE` already did. The explicit
   * `deleteMany` below is not redundant — it is what makes the affected row count a fact this
   * transaction observed rather than a side effect it hopes for.
   */
  app.delete("/api/v1/tags/:id", { preHandler: requireAuth }, async (request) => {
    const bookId = request.book!.bookId;
    const { id } = request.params as { id: string };
    const actorId = request.currentUser!.id;
    const actorName = request.currentUser!.displayName;

    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.tag.findFirst({
        where: { id, bookId },
        select: { id: true, name: true },
      });

      if (!target) throw notFound("tag_missing", "找不到该标签。");

      /**
       * ⚠️ **Live entries only**, the same rule the entry list uses (`deleted_at IS NULL`): the
       * dialog says "有 N 笔账目使用它", and a tombstone is not an entry the user can see. The
       * actual number of links removed is recorded in the summary as `unlinkedRows`.
       */
      const affectedEntries = await tx.transactionTag.count({
        where: { tagId: id, transaction: { deletedAt: null } },
      });

      const unlinked = await tx.transactionTag.deleteMany({ where: { tagId: id } });

      const removed = await tx.tag.deleteMany({ where: { id, bookId } });

      if (removed.count === 0) {
        // Lost the race with another delete: roll back, and answer the same way as "never existed".
        throw notFound("tag_missing", "找不到该标签。");
      }

      const operationId = await recordOperation(tx, {
        bookId,
        actorId,
        actorName,
        action: "tag.permanent_delete",
        objectType: "tag",
        objectId: target.id,
        objectName: target.name,
        affectedCount: affectedEntries,
        detail: {
          mode: "unlink",
          unlinkedRows: unlinked.count,
        },
      });

      return { affectedEntries, operationId };
    });

    return classificationDeleteResponseSchema.parse({
      affectedEntries: result.affectedEntries,
      replacementId: null,
      replacementName: null,
      operationId: result.operationId,
    });
  });
}
