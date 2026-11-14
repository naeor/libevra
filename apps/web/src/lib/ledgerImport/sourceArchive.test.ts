import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 导入结果页归档来源账本（1.19.63，待办 §6 第 25 条）：与账本设置的普通归档一致，成功后清掉来源账本的本机离线数据。
 *
 * 清理用真实的 `clearBookLocalData`，只把离线库换成内存表（与 offline/localCleanup.test.ts 同一做法），
 * 所以能直接看到“哪些本机数据被删、哪些还在”：来源账本的被删，目标账本与别的账号、别的账本的都还在。
 */
const store = new Map<string, unknown>();

vi.mock("../offline/storage.js", () => ({
  listKeys: () => Promise.resolve([...store.keys()]),
  removeValue: (key: string) => {
    store.delete(key);
    return Promise.resolve(true);
  },
}));

const { clearBookLocalData } = await import("../offline/localCleanup.js");
const { archiveImportSource } = await import("./sourceArchive.js");

const ACCOUNT = "user-a";
const SOURCE = "book-source";
const TARGET = "book-target";

/** 每一步都记进同一条时间线，用来核对先后顺序。 */
function harness(overrides: {
  readonly currentBookId?: string | null;
  readonly accountId?: string | null;
  readonly sourceBookId?: string;
  readonly archive?: () => Promise<unknown>;
  readonly clear?: (accountId: string, bookId: string) => Promise<unknown>;
} = {}) {
  const timeline: string[] = [];
  const cleared: [string, string][] = [];
  const steps = {
    sourceBookId: overrides.sourceBookId ?? SOURCE,
    targetBookId: TARGET,
    currentBookId: overrides.currentBookId === undefined ? SOURCE : overrides.currentBookId,
    accountId: overrides.accountId === undefined ? ACCOUNT : overrides.accountId,
    archive: async (bookId: string) => {
      timeline.push(`archive:${bookId}`);
      return overrides.archive?.();
    },
    clearLocalData: async (accountId: string, bookId: string) => {
      timeline.push(`clear:${bookId}`);
      cleared.push([accountId, bookId]);
      return (overrides.clear ?? clearBookLocalData)(accountId, bookId);
    },
    onArchived: () => {
      timeline.push("archived");
    },
    reload: () => {
      timeline.push("reload");
    },
  };
  return { steps, timeline, cleared };
}

beforeEach(() => {
  store.clear();
  for (const key of [
    `ledger-months:${ACCOUNT}:${SOURCE}`,
    `query-cache:${ACCOUNT}:${SOURCE}`,
    `ledger-months:${ACCOUNT}:${TARGET}`,
    `query-cache:${ACCOUNT}:${TARGET}`,
    `ledger-months:user-b:${SOURCE}`,
    `ledger-months:${ACCOUNT}:book-other`,
  ]) {
    store.set(key, {});
  }
});

const remaining = (): string[] => [...store.keys()].sort();
const KEPT_AFTER_SOURCE_CLEARED = [
  `ledger-months:${ACCOUNT}:${TARGET}`,
  `ledger-months:${ACCOUNT}:book-other`,
  `ledger-months:user-b:${SOURCE}`,
  `query-cache:${ACCOUNT}:${TARGET}`,
].sort();

describe("导入页归档来源账本：与普通归档一致清本机数据", () => {
  it("来源是设备当前账本：归档 → 显示已归档 → 清来源账本本机数据 → 整页载入", async () => {
    const { steps, timeline, cleared } = harness({ currentBookId: SOURCE });
    await expect(archiveImportSource(steps)).resolves.toBe("reloading");
    expect(timeline).toEqual([`archive:${SOURCE}`, "archived", `clear:${SOURCE}`, "reload"]);
    expect(cleared).toEqual([[ACCOUNT, SOURCE]]);
    expect(remaining()).toEqual(KEPT_AFTER_SOURCE_CLEARED);
  });

  it("来源不是当前账本（例如当前账本是目标）：同样清来源账本，但不载入、留在结果页", async () => {
    const { steps, timeline, cleared } = harness({ currentBookId: TARGET });
    await expect(archiveImportSource(steps)).resolves.toBe("stayed");
    expect(timeline).toEqual([`archive:${SOURCE}`, "archived", `clear:${SOURCE}`]);
    expect(cleared).toEqual([[ACCOUNT, SOURCE]]);
    expect(remaining()).toEqual(KEPT_AFTER_SOURCE_CLEARED);
  });

  it("没有设备当前账本：清来源账本，不载入", async () => {
    const { steps, timeline } = harness({ currentBookId: null });
    await expect(archiveImportSource(steps)).resolves.toBe("stayed");
    expect(timeline).toEqual([`archive:${SOURCE}`, "archived", `clear:${SOURCE}`]);
  });

  it("目标账本的本机数据在任何分支都不被清理", async () => {
    for (const currentBookId of [SOURCE, TARGET, null]) {
      store.set(`ledger-months:${ACCOUNT}:${SOURCE}`, {});
      const { steps, cleared } = harness({ currentBookId });
      await archiveImportSource(steps);
      expect(cleared.every(([, bookId]) => bookId !== TARGET)).toBe(true);
      expect(store.has(`ledger-months:${ACCOUNT}:${TARGET}`)).toBe(true);
      expect(store.has(`query-cache:${ACCOUNT}:${TARGET}`)).toBe(true);
    }
  });

  it("来源与目标是同一本账（服务器本应拒绝）：宁可报错也不清，也不载入", async () => {
    const { steps, timeline, cleared } = harness({ sourceBookId: TARGET, currentBookId: TARGET });
    await expect(archiveImportSource(steps)).rejects.toThrow();
    expect(cleared).toEqual([]);
    expect(timeline).not.toContain("reload");
    expect(store.has(`ledger-months:${ACCOUNT}:${TARGET}`)).toBe(true);
  });

  it("归档请求失败：不显示已归档、不清理、不载入，错误交给调用方显示", async () => {
    const failure = new Error("archive failed");
    const { steps, timeline, cleared } = harness({ archive: () => Promise.reject(failure) });
    await expect(archiveImportSource(steps)).rejects.toBe(failure);
    expect(timeline).toEqual([`archive:${SOURCE}`]);
    expect(cleared).toEqual([]);
    expect(store.size).toBe(6);
  });

  it("清本机数据失败（与 runLifecycle 一致）：已归档照实显示，但不载入，错误交给调用方显示", async () => {
    const failure = new Error("indexeddb unavailable");
    const { steps, timeline } = harness({ currentBookId: SOURCE, clear: () => Promise.reject(failure) });
    await expect(archiveImportSource(steps)).rejects.toBe(failure);
    expect(timeline).toEqual([`archive:${SOURCE}`, "archived", `clear:${SOURCE}`]);
    expect(timeline).not.toContain("reload");
  });

  it("没有登录用户（与 runLifecycle 的 user === null 一致）：跳过清理，照常决定是否载入", async () => {
    const current = harness({ accountId: null, currentBookId: SOURCE });
    await expect(archiveImportSource(current.steps)).resolves.toBe("reloading");
    expect(current.timeline).toEqual([`archive:${SOURCE}`, "archived", "reload"]);
    const other = harness({ accountId: null, currentBookId: TARGET });
    await expect(archiveImportSource(other.steps)).resolves.toBe("stayed");
    expect(other.cleared).toEqual([]);
    expect(store.size).toBe(6);
  });
});
