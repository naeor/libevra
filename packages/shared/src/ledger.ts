import { duplicateRulesSchema } from "./duplicateReview.js";
import { z } from "zod";

/**
 * Ledger types shared by the API and the browser.
 *
 * Money is always an integer number of cents — see `money.ts`. Amounts arrive
 * from the client already converted, so the server never parses "12.34".
 */

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

/**
 * The currencies a book can use. Deliberately a closed list, so the picker, the
 * validation and the formatting all work from one set of names.
 *
 * Precision is **per currency**, and lives in `money.ts` with the rest of the
 * money rules: the yen is recorded without decimals (¥1000 is `1000` minor
 * units, not `100000`) while the others use two.
 */
export const CURRENCIES = ["CNY", "USD", "EUR", "JPY", "HKD", "GBP"] as const;

export const currencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currencySchema>;

export const TRANSACTION_KINDS = ["expense", "income"] as const;
export const transactionKindSchema = z.enum(TRANSACTION_KINDS);
export type TransactionKind = z.infer<typeof transactionKindSchema>;

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Ceiling for a single entry: 10 billion units, i.e. 1e12 cents.
 *
 * Two reasons it exists. It keeps every amount inside JavaScript's safe
 * integer range, so cents can travel as numbers without precision loss; and it
 * rejects the typo that would otherwise poison every total.
 */
export const MAX_AMOUNT_CENTS = 1_000_000_000_000;

export const amountCentsSchema = z
  .number()
  .int("金额必须是整数（分）")
  .min(0, "金额不能为负数")
  .max(MAX_AMOUNT_CENTS, "金额超出可记录的上限");

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Written as a regex rather than a helper so the rule is visible and stable
 * across zod versions. Entry ids are UUID v7 produced by the browser — see the
 * offline design in PLAN 3.3.
 */
export const uuidSchema = z.string().regex(UUID_PATTERN, "标识格式不正确");

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * What a person may do in one ledger.
 *
 * ⚠️ **`owner` is a legacy value that no code writes or honours any more.** The owner decided on
 * two roles — `editor` and `viewer` — and the collaboration migration converted the rows that
 * still said `owner`. It stays in the schema because the database enum still contains it, and a
 * response that contained a value the client's schema rejected would be a validation failure on
 * real data. **`editor` is the only value that may write.**
 */
export const bookRoleSchema = z.enum(["owner", "editor", "viewer"]);

/** Name of the system category that collects entries saved without one. */
export const UNCATEGORISED_NAME = "暂无分类";

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: transactionKindSchema,
  /**
   * Plain-language explanation, shown behind the ⓘ next to a preset. Null for
   * categories the user made or renamed — they do not need to be told what
   * their own category means.
   */
  description: z.string().nullable(),
  /** System categories are server-managed and hidden from the picker. */
  isSystem: z.boolean(),
  isArchived: z.boolean(),
  sortOrder: z.number(),
});
export type Category = z.infer<typeof categorySchema>;

export const paymentMethodSchema = z.object({
  id: z.string(),
  name: z.string(),
  isArchived: z.boolean(),
  sortOrder: z.number(),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});
export type Tag = z.infer<typeof tagSchema>;

export const ledgerMetaResponseSchema = z.object({
  book: z.object({
    id: z.string(),
    name: z.string(),
    /**
     * The ledger's public eight-digit number.
     *
     * Nullable only for the sake of rows written before the migration that
     * introduced it; every ledger created since has one. The client shows it so
     * two people can confirm out loud that they are looking at the same ledger.
     */
    bookNumber: z.string().nullable(),
    /// ⚠️ **How many people are in this ledger right now** — only active memberships, so somebody
    /// who left is not counted. **The bottom navigation renames itself on this number**: one member
    /// is 账本, two or more is 协作 (the owner's rule), and **the two labels are the same page.**
    memberCount: z.number().int().nonnegative().optional(),
  }),
  /**
   * **Enough to recognise the ledger, and no more.**
   *
   * ⚠️ **The owner drew this boundary himself**: *"这里的账本信息主要用于帮助用户识别自己当前打开的
   * 是哪本账，而不是**重复「分析」页面已有的收支统计功能**."* So there is **no income, no expense,
   * no balance** here — those belong to 分析, and a total on this screen would make two pages look
   * like they were answering the same question.
   */
  stats: z
    .object({
      /// ⚠️ When the ledger itself was created — the ledger's age, not the entries'.
      createdAt: z.string(),
      transactionCount: z.number().int().nonnegative(),
      /// ⚠️ Counted with the same rule the list uses: a tombstone is not an entry.
      eventCount: z.number().int().nonnegative(),
    })
    .optional(),
  categories: z.array(categorySchema),
  paymentMethods: z.array(paymentMethodSchema),
  tags: z.array(tagSchema),
});
export type LedgerMetaResponse = z.infer<typeof ledgerMetaResponseSchema>;

