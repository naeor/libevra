/**
 * The local guest identity — the first half of "a guest is a real, persistent local user".
 *
 * ⚠️ **It lives in `localStorage`, and that is a startup decision, not a storage preference.**
 * The app has to decide between "formal account", "guest workspace" and "account entry" before it
 * paints a screen; a synchronous read is what makes that decision without a flash of the wrong
 * page. Ledger data does **not** live here (see `guest/storage.ts`); only identity flags do.
 *
 * ⚠️ **The key keeps the `libellum-` prefix on purpose.** The product was renamed Libevra
 * (1.10.20), but renaming a persistent key **orphans the data already stored under it** — the same
 * reason the IndexedDB database is still called `libellum`. This key is new in S14-B, so it starts
 * with the historical prefix deliberately, and must not be renamed without a migration.
 *
 * ⚠️ **A guest id is not a user id.** It is never sent to the server, never used as an account id,
 * and never passed to `setOfflineAccount`/the query cache. It only namespaces local guest data
 * (`guest:<id>:...`) inside the separate guest database.
 */

/** Where the identity is persisted. Renaming it abandons existing guest identities. */
export const GUEST_IDENTITY_STORAGE_KEY = "libellum-guest-identity";

/** Bumped only with a migration; an unknown version is treated as "no identity". */
export const GUEST_IDENTITY_SCHEMA_VERSION = 1;

export interface GuestIdentity {
  readonly id: string;
  readonly schemaVersion: typeof GUEST_IDENTITY_SCHEMA_VERSION;
  readonly createdAt: string;
  /**
   * `true` until the first workspace mount showed the light brand transition. Persisted so a
   * reload or a reopened browser does not replay the welcome.
   */
  readonly welcomePending: boolean;
  /** Whether the "guest data stays on this device" explanation has been dismissed. */
  readonly noticeAcknowledged: boolean;
  /** Last guest page, so reopening guest mode resumes there. Only guest paths are accepted. */
  readonly lastPath: string | null;
}

export type GuestIdentityPatch = Partial<
  Pick<GuestIdentity, "welcomePending" | "noticeAcknowledged" | "lastPath">
>;

/** The slice of `Storage` this module needs, so tests can supply a plain map. */
export interface GuestIdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): GuestIdentityStorage | null {
  try {
    const storage = globalThis.localStorage;
    return typeof storage === "undefined" ? null : storage;
  } catch {
    // A blocked/private storage throws on access. "No storage" is a supported state.
    return null;
  }
}

/** Guest ids are generated locally; keep the character set safe for key construction. */
const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Only guest-owned pages may be remembered or navigated to from an identity. */
export function isGuestPath(path: string | null | undefined): path is string {
  if (typeof path !== "string") return false;
  return /^\/guest(?:[/?]|$)/.test(path);
}

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();

  // Non-secure contexts have no randomUUID; this is only an identifier, not a credential.
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Parse and validate a stored identity. Invalid data is treated as absent, never repaired silently. */
export function parseGuestIdentity(raw: string | null): GuestIdentity | null {
  if (raw === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (candidate["schemaVersion"] !== GUEST_IDENTITY_SCHEMA_VERSION) return null;
  if (typeof candidate["id"] !== "string" || !GUEST_ID_PATTERN.test(candidate["id"])) return null;
  if (typeof candidate["createdAt"] !== "string" || Number.isNaN(Date.parse(candidate["createdAt"]))) {
    return null;
  }

  const lastPath = isGuestPath(candidate["lastPath"] as string | null)
    ? (candidate["lastPath"] as string)
    : null;

  return {
    id: candidate["id"],
    schemaVersion: GUEST_IDENTITY_SCHEMA_VERSION,
    createdAt: candidate["createdAt"],
    welcomePending: candidate["welcomePending"] === true,
    noticeAcknowledged: candidate["noticeAcknowledged"] === true,
    lastPath,
  };
}

/** The stored identity, synchronously. Used by startup routing before the first paint. */
export function readGuestIdentity(
  storage: GuestIdentityStorage | null = browserStorage(),
): GuestIdentity | null {
  if (storage === null) return null;

  try {
    return parseGuestIdentity(storage.getItem(GUEST_IDENTITY_STORAGE_KEY));
  } catch {
    return null;
  }
}

function persist(identity: GuestIdentity, storage: GuestIdentityStorage): boolean {
  try {
    storage.setItem(GUEST_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the guest identity, or return the existing one.
 *
 * ⚠️ **Idempotent on purpose.** Every guest entry point calls this; a second call must reopen the
 * same guest rather than manufacture a new one and strand the previous local ledger.
 *
 * Returns `null` when the browser refuses persistent storage — the caller shows an honest error
 * instead of pretending a guest exists that would vanish on reload.
 */
export function createGuestIdentity(
  storage: GuestIdentityStorage | null = browserStorage(),
  now: Date = new Date(),
): GuestIdentity | null {
  if (storage === null) return null;

  const existing = readGuestIdentity(storage);
  if (existing !== null) return existing;

  const identity: GuestIdentity = {
    id: randomId(),
    schemaVersion: GUEST_IDENTITY_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    welcomePending: true,
    noticeAcknowledged: false,
    lastPath: null,
  };

  return persist(identity, storage) ? identity : null;
}

/** Merge flags into the identity. Returns the updated identity, or `null` when nothing is stored. */
export function updateGuestIdentity(
  patch: GuestIdentityPatch,
  storage: GuestIdentityStorage | null = browserStorage(),
): GuestIdentity | null {
  if (storage === null) return null;

  const current = readGuestIdentity(storage);
  if (current === null) return null;

  const next: GuestIdentity = {
    ...current,
    ...patch,
    // A remembered path that is not a guest page is refused rather than trusted.
    lastPath:
      patch.lastPath === undefined
        ? current.lastPath
        : isGuestPath(patch.lastPath)
          ? patch.lastPath
          : null,
  };

  return persist(next, storage) ? next : null;
}

/** Forget the identity. Guest ledger data is cleared separately (see `guest/cleanup.ts`). */
export function clearGuestIdentity(
  storage: GuestIdentityStorage | null = browserStorage(),
): boolean {
  if (storage === null) return false;

  try {
    storage.removeItem(GUEST_IDENTITY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where "以游客身份继续" should go for this identity.
 *
 * A fresh guest has no remembered page; a returning one resumes its last guest page. The fallback
 * is always `/guest`, so a corrupted `lastPath` cannot navigate anywhere outside guest mode.
 */
export function guestEntryPath(identity: GuestIdentity | null): string {
  if (identity !== null && isGuestPath(identity.lastPath)) return identity.lastPath;

  return "/guest";
}

/**
 * Startup route for a visitor without a formal session.
 *
 * Pure, so the decision can be tested without a browser: formal account wins (handled by the
 * caller), then guest, then the account entry.
 */
export function guestOrLoginPath(identity: GuestIdentity | null): string {
  return identity === null ? "/login" : guestEntryPath(identity);
}
