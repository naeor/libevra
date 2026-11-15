/**
 * The guest ledger registry.
 *
 * ⚠️ **Why a registry at all.** A formal account's ledger list comes from the server (`GET /books`);
 * the local database only caches responses by `bookId`. A guest has no server list, so the *local*
 * side must own the list itself: name, currency, creation time, and which one is current. This file
 * is that registry.
 *
 * 游客多账本（第二批）：注册表现在是游客账本列表的唯一来源——每本账的名称、币种、归档状态、排序、
 * 最近一次迁入正式账号的时间都记在这里；每本账的数据是另一个键（`workspace.ts` 的
 * `guest:<游客id>:data:<账本id>`），当前账本仍是 `current-ledger` 键。
 *
 * ⚠️ **存储格式仍是数组、`schemaVersion` 仍是 1，新字段都是可选的。** 这样旧版本页面（例如另一个还没
 * 刷新的标签页）读到新注册表也能照常认出每一本账，不会因为“版本不认识”就当成没有账本、再造一本新的。
 * 新字段的类型不对时只丢掉那个字段，不丢掉整本账——一本账从列表里消失，用户就再也找不到它的数据。
 */
import { guestKey, readGuestValueResult, updateGuestValue } from "./storage.js";

/** Bumped with a migration; unknown versions are ignored rather than reinterpreted. */
export const GUEST_LEDGER_SCHEMA_VERSION = 1;

export interface GuestLedger {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly schemaVersion: typeof GUEST_LEDGER_SCHEMA_VERSION;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** 归档时间；未归档为 `null` 或缺省。归档的账本不在常用列表里，也不能作为当前账本。 */
  readonly archivedAt?: string | null;
  /** 列表顺序（小的在前）。旧数据没有这个字段，按它在数组里的位置排。 */
  readonly sortOrder?: number;
  /** 最近一次成功迁入正式账号的时间（本机记录，只用于在账本导入页把迁过的标出来）。 */
  readonly migratedAt?: string | null;
}

export const DEFAULT_GUEST_LEDGER_NAME = "我的本地账本"; // i18n-ignore：写进本机数据库的账本名（数据，可被导入正式账号），不是界面文字
export const DEFAULT_GUEST_CURRENCY = "CNY";
/** 账本名称的长度上限，与正式账号（服务器 1–40 字）一致。 */
export const GUEST_LEDGER_NAME_MAX = 40;
/**
 * 一个游客最多能有几本账（含已归档）。⚠️ 需所有者确认：正式账号没有本数上限（只有存储配额），游客数据
 * 全在浏览器里、每本账一个 blob，先定一个不会撑满配额的数。
 */
export const MAX_GUEST_LEDGERS = 20;

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

/** 只保留认得的可选字段；类型不对的可选字段丢掉，账本本身保留（见文件头）。 */
function sanitizeGuestLedger(ledger: GuestLedger): GuestLedger {
  const raw = ledger as unknown as Record<string, unknown>;
  const archivedAt = raw["archivedAt"];
  const sortOrder = raw["sortOrder"];
  const migratedAt = raw["migratedAt"];
  return {
    id: ledger.id,
    name: ledger.name,
    currency: ledger.currency,
    schemaVersion: GUEST_LEDGER_SCHEMA_VERSION,
    createdAt: ledger.createdAt,
    updatedAt: ledger.updatedAt,
    ...(typeof archivedAt === "string" && archivedAt.length > 0 ? { archivedAt } : {}),
    ...(typeof sortOrder === "number" && Number.isFinite(sortOrder) ? { sortOrder } : {}),
    ...(typeof migratedAt === "string" && migratedAt.length > 0 ? { migratedAt } : {}),
  };
}

