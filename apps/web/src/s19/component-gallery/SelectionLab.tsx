// i18n-ignore-file 开发用设计样板：选中指示与已选条件标签，只含静态示例文字，不读写业务数据、不进正式构建。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/Button.js";
import { Switch } from "../../components/ui/PurposeControls.js";
import { ConditionTag, ConditionTags, MovingSelection, SelectionGrid, type ConditionTagItem } from "../../components/ui/SelectionControls.js";
import "./selection-lab.css";

/**
 * 选中指示与已选条件标签样板（S19 §2.1、§2.2；所有者 2026-11-14 定稿：A 用第三版 = A2 档，B1 / B2 选中玻璃不染色，
 * B2 条件标签用瓷片）。1.19.62 起这里**直接引用正式组件**（components/ui/SelectionControls.tsx）与正式令牌，
 * 不再保留第一、二版、染色与磨砂标签的对照实现；外观以 selection-controls.css 为准，本页只给示例布局、慢放与定格帧。
 */

interface Option { readonly value: string; readonly label: string; readonly dot?: boolean }

const DIMENSIONS: readonly Option[] = [
  { value: "time", label: "时间", dot: true }, { value: "category", label: "分类" }, { value: "tag", label: "标签" },
  { value: "payment", label: "支付方式" }, { value: "currency", label: "币种" }, { value: "attachment", label: "附件" },
];
const MODES: readonly Option[] = [{ value: "month", label: "月份" }, { value: "range", label: "日期范围" }];
const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);
const CATALOG = ["2026年11月", "分类：餐饮", "标签：出差", "支付方式：微信", "币种：CNY", "附件：有", "分类：交通", "标签：报销"] as const;
const tagItem = (label: string, key = label): ConditionTagItem => ({ key, label, title: label, removeLabel: `删除条件：${label}` });

function Nav({ value, onChange }: { value: string; onChange?: (v: string) => void }) {
  return <MovingSelection axis="y" className="sl-nav" role="tablist" aria-label="筛选维度" aria-orientation="vertical">
    {DIMENSIONS.map(o => <button key={o.value} type="button" role="tab" className="sl-opt" aria-selected={o.value === value}
      {...(onChange ? { onClick: () => onChange(o.value) } : { tabIndex: -1 })}><span>{o.label}</span>{o.dot ? <span className="sl-dot" aria-hidden="true" /> : null}</button>)}
  </MovingSelection>;
}

function Segments({ value, onChange }: { value: string; onChange?: (v: string) => void }) {
  return <MovingSelection axis="x" className="sl-segments" role="group" aria-label="时间方式">
    {MODES.map(o => <button key={o.value} type="button" className="sl-opt" aria-pressed={o.value === value} {...(onChange ? { onClick: () => onChange(o.value) } : { tabIndex: -1 })}>{o.label}</button>)}
  </MovingSelection>;
}

function Months({ selected, onSelect, half }: { selected: number; onSelect?: (i: number) => void; half?: number }) {
  return <SelectionGrid className="sl-months">{MONTHS.map((m, i) =>
    <button key={m} type="button" className="sl-opt sl-cell" aria-pressed={selected === i} {...(half === i ? { "data-half": "" } : {})} {...(onSelect ? { onClick: () => onSelect(i) } : { tabIndex: -1 })}>{m}</button>)}</SelectionGrid>;
}

/* ---------- 筛选面板模拟（外壳取真实 S19 sheet 材质：.rounded-t-sheet.bg-surface） ---------- */

function Sheet({ children, title = "筛选" }: { children: ReactNode; title?: string }) {
  return <div className="sl-stage"><div className="sl-sheet rounded-t-sheet bg-surface"><header className="sl-head"><h4>{title}</h4><span className="sl-head-x" aria-hidden="true">×</span></header>{children}</div></div>;
}

interface DemoApi { setDim: (v: string) => void; setMode: (v: string) => void; setMonth: (v: number) => void; add: () => void; removeLast: () => void }

function LiveSheet({ runDemo }: { runDemo: (api: DemoApi) => void }) {
  const [dim, setDim] = useState("time"), [mode, setMode] = useState("month"), [month, setMonth] = useState(10);
  const [tags, setTags] = useState<ConditionTagItem[]>([tagItem(CATALOG[0]), tagItem(CATALOG[1])]);
  const add = (): void => setTags(old => {
    const label = CATALOG.find(c => !old.some(t => t.label === c));
    return label === undefined ? old : [...old, tagItem(label)];
  });
  const removeLast = (): void => setTags(old => old.slice(0, -1));
  useEffect(() => { runDemo({ setDim, setMode, setMonth, add, removeLast }); });
  return <Sheet>
    <ConditionTags className="sl-chips" aria-label="已选条件" items={tags} onRemove={key => setTags(old => old.filter(t => t.key !== key))}
      empty={<span className="sl-empty">全部（未设条件）</span>} />
    <div className="sl-body">
      <Nav value={dim} onChange={setDim} />
      <div className="sl-options">
        <Segments value={mode} onChange={setMode} />
        {dim !== "time" ? <p className="sl-note">示例：切到「时间」可看月份网格。</p> : mode === "range" ? <p className="sl-note">日期范围：开始 / 结束日期输入（此处不展示）。</p> : <Months selected={month} onSelect={setMonth} />}
      </div>
    </div>
    <footer className="sl-foot"><span>重置</span><span className="sl-apply">应用</span></footer>
    <div className="sl-actions">
      <Button type="button" variant="secondary" fullWidth={false} onClick={add}>添加条件</Button>
      <Button type="button" variant="secondary" fullWidth={false} onClick={removeLast}>删除最后一个</Button>
    </div>
  </Sheet>;
}

