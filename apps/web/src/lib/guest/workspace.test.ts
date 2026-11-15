import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryGuestBackend, type MemoryGuestBackend } from "./memoryBackend.js";

/**
 * 游客多账本：存储布局迁移（旧的单一 `data` blob → 每本账一个 blob）与账本生命周期。
 *
 * 每个“启动”都重新载入模块（`vi.resetModules`），和真实的“关掉页面再打开”一样：模块里的会话状态
 * （旧键模式、排队）全部丢掉，只有存储里的东西留下来。
 */

const GUEST = "guest-test-0001";
const BOOK = "guest-book-11111111-1111-4111-8111-111111111111";

const KEY = {
  legacy: `guest:${GUEST}:data`,
  book: (id: string) => `guest:${GUEST}:data:${id}`,
  ledgers: `guest:${GUEST}:ledgers`,
  current: `guest:${GUEST}:current-ledger`,
  layout: `guest:${GUEST}:layout`,
  legacyNotDuplicate: `guest:${GUEST}:not-duplicate`,
  notDuplicate: (id: string) => `guest:${GUEST}:not-duplicate:${id}`,
};

function tx(id: string, amountCents = 1_000) {
  return {
    id,
    seq: 1,
    kind: "expense",
    amountCents,
    currency: "CNY",
    categoryId: "c1",
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
  };
}

/** 1.19.94 写下的旧 blob（形状与当时的 `data.ts` 一致），外加一个“未来字段”——迁移必须原样带走。 */
function legacyBlob(transactions = [tx("t1"), tx("t2", 2_500)]) {
  return {
    schemaVersion: 1,
    book: {
      id: BOOK,
      name: "我的本地账本",
      currency: "CNY",
      schemaVersion: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
    },
    categories: [
      { id: "c1", name: "餐饮", kind: "expense", description: null, isSystem: false, isArchived: false, sortOrder: 0 },
      { id: "c-sys", name: "未分类", kind: "expense", description: null, isSystem: true, isArchived: false, sortOrder: 9000 },
    ],
    paymentMethods: [{ id: "p1", name: "微信", isArchived: false, sortOrder: 0 }],
    tags: [{ id: "tag1", name: "出差", color: "#55997a" }],
    transactions,
    deleted: [tx("t0")],
    cleanup: [],
    nextSeq: 4,
    extraFromFuture: { keep: true },
  };
}

const NOT_DUPLICATE = { version: 1, items: [{ id: "r1", transactionAId: "t1", transactionBId: "t2" }] };

async function boot(store: Map<string, unknown>, setup?: (backend: MemoryGuestBackend) => void) {
  vi.resetModules();
  const storage = await import("./storage.js");
  const backend = createMemoryGuestBackend(store);
  setup?.(backend);
  storage.setGuestStorageBackendForTests(backend);
  const workspace = await import("./workspace.js");
  const ledger = await import("./ledger.js");
  return { backend, storage, workspace, ledger };
}

