import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DUPLICATE_DETECTION_SETTINGS as settings, type Transaction } from "@libellum/shared";
const mock = vi.hoisted(() => ({ book: "book-1", guest: false, entries: [] as Transaction[], api: vi.fn() }));
vi.mock("./api.js", () => ({ apiFetch: mock.api, currentBookIdHeader: () => mock.book }));
vi.mock("./guest/runtime.js", () => ({ isGuestRuntime: () => mock.guest }));
vi.mock("./guest/data.js", () => ({ guestDataValue: () => ({ book: { id: mock.book } }), guestDeletedIds: () => new Set(), guestTransactions: () => mock.entries }));
vi.mock("./offline/localLedger.js", () => ({ deletedEntriesValue: () => new Set(), readLocalTransactions: async () => mock.entries }));
import { fetchReviewChunk, type ReviewCursor } from "./duplicateReview.js";
function entry(id: number, seq?: number): Transaction { return {
  id: String(id).padStart(5, "0"), ...(seq === undefined ? {} : { seq }), kind: "expense", amountCents: 100, currency: "CNY",
  occurredAt: "2026-10-21T00:00:00Z", occurredLocalDate: "2026-10-21", occurredTz: "UTC", categoryId: "cat", categoryName: "分类", categoryIsSystem: false,
  paymentMethodId: null, paymentMethodName: null, note: null, tags: [], version: 1,
}; }
beforeEach(() => { mock.book = "book-1"; mock.guest = false; mock.entries = []; mock.api.mockReset(); vi.stubGlobal("navigator", { onLine: false }); });
describe("真实本地审查分页", () => {
  it("未同步记录无序号和相同序号都参与，而不是被0起点排除", async () => {
    mock.entries = [entry(1), entry(2), entry(3, 5), entry(4, 5)];
    const chunk = await fetchReviewChunk(mock.book, settings, 0);
    expect(chunk.pairs).toHaveLength(6); expect(chunk.processed).toBe(4); expect(chunk.continuation).toBeNull();
  });
  it("超过500对可以中途续扫，快照不会随本地新增或排序改变", async () => {
    mock.entries = Array.from({ length: 40 }, (_, i) => entry(i));
    let chunk = await fetchReviewChunk(mock.book, settings, 0);
    expect(chunk.pairs).toHaveLength(500); expect(chunk.processed).toBeLessThan(40);
    const keys = new Set(chunk.pairs.map(pair => pair.pairKey)); let processed = chunk.processed;
    mock.entries = [entry(999), ...mock.entries.reverse()];
    while (chunk.continuation) {
      chunk = await fetchReviewChunk(mock.book, settings, chunk.nextSeq ?? 0, chunk.throughSeq, chunk.continuation);
      expect(chunk.pairs.length).toBeLessThanOrEqual(500);
      for (const pair of chunk.pairs) { expect(keys.has(pair.pairKey)).toBe(false); keys.add(pair.pairKey); }
      processed += chunk.processed;
    }
    expect(keys.size).toBe(780); expect(processed).toBe(40); expect(chunk.total).toBe(40);
  });
  it("在线中途失败不会把服务器游标套给离线快照", async () => {
    vi.stubGlobal("navigator", { onLine: true }); mock.api.mockRejectedValue(new Error("连接中断"));
    mock.entries = [entry(1), entry(2)];
    const cursor: ReviewCursor = { source: "server", value: { leftSeq: 30, rightSeq: 70, throughSeq: 100 } };
    await expect(fetchReviewChunk(mock.book, settings, 30, 100, cursor)).rejects.toThrow("连接中断");
    const fresh = await fetchReviewChunk(mock.book, settings, 0);
    expect(fresh.scope).toBe("local"); expect(fresh.pairs).toHaveLength(1);
  });
  it("规则或账本改变后拒绝旧本地断点", async () => {
    mock.entries = Array.from({ length: 40 }, (_, i) => entry(i));
    const chunk = await fetchReviewChunk(mock.book, settings, 0);
    await expect(fetchReviewChunk(mock.book, { ...settings, timeWindowSeconds: 300 }, 0, 0, chunk.continuation!)).rejects.toThrow("快照已失效");
    mock.book = "book-2";
    await expect(fetchReviewChunk("book-1", settings, 0, 0, chunk.continuation!)).rejects.toThrow("本机没有这本账");
  });
  it("从另一账本设置在线检查时显式使用目标账本，不要求切换当前账本", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    mock.api.mockResolvedValue({ pairs: [], entries: [], total: 2, processed: 2, nextSeq: null, throughSeq: 2, nextCursor: null, truncated: false });
    const result = await fetchReviewChunk("target-book", settings, 0);
    expect(result.scope).toBe("server");
    expect(mock.api).toHaveBeenCalledWith("/transactions/duplicates/review", expect.objectContaining({ bookId: "target-book" }));
    expect(mock.book).toBe("book-1");
  });
  it("另一账本在线检查失败时，不能回退并冒用当前账本的本地数据", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    mock.entries = [entry(1), entry(2)];
    mock.api.mockRejectedValue(new Error("网络中断"));
    await expect(fetchReviewChunk("target-book", settings, 0)).rejects.toThrow("网络中断");
  });
  it("在线请求返回时当前账本变化，丢弃旧响应而不是回退显示另一账本", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    mock.api.mockImplementation(async () => {
      mock.book = "changed-book";
      return { pairs: [], entries: [], total: 2, processed: 2, nextSeq: null, throughSeq: 2, truncated: false };
    });
    await expect(fetchReviewChunk("book-1", settings, 0)).rejects.toThrow("账本已切换");
  });
});
