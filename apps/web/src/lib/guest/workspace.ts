/**
 * **游客多账本的存储布局、旧数据迁移与账本生命周期（新建 / 切换 / 重命名 / 归档 / 恢复 / 删除）。**
 *
 * ## 布局（v2）
 *
 * | 键 | 内容 |
 * |---|---|
 * | `guest:<游客id>:ledgers` | 注册表：每本账的名称、币种、归档、排序、迁入正式账号时间（`ledger.ts`） |
 * | `guest:<游客id>:current-ledger` | 当前账本 id（**只在游客库里**，从不写进账号用的 `currentBook`） |
 * | `guest:<游客id>:data:<账本id>` | 这本账的数据 blob（形状见 `blob.ts`，与旧的单一 blob 相同） |
 * | `guest:<游客id>:not-duplicate:<账本id>` | 这本账的「不是重复」关系（`notDuplicate.ts`） |
 * | `guest:<游客id>:layout` | 迁移标记：`{version: 2, legacyBookId, migratedAt}` |
 *
 * v1（1.19.94 及以前）只有一个 `guest:<游客id>:data`（和一个 `guest:<游客id>:not-duplicate`），
 * 一个游客一本账。
 *
 * ## 迁移（`migrateGuestLayout`，每次载入都会先跑一遍，幂等）
 *
 * 1. 读旧键 `data`。没有就什么都不做；读失败就**整个载入失败**（绝不把“读失败”当“没有”）；
 *    版本认不出就原样留着、不碰。
 * 2. 旧 blob 的 `book.id` 就是这本账的 id（正式账号导入的状态键就是它，不能换）。注册表里没有这本账就
 *    把它加到最前面（原子更新）。
 * 3. 新键还没有：把旧 blob **原样**写进 `data:<账本id>`，读回逐字段比较；不一致就删掉刚写的新键、
 *    本次会话继续用旧键（“旧键模式”）。
 *    新键已经有、而且与旧 blob 完全相同：上次写完新键还没删旧键就中断了，接着往下做。
 *    新键已经有、但与旧 blob 不同：旧键在迁移之后又被写过（例如另一个还没刷新的旧版本标签页又记了一笔）。
 *    此时**两份都是用户的数据，不能二选一**：旧 blob 里有账目就另存成一本新账本「（恢复的副本）」，
 *    读回校验成功后才删旧键；旧 blob 里一笔账目都没有（旧版本页面打开时重新种出来的空账本），直接删掉。
 * 4. 「不是重复」关系同样搬到 `not-duplicate:<账本id>`（新键已有就按关系 id 合并，新键优先），读回校验。
 * 5. 写迁移标记，然后删旧的 `data`；删失败就把刚写的新键也删掉、回到旧键模式（下次启动重来，
 *    不会出现“新旧两份都在、新的已经往前走了”的分叉）。最后删旧的 `not-duplicate`。
 *
 * **中途关页面 / 配额不足**：任何一步失败，旧键都还在、内容没变；下次启动从第 1 步重来，第 3 步会认出
 * “新键已写好且一致”继续往下。整个过程只有“读回校验通过之后”才删东西，所以任何中断都不会丢账目。
 * 多个标签页同时启动时，用 Web Locks（`navigator.locks`）把迁移串起来；没有 Web Locks 的环境退化为
 * 同一标签页内排队（跨标签页最坏情况是多出一本「恢复的副本」，仍然不丢账目）。
 *
 * ## 旧键模式
 *
 * 迁移没完成时，这本账本次会话的读写都走旧键 `data`（见 `guestDataKeyFor`），其余功能（包括新建别的
 * 账本）照常可用；下次启动再试迁移。
 */
import { t } from "../../i18n/index.js";
import { removeGuestBookAttachments } from "./attachments.js";
import {
  guestBlobHasEntries,
  isRecognisedGuestBlob,
  normalizeGuestBlob,
  sameGuestValue,
  seedGuestData,
  type GuestData,
} from "./blob.js";
import {
  DEFAULT_GUEST_CURRENCY,
  DEFAULT_GUEST_LEDGER_NAME,
  GUEST_LEDGER_NAME_MAX,
  GUEST_LEDGER_SCHEMA_VERSION,
  MAX_GUEST_LEDGERS,
  createDefaultGuestLedger,
  guestCurrentLedgerKey,
  isArchivedGuestLedger,
  newGuestLedgerId,
  nextGuestSortOrder,
  orderGuestLedgers,
  readCurrentGuestLedgerId,
  readGuestLedgersResult,
  updateGuestLedgers,
  type GuestLedger,
} from "./ledger.js";
import {
  GUEST_BOOK_ID_PATTERN,
  deleteGuestValue,
  guestBookKey,
  guestKey,
  readGuestValueResult,
  updateGuestValue,
  writeGuestValue,
} from "./storage.js";

