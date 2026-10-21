import {
  buildNotDuplicateBasis,
  isNotDuplicateBasisStale,
  keyFieldsChanged,
  readNotDuplicateBasis,
  type NotDuplicateBasis,
  type NotDuplicateBasisStaleness,
  type NotDuplicateBasisTransaction,
  type NotDuplicateCurrentTransaction,
  type NotDuplicateKeyField,
  type NotDuplicateRelation,
  type NotDuplicateRelationTransaction,
} from "@libellum/shared";

import type { Prisma } from "../generated/prisma/client.js";
import type { PrismaClient } from "../db.js";
import { bookLockInfo } from "./ledgerLocks.js";
import { conflict } from "../lib/errors.js";

/**
 * S15-E3 · 不重复关系的服务端逻辑。
 *
 * 这里只做四件事：把数据库行翻译成 API 形状、按当前值判断关系是否失效、
 * 写入/重激活、按交易撤销。**权限不在这里**——路由复用 `access.ts` 的既有包装器
 * （敏感权限判断只许新增、不许改动）。
 *
 * ⚠️ **失效规则（所有者 2026-10-21 定义）**：
 *  - 金额 / 币种 / 方向 / 时间 任一变化 → 失效（`key_fields_changed`），该对重新进入候选；
 *  - 分类 / 支付方式 / 标签 / 商户 / 备注变化 → **不失效**（E2 规则里不是必要条件）；
 *  - 软删除 / 恢复 → **不失效**（删除不改变"不是同一笔钱"这个判断）；
 *  - 交易被永久清理 → 对端摘要为 `null`，关系不再参与抑制。
 *
 * ⚠️ **两层失效**：`PATCH /transactions/:id` 在同一事务里调用
 * {@link revokeRelationsTouchingTransaction}（确定性）；读取时
 * {@link relationView} 再拿 `basis` 与当前值比较一次（兜底，覆盖导入/清理等
 * 绕过 PATCH 的历史数据）。读取时的判定**只影响返回结果，不写库**——GET 不做写操作。
 */

type Tx = Prisma.TransactionClient;
type DbClient = PrismaClient | Tx;

/** 关系行的 Prisma 形状；路由与测试都复用它，不各写一份。 */
export type RelationRow = RelationRowBase;
type RelationRowBase = Prisma.TransactionNotDuplicateRelationGetPayload<Record<string, never>>;

export interface RelationTransactionRow {
  readonly id: string;
  readonly bookId: string;
  readonly seq: number;
  readonly version: number;
  readonly amountCents: bigint;
  readonly currency: string;
  readonly kind: string;
  readonly occurredAt: Date;
  readonly occurredLocalDate: Date;
  readonly occurredTz: string;
  readonly categoryId: string;
  readonly paymentMethodId: string | null;
  readonly deletedAt: Date | null;
  readonly category: { readonly name: string };
  readonly paymentMethod: { readonly name: string } | null;
}

/** 读取关系两端需要的交易列；`deletedAt` 保留，用于界面标注"已删除"。 */
const RELATION_TRANSACTION_SELECT = {
  id: true,
  bookId: true,
  seq: true,
  version: true,
  amountCents: true,
  currency: true,
  kind: true,
  occurredAt: true,
  occurredLocalDate: true,
  occurredTz: true,
  categoryId: true,
  paymentMethodId: true,
  deletedAt: true,
  category: { select: { name: true } },
  paymentMethod: { select: { name: true } },
} as const satisfies Prisma.TransactionSelect;

