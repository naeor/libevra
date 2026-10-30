import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
let offline = false;

vi.mock("./api.js", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("./offline/connectivity.js", () => ({ isAccountOffline: () => offline }));

const { createInBook, deleteInBook, foreignBookFor, foreignKey, ForeignLedgerOfflineError, restoreInBook, updateInBook, FOREIGN_KEY } =
  await import("./workspaceLedger.js");
const { foreignAnalysisIo } = await import("./analysisRange.js");

describe("工作区账本：外部账本的判定", () => {
  it("没选、选的就是当前账本、游客：都不是外部账本", () => {
    expect(foreignBookFor(null, "mine", false)).toBeNull();
    expect(foreignBookFor("", "mine", false)).toBeNull();
    expect(foreignBookFor("mine", "mine", false)).toBeNull();
    expect(foreignBookFor("travel", "mine", true)).toBeNull();
  });

  it("选了另一本账：外部账本", () => {
    expect(foreignBookFor("travel", "mine", false)).toBe("travel");
    expect(foreignBookFor("travel", null, false)).toBe("travel");
  });

  it("外部账本的查询键不以当前账本的前缀开头，当前账本的失效与离线回退碰不到它", () => {
    const key = foreignKey("travel", "transactions", { month: "2026-10" });
    expect(key[0]).toBe(FOREIGN_KEY);
    expect(key[0]).not.toBe("transactions");
    expect(key[1]).toBe("travel");
  });
});

describe("工作区账本：外部账本的写入一定带上那本账的 id", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ id: "t1" });
    offline = false;
  });

  it("新建、修改、删除、恢复都显式指定账本", async () => {
    await createInBook("travel", { id: "t1" } as never);
    await updateInBook("travel", "t1", { version: 2 } as never);
    await deleteInBook("travel", "t1");
    await restoreInBook("travel", "t1");
    expect(apiFetch.mock.calls.map((call) => [call[0], (call[1] as { method: string; bookId: string }).method, (call[1] as { bookId: string }).bookId])).toEqual([
      ["/transactions", "POST", "travel"],
      ["/transactions/t1", "PATCH", "travel"],
      ["/transactions/t1", "DELETE", "travel"],
      ["/transactions/t1/restore", "POST", "travel"],
    ]);
  });

  it("修改带上「从哪个值改成哪个值」：服务器只按它写入金额、分类这类字段", async () => {
    const { onlineChanges } = await import("./offline/write.js");
    const before = { id: "t1", version: 4, kind: "expense", amountCents: 777, currency: "CNY", categoryId: "c1", paymentMethodId: "p1", note: null, tags: [] } as never;
    const after = { ...(before as object), amountCents: 888, note: "午饭" } as never;
    const changes = onlineChanges(before, after);
    expect(changes).toEqual([
      { field: "amountCents", base: 777, wanted: 888, chain: [777, 888] },
      { field: "note", base: null, wanted: "午饭", chain: [null, "午饭"] },
    ]);
    await updateInBook("travel", "t1", { version: 4, amountCents: 888 } as never, changes);
    const body = (apiFetch.mock.calls[0]?.[1] as { body: { changes?: unknown; amountCents: number } }).body;
    expect(body.amountCents).toBe(888);
    expect(body.changes).toEqual(changes);
  });

  it("离线时明确拒绝，不会退回设备当前账本的离线队列", async () => {
    offline = true;
    await expect(createInBook("travel", { id: "t1" } as never)).rejects.toBeInstanceOf(ForeignLedgerOfflineError);
    await expect(updateInBook("travel", "t1", { version: 2 } as never)).rejects.toBeInstanceOf(ForeignLedgerOfflineError);
    await expect(deleteInBook("travel", "t1")).rejects.toBeInstanceOf(ForeignLedgerOfflineError);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("工作区账本：外部账本的分析读取不碰设备的离线副本", () => {
  it("作用域固定为那本账，存储与读取都是空操作", async () => {
    const io = foreignAnalysisIo("user-1:travel");
    expect(io.scope()).toBe("user-1:travel");
    await expect(io.readStored()).resolves.toEqual({});
    await expect(io.readOriginals()).resolves.toEqual([]);
    await expect(io.readMarks()).resolves.toEqual({});
    await expect(io.readCoverage("user-1:travel")).resolves.toBeNull();
    await expect(io.storeMonth("2026-10", [])).resolves.toBeUndefined();
  });
});
