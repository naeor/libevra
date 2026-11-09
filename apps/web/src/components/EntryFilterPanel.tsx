import { useCallback, useMemo, useState, useId, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CURRENCIES, type LedgerMetaResponse } from "@libellum/shared";
import { useI18n } from "../i18n/index.js";
import { ALL_MONTHS, currentMonth, formatInstant, isAllMonths } from "../lib/datetime.js";
import { currencyName } from "../lib/format.js";
import { displayCategoryName, displayPaymentMethodName } from "../lib/presetNames.js";
import { activeFilterDimensions, clearFilterDimension, detailFilterPredicate, emptyDetailFilters, FILTER_DIMENSIONS, validDetailDates, type DetailFilters, type FilterDimension } from "../lib/detailFilters.js";
import { useDesktopActive } from "../desktop/surface.js";
import { DesktopPopover } from "../desktop/DesktopPopover.js";
import { BottomSheet } from "./BottomSheet.js";
import { LedgerMonthPicker } from "./LedgerMonthPicker.js";
import { ChevronIcon } from "./Icons.js";
import { validStorageRange } from "./EntrySortControls.js";
import "./entry-filters.css";
import { Switch } from "./ui/PurposeControls.js";
import { setFilterSync, useFilterSync } from "../lib/ledgerFilter.js";
import { useFilterOwner } from "../lib/usePageFilter.js";
import { useViewBookId } from "../lib/workspaceLedger.js";

/**
 * 1.19.53：筛选不再存在地址栏里，而是本机保存的那一份（`lib/ledgerFilter.ts`，明细与分析默认共用）；
 * 这里只负责谓词、标签与应用。`value` / `onChange` 由页面从 `usePageFilter` 传入。
 */
export function useDetailFilters(value: DetailFilters, onChange: (next: DetailFilters) => void, ledger?: LedgerMetaResponse) {
  const predicate = useMemo(() => detailFilterPredicate(value, ledger?.categories ?? []), [value, ledger?.categories]);
  const apply = useCallback((next: DetailFilters) => { onChange(next); }, [onChange]);
  const dimensions = activeFilterDimensions(value);
  const names = useFilterLabels(value, ledger);
  return { value, apply, predicate, key: JSON.stringify(value),
    extended: dimensions.some(d => d !== "time") || !!value.from || !!value.to,
    label: names.label };
}

function useFilterLabels(value: DetailFilters, ledger?: LedgerMetaResponse) {
  const { t } = useI18n();
  const dimensionLabel = (key: FilterDimension): string => {
    if (key === "time") return !isAllMonths(value.month) ? formatInstant(new Date(`${value.month}-01T12:00:00`), { year: "numeric", month: "long" })
      : value.from || value.to ? `${value.from} – ${value.to}` : t("ledger.filters.all");
    if (key === "attachments") return value.attachment !== "any" && !value.type && !value.minMB && !value.maxMB ? t(value.attachment === "has" ? "attachments.has" : "attachments.none") : t("ledger.filters.attachments");
    const values = value[key];
    if (values.length !== 1) return t("ledger.filters.values", { name: t(`ledger.filters.${key}`), count: values.length });
    const id = values[0]!;
    if (key === "categories") return displayCategoryName(ledger?.categories.find(item => item.id === id)?.name ?? id);
    if (key === "payments") return id === "none" ? t("ledger.filters.nonePayment") : displayPaymentMethodName(ledger?.paymentMethods.find(item => item.id === id)?.name ?? id);
    if (key === "tags") return ledger?.tags.find(item => item.id === id)?.name ?? id;
    return currencyName(id);
  };
  const active = activeFilterDimensions(value);
  const label = active.length === 0 ? t("ledger.filters.all") : active.length > 1 ? t("ledger.filters.multiple", { count: active.length })
    : active[0] === "time" && (value.from || value.to) ? t("ledger.filters.dateRange") : dimensionLabel(active[0]!);
  return { label, dimensionLabel };
}

export function FilterIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 5h16l-6 7v7l-4-2v-5Z" /></svg>; }

