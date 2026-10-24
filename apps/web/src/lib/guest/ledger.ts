/**
 * The minimal guest ledger registry.
 *
 * ⚠️ **Why a registry at all.** A formal account's ledger list comes from the server (`GET /books`);
 * the local database only caches responses by `bookId`. A guest has no server list, so the *local*
 * side must own the list itself: name, currency, creation time, and which one is current. This file
 * is that registry, and it is the extension point S14-C will attach transactions to.
 *
 * ⚠️ **Only structure is created here; no transactions and no fake entries.** S14-B's acceptance
 * explicitly rules out simulating a working bookkeeping system: an empty local ledger is created,
 * nothing pretends to have been recorded. Recording arrives with S14-C.
 */
import { guestKey, readGuestValue, writeGuestValue } from "./storage.js";

/** Bumped with a migration; unknown versions are ignored rather than reinterpreted. */
export const GUEST_LEDGER_SCHEMA_VERSION = 1;

export interface GuestLedger {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly schemaVersion: typeof GUEST_LEDGER_SCHEMA_VERSION;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const DEFAULT_GUEST_LEDGER_NAME = "我的本地账本"; // i18n-ignore：写进本机数据库的账本名（数据，可被导入正式账号），不是界面文字
export const DEFAULT_GUEST_CURRENCY = "CNY";

const LEDGERS_NAME = "ledgers";
const CURRENT_LEDGER_NAME = "current-ledger";

export function guestLedgersKey(guestId: string): string {
  return guestKey(guestId, LEDGERS_NAME);
}

export function guestCurrentLedgerKey(guestId: string): string {
  return guestKey(guestId, CURRENT_LEDGER_NAME);
}

/** Validate one stored ledger. A malformed entry is dropped, not rendered as broken data. */
export function isGuestLedger(value: unknown): value is GuestLedger {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  return (
    candidate["schemaVersion"] === GUEST_LEDGER_SCHEMA_VERSION &&
    typeof candidate["id"] === "string" &&
    /^[A-Za-z0-9_-]{4,80}$/.test(candidate["id"]) &&
    typeof candidate["name"] === "string" &&
    candidate["name"].length > 0 &&
    typeof candidate["currency"] === "string" &&
    candidate["currency"].length > 0 &&
    typeof candidate["createdAt"] === "string" &&
    typeof candidate["updatedAt"] === "string"
  );
}

/** Keep only valid ledgers; a corrupt list is a list with those entries missing. */
export function normalizeGuestLedgers(value: unknown): GuestLedger[] {
  if (!Array.isArray(value)) return [];

  return value.filter(isGuestLedger);
}

/** A fresh default ledger. Kept pure so tests and the workspace agree on the shape. */
export function createDefaultGuestLedger(now: Date = new Date()): GuestLedger {
  const stamp = now.toISOString();
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${String(now.getTime())}-${String(Math.floor(Math.random() * 1_000_000))}`;

  return {
    id: `guest-book-${suffix}`,
    name: DEFAULT_GUEST_LEDGER_NAME,
    currency: DEFAULT_GUEST_CURRENCY,
    schemaVersion: GUEST_LEDGER_SCHEMA_VERSION,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export async function readGuestLedgers(guestId: string): Promise<GuestLedger[]> {
  return normalizeGuestLedgers(await readGuestValue<unknown>(guestLedgersKey(guestId)));
}

export async function readCurrentGuestLedgerId(guestId: string): Promise<string | null> {
  const stored = await readGuestValue<unknown>(guestCurrentLedgerKey(guestId));
  return typeof stored === "string" && stored.length > 0 ? stored : null;
}

export interface GuestWorkspaceState {
  readonly ledgers: readonly GuestLedger[];
  readonly currentLedgerId: string;
}

/**
 * Read the guest workspace, creating the default local ledger on first use.
 *
 * ⚠️ **Idempotent and self-healing for the two harmless inconsistencies**: an empty list, or a
 * `current-ledger` that points at a ledger which no longer exists. Both are repaired to a valid
 * state on read. Nothing is deleted: a corrupt list is replaced by a fresh default only when no
 * valid ledger survives, and the old value is simply overwritten by the next write.
 *
 * Returns `null` when persistence fails, so the workspace can say so instead of showing a ledger
 * that would disappear on reload.
 */
export async function ensureGuestWorkspace(guestId: string): Promise<GuestWorkspaceState | null> {
  const existing = await readGuestLedgers(guestId);
  const storedCurrent = await readCurrentGuestLedgerId(guestId);

  if (existing.length > 0) {
    const current =
      storedCurrent !== null && existing.some((ledger) => ledger.id === storedCurrent)
        ? storedCurrent
        : existing[0]!.id;

    if (current !== storedCurrent) {
      const written = await writeGuestValue(guestCurrentLedgerKey(guestId), current);
      if (!written) return null;
    }

    return { ledgers: existing, currentLedgerId: current };
  }

  const ledger = createDefaultGuestLedger();
  const wroteLedgers = await writeGuestValue(guestLedgersKey(guestId), [ledger]);
  const wroteCurrent = await writeGuestValue(guestCurrentLedgerKey(guestId), ledger.id);

  if (!wroteLedgers || !wroteCurrent) return null;

  return { ledgers: [ledger], currentLedgerId: ledger.id };
}

/** Switch the current guest ledger. Reserved for S14-C's multi-ledger UI; validated here. */
export async function setCurrentGuestLedger(guestId: string, ledgerId: string): Promise<boolean> {
  const ledgers = await readGuestLedgers(guestId);
  if (!ledgers.some((ledger) => ledger.id === ledgerId)) return false;

  return writeGuestValue(guestCurrentLedgerKey(guestId), ledgerId);
}
