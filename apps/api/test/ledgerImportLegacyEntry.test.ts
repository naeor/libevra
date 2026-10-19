import { randomUUID } from "node:crypto";

import { ledgerImportResultSchema } from "@libellum/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

describe("legacy direct import entry is disabled for production clients", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = makeApp({ allowLegacyDirectImport: false });
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function account(username: string) {
    const cookie = await signUp(app, username);
    const user = await prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true } });
    const book = await prisma.book.findFirstOrThrow({
      where: { createdBy: user.id, disposedAt: null },
      select: { id: true, name: true, bookNumber: true },
    });
    return { cookie, userId: user.id, book };
  }

  function legacyPayload(target: unknown) {
    return {
      importId: randomUUID(),
      target,
      source: {
        name: "旧 PWA 缓存来源",
        guestBookId: `guest-book-${randomUUID().slice(0, 8)}`,
        categories: [],
        paymentMethods: [],
        tags: [],
        transactions: [],
      },
      sourceFingerprint: "0".repeat(64),
      taxonomy: [],
      duplicateGroups: [],
      incrementalDecisions: [],
    };
  }

  it("rejects both target-new and target-existing direct writes with a server-side error", async () => {
    const owner = await account("legacy_direct_owner");
    const before = await prisma.transaction.count({ where: { bookId: owner.book.id } });
    const existing = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: legacyPayload({
        kind: "existing",
        bookId: owner.book.id,
        expectedTargetFingerprint: "0".repeat(64),
      }),
    });
    expect(existing.statusCode).toBe(409);
    expect(existing.json()).toMatchObject({ code: "legacy_import_disabled" });

    const targetNew = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: legacyPayload({ kind: "new", name: "旧入口新建目标" }),
    });
    expect(targetNew.statusCode).toBe(409);
    expect(targetNew.json()).toMatchObject({ code: "legacy_import_disabled" });
    expect(await prisma.transaction.count({ where: { bookId: owner.book.id } })).toBe(before);
    expect(await prisma.ledgerImportJob.count({ where: { userId: owner.userId } })).toBe(0);
  });

  it("still replays an existing historical receipt read-only", async () => {
    const owner = await account("legacy_receipt_owner");
    const importId = randomUUID();
    const result = ledgerImportResultSchema.parse({
      importId,
      targetBook: {
        id: owner.book.id,
        name: owner.book.name,
        bookNumber: owner.book.bookNumber,
        created: false,
      },
      sourceCount: 0,
      importedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      removedCount: 0,
      targetExistingBefore: 0,
      targetCountAfter: 0,
      removedTargets: [],
      totals: [],
      imported: [],
      updated: [],
      taxonomy: {
        categoriesCreated: 0,
        paymentMethodsCreated: 0,
        tagsCreated: 0,
        categoriesReused: 0,
        paymentMethodsReused: 0,
        tagsReused: 0,
      },
      reconciled: true,
    });
    await prisma.ledgerImport.create({
      data: {
        id: importId,
        userId: owner.userId,
        targetBookId: owner.book.id,
        targetCreated: false,
        sourceFingerprint: "0".repeat(64),
        targetFingerprint: "0".repeat(64),
        importedCount: 0,
        skippedCount: 0,
        result,
      },
    });

    const replayPayload = legacyPayload({
      kind: "existing",
      bookId: owner.book.id,
      expectedTargetFingerprint: "0".repeat(64),
    });
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: { ...replayPayload, importId },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ importId, reconciled: true });
    expect(await prisma.transaction.count({ where: { bookId: owner.book.id } })).toBe(0);
  });
});
