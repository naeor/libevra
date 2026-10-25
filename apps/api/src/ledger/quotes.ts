import type { PrismaClient } from "../generated/prisma/client.js";
import {
  formatTransactionNumber,
  UNCATEGORISED_NAME,
  type MessageReferenceView,
  type QuoteSnapshot,
  type QuoteTargetView,
} from "@libellum/shared";
import { historyEntryFromRow, HISTORY_EVENT_SELECT, readHistory, type HistoryEntry } from "./history.js";

/**
 * **What a quoted card shows, and where the availability bit comes from.**
 *
 * ⚠️ **The snapshot is stored; availability is computed on read.** A quote is a historical
 * statement — "this amount was ¥86 when I said it" — so the card must keep rendering after the
 * entry changes or is deleted. What *is* recomputed is whether the reader can still open the
 * target, which is a permission-and-existence question, not a content question.
 */

/** 快照用的账目列。⚠️ `deletedAt` 不选：它只影响 `available`，不影响卡片内容。 */
const TRANSACTION_SNAPSHOT_SELECT = {
  id: true,
  seq: true,
  note: true,
  amountCents: true,
  currency: true,
  kind: true,
  occurredAt: true,
  category: { select: { name: true } },
} as const;

type TransactionSnapshotRow = {
  readonly id: string;
  readonly seq: number | null;
  readonly note: string | null;
  readonly amountCents: bigint;
  readonly currency: string;
  readonly kind: string;
  readonly occurredAt: Date;
  readonly category: { readonly name: string } | null;
};

function transactionSnapshot(row: TransactionSnapshotRow): QuoteTargetView {
  const categoryName = row.category?.name ?? null;
  return {
    kind: "transaction",
    id: row.id,
    snapshot: {
      kind: "transaction",
      id: row.id,
      seq: row.seq,
      code: row.seq === null ? null : formatTransactionNumber(row.seq),
      /** ⚠️ 备注优先，其次分类名 —— 卡片第一行要能一眼认出是哪笔账。兜底用「暂无分类」的预置原文，
       * 由前端按界面语言显示（英文界面显示 Uncategorized），不在服务端写死中文。 */
      title: row.note ?? categoryName ?? UNCATEGORISED_NAME,
      categoryName,
      note: row.note,
      amountCents: String(row.amountCents),
      currency: row.currency,
      transactionKind: row.kind === "income" ? "income" : "expense",
      occurredAt: row.occurredAt.toISOString(),
    },
  };
}

function eventSnapshot(entry: HistoryEntry): QuoteTargetView {
  return {
    kind: "event",
    id: entry.id,
    snapshot: {
      kind: "event",
      id: entry.id,
      eventKind: entry.kind === "member_changed" || entry.kind === "book_changed" ? "updated" : entry.kind,
      occurredAt: entry.occurredAt,
      actorName: entry.actorName,
      transactionId: entry.transactionId,
      transactionSeq: entry.transactionSeq,
      summary: entry.summary,
      changes: entry.changes,
    },
  };
}

/**
 * The picker's default list: a handful of recent entries and recent edits.
 *
 * ⚠️ **Recent, not searched, in the first version.** The owner asked for "最近的少量记录，必要时再
 * 查看更多"; a search endpoint would be a second feature, and the sheet offering eight lines is
 * enough to point at the thing being discussed.
 */
export async function readQuoteTargets(
  prisma: PrismaClient,
  bookId: string,
  limit = 8,
): Promise<{ readonly transactions: QuoteTargetView[]; readonly events: QuoteTargetView[] }> {
  const [transactions, events] = await Promise.all([
    prisma.transaction.findMany({
      where: { bookId, deletedAt: null },
      orderBy: { occurredAt: "desc" },
      take: limit,
      select: TRANSACTION_SNAPSHOT_SELECT,
    }),
    readHistory(prisma, bookId, limit, { kinds: ["created", "updated", "deleted", "restored"] }),
  ]);

  return {
    transactions: transactions.map((row) => transactionSnapshot(row)),
    events: events.map((entry) => eventSnapshot(entry)),
  };
}

/**
 * One entry as a quote target, for the "引用留言" button on a just-saved entry.
 *
 * ⚠️ **Returns `null` rather than throwing when the entry is gone or belongs to another ledger.**
 * The caller turns that into the same `quote_target_unavailable` a stale picker hands back — one
 * error for "cannot be quoted", regardless of how the caller found out.
 */
