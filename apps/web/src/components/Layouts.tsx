import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";

import { CurrentBookCaption } from "./CurrentBookCaption.js";
import { BottomNav, type EntryCards } from "./BottomNav.js";
import { GuestModeBadge } from "./GuestModeBadge.js";
import { ChevronIcon } from "./Icons.js";
import { GuestWelcome } from "./GuestWelcome.js";
import { OfflineStatus } from "./OfflineStatus.js";
import { SyncBanner } from "./SyncBanner.js";
import { useGoBack, type BackMode } from "../lib/connectivity.js";
import { useI18n } from "../i18n/index.js";
import { WorkbenchSyncBridge } from "../statsWorkbench/SyncBridge.js";

/**
 * Whether the entry cards are open, and who may close them.
 *
 * **The owner's design goal, in his words**: recording should be startable from
 * as many screens as possible. The three ways to record — voice, by hand, by
 * photograph — have nowhere else to live, so the centre button unfolds them
 * wherever the reader happens to be.
 *
 * This used to be local state inside each frame, which made every tab its own
 * island: the analysis screen could not close a menu the ledger had opened, and
 * nothing could close a menu on navigation. One piece of state for the whole app
 * is what makes "open anywhere, closed when you move on" expressible.
 *
 * The state lives in context rather than in the router, deliberately: it is
 * *interface* state, it should not survive a reload, and it should not appear in
 * a URL somebody can share.
 */
interface EntryMenuValue {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly close: () => void;
}

const EntryMenuContext = createContext<EntryMenuValue>({
  open: false,
  toggle: () => undefined,
  close: () => undefined,
});

/** For a screen that wants to close the menu itself — the ledger, on scrolling. */
export function useEntryMenu(): EntryMenuValue {
  return useContext(EntryMenuContext);
}

/**
 * What happens to the menu, as a pure function.
 *
 * A pure function so the rule can be *tested* rather than described: the
 * behaviour lives in a `useEffect` that a test without a DOM cannot reach, and a
 * rule that is only asserted in a comment is a rule that drifts.
 *
 *  * **Pressing the button always unfolds the options.** Never a jump to
 *    the manual form: somebody who wanted the camera would have had to open the
 *    menu anyway, so the jump only ever cost them a press.
 *  * **Arriving at any screen folds them**, so a page starts with its own
 *    content rather than with a menu somebody opened for a different one. The
 *    ledger is not an exception at the moment of arrival; it only differs in
 *    *when* it folds — see the third case.
 *  * **Scrolling down into the ledger's list folds them**, because the summary
 *    has just collapsed to give the entries room and an open menu would spend
 *    exactly what was won. This is a fold within a screen rather than on
 *    arrival, which is why it is a separate event.
 */
export type MenuEvent =
  | { readonly type: "toggle" }
  | { readonly type: "arrivedSomewhere" }
  | { readonly type: "scrolledIntoList" };

export function menuAfter(open: boolean, event: MenuEvent): boolean {
  switch (event.type) {
    case "toggle":
      return !open;
    case "arrivedSomewhere":
    case "scrolledIntoList":
      return false;
  }
}

/**
 * Holds the menu for every tab, and folds it when the reader moves on.
 */
export function AppShell({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // The pathname *after* the first render. Comparing against it means the fold
  // cannot fire for the page the reader is already on when the app starts —
  // otherwise a reload of the ledger would arrive with its menu already shut.
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current !== pathname) {
      previous.current = pathname;
      setOpen((current) => menuAfter(current, { type: "arrivedSomewhere" }));
    }
  }, [pathname]);

  const value = useMemo<EntryMenuValue>(
    () => ({
      open,
      toggle: () => {
        setOpen((current) => menuAfter(current, { type: "toggle" }));
      },
      close: () => {
        setOpen((current) => menuAfter(current, { type: "scrolledIntoList" }));
      },
    }),
    [open],
  );

  return (
    <EntryMenuContext.Provider value={value}>
      <WorkbenchSyncBridge>
      {children}
      <GuestWelcome />
      </WorkbenchSyncBridge>
    </EntryMenuContext.Provider>
  );
}

/**
 * Frame for the five tab destinations.
 *
 * The height is the **dynamic** viewport height and only the middle region
 * scrolls, so the navigation bar is a flex sibling of the content rather than
 * something pinned to the bottom of the document. That matters on a phone:
 * with a document-scrolling layout, iOS Safari expands its own toolbar as soon
 * as you scroll up and the app's navigation disappears underneath it, so the
 * user has to scroll back down to reach the tabs. With the page itself never
 * scrolling, there is nothing for that toolbar to react to.
 *
 * **Every tab gets the three recording options and 导入账单.** That is the owner's design
 * goal rather than an oversight: recording should be startable from wherever the
 * reader is, and the camera and voice routes have no other home. What a tab does
 * *not* get is the menu left open behind it — see `AppShell`.
 */
