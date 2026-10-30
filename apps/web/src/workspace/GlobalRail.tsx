/**
 * **全局侧边导航栏**（大屏）：品牌、主导航、绿色记账入口、账本快速切换。
 *
 * - 单工作区时完整显示（约 232px），双工作区时自动收成紧凑形态（约 68px），用户也可手动展开 / 收起；
 *   收起只是换形态，功能不消失（账本切换、记账入口、拖动导航项都还在）。
 * - **侧栏默认控制主工作区**；双区跟随时，记一笔交给辅助区，竖屏下半段导航只控制辅助区。
 * - 竖屏双工作区时侧栏仍是**一整条**：内部一条横线与工作区分界线处于同一高度（读同一个 CSS 变量，
 *   拖动时同步移动），上半段控制主区，下半段是辅助区的简洁导航入口。
 * - 导航项**长按（触摸）或按住拖动（鼠标）**可以拖进辅助工作区；长按松手 / 右键 / 菜单键给出同样的
 *   「在辅助工作区打开」菜单，拖拽不是唯一途径。
 *
 * ⚠️ 绿色记账按钮沿用 Libevra 的加号语言（设计记录 P-09）：点开仍是五种记账方式，不把它们变成五个导航页。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { BottomSheet } from "../components/BottomSheet.js";
import { Button } from "../components/Button.js";
import { PlusIcon } from "../components/BottomNav.js";
import type { EntryNavigate } from "./entryMenu.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useViewBookId, ViewLedgerContext } from "../lib/workspaceLedger.js";
import { useActivateBook, useBooks, useCreateBook, useLedger } from "../lib/queries.js";
import { EntryMethodList } from "./RailEntryMenu.js";
import { entryMenuPosition } from "./entryMenu.js";
import { BrandMark } from "../components/BrandMark.js";
import { destinationOf } from "./follow.js";
import { GUTTER, type Orientation } from "./geometry.js";
import { BackIcon, BookIcon, CaretIcon, CheckIcon, SidebarIcon, XIcon } from "./icons.js";
import type { RailPreference } from "./model.js";
import { FloatingMenu, useOpenDrag } from "./openDrag.js";
import type { OpenOptions } from "./context.js";
import { DestinationIcon, useDestinations, type DestinationItem } from "./SecondaryNav.js";


interface RailProps {
  readonly compact: boolean;
  readonly orientation: Orientation;
  readonly splitVisible: boolean;
  readonly preference: RailPreference;
  readonly primaryPath: string;
  readonly secondaryPath: string | null;
  readonly secondaryLedger: string | null;
  readonly onEnterSecondaryLedger: (bookId: string, reload: () => void) => void;
  readonly onBackSecondary: () => void;
  readonly canBackSecondary: boolean;
  readonly onCloseSecondary: () => void;
  readonly onNavigate: (path: string) => void;
  readonly onNavigateEntry: EntryNavigate;
  readonly onNavigateSecondary: (path: string) => void;
  readonly onOpenInSecondary: (path: string, options?: OpenOptions) => void;
  readonly onSetRail: (rail: RailPreference) => void;
  /** 主工作区进入一本账（见 `WorkspaceActions.enterLedger`）。 */
  readonly onEnterLedger: (bookId: string, reload: () => void) => void;
  readonly canSplit: boolean;
  readonly followEntry: boolean;
  readonly entryMenuOpen: boolean;
  readonly onToggleEntry: () => void;
  readonly onCloseEntry: () => void;
}

