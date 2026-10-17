import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isSharedLedger,
  isSharedLedgerOfflineReadOnly,
  resetSharedLedgerForTest,
  setSharedLedger,
  sharedLedgerSnapshot,
  subscribeSharedLedger,
} from "./writePolicy.js";

/**
 * The policy itself is one pure expression, but the store matters too: the write layer reads the
 * synchronous snapshot, and the banner subscribes to the same value. A test on only the expression
 * would miss a store that never notifies.
 */
describe("shared-ledger offline write policy", () => {
  afterEach(() => {
    resetSharedLedgerForTest();
  });

  it("is read-only only when the ledger is shared and the account is offline", () => {
    expect(isSharedLedgerOfflineReadOnly(true, true)).toBe(true);
    expect(isSharedLedgerOfflineReadOnly(true, false)).toBe(false);
    expect(isSharedLedgerOfflineReadOnly(false, true)).toBe(false);
    expect(isSharedLedgerOfflineReadOnly(false, false)).toBe(false);
  });

  it("records the current ledger's shared flag and notifies subscribers once per change", () => {
    const listener = vi.fn();
    subscribeSharedLedger(listener);

    setSharedLedger(true);
    expect(isSharedLedger()).toBe(true);
    expect(sharedLedgerSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    /** ⚠️ Same value again must not cause a second render in every subscriber. */
    setSharedLedger(true);
    expect(listener).toHaveBeenCalledTimes(1);

    setSharedLedger(false);
    expect(isSharedLedger()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSharedLedger(listener);
    unsubscribe();

    setSharedLedger(true);

    expect(listener).not.toHaveBeenCalled();
    expect(isSharedLedger()).toBe(true);
  });
});
