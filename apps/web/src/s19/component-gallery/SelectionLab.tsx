// i18n-ignore-file 开发用设计样板：选中指示与已选条件标签，只含静态示例文字，不读写业务数据、不进正式构建。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/Button.js";
import { SegmentedControl, Switch } from "../../components/ui/PurposeControls.js";
import "./selection-lab.css";

/**
 * 选中指示与已选条件标签样板（S19 §2.1，所有者 2026-11-14 定下的方向）。
 * 四种风格是同一个“模型”：会移动的选中、条件标签出现与消失、网格选中，每种风格都有对应动画。
 * 外观全部由 selection-lab.css 按 html[data-visual-style] 切换；这里只负责结构和“会移动的选中块”的位置动画。
 */

type VisualStyle = "a" | "b1" | "b2" | "c";
type Axis = "x" | "y";
interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
interface Option { readonly value: string; readonly label: string; readonly dot?: boolean }

const DIMENSIONS: readonly Option[] = [
  { value: "time", label: "时间", dot: true }, { value: "category", label: "分类" }, { value: "tag", label: "标签" },
  { value: "payment", label: "支付方式" }, { value: "currency", label: "币种" }, { value: "attachment", label: "附件" },
];
const MODES: readonly Option[] = [{ value: "month", label: "月份" }, { value: "range", label: "日期范围" }];
const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);
const CATALOG = ["2026年11月", "分类：餐饮", "标签：出差", "支付方式：微信", "币种：CNY", "附件：有", "分类：交通", "标签：报销"] as const;

