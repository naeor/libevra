/**
 * The guest ledger's local data — the **same shapes the server returns**, stored in `libellum-guest`.
 *
 * ⚠️ **This is a data adapter, not a second application.** S14-C replaced the S14-B "guest workspace"
 * with the real Libevra screens; those screens already know how to render `Transaction`,
 * `LedgerMetaResponse`, `SummaryResponse` and `StatsResponse`. So the guest side produces exactly
 * those shapes from IndexedDB, and the pages do not branch on "guest or account" for their layout.
 *
 * ⚠️ **Why one blob instead of a table per entity.** The guest ledger lives on one device, has one
 * writer (this browser), and is read whole by the screens that need it; the account side reached the
 * same conclusion for its offline copy (`offline/storage.ts` is a key–value store, not a mirror of
 * the Prisma schema). The blob is versioned with `schemaVersion`, so the next stage can migrate it
 * without guessing.
 *
 * ⚠️ **Nothing here talks to the server, and nothing here uses the account stores.** In particular
 * it does not write `ledger-marks`, the query cache, the outbox or the offline scope; the guest data
 * is not part of any sync queue. See `../offline/storage.ts` for why the database itself is separate.
 */
import {
  UNCATEGORISED,
  categoriesFor,
  PAYMENT_METHOD_NAMES,
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

import { createDefaultGuestLedger, type GuestLedger } from "./ledger.js";
import { guestKey, readGuestValue, writeGuestValue } from "./storage.js";

export const GUEST_DATA_SCHEMA_VERSION = 1;
const DATA_NAME = "data";

export interface GuestData {
  readonly schemaVersion: typeof GUEST_DATA_SCHEMA_VERSION;
  readonly book: GuestLedger;
  readonly categories: readonly Category[];
  readonly paymentMethods: readonly PaymentMethod[];
  readonly tags: readonly Tag[];
  readonly transactions: readonly Transaction[];
  /** Entries the guest deleted, kept so the undo button can restore them. */
  readonly deleted: readonly Transaction[];
  readonly nextSeq: number;
}

function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nowIso(): string {
  return new Date().toISOString();
}

function validCategory(value: unknown): value is Category {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["name"] === "string" &&
    (candidate["kind"] === "income" || candidate["kind"] === "expense") &&
    typeof candidate["isSystem"] === "boolean" &&
    typeof candidate["isArchived"] === "boolean" &&
    typeof candidate["sortOrder"] === "number"
  );
}

function validPaymentMethod(value: unknown): value is PaymentMethod {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["name"] === "string" &&
    typeof candidate["isArchived"] === "boolean" &&
    typeof candidate["sortOrder"] === "number"
  );
}

function validTag(value: unknown): value is Tag {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    typeof candidate["name"] === "string" &&
    typeof candidate["color"] === "string"
  );
}

function validTransaction(value: unknown): value is Transaction {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["id"] === "string" &&
    (candidate["kind"] === "income" || candidate["kind"] === "expense") &&
    typeof candidate["amountCents"] === "number" &&
    typeof candidate["currency"] === "string" &&
    typeof candidate["categoryId"] === "string" &&
    typeof candidate["categoryName"] === "string" &&
    typeof candidate["occurredAt"] === "string" &&
    typeof candidate["occurredLocalDate"] === "string" &&
    typeof candidate["version"] === "number"
  );
}

function presetCategories(): Category[] {
  const categories: Category[] = [];
  let order = 0;

  for (const kind of ["expense", "income"] as const) {
    for (const preset of categoriesFor(kind)) {
      categories.push({
        id: newId(),
        name: preset.name,
        kind,
        description: preset.description,
        isSystem: false,
        isArchived: false,
        sortOrder: order,
      });
      order += 1;
    }
  }

  for (const kind of ["expense", "income"] as const) {
    categories.push({
      id: newId(),
      name: UNCATEGORISED.name,
      kind,
      description: null,
      isSystem: true,
      isArchived: false,
      sortOrder: 9_000,
    });
  }

  return categories;
}

