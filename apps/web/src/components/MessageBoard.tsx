import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import type { MessageReferenceView, QuoteReferenceKind } from "@libellum/shared";

import { ChevronIcon, QuoteIcon } from "./Icons.js";
import { QuotePickerSheet, QuoteReferenceCard } from "./MessageQuote.js";
import { FrameAction, SectionFrame } from "./SectionFrame.js";
import { isChineseLocale, t as translate, useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { formatInstant } from "../lib/datetime.js";
import { useGoBack } from "../lib/connectivity.js";
import { useBookMessages, useQuoteTarget, useSendBookMessage, type BookMessageView } from "../lib/queries.js";

/**
 * **这本账的留言 —— 围绕账目的公共讨论，不是聊天。**
 *
 * ⚠️ **The owner's framing decides the shape**: *"我希望它更接近一个**围绕账本的公共讨论空间**"*,
 * with a list of things he explicitly does **not** want — *"消息撤回、表情包、语音聊天、在线状态、
 * 已读回执"*. So there is **no bubble styling, no typing indicator, no read state**: a message is a
 * name, a time and a sentence.
 *
 * ⚠️ **Nothing here says "私聊".** The board is the same for everybody in the ledger — that is the
 * property that makes it a discussion about the books. **A layout that looked like a chat app would
 * promise a private channel it does not have.**
 *
 * ⚠️ **⚠️ Two views, one implementation, and that is the point of this file (1.10.05).**
 *
 * The owner asked for both — *"留言必须同时支持两种使用方式：一级页面内的小窗口快速交流，以及展开后的
 * 完整历史对话界面"* — and added the rule that decides how to build it: *"两者属于同一份留言数据，不是
 * 两套独立的聊天系统"* and *"不应因为切换小窗口和完整界面而丢失已经成功发送的消息"*.
 *
 * So `useMessageComposer` holds **the draft, the send and the error**, and the two presentations
 * below render it. **A second composer would be a second draft to lose**, and the owner named that
 * failure directly.
 */

/**
 * The draft and the send, shared by both views.
 *
 * ⚠️ **The draft deliberately does not live in either view.** They mount and unmount as the reader
 * moves between the card and the full screen, so state inside them would be **destroyed exactly when
 * the owner said it must survive**: *"如果存在未发送的文字草稿，应合理处理视图切换。优先保持草稿，
 * 而不是意外清空用户已经输入的内容."*
 *
 * ⚠️ **Module scope, not React state, and that is not a shortcut.** The two views are on different
 * routes, so one is unmounted before the other mounts — there is no shared ancestor to hold it, and
 * a context would still lose it on the full-screen route's own reload. A module-level value survives
 * the navigation; it is cleared on a successful send, which is the only moment the text stops being
 * the user's to keep.
 *
 * ⚠️ **It is not persisted to disk on purpose.** A draft is unsent text, not data — and a draft that
 * came back after a reload, in a *different ledger*, would be a sentence written about one set of
 * books appearing in another. **It is cleared whenever the ledger changes** (see `send` and the
 * board's `key`).
 */
let sharedDraft = "";

/**
 * **The quote chosen for the unsent message, shared by the two views for the same reason the draft is.**
 *
 * ⚠️ **Only the *reference target* is held here — the snapshot always comes from the server.** If the
 * card remembered a snapshot it fetched, it would be a second copy of the fact that could disagree with
 * the one written on send; the picker and the shortcut both use `MessageReferenceView` produced by the
 * API (`apps/api/src/ledger/quotes.ts`), and sending passes only `{kind, id}` — **the server re-reads the
 * snapshot, so a client cannot invent a title or amount.**
 */
let sharedQuote: MessageReferenceView | null = null;

/** Forget the draft. Called when the ledger changes, so text cannot cross between ledgers. */
export function clearMessageDraft(): void {
  sharedDraft = "";
  sharedQuote = null;
}

/**
 * **"新消息 N 条" —— how many messages arrived since this reader last looked.**
 *
 * ⚠️ **The owner asked for this by name**: *"`新消息 N 条` 表示自用户上次查看以来新增的留言数；如果没有
 * 新消息，可视情况隐藏……但「展开完整对话」仍应保留."*
 *
 * ⚠️ **It is computed on the client, from the messages the server already sends.** A per-person
 * "last read" column on the server would be **a second record of something only this device needs**
 * (`教训.md` §8.7), and it would have to be written on every glance at the card. The count is a
 * display convenience, and a device that loses it shows "no new" — which is the harmless direction.
 *
 * ⚠️ **⚠️ Scoped by ledger, and that is not optional.** Two ledgers have separate boards, so a
 * single "last seen" value would make **ledger B inherit ledger A's read state** — the exact
 * cross-ledger leak the rest of this file is careful about. The key carries the id; the caller
 * passes it from the ledger it is rendering.
 *
 * ⚠️ **Stored in `localStorage`, not IndexedDB**, deliberately: it is not bookkeeping data, it must
 * never be mistaken for something worth syncing, and it must be safe to lose.
 */
import { messagesSeenKey } from "../lib/deviceStorageKeys.js";

/**
 * ⚠️ **The bare global, never `window.localStorage`.**
 *
 * They are the same object in a browser, but **`window` does not exist outside one** — and this
 * project's tests deliberately run in plain Node with no DOM (`vitest.config.ts`: *"Components are
 * checked by rendering them to static markup — that needs no DOM, no jsdom."*). Reaching through
 * `window` made the whole board unrenderable in that environment, which the test for this function
 * caught. **A storage helper that only works in a browser is a dependency on the renderer, not on
 * storage.**
 */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    /** ⚠️ Hardened browsers throw on *access*, not only on use. */
    return null;
  }
}