export async function quoteTransactionTarget(
  prisma: PrismaClient,
  bookId: string,
  transactionId: string,
): Promise<QuoteTargetView | null> {
  const row = await prisma.transaction.findFirst({
    where: { id: transactionId, bookId, deletedAt: null },
    select: TRANSACTION_SNAPSHOT_SELECT,
  });
  return row === null ? null : transactionSnapshot(row);
}

/** One edit event as a quote target — used by the full board when it opens from a quick-quote link. */
export async function quoteEventTarget(
  prisma: PrismaClient,
  bookId: string,
  eventId: string,
): Promise<QuoteTargetView | null> {
  const row = await prisma.transactionEvent.findFirst({
    where: { id: eventId, bookId },
    select: HISTORY_EVENT_SELECT,
  });
  if (row === null) return null;
  const kind = row.kind;
  /** 成员/账本变更不是“某次账目修改”，不能被引用。 */
  if (kind !== "created" && kind !== "updated" && kind !== "deleted" && kind !== "restored") {
    return null;
  }
  return eventSnapshot(historyEntryFromRow(row));
}

/** A stored `book_messages` row as far as quotes care. */
export interface StoredMessageRow {
  readonly id: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly refKind: string | null;
  readonly refId: string | null;
  readonly refSnapshot: unknown;
}

/**
 * Recomputes `available` for a page of messages, without failing the whole page.
 *
 * ⚠️ **Two batched queries, not one per message.** A page holds at most 100 messages, but a
 * per-row permission check is still 100 round-trips; the id sets are small and indexed.
 *
 * ⚠️ **A message whose snapshot is missing or malformed is still delivered**, with
 * `snapshot: null` — the card degrades to "内容暂不可用" and the rest of the row (who, when, text)
 * survives. Losing a snapshot from an old row must never blank a conversation (`教训.md` §8.10).
 */
export async function withMessageReferences(
  prisma: PrismaClient,
  bookId: string,
  rows: readonly StoredMessageRow[],
): Promise<Array<StoredMessageRow & { readonly reference: MessageReferenceView | null }>> {
  const transactionIds = new Set<string>();
  const eventIds = new Set<string>();
  for (const row of rows) {
    if (row.refKind === "transaction" && row.refId !== null) transactionIds.add(row.refId);
    if (row.refKind === "event" && row.refId !== null) eventIds.add(row.refId);
  }

  const [liveTransactions, liveEvents] = await Promise.all([
    transactionIds.size === 0
      ? []
      : prisma.transaction.findMany({
          where: { bookId, deletedAt: null, id: { in: [...transactionIds] } },
          select: { id: true },
        }),
    eventIds.size === 0
      ? []
      : prisma.transactionEvent.findMany({ where: { bookId, id: { in: [...eventIds] } }, select: { id: true } }),
  ]);
  const availableTransactions = new Set(liveTransactions.map((row) => row.id));
  const availableEvents = new Set(liveEvents.map((row) => row.id));

  return rows.map((row) => {
    if (row.refKind !== "transaction" && row.refKind !== "event") {
      return { ...row, reference: null };
    }
    const available =
      row.refId === null
        ? false
        : row.refKind === "transaction"
          ? availableTransactions.has(row.refId)
          : availableEvents.has(row.refId);
    const snapshot = parseSnapshot(row.refSnapshot);
    return {
      ...row,
      reference:
        row.refId === null || snapshot === null
          ? null
          : { kind: row.refKind, id: row.refId, available, snapshot },
    };
  });
}

/**
 * ⚠️ **A JSON column is untrusted input, even when it was written by this server.** The shape is
 * checked against the same `kind` the column claims; anything unexpected becomes `null` and the
 * card degrades instead of the JSON reaching a renderer.
 */
function parseSnapshot(value: unknown): QuoteSnapshot | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as { kind?: unknown };
  if (candidate.kind === "transaction") {
    return typeof (value as { id?: unknown }).id === "string" ? (value as QuoteSnapshot) : null;
  }
  if (candidate.kind === "event") {
    return typeof (value as { id?: unknown }).id === "string" ? (value as QuoteSnapshot) : null;
  }
  return null;
}