function presetPaymentMethods(): PaymentMethod[] {
  return PAYMENT_METHOD_NAMES.map((name, index) => ({
    id: newId(),
    name,
    isArchived: false,
    sortOrder: index,
  }));
}

function seedData(book: GuestLedger): GuestData {
  return {
    schemaVersion: GUEST_DATA_SCHEMA_VERSION,
    book,
    categories: presetCategories(),
    paymentMethods: presetPaymentMethods(),
    tags: [],
    transactions: [],
    deleted: [],
    nextSeq: 1,
  };
}

/** Read a persisted blob defensively; a damaged blob is treated as absent rather than rendered. */
function normalizeData(value: unknown, book: GuestLedger): GuestData | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate["schemaVersion"] !== GUEST_DATA_SCHEMA_VERSION) return null;

  const categories = Array.isArray(candidate["categories"])
    ? candidate["categories"].filter(validCategory)
    : [];
  const paymentMethods = Array.isArray(candidate["paymentMethods"])
    ? candidate["paymentMethods"].filter(validPaymentMethod)
    : [];
  const tags = Array.isArray(candidate["tags"]) ? candidate["tags"].filter(validTag) : [];
  const transactions = Array.isArray(candidate["transactions"])
    ? candidate["transactions"].filter(validTransaction)
    : [];
  const deleted = Array.isArray(candidate["deleted"])
    ? candidate["deleted"].filter(validTransaction)
    : [];
  const storedBook =
    typeof candidate["book"] === "object" && candidate["book"] !== null
      ? (candidate["book"] as GuestLedger)
      : book;

  return {
    schemaVersion: GUEST_DATA_SCHEMA_VERSION,
    book: storedBook,
    categories,
    paymentMethods,
    tags,
    transactions,
    deleted,
    nextSeq:
      typeof candidate["nextSeq"] === "number" && candidate["nextSeq"] > 0
        ? candidate["nextSeq"]
        : transactions.length + 1,
  };
}

/* ------------------------------------------------------------------ */
/* In-memory snapshot + subscription                                    */
/* ------------------------------------------------------------------ */

let snapshot: GuestData | null = null;
let snapshotGuestId: string | null = null;
let loadPromise: Promise<GuestData | null> | null = null;
const listeners = new Set<() => void>();

export function guestDataValue(): GuestData | null {
  return snapshot;
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
  loadPromise = null;
  publish(null);
}

function ledgerKey(guestId: string): string {
  return guestKey(guestId, DATA_NAME);
}

/** The S14-B ledger registry, used only to preserve an existing guest's ledger name/id. */
async function existingBook(guestId: string): Promise<GuestLedger> {
  const stored = await readGuestValue<unknown>(guestKey(guestId, "ledgers"));
  if (Array.isArray(stored)) {
    const first = stored.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as GuestLedger).id === "string" &&
        typeof (entry as GuestLedger).name === "string",
    ) as GuestLedger | undefined;
    if (first !== undefined) return first;
  }

  return createDefaultGuestLedger();
}

/**
 * Load the guest ledger, creating it (and its preset categories/payment methods) on first use.
 *
 * Idempotent and cached per identity. Never deletes the S14-B ledger registry: an identity created
 * in S14-B keeps its original book id and name when S14-C first opens the real screens.
 */
export async function ensureGuestData(guestId: string): Promise<GuestData | null> {
  if (snapshot !== null && snapshotGuestId === guestId) return snapshot;
  if (loadPromise !== null && snapshotGuestId === guestId) return loadPromise;

  snapshotGuestId = guestId;
  loadPromise = (async () => {
    const book = await existingBook(guestId);
    const stored = await readGuestValue<unknown>(ledgerKey(guestId));
    const normalized = normalizeData(stored, book);
    const data = normalized ?? seedData(book);

    if (normalized === null) {
      await writeGuestValue(ledgerKey(guestId), data);
    }

    publish(data);
    return data;
  })();

  return loadPromise;
}

