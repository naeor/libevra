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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useI18n } from "../i18n/index.js";
import { formatLocalDate } from "../lib/datetime.js";
import { currencyName } from "../lib/format.js";
import {
  customRangeProblem,
  filterIds,
  resolveRange,
  sameFilters,
  toggleFilterId,
  type TimeChoice,
  type WorkbenchFilters,
} from "./filters.js";
import "./filters.css";

/** 筛选面板里的一个可选项（分类 / 支付方式 / 标签）。 */
export interface FilterOption {
  readonly id: string;
  readonly name: string;
  readonly archived?: boolean;
  /** 标签色值（`#RRGGBB`），只有标签会用到。 */
  readonly color?: string;
}

/** 滚动提示只在还有隐藏选项时出现，放在选择栏外，不遮住选项。 */
function ChoiceRow({ children, label }: { readonly children: ReactNode; readonly label: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const row = ref.current;
    if (row === null) return;
    const update = () => setMore(row.scrollWidth > row.clientWidth + row.scrollLeft + 2);
    update();
    row.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(row);
    return () => { row.removeEventListener("scroll", update); resize?.disconnect(); };
  }, [children]);
  return <div className="sw-choice-wrap"><div ref={ref} className="sw-choice-row" role="group" aria-label={label}>{children}</div>{more ? <span aria-hidden="true" className="sw-choice-more text-muted">›</span> : null}</div>;
}

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
  categories = [],
  categoryHierarchy = false,
  paymentMethods = [],
  tags = [],
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
  /** 账本现有分类（归档分类也列出，允许查看历史；是否可选由 W5 规格继续明确）。 */
  readonly categories?: readonly FilterOption[];
  readonly categoryHierarchy?: boolean;
  readonly paymentMethods?: readonly FilterOption[];
  readonly tags?: readonly FilterOption[];
  readonly onDraft: (next: WorkbenchFilters) => void;
  readonly onApply: () => void;
  readonly onRevert: () => void;
  readonly onCollapse: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const dirty = !sameFilters(draft, effective);
  const time = draft.time;
  // 老链接的月范围仍有效，但入口统一呈现为自定义日期。
  const custom = time.kind === "custom" ? time : time.kind !== "preset" ? { kind: "custom" as const, ...resolveRange(time, today) } : null;
  const problem = custom === null ? null : customRangeProblem(custom.from, custom.to);
  const range = problem === null ? resolveRange(time, today) : null;
  const combined = fxAvailable && draft.combined;
  const ids = filterIds(draft);

  const currencies = useMemo(() => {
    const preferred = new Set<string>([defaultCurrency, ...currenciesInLedger]);
    return [...CURRENCIES].sort((a, b) => Number(preferred.has(b)) - Number(preferred.has(a)) || (a === defaultCurrency ? -1 : b === defaultCurrency ? 1 : 0));
  }, [defaultCurrency, currenciesInLedger]);
  const selectedCurrency = draft.currency ?? defaultCurrency;

  const setTime = (next: TimeChoice) => onDraft({ ...draft, time: next });
  const isTime = (candidate: TimeChoice) => JSON.stringify(candidate) === JSON.stringify(time);

  type DimensionKey = "categoryIds" | "paymentMethodIds" | "tagIds";
  const toggle = (key: DimensionKey, id: string): void => {
    if(key==="categoryIds"&&draft.categoryBranchIds !== undefined){onDraft({...draft,categoryBranchIds:toggleFilterId(draft.categoryBranchIds,id),categoryIds:null});return;}
    onDraft({ ...draft, [key]: toggleFilterId(ids[key], id) });
  };
  const clearDimension = (key: DimensionKey): void => onDraft({ ...draft, [key]: null, ...(key==="categoryIds"?{categoryBranchIds:undefined}: {}) });

  const dimension = (
    key: DimensionKey,
    legend: string,
    options: readonly FilterOption[],
  ): React.ReactNode => {
    if (options.length === 0) return null;
    const selected = key==="categoryIds"&&draft.categoryBranchIds !== undefined?draft.categoryBranchIds:ids[key];
    return (
      <fieldset className="flex min-w-0 flex-col gap-2" data-filter-dimension={key}>
        <legend className="pb-1.5 text-helper text-muted">{legend}</legend>
        <ChoiceRow label={legend}>
          <button
            type="button"
            aria-pressed={selected === null}
            className={`sw-chip ${selected === null ? "sw-chip-on" : ""}`}
            onClick={() => clearDimension(key)}
          >
            {t("statsWorkbench.filter.all")}
          </button>
          {options.map((option) => {
            const on = selected !== null && selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={on}
                className={`sw-chip ${on ? "sw-chip-on" : ""}`}
                onClick={() => toggle(key, option.id)}
              >
                {option.color === undefined ? null : (
                  <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: option.color }} />
                )}
                {option.name}
              </button>
            );
          })}
        </ChoiceRow>
        {selected !== null && selected.length === 0 ? (
          <p role="alert" className="text-helper text-danger">{t("statsWorkbench.filter.emptySelection")}</p>
        ) : null}
      </fieldset>
    );
  };

  return (
    <section id={id} className="sw-filter-panel mx-6 mt-4 rounded-card border border-line bg-surface" aria-label={t("statsWorkbench.filter.title")}>
      <header className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <h2 className="text-card-title text-ink">{t("statsWorkbench.filter.title")}</h2>
        <button type="button" className="sw-link" onClick={onCollapse}>
          {t("statsWorkbench.filter.collapse")}
        </button>
      </header>

      <div className="flex flex-col gap-4 px-4 pt-3 pb-4">
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="pb-1.5 text-helper text-muted">{t("statsWorkbench.filter.time")}</legend>
          <ChoiceRow label={t("statsWorkbench.filter.time")}>
            <button
              type="button"
              aria-pressed={custom !== null}
              className={`sw-chip ${custom !== null ? "sw-chip-on" : ""}`}
              onClick={() => {
                const current = resolveRange(time, today);
                setTime({ kind: "custom", from: current.from, to: current.to });
              }}
            >
              {t("statsWorkbench.time.custom")}
            </button>
            {STATS_RANGES.map((preset) => (
              <button key={preset} type="button" aria-pressed={isTime({ kind: "preset", preset })} className={`sw-chip ${isTime({ kind: "preset", preset }) ? "sw-chip-on" : ""}`} onClick={() => setTime({ kind: "preset", preset })}>
                {t(`statsWorkbench.time.${preset}`)}
              </button>
            ))}
          </ChoiceRow>
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
          {custom === null ? null : <p className="text-helper text-muted">{t("statsWorkbench.filter.rangeLimit")}</p>}
          {problem === null ? (
            range === null ? null : (
              <p className="text-helper text-muted">{t("statsWorkbench.summary.dates", { from: formatLocalDate(range.from), to: formatLocalDate(range.to) })}</p>
            )
          ) : (
            <p role="alert" className="text-helper text-danger">{t(`statsWorkbench.filter.problems.${problem}`)}</p>
          )}
        </fieldset>

        {dimension("categoryIds", t("statsWorkbench.filter.category"), categories)}
        {categoryHierarchy?<label className="flex items-center gap-2 text-helper text-muted"><input type="checkbox" checked={draft.categoryBranchIds !== undefined} disabled={!draft.categoryIds?.length&&draft.categoryBranchIds === undefined} onChange={e=>onDraft({...draft,categoryBranchIds:e.target.checked?[...(draft.categoryIds??[])]:undefined,categoryIds:e.target.checked?null:[...(draft.categoryBranchIds??[])]})}/>{t("manage.tree.branch")}</label>:null}
        {dimension("paymentMethodIds", t("statsWorkbench.filter.paymentMethod"), paymentMethods)}
        {dimension("tagIds", t("statsWorkbench.filter.tag"), tags)}

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="pb-1.5 text-helper text-muted">{t("statsWorkbench.filter.currency")}</legend>
          <ChoiceRow label={t("statsWorkbench.filter.currency")}>
              {fxAvailable ? <button type="button" aria-pressed={combined} className={`sw-chip ${combined ? "sw-chip-on" : ""}`} onClick={() => onDraft({ ...draft, combined: true })}>
                {t("statsWorkbench.filter.combinedOption", { currency: fxTarget })}
              </button> : null}
              {currencies.map((currency) => (
                <button
                  key={currency}
                  type="button"
                  aria-pressed={!combined && selectedCurrency === currency}
                  className={`sw-chip ${!combined && selectedCurrency === currency ? "sw-chip-on" : ""}`}
                  onClick={() => onDraft({ ...draft, combined: false, currency: currency === defaultCurrency ? null : currency })}
                >
                  {currencyName(currency)}
                </button>
              ))}
          </ChoiceRow>
          {combined ? <p className="text-helper-relaxed text-muted">{t("statsWorkbench.filter.combinedHint", { currency: currencyName(fxTarget) })}</p> : null}
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
