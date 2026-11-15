/**
 * The guest ledger's local data — the **same shapes the server returns**, stored in `libellum-guest`.
 *
 * ⚠️ **This is a data adapter, not a second application.** S14-C replaced the S14-B "guest workspace"
 * with the real Libevra screens; those screens already know how to render `Transaction`,
 * `LedgerMetaResponse`, `SummaryResponse` and `StatsResponse`. So the guest side produces exactly
 * those shapes from IndexedDB, and the pages do not branch on "guest or account" for their layout.
 *
 * ⚠️ **Why one blob per ledger instead of a table per entity.** The guest ledger lives on one device,
 * has one writer (this browser), and is read whole by the screens that need it; the account side
 * reached the same conclusion for its offline copy (`offline/storage.ts` is a key–value store, not a
 * mirror of the Prisma schema). The blob is versioned with `schemaVersion` (`blob.ts`).
 *
 * ⚠️ **Nothing here talks to the server, and nothing here uses the account stores.** In particular
 * it does not write `ledger-marks`, the query cache, the outbox or the offline scope; the guest data
 * is not part of any sync queue. See `../offline/storage.ts` for why the database itself is separate.
 *
 * ## 游客多账本（第二批）
 *
 * - 每本账一个 blob，存储布局、旧数据迁移、新建 / 切换 / 归档 / 删除都在 `workspace.ts`。
 * - **这个模块的内存快照永远是“当前账本”**：明细、统计、记账写入（`offline/write.ts` 的游客分支）、
 *   快照发布（`bridge.ts`）都只认它。切换当前账本走整页重新载入，所以一个页面生命周期里快照不会换账本。
 * - **账本设置可以管理另一本账**（与正式账号一样，地址里的 `bookId` 说了算）：分类 / 支付方式 / 标签的
 *   读写函数都接受可选的 `bookId`，不是当前账本时直接读写那本账的 blob，**不动当前快照**。
 * - 所有写操作在本标签页内排队（`serial`），避免两次并发修改都从同一份旧数据出发、后写的覆盖先写的。
 * - 写当前账本前确认它还在注册表里：另一个标签页删掉这本账之后，这里再写就会在一个没人引用的键里
 *   “复活”它（数据从此看不见），宁可报错。
 */
import {
  type Category,
  type ClassificationDeleteResponse,
  type CreateCategoryInput,
  type CreatePaymentMethodInput,
  type CreateTagInput,
  type CreateTransactionInput,
  type LedgerMetaResponse,
  type PaymentMethod,
  type Tag,
  type Transaction,
  type TransactionKind,
  type UpdateCategoryInput,
  type UpdatePaymentMethodInput,
  type UpdateTagInput,
  type UpdateTransactionInput,
} from "@libellum/shared";

import { t } from "../../i18n/index.js";
import { validateCategoryTree } from "@libellum/shared";
import { newGuestEntityId, type GuestData } from "./blob.js";
import { readGuestLedgersResult, type GuestLedger } from "./ledger.js";
import {
  archiveGuestLedger,
  createGuestLedger,
  deleteGuestLedger,
  ensureGuestWorkspace,
  forgetGuestWorkspace,
  loadGuestBook,
  readGuestBook,
  readGuestLedgerList,
  renameGuestLedger,
  restoreGuestLedger,
  switchGuestLedger,
  updateGuestBook,
  writeGuestBook,
  type GuestWorkspaceState,
} from "./workspace.js";

export { GUEST_DATA_SCHEMA_VERSION, type GuestData } from "./blob.js";

function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* In-memory snapshot + subscription                                    */
/* ------------------------------------------------------------------ */

let snapshot: GuestData | null = null;
let snapshotGuestId: string | null = null;
let publishedGuestId: string | null = null;
let loadPromise: Promise<GuestData | null> | null = null;
/** 载入快照时读到的游客工作区（账本列表 + 当前账本 + 是否仍在旧键模式）。 */
let workspace: GuestWorkspaceState | null = null;
const listeners = new Set<() => void>();

export function guestDataValue(): GuestData | null {
  return snapshot;
}

/** 当前快照所属的游客工作区；没载入时为 `null`。 */
export function guestWorkspaceValue(): GuestWorkspaceState | null {
  return workspace !== null && workspace.guestId === snapshotGuestId ? workspace : null;
}

