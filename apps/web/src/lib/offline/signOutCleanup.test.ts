import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUG-007（1.19.83）：退出登录 / 会话结束时清掉这个账号留在本机的账目副本；还有未同步改动的账本保留未同步的记录。
 */
const store = new Map<string, unknown>();

vi.mock("./storage.js", () => ({
  listKeys: () => Promise.resolve([...store.keys()]),
  readValue: (key: string) => Promise.resolve(store.has(key) ? store.get(key) : null),
  removeValue: (key: string) => {
    const had = store.delete(key);
    return Promise.resolve(had);
  },
}));

import { clearSignedOutAccountData, clearSignedOutQueryCache } from "./localCleanup.js";

describe("退出登录清理本账号的本机副本", () => {
  beforeEach(() => {
    store.clear();
    // user-a：book-a 全部已同步；book-b 有一笔未同步；book-c 有一笔本机删除、服务器还不知道。
    store.set("query-cache:user-a:book-a", "{}");
    store.set("ledger-months:user-a:book-a", { "2026-11": [] });
    store.set("ledger-marks:user-a:book-a", { e1: { synced: true } });
    store.set("offline-fill-partial-months:user-a:book-a", {});
    store.set("offline-isolation:user-a:book-a", true);
    store.set("query-cache:user-a:book-b", "{}");
    store.set("ledger-months:user-a:book-b:isolated-v1", { "2026-11": [] });
    store.set("ledger-marks:user-a:book-b:isolated-v1", { e2: { pending: true } });
    store.set("offline-isolation:user-a:book-b", true);
    store.set("query-cache:user-a:book-c", "{}");
    store.set("ledger-months:user-a:book-c", {});
    store.set("ledger-marks:user-a:book-c", { e3: { deleted: true } });
    // 别的账号与游客、旧的无作用域键不动。
    store.set("query-cache:user-b:book-a", "{}");
    store.set("ledger-months:user-b:book-a", {});
    store.set("ledger-marks", {});
    store.set("auth-user", { id: "user-a" });
  });

  it("已同步的账本全部清掉；有未同步改动的账本只清查询缓存，保留月份、标记与隔离标记", async () => {
    const result = await clearSignedOutAccountData("user-a");
    expect([...result.keptBooks].sort()).toEqual(["book-b", "book-c"]);
    for (const key of ["query-cache:user-a:book-a", "ledger-months:user-a:book-a", "ledger-marks:user-a:book-a", "offline-fill-partial-months:user-a:book-a", "offline-isolation:user-a:book-a", "query-cache:user-a:book-b", "query-cache:user-a:book-c"]) {
      expect(store.has(key), key).toBe(false);
    }
    for (const key of ["ledger-months:user-a:book-b:isolated-v1", "ledger-marks:user-a:book-b:isolated-v1", "offline-isolation:user-a:book-b", "ledger-months:user-a:book-c", "ledger-marks:user-a:book-c"]) {
      expect(store.has(key), key).toBe(true);
    }
  });

  it("不碰别的账号、游客与无作用域的旧键", async () => {
    await clearSignedOutAccountData("user-a");
    for (const key of ["query-cache:user-b:book-a", "ledger-months:user-b:book-a", "ledger-marks", "auth-user"]) expect(store.has(key), key).toBe(true);
    expect(await clearSignedOutAccountData("")).toEqual({ removed: 0, keptBooks: [] });
  });

  it("节流中迟到的缓存写入：第二次只清这个账号的查询缓存", async () => {
    await clearSignedOutAccountData("user-a");
    store.set("query-cache:user-a:book-a", "{late}");
    expect(await clearSignedOutQueryCache("user-a")).toBe(1);
    expect(store.has("query-cache:user-a:book-a")).toBe(false);
    expect(store.has("ledger-marks:user-a:book-b:isolated-v1")).toBe(true);
    expect(store.has("query-cache:user-b:book-a")).toBe(true);
  });
});

describe("接线", () => {
  const provider = readFileSync(new URL("../../auth/AuthProvider.tsx", import.meta.url), "utf8");
  it("退出与会话结束都走同一个清理，先取账号再忘掉它；同意门禁的受限退出不清", () => {
    expect(provider).toContain('const leaving = options?.preserveOfflineData === true ? null : (await readRememberedUser())?.id ?? offlineScope().split(":")[0] ?? "";');
    expect(provider.indexOf("const leaving =")).toBeLessThan(provider.indexOf("await forgetUser();"));
    expect(provider).toContain("await clearSignedOutAccountData(leaving);");
    expect(provider).toContain("setTimeout(() => { void clearSignedOutQueryCache(leaving); }, 1_500);");
  });
});