const DATA_NAME = "data";
const NOT_DUPLICATE_NAME = "not-duplicate";
const LAYOUT_NAME = "layout";
export const GUEST_LAYOUT_VERSION = 2;
/** 分叉时另存的那本账的名称后缀。写进本机数据库（数据，可被导入正式账号），不是界面文字。 */
const RECOVERED_SUFFIX = "（恢复的副本）"; // i18n-ignore：账本名（数据），不是界面文字

export function guestLegacyDataKey(guestId: string): string {
  return guestKey(guestId, DATA_NAME);
}

export function guestBookDataKey(guestId: string, bookId: string): string {
  return guestBookKey(guestId, DATA_NAME, bookId);
}

export function guestLegacyNotDuplicateKey(guestId: string): string {
  return guestKey(guestId, NOT_DUPLICATE_NAME);
}

export function guestBookNotDuplicateKey(guestId: string, bookId: string): string {
  return guestBookKey(guestId, NOT_DUPLICATE_NAME, bookId);
}

export function guestLayoutKey(guestId: string): string {
  return guestKey(guestId, LAYOUT_NAME);
}

/** 本次会话里迁移没完成、仍住在旧键里的那本账（游客 id → 账本 id）。 */
const legacyResidents = new Map<string, string>();

/** 这本账的数据现在存在哪个键里（旧键模式下是旧的 `data`）。 */
export function guestDataKeyFor(guestId: string, bookId: string): string {
  return legacyResidents.get(guestId) === bookId ? guestLegacyDataKey(guestId) : guestBookDataKey(guestId, bookId);
}

/** 这本账的「不是重复」关系现在存在哪个键里（旧键模式下是旧的 `not-duplicate`）。 */
export function guestNotDuplicateKeyFor(guestId: string, bookId: string): string {
  return legacyResidents.get(guestId) === bookId
    ? guestLegacyNotDuplicateKey(guestId)
    : guestBookNotDuplicateKey(guestId, bookId);
}

/** 清除游客数据 / 换身份时丢掉本模块记住的会话状态。 */
export function forgetGuestWorkspace(guestId?: string): void {
  if (guestId === undefined) legacyResidents.clear();
  else legacyResidents.delete(guestId);
}

function storageUnavailable(): Error {
  return new Error(t("account.guest.errors.storageUnavailable"));
}

/* ------------------------------------------------------------------ */
/* 串行：同一游客的布局操作一次只做一件                                   */
/* ------------------------------------------------------------------ */

const layoutChains = new Map<string, Promise<unknown>>();

/**
 * 同一标签页内按游客排队，再用 Web Locks 跨标签页互斥（有的话）。**不可重入**：持锁的函数里不要再调用
 * 另一个持锁的公开函数（内部都用不加锁的 `…Unlocked` 版本）。
 */
function withLayoutLock<T>(guestId: string, work: () => Promise<T>): Promise<T> {
  const locked = (): Promise<T> => {
    const locks =
      typeof navigator !== "undefined" ? (navigator as Navigator & { readonly locks?: LockManager }).locks : undefined;
    if (locks !== undefined && typeof locks.request === "function") {
      return locks.request(`libellum-guest-layout:${guestId}`, work) as Promise<T>;
    }
    return work();
  };
  const previous = layoutChains.get(guestId) ?? Promise.resolve();
  const next = previous.then(locked, locked);
  layoutChains.set(
    guestId,
    next.catch(() => undefined),
  );
  return next;
}

/* ------------------------------------------------------------------ */
/* 迁移                                                                  */
/* ------------------------------------------------------------------ */

export interface GuestMigrationOutcome {
  /** 迁移后（或旧键模式下）这本旧账本的注册表条目；没有旧数据时为 `null`。 */
  readonly legacyLedger: GuestLedger | null;
  /** 本次会话仍用旧键的账本 id；迁移完成或没有旧数据时为 `null`。 */
  readonly legacyBookId: string | null;
  /** 分叉时另存出来的账本（见文件头第 3 步）；没有分叉为 `null`。 */
  readonly recovered: GuestLedger | null;
}

const NO_MIGRATION: GuestMigrationOutcome = { legacyLedger: null, legacyBookId: null, recovered: null };

function storedBookOf(raw: Record<string, unknown>): Record<string, unknown> | null {
  const book = raw["book"];
  return typeof book === "object" && book !== null && !Array.isArray(book) ? (book as Record<string, unknown>) : null;
}

/** 从旧 blob 里存的 `book` 推出注册表条目；字段缺了用默认值补上，不让这本账因为一个字段不对就消失。 */
function ledgerFromStoredBook(book: Record<string, unknown> | null, id: string, sortOrder: number): GuestLedger {
  const now = new Date().toISOString();
  const text = (field: string, fallback: string): string => {
    const value = book?.[field];
    return typeof value === "string" && value.length > 0 ? value : fallback;
  };
  return {
    id,
    name: text("name", DEFAULT_GUEST_LEDGER_NAME).slice(0, GUEST_LEDGER_NAME_MAX),
    currency: text("currency", DEFAULT_GUEST_CURRENCY),
    schemaVersion: GUEST_LEDGER_SCHEMA_VERSION,
    createdAt: text("createdAt", now),
    updatedAt: text("updatedAt", now),
    sortOrder,
  };
}

