import { describe, expect, it } from "vitest";

import {
  GUEST_LEDGER_SCHEMA_VERSION,
  createDefaultGuestLedger,
  guestCurrentLedgerKey,
  guestLedgersKey,
  isArchivedGuestLedger,
  isGuestLedger,
  newGuestLedgerId,
  nextGuestSortOrder,
  normalizeGuestLedgers,
  orderGuestLedgers,
} from "./ledger.js";
import { guestBookKey, guestKey } from "./storage.js";

/**
 * The guest ledger registry is storage-backed, so only its pure shape rules are tested here; the
 * browser suite covers the actual create-on-first-use flow against real IndexedDB.
 */
describe("guestKey", () => {
  it("namespaces guest data and validates both halves", () => {
    expect(guestKey("guest-0123456789abcdef", "ledgers")).toBe(
      "guest:guest-0123456789abcdef:ledgers",
    );
    expect(() => guestKey("bad id with spaces", "ledgers")).toThrow();
    expect(() => guestKey("guest-0123456789abcdef", "Bad Name")).toThrow();
  });

  it("每本账的键：guest:<游客id>:<name>:<账本id>，账本 id 也要校验（不能带冒号）", () => {
    expect(guestBookKey("guest-0123456789abcdef", "data", "guest-book-1234")).toBe(
      "guest:guest-0123456789abcdef:data:guest-book-1234",
    );
    expect(() => guestBookKey("guest-0123456789abcdef", "data", "a:b")).toThrow();
    expect(() => guestBookKey("guest-0123456789abcdef", "data", "")).toThrow();
  });

  it("never produces a key shaped like a formal account scope", () => {
    const key = guestKey("guest-0123456789abcdef", "ledgers");
    expect(key.startsWith("guest:")).toBe(true);
    expect(key).not.toMatch(/^[0-9a-f-]{36}:/);
    expect(guestLedgersKey("guest-0123456789abcdef")).toBe(key);
    expect(guestCurrentLedgerKey("guest-0123456789abcdef")).toContain("current-ledger");
  });
});

describe("guest ledger shape", () => {
  it("creates a default local ledger with no transactions", () => {
    const ledger = createDefaultGuestLedger(new Date("2026-10-18T12:00:00.000Z"));

    expect(ledger.id.startsWith("guest-book-")).toBe(true);
    expect(ledger.name).toBe("我的本地账本");
    expect(ledger.currency).toBe("CNY");
    expect(ledger.schemaVersion).toBe(GUEST_LEDGER_SCHEMA_VERSION);
    expect(ledger.createdAt).toBe("2026-10-18T12:00:00.000Z");
  });

  it("accepts a valid stored ledger and rejects malformed entries", () => {
    const ledger = createDefaultGuestLedger();

    expect(isGuestLedger(ledger)).toBe(true);
    expect(isGuestLedger({ ...ledger, schemaVersion: 99 })).toBe(false);
    expect(isGuestLedger({ ...ledger, id: "" })).toBe(false);
    expect(isGuestLedger({ ...ledger, name: "" })).toBe(false);
    expect(isGuestLedger(null)).toBe(false);
  });

  it("drops only the invalid entries from a stored list", () => {
    const good = createDefaultGuestLedger();
    const normalized = normalizeGuestLedgers([good, { nope: true }, "string", { ...good, id: "other-ledger" }]);

    expect(normalized).toHaveLength(2);
    expect(normalized[0]?.id).toBe(good.id);
  });

  it("treats a non-array value as an empty list rather than crashing", () => {
    expect(normalizeGuestLedgers(undefined)).toEqual([]);
    expect(normalizeGuestLedgers({ ledgers: [] })).toEqual([]);
  });

  it("游客多账本：重复的 id 只留第一条；可选字段（归档、排序、迁入时间）认得就保留", () => {
    const good = createDefaultGuestLedger();
    const normalized = normalizeGuestLedgers([
      { ...good, archivedAt: "2026-11-01T00:00:00.000Z", sortOrder: 3, migratedAt: "2026-11-02T00:00:00.000Z" },
      { ...good, name: "重复" },
    ]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ archivedAt: "2026-11-01T00:00:00.000Z", sortOrder: 3, migratedAt: "2026-11-02T00:00:00.000Z" });
    expect(isArchivedGuestLedger(normalized[0]!)).toBe(true);
    expect(isArchivedGuestLedger(good)).toBe(false);
  });

  it("列表顺序：sortOrder 小的在前，旧条目按数组位置；新账本排最后", () => {
    const a = { ...createDefaultGuestLedger(new Date("2026-10-01T00:00:00.000Z")), id: "guest-book-a" };
    const b = { ...createDefaultGuestLedger(new Date("2026-10-02T00:00:00.000Z")), id: "guest-book-b", sortOrder: 5 };
    const c = { ...createDefaultGuestLedger(new Date("2026-10-03T00:00:00.000Z")), id: "guest-book-c", sortOrder: -1 };
    expect(orderGuestLedgers([a, b, c]).map((ledger) => ledger.id)).toEqual(["guest-book-c", "guest-book-a", "guest-book-b"]);
    expect(nextGuestSortOrder([a, b, c])).toBe(6);
    expect(nextGuestSortOrder([])).toBe(0);
  });

  it("新账本 id 永远是 guest-book-<uuid>，长度不超过服务器状态键的上限", () => {
    const id = newGuestLedgerId();
    expect(id).toMatch(/^guest-book-[0-9a-f-]{36}$/);
    expect(id.length).toBeLessThanOrEqual(58);
  });
});
