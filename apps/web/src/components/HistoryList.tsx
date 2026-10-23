import { useEffect, useState } from "react";

import { formatTransactionNumber } from "@libellum/shared";

import { copyText } from "../lib/clipboard.js";
import { useLedgerHistory, type LedgerHistoryEntry } from "../lib/queries.js";
import { RecordGroup, RecordList, RecordRow } from "./ui/RecordList.js";

/**
 * **账本的编辑历史：谁在什么时候，对哪一笔做了什么。**
 *
 * ⚠️ **A list of sentences, not a log viewer.** The owner's requirement is explicit:
 * *"历史记录尽量以**简洁、易读**的方式呈现，**不要变成复杂的数据库日志界面**."* So a row here is
 * one line plus, when the change was an edit, **what changed** — and nothing else.
 *
 * ⚠️ **The sentence is the server's.** This component renders `summary` instead of assembling one,
 * because the API is the side that knows which fields are tracked. **S16-A only *lays it out*:** the
 * leading actor name is set in the ink colour and the verb in grey, and the entry number inside the
 * sentence becomes the copy chip — so the number appears once instead of twice. When the sentence does
 * not have the expected `${actor} ${verb} …` shape, it is shown exactly as the server wrote it.
 *
 * ⚠️ **S16-A: one line per record, and the time on the right.** A long note used to wrap the sentence
 * onto three lines and push the copy chip onto a line of its own, so two records of the same kind had
 * different heights and the list jumped. The sentence and each change are now single lines with an
 * ellipsis; the whole row opens the entry, where the full note is.
 *
 * ⚠️ **No "今天/昨天" from the server.** The API returns an instant; saying it in the reader's own
 * words happens here, from their clock — **a relative time computed anywhere else is wrong for somebody.**
 */
export function HistoryList({
  limit,
  emptyHint,
  embedded = false,
}: {
  readonly limit: number;
  readonly emptyHint: string;
  /**
   * ⚠️ **Draw no frame of its own, because the caller already has one.**
   *
   * The owner's complaint about the first-level page was *"盒子套盒子"* — a heading, a frame, and
   * then **a complete second card inside it** before any content. Embedded, the rows sit directly in
   * the caller's `SectionFrame`; on the full history screen they sit directly on the page, grouped by
   * day. **One flag, one list** — a second copy for the embedded case would be two renderers of one
   * server sentence (`教训.md` §8.12).
   */
  readonly embedded?: boolean;
}): React.JSX.Element {
  const history = useLedgerHistory(limit);

  if (history.isPending) {
    return <p className={`${embedded ? "px-5" : ""} py-4 text-body text-muted`}>正在读取历史……</p>;
  }

  if (history.isError) {
    return (
      <div className={`${embedded ? "px-5" : ""} flex items-center justify-between gap-3 py-4`}>
        <p className="text-body text-muted">历史读取失败。</p>
        <button
          type="button"
          onClick={() => {
            void history.refetch();
          }}
          className="shrink-0 text-helper font-medium text-brand transition hover:text-brand-dark"
        >
          重试
        </button>
      </div>
    );
  }

  const { entries, total } = history.data;

  /**
   * ⚠️ **Empty is stated, not left blank.** An empty list reads as "this ledger has no history",
   * which after S9.5 is **false for any ledger that has been touched since** — the events simply
   * start when the feature did. The hint says which of the two it is.
   */
  if (entries.length === 0) {
    return <p className={`${embedded ? "px-5" : ""} py-4 text-body-relaxed text-muted`}>{emptyHint}</p>;
  }

  if (embedded) {
    /**
     * ⚠️ **The "共 N 条" footnote is dropped here.** It belongs to the full screen, where the reader
     * is asking "how much is there"; on the first-level page the 查看全部 › link in the heading
     * already answers that, and a second sentence saying it is the crowding the owner is removing.
     */
    return (
      <RecordList placement="frame" label="最近的编辑记录">
        {entries.map((entry) => (
          <HistoryRow key={entry.id} entry={entry} when={formatShortWhen(entry.occurredAt)} />
        ))}
      </RecordList>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col">
        {groupByDay(entries).map((group) => (
          <RecordGroup key={group.key} heading={group.heading}>
            {group.entries.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} when={formatClock(entry.occurredAt)} />
            ))}
          </RecordGroup>
        ))}
      </div>

      {total > entries.length ? (
        <p className="text-helper text-muted">
          共 {String(total)} 条记录，这里显示最近 {String(entries.length)} 条。
        </p>
      ) : null}
    </div>
  );
}

/**
 * One line of history.
 *
 * ⚠️ **The whole row is a link when there is an entry to open.** The owner asked for it directly:
 * *"在历史记录中**点击某笔账，应尽可能直接打开对应的账目详情**，而不是要求用户手动搜索编号."*
 *
 * ⚠️ **A deleted entry has no detail page to open** — its row is a tombstone, and
 * `transactionId` survives (the delete is a soft one) — **so the link is offered, and the entry
 * detail screen is what explains it is deleted.** Refusing the link here would be a second place
 * deciding what "deleted" means.
 */