/** 写入并读回比较；任何一步失败都返回 false。 */
async function writeAndVerify(key: string, value: unknown): Promise<boolean> {
  if (!(await writeGuestValue(key, value))) return false;
  const back = await readGuestValueResult<unknown>(key);
  return back.ok && sameGuestValue(back.value, value);
}

interface NotDuplicateFile {
  readonly version: 1;
  readonly items: readonly { readonly id: string }[];
}

function isNotDuplicateFile(value: unknown): value is NotDuplicateFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate["version"] === 1 &&
    Array.isArray(candidate["items"]) &&
    (candidate["items"] as unknown[]).every(
      (item) => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>)["id"] === "string",
    )
  );
}

/** 按关系 id 合并两份「不是重复」文件；同一 id 以 `primary` 为准。 */
function mergeNotDuplicateFiles(primary: NotDuplicateFile, extra: NotDuplicateFile): NotDuplicateFile {
  const known = new Set(primary.items.map((item) => item.id));
  return { version: 1, items: [...primary.items, ...extra.items.filter((item) => !known.has(item.id))] };
}

/**
 * 把旧的「不是重复」文件搬到这本账的新键。返回旧键是否可以删（已经安全地在新键里，或者根本没有旧键）。
 * 认不出的旧文件原样留着（返回 false，旧键不删）。
 */
async function copyLegacyNotDuplicate(guestId: string, bookId: string): Promise<{ ok: boolean; present: boolean }> {
  const legacyKey = guestLegacyNotDuplicateKey(guestId);
  const legacy = await readGuestValueResult<unknown>(legacyKey);
  if (!legacy.ok) return { ok: false, present: true };
  if (legacy.value === null) return { ok: true, present: false };
  if (!isNotDuplicateFile(legacy.value)) return { ok: false, present: true };

  const targetKey = guestBookNotDuplicateKey(guestId, bookId);
  const target = await readGuestValueResult<unknown>(targetKey);
  if (!target.ok) return { ok: false, present: true };

  let next: NotDuplicateFile;
  if (target.value === null) next = legacy.value;
  else if (isNotDuplicateFile(target.value)) next = mergeNotDuplicateFiles(target.value, legacy.value);
  else return { ok: false, present: true };

  if (target.value !== null && sameGuestValue(target.value, next)) return { ok: true, present: true };
  return { ok: await writeAndVerify(targetKey, next), present: true };
}

/** 另存分叉的旧 blob 为一本新账本（见文件头第 3 步）。成功后才允许删旧键。 */
async function preserveDivergentLegacy(
  guestId: string,
  raw: Record<string, unknown>,
  origin: GuestLedger,
): Promise<GuestLedger | null> {
  const now = new Date().toISOString();
  const registry = await readGuestLedgersResult(guestId);
  if (!registry.ok) return null;
  const recovered: GuestLedger = {
    id: newGuestLedgerId(),
    name: `${origin.name.slice(0, GUEST_LEDGER_NAME_MAX - RECOVERED_SUFFIX.length)}${RECOVERED_SUFFIX}`,
    currency: origin.currency,
    schemaVersion: GUEST_LEDGER_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    sortOrder: nextGuestSortOrder(registry.ledgers),
  };
  if (!(await writeAndVerify(guestBookDataKey(guestId, recovered.id), { ...raw, book: recovered }))) {
    await deleteGuestValue(guestBookDataKey(guestId, recovered.id));
    return null;
  }
  // ⚠️ 另存的账本不受本数上限限制：它装的是已经存在的账目，拒绝它就等于丢掉它们。
  const listed = await updateGuestLedgers(guestId, (ledgers) => [...ledgers, recovered]);
  if (!listed.ok || !listed.ledgers.some((ledger) => ledger.id === recovered.id)) {
    await deleteGuestValue(guestBookDataKey(guestId, recovered.id));
    return null;
  }
  return recovered;
}

interface LayoutMarker {
  readonly version: number;
  readonly legacyBookId: string | null;
  readonly migratedAt: string;
  /** 分叉时另存出来的那本账（用来认出“这份旧键已经另存过了”，不会每次启动都再存一份）。 */
  readonly recoveredLedgerId?: string;
}

async function readLayoutMarker(guestId: string): Promise<LayoutMarker | null> {
  const marker = await readGuestValueResult<LayoutMarker>(guestLayoutKey(guestId));
  return marker.ok && typeof marker.value === "object" && marker.value !== null ? marker.value : null;
}

function writeLayoutMarker(guestId: string, marker: Omit<LayoutMarker, "version" | "migratedAt">): Promise<boolean> {
  return writeGuestValue(guestLayoutKey(guestId), {
    version: GUEST_LAYOUT_VERSION,
    migratedAt: new Date().toISOString(),
    ...marker,
  } satisfies LayoutMarker);
}