export function markMessagesSeen(bookId: string, at: Date = new Date()): void {
  try {
    storage()?.setItem(messagesSeenKey(bookId), String(at.getTime()));
  } catch {
    /** ⚠️ A browser refusing storage must not break the board — the count just stays empty. */
  }
}

export function newMessageCount(
  bookId: string,
  messages: readonly { readonly createdAt: string }[],
): number {
  let seenAt = 0;
  try {
    seenAt = Number(storage()?.getItem(messagesSeenKey(bookId)) ?? "0") || 0;
  } catch {
    return 0;
  }

  /**
   * ⚠️ **Nothing stored means "never looked here", and that counts as zero rather than everything.**
   * The alternative greets a first-time reader with "新消息 47 条" about a conversation they have
   * never seen — which is not news, it is the history.
   */
  if (seenAt === 0) return 0;

  return messages.filter((message) => Date.parse(message.createdAt) > seenAt).length;
}

export interface MessageComposer {
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  /**
   * The thing this message is about — **optional, and `null` for every ordinary message.**
   * Choosing one never sends anything; it only attaches a snapshot to the next send.
   */
  readonly quote: MessageReferenceView | null;
  readonly setQuote: (reference: MessageReferenceView | null) => void;
  readonly error: string | null;
  readonly sending: boolean;
  /** ⚠️ Resolves `true` only when the server accepted it — never optimistically. */
  readonly send: () => Promise<boolean>;
  readonly canSend: boolean;
}

