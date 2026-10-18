/**
 * S14-D D1 · 读取导入预览所需的来源/目标快照。
 *
 * ⚠️ **只读**。正式账本通过现有 `/ledger` 与 `/transactions`（逐页）读取；游客账本从本机 IndexedDB
 * 读取。这里绝不创建账本、分类、交易或迁移日志。
 */
import type { LedgerMetaResponse, TransactionListResponse } from "@libellum/shared";
import { PAYMENT_METHOD_NAMES, UNCATEGORISED, categoriesFor } from "@libellum/shared";

import { apiFetch } from "../api.js";
import { readGuestIdentity } from "../guest/identity.js";
import { reloadGuestData, sortedTransactions } from "../guest/data.js";
import type { ImportBookIdentity, ImportSource, ImportTarget } from "./types.js";

const PAGE_SIZE = 200;

/** `/books` 的公开摘要子集；用一个本地窄类型，避免预览逻辑依赖查询层的私有形状。 */
export interface ImportBookSummary {
  readonly id: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly role: "owner" | "editor" | "viewer";
  readonly isCreator: boolean;
  readonly memberCount: number;
}

/**
 * 首版只允许“本人拥有、没有其他协作者”的单人账本参与导入。
 *
 * `isCreator` 与 `memberCount === 1` 是 `/books` 已经返回的公开事实；真正的服务端权限仍会在
 * D3 的提交接口重新校验，不能把这里的过滤当成安全边界。
 */
export function isSoloImportBook(book: ImportBookSummary): boolean {
  return book.isCreator && book.memberCount === 1 && (book.role === "owner" || book.role === "editor");
}

async function fetchAllTransactions(bookId: string): Promise<TransactionListResponse["items"]> {
  const all: TransactionListResponse["items"] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await apiFetch<TransactionListResponse>("/transactions", {
      bookId,
      query: { limit: PAGE_SIZE, cursor },
    });
    all.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return all;
}

interface LoadedBookData {
  readonly identity: ImportBookIdentity;
  readonly source: ImportSource;
  readonly target: ImportTarget;
}

async function loadBookData(bookId: string): Promise<LoadedBookData> {
  const [meta, transactions] = await Promise.all([
    apiFetch<LedgerMetaResponse>("/ledger", { bookId }),
    fetchAllTransactions(bookId),
  ]);
  const identity: ImportBookIdentity = {
    name: meta.book.name,
    bookNumber: meta.book.bookNumber ?? null,
  };
  const base = {
    bookId,
    identity,
    categories: meta.categories,
    paymentMethods: meta.paymentMethods,
    tags: meta.tags,
    transactions,
    hiddenDeletedCount: 0,
  } as const;
  return {
    identity,
    source: { ...base, kind: "book" },
    target: base,
  };
}

/** 读取一本正式账本作为来源 B。 */
export async function loadBookImportSource(bookId: string): Promise<ImportSource> {
  return (await loadBookData(bookId)).source;
}

/** 读取一本正式账本作为目标 A。 */
export async function loadBookImportTarget(bookId: string): Promise<ImportTarget> {
  return (await loadBookData(bookId)).target;
}

/** 本机是否还有游客身份；只读 localStorage，不创建任何东西。 */
export function hasLocalGuestIdentity(): boolean {
  return readGuestIdentity() !== null;
}

/**
 * D2 新目标账本的**预览用**快照。
 *
 * ⚠️ 它不是服务器账本，只在预览里模拟“服务器创建新账本后会有哪些默认分类/支付方式/标签”。真正的
 * 创建发生在提交事务内；ID 只用于浏览器展示和 `auto` 映射，不会被发送为目标 ID。
 */
export function buildNewImportTarget(name: string): ImportTarget {
  const categories = (["expense", "income"] as const).flatMap((kind) => {
    const presets = [...categoriesFor(kind), UNCATEGORISED];
    return presets.map((preset, index) => ({
      id: `new-${kind}-${String(index)}`,
      name: preset.name,
      kind,
      description: preset.name === UNCATEGORISED.name ? null : preset.description,
      sortOrder: index,
      isArchived: false,
      isSystem: preset.name === UNCATEGORISED.name,
    }));
  });
  return {
    bookId: "new",
    identity: { name: name.trim(), bookNumber: null },
    categories,
    paymentMethods: PAYMENT_METHOD_NAMES.map((item, index) => ({
      id: `new-payment-${String(index)}`,
      name: item,
      sortOrder: index,
      isArchived: false,
    })),
    tags: [],
    transactions: [],
    hiddenDeletedCount: 0,
  };
}

/**
 * 读取本机游客账本作为来源。
 *
 * `reloadGuestData` 只读取已有数据，不会因为打开预览而创建游客账本。没有数据时返回 null，页面据此
 * 显示“没有可用的本机游客账本”，而不是凭空造一份空账本。
 */
export async function loadGuestImportSource(): Promise<ImportSource | null> {
  const identity = readGuestIdentity();
  if (identity === null) return null;
  const data = await reloadGuestData(identity.id);
  if (data === null) return null;
  return {
    kind: "guest",
    bookId: data.book.id,
    identity: { name: data.book.name, bookNumber: null },
    categories: [...data.categories],
    paymentMethods: [...data.paymentMethods],
    tags: [...data.tags],
    transactions: sortedTransactions(data),
    hiddenDeletedCount: data.deleted.length,
  };
}
