import { currentAuditContext } from "./auditContext.js";
import { assertStorageGrowth, lockAccountStorage } from "./storage.js";
import type { Prisma } from "../generated/prisma/client.js";

/** 业务保存与完整历史、创建者提醒同事务提交。设备时间单独记录，服务器接收时间不被覆盖。 */

type Tx = Prisma.TransactionClient;

export type EventKind =
  | "created"
  | "updated"
  | "deleted"
  | "restored"
  | "member_changed"
  /**
   * ⚠️ **About the ledger itself rather than about one entry** (added 1.10.08, for renaming).
   *
   * ⚠️ **The counterpart of `member_changed`, and for the same reason**: `transactionId` and
   * `transactionSeq` are both null, because there is no entry behind it. The owner's framing for the
   * history is *"谁在什么时候，对哪一笔账目做了什么修改"* — and his own extension of it —
   * *"也可以适当展示成员加入、退出……等重要协作事件."* **A ledger's name changing is one of those.**
   */
  | "book_changed";

/** One field's before and after, as the history screen renders it. */
export interface FieldChange {
  readonly from: unknown;
  readonly to: unknown;
}

export interface RecordEventInput {
  readonly bookId: string;
  /** Null for a `member_changed` event — those are about the ledger, not about one entry. */
  readonly transactionId?: string | null;
  /**
   * ⚠️ **The entry's number at the time of the event.** Stored because after a delete the entry
   * cannot be asked for its number any more, and **a history line that cannot name the entry is
   * useless** — one of the owner's three examples is *"删除了 #000103"*.
   */
  readonly transactionSeq?: number | null;
  readonly actorId: string | null;
  /** ⚠️ A snapshot, so a closed account's actions still read as a person's. */
  readonly actorName: string | null;
  readonly kind: EventKind;
  /** Which fields changed, and what they were. Omitted for created/deleted/restored. */
  readonly changes?: Record<string, FieldChange> | null;
  readonly at?: Date;
  readonly operationId?: string;
  readonly beforeSnapshot?: unknown;
  readonly offlineChanges?: unknown;
  readonly deviceEdits?: readonly { at: string; changes: Record<string, { from: unknown; to: unknown }> }[];
}

/**
 * Append one event.
 *
 * ⚠️ **`actorName` is stored rather than joined.** A join would show the name the account has
 * *now* — so renaming yourself would silently rewrite history, and closing the account would blank
 * it. **The history says who did it at the time**, which is the only answer that stays true.
 */
export async function recordEvent(tx: Tx, input: RecordEventInput): Promise<void> {
  if (input.operationId && await tx.transactionEvent.findFirst({ where: { bookId: input.bookId, transactionId: input.transactionId ?? null, operationId: input.operationId }, select: { id: true } })) return;
  const entry = input.transactionId ? await tx.transaction.findUnique({
    where: { id: input.transactionId },
    include: { category: { select: { id: true, name: true } }, paymentMethod: { select: { id: true, name: true } },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } } },
  }) : null;
  const snapshot = entry ? JSON.parse(JSON.stringify({
    after: { id: entry.id, seq: entry.seq, creatorId: entry.userId, amountCents: entry.amountCents.toString(),
      currency: entry.currency, kind: entry.kind, occurredAt: entry.occurredAt, occurredLocalDate: entry.occurredLocalDate,
      occurredTz: entry.occurredTz, note: entry.note, category: entry.category, paymentMethod: entry.paymentMethod,
      tags: entry.tags.map(({ tag }) => tag), deletedAt: entry.deletedAt },
    ...(input.beforeSnapshot === undefined ? {} : { before: auditSnapshot(input.beforeSnapshot) }),
    ...(input.deviceEdits?.length ? { deviceEdits: input.deviceEdits } : {}),
    ...(input.offlineChanges === undefined ? {} : { acceptedDeviceChanges: input.offlineChanges }),
  }, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)) as Prisma.InputJsonValue : undefined;
  const event = await tx.transactionEvent.create({
    data: {
      ...currentAuditContext(),
      ...(input.operationId ? { operationId: input.operationId } : {}),
      entryVersion: entry?.version ?? null,
      deviceRecordedAt: input.deviceEdits?.length ? new Date(input.deviceEdits.at(-1)!.at) : null,
      ...(snapshot === undefined ? {} : { snapshot }),
      bookId: input.bookId,
      transactionId: input.transactionId ?? null,
      transactionSeq: input.transactionSeq ?? null,
      actorId: input.actorId,
      actorName: input.actorName,
      kind: input.kind,
      /**
       * ⚠️ **Spread, not a nullable field.** `exactOptionalPropertyTypes` is on, and Prisma's
       * `Json` input does not accept an explicit `undefined` — passing one is a compile error, and
       * the compiler is right to insist: **"no changes recorded" and "changes recorded as null" are
       * different**, and only the first is what a `created` event means.
       */
      ...(input.changes === undefined || input.changes === null
        ? {}
        : { changes: input.changes as unknown as Prisma.InputJsonValue }),
      occurredAt: input.at ?? new Date(),
    },
    select: { id: true },
  });
  if (entry && input.kind === "updated" && Object.keys(input.changes ?? {}).length > 0 && input.actorId && entry.userId !== input.actorId) {
    const member = await tx.bookMember.findUnique({
      where: { bookId_userId: { bookId: input.bookId, userId: entry.userId } },
      select: { leftAt: true },
    });
    if (member && member.leftAt === null) {
      await tx.entryChangeNotice.create({ data: {
        bookId: input.bookId, recipientId: entry.userId, eventId: event.id,
      } });
    }
  }
  if (input.kind === "created" && input.actorId) {
    await lockAccountStorage(tx, input.actorId);
    // 本次业务内容和历史均已计入；超限时整个事务回滚。
    await assertStorageGrowth(tx, input.actorId, input.bookId, 0n);
  }
}

