import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DUPLICATE_DETECTION_SETTINGS, evaluateDuplicatePair, type DuplicateCandidateFields } from "@libellum/shared";
import { ReviewScanController } from "./reviewScanController.js";
import type { ReviewScanChunk } from "./duplicateReview.js";
const candidate = (id: string): DuplicateCandidateFields => ({ id, bookId: "book", kind: "expense", amountCents: 100, currency: "CNY", occurredAt: "2026-10-21T00:00:00Z", occurredLocalDate: "2026-10-21", categoryId: null, paymentMethodId: null });
const pair = evaluateDuplicatePair(candidate("a"), candidate("b"), DEFAULT_DUPLICATE_DETECTION_SETTINGS);
const chunk = (more = false): ReviewScanChunk => ({ pairs: [pair], entries: [], total: 4, processed: 2, nextSeq: more ? 2 : null, throughSeq: 4, truncated: false, scope: "server", continuation: more ? { source: "server", value: { leftSeq: 2, rightSeq: 0, throughSeq: 4 } } : null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
describe("实际扫描状态控制器", () => {
  it("重新扫描为空结果时不会恢复上次配对", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(chunk()).mockResolvedValueOnce({ ...chunk(), pairs: [], processed: 4 });
    const state = new ReviewScanController(fetch);
    await state.scan(false); expect(state.getSnapshot().pairs).toHaveLength(1);
    await state.scan(false); expect(state.getSnapshot().pairs).toHaveLength(0); expect(state.getSnapshot().processed).toBe(4);
    expect(fetch.mock.calls[1]?.[0]).toBe(0);
  });
  it("失败续扫累计进度并去重，不重置已完成的记录", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(chunk(true)).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(chunk());
    const state = new ReviewScanController(fetch);
    await state.scan(false); expect(state.getSnapshot().phase).toBe("error"); expect(state.getSnapshot().processed).toBe(2);
    await state.scan(true); expect(state.getSnapshot().processed).toBe(4); expect(state.getSnapshot().pairs).toHaveLength(1);
    expect(fetch.mock.calls[2]?.[2]).toEqual(chunk(true).continuation);
  });
  it("连续点击只发一次，取消后到达的旧请求不覆盖新扫描", async () => {
    const old = deferred<ReviewScanChunk>(); const fresh = deferred<ReviewScanChunk>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const state = new ReviewScanController(fetch);
    const first = state.scan(false); await state.scan(false); expect(fetch).toHaveBeenCalledTimes(1);
    state.cancel(); const second = state.scan(false);
    old.resolve(chunk()); await first; expect(state.getSnapshot().phase).toBe("running"); expect(state.getSnapshot().pairs).toHaveLength(0);
    fresh.resolve({ ...chunk(), pairs: [] }); await second; expect(state.getSnapshot().pairs).toHaveLength(0);
  });
  it("账本或规则对应的控制器销毁后，迟到结果不能污染新页面状态", async () => {
    const pending = deferred<ReviewScanChunk>(); const old = new ReviewScanController(() => pending.promise);
    const running = old.scan(false); old.dispose();
    const next = new ReviewScanController(async () => ({ ...chunk(), pairs: [] })); await next.scan(false);
    pending.resolve(chunk()); await running;
    expect(next.getSnapshot().pairs).toHaveLength(0); expect(old.getSnapshot().pairs).toHaveLength(0);
  });
});
