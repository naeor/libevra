import type { DuplicateReviewChunk, DuplicateReviewCursor } from "@libellum/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

/**
 * S15-E4/E5 · 统一重复检测的候选、审查、批量导入检查三组接口。
 *
 * 覆盖的都是**契约**，不是界面：每笔候选只做一次有界粗筛、审查分块的进度单调、
 * 批量导入按导入编号点名这一批、以及「不是同一笔」的关系会压掉后续提醒。
 *
 * 这些用例跑在真实 PostgreSQL 测试库上（迁移与本地一致），只用测试库。
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

/** 与默认设置等价，但显式写出来：测试里不应该依赖“默认值以后也不变”。 */
const SETTINGS = {
  enabled: true,
  timeWindowSeconds: 60,
  matchCategory: true,
  matchPaymentMethod: true,
} as const;

describe("S15-E4 统一重复检测接口", () => {
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
      select: { id: true, bookMemberships: { select: { bookId: true } } },
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

  async function entry(
    who: Account,
    overrides: Partial<{
      amountCents: bigint;
      occurredAt: Date;
      importRef: string;
    }> = {},
  ): Promise<string> {
    seq += 1;
    const id = txId(seq);
    const occurredAt = overrides.occurredAt ?? new Date("2026-10-21T02:03:00.000Z");

    await prisma.transaction.create({
      data: {
        id,
        bookId: who.bookId,
        userId: who.userId,
        seq,
        categoryId: await uncategorised(who.bookId),
        kind: "expense",
        amountCents: overrides.amountCents ?? 2_000n,
        currency: "CNY",
        occurredAt,
        occurredLocalDate: new Date(occurredAt.toISOString().slice(0, 10)),
        occurredTz: "Asia/Shanghai",
        idempotencyKey: id,
        ...(overrides.importRef === undefined ? {} : { importRef: overrides.importRef }),
      },
    });

    return id;
  }

  function candidate(id: string, bookId: string, at: string) {
    return {
      id,
      bookId,
      kind: "expense" as const,
      amountCents: 2_000,
      currency: "CNY",
      occurredAt: at,
      occurredAtPrecision: "second" as const,
      occurredLocalDate: at.slice(0, 10),
      categoryId: null,
      paymentMethodId: null,
    };
  }

  function headers(who: Account) {
    return { cookie: who.cookie, "x-libellum-book": who.bookId };
  }

  async function candidates(who: Account, payload: unknown) {
    return app.inject({
      method: "POST",
      url: "/api/v1/transactions/duplicates/candidates",
      headers: headers(who),
      payload: payload as Record<string, unknown>,
    });
  }

  async function review(who: Account, payload: unknown) {
    return app.inject({
      method: "POST",
      url: "/api/v1/transactions/duplicates/review",
      headers: headers(who),
      payload: payload as Record<string, unknown>,
    });
  }

  async function importReview(who: Account, payload: unknown) {
    return app.inject({
      method: "POST",
      url: "/api/v1/transactions/duplicates/import-review",
      headers: headers(who),
      payload: payload as Record<string, unknown>,
    });
  }

  it("把一笔新记录和账本里 60 秒内的同一笔配成一对", async () => {
    const who = await account("duplicate_candidates");
    const existing = await entry(who);

    const response = await candidates(who, {
      candidates: [candidate(txId(900), who.bookId, "2026-10-21T10:03:30+08:00")],
      settings: SETTINGS,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ pairs: { leftId: string; rightId: string; matched: boolean }[]; history: { id: string }[] }>();
    expect(body.pairs).toHaveLength(1);
    expect(body.pairs[0]?.matched).toBe(true);
    expect([body.pairs[0]?.leftId, body.pairs[0]?.rightId].sort()).toEqual([existing, txId(900)].sort());
    expect(body.history.map((item) => item.id)).toContain(existing);
  });

  it("超过时间窗口就不算候选", async () => {
    const who = await account("duplicate_window");
    await entry(who);

    const response = await candidates(who, {
      candidates: [candidate(txId(901), who.bookId, "2026-10-21T10:05:01+08:00")],
      settings: SETTINGS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ pairs: unknown[] }>().pairs).toHaveLength(0);
  });

  it("关闭提醒后三种接口都返回空，不会偷偷跑一套不同的规则", async () => {
    const who = await account("duplicate_disabled");
    await entry(who);

    const off = { ...SETTINGS, enabled: false };
    const payload = { candidates: [candidate(txId(902), who.bookId, "2026-10-21T10:03:00+08:00")], settings: off };

    expect((await candidates(who, payload)).json<{ pairs: unknown[] }>().pairs).toHaveLength(0);
    expect((await review(who, { settings: off })).json<{ pairs: unknown[] }>().pairs).toHaveLength(0);
    expect(
      (await importReview(who, { importRef: "In-whatever", settings: off })).json<{ pairs: unknown[] }>().pairs,
    ).toHaveLength(0);
  });

  it("候选不属于当前账本时明确拒绝", async () => {
    const who = await account("duplicate_mismatch");
    const other = await account("dup_mismatch_other");

    const response = await candidates(who, {
      candidates: [candidate(txId(903), other.bookId, "2026-10-21T10:03:00+08:00")],
      settings: SETTINGS,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("book_mismatch");
  });

  it("已确认「不是同一笔」的配对不再出现在新增检查里", async () => {
    const who = await account("duplicate_suppressed");
    const first = await entry(who);
    const second = await entry(who);

    const relation = await app.inject({
      method: "POST",
      url: `/api/v1/books/${who.bookId}/not-duplicate-relations`,
      headers: headers(who),
      payload: { pairs: [{ transactionIdA: first, transactionIdB: second }] },
    });
    expect(relation.statusCode).toBe(201);

    const response = await candidates(who, {
      candidates: [candidate(second, who.bookId, "2026-10-21T10:03:00+08:00")],
      settings: SETTINGS,
    });

    expect(response.json<{ pairs: unknown[] }>().pairs).toHaveLength(0);
  });

  it("全账本审查每对只比一次，进度靠 throughSeq 单调向前", async () => {
    const who = await account("duplicate_review");
    const first = await entry(who);
    const second = await entry(who, { occurredAt: new Date("2026-10-21T02:03:20.000Z") });
    const third = await entry(who, { amountCents: 9_900n });

    const page = await review(who, { settings: SETTINGS });
    expect(page.statusCode).toBe(200);
    const firstPage = page.json<{
      pairs: { pairKey: string }[];
      entries: { id: string }[];
      total: number;
      processed: number;
      nextSeq: number | null;
      throughSeq: number;
    }>();
    expect(firstPage.total).toBe(3);
    expect(firstPage.processed).toBe(3);
    expect(firstPage.pairs).toHaveLength(1);
    expect(firstPage.entries.map((item) => item.id).sort()).toEqual([first, second].sort());
    expect(firstPage.nextSeq).toBeNull();

    const tail = await review(who, { settings: SETTINGS, afterSeq: firstPage.throughSeq, throughSeq: firstPage.throughSeq });
    const tailPage = tail.json<{ pairs: unknown[]; nextSeq: number | null; processed: number }>();
    expect(tailPage.pairs).toHaveLength(0);
    expect(tailPage.processed).toBe(0);
    expect(tailPage.nextSeq).toBeNull();
    expect(third).not.toBe("");
  });

  it("批量导入检查只点名这一批，并在批内也两两比对", async () => {
    const who = await account("duplicate_import");
    const existing = await entry(who);
    const batchFirst = await entry(who, { importRef: "In-20261021-100300-abcd" });
    const batchSecond = await entry(who, { importRef: "In-20261021-100300-abcd" });

    const response = await importReview(who, { importRef: "In-20261021-100300-abcd", settings: SETTINGS });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      pairs: { leftId: string; rightId: string }[];
      entries: { id: string }[];
      checked: number;
      truncated: boolean;
    }>();

    expect(body.checked).toBe(2);
    expect(body.truncated).toBe(false);
    const ids = new Set(body.entries.map((item) => item.id));
    expect(ids.has(batchFirst)).toBe(true);
    expect(ids.has(batchSecond)).toBe(true);
    expect(ids.has(existing)).toBe(true);
    // 三笔两两都落在 60 秒窗口内，所以 3 对都在。
    expect(body.pairs).toHaveLength(3);
  });

  it("没有这笔导入编号时如实说检查了 0 条", async () => {
    const who = await account("dup_import_empty");

    const response = await importReview(who, { importRef: "In-20261021-100400-ef01", settings: SETTINGS });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ checked: number; pairs: unknown[] }>()).toMatchObject({ checked: 0, pairs: [] });
  });
  async function denseEntries(who: Account, count: number): Promise<string[]> {
    const categoryId = await uncategorised(who.bookId);
    const data = Array.from({ length: count }, () => {
      seq += 1; const id = txId(seq);
      return { id, bookId: who.bookId, userId: who.userId, seq, categoryId, kind: "expense" as const,
        amountCents: 2000n, currency: "CNY", occurredAt: new Date("2026-10-21T02:03:00Z"),
        occurredLocalDate: new Date("2026-10-21"), occurredTz: "UTC", idempotencyKey: id };
    });
    await prisma.transaction.createMany({ data });
    return data.map(row => row.id);
  }
  async function ignorePairs(who: Account, pairs: { transactionIdA: string; transactionIdB: string }[]) {
    for (let start = 0; start < pairs.length; start += 200) {
      const response = await app.inject({ method: "POST", url: "/api/v1/books/" + who.bookId + "/not-duplicate-relations",
        headers: headers(who), payload: { pairs: pairs.slice(start, start + 200), decisionSource: "review_group" } });
      expect([200, 201]).toContain(response.statusCode);
    }
  }
  it("密集结果超过500对仍可逐页继续，所有780对恰好一次", async () => {
    const who = await account("dense_review"); await denseEntries(who, 40);
    const keys = new Set<string>(); let cursor: DuplicateReviewCursor | undefined; let processed = 0; let calls = 0;
    do {
      const response = await review(who, { settings: SETTINGS, cursor }); expect(response.statusCode).toBe(200);
      const chunk = response.json<DuplicateReviewChunk>();
      expect(chunk.pairs.length).toBeLessThanOrEqual(500); expect(chunk.truncated).toBe(false);
      for (const pair of chunk.pairs) { expect(keys.has(pair.pairKey)).toBe(false); keys.add(pair.pairKey); }
      processed += chunk.processed; cursor = chunk.nextCursor ?? undefined; calls += 1;
      expect(calls).toBeLessThan(5);
    } while (cursor);
    expect(keys.size).toBe(780); expect(processed).toBe(40);
  });
  it("单笔超过500条历史候选，前500对已忽略也不会漏掉后面的有效对", async () => {
    const who = await account("ignored_review_prefix"); const ids = await denseEntries(who, 503);
    await ignorePairs(who, ids.slice(1, 501).map(id => ({ transactionIdA: ids[0]!, transactionIdB: id })));
    const first = (await review(who, { settings: SETTINGS })).json<DuplicateReviewChunk>();
    expect(first.pairs).toHaveLength(0); expect(first.processed).toBe(0); expect(first.nextCursor).toBeTruthy();
    const second = (await review(who, { settings: SETTINGS, cursor: first.nextCursor })).json<DuplicateReviewChunk>();
    expect(second.pairs.some(pair => pair.leftId === ids[0] && pair.rightId === ids[502])).toBe(true);
    expect(second.processed).toBeGreaterThanOrEqual(1); expect(second.nextCursor).not.toEqual(first.nextCursor);
  });
  it("全部528对已忽略仍以工作量预算前进，最终正常结束", async () => {
    const who = await account("ignored_review_all"); const ids = await denseEntries(who, 33);
    await ignorePairs(who, ids.flatMap((id, i) => ids.slice(i + 1).map(other => ({ transactionIdA: id, transactionIdB: other }))));
    const first = (await review(who, { settings: SETTINGS })).json<DuplicateReviewChunk>();
    expect(first.pairs).toHaveLength(0); expect(first.nextCursor).toBeTruthy();
    const second = (await review(who, { settings: SETTINGS, cursor: first.nextCursor })).json<DuplicateReviewChunk>();
    expect(second.pairs).toHaveLength(0); expect(second.nextCursor).toBeNull();
    expect(first.processed + second.processed).toBe(33);
  });

});
