import type { DetailMetric, Transaction } from "@libellum/shared";
import { useI18n } from "../../i18n/index.js";
import { fxMoney } from "../../lib/fxView.js";

export type MiniEntry = Pick<Transaction, "kind" | "currency" | "occurredLocalDate" | "categoryId" | "categoryName"> & { minor: string };
/** 同一时间分桶的收入减支出；只组合既有系列，不把结余当账户余额。 */
export function netSeries(entries: readonly MiniEntry[], from: string, to: string) {
  const income = miniSeries("incomeTrend", entries, from, to);
  const expense = miniSeries("expenseTrend", entries, from, to);
  return income.map((point, index) => ({ label: point.label, amount: point.amount - (expense[index]?.amount ?? 0n) }));
}
export function miniSeries(metric: DetailMetric, entries: readonly MiniEntry[], from: string, to: string) {
  const selected = entries.filter(e => e.kind === (metric === "incomeTrend" ? "income" : "expense") && e.occurredLocalDate >= from && e.occurredLocalDate <= to);
  const amounts = new Map<string, bigint>(), labels = new Map<string, string>();
  for (const e of selected) {
    const key = metric === "categoryRank" ? e.categoryId : e.occurredLocalDate;
    amounts.set(key, (amounts.get(key) ?? 0n) + BigInt(e.minor)); labels.set(key, e.categoryName);
  }
  if (metric === "categoryRank") return [...amounts].sort(([a, x], [b, y]) => x === y ? a.localeCompare(b) : x > y ? -1 : 1).slice(0, 3).map(([key, amount]) => ({ label: labels.get(key) ?? key, amount }));
  const start = Date.parse(from + "T00:00:00Z"), end = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 366 * 86400000) return [];
  const daily = [];
  for (let day = start; day <= end; day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10);
    daily.push({ label: date.slice(5), amount: amounts.get(date) ?? 0n });
  }
  // 宽范围按连续等长区间求和，最多 31 个点；不抽样丢掉交易，也不伪造平滑曲线。
  const step = Math.ceil(daily.length / 31), result = [];
  for (let i = 0; i < daily.length; i += step) result.push({ label: daily[i]!.label, amount: daily.slice(i, i + step).reduce((n, d) => n + d.amount, 0n) });
  return result;
}
export function DetailMiniChart({ metric, entries, from, to, currency, incomplete = false }: {
  metric: DetailMetric; entries: readonly MiniEntry[]; from: string; to: string; currency: string; incomplete?: boolean;
}) {
  const { t } = useI18n(), rows = miniSeries(metric, entries, from, to);
  const max = rows.reduce((n, r) => r.amount > n ? r.amount : n, 0n);
  const ratio = (n: bigint) => max === 0n ? 0 : Number(n * 10000n / max) / 10000;
  if (!rows.length) return <p className="detail-mini-empty">{t("ledger.cards.chartEmpty")}</p>;
  const grouped = metric !== "categoryRank" && (Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 31;
  const title = t(`ledger.cards.${metric}`);
  return <div className="detail-mini">
    {metric === "categoryRank" ? <div className="detail-mini-ranks">{rows.map((r, i) => <div key={i}><div><span>{r.label}</span><span>{fxMoney(String(r.amount), currency)}</span></div><div className="detail-mini-track"><i style={{ width: `${ratio(r.amount) * 100}%` }} /></div></div>)}</div> : <>
      <svg viewBox="0 0 300 80" role="img" aria-label={title} preserveAspectRatio="none">
        <title>{title}</title>
        {metric === "expenseBars" ? rows.map((r, i) => <rect key={i} x={i * 300 / rows.length + 2} y={76 - ratio(r.amount) * 68} width={Math.max(2, 300 / rows.length - 4)} height={ratio(r.amount) * 68} rx="3" fill="currentColor"><title>{r.label}: {fxMoney(String(r.amount), currency)}</title></rect>) : <polyline points={rows.map((r, i) => `${rows.length === 1 ? 150 : 4 + i * 292 / (rows.length - 1)},${76 - ratio(r.amount) * 68}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {rows.length === 1 && metric !== "expenseBars" ? <circle cx="150" cy={76 - ratio(rows[0]!.amount) * 68} r="3" fill="currentColor" /> : null}
      </svg>
      <div className="detail-mini-axis"><span>{rows[0]?.label}</span><span>{t("ledger.cards.peak", { value: fxMoney(String(max), currency) })}</span><span>{rows.at(-1)?.label}</span></div>
    </>}
    {grouped ? <p className="text-helper">{t("ledger.cards.grouped")}</p> : null}
    {incomplete ? <p className="text-helper">{t("ledger.cards.chartPartial")}</p> : null}
  </div>;
}