/* ---------- 静态展示：不用点击，同一屏并排各状态 ---------- */

function StaticBoard() {
  return <div className="sl-static">
    <div><h4 className="sl-cap">① 会移动的选中 · 竖向导航与分段</h4>
      <Sheet title="选中态：分类 / 月份">
        <div className="sl-body">
          <Nav value="category" />
          <div className="sl-options"><Segments value="month" />
            <Months selected={10} half={9} /><p className="sl-note">月份网格：11月已选；10月为“交叉淡化到一半”的定格帧。</p></div>
        </div>
      </Sheet>
    </div>
    <div><h4 className="sl-cap">② 已选条件标签 · 默认 / 出现中 / 消失中（定格）</h4>
      <Sheet title="条件标签">
        <div className="sl-tagrow">
          <ConditionTag item={tagItem("2026年11月")} tabIndex={-1} />
          <ConditionTag item={tagItem("分类：餐饮")} state="in" className="sl-freeze" tabIndex={-1} />
          <ConditionTag item={tagItem("标签：出差")} state="out" className="sl-freeze" />
        </div>
        <p className="sl-note">B1 / B2 带淡绿的瓷片；A 带淡绿、轻轻浮起的柔和薄片；C 纸面加细线。</p>
      </Sheet>
    </div>
  </div>;
}

/* ---------- A 浮起档位一览：同一组示例分别放在页面底色与面板底色上（正式令牌 --s19-a-elev-*） ---------- */

const ELEVATIONS: readonly (readonly [string, string, string])[] = [
  ["0", "A0 嵌入", "凹进平面：分段轨道、外观选项组"],
  ["1", "A1 静置", "贴在平面上：普通卡片、分组、摘要小卡"],
  ["2", "A2 浮起", "从原位抬起：选中项、条件标签、小工具"],
  ["3", "A3 悬浮", "浮在页面之上：关键卡、金额框、加号、提示条"],
  ["4", "A4 覆盖", "盖在页面之上的整层：弹出面板、对话框"],
];

function ElevationBoard() {
  return <div className="sl-elev-wrap">
    {(["canvas", "sheet"] as const).map(on => <div key={on}>
      <h4 className="sl-cap">{on === "canvas" ? "放在页面底色上" : "放在面板底色上"}</h4>
      <div className="sl-elev-stage" data-on={on}>
        {ELEVATIONS.map(([level, name, use]) => <div key={level} className="sl-elev-tile" data-level={level}><b>{name}</b><span>{use}</span></div>)}
      </div>
    </div>)}
  </div>;
}

/* ---------- 章节 ---------- */

export function SelectionLabSection() {
  const params = new URLSearchParams(window.location.search);
  const [slow, setSlow] = useState(false);
  const lab = useRef<HTMLDivElement>(null), api = useRef<DemoApi | null>(null), timers = useRef<number[]>([]);
  const factor = slow ? 3 : 1;
  const stop = (): void => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => stop, []);
  // ?shot=static / ?shot=live / ?shot=elev：打开后直接滚到对应区域，便于固定窗口尺寸截图。
  useEffect(() => {
    const shot = params.get("shot");
    const target = shot === "static" ? ".sl-static" : shot === "live" ? ".sl-live-anchor" : shot === "elev" ? ".sl-elev-anchor" : null;
    if (target) window.setTimeout(() => document.querySelector(target)?.scrollIntoView({ block: "start" }), 300);
  }, []);
  // 慢放 ×3：正式组件的时长来自 Motion Token，这里不改它们，只把本节里正在播放的动画（脚本动画与 CSS 过渡）放慢三倍。
  useEffect(() => {
    if (!slow) return;
    let frame = 0;
    const tick = (): void => {
      for (const animation of document.getAnimations()) {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        if (target && lab.current?.contains(target) && animation.playbackRate !== 1 / 3) animation.updatePlaybackRate(1 / 3);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [slow]);
  const play = (): void => {
    stop();
    const steps: readonly (readonly [number, (a: DemoApi) => void])[] = [
      [0, a => { a.setDim("time"); a.setMode("month"); a.setMonth(10); }],
      [700, a => a.setDim("category")], [700, a => a.setDim("tag")], [700, a => a.setDim("attachment")], [900, a => a.setDim("time")],
      [900, a => a.setMode("range")], [900, a => a.setMode("month")],
      [900, a => a.setMonth(2)], [900, a => a.setMonth(8)],
      [900, a => a.add()], [900, a => a.add()], [1100, a => a.removeLast()], [900, a => a.removeLast()],
    ];
    let at = 0;
    for (const [gap, run] of steps) { at += gap * factor; timers.current.push(window.setTimeout(() => { if (api.current) run(api.current); }, at)); }
  };
  return <div ref={lab} className="sl-lab" data-slow={slow ? "on" : "off"}>
    <div className="sl-controls">
      <Switch checked={slow} onCheckedChange={setSlow}>慢放 ×3（看清动画）</Switch>
      <Button type="button" variant="secondary" fullWidth={false} onClick={play}>自动演示</Button>
    </div>
    <h3>静态展示（截图用，不需点击）</h3>
    <StaticBoard />
    <h3 className="sl-elev-anchor">A 浮起档位（在 A 风格下查看）</h3>
    <ElevationBoard />
    <h3 className="sl-live-anchor">可点击样板</h3>
    <p className="sl-hint">点左侧维度、「月份 / 日期范围」、月份格；用下方按钮增删条件标签，或点标签删除，或点“自动演示”。系统开启“减少动态效果”时全部直接切换。</p>
    <LiveSheet runDemo={a => { api.current = a; }} />
  </div>;
}