function currentValues(row: RelationTransactionRow): NotDuplicateCurrentTransaction {
  return {
    transactionId: row.id,
    amountCents: row.amountCents.toString(),
    currency: row.currency,
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
  };
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** 判定快照：金额用字符串，避免 JSON 与 BigInt 之间的精度问题。 */
function basisTransaction(row: RelationTransactionRow): NotDuplicateBasisTransaction {
  return {
    transactionId: row.id,
    seq: row.seq,
    version: row.version,
    amountCents: row.amountCents.toString(),
    currency: row.currency,
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
    occurredLocalDate: dateOnly(row.occurredLocalDate),
    occurredTz: row.occurredTz,
    categoryId: row.categoryId,
    paymentMethodId: row.paymentMethodId,
  };
}

function makeBasis(
  a: RelationTransactionRow,
  b: RelationTransactionRow,
  capturedAt: Date,
): NotDuplicateBasis {
  return buildNotDuplicateBasis(basisTransaction(a), basisTransaction(b), capturedAt.toISOString());
}

function transactionSummary(row: RelationTransactionRow): NotDuplicateRelationTransaction {
  return {
    id: row.id,
    seq: row.seq,
    occurredAt: row.occurredAt.toISOString(),
    occurredLocalDate: dateOnly(row.occurredLocalDate),
    amountCents: Number(row.amountCents),
    currency: row.currency,
    kind: row.kind === "income" ? "income" : "expense",
    categoryName: row.category.name,
    paymentMethodName: row.paymentMethod?.name ?? null,
    deleted: row.deletedAt !== null,
  };
}

export interface RelationViewContext {
  readonly transactions: ReadonlyMap<string, RelationTransactionRow>;
}

/** 当前关系是否仍应抑制重复提示；撤销/失效/对端缺失都不抑制。 */
export function relationView(
  row: RelationRow,
  context: RelationViewContext,
): {
  readonly staleness: NotDuplicateBasisStaleness;
  readonly transactionA: RelationTransactionRow | null;
  readonly transactionB: RelationTransactionRow | null;
  readonly effective: boolean;
} {
  const a = context.transactions.get(row.transactionAId) ?? null;
  const b = context.transactions.get(row.transactionBId) ?? null;
  const basis = readNotDuplicateBasis(row.basis);
  const staleness = isNotDuplicateBasisStale(basis, {
    a: a === null ? null : currentValues(a),
    b: b === null ? null : currentValues(b),
  });

  const missingSide = a === null || b === null;
  const effective =
    row.revokedAt === null && !staleness.stale && !staleness.unreadable && !missingSide;

  return { staleness, transactionA: a, transactionB: b, effective };
}

export function toRelationDto(
  row: RelationRow,
  view: ReturnType<typeof relationView>,
): NotDuplicateRelation {
  return {
    id: row.id,
    bookId: row.bookId,
    transactionAId: row.transactionAId,
    transactionBId: row.transactionBId,
    relationship: "not_duplicate",
    decisionSource: row.decisionSource as NotDuplicateRelation["decisionSource"],
    decidedBy: row.decidedBy,
    decidedByName: row.decidedByName,
    decidedAt: row.decidedAt.toISOString(),
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    revokedBy: row.revokedBy,
    revokedByName: row.revokedByName,
    revocationReason: row.revocationReason,
    stale: view.staleness.stale || view.staleness.unreadable,
    staleFields: [...view.staleness.changedFields],
    effective: view.effective,
    transactionA: view.transactionA === null ? null : transactionSummary(view.transactionA),
    transactionB: view.transactionB === null ? null : transactionSummary(view.transactionB),
  };
}

export async function loadRelationTransactions(
  client: DbClient,
  bookId: string,
  ids: readonly string[],
): Promise<Map<string, RelationTransactionRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const rows = await client.transaction.findMany({
    where: { bookId, id: { in: unique } },
    select: RELATION_TRANSACTION_SELECT,
  });

  return new Map(rows.map((row) => [row.id, row as RelationTransactionRow]));
}

/**
 * 导入锁的可读错误。
 *
 * ⚠️ 数据库触发器（migration 里给本表挂的 `trg_guard_transaction_not_duplicate_relations`）
 * 是最终兜底；这里先查一次，是为了给出**具体**提示，而不是让用户看到通用的
 * "账本正在导入"。两次判断共用 `ledger_write_locks`，不改既有触发器。
 */
export async function assertRelationsNotLocked(client: DbClient, bookId: string): Promise<void> {
  const lock = await bookLockInfo(client, bookId);
  if (lock === null) return;

  throw conflict(
    "book_locked",
    "这本账正在进行导入、确认或撤销，暂时不能修改「不重复」判断；请等操作完成后再试。",
    { bookId, ownerKind: lock.ownerKind, ownerId: lock.ownerId },
  );
}

export interface RelationWritePlanItem {
  readonly transactionAId: string;
  readonly transactionBId: string;
}

export interface RelationWriteContext {
  readonly bookId: string;
  readonly decidedBy: string | null;
  readonly decidedByName: string | null;
  readonly decisionSource: string;
  readonly now: Date;
}

export interface RelationWriteOutcome {
  readonly created: number;
  readonly reactivated: number;
  readonly unchanged: number;
  readonly ids: readonly string[];
}

/**
 * 写入一批显式对：不存在则建、已撤销则**原地重激活**、已生效则原样返回。
 *
 * ⚠️ **每一对各自生成 basis**：不同对的金额/时间不同，不能整批共用一个快照。
 * 调用方必须传入已经加载好的交易行（`transactions`），并且已经校验过两笔都属于该账本。
 *
 * ⚠️ 同一对再次确认时重激活旧行而不是插新行：唯一约束 `(bookId, a, b)` 决定每对只有一行，
 * 撤销历史因此不单独保留（`decidedAt`/`decidedBy` 会被这次确认覆盖）。要保留完整历史
 * 需要另加审计表，超出 E3 授权范围。
 */
