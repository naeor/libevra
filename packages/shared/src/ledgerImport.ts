/**
 * S14-D D2 · 账本导入的跨端契约与指纹。
 *
 * 这里只放**两端必须一致**的东西：
 * - 游客来源快照 schema（浏览器上传，服务器校验）；
 * - 目标账本指纹算法（浏览器预览时算一次，服务器提交前再算一次）；
 * - 导入请求/响应 schema（浏览器与服务端共用）。
 *
 * 业务映射规则仍在 apps/web；D2 的服务器只接受用户已确认的 taxonomy/重复决定，并重新校验
 * 来源指纹、目标指纹与账本权限。不把“客户端说成功”当成成功。
 */
import { z } from "zod";

import {
  amountCentsSchema,
  currencySchema,
  transactionKindSchema,
} from "./ledger.js";

const uuid = z.string().uuid();
const shortText = z.string().trim().min(1).max(40);
const objectName = z.string().trim().min(1).max(20);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const MAX_IMPORT_TRANSACTIONS = 500;

export const guestImportCategorySchema = z.object({
  id: uuid,
  name: objectName,
  kind: transactionKindSchema,
  description: z.string().max(200).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9_999),
  isArchived: z.boolean(),
  isSystem: z.boolean(),
});
export type GuestImportCategory = z.infer<typeof guestImportCategorySchema>;

export const guestImportPaymentMethodSchema = z.object({
  id: uuid,
  name: objectName,
  sortOrder: z.number().int().min(0).max(9_999),
  isArchived: z.boolean(),
});
export type GuestImportPaymentMethod = z.infer<typeof guestImportPaymentMethodSchema>;

export const guestImportTagSchema = z.object({
  id: uuid,
  name: objectName,
  color: z.string().trim().min(1).max(32),
});
export type GuestImportTag = z.infer<typeof guestImportTagSchema>;

export const guestImportTransactionSchema = z.object({
  id: uuid,
  kind: transactionKindSchema,
  amountCents: amountCentsSchema,
  currency: currencySchema,
  categoryId: uuid,
  paymentMethodId: uuid.nullable(),
  occurredAt: z.string().min(20).max(40),
  occurredLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  occurredTz: z.string().min(1).max(64),
  note: z.string().max(500).nullable(),
  tagIds: z.array(uuid).max(10),
});
export type GuestImportTransaction = z.infer<typeof guestImportTransactionSchema>;

export const guestImportSourceSchema = z.object({
  name: shortText,
  categories: z.array(guestImportCategorySchema).max(200),
  paymentMethods: z.array(guestImportPaymentMethodSchema).max(100),
  tags: z.array(guestImportTagSchema).max(200),
  transactions: z.array(guestImportTransactionSchema).max(MAX_IMPORT_TRANSACTIONS),
});
export type GuestImportSource = z.infer<typeof guestImportSourceSchema>;

export const taxonomyResolutionSchema = z.object({
  type: z.enum(["category", "paymentMethod", "tag"]),
  sourceId: uuid,
  /** `auto` 只允许新目标账本；existing 目标必须给出 reuse + targetId 或 create + createName。 */
  action: z.enum(["reuse", "create", "auto"]),
  targetId: uuid.optional(),
  createName: objectName.optional(),
});
export type TaxonomyResolution = z.infer<typeof taxonomyResolutionSchema>;

export const duplicateDecisionSchema = z.object({
  groupId: z.string().min(1).max(200),
  action: z.enum(["keep_a", "keep_both"]),
  sourceIds: z.array(uuid).min(1).max(MAX_IMPORT_TRANSACTIONS),
  targetIds: z.array(uuid).min(1).max(MAX_IMPORT_TRANSACTIONS),
});
export type DuplicateDecision = z.infer<typeof duplicateDecisionSchema>;

/**
 * 目标账本快照。客户端从 `/ledger` + `/transactions` 组装，服务端从 Prisma 组装；
 * 两边必须使用同一 canonical 形状，否则指纹会在每次导入时错误地判定“目标变了”。
 */
export const importTargetSnapshotSchema = z.object({
  bookId: uuid,
  name: shortText,
  bookNumber: z.string().nullable(),
  categories: z.array(guestImportCategorySchema),
  paymentMethods: z.array(guestImportPaymentMethodSchema),
  tags: z.array(guestImportTagSchema),
  transactions: z.array(
    z.object({
      id: uuid,
      version: z.number().int().positive(),
      kind: transactionKindSchema,
      amountCents: amountCentsSchema,
      currency: currencySchema,
      categoryId: uuid,
      paymentMethodId: uuid.nullable(),
      occurredAt: z.string().min(20).max(40),
      occurredLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      occurredTz: z.string().min(1).max(64),
      note: z.string().max(500).nullable(),
      tagIds: z.array(uuid).max(10),
    }),
  ),
});
export type ImportTargetSnapshot = z.infer<typeof importTargetSnapshotSchema>;