export function TabPage({
  active,
  onNavigate,
  children,
  className = "",
  scrollRef,
  rootRef,
  rootClassName = "",
  currentBookName,
  bottom,
}: {
  readonly active: string;
  readonly onNavigate: (to: string) => void;
  readonly children: React.ReactNode;
  readonly className?: string;
  /**
   * Exposed so a screen can follow its own scroll position. Only the ledger
   * needs it — it is the one screen whose layout changes as the reader moves.
   */
  readonly scrollRef?: React.RefObject<HTMLDivElement | null>;
  /** The outermost element, for a screen that drives its own animation. */
  readonly rootRef?: React.RefObject<HTMLDivElement | null>;
  readonly rootClassName?: string;
  readonly currentBookName?: string | undefined;
  /**
   * ⚠️ **S17：只有分析工作台的布局编辑态会传它。** 编辑态下底部换成卡片抽屉（草图第三屏），
   * 主导航暂时让位——既给抽屉留出空间，也避免在未保存的编辑中途误点到别的 Tab。
   * 不传时（所有其它页面，以及分析页的浏览态）与以前完全一样。
   */
  readonly bottom?: React.ReactNode;
}): React.JSX.Element {
  const menu = useEntryMenu();

  if (bottom !== undefined) {
    return (
      <div ref={rootRef} className={`relative flex h-dvh flex-col overflow-hidden ${rootClassName}`}>
        <SyncBanner />
        <OfflineStatus />
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
          {/* 固定保留展开抽屉的空间；抽屉动画不改变滚动视口和拖放命中坐标。 */}
          <div className={`mx-auto flex w-full max-w-md flex-col pb-[calc(min(48dvh,27rem)+1.5rem)] ${className}`}>{children}</div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 [&>*]:pointer-events-auto">{bottom}</div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`flex h-dvh flex-col overflow-hidden ${rootClassName}`}>
      <SyncBanner />
      <OfflineStatus />

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        {/* pb-24 leaves room for the raised entry button, which reaches up
            above the bar and would otherwise cover the last row of a list. */}
        <div className={`mx-auto flex w-full max-w-md flex-col pb-24 ${className}`}>{children}</div>
      </div>

      <CurrentBookCaption name={currentBookName} hidden={menu.open} />
      {/*
        Real space for the cards, not a floating layer over the list.
        The scroll region shrinks by this much while they are out, so nothing
        ever passes behind them — they are in the layout rather than on top of
        it. Animating the height keeps the list from jumping as they fold away.
      */}
      <div
        aria-hidden="true"
        className={`shrink-0 transition-[height] duration-200 ease-out ${
          menu.open ? "h-[100px]" : "h-0"
        }`}
      />

      <BottomNav
        active={active}
        onNavigate={onNavigate}
        cards={{ mode: "toggle", expanded: menu.open, active: false, onToggle: menu.toggle }}
      />
    </div>
  );
}
/**
 * Frame for screens reached *from* a tab: back control at the top, no bottom
 * bar, because a form is a place you leave, not a place you switch away from.
 *
 * Back always returns to the screen the user actually came from. The same
 * management screen can be opened from more than one place, so a fixed parent
 * would send somebody somewhere they had never been — which reads as a bug even
 * though nothing is broken. `backTo` is only the fallback for a deep link that
 * has no history behind it.
 *
 * ⚠️ **`backMode="parent"` is the opt-out, and only 账本设置 / 账本导入 use it** (S15-C 第四轮). 设置's
 * parent never changes; asking history meant 设置 could point back at 导出, and the pair walked a circle.
 * 导出 itself stays on history on purpose: it is a leaf pushed from 设置, so `-1` returns there and
 * consumes its own entry — giving it a declared parent was the first version's second loop.
 * **`parent` no longer means "replace 掉自己"**: replace kept the entry alive under the next screen
 * (导入 返回 → 设置 → 详情, whose `-1` fell back into 导入). It now pops its own entry when there is
 * history, and only a deep link falls back to `backTo` — see `useGoBack`. **The default stays
 * `history`, so every other screen behaves exactly as before.**
 */
export function InnerPage({
  title,
  subtitle,
  backTo = "/",
  backMode = "history",
  onBack,
  actions,
  children,
}: {
  readonly title: string;
  /**
   * ⚠️ **S16-A: optional and short.** A subtitle names the *context* of the page (which ledger, which
   * version) in one line. An explanation of how the page works belongs next to the thing it explains —
   * as a footnote under a list or a hint under a field — not between the title and the first control,
   * where it pushes the page's actual job below the fold.
   */
  readonly subtitle?: string;
  readonly backTo?: string;
  /**
   * ⚠️ **`history` unless a screen says otherwise.** See `useGoBack` in `lib/connectivity.ts`.
   */
  readonly backMode?: BackMode;
  /** Used when a screen must finish something before it leaves. */
  readonly onBack?: () => void;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const goBack = useGoBack(backTo, backMode);
  const handleBack = onBack ?? goBack;
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const condensed = useTitleScrolledAway(titleRef);

  return (
    /**
     * ⚠️ **The wrapper exists for `position: sticky`.** A sticky element only sticks inside its own
     * parent; `#root` is exactly one viewport tall, so a navigation bar placed directly in it would
     * scroll away after the first screen. `min-h-full` + growing with the content gives the bar a
     * parent as tall as the page.
     */
    <div className="flex min-h-full flex-col">
      {/*
        ⚠️ **Both banners, on every framed screen.**

        The owner reported that the download notice appeared on the analysis and account
        screens but not on the ledger: "它只会在分析和账户页面出现，在明细页面则不会弹
        出——应该所有页面都有的."

        He was right, and the cause was structural rather than logical. `OfflineStatus`
        lived only in `TabPage`, and **the ledger builds its own frame** — it owns its
        scroll position and its own animation, so it does not use `TabPage` at all. The
        screens he saw it on were the ones that do.

        A notice about the *device's* storage has nothing to do with which frame a screen
        chose, so it belongs beside every frame rather than inside one of them.
      */}
      <OfflineStatus />

      <PageNavBar title={title} condensed={condensed} onBack={handleBack} actions={actions}>
        {/* ⚠️ The offline banner is itself `sticky top-0`; inside the bar's sticky group it stays
            pinned *with* the bar instead of being covered by it. */}
        <SyncBanner />
      </PageNavBar>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 pt-1 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))]">
        <header>
          <h1 ref={titleRef} className="flex items-center gap-2 text-page-title text-ink">
            {title}
            <GuestModeBadge />
          </h1>
          {subtitle ? <p className="mt-1 text-body-relaxed text-muted">{subtitle}</p> : null}
        </header>

        {children}
      </main>
    </div>
  );
}

