/**
 * **辅助工作区的导航**（第二轮）：辅助区内部右下角一个小小的圆角按钮，点开是一个轻量浮层。
 *
 * - 浮层里是：顶部一行「这个工作区现在是什么（页面 · 账本）· 收起」；四个主目的地（带当前选中
 *   状态）；这个工作区查看的账本。（第三轮按所有者意见去掉了「这里浏览过」与「设为主工作区」。）
 * - 选择一项**只改变辅助工作区**（主区不变），并自动切换为独立模式——用户已经明确让辅助区承担这项任务，
 *   之后主区的点击不应该覆盖它（规格 §9.3 / §10）。同一种功能允许两边各开一次（主区明细 + 辅区明细）。
 * - 按钮让开页面自己的底部操作条（保存条、批量操作条、留言输入框、编辑抽屉……标记了
 *   `data-lv-bottom-bar` 的元素），在这个工作区里输入文字（软键盘弹出）时暂时隐藏。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ChartIcon, ledgerTabLabel, ListIcon, PeopleIcon, PersonIcon, PlusIcon } from "../components/BottomNav.js";
import { useI18n } from "../i18n/index.js";
import { currentBookId } from "../lib/currentBook.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useBooks, useLedger } from "../lib/queries.js";
import { useViewBookId } from "../lib/workspaceLedger.js";
import { usePaneLedgerEntry, useWorkspaceActions } from "./context.js";
import { destinationOf } from "./follow.js";
import { BookIcon, CheckIcon, GridIcon, MenuIcon, SplitIcon, XIcon } from "./icons.js";
import type { PaneHistory } from "./paneHistory.js";
import { usePaneIdentity, type PageKey } from "./paneTitle.js";

export function DestinationIcon({ page, className = "size-6" }: { readonly page: PageKey; readonly className?: string }): React.JSX.Element {
  switch (page) {
    case "entries":
    case "detail":
      return <ListIcon className={className} />;
    case "insights":
      return <ChartIcon className={className} />;
    case "ledger":
      return <PeopleIcon className={className} />;
    case "me":
      return <PersonIcon className={className} />;
    case "add":
      return <PlusIcon className={className} />;
    case "start":
      return <SplitIcon className={className} />;
    case "other":
      return <MenuIcon className={className} />;
  }
}

export interface DestinationItem {
  readonly id: "entries" | "insights" | "ledger" | "me";
  readonly path: string;
  readonly label: string;
}

/** 四个主目的地（与底部导航同一组；第四格按成员数叫「账本」或「协作」，游客去本机账本空间）。 */
export function useDestinations(): readonly DestinationItem[] {
  const { t } = useI18n();
  const guest = useGuestMode();
  const ledger = useLedger();
  return [
    { id: "entries", path: "/", label: t("nav.tabs.entries") },
    { id: "insights", path: "/stats", label: t("nav.tabs.insights") },
    { id: "ledger", path: guest ? "/start" : "/ledger", label: ledgerTabLabel(ledger.data?.book.memberCount) },
    { id: "me", path: "/me", label: t("nav.tabs.me") },
  ];
}

/** 「这个工作区里正在输入文字」：软键盘可能弹出，右下角的按钮暂时让开。 */
function isEditable(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return true;
  return node instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(node.type);
}

const FAB_SIZE = 48;
const FAB_INSET = 16;

/**
 * 按钮需要抬高多少才不压住页面自己的底部操作条（标记了 `data-lv-bottom-bar`、贴着工作区底边、
 * 横向与按钮重叠的元素）。条出现 / 消失、工作区尺寸变化、滚动（吸底的条位置会变）时重新量。
 */
function useBottomBarLift(wrap: React.RefObject<HTMLElement | null>): number {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const pane = wrap.current?.closest<HTMLElement>(".lv-pane");
    if (pane === null || pane === undefined) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const box = pane.getBoundingClientRect();
      const left = box.right - FAB_INSET - FAB_SIZE - 8;
      let needed = 0;
      for (const bar of pane.querySelectorAll<HTMLElement>("[data-lv-bottom-bar]")) {
        const rect = bar.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.right < left || rect.left > box.right) continue;
        // 只认贴着工作区底边的条（吸底 / 固定在底部）；列表中间的元素不算。
        if (box.bottom - rect.bottom > 28 || rect.top >= box.bottom) continue;
        needed = Math.max(needed, Math.round(box.bottom - rect.top));
      }
      setLift((current) => (current === needed ? current : needed));
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(pane, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-lv-bottom-bar", "hidden"] });
    const sizes = new ResizeObserver(schedule);
    sizes.observe(pane);
    pane.addEventListener("scroll", schedule, { capture: true, passive: true });
    schedule();
    return () => {
      mutations.disconnect();
      sizes.disconnect();
      pane.removeEventListener("scroll", schedule, { capture: true });
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [wrap]);
  return lift;
}