/** Re-read the store from IndexedDB (used by the ledger's refresh button in guest mode). */
export async function reloadGuestData(guestId: string): Promise<GuestData | null> {
  resetGuestDataCache();
  return ensureGuestData(guestId);
}

async function persist(data: GuestData): Promise<void> {
  const written = await writeGuestValue(ledgerKey(requireGuestId()), data);
  if (!written) {
    throw new Error("游客数据暂时无法保存。请检查浏览器是否允许网站保存数据。");
  }
  publish(data);
}

function requireGuestId(): string {
  if (snapshotGuestId === null) throw new Error("游客身份尚未准备好。");
  return snapshotGuestId;
}

async function requireData(): Promise<GuestData> {
  if (snapshot === null) {
    const loaded = await ensureGuestData(requireGuestId());
    if (loaded === null) throw new Error("游客账本暂时打不开。");
    return loaded;
  }
  return snapshot;
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
/* Entries                                                              */
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
    throw new Error("这个账本还没有可用的分类。");
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
export async function createGuestTransaction(input: CreateTransactionInput): Promise<Transaction> {
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
}

export async function updateGuestTransaction(
  id: string,
  input: UpdateTransactionInput,
  apply: (current: Transaction) => Transaction,
): Promise<Transaction | null> {
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
}

export async function deleteGuestTransaction(id: string): Promise<void> {
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
}

export async function restoreGuestTransaction(id: string): Promise<Transaction | null> {
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
}

/* ------------------------------------------------------------------ */
/* Classification (categories / payment methods / tags)                 */
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
    throw new Error("已经有一个同名的项目了。");
  }
}

export async function createGuestCategory(input: CreateCategoryInput): Promise<Category> {
  const data = await requireData();
  const name = input.name.trim();
  assertUniqueName(
    data.categories.filter((category) => category.kind === input.kind),
    name,
  );

  const category: Category = {
    id: newId(),
    name,
    kind: input.kind,
    description: null,
    isSystem: false,
    isArchived: false,
    sortOrder: input.sortOrder ?? nextSortOrder(data.categories.filter((entry) => entry.kind === input.kind)),
  };

  await persist({ ...data, categories: [...data.categories, category] });
  return category;
}

export async function updateGuestCategory(
  id: string,
  input: UpdateCategoryInput,
): Promise<Category> {
  const data = await requireData();
  const current = data.categories.find((category) => category.id === id);
  if (current === undefined) throw new Error("这个分类已经不存在了。");
  if (current.isSystem) throw new Error("系统分类不能修改。");

  const name = input.name === undefined ? current.name : input.name.trim();
  assertUniqueName(
    data.categories.filter((category) => category.kind === current.kind),
    name,
    id,
  );

  const updated: Category = {
    ...current,
    name,
    description: input.name === undefined ? current.description : null,
    isArchived: input.isArchived ?? current.isArchived,
    sortOrder: input.sortOrder ?? current.sortOrder,
  };

  await persist({
    ...data,
    categories: data.categories.map((category) => (category.id === id ? updated : category)),
  });
  return updated;
}

export async function archiveGuestCategory(id: string): Promise<Category> {
  return updateGuestCategory(id, { isArchived: true });
}

export async function deleteGuestCategory(
  id: string,
  replacementCategoryId?: string | null,
): Promise<ClassificationDeleteResponse> {
  const data = await requireData();
  const current = data.categories.find((category) => category.id === id);
  if (current === undefined) {
    return { affectedEntries: 0, replacementId: null, replacementName: null, operationId: newId() };
  }
  if (current.isSystem) throw new Error("系统分类不能删除。");

  const replacement =
    replacementCategoryId == null
      ? data.categories.find(
          (category) => category.kind === current.kind && category.isSystem === true,
        )
      : data.categories.find((category) => category.id === replacementCategoryId);

  if (replacement === undefined) throw new Error("还没有可用来接收历史账目的分类。");

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

  await persist({
    ...data,
    categories: data.categories.filter((category) => category.id !== id),
    transactions,
    deleted,
  });

  return {
    affectedEntries: moved,
    replacementId: replacement.id,
    replacementName: replacement.name,
    operationId: newId(),
  };
}

