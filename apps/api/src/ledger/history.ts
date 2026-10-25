import type { PrismaClient } from "../db.js";
import { trackedFieldLabel } from "./events.js";

/**
 * Reading the ledger's history back, in words a person reads.
 *
 * ⚠️ **The sentence is built here, not on the client.** The owner's example lines are the spec —
 * *"今天 14:32，naeor 将 #000128 午餐的金额从 ¥35 修改为 ¥38."* — and putting that wording in the
 * browser would mean **a second place that decides what a change is called.** The API already knows
 * which fields were tracked (`TRACKED_FIELDS`); the screen should not have to learn it too
 * (`教训.md` §8.12).
 *
 * ⚠️ **No relative time ("今天") is produced here.** "Today" depends on the reader's clock and
 * changes while the page is open — the API returns the instant and the screen decides how to say
 * it. **A server that computes "今天" is a server that is wrong for somebody in another zone**, and
 * this ledger already has an explicit `occurredTz` for exactly this reason.
 */

export interface HistoryEntry {
  readonly id: string;
  readonly kind:
    | "created"
    | "updated"
    | "deleted"
    | "restored"
    | "member_changed"
    /** ⚠️ About the ledger itself — see `EventKind` in `events.ts`. */
    | "book_changed";
  readonly occurredAt: string;
  readonly actorName: string | null;
  readonly transactionId: string | null;
  readonly transactionSeq: number | null;
  /** ⚠️ Already formatted, so every reader of this API shows the same thing. */
  readonly summary: string;
  /** One line per changed field, ready to render. Empty for anything but an edit. */
  readonly changes: readonly { readonly label: string; readonly from: string; readonly to: string }[];
}

/**
 * The row shape `historyEntryFromRow` accepts — the exact `select` used by both the history endpoint
 * and the quote-target endpoints, so a quoted event and a history line are rendered by one function
 * (`教训.md` §8.12).
 */
export interface HistoryEventRow {
  readonly id: string;
  readonly kind: string;
  readonly occurredAt: Date;
  readonly actorName: string | null;
  readonly transactionId: string | null;
  readonly transactionSeq: number | null;
  readonly changes: unknown;
  readonly transaction: { readonly note: string | null; readonly category: { readonly name: string } } | null;
}

/** The `select` both readers use. ⚠️ Must stay in step with `HistoryEventRow`. */
export const HISTORY_EVENT_SELECT = {
  id: true,
  kind: true,
  occurredAt: true,
  actorName: true,
  transactionId: true,
  transactionSeq: true,
  changes: true,
  transaction: { select: { note: true, category: { select: { name: true } } } },
} as const;


const KIND_VERB: Record<HistoryEntry["kind"], string> = {
  created: "添加了",
  updated: "修改了",
  deleted: "删除了",
  restored: "恢复了",
  member_changed: "变更了",
  /**
    * ⚠️ **`"改了"`, not `"变更了这本账"`, and the live smoke test is what caught it.**
    *
    * The sentence is assembled as `${who} ${verb} ${subject}`, and the subject for a ledger-level
    * event is already 「这本账」 — so the first version read **"naeor 变更了这本账 这本账"**, with the
    * noun twice. **The unit test asserted `summary` contains 「这本账」 and is not 「一笔账目」, which
    * both passed** — it checked the thing that was broken without checking the thing that was wrong.
    *
    * ⚠️ **A verb that reads correctly with this subject is the fix, not a special case in the
    * assembler.** The other four kinds keep their verbs because their subjects are entries.
    */
  book_changed: "改了",
};

/** Which history kinds a reader wants — used by the quote picker to skip member/book events. */
export interface HistoryReadOptions {
  readonly kinds?: readonly HistoryEntry["kind"][];
}