/**
 * **S16-A: the one top bar every secondary screen shares.**
 *
 * ⚠️ **Why it is sticky.** The back control used to scroll away with the page, so on a long list
 * (编辑历史、更新公告、下载管理) the only way out was to scroll all the way back up. The owner asked
 * for the back entry to stay visible while scrolling, at the top left, without costing first-screen
 * height — **so the bar is 48px, and the large title below it is not repeated until it has scrolled
 * under the bar.** Then the bar shows the title in small type and a hairline, the way a phone's own
 * settings screens do.
 *
 * ⚠️ **The back control keeps `data-back-control`** — tests and the E2E scripts find it by that name.
 *
 * ⚠️ **Safe area**: `index.html` sets `viewport-fit=cover`, so in an installed PWA the page runs under
 * the status bar. The bar pads itself by `safe-area-inset-top` (zero in a normal browser tab).
 *
 * ⚠️ **Right-hand actions keep their own slot** and never overlap the centred title: the title is
 * inset from both sides and truncates.
 */
function PageNavBar({
  title,
  condensed,
  onBack,
  actions,
  children,
}: {
  readonly title: string;
  readonly condensed: boolean;
  readonly onBack: () => void;
  readonly actions?: React.ReactNode;
  /** Pinned above the bar inside the same sticky group (the offline banner). */
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div
      data-page-nav
      data-condensed={condensed ? "true" : "false"}
      className={`sticky top-0 z-30 border-b pt-[env(safe-area-inset-top,0px)] transition-[background-color,border-color] duration-200 ${
        condensed ? "border-line bg-canvas/90 backdrop-blur-md" : "border-transparent bg-canvas"
      }`}
    >
      {children}
      <nav aria-label={t("nav.page.nav")} className="relative mx-auto flex h-12 w-full max-w-md items-center justify-between gap-3 px-6">
        {/* Deliberately generous: this is the control a thumb reaches for on a phone, and a small
            target means missed taps. 44px high, and the chevron sits on the content's 24px edge. */}
        <button
          type="button"
          data-back-control
          onClick={onBack}
          className="-ml-3 flex h-11 shrink-0 items-center gap-1 rounded-field pr-3 pl-2 text-base text-brand-dark transition hover:bg-brand-soft active:bg-brand-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
        >
          <ChevronIcon direction="left" className="size-5" />
          {t("nav.page.back")}
        </button>

        <p
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-24 truncate text-center text-section-title text-ink transition-opacity duration-200 ${
            condensed ? "opacity-100" : "opacity-0"
          }`}
        >
          {title}
        </p>

        {actions === undefined || actions === null ? null : (
          <div className="relative flex shrink-0 items-center gap-1">{actions}</div>
        )}
      </nav>
    </div>
  );
}

/**
 * Whether the page's large title has scrolled up under the navigation bar.
 *
 * ⚠️ **An observer, not a scroll listener**: it costs nothing while scrolling and it answers the only
 * question the bar has — "is the big title still visible?". The top margin is the bar's own height,
 * so the small title appears exactly when the large one goes under the bar, not when it leaves the
 * screen. Where `IntersectionObserver` is missing (tests, very old browsers) the bar simply never
 * condenses, which is the pre-S16 look.
 */
function useTitleScrolledAway(ref: React.RefObject<HTMLElement | null>): boolean {
  const [away, setAway] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry === undefined) return;
        setAway(!entry.isIntersecting && entry.boundingClientRect.top < 64);
      },
      { rootMargin: "-56px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return away;
}
