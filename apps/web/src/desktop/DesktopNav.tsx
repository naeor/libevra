/**
 * **电脑版最左侧的窄全局导航栏**（宽度固定，不随悬停展开、不随页面变化，没有伸缩动画）。
 *
 * 图标下常驻名称，悬停 / 聚焦时补充完整提示；当前页用浅绿底与左侧细条标出。导航目的地是真实链接，中键或
 * Ctrl(⌘)+点击可以在新标签页打开。账本切换与账户使用向右小面板，记账方式直接在加号下方展开。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { BrandMark } from "../components/BrandMark.js";
import { ChartIcon, ENTRY_ACTIONS, ListIcon, PeopleIcon, PlusIcon } from "../components/BottomNav.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { UserAvatar } from "../components/UserAvatar.js";
import { useI18n } from "../i18n/index.js";
import { useAdminEntry } from "../lib/admin.js";
import { errorMessage } from "../lib/api.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useActivateBook, useBooks, useCurrentBookId, useLedger } from "../lib/queries.js";
import { myBookTarget } from "../pages/MePage.js";
import { NewBookSheet } from "../workspace/GlobalRail.js";
import { EntryMethodList } from "../workspace/RailEntryMenu.js";
import { useRailTip } from "../workspace/RailTip.js";
import { BookIcon, CheckIcon } from "../workspace/icons.js";
import { DesktopPopover, moveFocusInList } from "./DesktopPopover.js";
import { DashboardIcon, SearchIcon, SignOutIcon } from "./icons.js";

type NavId = "dashboard" | "entries" | "stats" | "book" | "collab";

export interface DesktopNavItem {
  readonly id: NavId;
  readonly to: string;
  readonly label: string;
}

/** 当前地址属于哪个导航目的地（没有对应时为 `null`，例如设置页）。 */
export function navIdFor(pathname: string): NavId | null {
  if (pathname === "/ledger/cards") return "entries";
  if (pathname === "/dashboard") return "dashboard";
  if (pathname === "/" || pathname.startsWith("/transactions/")) return "entries";
  if (pathname === "/stats" || pathname.startsWith("/stats/")) return "stats";
  if (pathname === "/ledger" || pathname.startsWith("/ledger/")) return "collab";
  if (pathname.startsWith("/books/") || pathname === "/start" || pathname.startsWith("/start/")) return "book";
  return null;
}

/**
 * 游客在电脑版记账菜单里不可用的方式。
 *
 * ⚠️ **第二份判断，按 AGENTS §6 另写并由一致性测试锁住**：与 `GlobalRail` 的「记一笔」菜单（游客只能手动
 * 记账）必须一致，见 `desktop/desktopNav.test.tsx`。
 */
export function desktopEntryDisabled(action: (typeof ENTRY_ACTIONS)[number], guest: boolean): boolean {
  return guest && action.id !== "manual";
}

function NavLinkItem({ item, active }: { readonly item: DesktopNavItem; readonly active: boolean }): React.JSX.Element {
  const tip = useRailTip(item.label, true);
  const icon =
    item.id === "dashboard" ? <DashboardIcon className="size-[22px]" /> :
    item.id === "entries" ? <ListIcon className="size-[22px]" /> :
    item.id === "stats" ? <ChartIcon className="size-[22px]" /> :
    item.id === "book" ? <BookIcon className="size-[22px]" /> :
    <PeopleIcon className="size-[22px]" />;
  return (
    <li>
      <Link to={item.to} className="lv-desk-nav-item" aria-current={active ? "page" : undefined} aria-label={item.label} {...tip.bind}>
        {icon}
        <span className="text-helper">{item.label}</span>
      </Link>
      {tip.tip}
    </li>
  );
}

