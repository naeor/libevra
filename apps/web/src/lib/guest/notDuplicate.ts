import {
  buildNotDuplicateBasis,
  expandNotDuplicatePairs,
  isNotDuplicateBasisStale,
  normalizeNotDuplicatePair,
  readNotDuplicateBasis,
  type CreateNotDuplicateRelationsInput,
  type NotDuplicateBasis,
  type NotDuplicateBasisTransaction,
  type NotDuplicateRelation,
  type NotDuplicateRelationListResponse,
  type NotDuplicateRelationMutationResponse,
  type NotDuplicateRelationTransaction,
  type Transaction,
} from "@libellum/shared";

import { guestDataValue } from "./data.js";
import { guestKey, readGuestValue, writeGuestValue } from "./storage.js";

/**
 * 游客的「不是重复」关系：存在游客库 `libellum-guest` 的一个键里（`guest:<游客id>:not-duplicate`）。
 *
 * ⚠️ 与账号的关系互不相通：账号关系在服务器，游客关系只在这台设备；“清除游客数据”会连库一起删掉，
 * 所以不需要再登记 localStorage 清理名单。判定规则（哪些字段变了就失效）复用 `@libellum/shared`
 * 的 `isNotDuplicateBasisStale`，与服务器同一份定义。
 */

const NAME = "not-duplicate";

interface StoredRelation {
  readonly id: string;
  readonly transactionAId: string;
  readonly transactionBId: string;
  readonly decisionSource: NotDuplicateRelation["decisionSource"];
  readonly decidedAt: string;
  readonly revokedAt: string | null;
  readonly basis: NotDuplicateBasis;
}

interface StoredFile {
  readonly version: 1;
  readonly items: readonly StoredRelation[];
}

function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

async function readFile(guestId: string): Promise<StoredFile> {
  const value = await readGuestValue<StoredFile>(guestKey(guestId, NAME));
  if (value === null || value.version !== 1 || !Array.isArray(value.items)) return { version: 1, items: [] };
  return value;
}

async function writeFile(guestId: string, items: readonly StoredRelation[]): Promise<void> {
  const ok = await writeGuestValue(guestKey(guestId, NAME), { version: 1, items } satisfies StoredFile);
  if (!ok) throw new Error("guest_not_duplicate_write_failed");
}

interface Lookup {
  readonly get: (id: string) => { readonly transaction: Transaction; readonly deleted: boolean } | null;
  readonly bookId: string;
}

function lookup(): Lookup {
  const data = guestDataValue();
  const map = new Map<string, { transaction: Transaction; deleted: boolean }>();
  for (const transaction of data?.deleted ?? []) map.set(transaction.id, { transaction, deleted: true });
  for (const transaction of data?.transactions ?? []) map.set(transaction.id, { transaction, deleted: false });
  return { get: (id) => map.get(id) ?? null, bookId: data?.book.id ?? "" };
}

function basisOf(transaction: Transaction): NotDuplicateBasisTransaction {
  return {
    transactionId: transaction.id,
    seq: transaction.seq ?? 0,
    version: transaction.version,
    amountCents: String(transaction.amountCents),
    currency: transaction.currency,
    kind: transaction.kind,
    occurredAt: transaction.occurredAt,
    occurredLocalDate: transaction.occurredLocalDate,
    occurredTz: transaction.occurredTz,
    categoryId: transaction.categoryId,
    paymentMethodId: transaction.paymentMethodId,
  };
}

function summaryOf(entry: { readonly transaction: Transaction; readonly deleted: boolean } | null): NotDuplicateRelationTransaction | null {
  if (entry === null) return null;
  const { transaction } = entry;
  return {
    id: transaction.id,
    seq: transaction.seq ?? 0,
    occurredAt: transaction.occurredAt,
    occurredLocalDate: transaction.occurredLocalDate,
    amountCents: transaction.amountCents,
    currency: transaction.currency,
    kind: transaction.kind,
    categoryName: transaction.categoryName,
    paymentMethodName: transaction.paymentMethodName,
    deleted: entry.deleted,
  };
}

