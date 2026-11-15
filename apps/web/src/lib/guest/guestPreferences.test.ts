import { describe, expect, it } from "vitest";

import { detailCardsStorageKey } from "../detailCards.js";
import { clearOwnerPreferences } from "../deviceStorageKeys.js";
import { ledgerFilterKey } from "../ledgerFilter.js";

/**
 * 游客多账本：按账本存的本机偏好（展示卡片、明细 / 分析筛选）与正式账号一样按“身份 : 账本”分开；
 * 新的键都带游客 id，“清除游客数据”（`clearOwnerPreferences` 的 guest 分支）一次清掉这位游客全部账本的偏好，
 * 不碰别的游客、也不碰正式账号。
 */

class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()].sort();
  }
}

const GUEST = "guest-prefs-0001";
const OTHER = "guest-prefs-0002";

describe("游客多账本的本机偏好", () => {
  it("展示卡片与筛选按游客账本分键", () => {
    expect(detailCardsStorageKey(GUEST, "guest-book-a")).not.toBe(detailCardsStorageKey(GUEST, "guest-book-b"));
    expect(detailCardsStorageKey(GUEST, null)).toBe(`libevra.detail-cards.v2.${GUEST}.local`);
    expect(ledgerFilterKey("ledger", `guest:${GUEST}`, "guest-book-a")).not.toBe(
      ledgerFilterKey("ledger", `guest:${GUEST}`, "guest-book-b"),
    );
  });

  it("清除游客数据：这位游客每本账的偏好都清掉，别的游客与正式账号的不动", () => {
    const store = new MemoryStorage();
    const mine = [
      detailCardsStorageKey(GUEST, "guest-book-a"),
      detailCardsStorageKey(GUEST, "guest-book-b"),
      detailCardsStorageKey(GUEST, null),
      ledgerFilterKey("ledger", `guest:${GUEST}`, "guest-book-a"),
      ledgerFilterKey("analysis", `guest:${GUEST}`, "guest-book-b"),
    ];
    const kept = [
      detailCardsStorageKey(OTHER, "guest-book-c"),
      ledgerFilterKey("ledger", `guest:${OTHER}`, "guest-book-c"),
      detailCardsStorageKey("user-1", "book-1"),
      ledgerFilterKey("ledger", "user:user-1", "book-1"),
    ];
    for (const key of [...mine, ...kept]) store.setItem(key, "{}");

    clearOwnerPreferences("guest", GUEST, store as unknown as Storage);
    expect(store.keys()).toEqual([...kept].sort());
  });
});
