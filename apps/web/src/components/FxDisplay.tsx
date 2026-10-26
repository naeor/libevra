import { useEffect, useRef, useState } from "react";
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
  const content = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = content.current, root = element?.closest<HTMLElement>(".detail-root");
    if (compact || !element || !root) return;
    // 测量自然内容，动画仍只读原有 --p；不在动画每帧写 React 状态。
    const measure = () => {
      const card = Math.max(128, Math.ceil(element.getBoundingClientRect().height));
      const small = Math.max(74, ...Array.from(root.querySelectorAll<HTMLElement>("[data-currency-content]")).map(node => Math.ceil(node.getBoundingClientRect().height)));
      root.style.setProperty("--card-tall", `${card}px`);
      root.style.setProperty("--secondary-tall", `${small}px`);
      root.style.setProperty("--hero-tall", `${360 + card - 128 + small - 74}px`);
      root.style.setProperty("--hero-short", `${140 + small - 74}px`);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    root.querySelectorAll("[data-currency-content]").forEach(node => observer?.observe(node));
    return () => {
      observer?.disconnect();
      for (const name of ["--card-tall", "--secondary-tall", "--hero-tall", "--hero-short"]) root.style.removeProperty(name);
    };
  }, [compact, fx.result, fx.sourceComplete, fx.error, fx.target, t]);
  if (compact) return <div data-currency-content className="flex min-w-0 flex-col justify-center gap-1 px-4 py-2.5 [overflow-wrap:anywhere]"><p className="text-helper">{t("fx.combined")} · {fx.target}</p><p className="text-base font-semibold tabular-nums">{fx.result ? fxMoney(fx.result.totals.expenseMinor, fx.target) : t(fx.error ? "fx.unavailable" : "fx.loading")}</p>{fx.result && (!fx.result.complete || !fx.sourceComplete) ? <p className="text-helper">{t("fx.incomplete")}</p> : null}</div>;
  return <section ref={content} data-fx-hero className="detail-currency-card min-w-0 gap-1 px-5 py-4 text-on-brand [overflow-wrap:anywhere]">
    <p className="text-card-title">{t("fx.combined")} · {fx.target}</p>
    {fx.offline ? <p className="text-helper text-on-brand/80">{t("fx.offline")}</p> : null}
    {fx.result ? <>
      <p className="text-helper text-on-brand/80">{t("fx.expense")}</p>
      <p className={`${fxMoney(fx.result.totals.expenseMinor, fx.target).length > 22 ? "text-base" : "detail-main-amount"} font-semibold tabular-nums`}>{fxMoney(fx.result.totals.expenseMinor, fx.target)}</p>
      <dl className="flex min-w-0 flex-col gap-1 text-helper tabular-nums text-on-brand/80">{(["income", "net"] as const).map(key => <div key={key} className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt>{t(`fx.${key}`)}</dt><dd className="min-w-0">{fxMoney(fx.result!.totals[`${key}Minor`], fx.target)}</dd></div>)}</dl>
      {!fx.result.complete || !fx.sourceComplete ? <p className="mt-1 text-helper">{t("fx.incomplete")} · {t("fx.subtotal")}</p> : null}
      {fx.result.reviewNeededCount ? <p className="text-helper">{t("fx.review")}</p> : null}
    </> : <p className="text-helper">{t(fx.error ? "fx.error" : "fx.loading")}</p>}
    <button type="button" onClick={fx.refresh} className="min-h-11 self-start text-link text-on-brand underline">{t(fx.error ? "fx.retry" : "fx.refresh")}</button>
  </section>;
}
