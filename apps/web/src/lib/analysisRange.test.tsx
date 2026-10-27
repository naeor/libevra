import type { Transaction, TransactionListResponse } from "@libellum/shared";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiRequestError } from "./api.js";
import { readAnalysisRange, type AnalysisRangeIo, type AnalysisMarks } from "./analysisRange.js";
import { applyLocale } from "../i18n/index.js";
import { CardBody } from "../statsWorkbench/cards.js";
import { newCard } from "../statsWorkbench/defaults.js";
import type { WorkbenchScope } from "../statsWorkbench/scope.js";

function row(id: string, date: string, amountCents = 100): Transaction {
  return { id, kind: "expense", amountCents, currency: "CNY", categoryId: "c", categoryName: "餐饮", categoryIsSystem: false, paymentMethodId: null, paymentMethodName: null, occurredAt: `${date}T12:00:00Z`, occurredLocalDate: date, occurredTz: "Asia/Shanghai", note: null, tags: [], version: 1 };
}
function fixture() {
  let scope = "a:b";
  let marks: AnalysisMarks = {};
  const stored: Record<string, readonly Transaction[]> = {};
  const receipts: Record<string, readonly string[]> = {};
  const calls: string[] = [];
  let fetch = async (_month: string, _cursor: string | undefined): Promise<TransactionListResponse> => ({ items: [], nextCursor: null });
  const io: AnalysisRangeIo = {
    scope: () => scope,
    fetchMonth: async (month, cursor, bookId) => { expect(bookId).toBe("b"); calls.push(`${month}:${cursor ?? "first"}`); return fetch(month, cursor); },
    storeMonth: async (month, entries) => { stored[month] = entries; },
    readStored: async () => stored,
    readOriginals: async () => Object.values(stored).flat(),
    readMarks: async () => marks,
    readCoverage: async key => { expect(key).toBe("a:b"); return receipts; },
    saveReceipt: async (key, month, ids) => { expect(key).toBe("a:b"); receipts[month] = ids; },
  };
  const request = { accountId: "a", bookId: "b", range: { from: "2026-09-01", to: "2026-10-23" }, offline: false, signal: new AbortController().signal };
  return { io, request, stored, receipts, calls, setScope: (next: string) => { scope = next; }, setFetch: (next: typeof fetch) => { fetch = next; }, setMarks: (next: AnalysisMarks) => { marks = next; } };
}