/** 筛选/附属任务的归属只读取已经载入的游客账本，不把它写进正式账号的设备账本。 */
export function loadedGuestBookId(owner: string | null): string | null {
  return owner !== null && owner === publishedGuestId ? snapshot?.book.id ?? null : null;
}

export function subscribeGuestData(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: GuestData | null): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Drop the in-memory copy — called when guest data is cleared or the identity is replaced. */
export function resetGuestDataCache(): void {
  snapshot = null;
  snapshotGuestId = null;
  publishedGuestId = null;
  loadPromise = null;
  workspace = null;
  forgetGuestWorkspace();
  publish(null);
}

/**
 * Load the guest's **current** ledger, creating the first one (and its preset categories/payment
 * methods) on first use.
 *
 * Idempotent and cached per identity. 每次（每个页面生命周期一次）先跑一遍旧数据迁移（`workspace.ts`），
 * 再读当前账本那一本。读存储失败时返回 `null`（调用方显示“暂时打不开”），**不种一本空账覆盖它**；
 * 下次调用会重新尝试。
 */
export async function ensureGuestData(guestId: string): Promise<GuestData | null> {
  if (snapshot !== null && publishedGuestId === guestId && snapshotGuestId === guestId) return snapshot;
  if (loadPromise !== null && snapshotGuestId === guestId) return loadPromise;

  if (publishedGuestId !== guestId && snapshot !== null) {
    publishedGuestId = null;
    workspace = null;
    publish(null);
  }
  snapshotGuestId = guestId;
  const attempt: { promise: Promise<GuestData | null> | null } = { promise: null };
  attempt.promise = (async () => {
    try {
      const state = await ensureGuestWorkspace(guestId);
      const ledger = state.ledgers.find((entry) => entry.id === state.currentLedgerId);
      if (ledger === undefined) return null;
      const data = await loadGuestBook(guestId, ledger);

      if (snapshotGuestId !== guestId) return null;
      workspace = state;
      publishedGuestId = guestId;
      publish(data);
      return data;
    } catch {
      // 读失败不留在缓存里：下一次调用重新尝试（这一次什么都没写）。
      if (snapshotGuestId === guestId && loadPromise === attempt.promise) loadPromise = null;
      return null;
    }
  })();
  loadPromise = attempt.promise;

  return attempt.promise;
}

/** Re-read the store from IndexedDB (used by the ledger's refresh button in guest mode). */
export async function reloadGuestData(guestId: string): Promise<GuestData | null> {
  resetGuestDataCache();
  return ensureGuestData(guestId);
}

function requireGuestId(): string {
  if (snapshotGuestId === null) throw new Error(t("account.guest.errors.identityNotReady"));
  return snapshotGuestId;
}

async function requireData(): Promise<GuestData> {
  if (snapshot === null) {
    const loaded = await ensureGuestData(requireGuestId());
    if (loaded === null) throw new Error(t("account.guest.errors.ledgerUnavailable"));
    return loaded;
  }
  return snapshot;
}

/** 本标签页内的写入队列：一次只做一件，后一件从前一件写完的数据出发。 */
let writeQueue: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.catch(() => undefined);
  return next;
}

/** 当前快照里账本的最新列表（读注册表；存储不可用时用载入时那份）。 */
export async function listGuestLedgers(): Promise<readonly GuestLedger[]> {
  await requireData();
  const guestId = requireGuestId();
  const ledgers = await readGuestLedgerList(guestId, workspace?.ledgers ?? []);
  if (workspace !== null && workspace.guestId === guestId) workspace = { ...workspace, ledgers };
  return ledgers;
}

async function findLedger(bookId: string): Promise<GuestLedger> {
  const ledger = (await listGuestLedgers()).find((entry) => entry.id === bookId);
  if (ledger === undefined) throw new Error(t("account.guest.errors.ledgerGone"));
  return ledger;
}

/**
 * 某一本账的数据：当前账本就是内存快照；别的账本**每次从存储读**（不缓存，避免另一个标签页改过之后
 * 这里还拿旧的），只有确实没有这个键时才种一份初始数据。
 */
async function requireTarget(bookId?: string): Promise<GuestData> {
  const current = await requireData();
  if (bookId === undefined || bookId === "" || bookId === current.book.id) return current;
  return loadGuestBook(requireGuestId(), await findLedger(bookId));
}