/** 这个工作区里是否有输入框获得焦点。 */
function useEditingInPane(wrap: React.RefObject<HTMLElement | null>): boolean {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const pane = wrap.current?.closest<HTMLElement>(".lv-pane");
    if (pane === null || pane === undefined) return;
    const update = (): void => {
      const active = document.activeElement;
      setEditing(pane.contains(active) && isEditable(active));
    };
    // 焦点移动完成后再判断（focusout 时 activeElement 还是 body）。
    const later = (): void => {
      requestAnimationFrame(update);
    };
    pane.addEventListener("focusin", update);
    pane.addEventListener("focusout", later);
    update();
    return () => {
      pane.removeEventListener("focusin", update);
      pane.removeEventListener("focusout", later);
    };
  }, [wrap]);
  return editing;
}

export function SecondaryFab({ history }: { readonly history: PaneHistory }): React.JSX.Element | null {
  const { t } = useI18n();
  const snapshot = useSyncExternalStore(history.subscribe, () => history.snapshot, () => history.snapshot);
  const identity = usePaneIdentity(snapshot.location.pathname);
  const wrap = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const lift = useBottomBarLift(wrap);
  const editing = useEditingInPane(wrap);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  const title = identity.book === null ? identity.title : t("workspace.pane.identity", { page: identity.title, book: identity.book });

  return (
    <div
      ref={wrap}
      className="lv-fab-wrap"
      data-hidden={editing && !open ? "true" : undefined}
      style={{ ["--lv-fab-lift" as string]: `${String(lift)}px` } as React.CSSProperties}
    >
      {open ? <SecondaryNavPanel history={history} anchor={button} title={title} onClose={close} /> : null}
      <button
        ref={button}
        type="button"
        className="lv-fab"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("workspace.secondary.navButton", { title })}
        title={t("workspace.secondary.navButton", { title })}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <GridIcon className="size-[22px]" />
      </button>
    </div>
  );
}

export function SecondaryNavPanel({
  history,
  anchor,
  title,
  onClose,
}: {
  readonly history: PaneHistory;
  readonly anchor: React.RefObject<HTMLElement | null>;
  readonly title: string;
  readonly onClose: (refocus: boolean) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const books = useBooks();
  const destinations = useDestinations();
  const actions = useWorkspaceActions();
  const enterLedger = usePaneLedgerEntry();
  const viewing = useViewBookId();
  const snapshot = useSyncExternalStore(history.subscribe, () => history.snapshot, () => history.snapshot);
  const panel = useRef<HTMLDivElement | null>(null);
  const current = destinationOf(snapshot.location.pathname);

  // 打开时只聚焦一次；`onClose` 放进引用里，避免重新渲染时把焦点拉回第一项。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current(true);
      }
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panel.current?.contains(target) === true || anchor.current?.contains(target) === true) return;
      closeRef.current(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [anchor]);

  const device = currentBookId();
  const list = books.data?.books ?? [];

  const go = (path: string): void => {
    closeRef.current(false);
    actions?.navigateSecondary(path);
  };

  return (
    <div ref={panel} className="lv-popover lv-secondary-nav" role="dialog" aria-label={t("workspace.rail.secondaryNavLabel")}>
      {/* 返回沿用各次级页面左上角入口；导航只保留工作区身份与关闭。 */}
      <div className="lv-secondary-head">
        <p className="lv-secondary-identity" title={title}>
          <span className="lv-secondary-role">{t("workspace.pane.secondary")}</span>
          <span className="min-w-0 max-w-full truncate">{title}</span>
        </p>
        <button
          type="button"
          className="lv-secondary-action"
          aria-label={t("workspace.secondary.close")}
          title={t("workspace.secondary.close")}
          onClick={() => {
            closeRef.current(false);
            actions?.closeSecondary();
          }}
        >
          <XIcon className="size-5" />
        </button>
      </div>

      <p className="lv-popover-title">{t("workspace.secondary.destinations")}</p>
      <ul className="lv-popover-list lv-secondary-destinations">
        {destinations.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              className="lv-popover-item"
              data-autofocus={index === 0 ? "" : undefined}
              aria-current={current === item.id ? "page" : undefined}
              onClick={() => {
                go(item.path);
              }}
            >
              <DestinationIcon page={item.id} className="size-5" />
              <span className="min-w-0 truncate">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>

      {!guest && list.length > 1 && enterLedger !== null ? (
        <>
          <p className="lv-popover-title">{t("workspace.ledger.title")}</p>
          <p className="lv-popover-note">{t("workspace.ledger.hint")}</p>
          <ul className="lv-popover-list">
            {list.map((book) => {
              const selected = book.id === viewing;
              return (
                <li key={book.id}>
                  <button
                    type="button"
                    className="lv-popover-item"
                    title={book.name}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => {
                      closeRef.current(false);
                      if (!selected) enterLedger(book.id, () => {});
                    }}
                  >
                    <BookIcon className="size-5" />
                    <span className="min-w-0 flex-1 truncate">{book.name}</span>
                    {book.id === device ? <span className="lv-popover-badge">{t("workspace.ledger.current")}</span> : null}
                    {selected ? <CheckIcon className="size-4 text-brand" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

    </div>
  );
}
