// i18n-ignore-file 独立视觉评审样例；正式控件与指标名仍读取现有文案。不接账号或业务存储。
import { detailCardSchema, detailCharts, detailNumbers, isDetailChart, type DetailMetric } from "@libellum/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BottomSheet } from "../../components/BottomSheet.js";
import { ChoiceDialog, type Choice } from "../../components/ChoiceDialog.js";
import { Button } from "../../components/Button.js";
import { PageNavBar } from "../../components/Layouts.js";
import { DetailMiniChart, type MiniEntry } from "../../components/ledger/DetailMiniChart.js";
import { useDialogFocus } from "../../lib/dialogFocus.js";
import { t } from "../../i18n/index.js";
import { applyB2Glass, B2_GLASS_PRESETS, type B2GlassPreset } from "../b2Glass.js";
import "../../index.css";
import "../s19-lab-tokens.css";
import "../shared.css";
import "../ambient.css";
import "../classic.css";
import "../../components/ledger/detail-card-editor.css";
import "./lab.css";

const STYLES = [{ id: "a", name: "柔和薄片" }, { id: "b1", name: "温润瓷质" }, { id: "b2", name: "操作玻璃" }, { id: "c", name: "经典纸面" }] as const;
type Style = typeof STYLES[number]["id"];
type Scene = "books" | "choice" | "editor";
type Slot = "main" | "first" | "second";
type Draft = Record<Slot, DetailMetric[]>;
const SLOTS: Slot[] = ["main", "first", "second"];
const DEFAULT: Draft = { main: ["income", "expense"], first: ["balance"], second: ["daily"] };
const PRESETS = { clear: "清透", balanced: "均衡", soft: "柔和" } as const;
const BOOKS = [
  { id: "daily", name: "日常生活", number: "100001", people: 1 },
  { id: "family", name: "我们的家庭共同账本 · 长名称显示样例", number: "100002", people: 3 },
  { id: "travel", name: "旅行计划", number: "100003", people: 2 },
  { id: "read", name: "家庭资料 · 仅查看", number: "100004", people: 4 },
  { id: "study", name: "学习与成长", number: "100005", people: 1 },
  { id: "home", name: "居家整理", number: "100006", people: 2 },
  { id: "hobby", name: "兴趣记录", number: "100007", people: 1 },
];
const ENTRIES: MiniEntry[] = [12, 7, 19, 10, 6, 15, 9].flatMap((n, i) => (["expense", "income"] as const).map(kind => ({ kind, minor: String(n * (kind === "income" ? 200 : 100)), currency: "CNY", occurredLocalDate: "2026-01-0" + (i + 1), categoryId: String(i % 3), categoryName: ["餐饮", "交通", "购物"][i % 3]! })));
const DEMO_CHOICES: readonly Choice<string>[] = [
  { id: "retry", label: "再试一次", hint: "使用同一张示例图片重新尝试", primary: true },
  { id: "manual", label: "改为手动记账", hint: "保留图片，手动填写信息" },
  { id: "cancel", label: "返回选择图片", dismissive: true },
];
const DISCARD_CHOICES: readonly Choice<string>[] = [{ id: "keep", label: "继续编辑", primary: true, dismissive: true }, { id: "discard", label: "放弃修改" }];

/** 保留真实 ChoiceDialog 的堆叠按钮、默认焦点和取消语义；延迟卸载仅供新外观评审。 */
function ChoiceSample({ discard = false, onChoose }: { readonly discard?: boolean; readonly onChoose: (id: string) => void }) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  useDialogFocus(wrapper);
  const choose = useCallback((id: string) => {
    if (timer.current !== null) return;
    setClosing(true);
    timer.current = setTimeout(() => onChoose(id), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200);
  }, [onChoose]);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  return <div ref={wrapper} className="alab-choice" data-closing={closing} tabIndex={-1}>
    <ChoiceDialog open title={discard ? t("ledger.cards.discard") : "暂时没有识别出记录"} description={discard ? "当前修改还没有保存。" : "你可以再试一次，或换一种方式继续。"} choices={discard ? DISCARD_CHOICES : DEMO_CHOICES} onChoose={choose} />
  </div>;
}

