import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryGuestBackend } from "./memoryBackend.js";

/**
 * 游客附件：存储（增删、按账目 / 账本 / 游客清理）、限制与空间提示、随游客数据清理。
 *
 * 附件原件存在独立库 `libevra-attachments-v1`（`lib/pendingAttachments.ts`，`ownerId` = 游客 id）。Node 没有
 * IndexedDB，这里用与那几个函数同语义的内存替身；该库本身的 IndexedDB 代码与库版本都没有改动（所以没有升级逻辑）。
 */
type Row = import("../pendingAttachments.js").PendingAttachment;
const mocks = vi.hoisted(() => ({ rows: new Map<string, unknown>(), failSave: false }));
const rows = mocks.rows as Map<string, Row>;
vi.mock("../pendingAttachments.js", () => ({
  pendingAttachments: async (owner: string) => [...mocks.rows.values()].filter((row) => (row as Row).ownerId === owner),
  savePendingAttachment: async (file: { id: string }) => {
    if (mocks.failSave) throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    mocks.rows.set(file.id, file);
  },
  updatePendingAttachment: async (file: { id: string; ownerId: string; bookId: string }, patch: object) => {
    const current = mocks.rows.get(file.id) as Row | undefined;
    if (current && current.ownerId === file.ownerId && current.bookId === file.bookId) mocks.rows.set(file.id, { ...current, ...patch });
  },
  removePendingAttachment: async (file: { id: string; ownerId: string }) => {
    if (file.ownerId && (mocks.rows.get(file.id) as Row | undefined)?.ownerId === file.ownerId) mocks.rows.delete(file.id);
  },
  clearClosedAccountAttachments: async (owner: string) => {
    for (const [id, row] of mocks.rows) if ((row as Row).ownerId === owner) mocks.rows.delete(id);
  },
}));

const GUEST = "guest-test-0001";
const OTHER = "user-formal-0001";
const BOOK = "guest-book-11111111-1111-4111-8111-111111111111";
const BOOK2 = "guest-book-22222222-2222-4222-8222-222222222222";

function file(name: string, size = 10, type = "image/png"): File {
  return new File([new Uint8Array(size)], name, { type });
}
function row(id: string, ownerId: string, bookId: string, entryIds: string[], createdAt = 1): Row {
  return { id, ownerId, bookId, entryIds, name: id, blob: new Blob([id]), createdAt, error: null };
}

beforeEach(() => { rows.clear(); mocks.failSave = false; vi.stubGlobal("navigator", {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("游客附件存储", () => {
  it("新增后可按账本、账目取到；元数据足够下一批上传（id、账本、账目、文件名、类型、大小、创建时间）", async () => {
    const lib = await import("./attachments.js");
    const added = await lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1"], file: file("发票.png", 25) });
    expect(added).toMatchObject({ guestId: GUEST, guestBookId: BOOK, entryIds: ["t1"], name: "发票.png", mediaType: "image/png", sizeBytes: 25 });
    expect(added.createdAt).toBeGreaterThan(0);
    expect(rows.get(added.id)?.blob.size).toBe(25);
    expect(await lib.listGuestAttachments(GUEST, BOOK)).toHaveLength(1);
    expect(await lib.listGuestAttachments(GUEST, BOOK2)).toHaveLength(0);
    // 正式账号的行看不到、也动不了
    rows.set("acc", row("acc", OTHER, BOOK, ["t1"]));
    expect(await lib.listGuestAttachments(GUEST)).toHaveLength(1);
    await lib.removeGuestAttachment(GUEST, "acc");
    expect(rows.has("acc")).toBe(true);
    await lib.removeGuestAttachment(GUEST, added.id);
    expect(rows.has(added.id)).toBe(false);
  });

  it("没有类型的文件按扩展名补类型", async () => {
    const lib = await import("./attachments.js");
    const added = await lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1"], file: file("账单.pdf", 5, "") });
    expect(added.mediaType).toBe("application/pdf");
    expect(rows.get(added.id)?.blob.type).toBe("application/pdf");
  });

  it("草稿（未关联账目）不出现在列表里，但计入占用；过期草稿会被清掉", async () => {
    const lib = await import("./attachments.js");
    rows.set("d", row("d", GUEST, BOOK, [], 1_000));
    expect(await lib.listGuestAttachments(GUEST, BOOK)).toHaveLength(0);
    expect(await lib.guestAttachmentUsage(GUEST, BOOK)).toEqual({ count: 1, bytes: 1 });
    expect(await lib.pruneStaleGuestDrafts(GUEST, 1_000 + lib.GUEST_DRAFT_MAX_AGE_MS - 1)).toBe(0);
    expect(await lib.pruneStaleGuestDrafts(GUEST, 1_000 + lib.GUEST_DRAFT_MAX_AGE_MS + 1)).toBe(1);
  });

  it("账目永久删除：只被它引用的附件删除，同时关联别的账目的只去掉这一条关联", async () => {
    const lib = await import("./attachments.js");
    const only = await lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1"], file: file("a.png") });
    const shared = await lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1", "t2"], file: file("b.png") });
    const elsewhere = await lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK2, entryIds: ["t1"], file: file("c.png") });
    await lib.removeGuestEntryAttachments(GUEST, BOOK, ["t1"]);
    expect(rows.has(only.id)).toBe(false);
    expect(rows.get(shared.id)?.entryIds).toEqual(["t2"]);
    expect(rows.has(elsewhere.id)).toBe(true);
  });

  it("删除账本只删这本账的附件；清除游客数据删掉这个游客的全部、不碰正式账号", async () => {
    const lib = await import("./attachments.js");
    await lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1"], file: file("a.png") });
    await lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK2, entryIds: ["t1"], file: file("b.png") });
    rows.set("acc", row("acc", OTHER, BOOK, ["t1"]));
    expect(await lib.removeGuestBookAttachments(GUEST, BOOK)).toBe(1);
    expect((await lib.listGuestAttachments(GUEST)).map((f) => f.guestBookId)).toEqual([BOOK2]);
    await lib.removeAllGuestAttachments(GUEST);
    expect(await lib.listGuestAttachments(GUEST)).toHaveLength(0);
    expect(rows.has("acc")).toBe(true);
  });
});

