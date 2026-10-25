/**
 * **Shared-ledger offline policy — one question, asked in one place.**
 *
 * The owner's decision (2026-10-17, S13-E):
 *
 * > *"个人账本保留当前离线记账、编辑、删除和同步能力。共享账本……离线时允许查看已经授权缓存的数据，
 * > 离线时不能新建、修改、删除账目。"*
 *
 * ⚠️ **Why this is a module-level store instead of a prop or a context.** The write decision is made
 * in `offline/write.ts`, which is not a React component — a queued offline write must be refused at
 * the moment it is attempted, not only where a screen happens to render a button. The ledger
 * metadata already tells the app whether the current ledger is shared; `useLedger` (the only place
 * that knows the current ledger) records it here, and both the write layer and the banner read it.
 *
 * ⚠️ **This state is about the *current* ledger only.** A target ledger in 账本设置 is read through
 * `useLedgerMeta` and never becomes current, so it never touches this store — exactly the isolation
 * that makes "管理另一本账" safe.
 *
 * ⚠️ **Existing unsynced marks are not deleted here.** This policy only refuses *new* offline
 * writes. Marks created before the upgrade are left alone: the owner's instruction was
 * *"默认保留、不自动丢弃"*, and the sync/conflict path already knows how to deliver or report them.
 */
import { useSyncExternalStore } from "react";

import { currentBookId, subscribeCurrentBook } from "../currentBook.js";
import { useGuestMode } from "../guest/session.js";
import { useAccountOffline } from "./connectivity.js";

/**
 * ⚠️ **Remembered per ledger, because "which ledger am I in" survives a reload while offline
 * and the membership count does not.** The server is the authority, but a cold offline start
 * cannot ask it; without a remembered flag a shared ledger would look personal after reload and
 * a new offline write would be queued — the exact "permanent red row the server refuses forever"
 * the policy exists to prevent.
 *
 * Keyed by book id (globally unique), so opening another ledger never inherits this one's answer.
 * `localStorage` rather than IndexedDB because the write layer needs a **synchronous** answer at
 * the moment a write is attempted; the async read at startup would be too late.
 */
import { sharedLedgerKey } from "../deviceStorageKeys.js";

let sharedLedger: boolean | null = null;
const listeners = new Set<() => void>();

function storageKey(bookId: string): string {
  return sharedLedgerKey(bookId);
}

function readStoredShared(bookId: string | null): boolean | null {
  if (bookId === null || typeof localStorage === "undefined") return null;

  try {
    const value = localStorage.getItem(storageKey(bookId));
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
}

function persistShared(bookId: string | null, value: boolean): void {
  if (bookId === null || typeof localStorage === "undefined") return;

  try {
    if (value) localStorage.setItem(storageKey(bookId), "1");
    else localStorage.removeItem(storageKey(bookId));
  } catch {
    /** Storage may be unavailable (private mode/quota); the in-memory answer still stands. */
  }
}

/** Called by `useLedger` after it learns the current ledger's member count. */
export function setSharedLedger(value: boolean, bookId: string | null = currentBookId()): void {
  persistShared(bookId, value);

  if (sharedLedger === value) return;

  sharedLedger = value;
  for (const listener of listeners) listener();
}

export function isSharedLedger(): boolean {
  if (sharedLedger === null) {
    sharedLedger = readStoredShared(currentBookId()) ?? false;
  }

  return sharedLedger;
}

export function sharedLedgerSnapshot(): boolean {
  return isSharedLedger();
}

export function subscribeSharedLedger(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A different current ledger has a different answer; forget the old one and let the lazy read
 * pick up that ledger's remembered flag. This also runs on sign-out (`forgetCurrentBook`), so a
 * shared answer cannot leak into the next account's session.
 */
subscribeCurrentBook(() => {
  sharedLedger = null;
});

/**
 * The pure rule, kept separate so tests can cover it without a DOM.
 *
 * Shared ledger + offline = read-only. Everything else keeps the old behaviour: personal ledgers
 * stay fully offline-capable, and shared ledgers stay writable while the server is reachable.
 */
export function isSharedLedgerOfflineReadOnly(shared: boolean, offline: boolean): boolean {
  return shared && offline;
}

/** Test-only reset; module-level state leaks between cases otherwise. */
export function resetSharedLedgerForTest(): void {
  sharedLedger = null;
  listeners.clear();
}

/**
 * The React view of the same rule, for buttons and banners.
 *
 * ⚠️ **It must read the same two facts the write layer reads** — the shared flag from this store and
 * the merged offline signal. A screen that computed "shared" from a different request could disagree
 * with the guard that actually refuses the write, which is how a button ends up enabled over a
 * guaranteed failure.
 */
export function useSharedLedgerOfflineReadOnly(): {
  readonly readOnly: boolean;
  readonly shared: boolean;
  readonly offline: boolean;
} {
  const guest = useGuestMode();
  const shared = useSyncExternalStore(subscribeSharedLedger, sharedLedgerSnapshot, () => false);
  const { offline } = useAccountOffline();

  /**
   * ⚠️ **A guest ledger is personal by construction**, so the shared-ledger offline rule cannot
   * apply to it. The account path is unchanged; this only prevents a stale account flag from
   * disabling the guest's own write buttons.
   */
  if (guest) return { readOnly: false, shared: false, offline: false };

  return { readOnly: isSharedLedgerOfflineReadOnly(shared, offline), shared, offline };
}