/** BookSwitcherSheet 的高度、头部、列表、选中与当前记账标记保持原结构；数据仅为夹具。 */
function BookSample({ selected, onSelect, onClose }: { readonly selected: string; readonly onSelect: (id: string) => void; readonly onClose: () => void }) {
  const [drag, setDrag] = useState(0), [entered, setEntered] = useState(false);
  const start = useRef<number | null>(null);
  useEffect(() => { const id = setTimeout(() => setEntered(true), 280); return () => clearTimeout(id); }, []);
  const down = (event: PointerEvent<HTMLElement>) => {
    if (!entered || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    start.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLElement>) => { if (start.current !== null) setDrag(Math.max(0, event.clientY - start.current)); };
  return <div className="alab-book-sheet" data-entered={entered} data-dragging={drag > 0} style={{ "--alab-drag": `${drag}px` } as CSSProperties}>
    <BottomSheet label={t("books.switcher.title")} onClose={onClose} dialogClassName="alab-sheet">
      {close => {
        const up = (event: PointerEvent<HTMLElement>) => {
          // 松手坐标为准，避免移动与松手在同一批事件中时读取到上一帧 state。
          const distance = start.current === null ? 0 : Math.max(0, event.clientY - start.current);
          if (distance > 90) { setDrag(distance); close(); } else setDrag(0);
          start.current = null;
        };
        return <>
          <div className="alab-sheet-heading" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDrag(0); }}>
            <div data-sheet-drag className="flex justify-center pt-3 pb-1"><span aria-hidden="true" className="h-1 w-10 rounded-full bg-line" /></div>
            <div data-sheet-drag className="flex items-center justify-between gap-3 px-5 pt-2 pb-1">
              <h2 className="text-base font-medium text-ink">{t("books.switcher.title")}</h2>
              <button type="button" onClick={close} aria-label={t("books.switcher.close")} className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-canvas">×</button>
            </div>
          </div>
          <p className="shrink-0 px-5 pb-3 text-helper-relaxed text-muted">{t("books.switcher.hint.view")}</p>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <ul className="border-t border-line">{BOOKS.map(book => <li key={book.id}>
              <button type="button" aria-pressed={selected === book.id} onClick={() => { onSelect(book.id); close(); }} className={`flex min-h-14 w-full items-center gap-3 border-b border-line px-5 py-3 text-left transition hover:bg-canvas ${selected === book.id ? "bg-brand-soft/50" : ""}`}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="truncate text-body text-ink">{book.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-helper text-muted"><span className="font-mono">{book.number}</span><span>·</span><span>{t("books.people", { count: book.people })}</span>{book.id === "daily" ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-micro text-brand-dark">{t("books.currentAccounting")}</span> : null}</span>
                </span><span className="flex size-6 shrink-0 items-center justify-center text-brand" aria-hidden="true">{selected === book.id ? "✓" : ""}</span>
              </button>
            </li>)}</ul>
          </div>
        </>;
      }}
    </BottomSheet>
  </div>;
}