describe("W5唯一分析范围读取链", () => {
  it("完整翻页并保存空月份凭据，离线能区分已核实空月和未下载月份", async () => {
    const f = fixture();
    f.setFetch(async (month, cursor) => month === "2026-10" ? { items: [], nextCursor: null } : cursor === undefined ? { items: [row("one", "2026-09-02")], nextCursor: "p2" } : { items: [row("two", "2026-09-20")], nextCursor: null });
    const result = await readAnalysisRange(f.request, f.io);
    expect(f.calls).toEqual(["2026-09:first", "2026-09:p2", "2026-10:first"]);
    expect(result.entries.map(entry => entry.id)).toEqual(["one", "two"]);
    expect(result.sourceComplete).toBe(true);
    expect(f.receipts["2026-10"]).toEqual([]);
    expect(f.stored["2026-10"]).toEqual([]);
    const offline = await readAnalysisRange({ ...f.request, offline: true }, f.io);
    expect(offline.sourceComplete).toBe(true);
    expect(offline.offline).toBe(true);
    delete f.receipts["2026-10"];
    expect((await readAnalysisRange({ ...f.request, offline: true }, f.io)).sourceComplete).toBe(false);
  });

  it("网络断开时按全部请求月份的凭据核对，不把读取到的部分月份冒充完整", async () => {
    const f = fixture();
    f.stored["2026-09"] = [row("cached", "2026-09-02")];
    f.receipts["2026-09"] = ["cached"];
    f.setFetch(async () => { throw new TypeError("offline"); });
    const result = await readAnalysisRange(f.request, f.io);
    expect(result).toMatchObject({ offline: true, sourceComplete: false });
    expect(result.entries[0]?.id).toBe("cached");
    expect(result.remoteEntries).toBeNull();
  });

  it("账本切换或取消后迟到的HTTP响应不写缓存、不签凭据、不返回旧结果", async () => {
    for (const abort of [false, true]) {
      const f = fixture();
      let resolve!: (page: TransactionListResponse) => void;
      f.setFetch(() => new Promise(answer => { resolve = answer; }));
      const controller = new AbortController();
      const reading = readAnalysisRange({ ...f.request, signal: controller.signal }, f.io);
      if (abort) controller.abort(); else f.setScope("a:other-book");
      resolve({ items: [row("old-book", "2026-09-02")], nextCursor: null });
      await expect(reading).rejects.toThrow();
      expect(f.stored).toEqual({});
      expect(f.receipts).toEqual({});
    }
  });

  it("权限拒绝不降级为本机成功统计；循环cursor拒绝而不无限读取", async () => {
    const f = fixture();
    f.setFetch(async () => { throw new ApiRequestError(403, "book_forbidden", "fixture"); });
    await expect(readAnalysisRange(f.request, f.io)).rejects.toMatchObject({ status: 403 });
    f.setFetch(async () => ({ items: [], nextCursor: "same" }));
    await expect(readAnalysisRange(f.request, f.io)).rejects.toThrow("analysis_cursor_cycle");
  });

  it("在线本机写盘失败仍保留完整读取的内存原件，不伪造离线下载凭据", async () => {
    const f = fixture();
    f.setFetch(async month => ({ items: month === "2026-09" ? [row("one", "2026-09-02")] : [], nextCursor: null }));
    const result = await readAnalysisRange(f.request, { ...f.io, storeMonth: async () => { throw new Error("quota"); } });
    expect(result.sourceComplete).toBe(true);
    expect(result.offline).toBe(false);
    expect(result.entries).toHaveLength(1);
    expect(f.receipts).toEqual({});
  });

  it("保留本机待同步改动、排除已删原件，400天跨15月仍完整枚举；超限拒绝", async () => {
    const f = fixture();
    const old = row("edited", "2026-09-02", 100);
    const changed = { ...old, amountCents: 200, version: 2 };
    const added = row("pending-new", "2026-10-03", 300);
    f.setMarks({ edited: { pending: true }, "pending-new": { pending: true }, deleted: { deleted: true } });
    f.setFetch(async month => ({ items: month === "2026-09" ? [old, row("deleted", "2026-09-03")] : [], nextCursor: null }));
    const result = await readAnalysisRange(f.request, { ...f.io, readOriginals: async () => [changed, added] });
    expect(result.entries.map(entry => entry.id)).toEqual(["edited", "pending-new"]);
    expect(result.entries[0]?.amountCents).toBe(200);
    const fifteen = fixture();
    await readAnalysisRange({ ...fifteen.request, range: { from: "2025-01-31", to: "2026-03-06" } }, fifteen.io);
    expect(fifteen.calls).toHaveLength(15);
    expect(fifteen.calls.at(-1)).toBe("2026-03:first");
    await expect(readAnalysisRange({ ...f.request, range: { from: "2020-01-01", to: "2026-10-23" } }, f.io)).rejects.toThrow("analysis_range_too_long");
  });

  it("A01当前和上期独立读取完整后恢复真实增幅，未核实上期不显示增幅", async () => {
    applyLocale("zh-CN");
    const f = fixture();
    f.setFetch(async month => ({ items: month === "2026-09" ? [row("previous", "2026-09-20", 500)] : [row("current", "2026-10-20", 1000)], nextCursor: null }));
    const range = { from: "2026-10-01", to: "2026-10-23" };
    const current = await readAnalysisRange({ ...f.request, range }, f.io);
    const previous = await readAnalysisRange({ ...f.request, range: { from: "2026-09-01", to: "2026-09-23" } }, f.io);
    const base: WorkbenchScope = { today: "2026-10-27", filters: { time: { kind: "custom", ...range }, currency: null, combined: false }, range, bucket: "day", combined: false, fxAvailable: true, currency: "CNY", defaultCurrency: "CNY", entries: current.entries, loaded: true, fx: null, coverageGap: null, repairing: false, accountScope: "user:a", rangeReadState: "complete", rangeSourceComplete: current.sourceComplete, comparisonRead: { entries: previous.entries, verified: previous.sourceComplete } };
    const verified = renderToStaticMarkup(<CardBody card={newCard("AN-A01")} scope={base} density="expanded" />);
    expect(verified).toContain("100%");
    expect(verified).not.toContain("没有可对比的历史数据");
    const unknown = renderToStaticMarkup(<CardBody card={newCard("AN-A01")} scope={{ ...base, comparisonRead: { entries: previous.entries, verified: false } }} density="expanded" />);
    expect(unknown).toContain("数据不完整");
    expect(unknown).not.toContain("100%");
    expect(unknown).toContain("没有可对比的历史数据");
  });

  it("同账本多范围落盘、读回与凭据整体串行，凭据未签发前下一月份不能开始落盘", async () => {
    const f = fixture();
    const events: string[] = [];
    let receiptStarted!: () => void;
    let finishReceipt!: () => void;
    const started = new Promise<void>(resolve => { receiptStarted = resolve; });
    const hold = new Promise<void>(resolve => { finishReceipt = resolve; });
    const io: AnalysisRangeIo = {
      ...f.io,
      storeMonth: async (month, entries) => { events.push(`store:${month}`); await f.io.storeMonth(month, entries); },
      readStored: async () => { events.push("verify"); return f.io.readStored(); },
      saveReceipt: async (scope, month, ids) => {
        events.push(`receipt-start:${month}`);
        if (month === "2026-09") { receiptStarted(); await hold; }
        await f.io.saveReceipt(scope, month, ids);
        events.push(`receipt-end:${month}`);
      },
    };
    const first = readAnalysisRange({ ...f.request, range: { from: "2026-09-01", to: "2026-09-30" } }, io);
    const second = readAnalysisRange({ ...f.request, range: { from: "2026-10-01", to: "2026-10-31" } }, io);
    await started;
    expect(events).toEqual(["store:2026-09", "verify", "receipt-start:2026-09"]);
    finishReceipt();
    await Promise.all([first, second]);
    expect(events.indexOf("receipt-end:2026-09")).toBeLessThan(events.indexOf("store:2026-10"));
    expect(Object.keys(f.receipts).sort()).toEqual(["2026-09", "2026-10"]);
  });

  it("调用方等候超时不释放底层写锁，迟到写结束后下一范围才开始落盘", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      const writes: string[] = [];
      let firstStarted!: () => void;
      let release!: () => void;
      let secondStarted!: () => void;
      const began = new Promise<void>(resolve => { firstStarted = resolve; });
      const held = new Promise<void>(resolve => { release = resolve; });
      const next = new Promise<void>(resolve => { secondStarted = resolve; });
      const io: AnalysisRangeIo = { ...f.io, storeMonth: async (month, entries) => {
        writes.push(month);
        if (month === "2026-09") { firstStarted(); await held; } else secondStarted();
        await f.io.storeMonth(month, entries);
      } };
      const first = readAnalysisRange({ ...f.request, range: { from: "2026-09-01", to: "2026-09-30" } }, io);
      const second = readAnalysisRange({ ...f.request, range: { from: "2026-10-01", to: "2026-10-31" } }, io);
      await began;
      await vi.advanceTimersByTimeAsync(1501);
      await Promise.all([first, second]);
      expect(writes).toEqual(["2026-09"]);
      release();
      await next;
      // 等两个实际提交完成后再结束测试，不遗留挂起队列给下一用例。
      await vi.runAllTimersAsync();
      expect(writes).toEqual(["2026-09", "2026-10"]);
    } finally { vi.useRealTimers(); }
  });
});