/** 读某一本账（账本详情 / 设置 / 导出用）；不是当前账本时从存储读，不动当前快照。 */
export async function loadGuestDataFor(bookId?: string): Promise<GuestData> {
  return requireTarget(bookId);
}

/** 写之前确认这本账还在注册表里（见文件头最后一条）。读不出注册表时不拦，交给写入本身报告失败。 */
async function assertStillListed(guestId: string, bookId: string): Promise<void> {
  if (workspace?.legacyBookId === bookId) return;
  const registry = await readGuestLedgersResult(guestId);
  if (!registry.ok || registry.ledgers.length === 0) return;
  if (!registry.ledgers.some((ledger) => ledger.id === bookId)) {
    throw new Error(t("account.guest.errors.ledgerGone"));
  }
}

/**
 * 写回一本账。当前账本：写完发布到内存快照（页面随之更新）；别的账本：只写存储。
 */
async function persist(data: GuestData): Promise<void> {
  const guestId = requireGuestId();
  await assertStillListed(guestId, data.book.id);
  const written = await writeGuestBook(guestId, data);
  if (!written) {
    // 提示在抛出时按当前界面语言取（S16）；调用方显示 `error.message`。
    throw new Error(t("account.guest.errors.saveFailed"));
  }
  if (snapshot !== null && snapshot.book.id === data.book.id) publish(data);
}

/** The live entries, newest first — the order the ledger screen expects from the server. */
export function sortedTransactions(data: GuestData): readonly Transaction[] {
  return [...data.transactions].sort((left, right) => {
    if (left.occurredAt === right.occurredAt) return right.id.localeCompare(left.id);
    return right.occurredAt.localeCompare(left.occurredAt);
  });
}

export function guestTransactions(): readonly Transaction[] {
  return snapshot === null ? [] : sortedTransactions(snapshot);
}

export function guestLedgerMeta(data: GuestData): LedgerMetaResponse {
  return {
    book: {
      id: data.book.id,
      name: data.book.name,
      bookNumber: null,
      memberCount: 1,
    },
    stats: {
      createdAt: data.book.createdAt,
      transactionCount: data.transactions.length,
      eventCount: data.transactions.length,
    },
    categories: [...data.categories],
    paymentMethods: [...data.paymentMethods],
    tags: [...data.tags],
  };
}

export function guestDeletedIds(data: GuestData | null): ReadonlySet<string> {
  return new Set((data?.deleted ?? []).map((entry) => entry.id));
}

/* ------------------------------------------------------------------ */
/* Ledgers (the guest's own list — 新建 / 切换 / 重命名 / 归档 / 恢复 / 删除) */
/* ------------------------------------------------------------------ */

/**
 * 新建一本游客账本（自己的一套预设分类与支付方式，币种沿用当前账本）。不切换当前账本——调用方随后
 * 用 `switchGuestBook` + 整页重新载入进入它（与正式账号“新建即进入”同一条路径）。
 */
export function createGuestBook(name: string): Promise<GuestLedger> {
  return serial(async () => {
    const current = await requireData();
    const ledger = await createGuestLedger(requireGuestId(), { name, currency: current.book.currency });
    await listGuestLedgers();
    return ledger;
  });
}

/** 把当前账本记成另一本（只写游客库）。调用方随后整页重新载入。 */
export function switchGuestBook(bookId: string): Promise<void> {
  return serial(async () => {
    await requireData();
    await switchGuestLedger(requireGuestId(), bookId, workspace?.ledgers ?? []);
  });
}

/** 重命名；改的是当前账本时同时更新内存快照里的 `book`，标题立即变。 */
export function renameGuestBook(bookId: string, name: string): Promise<GuestLedger> {
  return serial(async () => {
    const current = await requireData();
    const ledger = await renameGuestLedger(requireGuestId(), bookId, name);
    await listGuestLedgers();
    if (snapshot !== null && current.book.id === bookId && snapshot.book.id === bookId) {
      publish({ ...snapshot, book: { ...snapshot.book, name: ledger.name, updatedAt: ledger.updatedAt } });
    }
    return ledger;
  });
}

/** 归档。返回它是不是当前账本（是的话调用方整页重新载入，当前账本已换到下一本未归档的）。 */
export function archiveGuestBook(bookId: string): Promise<{ readonly wasCurrent: boolean }> {
  return serial(async () => {
    const current = await requireData();
    await archiveGuestLedger(requireGuestId(), bookId);
    await listGuestLedgers();
    return { wasCurrent: current.book.id === bookId };
  });
}

