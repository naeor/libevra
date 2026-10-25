import { describe, expect, it } from "vitest";

import {
  CURRENT_BOOK_KEY,
  LIBELLUM_KEY_PREFIX,
  LIBEVRA_KEY_PREFIX,
  isAppDeviceStorageKey,
  messagesSeenKey,
  presentationSeenKey,
  sharedLedgerKey,
} from "./deviceStorageKeys.js";

describe("device storage key helpers", () => {
  it("keeps the historical formats so existing device data is still found", () => {
    expect(messagesSeenKey("book-1")).toBe("libellum-messages-seen:book-1");
    expect(presentationSeenKey("user-1")).toBe("libellum-presentation-seen:user-1");
    expect(sharedLedgerKey("book-1")).toBe("libellum:shared-ledger:book-1");
  });

  it("sweeps both brand prefixes and the pre-brand current-book key", () => {
    expect(LIBELLUM_KEY_PREFIX).toBe("libellum");
    expect(LIBEVRA_KEY_PREFIX).toBe("libevra.");
    expect(CURRENT_BOOK_KEY).toBe("current-book");

    expect(isAppDeviceStorageKey("libellum-guest-identity")).toBe(true);
    expect(isAppDeviceStorageKey("libellum.duplicate-detection.v1.guest")).toBe(true);
    expect(isAppDeviceStorageKey("libellum:shared-ledger:book-1")).toBe(true);
    expect(isAppDeviceStorageKey("libevra.language")).toBe(true);
    expect(isAppDeviceStorageKey("libevra.theme")).toBe(true);
    expect(isAppDeviceStorageKey("current-book")).toBe(true);
  });

  it("leaves keys owned by anything else alone", () => {
    expect(isAppDeviceStorageKey("")).toBe(false);
    expect(isAppDeviceStorageKey("libelle")).toBe(false);
    expect(isAppDeviceStorageKey("libevr")).toBe(false);
    expect(isAppDeviceStorageKey("current-bookmark")).toBe(false);
    expect(isAppDeviceStorageKey("other-app.session")).toBe(false);
  });
});
