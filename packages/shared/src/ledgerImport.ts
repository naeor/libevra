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
import { categoryPath, validateCategoryTree } from "./categoryTree.js";

import {
  amountCentsSchema,
  currencySchema,
  transactionKindSchema,
} from "./ledger.js";

const uuid = z.string().uuid();
const shortText = z.string().trim().min(1).max(40);
const objectName = z.string().trim().min(1).max(20);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const MAX_IMPORT_TRANSACTIONS = 5000;
/** Initial D5 batch size; UI/server may tune after tests. Not a permanent product limit. */
export const DEFAULT_IMPORT_BATCH_SIZE = 200;
export const MAX_IMPORT_BATCH_SIZE = 500;
/** D5：超过该笔数走服务端分批任务；小导入仍走单事务路径。 */
export const IMPORT_BATCH_THRESHOLD = 200;



export const guestImportCategorySchema = z.object({
  parentId: uuid.nullable().optional(),
  icon: z.string().max(32).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
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
  /**
   * Stable identity of the guest ledger this snapshot came from. It is generated with the
   * guest ledger (`guest-book-<uuid>`), not with the browser identity, so copies restored on
   * another device keep the same logical source while independent guest ledgers do not
   * share a state namespace.
   */
  guestBookId: z
    .string()
    .trim()
    .min(4)
    // `guest:<guestBookId>` must fit both the state key VARCHAR(64) and target namespace
    // VARCHAR(80); the generated `guest-book-<uuid>` is ~47 characters.
    .max(58)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  categories: z.array(guestImportCategorySchema).max(200),
  paymentMethods: z.array(guestImportPaymentMethodSchema).max(100),
  tags: z.array(guestImportTagSchema).max(200),
  transactions: z.array(guestImportTransactionSchema).max(MAX_IMPORT_TRANSACTIONS),
}).superRefine((value,ctx)=>{try{validateCategoryTree(value.categories);}catch{ctx.addIssue({code:"custom",message:"category_tree_invalid"});}});
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

export const duplicateGroupSourceActionSchema = z.object({
  sourceTransactionId: uuid,
  action: z.enum(["import", "skip"]),
});
export type DuplicateGroupSourceAction = z.infer<typeof duplicateGroupSourceActionSchema>;

export const duplicateGroupTargetActionSchema = z.object({
  targetTransactionId: uuid,
  action: z.enum(["keep", "remove"]),
});
export type DuplicateGroupTargetAction = z.infer<typeof duplicateGroupTargetActionSchema>;

export const duplicateDecisionSchema = z.object({
  groupId: z.string().min(1).max(200),
  /**
   * D2 的四个快捷选择在 D3 变成四种；`custom` 表示多对多逐条决定。
   * 一对多/多对多如果使用 keep_b/keep_neither 删除多条 A，必须同时给出完整 targetActions。
   */
  action: z.enum(["keep_a", "keep_b", "keep_both", "keep_neither", "custom"]).optional(),
  sourceIds: z.array(uuid).min(1).max(MAX_IMPORT_TRANSACTIONS),
  targetIds: z.array(uuid).min(1).max(MAX_IMPORT_TRANSACTIONS),
  /**
   * 一旦给出，必须覆盖本组全部来源/目标记录，且 id 不重复。
   * 服务端只用这些显式动作决定导入/跳过/软删除，不自行扩大范围。
   */
  sourceActions: z.array(duplicateGroupSourceActionSchema).max(MAX_IMPORT_TRANSACTIONS).optional(),
  targetActions: z.array(duplicateGroupTargetActionSchema).max(MAX_IMPORT_TRANSACTIONS).optional(),
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

/** D5 phase 2 · 用户在增量核对中的显式处理决定。 */
export const incrementalDecisionActionValues = ["keep_target", "update_target", "import", "skip"] as const;
export type IncrementalDecisionAction = (typeof incrementalDecisionActionValues)[number];

export const incrementalDecisionSchema = z.object({
  sourceTransactionId: uuid,
  action: z.enum(incrementalDecisionActionValues),
});
export type IncrementalDecision = z.infer<typeof incrementalDecisionSchema>;

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
    /**
     * D2/D3：游客来源快照随请求上传。D4 正式来源不上传快照，只给 sourceBookId；
     * 服务器重新读取 B 并计算指纹。两者必须且只能出现一个。
     */
    source: guestImportSourceSchema.optional(),
    sourceBookId: uuid.optional(),
    sourceFingerprint: sha256,
    taxonomy: z.array(taxonomyResolutionSchema).max(400),
    duplicateGroups: z.array(duplicateDecisionSchema).max(500),
    /** D5 phase 2: explicit decisions for previously imported/changed/skipped source records. */
    incrementalDecisions: z.array(incrementalDecisionSchema).max(MAX_IMPORT_TRANSACTIONS).default([]),
  })
  .superRefine((value, ctx) => {
    const hasSnapshot = value.source !== undefined;
    const hasBook = value.sourceBookId !== undefined;

    if (hasSnapshot === hasBook) {
      ctx.addIssue({
        code: "custom",
        message: "来源必须且只能是游客快照或正式账本 id 之一。",
        path: ["source"],
      });
      return;
    }

    if (hasBook && value.target.kind === "new") {
      ctx.addIssue({
        code: "custom",
        message: "正式账本来源不能把新账本作为目标。",
        path: ["target"],
      });
    }

    if (hasBook && value.target.kind === "existing" && value.sourceBookId === value.target.bookId) {
      ctx.addIssue({
        code: "custom",
        message: "来源账本和目标账本不能相同。",
        path: ["sourceBookId"],
      });
    }

    if (value.source !== undefined) {
      const transactionIds = value.source.transactions.map((item) => item.id);
      if (new Set(transactionIds).size !== transactionIds.length) {
        ctx.addIssue({ code: "custom", message: "来源账目 id 重复", path: ["source", "transactions"] });
      }
    }
  });