function toRelation(stored: StoredRelation, source: Lookup): NotDuplicateRelation {
  const a = source.get(stored.transactionAId);
  const b = source.get(stored.transactionBId);
  const staleness = isNotDuplicateBasisStale(readNotDuplicateBasis(stored.basis), {
    a: a === null ? null : basisOf(a.transaction),
    b: b === null ? null : basisOf(b.transaction),
  });
  const bothAlive = a !== null && b !== null && !a.deleted && !b.deleted;

  return {
    id: stored.id,
    bookId: source.bookId,
    transactionAId: stored.transactionAId,
    transactionBId: stored.transactionBId,
    relationship: "not_duplicate",
    decisionSource: stored.decisionSource,
    decidedBy: null,
    decidedByName: null,
    decidedAt: stored.decidedAt,
    revokedAt: stored.revokedAt,
    revokedBy: null,
    revokedByName: null,
    revocationReason: null,
    stale: staleness.stale,
    staleFields: [...staleness.changedFields],
    effective: stored.revokedAt === null && !staleness.stale && bothAlive,
    transactionA: summaryOf(a),
    transactionB: summaryOf(b),
  } as NotDuplicateRelation;
}

/** 读游客的关系列表（没有分页：只在本机，数量有限）。 */
export async function listGuestNotDuplicateRelations(
  guestId: string,
  options: { readonly includeRevoked?: boolean; readonly transactionId?: string } = {},
): Promise<NotDuplicateRelationListResponse> {
  const file = await readFile(guestId);
  const source = lookup();
  const items = file.items
    .filter((item) => options.includeRevoked === true || item.revokedAt === null)
    .filter((item) => options.transactionId === undefined || item.transactionAId === options.transactionId || item.transactionBId === options.transactionId)
    .map((item) => toRelation(item, source))
    .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt));
  return { items, nextCursor: null };
}

/** 记下「不是同一笔」；与服务器一样：撤销过的重新生效，已生效的保持不变。 */
export async function createGuestNotDuplicateRelations(
  guestId: string,
  input: CreateNotDuplicateRelationsInput,
): Promise<NotDuplicateRelationMutationResponse> {
  const pairs = new Map<string, { a: string; b: string }>();
  const add = (left: string, right: string): void => {
    const normalized = normalizeNotDuplicatePair(left, right);
    if (!normalized.ok) return;
    pairs.set(`${normalized.pair.transactionAId}|${normalized.pair.transactionBId}`, { a: normalized.pair.transactionAId, b: normalized.pair.transactionBId });
  };
  for (const pair of input.pairs ?? []) add(pair.transactionIdA, pair.transactionIdB);
  for (const pair of expandNotDuplicatePairs(input.transactionIds ?? [])) add(pair.transactionAId, pair.transactionBId);

  const source = lookup();
  const file = await readFile(guestId);
  const items = [...file.items];
  const touched: StoredRelation[] = [];
  const now = new Date().toISOString();
  let created = 0;
  let reactivated = 0;
  let unchanged = 0;

  for (const { a, b } of pairs.values()) {
    const left = source.get(a);
    const right = source.get(b);
    if (left === null || right === null) continue;
    const basis = buildNotDuplicateBasis(basisOf(left.transaction), basisOf(right.transaction), now);
    const index = items.findIndex((item) => item.transactionAId === a && item.transactionBId === b);
    const decisionSource = input.decisionSource ?? "manual";

    if (index < 0) {
      const next: StoredRelation = { id: newId(), transactionAId: a, transactionBId: b, decisionSource, decidedAt: now, revokedAt: null, basis };
      items.push(next);
      touched.push(next);
      created += 1;
      continue;
    }

    const existing = items[index] as StoredRelation;
    const stale = isNotDuplicateBasisStale(readNotDuplicateBasis(existing.basis), { a: basisOf(left.transaction), b: basisOf(right.transaction) }).stale;
    if (existing.revokedAt === null && !stale) {
      unchanged += 1;
      touched.push(existing);
      continue;
    }
    const next: StoredRelation = { ...existing, decisionSource, decidedAt: now, revokedAt: null, basis };
    items[index] = next;
    touched.push(next);
    reactivated += 1;
  }

  if (created + reactivated > 0) await writeFile(guestId, items);
  return { items: touched.map((item) => toRelation(item, source)), created, reactivated, unchanged };
}

/** 撤销一条关系（保留记录，标记撤销时间）。 */
export async function revokeGuestNotDuplicateRelation(guestId: string, relationId: string): Promise<NotDuplicateRelationMutationResponse> {
  const file = await readFile(guestId);
  const index = file.items.findIndex((item) => item.id === relationId);
  if (index < 0) return { items: [], created: 0, reactivated: 0, unchanged: 0 };
  const existing = file.items[index] as StoredRelation;
  if (existing.revokedAt !== null) return { items: [toRelation(existing, lookup())], created: 0, reactivated: 0, unchanged: 1 };

  const next: StoredRelation = { ...existing, revokedAt: new Date().toISOString() };
  const items = [...file.items];
  items[index] = next;
  await writeFile(guestId, items);
  return { items: [toRelation(next, lookup())], created: 0, reactivated: 0, unchanged: 0 };
}
