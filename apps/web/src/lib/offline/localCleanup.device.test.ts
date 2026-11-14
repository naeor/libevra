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

import { clearGuestData } from "../guest/cleanup.js";
import { createGuestIdentity } from "../guest/identity.js";
import { fxModeKey, messagesSeenKey, presentationSeenKey, sharedLedgerKey } from "../deviceStorageKeys.js";
import { clearAccountLocalData, clearBookLocalData, clearAfterAccountClosure } from "./localCleanup.js";

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
  it("清当前账号的面板、卡片与玻璃设置，保留相似 ID 和设备默认值", async () => {
    const own = ["libevra.desktop.dashboard:v1:user:user-a", "libevra.detail-cards.v2.user-a.book", "libevra.detail-cards.v1.user-a", "libevra.s19-b2-glass:user-a", "libevra.ledger-filter:analysis:user:user-a:book"];
    const keep = ["libevra.desktop.dashboard:v1:guest:user-a", "libevra.detail-cards.v2.user-ab.book", "libevra.s19-b2-glass:local", "libevra.ledger-filter:analysis:user:user-ab:book"];
    for (const key of [...own, ...keep]) state.local.set(key, "{}");
    state.local.set("libevra.s19-b2-legacy-owner", "user-a");
    await clearAccountLocalData("user-a");
    for (const key of own) expect(state.local.has(key), key).toBe(false);
    for (const key of keep) expect(state.local.has(key), key).toBe(true);
    expect(state.local.get("libevra.s19-b2-legacy-owner")).toBe("retired");
  });

  it("注销只按日志正文里的确切账号清导入任务，旧版格式可清，无归属证据的残件保留", async () => {
    const prefix = "libellum-ledger-import-task:";
    for (const [key, value] of Object.entries({
      one: '{"userId":"user-a","request":{"snapshot":"synthetic"}}',
      two: '{"userId":"user-ab"}', old: '{"legacy":true}', bad: '{', empty: 'null',
    })) state.local.set(prefix + key, value);
    await clearAfterAccountClosure("user-a", "user-a");
    expect([...state.local.keys()]).toEqual(["two", "old", "bad", "empty"].map(key => prefix + key));
  });

  it("清游客数据一并移除当前游客面板、筛选与统计恢复副本，其他身份继续保留", async () => {
    const guest = createGuestIdentity()!;
    const own = [
      `libevra.stats-workbench:v1:guest:${guest.id}:previous`,
      `libevra.stats-workbench-presets:v1:guest:${guest.id}`,
      `libevra.stats-workbench-sync:v1:guest:${guest.id}`,
      `libevra.desktop.dashboard:v1:guest:${guest.id}`,
      `libevra.detail-cards.v2.${guest.id}.local`,
      `libevra.ledger-filter:ledger:guest:${guest.id}:book`,
    ];
    const keep = [`libevra.stats-workbench:v1:user:${guest.id}`, `libevra.stats-workbench:v1:guest:${guest.id}x`, "libevra.s19-b2-glass:local"];
    for (const key of [...own, ...keep]) state.local.set(key, "{}");
    await clearGuestData();
    for (const key of own) expect(state.local.has(key), key).toBe(false);
    for (const key of keep) expect(state.local.has(key), key).toBe(true);
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
