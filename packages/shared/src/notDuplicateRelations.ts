/**
 * S15-E3 · 「不重复关系」的公共纯函数与协议形状。
 *
 * 这张表记住的是**用户明确确认过的两两判断**：「A 与 B 不是同一笔」。
 * 它**不具备传递性**——A–B 与 B–C 都不能推出 A–C，所以这里只提供
 * `expandNotDuplicatePairs(ids)`（把用户明确说"这几笔都独立"的一组展开成 C(n,2) 个显式对）
 * 与配对规范化，不提供任何"由图推导"的函数。
 *
 * ⚠️ **关系是账本级共享状态**，服务器权威；个人检测偏好仍然只存 `localStorage`，
 * 两者不混存（见 `docs/specs/features/S15-E3-不重复关系记忆-设计决定.md`）。
 *
 * ⚠️ **`basis` 是判定当时的值快照，不是引用。** 金额、币种、方向、时间任一变化
 * （{@link NOT_DUPLICATE_KEY_FIELDS}）都会让关系失效；分类、支付方式、标签、商户、备注
 * 变化不失效——按 E2 统一规则，它们本来就不是"疑似重复"的必要条件。
 *
 * ⚠️ **读取端必须能容忍对端缺失**：交易侧没有外键（原因见 `prisma/schema.prisma`
 * 的模型注释），所以这里所有"当前值"入参都允许 `null`。
 */

import { z } from "zod";

import { uuidSchema } from "./ledger.js";

// ---------------------------------------------------------------------------
// 常量与取值
// ---------------------------------------------------------------------------

/** 无序配对键的分隔符；与 E2 `duplicatePairKey` 保持一致。 */
const PAIR_SEPARATOR = "\u0000";

/** 首版唯一的关系类型；扩展前必须先改数据库 CHECK。 */
export const NOT_DUPLICATE_RELATIONSHIP = "not_duplicate" as const;
export type NotDuplicateRelationship = typeof NOT_DUPLICATE_RELATIONSHIP;

/** 关系是怎么被确认的；用于统计与撤销时说明来源。 */
export const NOT_DUPLICATE_DECISION_SOURCES = [
  "manual",
  "review_group",
  "import_review",
] as const;
export type NotDuplicateDecisionSource = (typeof NOT_DUPLICATE_DECISION_SOURCES)[number];

export const NOT_DUPLICATE_DECISION_SOURCE_LABELS: Readonly<
  Record<NotDuplicateDecisionSource, string>
> = {
  manual: "逐对确认",
  review_group: "整组确认",
  import_review: "导入核对",
};

/**
 * 失效原因。
 *
 * - `user_revoked`：用户主动撤销；
 * - `key_fields_changed`：金额/币种/方向/时间被改（写入时确定性撤销）；
 * - `basis_stale`：读取时发现快照与当前值不一致（历史数据兜底）；
 * - `book_cleanup`：账本生命周期清理。
 */
export const NOT_DUPLICATE_REVOCATION_REASONS = [
  "user_revoked",
  "key_fields_changed",
  "basis_stale",
  "book_cleanup",
] as const;
export type NotDuplicateRevocationReason = (typeof NOT_DUPLICATE_REVOCATION_REASONS)[number];

/** 单次请求的显式对数上限（C(200,2) 已经远超真实使用量）。 */
export const MAX_NOT_DUPLICATE_PAIRS_PER_REQUEST = 200;
/** 单次「整组确认」的成员上限：C(20,2)=190，仍在校验范围内。 */
export const MAX_NOT_DUPLICATE_GROUP_SIZE = 20;

// ---------------------------------------------------------------------------
// 配对规范化
// ---------------------------------------------------------------------------

export interface NotDuplicatePair {
  /** 字典序较小的一方。 */
  readonly transactionAId: string;
  /** 字典序较大的一方。 */
  readonly transactionBId: string;
}