/** 让出事件循环，直到条件成立或 promise 结束（模拟“页面在这一步关掉”时用）。 */
async function settle(promise: Promise<unknown>, until: () => boolean): Promise<void> {
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let i = 0; i < 2_000 && !done && !until(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function registry(store: Map<string, unknown>): { id: string; name: string; archivedAt?: string | null; migratedAt?: string }[] {
  return (store.get(KEY.ledgers) as { id: string; name: string }[] | undefined) ?? [];
}

beforeEach(() => {
  // Node 24 自带 Web Locks：一次“关掉的页面”留下的锁在同一个进程里不会释放，测试里关掉，只用模块内排队。
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("游客库布局：首次使用", () => {
  it("一本账都没有时建一本默认账本：先写数据，再登记注册表与当前账本", async () => {
    const store = new Map<string, unknown>();
    const { workspace } = await boot(store);

    const state = await workspace.ensureGuestWorkspace(GUEST);

    expect(state.ledgers).toHaveLength(1);
    const id = state.ledgers[0]!.id;
    expect(id).toMatch(/^guest-book-[0-9a-f-]{36}$/);
    // 服务器用 `guest:<guestBookId>` 当状态键，上限 58（packages/shared/src/ledgerImport.ts）。
    expect(id.length).toBeLessThanOrEqual(58);
    expect(state.currentLedgerId).toBe(id);
    expect(store.get(KEY.current)).toBe(id);
    expect(store.has(KEY.book(id))).toBe(true);
    expect(store.has(KEY.legacy)).toBe(false);
  });

  it("幂等：再跑一遍什么都不改", async () => {
    const store = new Map<string, unknown>();
    const { workspace, backend } = await boot(store);
    await workspace.ensureGuestWorkspace(GUEST);
    const before = structuredClone([...store.entries()]);
    const count = backend.mutations();

    await workspace.ensureGuestWorkspace(GUEST);
    expect(backend.mutations()).toBe(count);
    expect([...store.entries()]).toEqual(before);
  });

  it("`create: false`（账本导入页）不会因为打开页面就建账本", async () => {
    const store = new Map<string, unknown>();
    const { workspace } = await boot(store);
    const state = await workspace.ensureGuestWorkspace(GUEST, { create: false });
    expect(state.ledgers).toEqual([]);
    expect(state.currentLedgerId).toBeNull();
    expect(store.size).toBe(0);
  });
});

describe("游客库布局：旧的单一 blob 迁移", () => {
  it("旧 blob 原样搬到 data:<账本id>（含未来字段），登记为第一本，删掉旧键", async () => {
    const store = new Map<string, unknown>([[KEY.legacy, legacyBlob()]]);
    const { workspace } = await boot(store);

    const state = await workspace.ensureGuestWorkspace(GUEST);

    expect(state.ledgers.map((ledger) => ledger.id)).toEqual([BOOK]);
    expect(state.ledgers[0]?.name).toBe("我的本地账本");
    expect(state.currentLedgerId).toBe(BOOK);
    expect(state.legacyBookId).toBeNull();
    expect(store.get(KEY.book(BOOK))).toEqual(legacyBlob());
    expect(store.has(KEY.legacy)).toBe(false);
    expect(store.get(KEY.layout)).toMatchObject({ version: 2, legacyBookId: BOOK });
  });

  it("S14-B 留下的注册表沿用原来的账本 id 与名称，不再登记第二遍", async () => {
    const entry = { ...legacyBlob().book, name: "S14-B 的名字" };
    const store = new Map<string, unknown>([
      [KEY.legacy, legacyBlob()],
      [KEY.ledgers, [entry]],
      [KEY.current, BOOK],
    ]);
    const { workspace } = await boot(store);
    const state = await workspace.ensureGuestWorkspace(GUEST);
    expect(state.ledgers).toHaveLength(1);
    expect(state.ledgers[0]?.name).toBe("S14-B 的名字");
    expect(store.get(KEY.book(BOOK))).toEqual(legacyBlob());
  });

  it("迁移幂等：迁完再启动，存储一字不变", async () => {
    const store = new Map<string, unknown>([[KEY.legacy, legacyBlob()]]);
    await (await boot(store)).workspace.ensureGuestWorkspace(GUEST);
    const before = structuredClone([...store.entries()]);
    const again = await boot(store);
    await again.workspace.ensureGuestWorkspace(GUEST);
    expect(again.backend.mutations()).toBe(0);
    expect([...store.entries()]).toEqual(before);
  });

  it("「不是重复」关系一起搬到这本账名下", async () => {
    const store = new Map<string, unknown>([
      [KEY.legacy, legacyBlob()],
      [KEY.legacyNotDuplicate, NOT_DUPLICATE],
    ]);
    await (await boot(store)).workspace.ensureGuestWorkspace(GUEST);
    expect(store.get(KEY.notDuplicate(BOOK))).toEqual(NOT_DUPLICATE);
    expect(store.has(KEY.legacyNotDuplicate)).toBe(false);
  });

  it("中断：在迁移的每一步之后关页面，下次启动都能完成，任何时刻账目都在", async () => {
    const initial = (): Map<string, unknown> =>
      new Map<string, unknown>([
        [KEY.legacy, legacyBlob()],
        [KEY.legacyNotDuplicate, NOT_DUPLICATE],
      ]);

    // 先量一次完整迁移要改动几次存储。
    const probe = initial();
    const clean = await boot(probe);
    await clean.workspace.ensureGuestWorkspace(GUEST);
    const total = clean.backend.mutations();
    expect(total).toBeGreaterThanOrEqual(4);

    for (let step = 0; step <= total; step += 1) {
      const store = initial();
      const first = await boot(store, (backend) => backend.crashAfter(step));
      await settle(first.workspace.ensureGuestWorkspace(GUEST), () => first.backend.crashed());

      // 关掉的那一刻：旧键或新键至少有一个原样装着全部账目。
      const legacy = store.get(KEY.legacy);
      const copied = store.get(KEY.book(BOOK));
      expect([legacy, copied].some((value) => JSON.stringify(value) === JSON.stringify(legacyBlob())), `step ${String(step)}`).toBe(true);

      const second = await boot(store);
      const state = await second.workspace.ensureGuestWorkspace(GUEST);
      expect(state.ledgers.map((ledger) => ledger.id), `step ${String(step)}`).toEqual([BOOK]);
      expect(state.legacyBookId).toBeNull();
      expect(store.get(KEY.book(BOOK)), `step ${String(step)}`).toEqual(legacyBlob());
      expect(store.has(KEY.legacy), `step ${String(step)}`).toBe(false);
      expect(store.get(KEY.notDuplicate(BOOK)), `step ${String(step)}`).toEqual(NOT_DUPLICATE);
      expect(store.has(KEY.legacyNotDuplicate), `step ${String(step)}`).toBe(false);
      expect(store.get(KEY.current)).toBe(BOOK);
    }
  }, 120_000);

  it("配额不足（新键写不进去）：本次会话继续用旧键记账，下次启动带着新记的账目完成迁移", async () => {
    const store = new Map<string, unknown>([[KEY.legacy, legacyBlob()]]);
    const first = await boot(store, (backend) => {
      backend.failPut = (key) => key === KEY.book(BOOK);
    });
    const state = await first.workspace.ensureGuestWorkspace(GUEST);
    expect(state.legacyBookId).toBe(BOOK);
    expect(store.has(KEY.book(BOOK))).toBe(false);
    expect(first.workspace.guestDataKeyFor(GUEST, BOOK)).toBe(KEY.legacy);

    // 旧键模式下照常读写（走旧键）。
    const ledger = state.ledgers.find((entry) => entry.id === BOOK)!;
    const data = await first.workspace.loadGuestBook(GUEST, ledger);
    expect(data.transactions).toHaveLength(2);
    expect(await first.workspace.writeGuestBook(GUEST, { ...data, transactions: [...data.transactions, tx("t3") as never] })).toBe(true);
    expect((store.get(KEY.legacy) as { transactions: unknown[] }).transactions).toHaveLength(3);

    const second = await boot(store);
    const after = await second.workspace.ensureGuestWorkspace(GUEST);
    expect(after.legacyBookId).toBeNull();
    expect(store.has(KEY.legacy)).toBe(false);
    expect((store.get(KEY.book(BOOK)) as { transactions: { id: string }[] }).transactions.map((entry) => entry.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("读回校验不通过：删掉写坏的新键，留在旧键", async () => {
    const store = new Map<string, unknown>([[KEY.legacy, legacyBlob()]]);
    const first = await boot(store, (backend) => {
      const put = backend.put.bind(backend);
      backend.put = async (key, value) => {
        await put(key, key === KEY.book(BOOK) ? { ...(value as object), transactions: [] } : value);
      };
    });
    const state = await first.workspace.ensureGuestWorkspace(GUEST);
    expect(state.legacyBookId).toBe(BOOK);
    expect(store.has(KEY.book(BOOK))).toBe(false);
    expect(store.get(KEY.legacy)).toEqual(legacyBlob());
  });

  it("旧键删不掉：把刚写的新键也删掉、回到旧键模式，下次再来（不留下会分叉的两份）", async () => {
    const store = new Map<string, unknown>([[KEY.legacy, legacyBlob()]]);
    const first = await boot(store, (backend) => {
      backend.failDelete = (key) => key === KEY.legacy;
    });
    const state = await first.workspace.ensureGuestWorkspace(GUEST);
    expect(state.legacyBookId).toBe(BOOK);
    expect(store.has(KEY.book(BOOK))).toBe(false);
    expect(store.get(KEY.legacy)).toEqual(legacyBlob());

    const second = await boot(store);
    expect((await second.workspace.ensureGuestWorkspace(GUEST)).legacyBookId).toBeNull();
    expect(store.get(KEY.book(BOOK))).toEqual(legacyBlob());
  });

  it("读存储失败：整个载入失败，什么都不写、不建账本", async () => {
    const store = new Map<string, unknown>([[KEY.legacy, legacyBlob()]]);
    const { workspace, backend } = await boot(store, (memory) => {
      memory.failGet = (key) => key === KEY.legacy;
    });
    await expect(workspace.ensureGuestWorkspace(GUEST)).rejects.toThrow();
    expect(backend.mutations()).toBe(0);
    expect([...store.keys()]).toEqual([KEY.legacy]);
  });

  it("认不出的版本（例如更新版本写的）原样留着，不覆盖", async () => {
    const future = { ...legacyBlob(), schemaVersion: 2 };
    const store = new Map<string, unknown>([[KEY.legacy, future]]);
    const { workspace } = await boot(store);
    await workspace.ensureGuestWorkspace(GUEST);
    expect(store.get(KEY.legacy)).toEqual(future);
  });
});

describe("游客库布局：迁移之后旧键又出现（旧版本标签页又写了一次）", () => {
  it("旧键里有新账目：另存为「（恢复的副本）」，现行账本不动，再启动不会存第二份", async () => {
    const store = new Map<string, unknown>([[KEY.legacy, legacyBlob()]]);
    await (await boot(store)).workspace.ensureGuestWorkspace(GUEST);

    // 旧版本页面在迁移之后又记了一笔，写回旧键。
    store.set(KEY.legacy, legacyBlob([tx("t1"), tx("t2", 2_500), tx("t-old-tab", 777)]));

    const second = await boot(store);
    const state = await second.workspace.ensureGuestWorkspace(GUEST);
    expect(state.ledgers).toHaveLength(2);
    const recovered = state.ledgers.find((ledger) => ledger.id !== BOOK)!;
    expect(recovered.name).toBe("我的本地账本（恢复的副本）");
    expect(recovered.id).toMatch(/^guest-book-/);
    expect((store.get(KEY.book(recovered.id)) as { transactions: { id: string }[] }).transactions.map((entry) => entry.id)).toContain("t-old-tab");
    expect(store.get(KEY.book(BOOK))).toEqual(legacyBlob());
    expect(store.has(KEY.legacy)).toBe(false);

    const third = await boot(store);
    expect((await third.workspace.ensureGuestWorkspace(GUEST)).ledgers).toHaveLength(2);
  });

  it("另存后旧键删不掉：下次启动认出已经另存过，只删旧键", async () => {
    const store = new Map<string, unknown>([[KEY.legacy, legacyBlob()]]);
    await (await boot(store)).workspace.ensureGuestWorkspace(GUEST);
    store.set(KEY.legacy, legacyBlob([tx("t-old-tab")]));

    const second = await boot(store, (backend) => {
      backend.failDelete = (key) => key === KEY.legacy;
    });
    expect((await second.workspace.ensureGuestWorkspace(GUEST)).ledgers).toHaveLength(2);
    expect(store.has(KEY.legacy)).toBe(true);

    const third = await boot(store);
    expect((await third.workspace.ensureGuestWorkspace(GUEST)).ledgers).toHaveLength(2);
    expect(store.has(KEY.legacy)).toBe(false);
  });

  it("旧键里一笔账目都没有（旧版本页面重新种出来的空账本）：直接删掉，不多出一本空账", async () => {
    const store = new Map<string, unknown>([[KEY.legacy, legacyBlob()]]);
    await (await boot(store)).workspace.ensureGuestWorkspace(GUEST);
    store.set(KEY.legacy, { ...legacyBlob([]), deleted: [], categories: [] });

    const second = await boot(store);
    const state = await second.workspace.ensureGuestWorkspace(GUEST);
    expect(state.ledgers).toHaveLength(1);
    expect(store.has(KEY.legacy)).toBe(false);
    expect(store.get(KEY.book(BOOK))).toEqual(legacyBlob());
  });

  it("旧的「不是重复」又出现：按迁移标记合并回原来那本账", async () => {
    const store = new Map<string, unknown>([[KEY.legacy, legacyBlob()], [KEY.legacyNotDuplicate, NOT_DUPLICATE]]);
    await (await boot(store)).workspace.ensureGuestWorkspace(GUEST);
    store.set(KEY.legacyNotDuplicate, { version: 1, items: [...NOT_DUPLICATE.items, { id: "r2", transactionAId: "t1", transactionBId: "t0" }] });

    await (await boot(store)).workspace.ensureGuestWorkspace(GUEST);
    expect((store.get(KEY.notDuplicate(BOOK)) as { items: { id: string }[] }).items.map((item) => item.id)).toEqual(["r1", "r2"]);
    expect(store.has(KEY.legacyNotDuplicate)).toBe(false);
  });
});

describe("游客账本生命周期", () => {
  async function ready() {
    const store = new Map<string, unknown>([[KEY.legacy, legacyBlob()]]);
    const env = await boot(store);
    await env.workspace.ensureGuestWorkspace(GUEST);
    return { store, ...env };
  }

  it("新建：自己的一套预设分类，不复制当前账本；id 是 guest-book-<uuid>；不切换当前账本", async () => {
    const { store, workspace } = await ready();
    const created = await workspace.createGuestLedger(GUEST, { name: "  旅行  " });
    expect(created.name).toBe("旅行");
    expect(created.id).toMatch(/^guest-book-[0-9a-f-]{36}$/);
    expect(registry(store).map((ledger) => ledger.id)).toEqual([BOOK, created.id]);
    const blob = store.get(KEY.book(created.id)) as { categories: { id: string }[]; transactions: unknown[] };
    expect(blob.transactions).toEqual([]);
    expect(blob.categories.length).toBeGreaterThan(2);
    expect(blob.categories.some((category) => category.id === "c1")).toBe(false);
    expect(store.get(KEY.current)).toBe(BOOK);
  });

  it("新建：名称校验与本数上限", async () => {
    const { workspace, ledger } = await ready();
    await expect(workspace.createGuestLedger(GUEST, { name: "   " })).rejects.toThrow();
    await expect(workspace.createGuestLedger(GUEST, { name: "x".repeat(41) })).rejects.toThrow();
    for (let index = 1; index < ledger.MAX_GUEST_LEDGERS; index += 1) {
      await workspace.createGuestLedger(GUEST, { name: `账本 ${String(index)}` });
    }
    await expect(workspace.createGuestLedger(GUEST, { name: "多一本" })).rejects.toThrow();
  });

  it("新建时数据写不进去：不登记（列表里不会出现一本没有数据的账）", async () => {
    const { store, workspace, backend } = await ready();
    backend.failPut = (key) => key.startsWith(`guest:${GUEST}:data:`) && key !== KEY.book(BOOK);
    await expect(workspace.createGuestLedger(GUEST, { name: "旅行" })).rejects.toThrow();
    expect(registry(store)).toHaveLength(1);
  });

  it("切换：只写游客库的 current-ledger 并读回；归档的不能切换", async () => {
    const { store, workspace } = await ready();
    const other = await workspace.createGuestLedger(GUEST, { name: "旅行" });
    await workspace.switchGuestLedger(GUEST, other.id);
    expect(store.get(KEY.current)).toBe(other.id);
    expect((await workspace.ensureGuestWorkspace(GUEST)).currentLedgerId).toBe(other.id);

    await workspace.archiveGuestLedger(GUEST, BOOK);
    await expect(workspace.switchGuestLedger(GUEST, BOOK)).rejects.toThrow();
    await expect(workspace.switchGuestLedger(GUEST, "guest-book-missing")).rejects.toThrow();
  });

  it("重命名只改注册表；读出数据时以注册表的名称为准", async () => {
    const { store, workspace } = await ready();
    await workspace.renameGuestLedger(GUEST, BOOK, "家庭账本");
    expect(registry(store)[0]?.name).toBe("家庭账本");
    const state = await workspace.ensureGuestWorkspace(GUEST);
    const data = await workspace.loadGuestBook(GUEST, state.ledgers[0]!);
    expect(data.book.name).toBe("家庭账本");
    expect(data.transactions).toHaveLength(2);
  });

  it("归档 / 恢复：至少保留一本未归档；归档当前账本时当前账本换到下一本", async () => {
    const { store, workspace } = await ready();
    await expect(workspace.archiveGuestLedger(GUEST, BOOK)).rejects.toThrow();

    const other = await workspace.createGuestLedger(GUEST, { name: "旅行" });
    const outcome = await workspace.archiveGuestLedger(GUEST, BOOK);
    expect(outcome.nextCurrentId).toBe(other.id);
    expect(store.get(KEY.current)).toBe(other.id);
    expect(registry(store).find((ledger) => ledger.id === BOOK)?.archivedAt).toEqual(expect.any(String));
    // 数据原样保留。
    expect(store.get(KEY.book(BOOK))).toEqual(legacyBlob());
    // 现在旅行是唯一未归档的。
    await expect(workspace.archiveGuestLedger(GUEST, other.id)).rejects.toThrow();

    await workspace.restoreGuestLedger(GUEST, BOOK);
    expect(registry(store).find((ledger) => ledger.id === BOOK)?.archivedAt).toBeUndefined();
    // 恢复不切换当前账本。
    expect(store.get(KEY.current)).toBe(other.id);
  });

  it("永久删除：先出注册表再删数据与关系；不能删唯一一本未归档的；删当前账本时换走", async () => {
    const { store, workspace } = await ready();
    store.set(KEY.notDuplicate(BOOK), NOT_DUPLICATE);
    await expect(workspace.deleteGuestLedger(GUEST, BOOK)).rejects.toThrow();
    expect(store.has(KEY.book(BOOK))).toBe(true);

    const other = await workspace.createGuestLedger(GUEST, { name: "旅行" });
    const outcome = await workspace.deleteGuestLedger(GUEST, BOOK);
    expect(outcome.nextCurrentId).toBe(other.id);
    expect(registry(store).map((ledger) => ledger.id)).toEqual([other.id]);
    expect(store.has(KEY.book(BOOK))).toBe(false);
    expect(store.has(KEY.notDuplicate(BOOK))).toBe(false);
    expect(store.get(KEY.current)).toBe(other.id);
  });

  it("已归档的随时可以删（删掉后仍有一本未归档的）", async () => {
    const { store, workspace } = await ready();
    const other = await workspace.createGuestLedger(GUEST, { name: "旅行" });
    await workspace.archiveGuestLedger(GUEST, other.id);
    expect(workspace.guestLedgerLifecycle(registry(store) as never, other.id)).toMatchObject({ archived: true, canDelete: true, canRestore: true, canArchive: false });
    await workspace.deleteGuestLedger(GUEST, other.id);
    expect(registry(store).map((ledger) => ledger.id)).toEqual([BOOK]);
  });

  it("记下“已迁入正式账号”的时间", async () => {
    const { store, workspace } = await ready();
    expect(await workspace.markGuestLedgerMigrated(GUEST, BOOK, "2026-11-15T00:00:00.000Z")).toBe(true);
    expect(registry(store)[0]?.migratedAt).toBe("2026-11-15T00:00:00.000Z");
    expect(await workspace.markGuestLedgerMigrated(GUEST, "guest-book-missing")).toBe(false);
  });

  it("注册表里类型不对的可选字段只丢那个字段，不丢这本账", async () => {
    const { ledger } = await ready();
    const [entry] = ledger.normalizeGuestLedgers([{ ...legacyBlob().book, sortOrder: "x", archivedAt: 5 }]);
    expect(entry?.id).toBe(BOOK);
    expect(entry?.sortOrder).toBeUndefined();
    expect(entry?.archivedAt).toBeUndefined();
  });
});

describe("隔离", () => {
  it("游客布局与生命周期代码不碰账号的 currentBook / 离线作用域", () => {
    for (const file of ["./workspace.ts", "./data.ts", "./ledger.ts", "./blob.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      expect(source, file).not.toMatch(/from "\.\.\/currentBook\.js"|setCurrentBook|selectBookForReload|offline\/scope/);
    }
  });
});