function currentStyle(): VisualStyle | null {
  const v = document.documentElement.dataset.visualStyle;
  return v === "a" || v === "b1" || v === "b2" || v === "c" ? v : null;
}
function reducedMotion(): boolean { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

/* ---------- 会移动的选中块：B1/B2 弹性玻璃，C 干脆滑动，A 不用（选项自己浮起，见 CSS） ---------- */

/**
 * B1/B2：与底栏玻璃胶囊同一套形变规则，逐项取自 s19/tabIndicator.ts：
 * MAX_STRETCH=.28（L22）、MOTION_TIME_SCALE=1.08（L24）、stretched()（L133）、slide() 的 5 帧与曲线（L138–L158）、
 * 时长 min(270, max(190, 150+dist*.4)) × 1.08（move() L224）。底栏是横向，这里把“位置/长度”抽象成沿 axis 的量，
 * 竖直列表（左侧维度导航）按同样规则换成竖向：前缘先走（分到 70% 拉伸）、到点越过 1.5–3.5px 再回弹。
 */
const MAX_STRETCH = 0.28;
const MOTION_TIME_SCALE = 1.08;
function glassFrames(from: Rect, to: Rect, axis: Axis): { frames: Keyframe[]; duration: number } {
  const pos = (r: Rect): number => (axis === "x" ? r.x : r.y), len = (r: Rect): number => (axis === "x" ? r.w : r.h);
  const fromC = pos(from) + len(from) / 2, toC = pos(to) + len(to) / 2, d = toC - fromC;
  const dir = d >= 0 ? 1 : -1, dist = Math.abs(d);
  const s = Math.min(len(to) * MAX_STRETCH, dist * 0.35), over = Math.min(3.5, 1.5 + dist * 0.01);
  const frame = (offset: number, p: number, l: number, easing?: string): Keyframe => ({
    offset,
    transform: axis === "x" ? `translate3d(${p}px, ${to.y}px, 0)` : `translate3d(${to.x}px, ${p}px, 0)`,
    [axis === "x" ? "width" : "height"]: `${l}px`,
    ...(easing === undefined ? {} : { easing }),
  });
  const at = (offset: number, c: number, stretch: number, easing?: string): Keyframe => {
    const l = len(to) + stretch;
    return frame(offset, dir > 0 ? c - len(to) / 2 - stretch * 0.3 : c - len(to) / 2 - stretch * 0.7, l, easing);
  };
  return {
    duration: Math.round(Math.min(270, Math.max(190, 150 + dist * 0.4)) * MOTION_TIME_SCALE),
    frames: [
      frame(0, pos(from), len(from), "cubic-bezier(.45, .05, .55, .95)"),
      at(0.4, fromC + d * 0.5, s, "cubic-bezier(.2, .6, .35, 1)"),
      at(0.72, toC + dir * over, s * 0.15, "cubic-bezier(.4, 0, .6, 1)"),
      at(0.88, toC - dir * over * 0.3, 0, "ease-in-out"),
      at(1, toC, 0),
    ],
  };
}

/**
 * C：整块实底干脆滑到新选项，不拉伸、不越界。时长 100ms + 0.3×距离，夹在 120–170ms
 * （起点取 C 的 --lv-select-ms=120ms，components/ui/component-motion.css L5；上限随距离略增，长距离不拖沓），
 * 曲线取 C 的 NAVIGATION.c 缓动 cubic-bezier(.22,.68,.25,1)（lib/motionTokens.ts L80）。
 */
const C_EASING = "cubic-bezier(.22,.68,.25,1)";
function classicFrames(from: Rect, to: Rect, axis: Axis): { frames: Keyframe[]; duration: number } {
  const dist = Math.abs((axis === "x" ? to.x - from.x : to.y - from.y));
  const key = (r: Rect): Keyframe => ({ transform: `translate3d(${r.x}px, ${r.y}px, 0)`, width: `${r.w}px`, height: `${r.h}px` });
  return { duration: Math.round(Math.min(170, Math.max(120, 100 + dist * 0.3))), frames: [{ ...key(from), easing: C_EASING }, key(to)] };
}

function MovingSelect({ options, value, onChange, axis, label, role, slow, className }: {
  options: readonly Option[]; value: string; onChange: (v: string) => void; axis: Axis; label: string; role: "tablist" | "group"; slow: number; className?: string;
}) {
  const box = useRef<HTMLDivElement>(null), block = useRef<HTMLSpanElement>(null), buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const last = useRef<{ index: number } | null>(null), running = useRef<Animation | null>(null);
  const index = Math.max(0, options.findIndex(o => o.value === value));
  const measure = (i: number): Rect | null => { const b = buttons.current[i]; return b ? { x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight } : null; };
  const place = (r: Rect): void => {
    const el = block.current; if (!el) return;
    el.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`; el.style.width = `${r.w}px`; el.style.height = `${r.h}px`;
  };
  useLayoutEffect(() => {
    const el = block.current, host = box.current, to = measure(index); if (!el || !host || !to) return;
    const was = last.current; last.current = { index };
    // 动画被打断时从块此刻所在的位置接着走（同底栏胶囊：不排队）。
    let from: Rect | null = was ? measure(was.index) : null;
    if (running.current && running.current.playState === "running") {
      const r = el.getBoundingClientRect(), h = host.getBoundingClientRect();
      from = { x: r.left - h.left - host.clientLeft, y: r.top - h.top - host.clientTop, w: r.width, h: r.height };
    }
    running.current?.cancel(); running.current = null;
    place(to);
    const style = currentStyle();
    if (!was || was.index === index || from === null || reducedMotion() || (style !== "b1" && style !== "b2" && style !== "c")) return;
    const { frames, duration } = style === "c" ? classicFrames(from, to, axis) : glassFrames(from, to, axis);
    running.current = el.animate(frames, { duration: duration * slow });
  }, [index, axis, slow]);
  useEffect(() => {
    // 窗口尺寸、字体或风格切换后，选项位置会变：静止时重新对齐（不播放动画）。
    const host = box.current; if (!host) return;
    const sync = (): void => { if (running.current) return; const r = measure(index); if (r) place(r); };
    const ro = new ResizeObserver(sync); ro.observe(host);
    const mo = new MutationObserver(sync); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-visual-style"] });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [index]);
  const selectedAttr = role === "tablist" ? "aria-selected" : "aria-pressed";
  return <div ref={box} className={`sl-move ${className ?? ""}`} data-axis={axis} role={role} aria-label={label} {...(role === "tablist" ? { "aria-orientation": "vertical" as const } : {})}>
    <span ref={block} className="sl-block" aria-hidden="true" />
    {options.map((o, i) => <button key={o.value} ref={el => { buttons.current[i] = el; }} type="button" className="sl-opt" {...(role === "tablist" ? { role: "tab" } : {})}
      {...{ [selectedAttr]: o.value === value }} onClick={() => onChange(o.value)}><span>{o.label}</span>{o.dot ? <span className="sl-dot" aria-hidden="true" /> : null}</button>)}
  </div>;
}

/* ---------- 已选条件标签 ---------- */

interface TagItem { readonly id: string; readonly label: string; readonly state: "in" | "rest" | "out" }
type TagMaterial = "frosted" | "porcelain";

function Tag({ label, state, material, freeze, onRemove, onEnd }: { label: string; state: TagItem["state"]; material: TagMaterial; freeze?: boolean; onRemove?: () => void; onEnd?: () => void }) {
  return <span className="sl-tag" data-state={state} data-material={material} data-freeze={freeze || undefined} onAnimationEnd={e => { if (e.target === e.currentTarget) onEnd?.(); }}>
    <span className="sl-tag-label">{label}</span>
    <button type="button" className="sl-tag-x" aria-label={`删除条件：${label}`} {...(onRemove ? { onClick: onRemove } : { tabIndex: -1 })}>×</button>
  </span>;
}

/* ---------- 筛选面板模拟（外壳取真实 S19 sheet 材质：.rounded-t-sheet.bg-surface） ---------- */

function Sheet({ children, title = "筛选" }: { children: ReactNode; title?: string }) {
  return <div className="sl-stage"><div className="sl-sheet rounded-t-sheet bg-surface"><header className="sl-head"><h4>{title}</h4><span className="sl-head-x" aria-hidden="true">×</span></header>{children}</div></div>;
}

function Months({ selected, onSelect, half }: { selected: number; onSelect?: (i: number) => void; half?: number }) {
  return <div className="sl-months">{MONTHS.map((m, i) =>
    <button key={m} type="button" className="sl-opt sl-cell" aria-pressed={selected === i} {...(half === i ? { "data-half": "" } : {})} {...(onSelect ? { onClick: () => onSelect(i) } : { tabIndex: -1 })}>{m}</button>)}</div>;
}

function LiveSheet({ material, slow, runDemo }: { material: TagMaterial; slow: number; runDemo: (api: DemoApi) => void }) {
  const [dim, setDim] = useState("time"), [mode, setMode] = useState("month"), [month, setMonth] = useState(10);
  const [tags, setTags] = useState<TagItem[]>([{ id: "t0", label: CATALOG[0], state: "rest" }, { id: "t1", label: CATALOG[1], state: "rest" }]);
  const seq = useRef(2);
  const add = (): void => setTags(old => {
    const label = CATALOG.find(c => !old.some(t => t.label === c && t.state !== "out")) ?? CATALOG[seq.current % CATALOG.length]!;
    return [...old, { id: `t${seq.current++}`, label, state: "in" }];
  });
  const remove = (id: string): void => {
    if (reducedMotion()) { setTags(old => old.filter(t => t.id !== id)); return; }
    setTags(old => old.map(t => t.id === id ? { ...t, state: "out" } : t));
    window.setTimeout(() => setTags(old => old.filter(t => t.id !== id || t.state !== "out")), 600 * slow); // animationend 的兜底
  };
  const removeLast = (): void => setTags(old => { const t = [...old].reverse().find(x => x.state !== "out"); if (t) window.setTimeout(() => remove(t.id), 0); return old; });
  useEffect(() => { runDemo({ setDim, setMode, setMonth, add, removeLast }); });
  return <Sheet>
    <div className="sl-chips" aria-label="已选条件" aria-live="polite">
      {tags.length === 0 ? <span className="sl-empty">全部（未设条件）</span> : null}
      {tags.map(t => <Tag key={t.id} label={t.label} state={t.state} material={material} onRemove={() => remove(t.id)}
        onEnd={() => { if (t.state === "out") setTags(old => old.filter(x => x.id !== t.id)); else if (t.state === "in") setTags(old => old.map(x => x.id === t.id ? { ...x, state: "rest" } : x)); }} />)}
    </div>
    <div className="sl-body">
      <MovingSelect className="sl-nav" options={DIMENSIONS} value={dim} onChange={setDim} axis="y" label="筛选维度" role="tablist" slow={slow} />
      <div className="sl-options">
        <MovingSelect className="sl-segments" options={MODES} value={mode} onChange={setMode} axis="x" label="时间方式" role="group" slow={slow} />
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

interface DemoApi { setDim: (v: string) => void; setMode: (v: string) => void; setMonth: (v: number) => void; add: () => void; removeLast: () => void }

/* ---------- 静态展示：不用点击，同一屏并排各状态 ---------- */

function StaticBoard() {
  return <div className="sl-static">
    <div><h4 className="sl-cap">① 会移动的选中 · 竖向导航与分段</h4>
      <Sheet title="选中态：分类 / 月份">
        <div className="sl-body">
          <MovingSelect className="sl-nav" options={DIMENSIONS} value="category" onChange={() => {}} axis="y" label="静态：维度导航" role="tablist" slow={1} />
          <div className="sl-options"><MovingSelect className="sl-segments" options={MODES} value="month" onChange={() => {}} axis="x" label="静态：分段" role="group" slow={1} />
            <Months selected={10} half={9} /><p className="sl-note">月份网格：11月已选；10月为“交叉淡化到一半”的定格帧。</p></div>
        </div>
      </Sheet>
    </div>
    <div><h4 className="sl-cap">② 已选条件标签 · 默认 / 出现中 / 消失中（定格）</h4>
      <Sheet title="条件标签">
        <div className="sl-tagrows">
          {(["frosted", "porcelain"] as const).map(m => <div className="sl-tagrow" key={m}>
            <span className="sl-tagrow-name" data-only="b2">{m === "frosted" ? "B2 磨砂" : "B2 瓷片"}</span>
            <Tag label="2026年11月" state="rest" material={m} /><Tag label="分类：餐饮" state="in" material={m} freeze /><Tag label="标签：出差" state="out" material={m} freeze />
          </div>)}
        </div>
        <p className="sl-note">仅 B2 显示磨砂与瓷片两行；A / B1 / C 各只有一种标签。</p>
      </Sheet>
    </div>
  </div>;
}

/* ---------- 章节 ---------- */

export function SelectionLabSection() {
  // 地址参数 ?tint=1 / ?tag=porcelain 只用于截图时直接进入对应开关状态。
  const params = new URLSearchParams(window.location.search);
  const [tint, setTint] = useState(params.get("tint") === "1"), [slow, setSlow] = useState(false);
  // 所有者 2026-11-14 定 B2 条件标签用瓷片；磨砂留作对照（?tag=frosted）。
  const [material, setMaterial] = useState<TagMaterial>(params.get("tag") === "frosted" ? "frosted" : "porcelain");
  const api = useRef<DemoApi | null>(null), timers = useRef<number[]>([]);
  const factor = slow ? 3 : 1;
  const stop = (): void => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => stop, []);
  // ?shot=static / ?shot=live：打开后直接滚到静态展示区或可点击样板，便于固定窗口尺寸截图。
  useEffect(() => {
    const shot = params.get("shot");
    const target = shot === "static" ? ".sl-static" : shot === "live" ? ".sl-live-anchor" : null;
    if (target) window.setTimeout(() => document.querySelector(target)?.scrollIntoView({ block: "start" }), 300);
  }, []);
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
  return <div className="sl-lab" data-tint={tint ? "on" : "off"} data-slow={slow ? "on" : "off"} data-b2-tag={material}>
    <div className="sl-controls">
      <Switch checked={tint} onCheckedChange={setTint}>玻璃加约 10% 品牌绿色调（B1 / B2）</Switch>
      <Switch checked={slow} onCheckedChange={setSlow}>慢放 ×3（看清动画）</Switch>
      <SegmentedControl label="B2 条件标签材质" value={material} options={[{ value: "frosted", label: "B2 标签：磨砂" }, { value: "porcelain", label: "B2 标签：瓷片" }]} onChange={setMaterial} />
      <Button type="button" variant="secondary" fullWidth={false} onClick={play}>自动演示</Button>
    </div>
    <h3>静态展示（截图用，不需点击）</h3>
    <StaticBoard />
    <h3 className="sl-live-anchor">可点击样板</h3>
    <p className="sl-hint">点左侧维度、「月份 / 日期范围」、月份格；用下方按钮增删条件标签，或点“自动演示”。系统开启“减少动态效果”时全部直接切换。</p>
    <LiveSheet material={material} slow={factor} runDemo={a => { api.current = a; }} />
  </div>;
}
