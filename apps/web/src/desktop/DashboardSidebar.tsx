/**
 * **总览右侧栏**（1.19.101，候选清单 D1–D4）：一列可以自定义的模块——快捷操作、新消息、待处理、最近账目、账本列表。
 *
 * - 模块可以显示 / 隐藏、调整顺序（「自定义侧栏」）；每个模块的标题可以点一下收起。
 * - 快捷操作：选显示哪几种记账方式、什么顺序，可以只显示图标（是否可用仍按原来的判断，游客不能用的照样禁用）。
 * - 新消息：可以不显示账户提醒，选最多几条；最近账目：选几条。
 * - 设置记在本机（与时间范围等口径同一份），改了立即生效，不需要进总览编辑。
 */
import { useContext, useMemo } from "react";
import { useNavigate } from "react-router";
import type { Transaction } from "@libellum/shared";

import { BottomSheet } from "../components/BottomSheet.js";
import { ChevronIcon } from "../components/Icons.js";
import { useI18n } from "../i18n/index.js";
import { formatMoney } from "../lib/format.js";
import { useGuestMode } from "../lib/guest/session.js";
import { sortByTime } from "../pages/DetailPage.js";
import { EntryMethodList } from "../workspace/RailEntryMenu.js";
import { bookFigures } from "./dashboardData.js";
import { DashboardMessages } from "./DashboardMessages.js";
import { dashboardDestination } from "./dashboardNavigation.js";
import { DashboardViewContext, PendingBody, RecentRows, type DashboardBook } from "./DashboardNativeCards.js";
import { useDashboardBooks } from "./dashboardScopes.js";
import { ENTRY_METHOD_IDS, SIDEBAR_KINDS, SIDEBAR_LIMITS, type SidebarConfig, type SidebarKind, type SidebarModule } from "./dashboardStore.js";
import { desktopEntryDisabled, useEnterLedger } from "./DesktopNav.js";

function updateModule(config: SidebarConfig, kind: SidebarKind, patch: (module: SidebarModule) => SidebarModule): SidebarConfig {
  return { modules: config.modules.map((module) => (module.kind === kind ? patch(module) : module)) };
}

export function DashboardSidebar({ config, books, onChange, onCustomize }: {
  readonly config: SidebarConfig;
  readonly books: readonly DashboardBook[];
  readonly onChange: (config: SidebarConfig) => void;
  readonly onCustomize: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <div className="lv-dash-sidebar-head">
        <button type="button" className="lv-desk-link" onClick={onCustomize}>{t("desktop.dashboard.sidebar.customize")}</button>
      </div>
      {config.modules.length === 0 ? <p className="text-helper text-muted">{t("desktop.dashboard.sidebar.empty")}</p> : null}
      {config.modules.map((module) => (
        <section key={module.kind} className="lv-dash-module" aria-label={t(`desktop.dashboard.sidebar.kinds.${module.kind}`)}>
          <h2 className="text-card-title text-ink">
            <button
              type="button"
              className="lv-dash-module-toggle"
              aria-expanded={module.collapsed !== true}
              onClick={() => onChange(updateModule(config, module.kind, (item) => (item.collapsed === true ? { ...item, collapsed: false } : { ...item, collapsed: true })))}
            >
              <span className="min-w-0 flex-1 truncate text-left">{t(`desktop.dashboard.sidebar.kinds.${module.kind}`)}</span>
              <ChevronIcon up={module.collapsed !== true} className="size-4 shrink-0 text-muted" />
            </button>
          </h2>
          {module.collapsed === true ? null : <ModuleBody module={module} books={books} />}
        </section>
      ))}
    </>
  );
}

function ModuleBody({ module, books }: { readonly module: SidebarModule; readonly books: readonly DashboardBook[] }): React.JSX.Element {
  switch (module.kind) {
    case "quick":
      return <QuickModule module={module} />;
    case "messages":
      return <DashboardMessages books={books} account={module.account !== false} limit={module.limit ?? 4} heading={false} />;
    case "pending":
      return <PendingBody width={360} height={200} />;
    case "recent":
      return <RecentModule limit={module.limit ?? 5} />;
    case "books":
      return <BooksModule />;
  }
}