export function DesktopNav(): React.JSX.Element {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const guest = useGuestMode();
  const books = useBooks();
  const currentBookId = useCurrentBookId();
  const currentBook = books.data?.books.find((book) => book.id === currentBookId);
  const active = navIdFor(pathname);
  const brandTip = useRailTip(t("desktop.nav.brand"), true);

  const items = useMemo<DesktopNavItem[]>(() => {
    const list: DesktopNavItem[] = [
      { id: "dashboard", to: "/dashboard", label: t("desktop.nav.dashboard") },
      { id: "entries", to: "/", label: t("desktop.nav.entries") },
      { id: "stats", to: "/stats", label: t("desktop.nav.stats") },
      { id: "book", to: guest ? "/start" : myBookTarget(currentBookId, books.data?.books), label: t("desktop.nav.book") },
    ];
    if (!guest) list.push({ id: "collab", to: "/ledger", label: t("desktop.nav.collab") });
    return list;
  }, [t, guest, currentBookId, books.data?.books]);

  return (
    <nav className="lv-desk-nav" aria-label={t("desktop.nav.label")}>
      <Link to="/dashboard" className="lv-desk-nav-brand" aria-label={t("desktop.nav.brand")} {...brandTip.bind}>
        <BrandMark className="size-8" />
        <span className="lv-desk-nav-wordmark" aria-hidden="true">Libevra</span>
      </Link>
      {brandTip.tip}
      <div className="lv-desk-nav-main">
        <ul className="lv-desk-nav-list">
          {items.filter((item) => item.id === "dashboard").map((item) => (
            <NavLinkItem key={item.id} item={item} active={active === item.id} />
          ))}
        </ul>
        <div className="lv-desk-nav-sep" aria-hidden="true" />
        <LedgerButton />
        <ul className="lv-desk-nav-list">
          {items.filter((item) => item.id !== "dashboard" && (item.id !== "collab" || (currentBook?.memberCount ?? 1) > 1)).map((item) => (
            <NavLinkItem key={item.id} item={item} active={active === item.id} />
          ))}
        </ul>
        <AddButton />
      </div>
      <div className="lv-desk-nav-footer">
        <AccountButton />
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// 当前账本与账本选择面板
// ---------------------------------------------------------------------------

function LedgerButton(): React.JSX.Element {
  const { t } = useI18n();
  const ledger = useLedger();
  const name = ledger.data?.book.name ?? "";
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const tip = useRailTip(name === "" ? t("desktop.ledgerPicker.title") : t("desktop.nav.currentLedger", { name }), !open);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="lv-desk-nav-ledger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={name === "" ? t("desktop.ledgerPicker.title") : t("desktop.nav.currentLedger", { name })}
        onClick={() => setOpen((value) => !value)}
        {...tip.bind}
      >
        <span aria-hidden="true">{Array.from(name)[0] ?? "·"}</span>
        <span className="lv-desk-nav-ledger-name text-helper">{name || t("desktop.ledgerPicker.title")}</span>
      </button>
      {tip.tip}
      {open ? (
        <DesktopPopover anchor={anchor} label={t("desktop.ledgerPicker.title")} onClose={close} width={300}>
          <LedgerPicker onClose={close} />
        </DesktopPopover>
      ) : null}
    </>
  );
}

/** 换账本后留在哪一页：属于某一笔账或某张卡片的页面回到明细，其它页面原地重新载入。 */
export function pathAfterSwitch(pathname: string): string {
  return /^\/(transactions|books|stats\/cards|start\/book)\//.test(pathname) ? "/" : pathname;
}

/**
 * 进入一本账。⚠️ **与侧栏、账本空间页同一条切换路径**：先告诉服务器并把新账本写进本机，再整页重新载入——
 * 请求头、离线副本与所有页面一起换，权限仍由服务器按新账本检查。
 */
export function useEnterLedger(): {
  readonly enter: (bookId: string, after?: () => void, destination?: string) => void;
  readonly status: string | null;
  readonly busy: boolean;
} {
  const { t } = useI18n();
  const guest = useGuestMode();
  const ledger = useLedger();
  const activate = useActivateBook();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [status, setStatus] = useState<string | null>(null);
  const currentId = ledger.data?.book.id ?? null;
  const enter = (bookId: string, after?: () => void, destination?: string): void => {
    if (guest || bookId === currentId) {
      after?.();
      if (destination !== undefined || pathname !== "/") void navigate(destination ?? "/");
      return;
    }
    setStatus(t("desktop.ledgerPicker.switching"));
    void activate
      .mutateAsync(bookId)
      .then(() => {
        window.location.assign(destination ?? pathAfterSwitch(pathname));
      })
      .catch((caught: unknown) => {
        setStatus(t("desktop.ledgerPicker.failed", { message: errorMessage(caught) }));
      });
  };
  return { enter, status, busy: activate.isPending };
}

function LedgerPicker({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const books = useBooks();
  const ledger = useLedger();
  const switcher = useEnterLedger();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const list = books.data?.books ?? [];
  const currentId = ledger.data?.book.id ?? null;
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle === "" ? list : list.filter((book) => book.name.toLocaleLowerCase().includes(needle));
  const enter = (bookId: string): void => switcher.enter(bookId, onClose);
  const status = switcher.status;

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-3.5 pb-2">
        <p className="text-card-title text-ink">{t("desktop.ledgerPicker.title")}</p>
      </div>
      {list.length > 6 ? (
        <label className="lv-desk-search mx-3 mb-2">
          <SearchIcon className="size-4 shrink-0 text-muted" />
          <input
            data-autofocus=""
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("desktop.ledgerPicker.search")}
            aria-label={t("desktop.ledgerPicker.search")}
          />
        </label>
      ) : null}
      <ul className="max-h-[min(22rem,60vh)] overflow-y-auto px-2 pb-1" onKeyDown={(event) => moveFocusInList(event)}>
        {books.isPending ? <li className="px-3 py-2 text-helper text-muted">{t("desktop.common.loading")}</li> : null}
        {shown.map((book) => {
          const current = book.id === currentId;
          return (
            <li key={book.id}>
              <button
                type="button"
                {...(current && list.length <= 6 ? { "data-autofocus": "" } : {})}
                className="lv-desk-menu-row"
                aria-current={current ? "true" : undefined}
                disabled={switcher.busy}
                onClick={() => enter(book.id)}
              >
                <span className="lv-desk-ledger-badge" aria-hidden="true">{Array.from(book.name)[0] ?? "·"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">{book.name}</span>
                  {book.memberCount > 1 ? <span className="block text-helper text-muted">{t("desktop.ledgerPicker.members", { count: book.memberCount })}</span> : null}
                </span>
                {current ? <CheckIcon className="size-4 shrink-0 text-brand-dark" /> : null}
              </button>
            </li>
          );
        })}
        {!books.isPending && shown.length === 0 ? <li className="px-3 py-2 text-helper text-muted">{t("desktop.ledgerPicker.empty")}</li> : null}
      </ul>
      {status === null ? null : (
        <p role="status" className="px-4 pb-2 text-helper text-muted">{status}</p>
      )}
      <div className="lv-desk-popover-foot">
        <Link to="/start" className="lv-desk-link" onClick={onClose}>{t("desktop.ledgerPicker.manage")}</Link>
        {guest ? null : (
          <button type="button" className="lv-desk-link" onClick={() => setCreating(true)}>
            {t("desktop.ledgerPicker.create")}
          </button>
        )}
      </div>
      {creating ? (
        <NewBookSheet
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            enter(id);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 记一笔
// ---------------------------------------------------------------------------

function AddButton(): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const tip = useRailTip(t("desktop.nav.add"), !open);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [open]);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="lv-desk-nav-add"
        aria-haspopup="menu"
        aria-controls={open ? "desktop-entry-methods" : undefined}
        aria-expanded={open}
        aria-label={t("desktop.nav.add")}
        onClick={() => setOpen((value) => !value)}
        {...tip.bind}
      >
        <PlusIcon className={`size-6 transition-transform duration-150 ${open ? "rotate-45" : ""}`} />
      </button>
      {tip.tip}
      {open ? (
          <div ref={menu} id="desktop-entry-methods" className="lv-desk-nav-methods" role="menu" aria-label={t("desktop.nav.addMenu")} onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); close(); anchor.current?.focus(); }
          }}>
            <EntryMethodList
              disabledFor={(action) => desktopEntryDisabled(action, guest)}
              onNavigate={(path, prepare) => {
                prepare?.();
                close();
                void navigate(path);
              }}
              onSelected={close}
            />
          </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// 账户
// ---------------------------------------------------------------------------

function AccountButton(): React.JSX.Element {
  const { t } = useI18n();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const label = user === null ? t("desktop.account.guest") : user.displayName;
  const tip = useRailTip(label, !open);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="lv-desk-nav-account"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("desktop.account.menu")}
        onClick={() => setOpen((value) => !value)}
        {...tip.bind}
      >
        <UserAvatar avatarId={user?.avatarId} className="size-8" /><span className="text-helper">{t("desktop.account.label")}</span>
      </button>
      {tip.tip}
      {open ? (
        <DesktopPopover anchor={anchor} label={t("desktop.account.menu")} onClose={close} placement="right-end" width={260}>
          <AccountMenu onClose={close} />
        </DesktopPopover>
      ) : null}
    </>
  );
}

