/**
 * **全局侧边导航栏**（大屏）：品牌、主导航、绿色记账入口、账本快速切换。
 *
 * - 单工作区时完整显示（约 232px），双工作区时自动收成紧凑形态（约 68px），用户也可手动展开 / 收起；
 *   收起只是换形态，功能不消失（账本切换、记账入口、拖动导航项都还在）。
 * - **侧栏默认控制主工作区**：点导航项、记一笔、切账本都作用于主区。
 * - 竖屏双工作区时侧栏仍是**一整条**：内部一条横线与工作区分界线处于同一高度（读同一个 CSS 变量，
 *   拖动时同步移动），上半段控制主区，下半段是辅助区的简洁导航入口。
 * - 导航项**长按（触摸）或按住拖动（鼠标）**可以拖进辅助工作区；长按松手 / 右键 / 菜单键给出同样的
 *   「在辅助工作区打开」菜单，拖拽不是唯一途径。
 *
 * ⚠️ 绿色记账按钮沿用 Libevra 的加号语言（设计记录 P-09）：点开仍是五种记账方式，不把它们变成五个导航页。
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { BottomSheet } from "../components/BottomSheet.js";
import { Button } from "../components/Button.js";
import { ENTRY_ACTIONS, PlusIcon } from "../components/BottomNav.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useActivateBook, useBooks, useCreateBook, useLedger } from "../lib/queries.js";
import { handOverForScan } from "../lib/scanHandoff.js";
import { BrandMark } from "../components/BrandMark.js";
import { destinationOf } from "./follow.js";
import { GUTTER, type Orientation } from "./geometry.js";
import { BookIcon, CaretIcon, CheckIcon, SidebarIcon } from "./icons.js";
import type { RailPreference } from "./model.js";
import { FloatingMenu, useOpenDrag } from "./openDrag.js";
import { DestinationIcon, useDestinations, type DestinationItem } from "./SecondaryNav.js";


interface RailProps {
  readonly compact: boolean;
  readonly orientation: Orientation;
  readonly splitVisible: boolean;
  readonly preference: RailPreference;
  readonly primaryPath: string;
  readonly secondaryPath: string | null;
  readonly onNavigate: (path: string) => void;
  readonly onNavigateSecondary: (path: string) => void;
  readonly onOpenInSecondary: (path: string) => void;
  readonly onSetRail: (rail: RailPreference) => void;
  /** 主工作区进入一本账（见 `WorkspaceActions.enterLedger`）。 */
  readonly onEnterLedger: (bookId: string, reload: () => void) => void;
  readonly canSplit: boolean;
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

        <AddEntryButton compact={compact} onNavigate={props.onNavigate} />

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
          <div className="lv-rail-section" data-section="secondary" role="group" aria-label={t("workspace.rail.secondaryNavLabel")}>
            <ul className="lv-rail-nav">
              {destinations.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="lv-rail-item"
                    aria-current={destinationOf(props.secondaryPath ?? "") === item.id ? "page" : undefined}
                    aria-label={t("workspace.rail.secondaryNav", { title: item.label })}
                    title={t("workspace.rail.secondaryNav", { title: item.label })}
                    onClick={() => {
                      props.onNavigateSecondary(item.path);
                    }}
                  >
                    <span className="lv-rail-item-icon">
                      <DestinationIcon page={item.id} className="size-6" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// 导航项：轻点导航、长按 / 拖动进辅助区、右键菜单
// ---------------------------------------------------------------------------

function RailNavItem({
  item,
  compact,
  active,
  onOpen,
}: {
  readonly item: DestinationItem;
  readonly compact: boolean;
  readonly active: boolean;
  readonly onOpen: (path: string) => void;
}): React.JSX.Element {
  /** 长按 / 拖动 / 右键菜单与工作区里的其它入口是同一套（`useOpenDrag`）。 */
  const drag = useOpenDrag({ path: item.path, title: item.label, fromRail: true });

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

function AddEntryButton({ compact, onNavigate }: { readonly compact: boolean; readonly onNavigate: (path: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const box = button.current?.getBoundingClientRect();
    const sheet = panel.current?.getBoundingClientRect();
    if (box === undefined) return;
    const height = sheet?.height ?? 320;
    setAnchor({
      left: box.right + 12,
      top: Math.max(12, Math.min(box.top + box.height / 2 - height / 2, window.innerHeight - height - 12)),
    });
    panel.current?.querySelector<HTMLElement>("a,button:not([disabled])")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panel.current?.contains(target) === true || button.current?.contains(target) === true) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open]);

  return (
    <div className="lv-rail-add-wrap">
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])];
          event.target.value = "";
          if (chosen.length > 0) {
            handOverForScan(chosen);
            onNavigate("/scan");
          }
        }}
      />
      <button
        ref={button}
        type="button"
        className="lv-rail-add"
        data-compact={compact ? "true" : "false"}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={open ? t("workspace.rail.closeAddMenu") : t("workspace.rail.addMenu")}
        title={compact ? t("workspace.rail.add") : undefined}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <PlusIcon className={`size-6 transition-transform duration-200 ${open ? "rotate-45" : "rotate-0"}`} />
        {compact ? null : <span>{t("workspace.rail.add")}</span>}
      </button>
      {open ? (
        <div
          ref={panel}
          id={menuId}
          className="lv-popover lv-add-menu"
          role="menu"
          aria-label={t("workspace.rail.addMenu")}
          style={{ position: "fixed", left: anchor?.left ?? -9999, top: anchor?.top ?? 0 }}
        >
          {ENTRY_ACTIONS.map((action) => {
            const label = t(`nav.entry.${action.id}.label`);
            const disabled = guest && action.id !== "manual";
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className="lv-add-item"
                data-primary={action.id === "manual" ? "true" : undefined}
                disabled={disabled}
                aria-label={disabled ? t("nav.entry.needsAccount", { label }) : label}
                onClick={() => {
                  setOpen(false);
                  if (action.picksImages === true) {
                    picker.current?.click();
                    return;
                  }
                  if (action.to !== undefined) onNavigate(action.to);
                }}
              >
                <span className="lv-add-item-icon">{action.icon}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 账本快速切换
// ---------------------------------------------------------------------------

function RailBooks({
  compact,
  onNavigate,
  onOpenInSecondary,
  onEnterLedger,
  canSplit,
}: {
  readonly compact: boolean;
  readonly onNavigate: (path: string) => void;
  readonly onOpenInSecondary: (path: string) => void;
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
          <li key={book.id}>
            <button
              type="button"
              className="lv-rail-book"
              aria-current={current ? "true" : undefined}
              title={book.name}
              disabled={activate.isPending}
              onClick={() => {
                setPopover(false);
                void enter(book.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ id: book.id, name: book.name, x: event.clientX, y: event.clientY });
              }}
              onKeyDown={(event) => {
                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  setMenu({ id: book.id, name: book.name, x: box.right, y: box.top + box.height / 2 });
                }
              }}
            >
              <span className="lv-rail-book-dot" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{book.name}</span>
              {current ? (
                <span className="lv-rail-book-current">
                  <CheckIcon className="size-4" />
                  <span className="sr-only">{t("workspace.rail.current")}</span>
                </span>
              ) : null}
            </button>
          </li>
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