export type LedgerImportRequest = z.infer<typeof ledgerImportRequestSchema>;

/** D4 预览请求：只给两本正式账本的 id，服务器负责读取并校验，不信任浏览器旧快照。 */
export const formalImportPreviewRequestSchema = z.object({
  sourceBookId: uuid,
  targetBookId: uuid,
});
export type FormalImportPreviewRequest = z.infer<typeof formalImportPreviewRequestSchema>;

export const formalImportPreviewResponseSchema = z.object({
  sourceBook: z.object({
    id: uuid,
    name: z.string(),
    bookNumber: z.string().nullable(),
  }),
  targetBook: z.object({
    id: uuid,
    name: z.string(),
    bookNumber: z.string().nullable(),
  }),
  source: guestImportSourceSchema,
  sourceFingerprint: sha256,
  target: importTargetSnapshotSchema,
  targetFingerprint: sha256,
});
export type FormalImportPreviewResponse = z.infer<typeof formalImportPreviewResponseSchema>;

/**
 * D5 phase 2 · 增量预览只读结果。
 *
 * 身份关联以目标账目的 `sourceRef` 和持久化 `LedgerImportSourceState` 为准；
 * 真正的状态推进只在用户确认后的导入事务内发生。
 */
export const incrementalSourceStatusValues = [
  "new",
  "unchanged",
  "modified",
  "target_changed",
  "target_deleted",
  "previously_skipped",
  "previously_skipped_modified",
  "needs_review",
] as const;
export type IncrementalSourceStatusValue = (typeof incrementalSourceStatusValues)[number];

export const incrementalSourceStatusSchema = z.object({
  sourceTransactionId: uuid,
  status: z.enum(incrementalSourceStatusValues),
  previousDecision: z.enum(["imported", "skipped", "kept_target", "target_deleted"]).nullable(),
  targetTransactionId: uuid.nullable(),
  targetVersion: z.number().int().positive().nullable(),
  /**
   * 目标版本是否已经不同于上次确认的版本。为 true 时 UI 不允许直接覆盖目标，
   * 服务端也会把它作为 update_target 的硬校验条件。
   */
  targetChanged: z.boolean(),
  /** 旧版本导入没有状态行；这是推断结果，不是已存决策。 */
  legacy: z.boolean(),
  sourceFingerprint: sha256,
  previousSourceFingerprint: sha256.nullable(),
});
export type IncrementalSourceStatus = z.infer<typeof incrementalSourceStatusSchema>;

export const incrementalPreviewRequestSchema = z
  .object({
    targetBookId: uuid,
    sourceBookId: uuid.optional(),
    source: guestImportSourceSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.sourceBookId === undefined) === (value.source === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "增量预览必须且只能给出正式来源 id 或游客来源快照之一。",
        path: ["source"],
      });
    }
  });