export function restoreGuestBook(bookId: string): Promise<GuestLedger> {
  return serial(async () => {
    await requireData();
    const ledger = await restoreGuestLedger(requireGuestId(), bookId);
    await listGuestLedgers();
    return ledger;
  });
}

/** 永久删除。返回它是不是当前账本（是的话调用方整页重新载入）。 */
export function deleteGuestBook(bookId: string): Promise<{ readonly wasCurrent: boolean }> {
  return serial(async () => {
    const current = await requireData();
    await deleteGuestLedger(requireGuestId(), bookId);
    await listGuestLedgers();
    return { wasCurrent: current.book.id === bookId };
  });
}

/* ------------------------------------------------------------------ */
/* 正式账号会话里读写某个游客的某本账（账本导入页）                        */
/* ------------------------------------------------------------------ */

/**
 * 这个游客的全部账本（账本导入页选择来源用）。会先跑一遍迁移，但**不会新建账本**：没有账本就返回空列表。
 */
export async function listGuestLedgersFor(guestId: string): Promise<readonly GuestLedger[]> {
  return (await ensureGuestWorkspace(guestId, { create: false })).ledgers;
}

/** 只读某个游客的某本账；没有这本账或没有数据时返回 `null`（不种子、不写）。 */
export async function readGuestBookFor(guestId: string, bookId: string): Promise<GuestData | null> {
  const ledger = (await listGuestLedgersFor(guestId)).find((entry) => entry.id === bookId);
  if (ledger === undefined) return null;
  const read = await readGuestBook(guestId, ledger);
  if (read.status === "ok") return read.data;
  if (read.status === "absent") return null;
  throw new Error(
    read.status === "unreadable" ? t("account.guest.errors.storageUnavailable") : t("account.guest.errors.unrecognisedData"),
  );
}

async function updateGuestBookFor(
  guestId: string,
  bookId: string,
  change: (data: GuestData) => GuestData | undefined,
): Promise<GuestData | null> {
  const ledger = (await listGuestLedgersFor(guestId)).find((entry) => entry.id === bookId);
  if (ledger === undefined) throw new Error(t("account.guest.errors.ledgerGone"));
  const next = await updateGuestBook(guestId, ledger, change);
  // 同一个游客的这本账恰好就是内存里的当前账本（少见）：一起更新，免得下一次写入用旧快照覆盖回去。
  if (next !== null && snapshotGuestId === guestId && snapshot?.book.id === bookId) publish(next);
  return next;
}

/**
 * D5 phase 3: remove only guest rows that the server confirmed are safely present in the
 * target. The removed copies are kept in the same local blob (`cleanup`) so they can be
 * restored from this device; no other guest data is touched.
 *
 * 多账本：按 `(游客 id, 游客账本 id)` 清理那一本账，与当前账本无关。
 */
export async function cleanupMigratedGuestBook(
  guestId: string,
  bookId: string,
  ids: readonly string[],
): Promise<{ readonly removed: number; readonly remaining: number; readonly archived: number }> {
  const wanted = new Set(ids);
  let removed = 0;
  const next = await updateGuestBookFor(guestId, bookId, (data) => {
    const moving = data.transactions.filter((entry) => wanted.has(entry.id));
    removed = moving.length;
    if (moving.length === 0) return undefined;
    return {
      ...data,
      book: { ...data.book, updatedAt: nowIso() },
      transactions: data.transactions.filter((entry) => !wanted.has(entry.id)),
      cleanup: [
        ...((data.cleanup ?? []).filter((entry) => !moving.some((item) => item.id === entry.id))),
        ...moving,
      ],
    };
  });
  return {
    removed,
    remaining: next?.transactions.length ?? 0,
    archived: next?.cleanup?.length ?? 0,
  };
}

/** 把清理留档里的账目放回那本游客账本。返回放回的笔数。 */
export async function restoreGuestBookCleanup(guestId: string, bookId: string, ids: readonly string[]): Promise<number> {
  const wanted = new Set(ids);
  let restored = 0;
  await updateGuestBookFor(guestId, bookId, (data) => {
    const back = (data.cleanup ?? []).filter((entry) => wanted.has(entry.id));
    restored = back.length;
    if (back.length === 0) return undefined;
    return {
      ...data,
      book: { ...data.book, updatedAt: nowIso() },
      transactions: [...data.transactions, ...back],
      cleanup: (data.cleanup ?? []).filter((entry) => !wanted.has(entry.id)),
    };
  });
  return restored;
}

