import { useLocation, useParams } from "react-router";
import { InnerPage } from "../components/Layouts.js";
import { DetailMiniChart, netSeries } from "../components/ledger/DetailMiniChart.js";
import { fxMoney } from "../lib/fxView.js";
import { readMetricSnapshot, type OverviewMetric } from "../components/ledger/metricSnapshot.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useGuestIdentity } from "../lib/guest/session.js";
import { useViewBookId } from "../lib/workspaceLedger.js";
import { usePane } from "../workspace/context.js";
import { useGoBack } from "../lib/connectivity.js";
import { useI18n } from "../i18n/index.js";
import { Button } from "../components/Button.js";

/** 金额来自来源卡片，图表使用既有分析组件；不重新请求另一套筛选口径。 */
export function MetricDetailPage(): React.JSX.Element {
  const { t } = useI18n(), { user } = useAuth(), guest = useGuestIdentity(), book = useViewBookId(), pane = usePane();
  const location = useLocation(), { metric } = useParams();
  const data = readMetricSnapshot((location.state as { metricSnapshot?: unknown } | null)?.metricSnapshot, user?.id ?? guest?.id ?? "", book, pane.instance);
  const back = useGoBack(data?.returnTo ?? "/");
  const title = t(`ledger.cards.${data?.metric ?? "overview"}`);
  if (!data || data.metric !== metric) return <InnerPage title={title} backTo="/"><p>{t("ledger.metricDetail.expired")}</p><Button onClick={back}>{t("ledger.metricDetail.entries")}</Button></InnerPage>;
  const charts = data.metric === "daily" || data.metric === "expense" ? ["expenseTrend", "categoryRank"] as const : ["incomeTrend", "expenseTrend"] as const;
  const metrics: OverviewMetric[] = data.metric === "overview" ? ["income", "expense"] : [data.metric];
  return <InnerPage title={title} backTo={data.returnTo}>
    <p className="text-helper text-muted">{data.label} · {data.from} – {data.to} · {data.currency}</p>
    <section className="rounded-card border border-line bg-surface p-5 space-y-4">
      {metrics.map(key => <div key={key}><p className="text-helper text-muted">{t(`ledger.cards.${key}`)}</p><p className="text-2xl font-semibold tabular-nums">{data.values[key]} {key === "count" ? "" : data.currency}</p></div>)}
      {data.metric === "balance" ? <><p className="text-helper">{t("ledger.metricDetail.netHint")}</p><p>{data.values.income} − {data.values.expense} = {data.values.balance}</p></> : null}
      {data.metric === "daily" ? <><p className="text-helper">{t("ledger.cards.days", { count: data.days ?? 0 })}</p><p>{data.values.expense} ÷ {data.days} = {data.values.daily} {data.currency}</p><p className="text-helper">{t("ledger.metricDetail.dailyHint")}</p></> : null}
    </section>
    {data.incomplete ? <p className="text-helper text-muted">{t("ledger.cards.chartPartial")}</p> : null}
    {data.metric === "balance" && data.from && data.to ? <section className="rounded-card border border-line bg-surface p-5"><h2 className="text-section-title mb-3">{t("ledger.metricDetail.netTrend")}</h2>
      <table className="w-full text-sm tabular-nums"><thead><tr><th className="text-left">{t("ledger.filters.time")}</th><th className="text-right">{t("ledger.cards.balance")}</th></tr></thead><tbody>{netSeries(data.entries, data.from, data.to).map(row => <tr key={row.label}><td className="py-2">{row.label}</td><td className="text-right">{fxMoney(String(row.amount), data.currency)}</td></tr>)}</tbody></table>
      {(Date.parse(data.to) - Date.parse(data.from)) / 86400000 >= 31 ? <p className="text-helper">{t("ledger.cards.grouped")}</p> : null}
    </section> : null}
    {charts.map(chart => <section key={chart} className="rounded-card border border-line bg-surface p-5"><h2 className="text-section-title mb-4">{t(`ledger.cards.${chart}`)}</h2>{data.from && data.to ? <DetailMiniChart metric={chart} entries={data.entries} from={data.from} to={data.to} currency={data.currency} incomplete={data.incomplete} /> : <p>{t("ledger.cards.chooseRange")}</p>}</section>)}
    <Button onClick={back}>{t("ledger.metricDetail.entries")}</Button>
  </InnerPage>;
}