export type IncrementalPreviewRequest = z.infer<typeof incrementalPreviewRequestSchema>;

export const incrementalPreviewResponseSchema = z.object({
  statuses: z.array(incrementalSourceStatusSchema).max(MAX_IMPORT_TRANSACTIONS),
  summary: z.object({
    newCount: z.number().int().nonnegative(),
    unchangedCount: z.number().int().nonnegative(),
    modifiedCount: z.number().int().nonnegative(),
    targetChangedCount: z.number().int().nonnegative(),
    targetDeletedCount: z.number().int().nonnegative(),
    previouslySkippedCount: z.number().int().nonnegative(),
    needsReviewCount: z.number().int().nonnegative(),
  }),
});
export type IncrementalPreviewResponse = z.infer<typeof incrementalPreviewResponseSchema>;

export const ledgerImportResultSchema = z.object({
  importId: uuid,
  /** D4：正式来源账本；游客导入没有该字段。 */
  sourceBookId: uuid.optional(),
  targetBook: z.object({
    id: uuid,
    name: z.string(),
    bookNumber: z.string().nullable(),
    created: z.boolean(),
  }),
  sourceCount: z.number().int().nonnegative(),
  importedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative().default(0),
  skippedCount: z.number().int().nonnegative(),
  /** D3：被软删除的目标记录数量；旧 D2 回执没有该字段，按 0 处理。 */
  removedCount: z.number().int().nonnegative().default(0),
  targetExistingBefore: z.number().int().nonnegative(),
  targetCountAfter: z.number().int().nonnegative(),
  removedTargets: z
    .array(
      z.object({
        targetTransactionId: uuid,
        targetSeq: z.number().int().positive(),
        groupId: z.string(),
      }),
    )
    .default([]),
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
  updated: z
    .array(
      z.object({
        sourceTransactionId: uuid,
        targetTransactionId: uuid,
        targetSeq: z.number().int().positive(),
      }),
    )
    .default([]),
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

export const importJobRequestSchema = ledgerImportRequestSchema.and(
  z.object({
    batchSize: z.number().int().min(1).max(MAX_IMPORT_BATCH_SIZE).optional(),
  }),
);
export type ImportJobRequest = z.infer<typeof importJobRequestSchema>;

export const importJobStatusSchema = z.object({
  id: uuid,
  status: z.enum([
    "queued",
    "running",
    "paused",
    "finalizing",
    "awaiting_confirmation",
    "confirming",
    "confirmed",
    "undoing",
    "undone",
    "undo_failed",
    "completed",
    "failed",
    "cancelled",
    "expired",
  ]),
  phase: z.number().int().nonnegative().default(3),
  timeoutSeconds: z.number().int().positive().default(600),
  activityAt: z.string().nullable().default(null),
  confirmationDeadline: z.string().nullable().default(null),
  undoAttempts: z.number().int().nonnegative().default(0),
  canConfirm: z.boolean().default(false),
  canUndo: z.boolean().default(false),
  sourceKind: z.enum(["guest", "book"]),
  sourceBookId: uuid.nullable(),
  targetBookId: uuid,
  batchSize: z.number().int().positive(),
  nextBatch: z.number().int().nonnegative(),
  totalBatches: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  importedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative().default(0),
  skippedCount: z.number().int().nonnegative(),
  removedCount: z.number().int().nonnegative(),
  /** 服务端已提交的批次摘要；用于证明进度不是前端动画。 */
  batches: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        importedCount: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  targetBaselineCount: z.number().int().nonnegative(),
  targetExpectedCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  result: ledgerImportResultSchema.nullable(),
});
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;

/** D5 phase 3: completed formal job's source-ledger disposition information. */
export const formalSourceDispositionSchema = z.object({
  jobId: uuid,
  sourceBookId: uuid,
  sourceBookName: z.string(),
  targetBookId: uuid,
  sourceCount: z.number().int().nonnegative(),
  migratedCount: z.number().int().nonnegative(),
  unmigratedCount: z.number().int().nonnegative(),
  canArchive: z.boolean(),
  archivedAt: z.string().nullable(),
  selfRestoreUntil: z.string().nullable(),
  scheduledPurgeAt: z.string().nullable(),
  pendingRecovery: z.boolean(),
  reason: z.string(),
});
export type FormalSourceDisposition = z.infer<typeof formalSourceDispositionSchema>;

/** D5 phase 3: local guest cleanup preview. Server only reports safe candidate ids. */
export const guestCleanupPreviewRequestSchema = z.object({
  targetBookId: uuid,
  guestBookId: z.string().trim().min(4).max(58).regex(/^[A-Za-z0-9_-]+$/),
  receiptId: uuid,
  source: guestImportSourceSchema,
});
export type GuestCleanupPreviewRequest = z.infer<typeof guestCleanupPreviewRequestSchema>;

export const guestCleanupPreviewResponseSchema = z.object({
  targetBookId: uuid,
  guestBookId: z.string(),
  cleanableSourceIds: z.array(uuid),
  cleanableCount: z.number().int().nonnegative(),
  retainedCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
});
export type GuestCleanupPreviewResponse = z.infer<typeof guestCleanupPreviewResponseSchema>;


function sortedById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function canonicalSource(source: GuestImportSource): string {
  return JSON.stringify({
    // Keep the historical v1 canonical string for old clients/snapshots that have no guestBookId;
    // only sources that carry a stable guest book identity move to v2.
    ...(source.guestBookId === undefined ? { version: 1 } : { version: 2, guestBookId: source.guestBookId }),
    name: source.name,
    categories: sortedById(source.categories).map((item) => ({
      ...(item.parentId ? { parentId:item.parentId } : {}),
      ...(item.icon ? {icon:item.icon} : {}), ...(item.color ? {color:item.color} : {}),
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
      ...(item.parentId ? { parentId:item.parentId } : {}),
      ...(item.icon ? {icon:item.icon} : {}), ...(item.color ? {color:item.color} : {}),
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

/**
 * 单条来源记录的 canonical 指纹。把来源分类/支付方式/标签的名称与属性纳入，
 * 这样“来源改名”也会被识别为内容变化，而不是静默沿用旧结果。
 */
export async function fingerprintImportSourceRecord(
  source: GuestImportSource,
  transactionId: string,
): Promise<string> {
  const transaction = source.transactions.find((item) => item.id === transactionId);
  if (transaction === undefined) throw new Error("source_transaction_missing");
  const category = source.categories.find((item) => item.id === transaction.categoryId);
  const paymentMethod =
    transaction.paymentMethodId === null
      ? null
      : source.paymentMethods.find((item) => item.id === transaction.paymentMethodId);
  const tags = transaction.tagIds
    .map((tagId) => source.tags.find((tag) => tag.id === tagId))
    .filter((tag): tag is GuestImportTag => tag !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  return sha256Hex(
    JSON.stringify({
      version: 1,
      transaction: {
        kind: transaction.kind,
        amountCents: transaction.amountCents,
        currency: transaction.currency,
        categoryId: transaction.categoryId,
        paymentMethodId: transaction.paymentMethodId ?? null,
        occurredAt: transaction.occurredAt,
        occurredLocalDate: transaction.occurredLocalDate,
        occurredTz: transaction.occurredTz,
        note: transaction.note ?? null,
        tagIds: [...transaction.tagIds].sort((left, right) => left.localeCompare(right, "en")),
      },
      category:
        category === undefined
          ? null
          : {
              id: category.id,
              ...(category.parentId?{parentPath:categoryPath(source.categories,category.id).map(n=>({id:n.id,name:n.name,parentId:n.parentId??null}))}:{}),
              name: category.name,
              kind: category.kind,
              description: category.description ?? null,
              sortOrder: category.sortOrder,
              isArchived: category.isArchived,
              isSystem: category.isSystem,
            },
      paymentMethod:
        paymentMethod === undefined || paymentMethod === null
          ? null
          : {
              id: paymentMethod.id,
              name: paymentMethod.name,
              sortOrder: paymentMethod.sortOrder,
              isArchived: paymentMethod.isArchived,
            },
      tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    }),
  );
}

/** 指纹规范串只用于调试和测试；正常调用方使用上面的异步指纹函数。 */
export function canonicalGuestSourceText(source: GuestImportSource): string {
  return canonicalSource(source);
}

export function canonicalTargetSnapshotText(target: ImportTargetSnapshot): string {
  return canonicalTarget(target);
}