/** The fields the history tracks, and how each is named on screen. */
const TRACKED_FIELDS: readonly { readonly key: string; readonly label: string }[] = [
  { key: "amountCents", label: "金额" },
  { key: "kind", label: "类型" },
  { key: "currency", label: "币种" },
  { key: "categoryId", label: "分类" },
  { key: "paymentMethodId", label: "支付方式" },
  { key: "occurredAt", label: "时间" },
  { key: "occurredTz", label: "时区" },
  { key: "note", label: "备注" },
  { key: "tags", label: "标签" },
  { key: "attachments", label: "附件" },
  { key: "occurredLocalDate", label: "日期" },
  /**
   * ⚠️ **A ledger's name is not an entry field, and it is in this table anyway** (1.10.08).
   *
   * The table is not really "the entry's tracked fields" — it is **"every key that can appear in an
   * event's `changes`, and what to call it on screen."** `history.ts` renders `label` by looking the
   * key up here and **falls back to the raw column name**, so a `book_changed` event whose key was
   * missing would print *"name：（空）→ 共享账本"* — a field name in English, in a Chinese sentence.
   *
   * ⚠️ **Adding it to `diffEntry`'s loop is harmless**: that loop skips any key not present in
   * `after`, and a transaction has no `name` field, so no entry edit can ever produce it.
   */
  { key: "name", label: "名称" },
  /** D3 imported-removal audit context; these keys never appear in a normal entry edit. */
  { key: "importId", label: "导入任务" },
  { key: "importSource", label: "导入来源" },
  { key: "importGroupId", label: "重复组" },
  { key: "importUndo", label: "导入撤销" },
];

export function trackedFieldLabel(key: string): string | null {
  return TRACKED_FIELDS.find((field) => field.key === key)?.label ?? null;
}

/**
 * Work out what changed between two versions of an entry.
 *
 * ⚠️ **Only the tracked fields, and only the ones that actually differ.** Writing every field on
 * every save would turn one edit into eight lines of "no change", and **a history where most lines
 * say nothing is a history nobody reads.**
 *
 * ⚠️ **Comparison is by value, not by reference** — `Date` and `BigInt` need normalising first, or
 * every edit would report the timestamp as changed. The same lesson as the conflict work: *"判据应该
 * 是值"*.
 */
export function diffEntry(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};

  for (const { key } of TRACKED_FIELDS) {
    if (!(key in after)) continue;

    const from = normalise(before[key]);
    const to = normalise(after[key]);
    if (from === to) continue;

    changes[key] = { from: storable(before[key] ?? null), to: storable(after[key] ?? null) };
  }

  return changes;
}

/**
 * A value that survives the trip into JSONB **and still reads like the number it is**.
 *
 * ⚠️ **`BigInt` cannot be stored as JSON, and the obvious workaround is wrong.** `JSON.stringify`
 * refuses it, so the first version of this left the value to `normalise` — and an amount of 3500
 * came back from the database as the **string** `"3500"`. The history screen would then have to
 * decide, per field, whether a string is a number, and **so would every future reader of this
 * table.**
 *
 * ⚠️ **`Number` is safe here and the reason is stated in the schema**: `amountCents` is bounded by
 * `amountCentsSchema`, which keeps every value inside the safe-integer range. **Converting a
 * bigint that could exceed it would be a different decision** — this one is safe precisely because
 * of a limit enforced elsewhere.
 */
function storable(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * A comparable form, so "did this change" is answered by value.
 *
 * ⚠️ **`Date` → its instant, `BigInt` → its string, `undefined` → `null`.** Without this,
 * `new Date(x)` and `new Date(x)` are different objects, **every save would report the time as
 * changed**, and the history would be full of edits that never happened.
 */
function normalise(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return JSON.stringify(value.map(v => JSON.stringify(v)).sort());
  return JSON.stringify(value) ?? "";
}

/** 只保留业务快照，避免把有限冲突缓存或派生容量复制进长期历史。 */
function auditSnapshot(input: unknown): Record<string, unknown> {
  const row = input as Record<string, unknown>;
  return Object.fromEntries(["id","seq","userId","kind","amountCents","currency","categoryId","category","paymentMethodId","paymentMethod","note","tags","occurredAt","occurredLocalDate","occurredTz","deletedAt","version"].filter(key => key in row).map(key => [key,row[key]]));
}
