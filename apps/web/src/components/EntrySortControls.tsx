import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import type { Transaction } from "@libellum/shared";
import { useI18n } from "../i18n/index.js";
import { entrySortAmounts, useFxMode } from "../lib/fxView.js";
import { useViewBookId } from "../lib/workspaceLedger.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { useDesktopActive } from "../desktop/surface.js";
import { DesktopPopover, moveFocusInList } from "../desktop/DesktopPopover.js";
import { BottomSheet } from "./BottomSheet.js";
import { ChevronIcon } from "./Icons.js";
import "./attachments.css";

export type EntryOrder = "timeDesc" | "timeAsc" | "amountDesc" | "amountAsc" | "storageDesc" | "storageAsc";
export interface EntryPresentation { order: EntryOrder; attachment: string; type: string; minMB: string; maxMB: string }
const FIELD_LABEL = { time: "sortFieldTime", amount: "sortFieldAmount", storage: "sortFieldStorage" } as const;
type SortField = keyof typeof FIELD_LABEL;
type SortDirection = "Asc" | "Desc";
const DIRECTION_LABEL = { Asc: "sortAscending", Desc: "sortDescending" } as const;
const INITIAL: EntryPresentation = { order: "timeDesc", attachment: "any", type: "", minMB: "", maxMB: "" };

function sortField(order: EntryOrder): SortField {
  return order.startsWith("time") ? "time" : order.startsWith("amount") ? "amount" : "storage";
}
function sortDirection(order: EntryOrder): SortDirection {
  return order.endsWith("Asc") ? "Asc" : "Desc";
}

export function presentEntries(entries: readonly Transaction[], options: EntryPresentation, amounts?: Record<string, string | null>): Transaction[] {
  const filtered = entries.filter(e => {
    const count = e.attachmentCount ?? 0, bytes = e.storageBytes ?? 0;
    return (options.attachment === "any" || (options.attachment === "has" ? count > 0 : count === 0))
      && (!options.type || (e.attachmentTypes ?? []).some(type => type.startsWith(options.type)))
      && (!options.minMB || bytes >= Number(options.minMB) * 1e6)
      && (!options.maxMB || bytes <= Number(options.maxMB) * 1e6);
  });
  const direction = options.order.endsWith("Asc") ? 1 : -1;
  return filtered.sort((a, b) => {
    let compared = 0;
    if (options.order.startsWith("amount")) {
      // 未启用折算时先按币种分组；不能直接比较不同币种的数字。
      if (!amounts && a.currency !== b.currency) return a.currency.localeCompare(b.currency);
      const av = amounts ? amounts[a.id] : String(a.amountCents), bv = amounts ? amounts[b.id] : String(b.amountCents);
      if (av == null || bv == null) return av == null && bv == null ? a.id.localeCompare(b.id) : av == null ? 1 : -1;
      const an = BigInt(av), bn = BigInt(bv);
      compared = an < bn ? -1 : an > bn ? 1 : 0;
    } else if (options.order.startsWith("storage")) {
      compared = (a.storageBytes ?? 0) - (b.storageBytes ?? 0);
    } else {
      compared = a.occurredLocalDate.localeCompare(b.occurredLocalDate) || a.occurredAt.localeCompare(b.occurredAt);
    }
    return compared * direction || b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id);
  });
}