export function EntryFilterPanel({ open, value, ledger, anchor, onApply, onClose, note }: {
  open: boolean; value: DetailFilters; ledger?: LedgerMetaResponse | undefined; anchor: RefObject<HTMLButtonElement | null>; onApply: (value: DetailFilters) => void; onClose: () => void;
  /** 分析页的补充说明（例如附件条件只作用于明细）。 */
  note?: string | null;
}) {
  const { t } = useI18n();
  const desktop = useDesktopActive();
  const closeDesktop = useCallback(() => { onClose(); anchor.current?.focus({ preventScroll: true }); }, [onClose, anchor]);
  if (!open) return null;
  const content = (dismiss: () => void) => <FilterForm desktop={desktop} value={value} ledger={ledger} note={note ?? null} onClose={dismiss} onApply={next => { onApply(next); dismiss(); }} />;
  return desktop ? <DesktopPopover anchor={anchor} label={t("ledger.filters.title")} placement="bottom-start" width={680} onClose={closeDesktop}>{content(closeDesktop)}</DesktopPopover>
    : createPortal(<BottomSheet label={t("ledger.filters.title")} onClose={onClose} dialogClassName="lv-filter-sheet">{content}</BottomSheet>, anchor.current?.closest("[data-instance]") ?? document.body);
}

