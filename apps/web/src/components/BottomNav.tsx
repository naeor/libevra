import { useLedger } from "../lib/queries.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useRef, type ReactNode } from "react";
import { Link } from "react-router";

interface IconProps {
  readonly className?: string;
}

function ListIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
    </svg>
  );
}

function ChartIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <path d="M5 19V11M12 19V5M19 19v-6" strokeLinecap="round" />
    </svg>
  );
}

function PeopleIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" strokeLinecap="round" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17 19a5.5 5.5 0 0 0-2-4.3" strokeLinecap="round" />
    </svg>
  );
}

function PersonIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function MicrophoneIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

function PenIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" strokeLinejoin="round" />
      <path d="M14.5 6.5 17.5 9.5" strokeLinecap="round" />
    </svg>
  );
}

export function CameraIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path
        d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

/** A clipboard with two lines: pasted transaction text. */
function ClipboardIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 14h7M8.5 18h4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A sheet of paper with an arrow rising out of it — 「导入」 in the same drawing
 * language as the other cards (24px box, `currentColor`, 1.8 stroke).
 *
 * ⚠️ It goes here rather than in `Icons.tsx` because it has one home: the entry
 * menu. `Icons.tsx` is for icons more than one screen needs.
 */
function FileUpIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path
        d="M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-4-4Z"
        strokeLinejoin="round"
      />
      <path d="M15 3v4h4" strokeLinejoin="round" />
      <path d="M12 16.5v-5M9.7 13.6 12 11.3l2.3 2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Tab {
  readonly to: string;
  readonly label: string;
  readonly icon: (props: IconProps) => React.JSX.Element;
  readonly primary?: boolean;
  /**
   * ⚠️ **The label depends on how many people are in the current ledger.**
   *
   * The owner's rule: *"只有自己一位成员时，显示「账本」。有两位或以上成员时，显示「协作」。……
   * 这两个名称对应的实际上是**同一个功能空间**，页面的整体设计语言保持一致，
   * 但展示重点和内容布局根据成员数量自动变化."*
   *
   * ⚠️ **A flag rather than two entries with two routes.** Two tabs pointing at the same page would
   * mean the navigation had two states to keep in step, and **the day they disagree is the day the
   * bar shows 协作 while the page shows one member.**
   */
  readonly labelFromMembers?: boolean;
}

export const TABS: readonly Tab[] = [
  { to: "/", label: "明细", icon: ListIcon },
  { to: "/stats", label: "分析", icon: ChartIcon },
  { to: "/add", label: "记账", icon: PlusIcon, primary: true },
  /** ⚠️ The fourth slot is the ledger itself — *"账本"* alone, *"协作"* with others. */
  { to: "/ledger", label: "账本", icon: PeopleIcon, labelFromMembers: true },
  { to: "/me", label: "我的", icon: PersonIcon },
];

/**
 * The fourth slot's label, from the member count.
 *
 * ⚠️ **One member means 账本, two or more means 协作** — *"有两位或以上成员时"*. Written as a
 * function so the rule has **one** implementation: the page will need the same answer when it
 * decides how prominent to make the member area.
 *
 * ⚠️ **While the count is unknown it says 账本**, which is the quieter of the two. Guessing 协作
 * would promise a collaboration screen to somebody who is alone — **and the wrong guess in that
 * direction is the one a person notices.**
 */
export function ledgerTabLabel(memberCount: number | undefined): string {
  return memberCount !== undefined && memberCount >= 2 ? "协作" : "账本";
}