export function useEntryPresentation(entries: readonly Transaction[], complete: boolean, initial: EntryPresentation = INITIAL, requiresComplete = false) {
  const [options, setOptions] = useState<EntryPresentation>(initial);
  const mode = useFxMode(), bookId = useViewBookId(), { offline } = useAccountOffline();
  const extended = requiresComplete || options.order !== "timeDesc" || options.attachment !== "any" || !!options.type || !!options.minMB || !!options.maxMB;
  const convert = mode.enabled && options.order.startsWith("amount");
  const fx = useQuery({ queryKey: ["entry-sort", mode.userId, bookId, mode.target, offline, entries.map(e => `${e.id}:${e.version}:${e.amountCents}:${e.currency}:${e.occurredLocalDate}`).join("|")],
    queryFn: ({ signal }) => entrySortAmounts(entries, mode.target, bookId ?? "", offline, signal),
    enabled: convert && complete, networkMode: "always", staleTime: 60_000, retry: false, meta: { volatile: true } });
  const waiting = extended && (!complete || (convert && fx.isPending));
  const ordered = useMemo(() => waiting || (convert && fx.isError) ? [] : presentEntries(entries, options, convert ? fx.data : undefined), [entries, options, waiting, convert, fx.data, fx.isError]);
  return { options, setOptions, extended, ordered, waiting, offline, error: convert && fx.isError,
    flat: !options.order.startsWith("time"), missingFx: convert && !!fx.data && Object.values(fx.data).some(v => v === null) };
}

