import { randomUUID } from "node:crypto";

import { LEDGER_OPERATION_ACTIONS, LEDGER_OPERATION_OBJECT_TYPES } from "@libellum/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ledgerOf,
  makeApp,
  prisma,
  resetDatabase,
  signUp,
  type LedgerMeta,
} from "./support.js";

let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase();
  app = makeApp();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createCategory(cookie: string, name: string, kind: "expense" | "income") {
  return app.inject({
    method: "POST",
    url: "/api/v1/categories",
    headers: { cookie },
    payload: { name, kind },
  });
}

/**
 * Record one entry, with **any** of the three organisers.
 *
 * The book header is optional on purpose: a single-book account needs none (the guard falls back to
 * its oldest membership), while the viewer tests must name the ledger they are writing into.
 */
async function recordEntryWith(
  cookie: string,
  input: {
    readonly categoryId?: string | null;
    readonly paymentMethodId?: string | null;
    readonly tagIds?: string[];
    readonly bookId?: string;
  } = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/transactions",
    headers: { cookie, ...(input.bookId === undefined ? {} : { "x-libellum-book": input.bookId }) },
    payload: {
      id: randomUUID(),
      idempotencyKey: randomUUID(),
      kind: "expense",
      amountCents: 500,
      currency: "CNY",
      categoryId: input.categoryId ?? null,
      paymentMethodId: input.paymentMethodId ?? null,
      occurredAt: "2026-10-09T12:00:00.000+08:00",
      occurredLocalDate: "2026-10-09",
      occurredTz: "Asia/Shanghai",
      note: null,
      tagIds: input.tagIds ?? [],
    },
  });
}

async function recordEntry(cookie: string, tagIds: string[]) {
  return recordEntryWith(cookie, { tagIds });
}

async function addPaymentMethod(cookie: string, name: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/payment-methods",
    headers: { cookie },
    payload: { name },
  });
}

async function addTag(cookie: string, name: string, color = "#55997a") {
  return app.inject({
    method: "POST",
    url: "/api/v1/tags",
    headers: { cookie },
    payload: { name, color },
  });
}

function findCategory(ledger: LedgerMeta, name: string, kind: string) {
  return ledger.categories.find((category) => category.name === name && category.kind === kind);
}

