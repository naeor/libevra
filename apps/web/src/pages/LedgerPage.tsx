import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { DefaultAvatar } from "../components/DefaultAvatar.js";
import { HistoryList } from "../components/HistoryList.js";
import { Section } from "../components/Section.js";
import { FrameAction, SectionFrame } from "../components/SectionFrame.js";
import { MessageBoardSection } from "../components/MessageBoard.js";
import { NotificationBell } from "../components/Notifications.js";
import { TabPage } from "../components/Layouts.js";
import { TabPageHeader } from "../components/TabPageHeader.js";
import { SkeletonRows } from "../components/States.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { useBookMembers, useBooks, useInviteToBook, useLeaveBook, useLedger } from "../lib/queries.js";

/**
 * **账本 / 协作 —— 第四个主 Tab，和明细、分析、账户同级。**
 *
 * ⚠️ **The owner's framing is "一个账本相当于一个群组"**, and this page is where that shows. The
 * headings below are his, verbatim:
 *
 * > *"单人账本：底部导航和页面标题显示「账本」……内容从上到下：当前账本信息、编辑记录、邀请成员。"*
 * >
 * > *"多人账本：底部导航和页面标题显示「协作」……内容从上到下：顶部两张并排卡片（当前账本／成员）、
 * >  编辑记录、留言。"*
 *
 * ⚠️ **One page, two emphases — never two pages.** *"不创建两套完全独立的一级页面"*, and the same
 * instruction governs the bottom bar: **the label changes with the member count and the screen does
 * not.** A second route would let the two drift, and the reader would have two places to look for
 * one thing.
 *
 * ⚠️ **The frame is `TabPage`**, which is what `StatsPage` and `MePage` use: no back arrow, dynamic
 * viewport height, the middle region scrolls, and the bottom bar is a flex sibling rather than
 * something pinned over the content. **A main tab is a place you switch to, not one you come back
 * from.**
 *
 * ⚠️ **The green header, the `px-6` rhythm and the `rounded-card` blocks are the same pieces
 * `StatsPage` uses**, because the owner asked for one design system rather than a new one:
 * *"不要为了统一而把页面重新设计成与其他模块完全不同的新风格."*
 */
