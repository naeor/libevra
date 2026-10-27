import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@libellum/shared";

const fixture = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  scope: 0,
  marksRead: null as null | (() => Promise<unknown>),
}));
vi.mock("./scope.js", () => ({ scopedKey: (key: string) => `${key}:review-${fixture.scope}` }));
vi.mock("./storage.js", () => ({
  readValue: async (key: string) => key.startsWith("ledger-marks:") && fixture.marksRead !== null ? fixture.marksRead() : fixture.values.get(key) ?? null,
  readSnapshot: () => null,
  writeValue: async (key: string, value: unknown) => { fixture.values.set(key, value); return true; },
}));
vi.mock("../guest/runtime.js", () => ({ guestRuntimeId: () => null }));
import { readStoredMonths, storeMonth, upsertEntry } from "./localLedger.js";

const row = (id: string, occurredLocalDate: string, version = 1) => ({ id, occurredLocalDate, version, amountCents: version * 100 }) as Transaction;

beforeEach(() => { fixture.values.clear(); fixture.scope += 1; fixture.marksRead = null; });

describe("分析多范围并发下载使用真实本机月存储", () => {
  it("两个范围并发保存不同月份，均保留原件月份", async () => {
    await Promise.all([
      storeMonth("2026-09", [row("september", "2026-09-01")]),
      storeMonth("2026-10", [row("october", "2026-10-01")]),
    ]);
    const saved = await readStoredMonths();
    expect(saved["2026-09"]?.map((item) => item.id)).toEqual(["september"]);
    expect(saved["2026-10"]?.map((item) => item.id)).toEqual(["october"]);
  });

  it("同月迟到的旧版本响应不回退已保存的新版本", async () => {
    await storeMonth("2026-10", [row("same", "2026-10-01", 2)]);
    await storeMonth("2026-10", [row("same", "2026-10-01", 1)]);
    const saved = await readStoredMonths();
    expect(saved["2026-10"]?.[0]?.version).toBe(2);
    expect(saved["2026-10"]?.[0]?.amountCents).toBe(200);
  });

  it("下载等待本机标记期间新增的待同步原件，不被旧月快照覆盖", async () => {
    let started!: () => void;
    let finishMarks!: (value: unknown) => void;
    const readingMarks = new Promise<void>((resolve) => { started = resolve; });
    fixture.marksRead = () => { started(); return new Promise((resolve) => { finishMarks = resolve; }); };
    const download = storeMonth("2026-10", [row("remote", "2026-10-01")]);
    await readingMarks;
    const edit = upsertEntry(row("pending-new", "2026-10-02"));
    // 锁实现允许upsert排队；无锁旧实现也有机会在下载继续前提交，覆盖两种调度。
    await Promise.resolve();
    await Promise.resolve();
    finishMarks({ "pending-new": { pending: true } });
    await Promise.all([download, edit]);
    const saved = await readStoredMonths();
    expect(saved["2026-10"]?.map((item) => item.id).sort()).toEqual(["pending-new", "remote"]);
  });
});