function PreviewCards({ draft, slot, choose }: { readonly draft: Draft; readonly slot?: Slot; readonly choose?: (slot: Slot) => void }) {
  return <section className="dce-preview" aria-label={t("ledger.cards.preview")}>
    <p className="dce-sample">{t("ledger.cards.sample")}</p>
    <div className="dce-cards">{SLOTS.map(id => {
      const contents = <><span className="dce-slot-name">{t(`ledger.cards.${id}`)}</span><div className="dce-values">{draft[id].length ? draft[id].map(metric => <div key={metric} className={isDetailChart(metric) ? "dce-chart" : ""}><span>{t(`ledger.cards.${metric}`)}</span>{isDetailChart(metric)
        ? <DetailMiniChart metric={metric} entries={ENTRIES} from="2026-01-01" to="2026-01-07" currency="CNY" />
        : <strong>{metric === "count" ? "24" : metric === "daily" ? "35.80" : metric === "income" ? "8,600.00" : metric === "expense" ? "1,234.00" : "7,366.00"}</strong>}</div>) : <span className="dce-empty">＋</span>}</div></>;
      return choose ? <button key={id} type="button" className={`dce-card dce-${id}`} data-selected={slot === id} aria-pressed={slot === id} aria-label={t(`ledger.cards.${id}`)} onClick={() => choose(id)}>{contents}</button> : <div key={id} className={`dce-card dce-${id}`}>{contents}</div>;
    })}</div>
  </section>;
}