function QuickModule({ module }: { readonly module: SidebarModule }): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const navigate = useNavigate();
  return (
    <div className="lv-dash-quick">
      <div className="lv-dash-quick-grid" role="menu" aria-label={t("desktop.dashboard.cards.quick")} data-icon-only={module.iconOnly === true ? "true" : undefined}>
        <EntryMethodList
          {...(module.methods === undefined ? {} : { only: module.methods })}
          disabledFor={(action) => desktopEntryDisabled(action, guest)}
          onNavigate={(path, prepare) => {
            prepare?.();
            void navigate(path);
          }}
        />
      </div>
    </div>
  );
}

function RecentModule({ limit }: { readonly limit: number }): React.JSX.Element {
  const view = useContext(DashboardViewContext);
  const data = useDashboardBooks();
  const books = view?.bookIds ?? [];
  const items = useMemo(() => {
    const all: { readonly entry: Transaction; readonly bookId: string }[] = [];
    for (const bookId of books) for (const entry of data.get(bookId)?.recent ?? []) all.push({ entry, bookId });
    const order = new Map(sortByTime(all.map((item) => item.entry)).map((entry, index) => [entry.id, index]));
    return [...all].sort((a, b) => (order.get(a.entry.id) ?? 0) - (order.get(b.entry.id) ?? 0)).slice(0, limit);
  }, [books, data, limit]);
  return <RecentRows items={items} width={320} height={limit * 44} showBook={false} />;
}