export type NotDuplicatePairError =
  | { readonly code: "missing_id"; readonly message: string }
  | { readonly code: "same_transaction"; readonly message: string };

export type NotDuplicatePairResult =
  | { readonly ok: true; readonly pair: NotDuplicatePair }
  | { readonly ok: false; readonly error: NotDuplicatePairError };

/**
 * 把一对交易 id 规范化成 `a < b`。
 *
 * 比较的是**去掉首尾空白后的字符串**；UUID 的规范小写形式在 PostgreSQL 的 uuid 比较里
 * 与字符串字典序一致（相同位置、相同十六进制字符），所以应用层与数据库 CHECK 的结论不会分叉。
 * 非 UUID 形态的 id 不会被拒绝——那是协议层 `uuidSchema` 的职责，这里只做排序，
 * 便于纯函数测试与将来的其它 id 体系。
 */
export function normalizeNotDuplicatePair(
  left: string,
  right: string,
): NotDuplicatePairResult {
  const first = left.trim();
  const second = right.trim();

  if (first === "" || second === "") {
    return {
      ok: false,
      error: { code: "missing_id", message: "配对的两笔交易 id 都不能为空。" },
    };
  }

  if (first === second) {
    return {
      ok: false,
      error: { code: "same_transaction", message: "一笔交易不能和自己构成不重复关系。" },
    };
  }

  return first < second
    ? { ok: true, pair: { transactionAId: first, transactionBId: second } }
    : { ok: true, pair: { transactionAId: second, transactionBId: first } };
}

/**
 * 与左右顺序无关的配对键。
 *
 * 与 E2 的 `duplicatePairKey` **格式完全相同**（较小 id + `\u0000` + 较大 id），
 * 因为 E2 检测适配层就是按这个键抑制已确认的对。
 */
export function notDuplicatePairKey(left: string, right: string): string {
  const normalized = normalizeNotDuplicatePair(left, right);
  if (!normalized.ok) {
    // 非法输入也给出一个确定性的键，让调用方可以去重/打日志，而不是抛异常。
    return left <= right ? `${left}${PAIR_SEPARATOR}${right}` : `${right}${PAIR_SEPARATOR}${left}`;
  }

  return `${normalized.pair.transactionAId}${PAIR_SEPARATOR}${normalized.pair.transactionBId}`;
}

/** 从一组「已确认互不重复」的交易复习出 C(n,2) 个显式对（去重、稳定排序）。 */
export function expandNotDuplicatePairs(
  transactionIds: readonly string[],
): NotDuplicatePair[] {
  const ids = [...new Set(transactionIds.map((id) => id.trim()).filter((id) => id !== ""))].sort();

  const pairs: NotDuplicatePair[] = [];
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      const normalized = normalizeNotDuplicatePair(ids[left]!, ids[right]!);
      if (normalized.ok) pairs.push(normalized.pair);
    }
  }

  return pairs;
}

/** 把一批关系行变成"已确认"的配对键集合，供 E2 检测适配层过滤。 */
export function notDuplicatePairKeySet(
  pairs: readonly { readonly transactionAId: string; readonly transactionBId: string }[],
): ReadonlySet<string> {
  return new Set(pairs.map((pair) => notDuplicatePairKey(pair.transactionAId, pair.transactionBId)));
}

// ---------------------------------------------------------------------------
// Basis（判定时的值快照）与失效判断
// ---------------------------------------------------------------------------

/** 影响"是不是同一笔"的关键字段；任一变化 → 关系失效。 */
export const NOT_DUPLICATE_KEY_FIELDS = ["amountCents", "currency", "kind", "occurredAt"] as const;
export type NotDuplicateKeyField = (typeof NOT_DUPLICATE_KEY_FIELDS)[number];

