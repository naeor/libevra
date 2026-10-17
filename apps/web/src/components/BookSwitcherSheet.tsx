import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { SkeletonRows } from "./States.js";
import { errorMessage } from "../lib/api.js";
import { useBooks, useCurrentBookId, type BookSummary } from "../lib/queries.js";

/**
 * **换一本"正在看/正在管"的账本 —— 只换地址栏里的 bookId。**
 *
 * ⚠️ **This sheet is the answer to one question the owner asked twice** (S13-E):
 * *"账本详情顶部可以切换查看目标；账本设置里也可以切换管理目标"* — and the same sentence always
 * carried the restriction: **"切换只更新 URL 的 bookId，不调用 enterLedger、不改全局当前账本"**.
 *
 * ⚠️ **So `onSelect` hands the id back to the page, and the page navigates.** This component never
 * calls `useActivateBook`, never writes `currentBook`, and never touches the offline scope. The
 * ledger a person is *in* is a different fact from the ledger they are *looking at* — 1.10.08 drew
 * that line, and the whole point of `/books/:bookId` is that it can be looked at without entering it.
 *
 * ⚠️ **The overlay, the panel, the drag and the keyboard rules are `BookManageSheet`'s, not a third
 * spec.** The markup below repeats that component's classes deliberately: it is the same bottom
 * sheet, and a second set of paddings or a second entry animation is exactly how two panels start
 * to look like two products. (The behaviour cannot be shared by import without lifting half of that
 * component out; the class strings are the part that must not drift, so they are identical here.)
 *
 * ⚠️ **Picking the ledger you are already looking at closes the sheet and sends no request.** "Go to
 * where I am" is not a navigation, and a redundant visit would only add a cache miss to a screen
 * that is already correct.
 */

/** What the sheet is switching — the two pages that use it differ only in this word. */
export type BookSwitcherPurpose = "view" | "manage";

/**
 * ⚠️ **The sentence is the safety feature, so it says the same thing in both modes apart from the
 * verb.** Every reviewer of this screen asked one question — *"this changes my current ledger,
 * right?"* — and the answer is no.
 */
const HINTS: Record<BookSwitcherPurpose, string> = {
  view: "此处只切换正在查看的账本，不会更改当前记账账本。",
  manage: "此处只切换正在管理的账本，不会更改当前记账账本。",
};