interface EntryAction {
  readonly label: string;
  /**
   * The short visible caption used while the row is too tight for four characters.
   *
   * ⚠️ **This is only a caption, never the accessible name.** The full `label`
   * stays on every card as `aria-label`, so a narrow screen does not turn
   * 粘贴识别 into "粘贴" for someone using a screen reader.
   */
  readonly shortLabel: string;
  readonly icon: ReactNode;
  /** Why the card is disabled, read out with its label. Absent when it has a `to`. */
  readonly hint?: string;
  /** Where the card goes, when it goes anywhere. */
  readonly to?: string;
  /**
   * Whether this card opens the image picker before going there.
   *
   * A flag rather than a callback on the action, because the onClick has to run
   * inside the user's tap to be allowed to open a picker at all — see the note
   * on the camera card where it is rendered.
   */
  readonly picksImages?: boolean;
  /**
   * What a screen reader hears, when `${label}记账` would be wrong.
   *
   * ⚠️ **导入账单 is not a way to type an entry**, so "导入账单记账" would be
   * nonsense. Every other card keeps the default.
   */
  readonly ariaLabel?: string;
}

/**
 * The four ways to get a record into the ledger, in the order they appear.
 *
 * Whether a card goes anywhere is expressed by `to` and by nothing else: with
 * one, it is a link; without one, it is a feature that has not shipped and is
 * rendered disabled with its own wording. A separate `available` flag used to
 * sit beside `to` and was never read — two fields answering one question is how
 * they end up disagreeing about the answer.
 *
 * A card that looks live and does nothing is worse than one that admits it is
 * not, and hiding the unfinished ones would make the row's shape change the day
 * they ship.
 *
 * ⚠️ **拍照 no longer links anywhere.** It opens the image picker itself and then
 * goes to recognition, which is the owner's two-taps-fewer change: the card used
 * to load a screen whose first act was to ask for the same picture, so the user
 * pressed 拍照, waited for a screen, and pressed 选择截图 to say what they had
 * already said.
 *
 * `to` is still used by 手动 and 语音. 拍照 keeps one as its **fallback** for the
 * case where the picker cannot be opened at all — the page it lands on offers the
 * button itself, so the user is not stuck.
 *
 * ⚠️ **导入账单 is the fourth card, and it goes to `/import` — never
 * `/import-ledger`.** The latter is `LedgerImportPage`, which migrates a whole
 * ledger from another ledger; this card is about bringing a **CSV** file into
 * **the ledger the reader is already in**, which is exactly what `/import` does
 * (the same screen 导出 reaches through 「导入历史账」; the API parses CSV only,
 * so the card makes no Excel promise). Pointing it at the ledger-import screen
 * would silently change which ledger the file lands in.
 *
 * **All five cards lead somewhere now.** 语音 sat disabled with "即将开放"
 * until the recorder shipped; 粘贴识别 is the newest, and 手动记账 sits in the
 * visual centre because it is the fallback that always works.
 */
const ENTRY_ACTIONS: readonly EntryAction[] = [
  {
    label: "粘贴识别",
    shortLabel: "粘贴",
    icon: <ClipboardIcon className="size-6" />,
    to: "/paste",
    ariaLabel: "粘贴识别",
  },
  {
    label: "语音记账",
    shortLabel: "语音",
    icon: <MicrophoneIcon className="size-6" />,
    to: "/record",
    ariaLabel: "语音记账",
  },
  {
    label: "手动记账",
    shortLabel: "手动",
    icon: <PenIcon className="size-6" />,
    to: "/add",
    ariaLabel: "手动记账",
  },
  {
    label: "拍照识别",
    shortLabel: "拍照",
    icon: <CameraIcon className="size-6" />,
    to: "/scan",
    picksImages: true,
    ariaLabel: "拍照识别",
  },
  {
    label: "导入账单",
    shortLabel: "导入",
    icon: <FileUpIcon className="size-6" />,
    /**
     * `?from=nav` is the page's origin hint, not a second route: `ImportPage` uses it to hide the
     * legacy 「← 返回导出」 shortcut (a child of `/export`) and to fall back to 明细 instead of
     * `/export` when there is no history. The destination is still the current-ledger import.
     */
    to: "/import?from=nav",
    ariaLabel: "导入账单",
  },
];

