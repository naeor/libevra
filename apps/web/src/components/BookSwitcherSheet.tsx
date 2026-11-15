import { Link, useNavigate } from "react-router";

import { BottomSheet } from "./BottomSheet.js";
import { ChevronIcon } from "./Icons.js";
import { SelectionItem } from "./ui/SelectionControls.js";
import { SkeletonRows } from "./States.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { onPlainClick } from "../lib/entryReturn.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useBooks, useCurrentBookId, type BookSummary } from "../lib/queries.js";

/**
 * **账本列表选择面板。查看／管理入口只换目标，手机当前账本入口由调用方激活。**
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
 * ⚠️ **外壳是弹出面板模板（1.19.58）**：与管理面板同一个 `BottomSheet`（材质、退场、滚动锁、下拉手势），
 * 保留原有固定半屏列表；账本选择、激活与权限判断都不搬进通用外壳。
 *
 * ⚠️ **Picking the ledger you are already looking at closes the sheet and sends no request.** "Go to
 * where I am" is not a navigation, and a redundant visit would only add a cache miss to a screen
 * that is already correct.
 */

/** 选择目的决定提示文案；实际导航与激活均由调用方处理。 */
export type BookSwitcherPurpose = "view" | "manage" | "activate";

/*
 * 提示必须区分查看／管理与激活，避免用户误认为查看其他账本会改变记账目标。
 * 文案位于 `books.switcher.hint.<purpose>`。
 */