export function GlobalRail(props: RailProps): React.JSX.Element {
  const { t } = useI18n();
  const { compact, orientation, splitVisible } = props;
  const destinations = useDestinations();
  const active = destinationOf(props.primaryPath);
  const portraitSplit = orientation === "portrait" && splitVisible;

  return (
    <nav className="lv-rail" data-compact={compact ? "true" : "false"} data-portrait-split={portraitSplit ? "true" : "false"} aria-label={t("workspace.rail.label")}>
      <div className="lv-rail-section" data-section="primary">
        {/**
          * ⚠️ **第二轮：品牌是同一组元素，只是展开 / 收起两种形态**——标志始终在同一个位置，文字与收起按钮
          * 随宽度淡入淡出，不在两种形态之间替换成另一套 DOM（那样会「跳」）。
          * - 紧凑：点标志 = 展开侧栏（原有行为）；
          * - 展开：点标志与名称 = 主工作区回到明细首页（主区账本、辅助区、模式都不变）。
          */}
        <div className="lv-rail-brand">
          <button
            type="button"
            className="lv-rail-brand-button"
            aria-label={compact ? t("workspace.rail.expand") : t("workspace.rail.home")}
            title={compact ? t("workspace.rail.expand") : t("workspace.rail.home")}
            onClick={() => {
              if (compact) {
                props.onSetRail("expanded");
                return;
              }
              // 已经在明细首页就什么都不做（不重新载入、不重置筛选）。
              if (props.primaryPath !== "/") props.onNavigate("/");
            }}
          >
            <span className="lv-rail-mark" aria-hidden="true">
              <BrandMark className="size-6" />
            </span>
            <span className="lv-rail-wordmark lv-rail-fade" aria-hidden="true">
              Libevra
            </span>
          </button>
          <button
            type="button"
            className="lv-rail-icon-button lv-rail-collapse lv-rail-fade"
            aria-label={t("workspace.rail.collapse")}
            title={t("workspace.rail.collapse")}
            tabIndex={compact ? -1 : undefined}
            aria-hidden={compact ? true : undefined}
            onClick={() => {
              props.onSetRail(splitVisible ? "auto" : "collapsed");
            }}
          >
            <SidebarIcon className="size-5" />
          </button>
        </div>

        <ul className="lv-rail-nav">
          {destinations.map((item) => (
            <RailNavItem
              key={item.id}
              item={item}
              compact={compact}
              active={active === item.id}
              onOpen={props.onNavigate}
            />
          ))}
        </ul>

        <AddEntryButton compact={compact} onNavigate={props.onNavigateEntry} follow={props.followEntry} followOpen={props.entryMenuOpen} onToggleFollow={props.onToggleEntry} onCloseFollow={props.onCloseEntry} />

        <RailBooks
          compact={compact}
          onNavigate={props.onNavigate}
          onOpenInSecondary={props.onOpenInSecondary}
          onEnterLedger={props.onEnterLedger}
          canSplit={props.canSplit}
        />
      </div>

      {portraitSplit && props.secondaryPath !== null ? (
        <>
          <span className="lv-rail-split" aria-hidden="true" />
          <ViewLedgerContext.Provider value={props.secondaryLedger}><PortraitSecondaryRail {...props} /></ViewLedgerContext.Provider>
        </>
      ) : null}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// 导航项：轻点导航、长按 / 拖动进辅助区、右键菜单
// ---------------------------------------------------------------------------

/** 竖屏下方工作区共用侧栏宽度与账本组件；没有第二个记账入口。 */
export function PortraitSecondaryRail(props: RailProps): React.JSX.Element {
  const { t } = useI18n();
  const destinations = useDestinations();
  const viewing = useViewBookId();
  return <div className="lv-rail-section" data-section="secondary" role="group" aria-label={t("workspace.rail.secondaryNavLabel")}>
    <div className="lv-rail-brand">
      <button type="button" className="lv-rail-brand-button" aria-label={props.compact ? t("workspace.rail.expand") : t("workspace.rail.secondaryHome")} title={props.compact ? t("workspace.rail.expand") : t("workspace.rail.secondaryHome")}
        onClick={() => { if (props.compact) props.onSetRail("expanded"); else if (props.secondaryPath !== "/") props.onNavigateSecondary("/"); }}>
        <span className="lv-rail-mark" aria-hidden="true"><BrandMark className="size-6" /></span>
        <span className="lv-rail-wordmark lv-rail-fade" aria-hidden="true">Libevra</span>
      </button>
      <button type="button" className="lv-rail-icon-button lv-rail-collapse lv-rail-fade" aria-label={t("workspace.rail.collapse")} tabIndex={props.compact ? -1 : undefined} aria-hidden={props.compact ? true : undefined} onClick={() => props.onSetRail("auto")}><SidebarIcon className="size-5" /></button>
    </div>
    <div className="lv-rail-secondary-tools">
      <button type="button" className="lv-rail-icon-button" aria-label={t("workspace.secondary.back")} title={t("workspace.secondary.back")} disabled={!props.canBackSecondary} onClick={props.onBackSecondary}><BackIcon className="size-5" /></button>
      <span className="lv-rail-fade min-w-0 flex-1 truncate text-helper text-muted">{t("workspace.pane.secondary")}</span>
      <button type="button" className="lv-rail-icon-button" aria-label={t("workspace.secondary.close")} title={t("workspace.secondary.close")} onClick={props.onCloseSecondary}><XIcon className="size-5" /></button>
    </div>
    <ul className="lv-rail-nav">{destinations.map((item) => <RailNavItem key={item.id} item={item} compact={props.compact} active={destinationOf(props.secondaryPath ?? "") === item.id} onOpen={props.onNavigateSecondary} ledger={viewing} />)}</ul>
    <RailBooks compact={props.compact} onNavigate={props.onNavigateSecondary} onOpenInSecondary={props.onOpenInSecondary} onEnterLedger={props.onEnterSecondaryLedger} canSplit={props.canSplit} />
  </div>;
}

function RailNavItem({
  item,
  compact,
  active,
  onOpen,
  ledger,
}: {
  readonly item: DestinationItem;
  readonly compact: boolean;
  readonly active: boolean;
  readonly onOpen: (path: string) => void;
  readonly ledger?: string | null;
}): React.JSX.Element {
  /** 长按 / 拖动 / 右键菜单与工作区里的其它入口是同一套（`useOpenDrag`）。 */
  const drag = useOpenDrag({ path: item.path, title: item.label, fromRail: true, ...(ledger === undefined ? {} : { ledger }) });

  return (
    <li>
      <button
        type="button"
        className="lv-rail-item lv-draggable"
        aria-current={active ? "page" : undefined}
        aria-haspopup="menu"
        title={compact ? item.label : undefined}
        onClick={() => {
          onOpen(item.path);
        }}
        {...drag.bind}
      >
        <span className="lv-rail-item-icon">
          <DestinationIcon page={item.id} className="size-6" />
        </span>
        {/* 紧凑形态只显示图标：名字留在 DOM 里作为读屏名，视觉上随宽度淡出（不改变 DOM 结构）。 */}
        <span className="lv-rail-item-label lv-rail-fade">{item.label}</span>
      </button>
      {drag.menu}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 记一笔：绿色加号，点开五种记账方式（与手机端同一组入口）
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// 账本快速切换
// ---------------------------------------------------------------------------

export function AddEntryButton({ compact, onNavigate, follow, followOpen, onToggleFollow, onCloseFollow }: {
  readonly compact: boolean;
  readonly onNavigate: EntryNavigate;
  readonly follow: boolean;
  readonly followOpen: boolean;
  readonly onToggleFollow: () => void;
  readonly onCloseFollow: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const [localOpen, setLocalOpen] = useState(false);
  const open = follow ? followOpen : localOpen;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<ReturnType<typeof entryMenuPosition> | null>(null);
  const menuId = useId();
  const close = (): void => { setLocalOpen(false); if (followOpen) onCloseFollow(); };

  useEffect(() => { setLocalOpen(false); }, [follow]);
  useLayoutEffect(() => {
    if (!open || follow) return;
    const update = (): void => {
      const trigger = button.current;
      const own = panel.current;
      if (trigger === null || own === null) return;
      const box = trigger.getBoundingClientRect();
      const rail = trigger.closest(".lv-rail");
      // 工作区真实左边缘包含侧栏与内容间的留边；不依赖屏幕固定 x 坐标。
      const content = rail?.closest(".lv-shell")?.querySelector<HTMLElement>('.lv-pane[data-role="primary"]');
      const edge = content?.getBoundingClientRect().left ?? rail?.getBoundingClientRect().right ?? box.right;
      setAnchor(entryMenuPosition(box, edge, { width: window.innerWidth, height: window.innerHeight }, own.scrollHeight));
    };
    update();
    const observer = new ResizeObserver(update);
    if (button.current !== null) observer.observe(button.current);
    const rail = button.current?.closest(".lv-rail");
    if (rail !== null && rail !== undefined) observer.observe(rail);
    if (panel.current !== null) observer.observe(panel.current);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    panel.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus({ preventScroll: true });
    return () => { observer.disconnect(); window.removeEventListener("resize", update); document.removeEventListener("scroll", update, true); };
  }, [open, compact, follow]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault(); close(); button.current?.focus({ preventScroll: true });
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element) || panel.current?.contains(target) || button.current?.contains(target) || (follow && target.closest("[data-entry-chooser], .lv-divider"))) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer, true); };
  });

  const choices = <div ref={panel} id={menuId} className={compact ? "lv-entry-popover" : "lv-entry-inline"} data-open={open && !follow ? "true" : "false"}
    inert={!open || follow} aria-hidden={!open || follow} style={compact ? { position: "fixed", left: anchor?.left ?? -9999, top: anchor?.top ?? 0, width: anchor?.width ?? 224, maxHeight: anchor?.maxHeight, "--lv-entry-max-height": `${anchor?.maxHeight ?? 520}px`, "--lv-entry-connector": `${anchor?.connector ?? 24}px` } as React.CSSProperties : undefined}>
    <div className="lv-entry-clip"><div className="lv-entry-methods" role="menu" aria-label={t("workspace.rail.addMenu")}><EntryMethodList disabledFor={(action) => {
      const disabled = guest && action.id !== "manual";
      return disabled;
    }} onNavigate={onNavigate} onSelected={() => { setLocalOpen(false); button.current?.focus({ preventScroll: true }); }} /></div></div>
  </div>;
  return <div className="lv-rail-add-wrap">
    <button ref={button} type="button" className="lv-rail-add" data-compact={compact ? "true" : "false"} aria-expanded={open}
      aria-controls={open ? follow ? "lv-follow-entry-menu" : menuId : undefined} aria-haspopup="menu"
      aria-label={open ? t("workspace.rail.closeAddMenu") : t("workspace.rail.addMenu")} title={compact ? t("workspace.rail.add") : undefined}
      onClick={() => { if (follow) onToggleFollow(); else setLocalOpen((value) => !value); }}>
      <PlusIcon className={`size-6 lv-entry-plus ${open ? "rotate-45" : "rotate-0"}`} />{compact ? null : <span>{t("workspace.rail.add")}</span>}
    </button>
    {compact ? createPortal(choices, document.body) : choices}
  </div>;
}

