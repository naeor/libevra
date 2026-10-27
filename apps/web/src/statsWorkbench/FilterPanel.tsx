/**
 * 状态 B：筛选展开态。**在当前页内展开，参与正常文档流**——下方卡片因为这块区域变高而自然下移，
 * 网格位置本身没有任何改变（交互补充 §3）。
 *
 * 语义（所有者 2026-10-27：关闭面板与撤销未提交修改必须区分）：
 * - 面板里的修改先是**草稿**，点「应用」才生效并重算；
 * - 「收起」只是收起面板，**草稿保留**（漏斗上有小圆点提示还有未应用的修改），不会悄悄生效也不会丢；
 * - 「撤销修改」把草稿恢复成当前生效的条件，面板保持打开。
 */
import { CURRENCIES, STATS_RANGES, type Currency } from "@libellum/shared";
import { useMemo } from "react";

import { useI18n } from "../i18n/index.js";
import { formatLocalDate } from "../lib/datetime.js";
import { currencyName } from "../lib/format.js";
import { customRangeProblem, previousMonth, resolveRange, sameFilters, type TimeChoice, type WorkbenchFilters } from "./filters.js";

export function timeLabel(time: TimeChoice, t: ReturnType<typeof useI18n>["t"]): string {
  switch (time.kind) {
    case "preset":
      return t(`statsWorkbench.time.${time.preset}`);
    case "this-month":
      return t("statsWorkbench.time.thisMonth");
    case "month":
      return formatLocalDate(`${time.month}-01`, { year: "numeric", month: "long" });
    case "custom":
      return t("statsWorkbench.time.custom");
  }
}