export function EntrySortControls({ state, mode = "all" }: { state: ReturnType<typeof useEntryPresentation>; mode?: "all" | "sort" | "compact" | "filter" | "status" }): React.JSX.Element {
  const { t } = useI18n();
  const desktop = useDesktopActive();
  const [panel, setPanel] = useState<"sort" | "direction" | "filter" | null>(null);
  const sortAnchor = useRef<HTMLButtonElement>(null), directionAnchor = useRef<HTMLButtonElement>(null), filterAnchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setPanel(null), []);
  const field = sortField(state.options.order), direction = sortDirection(state.options.order);
  const anchor = panel === "sort" ? sortAnchor : panel === "direction" ? directionAnchor : filterAnchor;
  const count = Number(state.options.attachment !== "any") + Number(!!state.options.type) + Number(!!state.options.minMB || !!state.options.maxMB);
  const compact = mode === "compact";
  const showSort = mode !== "filter" && mode !== "status", showFilters = mode === "all" || mode === "filter";
  const title = t(panel === "sort" ? "attachments.sort" : panel === "direction" ? "attachments.sortDirection" : "attachments.filters.title");
  const content = (dismiss: () => void) => <>
    <header className="lv-entry-panel-heading"><h2 className="text-section-title">{title}</h2><button type="button" className="lv-entry-panel-close" aria-label={t("attachments.close")} onClick={dismiss}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></header>
    {panel === "sort" ? <><EntrySortOptions value={field} onSelect={next => { state.setOptions(o => ({ ...o, order: `${next}${sortDirection(o.order)}` })); if (!compact) dismiss(); if (desktop) sortAnchor.current?.focus(); }} />{compact ? <div className="lv-entry-direction-section"><h3 className="px-4 text-helper text-muted">{t("attachments.sortDirection")}</h3><EntryDirectionOptions value={direction} onSelect={next => { state.setOptions(o => ({ ...o, order: `${sortField(o.order)}${next}` })); }} /></div> : null}</>
      : panel === "direction" ? <EntryDirectionOptions value={direction} onSelect={next => { state.setOptions(o => ({ ...o, order: `${sortField(o.order)}${next}` })); dismiss(); if (desktop) directionAnchor.current?.focus(); }} />
      : <EntryFilterOptions value={state.options} onApply={filters => { state.setOptions(o => ({ ...filters, order: o.order })); dismiss(); if (desktop) filterAnchor.current?.focus(); }} />}
  </>;
  return <div className="lv-entry-presentation" data-mode={mode}>
    <div className="lv-entry-tools">
      {showSort ? compact ? <button ref={sortAnchor} type="button" className="lv-entry-sort-circle" aria-label={`${t("attachments.sort")} · ${t(`attachments.${FIELD_LABEL[field]}`)} · ${t(`attachments.${DIRECTION_LABEL[direction]}`)}`} title={t("attachments.sort")} aria-haspopup="dialog" aria-expanded={panel === "sort"} onClick={() => setPanel(p => p === "sort" ? null : "sort")}><DirectionIcon value={direction} /></button> : <div className="lv-entry-sort-group" role="group" aria-label={t("attachments.sort")}>
        <button ref={directionAnchor} type="button" className="lv-entry-tool lv-entry-direction" aria-label={`${t("attachments.sortDirection")} · ${t(`attachments.${DIRECTION_LABEL[direction]}`)}`} aria-haspopup="dialog" aria-expanded={panel === "direction"} onClick={() => setPanel(p => p === "direction" ? null : "direction")}>
          <DirectionIcon value={direction} />
        </button>
        <button ref={sortAnchor} type="button" className="lv-entry-tool" aria-label={`${t("attachments.sort")} · ${t(`attachments.${FIELD_LABEL[field]}`)}`} aria-haspopup="dialog" aria-expanded={panel === "sort"} onClick={() => setPanel(p => p === "sort" ? null : "sort")}>
          <span>{t(`attachments.${FIELD_LABEL[field]}`)}</span><ChevronIcon direction="down" className="size-3.5" />
        </button>
      </div> : null}
      {showFilters ? <><button ref={filterAnchor} type="button" className="lv-entry-tool" data-active={count > 0 || undefined} aria-haspopup="dialog" aria-expanded={panel === "filter"} onClick={() => setPanel(p => p === "filter" ? null : "filter")}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10m-7 6h4" /></svg><span>{t("attachments.filters.title")}</span>{count > 0 ? <span className="lv-entry-filter-count">{count}</span> : null}
      </button>
      {count > 0 ? <button type="button" className="lv-entry-clear text-helper" onClick={() => state.setOptions(o => ({ ...INITIAL, order: o.order }))}>{t("attachments.filters.clear")}</button> : null}</> : null}
    </div>
    {showFilters || mode === "status" ? <>
    {count > 0 ? <p className="lv-entry-filter-summary text-helper text-muted">{[state.options.attachment !== "any" ? t(state.options.attachment === "has" ? "attachments.has" : "attachments.none") : "", state.options.type ? t(`attachments.${TYPE_OPTIONS.find(([v]) => v === state.options.type)?.[1] ?? "anyType"}`) : "", state.options.minMB || state.options.maxMB ? `${state.options.minMB || "0"} – ${state.options.maxMB || t("attachments.filters.unlimited")} MB` : ""].filter(Boolean).join(" · ")}</p> : null}
    {state.offline && state.extended ? <p className="text-helper text-muted">{t("attachments.offlineSubset")}</p> : null}
    {state.waiting ? <p role="status" className="text-helper text-muted">{t("attachments.sortLoading")}</p> : null}
    {state.error ? <p role="alert" className="text-helper text-danger">{t("attachments.sortFailed")}</p> : null}
    {state.missingFx ? <p className="text-helper text-muted">{t("attachments.missingFx")}</p> : null}</> : null}
    {panel === null ? null : desktop ? <DesktopPopover anchor={anchor} label={title} placement="bottom-start" width={panel === "filter" ? 400 : 240} onClose={close}>{content(close)}</DesktopPopover>
      // 明细工具栏会做 transform 动画；面板挂到所属工作区，避免 fixed 被限制在工具栏内。
      : createPortal(<BottomSheet label={title} onClose={close} dialogClassName="lv-entry-sheet">{dismiss => content(dismiss)}</BottomSheet>, anchor.current?.closest("[data-instance]") ?? document.body)}
  </div>;
}

const TYPE_OPTIONS = [["", "anyType"], ["image/", "image"], ["application/pdf", "pdf"], ["audio/", "audio"], ["text/", "text"]] as const;

export function EntrySortOptions({ value, onSelect }: { value: SortField; onSelect: (value: SortField) => void }) {
  const { t } = useI18n();
  return <div className="lv-entry-order-list" role="group" aria-label={t("attachments.sort")} onKeyDown={moveFocusInList}>
    {(Object.keys(FIELD_LABEL) as SortField[]).map(field => <button type="button" key={field} aria-pressed={value === field} data-autofocus={value === field ? true : undefined} onClick={() => onSelect(field)}>
      <span>{t(`attachments.${FIELD_LABEL[field]}`)}</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ visibility: value === field ? undefined : "hidden" }}><path d="m5 12 4 4L19 6" /></svg>
    </button>)}
  </div>;
}