/**
 * 旧的 `data` 已经迁完、却又出现了旧的 `not-duplicate`（旧版本标签页在迁移之后又确认了一次“不是重复”）：
 * 按迁移标记找到原来那本账，合并进它的新键。找不到归属就原样留着。
 */
async function adoptOrphanLegacyNotDuplicate(guestId: string): Promise<void> {
  const bookId = (await readLayoutMarker(guestId))?.legacyBookId ?? null;
  if (bookId === null || !GUEST_BOOK_ID_PATTERN.test(bookId)) return;
  const copied = await copyLegacyNotDuplicate(guestId, bookId);
  if (copied.ok && copied.present) await deleteGuestValue(guestLegacyNotDuplicateKey(guestId));
}

/** 这份分叉的旧 blob 是否已经另存过（迁移标记记着另存的那本账，内容与旧 blob 相同）。 */
async function alreadyPreserved(guestId: string, raw: Record<string, unknown>): Promise<boolean> {
  const recoveredId = (await readLayoutMarker(guestId))?.recoveredLedgerId;
  if (typeof recoveredId !== "string" || !GUEST_BOOK_ID_PATTERN.test(recoveredId)) return false;
  const stored = await readGuestValueResult<unknown>(guestBookDataKey(guestId, recoveredId));
  if (!stored.ok || !isRecognisedGuestBlob(stored.value)) return false;
  return sameGuestValue(stored.value, { ...raw, book: stored.value["book"] });
}

async function migrateUnlocked(guestId: string): Promise<GuestMigrationOutcome> {
  const legacyKey = guestLegacyDataKey(guestId);
  const legacy = await readGuestValueResult<unknown>(legacyKey);
  if (!legacy.ok) throw storageUnavailable();

  if (legacy.value === null) {
    legacyResidents.delete(guestId);
    await adoptOrphanLegacyNotDuplicate(guestId);
    return NO_MIGRATION;
  }
  // 认不出的版本：不读、不搬、不删（也许是更新的版本写的）。
  if (!isRecognisedGuestBlob(legacy.value)) return NO_MIGRATION;
  const raw = legacy.value;

  // ---- 第 2 步：注册表里有这本账 ----
  const registry = await readGuestLedgersResult(guestId);
  if (!registry.ok) throw storageUnavailable();
  const storedBook = storedBookOf(raw);
  const storedId = storedBook?.["id"];
  const bookId =
    typeof storedId === "string" && GUEST_BOOK_ID_PATTERN.test(storedId)
      ? storedId
      : registry.ledgers[0]?.id ?? newGuestLedgerId();
  let ledger = registry.ledgers.find((entry) => entry.id === bookId) ?? null;
  const enterLegacyMode = (entry: GuestLedger): GuestMigrationOutcome => {
    legacyResidents.set(guestId, bookId);
    return { legacyLedger: entry, legacyBookId: bookId, recovered: null };
  };
  const finished = (entry: GuestLedger, recovered: GuestLedger | null): GuestMigrationOutcome => {
    legacyResidents.delete(guestId);
    return { legacyLedger: entry, legacyBookId: null, recovered };
  };

  if (ledger === null) {
    const first = registry.ledgers.reduce((min, entry, index) => Math.min(min, entry.sortOrder ?? index), 0);
    const entry = ledgerFromStoredBook(storedBook, bookId, registry.ledgers.length === 0 ? 0 : first - 1);
    const listed = await updateGuestLedgers(guestId, (ledgers) =>
      ledgers.some((item) => item.id === bookId) ? undefined : [entry, ...ledgers],
    );
    ledger = listed.ledgers.find((item) => item.id === bookId) ?? null;
    if (!listed.ok || ledger === null) return enterLegacyMode(entry);
  }

  // ---- 第 3 步：数据搬到新键 ----
  const copy = storedId === bookId ? raw : { ...raw, book: { ...(storedBook ?? {}), ...ledger } };
  const targetKey = guestBookDataKey(guestId, bookId);
  const target = await readGuestValueResult<unknown>(targetKey);
  if (!target.ok) return enterLegacyMode(ledger);

  if (target.value !== null && !sameGuestValue(target.value, copy)) {
    /**
     * 分叉：新键是这本账的现行数据，照常使用。旧键里有账目就另存成一本新账本（存不下就原样留着，下次
     * 再试）；已经另存过的（上次另存后没删掉旧键）不再存第二份；一笔账目都没有的直接删。
     */
    let recovered: GuestLedger | null = null;
    if (guestBlobHasEntries(raw) && !(await alreadyPreserved(guestId, raw))) {
      recovered = await preserveDivergentLegacy(guestId, raw, ledger);
      if (recovered === null) return finished(ledger, null);
      await writeLayoutMarker(guestId, { legacyBookId: bookId, recoveredLedgerId: recovered.id });
    }
    if (await deleteGuestValue(legacyKey)) {
      const notDuplicate = await copyLegacyNotDuplicate(guestId, bookId);
      if (notDuplicate.ok && notDuplicate.present) await deleteGuestValue(guestLegacyNotDuplicateKey(guestId));
    }
    return finished(ledger, recovered);
  }

  if (target.value === null && !(await writeAndVerify(targetKey, copy))) {
    await deleteGuestValue(targetKey);
    return enterLegacyMode(ledger);
  }

  /**
   * 新键与旧键现在完全相同。「不是重复」关系先搬（搬不成也不挡住账目的迁移：旧关系文件原样留着，
   * 下次启动按迁移标记再合并），然后写标记、删旧键。删旧键失败就把新键也删掉、回到旧键模式——
   * 否则本次会话往新键里写、旧键原样留着，下次启动就成了“分叉”。
   */
  const notDuplicate = await copyLegacyNotDuplicate(guestId, bookId);
  await writeLayoutMarker(guestId, { legacyBookId: bookId });
  if (!(await deleteGuestValue(legacyKey))) {
    await deleteGuestValue(targetKey);
    return enterLegacyMode(ledger);
  }
  if (notDuplicate.ok && notDuplicate.present) await deleteGuestValue(guestLegacyNotDuplicateKey(guestId));
  return finished(ledger, null);
}

