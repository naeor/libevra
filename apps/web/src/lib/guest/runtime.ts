/**
 * Which guest identity the current screen is running as.
 *
 * ⚠️ **A module-level value, not React state, because write functions are not components.** The
 * ledger's offline write path (`offline/write.ts`) is called from event handlers, and it has no way
 * to read a React context; it needs a synchronous answer to "is this a guest write or an account
 * write". A wrong answer would be the worst outcome in this feature — account data and guest data
 * must never be written through each other's path — so the value is set in exactly one place
 * (`DataModeSync`, rendered inside `AuthProvider`) and is derived from the same source the route
 * guard uses: a signed-out session plus a persisted guest identity.
 *
 * ⚠️ **It is set during render, deliberately.** `DataModeSync` runs before its siblings' children
 * render, so the first screen after a guest login already sees guest mode; an effect would be one
 * frame too late and could let a query start against the account store. The setter is idempotent
 * and only writes a string, so StrictMode's double render is harmless.
 */
let guestId: string | null = null;

export function setGuestRuntimeId(id: string | null): void {
  guestId = id;
}

/** The guest identity this page tree is using, or `null` for the account path / signed-out entry. */
export function guestRuntimeId(): string | null {
  return guestId;
}

export function isGuestRuntime(): boolean {
  return guestId !== null;
}

/**
 * A one-slot notification for "the guest store changed".
 *
 * ⚠️ **The write path cannot import React Query**, and it should not learn about it. It knows one
 * fact — the guest data changed — and the query layer installs the listener that turns that into
 * invalidation. The same idea as `installQueryNotifier` in the account write path, for the same
 * reason: a subscriber that imported the writer would be a cycle.
 */
let guestWriteListener: (() => void) | null = null;

export function installGuestWriteListener(listener: (() => void) | null): void {
  guestWriteListener = listener;
}

export function notifyGuestWrite(): void {
  guestWriteListener?.();
}