function DirectionIcon({ value }: { value: SortDirection }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={value === "Asc" ? "M12 20V4m-6 6 6-6 6 6" : "M12 4v16m-6-6 6 6 6-6"} /></svg>;
}

function EntryDirectionOptions({ value, onSelect }: { value: SortDirection; onSelect: (value: SortDirection) => void }) {
  const { t } = useI18n();
  return <div className="lv-entry-order-list" role="group" aria-label={t("attachments.sortDirection")} onKeyDown={moveFocusInList}>
    {(["Asc", "Desc"] as const).map(direction => <button type="button" key={direction} aria-pressed={value === direction} data-autofocus={value === direction ? true : undefined} onClick={() => onSelect(direction)}>
      <span className="lv-entry-order-label"><DirectionIcon value={direction} />{t(`attachments.${DIRECTION_LABEL[direction]}`)}</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ visibility: value === direction ? undefined : "hidden" }}><path d="m5 12 4 4L19 6" /></svg>
    </button>)}
  </div>;
}

export function validStorageRange(min: string, max: string): boolean {
  const valid = (v: string) => v === "" || (/^\d+(\.\d*)?$/.test(v) && Number.isFinite(Number(v)));
  return valid(min) && valid(max) && (!min || !max || Number(min) <= Number(max));
}

export function EntryFilterOptions({ value, onApply }: { value: EntryPresentation; onApply: (value: EntryPresentation) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const [attempted, setAttempted] = useState(false);
  const valid = validStorageRange(draft.minMB, draft.maxMB);
  const change = (patch: Partial<EntryPresentation>) => setDraft(o => ({ ...o, ...patch }));
  return <form className="lv-entry-filter-form" onSubmit={event => { event.preventDefault(); setAttempted(true); if (valid) onApply(draft); }}>
    <div className="lv-entry-filter-body">
      <fieldset><legend className="text-card-title">{t("attachments.title")}</legend><div className="lv-entry-choices">{(["any", "has", "none"] as const).map(v => <button type="button" key={v} aria-pressed={draft.attachment === v} onClick={() => change({ attachment: v })}>{t(`attachments.${v}`)}</button>)}</div></fieldset>
      <fieldset><legend className="text-card-title">{t("attachments.type")}</legend><div className="lv-entry-choices">{TYPE_OPTIONS.map(([v, k]) => <button type="button" key={v} aria-pressed={draft.type === v} onClick={() => change({ type: v })}>{t(`attachments.${k}`)}</button>)}</div></fieldset>
      <fieldset><legend className="text-card-title">{t("attachments.size")} <span className="text-helper text-muted">MB</span></legend><div className="lv-entry-range">
        <label><span className="text-helper text-muted">{t("attachments.minimum")}</span><input type="text" inputMode="decimal" placeholder="0" value={draft.minMB} aria-invalid={attempted && !valid || undefined} onChange={e => change({ minMB: e.target.value.trim() })} /></label><span aria-hidden="true">–</span>
        <label><span className="text-helper text-muted">{t("attachments.maximum")}</span><input type="text" inputMode="decimal" placeholder={t("attachments.filters.unlimited")} value={draft.maxMB} aria-invalid={attempted && !valid || undefined} onChange={e => change({ maxMB: e.target.value.trim() })} /></label>
      </div>{attempted && !valid ? <p role="alert" className="text-helper text-danger">{t("attachments.filters.invalidRange")}</p> : null}</fieldset>
    </div>
    <footer><button type="button" className="lv-entry-clear text-button" onClick={() => { setDraft({ ...INITIAL, order: value.order }); setAttempted(false); }}>{t("attachments.filters.reset")}</button><button type="submit" className="lv-entry-apply text-button">{t("attachments.filters.apply")}</button></footer>
  </form>;
}