export function FilterForm({ value, ledger, onApply, onClose, desktop = false, note = null }: { value: DetailFilters; ledger?: LedgerMetaResponse | undefined; onApply: (value: DetailFilters) => void; onClose: () => void; desktop?: boolean; note?: string | null }) {
  const { t } = useI18n();
  const uid = useId();
  const [draft, setDraft] = useState(value);
  const [section, setSection] = useState<FilterDimension>("time");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(value.categories));
  const [rangeMode, setRangeMode] = useState(!!value.from || !!value.to);
  const [attempted, setAttempted] = useState(false);
  const labels = useFilterLabels(draft, ledger);
  const active = activeFilterDimensions(draft);
  const change = (patch: Partial<DetailFilters>) => setDraft(old => ({ ...old, ...patch }));
  const toggle = (key: "categories" | "payments" | "tags" | "currencies", id: string) => change({ [key]: draft[key].includes(id) ? draft[key].filter(v => v !== id) : [...draft[key], id], ...(key === "categories" && draft[key].includes(id) ? { branches: draft.branches.filter(v => v !== id) } : {}) });
  const query = search.trim().toLocaleLowerCase();
  const options = section === "categories" ? (ledger?.categories ?? []).map(c => ({ id: c.id, name: displayCategoryName(c.name), parent: c.parentId, kind: c.kind }))
    : section === "payments" ? [{ id: "none", name: t("ledger.filters.nonePayment") }, ...(ledger?.paymentMethods ?? []).map(p => ({ id: p.id, name: displayPaymentMethodName(p.name) }))]
    : section === "tags" ? (ledger?.tags ?? []).map(tag => ({ id: tag.id, name: tag.name }))
    : section === "currencies" ? CURRENCIES.map(id => ({ id, name: `${id} · ${currencyName(id)}` })) : [];
  const visible = (item: typeof options[number]): boolean => {
    if (query) return item.name.toLocaleLowerCase().includes(query);
    if (section !== "categories") return true;
    let parent = "parent" in item ? item.parent as string | null : null;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) { if (!expanded.has(parent)) return false; seen.add(parent); parent = ledger?.categories.find(c => c.id === parent)?.parentId ?? null; }
    return true;
  };
  const datesValid = validDetailDates(draft) && (!rangeMode || !!draft.from && !!draft.to);
  const storageValid = validStorageRange(draft.minMB, draft.maxMB);
  return <form className="lv-filter-panel" data-desktop={desktop || undefined} onSubmit={event => { event.preventDefault(); setAttempted(true); if (datesValid && storageValid) onApply(draft); }}>
    <header className="lv-filter-heading"><h2 className="text-section-title">{t("ledger.filters.title")}</h2><button type="button" className="lv-filter-icon" aria-label={t("ledger.filters.close")} onClick={onClose}>×</button></header>
    <div className="lv-filter-chips" aria-label={t("ledger.filters.selected")}>
      {active.length === 0 ? <span className="text-helper text-muted">{t("ledger.filters.all")}</span> : active.map(key => <button type="button" key={key} title={labels.dimensionLabel(key)} aria-label={t("ledger.filters.clear", { name: t(`ledger.filters.${key}`) })} onClick={() => { setDraft(clearFilterDimension(draft, key)); if (key === "time") setRangeMode(false); }}><span>{labels.dimensionLabel(key)}</span><span aria-hidden="true">×</span></button>)}
    </div>
    <div className="lv-filter-content">
      <div className="lv-filter-nav" role="tablist" aria-label={t("ledger.filters.title")} aria-orientation="vertical" onKeyDown={event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
        const index = tabs.indexOf(event.target as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
      }}>
        {FILTER_DIMENSIONS.map(key => <button type="button" role="tab" aria-selected={section === key} id={`${uid}-filter-tab-${key}`} aria-controls={`${uid}-filter-options`} key={key} onClick={() => { setSection(key); setSearch(""); }}><span>{t(`ledger.filters.${key}`)}</span>{active.includes(key) ? <span className="lv-filter-dot" /> : null}</button>)}
      </div>
      <div className="lv-filter-options" id={`${uid}-filter-options`} role="tabpanel" aria-labelledby={`${uid}-filter-tab-${section}`}>
        {section === "time" ? <>
          <div className="lv-filter-segments">
            <button type="button" aria-pressed={!rangeMode} onClick={() => { if (rangeMode) { setRangeMode(false); change({ month: ALL_MONTHS, from: "", to: "" }); } }}>{t("desktop.entries.month")}</button>
            <button type="button" aria-pressed={rangeMode} onClick={() => { if (!rangeMode) { setRangeMode(true); change({ month: ALL_MONTHS, from: "", to: "" }); } }}>{t("ledger.filters.range")}</button>
          </div>
          {rangeMode ? <div className="lv-filter-date-range">{(["from", "to"] as const).map(key => <label key={key} className="text-body">{t(`ledger.filters.${key}`)}<input type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={draft[key]} onChange={event => change({ [key]: event.target.value })} aria-invalid={attempted && !datesValid || undefined} /></label>)}<p className="text-helper text-muted">{t("ledger.filters.dateHint")}</p></div>
            : <LedgerMonthPicker open month={draft.month} maxMonth={currentMonth()} onSelect={() => {}} onClose={() => {}} render={({ year, onYearChange, availability, loading, statusNote }) => <>
              <button type="button" className="lv-filter-option lv-filter-all-time" aria-pressed={isAllMonths(draft.month)} onClick={() => change({ month: ALL_MONTHS, from: "", to: "" })}>{t("ledger.filters.all")}<Check visible={isAllMonths(draft.month)} /></button>
              <div className="lv-filter-year"><button type="button" className="lv-filter-icon" aria-label={t("ledger.filters.previousYear")} onClick={() => onYearChange(year - 1)}><ChevronIcon direction="left" /></button><span className="text-card-title">{year}</span><button type="button" className="lv-filter-icon" aria-label={t("ledger.filters.nextYear")} disabled={year >= Number(currentMonth().slice(0, 4))} onClick={() => onYearChange(year + 1)}><ChevronIcon direction="right" /></button></div>
              <div className="lv-filter-months">{Array.from({ length: 12 }, (_, index) => { const month = `${year}-${String(index + 1).padStart(2, "0")}`; return <button type="button" key={month} aria-pressed={draft.month === month} disabled={month > currentMonth() || availability[month] === false || loading && availability[month] !== true} onClick={() => change({ month, from: "", to: "" })}>{formatInstant(new Date(year, index, 1), { month: "short" })}</button>; })}</div><p className="mt-3 text-helper text-muted" role="status">{statusNote}</p>
            </>} />}
        </> : section === "attachments" ? <div className="lv-filter-attachment">
          <fieldset><legend className="text-card-title">{t("attachments.title")}</legend><div className="lv-filter-choices">{(["any", "has", "none"] as const).map(v => <button type="button" key={v} aria-pressed={draft.attachment === v} onClick={() => change({ attachment: v, ...(v === "none" ? { type: "" } : {}) })}>{t(`attachments.${v}`)}</button>)}</div></fieldset>
          <fieldset><legend className="text-card-title">{t("attachments.type")}</legend><div className="lv-filter-choices">{([["", "anyType"], ["image/", "image"], ["application/pdf", "pdf"], ["audio/", "audio"], ["text/", "text"]] as const).map(([v, key]) => <button type="button" key={key} aria-pressed={draft.type === v} onClick={() => change({ type: v!, ...(v ? { attachment: "has" } : {}) })}>{t(`attachments.${key}`)}</button>)}</div></fieldset>
          <fieldset><legend className="text-card-title">{t("attachments.size")} (MB)</legend><div className="lv-filter-size">{(["minMB", "maxMB"] as const).map((key, index) => <label key={key} className="text-helper">{t(index === 0 ? "attachments.minimum" : "attachments.maximum")}<input type="text" inputMode="decimal" value={draft[key]} placeholder={index === 0 ? "0" : t("ledger.filters.unlimited")} onChange={event => change({ [key]: event.target.value.trim() })} aria-invalid={attempted && !storageValid || undefined} /></label>)}</div></fieldset>
        </div> : <>
          <input className="lv-filter-search" type="search" aria-label={t("ledger.filters.search")} placeholder={t("ledger.filters.search")} value={search} onChange={event => setSearch(event.target.value)} />
          <button type="button" className="lv-filter-option" aria-pressed={draft[section].length === 0} onClick={() => setDraft(clearFilterDimension(draft, section))}>{t("ledger.filters.unlimited")}<Check visible={draft[section].length === 0} /></button>
          {options.filter(visible).map(item => { const children = section === "categories" && ledger?.categories.some(c => c.parentId === item.id); return <div key={item.id}>
            <div className="lv-filter-option-row" data-child={section === "categories" && "parent" in item && !!item.parent || undefined}>
              <button type="button" className="lv-filter-option" aria-pressed={draft[section].includes(item.id)} onClick={() => toggle(section, item.id)}><span>{item.name}{section === "categories" && "kind" in item ? <span className="ml-2 text-helper text-muted">{t(item.kind === "income" ? "desktop.entries.income" : "desktop.entries.expense")}</span> : null}</span><Check visible={draft[section].includes(item.id)} /></button>
              {children ? <button type="button" className="lv-filter-icon" aria-expanded={expanded.has(item.id)} aria-label={t(expanded.has(item.id) ? "ledger.filters.collapse" : "ledger.filters.expand", { name: item.name })} onClick={() => setExpanded(old => { const next = new Set(old); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}><ChevronIcon direction={expanded.has(item.id) ? "down" : "right"} /></button> : null}
            </div>
            {children && draft.categories.includes(item.id) ? <label className="lv-filter-branch text-helper"><input type="checkbox" checked={draft.branches.includes(item.id)} onChange={event => change({ branches: event.target.checked ? [...draft.branches, item.id] : draft.branches.filter(v => v !== item.id) })} />{t("ledger.filters.branch")}</label> : null}
          </div>; })}
          {options.filter(visible).length === 0 ? <p className="lv-filter-empty text-helper text-muted">{t("ledger.filters.noOptions")}</p> : null}
        </>}
      </div>
    </div>
    {attempted && (!datesValid || !storageValid) ? <p role="alert" className="px-4 text-helper text-danger">{t(!datesValid ? "ledger.filters.invalidDates" : "attachments.filters.invalidRange")}</p> : null}
    {note ? <p className="lv-filter-note px-4 text-helper-relaxed text-muted">{note}</p> : null}
    <FilterSyncRow />
    <footer className="lv-filter-footer"><button type="button" className="text-button text-brand" onClick={() => { setDraft(emptyDetailFilters(currentMonth())); setRangeMode(false); setAttempted(false); }}>{t("ledger.filters.reset")}</button><button type="submit" className="lv-filter-apply text-button">{t("ledger.filters.apply")}</button></footer>
  </form>;
}
function Check({ visible }: { visible: boolean }) { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ visibility: visible ? undefined : "hidden", flexShrink: 0 }}><path d="m5 12 4 4L19 6" /></svg>; }

