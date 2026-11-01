import type { Transaction, TransactionListResponse } from "@libellum/shared";
import { describe, expect, it } from "vitest";
import { monthAvailability, monthsInYear, readMonthSamples } from "./monthAvailability.js";

const entry = (id: string, month = "2026-10") => ({ id, occurredLocalDate: `${month}-15` }) as Transaction;
const page = (items: Transaction[], nextCursor: string | null = null): TransactionListResponse => ({ items, nextCursor });
const empty = page([]);
const base = { months: ["2026-09", "2026-10"], bookIds: ["a"], localBookId: "a", local: [], pending: new Set<string>(), deleted: new Set<string>() };

describe("月份可选状态", () => {
  it("完整本地账本仅启用有账目的月份，日期按记账时当地日期", () => {
    expect(monthAvailability({ ...base, samples: undefined, completeLocal: true, local: [entry("1")] })).toEqual({ "2026-09": false, "2026-10": true });
  });
  it("远端明确为空时禁用，即使本机还有旧缓存", () => {
    expect(monthAvailability({ ...base, local: [entry("1")], samples: { "2026-10": { a: empty } } })["2026-10"]).toBe(false);
  });
  it("未同步的新账目仍使月份可选", () => {
    expect(monthAvailability({ ...base, local: [entry("1")], pending: new Set(["1"]), samples: { "2026-10": { a: empty } } })["2026-10"]).toBe(true);
  });
  it("本机已删唯一账目或待同步改到其他月份，不显示旧月份有账", () => {
    const samples = { "2026-10": { a: page([entry("1")]) } };
    expect(monthAvailability({ ...base, deleted: new Set(["1"]), samples })["2026-10"]).toBe(false);
    const moved = monthAvailability({ ...base, samples, local: [entry("1", "2026-09")], pending: new Set(["1"]) });
    expect(moved).toEqual({ "2026-09": true, "2026-10": false });
  });
  it("删掉样本但仍有后续页时，不把整月判空", () => {
    expect(monthAvailability({ ...base, deleted: new Set(["1"]), samples: { "2026-10": { a: page([entry("1")], "next") } } })["2026-10"]).toBeUndefined();
  });
  it("未下载、查询失败和未确定账本都不是空月", () => {
    expect(monthAvailability({ ...base, samples: undefined })["2026-10"]).toBeUndefined();
    expect(monthAvailability({ ...base, samples: { "2026-10": { a: null } } })["2026-10"]).toBeUndefined();
    expect(monthAvailability({ ...base, bookIds: [], samples: {} })["2026-10"]).toBeUndefined();
  });
  it("总览任一本有账就可选；全部确定为空才禁用，当前账本删除标记不影响其他账本", () => {
    const args = { ...base, bookIds: ["a", "b"], deleted: new Set(["1"]) };
    expect(monthAvailability({ ...args, samples: { "2026-10": { a: empty, b: page([entry("1")]) } } })["2026-10"]).toBe(true);
    expect(monthAvailability({ ...args, samples: { "2026-10": { a: empty, b: empty } } })["2026-10"]).toBe(false);
    expect(monthAvailability({ ...args, samples: { "2026-10": { a: empty, b: null } } })["2026-10"]).toBeUndefined();
  });
  it("外部账本不会使用当前账本的离线数据", () => {
    expect(monthAvailability({ ...base, bookIds: ["b"], local: [entry("1")], samples: undefined })["2026-10"]).toBeUndefined();
  });
  it("按指定账本和月份有界查询，失败只保留为未知", async () => {
    let active = 0;
    let peak = 0;
    const calls: string[] = [];
    const samples = await readMonthSamples(monthsInYear(2026), ["a", "b"], async (book, month) => {
      calls.push(`${book}:${month}`);
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      if (book === "b" && month === "2026-10") throw new Error("offline");
      return empty;
    }, () => false);
    expect(calls).toHaveLength(24);
    expect(new Set(calls).size).toBe(24);
    expect(peak).toBeLessThanOrEqual(3);
    expect(samples["2026-10"]).toEqual({ a: empty, b: null });
  });
  it("面板关闭或范围切换后停止继续查询", async () => {
    let cancelled = false;
    let calls = 0;
    await readMonthSamples(monthsInYear(2026), ["a"], async () => { calls++; cancelled = true; return empty; }, () => cancelled);
    expect(calls).toBe(1);
  });
});
