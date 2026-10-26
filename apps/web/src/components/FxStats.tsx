import { STATS_RANGES, type DateRange, type StatsRangeKey } from "@libellum/shared";
import { Link } from "react-router";
import { useI18n } from "../i18n/index.js";
import { fxMoney, useFxRange } from "../lib/fxView.js";
import { useLedger } from "../lib/queries.js";
import { displayCategoryName } from "../lib/presetNames.js";

export function FxStats({ range, preset, setPreset, month, setMonth, kind, setKind }: { range: DateRange; preset: StatsRangeKey; setPreset: (value: StatsRangeKey) => void; month: string; setMonth: (value: string) => void; kind: "income" | "expense"; setKind: (value: "income" | "expense") => void }) {
  const effective = range;
  const fx = useFxRange(effective.from, effective.to), ledger = useLedger(), { t } = useI18n();
  const result = fx.result, complete = result?.complete && fx.sourceComplete;
  const names = new Map(ledger.data?.categories.map(category => [category.id, displayCategoryName(category.name)]));
  return <section className="flex flex-col gap-5 px-6 pt-5 pb-8" data-fx-stats>
    <div className="flex flex-wrap gap-2">{STATS_RANGES.map(option => <button key={option} type="button"
      onClick={() => setPreset(option)} className={`rounded-full px-4 py-2 text-body ${!month && option === preset ? "bg-brand text-on-brand" : "bg-surface text-muted"}`}>{t(`stats.range.${option}`)}</button>)}</div>
    <label className="flex flex-wrap items-center gap-3 text-body text-muted">{t("fx.month")}<input type="month" value={month} onChange={event => setMonth(event.target.value)}
      className="min-w-0 rounded-field border border-line bg-surface px-3 py-2 text-base text-ink" /></label>
    {month ? <button type="button" onClick={() => setMonth("")} className="self-start text-link text-brand-dark underline">{t("fx.clearMonth")}</button> : null}
    <p className="text-helper-relaxed text-muted">{effective.from} — {effective.to} · {t("fx.target", { currency: fx.target })}</p>
    {fx.offline ? <p className="text-helper text-muted">{t("fx.offline")}</p> : null}
    {fx.error ? <p role="alert" className="text-body text-danger">{t(fx.reason === "capacity" ? "fx.capacityError" : "fx.error")}</p> : null}
    {fx.loading ? <p role="status" className="text-body text-muted">{t("fx.loading")}</p> : null}
    <button type="button" className="self-start text-link text-brand-dark underline" onClick={fx.refresh}>{t(fx.error ? "fx.retry" : "fx.refresh")}</button>
    {result ? <>
      {!complete ? <div role="alert" className="rounded-card border border-warn bg-warn-soft p-4 text-ink">
        <h2 className="text-card-title">{t("fx.incomplete")}</h2><p className="mt-1 text-helper-relaxed">{t("fx.subtotal")}</p>
        {!fx.sourceComplete ? <p className="text-helper-relaxed">{t("fx.dataIncomplete")}</p> : null}
        {result.missingCount ? <p className="mt-1 text-helper">{t("fx.missing", { count: result.missingCount })}</p> : null}
      </div> : null}
      {result.reviewNeededCount ? <p className="text-helper text-warn">{t("fx.review")}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">{(["income", "expense", "net"] as const).map(key => <div key={key} className="min-w-0 rounded-card border border-line bg-surface p-4">
        <p className="text-helper text-muted">{t(`fx.${key}`)}</p><p className="mt-2 break-all text-xl font-semibold tabular-nums text-ink">{fxMoney(result.totals[`${key}Minor`], fx.target)}</p>
      </div>)}</div>
      <p className="text-helper text-muted">{t("fx.count", { count: result.convertedCount })} · {t("fx.complete")}</p>
      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-section-title text-ink">{t("fx.trend")} · {fx.target}</h2>
        <div className="mt-4 flex flex-col gap-4">{Object.entries(result.months).sort().map(([label, total]) => {
          const max = Object.values(result.months).reduce((value, row) => BigInt(row.expenseMinor) > value ? BigInt(row.expenseMinor) : value, 1n);
          return <div key={label} className="text-helper text-muted"><div className="flex flex-wrap justify-between gap-2"><span>{label}</span><span>{t("fx.expense")} {fxMoney(total.expenseMinor, fx.target)}</span></div>
            <div className="mt-2 h-2 rounded-full bg-brand-soft"><div className="h-2 rounded-full bg-brand" style={{ width: `${Number(BigInt(total.expenseMinor) * 10000n / max) / 100}%` }} /></div>
            <p className="mt-1">{t("fx.income")} {fxMoney(total.incomeMinor, fx.target)}</p></div>;
        })}</div>
      </section>
      <section className="rounded-card border border-line bg-surface p-5"><h2 className="text-section-title text-ink">{t("fx.category")} · {fx.target}</h2>
        <div className="my-3 flex gap-2">{(["expense", "income"] as const).map(value => <button type="button" key={value} onClick={() => setKind(value)} className={`rounded-full px-4 py-2 text-body ${kind === value ? "bg-brand text-on-brand" : "bg-canvas text-muted"}`}>{t(`fx.${value}`)}</button>)}</div>
        <dl>{Object.entries(result.categories).filter(([, total]) => BigInt(total[`${kind}Minor`]) !== 0n).sort((a, b) => BigInt(a[1][`${kind}Minor`]) > BigInt(b[1][`${kind}Minor`]) ? -1 : 1).map(([id, total]) => <div key={id} className="flex flex-wrap justify-between gap-2 border-b border-line py-3 text-body text-ink"><dt>{names.get(id) ?? id}</dt><dd className="tabular-nums">{fxMoney(total[`${kind}Minor`], fx.target)}</dd></div>)}</dl>
      </section>
      {result.failures.length ? <details className="rounded-card border border-line bg-surface p-5"><summary className="cursor-pointer text-card-title text-ink">{t("fx.showMissing")} ({result.missingCount})</summary>
        <ul className="mt-3 flex flex-col gap-3">{result.failures.map(row => <li key={row.id} className="text-helper-relaxed text-muted"><Link className="text-brand-dark underline" to={`/transactions/${row.id}`}>{row.date} · {row.currency}</Link> · {t(`fx.reasons.${row.reason}`)}</li>)}</ul>
      </details> : null}
      <details className="rounded-card border border-line bg-surface p-5"><summary className="text-card-title text-ink">{t("fx.originalTotals")}</summary>
        {Object.entries(result.originalByCurrency).map(([currency, totals]) => <p key={currency} className="mt-3 text-helper-relaxed text-muted">{currency} · {t("fx.expense")} {fxMoney(totals.expenseMinor, currency)} · {t("fx.income")} {fxMoney(totals.incomeMinor, currency)}</p>)}
      </details>
      <p className="text-helper-relaxed text-muted">{t("fx.source")} · {t("fx.reference")}</p>
    </> : null}
  </section>;
}
