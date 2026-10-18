/**
 * S14-D D4 · 正式账本来源的预览读取。
 *
 * ⚠️ 浏览器不自己拼一封“来源快照”当真相。预览请求只发送两本账本 id，服务器读取并校验 B/A
 * 的单人状态、邀请/分享链接、权限与账本状态，再返回 canonical 快照和指纹；提交时只发送
 * sourceBookId + 指纹，服务器重新读取 B。
 */
import {
  formalImportPreviewResponseSchema,
  type Category,
  type GuestImportSource,
  type ImportTargetSnapshot,
  type PaymentMethod,
  type Tag,
  type Transaction,
} from "@libellum/shared";

import { apiFetch } from "../api.js";
import type { ImportSource, ImportTarget } from "./types.js";

export interface FormalPreviewData {
  readonly source: ImportSource;
  readonly target: ImportTarget;
  readonly sourceFingerprint: string;
  readonly targetFingerprint: string;
}

function categoriesFromSource(items: GuestImportSource["categories"]): Category[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    kind: item.kind,
    description: item.description ?? null,
    isSystem: item.isSystem,
    isArchived: item.isArchived,
    sortOrder: item.sortOrder,
  }));
}

function categoriesFromTarget(items: ImportTargetSnapshot["categories"]): Category[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    kind: item.kind,
    description: item.description ?? null,
    isSystem: item.isSystem,
    isArchived: item.isArchived,
    sortOrder: item.sortOrder,
  }));
}

function paymentsFrom<
  T extends { readonly id: string; readonly name: string; readonly sortOrder: number; readonly isArchived: boolean },
>(items: readonly T[]): PaymentMethod[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    sortOrder: item.sortOrder,
    isArchived: item.isArchived,
  }));
}

function tagsFrom(items: readonly { readonly id: string; readonly name: string; readonly color: string }[]): Tag[] {
  return items.map((item) => ({ id: item.id, name: item.name, color: item.color }));
}

function transactionFromSource(
  item: GuestImportSource["transactions"][number],
  categoryNames: ReadonlyMap<string, string>,
  paymentNames: ReadonlyMap<string, string>,
  tags: readonly Tag[],
): Transaction {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag] as const));
  return {
    id: item.id,
    version: 1,
    kind: item.kind,
    amountCents: item.amountCents,
    currency: item.currency,
    categoryId: item.categoryId,
    categoryName: categoryNames.get(item.categoryId) ?? "（未知分类）",
    categoryIsSystem: false,
    paymentMethodId: item.paymentMethodId,
    paymentMethodName: item.paymentMethodId === null ? null : (paymentNames.get(item.paymentMethodId) ?? null),
    occurredAt: item.occurredAt,
    occurredLocalDate: item.occurredLocalDate,
    occurredTz: item.occurredTz,
    note: item.note,
    tags: item.tagIds.map((tagId) => tagsById.get(tagId)).filter((tag): tag is Tag => tag !== undefined),
  };
}

function transactionFromTarget(
  item: ImportTargetSnapshot["transactions"][number],
  categoryNames: ReadonlyMap<string, string>,
  paymentNames: ReadonlyMap<string, string>,
  tags: readonly Tag[],
): Transaction {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag] as const));
  return {
    id: item.id,
    version: item.version,
    kind: item.kind,
    amountCents: item.amountCents,
    currency: item.currency,
    categoryId: item.categoryId,
    categoryName: categoryNames.get(item.categoryId) ?? "（未知分类）",
    categoryIsSystem: false,
    paymentMethodId: item.paymentMethodId,
    paymentMethodName: item.paymentMethodId === null ? null : (paymentNames.get(item.paymentMethodId) ?? null),
    occurredAt: item.occurredAt,
    occurredLocalDate: item.occurredLocalDate,
    occurredTz: item.occurredTz,
    note: item.note,
    tags: item.tagIds.map((tagId) => tagsById.get(tagId)).filter((tag): tag is Tag => tag !== undefined),
  };
}

function categoryNames(categories: readonly { readonly id: string; readonly name: string }[]): Map<string, string> {
  return new Map(categories.map((item) => [item.id, item.name] as const));
}

export async function loadFormalImportPreview(sourceBookId: string, targetBookId: string): Promise<FormalPreviewData> {
  const raw = await apiFetch<unknown>("/ledger-imports/preview", {
    method: "POST",
    body: { sourceBookId, targetBookId },
  });
  const parsed = formalImportPreviewResponseSchema.parse(raw);

  const sourceCategories = categoriesFromSource(parsed.source.categories);
  const sourcePayments = paymentsFrom(parsed.source.paymentMethods);
  const sourceTags = tagsFrom(parsed.source.tags);
  const source: ImportSource = {
    kind: "book",
    bookId: parsed.sourceBook.id,
    identity: { name: parsed.sourceBook.name, bookNumber: parsed.sourceBook.bookNumber },
    categories: sourceCategories,
    paymentMethods: sourcePayments,
    tags: sourceTags,
    transactions: parsed.source.transactions.map((item) =>
      transactionFromSource(
        item,
        categoryNames(sourceCategories),
        new Map(sourcePayments.map((payment) => [payment.id, payment.name] as const)),
        sourceTags,
      ),
    ),
    hiddenDeletedCount: 0,
  };

  const targetCategories = categoriesFromTarget(parsed.target.categories);
  const targetPayments = paymentsFrom(parsed.target.paymentMethods);
  const targetTags = tagsFrom(parsed.target.tags);
  const target: ImportTarget = {
    bookId: parsed.targetBook.id,
    identity: { name: parsed.targetBook.name, bookNumber: parsed.targetBook.bookNumber },
    categories: targetCategories,
    paymentMethods: targetPayments,
    tags: targetTags,
    transactions: parsed.target.transactions.map((item) =>
      transactionFromTarget(
        item,
        categoryNames(targetCategories),
        new Map(targetPayments.map((payment) => [payment.id, payment.name] as const)),
        targetTags,
      ),
    ),
    hiddenDeletedCount: 0,
  };

  return {
    source,
    target,
    sourceFingerprint: parsed.sourceFingerprint,
    targetFingerprint: parsed.targetFingerprint,
  };
}
