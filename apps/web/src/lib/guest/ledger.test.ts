import { describe, expect, it } from "vitest";

import {
  GUEST_LEDGER_SCHEMA_VERSION,
  createDefaultGuestLedger,
  guestCurrentLedgerKey,
  guestLedgersKey,
  isGuestLedger,
  normalizeGuestLedgers,
} from "./ledger.js";
import { guestKey } from "./storage.js";

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
});
