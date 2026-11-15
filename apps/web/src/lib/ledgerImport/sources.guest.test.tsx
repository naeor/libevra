import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryGuestBackend } from "../guest/memoryBackend.js";

/**
 * 游客多账本 · 转正式账号：账本导入页每次选一本游客账本迁移，已迁过的标出来；
 * 旧地址 / 旧任务里的 `source=guest` 只有在本机恰好一本游客账本时才有确定的意思。
 */

const GUEST = "guest-import-0001";
const identity = vi.hoisted(() => ({ id: "guest-import-0001" as string | null }));

vi.mock("../guest/identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../guest/identity.js")>();
  return {
    ...actual,
    readGuestIdentity: () =>
      identity.id === null
        ? null
        : { id: identity.id, createdAt: "2026-10-01T00:00:00.000Z", welcomePending: false, noticeAcknowledged: true, lastPath: null },
  };
});

beforeEach(() => {
  identity.id = GUEST;
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function setup() {
  vi.resetModules();
  const storage = await import("../guest/storage.js");
  const store = new Map<string, unknown>();
  storage.setGuestStorageBackendForTests(createMemoryGuestBackend(store));
  const data = await import("../guest/data.js");
  const sources = await import("./sources.js");
  return { store, data, sources };
}

describe("来源键", () => {
  it("guest:<id> 指那一本；不在列表里就不算", async () => {
    const { sources } = await setup();
    const books = [
      { id: "guest-book-a", name: "A", archived: false, migratedAt: null },
      { id: "guest-book-b", name: "B", archived: true, migratedAt: "2026-11-01T00:00:00.000Z" },
    ];
    expect(sources.guestSourceKey("guest-book-a")).toBe("guest:guest-book-a");
    expect(sources.guestBookIdOfSource("guest:guest-book-b", books)).toBe("guest-book-b");
    expect(sources.guestBookIdOfSource("guest:guest-book-x", books)).toBeNull();
    expect(sources.isGuestSourceKey("guest")).toBe(true);
    expect(sources.isGuestSourceKey("guest:guest-book-a")).toBe(true);
    expect(sources.isGuestSourceKey("11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("旧的 `guest`：只有一本时就是它；有好几本时不替用户猜", async () => {
    const { sources } = await setup();
    const one = [{ id: "guest-book-a", name: "A", archived: false, migratedAt: null }];
    expect(sources.guestBookIdOfSource("guest", one)).toBe("guest-book-a");
    expect(sources.guestBookIdOfSource("guest", [...one, { id: "guest-book-b", name: "B", archived: false, migratedAt: null }])).toBeNull();
    expect(sources.guestBookIdOfSource("guest", [])).toBeNull();
  });
});

describe("读取游客账本作为来源", () => {
  it("列出全部游客账本（含已归档、已迁过的时间），按游客自己的顺序", async () => {
    const { data, sources } = await setup();
    const first = (await data.ensureGuestData(GUEST))!;
    const second = await data.createGuestBook("旅行");
    await data.createGuestBook("归档的");
    const third = (await data.listGuestLedgers()).at(-1)!;
    await data.archiveGuestBook(third.id);
    expect(await sources.markGuestImportMigrated(second.id)).toBe(true);

    const books = await sources.listGuestImportBooks();
    expect(books.map((book) => book.name)).toEqual([first.book.name, "旅行", "归档的"]);
    expect(books[1]?.migratedAt).toEqual(expect.any(String));
    expect(books[2]?.archived).toBe(true);
    expect(books.every((book) => /^guest-book-/.test(book.id))).toBe(true);
  });

  it("按账本 id 读一本：账目是那一本的，不动游客的当前账本", async () => {
    const { data, sources } = await setup();
    const first = (await data.ensureGuestData(GUEST))!;
    await data.createGuestTransaction({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "expense",
      amountCents: 1_000,
      currency: "CNY",
      occurredAt: "2026-11-01T12:00:00+08:00",
      occurredLocalDate: "2026-11-01",
      occurredTz: "Asia/Shanghai",
    } as never);
    const second = await data.createGuestBook("旅行");

    const a = await sources.loadGuestImportSource(first.book.id);
    const b = await sources.loadGuestImportSource(second.id);
    expect(a).toMatchObject({ kind: "guest", bookId: first.book.id });
    expect(a?.transactions).toHaveLength(1);
    expect(b).toMatchObject({ kind: "guest", bookId: second.id, identity: { name: "旅行", bookNumber: null } });
    expect(b?.transactions).toEqual([]);
    expect(data.guestDataValue()?.book.id).toBe(first.book.id);
    expect(await sources.loadGuestImportSource("guest-book-missing")).toBeNull();
  });

  it("没有游客身份：空列表，不建账本", async () => {
    identity.id = null;
    const { store, sources } = await setup();
    expect(await sources.listGuestImportBooks()).toEqual([]);
    expect(store.size).toBe(0);
  });

  it("有身份但从没记过账：不因为打开导入页就建一本游客账本", async () => {
    const { store, sources } = await setup();
    expect(await sources.listGuestImportBooks()).toEqual([]);
    expect(store.size).toBe(0);
  });
});

describe("选择步", () => {
  it("每本游客账本一项；选中的那一本显示在来源里；旧的 `guest` 在多本时不能继续", async () => {
    const { SelectionStep } = await import("../../pages/LedgerImportPage.js");
    const books = [
      { id: "guest-book-a", name: "日常", archived: false, migratedAt: null },
      { id: "guest-book-b", name: "旅行", archived: false, migratedAt: "2026-11-01T00:00:00.000Z" },
    ];
    const target = { id: "book-1", name: "正式账本", bookNumber: "10000001", role: "owner" as const, isCreator: true, memberCount: 1 };
    const noop = (): void => undefined;
    const render = (sourceKey: string): string =>
      renderToStaticMarkup(
        <MemoryRouter>
          <SelectionStep
            targetId="book-1"
            target={target}
            targetIsNew={false}
            newName=""
            soloBooks={[target]}
            sourceBooks={[]}
            sourceBook={null}
            guestAvailable
            guestBooks={books}
            sourceKey={sourceKey}
            accountLabel="alex"
            onChangeTarget={noop}
            onChangeSource={noop}
            onChangeNewName={noop}
            onContinue={noop}
          />
        </MemoryRouter>,
      );

    const continueButton = (html: string): string => /<button[^>]*>查看预览<\/button>/.exec(html)?.[0] ?? "";

    const chosen = render("guest:guest-book-b");
    expect(chosen).toContain("游客账本 · 旅行");
    expect(continueButton(chosen)).not.toContain(" disabled=\"\"");

    const ambiguous = render("guest");
    expect(ambiguous).toContain("本机游客账本");
    expect(continueButton(ambiguous)).toContain(" disabled=\"\"");
  });
});