/** 账本列表：总览范围里的每本账、这段时间的支出（主币种），点一下切换到那本账。 */
function BooksModule(): React.JSX.Element {
  const { t } = useI18n();
  const view = useContext(DashboardViewContext);
  const data = useDashboardBooks();
  const switcher = useEnterLedger();
  if (view === null) return <span />;
  return (
    <ul className="flex flex-col">
      {view.bookIds.map((bookId) => {
        const book = view.books.get(bookId);
        const figures = bookFigures(data.get(bookId)?.scope, view.mainCode);
        const main = figures.totals[0];
        return (
          <li key={bookId}>
            <button type="button" className="lv-dash-row lv-native-row" disabled={switcher.busy} onClick={() => switcher.enter(bookId, undefined, dashboardDestination(view.month))}>
              <span className="min-w-0 flex-1 truncate text-body text-ink">{book?.name ?? "—"}</span>
              {bookId === view.currentBookId ? <span className="shrink-0 text-helper text-brand-dark">{t("desktop.dashboard.currentLedger")}</span> : null}
              <span className="shrink-0 text-body tabular-nums text-ink" data-amount="">
                {figures.state !== "ready" ? "…" : main === undefined ? "—" : formatMoney(main.expense, main.currency)}
              </span>
            </button>
          </li>
        );
      })}
      {switcher.status === null ? null : <li role="status" className="text-helper text-danger">{switcher.status}</li>}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 自定义侧栏
// ---------------------------------------------------------------------------

export function SidebarCustomizer({ config, onChange, onClose }: {
  readonly config: SidebarConfig;
  readonly onChange: (config: SidebarConfig) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const shown = new Map(config.modules.map((module, index) => [module.kind, index] as const));
  const ordered: readonly SidebarKind[] = [...config.modules.map((module) => module.kind), ...SIDEBAR_KINDS.filter((kind) => !shown.has(kind))];
  const move = (kind: SidebarKind, delta: -1 | 1): void => {
    const modules = [...config.modules];
    const index = modules.findIndex((module) => module.kind === kind);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= modules.length) return;
    [modules[index], modules[target]] = [modules[target]!, modules[index]!];
    onChange({ modules });
  };
  const toggle = (kind: SidebarKind, on: boolean): void => {
    onChange({ modules: on ? [...config.modules, { kind }] : config.modules.filter((module) => module.kind !== kind) });
  };
  return (
    <BottomSheet label={t("desktop.dashboard.sidebar.title")} title={t("desktop.dashboard.sidebar.title")} onClose={onClose}>
      {() => (
        <div className="flex flex-col gap-4 px-6 pt-1 pb-6">
          <p className="text-helper-relaxed text-muted">{t("desktop.dashboard.sidebar.hint")}</p>
          <ol className="flex flex-col gap-2">
            {ordered.map((kind) => {
              const index = shown.get(kind);
              const module = index === undefined ? undefined : config.modules[index];
              return (
                <li key={kind} className="flex flex-col gap-2 rounded-field border border-line bg-surface px-3 py-2">
                  <div className="flex items-center gap-2">
                    <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-body text-ink">
                      <input type="checkbox" className="size-5 accent-brand" checked={module !== undefined} onChange={(event) => toggle(kind, event.target.checked)} />
                      <span className="truncate">{t(`desktop.dashboard.sidebar.kinds.${kind}`)}</span>
                    </label>
                    <button type="button" className="lv-desk-icon-btn" aria-label={t("statsWorkbench.containers.moveUp")} disabled={index === undefined || index === 0} onClick={() => move(kind, -1)}>
                      <ChevronIcon up className="size-4" />
                    </button>
                    <button type="button" className="lv-desk-icon-btn" aria-label={t("statsWorkbench.containers.moveDown")} disabled={index === undefined || index === config.modules.length - 1} onClick={() => move(kind, 1)}>
                      <ChevronIcon className="size-4" />
                    </button>
                  </div>
                  {module === undefined ? null : <ModuleOptions module={module} onChange={(next) => onChange(updateModule(config, kind, () => next))} />}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </BottomSheet>
  );
}

function ModuleOptions({ module, onChange }: { readonly module: SidebarModule; readonly onChange: (module: SidebarModule) => void }): React.JSX.Element | null {
  const { t } = useI18n();
  if (module.kind === "quick") {
    const methods = module.methods ?? ENTRY_METHOD_IDS;
    const chosen = new Set(methods);
    return (
      <div className="flex flex-col gap-1 pl-8">
        <div className="flex flex-wrap gap-x-4">
          {ENTRY_METHOD_IDS.map((id) => (
            <label key={id} className="flex min-h-11 items-center gap-2 text-body text-ink">
              <input
                type="checkbox"
                className="size-5 accent-brand"
                checked={chosen.has(id)}
                onChange={(event) => {
                  // 顺序按勾选的先后；至少留一种。
                  const next = event.target.checked ? [...methods, id] : methods.filter((item) => item !== id);
                  if (next.length > 0) onChange({ ...module, methods: next });
                }}
              />
              {/* 电脑版「拍照识别」叫「照片识别」（所有者 2026-11-01），与记账菜单一致。 */}
              {id === "scan" ? t("desktop.nav.photoRecognition") : t(`nav.entry.${id as "manual"}.label`)}
            </label>
          ))}
        </div>
        <label className="flex min-h-11 items-center gap-2 text-body text-ink">
          <input type="checkbox" className="size-5 accent-brand" checked={module.iconOnly === true} onChange={(event) => {
            const { iconOnly: _iconOnly, ...rest } = module;
            onChange(event.target.checked ? { ...rest, iconOnly: true } : rest);
          }} />
          {t("desktop.dashboard.sidebar.iconOnly")}
        </label>
      </div>
    );
  }
  if (module.kind === "messages" || module.kind === "recent") {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8">
        {module.kind === "messages" ? (
          <label className="flex min-h-11 items-center gap-2 text-body text-ink">
            <input type="checkbox" className="size-5 accent-brand" checked={module.account !== false} onChange={(event) => {
              const { account: _account, ...rest } = module;
              onChange(event.target.checked ? rest : { ...rest, account: false });
            }} />
            {t("desktop.dashboard.sidebar.account")}
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-body text-ink">
          {t("desktop.dashboard.sidebar.limit")}
          <select className="lv-dash-select rounded-field border border-line bg-surface text-base" value={module.limit ?? (module.kind === "messages" ? 4 : 5)} onChange={(event) => onChange({ ...module, limit: Number(event.target.value) })}>
            {SIDEBAR_LIMITS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
    );
  }
  return null;
}
