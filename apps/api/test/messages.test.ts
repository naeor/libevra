import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

/**
 * 账本内的公共留言。
 *
 * ⚠️ **The owner's boundary is narrow and this file tests the boundary, not a chat app**:
 * *"它只属于当前账本……**不提供私人聊天**；不需要复杂的**好友聊天体系**"* and
 * *"**查看者原则上也可以参与文字留言**，因为**交流并不等于修改账目**."*
 *
 * ⚠️ **The viewer case is the one worth having.** Every other assertion here would pass just as well
 * if the routes had used the write guard — **and a viewer silently unable to ask "昨天的菜记了吗"
 * is exactly the bug that guard would cause.**
 */
describe("ledger messages", () => {
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
    const user = await prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true } });
    const membership = await prisma.bookMember.findFirstOrThrow({
      where: { userId: user.id },
      select: { bookId: true },
    });
    return { cookie, userId: user.id, bookId: membership.bookId };
  }

  async function join(userId: string, bookId: string, role: "editor" | "viewer") {
    await prisma.bookMember.upsert({
      where: { bookId_userId: { bookId, userId } },
      create: { bookId, userId, role },
      update: { role, leftAt: null },
    });
  }

  function read(cookie: string, bookId: string) {
    return app.inject({
      method: "GET",
      url: "/api/v1/books/messages",
      headers: { cookie, "x-libellum-book": bookId },
    });
  }

  function say(cookie: string, bookId: string, body: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/books/messages",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { body },
    });
  }

  it("refuses a ledger the caller is not a member of", async () => {
    const owner = await account("msg_owner");
    const outsider = await account("msg_outsider");

    expect((await read(outsider.cookie, owner.bookId)).statusCode).toBe(403);
    expect((await say(outsider.cookie, owner.bookId, "你好")).statusCode).toBe(403);
    expect(await prisma.bookMessage.count()).toBe(0);
  });

  it("lets a viewer read and write — talking is not editing", async () => {
    const owner = await account("msg_owner");
    const viewer = await account("msg_viewer");
    await join(viewer.userId, owner.bookId, "viewer");

    /**
     * ⚠️ **This is the owner's sentence, asserted**: *"查看者原则上也可以参与文字留言，
     * 因为交流并不等于修改账目."* A route that had used `requireBookForWrite` would pass every other
     * test in this file and **fail only here** — which is why this one is not optional.
     */
    const posted = await say(viewer.cookie, owner.bookId, "昨天买菜的 86 元是不是还没有记？");
    expect(posted.statusCode).toBe(201);

    const listed = await read(viewer.cookie, owner.bookId);
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { messages: unknown[] }).messages).toHaveLength(1);

    // ⚠️ And the write permission did NOT widen: a viewer still cannot touch entries.
    const refused = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: viewer.cookie, "x-libellum-book": owner.bookId },
      payload: {},
    });
    /**
     * ⚠️ **403, not 400 — and the difference is the point.** My first version expected the request to
     * fail *validation* (an empty payload), but **the guard runs first**, so a viewer is turned away
     * before anything looks at the body. Asserting 400 would have been asserting the wrong refusal:
     * **"your payload is bad" and "you may not write here" are different sentences.**
     */
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe("book_read_only");
  });

  it("keeps two ledgers' boards apart", async () => {
    const owner = await account("msg_owner");
    await say(owner.cookie, owner.bookId, "第一本的话");

    const second = (
      await app.inject({
        method: "POST",
        url: "/api/v1/books",
        headers: { cookie: owner.cookie },
        payload: { name: "第二本" },
      })
    ).json() as { id: string };

    /**
     * ⚠️ **A message belongs to a ledger, not to the account that wrote it.** This is the assertion
     * that keeps *"它只属于当前账本"* a property: **the same person's words do not appear on the other
     * board.**
     */
    const first = await read(owner.cookie, owner.bookId);
    const other = await read(owner.cookie, second.id);

    expect((first.json() as { messages: { body: string }[] }).messages.map((m) => m.body)).toEqual([
      "第一本的话",
    ]);
    expect((other.json() as { messages: unknown[] }).messages).toHaveLength(0);
  });

  it("stores the sender's name as it was, not as it is now", async () => {
    const owner = await account("msg_owner");
    await say(owner.cookie, owner.bookId, "这笔房租我已经付过了。");

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: owner.userId },
      select: { displayName: true },
    });
    await prisma.user.update({ where: { id: owner.userId }, data: { displayName: "改了名字" } });

    const listed = await read(owner.cookie, owner.bookId);
    const message = (listed.json() as { messages: { senderName: string }[] }).messages[0];

    /**
     * ⚠️ **The signature does not move when the person is renamed.** A join on read would show "改了名字"
     * against a sentence written months earlier — **renaming yourself would silently rewrite everything
     * you ever said**, which is the same failure `TransactionEvent.actorName` exists to prevent.
     */
    expect(message?.senderName).toBe(user.displayName);
    expect(message?.senderName).not.toBe("改了名字");
  });

  it("refuses an empty or oversized message", async () => {
    const owner = await account("msg_owner");

    /** ⚠️ Whitespace is not a message — the database CHECK says the same thing, one layer down. */
    expect((await say(owner.cookie, owner.bookId, "   ")).statusCode).toBe(400);
    expect((await say(owner.cookie, owner.bookId, "x".repeat(501))).statusCode).toBe(400);
    expect((await say(owner.cookie, owner.bookId, "好")).statusCode).toBe(201);
  });

  // ---------------------------------------------------------------------------
  // 账目 / 修改事件引用
  // ---------------------------------------------------------------------------
  async function addEntry(
    owner: { readonly cookie: string; readonly bookId: string },
    note: string,
    index: number,
    amountCents = 8600,
  ): Promise<{ id: string; seq: number }> {
    const category = await prisma.category.findFirstOrThrow({
      where: { bookId: owner.bookId, isSystem: true },
      select: { id: true },
    });
    const id = `01930000-0000-7000-8000-${String(index).padStart(12, "0")}`;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        id,
        idempotencyKey: id,
        kind: "expense",
        amountCents,
        currency: "CNY",
        categoryId: category.id,
        paymentMethodId: null,
        occurredAt: new Date().toISOString(),
        occurredLocalDate: "2026-10-26",
        occurredTz: "Asia/Shanghai",
        note,
        tagIds: [],
      },
    });
    expect(response.statusCode).toBe(201);
    return { id, seq: (response.json() as { seq: number }).seq };
  }

  function sayWithReference(
    cookie: string,
    bookId: string,
    body: string,
    reference: { kind: "transaction" | "event"; id: string } | null,
  ) {
    return app.inject({
      method: "POST",
      url: "/api/v1/books/messages",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { body, reference },
    });
  }

  interface ReferenceView {
    readonly kind: "transaction" | "event";
    readonly id: string;
    readonly available: boolean;
    readonly snapshot: {
      readonly kind: "transaction" | "event";
      readonly title?: string;
      readonly code?: string | null;
      readonly amountCents?: string;
      readonly summary?: string;
      readonly changes?: readonly { label: string; from: string; to: string }[];
    };
  }

  async function messagesOf(cookie: string, bookId: string) {
    const response = await read(cookie, bookId);
    expect(response.statusCode).toBe(200);
    return (response.json() as { messages: { reference: ReferenceView | null }[] }).messages;
  }

  it("quotes an entry without turning ordinary messages into quotes", async () => {
    const owner = await account("msg_quote_owner");
    const entry = await addEntry(owner, "超市买菜", 1);

    const quoted = await sayWithReference(owner.cookie, owner.bookId, "今天超市买的东西都在这里啦～", {
      kind: "transaction",
      id: entry.id,
    });
    expect(quoted.statusCode).toBe(201);

    /**
     * ⚠️ **The unquoted message is the important half of this test.** The board shipped before quotes
     * existed, and the owner's rule is that quoting is optional — *"绝大多数时候，用户仍然应该像现在
     * 一样直接留言"*. If a plain `{body}` ever needed a reference to be accepted, that rule would be
     * broken without any quote-specific test noticing.
     */
    expect((await say(owner.cookie, owner.bookId, "这是普通留言")).statusCode).toBe(201);

    const messages = await messagesOf(owner.cookie, owner.bookId);
    expect(messages).toHaveLength(2);
    const plain = messages.find((message) => message.reference === null);
    expect(plain).toBeDefined();

    const message = messages.find((message) => message.reference !== null);
    const reference = message?.reference;
    expect(reference?.kind).toBe("transaction");
    expect(reference?.id).toBe(entry.id);
    expect(reference?.available).toBe(true);
    /**
     * ⚠️ **The snapshot is the server's, not the client's**: the code, title and amount were read
     * from the book's own row when the message was written. That is what lets the card stay truthful
     * after the entry is edited — and what stops a crafted payload from printing a fake amount.
     */
    expect(reference?.snapshot.title).toBe("超市买菜");
    expect(reference?.snapshot.code).toBe(`#${String(entry.seq).padStart(6, "0")}`);
    expect(reference?.snapshot.amountCents).toBe("8600");
  });

  it("refuses to quote an entry from another ledger", async () => {
    const owner = await account("msg_quote_owner");
    const entry = await addEntry(owner, "本账目的账", 1);

    const secondBook = (
      await app.inject({
        method: "POST",
        url: "/api/v1/books",
        headers: { cookie: owner.cookie },
        payload: { name: "另一本" },
      })
    ).json() as { id: string };

    /**
     * ⚠️ **A copied id must not become a title.** The reference is resolved against the ledger in the
     * request header, so an id belonging to another book is indistinguishable from one that never
     * existed — same unavailability error both times. This is what keeps quoting from being a read
     * oracle across ledgers (a member of book B must not be able to probe book A's entries).
     */
    const cross = await sayWithReference(owner.cookie, secondBook.id, "跨账本引用", {
      kind: "transaction",
      id: entry.id,
    });
    expect(cross.statusCode).toBe(400);
    expect(cross.json().code).toBe("quote_target_unavailable");
  });

  it("keeps a quoted edit as the fact it was, after the entry changes again", async () => {
    const owner = await account("msg_quote_owner");
    const entry = await addEntry(owner, "买菜", 1, 8600);

    await app.inject({
      method: "PATCH",
      url: `/api/v1/transactions/${entry.id}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        version: 2,
        amountCents: 6800,
        changes: [{ field: "amountCents", base: 8600, wanted: 6800, chain: [8600, 6800] }],
      },
    });

    const history = await app.inject({
      method: "GET",
      url: "/api/v1/ledger/history",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    const edit = (
      history.json() as { entries: { id: string; kind: string; changes: { label: string }[] }[] }
    ).entries.find((row) => row.kind === "updated");
    expect(edit).toBeDefined();
    expect(edit?.changes[0]?.label).toBe("金额");

    expect(
      (
        await sayWithReference(owner.cookie, owner.bookId, "刚才多算了 18 块，已经改好。", {
          kind: "event",
          id: edit!.id,
        })
      ).statusCode,
    ).toBe(201);

    /** The entry changes *again* — the quote must not follow it. */
    await app.inject({
      method: "PATCH",
      url: `/api/v1/transactions/${entry.id}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        version: 3,
        amountCents: 4200,
        changes: [{ field: "amountCents", base: 6800, wanted: 4200, chain: [6800, 4200] }],
      },
    });

    const message = (await messagesOf(owner.cookie, owner.bookId))[0];
    expect(message?.reference?.kind).toBe("event");
    expect(message?.reference?.available).toBe(true);
    /**
     * ⚠️ **This is the whole reason events are quoted by id, not "the entry's latest change".** The
     * card must still say 8600 → 6800 after the entry became 4200: a quote is testimony about what
     * was said, not a live view of the row.
     */
    expect(message?.reference?.snapshot.changes).toEqual([{ label: "金额", from: "8600", to: "6800" }]);
  });

  it("degrades a quote whose entry was deleted, without failing the board", async () => {
    const owner = await account("msg_quote_owner");
    const entry = await addEntry(owner, "要删掉的一笔", 1);
    await sayWithReference(owner.cookie, owner.bookId, "这笔稍后删", {
      kind: "transaction",
      id: entry.id,
    });

    await app.inject({
      method: "DELETE",
      url: `/api/v1/transactions/${entry.id}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });

    const messages = await messagesOf(owner.cookie, owner.bookId);
    expect(messages).toHaveLength(1);
    /**
     * ⚠️ **The snapshot survives and `available` flips.** A quote pointing at a deleted entry is a
     * normal historical situation, not an error: the reader still sees what was said, beside a
     * "已删除或不可访问" note. A 500 here would take the whole conversation down with one deletion.
     */
    expect(messages[0]?.reference?.available).toBe(false);
    expect(messages[0]?.reference?.snapshot.title).toBe("要删掉的一笔");

    // And a *new* quote of the deleted entry is refused outright.
    const refused = await sayWithReference(owner.cookie, owner.bookId, "还能引用吗", {
      kind: "transaction",
      id: entry.id,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().code).toBe("quote_target_unavailable");
  });

  it("lists recent targets for the picker and leaves member events out", async () => {
    const owner = await account("msg_quote_owner");
    const entry = await addEntry(owner, "电费", 1);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/books/quote-targets",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(response.statusCode).toBe(200);
    const targets = response.json() as {
      transactions: { id: string; snapshot: { title: string } }[];
      events: { snapshot: { summary: string } }[];
    };

    expect(targets.transactions.map((row) => row.id)).toContain(entry.id);
    expect(targets.transactions[0]?.snapshot.title).toBe("电费");
    expect(targets.events.some((row) => row.snapshot.summary.includes("添加了"))).toBe(true);

    /**
     * ⚠️ **The picker offers entry work, not ledger administration.** `member_changed` and
     * `book_changed` events are history a person may read, but a message replying to "某人加入了这个
     * 账本" would be a different feature — so the query filters kinds at the source.
     */
    const memberEvent = targets.events.find((row) => row.snapshot.summary.includes("成员"));
    expect(memberEvent).toBeUndefined();

    const single = await app.inject({
      method: "GET",
      url: `/api/v1/books/quote-targets/transaction/${entry.id}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(single.statusCode).toBe(200);
    expect((single.json() as { snapshot: { title: string } }).snapshot.title).toBe("电费");

    const missing = await app.inject({
      method: "GET",
      url: `/api/v1/books/quote-targets/transaction/01930000-0000-7000-8000-0000000000ff`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe("quote_target_unavailable");
  });
});