/** 跑一遍迁移（幂等）。读存储失败时抛出，调用方显示“暂时打不开”，不做任何改动。 */
export function migrateGuestLayout(guestId: string): Promise<GuestMigrationOutcome> {
  return withLayoutLock(guestId, () => migrateUnlocked(guestId));
}

/* ------------------------------------------------------------------ */
/* 工作区：账本列表 + 当前账本                                            */
/* ------------------------------------------------------------------ */

export interface GuestWorkspaceState {
  readonly guestId: string;
  /** 全部账本（含已归档），按列表顺序。 */
  readonly ledgers: readonly GuestLedger[];
  /** 当前账本；`create: false` 且一本账都没有时为 `null`。 */
  readonly currentLedgerId: string | null;
  /** 本次会话仍用旧键的账本（迁移没完成）。 */
  readonly legacyBookId: string | null;
}

function chooseCurrent(ledgers: readonly GuestLedger[], stored: string | null): string | null {
  const active = ledgers.filter((ledger) => !isArchivedGuestLedger(ledger));
  const storedActive = active.find((ledger) => ledger.id === stored);
  return storedActive?.id ?? active[0]?.id ?? ledgers[0]?.id ?? null;
}

async function ensureUnlocked(guestId: string, create: boolean): Promise<GuestWorkspaceState> {
  const migration = await migrateUnlocked(guestId);
  const registry = await readGuestLedgersResult(guestId);
  if (!registry.ok) throw storageUnavailable();

  let ledgers: GuestLedger[] = registry.ledgers;
  // 旧键模式下注册表可能没写成：这本账只在内存里列出来，下次启动再写。
  if (migration.legacyLedger !== null && !ledgers.some((ledger) => ledger.id === migration.legacyLedger?.id)) {
    ledgers = [migration.legacyLedger, ...ledgers];
  }

  if (ledgers.length === 0 && create) {
    const ledger: GuestLedger = { ...createDefaultGuestLedger(), sortOrder: 0 };
    // 先写数据再登记：注册表里的账本永远有数据可读（登记失败只会多一个无人引用的空 blob）。
    const blobKey = guestBookDataKey(guestId, ledger.id);
    await writeGuestValue(blobKey, seedGuestData(ledger));
    const listed = await updateGuestLedgers(guestId, (list) => (list.length === 0 ? [ledger] : undefined));
    if (listed.ok && listed.ledgers.length > 0) {
      ledgers = listed.ledgers;
      if (!ledgers.some((item) => item.id === ledger.id)) await deleteGuestValue(blobKey);
    } else {
      // 存储不可用（例如测试环境或浏览器禁止网站存数据）：只在内存里有这本账，与以前的行为一致。
      ledgers = [ledger];
    }
  }

  const ordered = orderGuestLedgers(ledgers);
  const stored = await readCurrentGuestLedgerId(guestId);
  const current = chooseCurrent(ordered, stored);
  if (current !== null && current !== stored) await writeGuestValue(guestCurrentLedgerKey(guestId), current);

  return { guestId, ledgers: ordered, currentLedgerId: current, legacyBookId: legacyResidents.get(guestId) ?? null };
}

/**
 * 读游客工作区：先迁移旧数据，再读注册表与当前账本。`create`（默认 true）：一本账都没有时建一本默认账本——
 * 这是“第一次进入游客模式”的行为；账本导入页只读，传 `false`。
 *
 * 读存储失败时抛出（不建账本、不改任何东西）。
 */
export function ensureGuestWorkspace(
  guestId: string,
  options: { readonly create?: boolean } = {},
): Promise<GuestWorkspaceState> {
  return withLayoutLock(guestId, () => ensureUnlocked(guestId, options.create ?? true));
}