function AccountMenu({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = useAdminEntry(user?.accountNumber);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const links: { readonly to: string; readonly label: string }[] =
    user === null
      ? [
          { to: "/me", label: t("desktop.account.guestHome") },
          { to: "/settings/appearance/language", label: t("desktop.settings.items.language") },
        ]
      : [
          { to: "/profile", label: t("desktop.settings.items.profile") },
          { to: "/settings/preferences", label: t("desktop.settings.items.preferences") },
          { to: "/settings/appearance", label: t("desktop.settings.items.appearance") },
          { to: "/downloads", label: t("desktop.settings.items.downloads") },
          { to: "/update", label: t("desktop.settings.items.updates") },
          ...(isAdmin ? [{ to: "/admin", label: t("desktop.settings.items.admin") }] : []),
          { to: "/about", label: t("desktop.settings.items.about") },
        ];

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <UserAvatar avatarId={user?.avatarId} className="size-10" />
        <div className="min-w-0">
          <p className="truncate text-card-title text-ink">{user === null ? t("desktop.account.guest") : user.displayName}</p>
          {user === null ? null : <p className="truncate text-helper text-muted">@{user.username}</p>}
        </div>
      </div>
      <ul className="px-2 pb-1" onKeyDown={(event) => moveFocusInList(event)}>
        {links.map((link) => (
          <li key={link.to}>
            <Link to={link.to} className="lv-desk-menu-row" onClick={onClose}>
              <span className="text-body text-ink">{link.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      {user === null ? (
        <div className="lv-desk-popover-foot">
          <Link to="/register" className="lv-desk-link" onClick={onClose}>{t("desktop.account.signUp")}</Link>
        </div>
      ) : (
        <div className="lv-desk-popover-foot">
          <button type="button" className="lv-desk-menu-row text-danger" onClick={() => setConfirmSignOut(true)}>
            <SignOutIcon className="size-4" />
            <span className="text-body">{t("account.me.signOut")}</span>
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirmSignOut}
        title={t("account.me.signOutTitle")}
        description={t("account.me.signOutDescription")}
        consequences={[t("account.me.signOutSession"), t("account.me.signOutRecovery")]}
        confirmLabel={t("account.me.signOut")}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          onClose();
          void logout().then(() => {
            void navigate("/", { replace: true });
          });
        }}
      />
    </div>
  );
}