/** 对齐 DetailCardEditor 的 JSX / 容量与搜索行为；复用 schema、指标目录和实际图表，保存只更新本页内存。 */
function EditorSample({ initial, onSave, onBack }: { readonly initial: Draft; readonly onSave: (draft: Draft) => void; readonly onBack: () => void }) {
  const [draft, setDraft] = useState<Draft>(initial), [slot, setSlot] = useState<Slot>("main"), [query, setQuery] = useState("");
  const [group, setGroup] = useState("numbers"), [discard, setDiscard] = useState(false);
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  const valid = detailCardSchema.safeParse({ main: "overview", mainMetrics: draft.main, first: draft.first[0], second: draft.second[0] }).success;
  const metrics = group === "numbers" ? detailNumbers : group === "trends" ? detailCharts.filter(id => id !== "categoryRank") : ["categoryRank" as const];
  const matches = (query.trim() ? [...detailNumbers, ...detailCharts] : metrics).filter(id => t(`ledger.cards.${id}`).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const used = draft[slot].reduce((n, id) => n + (isDetailChart(id) ? 2 : 1), 0), capacity = slot === "main" ? 2 : 1;
  const back = () => dirty ? setDiscard(true) : onBack();
  return <main className="detail-card-editor alab-editor">
    <PageNavBar title={t("ledger.cards.edit")} condensed onBack={back} widthClass="max-w-[560px]" actions={<Button fullWidth={false} disabled={!valid} onClick={() => onSave(draft)}>{t("ledger.cards.save")}</Button>} />
    <PreviewCards draft={draft} slot={slot} choose={setSlot} />
    <section className="dce-workbench">
      <div className="dce-fixed">
        <div className="dce-selected">{draft[slot].map(id => <button key={id} type="button" aria-label={t("ledger.cards.remove", { name: t(`ledger.cards.${id}`) })} onClick={() => setDraft({ ...draft, [slot]: draft[slot].filter(x => x !== id) })}>{t(`ledger.cards.${id}`)} <span aria-hidden="true">×</span></button>)}</div>
        <div className="dce-search"><input type="search" aria-label={t("ledger.cards.metricSearch")} placeholder={t("ledger.cards.metricSearch")} value={query} onChange={e => setQuery(e.target.value)} /><Button variant="secondary" fullWidth={false} disabled={!draft[slot].length} onClick={() => setDraft({ ...draft, [slot]: [] })}>{t("ledger.cards.clear")}</Button></div>
        <div className="dce-tabs" role="group" aria-label={t("ledger.cards.add")}>{(["numbers", "trends", "ranking"] as const).map(id => <button key={id} type="button" aria-pressed={group === id} onClick={() => setGroup(id)}>{t(`ledger.cards.${id}`)}</button>)}</div>
      </div>
      <div className="dce-catalogue" tabIndex={0} aria-label={t("ledger.cards.add")}>
        <p className="dce-help">{t("ledger.cards.capacity")}</p>
        {matches.map(id => {
          const chart = isDetailChart(id), added = draft[slot].includes(id), onlyMain = chart && slot !== "main", full = used + (chart ? 2 : 1) > capacity;
          const hint = onlyMain ? "onlyMain" : added ? "added" : full ? "full" : chart ? id === "categoryRank" ? "rankHint" : id === "expenseBars" ? "barsHint" : "lineHint" : "numericHint";
          return <button className="dce-metric" key={id} type="button" aria-pressed={added} disabled={onlyMain || (!added && full)} onClick={() => setDraft({ ...draft, [slot]: added ? draft[slot].filter(x => x !== id) : [...draft[slot], id] })}><span><span>{t(`ledger.cards.${id}`)}</span><small>{t(`ledger.cards.${hint}`)}</small></span><span aria-hidden="true">{added ? "✓" : "＋"}</span></button>;
        })}
        {!matches.length ? <p className="dce-help">{t("ledger.cards.noMetrics")}</p> : null}
      </div>
    </section>
    {discard ? <ChoiceSample discard onChoose={id => { if (id === "discard") onBack(); else setDiscard(false); }} /> : null}
  </main>;
}

function Lab() {
  const params = new URLSearchParams(location.search);
  const [style, setStyle] = useState<Style>(() => STYLES.find(s => s.id === params.get("style"))?.id ?? "a");
  const [preset, setPreset] = useState<B2GlassPreset>(() => Object.keys(PRESETS).includes(params.get("preset") ?? "") ? params.get("preset") as B2GlassPreset : "balanced");
  const [scene, setScene] = useState<Scene>(() => ["books", "choice", "editor"].includes(params.get("sample") ?? "") ? params.get("sample") as Scene : "books");
  const [sheet, setSheet] = useState(false), [choice, setChoice] = useState(false), [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState("daily"), [saved, setSaved] = useState<Draft>(DEFAULT);
  const [message, setMessage] = useState(""), [controls, setControls] = useState(true), [dense, setDense] = useState(true), [noBlur, setNoBlur] = useState(false);
  const bar = useRef<HTMLElement>(null), shell = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.adaptationLab = "true";
    root.dataset.visualStyle = style;
    root.dataset.themeMode = "light";
    root.dataset.themePalette = "green";
    root.dataset.labNoBlur = String(noBlur);
    applyB2Glass(root.style, B2_GLASS_PRESETS[preset], preset);
    // 只更新当前实验 URL 便于手机收藏；不读写真实外观偏好。
    const url = new URL(location.href); url.searchParams.set("style", style); url.searchParams.set("preset", preset); url.searchParams.set("sample", scene);
    history.replaceState(null, "", url);
  }, [style, preset, scene, noBlur]);
  useLayoutEffect(() => {
    const node = bar.current;
    const measure = () => shell.current?.style.setProperty("--alab-controls-height", controls && node ? `${node.getBoundingClientRect().height}px` : "0px");
    measure(); if (!node) return;
    const observer = new ResizeObserver(measure); observer.observe(node); return () => observer.disconnect();
  }, [controls]);
  const closeSheet = useCallback(() => setSheet(false), []);
  const choose = useCallback((id: string) => { setChoice(false); setMessage(id === "retry" ? "已选择再试一次（样例）" : id === "manual" ? "已选择手动记账（样例）" : "已返回选择图片（样例）"); }, []);
  const run = () => { setMessage(""); if (scene === "books") setSheet(true); else if (scene === "choice") setChoice(true); else { setEditing(true); setControls(false); } };
  const modal = sheet || choice;
  return <div ref={shell} className="lv-shell alab-shell" data-shell="contents" data-instance="adaptation-lab" data-controls={controls}>
    {controls ? <header ref={bar} className="alab-controls" aria-label="实验设置">
      <div className="alab-control-title"><span>界面样例 · 01</span>{!editing ? <button type="button" disabled={modal} onClick={run}>打开样例</button> : null}<button type="button" onClick={() => setControls(false)}>收起设置</button></div>
      <div className="alab-style-options" role="group" aria-label="视觉风格">{STYLES.map(s => <button key={s.id} type="button" aria-pressed={style === s.id} onClick={() => setStyle(s.id)}>{s.id.toUpperCase()}<span>{s.name}</span></button>)}</div>
      {style === "b2" ? <div className="alab-preset-options" role="group" aria-label="B2 玻璃预设">{(Object.keys(PRESETS) as B2GlassPreset[]).map(id => <button key={id} type="button" aria-pressed={preset === id} onClick={() => setPreset(id)}>{PRESETS[id]}</button>)}</div> : null}
      <div className="alab-test-options"><label><input type="checkbox" checked={dense} onChange={e => setDense(e.target.checked)} /> 密集文字背景</label>{style === "b2" ? <label><input type="checkbox" checked={noBlur} onChange={e => setNoBlur(e.target.checked)} /> 无滤镜对照</label> : null}</div>
    </header> : <button type="button" className="alab-reopen" aria-label="展开实验设置" onClick={() => setControls(true)}>{style.toUpperCase()}{style === "b2" ? ` · ${PRESETS[preset]}` : ""} · 设置</button>}
    <div className="alab-stage" data-modal={modal}>
      {editing ? <EditorSample initial={saved} onSave={draft => { setSaved(draft); setEditing(false); setMessage("已保存到本次样例，刷新后重置。"); }} onBack={() => setEditing(false)} /> : <main className="alab-home">
        <header className="alab-title"><p>LIBEVRA / S19</p><h1>弹窗与编辑页</h1><p>三个可操作样例，仅使用示例数据。</p></header>
        <div className="alab-samples" role="group" aria-label="选择样例">{([{ id: "books", label: "账本弹窗" }, { id: "choice", label: "选择窗口" }, { id: "editor", label: "展示卡片" }] as const).map(s => <button key={s.id} type="button" aria-pressed={scene === s.id} onClick={() => setScene(s.id)}>{s.label}</button>)}</div>
        <section className="alab-launch">
          <h2>{scene === "books" ? "选择查看的账本" : scene === "choice" ? "有几种方式继续" : "先看成品，再编辑"}</h2>
          <p>{scene === "books" ? `正在查看：${BOOKS.find(b => b.id === selected)!.name}` : scene === "choice" ? "保持原有的居中窗口与纵向选项。" : "上方预览与实际内容卡同材质，下方是稳定的编辑工作区。"}</p>
          <Button onClick={run}>{scene === "books" ? "打开账本选择" : scene === "choice" ? "打开选择窗口" : "编辑展示卡片"}</Button>
        </section>
        {message ? <p className="alab-feedback" role="status">{message}</p> : null}
        {scene === "editor" ? <PreviewCards draft={saved} /> : null}
        {dense ? <section className="alab-background-list" aria-label="示例明细背景">{Array.from({ length: 16 }, (_, i) => <div key={i}><span><b>{["午餐与咖啡", "地铁通勤", "日常采购", "书籍与学习"][i % 4]}</b><small>11 月 {String(8 - i % 7).padStart(2, "0")} 日 · 示例记录</small></span><strong>−{["36.00", "8.00", "128.50", "59.00"][i % 4]}</strong></div>)}</section> : null}
        <p className="alab-footnote">所有选择只留在本页内存；不修改账目、外观偏好或真实展示卡片。</p>
      </main>}
    </div>
    {sheet ? <BookSample selected={selected} onSelect={id => { setSelected(id); setMessage(`已选择查看：${BOOKS.find(b => b.id === id)!.name}`); }} onClose={closeSheet} /> : null}
    {choice ? <ChoiceSample onChoose={choose} /> : null}
  </div>;
}

// 开发热更新复用同一 React root，避免共享样式更新时对同一容器重复 createRoot。
const root: Root = (import.meta.hot?.data["adaptationRoot"] as Root | undefined) ?? createRoot(document.getElementById("adaptation-lab")!);
root.render(<Lab />);
if (import.meta.hot) import.meta.hot.data["adaptationRoot"] = root;