export async function createGuestPaymentMethod(
  input: CreatePaymentMethodInput,
): Promise<PaymentMethod> {
  const data = await requireData();
  const name = input.name.trim();
  assertUniqueName(data.paymentMethods, name);

  const method: PaymentMethod = {
    id: newId(),
    name,
    isArchived: false,
    sortOrder: input.sortOrder ?? nextSortOrder(data.paymentMethods),
  };

  await persist({ ...data, paymentMethods: [...data.paymentMethods, method] });
  return method;
}

export async function updateGuestPaymentMethod(
  id: string,
  input: UpdatePaymentMethodInput,
): Promise<PaymentMethod> {
  const data = await requireData();
  const current = data.paymentMethods.find((method) => method.id === id);
  if (current === undefined) throw new Error("这个支付方式已经不存在了。");

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

export async function archiveGuestPaymentMethod(id: string): Promise<PaymentMethod> {
  return updateGuestPaymentMethod(id, { isArchived: true });
}

export async function deleteGuestPaymentMethod(
  id: string,
  replacementPaymentMethodId?: string | null,
): Promise<ClassificationDeleteResponse> {
  const data = await requireData();
  if (!data.paymentMethods.some((method) => method.id === id)) {
    return { affectedEntries: 0, replacementId: null, replacementName: null, operationId: newId() };
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
    operationId: newId(),
  };
}

export async function createGuestTag(input: CreateTagInput): Promise<Tag> {
  const data = await requireData();
  const name = input.name.trim();
  assertUniqueName(data.tags, name);

  const tag: Tag = { id: newId(), name, color: input.color };
  await persist({ ...data, tags: [...data.tags, tag] });
  return tag;
}

export async function updateGuestTag(id: string, input: UpdateTagInput): Promise<Tag> {
  const data = await requireData();
  const current = data.tags.find((tag) => tag.id === id);
  if (current === undefined) throw new Error("这个标签已经不存在了。");

  const name = input.name === undefined ? current.name : input.name.trim();
  assertUniqueName(data.tags, name, id);

  const updated: Tag = {
    ...current,
    name,
    color: input.color ?? current.color,
  };

  await persist({ ...data, tags: data.tags.map((tag) => (tag.id === id ? updated : tag)) });
  return updated;
}

export async function deleteGuestTag(id: string): Promise<ClassificationDeleteResponse> {
  const data = await requireData();
  if (!data.tags.some((tag) => tag.id === id)) {
    return { affectedEntries: 0, replacementId: null, replacementName: null, operationId: newId() };
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
    operationId: newId(),
  };
}

/** Usage counts for the classification screens, from the local entries only. */
export function guestClassificationUsage(): {
  readonly categories: Readonly<Record<string, number>>;
  readonly paymentMethods: Readonly<Record<string, number>>;
  readonly tags: Readonly<Record<string, number>>;
} {
  const categories: Record<string, number> = {};
  const paymentMethods: Record<string, number> = {};
  const tags: Record<string, number> = {};

  for (const entry of snapshot?.transactions ?? []) {
    categories[entry.categoryId] = (categories[entry.categoryId] ?? 0) + 1;
    if (entry.paymentMethodId !== null) {
      paymentMethods[entry.paymentMethodId] = (paymentMethods[entry.paymentMethodId] ?? 0) + 1;
    }
    for (const tag of entry.tags) tags[tag.id] = (tags[tag.id] ?? 0) + 1;
  }

  return { categories, paymentMethods, tags };
}