export function LedgerPage(): React.JSX.Element {
  const navigate = useNavigate();
  const ledger = useLedger();
  const books = useBooks();
  const members = useBookMembers();
  const { t } = useI18n();

  const memberCount = ledger.data?.book.memberCount ?? 1;
  const shared = memberCount >= 2;
  const stats = ledger.data?.stats;

  /* ⚠️ The list this page shows, and only the first few of it — see `MemberSummaryCard`. */
  const memberList = members.data?.members ?? [];

  return (
    <TabPage
      active="/ledger"
      onNavigate={(to) => {
        navigate(to);
      }}
    >
      {/**
        * ⚠️ **The title is the tab's own name**, so the screen and the bar agree: 账本 alone, 协作
        * with others. The owner's rule is that these are **the same page with a different emphasis**,
        * and the header saying the same word as the bar is the cheapest way to keep that true.
        *
        * ⚠️ **The bell lives here, in the header, as the owner specified**: *"在账本／协作一级页面
        * 绿色顶部区域右上角直接提供通知铃铛"* — and *"不论单人还是多人状态，都显示同一位置的通知入口."*
        * It is **outside the `shared` branch on purpose**: an invitation arrives whether or not this
        * ledger has two members, and a bell that only appeared in one state would be invisible
        * exactly when the first invitation is waiting.
        */}
      {/**
        * ⚠️ **The green heading area is `TabPageHeader`, shared with 分析** (1.10.10). The owner asked
        * for the two screens to be aligned *by construction*: *"尽可能复用相同的标题区布局规则或共享样式，
        * 保证以后修改时不会再次出现差异."*
        *
        * ⚠️ **The bell rides in the `action` slot, and the slot is the whole point.** The owner kept the
        * two ideas apart: *"如果账本／协作页顶部有通知铃铛等独有操作，应予保留；分析页不需要为了统一而增加
        * 相同功能."* So the **title block is the shared rule** and the right-hand side is per page.
        *
        * ⚠️ **The bell is outside the `shared` branch on purpose**: an invitation arrives whether or not
        * this ledger has two members, and a bell that appeared in only one state would be invisible
        * exactly when the first invitation is waiting.
        *
        * ⚠️ **The subtitle no longer waits for `ledger.isSuccess`.** It used to, which made this header
        * **one line shorter while loading and then jump** — and would have made it disagree with 分析
        * during exactly the moment a reader switching tabs sees both. **The words are static; a height
        * that depends on a request is a layout that moves.**
        */}
      <TabPageHeader
        title={shared ? t("ledger.page.titleShared") : t("ledger.page.titleSolo")}
        subtitle={shared ? t("ledger.page.subtitleShared") : t("ledger.page.subtitleSolo")}
        action={
          /**
           * ⚠️ **Two actions, one action row.** The bell opens notifications; the gear opens the
           * **current ledger's** full settings page. Both share NotificationBell's row so they get
           * one size, one outline and one focus treatment — the owner asked for a single button
           * language on this green header, not a new button style per action.
           */
          <NotificationBell
            showHeading={false}
            extraAction={
              <button
                type="button"
                onClick={() => {
                  const bookId = ledger.data?.book.id;
                  // No current ledger yet: the honest destination is the ledger space, not a
                  // guessed settings page for a book we cannot name.
                  navigate(bookId === undefined ? "/start" : `/books/${bookId}/settings`);
                }}
                aria-label={t("ledger.page.settings")}
                className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
              >
                <GearIcon />
              </button>
            }
          />
        }
      />

      {ledger.isPending ? (
        <section className="px-6 pt-6">
          <SkeletonRows rows={3} />
        </section>
      ) : null}

      {ledger.isSuccess ? (
        <>
          {/**
            * ⚠️ **First layer, and its shape is the owner's split.** Shared ledgers get **two cards
            * side by side** — 当前账本 and 成员 — and a lone ledger gets one card carrying the same
            * facts plus the way out to the ledger space.
            *
            * ⚠️ **The two cards must stay the same height.** His instruction: *"两张卡片应保持一致的高度
            * 与布局节奏。较长的账本名称、较多的成员数量和窄屏幕不应导致文字溢出或布局错乱."* The grid
            * gives them the same row; `h-full` and `min-h-0` keep that. The book name **wraps**
            * (rather than being ellipsed) so a long name grows the shared row instead of losing text;
            * the member card stretches with it, and the switch stays a compact bar.
            */}
          {shared ? (
            <section className="grid grid-cols-2 items-stretch gap-3 px-6 pt-6">
              <CurrentBookCard
                bookId={ledger.data.book.id}
                name={ledger.data.book.name}
                bookNumber={ledger.data.book.bookNumber}
                bookCount={books.isSuccess ? books.data.books.length : null}
                facts={stats === undefined ? null : t("ledger.page.factsShort", { count: stats.transactionCount })}
              />
              <MemberSummaryCard
                members={memberList}
                memberCount={memberCount}
                loading={members.isPending}
              />
            </section>
          ) : (
            <section className="px-6 pt-6">
              <SoloBookCard
                bookId={ledger.data.book.id}
                name={ledger.data.book.name}
                bookNumber={ledger.data.book.bookNumber}
                bookCount={books.isSuccess ? books.data.books.length : null}
                facts={stats === undefined ? null : t("ledger.page.factsLong", { count: stats.transactionCount })}
              />
            </section>
          )}

          {/**
            * ⚠️ **编辑记录 —— 一个总外框，里面直接排条目（1.10.07）.**
            *
            * The owner's §4.3: the heading and the 查看全部 › link sit **above and outside** the
            * frame, and the frame's inside holds the records themselves with a hairline between
            * them — *"不出现'外框里面再套一个独立记录卡片'的结构."*
            *
            * ⚠️ **`embedded` is what removes the second card.** Before this, `Section` drew a card and
            * `HistoryList` drew another one inside it, so the reader looked through two borders at
            * two rows — which is the *"盒子套盒子"* the owner is asking to remove.
            */}
          {/**
            * ⚠️ **正式功能区标题，试验规格（16px/600）。** 这是所有者点名的两处之一。
            * ⚠️ **`titleClassName` 没有写** —— 走共享组件的默认值 `section-title`，
            * 所以它和「留言」由**同一个来源**决定，不可能是两个值。
            */}
          <SectionFrame
            title={t("ledger.page.history")}
            action={<FrameAction to="/ledger/history">{t("ledger.page.viewAll")}</FrameAction>}
          >
            <HistoryList
              limit={3}
              embedded
                emptyHint={t("ledger.page.historyEmpty")}
            />
          </SectionFrame>

          {/**
            * ⚠️ **Third layer in the shared state: 留言.**
            *
            * ⚠️ **Not merged with 编辑记录 and not behind a Tab**, because the owner ruled both out:
            * *"不与编辑记录合并成一个动态流，也不使用 Tab 切换."* They answer different questions —
            * one is a record of what changed, the other is people talking — and a combined feed would
            * make "who said this" and "who changed this" look like the same kind of event.
            *
            * ⚠️ **`MessageBoardSection` owns the heading row too**, because 新消息 N 条 has to be read
            * before the board marks itself seen — see the note on that component.
            */}
          {shared ? <MessageBoardSection bookId={ledger.data.book.id} /> : null}

          {/**
            * ⚠️ **Last layer in the lone state: 邀请成员, as a local operation rather than a doorway.**
            *
            * The owner removed the detour himself — *"不再通过「邀请新成员 → 去邀请 → 协作者」这一冗长路径"*
            * and *"即使账本只有一名成员，也能直接搜索其他用户并邀请加入"* — and the 补充 spec puts this
            * in his third container category: *"一级页面内的局部操作区域……直接开放式结构"* and
            * *"单人状态下的'邀请成员'属于可直接操作模块……不要过度盒子套盒子."*
            *
            * ⚠️ **So it is `bare`:** a heading, one line of explanation, one input and one button.
            * **No frame** — the input already has its own edge, and wrapping it would be a box around
            * a box. `/ledger/invite` still exists for the fuller flow (role choice, member list).
            *
            * ⚠️ **In the shared state the invitation lives inside 成员管理 instead** — the owner put it
            * there: *"点击进入当前账本的成员管理。成员管理内可以查看成员、权限以及邀请新成员."*
            */}
          {shared ? null : (
            /**
              * ⚠️ **推广后走默认规格（16px/600）。** 所有者 2026-10-13 批准全站推广，
              * 并确认这一层也属于正式功能区标题。
              */
            <SectionFrame
              title={t("ledger.page.invite")}
              bare
            >
              {/**
                * ⚠️ **S16-A：说明放到输入框下面，并降为辅助文字。** 单人账本里邀请是"可以做"，
                * 不是"必须做"：原来一段 14px 的说明压在输入框上面，整块比编辑记录还重。
                * 现在输入框是这一块的第一眼，说明是它的注脚；文字本身没有改。
                */}
              <QuickInvite bookName={ledger.data.book.name} />
            </SectionFrame>
          )}

          {/**
            * ⚠️ **S16-A：原来的「账本信息」卡片去掉了，它的内容并入顶部的当前账本卡片。**
            *
            * 所有者：*"当前底部账本信息卡片与账本详情存在较多重复。请评估是否应该移除、精简、融入顶部
            * 当前账本区域或采用其他方案。"* 那张卡的四项里：成员数已经在成员卡片上（单人账本恒为 1），
            * 账目笔数现在写在当前账本卡片的编号后面，创建日期在账本详情里，「详情」与卡片上的「查看详情」
            * 是同一个去处；估算的空间占用移到账本详情页的资料里（`BookDetailPage`）。所有者此前要求的
            * "简洁预览 + 点击进入二级页面查看"仍然成立，只是预览不再单独占一块。
            */}
          <LeaveBookSection bookId={ledger.data.book.id} />
        </>
      ) : null}
    </TabPage>
  );
}

