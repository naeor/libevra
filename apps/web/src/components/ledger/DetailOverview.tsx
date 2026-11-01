import { convertFx, type Transaction } from "@libellum/shared";
import { mainDetailMetrics, isDetailChart } from "../../lib/detailCards.js";
import { DetailMiniChart, type MiniEntry } from "./DetailMiniChart.js";
import "./detail-card-editor.css";
import type { CurrencySummary } from "@libellum/shared";
import { useI18n } from "../../i18n/index.js";
import { dailyMinor, type DetailCards } from "../../lib/detailCards.js";
import { fxMoney, type useFxRange } from "../../lib/fxView.js";
export function DetailOverview({ config, summary, currency, label, days, fx, onCurrencies, hidden, loading, entries = [], chartFrom = "", chartTo = "", chartComplete = false, syncStatus, onEdit }: {
  syncStatus?: "syncConflict" | "syncPending" | "syncError" | undefined; onEdit?: (() => void) | undefined;
  entries?: readonly Transaction[]; chartFrom?: string; chartTo?: string; chartComplete?: boolean;
  config: DetailCards; summary: CurrencySummary | null; currency: string; label: string; days: number | null;
  fx: ReturnType<typeof useFxRange> | null; onCurrencies: () => void; hidden: boolean; loading: boolean;
}) {
  const { t } = useI18n();
  const target = fx?.target ?? currency;
  const expense = fx ? fx.result?.totals.expenseMinor : String(summary?.expenseCents ?? 0);
  const income = fx ? fx.result?.totals.incomeMinor : String(summary?.incomeCents ?? 0);
  const balance = fx ? fx.result?.totals.netMinor : String(summary?.balanceCents ?? 0);
  const value = (metric: string) => {
    if (loading || fx && !fx.result) return "—";
    if (metric === "count") return String(fx ? fx.sourceEntries?.length ?? 0 : (summary?.expenseCount ?? 0) + (summary?.incomeCount ?? 0));
    const amount = metric === "expense" ? expense : metric === "income" ? income : metric === "balance" ? balance : days && expense != null ? dailyMinor(expense, days) : null;
    // 币种统一显示在卡片页头，数字保留最小货币单位的精度，不重复占据每个指标的宽度。
    return amount == null ? "—" : fxMoney(String(amount), target).slice(0, -(target.length + 1));
  };
  const metrics = mainDetailMetrics(config);
  const chartRows: MiniEntry[] = (metrics.some(isDetailChart) ? fx?.sourceEntries ?? entries : []).flatMap(e => {
    if (fx) {
      const minor = convertFx({ ...e, bookId: "bookId" in e ? String(e.bookId) : "" }, target, fx.lookups?.get(e.occurredLocalDate)).convertedMinor;
      return minor === null ? [] : [{ ...e, minor }];
    }
    return e.currency === currency && Number.isSafeInteger(e.amountCents) ? [{ ...e, minor: String(e.amountCents) }] : [];
  });
  return <div className="detail-overview" inert={hidden} aria-hidden={hidden}>
    <div className="detail-main-card"><section className="detail-overview-main">
      <div className="flex items-center justify-between gap-2 text-helper"><span>{label}</span><button type="button" className="min-h-8 underline" onClick={onCurrencies}>{fx ? t("fx.combined") + " · " : ""}{target}</button></div>
      <div className="detail-overview-totals" data-single={metrics.length === 1}>{metrics.map(metric => <div key={metric}><p className="text-helper text-on-brand/80">{t(`ledger.cards.${metric}`)}</p>{isDetailChart(metric) ? loading ? <p>—</p> : !chartFrom || !chartTo ? <p className="text-helper">{t("ledger.cards.chooseRange")}</p> : <DetailMiniChart metric={metric} entries={chartRows} from={chartFrom} to={chartTo} currency={target} incomplete={fx ? !fx.sourceComplete || !fx.result?.complete : !chartComplete} /> : <p className="text-2xl font-semibold tabular-nums break-words">{value(metric)}</p>}</div>)}</div>
      {syncStatus ? <button type="button" className="text-helper underline min-h-8" onClick={onEdit}>{t(`ledger.cards.${syncStatus}`)}</button> : null}
      {fx && (fx.error || fx.result && (!fx.result.complete || !fx.sourceComplete)) ? <p className="text-helper">{t(fx.error ? "fx.unavailable" : "fx.incomplete")}</p> : null}
      {fx?.offline ? <p className="text-helper">{t("fx.offline")}</p> : null}
      {fx?.result?.reviewNeededCount ? <p className="text-helper">{t("fx.review")}</p> : null}
      {fx?.error ? <button type="button" className="min-h-11 underline text-helper" onClick={fx.refresh}>{t("fx.retry")}</button> : null}
    </section></div>
    <div className="detail-overview-strip"><div className="detail-overview-small">{([config.first, config.second]).map((metric, i) => <section key={i}><p className="text-helper text-on-brand/80">{t(`ledger.cards.${metric}`)}</p><p className="text-lg font-semibold tabular-nums break-words">{value(metric)}</p>{metric === "daily" ? <p className="text-helper text-on-brand/75">{days ? t("ledger.cards.days", { count: days }) : t("ledger.cards.chooseRange")}</p> : null}</section>)}</div></div>
  </div>;
}