export function BookSwitcherSheet({
  open,
  currentTargetId,
  purpose,
  onSelect,
  onClose,
}: {
  readonly open: boolean;
  /** The `bookId` in the address bar right now — ticked in the list, and a no-op when picked. */
  readonly currentTargetId: string;
  readonly purpose: BookSwitcherPurpose;
  readonly onSelect: (bookId: string) => void;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const books = useBooks();
  /**
   * ⚠️ **Read from the device's own memory, never from `useLedger()`** — this sheet lives on the
   * target-ledger screens, and asking for the current ledger's metadata there is the silent switch
   * the whole design exists to prevent. `useCurrentBookId` is a label, not a request.
   */
  const currentBookId = useCurrentBookId();

  /** ⚠️ Live drag offset, so the sheet follows the finger rather than only reacting at the end. */
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, [open]);

  /** ⚠️ `Escape` closes it, and `Tab` stays inside — the same rules as the management sheet. */
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const buttons = [...(sheetRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled), a[href]") ?? [])];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, open]);

  /** ⚠️ The page behind is frozen while the sheet is open — same reason as the management sheet. */
  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const list = books.data?.books ?? [];
  const targetMissing = books.isSuccess && list.length > 0 && !list.some((book) => book.id === currentTargetId);

  function choose(bookId: string): void {
    if (bookId === currentTargetId) {
      onClose();
      return;
    }
    onSelect(bookId);
  }

  return (
    <>
      {/* ⚠️ `aria-hidden` and closing on tap: a dismissal affordance, not content — same as `BookManageSheet`. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-overlay-soft backdrop-in"
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="选择账本"
        onTouchStart={(event) => {
          startY.current = (event.target as HTMLElement).closest("[data-sheet-drag]") ? event.touches[0]?.clientY ?? null : null;
        }}
        onTouchMove={(event) => {
          if (startY.current === null) return;
          const dy = (event.touches[0]?.clientY ?? startY.current) - startY.current;
          /** ⚠️ Downward only: pulling *up* must not lift the sheet off the bottom edge. */
          setDragY(Math.max(0, dy));
        }}
        onTouchEnd={() => {
          if (dragY > 90) onClose();
          setDragY(0);
          startY.current = null;
        }}
        style={dragY === 0 ? undefined : { transform: `translateY(${String(dragY)}px)` }}
        className={`fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-t-sheet border border-line bg-surface pb-[env(safe-area-inset-bottom,0px)] shadow-sheet ${
          dragY === 0 ? "sheet-in" : ""
        }`}
      >
        {/* ⚠️ The drag handle — the same one the management sheet has, and the only thing that says "this slides". */}
        <div data-sheet-drag className="flex justify-center pt-3 pb-1">
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line" />
        </div>

        <div data-sheet-drag className="flex items-center justify-between gap-3 px-5 pt-2 pb-1">
          <h2 className="text-base font-medium text-ink">选择账本</h2>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭账本列表"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-canvas hover:text-ink"
          >
            <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* ⚠️ The grey sentence: what this list does *not* do. */}
        <p className="px-5 pb-3 text-helper-relaxed text-muted">{HINTS[purpose]}</p>

        {books.isPending ? <SkeletonRows rows={3} /> : null}

        {books.isError ? (
          <div className="flex flex-col gap-3 px-5 py-4">
            <p role="alert" className="text-body-relaxed text-danger">
              读不到账本列表：{errorMessage(books.error)}
            </p>
            <button
              type="button"
              onClick={() => {
                void books.refetch();
              }}
              className="self-start rounded-field bg-brand-soft px-4 py-2.5 text-sm font-medium text-brand-dark transition hover:bg-brand-soft/70"
            >
              重试
            </button>
          </div>
        ) : null}

        {books.isSuccess && list.length === 0 ? (
          <div className="flex flex-col gap-3 px-5 py-4">
            <p className="text-body-relaxed text-muted">这个账号下还没有可切换的账本。</p>
            <Link
              to="/start"
              onClick={onClose}
              className="self-start rounded-field bg-brand-soft px-4 py-2.5 text-sm font-medium text-brand-dark transition hover:bg-brand-soft/70"
            >
              去账本空间
            </Link>
          </div>
        ) : null}

        {/**
          * ⚠️ **A target that is not in the list is stated, not guessed at.** It happens when a book
          * is disposed (or the reader is removed from it) and this screen was still open in another
          * tab. Silently ticking nothing would look like a rendering bug; ticking the *current*
          * ledger would be the fallback the owner forbade.
          */}
        {targetMissing ? (
          <p className="mx-5 mb-3 rounded-field bg-warn-soft px-4 py-3 text-helper-relaxed text-warn-dark">
            正在查看的这本账已不在列表里：它可能已被弃置，或者你已经不在其中。
          </p>
        ) : null}

        {list.length > 0 ? (
          <ul className="border-t border-line">
            {list.map((book) => (
              <li key={book.id}>
                <BookRow
                  book={book}
                  selected={book.id === currentTargetId}
                  isCurrentAccounting={book.id === currentBookId}
                  onSelect={() => {
                    choose(book.id);
                  }}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}

/**
 * **The identity strip at the top of 账本详情 / 账本设置 — and the whole strip is the switch.**
 *
 * ⚠️ **It lives beside the sheet rather than in either page, and that is the point**: the two pages
 * differ in one word (`caption`: 「正在管理」 on settings, nothing on the read-only screen) and must
 * otherwise agree to the pixel. Two hand-written copies of "name · number · member count + 切换"
 * is how the two screens start drifting apart — the same argument `TabPageHeader` was created for.
 *
 * ⚠️ **One button, not a block with a button in it.** The owner asked for *"右侧「切换」按钮整块可点"*;
 * nesting a button inside a clickable block would put two controls on one target and break the
 * keyboard (a `<button>` inside a `<button>` is invalid HTML).
 *
 * ⚠️ **The 「当前记账账本」 tag is a statement, never a suggestion.** It comes from the device's own
 * memory of the ledger (`useCurrentBookId`), so this component cannot change that fact by being
 * rendered — which is the whole property the target-ledger screens depend on.
 */
export function BookIdentityCard({
  bookId,
  name,
  bookNumber,
  memberCount,
  caption,
  onSwitch,
}: {
  readonly bookId: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly memberCount: number | undefined;
  /** 「正在管理」 on 账本设置; omitted on 账本详情, where nothing is being managed yet. */
  readonly caption?: string;
  readonly onSwitch: () => void;
}): React.JSX.Element {
  const currentBookId = useCurrentBookId();
  const isCurrentAccounting = bookId === currentBookId;

  return (
    <button
      type="button"
      onClick={onSwitch}
      className="flex w-full items-center justify-between gap-4 rounded-card border border-line bg-surface px-5 py-4 text-left transition hover:bg-canvas"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        {caption === undefined ? null : <span className="text-helper text-muted">{caption}</span>}
        <span className="truncate text-base font-medium text-ink">{name}</span>
        <span className="flex flex-wrap items-center gap-2 text-helper text-muted">
          <span className="font-mono">{bookNumber ?? "（未分配编号）"}</span>
          {memberCount === undefined ? null : (
            <>
              <span>·</span>
              <span>{String(memberCount)} 人</span>
            </>
          )}
          {isCurrentAccounting ? (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-micro text-brand-dark">当前记账账本</span>
          ) : null}
        </span>
      </span>

      <span className="shrink-0 rounded-field bg-brand-soft px-3 py-1.5 text-helper text-brand-dark">切换</span>
    </button>
  );
}

/** One ledger in the list: name, number, member count, and what it means here. */
function BookRow({
  book,
  selected,
  isCurrentAccounting,
  onSelect,
}: {
  readonly book: BookSummary;
  /** ⚠️ The one named in the address bar — ticked, and picking it is a no-op. */
  readonly selected: boolean;
  /** ⚠️ The one this device is *in* — a neutral label, never a suggestion to switch. */
  readonly isCurrentAccounting: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-14 w-full items-center gap-3 border-b border-line px-5 py-3 text-left transition last:border-b-0 hover:bg-canvas ${
        selected ? "bg-brand-soft/50" : ""
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body text-ink">{book.name}</span>
        <span className="flex flex-wrap items-center gap-2 text-helper text-muted">
          <span className="font-mono">{book.bookNumber ?? "（未分配编号）"}</span>
          <span>·</span>
          <span>{String(book.memberCount)} 人</span>
          {/**
            * ⚠️ **A word, not only a colour, and not only a tick** — the same rule the management
            * sheet follows for its 「当前」 badge. It says what the ledger *is* (where entries go),
            * which is a different fact from what this sheet is about (what is on screen).
            */}
          {isCurrentAccounting ? (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-micro text-brand-dark">当前记账账本</span>
          ) : null}
        </span>
      </span>

      <span className="flex size-6 shrink-0 items-center justify-center text-brand" aria-hidden="true">
        {selected ? (
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m4.5 12.5 5 5 10-11" />
          </svg>
        ) : null}
      </span>
    </button>
  );
}