export async function writeRelations(
  tx: Tx,
  context: RelationWriteContext,
  plan: readonly RelationWritePlanItem[],
  transactions: ReadonlyMap<string, RelationTransactionRow>,
): Promise<RelationWriteOutcome> {
  let created = 0;
  let reactivated = 0;
  let unchanged = 0;
  const ids: string[] = [];

  for (const item of plan) {
    const transactionA = transactions.get(item.transactionAId);
    const transactionB = transactions.get(item.transactionBId);
    // The route validates this before opening the transaction; a missing row here is a bug.
    if (transactionA === undefined || transactionB === undefined) {
      throw new Error("writeRelations: transaction row missing from the validated set");
    }

    const basis = makeBasis(transactionA, transactionB, context.now);

    const existing = await tx.transactionNotDuplicateRelation.findUnique({
      where: {
        bookId_transactionAId_transactionBId: {
          bookId: context.bookId,
          transactionAId: item.transactionAId,
          transactionBId: item.transactionBId,
        },
      },
    });

    if (existing === null) {
      const row = await tx.transactionNotDuplicateRelation.create({
        data: {
          bookId: context.bookId,
          transactionAId: item.transactionAId,
          transactionBId: item.transactionBId,
          relationship: "not_duplicate",
          decisionSource: context.decisionSource,
          decidedBy: context.decidedBy,
          decidedByName: context.decidedByName,
          decidedAt: context.now,
          basis: basis as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      ids.push(row.id);
      created += 1;
      continue;
    }

    /**
     * 已生效且快照仍与当前值一致 → 幂等返回，不重写 `decidedAt`。
     */
    const stored = readNotDuplicateBasis(existing.basis);
    const staleness = isNotDuplicateBasisStale(stored, {
      a: currentValues(transactionA),
      b: currentValues(transactionB),
    });

    if (existing.revokedAt === null && !staleness.stale && !staleness.unreadable) {
      ids.push(existing.id);
      unchanged += 1;
      continue;
    }

    const row = await tx.transactionNotDuplicateRelation.update({
      where: { id: existing.id },
      data: {
        decisionSource: context.decisionSource,
        decidedBy: context.decidedBy,
        decidedByName: context.decidedByName,
        decidedAt: context.now,
        basis: basis as unknown as Prisma.InputJsonValue,
        revokedAt: null,
        revokedBy: null,
        revokedByName: null,
        revocationReason: null,
      },
      select: { id: true },
    });
    ids.push(row.id);

    if (existing.revokedAt === null) unchanged += 1;
    else reactivated += 1;
  }

  return { created, reactivated, unchanged, ids };
}


/**
 * **写入时确定性撤销**：这笔交易的关键字段变了，涉及它的全部生效关系立即失效。
 *
 * ⚠️ 只在同一 DB 事务里调用（`PATCH /transactions/:id`），错误会连带回滚整次编辑。
 */
export async function revokeRelationsTouchingTransaction(
  tx: Tx,
  input: {
    readonly bookId: string;
    readonly transactionId: string;
    readonly actorId: string | null;
    readonly actorName: string | null;
    readonly now: Date;
  },
): Promise<number> {
  const result = await tx.transactionNotDuplicateRelation.updateMany({
    where: {
      bookId: input.bookId,
      revokedAt: null,
      OR: [
        { transactionAId: input.transactionId },
        { transactionBId: input.transactionId },
      ],
    },
    data: {
      revokedAt: input.now,
      revokedBy: input.actorId,
      revokedByName: input.actorName,
      revocationReason: "key_fields_changed",
    },
  });

  return result.count;
}

/**
 * 判断一次编辑是否改动了关键字段。
 *
 * 与 `diffEntry` 分开：历史记录关心 8 个字段，关系失效只关心 4 个关键字段；
 * 两者共用 `@libellum/shared` 的 `keyFieldsChanged`，不各写一份规则。
 */
export function changedKeyFields(
  before: { amountCents: bigint; currency: string; kind: string; occurredAt: Date },
  after: { amountCents: bigint; currency: string; kind: string; occurredAt: Date },
): readonly NotDuplicateKeyField[] {
  return keyFieldsChanged(
    {
      amountCents: before.amountCents.toString(),
      currency: before.currency,
      kind: before.kind,
      occurredAt: before.occurredAt.toISOString(),
    },
    {
      amountCents: after.amountCents.toString(),
      currency: after.currency,
      kind: after.kind,
      occurredAt: after.occurredAt.toISOString(),
    },
  );
}
