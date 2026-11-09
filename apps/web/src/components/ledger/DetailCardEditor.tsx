import { useViewBookId } from "../../lib/workspaceLedger.js";
import { useEffect, useState } from "react";
import { detailCharts, detailNumbers, detailCardSchema, type DetailMetric } from "@libellum/shared";
import { useAuth } from "../../auth/AuthProvider.js";
import { useGuestIdentity } from "../../lib/guest/session.js";
import { mainDetailMetrics, isDetailChart, useDetailCards, type DetailCards } from "../../lib/detailCards.js";
import { sameCards } from "../../lib/detailCardSync.js";
import { useI18n } from "../../i18n/index.js";
import { PageNavBar } from "../Layouts.js";
import { useGoBack } from "../../lib/connectivity.js";
import { useReturnTo } from "../../lib/entryReturn.js";
import { Button } from "../Button.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { DetailMiniChart, type MiniEntry } from "./DetailMiniChart.js";
import "./detail-card-editor.css";
import "../../s19/editor-surfaces.css";
import { SlidingSelection } from "../ui/SlidingSelection.js";
type Slot = "main" | "first" | "second";
type Draft = Record<Slot, DetailMetric[]>;
const slots: Slot[] = ["main", "first", "second"];
const draftFor = (v: DetailCards): Draft => ({ main: mainDetailMetrics(v), first: [v.first], second: [v.second] });
const samples: MiniEntry[] = [12, 7, 19, 10, 6, 15, 9].flatMap((n, i) => (["expense", "income"] as const).map(kind => ({
  kind, minor: String(n * (kind === "income" ? 200 : 100)), currency: "CNY", occurredLocalDate: "2026-01-0" + (i + 1), categoryId: String(i % 3), categoryName: String(i % 3 + 1),
})));
export function DetailCardEditor() {
  const { user } = useAuth(), guest = useGuestIdentity(), book = useViewBookId();
  return <CardEditorContent key={(guest?.id ?? user?.id ?? "local") + ":" + book} />;
}
function CardEditorContent() {
  const { user } = useAuth(), guest = useGuestIdentity(), { t } = useI18n();
  const sampleNames = [t("ledger.cards.sampleFood"), t("ledger.cards.sampleTravel"), t("ledger.cards.sampleShopping")];
  const previewEntries = samples.map(e => ({ ...e, categoryName: sampleNames[Number(e.categoryId)]! }));
  const config = useDetailCards(guest?.id ?? user?.id ?? "local");
  const [draft, setDraft] = useState(() => draftFor(config.value)), [initial, setInitial] = useState(() => draftFor(config.value));
  const [slot, setSlot] = useState<Slot>("main"), [query, setQuery] = useState("");
  const [group, setGroup] = useState("numbers"), [discard, setDiscard] = useState(false), [failed, setFailed] = useState(false);
  const dirty = !sameCards(draft, initial), source = JSON.stringify(config.value);
  useEffect(() => { if (!dirty) { const next = draftFor(config.value); setDraft(next); setInitial(next); } }, [source]);
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  const valid = detailCardSchema.safeParse({ main: "overview", mainMetrics: draft.main, first: draft.first[0], second: draft.second[0] });
  const goBack = useGoBack("/ledger/more", "parent");
  const returnToLedger = useReturnTo("/");
  const back = () => dirty ? setDiscard(true) : goBack();
  const save = () => {
    if (!valid.success || config.invalid) return;
    if (!config.save(valid.data)) { setFailed(true); return; }
    // 1.19.53：从明细打开的编辑器保存后用 -1 回到明细（默认返回转场），其他入口仍直接替换成明细。
    returnToLedger();
  };
  const metrics: readonly DetailMetric[] = group === "numbers" ? detailNumbers : group === "trends" ? detailCharts.filter(id => id !== "categoryRank") : ["categoryRank"];
  const matches = (query.trim() ? [...detailNumbers, ...detailCharts] : metrics).filter(id => t(`ledger.cards.${id}`).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const used = draft[slot].reduce((n, id) => n + (isDetailChart(id) ? 2 : 1), 0), capacity = slot === "main" ? 2 : 1;
  return <main className="detail-card-editor">
    <PageNavBar title={t("ledger.cards.edit")} condensed onBack={back} widthClass="max-w-[560px]" actions={<Button fullWidth={false} disabled={!valid.success || config.invalid} onClick={save}>{t("ledger.cards.save")}</Button>} />
    <section className="dce-preview" aria-label={t("ledger.cards.preview")}>
      <p className="dce-sample">{t("ledger.cards.sample")}</p>
      <div className="dce-cards">{slots.map(id => <button key={id} type="button" className={"dce-card dce-" + id} data-selected={slot === id} aria-pressed={slot === id} onClick={() => { setSlot(id); }}>
        <span className="dce-slot-name">{t(`ledger.cards.${id}`)}</span>
        <div className="dce-values">{draft[id].length ? draft[id].map(metric => <div key={metric} className={isDetailChart(metric) ? "dce-chart" : ""}><span>{t(`ledger.cards.${metric}`)}</span>{isDetailChart(metric)
          ? <DetailMiniChart metric={metric} entries={previewEntries} from="2026-01-01" to="2026-01-07" currency="CNY" />
          : <strong>{metric === "count" ? "24" : metric === "daily" ? "35.80" : metric === "income" ? "8,600.00" : metric === "expense" ? "1,234.00" : "7,366.00"}</strong>}</div>) : <span className="dce-empty">＋</span>}</div>
      </button>)}</div>
    </section>
    <section className="dce-workbench" data-editor-surface="workspace">
      <div className="dce-fixed">
        <div className="dce-selected">{draft[slot].map(id => <button key={id} type="button" aria-label={t("ledger.cards.remove", { name: t(`ledger.cards.${id}`) })} onClick={() => setDraft({ ...draft, [slot]: draft[slot].filter(x => x !== id) })}>{t(`ledger.cards.${id}`)} <span aria-hidden="true">×</span></button>)}</div>
        <div className="dce-search"><input type="search" aria-label={t("ledger.cards.metricSearch")} placeholder={t("ledger.cards.metricSearch")} value={query} onChange={e => setQuery(e.target.value)} /><Button variant="secondary" fullWidth={false} disabled={!draft[slot].length} onClick={() => setDraft({ ...draft, [slot]: [] })}>{t("ledger.cards.clear")}</Button></div>
        <SlidingSelection className="dce-tabs" role="group" aria-label={t("ledger.cards.add")}>{(["numbers", "trends", "ranking"] as const).map(id => <button key={id} type="button" aria-pressed={group === id} onClick={() => setGroup(id)}>{t(`ledger.cards.${id}`)}</button>)}</SlidingSelection>
      </div>
      <div className="dce-catalogue" tabIndex={0} aria-label={t("ledger.cards.add")}>
        <p className="dce-help">{t("ledger.cards.capacity")}</p>
        {config.conflict ? <div className="dce-notice" role="status"><p>{t("ledger.cards.syncConflict")}</p><button type="button" onClick={() => setFailed(!config.resolve("local"))}>{t("ledger.cards.keepLocal")}</button><button type="button" onClick={() => { if (config.resolve("remote")) { const next = draftFor(config.conflict!.configuration); setDraft(next); setInitial(next); } else setFailed(true); }}>{t("ledger.cards.useRemote")}</button></div> : null}
        {failed || config.invalid || config.syncError ? <p role="alert" className="dce-help">{t(config.invalid ? "ledger.cards.invalid" : failed ? "ledger.cards.saveFailed" : "ledger.cards.syncError")}</p> : config.dirty ? <p className="dce-help">{t("ledger.cards.syncPending")}</p> : null}
        {matches.map(id => {
          const chart = isDetailChart(id), added = draft[slot].includes(id), onlyMain = chart && slot !== "main", full = used + (chart ? 2 : 1) > capacity;
          const hint = onlyMain ? "onlyMain" : added ? "added" : full ? "full" : chart ? id === "categoryRank" ? "rankHint" : id === "expenseBars" ? "barsHint" : "lineHint" : "numericHint";
          return <button className="dce-metric" key={id} type="button" aria-pressed={added} disabled={onlyMain || (!added && full)} onClick={() => setDraft({ ...draft, [slot]: added ? draft[slot].filter(x => x !== id) : [...draft[slot], id] })}><span><span>{t(`ledger.cards.${id}`)}</span><small>{t(`ledger.cards.${hint}`)}</small></span><span aria-hidden="true">{added ? "✓" : "＋"}</span></button>;
        })}
        {!matches.length ? <p className="dce-help">{t("ledger.cards.noMetrics")}</p> : null}
      </div>
    </section>
    <ConfirmDialog open={discard} title={t("ledger.cards.discard")} confirmLabel={t("ledger.cards.discardAction")} onCancel={() => setDiscard(false)} onConfirm={goBack} />
  </main>;
}
