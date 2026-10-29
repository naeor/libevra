import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

describe("CSV file import atomicity and ledger-lock compatibility", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function multipart(csv: string): { boundary: string; body: string } {
    const boundary = "----libevra-csv-test";
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="import.csv"\r\n' +
      "Content-Type: text/csv\r\n\r\n" +
      csv +
      `\r\n--${boundary}--\r\n`;
    return { boundary, body };
  }

  it("rolls back new tags, entries and the import log when the ledger is locked", async () => {
    const app = makeApp();
    const cookie = await signUp(app, "csv_atomic_owner");
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: "csv_atomic_owner" },
      select: { id: true },
    });
    const book = await prisma.book.findFirstOrThrow({
      where: { createdBy: user.id, disposedAt: null },
      select: { id: true },
    });
    await prisma.ledgerWriteLock.create({
      data: {
        bookId: book.id,
        ownerKind: "import",
        ownerId: "import:00000000-0000-4000-8000-000000000000",
      },
    });

    const csv = "日期,金额,分类,标签\r\n2026-10-18,12.34,工资,锁定测试标签\r\n";
    const { boundary, body } = multipart(csv);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/import",
      headers: {
        cookie,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-libellum-book": book.id,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "ledger_locked" });
    // The new tag was moved inside the same transaction as the entries. A write rejected by the
    // database trigger must therefore leave no tag, entry or import-log residue behind.
    expect(await prisma.tag.count({ where: { bookId: book.id, name: "锁定测试标签" } })).toBe(0);
    expect(await prisma.transaction.count({ where: { bookId: book.id } })).toBe(0);
    expect(await prisma.importLog.count({ where: { bookId: book.id } })).toBe(0);
  });

  it("commits tags and entries together when the ledger is not locked", async () => {
    const app = makeApp();
    const cookie = await signUp(app, "csv_atomic_ok");
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: "csv_atomic_ok" },
      select: { id: true },
    });
    const book = await prisma.book.findFirstOrThrow({
      where: { createdBy: user.id, disposedAt: null },
      select: { id: true },
    });

    const csv = "日期,金额,分类,标签\r\n2026-10-18,12.34,工资,正常测试标签\r\n";
    const { boundary, body } = multipart(csv);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/import",
      headers: {
        cookie,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-libellum-book": book.id,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(await prisma.transaction.count({ where: { bookId: book.id } })).toBe(1);
    expect(await prisma.tag.count({ where: { bookId: book.id, name: "正常测试标签" } })).toBe(1);
    expect(await prisma.importLog.count({ where: { bookId: book.id } })).toBe(1);
  });
});
