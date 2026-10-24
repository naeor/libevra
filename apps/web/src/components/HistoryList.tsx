import { useEffect, useState } from "react";

import { formatTransactionNumber } from "@libellum/shared";

import { isChineseLocale, t, useI18n } from "../i18n/index.js";
import zhLedger from "../i18n/resources/zh-CN/ledger.js";
import { copyText } from "../lib/clipboard.js";
import { formatDayLabel, formatInstant, toLocalDate } from "../lib/datetime.js";
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
  const { t } = useI18n();

  if (history.isPending) {
    return <p className={`${embedded ? "px-5" : ""} py-4 text-body text-muted`}>{t("ledger.history.loading")}</p>;
  }

  if (history.isError) {
    return (
      <div className={`${embedded ? "px-5" : ""} flex items-center justify-between gap-3 py-4`}>
        <p className="min-w-0 text-body text-muted">{t("ledger.history.failed")}</p>
        <button
          type="button"
          onClick={() => {
            void history.refetch();
          }}
          className="shrink-0 text-helper font-medium text-brand transition hover:text-brand-dark"
        >
          {t("common.action.retry")}
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
      <RecordList placement="frame" label={t("ledger.history.recentLabel")}>
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
          {t("ledger.history.totalNote", { total, shown: entries.length })}
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
  const { t } = useI18n();
  const lines = entry.changes.slice(0, MAX_CHANGE_LINES).map((change) => <>{historyChangeText(change)}</>);
  const hidden = entry.changes.length - MAX_CHANGE_LINES;
  if (hidden > 0) lines.push(<>{t("ledger.history.moreChanges", { count: hidden })}</>);

  return (
    <RecordRow
      primary={<HistorySentence entry={entry} />}
      title={historySentenceText(entry)}
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
  const parts = sentenceParts(entry);
  const number = entry.transactionSeq === null ? null : formatTransactionNumber(entry.transactionSeq);

  if (parts === null) {
    return (
      <>
        {historySentenceText(entry)}
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
  const actor = entry.actorName ?? "某人"; // i18n-ignore：服务器句子里的兜底名（apps/api/src/ledger/history.ts），用来拆原文
  if (!entry.summary.startsWith(`${actor} `)) return null;

  const rest = entry.summary.slice(actor.length + 1);
  const space = rest.indexOf(" ");
  if (space <= 0) return null;

  return { actor, verb: rest.slice(0, space), subject: rest.slice(space + 1) };
}

interface SentenceParts {
  readonly actor: string;
  readonly verb: string;
  readonly subject: string;
}

/** 服务器句子里的动词只覆盖这四种账目事件；成员 / 账本事件是整句，见 `sentenceText`。 */
const ENTRY_EVENT_KINDS = ["created", "updated", "deleted", "restored"] as const;
type EntryEventKind = (typeof ENTRY_EVENT_KINDS)[number];

function isEntryEvent(kind: string): kind is EntryEventKind {
  return (ENTRY_EVENT_KINDS as readonly string[]).includes(kind);
}

/**
 * **按当前语言排版这一句（S16 国际化）。**
 *
 * ⚠️ **中文界面原样拆服务器的句子**（`splitSummary`），一个字不改，与以前完全一致。
 *
 * ⚠️ **其它语言用结构化字段重组**：服务器只返回中文句子（`apps/api/src/ledger/history.ts`），
 * 但同时给了 `kind`、`actorName`、`transactionSeq`，足够在浏览器端用本地语言说出同一件事。
 * 句子里的对象名（备注或分类名）是用户数据，从原句里原样取出、不翻译；认不出的句子形状
 * 返回 `null`，由调用方显示服务器原文——宁可显示中文，也不编造内容。
 */
function sentenceParts(entry: LedgerHistoryEntry): SentenceParts | null {
  const original = splitSummary(entry);
  if (isChineseLocale()) return original;
  if (!isEntryEvent(entry.kind)) return null;

  const actor = entry.actorName ?? t("ledger.history.someone");
  const verb = t(`ledger.history.verb.${entry.kind}`);

  if (entry.transactionSeq === null) return { actor, verb, subject: t("ledger.history.anEntry") };

  const number = formatTransactionNumber(entry.transactionSeq);
  /** 服务器的对象是 `#000128 午餐`（带名字）或 `记录 #000128`（没有名字）；名字是数据，原样保留。 */
  const subject =
    original !== null && original.subject.startsWith(`${number} `)
      ? original.subject
      : t("ledger.history.entryNumber", { number });

  return { actor, verb, subject };
}

/** 整句纯文本：用于 `title`，以及拆不开时直接显示。导出给测试用。 */
export function historySentenceText(entry: LedgerHistoryEntry): string {
  if (isChineseLocale()) return entry.summary;

  const actor = entry.actorName ?? t("ledger.history.someone");
  if (entry.kind === "member_changed") return t("ledger.history.memberChanged", { actor });
  /** 服务器还会发 `book_changed`（类型声明里没有列出），同样整句重组。 */
  if ((entry.kind as string) === "book_changed") return t("ledger.history.bookChanged", { actor });

  const parts = sentenceParts(entry);
  return parts === null ? entry.summary : `${parts.actor} ${parts.verb} ${parts.subject}`;
}

/** 一条改动：`金额：3500 → 3800` / `Amount: 3500 → 3800`。导出给测试用。 */
export function historyChangeText(change: LedgerHistoryEntry["changes"][number]): string {
  return t("ledger.history.change", {
    label: serverLabel(change.label),
    from: serverValue(change.label, change.from),
    to: serverValue(change.label, change.to),
  });
}

/** 把一组嵌套文案对象展开成 `前缀.键` 的联合类型，用于给运行时拼出的键名定类型。 */
type KeyPaths<T, Prefix extends string> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}.${K}` : KeyPaths<T[K], `${Prefix}.${K}`>;
}[keyof T & string];

type ServerLabelKey = KeyPaths<typeof zhLedger.history.serverLabels, "ledger.history.serverLabels">;
type ServerValueKey = KeyPaths<typeof zhLedger.history.serverValues, "ledger.history.serverValues">;

/**
 * 改动行里的字段名：服务器给的是中文原文（`events.ts` 的 `TRACKED_FIELDS` 与成员事件的名字）。
 * 中文界面原样显示；其它语言按原文查 `ledger.history.serverLabels`，查不到就原样显示。
 */
function serverLabel(label: string): string {
  if (isChineseLocale() || !Object.hasOwn(zhLedger.history.serverLabels, label)) return label;
  return t(`ledger.history.serverLabels.${label}` as ServerLabelKey);
}

/**
 * 改动行里的值：只翻译服务器自己写的几个固定说法（`（空）`、`仅查看`……），而且角色 / 收支方向
 * 只在对应字段下才翻译；其余（分类名、备注、金额等）是数据，原样显示。
 */
function serverValue(label: string, value: string): string {
  if (isChineseLocale()) return value;
  const groups: Readonly<Record<string, Readonly<Record<string, string>>>> = zhLedger.history.serverValues;
  const group = Object.hasOwn(groups.any ?? {}, value)
    ? "any"
    : Object.hasOwn(groups, label) && Object.hasOwn(groups[label] ?? {}, value)
      ? label
      : null;
  if (group === null) return value;
  return t(`ledger.history.serverValues.${group}.${value}` as ServerValueKey);
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
  const { t } = useI18n();
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
      title={t("ledger.history.copyNumber")}
      aria-label={t("ledger.history.copyNumberLabel", { number })}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyText(number).then((outcome) => {
          if (outcome === "copied") setCopied(true);
        });
      }}
      className="mx-0.5 inline-block rounded-full bg-canvas px-1.5 align-baseline font-mono text-micro text-muted ring-1 ring-line transition hover:text-ink"
    >
      {copied ? t("common.action.copied") : number}
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

/**
 * 分组标题。
 *
 * ⚠️ S16：其它语言用 `formatDayLabel`（Today / Yesterday / Wed, Oct 8）；中文界面保留原来不带星期的
 * 「10 月 8 日」写法，与国际化之前逐字一致。
 */
function formatDay(at: Date): string {
  if (!isChineseLocale()) return formatDayLabel(toLocalDate(at));

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(at, now)) return t("format.today");
  if (sameDay(at, yesterday)) return t("format.yesterday");

  const date = `${String(at.getMonth() + 1)} 月 ${String(at.getDate())} 日`; // i18n-ignore：中文界面专用的固定格式（与原来一致）
  return at.getFullYear() === now.getFullYear() ? date : `${String(at.getFullYear())} 年 ${date}`; // i18n-ignore：中文界面专用的固定格式（与原来一致）
}

/** 时刻：中文 `14:32`（与原来一致）；其它语言按 `Intl`（`2:32 PM`）。 */
function formatClock(iso: string): string {
  const at = new Date(iso);
  if (!isChineseLocale()) return formatInstant(at, { hour: "numeric", minute: "2-digit" });
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
  if (sameDay(at, yesterday)) return t("format.yesterday");

  if (!isChineseLocale()) return formatInstant(at, { month: "short", day: "numeric" });
  return `${String(at.getMonth() + 1)}月${String(at.getDate())}日`; // i18n-ignore：中文界面专用的固定格式（与原来一致）
}