/**
 * “明细与分析使用同一筛选”（1.19.53）。设备偏好，立即生效，不属于面板里尚未应用的草稿；
 * 记账偏好里是同一个开关（`FilterSyncSetting`）。
 */
function FilterSyncRow() {
  const { t } = useI18n();
  const sync = useFilterSync();
  const owner = useFilterOwner();
  const bookId = useViewBookId();
  return <div className="lv-filter-sync">
    <Switch checked={sync} onCheckedChange={next => { setFilterSync(next, owner !== null && bookId !== null ? { owner, bookId } : null); }} className="lv-filter-sync-switch">
      <span className="flex min-w-0 flex-col text-left"><span className="text-card-title text-ink">{t("ledger.filters.sync")}</span><span className="text-helper text-muted">{t(sync ? "ledger.filters.syncOn" : "ledger.filters.syncOff")}</span></span>
    </Switch>
  </div>;
}

/** 记账偏好里的同一个开关（1.19.53）。 */
export function FilterSyncSetting() {
  const { t } = useI18n();
  const sync = useFilterSync();
  const owner = useFilterOwner();
  const bookId = useViewBookId();
  const [failed, setFailed] = useState(false);
  return <section className="lv-settings-flat rounded-card border border-line bg-surface p-5">
    <label className="flex min-h-11 items-center justify-between gap-4 text-card-title text-ink">
      <span>{t("ledger.filters.sync")}</span><input type="checkbox" role="switch" aria-label={t("ledger.filters.sync")} checked={sync}
        onChange={event => setFailed(!setFilterSync(event.target.checked, owner !== null && bookId !== null ? { owner, bookId } : null))} className="size-5 shrink-0 accent-brand" />
    </label>
    <p className="mt-2 text-helper-relaxed text-muted">{t("ledger.filters.syncHint")}</p>
    {failed ? <p role="alert" className="mt-2 text-helper text-danger">{t("ledger.filters.syncSaveError")}</p> : null}
  </section>;
}