export function guestCleanupTransactions(data: GuestData | null): readonly Transaction[] {
  return data?.cleanup ?? [];
}

/* ------------------------------------------------------------------ */
/* Entries — always the current ledger                                  */
/* ------------------------------------------------------------------ */

function liveCategories(data: GuestData, kind: TransactionKind): readonly Category[] {
  return data.categories.filter((category) => category.kind === kind && !category.isArchived);
}

function resolveCategory(
  data: GuestData,
  kind: TransactionKind,
  categoryId: string | null | undefined,
  fallback: Category | undefined,
): Category {
  const candidates = liveCategories(data, kind);
  const chosen =
    (categoryId == null ? undefined : candidates.find((category) => category.id === categoryId)) ??
    fallback ??
    candidates.find((category) => category.isSystem) ??
    candidates[0];

  if (chosen === undefined) {
    throw new Error(t("account.guest.errors.noCategory"));
  }

  return chosen;
}

function resolvePaymentMethod(
  data: GuestData,
  paymentMethodId: string | null | undefined,
  fallback: PaymentMethod | null | undefined,
): PaymentMethod | null {
  const candidates = data.paymentMethods.filter((method) => !method.isArchived);
  if (paymentMethodId == null) return fallback ?? null;
  return candidates.find((method) => method.id === paymentMethodId) ?? fallback ?? null;
}

function resolveTags(data: GuestData, tagIds: readonly string[] | undefined): readonly Tag[] {
  if (tagIds === undefined) return [];
  return tagIds
    .map((tagId) => data.tags.find((tag) => tag.id === tagId))
    .filter((tag): tag is Tag => tag !== undefined);
}

/** Create an entry exactly the way the account path does: client-minted id, local truth first. */
export function createGuestTransaction(input: CreateTransactionInput): Promise<Transaction> {
  return serial(async () => {
    const data = await requireData();

    const existing = data.transactions.find((entry) => entry.id === input.id);
    if (existing !== undefined) return existing;

    const category = resolveCategory(data, input.kind, input.categoryId, undefined);
    const paymentMethod = resolvePaymentMethod(data, input.paymentMethodId, undefined);
    const tags = resolveTags(data, input.tagIds);

    const transaction: Transaction = {
      id: input.id,
      seq: data.nextSeq,
      kind: input.kind,
      amountCents: input.amountCents,
      currency: input.currency,
      categoryId: category.id,
      categoryName: category.name,
      categoryIsSystem: category.isSystem,
      paymentMethodId: paymentMethod?.id ?? null,
      paymentMethodName: paymentMethod?.name ?? null,
      occurredAt: input.occurredAt,
      occurredLocalDate: input.occurredLocalDate,
      occurredTz: input.occurredTz,
      note: input.note ?? null,
      tags: [...tags],
      version: 1,
    };

    const next: GuestData = {
      ...data,
      book: { ...data.book, updatedAt: nowIso() },
      transactions: [...data.transactions, transaction],
      nextSeq: data.nextSeq + 1,
    };

    await persist(next);
    return transaction;
  });
}

export function updateGuestTransaction(
  id: string,
  input: UpdateTransactionInput,
  apply: (current: Transaction) => Transaction,
): Promise<Transaction | null> {
  return serial(async () => {
    const data = await requireData();
    const current = data.transactions.find((entry) => entry.id === id);
    if (current === undefined) return null;

    const applied = apply(current);
    const kind = input.kind ?? applied.kind;
    const category = resolveCategory(data, kind, input.categoryId, undefined);
    const paymentMethod = resolvePaymentMethod(
      data,
      input.paymentMethodId,
      input.paymentMethodId === undefined
        ? data.paymentMethods.find((method) => method.id === applied.paymentMethodId) ?? null
        : null,
    );
    const tags = input.tagIds === undefined ? applied.tags : [...resolveTags(data, input.tagIds)];

    const nextEntry: Transaction = {
      ...applied,
      kind,
      amountCents: input.amountCents ?? applied.amountCents,
      currency: input.currency ?? applied.currency,
      categoryId: category.id,
      categoryName: category.name,
      categoryIsSystem: category.isSystem,
      paymentMethodId: paymentMethod?.id ?? null,
      paymentMethodName: paymentMethod?.name ?? null,
      occurredAt: input.occurredAt ?? applied.occurredAt,
      occurredLocalDate: input.occurredLocalDate ?? applied.occurredLocalDate,
      occurredTz: input.occurredTz ?? applied.occurredTz,
      note: input.note === undefined ? applied.note : (input.note ?? null),
      tags,
      version: current.version + 1,
    };

    const next: GuestData = {
      ...data,
      book: { ...data.book, updatedAt: nowIso() },
      transactions: data.transactions.map((entry) => (entry.id === id ? nextEntry : entry)),
    };

    await persist(next);
    return nextEntry;
  });
}

