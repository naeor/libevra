import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();

vi.mock("./storage.js", () => ({
  listKeys: () => Promise.resolve([...store.keys()]),
  removeValue: (key: string) => {
    store.delete(key);
    return Promise.resolve(true);
  },
}));

import { clearAccountLocalData, clearBookLocalData } from "./localCleanup.js";

describe("local lifecycle cleanup", () => {
  beforeEach(() => {
    store.clear();
    store.set("ledger-months:user-a:book-a", []);
    store.set("ledger-marks:user-a:book-a", {});
    store.set("query-cache:user-a:book-a", {});
    store.set("ledger-months:user-a:book-b", []);
    store.set("ledger-marks:user-b:book-a", {});
    store.set("query-cache:user-b:book-a", {});
    store.set("query-cache", {});
  });

  it("removes only the exact account and book scope", async () => {
    await clearBookLocalData("user-a", "book-a");
    expect(store.has("ledger-months:user-a:book-a")).toBe(false);
    expect(store.has("ledger-marks:user-a:book-a")).toBe(false);
    expect(store.has("query-cache:user-a:book-a")).toBe(false);
    expect(store.has("ledger-months:user-a:book-b")).toBe(true);
    expect(store.has("ledger-marks:user-b:book-a")).toBe(true);
    expect(store.has("query-cache:user-b:book-a")).toBe(true);
  });

  it("removes all ledgers of one account but nothing of another account", async () => {
    await clearAccountLocalData("user-a");
    expect([...store.keys()]).toEqual([
      "ledger-marks:user-b:book-a",
      "query-cache:user-b:book-a",
      "query-cache",
    ]);
  });
});
