import { randomUUID } from "node:crypto";

import {
  fingerprintGuestSource,
  fingerprintTargetSnapshot,
  ledgerImportRequestSchema,
  type GuestImportSource,
  type LedgerImportRequest,
} from "@libellum/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { loadTargetSnapshot } from "../src/ledger/importTarget.js";
import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

/** D2 integration tests: real PostgreSQL transaction, real idempotency, no UI mocks. */
describe("guest ledger import (D2)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = makeApp();
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function account(username: string) {
    const cookie = await signUp(app, username);
    const user = await prisma.user.findUniqueOrThrow({
      where: { username },
      select: { id: true, lastBookId: true },
    });
    const book = await prisma.book.findFirstOrThrow({
      where: { createdBy: user.id, disposedAt: null },
      select: { id: true, name: true },
    });
    return { cookie, userId: user.id, bookId: book.id, bookName: book.name };
  }

  async function ledger(cookie: string, bookId?: string) {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie, ...(bookId === undefined ? {} : { "x-libellum-book": bookId }) },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as {
      book: { id: string; name: string; bookNumber: string | null };
      categories: { id: string; name: string; kind: "expense" | "income"; isSystem: boolean; isArchived: boolean }[];
      paymentMethods: { id: string; name: string; isArchived: boolean; sortOrder: number }[];
      tags: { id: string; name: string; color: string }[];
    };
  }

  async function createTargetTransaction(cookie: string, bookId: string, categoryId: string, amountCents: number) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie, "x-libellum-book": bookId },
      payload: {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        kind: "expense",
        amountCents,
        currency: "CNY",
        categoryId,
        paymentMethodId: null,
        occurredAt: "2026-10-18T09:00:00+08:00",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "目标原有",
        tagIds: [],
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; seq: number };
  }

  function sourceFor(meta: Awaited<ReturnType<typeof ledger>>, suffix: string): {
    source: GuestImportSource;
    taxonomy: LedgerImportRequest["taxonomy"];
  } {
    const food = meta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const payment = meta.paymentMethods[0]!;
    const sourceFoodId = randomUUID();
    const sourcePaymentId = randomUUID();
    return {
      source: {
        name: `旧账本${suffix}`,
        categories: [
          {
            id: sourceFoodId,
            name: food.name,
            kind: food.kind,
            description: null,
            sortOrder: 0,
            isArchived: false,
            isSystem: false,
          },
        ],
        paymentMethods: [
          {
            id: sourcePaymentId,
            name: payment.name,
            sortOrder: payment.sortOrder,
            isArchived: false,
          },
        ],
        tags: [],
        transactions: [
          {
            id: randomUUID(),
            kind: "expense",
            amountCents: 1234,
            currency: "CNY",
            categoryId: sourceFoodId,
            paymentMethodId: sourcePaymentId,
            occurredAt: "2026-10-18T10:00:00+08:00",
            occurredLocalDate: "2026-10-18",
            occurredTz: "Asia/Shanghai",
            note: "来源午餐",
            tagIds: [],
          },
          {
            id: randomUUID(),
            kind: "income",
            amountCents: 500,
            currency: "USD",
            categoryId: sourceFoodId,
            paymentMethodId: null,
            occurredAt: "2026-10-18T11:00:00+08:00",
            occurredLocalDate: "2026-10-18",
            occurredTz: "Asia/Shanghai",
            note: null,
            tagIds: [],
          },
          {
            id: randomUUID(),
            kind: "expense",
            amountCents: 1000,
            currency: "JPY",
            categoryId: sourceFoodId,
            paymentMethodId: null,
            occurredAt: "2026-10-18T12:00:00+08:00",
            occurredLocalDate: "2026-10-18",
            occurredTz: "Asia/Shanghai",
            note: null,
            tagIds: [],
          },
        ],
      },
      taxonomy: [
        { type: "category", sourceId: sourceFoodId, action: "reuse", targetId: food.id },
        { type: "paymentMethod", sourceId: sourcePaymentId, action: "reuse", targetId: payment.id },
      ],
    };
  }

  async function requestForExisting(
    importId: string,
    targetBookId: string,
    source: GuestImportSource,
    taxonomy: LedgerImportRequest["taxonomy"],
    duplicateGroups: LedgerImportRequest["duplicateGroups"] = [],
  ): Promise<LedgerImportRequest> {
    const target = await loadTargetSnapshot(prisma, targetBookId);
    return ledgerImportRequestSchema.parse({
      importId,
      target: {
        kind: "existing",
        bookId: targetBookId,
        expectedTargetFingerprint: await fingerprintTargetSnapshot(target),
      },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy,
      duplicateGroups,
    });
  }

  it("imports guest entries into an existing ledger with multiple currencies and is idempotent", async () => {
    const owner = await account("import_existing");
    const meta = await ledger(owner.cookie, owner.bookId);
    const existing = await createTargetTransaction(
      owner.cookie,
      owner.bookId,
      meta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!.id,
      999,
    );
    const { source, taxonomy } = sourceFor(meta, "A");
    const importId = randomUUID();
    const body = await requestForExisting(importId, owner.bookId, source, taxonomy);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    const result = first.json() as {
      importedCount: number;
      skippedCount: number;
      targetExistingBefore: number;
      targetCountAfter: number;
      totals: { currency: string; expenseCents: number; incomeCents: number; count: number }[];
      imported: { sourceTransactionId: string; targetTransactionId: string; targetSeq: number }[];
      reconciled: boolean;
    };
    expect(result.importedCount).toBe(3);
    expect(result.skippedCount).toBe(0);
    expect(result.targetExistingBefore).toBe(1);
    expect(result.targetCountAfter).toBe(4);
    expect(result.reconciled).toBe(true);
    expect(result.totals).toEqual([
      { currency: "CNY", expenseCents: 1234, incomeCents: 0, count: 1 },
      { currency: "JPY", expenseCents: 1000, incomeCents: 0, count: 1 },
      { currency: "USD", expenseCents: 0, incomeCents: 500, count: 1 },
    ]);
    expect(result.imported).toHaveLength(3);

    const targetRows = await prisma.transaction.findMany({
      where: { bookId: owner.bookId, deletedAt: null },
      select: { id: true, seq: true, sourceRef: true },
      orderBy: { seq: "asc" },
    });
    expect(targetRows).toHaveLength(4);
    const original = targetRows.find((row) => row.id === existing.id);
    expect(original?.seq).toBe(existing.seq);
    expect(targetRows.filter((row) => row.sourceRef !== null)).toHaveLength(3);
    expect(new Set(targetRows.map((row) => row.seq)).size).toBe(4);

    // Retry the exact same importId: same receipt, no second set of rows.
    const retry = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ importId, importedCount: 3, targetCountAfter: 4 });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(4);

    // Reusing the same source under a new import id is refused; no silent duplicate rows.
    const secondId = randomUUID();
    const secondBody = await requestForExisting(secondId, owner.bookId, source, taxonomy);
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: secondBody,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "already_imported" });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(4);
  });

  it("rejects a stale source fingerprint and a target that changed after preview", async () => {
    const owner = await account("import_stale");
    const meta = await ledger(owner.cookie, owner.bookId);
    const { source, taxonomy } = sourceFor(meta, "B");
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const body = ledgerImportRequestSchema.parse({
      importId: randomUUID(),
      target: {
        kind: "existing",
        bookId: owner.bookId,
        expectedTargetFingerprint: await fingerprintTargetSnapshot(target),
      },
      source,
      sourceFingerprint: "a".repeat(64),
      taxonomy,
      duplicateGroups: [],
    });
    const staleSource = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(staleSource.statusCode).toBe(409);
    expect(staleSource.json()).toMatchObject({ code: "source_changed" });

    const valid = await requestForExisting(randomUUID(), owner.bookId, source, taxonomy);
    await createTargetTransaction(
      owner.cookie,
      owner.bookId,
      meta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!.id,
      777,
    );
    const staleTarget = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: valid,
    });
    expect(staleTarget.statusCode).toBe(409);
    expect(staleTarget.json()).toMatchObject({ code: "target_changed" });
  });

  it("honours an explicit taxonomy conflict choice and refuses another account's book", async () => {
    const owner = await account("import_taxonomy");
    const meta = await ledger(owner.cookie, owner.bookId);
    const food = meta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const targetTagResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tags",
      headers: { cookie: owner.cookie },
      payload: { name: "出差", color: "#111111" },
    });
    expect(targetTagResponse.statusCode).toBe(201);
    const { source, taxonomy } = sourceFor(meta, "TAX");
    const sourceTagId = randomUUID();
    source.tags.push({ id: sourceTagId, name: "出差", color: "#999999" });
    source.transactions[0]!.tagIds = [sourceTagId];
    taxonomy.push({ type: "tag", sourceId: sourceTagId, action: "create", createName: "出差（来源）" });

    const body = await requestForExisting(randomUUID(), owner.bookId, source, taxonomy);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    const tags = await prisma.tag.findMany({ where: { bookId: owner.bookId }, orderBy: { name: "asc" } });
    expect(tags.map((tag) => tag.name)).toContain("出差（来源）");
    expect(tags.find((tag) => tag.name === "出差")?.color).toBe("#111111");
    expect(tags.find((tag) => tag.name === "出差（来源）")?.color).toBe("#999999");

    const intruder = await account("import_intruder");
    const intruderBody = await requestForExisting(randomUUID(), owner.bookId, source, taxonomy);
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: intruder.cookie },
      payload: intruderBody,
    });
    expect(forbidden.statusCode).toBe(403);
  });
  it("imports into a newly created ledger and retrying does not create a second book", async () => {
    const owner = await account("import_new_book");
    const meta = await ledger(owner.cookie, owner.bookId);
    const source = sourceFor(meta, "C").source;
    // A source-only archived category and tag must survive as archived/coloured target objects.
    const uniqueCat = randomUUID();
    const uniqueTag = randomUUID();
    const uniquePayment = randomUUID();
    source.categories.push({
      id: uniqueCat,
      name: "旧分类",
      kind: "expense",
      description: "来源分类说明",
      sortOrder: 1,
      isArchived: true,
      isSystem: false,
    });
    source.tags.push({ id: uniqueTag, name: "旧标签", color: "#b8574f" });
    source.paymentMethods.push({ id: uniquePayment, name: "旧支付", sortOrder: 99, isArchived: true });
    source.transactions[0]!.categoryId = uniqueCat;
    source.transactions[0]!.tagIds = [uniqueTag];
    source.transactions[1]!.paymentMethodId = uniquePayment;

    const importId = randomUUID();
    const body = ledgerImportRequestSchema.parse({
      importId,
      target: { kind: "new", name: "导入的新账本" },
      source,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: [
        ...source.categories.map((item) => ({ type: "category" as const, sourceId: item.id, action: "auto" as const })),
        ...source.paymentMethods.map((item) => ({
          type: "paymentMethod" as const,
          sourceId: item.id,
          action: "auto" as const,
        })),
        ...source.tags.map((item) => ({ type: "tag" as const, sourceId: item.id, action: "auto" as const })),
      ],
      duplicateGroups: [],
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    const result = response.json() as {
      targetBook: { id: string; name: string; created: boolean };
      importedCount: number;
      taxonomy: { categoriesCreated: number; tagsCreated: number };
    };
    expect(result.targetBook.created).toBe(true);
    expect(result.targetBook.name).toBe("导入的新账本");
    expect(result.importedCount).toBe(3);
    expect(result.taxonomy.tagsCreated).toBe(1);

    const books = await prisma.book.findMany({ where: { createdBy: owner.userId }, select: { id: true, name: true } });
    expect(books.filter((book) => book.name === "导入的新账本")).toHaveLength(1);

    const retry = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ targetBook: { id: result.targetBook.id }, importedCount: 3 });
    expect(await prisma.book.count({ where: { createdBy: owner.userId, name: "导入的新账本" } })).toBe(1);

    const newBookLedger = await ledger(owner.cookie, result.targetBook.id);
    const importedCategory = newBookLedger.categories.find((item) => item.name === "旧分类");
    expect(importedCategory?.isArchived).toBe(true);
    expect(newBookLedger.tags.find((item) => item.name === "旧标签")?.color).toBe("#b8574f");
    expect(newBookLedger.paymentMethods.find((item) => item.name === "旧支付")?.isArchived).toBe(true);
  });

  it("D3 one-to-one keep-B soft-deletes the chosen A, imports B, and restores through the existing entry route", async () => {
    const owner = await account("d3_keep_b");
    const meta = await ledger(owner.cookie, owner.bookId);
    const food = meta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const original = await createTargetTransaction(owner.cookie, owner.bookId, food.id, 2500);
    const { source, taxonomy } = sourceFor(meta, "KB");
    const duplicateSourceId = randomUUID();
    source.transactions.push({
      id: duplicateSourceId,
      kind: "expense",
      amountCents: 2500,
      currency: "CNY",
      categoryId: source.categories[0]!.id,
      paymentMethodId: null,
      occurredAt: "2026-10-18T09:00:20+08:00",
      occurredLocalDate: "2026-10-18",
      occurredTz: "Asia/Shanghai",
      note: "来源替代目标",
      tagIds: [],
    });
    const importId = randomUUID();
    const body = await requestForExisting(importId, owner.bookId, source, taxonomy, [
      { groupId: "one", action: "keep_b", sourceIds: [duplicateSourceId], targetIds: [original.id] },
    ]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    const result = response.json() as {
      importedCount: number;
      skippedCount: number;
      removedCount: number;
      targetCountAfter: number;
      removedTargets: { targetTransactionId: string; targetSeq: number; groupId: string }[];
    };
    expect(result).toMatchObject({ importedCount: 4, skippedCount: 0, removedCount: 1, targetCountAfter: 4 });
    expect(result.removedTargets).toEqual([
      { targetTransactionId: original.id, targetSeq: original.seq, groupId: "one" },
    ]);

    const deletedRow = await prisma.transaction.findUniqueOrThrow({
      where: { id: original.id },
      select: { deletedAt: true, seq: true, version: true },
    });
    expect(deletedRow.deletedAt).not.toBeNull();
    expect(deletedRow.seq).toBe(original.seq);
    const event = await prisma.transactionEvent.findFirstOrThrow({
      where: { transactionId: original.id, kind: "deleted" },
      orderBy: { occurredAt: "desc" },
    });
    expect(event.changes).toMatchObject({ importId: { to: importId }, importSource: { to: "guest" } });

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/transactions/${original.id}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: original.id, deletedAt: expect.any(String) as string, deletedByImportId: importId });

    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/transactions/${original.id}/restore`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ id: original.id, seq: original.seq });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(5);

    const retry = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ importId, removedCount: 1, importedCount: 4 });
    // A retry returns the receipt; it must not soft-delete the restored row again.
    expect(
      await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } }),
    ).toBe(5);
  });

  it("D3 one-to-one supports all four choices in one confirmed import", async () => {
    const owner = await account("d3_four_choices");
    const meta = await ledger(owner.cookie, owner.bookId);
    const food = meta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const targetRows: { id: string; seq: number }[] = [];
    for (const amount of [1001, 1002, 1003, 1004]) {
      targetRows.push(await createTargetTransaction(owner.cookie, owner.bookId, food.id, amount));
    }
    const { source, taxonomy } = sourceFor(meta, "FOUR");
    const sourceCategoryId = source.categories[0]!.id;
    const sourceIds: string[] = [];
    for (const amount of [1001, 1002, 1003, 1004]) {
      const id = randomUUID();
      sourceIds.push(id);
      source.transactions.push({
        id,
        kind: "expense",
        amountCents: amount,
        currency: "CNY",
        categoryId: sourceCategoryId,
        paymentMethodId: null,
        occurredAt: "2026-10-18T09:00:20+08:00",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "四种选择",
        tagIds: [],
      });
    }
    const actions = ["keep_a", "keep_b", "keep_both", "keep_neither"] as const;
    const groups = actions.map((action, index) => ({
      groupId: `choice-${action}`,
      action,
      sourceIds: [sourceIds[index]!],
      targetIds: [targetRows[index]!.id],
    }));
    const body = await requestForExisting(randomUUID(), owner.bookId, source, taxonomy, groups);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    const result = response.json() as {
      importedCount: number;
      skippedCount: number;
      removedCount: number;
      targetCountAfter: number;
      removedTargets: { targetTransactionId: string; groupId: string }[];
    };
    expect(result).toMatchObject({ importedCount: 5, skippedCount: 2, removedCount: 2, targetCountAfter: 7 });
    expect(result.removedTargets.map((item) => item.targetTransactionId).sort()).toEqual(
      [targetRows[1]!.id, targetRows[3]!.id].sort(),
    );
    expect(result.removedTargets.map((item) => item.groupId).sort()).toEqual(["choice-keep_b", "choice-keep_neither"]);
    const live = await prisma.transaction.findMany({
      where: { bookId: owner.bookId, deletedAt: null },
      select: { id: true },
    });
    expect(live.some((row) => row.id === targetRows[0]!.id)).toBe(true);
    expect(live.some((row) => row.id === targetRows[1]!.id)).toBe(false);
    expect(live.some((row) => row.id === targetRows[2]!.id)).toBe(true);
    expect(live.some((row) => row.id === targetRows[3]!.id)).toBe(false);
  });
  it("D3 multi-record group removes only the explicitly selected A records", async () => {
    const owner = await account("d3_multi_remove");
    const meta = await ledger(owner.cookie, owner.bookId);
    const food = meta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const first = await createTargetTransaction(owner.cookie, owner.bookId, food.id, 1000);
    const second = await createTargetTransaction(owner.cookie, owner.bookId, food.id, 2000);
    const { source, taxonomy } = sourceFor(meta, "MR");
    const sourceCategoryId = source.categories[0]!.id;
    const s1 = randomUUID();
    const s2 = randomUUID();
    for (const [id, amountCents] of [
      [s1, 1000],
      [s2, 2000],
    ] as const) {
      source.transactions.push({
        id,
        kind: "expense",
        amountCents,
        currency: "CNY",
        categoryId: sourceCategoryId,
        paymentMethodId: null,
        occurredAt: "2026-10-18T09:00:20+08:00",
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "多对多来源",
        tagIds: [],
      });
    }

    // A multi-record group must not get a shortcut that deletes more than one A row.
    const shortcut = await requestForExisting(randomUUID(), owner.bookId, source, taxonomy, [
      { groupId: "multi", action: "keep_b", sourceIds: [s1, s2], targetIds: [first.id, second.id] },
    ]);
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: shortcut,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ code: "group_removal_not_explicit" });

    const body = await requestForExisting(randomUUID(), owner.bookId, source, taxonomy, [
      {
        groupId: "multi",
        action: "custom",
        sourceIds: [s1, s2],
        targetIds: [first.id, second.id],
        sourceActions: [
          { sourceTransactionId: s1, action: "import" },
          { sourceTransactionId: s2, action: "skip" },
        ],
        targetActions: [
          { targetTransactionId: first.id, action: "remove" },
          { targetTransactionId: second.id, action: "keep" },
        ],
      },
    ]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ importedCount: 4, skippedCount: 1, removedCount: 1, targetCountAfter: 5 });
    expect(
      await prisma.transaction.findUniqueOrThrow({ where: { id: first.id }, select: { deletedAt: true } }),
    ).toMatchObject({ deletedAt: expect.any(Date) as Date });
    expect(
      await prisma.transaction.findUniqueOrThrow({ where: { id: second.id }, select: { deletedAt: true } }),
    ).toMatchObject({ deletedAt: null });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(5);
  });

  it("D3 rolls back soft deletions when the rest of the import fails", async () => {
    const owner = await account("d3_rollback");
    const meta = await ledger(owner.cookie, owner.bookId);
    const food = meta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const original = await createTargetTransaction(owner.cookie, owner.bookId, food.id, 2500);
    const { source, taxonomy } = sourceFor(meta, "RB");
    const duplicateSourceId = randomUUID();
    source.transactions.push({
      id: duplicateSourceId,
      kind: "expense",
      amountCents: 2500,
      currency: "CNY",
      categoryId: source.categories[0]!.id,
      paymentMethodId: null,
      occurredAt: "2026-10-18T09:00:20+08:00",
      occurredLocalDate: "2026-10-18",
      occurredTz: "Asia/Shanghai",
      note: "会触发回滚",
      tagIds: [],
    });
    // Make a second target row claim one source ref. The insert then fails after the soft delete,
    // proving the whole D3 transaction rolls back rather than leaving A removed and B unwritten.
    const blocker = await createTargetTransaction(owner.cookie, owner.bookId, food.id, 999);
    await prisma.transaction.update({
      where: { id: blocker.id },
      data: { sourceRef: duplicateSourceId },
    });
    const body = await requestForExisting(randomUUID(), owner.bookId, source, taxonomy, [
      { groupId: "one", action: "keep_b", sourceIds: [duplicateSourceId], targetIds: [original.id] },
    ]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "already_imported" });
    expect(
      await prisma.transaction.findUniqueOrThrow({ where: { id: original.id }, select: { deletedAt: true } }),
    ).toMatchObject({ deletedAt: null });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(2);
  });
  it("keeps one-to-many and many-to-many group decisions consistent without deleting A", async () => {
    const owner = await account("import_groups");
    const meta = await ledger(owner.cookie, owner.bookId);
    const food = meta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const t1 = await createTargetTransaction(owner.cookie, owner.bookId, food.id, 1000);
    const t2 = await createTargetTransaction(owner.cookie, owner.bookId, food.id, 1000);
    const t3 = await createTargetTransaction(owner.cookie, owner.bookId, food.id, 3000);
    const { source, taxonomy } = sourceFor(meta, "GRP");
    const sourceCategoryId = source.categories[0]!.id;
    const s1 = randomUUID();
    const s2 = randomUUID();
    const s3 = randomUUID();
    const s4 = randomUUID();
    for (const [id, amountCents, time] of [
      [s1, 1000, "2026-10-18T10:00:20+08:00"],
      [s2, 1000, "2026-10-18T10:00:30+08:00"],
      [s3, 3000, "2026-10-18T12:00:10+08:00"],
      [s4, 3000, "2026-10-18T12:00:20+08:00"],
    ] as const) {
      source.transactions.push({
        id,
        kind: "expense",
        amountCents,
        currency: "CNY",
        categoryId: sourceCategoryId,
        paymentMethodId: null,
        occurredAt: time,
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note: "组内来源",
        tagIds: [],
      });
    }
    const body = await requestForExisting(randomUUID(), owner.bookId, source, taxonomy, [
      { groupId: "many", action: "keep_both", sourceIds: [s1, s2], targetIds: [t1.id, t2.id] },
      { groupId: "one", action: "keep_a", sourceIds: [s3, s4], targetIds: [t3.id] },
    ]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ importedCount: 5, skippedCount: 2, targetCountAfter: 8 });
    const rows = await prisma.transaction.findMany({
      where: { bookId: owner.bookId, deletedAt: null },
      select: { id: true },
    });
    expect(rows).toHaveLength(8);
    for (const targetId of [t1.id, t2.id, t3.id]) {
      expect(rows.some((row) => row.id === targetId)).toBe(true);
    }
  });
  it("applies keep-A decisions without deleting target entries", async () => {
    const owner = await account("import_decisions");
    const meta = await ledger(owner.cookie, owner.bookId);
    const food = meta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const original = await createTargetTransaction(owner.cookie, owner.bookId, food.id, 2500);
    const { source, taxonomy } = sourceFor(meta, "D");
    const dupSource = randomUUID();
    source.transactions.push({
      id: dupSource,
      kind: "expense",
      amountCents: 2500,
      currency: "CNY",
      categoryId: source.categories[0]!.id,
      paymentMethodId: null,
      occurredAt: "2026-10-18T09:00:30+08:00",
      occurredLocalDate: "2026-10-18",
      occurredTz: "Asia/Shanghai",
      note: "可能重复",
      tagIds: [],
    });

    const keepAImportId = randomUUID();
    const keepABody = await requestForExisting(keepAImportId, owner.bookId, source, taxonomy, [
      {
        groupId: "g1",
        action: "keep_a",
        sourceIds: [dupSource],
        targetIds: [original.id],
      },
    ]);
    const keepA = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: keepABody,
    });
    expect(keepA.statusCode).toBe(200);
    expect(keepA.json()).toMatchObject({ importedCount: 3, skippedCount: 1, targetCountAfter: 4 });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(4);

    // Re-importing the same source under a new import id is refused; D2 has no incremental
    // import yet, so this is the deliberate guard rather than a silent duplicate.
    const secondId = randomUUID();
    const secondBody = await requestForExisting(secondId, owner.bookId, source, taxonomy, [
      { groupId: "g1", action: "keep_a", sourceIds: [dupSource], targetIds: [original.id] },
    ]);
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: secondBody,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "already_imported" });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(4);
  });

  it("applies keep-both decisions without deleting target entries", async () => {
    const owner = await account("import_keep_both");
    const meta = await ledger(owner.cookie, owner.bookId);
    const food = meta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const original = await createTargetTransaction(owner.cookie, owner.bookId, food.id, 2500);
    const { source, taxonomy } = sourceFor(meta, "E");
    const dupSource = randomUUID();
    source.transactions.push({
      id: dupSource,
      kind: "expense",
      amountCents: 2500,
      currency: "CNY",
      categoryId: source.categories[0]!.id,
      paymentMethodId: null,
      occurredAt: "2026-10-18T09:00:30+08:00",
      occurredLocalDate: "2026-10-18",
      occurredTz: "Asia/Shanghai",
      note: "两边都保留",
      tagIds: [],
    });
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    expect(original.id).toBe(target.transactions[0]?.id);

    const importId = randomUUID();
    const body = await requestForExisting(importId, owner.bookId, source, taxonomy, [
      { groupId: "g1", action: "keep_both", sourceIds: [dupSource], targetIds: [original.id] },
    ]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ importedCount: 4, skippedCount: 0, targetCountAfter: 5 });
    const rows = await prisma.transaction.findMany({
      where: { bookId: owner.bookId, deletedAt: null },
      select: { id: true, seq: true },
    });
    expect(rows).toHaveLength(5);
    expect(rows.find((row) => row.id === original.id)?.seq).toBe(original.seq);
  });
});
