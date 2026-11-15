import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1.19.97 · 游客账本转正式账号时附件随账上传。
 *
 * 附件原件库 `libevra-attachments-v1` 用内存替身（与 `attachments.test.ts` 相同语义）；服务器只用到两个空间查询。
 * 真正的上传由全局 `AttachmentTransfers` 负责（已有逻辑），这里验证“哪些附件、挂到哪些正式账目、以什么 id 进队列”。
 */
type Row = import("../pendingAttachments.js").PendingAttachment;
const mocks = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  storage: { account: { limit: 1_000_000, bytes: 0 }, book: { limit: 1_000_000, bytes: 0, reservedBytes: 0 } },
  storageFails: false,
}));
const rows = mocks.rows as Map<string, Row>;
vi.mock("../pendingAttachments.js", () => ({
  pendingAttachments: async (owner: string) => [...mocks.rows.values()].filter((row) => (row as Row).ownerId === owner),
  savePendingAttachment: async (file: { id: string }) => {
    if (mocks.rows.has(file.id)) throw Object.assign(new Error("exists"), { name: "ConstraintError" });
    mocks.rows.set(file.id, file);
  },
  updatePendingAttachment: async () => undefined,
  removePendingAttachment: async (file: { id: string; ownerId: string }) => {
    if ((mocks.rows.get(file.id) as Row | undefined)?.ownerId === file.ownerId) mocks.rows.delete(file.id);
  },
  clearClosedAccountAttachments: async () => undefined,
}));
vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return {
    ...actual,
    apiFetch: async (path: string) => {
      if (mocks.storageFails) throw new actual.ApiRequestError(0, "offline", "offline");
      return path === "/storage" ? mocks.storage.account : mocks.storage.book;
    },
  };
});

const USER = "33333333-3333-4333-8333-333333333333";
const GUEST = "guest-test-0001";
const BOOK = "guest-book-11111111-1111-4111-8111-111111111111";
const OTHER_BOOK = "guest-book-22222222-2222-4222-8222-222222222222";
const TARGET = "44444444-4444-4444-8444-444444444444";
const IMPORT = "55555555-5555-4555-8555-555555555555";

function guestRow(id: string, entryIds: string[], size = 10, bookId = BOOK, createdAt = 1): Row {
  return { id, ownerId: GUEST, bookId, entryIds, name: `${id}.png`, blob: new Blob([new Uint8Array(size)], { type: "image/png" }), createdAt, error: null };
}

const result = {
  targetBook: { id: TARGET, name: "正式账本", bookNumber: null, created: false },
  imported: [
    { sourceTransactionId: "g1", targetTransactionId: "t1", targetSeq: 1 },
    { sourceTransactionId: "g2", targetTransactionId: "t2", targetSeq: 2 },
  ],
  updated: [{ sourceTransactionId: "g3", targetTransactionId: "t3", targetSeq: 3 }],
};

function store(): Map<string, string> {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  });
  return map;
}

