import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⚠️ Device-key cleanup is asserted separately from the IndexedDB test in
 * `localCleanup.test.ts`, because the two halves fail differently: a missing IndexedDB
 * delete loses offline bookkeeping data, while a missing `localStorage` delete leaks
 * per-account or per-ledger preferences into the next account/ledger on the same device
 * (the 2026-10-25 S16-E audit bug). Both halves need their own regression test.
 */
const state = vi.hoisted(() => ({
  indexed: new Map<string, unknown>(),
  local: new Map<string, string>(),
}));

vi.mock("./storage.js", () => ({
  listKeys: () => Promise.resolve([...state.indexed.keys()]),
  removeValue: (key: string) => Promise.resolve(state.indexed.delete(key)),
}));

import { fxModeKey, messagesSeenKey, presentationSeenKey, sharedLedgerKey } from "../deviceStorageKeys.js";
import { clearAccountLocalData, clearBookLocalData } from "./localCleanup.js";

function fakeStorage(): Storage {
  return {
    get length() {
      return state.local.size;
    },
    key: (index: number) => [...state.local.keys()][index] ?? null,
    getItem: (key: string) => state.local.get(key) ?? null,
    setItem: (key: string, value: string) => {
      state.local.set(key, value);
    },
    removeItem: (key: string) => {
      state.local.delete(key);
    },
    clear: () => {
      state.local.clear();
    },
  };
}

beforeEach(() => {
  state.indexed.clear();
  state.local.clear();
  vi.stubGlobal("localStorage", fakeStorage());
});

describe("local cleanup — device keys", () => {
  it("只清理目标账号的工作台、预设、同步元数据和恢复副本", async () => {
    for (const kind of ["stats-workbench", "stats-workbench-presets", "stats-workbench-sync"]) {
      state.local.set(`libevra.${kind}:v1:user:user-a`, "{}");
      state.local.set(`libevra.${kind}:v1:user:user-a:recovery`, "{}");
      state.local.set(`libevra.${kind}:v1:user:user-ab`, "{}");
      state.local.set(`libevra.${kind}:v1:guest:user-a`, "{}");
    }
    await clearAccountLocalData("user-a");
    for (const kind of ["stats-workbench", "stats-workbench-presets", "stats-workbench-sync"]) {
      expect(state.local.has(`libevra.${kind}:v1:user:user-a`)).toBe(false);
      expect(state.local.has(`libevra.${kind}:v1:user:user-a:recovery`)).toBe(false);
      expect(state.local.has(`libevra.${kind}:v1:user:user-ab`)).toBe(true);
      expect(state.local.has(`libevra.${kind}:v1:guest:user-a`)).toBe(true);
    }
  });
  it("clears the per-ledger device flags together with the ledger's offline copy", async () => {
    state.indexed.set("ledger-months:user-a:book-a", []);
    state.indexed.set("ledger-months:user-a:book-b", []);
    state.local.set(messagesSeenKey("book-a"), "1700000000000");
    state.local.set(sharedLedgerKey("book-a"), "1");
    state.local.set(messagesSeenKey("book-b"), "1700000000000");

    await clearBookLocalData("user-a", "book-a");

    expect(state.indexed.has("ledger-months:user-a:book-a")).toBe(false);
    expect(state.indexed.has("ledger-months:user-a:book-b")).toBe(true);
    expect(state.local.has(messagesSeenKey("book-a"))).toBe(false);
    expect(state.local.has(sharedLedgerKey("book-a"))).toBe(false);
    expect(state.local.has(messagesSeenKey("book-b"))).toBe(true);
  });

  it("clears account-level and per-ledger device flags on account cleanup", async () => {
    state.indexed.set("ledger-months:user-a:book-a", []);
    state.indexed.set("ledger-months:user-b:book-b", []);
    state.local.set("libellum.duplicate-detection.v1.account.user-a", "{}");
    state.local.set("libellum.duplicate-detection.v1.guest", "{}");
    state.local.set(presentationSeenKey("user-a"), "1");
    state.local.set(presentationSeenKey("user-b"), "1");
    state.local.set(fxModeKey("user-a"), "on");
    state.local.set(fxModeKey("user-b"), "on");
    state.local.set(messagesSeenKey("book-a"), "1");
    state.local.set(sharedLedgerKey("book-a"), "1");
    state.local.set(messagesSeenKey("book-b"), "1");

    await clearAccountLocalData("user-a", ["book-a"]);
    expect(state.local.has(fxModeKey("user-a"))).toBe(false);
    expect(state.local.has(fxModeKey("user-b"))).toBe(true);

    expect(state.indexed.has("ledger-months:user-a:book-a")).toBe(false);
    expect(state.indexed.has("ledger-months:user-b:book-b")).toBe(true);
    expect(state.local.has("libellum.duplicate-detection.v1.account.user-a")).toBe(false);
    expect(state.local.has("libellum.duplicate-detection.v1.guest")).toBe(true);
    expect(state.local.has(presentationSeenKey("user-a"))).toBe(false);
    expect(state.local.has(presentationSeenKey("user-b"))).toBe(true);
    expect(state.local.has(messagesSeenKey("book-a"))).toBe(false);
    expect(state.local.has(sharedLedgerKey("book-a"))).toBe(false);
    expect(state.local.has(messagesSeenKey("book-b"))).toBe(true);
  });
});