describe("categories", () => {
  it("adds a custom category at the end of its own kind", async () => {
    const cookie = await signUp(app, "mama");
    const before = await ledgerOf(app, cookie);

    const response = await createCategory(cookie, "宠物", "expense");
    expect(response.statusCode).toBe(201);

    const after = await ledgerOf(app, cookie);
    const expense = after.categories.filter((category) => category.kind === "expense");
    const created = expense.at(-1);

    // 9 presets + 暂无分类 + the new one.
    expect(expense).toHaveLength(before.categories.filter((c) => c.kind === "expense").length + 1);
    expect(created?.name).toBe("宠物");
    expect(created?.isSystem).toBe(false);
  });

  it("refuses a duplicate within a kind but allows it across kinds", async () => {
    const cookie = await signUp(app, "mama");

    const first = await createCategory(cookie, "宠物", "expense");
    expect(first.statusCode).toBe(201);

    const duplicate = await createCategory(cookie, "宠物", "expense");
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "category_exists" });

    // 转账 already exists as both an expense and an income preset; adding it
    // again as income must still be refused.
    const presetClash = await createCategory(cookie, "转账", "income");
    expect(presetClash.statusCode).toBe(409);

    // A different kind is a different list.
    const otherKind = await createCategory(cookie, "宠物", "income");
    expect(otherKind.statusCode).toBe(201);
  });

  it("renames and reorders a category", async () => {
    const cookie = await signUp(app, "mama");
    const created = await createCategory(cookie, "宠物", "expense");
    const id = (created.json() as { id: string }).id;

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/categories/${id}`,
      headers: { cookie },
      payload: { name: "宠物用品", sortOrder: 0 },
    });

    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: "宠物用品", sortOrder: 0 });
  });

  it("archives a category and brings it back", async () => {
    const cookie = await signUp(app, "mama");
    const created = await createCategory(cookie, "宠物", "expense");
    const id = (created.json() as { id: string }).id;

    const archived = await app.inject({
      method: "DELETE",
      url: `/api/v1/categories/${id}`,
      headers: { cookie },
    });
    expect(archived.statusCode).toBe(204);

    // Still present — archived, not gone. Past entries must keep rendering it.
    const afterArchive = await ledgerOf(app, cookie);
    expect(findCategory(afterArchive, "宠物", "expense")?.isArchived).toBe(true);

    const restored = await app.inject({
      method: "PATCH",
      url: `/api/v1/categories/${id}`,
      headers: { cookie },
      payload: { isArchived: false },
    });
    expect(restored.json()).toMatchObject({ isArchived: false });
  });

  it("refuses to rename or archive the system category", async () => {
    const cookie = await signUp(app, "mama");
    const ledger = await ledgerOf(app, cookie);
    const system = ledger.categories.find((category) => category.isSystem);

    const rename = await app.inject({
      method: "PATCH",
      url: `/api/v1/categories/${String(system?.id)}`,
      headers: { cookie },
      payload: { name: "其它" },
    });
    expect(rename.statusCode).toBe(403);
    expect(rename.json()).toMatchObject({ code: "category_system" });

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/categories/${String(system?.id)}`,
      headers: { cookie },
    });
    expect(remove.statusCode).toBe(403);
  });

  it("carries a plain-language explanation for presets, and drops it on rename", async () => {
    const cookie = await signUp(app, "mama");
    const ledger = await ledgerOf(app, cookie);
    const dining = findCategory(ledger, "餐饮", "expense");

    // The preset explains itself, which is the whole point of the ⓘ.
    expect(dining?.description).toBe("日常用餐与饮品支出");

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/categories/${String(dining?.id)}`,
      headers: { cookie },
      payload: { name: "吃饭" },
    });

    expect(renamed.statusCode).toBe(200);
    // Once it is the user's own category, an explanation they did not write is
    // noise — and the ⓘ disappears with it.
    expect((renamed.json() as { description: string | null }).description).toBeNull();
  });

  it("keeps one account's categories out of another's reach", async () => {
    const mama = await signUp(app, "mama");
    const baba = await signUp(app, "baba");

    const created = await createCategory(mama, "宠物", "expense");
    const id = (created.json() as { id: string }).id;

    const stolen = await app.inject({
      method: "PATCH",
      url: `/api/v1/categories/${id}`,
      headers: { cookie: baba },
      payload: { name: "我的了" },
    });

    // 404, not 403: baba never learns that this id exists.
    expect(stolen.statusCode).toBe(404);
  });
});

describe("payment methods", () => {
  it("adds one at the end, refuses duplicates and archives", async () => {
    const cookie = await signUp(app, "mama");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/payment-methods",
      headers: { cookie },
      payload: { name: "信用卡" },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/payment-methods",
      headers: { cookie },
      payload: { name: "信用卡" },
    });
    expect(duplicate.statusCode).toBe(409);

    const archived = await app.inject({
      method: "DELETE",
      url: `/api/v1/payment-methods/${id}`,
      headers: { cookie },
    });
    expect(archived.statusCode).toBe(204);

    const ledger = await ledgerOf(app, cookie);
    expect(ledger.paymentMethods.find((method) => method.id === id)?.isArchived).toBe(true);
  });
});

describe("tags", () => {
  async function createTag(cookie: string, name: string, color = "#55997a") {
    return app.inject({
      method: "POST",
      url: "/api/v1/tags",
      headers: { cookie },
      payload: { name, color },
    });
  }

  it("creates a tag and refuses a duplicate name", async () => {
    const cookie = await signUp(app, "mama");

    expect((await createTag(cookie, "出差")).statusCode).toBe(201);

    const duplicate = await createTag(cookie, "出差", "#b8574f");
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "tag_exists" });
  });

  it("refuses a colour that is not #RRGGBB", async () => {
    const cookie = await signUp(app, "mama");

    const response = await createTag(cookie, "出差", "green");

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "validation_failed" });
  });

  it("deleting a tag reports the entries it was on, and keeps those entries", async () => {
    const cookie = await signUp(app, "mama");
    const tag = await createTag(cookie, "可报销");
    const tagId = (tag.json() as { id: string }).id;

    const entry = await recordEntry(cookie, [tagId]);
    expect(entry.statusCode).toBe(201);
    const entryId = (entry.json() as { id: string }).id;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/tags/${tagId}`,
      headers: { cookie },
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ affectedEntries: 1 });

    // The entry survives; only the label is gone.
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/transactions/${entryId}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { tags: unknown[] }).tags).toHaveLength(0);
  });

  it("attaches tags to an entry and returns them", async () => {
    const cookie = await signUp(app, "mama");
    const first = await createTag(cookie, "出差");
    const second = await createTag(cookie, "可报销", "#b8574f");

    const response = await recordEntry(cookie, [
      (first.json() as { id: string }).id,
      (second.json() as { id: string }).id,
    ]);

    expect(response.statusCode).toBe(201);
    const tags = (response.json() as { tags: { name: string }[] }).tags;
    expect(tags.map((tag) => tag.name).sort()).toEqual(["出差", "可报销"]);
  });

  it("refuses more than ten tags on one entry", async () => {
    const cookie = await signUp(app, "mama");
    const ids: string[] = [];

    for (let index = 0; index < 11; index += 1) {
      const tag = await createTag(cookie, `标签${String(index)}`);
      ids.push((tag.json() as { id: string }).id);
    }

    const response = await recordEntry(cookie, ids);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "validation_failed" });
  });
});

