import { beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "@libellum/shared";

import { cardSizing } from "../statsWorkbench/composition.js";
import { cardSourceBook, isNativeCard, nativeKindOf, nativeOptions, newNativeCard, resolveBooks, withCardSource, withNativeOptions } from "../statsWorkbench/nativeCards.js";
import { documentsProblems } from "../statsWorkbench/storage.js";
import { dailySeries, mergeTotals, totalsByCurrency } from "./dashboardData.js";
import {
  adaptToBooks,
  dashboardStorageKey,
  defaultDashboardDocuments,
  findDashboardCard,
  followDefaultDashboard,
  isDefaultDashboard,
  legacyDashboardStorageKey,
  migrateLegacyDashboard,
  readDashboard,
  saveDashboard,
} from "./dashboardStore.js";

class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length(): number { return this.map.size; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

const owner = "user:u1";
const ledgerBooks = (documents: ReturnType<typeof defaultDashboardDocuments>): (string | undefined)[] =>
  documents.content.cards.filter((card) => nativeKindOf(card) === "ledger").map((card) => nativeOptions(card).bookId);

describe("总览卡片：编号、选项与尺寸", () => {
  it("DB- 编号是总览卡片，选项写在 chart.options.native，不进 analysis.params", () => {
    const card = newNativeCard("ledger", "x", { bookId: "a", metric: "income" });
    expect(isNativeCard(card)).toBe(true);
    expect(card.analysis.params).toEqual({});
    expect(nativeOptions(card)).toEqual({ bookId: "a", metric: "income" });
    expect(nativeOptions(withNativeOptions(card, { bookId: "b", showTrend: false }))).toEqual({ bookId: "b", showTrend: false });
  });
  it("格式不对的选项按缺省处理，不抛错", () => {
    const card = { ...newNativeCard("cross", "x"), chart: { chartFamily: "dashboard", options: { native: { books: [1, "b", ""], metric: "loss", showTrend: "yes" } } } };
    expect(nativeOptions(card)).toEqual({ books: ["b"] });
  });
  it("每种总览卡片有自己的可选尺寸（调整尺寸面板与布局约束都从这里取）", () => {
    const ledger = cardSizing(newNativeCard("ledger", "x"));
    expect(ledger.minSize).toEqual({ colSpan: 1, rowSpan: 1 });
    expect(ledger.sizes).toContainEqual({ colSpan: 4, rowSpan: 3 });
    expect(cardSizing(newNativeCard("trend", "y")).minSize).toEqual({ colSpan: 2, rowSpan: 1 });
  });
  it("分析卡片的来源账本：写入、读回、清除", () => {
    const card = { objectId: "c", type: "analysis-card" as const, analysis: { analysisId: "AN-I01", params: {} }, chart: { chartFamily: "donut" }, rangePolicy: "inherit" as const };
    expect(cardSourceBook(card)).toBeNull();
    const pinned = withCardSource(card, "b");
    expect(cardSourceBook(pinned)).toBe("b");
    expect(withCardSource(pinned, null).chart).toEqual({ chartFamily: "donut" });
  });
  it("多账本范围：不在总览里的账本去掉；全部去掉时按全部账本", () => {
    expect(resolveBooks(undefined, ["a", "b"])).toEqual(["a", "b"]);
    expect(resolveBooks(["b", "z"], ["a", "b"])).toEqual(["b"]);
    expect(resolveBooks(["z"], ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("默认总览", () => {
  it("一本账：账本卡片 + 最近账目 + 趋势 + 待处理；多本账：每本一张账本卡片 + 多账本收支", () => {
    const single = defaultDashboardDocuments(["a"]);
    expect(single.content.cards.map((card) => nativeKindOf(card))).toEqual(["ledger", "recent", "trend", "pending"]);
    const multi = defaultDashboardDocuments(["a", "b", "c"]);
    expect(ledgerBooks(multi)).toEqual(["a", "b", "c"]);
    expect(multi.content.cards.some((card) => nativeKindOf(card) === "cross")).toBe(true);
    expect(documentsProblems(single)).toEqual([]);
    expect(documentsProblems(multi)).toEqual([]);
  });
  it("对象 id 固定：同样的账本生成同样的文档，能认出「还是默认」", () => {
    expect(isDefaultDashboard(defaultDashboardDocuments(["a", "b"]), ["a", "b"])).toBe(true);
    expect(isDefaultDashboard(defaultDashboardDocuments(["a"]), ["a", "b"])).toBe(false);
  });
});

describe("读取与保存", () => {
  it("没保存过：显示默认总览，版本 0", () => {
    const stored = readDashboard(owner, ["a"]);
    expect(stored.version).toBe(0);
    expect(stored.unreadable).toBe(false);
    expect(ledgerBooks(stored.documents)).toEqual(["a"]);
  });
  it("保存后读回；另一窗口先保存过（版本不同）就不覆盖", () => {
    const documents = defaultDashboardDocuments(["a", "b"]);
    expect(saveDashboard(owner, documents, 0, ["a", "b"])).toBe(1);
    expect(readDashboard(owner, ["a", "b"]).version).toBe(1);
    expect(saveDashboard(owner, documents, 0, ["a", "b"])).toBeNull();
    expect(saveDashboard(owner, documents, 1, ["a", "b"])).toBe(2);
  });
  it("跟随默认：删掉自己的记录、留下上一份，版本回到 0", () => {
    saveDashboard(owner, defaultDashboardDocuments(["a"]), 0, ["a"]);
    expect(followDefaultDashboard(owner, 1)).toBe(0);
    expect(localStorage.getItem(dashboardStorageKey(owner))).toBeNull();
    expect(localStorage.getItem(`${dashboardStorageKey(owner)}:previous`)).not.toBeNull();
  });
  it("不合法的文档拒绝保存，原记录不动", () => {
    saveDashboard(owner, defaultDashboardDocuments(["a"]), 0, ["a"]);
    const before = localStorage.getItem(dashboardStorageKey(owner));
    const broken = defaultDashboardDocuments(["a"]);
    // 所有对象挤在同一格：几何重叠，D 的校验拒绝。
    const overlapping = broken.layout.main.objects.map((object) => ({ ...object, anchor: 1 }));
    expect(saveDashboard(owner, { ...broken, layout: { ...broken.layout, main: { ...broken.layout.main, objects: overlapping } } }, 1, ["a"])).toBeNull();
    expect(localStorage.getItem(dashboardStorageKey(owner))).toBe(before);
  });
  it("账本变化只在读取时派生：新账本补一张账本卡片，已不在的账本的卡片不显示；保存的记录不变", () => {
    saveDashboard(owner, defaultDashboardDocuments(["a", "b"]), 0, ["a", "b"]);
    const raw = localStorage.getItem(dashboardStorageKey(owner));
    const shown = readDashboard(owner, ["a", "c"]).documents;
    expect(ledgerBooks(shown)).toEqual(["a", "c"]);
    expect(documentsProblems(shown)).toEqual([]);
    expect(localStorage.getItem(dashboardStorageKey(owner))).toBe(raw);
  });
  it("用户删掉的账本卡片不会因为「已知账本」又被补回来", () => {
    const documents = defaultDashboardDocuments(["a", "b"]);
    const withoutB = adaptToBooks(documents, ["a"], ["a", "b"]);
    expect(ledgerBooks(adaptToBooks(withoutB, ["a", "b"], ["a", "b"]))).toEqual(["a"]);
  });
  it("找得到保存过的分析卡片（分析页右侧辅助栏打开它）", () => {
    const documents = defaultDashboardDocuments(["a"]);
    saveDashboard(owner, documents, 0, ["a"]);
    expect(findDashboardCard(owner, "dash-recent")?.objectId).toBe("dash-recent");
    expect(findDashboardCard(owner, "nope")).toBeUndefined();
  });
});

describe("旧版总览配置（1.18.12–1.19.99）的迁移", () => {
  const legacy = {
    version: 1,
    crossScope: ["b"],
    cards: [
      { id: "ledger:a", kind: "ledger", size: "standard", bookId: "a", metric: "income", showTrend: false },
      { id: "ledger:b", kind: "ledger", size: "compact", bookId: "b" },
      { id: "cross", kind: "cross", size: "standard" },
      { id: "quick", kind: "quick", size: "standard" },
      { id: "recent", kind: "recent", size: "expanded", hidden: true },
      { id: "trend", kind: "trend", size: "expanded" },
      { id: "pending", kind: "pending", size: "compact" },
    ],
  };
  it("卡片、选项与范围照搬；隐藏的卡片与快捷操作不进网格；文档合法", () => {
    const documents = migrateLegacyDashboard(legacy, ["a", "b"])!;
    expect(documents).not.toBeNull();
    expect(documentsProblems(documents)).toEqual([]);
    const byId = new Map(documents.content.cards.map((card) => [card.objectId, card]));
    expect(nativeOptions(byId.get("ledger:a")!)).toEqual({ bookId: "a", metric: "income", showTrend: false });
    expect(nativeOptions(byId.get("cross")!)).toEqual({ books: ["b"] });
    expect(byId.has("quick")).toBe(false);
    expect(byId.has("recent")).toBe(false);
    expect(byId.has("trend")).toBe(true);
  });
  it("第一次读取时自动转换并写入新记录，旧记录原样保留", () => {
    const raw = JSON.stringify(legacy);
    localStorage.setItem(legacyDashboardStorageKey(owner), raw);
    const stored = readDashboard(owner, ["a", "b"]);
    expect(stored.version).toBe(1);
    expect(stored.documents.content.cards.some((card) => card.objectId === "ledger:a")).toBe(true);
    expect(localStorage.getItem(legacyDashboardStorageKey(owner))).toBe(raw);
  });
  it("损坏的旧配置：当作没保存过，显示默认总览", () => {
    localStorage.setItem(legacyDashboardStorageKey(owner), "{broken");
    expect(readDashboard(owner, ["a"]).version).toBe(0);
  });
});

function entry(partial: Partial<Transaction> & Pick<Transaction, "kind" | "amountCents" | "currency" | "occurredLocalDate">): Transaction {
  return { id: `${partial.occurredLocalDate}-${String(partial.amountCents)}`, ...partial } as Transaction;
}

describe("总览金额汇总", () => {
  const range = { from: "2026-11-01", to: "2026-11-30" };
  const entries = [
    entry({ kind: "expense", amountCents: 1000, currency: "CNY", occurredLocalDate: "2026-11-02" }),
    entry({ kind: "income", amountCents: 5000, currency: "CNY", occurredLocalDate: "2026-11-03" }),
    entry({ kind: "expense", amountCents: 700, currency: "USD", occurredLocalDate: "2026-11-03" }),
    entry({ kind: "expense", amountCents: 9999, currency: "CNY", occurredLocalDate: "2026-10-31" }),
  ];
  it("按币种分别合计，只算范围内，主币种在前", () => {
    expect(totalsByCurrency(entries, range, "CNY")).toEqual([
      { currency: "CNY", expense: 1000, income: 5000, balance: 4000, count: 2 },
      { currency: "USD", expense: 700, income: 0, balance: -700, count: 1 },
    ]);
  });
  it("几本账按币种相加（不折算）", () => {
    const a = totalsByCurrency(entries, range, "CNY");
    expect(mergeTotals([a, a], "CNY")[0]).toEqual({ currency: "CNY", expense: 2000, income: 10000, balance: 8000, count: 4 });
  });
  it("每日序列：一个月 30 天，首尾都在范围内", () => {
    const series = dailySeries(entries, range, "CNY");
    expect(series).toHaveLength(30);
    expect(series[0]).toEqual({ date: "2026-11-01", value: 0 });
    expect(series[1]).toEqual({ date: "2026-11-02", value: 1000 });
    expect(series.at(-1)?.date).toBe("2026-11-30");
  });
});
