import { describe, expect, it } from "vitest";

import { UNCATEGORISED } from "@libellum/shared";

import type { Transaction } from "@libellum/shared";

import {
  GUEST_DATA_SCHEMA_VERSION,
  guestDeletedIds,
  guestLedgerMeta,
  sortedTransactions,
  type GuestData,
} from "./data.js";
import { createDefaultGuestLedger } from "./ledger.js";

function entry(overrides: Partial<Transaction> & { id: string }): Transaction {
  const { id, ...rest } = overrides;
  return {
    id,
    kind: "expense",
    amountCents: 1_234,
    currency: "CNY",
    categoryId: "cat-1",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: null,
    paymentMethodName: null,
    occurredAt: "2026-10-18T12:00:00+08:00",
    occurredLocalDate: "2026-10-18",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    ...rest,
  } as Transaction;
}

function data(transactions: readonly Transaction[], deleted: readonly Transaction[] = []): GuestData {
  return {
    schemaVersion: GUEST_DATA_SCHEMA_VERSION,
    book: createDefaultGuestLedger(new Date("2026-10-18T12:00:00.000Z")),
    categories: [
      {
        id: "cat-1",
        name: "餐饮",
        kind: "expense",
        description: "日常用餐与饮品支出",
        isSystem: false,
        isArchived: false,
        sortOrder: 0,
      },
      {
        id: "system-expense",
        name: UNCATEGORISED.name,
        kind: "expense",
        description: null,
        isSystem: true,
        isArchived: false,
        sortOrder: 9_000,
      },
    ],
    paymentMethods: [{ id: "pm-1", name: "微信", isArchived: false, sortOrder: 0 }],
    tags: [{ id: "tag-1", name: "出差", color: "#55997a" }],
    transactions,
    deleted,
    nextSeq: transactions.length + 1,
  };
}

describe("guest data adapter", () => {
  it("returns entries newest first, which is the order the ledger renders", () => {
    const state = data([
      entry({ id: "old", occurredAt: "2026-10-01T08:00:00+08:00" }),
      entry({ id: "new", occurredAt: "2026-10-18T20:00:00+08:00" }),
      entry({ id: "middle", occurredAt: "2026-10-10T09:00:00+08:00" }),
    ]);

    expect(sortedTransactions(state).map((item) => item.id)).toEqual(["new", "middle", "old"]);
  });

  it("shapes the guest ledger like the server's LedgerMetaResponse", () => {
    const state = data([entry({ id: "a" })]);
    const meta = guestLedgerMeta(state);

    expect(meta.book.id).toBe(state.book.id);
    expect(meta.book.name).toBe(state.book.name);
    expect(meta.book.memberCount).toBe(1);
    expect(meta.book.bookNumber).toBeNull();
    expect(meta.stats?.transactionCount).toBe(1);
    expect(meta.categories.length).toBeGreaterThan(0);
    expect(meta.paymentMethods.length).toBeGreaterThan(0);
  });

  it("exposes deleted entries for the undo flow without rendering them in the list", () => {
    const state = data([entry({ id: "alive" })], [entry({ id: "gone" })]);

    expect(sortedTransactions(state).map((item) => item.id)).toEqual(["alive"]);
    expect(guestDeletedIds(state).has("gone")).toBe(true);
    expect(guestDeletedIds(state).has("alive")).toBe(false);
  });
});
