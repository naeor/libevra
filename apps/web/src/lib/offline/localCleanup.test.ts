import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();

vi.mock("./storage.js", () => ({
  readValue: (key: string) => Promise.resolve(store.get(key) ?? null),
  listKeys: () => Promise.resolve([...store.keys()]),
  removeValue: (key: string) => {
    store.delete(key);
    return Promise.resolve(true);
  },
}));

vi.mock("../pendingAttachments.js", () => ({ clearClosedAccountAttachments: vi.fn(async () => {}) }));
import { clearClosedAccountAttachments } from "../pendingAttachments.js";
import { clearAccountLocalData, clearBookLocalData, clearAfterAccountClosure } from "./localCleanup.js";

describe("local lifecycle cleanup", () => {
  beforeEach(() => {
    vi.mocked(clearClosedAccountAttachments).mockClear();
    store.clear();
    store.set("ledger-months:user-a:book-a", []);
    store.set("ledger-marks:user-a:book-a", {});
    store.set("query-cache:user-a:book-a", {});
    store.set("ledger-months:user-a:book-b", []);
    store.set("ledger-marks:user-b:book-a", {});
    store.set("query-cache:user-b:book-a", {});
    store.set("query-cache", {});
  });

  it("只有确认账号归属的注销路径才清除该账号的待上传原件", async () => {
    await clearAccountLocalData("user-a");
    await clearBookLocalData("user-a", "book-b");
    expect(clearClosedAccountAttachments).not.toHaveBeenCalled();
    expect(await clearAfterAccountClosure("user-a", "user-b")).toBe(false);
    expect(clearClosedAccountAttachments).not.toHaveBeenCalled();
    expect(await clearAfterAccountClosure("user-a", "user-a")).toBe(true);
    expect(await clearAfterAccountClosure("user-a", "user-a")).toBe(true);
    expect(vi.mocked(clearClosedAccountAttachments).mock.calls).toEqual([["user-a"], ["user-a"]]);
    expect(store.has("query-cache:user-b:book-a")).toBe(true);
  });

  it("附件存储暂时失败时可单独重试本机清理，保留其他账号的离线副本", async () => {
    vi.mocked(clearClosedAccountAttachments).mockRejectedValueOnce(new Error("storage unavailable"));
    expect(await clearAfterAccountClosure("user-a", "user-a")).toBe(false);
    expect(store.has("ledger-months:user-a:book-a")).toBe(false);
    expect(await clearAfterAccountClosure("user-a", "user-a")).toBe(true);
    expect(store.has("ledger-marks:user-b:book-a")).toBe(true);
  });

  it("旧服务端的注销回执仍清普通副本，未同步月份和待上传附件保留", async () => {
    store.set("ledger-marks:user-a:book-b", { row: { pending: true } });
    expect(await clearAfterAccountClosure("user-a", undefined)).toBe(false);
    expect(store.has("ledger-months:user-a:book-a")).toBe(false);
    expect(store.has("ledger-months:user-a:book-b")).toBe(true);
    expect(store.has("ledger-marks:user-b:book-a")).toBe(true);
    expect(clearClosedAccountAttachments).not.toHaveBeenCalled();
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