// ---------------------------------------------------------------------------
// S13-E 批次 3：永久删除 + 历史重关联 + 一次性批量摘要
// ---------------------------------------------------------------------------
/**
 * ⚠️ **These are the tests the owner asked for by name** (S13-E acceptance criteria):
 * *"删除/重关联在服务端事务中完成：并发删除同一对象、无权限、跨账本引用都有测试"*.
 *
 * The behaviours under test are rules, not implementation details:
 *
 *  * 删除已被使用的对象时，历史必须被**重连**，不是丢掉，也不是删掉账目；
 *  * 不选替换时按默认：分类 → `暂无分类`、支付方式 → 未指定、标签 → 解除关联（Q5）；
 *  * **一次批量只写一条摘要**，不给每一笔账目写事件（Q4）；
 *  * 跨账本的替换被拒绝，viewer 的写被拒绝；
 *  * 重复 / 并发请求不能产生脏数据，也不能 500。
 */
describe("permanent delete and history re-pointing", () => {
  /** Register an account and return its cookie, id and its only ledger. */
  async function account(username: string) {
    const cookie = await signUp(app, username);

    const user = await prisma.user.findUniqueOrThrow({
      where: { username },
      select: { id: true, bookMemberships: { select: { bookId: true } } },
    });

    const membership = user.bookMemberships[0];
    if (!membership) throw new Error(`${username} was given no ledger`);

    return { cookie, userId: user.id, bookId: membership.bookId };
  }

  async function permanentDeleteCategory(
    cookie: string,
    id: string,
    payload: Record<string, unknown> = {},
    bookId?: string,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/categories/${id}/permanent-delete`,
      headers: { cookie, ...(bookId === undefined ? {} : { "x-libellum-book": bookId }) },
      payload,
    });
  }

  async function permanentDeletePaymentMethod(
    cookie: string,
    id: string,
    payload: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/payment-methods/${id}/permanent-delete`,
      headers: { cookie },
      payload,
    });
  }

  async function entryIdOf(response: { json: () => unknown }): Promise<string> {
    return (response.json() as { id: string }).id;
  }

  async function softDeleteEntry(cookie: string, id: string) {
    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/transactions/${id}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(204);
  }

  // -------------------------------------------------------------------------
  // 分类
  // -------------------------------------------------------------------------
  it("re-points history to the chosen category and writes exactly one summary", async () => {
    const mama = await account("pd_mama");

    const petId = (await createCategory(mama.cookie, "宠物", "expense").then((r) => r.json()) as {
      id: string;
    }).id;
    const suppliesId = (await createCategory(mama.cookie, "宠物用品", "expense").then((r) => r.json()) as {
      id: string;
    }).id;

    const entry = await recordEntryWith(mama.cookie, { categoryId: petId });
    expect(entry.statusCode).toBe(201);
    const entryId = await entryIdOf(entry);

    /** The `created` event the entry itself wrote — the batch must not add a second one per entry. */
    const eventsBefore = await prisma.transactionEvent.count({ where: { bookId: mama.bookId } });

    const response = await permanentDeleteCategory(mama.cookie, petId, {
      replacementCategoryId: suppliesId,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      affectedEntries: 1,
      replacementId: suppliesId,
      replacementName: "宠物用品",
    });
    expect((response.json() as { operationId: string }).operationId).toBeTruthy();

    // The entry follows the re-pointing…
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/transactions/${entryId}`,
      headers: { cookie: mama.cookie },
    });
    expect((detail.json() as { categoryId: string }).categoryId).toBe(suppliesId);

    // …the category is really gone (archiving is what `DELETE` still does)…
    const after = await ledgerOf(app, mama.cookie);
    expect(findCategory(after, "宠物", "expense")).toBeUndefined();
    expect(await prisma.category.count({ where: { id: petId } })).toBe(0);

    // …and there is **one** batch summary, not one event per entry (Q4).
    const logs = await prisma.ledgerOperationLog.findMany({ where: { bookId: mama.bookId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "category.permanent_delete",
      objectType: "category",
      objectId: petId,
      objectName: "宠物",
      affectedCount: 1,
      actorName: "pd_mama",
    });
    expect(logs[0]?.detail).toMatchObject({ mode: "replacement", movedRows: 1 });
    expect(await prisma.transactionEvent.count({ where: { bookId: mama.bookId } })).toBe(
      eventsBefore,
    );
  });

  it("falls back to the system 暂无分类 when the client does not choose", async () => {
    const mama = await account("pd_mama");
    const petId = (await createCategory(mama.cookie, "宠物", "expense").then((r) => r.json()) as {
      id: string;
    }).id;

    const entry = await recordEntryWith(mama.cookie, { categoryId: petId });
    const entryId = await entryIdOf(entry);

    const ledger = await ledgerOf(app, mama.cookie);
    const system = ledger.categories.find(
      (category) => category.isSystem && category.kind === "expense",
    );
    expect(system?.name).toBe("暂无分类");

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/categories/${petId}/permanent-delete`,
      headers: { cookie: mama.cookie },
      // ⚠️ **No body at all**, which is the shape a client sends when it has nothing to choose —
      // and the shared schema must keep accepting it (an empty body is not malformed input here).
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      affectedEntries: 1,
      replacementId: system?.id,
      replacementName: "暂无分类",
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/transactions/${entryId}`,
      headers: { cookie: mama.cookie },
    });
    expect((detail.json() as { categoryId: string }).categoryId).toBe(system?.id);

    // The default is recorded as a default, not as a choice the user made.
    const log = await prisma.ledgerOperationLog.findFirstOrThrow({
      where: { bookId: mama.bookId },
    });
    expect(log.detail).toMatchObject({ mode: "default" });
  });

  it("refuses a replacement from another ledger and changes nothing", async () => {
    const mama = await account("pd_mama");
    const baba = await account("pd_baba");

    const babaLedger = await ledgerOf(app, baba.cookie);
    const foreign = babaLedger.categories.find((category) => !category.isSystem);
    expect(foreign).toBeDefined();

    const petId = (await createCategory(mama.cookie, "宠物", "expense").then((r) => r.json()) as {
      id: string;
    }).id;
    const entry = await recordEntryWith(mama.cookie, { categoryId: petId });
    const entryId = await entryIdOf(entry);

    const response = await permanentDeleteCategory(mama.cookie, petId, {
      replacementCategoryId: foreign?.id,
    });

    /**
     * ⚠️ 403, not 404: mama is authenticated and is reaching into another ledger's classification.
     * The response says "not in this ledger" and never mentions whose ledger the id belongs to.
     */
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "replacement_invalid" });

    // Nothing was touched — not the category, not the entry, not the log.
    expect(await prisma.category.count({ where: { id: petId } })).toBe(1);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: entryId } })).toMatchObject({
      categoryId: petId,
      deletedAt: null,
    });
    expect(await prisma.ledgerOperationLog.count({ where: { bookId: mama.bookId } })).toBe(0);
  });

  it("refuses itself and a replacement of the other kind", async () => {
    const mama = await account("pd_mama");
    const petId = (await createCategory(mama.cookie, "宠物", "expense").then((r) => r.json()) as {
      id: string;
    }).id;
    const salaryId = (await createCategory(mama.cookie, "外快", "income").then((r) => r.json()) as {
      id: string;
    }).id;

    const itself = await permanentDeleteCategory(mama.cookie, petId, {
      replacementCategoryId: petId,
    });
    expect(itself.statusCode).toBe(400);
    expect(itself.json()).toMatchObject({ code: "replacement_invalid" });

    /**
     * ⚠️ Kind must match even for a system category: 把支出记到收入的分类下面会让按分类的合计
     * 和账目自己的 `kind` 对不上。`access.ts` 对"用户没选分类"更宽容，那不是同一件事。
     */
    const wrongKind = await permanentDeleteCategory(mama.cookie, petId, {
      replacementCategoryId: salaryId,
    });
    expect(wrongKind.statusCode).toBe(400);
    expect(wrongKind.json()).toMatchObject({ code: "replacement_invalid" });

    expect(await prisma.category.count({ where: { id: petId } })).toBe(1);
  });

  it("keeps the system category untouchable, and refuses a viewer", async () => {
    const mama = await account("pd_mama");
    const ledger = await ledgerOf(app, mama.cookie);
    const system = ledger.categories.find((category) => category.isSystem);

    const asSystem = await permanentDeleteCategory(mama.cookie, String(system?.id));
    expect(asSystem.statusCode).toBe(403);
    expect(asSystem.json()).toMatchObject({ code: "category_system" });

    const viewer = await account("pd_viewer");
    await prisma.bookMember.upsert({
      where: { bookId_userId: { bookId: mama.bookId, userId: viewer.userId } },
      create: { bookId: mama.bookId, userId: viewer.userId, role: "viewer" },
      update: { role: "viewer", leftAt: null },
    });

    const petId = (await createCategory(mama.cookie, "宠物", "expense").then((r) => r.json()) as {
      id: string;
    }).id;

    const asViewer = await permanentDeleteCategory(viewer.cookie, petId, {}, mama.bookId);

    // ⚠️ The refusal comes from `book_members` on the server, not from a hidden button.
    expect(asViewer.statusCode).toBe(403);
    expect(asViewer.json()).toMatchObject({ code: "book_read_only" });
    expect(await prisma.category.count({ where: { id: petId } })).toBe(1);
    expect(await prisma.ledgerOperationLog.count({ where: { bookId: mama.bookId } })).toBe(0);
  });

  it("deletes a category whose only references are deleted entries, without asking", async () => {
    const mama = await account("pd_mama");
    const petId = (await createCategory(mama.cookie, "宠物", "expense").then((r) => r.json()) as {
      id: string;
    }).id;

    const entry = await recordEntryWith(mama.cookie, { categoryId: petId });
    const entryId = await entryIdOf(entry);
    await softDeleteEntry(mama.cookie, entryId);

    /**
     * ⚠️ **A tombstone still holds `category_id`** (`ON DELETE RESTRICT`), so it must be re-pointed
     * even though it is not an entry the user can see. This is the case that would otherwise be a
     * 500 from a foreign key violation, and it is why the row count and the reported count differ.
     */
    const response = await permanentDeleteCategory(mama.cookie, petId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ affectedEntries: 0, replacementName: "暂无分类" });

    const tombstone = await prisma.transaction.findUniqueOrThrow({ where: { id: entryId } });
    expect(tombstone.deletedAt).not.toBeNull();
    expect(tombstone.categoryId).not.toBe(petId);

    const log = await prisma.ledgerOperationLog.findFirstOrThrow({
      where: { bookId: mama.bookId },
    });
    expect(log.affectedCount).toBe(0);
    expect(log.detail).toMatchObject({ movedRows: 1 });
  });

  it("is safe to repeat: the second call 404s and the first choice stands", async () => {
    const mama = await account("pd_mama");
    const petId = (await createCategory(mama.cookie, "宠物", "expense").then((r) => r.json()) as {
      id: string;
    }).id;
    const suppliesId = (await createCategory(mama.cookie, "宠物用品", "expense").then((r) => r.json()) as {
      id: string;
    }).id;
    const foodId = (await createCategory(mama.cookie, "宠物食品", "expense").then((r) => r.json()) as {
      id: string;
    }).id;

    const entry = await recordEntryWith(mama.cookie, { categoryId: petId });
    const entryId = await entryIdOf(entry);

    const first = await permanentDeleteCategory(mama.cookie, petId, {
      replacementCategoryId: suppliesId,
    });
    expect(first.statusCode).toBe(200);

    // A double tap, or an offline client resending: the row is gone, and that is a plain 404.
    const second = await permanentDeleteCategory(mama.cookie, petId, {
      replacementCategoryId: foodId,
    });
    expect(second.statusCode).toBe(404);
    expect(second.json()).toMatchObject({ code: "category_missing" });

    // The repeat did **not** quietly re-point the entries to the second replacement.
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: entryId } })).categoryId,
    ).toBe(suppliesId);
    expect(await prisma.ledgerOperationLog.count({ where: { bookId: mama.bookId } })).toBe(1);
  });

  it("survives two simultaneous deletes without mixing the two replacements", async () => {
    const mama = await account("pd_mama");
    const petId = (await createCategory(mama.cookie, "宠物", "expense").then((r) => r.json()) as {
      id: string;
    }).id;
    const firstChoice = (await createCategory(mama.cookie, "宠物用品", "expense").then((r) => r.json()) as {
      id: string;
    }).id;
    const secondChoice = (await createCategory(mama.cookie, "宠物食品", "expense").then((r) => r.json()) as {
      id: string;
    }).id;

    const created = await Promise.all([
      recordEntryWith(mama.cookie, { categoryId: petId }),
      recordEntryWith(mama.cookie, { categoryId: petId }),
      recordEntryWith(mama.cookie, { categoryId: petId }),
    ]);
    const entryIds = created.map((response) => (response.json() as { id: string }).id);

    const [first, second] = await Promise.all([
      permanentDeleteCategory(mama.cookie, petId, { replacementCategoryId: firstChoice }),
      permanentDeleteCategory(mama.cookie, petId, { replacementCategoryId: secondChoice }),
    ]);

    /**
     * ⚠️ **Exactly one wins, and the other is told the category does not exist** — not a 500.
     * The loser's transaction is aborted, so **its re-pointing never becomes a second truth**: the
     * user confirmed one replacement, and a concurrent request must not silently change it.
     */
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 404]);

    const winner = first.statusCode === 200 ? first : second;
    const winnerReplacement = (winner.json() as { replacementId: string }).replacementId;

    const rows = await prisma.transaction.findMany({
      where: { id: { in: entryIds } },
      select: { categoryId: true },
    });
    expect(new Set(rows.map((row) => row.categoryId))).toEqual(new Set([winnerReplacement]));

    expect(await prisma.category.count({ where: { id: petId } })).toBe(0);
    expect(await prisma.ledgerOperationLog.count({ where: { bookId: mama.bookId } })).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 支付方式
  // -------------------------------------------------------------------------
  it("re-points history to another payment method and deletes the row", async () => {
    const mama = await account("pd_mama");

    const cardId = (await addPaymentMethod(mama.cookie, "信用卡").then((r) => r.json()) as {
      id: string;
    }).id;
    const creditId = (await addPaymentMethod(mama.cookie, "花呗").then((r) => r.json()) as {
      id: string;
    }).id;

    const entry = await recordEntryWith(mama.cookie, { paymentMethodId: cardId });
    const entryId = await entryIdOf(entry);

    const response = await permanentDeletePaymentMethod(mama.cookie, cardId, {
      replacementPaymentMethodId: creditId,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      affectedEntries: 1,
      replacementId: creditId,
      replacementName: "花呗",
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/transactions/${entryId}`,
      headers: { cookie: mama.cookie },
    });
    expect((detail.json() as { paymentMethodId: string | null }).paymentMethodId).toBe(creditId);

    expect(await prisma.paymentMethod.count({ where: { id: cardId } })).toBe(0);

    const log = await prisma.ledgerOperationLog.findFirstOrThrow({
      where: { bookId: mama.bookId },
    });
    expect(log).toMatchObject({
      action: "payment_method.permanent_delete",
      objectType: "payment_method",
      objectName: "信用卡",
      affectedCount: 1,
    });
    expect(log.detail).toMatchObject({ mode: "replacement", movedRows: 1 });
  });

  it("clears history to 未指定 when no replacement is given", async () => {
    const mama = await account("pd_mama");
    const cardId = (await addPaymentMethod(mama.cookie, "信用卡").then((r) => r.json()) as {
      id: string;
    }).id;

    const entry = await recordEntryWith(mama.cookie, { paymentMethodId: cardId });
    const entryId = await entryIdOf(entry);

    const response = await permanentDeletePaymentMethod(mama.cookie, cardId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      affectedEntries: 1,
      replacementId: null,
      replacementName: null,
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/transactions/${entryId}`,
      headers: { cookie: mama.cookie },
    });
    // 未指定 is a real answer — the ledger does not grow an "其他" payment method nobody made.
    expect((detail.json() as { paymentMethodId: string | null }).paymentMethodId).toBeNull();

    const log = await prisma.ledgerOperationLog.findFirstOrThrow({
      where: { bookId: mama.bookId },
    });
    expect(log.detail).toMatchObject({ mode: "unspecified", movedRows: 1 });
  });

  it("refuses another ledger's payment method as a replacement", async () => {
    const mama = await account("pd_mama");
    const baba = await account("pd_baba");

    const babaLedger = await ledgerOf(app, baba.cookie);
    const foreign = babaLedger.paymentMethods[0];
    expect(foreign).toBeDefined();

    const cardId = (await addPaymentMethod(mama.cookie, "信用卡").then((r) => r.json()) as {
      id: string;
    }).id;

    const response = await permanentDeletePaymentMethod(mama.cookie, cardId, {
      replacementPaymentMethodId: foreign?.id,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "replacement_invalid" });
    expect(await prisma.paymentMethod.count({ where: { id: cardId } })).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 标签
  // -------------------------------------------------------------------------
  it("unlinks every row but reports only live entries, with one summary", async () => {
    const mama = await account("pd_mama");
    const tagId = (await addTag(mama.cookie, "可报销").then((r) => r.json()) as { id: string }).id;

    const live = await recordEntryWith(mama.cookie, { tagIds: [tagId] });
    const liveId = await entryIdOf(live);
    const gone = await recordEntryWith(mama.cookie, { tagIds: [tagId] });
    const goneId = await entryIdOf(gone);
    await softDeleteEntry(mama.cookie, goneId);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/tags/${tagId}`,
      headers: { cookie: mama.cookie },
    });

    expect(response.statusCode).toBe(200);
    // ⚠️ The number the dialog shows: a tombstone is not an entry (`deleted_at IS NULL`).
    expect(response.json()).toMatchObject({ affectedEntries: 1, replacementId: null });
    expect((response.json() as { operationId: string }).operationId).toBeTruthy();

    // The live entry survives; only the label is gone.
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/transactions/${liveId}`,
      headers: { cookie: mama.cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { tags: unknown[] }).tags).toHaveLength(0);

    // Every link is gone, including the tombstone's.
    expect(await prisma.transactionTag.count({ where: { tagId } })).toBe(0);

    const log = await prisma.ledgerOperationLog.findFirstOrThrow({
      where: { bookId: mama.bookId },
    });
    expect(log).toMatchObject({
      action: "tag.permanent_delete",
      objectType: "tag",
      objectName: "可报销",
      affectedCount: 1,
    });
    expect(log.detail).toMatchObject({ mode: "unlink", unlinkedRows: 2 });
  });

  // -------------------------------------------------------------------------
  // 批量摘要的读路径 + 与数据库的约定
  // -------------------------------------------------------------------------
  it("serves the ledger's batch summaries, and a viewer may read them", async () => {
    const mama = await account("pd_mama");
    const tagId = (await addTag(mama.cookie, "可报销").then((r) => r.json()) as { id: string }).id;
    await recordEntryWith(mama.cookie, { tagIds: [tagId] });
    await app.inject({
      method: "DELETE",
      url: `/api/v1/tags/${tagId}`,
      headers: { cookie: mama.cookie },
    });

    const viewer = await account("pd_viewer");
    await prisma.bookMember.upsert({
      where: { bookId_userId: { bookId: mama.bookId, userId: viewer.userId } },
      create: { bookId: mama.bookId, userId: viewer.userId, role: "viewer" },
      update: { role: "viewer", leftAt: null },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/ledger/operations",
      headers: { cookie: viewer.cookie, "x-libellum-book": mama.bookId },
    });

    // ⚠️ A viewer sees everything except editing — "这个标签是谁删的" is part of seeing it.
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      entries: { action: string; actorName: string | null; affectedCount: number; detail: unknown }[];
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      action: "tag.permanent_delete",
      actorName: "pd_mama",
      affectedCount: 1,
    });
    expect(body.entries[0]?.detail).toMatchObject({ unlinkedRows: 1 });

    // Another ledger's operations are invisible — the read is scoped by `book_id`.
    const baba = await account("pd_baba");
    const other = await app.inject({
      method: "GET",
      url: "/api/v1/ledger/operations",
      headers: { cookie: baba.cookie },
    });
    expect(other.statusCode).toBe(200);
    expect((other.json() as { total: number }).total).toBe(0);
  });

  it("keeps the shared action list in step with the database CHECK constraints", async () => {
    /**
     * ⚠️ **The list exists twice — in `shared` (what the client may see) and in the migration's
     * CHECK constraint (what may be stored).** The project has been bitten by exactly this shape of
     * duplication before (`教训.md` §8.7: 第二份记录迟早会不一致), so the two copies are pinned
     * together here rather than trusted.
     */
    const actionRows = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'ledger_operation_logs_action_known'
    `;
    expect(actionRows).toHaveLength(1);
    const actions = [...(actionRows[0]?.def.matchAll(/'([^']+)'/g) ?? [])]
      .map((match) => match[1] ?? "")
      .sort();
    expect(actions).toEqual([...LEDGER_OPERATION_ACTIONS].sort());

    const typeRows = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'ledger_operation_logs_object_type_known'
    `;
    expect(typeRows).toHaveLength(1);
    const types = [...(typeRows[0]?.def.matchAll(/'([^']+)'/g) ?? [])]
      .map((match) => match[1] ?? "")
      .sort();
    expect(types).toEqual([...LEDGER_OPERATION_OBJECT_TYPES].sort());
  });
});

describe("classification usage preview", () => {
  /** Register an account and return its cookie, id and its only ledger. */
  async function account(username: string) {
    const cookie = await signUp(app, username);

    const user = await prisma.user.findUniqueOrThrow({
      where: { username },
      select: { id: true, bookMemberships: { select: { bookId: true } } },
    });

    const membership = user.bookMemberships[0];
    if (!membership) throw new Error(`${username} was given no ledger`);

    return { cookie, userId: user.id, bookId: membership.bookId };
  }

  async function usage(cookie: string, bookId?: string) {
    return app.inject({
      method: "GET",
      url: "/api/v1/ledger/classification-usage",
      headers: { cookie, ...(bookId === undefined ? {} : { "x-libellum-book": bookId }) },
    });
  }

  async function createObjectIds(cookie: string) {
    const category = await createCategory(cookie, "宠物", "expense");
    expect(category.statusCode).toBe(201);

    /**
     * ⚠️ **A name that is not a preset.** `微信` is seeded into every new ledger, so asking for it
     * returns 409 — and if this helper only read `.id` off the response, the missing key would turn
     * into `[undefined]` in the expected object instead of failing. The status assertions are what
     * make that impossible.
     */
    const paymentMethod = await addPaymentMethod(cookie, "公司卡");
    expect(paymentMethod.statusCode).toBe(201);

    const tag = await addTag(cookie, "可报销");
    expect(tag.statusCode).toBe(201);

    return {
      categoryId: (category.json() as { id: string }).id,
      paymentMethodId: (paymentMethod.json() as { id: string }).id,
      tagId: (tag.json() as { id: string }).id,
    };
  }

  async function softDeleteEntry(cookie: string, id: string) {
    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/transactions/${id}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(204);
  }

  it("counts live entries for all three kinds, and skips tombstones and unused objects", async () => {
    const mama = await account("cu_mama");

    // ⚠️ Nothing has used anything yet — `{}` is a legal answer, not an error and not a 404.
    const empty = await usage(mama.cookie);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ categories: {}, paymentMethods: {}, tags: {} });

    const ids = await createObjectIds(mama.cookie);

    const first = await recordEntryWith(mama.cookie, {
      categoryId: ids.categoryId,
      paymentMethodId: ids.paymentMethodId,
      tagIds: [ids.tagId],
    });
    expect(first.statusCode).toBe(201);

    const second = await recordEntryWith(mama.cookie, {
      categoryId: ids.categoryId,
      paymentMethodId: ids.paymentMethodId,
      tagIds: [ids.tagId],
    });
    expect(second.statusCode).toBe(201);

    const gone = await recordEntryWith(mama.cookie, {
      categoryId: ids.categoryId,
      paymentMethodId: ids.paymentMethodId,
      tagIds: [ids.tagId],
    });
    await softDeleteEntry(mama.cookie, (gone.json() as { id: string }).id);

    const response = await usage(mama.cookie);
    expect(response.statusCode).toBe(200);

    /**
     * ⚠️ **Two, not three**: the tombstone still holds every foreign key, but it is not an entry
     * the user can open — the same `deleted_at IS NULL` rule the entry list and the delete dialog
     * use (`classificationDeleteResponseSchema.affectedEntries`).
     *
     * ⚠️ Only objects that are actually used appear; the book's presets and its system 暂无分类
     * are absent rather than present as 0.
     */
    expect(response.json()).toEqual({
      categories: { [ids.categoryId]: 2 },
      paymentMethods: { [ids.paymentMethodId]: 2 },
      tags: { [ids.tagId]: 2 },
    });
  });

  it("answers only for the ledger named in the header", async () => {
    const mama = await account("cu_mama");
    const baba = await account("cu_baba");

    const mine = await createObjectIds(mama.cookie);
    const theirs = await createObjectIds(baba.cookie);

    const mamaEntry = await recordEntryWith(mama.cookie, {
      categoryId: mine.categoryId,
      paymentMethodId: mine.paymentMethodId,
      tagIds: [mine.tagId],
    });
    expect(mamaEntry.statusCode).toBe(201);

    const babaEntry = await recordEntryWith(baba.cookie, {
      categoryId: theirs.categoryId,
      paymentMethodId: theirs.paymentMethodId,
      tagIds: [theirs.tagId],
    });
    expect(babaEntry.statusCode).toBe(201);

    const mamaUsage = await usage(mama.cookie, mama.bookId);
    expect(mamaUsage.statusCode).toBe(200);
    expect(mamaUsage.json()).toEqual({
      categories: { [mine.categoryId]: 1 },
      paymentMethods: { [mine.paymentMethodId]: 1 },
      tags: { [mine.tagId]: 1 },
    });

    /**
     * ⚠️ Stated separately from `toEqual` because this is the security property, not the shape:
     * **another ledger's ids must not appear in the map at all** — a count is still data.
     */
    for (const id of [theirs.categoryId, theirs.paymentMethodId, theirs.tagId]) {
      expect(JSON.stringify(mamaUsage.json())).not.toContain(id);
    }

    // The other direction works the same way: baba's answer is his own ledger, alone.
    const babaUsage = await usage(baba.cookie, baba.bookId);
    expect(babaUsage.json()).toEqual({
      categories: { [theirs.categoryId]: 1 },
      paymentMethods: { [theirs.paymentMethodId]: 1 },
      tags: { [theirs.tagId]: 1 },
    });
  });

  it("lets a viewer read the counts", async () => {
    const mama = await account("cu_mama");
    const ids = await createObjectIds(mama.cookie);
    const entry = await recordEntryWith(mama.cookie, {
      categoryId: ids.categoryId,
      paymentMethodId: ids.paymentMethodId,
      tagIds: [ids.tagId],
    });
    expect(entry.statusCode).toBe(201);

    const viewer = await account("cu_viewer");
    await prisma.bookMember.upsert({
      where: { bookId_userId: { bookId: mama.bookId, userId: viewer.userId } },
      create: { bookId: mama.bookId, userId: viewer.userId, role: "viewer" },
      update: { role: "viewer", leftAt: null },
    });

    const response = await usage(viewer.cookie, mama.bookId);

    // ⚠️ A viewer sees everything except editing: "有 1 笔账用了它" is part of seeing the ledger.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      categories: { [ids.categoryId]: 1 },
      paymentMethods: { [ids.paymentMethodId]: 1 },
      tags: { [ids.tagId]: 1 },
    });
  });

  it("refuses an anonymous caller and a non-member", async () => {
    const mama = await account("cu_mama");

    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/ledger/classification-usage",
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ code: "not_authenticated" });

    const baba = await account("cu_baba");
    const asStranger = await usage(baba.cookie, mama.bookId);

    // ⚠️ 403, not 404: the caller is signed in and simply has no business in that ledger.
    expect(asStranger.statusCode).toBe(403);
    expect(asStranger.json()).toMatchObject({ code: "book_forbidden" });
  });
});