export function BookSwitcherSheet({
  open,
  currentTargetId,
  purpose,
  onSelect,
  onClose,
  footer,
}: {
  readonly open: boolean;
  /** The `bookId` in the address bar right now — ticked in the list, and a no-op when picked. */
  readonly currentTargetId: string;
  readonly purpose: BookSwitcherPurpose;
  readonly onSelect: (bookId: string) => void;
  readonly onClose: () => void;
  readonly footer?: React.ReactNode;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const navigate = useNavigate();
  const books = useBooks();
  /**
   * ⚠️ **Read from the device's own memory, never from `useLedger()`** — this sheet lives on the
   * target-ledger screens, and asking for the current ledger's metadata there is the silent switch
   * the whole design exists to prevent. `useCurrentBookId` is a label, not a request.
   */
  const currentBookId = useCurrentBookId();

  if (!open) return null;

  const list = books.data?.books ?? [];
  const targetMissing = books.isSuccess && list.length > 0 && !list.some((book) => book.id === currentTargetId);

  return (
    /**
     * ⚠️ **A stable, usable height, not a height decided by how many ledgers exist.**
     *
     * With two ledgers the content-driven sheet collapsed to a narrow strip; on a phone that
     * meant aiming at a small target near the bottom edge. The owner asked for roughly
     * 45–55% of the visible viewport — the template's fixed half detent (`half-fixed`,
     * `clamp(18rem, 52dvh, 34rem)`) keeps a 288px floor on very short screens and caps itself on a
     * tall desktop. Only the list scrolls (the template's body), so the drag handle, title, close
     * button and the grey sentence stay put while the list moves.
     *
     * 弹出面板模板（1.19.58）：拖动条、标题行、×、下拉关闭、焦点与 Esc 都由 `BottomSheet` 负责；
     * 宽屏下仍一直贴底（`wide="bottom"`），与原来相同。选择、查看与激活的语义没有动。
     */
    <BottomSheet
      label={t("books.switcher.title")}
      title={t("books.switcher.title")}
      /* ⚠️ The grey sentence: what this list does *not* do. */
      description={t(`books.switcher.hint.${purpose}`)}
      detent="half-fixed"
      wide="bottom"
      initialFocus={(panel) => panel.querySelector<HTMLButtonElement>("button")}
      footer={footer}
      onClose={onClose}
    >
      {(requestClose, sheet) => {
        function choose(bookId: string): void {
          if (bookId === currentTargetId) {
            requestClose();
            return;
          }
          onSelect(bookId);
        }

        return (
          <>
            {books.isPending ? <SkeletonRows rows={3} /> : null}

            {books.isError ? (
              <div className="flex flex-col gap-3 px-5 py-4">
                <p role="alert" className="text-body-relaxed text-danger">
                  {t("books.switcher.loadFailed", { error: errorMessage(books.error) })}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void books.refetch();
                  }}
                  className="self-start rounded-field bg-brand-soft px-4 py-2.5 text-sm font-medium text-brand-dark transition hover:bg-brand/20"
                >
                  {t("nav.state.retry")}
                </button>
              </div>
            ) : null}

            {books.isSuccess && list.length === 0 ? (
              <div className="flex flex-col gap-3 px-5 py-4">
                <p className="text-body-relaxed text-muted">{t("books.switcher.empty")}</p>
                {/* 1.19.75（审查 T7）：先播放面板退场再进入账本空间（与账本管理面板同一做法）；导航那一刻面板还开着时，
                    协调器会当作“有弹窗”而不播放海浪。按住修饰键 / 中键仍按链接打开。 */}
                <Link
                  to="/start"
                  onClick={(event) => {
                    onPlainClick(() => { sheet.closeThen(() => { onClose(); void navigate("/start"); }); })(event);
                    if (!event.defaultPrevented) onClose();
                  }}
                  className="self-start rounded-field bg-brand-soft px-4 py-2.5 text-sm font-medium text-brand-dark transition hover:bg-brand/20"
                >
                  {t("books.goToSpace")}
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
                {t("books.switcher.targetMissing")}
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
          </>
        );
      }}
    </BottomSheet>
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
 *
 * ⚠️ **`onRename` is the one thing 账本设置 adds, and it is optional so 账本详情 does not change**
 * (S15-C). The owner's complaint was that the name and the number each appeared twice on 账本设置:
 * once in this card, once in the 「账本资料」 block below it. The block is gone; **the way to change
 * the name moved into this card instead.**
 *
 * ⚠️ **Why the rename entry is a row under the card, not a control inside it.** The card is a
 * `<button>` — the owner's *"右侧「切换」按钮整块可点"* — and a `<button>` inside a `<button>` is
 * invalid HTML, breaks keyboard order, and makes one tap fire two actions. With `onRename` the card
 * becomes a container of two rows (switch, rename); **without it the markup is the single button it
 * always was**, so the read-only screen is untouched.
 */
export function BookIdentityCard({
  bookId,
  name,
  bookNumber,
  memberCount,
  caption,
  onSwitch,
  onRename,
}: {
  readonly bookId: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly memberCount: number | undefined;
  /** 「正在管理」 on 账本设置; omitted on 账本详情, where nothing is being managed yet. */
  readonly caption?: string;
  readonly onSwitch: () => void;
  /**
   * ⚠️ **Only 账本设置 passes this, and only for an owner/editor.** A viewer's server would refuse
   * the rename anyway, so they get no control that is certain to fail — just the sentence below.
   */
  readonly onRename?: (() => void) | undefined;
}): React.JSX.Element {
  const { t } = useI18n();
  const currentBookId = useCurrentBookId();
  const isCurrentAccounting = bookId === currentBookId;
  /** 游客账本没有编号与成员：这一行写“仅本机 · 游客本地账本”。 */
  const guest = useGuestMode();

  /** The identity line itself — the same markup in both shapes of the card. */
  const identity = (
    <>
      <span className="flex min-w-0 flex-col gap-0.5">
        {caption === undefined ? null : <span className="text-helper text-muted">{caption}</span>}
        <span className="truncate text-base font-medium text-ink">{name}</span>
        <span className="flex flex-wrap items-center gap-2 text-helper text-muted">
          {guest ? <span>{t("books.space.guestLocal")}</span> : <span className="font-mono">{bookNumber ?? t("books.noNumber")}</span>}
          {memberCount === undefined || guest ? null : (
            <>
              <span>·</span>
              <span>{t("books.people", { count: memberCount })}</span>
            </>
          )}
          {isCurrentAccounting ? (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-micro text-brand-dark">{t("books.currentAccounting")}</span>
          ) : null}
        </span>
      </span>

      <span className="shrink-0 rounded-field bg-brand-soft px-3 py-1.5 text-helper text-brand-dark">{t("books.identity.switch")}</span>
    </>
  );

  /** ⚠️ **The unchanged card** — 账本详情 renders this, and so does a viewer on 账本设置. */
  if (onRename === undefined) {
    return (
      <button
        data-book-identity="summary"
        type="button"
        onClick={onSwitch}
        className="flex w-full items-center justify-between gap-4 rounded-card border border-line bg-surface px-5 py-4 text-left transition hover:bg-canvas"
      >
        {identity}
      </button>
    );
  }

  return (
    <div data-book-identity="editable" className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
      <button
        data-book-identity-summary
        type="button"
        onClick={onSwitch}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-canvas"
      >
        {identity}
      </button>

      {/**
        * ⚠️ **The name is not repeated here.** This row is an *action*, so it says what it does
        * rather than showing the value that is already one line above it.
        */}
      <button
        type="button"
        onClick={onRename}
        className="flex min-h-12 w-full items-center justify-between gap-4 border-t border-line px-5 py-3 text-left transition-colors hover:bg-canvas active:bg-brand-soft/60"
      >
        <span className="min-w-0 text-body text-ink">{t("books.identity.rename")}</span>
        <ChevronIcon direction="right" className="size-4 text-muted/70" />
      </button>
    </div>
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
  const { t } = useI18n();
  const guest = useGuestMode();
  return (
    // 1.19.70：只换选中外观——账本行是“当前正在看的账本”的单选列表，仍是同一个按钮、同一个 onSelect（切换账本的流程不动）；
    // 独立选中项 SelectionItem 只多一个 data-select-item 钩子，B1 / B2 / A / C 在 S19 下按统一选中模型表现。
    <SelectionItem
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-14 w-full items-center gap-3 border-b border-line px-5 py-3 text-left transition last:border-b-0 hover:bg-canvas ${
        selected ? "bg-brand-soft/50" : ""
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body text-ink">{book.name}</span>
        <span className="flex flex-wrap items-center gap-2 text-helper text-muted">
          {guest ? (
            <span>{t("books.space.guestLocal")}</span>
          ) : (
            <>
              <span className="font-mono">{book.bookNumber ?? t("books.noNumber")}</span>
              <span>·</span>
              <span>{t("books.people", { count: book.memberCount })}</span>
            </>
          )}
          {/**
            * ⚠️ **A word, not only a colour, and not only a tick** — the same rule the management
            * sheet follows for its 「当前」 badge. It says what the ledger *is* (where entries go),
            * which is a different fact from what this sheet is about (what is on screen).
            */}
          {isCurrentAccounting ? (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-micro text-brand-dark">{t("books.currentAccounting")}</span>
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
    </SelectionItem>
  );
}