/** Keep only valid ledgers; a corrupt list is a list with those entries missing. Duplicate ids keep the first. */
export function normalizeGuestLedgers(value: unknown): GuestLedger[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const ledgers: GuestLedger[] = [];
  for (const entry of value) {
    if (!isGuestLedger(entry) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    ledgers.push(sanitizeGuestLedger(entry));
  }
  return ledgers;
}

export function isArchivedGuestLedger(ledger: GuestLedger): boolean {
  return typeof ledger.archivedAt === "string" && ledger.archivedAt.length > 0;
}

/**
 * 列表顺序：`sortOrder` 小的在前；没有 `sortOrder` 的旧条目用它在数组里的位置；再相同按创建时间。
 * 稳定排序，返回新数组。
 */
export function orderGuestLedgers(ledgers: readonly GuestLedger[]): GuestLedger[] {
  return ledgers
    .map((ledger, index) => ({ ledger, index, order: ledger.sortOrder ?? index }))
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      if (left.ledger.createdAt !== right.ledger.createdAt) return left.ledger.createdAt.localeCompare(right.ledger.createdAt);
      return left.index - right.index;
    })
    .map((item) => item.ledger);
}

/** 新账本排在最后。 */
export function nextGuestSortOrder(ledgers: readonly GuestLedger[]): number {
  return ledgers.reduce((max, ledger, index) => Math.max(max, (ledger.sortOrder ?? index) + 1), 0);
}

/** A fresh ledger id, always `guest-book-<uuid>` — the server uses it as the import state key. */
export function newGuestLedgerId(now: Date = new Date()): string {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${String(now.getTime())}-${String(Math.floor(Math.random() * 1_000_000))}`;
  return `guest-book-${suffix}`;
}

/** A fresh default ledger. Kept pure so tests and the workspace agree on the shape. */
export function createDefaultGuestLedger(now: Date = new Date()): GuestLedger {
  const stamp = now.toISOString();

  return {
    id: newGuestLedgerId(now),
    name: DEFAULT_GUEST_LEDGER_NAME,
    currency: DEFAULT_GUEST_CURRENCY,
    schemaVersion: GUEST_LEDGER_SCHEMA_VERSION,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export async function readGuestLedgers(guestId: string): Promise<GuestLedger[]> {
  const result = await readGuestLedgersResult(guestId);
  return result.ok ? result.ledgers : [];
}

/** 读注册表，并把“读失败”与“没有注册表”分开（读失败时绝不能当成没有账本再去新建）。 */
export async function readGuestLedgersResult(
  guestId: string,
): Promise<{ readonly ok: true; readonly ledgers: GuestLedger[] } | { readonly ok: false }> {
  const result = await readGuestValueResult<unknown>(guestLedgersKey(guestId));
  return result.ok ? { ok: true, ledgers: normalizeGuestLedgers(result.value) } : { ok: false };
}

/**
 * 原子地改注册表：`change` 拿到当前（已校验的）列表，返回新列表或 `undefined`（不写）。必须是同步函数。
 *
 * ⚠️ 注册表里认不出的条目在这里会被丢掉——但只有确实要写的时候才会写回，而认不出的条目本来也不会显示、
 * 不会被读到；它对应的数据键不受影响。
 */
export async function updateGuestLedgers(
  guestId: string,
  change: (ledgers: GuestLedger[]) => GuestLedger[] | undefined,
): Promise<{ readonly ok: boolean; readonly ledgers: GuestLedger[] }> {
  const result = await updateGuestValue<unknown>(guestLedgersKey(guestId), (current) => {
    const next = change(normalizeGuestLedgers(current));
    // 写回之前同样清理一遍（例如恢复时的 `archivedAt: null` 不写进存储）。
    return next === undefined ? undefined : next.map(sanitizeGuestLedger);
  });
  return { ok: result.ok, ledgers: normalizeGuestLedgers(result.value) };
}

export async function readCurrentGuestLedgerId(guestId: string): Promise<string | null> {
  const stored = await readGuestValueResult<unknown>(guestCurrentLedgerKey(guestId));
  if (!stored.ok) return null;
  return typeof stored.value === "string" && stored.value.length > 0 ? stored.value : null;
}