export function useMessageComposer(): MessageComposer {
  const mutation = useSendBookMessage();
  const [draft, setDraftState] = useState(sharedDraft);
  const [quote, setQuoteState] = useState<MessageReferenceView | null>(sharedQuote);
  const [error, setError] = useState<string | null>(null);

  /**
   * ⚠️ **Every change goes through here**, so the shared value and this view's copy cannot drift —
   * which is what would make the card and the full screen show different text.
   */
  function setDraft(value: string): void {
    sharedDraft = value;
    setDraftState(value);
  }

  /** Same rule as `setDraft`: the two presentations share one quote, one place to lose it. */
  function setQuote(reference: MessageReferenceView | null): void {
    sharedQuote = reference;
    setQuoteState(reference);
  }

  /** ⚠️ A view that mounts after the other one wrote keeps its text, because the module holds it. */
  useEffect(() => {
    setDraftState(sharedDraft);
    setQuoteState(sharedQuote);
  }, []);

  async function send(): Promise<boolean> {
    const body = sharedDraft.trim();
    if (body === "") return false;

    setError(null);

    try {
      /**
       * ⚠️ **Only `{kind, id}` is sent.** The server re-reads the snapshot and refuses a target that is
       * gone or belongs to another ledger — **so quoting cannot become a way to write a fabricated
       * title or amount into a conversation** (`apps/api/src/ledger/quotes.ts`).
       */
      await mutation.mutateAsync({
        body,
        reference: sharedQuote === null ? null : { kind: sharedQuote.kind, id: sharedQuote.id },
      });
      /** ⚠️ Cleared only after the server said yes — see `canSend`'s note about offline. */
      setDraft("");
      setQuote(null);
      return true;
    } catch (caught: unknown) {
      /**
       * ⚠️ **A failure leaves the text alone and says so.** The owner asked not to fake offline
       * delivery: *"如果留言目前不支持离线发送，不要擅自承诺或伪造离线发送成功状态."* Messages go
       * straight to the server, so **there is no queue and no "发送中" that resolves later** — the
       * text stays in the box and the error is shown, which is the honest pair.
       */
      setError(errorMessage(caught));
      return false;
    }
  }

  return {
    draft,
    setDraft,
    quote,
    setQuote,
    error,
    sending: mutation.isPending,
    send,
    /** ⚠️ `500` is the server's own limit — allowing more would lose the text on submit. */
    canSend: mutation.isPending === false && sharedDraft.trim() !== "",
  };
}

/**
 * The quote on a message, normalised so "the field is missing" and "there is no quote" are the
 * same answer.
 *
 * ⚠️ **The field arrived in 1.16.18, and old device caches still hold messages without it.**
 * `buster` in `App.tsx` was bumped so those caches are discarded on upgrade, but this stays as
 * defence in depth: a persisted response can still reach the board through a path nobody counted
 * on, and `message.reference === null` does not catch `undefined` — it falls through to reading
 * `.available` on nothing, throwing during render and taking the whole page to the error boundary.
 * **A missing quote is a far smaller failure than a blank screen**, so read it as "no quote".
 */
export function messageReference(
  message: Pick<BookMessage, "reference">,
): MessageReferenceView | null {
  return message.reference ?? null;
}

/** One message: who, when, and what — in that order, and nothing else. */
function MessageRow({ message }: { readonly message: BookMessage }): React.JSX.Element {
  const reference = messageReference(message);

  /**
   * ⚠️ **A quote links to the entry it is about, when there is one left to open.** A deleted entry is a
   * soft delete, so `transactionId` usually survives and the detail screen itself explains the deletion —
   * deciding here that a dead link should be withheld would be a second place deciding what "deleted"
   * means. An unavailable quote with no id at all renders as plain text.
   */
  const target =
    reference === null || !reference.available
      ? null
      : reference.snapshot.kind === "transaction"
        ? reference.snapshot.id
        : reference.snapshot.transactionId;

  return (
    <li className="flex flex-col gap-1 border-b border-line px-5 py-3 last:border-b-0">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="text-helper text-muted">{message.senderName}</span>
        <span className="text-helper text-muted">{formatWhen(message.createdAt)}</span>
      </span>

      {reference === null ? null : (
        <QuoteReferenceCard
          reference={reference}
          {...(target === null ? {} : { href: `/transactions/${target}` })}
        />
      )}

      {/**
        * ⚠️ **`break-words`, because a message is arbitrary text.** Without it **one long pasted
        * string scrolls the whole page sideways on a phone** — and the person who pasted it will not
        * connect the two.
        */}
      <span className="break-words text-body text-ink">{message.body}</span>
    </li>
  );
}

/** The empty state, which says what the board is for rather than being a void. */
function EmptyBoard(): React.JSX.Element {
  const { t } = useI18n();
  return <p className="px-4 py-5 text-body-relaxed text-muted">{t("collab.messages.empty")}</p>;
}