/**
 * **邀请成员，直接在这个页面上做完（单人状态）.**
 *
 * ⚠️ **It used to be a button that went to `/ledger/invite`** — which was already one step better
 * than the old 邀请新成员 → 去邀请 → 协作者 detour, but still a page for one field and one press.
 * The 补充 spec puts this module in the third container category — *"一级页面内的局部操作区域"* —
 * and says outright that *"单人状态下的'邀请成员'属于可直接操作模块."* **A local operation belongs
 * where the person already is.**
 *
 * ⚠️ **The full flow has not gone anywhere.** `/ledger/invite` still exists and is still where the
 * **role** is chosen, an outstanding invitation is shown, and the member list is. The link below
 * says so rather than hiding it — **a shortcut that removed the careful path would be a worse
 * trade than the step it saved.**
 *
 * ⚠️ **The server refuses anything this cannot express**, and the permission is unchanged: sending
 * an invitation is a *write*, so a viewer is refused by `requireBookForWrite` regardless of what
 * this page draws.
 */
function QuickInvite({ bookName }: { readonly bookName: string }): React.JSX.Element {
  const invite = useInviteToBook();
  const { t } = useI18n();

  const [query, setQuery] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = query.trim();
  const canSend = value !== "" && invite.isPending === false;

  function send(): void {
    if (!canSend) return;

    setError(null);
    setSent(false);

    /**
     * ⚠️ **Eight digits is a number, anything else is a username** — the same rule the invite screen
     * uses, and the same rule the server validates. **One field, no mode switch**: the user should
     * not have to classify what they typed.
     */
    const target = /^[0-9]{8}$/.test(value) ? { accountNumber: value } : { username: value };

    void invite
      .mutateAsync({ ...target, role: "editor" })
      .then(() => {
        setSent(true);
        setQuery("");
      })
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
      });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {error === null ? null : (
        <p role="alert" className="rounded-field bg-danger-soft px-4 py-3 text-body text-danger">
          {error}
        </p>
      )}

      {sent ? (
        <p role="status" className="rounded-field bg-brand-soft px-4 py-3 text-body text-brand-dark">
          {t("ledger.page.inviteSent", { book: bookName })}
        </p>
      ) : null}

      {/**
        * ⚠️ **Input left, button right, and the input takes the width** — the same priority as the
        * message box: `flex-1` against `shrink-0`, so a narrow phone shrinks nothing that matters.
        */}
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
          placeholder={t("ledger.page.invitePlaceholder")}
          aria-label={t("ledger.page.inviteWho")}
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-field border border-line bg-surface px-3.5 py-2.5 text-base text-ink transition outline-none placeholder:text-muted/80 focus:border-brand focus:ring-4 focus:ring-focus-ring"
        />

        <button
          type="button"
          disabled={!canSend}
          onClick={send}
          className="shrink-0 rounded-field bg-brand px-4 py-2.5 text-sm font-medium text-on-brand transition hover:bg-brand-dark disabled:opacity-45"
        >
          {invite.isPending ? t("ledger.page.sending") : t("ledger.page.inviteButton")}
        </button>
      </div>

      <p className="text-helper-relaxed text-muted">
        {t("ledger.page.inviteHint")}
      </p>

      <Link to="/ledger/invite" className="self-start text-helper text-brand transition hover:text-brand-dark">
        {t("ledger.page.inviteMore")}
      </Link>
    </div>
  );
}