function RailBooks({
  compact,
  onNavigate,
  onOpenInSecondary,
  onEnterLedger,
  canSplit,
}: {
  readonly compact: boolean;
  readonly onNavigate: (path: string) => void;
  readonly onOpenInSecondary: (path: string, options?: OpenOptions) => void;
  readonly onEnterLedger: (bookId: string, reload: () => void) => void;
  readonly canSplit: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const books = useBooks();
  const ledger = useLedger();
  const activate = useActivateBook();
  const [expanded, setExpanded] = useState(true);
  const [popover, setPopover] = useState(false);
  const [menu, setMenu] = useState<{ readonly id: string; readonly name: string; readonly x: number; readonly y: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const compactButton = useRef<HTMLButtonElement | null>(null);
  const currentId = ledger.data?.book.id ?? null;
  const list = books.data?.books ?? [];
  const currentName = ledger.data?.book.name ?? "";

  const enter = async (bookId: string): Promise<void> => {
    if (guest) {
      onNavigate("/");
      return;
    }
    /**
     * ⚠️ **与账本空间页同一条切换路径**：先告诉服务器并把新账本写进本机，再整页重新载入——请求头、
     * 离线副本的作用域与所有页面一起换，不会出现「一个账本的标题配另一个账本的账目」。工作区布局与
     * 辅助区页面保存在会话里，重新载入后恢复。
     *
     * ⚠️ **侧栏只切换主工作区的账本**（第二轮）。外壳先把辅助区钉在它原来那本账上，重新载入后辅助区
     * 仍显示原来的账本；选的就是设备当前账本时（主区原本在看另一本）只让主区回来，不重新载入。
     */
    onEnterLedger(bookId, () => {
      setStatus(t("workspace.rail.switching"));
      void activate
        .mutateAsync(bookId)
        .then(() => {
          window.location.assign("/");
        })
        .catch((caught: unknown) => {
          setStatus(t("workspace.rail.switchFailed", { message: errorMessage(caught) }));
        });
    });
  };

  const rows = (
    <ul className="lv-rail-books-list">
      {list.map((book) => {
        const current = book.id === currentId;
        return (
          <RailBook key={book.id} book={book} current={current} disabled={activate.isPending}
            onEnter={() => { setPopover(false); void enter(book.id); }}
            onDropComplete={() => setPopover(false)}
            onMenu={(point) => setMenu({ id: book.id, name: book.name, ...point })} />
        );
      })}
      {guest ? null : (
        <li>
          <button
            type="button"
            className="lv-rail-book lv-rail-book-new"
            onClick={() => {
              setPopover(false);
              setCreating(true);
            }}
          >
            <PlusIcon className="size-4" />
            <span>{t("workspace.rail.newBook")}</span>
          </button>
        </li>
      )}
    </ul>
  );

  return (
    <div className="lv-rail-books" data-compact={compact ? "true" : "false"}>
      {compact ? (
        <button
          ref={compactButton}
          type="button"
          className="lv-rail-item"
          aria-expanded={popover}
          aria-label={t("workspace.rail.booksCurrent", { label: t("workspace.rail.books"), name: currentName })}
          title={currentName}
          onClick={() => {
            setPopover((value) => !value);
          }}
        >
          <span className="lv-rail-item-icon lv-rail-book-badge">
            <BookIcon className="size-6" />
          </span>
        </button>
      ) : (
        <>
          <button
            type="button"
            className="lv-rail-books-header"
            aria-expanded={expanded}
            aria-label={t("workspace.rail.booksToggle")}
            onClick={() => {
              setExpanded((value) => !value);
            }}
          >
            <span>{t("workspace.rail.books")}</span>
            <CaretIcon open={expanded} className="size-4" />
          </button>
          {expanded ? <div className="lv-rail-books-scroll">{rows}</div> : null}
        </>
      )}

      {compact && popover ? (
        <AnchoredPanel
          anchor={compactButton}
          label={t("workspace.rail.books")}
          onClose={() => {
            setPopover(false);
          }}
        >
          <p className="lv-popover-title">{t("workspace.rail.books")}</p>
          {rows}
        </AnchoredPanel>
      ) : null}

      {status !== null ? (
        <p className="lv-rail-status" role="status">
          {status}
        </p>
      ) : null}

      {menu !== null ? (
        <FloatingMenu
          x={menu.x}
          y={menu.y}
          label={menu.name}
          onClose={() => {
            setMenu(null);
          }}
          items={[
            {
              label: t("workspace.rail.bookWorkspaceInSecondary"),
              disabled: !canSplit,
              run: () => { setPopover(false); onOpenInSecondary("/", { ledger: menu.id }); },
            },
            ...(menu.id === currentId || guest
              ? []
              : [
                  {
                    label: t("workspace.rail.switchTo"),
                    run: () => {
                      void enter(menu.id);
                    },
                  },
                ]),
            ...(guest
              ? []
              : [
                  {
                    label: t("workspace.rail.bookDetail"),
                    run: () => {
                      onNavigate(`/books/${menu.id}`);
                    },
                  },
                  {
                    label: t("workspace.rail.bookDetailInSecondary"),
                    disabled: !canSplit,
                    run: () => {
                      onOpenInSecondary(`/books/${menu.id}`);
                    },
                  },
                ]),
          ]}
        />
      ) : null}

      {creating ? (
        <NewBookSheet
          onClose={() => {
            setCreating(false);
          }}
          onCreated={(id) => {
            setCreating(false);
            void enter(id);
          }}
        />
      ) : null}
    </div>
  );
}

function AnchoredPanel({
  anchor,
  label,
  onClose,
  children,
}: {
  readonly anchor: React.RefObject<HTMLElement | null>;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect();
    const own = ref.current?.getBoundingClientRect();
    if (box === undefined) return;
    const height = own?.height ?? 240;
    setPosition({ left: box.right + 12, top: Math.max(12, Math.min(box.top, window.innerHeight - height - 12)) });
    ref.current?.querySelector<HTMLElement>("button")?.focus();
  }, [anchor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
        anchor.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (ref.current?.contains(target) === true || anchor.current?.contains(target) === true) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [anchor, onClose]);

  return (
    <div ref={ref} className="lv-popover lv-books-popover" role="dialog" aria-label={label} style={{ position: "fixed", left: position?.left ?? -9999, top: position?.top ?? 0 }}>
      {children}
    </div>
  );
}

function RailBook({ book, current, disabled, onEnter, onMenu, onDropComplete }: {
  readonly book: { readonly id: string; readonly name: string };
  readonly current: boolean;
  readonly disabled: boolean;
  readonly onEnter: () => void;
  readonly onMenu: (point: { readonly x: number; readonly y: number }) => void;
  readonly onDropComplete: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const drag = useOpenDrag({ path: "/", title: book.name, ledger: book.id, fromRail: true, disabled, onMenu, onDropComplete });
  return <li><button type="button" className="lv-rail-book lv-draggable" aria-current={current ? "true" : undefined} title={book.name} disabled={disabled}
    {...drag.bind} onClick={onEnter}
    onContextMenu={drag.bind?.onContextMenu ?? ((event) => { event.preventDefault(); onMenu({ x: event.clientX, y: event.clientY }); })}>
    <span className="lv-rail-book-dot" aria-hidden="true" />
    <span className="min-w-0 flex-1 truncate">{book.name}</span>
    {current ? <span className="lv-rail-book-current"><CheckIcon className="size-4" /><span className="sr-only">{t("workspace.rail.current")}</span></span> : null}
  </button></li>;
}

function NewBookSheet({ onClose, onCreated }: { readonly onClose: () => void; readonly onCreated: (id: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const create = useCreateBook();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  return (
    <BottomSheet label={t("workspace.newBook.title")} onClose={onClose} dialogClassName="px-6 pt-5 pb-6">
      {(close) => (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            void create
              .mutateAsync(name.trim() === "" ? t("books.defaultLedgerName") : name.trim())
              .then((created) => {
                onCreated(created.id);
              })
              .catch((caught: unknown) => {
                setError(errorMessage(caught));
              });
          }}
        >
          <h2 className="text-section-title text-ink">{t("workspace.newBook.title")}</h2>
          <label htmlFor={inputId} className="text-helper text-muted">
            {t("workspace.newBook.name")}
          </label>
          <input
            id={inputId}
            value={name}
            maxLength={40}
            placeholder={t("books.defaultLedgerName")}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="rounded-field border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-focus-ring"
          />
          {error !== null ? <p className="text-helper text-danger">{error}</p> : null}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              {t("workspace.newBook.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t("workspace.newBook.create")}
            </Button>
          </div>
        </form>
      )}
    </BottomSheet>
  );
}

/** 侧栏内部分割线与工作区分界线对齐所用的偏移（分界区中心）。 */
export const RAIL_SPLIT_OFFSET = GUTTER / 2;