// ---------------------------------------------------------------------------
// Managing categories, payment methods and tags
// ---------------------------------------------------------------------------

const sortOrderSchema = z.number().int().min(0).max(9_999);

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "请填写分类名称")
  .max(20, "分类名称最多 20 个字符");

export const createCategorySchema = z.object({
  name: categoryNameSchema,
  kind: transactionKindSchema,
  sortOrder: sortOrderSchema.optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: categoryNameSchema.optional(),
  sortOrder: sortOrderSchema.optional(),
  /** Archiving hides it from the picker; restoring brings it back. */
  isArchived: z.boolean().optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const paymentMethodNameSchema = z
  .string()
  .trim()
  .min(1, "请填写支付方式名称")
  .max(20, "支付方式名称最多 20 个字符");

export const createPaymentMethodSchema = z.object({
  name: paymentMethodNameSchema,
  sortOrder: sortOrderSchema.optional(),
});
export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;

export const updatePaymentMethodSchema = z.object({
  name: paymentMethodNameSchema.optional(),
  sortOrder: sortOrderSchema.optional(),
  isArchived: z.boolean().optional(),
});
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;

export const tagNameSchema = z
  .string()
  .trim()
  .min(1, "请填写标签名称")
  .max(12, "标签名称最多 12 个字符");

/** `#RRGGBB` only: a fixed shape keeps the list readable and the input simple. */
export const tagColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "颜色格式应为 #RRGGBB");

export const createTagSchema = z.object({
  name: tagNameSchema,
  color: tagColorSchema,
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({
  name: tagNameSchema.optional(),
  color: tagColorSchema.optional(),
});
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

// ---------------------------------------------------------------------------
// 永久删除一个组织器对象，并把历史重新记到别处
// ---------------------------------------------------------------------------

/**
 * ⚠️ **`DELETE` 的语义没有变：分类与支付方式仍然是"归档"**，因为历史账目还要靠它们渲染
 * （`routes/classification.ts` 顶上那段注释就是理由）。真正把它们从数据库里删掉是一个
 * **独立的、破坏性的动作**，所以它有自己的端点（`POST …/permanent-delete`）和自己的请求体 ——
 * **一个会让几十笔历史换分类的操作，不该由"和以前一样的 DELETE"顺手完成。**
 *
 * 一个空值（省略 / `null` / `""`）在这里是**合法输入，意思是"你替我选"**：
 * 分类 → 同 `kind` 的系统分类 `暂无分类`；支付方式 → `null`（未指定）；标签 → 解除关联。
 * 这是所有者 S13-E Q5 的默认规则 —— *"不选才按默认"*。
 */
const optionalReplacementId = z
  .union([uuidSchema, z.literal(""), z.null()])
  .transform((value) => (value === "" || value === null ? null : value))
  /**
   * ⚠️ **`optional()` on the outside, after the transform**, so the *output* type keeps the key
   * optional. A `POST` with no body at all is a legitimate "you choose" — and with
   * `exactOptionalPropertyTypes` on (this repo), a type where the key was required would force
   * every caller to write `{ replacementCategoryId: null }` for the most common case.
   */
  .optional();

export const permanentDeleteCategorySchema = z.object({
  /**
   * 把历史账目换成哪个分类。省略 → 服务器选同 `kind` 的 `暂无分类`。
   * 必须是**同一本账**、**同一个 `kind`**，且不能是它自己。
   */
  replacementCategoryId: optionalReplacementId,
});
export type PermanentDeleteCategoryInput = z.infer<typeof permanentDeleteCategorySchema>;

export const permanentDeletePaymentMethodSchema = z.object({
  /**
   * 把历史账目换成哪个支付方式。省略 / `null` → 历史记录变成**未指定**（`payment_method_id = NULL`）。
   * ⚠️ 支付方式没有"其他"这一行，所以"不选"在这里就是一个明确的答案，而不是兜底。
   */
  replacementPaymentMethodId: optionalReplacementId,
});
export type PermanentDeletePaymentMethodInput = z.infer<
  typeof permanentDeletePaymentMethodSchema
>;

/**
 * 一次"删除 + 历史重关联"的结果。
 *
 * ⚠️ **`affectedEntries` 只统计未删除的账目**（`deleted_at IS NULL`）—— 和列表、`/ledger` 的
 * `transactionCount` 同一口径。**它是用户在确认框里看到的那个数，服务器不夸大也不缩小它。**
 * 被重连的墓碑行数不在这里（它们不是"账目"，用户也看不见），但确实也会被重连：
 * `transactions.category_id` 是 `ON DELETE RESTRICT`，不清干净就删不掉。
 */
export const classificationDeleteResponseSchema = z.object({
  affectedEntries: z.number().int().nonnegative(),
  /** 历史被重连到哪个对象。标签（解绑）、支付方式（未指定）、没有历史可改时都是 `null`。 */
  replacementId: z.string().nullable(),
  replacementName: z.string().nullable(),
  /**
   * ⚠️ **这次批量操作摘要的 id —— "只写一条记录"的凭据。**
   * 一次重关联只产生一行 `ledger_operation_logs`，不逐笔写 `transaction_events`（Q4）。
   */
  operationId: z.string(),
});
export type ClassificationDeleteResponse = z.infer<
  typeof classificationDeleteResponseSchema
>;

/**
 * 分类 / 支付方式 / 标签各自「被多少笔账目用着」—— 删除确认框里那句
 * *"有 N 笔历史记录使用它"* 的数字来源。
 *
 * ⚠️ **只读预览，不是删除的依据。** 真正永久删除时服务器会在事务里重新统计一次
 * （`routes/classification.ts` 的 `permanent-delete` 注释说明了理由：确认框打开之后可能又有
 * 新账目用了它）。这个接口回答的是"此刻"的数字，用途是让用户在按下去之前知道会发生什么。
 *
 * ⚠️ **只算未删除的账目**（`transactions.deleted_at IS NULL`）—— 和账目列表、
 * `classificationDeleteResponseSchema.affectedEntries`、`/ledger` 的 `transactionCount`
 * 同一口径。墓碑不算"一笔账目"，用户数不到它。
 *
 * ⚠️ **键是对象 id，值是未删除账目数；没有用过的对象不出现在结果里**（而不是出现为 0）。
 * 所以空对象 `{}` 是合法答案：这本账的这部分还没有任何账目使用。
 */
export const classificationUsageResponseSchema = z.object({
  /** 分类 id → 未删除账目数。 */
  categories: z.record(z.string(), z.number().int().nonnegative()),
  /** 支付方式 id → 未删除账目数。`未指定`（NULL）不是对象，不会出现。 */
  paymentMethods: z.record(z.string(), z.number().int().nonnegative()),
  /** 标签 id → 挂着它的未删除账目数。 */
  tags: z.record(z.string(), z.number().int().nonnegative()),
});
export type ClassificationUsageResponse = z.infer<
  typeof classificationUsageResponseSchema
>;

// ---------------------------------------------------------------------------
// 批量操作摘要（读）
// ---------------------------------------------------------------------------

/**
 * ⚠️ **动作名是稳定的标识符，不是一句中文** —— 句子由界面决定，数据库里存的是
 * `category.permanent_delete` 这样的值（与 `AdminAuditLog.action` 同一个规矩）。
 *
 * ⚠️ **这份列表与迁移里的 CHECK 约束是同一份事实的两处写法**，所以有一条测试
 * （`classification.test.ts` 的 "the action list agrees with the database"）
 * 会把 `pg_get_constraintdef` 和它对比 —— 没有测试的第二份副本迟早会不一致（`教训.md` §8.7）。
 */
export const LEDGER_OPERATION_ACTIONS = [
  "category.permanent_delete",
  "payment_method.permanent_delete",
  "tag.permanent_delete",
] as const;
export const ledgerOperationActionSchema = z.enum(LEDGER_OPERATION_ACTIONS);
export type LedgerOperationAction = z.infer<typeof ledgerOperationActionSchema>;

export const LEDGER_OPERATION_OBJECT_TYPES = ["category", "payment_method", "tag"] as const;
export const ledgerOperationObjectTypeSchema = z.enum(LEDGER_OPERATION_OBJECT_TYPES);
export type LedgerOperationObjectType = z.infer<typeof ledgerOperationObjectTypeSchema>;

export const ledgerOperationSchema = z.object({
  id: z.string(),
  action: ledgerOperationActionSchema,
  objectType: ledgerOperationObjectTypeSchema,
  /** ⚠️ 可能指向一个已经不存在的对象 —— 它已经被删掉了。`objectName` 是可读快照。 */
  objectId: z.string(),
  objectName: z.string(),
  /** 未删除的账目数，与 `classificationDeleteResponseSchema.affectedEntries` 同一个数。 */
  affectedCount: z.number().int().nonnegative(),
  /** 当时是谁做的。账号注销后仍留名（`actorName` 是快照）。 */
  actorName: z.string().nullable(),
  /** 何时。ISO 时间串；"今天/昨天"由界面按读者时区决定。 */
  at: z.string(),
  /** 历史去了哪里、怎么去的 —— 形状随动作变化，所以不在这里收紧。 */
  detail: z.unknown(),
});
export type LedgerOperation = z.infer<typeof ledgerOperationSchema>;

export const ledgerOperationListResponseSchema = z.object({
  entries: z.array(ledgerOperationSchema),
  /** 这本账一共记了多少次批量操作。 */
  total: z.number().int().nonnegative(),
});
export type LedgerOperationListResponse = z.infer<typeof ledgerOperationListResponseSchema>;

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** A tag may only be attached so many times to one entry. */
export const MAX_TAGS_PER_TRANSACTION = 10;

/**
 * How many tags a list row would show before collapsing the rest — **a rule
 * that is not implemented yet.**
 *
 * Nothing reads this today: the entry list shows no tags at all, and the detail
 * screen shows every tag on the entry. It is kept rather than deleted because
 * the decision it records — five in the list, all of them in the detail — is
 * still the intended design, and this is the only place that number is written
 * down. It should be wired into the row at the point the row starts showing
 * tags.
 */
export const TAGS_SHOWN_IN_LIST = 5;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A category chosen by the client, where an empty value means "none chosen".
 *
 * The empty string is folded into `null` on purpose, and `null` is kept as
 * `null` rather than normalised to `undefined`: a `<select>` with an empty
 * option hands back `""`, and every caller in the app already speaks in
 * `string | null`. Folding to `undefined` here would have forced four call sites
 * to change shape for no gain.
 *
 * What this replaces: passing `""` straight through used to fail validation with
 * "标识格式不正确" — a complaint about a malformed UUID, for the most ordinary
 * thing a person can do, which is not to pick a category.
 */
const optionalCategoryId = z
  .union([uuidSchema, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" || value === undefined ? null : value));

/** The same, for the payment method. */
const optionalPaymentMethodId = z
  .union([uuidSchema, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" || value === undefined ? null : value));

export const createTransactionSchema = z.object({
  /** Generated by the client so the entry keeps one identity from the start. */
  id: uuidSchema,
  /** Retrying an upload with the same key must not create a second row. */
  idempotencyKey: uuidSchema,

  kind: transactionKindSchema,
  amountCents: amountCentsSchema,
  currency: currencySchema,

  /** Omitted, null or empty files the entry under 暂无分类. */
  categoryId: optionalCategoryId,
  paymentMethodId: optionalPaymentMethodId,

  /** Full instant, ISO 8601 with an offset. */
  occurredAt: z.string().min(20).max(40),
  /** The phone's calendar date — what every group and month query uses. */
  occurredLocalDate: z.string().regex(LOCAL_DATE_PATTERN, "日期格式应为 YYYY-MM-DD"),
  /** IANA zone the entry was recorded in. */
  occurredTz: z.string().min(1).max(64),

  note: z.string().trim().max(200, "备注最多 200 个字符").nullish(),
  tagIds: z.array(uuidSchema).max(MAX_TAGS_PER_TRANSACTION, "一笔账最多 10 个标签").default([]),
});
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const updateTransactionSchema = z.object({
  kind: transactionKindSchema.optional(),
  amountCents: amountCentsSchema.optional(),
  currency: currencySchema.optional(),
  categoryId: optionalCategoryId,
  paymentMethodId: optionalPaymentMethodId,
  occurredAt: z.string().min(20).max(40).optional(),
  occurredLocalDate: z.string().regex(LOCAL_DATE_PATTERN).optional(),
  occurredTz: z.string().min(1).max(64).optional(),
  note: z.string().trim().max(200).nullish(),
  tagIds: z.array(uuidSchema).max(MAX_TAGS_PER_TRANSACTION).optional(),
  /** Optimistic lock: the version the client last saw. */
  version: z.number().int().positive(),

  /**
   * The values a device passed through while it was offline, one entry per field it changed.
   *
   * ⚠️ **A change is sent as "from A to B", not as "set it to B"** — the owner's rule, and the whole basis of the
   * conflict decision: **"只有在服务器的数值是 C，而某台设备上传的请求是把数字从 A 改成 B 时才会触发冲突机制."**
   * Without the `base` the server cannot tell an edit made against a current view from an edit made against a
   * view that no longer exists.
   *
   * ⚠️ **`chain` carries every step, not just the two ends**: "设备本地在恢复网络上传时要把从断网开始的每一步
   * 改动都上传" — the ones in between become history, which is what lets a later device recognise a value the
   * server has already held.
   */
  changes: z
    .array(
      z.object({
        field: z.string().min(1).max(32),
        /** What the device read before it started. */
        base: z.unknown(),
        /** What the user wants it to be. */
        wanted: z.unknown(),
        /** Every value it passed through, oldest first. */
        chain: z.array(z.unknown()).max(64),
      }),
    )
    .max(32)
    .optional(),

  /**
   * Whether this change is the user settling a conflict.
   *
   * ⚠️ **It closes every open question about this entry, on every device**: "如果用户已经对这个冲突做了一次确认…
   * 此时没必要让用户在别的设备上再肯定一次."
   */
  settlesConflict: z.boolean().optional(),
});
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export const transactionSchema = z.object({
  id: z.string(),
  /**
   * **The number a person reads: `#000001`.** Per ledger, from 1, assigned by the server.
   *
   * ⚠️ **Optional, and that is honest rather than convenient.** Rows cached on a device before this
   * existed do not carry it, and a required field would make every one of those entries fail to
   * parse — **turning "this entry has no number yet" into "this entry cannot be shown at all."**
   * New responses always include it; a missing one means the copy predates the feature.
   *
   * ⚠️ **It is not the id.** The owner drew the line himself: every operation still addresses the
   * entry by `id`. This is a label, and it is **never** accepted from a client.
   */
  seq: z.number().int().positive().optional(),
  kind: transactionKindSchema,
  amountCents: z.number(),
  /** Always one of the supported currencies — entries are validated on write. */
  currency: currencySchema,
  categoryId: z.string(),
  categoryName: z.string(),
  categoryIsSystem: z.boolean(),
  paymentMethodId: z.string().nullable(),
  paymentMethodName: z.string().nullable(),
  occurredAt: z.string(),
  occurredLocalDate: z.string(),
  occurredTz: z.string(),
  note: z.string().nullable(),
  tags: z.array(tagSchema),
  version: z.number(),
  /** D3: present only on a deleted entry fetched by id for history/restore. */
  deletedAt: z.string().nullable().optional(),
  /** D3: the import receipt that removed this entry, when the removal came from ledger import. */
  deletedByImportId: z.string().optional(),
});
export type Transaction = z.infer<typeof transactionSchema>;

/**
 * The number as a person sees it: `#000001`.
 *
 * ⚠️ **Rendered, never stored.** The database holds `1`; the `#` and the zero padding are
 * presentation, and **storing `"#000001"` would put a formatting decision into the data** — the
 * first time somebody wanted seven digits, every stored string would have to be rewritten.
 *
 * ⚠️ **It lives in `shared` because both sides need the same string.** The detail screen shows it
 * and the offline copy may render it too; two formatters would eventually disagree about padding.
 *
 * ⚠️ **Past a million it simply gets longer** (`#1000000`) rather than wrapping or truncating:
 * a household ledger will not reach it, and a busier one would rather have a longer number than a
 * repeated one.
 */
export function formatTransactionNumber(seq: number): string {
  return `#${String(seq).padStart(6, "0")}`;
}

export const transactionListResponseSchema = z.object({
  items: z.array(transactionSchema),
  /** Pass back as `cursor` to fetch the next page; null means the end. */
  nextCursor: z.string().nullable(),
});
export type TransactionListResponse = z.infer<typeof transactionListResponseSchema>;

// ---------------------------------------------------------------------------
// Monthly summary
// ---------------------------------------------------------------------------

/**
 * One line per currency. v1 never converts between currencies, so totals are
 * reported separately — adding ¥ and $ together would be meaningless.
 */
export const currencySummarySchema = z.object({
  currency: z.string(),
  expenseCents: z.number(),
  incomeCents: z.number(),
  balanceCents: z.number(),
  expenseCount: z.number(),
  incomeCount: z.number(),
  /** `|expense| + |income|`, used to rank which currencies are shown first. */
  volumeCents: z.number(),
});
export type CurrencySummary = z.infer<typeof currencySummarySchema>;

export const summaryResponseSchema = z.object({
  month: z.string(),
  currencies: z.array(currencySummarySchema),
});
export type SummaryResponse = z.infer<typeof summaryResponseSchema>;

/**
 * Looking for an entry that is already there, before writing another one.
 *
 * The owner asked for this after photographing the same bill twice, and the
 * definition is his: **date, time, amount, currency and kind all identical**.
 * Nothing else counts — not the note, not the category. A note is the field most
 * likely to be worded differently on a second attempt, so including it would
 * make the check miss exactly the case it exists for.
 *
 * ⚠️ **A query, not a constraint.** Two identical entries are a legitimate thing
 * to have — buying the same coffee twice in the same minute is uncommon but
 * real — so the server reports suspicion rather than refusing the write. The
 * decision is the user's, which is also what the owner said: "既然是用户自己做的
 * 决定，就应该尊重."
 *
 * `occurredTime` is `HH:mm`, matching what the form collects. Seconds are not
 * compared: the field does not ask for them, so a comparison at second
 * precision would be false precision dressed up as thoroughness.
 *
 * Defined here rather than beside the create schema because a parse at module
 * load would run before `transactionSchema` below exists — `const` does not
 * hoist.
 */
export const duplicateCheckSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }).optional(),
  occurredTz: z.string().max(80).optional(),
  categoryId: z.string().nullable().optional(),
  paymentMethodId: z.string().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  tagIds: z.array(z.string()).max(100).optional(),
  settings: duplicateRulesSchema.optional(),
  kind: transactionKindSchema,
  amountCents: amountCentsSchema,
  currency: currencySchema,
  occurredLocalDate: z.string().regex(LOCAL_DATE_PATTERN),
  /** `HH:mm`; an empty string means no time was recorded. */
  occurredTime: z.string().regex(/^(([01][0-9]|2[0-3]):[0-5][0-9])?$/),
});
export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;

export const duplicateCheckResponseSchema = z.object({
  /** Matching entries, most recent first. Empty when there is nothing to warn about. */
  duplicates: z.array(transactionSchema),
});
export type DuplicateCheckResponse = z.infer<typeof duplicateCheckResponseSchema>;
