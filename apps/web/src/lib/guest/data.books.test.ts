import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryGuestBackend } from "./memoryBackend.js";

/**
 * 游客多账本：内存快照永远是当前账本；账本设置管理另一本账时只改那本账的 blob；切换后（整页重新载入 =
 * 重新载入模块）读到的是新的当前账本；正式账号会话里（账本导入页）按账本清理已迁移账目。
 */

const GUEST = "guest-books-0001";

async function boot(store: Map<string, unknown>) {
  vi.resetModules();
  const storage = await import("./storage.js");
  const backend = createMemoryGuestBackend(store);
  storage.setGuestStorageBackendForTests(backend);
  const data = await import("./data.js");
  const workspace = await import("./workspace.js");
  return { backend, data, workspace };
}

function input(id: string, amountCents = 1_200) {
  return {
    id,
    kind: "expense" as const,
    amountCents,
    currency: "CNY",
    occurredAt: "2026-11-01T12:00:00+08:00",
    occurredLocalDate: "2026-11-01",
    occurredTz: "Asia/Shanghai",
  };
}

beforeEach(() => {
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("游客多账本的数据层", () => {
  it("记账写进当前账本；新建的账本有自己的空账与预设", async () => {
    const store = new Map<string, unknown>();
    const { data } = await boot(store);
    const first = await data.ensureGuestData(GUEST);
    expect(first).not.toBeNull();
    await data.createGuestTransaction(input("11111111-1111-4111-8111-111111111111") as never);

    const created = await data.createGuestBook("旅行");
    const ledgers = await data.listGuestLedgers();
    expect(ledgers.map((ledger) => ledger.id)).toEqual([first!.book.id, created.id]);
    expect(data.guestDataValue()?.book.id).toBe(first!.book.id);
    expect(data.guestTransactions()).toHaveLength(1);

    const other = await data.loadGuestDataFor(created.id);
    expect(other.transactions).toEqual([]);
    expect(other.categories.length).toBeGreaterThan(2);
  });

  it("管理另一本账的分类：只改那本账，不动当前快照", async () => {
    const store = new Map<string, unknown>();
    const { data } = await boot(store);
    const current = (await data.ensureGuestData(GUEST))!;
    const other = await data.createGuestBook("旅行");
    const before = current.categories.length;

    const category = await data.createGuestCategory({ name: "机票", kind: "expense" } as never, other.id);
    expect(data.guestDataValue()?.categories).toHaveLength(before);
    expect((await data.loadGuestDataFor(other.id)).categories.some((entry) => entry.id === category.id)).toBe(true);

    // 同名检查按那本账自己的分类，不受当前账本影响。
    await data.createGuestCategory({ name: "机票", kind: "expense" } as never);
    await expect(data.createGuestCategory({ name: "机票", kind: "expense" } as never, other.id)).rejects.toThrow();

    const usage = data.guestClassificationUsage(await data.loadGuestDataFor(other.id));
    expect(usage.categories).toEqual({});
  });

  it("切换后整页重新载入（重新载入模块），快照是新的当前账本", async () => {
    const store = new Map<string, unknown>();
    const first = await boot(store);
    const a = (await first.data.ensureGuestData(GUEST))!;
    await first.data.createGuestTransaction(input("11111111-1111-4111-8111-111111111111") as never);
    const b = await first.data.createGuestBook("旅行");
    await first.data.switchGuestBook(b.id);

    const second = await boot(store);
    const loaded = (await second.data.ensureGuestData(GUEST))!;
    expect(loaded.book.id).toBe(b.id);
    expect(loaded.book.name).toBe("旅行");
    expect(second.data.guestTransactions()).toEqual([]);
    await second.data.createGuestTransaction(input("22222222-2222-4222-8222-222222222222", 500) as never);

    // A 的账目没被碰。
    expect((await second.data.loadGuestDataFor(a.book.id)).transactions.map((entry) => entry.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("重命名当前账本：注册表与内存快照的标题一起变", async () => {
    const store = new Map<string, unknown>();
    const { data } = await boot(store);
    const current = (await data.ensureGuestData(GUEST))!;
    await data.renameGuestBook(current.book.id, "家用");
    expect(data.guestDataValue()?.book.name).toBe("家用");
    expect((await data.listGuestLedgers())[0]?.name).toBe("家用");
  });

  it("另一个窗口删掉了当前账本：这里再写就报错，不在没人引用的键里“复活”它", async () => {
    const store = new Map<string, unknown>();
    const { data, workspace } = await boot(store);
    const current = (await data.ensureGuestData(GUEST))!;
    const other = await data.createGuestBook("旅行");
    // 模拟另一个标签页：切到旅行并删掉原来那本。
    await workspace.switchGuestLedger(GUEST, other.id);
    await workspace.deleteGuestLedger(GUEST, current.book.id);

    await expect(data.createGuestTransaction(input("33333333-3333-4333-8333-333333333333") as never)).rejects.toThrow();
    expect(store.has(`guest:${GUEST}:data:${current.book.id}`)).toBe(false);
  });

  it("并发写入在本标签页内排队：两笔同时记，两笔都在", async () => {
    const store = new Map<string, unknown>();
    const { data } = await boot(store);
    await data.ensureGuestData(GUEST);
    await Promise.all([
      data.createGuestTransaction(input("44444444-4444-4444-8444-444444444444") as never),
      data.createGuestTransaction(input("55555555-5555-4555-8555-555555555555") as never),
    ]);
    expect(data.guestTransactions()).toHaveLength(2);
  });

  it("正式账号会话里（账本导入页）按游客账本清理 / 放回已迁移账目，不碰别的账本", async () => {
    const store = new Map<string, unknown>();
    const guestSession = await boot(store);
    const a = (await guestSession.data.ensureGuestData(GUEST))!;
    await guestSession.data.createGuestTransaction(input("66666666-6666-4666-8666-666666666666") as never);
    await guestSession.data.createGuestTransaction(input("77777777-7777-4777-8777-777777777777") as never);
    const b = await guestSession.data.createGuestBook("旅行");

    // 换成“登录后的导入页”：没有游客快照，只按 (游客 id, 账本 id) 读写。
    const formal = await boot(store);
    const books = await formal.data.listGuestLedgersFor(GUEST);
    expect(books.map((ledger) => ledger.id)).toEqual([a.book.id, b.id]);
    expect(formal.data.guestDataValue()).toBeNull();

    const cleaned = await formal.data.cleanupMigratedGuestBook(GUEST, a.book.id, ["66666666-6666-4666-8666-666666666666"]);
    expect(cleaned).toEqual({ removed: 1, remaining: 1, archived: 1 });
    expect(formal.data.guestDataValue()).toBeNull();
    const after = (await formal.data.readGuestBookFor(GUEST, a.book.id))!;
    expect(after.transactions.map((entry) => entry.id)).toEqual(["77777777-7777-4777-8777-777777777777"]);
    expect(formal.data.guestCleanupTransactions(after)).toHaveLength(1);
    expect((await formal.data.readGuestBookFor(GUEST, b.id))!.transactions).toEqual([]);

    expect(await formal.data.restoreGuestBookCleanup(GUEST, a.book.id, ["66666666-6666-4666-8666-666666666666"])).toBe(1);
    expect((await formal.data.readGuestBookFor(GUEST, a.book.id))!.transactions).toHaveLength(2);
  });

  it("读存储失败时 ensureGuestData 返回 null，且没有种出一本空账覆盖原来的数据", async () => {
    const store = new Map<string, unknown>();
    const first = await boot(store);
    const a = (await first.data.ensureGuestData(GUEST))!;
    await first.data.createGuestTransaction(input("88888888-8888-4888-8888-888888888888") as never);
    const key = `guest:${GUEST}:data:${a.book.id}`;
    const saved = structuredClone(store.get(key));

    vi.resetModules();
    const storage = await import("./storage.js");
    const backend = createMemoryGuestBackend(store);
    backend.failGet = (target) => target === key;
    storage.setGuestStorageBackendForTests(backend);
    const data = await import("./data.js");
    expect(await data.ensureGuestData(GUEST)).toBeNull();
    expect(store.get(key)).toEqual(saved);
  });
});
