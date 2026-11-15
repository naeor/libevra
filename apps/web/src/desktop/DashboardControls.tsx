/**
 * 总览工具栏的三个口径控件（1.19.100）：时间范围、统计设置（统计方式 + 总览范围）、金额遮罩。
 * 改了立即生效、记在本机（`dashboardStore.ts`），不需要进编辑。
 */
import { useCallback, useRef, useState } from "react";

import { ChevronIcon } from "../components/Icons.js";
import { LedgerMonthPicker } from "../components/LedgerMonthPicker.js";
import { useI18n } from "../i18n/index.js";
import { currentMonth, formatLocalDate } from "../lib/datetime.js";
import { DesktopPopover } from "./DesktopPopover.js";
import type { DashboardBook } from "./DashboardNativeCards.js";
import type { DashboardSettings, DashboardTime } from "./dashboardStore.js";

const QUICK_TIMES: readonly DashboardTime[] = [
  { kind: "this-month" },
  { kind: "last-month" },
  { kind: "preset", preset: "7d" },
  { kind: "preset", preset: "30d" },
  { kind: "preset", preset: "90d" },
  { kind: "ytd" },
  { kind: "preset", preset: "365d" },
];

function sameTime(a: DashboardTime, b: DashboardTime): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useTimeLabel(): (time: DashboardTime) => string {
  const { t } = useI18n();
  return useCallback((time: DashboardTime) => {
    switch (time.kind) {
      case "this-month":
        return t("desktop.dashboard.time.thisMonth");
      case "last-month":
        return t("desktop.dashboard.time.lastMonth");
      case "ytd":
        return t("desktop.dashboard.time.ytd");
      case "preset":
        return t(`statsWorkbench.time.${time.preset}`);
      case "month":
        return formatLocalDate(`${time.month}-01`, { year: "numeric", month: "long" });
    }
  }, [t]);
}

export function DashboardTimeControl({ value, bookIds, disabled, onChange }: {
  readonly value: DashboardTime;
  readonly bookIds: readonly string[];
  readonly disabled: boolean;
  readonly onChange: (time: DashboardTime) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const label = useTimeLabel();
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={anchor} type="button" className="lv-desk-btn lv-month-trigger" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        {label(value)}<ChevronIcon up={open} className="size-4 text-brand" />
      </button>
      {open ? (
        <DesktopPopover anchor={anchor} label={t("desktop.dashboard.time.title")} placement="bottom-start" width={220} role="menu" onClose={close}>
          <ul className="p-2">
            {QUICK_TIMES.map((time) => (
              <li key={JSON.stringify(time)}>
                <button type="button" role="menuitemradio" aria-checked={sameTime(time, value)} className="lv-desk-menu-row" onClick={() => { onChange(time); close(); }}>
                  <span className="flex-1 text-left text-body text-ink">{label(time)}</span>
                  {sameTime(time, value) ? <span aria-hidden="true" className="text-brand">✓</span> : null}
                </button>
              </li>
            ))}
            <li>
              <button type="button" role="menuitem" className="lv-desk-menu-row" onClick={() => { close(); setMonthOpen(true); }}>
                <span className="flex-1 text-left text-body text-ink">{t("desktop.dashboard.time.pickMonth")}</span>
              </button>
            </li>
          </ul>
        </DesktopPopover>
      ) : null}
      <LedgerMonthPicker
        open={monthOpen}
        month={value.kind === "month" ? value.month : currentMonth()}
        maxMonth={currentMonth()}
        bookIds={bookIds}
        anchor={anchor}
        onClose={() => setMonthOpen(false)}
        onSelect={(month) => onChange({ kind: "month", month })}
      />
    </>
  );
}

export function DashboardStatsControl({ settings, books, mainCode, disabled, onChange }: {
  readonly settings: DashboardSettings;
  readonly books: readonly DashboardBook[];
  readonly mainCode: string;
  readonly disabled: boolean;
  readonly onChange: (settings: DashboardSettings) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const chosen = settings.books === "all" ? null : new Set(settings.books);
  const summary = settings.combined ? t("desktop.dashboard.stats.combinedShort", { currency: mainCode }) : t("desktop.dashboard.stats.originalShort");
  return (
    <>
      <button ref={anchor} type="button" className="lv-desk-btn" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        {summary}{chosen === null || books.length <= 1 ? "" : ` · ${t("desktop.dashboard.booksSome", { count: chosen.size })}`}
        <ChevronIcon up={open} className="size-4 text-brand" />
      </button>
      {open ? (
        <DesktopPopover anchor={anchor} label={t("desktop.dashboard.stats.title")} placement="bottom-start" width={300} onClose={close}>
          <div className="flex flex-col gap-4 p-4">
            <fieldset className="flex flex-col gap-1">
              <legend className="pb-1.5 text-helper text-muted">{t("desktop.dashboard.stats.mode")}</legend>
              <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                <input type="radio" name="dashboard-mode" className="size-5 accent-brand" checked={!settings.combined} onChange={() => onChange({ ...settings, combined: false })} />
                {t("desktop.dashboard.stats.original")}
              </label>
              <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                <input type="radio" name="dashboard-mode" className="size-5 accent-brand" checked={settings.combined} onChange={() => onChange({ ...settings, combined: true })} />
                {t("desktop.dashboard.stats.combined", { currency: mainCode })}
              </label>
              <p className="text-helper-relaxed text-muted">{settings.combined ? t("desktop.dashboard.stats.combinedHint", { currency: mainCode }) : t("desktop.dashboard.stats.originalHint")}</p>
            </fieldset>
            {books.length > 1 ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="pb-1.5 text-helper text-muted">{t("desktop.dashboard.stats.books")}</legend>
                <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                  <input type="checkbox" className="size-5 accent-brand" checked={chosen === null} onChange={(event) => onChange({ ...settings, books: event.target.checked ? "all" : books.map((book) => book.id) })} />
                  {t("desktop.dashboard.settings.allBooks")}
                </label>
                {chosen === null ? null : books.map((book) => (
                  <label key={book.id} className="flex min-h-11 items-center gap-3 pl-8 text-body text-ink">
                    <input
                      type="checkbox"
                      className="size-5 accent-brand"
                      checked={chosen.has(book.id)}
                      onChange={(event) => {
                        const next = new Set(chosen);
                        if (event.target.checked) next.add(book.id);
                        else next.delete(book.id);
                        onChange({ ...settings, books: next.size === 0 ? "all" : books.map((item) => item.id).filter((id) => next.has(id)) });
                      }}
                    />
                    <span className="min-w-0 truncate">{book.name}</span>
                  </label>
                ))}
                <p className="text-helper-relaxed text-muted">{t("desktop.dashboard.stats.booksHint")}</p>
              </fieldset>
            ) : null}
          </div>
        </DesktopPopover>
      ) : null}
    </>
  );
}

export function MaskToggle({ masked, onChange }: { readonly masked: boolean; readonly onChange: (masked: boolean) => void }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <button type="button" className="lv-desk-btn" aria-pressed={masked} title={t("desktop.dashboard.mask.hint")} onClick={() => onChange(!masked)}>
      {masked ? t("desktop.dashboard.mask.on") : t("desktop.dashboard.mask.off")}
    </button>
  );
}
