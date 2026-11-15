/**
 * 多页总览（1.19.102，候选清单 B2、B4）与布局预设（E2、E3）的界面：
 *
 * - 工具栏里的页面标签：点一下换页（这台设备记住停在哪一页）；「＋」新建页面；页面菜单（右键或「⋯」）改名、换位、
 *   切换「每本账一组」、删除。编辑中不能换页（保存针对的是正在编辑的那一页）。
 * - 新建页面可以从空白、复制当前页、系统预设或「每本账一组」开始。
 * - 编辑时卡片抽屉的「预设」：系统预设 + 我的预设（把当前布局存起来，最多 10 套，只存布局不存金额）。
 */
import { useCallback, useRef, useState } from "react";

import { BottomSheet } from "../components/BottomSheet.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useI18n } from "../i18n/index.js";
import type { WorkbenchDocuments } from "../statsWorkbench/storage.js";
import { newNativeCard } from "../statsWorkbench/nativeCards.js";
import { DesktopPopover, moveFocusInList } from "./DesktopPopover.js";
import { buildDashboardPreset, DASHBOARD_PRESET_IDS, type DashboardPresetId } from "./dashboardPresets.js";
import {
  createPage,
  deleteDashboardPreset,
  deletePage,
  loadDashboardPresets,
  MAX_PAGES,
  movePage,
  packCards,
  PAGE_NAME_MAX,
  renamePage,
  saveDashboardPreset,
  type DashboardPreset,
  type PageSummary,
} from "./dashboardStore.js";

export function pageLabel(page: PageSummary, index: number, t: ReturnType<typeof useI18n>["t"]): string {
  return page.name !== "" ? page.name : index === 0 ? t("desktop.dashboard.title") : t("desktop.dashboard.pages.untitled", { index: index + 1 });
}

/** 「每本账一组」的空白模板：一张账本卡片 + 一条支出趋势（浏览时每本账各一组）。 */
function perBookTemplate(bookId: string | undefined): WorkbenchDocuments {
  return packCards([
    { card: newNativeCard("ledger", "pb-ledger", bookId === undefined ? {} : { bookId }), size: { colSpan: 2, rowSpan: 2 } },
    { card: newNativeCard("trend", "pb-trend", bookId === undefined ? {} : { bookId }), size: { colSpan: 2, rowSpan: 2 } },
  ]);
}

type Start = "blank" | "copy" | "per-book" | DashboardPresetId;