export const ledgerImportRequestSchema = z
  .object({
    importId: uuid,
    target: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("existing"),
        bookId: uuid,
        expectedTargetFingerprint: sha256,
      }),
      z.object({
        kind: z.literal("new"),
        name: shortText,
      }),
    ]),
    source: guestImportSourceSchema,
    sourceFingerprint: sha256,
    taxonomy: z.array(taxonomyResolutionSchema).max(400),
    duplicateGroups: z.array(duplicateDecisionSchema).max(500),
  })
  .superRefine((value, ctx) => {
    const transactionIds = value.source.transactions.map((item) => item.id);
    if (new Set(transactionIds).size !== transactionIds.length) {
      ctx.addIssue({ code: "custom", message: "来源账目 id 重复", path: ["source", "transactions"] });
    }
  });
export type LedgerImportRequest = z.infer<typeof ledgerImportRequestSchema>;

export const ledgerImportResultSchema = z.object({
  importId: uuid,
  targetBook: z.object({
    id: uuid,
    name: z.string(),
    bookNumber: z.string().nullable(),
    created: z.boolean(),
  }),
  sourceCount: z.number().int().nonnegative(),
  importedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  targetExistingBefore: z.number().int().nonnegative(),
  targetCountAfter: z.number().int().nonnegative(),
  totals: z.array(
    z.object({
      currency: z.string(),
      expenseCents: z.number().int().nonnegative(),
      incomeCents: z.number().int().nonnegative(),
      count: z.number().int().nonnegative(),
    }),
  ),
  imported: z.array(
    z.object({
      sourceTransactionId: uuid,
      targetTransactionId: uuid,
      targetSeq: z.number().int().positive(),
    }),
  ),
  taxonomy: z.object({
    categoriesCreated: z.number().int().nonnegative(),
    paymentMethodsCreated: z.number().int().nonnegative(),
    tagsCreated: z.number().int().nonnegative(),
    categoriesReused: z.number().int().nonnegative(),
    paymentMethodsReused: z.number().int().nonnegative(),
    tagsReused: z.number().int().nonnegative(),
  }),
  reconciled: z.literal(true),
});
export type LedgerImportResult = z.infer<typeof ledgerImportResultSchema>;

function sortedById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function canonicalSource(source: GuestImportSource): string {
  return JSON.stringify({
    version: 1,
    name: source.name,
    categories: sortedById(source.categories).map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      description: item.description ?? null,
      sortOrder: item.sortOrder,
      isArchived: item.isArchived,
      isSystem: item.isSystem,
    })),
    paymentMethods: sortedById(source.paymentMethods).map((item) => ({
      id: item.id,
      name: item.name,
      sortOrder: item.sortOrder,
      isArchived: item.isArchived,
    })),
    tags: sortedById(source.tags).map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
    })),
    transactions: sortedById(source.transactions).map((item) => ({
      id: item.id,
      kind: item.kind,
      amountCents: item.amountCents,
      currency: item.currency,
      categoryId: item.categoryId,
      paymentMethodId: item.paymentMethodId ?? null,
      occurredAt: item.occurredAt,
      occurredLocalDate: item.occurredLocalDate,
      occurredTz: item.occurredTz,
      note: item.note ?? null,
      tagIds: [...item.tagIds].sort((left, right) => left.localeCompare(right, "en")),
    })),
  });
}

function canonicalTarget(target: ImportTargetSnapshot): string {
  return JSON.stringify({
    version: 1,
    bookId: target.bookId,
    name: target.name,
    bookNumber: target.bookNumber,
    categories: sortedById(target.categories).map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      description: item.description ?? null,
      sortOrder: item.sortOrder,
      isArchived: item.isArchived,
      isSystem: item.isSystem,
    })),
    paymentMethods: sortedById(target.paymentMethods).map((item) => ({
      id: item.id,
      name: item.name,
      sortOrder: item.sortOrder,
      isArchived: item.isArchived,
    })),
    tags: sortedById(target.tags).map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
    })),
    transactions: sortedById(target.transactions).map((item) => ({
      id: item.id,
      version: item.version,
      kind: item.kind,
      amountCents: item.amountCents,
      currency: item.currency,
      categoryId: item.categoryId,
      paymentMethodId: item.paymentMethodId ?? null,
      occurredAt: item.occurredAt,
      occurredLocalDate: item.occurredLocalDate,
      occurredTz: item.occurredTz,
      note: item.note ?? null,
      tagIds: [...item.tagIds].sort((left, right) => left.localeCompare(right, "en")),
    })),
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintGuestSource(source: GuestImportSource): Promise<string> {
  return sha256Hex(canonicalSource(source));
}

export async function fingerprintTargetSnapshot(target: ImportTargetSnapshot): Promise<string> {
  return sha256Hex(canonicalTarget(target));
}

/** 指纹规范串只用于调试和测试；正常调用方使用上面的异步指纹函数。 */
export function canonicalGuestSourceText(source: GuestImportSource): string {
  return canonicalSource(source);
}

export function canonicalTargetSnapshotText(target: ImportTargetSnapshot): string {
  return canonicalTarget(target);
}