export function FilterPanel({
  id,
  draft,
  effective,
  today,
  fxAvailable,
  fxTarget,
  defaultCurrency,
  currenciesInLedger,
  onDraft,
  onApply,
  onRevert,
  onCollapse,
}: {
  readonly id: string;
  readonly draft: WorkbenchFilters;
  readonly effective: WorkbenchFilters;
  readonly today: string;
  readonly fxAvailable: boolean;
  readonly fxTarget: string;
  readonly defaultCurrency: Currency;
  readonly currenciesInLedger: readonly string[];
  readonly onDraft: (next: WorkbenchFilters) => void;
  readonly onApply: () => void;
  readonly onRevert: () => void;
  readonly onCollapse: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const dirty = !sameFilters(draft, effective);
  const time = draft.time;
  const custom = time.kind === "custom" ? time : null;
  const problem = custom === null ? null : customRangeProblem(custom.from, custom.to);
  const range = problem === null ? resolveRange(time, today) : null;
  const combined = fxAvailable && draft.combined;
  const lastMonth = previousMonth(today);

  const currencies = useMemo(() => {
    const preferred = new Set<string>([defaultCurrency, ...currenciesInLedger]);
    return [...CURRENCIES].sort((a, b) => Number(preferred.has(b)) - Number(preferred.has(a)) || (a === defaultCurrency ? -1 : b === defaultCurrency ? 1 : 0));
  }, [defaultCurrency, currenciesInLedger]);
  const selectedCurrency = draft.currency ?? defaultCurrency;

  const setTime = (next: TimeChoice) => onDraft({ ...draft, time: next });
  const isTime = (candidate: TimeChoice) => JSON.stringify(candidate) === JSON.stringify(time);

  return (
    <section id={id} className="sw-filter-panel mx-6 mt-4 rounded-card border border-line bg-surface" aria-label={t("statsWorkbench.filter.title")}>
      <header className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <h2 className="text-card-title text-ink">{t("statsWorkbench.filter.title")}</h2>
        <button type="button" className="sw-link" onClick={onCollapse}>
          {t("statsWorkbench.filter.collapse")}
        </button>
      </header>

      <div className="flex flex-col gap-4 px-4 pt-3 pb-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1.5 text-helper text-muted">{t("statsWorkbench.filter.time")}</legend>
          <div className="flex flex-wrap gap-2">
            {STATS_RANGES.map((preset) => (
              <button key={preset} type="button" aria-pressed={isTime({ kind: "preset", preset })} className={`sw-chip ${isTime({ kind: "preset", preset }) ? "sw-chip-on" : ""}`} onClick={() => setTime({ kind: "preset", preset })}>
                {t(`statsWorkbench.time.${preset}`)}
              </button>
            ))}
            <button type="button" aria-pressed={isTime({ kind: "this-month" })} className={`sw-chip ${isTime({ kind: "this-month" }) ? "sw-chip-on" : ""}`} onClick={() => setTime({ kind: "this-month" })}>
              {t("statsWorkbench.time.thisMonth")}
            </button>
            <button type="button" aria-pressed={isTime({ kind: "month", month: lastMonth })} className={`sw-chip ${isTime({ kind: "month", month: lastMonth }) ? "sw-chip-on" : ""}`} onClick={() => setTime({ kind: "month", month: lastMonth })}>
              {t("statsWorkbench.time.lastMonth")}
            </button>
            <button
              type="button"
              aria-pressed={time.kind === "custom"}
              className={`sw-chip ${time.kind === "custom" ? "sw-chip-on" : ""}`}
              onClick={() => {
                const current = resolveRange(time.kind === "custom" ? effective.time : time, today);
                setTime({ kind: "custom", from: current.from, to: current.to });
              }}
            >
              {t("statsWorkbench.time.custom")}
            </button>
          </div>
          <label className="flex flex-wrap items-center gap-3 text-helper text-muted">
            {t("statsWorkbench.time.pickMonth")}
            <input
              type="month"
              value={time.kind === "month" ? time.month : ""}
              max={today.slice(0, 7)}
              onChange={(event) => {
                if (/^\d{4}-\d{2}$/.test(event.target.value)) setTime({ kind: "month", month: event.target.value });
              }}
              className="min-h-11 min-w-0 rounded-field border border-line bg-surface px-3 py-2 text-base text-ink"
            />
          </label>
          {custom === null ? null : (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex min-w-0 flex-col gap-1 text-helper text-muted">
                {t("statsWorkbench.time.from")}
                <input type="date" value={custom.from} onChange={(event) => setTime({ ...custom, from: event.target.value })} className="min-h-11 min-w-0 rounded-field border border-line bg-surface px-3 py-2 text-base text-ink" />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-helper text-muted">
                {t("statsWorkbench.time.to")}
                <input type="date" value={custom.to} onChange={(event) => setTime({ ...custom, to: event.target.value })} className="min-h-11 min-w-0 rounded-field border border-line bg-surface px-3 py-2 text-base text-ink" />
              </label>
            </div>
          )}
          {problem === null ? (
            range === null ? null : (
              <p className="text-helper text-muted">{t("statsWorkbench.summary.dates", { from: formatLocalDate(range.from), to: formatLocalDate(range.to) })}</p>
            )
          ) : (
            <p role="alert" className="text-helper text-danger">{t(`statsWorkbench.filter.problems.${problem}`)}</p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1.5 text-helper text-muted">{t("statsWorkbench.filter.currency")}</legend>
          {fxAvailable ? (
            <div className="sw-segment self-start" role="radiogroup" aria-label={t("statsWorkbench.filter.mode")}>
              <button type="button" role="radio" aria-checked={!combined} className={!combined ? "sw-segment-on" : ""} onClick={() => onDraft({ ...draft, combined: false })}>
                {t("statsWorkbench.filter.original")}
              </button>
              <button type="button" role="radio" aria-checked={combined} className={combined ? "sw-segment-on" : ""} onClick={() => onDraft({ ...draft, combined: true })}>
                {t("statsWorkbench.filter.combined")}
              </button>
            </div>
          ) : null}
          {combined ? (
            <p className="text-helper-relaxed text-muted">{t("statsWorkbench.filter.combinedHint", { currency: currencyName(fxTarget) })}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {currencies.map((currency) => (
                <button
                  key={currency}
                  type="button"
                  aria-pressed={selectedCurrency === currency}
                  className={`sw-chip ${selectedCurrency === currency ? "sw-chip-on" : ""}`}
                  onClick={() => onDraft({ ...draft, currency: currency === defaultCurrency ? null : currency })}
                >
                  {currencyName(currency)}
                </button>
              ))}
            </div>
          )}
        </fieldset>

        <footer className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <button type="button" className="sw-pill" disabled={!dirty} onClick={onRevert}>
            {t("statsWorkbench.filter.revert")}
          </button>
          <button type="button" className="sw-pill sw-pill-primary" disabled={!dirty || problem !== null} onClick={onApply}>
            {t("statsWorkbench.filter.apply")}
          </button>
        </footer>
      </div>
    </section>
  );
}