/** 只读注册表（不迁移、不新建），给需要最新列表的地方用；旧键模式下补上那本只在内存里的账本。 */
export async function readGuestLedgerList(guestId: string, fallback: readonly GuestLedger[] = []): Promise<GuestLedger[]> {
  const registry = await readGuestLedgersResult(guestId);
  if (!registry.ok) throw storageUnavailable();
  let ledgers = registry.ledgers;
  const legacy = legacyResidents.get(guestId);
  const missingLegacy = legacy === undefined ? undefined : fallback.find((ledger) => ledger.id === legacy);
  if (missingLegacy !== undefined && !ledgers.some((ledger) => ledger.id === legacy)) ledgers = [missingLegacy, ...ledgers];
  // 存储不可用时注册表是空的：用内存里的那份。
  if (ledgers.length === 0) ledgers = [...fallback];
  return orderGuestLedgers(ledgers);
}

/* ------------------------------------------------------------------ */
/* 每本账的数据                                                            */
/* ------------------------------------------------------------------ */

export type GuestBookRead =
  | { readonly status: "ok"; readonly data: GuestData }
  | { readonly status: "absent" }
  | { readonly status: "unreadable" }
  | { readonly status: "unrecognised" };

/** 只读一本账的数据（不种子、不写）。 */
export async function readGuestBook(guestId: string, ledger: GuestLedger): Promise<GuestBookRead> {
  const stored = await readGuestValueResult<unknown>(guestDataKeyFor(guestId, ledger.id));
  if (!stored.ok) return { status: "unreadable" };
  if (stored.value === null) return { status: "absent" };
  const data = normalizeGuestBlob(stored.value, ledger);
  return data === null ? { status: "unrecognised" } : { status: "ok", data };
}

/**
 * 读一本账的数据；**只有确实没有**这个键时才种一份初始数据并写入（写不进去就只在内存里）。
 * 读失败或版本认不出时抛出——绝不用一本空账覆盖读不出来的数据。
 */
export async function loadGuestBook(guestId: string, ledger: GuestLedger): Promise<GuestData> {
  const read = await readGuestBook(guestId, ledger);
  if (read.status === "ok") return read.data;
  if (read.status === "unreadable") throw storageUnavailable();
  if (read.status === "unrecognised") throw new Error(t("account.guest.errors.unrecognisedData"));
  const seeded = seedGuestData(ledger);
  await writeGuestValue(guestDataKeyFor(guestId, ledger.id), seeded);
  return seeded;
}

/** 写一本账的数据（整份 blob）。 */
export function writeGuestBook(guestId: string, data: GuestData): Promise<boolean> {
  return writeGuestValue(guestDataKeyFor(guestId, data.book.id), data);
}

/**
 * 原子地改一本账的数据（同一个事务里读 + 改 + 写），给不经过内存快照的调用方用（账本导入页在正式账号
 * 会话里清理 / 恢复已迁移的游客账目）。`change` 拿到校验后的数据，返回新数据或 `undefined`（不写）；
 * 必须是同步函数。没有这本账的数据时 `change` 不会被调用。
 */