export function DashboardPageTabs({ owner, pages, active, bookIds, currentDocuments, disabled, onSelect }: {
  readonly owner: string | null;
  readonly pages: readonly PageSummary[];
  readonly active: string;
  readonly bookIds: readonly string[];
  readonly currentDocuments: () => WorkbenchDocuments;
  readonly disabled: boolean;
  readonly onSelect: (pageId: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const addAnchor = useRef<HTMLButtonElement | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeMenu = useCallback(() => setMenuFor(null), []);
  if (owner === null) return <span />;
  const index = (id: string): number => pages.findIndex((page) => page.id === id);
  const fail = (ok: boolean): void => setProblem(ok ? null : t("desktop.dashboard.pages.failed"));

  return (
    <div className="lv-dash-pages" role="tablist" aria-label={t("desktop.dashboard.pages.label")}>
      {pages.map((page, at) => (
        <button
          key={page.id}
          type="button"
          role="tab"
          aria-selected={page.id === active}
          className="lv-dash-page-tab"
          disabled={disabled && page.id !== active}
          onClick={() => onSelect(page.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            menuAnchor.current = event.currentTarget;
            setMenuFor(page.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              menuAnchor.current = event.currentTarget;
              setMenuFor(page.id);
            }
          }}
        >
          {pageLabel(page, at, t)}
          {page.kind === "per-book" ? <span className="text-helper text-muted"> · {t("desktop.dashboard.pages.perBookShort")}</span> : null}
        </button>
      ))}
      <button
        type="button"
        className="lv-desk-icon-btn"
        aria-label={t("desktop.dashboard.pages.more", { name: pageLabel(pages[Math.max(0, index(active))] ?? pages[0]!, Math.max(0, index(active)), t) })}
        disabled={disabled}
        onClick={(event) => { menuAnchor.current = event.currentTarget; setMenuFor(active); }}
      >
        ⋯
      </button>
      <button ref={addAnchor} type="button" className="lv-desk-icon-btn" aria-label={t("desktop.dashboard.pages.add")} title={t("desktop.dashboard.pages.add")} disabled={disabled || pages.length >= MAX_PAGES} onClick={() => setAdding(true)}>
        ＋
      </button>
      {problem === null ? null : <span role="status" className="text-helper text-danger">{problem}</span>}

      {adding ? (
        <DesktopPopover anchor={addAnchor} label={t("desktop.dashboard.pages.add")} placement="bottom-start" width={300} onClose={closeAdd}>
          <NewPageForm
            onCreate={(name, start) => {
              const documents = start === "blank" ? packCards([]) : start === "copy" ? currentDocuments() : start === "per-book" ? perBookTemplate(bookIds[0]) : buildDashboardPreset(start, bookIds);
              const id = createPage(owner, bookIds, { name, documents, ...(start === "per-book" ? { kind: "per-book" as const } : {}) });
              fail(id !== null);
              if (id !== null) { closeAdd(); onSelect(id); }
            }}
          />
        </DesktopPopover>
      ) : null}

      {menuFor !== null ? (
        <DesktopPopover anchor={menuAnchor} label={t("desktop.dashboard.pages.menu")} placement="bottom-start" width={220} role="menu" onClose={closeMenu}>
          <ul className="p-1.5" onKeyDown={(event) => moveFocusInList(event)}>
            <li><button type="button" role="menuitem" className="lv-desk-menu-row" onClick={() => { setRenaming(menuFor); closeMenu(); }}><span className="flex-1 text-left text-body">{t("desktop.dashboard.pages.rename")}</span></button></li>
            <li><button type="button" role="menuitem" className="lv-desk-menu-row" disabled={index(menuFor) <= 0} onClick={() => { fail(movePage(owner, bookIds, menuFor, -1)); closeMenu(); }}><span className="flex-1 text-left text-body">{t("desktop.dashboard.pages.moveLeft")}</span></button></li>
            <li><button type="button" role="menuitem" className="lv-desk-menu-row" disabled={index(menuFor) >= pages.length - 1} onClick={() => { fail(movePage(owner, bookIds, menuFor, 1)); closeMenu(); }}><span className="flex-1 text-left text-body">{t("desktop.dashboard.pages.moveRight")}</span></button></li>
            <li><button type="button" role="menuitem" className="lv-desk-menu-row text-danger" disabled={pages.length <= 1} onClick={() => { setConfirmDelete(menuFor); closeMenu(); }}><span className="flex-1 text-left text-body">{t("desktop.dashboard.pages.delete")}</span></button></li>
          </ul>
        </DesktopPopover>
      ) : null}

      {renaming === null ? null : (
        <RenameSheet
          initial={pages.find((page) => page.id === renaming)?.name ?? ""}
          onSave={(name) => { const ok = renamePage(owner, bookIds, renaming, name); fail(ok); return ok; }}
          onClose={() => setRenaming(null)}
        />
      )}

      {confirmDelete === null ? null : (
        <ConfirmDialog
          open
          title={t("desktop.dashboard.pages.deleteTitle", { name: pageLabel(pages[index(confirmDelete)] ?? pages[0]!, index(confirmDelete), t) })}
          description={t("desktop.dashboard.pages.deleteBody")}
          confirmLabel={t("desktop.dashboard.pages.delete")}
          tone="danger"
          onConfirm={() => {
            const ok = deletePage(owner, bookIds, confirmDelete);
            fail(ok);
            if (ok && confirmDelete === active) onSelect(pages.find((page) => page.id !== confirmDelete)?.id ?? "main");
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function NewPageForm({ onCreate }: { readonly onCreate: (name: string, start: Start) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [start, setStart] = useState<Start>("blank");
  const starts: readonly Start[] = ["blank", "copy", "per-book", ...DASHBOARD_PRESET_IDS];
  return (
    <form className="flex flex-col gap-3 p-4" onSubmit={(event) => { event.preventDefault(); onCreate(name, start); }}>
      <label className="flex flex-col gap-1.5">
        <span className="text-helper text-muted">{t("desktop.dashboard.pages.name")}</span>
        <input className="lv-desk-input text-base" value={name} maxLength={PAGE_NAME_MAX} data-autofocus="" onChange={(event) => setName(event.target.value)} />
      </label>
      <fieldset className="flex flex-col gap-0.5">
        <legend className="pb-1 text-helper text-muted">{t("desktop.dashboard.pages.start")}</legend>
        {starts.map((value) => (
          <label key={value} className="flex min-h-10 items-start gap-3 py-1 text-body text-ink">
            <input type="radio" name="dashboard-page-start" className="mt-0.5 size-5 shrink-0 accent-brand" checked={start === value} onChange={() => setStart(value)} />
            <span className="flex flex-col">
              <span>{t(`desktop.dashboard.pages.starts.${value}`)}</span>
              <span className="text-helper text-muted">{t(`desktop.dashboard.pages.startHints.${value}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <button type="submit" className="lv-desk-btn lv-desk-btn-primary self-end">{t("desktop.dashboard.pages.create")}</button>
    </form>
  );
}

function RenameSheet({ initial, onSave, onClose }: { readonly initial: string; readonly onSave: (name: string) => boolean; readonly onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  return (
    <BottomSheet
      label={t("desktop.dashboard.pages.rename")}
      title={t("desktop.dashboard.pages.rename")}
      onClose={onClose}
      footer={(controls) => (
        <div className="flex justify-end gap-2 px-6 pb-5">
          <button type="button" className="lv-desk-btn" onClick={controls.close}>{t("desktop.common.cancel")}</button>
          <button type="button" className="lv-desk-btn lv-desk-btn-primary" onClick={() => { if (onSave(name)) controls.finish(); }}>{t("desktop.common.done")}</button>
        </div>
      )}
    >
      {() => (
        <div className="px-6 pt-1 pb-5">
          <input className="lv-desk-input w-full text-base" value={name} maxLength={PAGE_NAME_MAX} autoFocus aria-label={t("desktop.dashboard.pages.name")} onChange={(event) => setName(event.target.value)} />
        </div>
      )}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// 布局预设（编辑时卡片抽屉的「预设」）
// ---------------------------------------------------------------------------

export function DashboardPresetSheet({ owner, bookIds, current, apply, onClose }: {
  readonly owner: string | null;
  readonly bookIds: readonly string[];
  readonly current: WorkbenchDocuments;
  readonly apply: (documents: WorkbenchDocuments, name: string) => boolean;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [mine, setMine] = useState<readonly DashboardPreset[]>(() => loadDashboardPresets(owner));
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  return (
    <BottomSheet label={t("desktop.dashboard.presets.title")} title={t("desktop.dashboard.presets.title")} onClose={onClose}>
      {(close) => (
        <div className="flex flex-col gap-5 px-6 pt-1 pb-6">
          <p className="text-helper-relaxed text-muted">{t("desktop.dashboard.presets.hint")}</p>
          <section className="flex flex-col gap-2">
            <h3 className="text-helper font-medium text-muted">{t("desktop.dashboard.presets.system")}</h3>
            {DASHBOARD_PRESET_IDS.map((id) => (
              <div key={id} className="flex items-center gap-3 rounded-field border border-line bg-surface px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink">{t(`desktop.dashboard.pages.starts.${id}`)}</span>
                  <span className="text-helper text-muted">{t(`desktop.dashboard.pages.startHints.${id}`)}</span>
                </span>
                <button type="button" className="lv-desk-btn" onClick={() => { if (apply(buildDashboardPreset(id, bookIds), t(`desktop.dashboard.pages.starts.${id}`))) close(); }}>
                  {t("desktop.dashboard.presets.apply")}
                </button>
              </div>
            ))}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-helper font-medium text-muted">{t("desktop.dashboard.presets.mine")}</h3>
            {mine.length === 0 ? <p className="text-helper text-muted">{t("desktop.dashboard.presets.mineEmpty")}</p> : null}
            {mine.map((preset) => (
              <div key={preset.id} className="flex items-center gap-3 rounded-field border border-line bg-surface px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-body text-ink">{preset.name}</span>
                <button type="button" className="lv-desk-btn" onClick={() => { if (apply(preset.documents, preset.name)) close(); }}>{t("desktop.dashboard.presets.apply")}</button>
                <button type="button" className="lv-desk-btn" onClick={() => { if (owner !== null && deleteDashboardPreset(owner, preset.id)) setMine(loadDashboardPresets(owner)); }}>{t("desktop.dashboard.presets.delete")}</button>
              </div>
            ))}
            {owner === null ? null : (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const result = saveDashboardPreset(owner, name, current);
                  setMessage(t(`desktop.dashboard.presets.results.${result}`));
                  if (result === "ok") { setName(""); setMine(loadDashboardPresets(owner)); }
                }}
              >
                <input className="lv-desk-input min-w-0 flex-1 text-base" value={name} maxLength={20} placeholder={t("desktop.dashboard.presets.namePlaceholder")} aria-label={t("desktop.dashboard.presets.name")} onChange={(event) => setName(event.target.value)} />
                <button type="submit" className="lv-desk-btn">{t("desktop.dashboard.presets.save")}</button>
              </form>
            )}
            {message === null ? null : <p role="status" className="text-helper text-muted">{message}</p>}
          </section>
        </div>
      )}
    </BottomSheet>
  );
}