export interface NotDuplicateBasisTransaction {
  readonly transactionId: string;
  /** 用户可见编号（#000123 的 123），便于日志与失效说明。 */
  readonly seq: number;
  /** 判定当时的行版本；只作说明，**不单独触发失效**（E1 §6.4）。 */
  readonly version: number;
  /** 整数最小单位，**字符串**：JSON 与 BigInt 之间不经 Number，避免精度问题。 */
  readonly amountCents: string;
  readonly currency: string;
  readonly kind: string;
  /** 带偏移的 ISO 时间戳。 */
  readonly occurredAt: string;
  /** `YYYY-MM-DD`。 */
  readonly occurredLocalDate: string;
  readonly occurredTz: string;
  /** 非关键字段，只记录快照与展示，不参与失效判断。 */
  readonly categoryId: string | null;
  readonly paymentMethodId: string | null;
}

/** `basis` 列的权威形状；`version` 留给未来的语义变更。 */
export interface NotDuplicateBasis {
  readonly version: 1;
  readonly capturedAt: string;
  readonly a: NotDuplicateBasisTransaction;
  readonly b: NotDuplicateBasisTransaction;
}

/** 构造一条关系的判定快照；`capturedAt` 由调用方传入，保证纯函数可测。 */
export function buildNotDuplicateBasis(
  a: NotDuplicateBasisTransaction,
  b: NotDuplicateBasisTransaction,
  capturedAt: string,
): NotDuplicateBasis {
  return { version: 1, capturedAt, a, b };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBasisTransaction(value: unknown): NotDuplicateBasisTransaction | null {
  if (!isRecord(value)) return null;

  const transactionId = readString(value, "transactionId");
  const amountCents = readString(value, "amountCents");
  const currency = readString(value, "currency");
  const kind = readString(value, "kind");
  const occurredAt = readString(value, "occurredAt");
  const occurredLocalDate = readString(value, "occurredLocalDate");
  const occurredTz = readString(value, "occurredTz");
  const seq = readNumber(value, "seq");
  const version = readNumber(value, "version");

  if (
    transactionId === null ||
    amountCents === null ||
    currency === null ||
    kind === null ||
    occurredAt === null ||
    occurredLocalDate === null ||
    occurredTz === null ||
    seq === null ||
    version === null
  ) {
    return null;
  }

  return {
    transactionId,
    seq,
    version,
    amountCents,
    currency,
    kind,
    occurredAt,
    occurredLocalDate,
    occurredTz,
    categoryId: readString(value, "categoryId"),
    paymentMethodId: readString(value, "paymentMethodId"),
  };
}

/**
 * 从 `basis` 列的 JSON 读回快照。
 *
 * 旧数据/被手工改坏的数据返回 `null`，由调用方决定怎么处理——
 * {@link isNotDuplicateBasisStale} 把"读不出快照"按失效处理（宁可多问一次，
 * 也不让一条无法核对的旧判断永久压住新的疑似重复）。
 */
export function readNotDuplicateBasis(value: unknown): NotDuplicateBasis | null {
  if (!isRecord(value)) return null;
  if (value["version"] !== 1) return null;

  const capturedAt = readString(value, "capturedAt");
  const a = readBasisTransaction(value["a"]);
  const b = readBasisTransaction(value["b"]);
  if (capturedAt === null || a === null || b === null) return null;

  return { version: 1, capturedAt, a, b };
}

/** 用于比较的当前值；交易行已被永久清理时整条为 `null`。 */
export interface NotDuplicateCurrentTransaction {
  readonly transactionId?: string | undefined;
  readonly amountCents: string;
  readonly currency: string;
  readonly kind: string;
  readonly occurredAt: string;
}

export interface NotDuplicateBasisStaleness {
  /** `true` = 不再抑制重复提示（该对重新进入候选）。 */
  readonly stale: boolean;
  /** 哪几个关键字段变了；`readable === false` 时为空。 */
  readonly changedFields: readonly NotDuplicateKeyField[];
  /** `true` = 快照读不出来（损坏/旧格式），按失效处理。 */
  readonly unreadable: boolean;
  /** `true` = 至少一侧交易已读不到（例如被账本清理）。 */
  readonly missingSide: boolean;
}

function normalizeAmount(value: string): string {
  return value.trim();
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function sameInstant(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime === rightTime;

  return left.trim() === right.trim();
}

/**
 * 拿 `basis` 与当前值比较，判断这条关系是否已经失效。
 *
 * 只比较 {@link NOT_DUPLICATE_KEY_FIELDS}：分类/支付方式/标签/商户/备注变化**不失效**
 * （E2 规则里它们不是必要条件；E1 §6.4 明确不建议用 `version` 一刀切）。
 */
export function isNotDuplicateBasisStale(
  basis: NotDuplicateBasis | null,
  current: {
    readonly a: NotDuplicateCurrentTransaction | null;
    readonly b: NotDuplicateCurrentTransaction | null;
  },
): NotDuplicateBasisStaleness {
  if (basis === null) {
    return { stale: true, changedFields: [], unreadable: true, missingSide: false };
  }

  if (current.a === null || current.b === null) {
    return { stale: false, changedFields: [], unreadable: false, missingSide: true };
  }

  const changed = new Set<NotDuplicateKeyField>();

  if (normalizeAmount(basis.a.amountCents) !== normalizeAmount(current.a.amountCents)) {
    changed.add("amountCents");
  }
  if (normalizeAmount(basis.b.amountCents) !== normalizeAmount(current.b.amountCents)) {
    changed.add("amountCents");
  }

  if (normalizeCurrency(basis.a.currency) !== normalizeCurrency(current.a.currency)) {
    changed.add("currency");
  }
  if (normalizeCurrency(basis.b.currency) !== normalizeCurrency(current.b.currency)) {
    changed.add("currency");
  }

  if (basis.a.kind !== current.a.kind) changed.add("kind");
  if (basis.b.kind !== current.b.kind) changed.add("kind");

  if (!sameInstant(basis.a.occurredAt, current.a.occurredAt)) changed.add("occurredAt");
  if (!sameInstant(basis.b.occurredAt, current.b.occurredAt)) changed.add("occurredAt");

  const changedFields = NOT_DUPLICATE_KEY_FIELDS.filter((field) => changed.has(field));

  return {
    stale: changedFields.length > 0,
    changedFields,
    unreadable: false,
    missingSide: false,
  };
}

/**
 * 写入时撤销用的字段比较（在 `PATCH /transactions/:id` 的同一事务里用）。
 *
 * 与 {@link isNotDuplicateBasisStale} 的区别只是输入：这里比较的是"同一行的 before/after"，
 * 而不是"快照 vs 当前值"。两者共用同一组关键字段定义，不允许各写一份。
 */
export function keyFieldsChanged(
  before: NotDuplicateCurrentTransaction,
  after: NotDuplicateCurrentTransaction,
): readonly NotDuplicateKeyField[] {
  const changed = new Set<NotDuplicateKeyField>();

  if (normalizeAmount(before.amountCents) !== normalizeAmount(after.amountCents)) {
    changed.add("amountCents");
  }
  if (normalizeCurrency(before.currency) !== normalizeCurrency(after.currency)) {
    changed.add("currency");
  }
  if (before.kind !== after.kind) changed.add("kind");
  if (!sameInstant(before.occurredAt, after.occurredAt)) changed.add("occurredAt");

  return NOT_DUPLICATE_KEY_FIELDS.filter((field) => changed.has(field));
}

// ---------------------------------------------------------------------------
// 协议形状（API 请求/响应）
// ---------------------------------------------------------------------------

export const notDuplicatePairSchema = z
  .object({
    transactionIdA: uuidSchema,
    transactionIdB: uuidSchema,
  })
  .strict();

/**
 * `POST /books/:bookId/not-duplicate-relations` 请求体。
 *
 * 两种显式输入，**都必须来自用户"明确确认互不重复"这一个动作**：
 *  - `pairs`：逐对确认；
 *  - `transactionIds`：用户把整组标为"都不是同一笔"时，服务端按两两展开 C(n,2)。
 *    这不是传递性推导——每一个对都来自用户点名的那一组。
 *
 * ⚠️ 两种都给时取并集（再规范化去重）；都没有则 400。
 * ⚠️ 请求里**没有**"从 keep/replace 等操作自动推断"的字段，也不接受客户端指定 basis。
 */
export const createNotDuplicateRelationsSchema = z
  .object({
    pairs: z.array(notDuplicatePairSchema).max(MAX_NOT_DUPLICATE_PAIRS_PER_REQUEST).optional(),
    transactionIds: z.array(uuidSchema).max(MAX_NOT_DUPLICATE_GROUP_SIZE).optional(),
    decisionSource: z.enum(NOT_DUPLICATE_DECISION_SOURCES).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const pairCount = value.pairs?.length ?? 0;
    const groupIds = new Set((value.transactionIds ?? []).map((id) => id.trim()));

    if (pairCount === 0 && groupIds.size === 0) {
      context.addIssue({
        code: "custom",
        path: ["pairs"],
        message: "请提供要确认的交易对（pairs）或一组互不重复的交易（transactionIds）。",
      });
    }
  });

export type CreateNotDuplicateRelationsInput = z.infer<typeof createNotDuplicateRelationsSchema>;

/** 交易摘要：管理页要显示"是哪两笔"，但不复制整笔账。 */
export const notDuplicateRelationTransactionSchema = z
  .object({
    id: uuidSchema,
    seq: z.number().int().nonnegative(),
    occurredAt: z.string(),
    occurredLocalDate: z.string(),
    amountCents: z.number().int().nonnegative(),
    currency: z.string(),
    kind: z.enum(["income", "expense"]),
    categoryName: z.string().nullable(),
    paymentMethodName: z.string().nullable(),
    deleted: z.boolean(),
  })
  .strict();

export type NotDuplicateRelationTransaction = z.infer<
  typeof notDuplicateRelationTransactionSchema
>;

export const notDuplicateRelationSchema = z
  .object({
    id: uuidSchema,
    bookId: uuidSchema,
    transactionAId: uuidSchema,
    transactionBId: uuidSchema,
    relationship: z.enum([NOT_DUPLICATE_RELATIONSHIP]),
    decisionSource: z.enum(NOT_DUPLICATE_DECISION_SOURCES),
    decidedBy: z.string().nullable(),
    decidedByName: z.string().nullable(),
    decidedAt: z.string(),
    revokedAt: z.string().nullable(),
    revokedBy: z.string().nullable(),
    revokedByName: z.string().nullable(),
    revocationReason: z.string().nullable(),
    /** 快照与当前值不一致：不再抑制重复提示。 */
    stale: z.boolean(),
    staleFields: z.array(z.enum(NOT_DUPLICATE_KEY_FIELDS)),
    /** 当前是否仍然生效（未撤销、不 stale、两侧都还在）。 */
    effective: z.boolean(),
    /** 交易被永久清理时对应一侧为 `null`。 */
    transactionA: notDuplicateRelationTransactionSchema.nullable(),
    transactionB: notDuplicateRelationTransactionSchema.nullable(),
  })
  .strict();

export type NotDuplicateRelation = z.infer<typeof notDuplicateRelationSchema>;

export const notDuplicateRelationListResponseSchema = z
  .object({
    items: z.array(notDuplicateRelationSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type NotDuplicateRelationListResponse = z.infer<
  typeof notDuplicateRelationListResponseSchema
>;

export const notDuplicateRelationMutationResponseSchema = z
  .object({
    /** 本次请求涉及的完整关系行（含刚建/刚重激活的）。 */
    items: z.array(notDuplicateRelationSchema),
    created: z.number().int().nonnegative(),
    reactivated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  })
  .strict();

export type NotDuplicateRelationMutationResponse = z.infer<
  typeof notDuplicateRelationMutationResponseSchema
>;
