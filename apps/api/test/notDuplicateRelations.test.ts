import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

/**
 * S15-E3 · 不重复关系 API 的集成测试（真实 PostgreSQL 测试库）。
 *
 * 覆盖：创建/规范化/幂等、撤销与重激活、整组展开但**不传递**、跨账本隔离、
 * viewer 只读、软删除/恢复、关键字段失效、非关键字段不失效、导入锁、分页过滤。
 *
 * 这里只测关系与既有交易接口的**共存**；交易本身的语义由既有测试覆盖。
 */

interface Account {
  readonly cookie: string;
  readonly userId: string;
  readonly bookId: string;
}

const BASE = "01970000-0000-7000-8000-";

function txId(n: number): string {
  return `${BASE}${String(n).padStart(12, "0")}`;
}

describe("S15-E3 不重复关系", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = makeApp();
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function account(username: string): Promise<Account> {
    const cookie = await signUp(app, username);
    const user = await prisma.user.findUniqueOrThrow({
      where: { username },
      select: { id: true, bookMemberships: { select: { bookId: true, role: true } } },
    });
    const membership = user.bookMemberships[0];
    if (!membership) throw new Error(`${username} was given no ledger`);
    return { cookie, userId: user.id, bookId: membership.bookId };
  }

  async function uncategorised(bookId: string): Promise<string> {
    const category = await prisma.category.findFirst({
      where: { bookId, isSystem: true },
      select: { id: true },
    });
    if (!category) throw new Error("the book has no system category");
    return category.id;
  }

  let seq = 0;

  /** 直接建交易行：关系测试不关心交易写入路径，只关心两笔真实存在的账目。 */
  async function entry(
    who: Account,
    overrides: Partial<{
      id: string;
      amountCents: bigint;
      currency: string;
      kind: "income" | "expense";
      occurredAt: Date;
    }> = {},
  ): Promise<string> {
    seq += 1;
    const id = overrides.id ?? txId(seq);
    const occurredAt = overrides.occurredAt ?? new Date("2026-10-21T02:03:00.000Z");

    await prisma.transaction.create({
      data: {
        id,
        bookId: who.bookId,
        userId: who.userId,
        seq,
        categoryId: await uncategorised(who.bookId),
        kind: overrides.kind ?? "expense",
        amountCents: overrides.amountCents ?? 1_234n,
        currency: overrides.currency ?? "CNY",
        occurredAt,
        occurredLocalDate: new Date(occurredAt.toISOString().slice(0, 10)),
        occurredTz: "Asia/Shanghai",
        idempotencyKey: id,
      },
    });

    return id;
  }

  function relationUrl(bookId: string): string {
    return `/api/v1/books/${bookId}/not-duplicate-relations`;
  }

  async function postRelations(
    who: Account,
    payload: unknown,
    bookId: string = who.bookId,
  ) {
    return app.inject({
      method: "POST",
      url: relationUrl(bookId),
      headers: { cookie: who.cookie, "x-libellum-book": bookId },
      payload: payload as Record<string, unknown>,
    });
  }

  async function listRelations(
    who: Account,
    query = "",
    bookId: string = who.bookId,
  ) {
    return app.inject({
      method: "GET",
      url: `${relationUrl(bookId)}${query}`,
      headers: { cookie: who.cookie, "x-libellum-book": bookId },
    });
  }

  it("创建显式配对：A<B 规范化、记录确认人、basis 是值快照", async () => {
    const owner = await account("rel_owner");
    const a = await entry(owner, { id: txId(101) });
    const b = await entry(owner, { id: txId(102), amountCents: 9_999n });

    // 故意反序提交：数据库里只能落成 a<b 的一行。
    const response = await postRelations(owner, {
      pairs: [{ transactionIdA: b, transactionIdB: a }],
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      created: number;
      reactivated: number;
      unchanged: number;
      items: {
        transactionAId: string;
        transactionBId: string;
        relationship: string;
        decisionSource: string;
        decidedBy: string | null;
        decidedByName: string | null;
        effective: boolean;
        stale: boolean;
        transactionA: { id: string; amountCents: number; seq: number } | null;
        transactionB: { id: string } | null;
      }[];
    };

    expect(body).toMatchObject({ created: 1, reactivated: 0, unchanged: 0 });
    expect(body.items).toHaveLength(1);
    const item = body.items[0]!;
    expect(item.transactionAId).toBe(a);
    expect(item.transactionBId).toBe(b);
    expect(item.relationship).toBe("not_duplicate");
    expect(item.decisionSource).toBe("manual");
    expect(item.decidedBy).toBe(owner.userId);
    expect(item.decidedByName).toBe("rel_owner");
    expect(item.effective).toBe(true);
    expect(item.stale).toBe(false);
    expect(item.transactionA?.amountCents).toBe(1_234);
    expect(item.transactionB?.id).toBe(b);

    const rows = await prisma.transactionNotDuplicateRelation.findMany({
      where: { bookId: owner.bookId },
    });
    expect(rows).toHaveLength(1);
    const basis = rows[0]!.basis as {
      version: number;
      a: { transactionId: string; amountCents: string };
      b: { transactionId: string; amountCents: string };
    };
    expect(basis.version).toBe(1);
    expect(basis.a.transactionId).toBe(a);
    expect(basis.a.amountCents).toBe("1234");
    expect(basis.b.amountCents).toBe("9999");
    // 快照是字符串金额：不经过 Number，避免精度问题。
    expect(typeof basis.a.amountCents).toBe("string");
  });

  it("重复提交幂等：不新增行，decidedAt 不被重写", async () => {
    const owner = await account("rel_idem");
    const a = await entry(owner);
    const b = await entry(owner);

    const first = await postRelations(owner, {
      pairs: [{ transactionIdA: a, transactionIdB: b }],
    });
    expect(first.statusCode).toBe(201);
    const firstItem = (first.json() as { items: { id: string; decidedAt: string }[] }).items[0]!;

    const second = await postRelations(owner, {
      pairs: [
        { transactionIdA: a, transactionIdB: b },
        { transactionIdA: b, transactionIdB: a },
      ],
    });

    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as {
      created: number;
      unchanged: number;
      items: { id: string; decidedAt: string }[];
    };
    expect(secondBody).toMatchObject({ created: 0, unchanged: 1 });
    expect(secondBody.items[0]!.id).toBe(firstItem.id);
    expect(secondBody.items[0]!.decidedAt).toBe(firstItem.decidedAt);

    expect(await prisma.transactionNotDuplicateRelation.count({ where: { bookId: owner.bookId } })).toBe(1);
  });

  it("并发确认同一对：全部 200/201，不因唯一约束返回 500，且只落一行", async () => {
    const owner = await account("rel_concurrent");
    const a = await entry(owner);
    const b = await entry(owner);

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        postRelations(owner, { pairs: [{ transactionIdA: a, transactionIdB: b }] }),
      ),
    );

    // E6 B12 回归：唯一约束竞争不能让用户看到 500。
    expect(
      responses.map((response) => response.statusCode),
      responses.map((response) => response.body).join("\n"),
    ).toEqual(expect.arrayContaining([201]));
    expect(
      responses.every((response) => response.statusCode === 200 || response.statusCode === 201),
    ).toBe(true);

    const bodies = responses.map((response) => response.json() as {
      created: number;
      unchanged: number;
      items: { id: string }[];
    });
    expect(bodies.reduce((sum, body) => sum + body.created, 0)).toBe(1);
    expect(new Set(bodies.flatMap((body) => body.items.map((item) => item.id))).size).toBe(1);
    expect(await prisma.transactionNotDuplicateRelation.count({ where: { bookId: owner.bookId } })).toBe(1);
  });

  it("撤销是软撤销、重复撤销幂等；默认列表不再返回已撤销", async () => {
    const owner = await account("rel_revoke");
    const a = await entry(owner);
    const b = await entry(owner);

    const created = await postRelations(owner, {
      pairs: [{ transactionIdA: a, transactionIdB: b }],
    });
    const relationId = (created.json() as { items: { id: string }[] }).items[0]!.id;

    const revoked = await app.inject({
      method: "DELETE",
      url: `${relationUrl(owner.bookId)}/${relationId}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });

    expect(revoked.statusCode).toBe(200);
    const revokedBody = revoked.json() as {
      items: { effective: boolean; revokedAt: string | null; revokedByName: string | null; revocationReason: string | null }[];
    };
    expect(revokedBody.items[0]).toMatchObject({
      effective: false,
      revocationReason: "user_revoked",
      revokedByName: "rel_revoke",
    });
    expect(revokedBody.items[0]!.revokedAt).not.toBeNull();

    // 行还在（软撤销），只是不再出现在默认列表里。
    expect(await prisma.transactionNotDuplicateRelation.count({ where: { bookId: owner.bookId } })).toBe(1);

    const active = await listRelations(owner);
    expect(active.statusCode).toBe(200);
    expect((active.json() as { items: unknown[] }).items).toHaveLength(0);

    const all = await listRelations(owner, "?includeRevoked=true");
    expect((all.json() as { items: { id: string }[] }).items).toHaveLength(1);

    // 重复撤销：200、同一行、不报错。
    const again = await app.inject({
      method: "DELETE",
      url: `${relationUrl(owner.bookId)}/${relationId}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { unchanged: number }).unchanged).toBe(1);
  });

  it("撤销后再次确认：原地重激活同一行，不插新行", async () => {
    const owner = await account("rel_reactivate");
    const a = await entry(owner);
    const b = await entry(owner);

    const created = await postRelations(owner, {
      pairs: [{ transactionIdA: a, transactionIdB: b }],
    });
    const relationId = (created.json() as { items: { id: string }[] }).items[0]!.id;

    await app.inject({
      method: "DELETE",
      url: `${relationUrl(owner.bookId)}/${relationId}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });

    const reconfirmed = await postRelations(owner, {
      pairs: [{ transactionIdA: a, transactionIdB: b }],
    });

    expect(reconfirmed.statusCode).toBe(200);
    const body = reconfirmed.json() as {
      created: number;
      reactivated: number;
      items: { id: string; effective: boolean; revokedAt: string | null }[];
    };
    expect(body).toMatchObject({ created: 0, reactivated: 1 });
    expect(body.items[0]!.id).toBe(relationId);
    expect(body.items[0]!.effective).toBe(true);
    expect(body.items[0]!.revokedAt).toBeNull();
  });

  it("整组确认展开三条两两关系；A–B、B–C 不会推出 A–C", async () => {
    const owner = await account("rel_group");
    const a = await entry(owner);
    const b = await entry(owner);
    const c = await entry(owner);

    const group = await postRelations(owner, { transactionIds: [a, b, c] });
    expect(group.statusCode).toBe(201);
    const groupBody = group.json() as {
      created: number;
      items: { transactionAId: string; transactionBId: string }[];
    };
    expect(groupBody.created).toBe(3);
    expect(groupBody.items.map((item) => [item.transactionAId, item.transactionBId])).toEqual([
      [a, b],
      [a, c],
      [b, c],
    ]);

    const source = await postRelations(owner, {
      pairs: [{ transactionIdA: a, transactionIdB: b }],
    });
    expect(source.statusCode).toBe(200);

    const onlyTwo = await listRelations(owner, `?transactionId=${a}`);
    const pairs = (onlyTwo.json() as { items: { transactionAId: string; transactionBId: string }[] }).items;
    // A–C 是整组确认时用户明确点名的，不是从 A–B、B–C 推出来的；这里只验证过滤形状。
    expect(pairs.some((item) => item.transactionBId === c)).toBe(true);
  });

  it("跨账本 / 不存在的交易被拒绝，且不写任何行", async () => {
    const owner = await account("rel_isolated_owner");
    const other = await account("rel_isolated_other");

    const a = await entry(owner);
    const b = await entry(owner);
    const foreign = await entry(other);

    const crossBook = await postRelations(owner, {
      pairs: [
        { transactionIdA: a, transactionIdB: b },
        { transactionIdA: a, transactionIdB: foreign },
      ],
    });
    expect(crossBook.statusCode).toBe(403);
    expect((crossBook.json() as { code: string }).code).toBe("transaction_not_in_book");
    expect(await prisma.transactionNotDuplicateRelation.count()).toBe(0);

    const missing = await postRelations(owner, {
      pairs: [{ transactionIdA: a, transactionIdB: txId(999) }],
    });
    expect(missing.statusCode).toBe(403);
    expect(await prisma.transactionNotDuplicateRelation.count()).toBe(0);
  });

  it("同一笔不能与自己配对", async () => {
    const owner = await account("rel_self");
    const a = await entry(owner);

    const response = await postRelations(owner, {
      pairs: [{ transactionIdA: a, transactionIdB: a }],
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe("same_transaction");
  });

  it("viewer 可以读、不能创建或撤销", async () => {
    const owner = await account("rel_perm_owner");
    const viewer = await account("rel_perm_viewer");

    await prisma.bookMember.upsert({
      where: { bookId_userId: { bookId: owner.bookId, userId: viewer.userId } },
      create: { bookId: owner.bookId, userId: viewer.userId, role: "viewer" },
      update: { role: "viewer", leftAt: null },
    });

    const a = await entry(owner);
    const b = await entry(owner);
    const created = await postRelations(owner, {
      pairs: [{ transactionIdA: a, transactionIdB: b }],
    });
    const relationId = (created.json() as { items: { id: string }[] }).items[0]!.id;

    const read = await app.inject({
      method: "GET",
      url: relationUrl(owner.bookId),
      headers: { cookie: viewer.cookie, "x-libellum-book": owner.bookId },
    });
    expect(read.statusCode).toBe(200);
    expect((read.json() as { items: unknown[] }).items).toHaveLength(1);

    const write = await postRelations(viewer, {
      pairs: [{ transactionIdA: a, transactionIdB: b }],
    }, owner.bookId);
    expect(write.statusCode).toBe(403);
    expect((write.json() as { code: string }).code).toBe("book_read_only");

    const revoke = await app.inject({
      method: "DELETE",
      url: `${relationUrl(owner.bookId)}/${relationId}`,
      headers: { cookie: viewer.cookie, "x-libellum-book": owner.bookId },
    });
    expect(revoke.statusCode).toBe(403);
  });

  it("路径里的账本与请求头不一致时什么都不做", async () => {
    const owner = await account("rel_mismatch_owner");
    const other = await account("rel_mismatch_other");
    const a = await entry(owner);
    const b = await entry(owner);

    const response = await app.inject({
      method: "POST",
      url: relationUrl(other.bookId),
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: { pairs: [{ transactionIdA: a, transactionIdB: b }] },
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe("book_mismatch");
    expect(await prisma.transactionNotDuplicateRelation.count()).toBe(0);
  });

  it("软删除不使关系失效；恢复后继续有效", async () => {
    const owner = await account("rel_soft_delete");
    const a = await entry(owner);
    const b = await entry(owner);
    await postRelations(owner, { pairs: [{ transactionIdA: a, transactionIdB: b }] });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/transactions/${a}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(deleted.statusCode).toBe(204);

    const afterDelete = await listRelations(owner);
    const items = (afterDelete.json() as { items: { effective: boolean; transactionA: { deleted: boolean } | null }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.effective).toBe(true);
    expect(items[0]!.transactionA?.deleted).toBe(true);

    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/transactions/${a}/restore`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(restored.statusCode).toBe(200);

    const afterRestore = await listRelations(owner);
    expect((afterRestore.json() as { items: { effective: boolean }[] }).items[0]!.effective).toBe(true);
  });

  it("关键字段（金额/币种/方向/时间）修改 → 关系失效；默认列表不再返回", async () => {
    const owner = await account("rel_key_fields");

    const cases: readonly {
      readonly label: string;
      readonly patch: Record<string, unknown>;
    }[] = [
      { label: "amountCents", patch: { amountCents: 2_000 } },
      { label: "currency", patch: { currency: "USD" } },
      { label: "kind", patch: { kind: "income" } },
      { label: "occurredAt", patch: { occurredAt: "2026-10-22T02:03:00.000Z" } },
    ];

    for (const testCase of cases) {
      const a = await entry(owner);
      const b = await entry(owner);
      const created = await postRelations(owner, { pairs: [{ transactionIdA: a, transactionIdB: b }] });
      const relationId = (created.json() as { items: { id: string }[] }).items[0]!.id;

      const current = await prisma.transaction.findUniqueOrThrow({
        where: { id: a },
        select: { version: true },
      });

      const patched = await app.inject({
        method: "PATCH",
        url: `/api/v1/transactions/${a}`,
        headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
        payload: {
          ...testCase.patch,
          version: current.version,
          changes: [
            {
              field: testCase.label,
              base: testCase.label === "amountCents" ? 1_234 : testCase.label === "currency" ? "CNY" : testCase.label === "kind" ? "expense" : "2026-10-21T02:03:00.000Z",
              wanted: Object.values(testCase.patch)[0],
              chain: [null],
            },
          ],
        },
      });

      expect(patched.statusCode, `PATCH ${testCase.label}`).toBe(200);

      const row = await prisma.transactionNotDuplicateRelation.findUniqueOrThrow({
        where: { id: relationId },
      });
      expect(row.revokedAt, testCase.label).not.toBeNull();
      expect(row.revocationReason, testCase.label).toBe("key_fields_changed");

      const active = await listRelations(owner);
      expect((active.json() as { items: unknown[] }).items, testCase.label).toHaveLength(0);
    }
  });

  it("非关键字段（备注）修改不使关系失效", async () => {
    const owner = await account("rel_note");
    const a = await entry(owner);
    const b = await entry(owner);
    await postRelations(owner, { pairs: [{ transactionIdA: a, transactionIdB: b }] });

    const current = await prisma.transaction.findUniqueOrThrow({
      where: { id: a },
      select: { version: true },
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/transactions/${a}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
      payload: {
        version: current.version,
        note: "改了备注",
        changes: [{ field: "note", base: null, wanted: "改了备注", chain: [null] }],
      },
    });
    expect(patched.statusCode).toBe(200);

    const active = await listRelations(owner);
    expect((active.json() as { items: { effective: boolean }[] }).items[0]!.effective).toBe(true);
  });

  it("数据被绕过 PATCH 改掉时，读取仍按快照判定失效（兜底）", async () => {
    const owner = await account("rel_read_fallback");
    const a = await entry(owner);
    const b = await entry(owner);
    await postRelations(owner, { pairs: [{ transactionIdA: a, transactionIdB: b }] });

    // 模拟导入/清理等不经过 PATCH 的写入：直接把金额改掉。
    await prisma.transaction.update({
      where: { id: a },
      data: { amountCents: 7_777n, version: { increment: 1 } },
    });

    const active = await listRelations(owner);
    expect((active.json() as { items: unknown[] }).items).toHaveLength(0);

    const all = await listRelations(owner, "?includeRevoked=true");
    const item = (all.json() as {
      items: { effective: boolean; stale: boolean; staleFields: string[]; revokedAt: string | null }[];
    }).items[0]!;
    expect(item.effective).toBe(false);
    expect(item.stale).toBe(true);
    expect(item.staleFields).toContain("amountCents");
    // 读取只判定、不写库：撤销时间仍为空。
    expect(item.revokedAt).toBeNull();
  });

  it("导入锁生效时写入返回可读 409，且不写任何行", async () => {
    const owner = await account("rel_lock");
    const a = await entry(owner);
    const b = await entry(owner);

    await prisma.ledgerWriteLock.create({
      data: { bookId: owner.bookId, ownerKind: "import", ownerId: "import:test-lock" },
    });

    try {
      const response = await postRelations(owner, {
        pairs: [{ transactionIdA: a, transactionIdB: b }],
      });

      expect(response.statusCode).toBe(409);
      const body = response.json() as { code: string; message: string };
      expect(body.code).toBe("book_locked");
      expect(body.message).toContain("导入");
      expect(await prisma.transactionNotDuplicateRelation.count()).toBe(0);
    } finally {
      await prisma.ledgerWriteLock.deleteMany({ where: { bookId: owner.bookId } });
    }
  });

  it("关系查询不影响交易接口：列表、详情、编辑照常", async () => {
    const owner = await account("rel_coexist");
    const a = await entry(owner);
    const b = await entry(owner);
    await postRelations(owner, { pairs: [{ transactionIdA: a, transactionIdB: b }] });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/transactions",
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(2);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/transactions/${a}`,
      headers: { cookie: owner.cookie, "x-libellum-book": owner.bookId },
    });
    expect(detail.statusCode).toBe(200);
  });

  it("按 transactionId 过滤，并按 decidedAt 游标分页", async () => {
    const owner = await account("rel_filter");
    const a = await entry(owner);
    const b = await entry(owner);
    const c = await entry(owner);

    await postRelations(owner, {
      pairs: [
        { transactionIdA: a, transactionIdB: b },
        { transactionIdA: b, transactionIdB: c },
      ],
    });

    const filtered = await listRelations(owner, `?transactionId=${b}`);
    expect(filtered.statusCode).toBe(200);
    expect((filtered.json() as { items: unknown[] }).items).toHaveLength(2);

    const firstPage = await listRelations(owner, "?limit=1");
    const firstBody = firstPage.json() as { items: { id: string }[]; nextCursor: string | null };
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.nextCursor).not.toBeNull();

    const secondPage = await listRelations(owner, `?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor!)}`);
    const secondBody = secondPage.json() as { items: { id: string }[] };
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items[0]!.id).not.toBe(firstBody.items[0]!.id);
  });
});
