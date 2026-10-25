import type { Transaction } from "@libellum/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./storage.js", () => ({
  readSnapshot: (key: string) => disk.get(key) ?? null,
  readValue: async (key: string) => disk.get(key) ?? null,
  writeValue: async (key: string, value: unknown) => { disk.set(key, value); return true; },
  removeValue: async (key: string) => { disk.delete(key); return true; },
}));
vi.mock("./diagnostics.js", () => ({ logOffline: vi.fn(async () => undefined) }));
vi.mock("../api.js", async (original) => ({ ...await original<typeof import("../api.js")>(), apiFetch: vi.fn() }));

import { apiFetch, primeBookId } from "../api.js";
import { cachePersister } from "./cache.js";
import { isolateMismatchedCopy, scopedKey, setOfflineScope } from "./scope.js";
import { ledgerSnapshotValue, readLocalTransactions, readMarks, readStoredMonths, setMark, upsertEntry } from "./localLedger.js";
import { retryAbandonedWrites, syncAll, syncMonth } from "./sync.js";

function entry(id: string): Transaction {
  return { id, kind: "expense", amountCents: 100, currency: "CNY", categoryId: "cat", categoryName: "餐饮",
    categoryIsSystem: false, paymentMethodId: null, paymentMethodName: null, occurredAt: "2026-10-25T01:00:00Z",
    occurredLocalDate: "2026-10-25", occurredTz: "Asia/Shanghai", note: null, tags: [], version: 1 };
}
function cached(id: string) {
  return { timestamp: Date.now(), buster: "", clientState: { mutations: [], queries: [{
    queryKey: ["transactions", { month: "2026-10" }], state: { data: { items: [entry(id)] } },
  }] } };
}

beforeEach(async () => {
  disk.clear();
  vi.mocked(apiFetch).mockReset();
  await retryAbandonedWrites();
});

describe("新账本隔离回归", () => {
  it("已有错误账本副本隔离保留，不能继续展示或投递其中的待同步记录", async () => {
    const contaminated = cached("foreign-row");
    contaminated.clientState.queries.push({ queryKey: ["ledger"], state: { data: { book: { id: "source" } } } } as never);
    disk.set("query-cache:quarantine:target", JSON.stringify(contaminated));
    disk.set("ledger-months:quarantine:target", { "2026-10": [entry("foreign-row")] });
    disk.set("ledger-marks:quarantine:target", { "foreign-row": { pending: true, synced: false } });
    setOfflineScope("quarantine", "target");
    await isolateMismatchedCopy();
    expect(scopedKey("ledger-months")).toBe("ledger-months:quarantine:target:isolated-v1");
    expect(await readLocalTransactions()).toEqual([]);
    await syncAll();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(disk.has("ledger-months:quarantine:target")).toBe(true);
    expect(disk.has("ledger-marks:quarantine:target")).toBe(true);
  });

  it("节流期间切账，旧查询仍保存到原账本", async () => {
    vi.useFakeTimers();
    try {
      setOfflineScope("throttle", "old");
      const first = cachePersister.persistClient(cached("first") as never);
      await vi.advanceTimersByTimeAsync(1100);
      await first;
      const second = cachePersister.persistClient(cached("second") as never);
      setOfflineScope("throttle", "new");
      await vi.advanceTimersByTimeAsync(1100);
      await second;
      expect(String(disk.get("query-cache:throttle:old"))).toContain("second");
      expect(disk.has("query-cache:throttle:new")).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("旧全局缓存和另一本账都不能进入 Test01；离线切回仍保留原记录", async () => {
    disk.set("query-cache", JSON.stringify(cached("legacy")));
    disk.set("query-cache:reader:old", JSON.stringify(cached("old-row")));
    setOfflineScope("reader", "old");
    expect((await readLocalTransactions()).map(row => row.id)).toEqual(["old-row"]);
    setOfflineScope("reader", "40000014");
    expect(ledgerSnapshotValue()).toEqual([]);
    expect(await readLocalTransactions()).toEqual([]);
    expect(await cachePersister.restoreClient()).toBeUndefined();
    setOfflineScope("other-reader", "old");
    expect(await readLocalTransactions()).toEqual([]);
    setOfflineScope("reader", "old");
    expect((await readLocalTransactions()).map(row => row.id)).toEqual(["old-row"]);
    expect(disk.has("query-cache")).toBe(true);
  });

  it("发送时全局账本改变，离线新增仍显式发送给原账本", async () => {
    setOfflineScope("sender", "original");
    await upsertEntry(entry("pending-original"));
    await setMark("pending-original", { pending: true, synced: false });
    primeBookId("new-book");
    vi.mocked(apiFetch).mockResolvedValue(entry("pending-original"));
    expect((await syncAll()).delivered).toBe(1);
    expect(apiFetch).toHaveBeenCalledWith("/transactions", expect.objectContaining({ method: "POST", bookId: "original" }));
  });

  it("旧同步响应返回时已换账本，不清除原标记，也不写入新账本", async () => {
    setOfflineScope("racing", "original");
    await upsertEntry(entry("racing-row"));
    await setMark("racing-row", { pending: true, synced: false });
    vi.mocked(apiFetch).mockImplementation(async () => {
      setOfflineScope("racing", "new");
      return entry("racing-row");
    });
    await syncAll();
    expect(await readStoredMonths()).toEqual({});
    expect(await readMarks()).toEqual({});
    setOfflineScope("racing", "original");
    expect((await readMarks())["racing-row"]?.pending).toBe(true);
  });

  it("旧月份下载在换账本后完成，不能落进新账本", async () => {
    setOfflineScope("download", "original");
    vi.mocked(apiFetch).mockImplementation(async () => {
      setOfflineScope("download", "new");
      return { items: [entry("late")], nextCursor: null };
    });
    expect(await syncMonth("2026-10")).toBe(0);
    expect(await readStoredMonths()).toEqual({});
  });

  it("同一账本在请求中被隔离，旧响应不能污染新地址", async () => {
    setOfflineScope("isolate-inflight", "target");
    await upsertEntry(entry("unsafe-row"));
    await setMark("unsafe-row", { pending: true, synced: false });
    vi.mocked(apiFetch).mockImplementation(async () => {
      disk.set("offline-isolation:isolate-inflight:target", true);
      await isolateMismatchedCopy();
      return entry("unsafe-row");
    });
    await syncAll();
    expect(await readStoredMonths()).toEqual({});
    expect(await readMarks()).toEqual({});
    expect(disk.has("ledger-marks:isolate-inflight:target")).toBe(true);
  });

  it("未识别身份时不恢复全局缓存，也不上传任何记录", async () => {
    disk.set("query-cache", JSON.stringify(cached("legacy")));
    setOfflineScope(null, null);
    expect(await cachePersister.restoreClient()).toBeUndefined();
    await syncAll();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