/**
 * **The whole 留言 block for a first-level page: heading row, then the frame.**
 *
 * ⚠️ **It exists so the "新消息 N 条" count and the board cannot disagree.**
 *
 * The count has to be read *before* the board marks everything seen — so if the heading and the
 * board each called `newMessageCount` on their own, **the second call would usually return zero**
 * and the heading would read "新消息 0 条" one render after saying 2. One component, one read, one
 * mark: the number is held in state and the seen-time is written when the board mounts.
 *
 * ⚠️ **"Seen" is marked when the card is on screen**, which is what the owner's sentence means by
 * 上次查看 — the card *is* the viewing. The count therefore describes **what arrived since the
 * reader last had this page open**, and it clears on the next visit rather than on the next tap.
 */
export function MessageBoardSection({ bookId }: { readonly bookId: string }): React.JSX.Element {
  const messages = useBookMessages();

  /**
   * ⚠️ **Read once, on mount, and deliberately not recomputed.** Recomputing would clear the count
   * as soon as the seen-time below is written — and a badge that erases itself before it is read is
   * worse than no badge.
   */
  const [fresh] = useState(() =>
    newMessageCount(bookId, messages.data?.messages ?? []),
  );

  /**
   * ⚠️ **Marked after the first successful read, not on mount.** Marking on mount would record
   * "looked at an empty board" while the request was still in flight, and **every message in that
   * response would then look new forever** — or, worse, look old. Waiting for the data means the
   * count for the *next* visit starts from what this visit actually showed.
   */
  useEffect(() => {
    if (messages.isSuccess) markMessagesSeen(bookId);
  }, [bookId, messages.isSuccess]);

  const unread = messages.isSuccess ? fresh : 0;
  const { t } = useI18n();

  return (
    /**
      * ⚠️ **正式功能区标题，试验规格（16px/600）。** 这是所有者点名的第二处。
      * ⚠️ **不写 `titleClassName`** —— 走 `SectionFrame` 的默认值 `section-title`，
      * 于是「留言」与「编辑记录」由同一个来源决定。
      *
      * ⚠️ **但这个组件同时被全屏留言页用不到**：`MessageBoardSection` 只出现在协作页，
      * 全屏页用的是 `MessageBoardFull`，所以这里放大标题不会影响全屏对话。
      */
    <SectionFrame
      title={t("collab.messages.title")}
      action={
        <>
          {/**
            * ⚠️ **Hidden when there is nothing new**, which the owner allowed and which is the quieter
            * choice: *"如果没有新消息，可视情况隐藏「新消息 N 条」……但「展开完整对话」仍应保留."*
            * `展开完整对话` is therefore unconditional — the way into the history must not depend on
            * whether anything is waiting in it.
            */}
          {unread > 0 ? (
            <span className="text-brand">{t("collab.messages.newCount", { count: unread })}</span>
          ) : null}
          <FrameAction to="/ledger/messages">{t("collab.messages.expand")}</FrameAction>
        </>
      }
    >
      <MessageBoardCard limit={2} />
    </SectionFrame>
  );
}

/**
 * **The card on the 协作 page — a compact window, not a shrunken chat app.**
 *
 * ⚠️ **It shows the most recent messages and an input, and it does not grow.** The owner's rule:
 * *"小窗口内容应保持紧凑，不能因为留言历史增加就无限增长"* and *"小窗口应更像一张嵌入页面的简洁留言
 * 卡片，而不是压缩版本的完整聊天应用."* So the count is fixed here and the full history is behind
 * 展开完整对话 — which is the whole reason the two views exist.
 *
 * ⚠️ **Sending from here is a first-class path.** *"不能把「展开完整对话」作为发送留言的必要步骤"* —
 * the input is in the card, and the expand link is only about reading more.
 *
 * ⚠️ **⚠️ Two halves and one line between them (1.10.07).** The owner specified the structure:
 *
 * > *"留言总外框内部划分为两个部分：上半部分显示区……中间分隔线……下半部分操作区."*
 *
 * and gave the reason: *"这条横线的作用很重要：它负责告诉用户'上面是内容，下面是操作'."*
 *
 * ⚠️ **The frame is the caller's.** This renders *inside* `SectionFrame`'s one frame and adds none
 * of its own — the whole point of the补充 spec is that the card is no longer **a card inside a
 * card**. `border-t` between the halves is a divider, not a container.
 *
 * ⚠️ **Frameless rows.** *"不要给每条留言单独加独立卡片；显示区内部直接展示消息内容"* — the rows
 * below are names, times and sentences with a hairline between them, and nothing else.
 */