export function deleteGuestTransaction(id: string): Promise<void> {
  return serial(async () => {
    const data = await requireData();
    const current = data.transactions.find((entry) => entry.id === id);
    if (current === undefined) return;

    const next: GuestData = {
      ...data,
      book: { ...data.book, updatedAt: nowIso() },
      transactions: data.transactions.filter((entry) => entry.id !== id),
      deleted: [...data.deleted.filter((entry) => entry.id !== id), current],
    };

    await persist(next);
  });
}

export function restoreGuestTransaction(id: string): Promise<Transaction | null> {
  return serial(async () => {
    const data = await requireData();
    const deleted = data.deleted.find((entry) => entry.id === id);
    if (deleted === undefined) return null;

    const restored: Transaction = { ...deleted, version: deleted.version + 1 };

    const next: GuestData = {
      ...data,
      book: { ...data.book, updatedAt: nowIso() },
      transactions: [...data.transactions, restored],
      deleted: data.deleted.filter((entry) => entry.id !== id),
    };

    await persist(next);
    return restored;
  });
}

/* ------------------------------------------------------------------ */
/* Classification (categories / payment methods / tags)                 */
/*                                                                      */
/* `bookId` 省略或等于当前账本：改当前快照；否则改那本账的 blob。          */
/* ------------------------------------------------------------------ */

function nextSortOrder(items: readonly { readonly sortOrder: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.sortOrder + 1), 0);
}

function assertUniqueName(
  existing: readonly { readonly id: string; readonly name: string }[],
  name: string,
  id?: string,
): void {
  if (existing.some((entry) => entry.id !== id && entry.name === name)) {
    throw new Error(t("account.guest.errors.duplicateName"));
  }
}

export function createGuestCategory(input: CreateCategoryInput, bookId?: string): Promise<Category> {
  return serial(async () => {
    const data = await requireTarget(bookId);
    const name = input.name.trim();
    assertUniqueName(
      data.categories.filter((category) => category.kind === input.kind && (category.parentId ?? null) === (input.parentId ?? null)),
      name,
    );

    const category: Category = {
      parentId: input.parentId ?? null, icon: input.icon ?? null, color: input.color ?? null,
      id: newGuestEntityId(),
      name,
      kind: input.kind,
      description: null,
      isSystem: false,
      isArchived: false,
      sortOrder: input.sortOrder ?? nextSortOrder(data.categories.filter((entry) => entry.kind === input.kind)),
    };

    validateCategoryTree([...data.categories, category]);
    await persist({ ...data, categories: [...data.categories, category] });
    return category;
  });
}

async function updateCategoryIn(data: GuestData, id: string, input: UpdateCategoryInput): Promise<Category> {
  const current = data.categories.find((category) => category.id === id);
  if (current === undefined) throw new Error(t("account.guest.errors.categoryGone"));
  if (current.isSystem) throw new Error(t("account.guest.errors.systemCategoryEdit"));

  const name = input.name === undefined ? current.name : input.name.trim();
  assertUniqueName(
    data.categories.filter((category) => category.kind === current.kind && (category.parentId ?? null) === (input.parentId === undefined ? current.parentId ?? null : input.parentId)),
    name,
    id,
  );

  const updated: Category = {
    ...current,
    ...(input.parentId === undefined ? {} : {parentId:input.parentId}),
    ...(input.icon === undefined ? {} : {icon:input.icon}),
    ...(input.color === undefined ? {} : {color:input.color}),
    name,
    description: input.name === undefined ? current.description : null,
    isArchived: input.isArchived ?? current.isArchived,
    sortOrder: input.sortOrder ?? current.sortOrder,
  };

  const categories = data.categories.map((category) => (category.id === id ? updated : category));
  validateCategoryTree(categories);
  await persist({ ...data, categories });
  return updated;
}