beforeEach(() => {
  rows.clear();
  mocks.storage = { account: { limit: 1_000_000, bytes: 0 }, book: { limit: 1_000_000, bytes: 0, reservedBytes: 0 } };
  mocks.storageFails = false;
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("迁哪些附件", () => {
  it("只迁关联账目已迁入（新建或覆盖更新）的附件，挂到对应的正式账目；其余留在本机", async () => {
    const lib = await import("./attachmentMigration.js");
    rows.set("a1", guestRow("a1", ["g1"], 10, BOOK, 3));
    rows.set("a2", guestRow("a2", ["g2", "g9"], 20, BOOK, 1)); // 一笔迁入、一笔没有
    rows.set("a3", guestRow("a3", ["g3"], 30, BOOK, 2)); // 覆盖更新的账目
    rows.set("a4", guestRow("a4", ["g9"])); // 账目被跳过
    rows.set("draft", guestRow("draft", [])); // 没关联账目的草稿
    rows.set("other", guestRow("other", ["g1"], 10, OTHER_BOOK)); // 别的游客账本

    const plan = await lib.planGuestAttachmentMigration({ userId: USER, guestId: GUEST, guestBookId: BOOK, result });
    expect(plan.items.map((item) => [item.attachment.id, item.targetEntryIds])).toEqual([
      ["a2", ["t2"]],
      ["a3", ["t3"]],
      ["a1", ["t1"]],
    ]);
    expect(plan.leftBehind).toBe(1);
    expect(plan.bytes).toBe(60);
  });

  it("正式附件 id 稳定（同一附件、同样目标得到同一个 UUID v8），换了目标就不同", async () => {
    const lib = await import("./attachmentMigration.js");
    const first = await lib.stableAttachmentId(["v1", USER, TARGET, "a1", "t1"]);
    expect(first).toBe(await lib.stableAttachmentId(["v1", USER, TARGET, "a1", "t1"]));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await lib.stableAttachmentId(["v1", USER, TARGET, "a1", "t2"])).not.toBe(first);
  });
});

describe("加入上传队列", () => {
  it("复制进登录用户的队列（游客原件不动），记下本次导入；再来一次不重复加入", async () => {
    const local = store();
    const lib = await import("./attachmentMigration.js");
    rows.set("a1", guestRow("a1", ["g1"], 10));
    rows.set("a2", guestRow("a2", ["g9"], 10));
    const plan = await lib.planGuestAttachmentMigration({ userId: USER, guestId: GUEST, guestBookId: BOOK, result });
    expect(await lib.queueGuestAttachmentMigration({ importId: IMPORT, userId: USER, guestBookId: BOOK, plan, targetBookId: TARGET })).toBe(1);

    const queued = [...rows.values()].filter((row) => row.ownerId === USER);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ id: plan.items[0]!.remoteId, bookId: TARGET, entryIds: ["t1"], name: "a1.png", error: null });
    expect(queued[0]!.blob).toBe(rows.get("a1")!.blob);
    expect(rows.has("a1")).toBe(true);

    const record = lib.readAttachmentMigrationRecord(USER, IMPORT);
    expect(record).toMatchObject({ userId: USER, targetBookId: TARGET, guestBookId: BOOK, ids: [plan.items[0]!.remoteId], leftBehind: 1, bytes: 10 });
    expect([...local.keys()]).toEqual([`libevra.guest-attachment-migration:${USER}:${IMPORT}`]);
    expect(lib.readAttachmentMigrationRecord("someone-else", IMPORT)).toBeNull();

    expect(await lib.queueGuestAttachmentMigration({ importId: IMPORT, userId: USER, guestBookId: BOOK, plan, targetBookId: TARGET })).toBe(0);
    expect([...rows.values()].filter((row) => row.ownerId === USER)).toHaveLength(1);
  });

  it("正式账号空间不够：一个都不加入，给出可读提示；读不到空间时照常加入", async () => {
    store();
    const lib = await import("./attachmentMigration.js");
    const { errorMessage } = await import("../api.js");
    rows.set("a1", guestRow("a1", ["g1"], 600));
    rows.set("a2", guestRow("a2", ["g2"], 600));
    mocks.storage.book = { limit: 1_000, bytes: 0, reservedBytes: 0 };
    const plan = await lib.planGuestAttachmentMigration({ userId: USER, guestId: GUEST, guestBookId: BOOK, result });
    const error = await lib.queueGuestAttachmentMigration({ importId: IMPORT, userId: USER, guestBookId: BOOK, plan, targetBookId: TARGET }).catch((caught: unknown) => caught);
    expect(errorMessage(error)).toContain("1.2 KB");
    expect([...rows.values()].filter((row) => row.ownerId === USER)).toHaveLength(0);
    expect(lib.readAttachmentMigrationRecord(USER, IMPORT)).toBeNull();

    mocks.storageFails = true;
    expect(await lib.queueGuestAttachmentMigration({ importId: IMPORT, userId: USER, guestBookId: BOOK, plan, targetBookId: TARGET })).toBe(2);
  });

  it("进度：从队列里消失的算已上传，出错的单独计数", async () => {
    store();
    const lib = await import("./attachmentMigration.js");
    rows.set("a1", guestRow("a1", ["g1"]));
    rows.set("a2", guestRow("a2", ["g2"]));
    const plan = await lib.planGuestAttachmentMigration({ userId: USER, guestId: GUEST, guestBookId: BOOK, result });
    await lib.queueGuestAttachmentMigration({ importId: IMPORT, userId: USER, guestBookId: BOOK, plan, targetBookId: TARGET });
    const record = lib.readAttachmentMigrationRecord(USER, IMPORT)!;
    const [first, second] = plan.items;
    rows.delete(first!.remoteId);
    rows.set(second!.remoteId, { ...rows.get(second!.remoteId)!, error: "空间不足" });
    expect(await lib.attachmentMigrationProgress(record)).toEqual({ total: 2, uploaded: 1, failed: 1, error: "空间不足" });
  });
});