function HistoryRow({ entry, when }: { readonly entry: LedgerHistoryEntry; readonly when: string }): React.JSX.Element {
  const lines = entry.changes.slice(0, MAX_CHANGE_LINES).map((change) => (
    <>
      {change.label}：{change.from} → {change.to}
    </>
  ));
  const hidden = entry.changes.length - MAX_CHANGE_LINES;
  if (hidden > 0) lines.push(<>另有 {String(hidden)} 项改动</>);

  return (
    <RecordRow
      primary={<HistorySentence entry={entry} />}
      title={entry.summary}
      aside={when}
      lines={lines}
      {...(entry.transactionId === null ? {} : { to: `/transactions/${entry.transactionId}` })}
    />
  );
}

/** Changes beyond this many are summarised, so one edit of six fields does not fill the screen. */
const MAX_CHANGE_LINES = 3;

/**
 * The server's sentence, typeset: actor, verb, then the subject with its number as a copy chip.
 */
function HistorySentence({ entry }: { readonly entry: LedgerHistoryEntry }): React.JSX.Element {
  const parts = splitSummary(entry);
  const number = entry.transactionSeq === null ? null : formatTransactionNumber(entry.transactionSeq);

  if (parts === null) {
    return (
      <>
        {entry.summary}
        {number === null ? null : (
          <>
            {" "}
            <NumberChip number={number} />
          </>
        )}
      </>
    );
  }

  const at = number === null ? -1 : parts.subject.indexOf(number);

  return (
    <>
      <span className="font-medium">{parts.actor}</span> <span className="text-muted">{parts.verb}</span>{" "}
      {number !== null && at >= 0 ? (
        <>
          {parts.subject.slice(0, at)}
          <NumberChip number={number} />
          {parts.subject.slice(at + number.length)}
        </>
      ) : (
        parts.subject
      )}
    </>
  );
}

/**
 * `${actor} ${verb} ${subject}` → its three parts, or `null` when the sentence has another shape.
 *
 * ⚠️ **Only splits; never rewrites.** The pieces are rendered in their original order with the original
 * spaces, so the visible text is still exactly the server's sentence.
 */
export function splitSummary(
  entry: Pick<LedgerHistoryEntry, "summary" | "actorName">,
): { readonly actor: string; readonly verb: string; readonly subject: string } | null {
  const actor = entry.actorName ?? "某人";
  if (!entry.summary.startsWith(`${actor} `)) return null;

  const rest = entry.summary.slice(actor.length + 1);
  const space = rest.indexOf(" ");
  if (space <= 0) return null;

  return { actor, verb: rest.slice(0, space), subject: rest.slice(space + 1) };
}

/**
 * The entry number, copyable.
 *
 * ⚠️ **The number is copyable, and the owner asked for exactly that**: *"应当能够在账目详情和
 * 历史记录中查看、复制."* The whole row is a link, so this button **stops the tap from
 * propagating** — otherwise copying the number would navigate away and the number would be
 * gone from the clipboard's context.
 *
 * ⚠️ **A `button`, not a `<span>` with a click handler**, because the row already contains
 * one interactive element and **a nested link inside a link is not valid HTML** — the screen
 * reader would announce one target where there are two.
 */
function NumberChip({ number }: { readonly number: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  return (
    <button
      type="button"
      title="复制编号"
      aria-label={`复制编号 ${number}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyText(number).then((outcome) => {
          if (outcome === "copied") setCopied(true);
        });
      }}
      className="mx-0.5 inline-block rounded-full bg-canvas px-1.5 align-baseline font-mono text-micro text-muted ring-1 ring-line transition hover:text-ink"
    >
      {copied ? "已复制" : number}
    </button>
  );
}

/** Groups newest-first entries by the reader's local calendar day. */
function groupByDay(
  entries: readonly LedgerHistoryEntry[],
): { readonly key: string; readonly heading: string; readonly entries: LedgerHistoryEntry[] }[] {
  const groups: { key: string; heading: string; entries: LedgerHistoryEntry[] }[] = [];

  for (const entry of entries) {
    const at = new Date(entry.occurredAt);
    const key = `${String(at.getFullYear())}-${String(at.getMonth())}-${String(at.getDate())}`;
    const last = groups[groups.length - 1];

    if (last !== undefined && last.key === key) {
      last.entries.push(entry);
    } else {
      groups.push({ key, heading: formatDay(at), entries: [entry] });
    }
  }

  return groups;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDay(at: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(at, now)) return "今天";
  if (sameDay(at, yesterday)) return "昨天";

  const date = `${String(at.getMonth() + 1)} 月 ${String(at.getDate())} 日`;
  return at.getFullYear() === now.getFullYear() ? date : `${String(at.getFullYear())} 年 ${date}`;
}

function formatClock(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * The instant, in the reader's own words — short enough to sit beside a one-line sentence.
 *
 * ⚠️ **Deliberately coarse**: a time for today, 「昨天」, otherwise the date. Seconds would add precision
 * nobody reads and **make two edits in the same minute look different for no reason.** (S16-A: the
 * old "今天 14:32" form took a third of a 320px row and pushed the sentence into its ellipsis; the
 * full history screen groups by day, so it shows the clock under a day heading instead.)
 */
function formatShortWhen(iso: string): string {
  const at = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(at, now)) return formatClock(iso);
  if (sameDay(at, yesterday)) return "昨天";

  return `${String(at.getMonth() + 1)}月${String(at.getDate())}日`;
}