/**
 * How the entry cards behave.
 *
 * **They are a switch everywhere, and that is deliberate.** An earlier version
 * made the centre button navigate to the manual form on screens other than the
 * ledger, on the reasoning that a menu is only wanted where it is part of the
 * layout. That was wrong, and the owner said why: he added the camera and the
 * planned voice recording *because* there was nowhere to put them, and a button
 * that jumps straight to the manual form makes those two harder to reach on
 * every screen that is not the ledger. The menu opens wherever the reader is.
 *
 * What a screen does control is whether the menu is *left* open behind it — see
 * `AppShell` in `Layouts`.
 */
export type EntryCards = {
  readonly mode: "toggle";
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly active: boolean;
};

/**
 * The bottom bar, whose centre button unfolds the ways to add records.
 *
 * Pressing it turns the `+` forty-five degrees into an `×` and unfolds the
 * cards above it. Pressing it again folds them away. The rotation is the whole
 * animation — a plus rotated forty-five degrees *is* a cross, so there is no
 * second icon to swap in and nothing to keep in sync.
 *
 * The cards sit above the bar rather than floating over the list. That is the
 * difference between this and the island it replaced: an overlay has to be
 * given room by shoving content aside, and this simply occupies space nothing
 * else wanted.
 */
export function BottomNav({
  active,
  onNavigate,
  cards,
  onPickImages,
}: {
  readonly active: string;
  readonly onNavigate: (to: string) => void;
  readonly cards: EntryCards;
  /**
   * What to do with the pictures once 拍照 has them.
   *
   * Absent means the camera card falls back to being a plain link to `/scan`,
   * where a visible button does the same job. That is the behaviour on any
   * screen that has not opted in, and it keeps the card useful rather than dead.
   */
  readonly onPickImages?: ((files: File[]) => void) | undefined;
}): React.JSX.Element {
  const open = cards.expanded;
  const guest = useGuestMode();
  const pickerRef = useRef<HTMLInputElement | null>(null);
  /**
   * ⚠️ **Read here so the fourth slot can name itself.** Shared with whatever screen is open through
   * the query cache, so this is not an extra request — see `ledgerTabLabel`.
   */
  const ledger = useLedger();
  return (
    // Not `fixed`: the frame that owns this bar is the full dynamic viewport
    // height and only scrolls its middle region, so the bar never ends up
    // underneath a browser toolbar.
    <nav
      aria-label="主导航"
      className="relative z-10 shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      {/*
        The camera card's file picker.
        
        Hidden rather than absent, and never focused: it exists to be clicked by
        the card. `multiple` because a batch of screenshots is a supported case,
        and the screen it hands them to decides what to do with more than one.
        
        Living in the bar rather than on the recognition screen means the user's
        tap opens the picker immediately — the requirement is that the picker
        opens from a gesture, and the gesture happens here.
        
        The input is reset after every change so that choosing the *same*
        screenshot twice still fires a change event; without that, a second
        attempt with the same picture would look like nothing happened.
      */}
      {onPickImages === undefined ? null : (
        <input
          ref={pickerRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            const chosen = [...(event.target.files ?? [])];
            event.target.value = "";

            if (chosen.length > 0) onPickImages(chosen);
          }}
        />
      )}

      {/*
        The cards sit above the bar rather than floating over the list. Real
        space is reserved for them by the frame, so nothing ever passes behind
        them — see the note in `TabPage`.

        Kept mounted and animated rather than added and removed: an element that
        appears instantly has nothing to animate, and the fade is what makes the
        row read as coming out of the button.
      */}
      <div
        aria-hidden={!open}
        className={`absolute inset-x-0 bottom-full transition-all duration-200 ease-out ${
          open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
        }`}
      >
          {/*
            pb-[26px]: the row sits a little lower than it first did. The cross
            button is raised 32px above the bar, so the cards' lower edge comes
            within a few pixels of its top — close, but the owner asked for the
            row to sit lower and the two do not actually touch.

            ⚠️ **Five cards have to fit a 320px screen without a second row.**
            The row is full-bleed and its cards share the available width
            equally (`flex-1 basis-0`), rather than being pinned to `w-14`:
            - 320px: 2×8px side padding + 4×4px gaps → each card 57.6px.
            - 360px and up: side padding 12px, gaps 6px.
            - 420px and up: side padding 16px, gaps 8px.
            - `sm` (≥640px): the existing `max-w-md` cap and 24px/12px rhythm.

            ⚠️ **The caption shortens only below the existing 420px step.**
            Four-character captions have 44px of text; at 320px a 57.6px card
            would leave only 6.8px on each side, which is the cramped edge the
            owner rejected. Below 420px the five cards therefore show 粘贴 /
            语音 / 手动 / 拍照 / 导入, and from 420px up they show the full
            粘贴识别 / 语音记账 / 手动记账 / 拍照识别 / 导入账单. The full
            labels at 420px have ≥13.6px of breathing room. This reuses the
            row's existing 420px breakpoint rather than inventing a second one.

            The short caption is visual only: `aria-label` on every card stays
            the full name, so the accessible name does not change with width.
          */}
          <ul className="mx-auto flex w-full max-w-md items-end justify-center gap-1 px-2 pb-[26px] min-[360px]:gap-1.5 min-[360px]:px-3 min-[420px]:gap-2 min-[420px]:px-4 sm:gap-3 sm:px-6">
            {ENTRY_ACTIONS.map((action) => {
              const shape =
                "flex w-full min-w-0 flex-col items-center gap-0.5 rounded-2xl bg-brand-soft px-1 py-2 text-brand-dark shadow-sm transition sm:px-2";
              /**
               * The visible caption switches at the same 420px breakpoint that
               * widens the row. ⚠️ **The short text is visual only** — `spoken`
               * below is always the full name, and it is what `aria-label`
               * carries on every link/button.
               */
              const caption = "whitespace-nowrap text-micro";
              const spoken = action.ariaLabel ?? action.label;
              const captionText = (
                <span aria-hidden="true" className={caption}>
                  <span className="min-[420px]:hidden">{action.shortLabel}</span>
                  <span className="hidden min-[420px]:inline">{action.label}</span>
                </span>
              );

              /**
               * ⚠️ **S14-C: 语音 and 拍照 are server-side capabilities** (transcription and screenshot
               * recognition run on the API). A guest has no account to send them with, so the cards
               * are disabled with a natural reason instead of leading to a login screen or, worse,
               * pretending to work. 手动 stays live — it is the local form and the whole point of
               * guest mode.
               *
               * ⚠️ **导入账单 is behind the same gate**, and for the same reason: `/import` is a
               * server write scoped to a real account ledger. A guest pressing it would be bounced
               * to `/login`, which is exactly the dead end these cards avoid.
               */
              if (guest && action.label !== "手动记账") {
                return (
                  <li key={action.label} className="min-w-0 flex-1 basis-0">
                    <button
                      type="button"
                      disabled
                      tabIndex={open ? 0 : -1}
                      aria-label={`${spoken}，需要正式账号`}
                      className={`${shape} opacity-55`}
                    >
                      {action.icon}
                      {captionText}
                    </button>
                  </li>
                );
              }

              /**
               * The camera card: opens the picker, then hands the pictures over.
               *
               * ⚠️ **The click is made from inside the tap handler, and that is
               * not a detail.** A browser only opens a file picker when the call
               * happens during a user gesture — so a screen cannot "open the
               * picker on mount", which is what the owner first imagined. Calling
               * it here, synchronously, works; the navigation happens afterwards
               * in the change handler.
               *
               * Why a programmatic `.click()` on a hidden input rather than a
               * `<label>` wrapping one: a label would submit the tap to the
               * input and leave no room to be told *whether anything happened*.
               * Going through the handler means the fallback — a tap that
               * opened nothing — can be recognised and the user sent to the
               * screen that has a visible button.
               */
              if (action.picksImages === true && onPickImages !== undefined) {
                return (
                  <li key={action.label} className="min-w-0 flex-1 basis-0">
                    <button
                      type="button"
                      tabIndex={open ? 0 : -1}
                      aria-label={spoken}
                      onClick={() => {
                        pickerRef.current?.click();
                      }}
                      className={`${shape} active:bg-brand-soft/70`}
                    >
                      {action.icon}
                      {captionText}
                    </button>
                  </li>
                );
              }

              // A real link, not a button that calls navigate(). If the router's
              // own navigation ever fails, an <a href> still works — the browser
              // does it — and it can be long-pressed and copied, which a button
              // cannot.
              if (action.to !== undefined) {
                return (
                  <li key={action.label} className="min-w-0 flex-1 basis-0">
                    <Link
                      to={action.to}
                      tabIndex={open ? 0 : -1}
                      aria-label={spoken}
                      className={`${shape} active:bg-brand-soft/70`}
                    >
                      {action.icon}
                      {captionText}
                    </Link>
                  </li>
                );
              }

              return (
                <li key={action.label} className="min-w-0 flex-1 basis-0">
                  <button
                    type="button"
                    disabled
                    tabIndex={open ? 0 : -1}
                    aria-label={`${spoken}，${action.hint ?? "即将开放"}`}
                    className={`${shape} opacity-60`}
                  >
                    {action.icon}
                    {captionText}
                  </button>
                </li>
              );
            })}
          </ul>
      </div>

      <ul className="mx-auto flex w-full max-w-md items-end justify-around px-2">
        {TABS.map((tab) => {
          const isActive = tab.to === active;
          /**
           * ⚠️ **S14-C: the fourth tab is the guest's own ledger, not the collaboration page.**
           * `/ledger` is account-only (members, invitations, history) and sending a guest there
           * would dump them on the login screen from a tab they can always see. The local ledger
           * space is the honest destination: it is where a guest's one ledger lives.
           */
          const destination = guest && tab.to === "/ledger" ? "/start" : tab.to;
          const Icon = tab.icon;
          /**
           * ⚠️ **The fourth label is resolved here, from the ledger already in the query cache.**
           * `useLedger` is TanStack Query, so the ledger screen's own fetch is shared rather than
           * repeated — the bar costs no extra request.
           */
          const label = tab.labelFromMembers === true ? ledgerTabLabel(ledger.data?.book.memberCount) : tab.label;

          if (tab.primary === true) {
            return (
              <li key={tab.to} className="flex-1">
                {/*
                  Raised well above the bar and ringed in the bar's own colour,
                  so it reads as the one deliberate action rather than a fifth
                  destination.

                  It is always a switch now. See `EntryCards` above for why that
                  reversal happened.
                */}
                <button
                  type="button"
                  onClick={cards.onToggle}
                  aria-expanded={open}
                  aria-label={open ? "收起记账方式" : "展开记账方式"}
                  className="mx-auto -mt-8 mb-2 flex size-16 items-center justify-center rounded-full bg-brand text-white shadow-lg ring-4 ring-surface transition hover:bg-brand-dark"
                >
                  <PlusIcon
                    className={`size-8 transition-transform duration-200 ease-out ${
                      open ? "rotate-45" : "rotate-0"
                    }`}
                  />
                </button>
              </li>
            );
          }

          return (
            <li key={tab.to} className="flex-1">
              <button
                type="button"
                onClick={() => {
                  onNavigate(destination);
                }}
                aria-current={isActive ? "page" : undefined}
                className={`flex w-full flex-col items-center gap-1 py-2.5 text-micro transition ${
                  isActive ? "text-brand-dark" : "text-muted"
                }`}
              >
                <Icon className="size-6" />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