export function MessageBoardCard({ limit = 2 }: { readonly limit?: number } = {}): React.JSX.Element {
  const messages = useBookMessages();
  const composer = useMessageComposer();
  const [submitted, setSubmitted] = useState(0);
  const [picking, setPicking] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const { t } = useI18n();

  /** ⚠️ Scroll to the newest only when *this* view sent something, not on every refetch. */
  useEffect(() => {
    if (submitted === 0) return;
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [submitted]);

  if (messages.isPending) return <p className="px-5 py-4 text-body text-muted">{t("collab.messages.loading")}</p>;
  if (messages.isError) return <p className="px-5 py-4 text-body text-muted">{t("collab.messages.loadFailed")}</p>;

  /**
   * ⚠️ **The newest few, at the bottom.** `/books/messages` returns **oldest → newest** (the server
   * reverses its descending query before returning), so the last `limit` rows are the latest ones;
   * `slice(-limit)` keeps them in reading order — newest at the bottom, same as the full screen.
   * (m07047: this used to take the first rows, which are the oldest.)
   */
  const shown = messages.data.messages.slice(-limit);

  return (
    <div className="flex flex-col">
      {composer.error !== null ? (
        <p role="alert" className="border-b border-danger/30 bg-danger-soft px-4 py-3 text-body text-danger">
          {composer.error}
        </p>
      ) : null}

      {/**
        * ⚠️ **The display half.** A hairline-tinted background rather than pure surface, so the reader
        * can see where the content ends and the controls begin **before** reaching the divider — the
        * owner allowed exactly this and nothing heavier: *"可以为留言区的显示区或操作区增加轻微的浅灰 /
        * 浅绿灰背景……只需要轻微区分，不要让背景块太重."* `bg-canvas` is the project's own warm
        * off-white, so it is quiet by construction and adds no new colour.
        */}
      <div className="bg-canvas/60">
        {shown.length === 0 ? (
          <EmptyBoard />
        ) : (
          <ul ref={listRef} className="max-h-44 overflow-y-auto">
            {shown.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
          </ul>
        )}
      </div>

      {/**
        * ⚠️ **The divider the owner called out.** It is the only thing separating content from
        * controls, so it is a real border on a real element rather than spacing — **whitespace alone
        * does not say "below here is an input".**
        */}
      <div className="border-t border-line" />

      {/**
        * ⚠️ **The chosen quote sits above the input, in the operation half** — the card reads as
        * "this is what my next sentence is about", and removing it is one × in the same place it
        * appeared. **No quote, no extra height**: the input row below is unchanged.
        */}
      {composer.quote === null ? null : (
        <div className="px-3 pt-3">
          <QuoteReferenceCard
            reference={composer.quote}
            onRemove={() => {
              composer.setQuote(null);
            }}
          />
        </div>
      )}

      {/**
        * ⚠️ **The operation half: one row, input left, small button right.** The owner's rules:
        * *"左侧：输入框；右侧：发送按钮"*, *"发送按钮要明显比主按钮小"*, *"输入区应尽量利用横向空间"*,
        * *"整体布局应优先保证输入框宽度."*
        *
        * ⚠️ **`flex-1` on the input and `shrink-0` on the button** is how that priority is enforced:
        * on a narrow phone the button keeps its size and **the input absorbs all the remaining
        * width**, instead of the two splitting it evenly and the input becoming unusable.
        */}
      <div className="flex items-center gap-2 p-3">
        {/**
          * ⚠️ **The quote entry is a small themed badge, not a labelled button.** The owner asked for a
          * "小型引用按钮" that stays "足够低调，不要成为留言区域最醒目的元素" — a word beside the
          * 发送 button would compete with it, and this is the one control whose whole job is to
          * disappear until someone needs it. The badge itself (浅绿圆 + 白引号) carries the meaning;
          * the container stays transparent so the icon is the only thing that shows.
          */}
        <button
          type="button"
          aria-label={t("collab.messages.quoteButton")}
          aria-expanded={picking}
          onClick={() => {
            setPicking(true);
          }}
          className="flex size-11 shrink-0 items-center justify-center rounded-full transition hover:opacity-85 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
        >
          <QuoteIcon className="size-7" />
        </button>

        <textarea
          value={composer.draft}
          onChange={(event) => {
            composer.setDraft(event.target.value);
          }}
          /**
           * ⚠️ **Enter sends, Shift+Enter makes a new line.** The owner asked for *"手机触屏操作清楚、
           * 输入体验顺畅"*; on a phone the return key is the obvious way to send, and a textarea that
           * ignored it would feel broken. **`rows={1}` with a soft look** — *"输入框要做得轻一点、
           * 软一点，避免'框中框'的压迫感."*
           *
           * ⚠️ **输入框、引用按钮、发送按钮必须同高**（m06997）：三件同处一行时高度不齐会让人以为
           * 点错了地方；`min-h-11` + `py-2.5`（16px 行高 24 + 上下 10）正好 44px，与两个 `size-11` /
           * `h-11` 控件对齐。
           */
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (composer.canSend) {
                void composer.send().then((sent) => {
                  if (sent) setSubmitted((count) => count + 1);
                });
              }
            }
          }}
          maxLength={500}
          rows={1}
          placeholder={t("collab.messages.placeholder")}
          aria-label={t("collab.messages.inputLabel")}
          className="h-11 flex-1 resize-none rounded-field border border-line/70 bg-surface px-3.5 py-2.5 text-base text-ink transition outline-none placeholder:text-muted/80 focus:border-brand/60 focus:ring-4 focus:ring-focus-ring"
        />

        <button
          type="button"
          disabled={!composer.canSend}
          onClick={() => {
            void composer.send().then((sent) => {
              if (sent) setSubmitted((count) => count + 1);
            });
          }}
          /**
            * ⚠️ **Deliberately smaller than a primary button** — `px-3.5 py-2 text-xs` against the
            * 邀请成员 button's `px-4 py-2.5 text-sm`. The owner: *"这不是全页面级主操作，不应做成
            * 大面积绿色按钮"* and *"视觉上它是'局部操作按钮'，不是一级主操作按钮."*
            */
          className="inline-flex h-11 shrink-0 items-center rounded-field bg-brand px-3.5 text-sm font-medium text-on-brand transition hover:bg-brand-dark disabled:opacity-45"
        >
          {composer.sending ? "…" : t("collab.messages.send")}
        </button>
      </div>

      {picking ? (
        <QuotePickerSheet
          onPick={(reference) => {
            composer.setQuote(reference);
            setPicking(false);
          }}
          onClose={() => {
            setPicking(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * **The full-screen conversation.**
 *
 * ⚠️ **Full screen, not a modal or a half-height sheet** — the owner was explicit: *"点击「展开」后，
 * 进入独立的全屏留言界面，而不是弹窗或半屏抽屉."* It has its own route so the phone's back gesture
 * and the browser's back button both work, which a sheet would have to reimplement.
 *
 * ⚠️ **The input is fixed at the bottom and the history scrolls above it**, and the keyboard is the
 * reason: `h-dvh` with `flex-1 overflow-y-auto` in the middle means the input stays put when the
 * on-screen keyboard opens (`h-screen`/`100vh` would push it off the visible area on iOS).
 * `InteractiveWidget` note: this is the same frame shape as `TabPage`, minus the tab bar.
 *
 * ⚠️ **The same `useMessageComposer`**, so text typed here is the text the card shows and vice versa
 * — and a send from either place is one request, not two paths that could disagree.
 */
export function MessageBoardFull({
  bookName,
  quoteRequest,
}: {
  readonly bookName: string;
  /**
   * **A quote the shortcut entry handed over** (`/ledger/messages?quote=transaction:<id>`, from the
   * 「引用留言」 line under a saved entry). ⚠️ It is a *request*, resolved here against the server —
   * **a link cannot smuggle a title or amount in**, because only `{kind, id}` travels in the URL and
   * the snapshot is re-read. If the target is gone, the attempt is silently dropped and the ordinary
   * composer stays as it was; **opening the messages screen must never fail because of a quote.**
   */
  readonly quoteRequest?: { readonly kind: QuoteReferenceKind; readonly id: string };
}): React.JSX.Element {
  const messages = useBookMessages();
  const composer = useMessageComposer();
  const [picking, setPicking] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /**
   * ⚠️ **Fetched even when the request came from the card** — the target is what the server would
   * write, so the card the reader sees before sending is the same card every other member will see.
   */
  const pendingTarget = useQuoteTarget(
    quoteRequest?.kind ?? "transaction",
    quoteRequest?.id ?? "",
    quoteRequest !== undefined,
  );
  const appliedRequest = useRef<string | null>(null);
  /**
   * ⚠️ **S16-A: back pops this screen instead of pushing `/ledger` again.** The old control was a
   * `<Link to="/ledger">`, which *added* a ledger entry on top of the board — so the phone's back
   * gesture from the ledger page reopened the board, and the two screens walked in a circle.
   * `useGoBack` returns to wherever the reader came from and only falls back to `/ledger` for a deep
   * link, the same rule every other secondary screen uses.
   */
  const goBack = useGoBack("/ledger");
  const { t } = useI18n();

  /**
   * ⚠️ **The shortcut entry attaches its quote once, and only once.** `appliedRequest` remembers which
   * request was consumed so a refetch of the target cannot re-attach a quote the reader had removed —
   * **removing a quote must stay removed**, including while the screen is open.
   */
  useEffect(() => {
    if (quoteRequest === undefined || pendingTarget.data === undefined) return;
    const requestKey = `${quoteRequest.kind}:${quoteRequest.id}`;
    if (appliedRequest.current === requestKey) return;
    appliedRequest.current = requestKey;
    composer.setQuote({
      kind: pendingTarget.data.kind,
      id: pendingTarget.data.id,
      available: true,
      snapshot: pendingTarget.data.snapshot,
    });
    inputRef.current?.focus();
  }, [quoteRequest, pendingTarget.data, composer]);

  /**
   * ⚠️ **Open at the newest message.** This screen is entered to read *what just happened*, so the
   * first paint — cached or freshly fetched — scrolls the history to its end; new messages keep it
   * pinned there. (m07047: the list is oldest → newest, so the bottom is the latest.)
   */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [messages.data?.messages.length, composer.sending]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      {/*
        ⚠️ S16-A: the same top bar as every other secondary screen (back on the left, the title
        centred, a hairline under it) instead of a green band. The green band is the first-level
        tabs' header; on a pushed full-screen view it read as "another tab". This screen keeps its
        own frame — `h-dvh` with the history scrolling between a fixed bar and a fixed composer —
        because the on-screen keyboard needs exactly that (see the note above).
      */}
      <header className="shrink-0 border-b border-line bg-canvas pt-[env(safe-area-inset-top,0px)]">
        <div className="relative mx-auto flex h-14 w-full max-w-md items-center px-6">
          <button
            type="button"
            data-back-control
            onClick={goBack}
            className="-ml-3 flex h-11 shrink-0 items-center gap-1 rounded-field pr-3 pl-2 text-base text-brand-dark transition hover:bg-brand-soft active:bg-brand-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
          >
            <ChevronIcon direction="left" className="size-5" />
            {t("collab.messages.back")}
          </button>
          <div className="pointer-events-none absolute inset-x-24 flex min-w-0 flex-col items-center text-center">
            <h1 className="max-w-full truncate text-section-title text-ink">{t("collab.messages.title")}</h1>
            <p className="max-w-full truncate text-helper text-muted">{bookName}</p>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-md flex-col pb-4">
          {messages.isPending ? <p className="px-5 py-6 text-body text-muted">{t("collab.messages.loading")}</p> : null}
          {messages.isError ? <p className="px-5 py-6 text-body text-muted">{t("collab.messages.loadFailed")}</p> : null}

          {messages.isSuccess ? (
            /**
             * ⚠️ **Oldest-first, newest at the bottom.** The server already returns ascending order,
             * so the list renders as received — a conversation is read downwards and the latest
             * sentence is the last one. **This is presentation, not a second source.**
             */
            <ul className="flex flex-col">
              {messages.data.messages.map((message) => (
                <MessageRow key={message.id} message={message} />
              ))}
            </ul>
          ) : null}

          {messages.isSuccess && messages.data.messages.length === 0 ? <EmptyBoard /> : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2 px-4 py-3">
          {composer.error !== null ? (
            <p role="alert" className="rounded-field bg-danger-soft px-4 py-3 text-body text-danger">
              {composer.error}
            </p>
          ) : null}

          {composer.quote === null ? null : (
            <QuoteReferenceCard
              reference={composer.quote}
              onRemove={() => {
                composer.setQuote(null);
              }}
            />
          )}

          <div className="flex items-center gap-2">
            {/**
              * ⚠️ Same themed badge as the card's — **one way to start a quote, whichever view the
              * reader happens to be in.** The label is for the screen reader, not for the eye.
              */}
            <button
              type="button"
              aria-label={t("collab.messages.quoteButton")}
              aria-expanded={picking}
              onClick={() => {
                setPicking(true);
              }}
              className="flex size-11 shrink-0 items-center justify-center rounded-full transition hover:opacity-85 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
            >
              <QuoteIcon className="size-7" />
            </button>

            {/**
              * ⚠️ **三件同高**（m06997）：引用徽章 `size-11`、发送按钮 `h-11`，输入框用
              * `min-h-11` + `py-2.5`（24px 行高 + 上下 10 = 44px）。此前 `items-end` + `py-3` 让
              * 输入框 48px、按钮 32px，三者底边不齐，看起来像没对齐。
              */}
            <textarea
              ref={inputRef}
              value={composer.draft}
              onChange={(event) => {
                composer.setDraft(event.target.value);
              }}
              maxLength={500}
              rows={1}
              placeholder={t("collab.messages.placeholderFull")}
              aria-label={t("collab.messages.inputLabel")}
              className="h-11 flex-1 resize-none rounded-field border border-line bg-canvas px-4 py-2.5 text-base text-ink"
            />
            <button
              type="button"
              disabled={!composer.canSend}
              onClick={() => {
                void composer.send();
              }}
              className="inline-flex h-11 shrink-0 items-center rounded-field bg-brand px-4 text-sm text-on-brand transition hover:bg-brand-dark disabled:opacity-45"
            >
              {composer.sending ? t("collab.messages.sending") : t("collab.messages.send")}
            </button>
          </div>
        </div>
      </div>

      {picking ? (
        <QuotePickerSheet
          onPick={(reference) => {
            composer.setQuote(reference);
            setPicking(false);
          }}
          onClose={() => {
            setPicking(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** The message shape, taken from the query module so the two cannot drift apart. */
type BookMessage = BookMessageView;

/**
 * The instant, in the reader's own words.
 *
 * ⚠️ **Coarser than the history's version on purpose** — a board reads as a conversation, and
 * *"今天 14:32"* is what somebody wants; seconds would be noise. **A message from last month says the
 * date, because "12 天前" is arithmetic the reader should not have to do.**
 *
 * S16：中文保留原来的写法（`今天 14:32`、`10 月 8 日 14:32`）；其它语言的钟点与日期交给 `Intl`
 * （`Today 2:32 PM`、`Oct 8, 2:32 PM`）。只改显示，不改按哪一天归属。
 */
function formatWhen(iso: string): string {
  const at = new Date(iso);
  const now = new Date();
  const chinese = isChineseLocale();

  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const time = chinese
    ? `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
    : formatInstant(at, { hour: "numeric", minute: "2-digit" });

  if (sameDay(at, now)) return translate("collab.messages.todayAt", { time });
  if (sameDay(at, yesterday)) return translate("collab.messages.yesterdayAt", { time });

  if (!chinese) return formatInstant(at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return `${String(at.getMonth() + 1)} 月 ${String(at.getDate())} 日 ${time}`; // i18n-ignore：中文界面专用的固定格式（与 lib/datetime.ts 的 formatDayLabel 同一做法）
}
