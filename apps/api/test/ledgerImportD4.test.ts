import { randomUUID } from "node:crypto";

import {
  ledgerImportRequestSchema,
  type LedgerImportRequest,
} from "@libellum/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

/**
 * S14-D D4 integration tests: formal solo B → solo A.
 *
 * These use the real PostgreSQL database because the important properties are membership/invite
 * eligibility, fingerprints and transaction/idempotency behavior — not UI mocks.
 */
describe("formal ledger import (D4)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = makeApp();
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  interface Account {
    readonly cookie: string;
    readonly userId: string;
    readonly bookId: string;
  }

  async function account(username: string): Promise<Account> {
    const cookie = await signUp(app, username);
    const user = await prisma.user.findUniqueOrThrow({
      where: { username },
      select: { id: true },
    });
    const book = await prisma.book.findFirstOrThrow({
      where: { createdBy: user.id, disposedAt: null },
      select: { id: true },
    });
    return { cookie, userId: user.id, bookId: book.id };
  }

  async function createBook(account: Account, name: string): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/books",
      headers: { cookie: account.cookie },
      payload: { name },
    });
    expect(response.statusCode).toBe(201);
    return (response.json() as { id: string }).id;
  }

  async function ledger(cookie: string, bookId: string) {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/ledger",
      headers: { cookie, "x-libellum-book": bookId },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as {
      book: { id: string; name: string; bookNumber: string | null };
      categories: { id: string; name: string; kind: "expense" | "income"; isSystem: boolean }[];
      paymentMethods: { id: string; name: string }[];
      tags: { id: string; name: string; color: string }[];
    };
  }

  async function addTransaction(
    cookie: string,
    bookId: string,
    categoryId: string,
    amountCents: number,
    note: string,
    occurredAt: string,
  ) {
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
        occurredAt,
        occurredLocalDate: "2026-10-18",
        occurredTz: "Asia/Shanghai",
        note,
        tagIds: [],
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; seq: number; version: number };
  }

  async function preview(account: Account, sourceBookId: string, targetBookId: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/preview",
      headers: { cookie: account.cookie },
      payload: { sourceBookId, targetBookId },
    });
  }

  type Preview = {
    sourceBook: { id: string; name: string; bookNumber: string | null };
    targetBook: { id: string; name: string; bookNumber: string | null };
    source: {
      name: string;
      categories: { id: string; name: string; kind: "expense" | "income"; isSystem: boolean }[];
      paymentMethods: { id: string; name: string }[];
      tags: { id: string; name: string; color: string }[];
      transactions: { id: string }[];
    };
    sourceFingerprint: string;
    target: {
      categories: { id: string; name: string; kind: "expense" | "income"; isSystem: boolean }[];
      paymentMethods: { id: string; name: string }[];
      tags: { id: string; name: string; color: string }[];
      transactions: { id: string }[];
    };
    targetFingerprint: string;
  };

  function taxonomyFor(previewData: Preview): LedgerImportRequest["taxonomy"] {
    const { source, target } = previewData;
    const taxonomy: LedgerImportRequest["taxonomy"] = [];
    for (const category of source.categories) {
      const match = target.categories.find(
        (item) => item.kind === category.kind && item.name === category.name,
      );
      taxonomy.push(
        match === undefined
          ? { type: "category", sourceId: category.id, action: "create", createName: category.name }
          : { type: "category", sourceId: category.id, action: "reuse", targetId: match.id },
      );
    }
    for (const payment of source.paymentMethods) {
      const match = target.paymentMethods.find((item) => item.name === payment.name);
      taxonomy.push(
        match === undefined
          ? { type: "paymentMethod", sourceId: payment.id, action: "create", createName: payment.name }
          : { type: "paymentMethod", sourceId: payment.id, action: "reuse", targetId: match.id },
      );
    }
    for (const tag of source.tags) {
      const match = target.tags.find((item) => item.name === tag.name);
      taxonomy.push(
        match === undefined
          ? { type: "tag", sourceId: tag.id, action: "create", createName: tag.name }
          : { type: "tag", sourceId: tag.id, action: "reuse", targetId: match.id },
      );
    }
    return taxonomy;
  }

  function formalRequest(
    previewData: Preview,
    duplicateGroups: LedgerImportRequest["duplicateGroups"] = [],
  ): LedgerImportRequest {
    return ledgerImportRequestSchema.parse({
      importId: randomUUID(),
      target: {
        kind: "existing",
        bookId: previewData.targetBook.id,
        expectedTargetFingerprint: previewData.targetFingerprint,
      },
      sourceBookId: previewData.sourceBook.id,
      sourceFingerprint: previewData.sourceFingerprint,
      taxonomy: taxonomyFor(previewData),
      duplicateGroups,
    });
  }

  async function prepareFormalPair() {
    const owner = await account("d4_owner");
    const sourceBookId = await createBook(owner, "D4来源B");
    const sourceMeta = await ledger(owner.cookie, sourceBookId);
    const sourceFood = sourceMeta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    await addTransaction(
      owner.cookie,
      sourceBookId,
      sourceFood.id,
      1000,
      "来源旧账一",
      "2026-10-18T13:00:00+08:00",
    );
    await addTransaction(
      owner.cookie,
      sourceBookId,
      sourceFood.id,
      2000,
      "来源旧账二",
      "2026-10-18T14:00:00+08:00",
    );
    return { owner, sourceBookId, sourceMeta };
  }

  it("imports formal B into an empty solo A and keeps B untouched", async () => {
    const { owner, sourceBookId } = await prepareFormalPair();
    const previewResponse = await preview(owner, sourceBookId, owner.bookId);
    expect(previewResponse.statusCode).toBe(200);
    const previewData = previewResponse.json() as Preview;
    expect(previewData.sourceBook.id).toBe(sourceBookId);
    expect(previewData.targetBook.id).toBe(owner.bookId);

    const request = formalRequest(previewData);
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: request,
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({
      sourceBookId,
      importedCount: 2,
      skippedCount: 0,
      targetExistingBefore: 0,
      targetCountAfter: 2,
    });

    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(2);
    expect(await prisma.transaction.count({ where: { bookId: sourceBookId, deletedAt: null } })).toBe(2);
    const sourceNotes = await prisma.transaction.findMany({
      where: { bookId: sourceBookId, deletedAt: null },
      select: { note: true },
      orderBy: { occurredAt: "asc" },
    });
    expect(sourceNotes.map((row) => row.note)).toEqual(["来源旧账一", "来源旧账二"]);

    const retry = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: request,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ importId: request.importId, importedCount: 2 });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(2);
  });

  it("handles concurrent submissions of the same importId without duplicating rows", async () => {
    const { owner, sourceBookId } = await prepareFormalPair();
    const previewData = (await preview(owner, sourceBookId, owner.bookId)).json() as Preview;
    const request = formalRequest(previewData);
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/ledger-imports",
        headers: { cookie: owner.cookie },
        payload: request,
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/ledger-imports",
        headers: { cookie: owner.cookie },
        payload: request,
      }),
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(first.json()).toMatchObject({ importId: request.importId, importedCount: 2 });
    expect(second.json()).toMatchObject({ importId: request.importId, importedCount: 2 });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(2);
    expect(await prisma.transaction.count({ where: { bookId: sourceBookId, deletedAt: null } })).toBe(2);
  });

  it("imports formal B into a non-empty A with a keep-both duplicate decision", async () => {
    const owner = await account("d4_existing");
    const targetMeta = await ledger(owner.cookie, owner.bookId);
    const targetFood = targetMeta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const existing = await addTransaction(
      owner.cookie,
      owner.bookId,
      targetFood.id,
      1000,
      "目标原有",
      "2026-10-18T13:00:15+08:00",
    );
    const sourceBookId = await createBook(owner, "D4来源B");
    const sourceMeta = await ledger(owner.cookie, sourceBookId);
    const sourceFood = sourceMeta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const sourceDuplicate = await addTransaction(
      owner.cookie,
      sourceBookId,
      sourceFood.id,
      1000,
      "来源重复",
      "2026-10-18T13:00:00+08:00",
    );
    await addTransaction(
      owner.cookie,
      sourceBookId,
      sourceFood.id,
      2000,
      "来源独有",
      "2026-10-18T14:00:00+08:00",
    );

    const previewResponse = await preview(owner, sourceBookId, owner.bookId);
    expect(previewResponse.statusCode).toBe(200);
    const previewData = previewResponse.json() as Preview;
    expect(previewData.target.transactions).toHaveLength(1);
    const group = {
      groupId: "d4-keep-both",
      action: "keep_both" as const,
      sourceIds: [sourceDuplicate.id],
      targetIds: [existing.id],
    };
    const request = formalRequest(previewData, [group]);
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: request,
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ importedCount: 2, skippedCount: 0, targetCountAfter: 3 });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(3);
    expect(await prisma.transaction.count({ where: { bookId: sourceBookId, deletedAt: null } })).toBe(2);
    expect(
      await prisma.transaction.findUniqueOrThrow({ where: { id: existing.id }, select: { seq: true } }),
    ).toMatchObject({ seq: existing.seq });
  });

  it("rejects a second member in either B or A, including a viewer", async () => {
    const { owner, sourceBookId } = await prepareFormalPair();
    const other = await account("d4_other_member");
    await prisma.bookMember.create({
      data: { bookId: sourceBookId, userId: other.userId, role: "viewer" },
    });
    const sourceRejected = await preview(owner, sourceBookId, owner.bookId);
    expect(sourceRejected.statusCode).toBe(403);
    expect(sourceRejected.json()).toMatchObject({ code: "book_not_solo" });

    await prisma.bookMember.deleteMany({ where: { bookId: sourceBookId, userId: other.userId } });
    await prisma.bookMember.create({
      data: { bookId: owner.bookId, userId: other.userId, role: "editor" },
    });
    const targetRejected = await preview(owner, sourceBookId, owner.bookId);
    expect(targetRejected.statusCode).toBe(403);
    expect(targetRejected.json()).toMatchObject({ code: "book_not_solo" });
  });

  it("rejects pending invites and active share links, but allows a former member who left", async () => {
    const { owner, sourceBookId } = await prepareFormalPair();
    const other = await account("d4_invited");

    await prisma.notification.create({
      data: {
        recipientId: other.userId,
        senderId: owner.userId,
        bookId: sourceBookId,
        kind: "book_invite",
        status: "pending",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const inviteRejected = await preview(owner, sourceBookId, owner.bookId);
    expect(inviteRejected.statusCode).toBe(403);
    expect(inviteRejected.json()).toMatchObject({ code: "book_has_pending_invite" });
    await prisma.notification.deleteMany({ where: { bookId: sourceBookId } });

    const linkResponse = await app.inject({
      method: "POST",
      url: "/api/v1/share/links",
      headers: { cookie: owner.cookie, "x-libellum-book": sourceBookId },
      payload: { role: "viewer" },
    });
    expect(linkResponse.statusCode).toBe(201);
    const shareRejected = await preview(owner, sourceBookId, owner.bookId);
    expect(shareRejected.statusCode).toBe(403);
    expect(shareRejected.json()).toMatchObject({ code: "book_has_active_share_link" });
    await prisma.bookShareLink.deleteMany({ where: { bookId: sourceBookId } });

    await prisma.bookMember.create({
      data: { bookId: sourceBookId, userId: other.userId, role: "viewer", leftAt: new Date() },
    });
    const allowed = await preview(owner, sourceBookId, owner.bookId);
    expect(allowed.statusCode).toBe(200);
  });

  it("rejects source and target changes after preview, and membership changes before submit", async () => {
    const { owner, sourceBookId } = await prepareFormalPair();
    const initialPreview = await preview(owner, sourceBookId, owner.bookId);
    expect(initialPreview.statusCode).toBe(200);
    const previewData = initialPreview.json() as Preview;

    const sourceTransaction = await prisma.transaction.findFirstOrThrow({
      where: { bookId: sourceBookId, deletedAt: null },
      select: { id: true },
    });
    await prisma.transaction.update({
      where: { id: sourceTransaction.id },
      data: { note: "预览后修改来源" },
    });
    const sourceChanged = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: formalRequest(previewData),
    });
    expect(sourceChanged.statusCode).toBe(409);
    expect(sourceChanged.json()).toMatchObject({ code: "source_changed" });

    // New preview for the target-change case; the source is now at its new state.
    const secondPreviewResponse = await preview(owner, sourceBookId, owner.bookId);
    const secondPreview = secondPreviewResponse.json() as Preview;
    const targetMeta = await ledger(owner.cookie, owner.bookId);
    const food = targetMeta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const targetRow = await addTransaction(
      owner.cookie,
      owner.bookId,
      food.id,
      500,
      "预览后新增目标",
      "2026-10-18T15:00:00+08:00",
    );
    expect(targetRow.id).toBeTruthy();
    const targetChanged = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: formalRequest(secondPreview),
    });
    expect(targetChanged.statusCode).toBe(409);
    expect(targetChanged.json()).toMatchObject({ code: "target_changed" });
  });

  it("soft-deletes an explicitly selected A record and restores it through the existing route", async () => {
    const owner = await account("d4_soft_delete");
    const targetMeta = await ledger(owner.cookie, owner.bookId);
    const targetFood = targetMeta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const original = await addTransaction(
      owner.cookie,
      owner.bookId,
      targetFood.id,
      2500,
      "D4目标待移除",
      "2026-10-18T13:00:20+08:00",
    );
    const sourceBookId = await createBook(owner, "D4来源B");
    const sourceMeta = await ledger(owner.cookie, sourceBookId);
    const sourceFood = sourceMeta.categories.find((item) => item.name === "餐饮" && item.kind === "expense")!;
    const sourceDuplicate = await addTransaction(
      owner.cookie,
      sourceBookId,
      sourceFood.id,
      2500,
      "D4来源替代",
      "2026-10-18T13:00:00+08:00",
    );

    const previewData = (await preview(owner, sourceBookId, owner.bookId)).json() as Preview;
    const request = formalRequest(previewData, [
      {
        groupId: "d4-keep-b",
        action: "keep_b",
        sourceIds: [sourceDuplicate.id],
        targetIds: [original.id],
      },
    ]);
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: request,
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ importedCount: 1, removedCount: 1, targetCountAfter: 1 });
    expect(
      await prisma.transaction.findUniqueOrThrow({ where: { id: original.id }, select: { deletedAt: true } }),
    ).toMatchObject({ deletedAt: expect.any(Date) as Date });

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/transactions/${original.id}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ deletedAt: expect.any(String) as string, deletedByImportId: request.importId });
    const deletionEvent = await prisma.transactionEvent.findFirstOrThrow({
      where: { transactionId: original.id, kind: "deleted" },
      orderBy: { occurredAt: "desc" },
    });
    expect(deletionEvent.changes).toMatchObject({ importId: { to: request.importId }, importSource: { to: "book" } });

    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/transactions/${original.id}/restore`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(restored.statusCode).toBe(200);
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(2);
    expect(await prisma.transaction.count({ where: { bookId: sourceBookId, deletedAt: null } })).toBe(1);
  });

  it("rejects a member/invite change after preview, before the final submit", async () => {
    const { owner, sourceBookId } = await prepareFormalPair();
    const previewData = (await preview(owner, sourceBookId, owner.bookId)).json() as Preview;
    const request = formalRequest(previewData);
    const other = await account("d4_late_member");
    await prisma.bookMember.create({
      data: { bookId: sourceBookId, userId: other.userId, role: "viewer" },
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: request,
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ code: "book_not_solo" });
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, deletedAt: null } })).toBe(0);
  });

  it("allows expired invites and rejects a pending invite on the target", async () => {
    const { owner, sourceBookId } = await prepareFormalPair();
    const other = await account("d4_target_invite");
    const expired = await prisma.notification.create({
      data: {
        recipientId: other.userId,
        senderId: owner.userId,
        bookId: sourceBookId,
        kind: "book_invite",
        status: "pending",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    expect((await preview(owner, sourceBookId, owner.bookId)).statusCode).toBe(200);
    await prisma.notification.delete({ where: { id: expired.id } });

    await prisma.notification.create({
      data: {
        recipientId: other.userId,
        senderId: owner.userId,
        bookId: owner.bookId,
        kind: "book_invite",
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const rejected = await preview(owner, sourceBookId, owner.bookId);
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ code: "book_has_pending_invite" });
  });

  it("serializes membership changes with the formal import transaction lock", async () => {
    const { owner, sourceBookId } = await prepareFormalPair();
    const other = await account("d4_lock_member");
    const { lockFormalImportPair } = await import("../src/ledger/importSolo.js");
    let release: (() => void) | undefined;
    const acquired = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      setTimeout(resolve, 1000);
    });
    const holder = prisma.$transaction(async (tx) => {
      await lockFormalImportPair(tx, sourceBookId, owner.bookId);
      release?.();
      await gate;
    });
    await acquired;

    const insert = prisma.bookMember.create({
      data: { bookId: sourceBookId, userId: other.userId, role: "viewer" },
    });
    const raced = await Promise.race([
      insert.then(() => "inserted" as const),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100)),
    ]);
    expect(raced).toBe("blocked");
    await holder;
    await insert;
    expect(
      await prisma.bookMember.count({ where: { bookId: sourceBookId, leftAt: null } }),
    ).toBe(2);
  });

  it("rejects same-book and new-target formal requests, and another account's books", async () => {
    const { owner, sourceBookId } = await prepareFormalPair();
    const same = await preview(owner, sourceBookId, sourceBookId);
    expect(same.statusCode).toBe(400);
    expect(same.json()).toMatchObject({ code: "book_source_same_as_target" });

    const previewResponse = await preview(owner, sourceBookId, owner.bookId);
    const previewData = previewResponse.json() as Preview;
    const newTarget = ledgerImportRequestSchema.safeParse({
      importId: randomUUID(),
      target: { kind: "new", name: "不应创建" },
      sourceBookId,
      sourceFingerprint: previewData.sourceFingerprint,
      taxonomy: [],
      duplicateGroups: [],
    });
    expect(newTarget.success).toBe(false);

    const other = await account("d4_outsider");
    const denied = await preview(other, sourceBookId, owner.bookId);
    expect(denied.statusCode).toBe(403);
  });
});