export async function updateGuestBook(
  guestId: string,
  ledger: GuestLedger,
  change: (data: GuestData) => GuestData | undefined,
): Promise<GuestData | null> {
  let failure: Error | null = null;
  const result = await updateGuestValue<unknown>(guestDataKeyFor(guestId, ledger.id), (current) => {
    if (current === null) return undefined;
    const data = normalizeGuestBlob(current, ledger);
    if (data === null) {
      failure = new Error(t("account.guest.errors.unrecognisedData"));
      return undefined;
    }
    return change(data);
  });
  if (failure !== null) throw failure;
  if (!result.ok) throw new Error(t("account.guest.errors.saveFailed"));
  return result.value === null ? null : normalizeGuestBlob(result.value, ledger);
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                               */
/* ------------------------------------------------------------------ */

function validName(name: string): string {
  const value = name.trim();
  if (value === "") throw new Error(t("books.settings.rename.empty"));
  if (value.length > GUEST_LEDGER_NAME_MAX) throw new Error(t("books.settings.rename.tooLong"));
  return value;
}

function findOrThrow(ledgers: readonly GuestLedger[], id: string): GuestLedger {
  const ledger = ledgers.find((item) => item.id === id);
  if (ledger === undefined) throw new Error(t("account.guest.errors.ledgerGone"));
  return ledger;
}

/**
 * 一本账现在能不能归档 / 删除 / 恢复。规则（游客版，自行决定，见报告）：
 * - 归档：未归档，并且还有**另一本未归档**的账本（至少保留一本可以记账的账本）；
 * - 删除：删掉以后仍至少有一本未归档的账本（已归档的随时可删；未归档的要有另一本未归档的）；
 * - 恢复：已归档。
 */
export function guestLedgerLifecycle(ledgers: readonly GuestLedger[], id: string): {
  readonly archived: boolean;
  readonly canArchive: boolean;
  readonly canDelete: boolean;
  readonly canRestore: boolean;
} {
  const ledger = ledgers.find((item) => item.id === id);
  if (ledger === undefined) return { archived: false, canArchive: false, canDelete: false, canRestore: false };
  const archived = isArchivedGuestLedger(ledger);
  const otherActive = ledgers.some((item) => item.id !== id && !isArchivedGuestLedger(item));
  return { archived, canArchive: !archived && otherActive, canDelete: archived || otherActive, canRestore: archived };
}

/** 账本离开后（归档 / 删除）当前账本该换成哪一本：列表里第一本未归档的、不是它的。 */
function nextCurrentAfterLeaving(ledgers: readonly GuestLedger[], leaving: string): string | null {
  return orderGuestLedgers(ledgers).find((item) => item.id !== leaving && !isArchivedGuestLedger(item))?.id ?? null;
}

/**
 * 新建一本账：先写它的初始数据，再登记进注册表（与正式账号一样，新账本有自己的一套预设分类与支付方式，
 * 不从当前账本复制）。**不切换当前账本**——调用方随后走切换（整页重新载入）。
 */
export function createGuestLedger(
  guestId: string,
  input: { readonly name: string; readonly currency?: string },
): Promise<GuestLedger> {
  return withLayoutLock(guestId, async () => {
    const name = validName(input.name);
    const registry = await readGuestLedgersResult(guestId);
    if (!registry.ok) throw storageUnavailable();
    if (registry.ledgers.length >= MAX_GUEST_LEDGERS) {
      throw new Error(t("account.guest.errors.ledgerLimit", { count: MAX_GUEST_LEDGERS }));
    }
    const now = new Date().toISOString();
    const ledger: GuestLedger = {
      id: newGuestLedgerId(),
      name,
      currency: input.currency ?? DEFAULT_GUEST_CURRENCY,
      schemaVersion: GUEST_LEDGER_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      sortOrder: nextGuestSortOrder(registry.ledgers),
    };
    const blobKey = guestBookDataKey(guestId, ledger.id);
    if (!(await writeGuestValue(blobKey, seedGuestData(ledger)))) throw new Error(t("account.guest.errors.saveFailed"));

    let overLimit = false;
    const listed = await updateGuestLedgers(guestId, (ledgers) => {
      if (ledgers.length >= MAX_GUEST_LEDGERS) {
        overLimit = true;
        return undefined;
      }
      return [...ledgers, ledger];
    });
    if (!listed.ok || overLimit || !listed.ledgers.some((item) => item.id === ledger.id)) {
      await deleteGuestValue(blobKey);
      if (overLimit) throw new Error(t("account.guest.errors.ledgerLimit", { count: MAX_GUEST_LEDGERS }));
      throw new Error(t("account.guest.errors.saveFailed"));
    }
    return ledger;
  });
}

/** 改一本账的注册表条目（原子）。条目不存在时抛出 `ledgerGone`。 */
async function patchLedger(
  guestId: string,
  id: string,
  patch: (ledger: GuestLedger, ledgers: readonly GuestLedger[]) => GuestLedger,
): Promise<GuestLedger> {
  let gone = false;
  let failure: Error | null = null;
  const listed = await updateGuestLedgers(guestId, (ledgers) => {
    const index = ledgers.findIndex((item) => item.id === id);
    if (index < 0) {
      gone = true;
      return undefined;
    }
    try {
      const next = [...ledgers];
      next[index] = patch(ledgers[index]!, ledgers);
      return next;
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      return undefined;
    }
  });
  if (failure !== null) throw failure;
  if (gone) throw new Error(t("account.guest.errors.ledgerGone"));
  if (!listed.ok) throw new Error(t("account.guest.errors.saveFailed"));
  return findOrThrow(listed.ledgers, id);
}

/** 重命名。名称只存在注册表里（blob 里的 `book` 读出时以注册表为准）。 */
export function renameGuestLedger(guestId: string, id: string, name: string): Promise<GuestLedger> {
  return withLayoutLock(guestId, async () => {
    const value = validName(name);
    return patchLedger(guestId, id, (ledger) => ({ ...ledger, name: value, updatedAt: new Date().toISOString() }));
  });
}

/**
 * 归档。数据原样保留，只是不在常用列表里、不能作为当前账本。归档的是当前账本时，当前账本换成下一本
 * 未归档的账本，返回它的 id（调用方随后整页重新载入）；否则返回 `null`。
 */
export function archiveGuestLedger(guestId: string, id: string): Promise<{ readonly nextCurrentId: string | null }> {
  return withLayoutLock(guestId, async () => {
    const stamp = new Date().toISOString();
    let after: readonly GuestLedger[] = [];
    await patchLedger(guestId, id, (ledger, ledgers) => {
      const rules = guestLedgerLifecycle(ledgers, id);
      if (rules.archived) return ledger;
      if (!rules.canArchive) throw new Error(t("account.guest.errors.lastActiveLedger"));
      after = ledgers.map((item) => (item.id === id ? { ...ledger, archivedAt: stamp, updatedAt: stamp } : item));
      return { ...ledger, archivedAt: stamp, updatedAt: stamp };
    });
    return { nextCurrentId: await moveCurrentAway(guestId, id, after) };
  });
}

/** 恢复一本已归档的账本（不切换当前账本）。 */
export function restoreGuestLedger(guestId: string, id: string): Promise<GuestLedger> {
  return withLayoutLock(guestId, () =>
    patchLedger(guestId, id, (ledger) => {
      if (!isArchivedGuestLedger(ledger)) return ledger;
      // `null` 在注册表校验时被当成“未归档”丢掉（`ledger.ts` 的 sanitize），存下来的就是没有这个字段。
      return { ...ledger, archivedAt: null, updatedAt: new Date().toISOString() };
    }),
  );
}

/** 它是当前账本时，把当前账本换走。返回新的当前账本 id；它不是当前账本时返回 `null`。 */
async function moveCurrentAway(guestId: string, leaving: string, ledgers: readonly GuestLedger[]): Promise<string | null> {
  const stored = await readCurrentGuestLedgerId(guestId);
  if (stored !== null && stored !== leaving) return null;
  const next = nextCurrentAfterLeaving(ledgers, leaving);
  if (next === null) return null;
  if (!(await writeGuestValue(guestCurrentLedgerKey(guestId), next))) throw new Error(t("account.guest.errors.saveFailed"));
  return next;
}

/**
 * 永久删除一本账：先从注册表里去掉（之后它就不会再被读到），再删它的数据与「不是重复」关系。
 * 删数据失败只会留下一个无人引用的 blob（“清除游客数据”会连库删掉），不会出现“列表里还在、数据没了”。
 * 删的是当前账本时，当前账本换成下一本未归档的账本并返回它的 id。
 */
export function deleteGuestLedger(guestId: string, id: string): Promise<{ readonly nextCurrentId: string | null }> {
  return withLayoutLock(guestId, async () => {
    let gone = false;
    let refused = false;
    const listed = await updateGuestLedgers(guestId, (ledgers) => {
      if (!ledgers.some((item) => item.id === id)) {
        gone = true;
        return undefined;
      }
      if (!guestLedgerLifecycle(ledgers, id).canDelete) {
        refused = true;
        return undefined;
      }
      return ledgers.filter((item) => item.id !== id);
    });
    if (refused) throw new Error(t("account.guest.errors.lastActiveLedger"));
    if (gone) throw new Error(t("account.guest.errors.ledgerGone"));
    if (!listed.ok) throw new Error(t("account.guest.errors.saveFailed"));

    const nextCurrentId = await moveCurrentAway(guestId, id, listed.ledgers);
    await deleteGuestValue(guestDataKeyFor(guestId, id));
    await deleteGuestValue(guestNotDuplicateKeyFor(guestId, id));
    // 这本账的附件原件在 libevra-attachments-v1，随账本一起删（失败不让删账本失败，只是残留可在清除游客数据时清掉）。
    await removeGuestBookAttachments(guestId, id).catch(() => undefined);
    if (legacyResidents.get(guestId) === id) {
      legacyResidents.delete(guestId);
      // 旧键模式下删的就是旧键；新键若已写过一半也一起删。
      await deleteGuestValue(guestBookDataKey(guestId, id));
      await deleteGuestValue(guestBookNotDuplicateKey(guestId, id));
    }
    return { nextCurrentId };
  });
}

/**
 * 切换当前账本：只写游客库里的 `current-ledger`，**不碰账号用的 `currentBook`**，写完读回确认。
 * 调用方随后整页重新载入（与正式账号“激活成功后整页重新载入”同一原则）。
 */
export function switchGuestLedger(guestId: string, id: string, known: readonly GuestLedger[] = []): Promise<void> {
  return withLayoutLock(guestId, async () => {
    const registry = await readGuestLedgerList(guestId, known);
    const ledger = findOrThrow(registry, id);
    if (isArchivedGuestLedger(ledger)) throw new Error(t("account.guest.errors.ledgerArchived"));
    const key = guestCurrentLedgerKey(guestId);
    if (!(await writeGuestValue(key, id))) throw new Error(t("account.guest.errors.saveFailed"));
    const back = await readGuestValueResult<unknown>(key);
    if (!back.ok || back.value !== id) throw new Error(t("account.guest.errors.saveFailed"));
  });
}

/** 记下这本游客账本刚刚成功迁入正式账号（账本导入页用来标出“已迁过”）。失败不影响导入结果。 */
export async function markGuestLedgerMigrated(guestId: string, id: string, at: string = new Date().toISOString()): Promise<boolean> {
  try {
    await withLayoutLock(guestId, () => patchLedger(guestId, id, (ledger) => ({ ...ledger, migratedAt: at })));
    return true;
  } catch {
    return false;
  }
}