describe("限制与空间", () => {
  it("沿用登录用户的限制：单文件、每笔个数、每笔总大小；超限不写入，已存的不动", async () => {
    const lib = await import("./attachments.js");
    await expect(lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1"], file: file("big.png", 100_000_001) })).rejects.toThrow();
    expect(rows.size).toBe(0);
    for (let i = 0; i < 10; i += 1) await lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1"], file: file(`${i}.png`) });
    await expect(lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1"], file: file("11.png") })).rejects.toThrow();
    expect(rows.size).toBe(10);
    await lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t2"], file: file("ok.png") });
    expect(lib.guestLimitError([{ entryIds: ["x"], sizeBytes: 150_000_000 } as never], 60_000_000, ["x"])).not.toBeNull();
    expect(lib.guestLimitError([{ entryIds: ["x"], sizeBytes: 150_000_000 } as never], 40_000_000, ["x"])).toBeNull();
  });

  it("本机空间不足时如实报错，已存的附件不丢", async () => {
    const lib = await import("./attachments.js");
    await lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1"], file: file("a.png", 10) });
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ usage: 990, quota: 1_000 }) } });
    await expect(lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1"], file: file("b.png", 50) })).rejects.toThrow(/空间|space/);
    expect(await lib.listGuestAttachments(GUEST, BOOK)).toHaveLength(1);
    expect((await lib.localSpace()).available).toBe(10);
  });

  it("写入时配额错误转成可读提示，已存的附件不丢", async () => {
    const lib = await import("./attachments.js");
    await lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1"], file: file("a.png") });
    mocks.failSave = true;
    await expect(lib.addGuestAttachment({ guestId: GUEST, bookId: BOOK, entryIds: ["t1"], file: file("b.png") })).rejects.toThrow(/没有保存成功|not saved/);
    expect(rows.size).toBe(1);
  });

  it("浏览器不给空间估算时放行", async () => {
    const lib = await import("./attachments.js");
    await expect(lib.assertLocalRoom(10 ** 12)).resolves.toBeUndefined();
    expect(await lib.localSpace()).toEqual({ usage: null, quota: null, available: null });
  });
});

describe("随游客数据 / 账本清理", () => {
  it("清除游客数据带走游客附件，不碰正式账号的", async () => {
    vi.resetModules();
    const identity = await import("./identity.js");
    const storage = await import("./storage.js");
    storage.setGuestStorageBackendForTests(createMemoryGuestBackend());
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; },
    });
    const created = identity.createGuestIdentity();
    const id = (created as { id: string }).id;
    rows.set("g", row("g", id, BOOK, ["t1"]));
    rows.set("acc", row("acc", OTHER, BOOK, ["t1"]));
    const cleanup = await import("./cleanup.js");
    await cleanup.clearGuestData();
    expect(rows.has("g")).toBe(false);
    expect(rows.has("acc")).toBe(true);
  });

  it("删除游客账本时一并删掉这本账的附件", async () => {
    vi.resetModules();
    const store = new Map<string, unknown>();
    const storage = await import("./storage.js");
    storage.setGuestStorageBackendForTests(createMemoryGuestBackend(store));
    const workspace = await import("./workspace.js");
    const first = (await workspace.ensureGuestWorkspace(GUEST)).ledgers[0]!;
    const other = await workspace.createGuestLedger(GUEST, { name: "旅行" });
    rows.set("a", row("a", GUEST, first.id, ["t1"]));
    rows.set("b", row("b", GUEST, other.id, ["t1"]));
    await workspace.deleteGuestLedger(GUEST, first.id);
    expect(rows.has("a")).toBe(false);
    expect(rows.has("b")).toBe(true);
  });
});
