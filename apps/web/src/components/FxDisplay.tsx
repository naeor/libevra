import { useState } from "react";
import { type Transaction, type FxResult } from "@libellum/shared";
import { useI18n } from "../i18n/index.js";
import { fxMoney, useFxEntry, useFxMode, useFxRange } from "../lib/fxView.js";
import { formatMoney } from "../lib/format.js";

export function FxModeSetting() {
  const mode = useFxMode(), { t } = useI18n(); const [failed, setFailed] = useState(false);
  if (!mode.userId) return null;
  return <section className="rounded-card border border-line bg-surface p-5">
    <label className="flex min-h-11 items-center justify-between gap-4 text-card-title text-ink">
      <span>{t("fx.title")}</span><input type="checkbox" role="switch" aria-label={t("fx.title")} checked={mode.enabled}
        onChange={event => setFailed(!mode.setEnabled(event.target.checked))} className="size-5 shrink-0 accent-brand" />
    </label>
    <p className="mt-2 text-helper-relaxed text-muted">{t("fx.hint")}</p>
    <p className="mt-1 text-helper text-muted">{t("fx.device")}</p>
    {failed ? <p role="alert" className="mt-2 text-helper text-danger">{t("fx.saveError")}</p> : null}
  </section>;
}
export function FxAmountView({ entry, target, result, loading, details = false, offline = false }: {
  entry: Transaction; target: string; result: FxResult; loading: boolean; details?: boolean; offline?: boolean;
}) {
  const { t } = useI18n(), sign = entry.kind === "expense" ? "−" : "+";
  if (entry.currency === target) return <>{sign}{formatMoney(entry.amountCents, entry.currency, { withCode: true })}</>;
  return <span className="inline-flex max-w-full flex-col items-end gap-1 break-words text-right" data-fx-amount>
    <span>{result.convertedMinor !== null ? `${sign}${fxMoney(result.convertedMinor, target)}` : `${sign}${formatMoney(entry.amountCents, entry.currency, { withCode: true })}`}</span>
    {result.convertedMinor !== null ? <span className="text-helper font-normal text-muted">{t("fx.original")} · {formatMoney(entry.amountCents, entry.currency, { withCode: true })}</span> : null}
    {loading || result.status === "unavailable" ? <span className="text-helper font-normal text-muted">{t(loading ? "fx.loading" : "fx.unavailable")}</span> : null}
    {!loading && result.reason ? <span className="text-helper font-normal text-muted">{t(`fx.reasons.${result.reason}`)}</span> : null}
    {result.review?.needsReview ? <span className="text-helper font-normal text-warn">{t("fx.review")}</span> : null}
    {details ? <span className="mt-2 flex flex-col gap-1 text-helper-relaxed font-normal text-muted">
      <span>{t("fx.requested", { date: entry.occurredLocalDate })}</span>
      {result.rate ? <span>{t("fx.rate", { from: entry.currency, to: target, rate: rateText(result) })}</span> : null}
      {result.rateDate ? <span>{t("fx.date", { date: result.rateDate })}</span> : null}
      {result.provider ? <a href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html" target="_blank" rel="noreferrer" className="underline">{t("fx.source")}</a> : null}
      {offline ? <span>{t("fx.offline")}</span> : null}<span>{t("fx.reference")}</span>
    </span> : null}
  </span>;
}
function rateText(result: FxResult): string {
  if (!result.rate) return "";
  const n = BigInt(result.rate.numerator) * 100000000n / BigInt(result.rate.denominator);
  return `${n / 100000000n}.${(n % 100000000n).toString().padStart(8, "0")}`.replace(/\.?0+$/, "");
}
export function FxAmount({ entry, details = false }: { entry: Transaction; details?: boolean }) {
  const fx = useFxEntry(entry);
  return <FxAmountView entry={entry} target={fx.target} result={fx.result} loading={fx.loading} offline={fx.offline} details={details} />;
}
export function FxMonthSummary({ data: fx, compact = false }: { data: ReturnType<typeof useFxRange>; compact?: boolean }) {
  const { t } = useI18n();
  if (compact) return <><p className="text-helper">{t("fx.combined")} · {fx.target}</p><p className="mt-2 text-base font-semibold tabular-nums">{fx.result ? fxMoney(fx.result.totals.expenseMinor, fx.target) : t(fx.error ? "fx.error" : "fx.loading")}</p>{fx.result && (!fx.result.complete || !fx.sourceComplete) ? <p className="text-helper">{t("fx.incomplete")}</p> : null}</>;
  return <section className="rounded-card border border-line bg-surface p-4 text-ink">
    <p className="text-card-title">{t("fx.combined")} · {fx.target}</p>
    {fx.offline ? <p className="mt-1 text-helper text-muted">{t("fx.offline")}</p> : null}
    {fx.result ? <>
      <p className="mt-2 text-lg font-semibold tabular-nums">{t("fx.expense")} {fxMoney(fx.result.totals.expenseMinor, fx.target)}</p>
      <p className="mt-1 text-helper">{t("fx.income")} {fxMoney(fx.result.totals.incomeMinor, fx.target)} · {t("fx.net")} {fxMoney(fx.result.totals.netMinor, fx.target)}</p>
      {!fx.result.complete || !fx.sourceComplete ? <p className="mt-2 text-helper text-warn">{t("fx.incomplete")} · {t("fx.subtotal")}</p> : null}
      {fx.result.reviewNeededCount ? <p className="text-helper text-muted">{t("fx.review")}</p> : null}
    </> : <p className="text-helper">{t(fx.error ? "fx.error" : "fx.loading")}</p>}
    <button type="button" onClick={fx.refresh} className="mt-2 text-link text-brand-dark underline">{t(fx.error ? "fx.retry" : "fx.refresh")}</button>
  </section>;
}