export async function readHistory(
  prisma: PrismaClient,
  bookId: string,
  limit: number,
  options: HistoryReadOptions = {},
): Promise<HistoryEntry[]> {
  const rows = await prisma.transactionEvent.findMany({
    where: {
      bookId,
      ...(options.kinds === undefined ? {} : { kind: { in: [...options.kinds] } }),
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: HISTORY_EVENT_SELECT,
  });

  return rows.map(historyEntryFromRow);
}

/**
 * One event row → the sentence a person reads.
 *
 * ⚠️ **Exported because a quoted edit and the history list must say the same thing about the same
 * event.** A second formatter would drift the day one of them learns a new field (`教训.md` §8.12).
 */
export function historyEntryFromRow(row: HistoryEventRow): HistoryEntry {

    const kind = row.kind as HistoryEntry["kind"];
    const who = row.actorName ?? "某人";
    const number = row.transactionSeq === null ? null : `#${String(row.transactionSeq).padStart(6, "0")}`;

    /**
     * ⚠️ **When the entry is gone, the event still names it.** A deleted entry cannot be asked for
     * its note or category, so the sentence falls back to the number alone — **which is precisely
     * why the number is stored on the event** (`教训.md` §8.11 is about the version of this where
     * the join quietly returns nothing).
     */
    const label = row.transaction?.note ?? row.transaction?.category.name ?? null;

    /**
     * ⚠️ **An event about the ledger has no entry to name, so it names the ledger.**
     *
     * `member_changed` and `book_changed` both carry `transactionId: null`, and **the `number ===
     * null` fallback below says "一笔账目"** — right for a deleted entry whose number was lost, and
     * plainly wrong here: *"naeor 变更了这本账 一笔账目"* is nonsense. Renaming is where that showed
     * up (1.10.08), because before it every event happened to be about an entry.
     */
    const subject =
      kind === "member_changed" || kind === "book_changed"
        ? kind === "member_changed" ? "这本账的成员" : "这本账"
        : number === null
          ? "一笔账目"
          : label === null
            ? `记录 ${number}`
            : `${number} ${label}`;

    const changes = (row.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>;

    const summary =
      kind === "member_changed"
        ? `${who} 变更了这本账的成员`
        : kind === "book_changed"
          ? `${who} 改了这本账`
          : `${who} ${KIND_VERB[kind]} ${subject}`;

    return {
      id: row.id,
      kind,
      occurredAt: row.occurredAt.toISOString(),
      actorName: row.actorName,
      transactionId: row.transactionId,
      transactionSeq: row.transactionSeq,
      summary,
      /**
       * ⚠️ **Rendered with the field's Chinese name**, because "amountCents 3500 → 3800" is a
       * developer's sentence. `trackedFieldLabel` is the same table the diff used, so a field that
       * is tracked but unnamed uses a neutral label instead of exposing an internal column name.
       */
      changes: Object.entries(changes).map(([key, value]) => ({
        label: HISTORY_LABELS[key] ?? trackedFieldLabel(key) ?? "其他变更",
        from: renderValue(value?.from, key),
        to: renderValue(value?.to, key),
      })),
    };
}

// Display-only names for membership events; do not add them to entry diff tracking.
const HISTORY_LABELS: Readonly<Record<string, string>> = {
  joined: "加入账本",
  removed: "移除成员",
  left: "退出账本",
  role: "成员权限",
};

/**
 * A changed value as a person reads it.
 *
 * ⚠️ **Money is not converted here, deliberately.** `amountCents` is stored in minor units and the
 * currency's precision lives in `shared`, but events do not reliably retain the currency at the
 * time of the change. The entry's current currency may be different. S16 leaves money unchanged
 * pending a historical-context design; using current currency or dividing by 100 is unsafe.
 *
 * ⚠️ This still returns the raw minor-unit number as a string (a documented unresolved display
 * issue). Known role/kind enums are translated here without changing the stored event.
 */
function renderValue(value: unknown, key: string): string {
  if (value === null || value === undefined) return "（空）";
  if (key === "role" && value === "viewer") return "仅查看";
  if (key === "role" && value === "editor") return "可编辑";
  if (key === "kind" && value === "income") return "收入";
  if (key === "kind" && value === "expense") return "支出";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? "（无法显示）";
}
