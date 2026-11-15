import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Transaction } from "@libellum/shared";

const state = vi.hoisted(() => ({ store: new Map<string, unknown>(), transactions: [] as Transaction[] }));

vi.mock("./storage.js", () => ({
  guestKey: (id: string, name: string) => `guest:${id}:${name}`,
  readGuestValue: async (key: string) => state.store.get(key) ?? null,
  writeGuestValue: async (key: string, value: unknown) => {
    state.store.set(key, structuredClone(value));
    return true;
  },
}));
vi.mock("./data.js", () => ({
  guestDataValue: () => ({ book: { id: "guest-book-1" }, transactions: state.transactions, deleted: [] }),
}));

import {
  createGuestNotDuplicateRelations,
  listGuestNotDuplicateRelations,
  revokeGuestNotDuplicateRelation,
} from "./notDuplicate.js";

const GUEST = "guest-0123456789";

function entry(id: string, amountCents = 1000): Transaction {
  return {
    id,
    seq: 1,
    kind: "expense",
    amountCents,
    currency: "CNY",
    categoryId: "c",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: null,
    paymentMethodName: null,
    occurredAt: "2026-11-01T04:00:00.000Z",
    occurredLocalDate: "2026-11-01",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
  } as Transaction;
}

beforeEach(() => {
  state.store.clear();
  state.transactions = [entry("a"), entry("b")];
});

describe("游客的“不是重复”关系", () => {
  it("存进游客库的专属键，创建、重复创建、撤销都按服务器的语义", async () => {
    const first = await createGuestNotDuplicateRelations(GUEST, { pairs: [{ transactionIdA: "b", transactionIdB: "a" }] });
    expect(first).toMatchObject({ created: 1, reactivated: 0, unchanged: 0 });
    expect([...state.store.keys()]).toEqual([`guest:${GUEST}:not-duplicate`]);

    const again = await createGuestNotDuplicateRelations(GUEST, { pairs: [{ transactionIdA: "a", transactionIdB: "b" }] });
    expect(again).toMatchObject({ created: 0, unchanged: 1 });

    const listed = await listGuestNotDuplicateRelations(GUEST);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ transactionAId: "a", transactionBId: "b", effective: true });

    const id = listed.items[0]!.id;
    await revokeGuestNotDuplicateRelation(GUEST, id);
    expect((await listGuestNotDuplicateRelations(GUEST)).items).toHaveLength(0);
    const revoked = await listGuestNotDuplicateRelations(GUEST, { includeRevoked: true });
    expect(revoked.items[0]).toMatchObject({ effective: false });

    const reactivated = await createGuestNotDuplicateRelations(GUEST, { transactionIds: ["a", "b"] });
    expect(reactivated).toMatchObject({ reactivated: 1 });
  });

  it("关键字段（金额）改过之后失效，不再压住重复提示", async () => {
    await createGuestNotDuplicateRelations(GUEST, { pairs: [{ transactionIdA: "a", transactionIdB: "b" }] });
    state.transactions = [entry("a", 2500), entry("b")];
    const listed = await listGuestNotDuplicateRelations(GUEST);
    expect(listed.items[0]).toMatchObject({ stale: true, effective: false, staleFields: ["amountCents"] });
  });

  it("不存在的账目不会被记成关系", async () => {
    const result = await createGuestNotDuplicateRelations(GUEST, { pairs: [{ transactionIdA: "a", transactionIdB: "zzz" }] });
    expect(result).toMatchObject({ created: 0 });
    expect(state.store.size).toBe(0);
  });
});