/**
 * **当前账本 —— the shared state's left card.**
 *
 * ⚠️ **Two separate tap targets inside one card, and that is the owner's requirement**:
 * *"将「切换账本」整合在卡片内，但应与「查看账本详情」形成清楚的独立点击目标."* So the name is a
 * link to the ledger's details and 切换账本 is its own control — **nested links are invalid HTML and
 * would make the two indistinguishable to a screen reader**, which is why they are siblings here
 * rather than one inside the other.
 */
function CurrentBookCard({
  bookId,
  name,
  bookNumber,
  bookCount,
  facts,
}: {
  readonly bookId: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly bookCount: number | null;
  readonly facts: string | null;
}): React.JSX.Element {
  return <BookCardSplit bookId={bookId} name={name} bookNumber={bookNumber} bookCount={bookCount} facts={facts} />;
}

/**
 * **One card, two large independent tap targets.**
 *
 * ⚠️ **The owner's requirement is about target size, not just labels**: *"将「切换账本」整合在卡片内，
 * 但应与「查看账本详情」形成清楚的独立点击目标."* The previous version had two small text links at
 * the bottom; on a phone they were the smallest things in the card. Now the left side is one large
 * **查看详情** area and the right side is one large **切换账本** area, each at least 44×44 CSS px.
 *
 * ⚠️ **The split must not depend on the card being wide.** Shared ledgers put this card in a
 * half-width grid cell, so the two areas stack vertically below `sm` (`flex-col sm:flex-row`).
 * **The words 切换账本 stay complete in both layouts** — an icon-only switch is the thing this
 * change exists to avoid.
 */