export function updateGuestCategory(
  id: string,
  input: UpdateCategoryInput,
  bookId?: string,
): Promise<Category> {
  return serial(async () => updateCategoryIn(await requireTarget(bookId), id, input));
}

export function archiveGuestCategory(id: string, bookId?: string): Promise<Category> {
  return updateGuestCategory(id, { isArchived: true }, bookId);
}

export function deleteGuestCategory(
  id: string,
  replacementCategoryId?: string | null,
  bookId?: string,
): Promise<ClassificationDeleteResponse> {
  return serial(async () => {
    const data = await requireTarget(bookId);
    const current = data.categories.find((category) => category.id === id);
    if (current === undefined) {
      return { affectedEntries: 0, replacementId: null, replacementName: null, operationId: newGuestEntityId() };
    }
    if (current.isSystem) throw new Error(t("account.guest.errors.systemCategoryDelete"));

    const replacement =
      replacementCategoryId == null
        ? data.categories.find(
            (category) => category.kind === current.kind && category.isSystem === true,
          )
        : data.categories.find((category) => category.id === replacementCategoryId);

    if (replacement === undefined) throw new Error(t("account.guest.errors.noReplacement"));

    let moved = 0;
    const transactions = data.transactions.map((entry) => {
      if (entry.categoryId !== id) return entry;
      moved += 1;
      return {
        ...entry,
        categoryId: replacement.id,
        categoryName: replacement.name,
        categoryIsSystem: replacement.isSystem,
        version: entry.version + 1,
      };
    });

    const deleted = data.deleted.map((entry) =>
      entry.categoryId === id
        ? { ...entry, categoryId: replacement.id, categoryName: replacement.name }
        : entry,
    );

    const categories = data.categories.filter(category => category.id !== id).map(category => category.parentId === id ? {...category,parentId:current.parentId ?? null} : category);
    validateCategoryTree(categories);
    await persist({
      ...data,
      categories,
      transactions,
      deleted,
    });

    return {
      affectedEntries: moved,
      replacementId: replacement.id,
      replacementName: replacement.name,
      operationId: newGuestEntityId(),
    };
  });
}

export function createGuestPaymentMethod(
  input: CreatePaymentMethodInput,
  bookId?: string,
): Promise<PaymentMethod> {
  return serial(async () => {
    const data = await requireTarget(bookId);
    const name = input.name.trim();
    assertUniqueName(data.paymentMethods, name);

    const method: PaymentMethod = {
      id: newGuestEntityId(),
      name,
      isArchived: false,
      sortOrder: input.sortOrder ?? nextSortOrder(data.paymentMethods),
    };

    await persist({ ...data, paymentMethods: [...data.paymentMethods, method] });
    return method;
  });
}

async function updatePaymentMethodIn(
  data: GuestData,
  id: string,
  input: UpdatePaymentMethodInput,
): Promise<PaymentMethod> {
  const current = data.paymentMethods.find((method) => method.id === id);
  if (current === undefined) throw new Error(t("account.guest.errors.paymentMethodGone"));

  const name = input.name === undefined ? current.name : input.name.trim();
  assertUniqueName(data.paymentMethods, name, id);

  const updated: PaymentMethod = {
    ...current,
    name,
    isArchived: input.isArchived ?? current.isArchived,
    sortOrder: input.sortOrder ?? current.sortOrder,
  };

  await persist({
    ...data,
    paymentMethods: data.paymentMethods.map((method) => (method.id === id ? updated : method)),
  });
  return updated;
}

export function updateGuestPaymentMethod(
  id: string,
  input: UpdatePaymentMethodInput,
  bookId?: string,
): Promise<PaymentMethod> {
  return serial(async () => updatePaymentMethodIn(await requireTarget(bookId), id, input));
}

export function archiveGuestPaymentMethod(id: string, bookId?: string): Promise<PaymentMethod> {
  return updateGuestPaymentMethod(id, { isArchived: true }, bookId);
}

