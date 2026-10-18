import { describe, expect, it } from "vitest";

import {
  GUEST_IDENTITY_STORAGE_KEY,
  clearGuestIdentity,
  createGuestIdentity,
  guestEntryPath,
  guestOrLoginPath,
  isGuestPath,
  parseGuestIdentity,
  readGuestIdentity,
  updateGuestIdentity,
  type GuestIdentity,
  type GuestIdentityStorage,
} from "./identity.js";

/**
 * The guest identity is the thing that decides which screen opens on launch, so its parse/update
 * rules are tested as plain functions — no browser, no IndexedDB, no React.
 */
function memoryStorage(): GuestIdentityStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const VALID: GuestIdentity = {
  id: "guest-0123456789abcdef",
  schemaVersion: 1,
  createdAt: "2026-10-18T12:00:00.000Z",
  welcomePending: false,
  noticeAcknowledged: true,
  lastPath: "/guest",
};

describe("parseGuestIdentity", () => {
  it("accepts a valid identity", () => {
    expect(parseGuestIdentity(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("treats malformed JSON, wrong versions and bad ids as absent", () => {
    expect(parseGuestIdentity("{")).toBeNull();
    expect(parseGuestIdentity(JSON.stringify({ ...VALID, schemaVersion: 2 }))).toBeNull();
    expect(parseGuestIdentity(JSON.stringify({ ...VALID, id: "short" }))).toBeNull();
    expect(parseGuestIdentity(JSON.stringify({ ...VALID, id: "has:colon-and-is-long" }))).toBeNull();
    expect(parseGuestIdentity(JSON.stringify({ ...VALID, createdAt: "not-a-date" }))).toBeNull();
  });

  it("refuses a remembered path outside guest mode", () => {
    const parsed = parseGuestIdentity(JSON.stringify({ ...VALID, lastPath: "/settings" }));
    expect(parsed?.lastPath).toBeNull();
  });
});

describe("createGuestIdentity", () => {
  it("creates once and reuses the same guest on every later call", () => {
    const storage = memoryStorage();

    const first = createGuestIdentity(storage, new Date("2026-10-18T12:00:00.000Z"));
    const second = createGuestIdentity(storage);

    expect(first).not.toBeNull();
    expect(second?.id).toBe(first?.id);
    expect(first?.welcomePending).toBe(true);
    expect(storage.values.get(GUEST_IDENTITY_STORAGE_KEY)).toBeDefined();
  });

  it("returns null rather than pretending persistence worked", () => {
    const blocked: GuestIdentityStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };

    expect(createGuestIdentity(blocked)).toBeNull();
    expect(createGuestIdentity(null)).toBeNull();
  });
});

describe("updateGuestIdentity", () => {
  it("updates flags while keeping the id and creation time", () => {
    const storage = memoryStorage();
    createGuestIdentity(storage, new Date("2026-10-18T12:00:00.000Z"));

    const updated = updateGuestIdentity({ welcomePending: false, noticeAcknowledged: true }, storage);

    expect(updated?.welcomePending).toBe(false);
    expect(updated?.noticeAcknowledged).toBe(true);
    expect(updated?.id).toBe(readGuestIdentity(storage)?.id);
    expect(updated?.createdAt).toBe("2026-10-18T12:00:00.000Z");
  });

  it("sanitises an unsafe remembered path instead of storing it", () => {
    const storage = memoryStorage();
    createGuestIdentity(storage);

    const updated = updateGuestIdentity({ lastPath: "/settings" }, storage);

    expect(updated?.lastPath).toBeNull();
  });

  it("does nothing when there is no identity", () => {
    expect(updateGuestIdentity({ noticeAcknowledged: true }, memoryStorage())).toBeNull();
  });
});

describe("guest navigation", () => {
  it("opens the remembered guest page, and only a guest page", () => {
    expect(guestEntryPath({ ...VALID, lastPath: "/guest/books/one" })).toBe("/guest/books/one");
    expect(guestEntryPath({ ...VALID, lastPath: null })).toBe("/guest");
    expect(guestEntryPath(null)).toBe("/guest");
  });

  it("falls back to the login screen only when no guest identity exists", () => {
    expect(guestOrLoginPath(null)).toBe("/login");
    expect(guestOrLoginPath({ ...VALID, lastPath: "/guest" })).toBe("/guest");
  });

  it("recognises guest paths and rejects everything else", () => {
    expect(isGuestPath("/guest")).toBe(true);
    expect(isGuestPath("/guest/ledger")).toBe(true);
    expect(isGuestPath("/guest?x=1")).toBe(true);
    expect(isGuestPath("/guestish")).toBe(false);
    expect(isGuestPath("/login")).toBe(false);
    expect(isGuestPath(null)).toBe(false);
  });
});

describe("clearGuestIdentity", () => {
  it("removes only the guest identity key", () => {
    const storage = memoryStorage();
    storage.setItem("libellum-session-adjacent", "keep me");
    createGuestIdentity(storage);

    expect(clearGuestIdentity(storage)).toBe(true);
    expect(readGuestIdentity(storage)).toBeNull();
    expect(storage.values.get("libellum-session-adjacent")).toBe("keep me");
  });
});