function BookCardSplit({
  bookId,
  name,
  bookNumber,
  bookCount,
  facts = null,
  tinted = false,
}: {
  readonly bookId: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly bookCount: number | null;
  /** S16-A：原「账本信息」卡片里的事实（笔数、创建日期），写在编号后面。 */
  readonly facts?: string | null;
  readonly tinted?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const switchLabel =
    bookCount === null ? t("ledger.page.switchBookLabel") : t("ledger.page.switchBookCount", { count: bookCount });

  return (
    <div
      className={`book-card flex h-full min-h-0 flex-col overflow-hidden rounded-card border ${
        tinted ? "border-brand/30 bg-brand-soft/50" : "border-line bg-surface"
      }`}
    >
      <div className="book-card-body">
        <Link
          to={`/books/${bookId}`}
          className="flex min-h-20 min-w-0 flex-1 flex-col justify-between gap-1.5 p-4 text-left transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
        >
          <span className="text-helper text-muted">{t("ledger.page.currentBook")}</span>
          <span className="break-words text-base font-medium text-ink">{name}</span>
          <span className="truncate text-helper text-muted">
            <span className="font-mono">{bookNumber ?? t("ledger.page.noNumber")}</span>
            {facts === null ? null : ` · ${facts}`}
          </span>
          <span className="text-helper font-medium text-brand">{t("ledger.page.viewDetails")}</span>
        </Link>

        <Link
          to="/start"
          aria-label={switchLabel}
          className="book-card-switch group border-line text-center transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring active:bg-brand-soft/40"
        >
          <SwitchIcon className="book-card-switch-icon text-brand transition group-hover:scale-105 group-active:scale-95" />
          <span className="book-card-switch-label text-helper font-medium text-brand">{t("ledger.page.switchBook")}</span>
        </Link>
      </div>
    </div>
  );
}

/**
 * **成员 —— the shared state's right card: a count and a glimpse, not the list.**
 *
 * ⚠️ **The controls live on the members page**, and this card is the way in — the owner:
 * *"点击后进入当前账本的成员管理。成员管理内可以查看成员、权限以及邀请新成员."* Showing roles and
 * remove buttons here would make the main tab the management screen, which is the layer split he
 * asked for in the same paragraph.
 *
 * ⚠️ **Two or three faces, then a number.** A ledger with twenty members must not push this card
 * taller than the one beside it, so the extras are counted rather than listed.
 */
function MemberSummaryCard({
  members,
  memberCount,
  loading,
}: {
  readonly members: readonly { readonly userId: string; readonly displayName: string }[];
  readonly memberCount: number;
  readonly loading: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  /** ⚠️ Three at most, and the remainder is arithmetic — see the note above about equal heights. */
  const faces = members.slice(0, 3);
  const extra = Math.max(0, memberCount - faces.length);

  return (
    <Link
      to="/ledger/members"
      className="flex h-full min-h-0 flex-col justify-between gap-3 rounded-card border border-line bg-surface p-4 transition hover:border-brand/40"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-helper text-muted">{t("ledger.page.members")}</span>
        <span className="text-base font-medium text-ink">
          {loading ? "…" : t("ledger.page.memberCount", { count: memberCount })}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {faces.length === 0 ? (
          /** ⚠️ A placeholder rather than an empty row, so the card keeps its shape while loading. */
          <span className="h-8" aria-hidden="true" />
        ) : (
          <span className="flex items-center gap-1.5">
            {faces.map((member) => (
              <span
                key={member.userId}
                title={member.displayName}
                className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line"
              >
                <DefaultAvatar className="size-8" />
              </span>
            ))}
            {extra > 0 ? <span className="text-helper text-muted">+{String(extra)}</span> : null}
          </span>
        )}

        <span className="text-helper text-brand">{t("ledger.page.manageMembers")}</span>
      </div>
    </Link>
  );
}

/**
 * **当前账本信息 —— the lone state's single card.**
 *
 * ⚠️ **The owner's first item for a one-person ledger is "当前账本信息……账本名称、编号及部分基本信息"**,
 * with the switcher inside it — so this card carries the name, the number and the way out, and the
 * two tap targets are as separate as they are in the shared state.
 *
 * ⚠️ **It keeps the brand tint the old card had.** The tint is what makes it read as a way *between*
 * ledgers rather than another item *in* this one, which was the reason for it before this change.
 */
function SoloBookCard({
  bookId,
  name,
  bookNumber,
  bookCount,
  facts,
}: {
  readonly bookId: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly bookCount: number | null;
  readonly facts: string | null;
}): React.JSX.Element {
  return (
    <BookCardSplit
      bookId={bookId}
      name={name}
      bookNumber={bookNumber}
      bookCount={bookCount}
      facts={facts}
      tinted
    />
  );
}


/** The switch glyph — arrows pointing both ways, so the word 切换账本 has a visual anchor. */
function SwitchIcon({ className = "size-4" }: { readonly className?: string }): React.JSX.Element {
  return (
    <svg
      className={`${className} shrink-0`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h13l-3-3m6 11H7l3 3" />
    </svg>
  );
}

/** The gear used in the 账本/协作 header action row. */
function GearIcon(): React.JSX.Element {
  return (
    <svg
      className="size-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
    </svg>
  );
}

/**
 * **退出这本账 —— 只对「不是创建者」的人显示。**
 *
 * ⚠️ **The owner keeps two meanings apart**, and this is the second of them: *"不是同一回事"* (Q5).
 * **弃置** is *"整本弃置"* — it sets the ledger aside for everybody, and **only its creator may do
 * it**. **退出** is *"我不想再显示这本账"* — one person stepping out of somebody else's ledger.
 *
 * ⚠️ **So the creator sees no button here**, and the server says the same (`creator_cannot_leave`):
 * **removing the last writer would leave a ledger nobody can edit, invite into or dispose of**, and
 * no screen could undo it. Their route is 弃置, which lives on 我的账本.
 *
 * ⚠️ **It sits at the very bottom, after the information.** A destructive action placed above the
 * content is one people reach by scrolling past it.
 *
 * ⚠️ **`bookId` is passed in rather than derived.** My first version wrote a helper that returned
 * `member.userId` under the name `ledgerIdOf` — **which would have asked the server to make the user
 * leave a ledger whose id happened to equal their own user id.** It is a type error waiting to be a
 * runtime one, and the fix is to take the ledger from the ledger.
 */
function LeaveBookSection({ bookId }: { readonly bookId: string }): React.JSX.Element | null {
  const { user } = useAuth();
  const members = useBookMembers();
  const leave = useLeaveBook();
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = members.data?.members.find((member) => member.userId === user?.id) ?? null;

  /** ⚠️ Nothing at all while the answer is unknown — a button that appears then vanishes is worse. */
  if (me === null || me.isCreator) return null;

  return (
    /**
      * ⚠️ **推广后走默认规格（16px/600）。**
      */
    <Section title={t("ledger.page.leaveTitle")}>
      {error === null ? null : (
        <p role="alert" className="mb-3 rounded-field bg-danger-soft px-4 py-3 text-body text-danger">
          {error}
        </p>
      )}

      <p className="text-body-relaxed text-muted">
        {t("ledger.page.leaveExplain")}
      </p>

      {confirming ? (
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={leave.isPending}
            onClick={() => {
              setError(null);
              void leave
                .mutateAsync(bookId)
                .then(() => {
                  /**
                   * ⚠️ **A reload, for the same reason entering a ledger is one**: leaving changes
                   * which ledger every later request addresses and which slice of the offline copy is
                   * read. **A screen showing this ledger's header over another's entries is the
                   * failure the isolation exists to prevent**, and a reload cannot be half-done.
                   */
                  window.location.assign("/");
                })
                .catch((caught: unknown) => {
                  setError(errorMessage(caught));
                  setConfirming(false);
                });
            }}
            className="rounded-field bg-danger px-4 py-2 text-sm text-on-danger transition hover:bg-danger-dark disabled:opacity-45"
          >
            {leave.isPending ? t("ledger.page.leaving") : t("ledger.page.leaveConfirm")}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
            }}
            className="rounded-field bg-canvas px-4 py-2 text-body text-muted transition hover:text-ink"
          >
            {t("common.action.cancel")}
          </button>
        </div>
      ) : (
        /**
         * ⚠️ **Red, at the owner's instruction (2026-10-13): *"把多人账目中的退出这笔帐按钮改成红的."***
         *
         * ⚠️ **It used to be a quiet grey button that only turned red on hover** — and that was
         * defensible (the confirmation step is the real gate, and a red button invites the tap it is
         * warning about). **The owner overruled it, and his reason is the better one: a grey button
         * in a section titled 退出这本账 does not look like the thing it is.** The colour has to
         * match the act, or the warning only arrives after the reader has already decided.
         *
         * ⚠️ **Nothing about the safety changed**: this still only *asks*, and `ConfirmDialog`-style
         * confirm/cancel below is still the step that leaves. **The colour is the signpost, not the
         * guard** — and the server refuses a creator regardless of what any of this looks like.
         */
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
          }}
          className="mt-3 rounded-field bg-danger px-4 py-2 text-sm text-on-danger transition hover:bg-danger-dark"
        >
          {t("ledger.page.leaveTitle")}
        </button>
      )}
    </Section>
  );
}