export function deleteGuestPaymentMethod(
  id: string,
  replacementPaymentMethodId?: string | null,
  bookId?: string,
): Promise<ClassificationDeleteResponse> {
  return serial(async () => {
    const data = await requireTarget(bookId);
    if (!data.paymentMethods.some((method) => method.id === id)) {
      return { affectedEntries: 0, replacementId: null, replacementName: null, operationId: newGuestEntityId() };
    }

    const replacement =
      replacementPaymentMethodId == null
        ? undefined
        : data.paymentMethods.find((method) => method.id === replacementPaymentMethodId);

    let moved = 0;
    const transactions = data.transactions.map((entry) => {
      if (entry.paymentMethodId !== id) return entry;
      moved += 1;
      return {
        ...entry,
        paymentMethodId: replacement?.id ?? null,
        paymentMethodName: replacement?.name ?? null,
        version: entry.version + 1,
      };
    });

    const deleted = data.deleted.map((entry) =>
      entry.paymentMethodId === id
        ? { ...entry, paymentMethodId: replacement?.id ?? null, paymentMethodName: replacement?.name ?? null }
        : entry,
    );

    await persist({
      ...data,
      paymentMethods: data.paymentMethods.filter((method) => method.id !== id),
      transactions,
      deleted,
    });

    return {
      affectedEntries: moved,
      replacementId: replacement?.id ?? null,
      replacementName: replacement?.name ?? null,
      operationId: newGuestEntityId(),
    };
  });
}

export function createGuestTag(input: CreateTagInput, bookId?: string): Promise<Tag> {
  return serial(async () => {
    const data = await requireTarget(bookId);
    const name = input.name.trim();
    assertUniqueName(data.tags, name);

    const tag: Tag = { id: newGuestEntityId(), name, color: input.color };
    await persist({ ...data, tags: [...data.tags, tag] });
    return tag;
  });
}

export function updateGuestTag(id: string, input: UpdateTagInput, bookId?: string): Promise<Tag> {
  return serial(async () => {
    const data = await requireTarget(bookId);
    const current = data.tags.find((tag) => tag.id === id);
    if (current === undefined) throw new Error(t("account.guest.errors.tagGone"));

    const name = input.name === undefined ? current.name : input.name.trim();
    assertUniqueName(data.tags, name, id);

    const updated: Tag = {
      ...current,
      name,
      color: input.color ?? current.color,
    };

    await persist({ ...data, tags: data.tags.map((tag) => (tag.id === id ? updated : tag)) });
    return updated;
  });
}

export function deleteGuestTag(id: string, bookId?: string): Promise<ClassificationDeleteResponse> {
  return serial(async () => {
    const data = await requireTarget(bookId);
    if (!data.tags.some((tag) => tag.id === id)) {
      return { affectedEntries: 0, replacementId: null, replacementName: null, operationId: newGuestEntityId() };
    }

    let moved = 0;
    const strip = (entry: Transaction): Transaction => {
      if (!entry.tags.some((tag) => tag.id === id)) return entry;
      moved += 1;
      return { ...entry, tags: entry.tags.filter((tag) => tag.id !== id) };
    };

    await persist({
      ...data,
      tags: data.tags.filter((tag) => tag.id !== id),
      transactions: data.transactions.map(strip),
      deleted: data.deleted.map(strip),
    });

    return {
      affectedEntries: moved,
      replacementId: null,
      replacementName: null,
      operationId: newGuestEntityId(),
    };
  });
}

/** Usage counts for the classification screens, from the local entries only (`data` 省略时是当前账本). */
export function guestClassificationUsage(data: GuestData | null = snapshot): {
  readonly categories: Readonly<Record<string, number>>;
  readonly paymentMethods: Readonly<Record<string, number>>;
  readonly tags: Readonly<Record<string, number>>;
} {
  const categories: Record<string, number> = {};
  const paymentMethods: Record<string, number> = {};
  const tags: Record<string, number> = {};

  for (const entry of data?.transactions ?? []) {
    categories[entry.categoryId] = (categories[entry.categoryId] ?? 0) + 1;
    if (entry.paymentMethodId !== null) {
      paymentMethods[entry.paymentMethodId] = (paymentMethods[entry.paymentMethodId] ?? 0) + 1;
    }
    for (const tag of entry.tags) tags[tag.id] = (tags[tag.id] ?? 0) + 1;
  }

  return { categories, paymentMethods, tags };
}
