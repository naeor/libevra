import { describe, expect, it } from "vitest";
import type { Transaction } from "@libellum/shared";
import { presentEntries, validStorageRange, type EntryPresentation } from "./EntrySortControls.js";

const options: EntryPresentation = { order: "timeDesc", attachment: "any", type: "", minMB: "", maxMB: "" };
function row(id: string, extra: Partial<Transaction> = {}): Transaction {
  return { id, amountCents: 100, currency: "CNY", occurredAt: "2026-11-01T10:00:00Z", occurredLocalDate: "2026-11-01", ...extra } as Transaction;
}
describe("明细筛选后的稳定排序", () => {
  it("容量范围允许单边和小数，不接受倒置、负数、无穷或未完成输入", () => {
    for (const range of [["", ""], ["0", "1.5"], ["2", ""], ["", "0"], ["1.5", "1.5"]]) expect(validStorageRange(range[0]!, range[1]!)).toBe(true);
    for (const range of [["2", "1"], ["-1", ""], [".", ""], ["abc", "5"], ["Infinity", ""], ["1e309", ""]]) expect(validStorageRange(range[0]!, range[1]!)).toBe(false);
  });
  it("先同时筛选附件类型、数量和容量，再按容量排序，保留原数组", () => {
    const rows = [row("large", { attachmentCount: 2, attachmentTypes: ["image/png"], storageBytes: 4e6 }), row("small", { attachmentCount: 1, attachmentTypes: ["image/jpeg"], storageBytes: 2e6 }), row("pdf", { attachmentCount: 1, attachmentTypes: ["application/pdf"], storageBytes: 3e6 }), row("none")];
    expect(presentEntries(rows, { ...options, order: "storageAsc", attachment: "has", type: "image/", minMB: "1", maxMB: "5" }).map(r => r.id)).toEqual(["small", "large"]);
    expect(rows[0]!.id).toBe("large");
  });
  it("未折算时按币种分组，避免直接比较不同货币的金额", () => {
    const rows = [row("usd", { currency: "USD", amountCents: 1 }), row("cny", { amountCents: 999 })];
    expect(presentEntries(rows, { ...options, order: "amountAsc" }).map(r => r.id)).toEqual(["cny", "usd"]);
  });
  it("折算金额保持大整数精度；缺失汇率在两个方向都排在末尾", () => {
    const rows = [row("a"), row("b"), row("missing")];
    const amounts = { a: "9007199254740993", b: "9007199254740992", missing: null };
    expect(presentEntries(rows, { ...options, order: "amountAsc" }, amounts).map(r => r.id)).toEqual(["b", "a", "missing"]);
    expect(presentEntries(rows, { ...options, order: "amountDesc" }, amounts).map(r => r.id)).toEqual(["a", "b", "missing"]);
  });
  it("时间按记账本地日期排序，同日再按时刻；相同值保持确定次序", () => {
    const rows = [row("b"), row("a"), row("older", { occurredLocalDate: "2026-10-31" })];
    expect(presentEntries(rows, options).map(r => r.id)).toEqual(["a", "b", "older"]);
    expect(presentEntries(rows, { ...options, order: "timeAsc" }).map(r => r.id)).toEqual(["older", "a", "b"]);
  });
});
