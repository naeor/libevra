// i18n-ignore-file 本机组件规范与交互示例，不读取真实账本或保存正式外观设置。
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../components/Button.js";
import { Card, ActionCard } from "../../components/Card.js";
import { TextField } from "../../components/TextField.js";
import { CopyButton } from "../../components/CopyButton.js";
import { BottomSheet } from "../../components/BottomSheet.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { ChoiceSheet } from "../../components/ui/ChoiceSheet.js";
import { CapsuleButton, IconButton, SegmentedControl, Switch } from "../../components/ui/PurposeControls.js";
import { MotionPresence, useComponentFeedback } from "../../components/ui/ComponentMotion.js";
import { StandardStatesExample } from "./StandardStates.js";
import { LayoutPatterns, StandaloneBottomPattern } from "./LayoutPatterns.js";
import { applyB2Glass, B2_GLASS_PRESETS, type B2GlassPreset } from "../b2Glass.js";
import { MATERIAL_DEFAULTS, materialCapability, materialTuningStyle, type MaterialAppearance, type MaterialFinish } from "../material.js";
import "../../index.css";
import "../s19.css";
import "../overlays.css";
import "./gallery.css";

const STYLES = [{ value: "a", label: "A" }, { value: "b1", label: "B1" }, { value: "b2", label: "B2" }, { value: "c", label: "C" }] as const;
type Style = typeof STYLES[number]["value"];
const NAMES = { a: "Soft Surface · 柔和薄片", b1: "Porcelain · 温润瓷质", b2: "Glass · 轻盈玻璃", c: "Classic Surface · 经典纸面" };
const PRESETS = [{ value: "clear", label: "清透" }, { value: "balanced", label: "均衡" }, { value: "soft", label: "柔和" }] as const;
const SECTIONS = [{ id: "buttons", name: "按钮" }, { id: "cards", name: "卡片与材质" }, { id: "capsules", name: "胶囊" }, { id: "inputs", name: "输入与选择" }, { id: "overlays", name: "弹窗与面板" }, { id: "motion", name: "动效" }, { id: "states", name: "标签与状态" }, { id: "layouts", name: "布局模式" }];

function Example({ title, note, code, children }: { title: string; note: string; code: string; children: ReactNode }) {
  return <div className="cg-example"><h3>{title}</h3><p>{note}</p><div className="cg-specimen">{children}</div><details><summary>调用示例 · 复制</summary><CopyButton text={code} label="复制代码" variant="secondary" rows={Math.min(6, code.split("\n").length + 1)} /></details></div>;
}
function Range({ label, value, onChange, min = 0, max = 100 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return <label className="cg-range"><span>{label}<output>{value}</output></span><input type="range" aria-label={label} min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} /></label>;
}
function Gallery() {
  const [style, setStyle] = useState<Style>(() => STYLES.find(s => s.value === new URLSearchParams(location.search).get("style"))?.value ?? "b2");
  const [preset, setPreset] = useState<B2GlassPreset>("balanced"), [finish, setFinish] = useState<MaterialFinish>("auto"), [enhanced, setEnhanced] = useState(false);
  const [edge, setEdge] = useState<number>(MATERIAL_DEFAULTS.edge * 100), [reflection, setReflection] = useState<number>(MATERIAL_DEFAULTS.reflection * 100);
  const [opacity, setOpacity] = useState<number | undefined>(), [radius, setRadius] = useState<number | undefined>(), [elevation, setElevation] = useState<NonNullable<MaterialAppearance["elevation"]>>("default");
  const [selected, setSelected] = useState(false), [enabled, setEnabled] = useState(true), [choice, setChoice] = useState("daily"), [panel, setPanel] = useState<"none" | "choice" | "sheet" | "confirm">("none");
  const [visible, setVisible] = useState(true), [renderCount, setRenderCount] = useState(0), [success, setSuccess] = useState(0), [loading, setLoading] = useState(false);
  const feedback = useRef<HTMLParagraphElement>(null); useComponentFeedback(feedback, success);
  useLayoutEffect(() => {
    const root = document.documentElement; root.dataset.visualStyle = style;
    // 仅本独立文档内调参；展示透明度只改 content，操作面继续读取 chrome。
    applyB2Glass(root.style, { ...B2_GLASS_PRESETS[preset], ...(opacity === undefined ? {} : { content: 100 - opacity }) }, preset);
  }, [style, preset, opacity]);
  const appearance: MaterialAppearance = { finish, optics: enhanced ? "enhanced" : "stable", elevation };
  const changeStyle = (next: Style) => { setStyle(next); setFinish("auto"); };
  const reset = () => { setEdge(MATERIAL_DEFAULTS.edge * 100); setReflection(MATERIAL_DEFAULTS.reflection * 100); setOpacity(undefined); setRadius(undefined); setElevation("default"); setEnhanced(false); setFinish("auto"); };
  const capability = materialCapability(finish);
  return <main className="lv-shell cg-page" data-shell="contents" style={materialTuningStyle({ edge: edge / 100, reflection: reflection / 100, ...(radius === undefined ? {} : { radius }) })}>
    <header className="cg-heading"><p>LIBEVRA / DESIGN SYSTEM</p><h1>Component Gallery</h1><p>从用途出发。这里的控件与正式应用共用组件和材质。</p></header>
    <div className="cg-layout"><aside className="cg-controls" aria-label="预览设置">
      <h2>四种风格，同一套组件</h2><SegmentedControl label="视觉风格" value={style} options={STYLES} onChange={changeStyle} /><p className="cg-style-name">{NAMES[style]}</p>
      {style === "b2" ? <><SegmentedControl label="B2 玻璃预设" value={preset} options={PRESETS} onChange={v => { setPreset(v); setOpacity(undefined); }} /><p>展示卡片读取内容玻璃；操作面板读取更清晰的操作材质。主按钮保持实体品牌色。</p></> : null}
      <nav aria-label="组件分类" className="cg-index">{SECTIONS.map(s => <a href={`#${s.id}`} key={s.id}>{s.name}<span aria-hidden="true">↗</span></a>)}</nav>
      <details className="cg-tuning"><summary>高级材质 · 仅本页</summary>
        <label className="cg-select-label">材质变体<select aria-label="材质变体" className="rounded-field border border-line bg-surface text-section-title" value={finish} onChange={e => setFinish(e.target.value as MaterialFinish)}><option value="auto">稳定默认</option>{(style === "b1" ? ["satin", "glazed"] : style === "b2" ? ["frosted", "clear", "lens"] : []).map(v => <option key={v} value={v}>{v}</option>)}</select></label>
        {style === "b2" ? <><Switch checked={enhanced} onCheckedChange={setEnhanced}>增强边缘候选</Switch><Range label="光学边缘 %" value={edge} onChange={setEdge} /><Range label="展示填充 %" min={15} max={90} value={opacity ?? 100 - B2_GLASS_PRESETS[preset].content} onChange={setOpacity} /></> : null}
        {style === "b1" ? <Range label="瓷片反射 %" value={reflection} onChange={setReflection} /> : null}
        <Range label="卡片圆角 px" min={8} max={32} value={radius ?? (style === "c" ? 16 : 20)} onChange={setRadius} />
        <label className="cg-select-label">阴影层级<select aria-label="阴影层级" className="rounded-field border border-line bg-surface text-section-title" value={elevation} onChange={e => setElevation(e.target.value as NonNullable<MaterialAppearance["elevation"]>)}><option value="default">用途默认</option><option value="flat">平面</option><option value="raised">强调</option></select></label>
        <Button type="button" variant="secondary" onClick={reset}>恢复默认</Button><p>不会修改正式偏好。任意 DOM 背景不放大；{finish === "auto" ? "Clear / Lens" : finish} 的目标倍率 {capability.target.toFixed(2)}× 仅用于适当纹理场景。</p>
      </details>
      <a className="cg-link" href="/material-lab.html?view=lens">查看已知纹理的放大对照 →</a><p>新的共享候选仍待 iPhone Safari 验收。WebGL 曲面折射仅留在 Material Lab。</p>
    </aside><div className="cg-content">
      <section id="buttons"><h2><span>01</span> 操作按钮</h2><Example title="用途决定颜色与层级" note="主要操作保持清楚的品牌色。危险操作不借用品牌色；禁用与加载均阻止重复点击。长按可预览按压反馈，键盘 Tab 可检查焦点。" code={'import { Button } from "../components/Button.js";\n<Button variant="primary" motion onClick={save}>保存</Button>\n<Button variant="secondary">取消</Button>\n<Button variant="danger" loading={busy}>删除</Button>'}>
        <div className="cg-grid"><Button type="button" motion appearance={appearance} onClick={() => setSuccess(v => v + 1)}>保存</Button><Button type="button" variant="secondary" motion appearance={appearance}>查看详情</Button><Button type="button" variant="danger" motion>删除</Button><Button type="button" variant="danger-quiet" motion>移除选择</Button><Button type="button" disabled>不可用</Button><Button type="button" loading>处理中</Button></div>
        <div className="cg-row"><IconButton label="添加样例" appearance={appearance} onClick={() => setSelected(!selected)} aria-pressed={selected}>＋</IconButton><IconButton label="更多操作" appearance={appearance}>⋯</IconButton><IconButton label="不可用工具" disabled>×</IconButton><span>工具按钮 · 44px 点击区</span></div>
      </Example></section>
      <section id="cards"><h2><span>02</span> 卡片与材质</h2><Example title="展示、操作和编辑各有语义" note="展示卡片承载信息；整块点击用 ActionCard；内部有编辑按钮时使用 Card，避免嵌套按钮。下面数据仅是展示文本。" code={'import { Card, ActionCard } from "../components/Card.js";\n<Card>展示内容</Card>\n<ActionCard onClick={openDetails}>查看详情</ActionCard>\n<Card appearance={{ finish: "glazed" }}>瓷面强调</Card>'}>
        <div className="cg-grid cg-colored"><Card appearance={appearance}><p className="cg-kicker">普通数据展示</p><p className="cg-amount">1,280<span>示例</span></p><p>清晰的内容层级</p></Card><ActionCard appearance={appearance} aria-pressed={selected} onClick={() => setSelected(!selected)}><span className="cg-kicker">可点击卡片</span><strong className="cg-action-title">{selected ? "已选中 ✓" : "查看详情 ↗"}</strong><span>点按切换选择状态</span></ActionCard></div>
        <Card appearance={appearance}><div className="cg-row"><div><h3>可编辑卡片</h3><p>编辑动作独立于信息区域</p></div><IconButton label="编辑样例" onClick={() => setPanel("sheet")}>✎</IconButton></div></Card>
        {style === "b1" ? <div className="cg-grid cg-colored">{(["satin", "glazed"] as const).map(v => <Card key={v} appearance={{ finish: v }}><h3>{v === "satin" ? "Satin / 磨砂瓷" : "Glazed / 釉面瓷"}</h3><p>同一底座、厚度和圆角</p><p>{v === "satin" ? "宽而柔的漫散反光" : "集中镜面与虚拟光源"}</p></Card>)}</div> : null}
        {style === "b2" ? <><div className="cg-glass-grid cg-colored">{(["frosted", "clear", "lens"] as const).map(v => <Card key={v} appearance={{ finish: v, optics: enhanced ? "enhanced" : "stable" }}><h3>{v}</h3><p>目标 {MATERIAL_DEFAULTS.magnification[v].toFixed(2)}×</p><p>{v === "frosted" ? "原生磨砂，文字保持清晰" : "DOM 场景降级为稳定玻璃"}</p></Card>)}</div><p>Clear / Lens 在此都不复制页面背景。可控纹理放大使用实验页已有实现，本页没有 WebGL 管线。</p></> : null}
      </Example></section>
      <section id="capsules"><h2><span>03</span> 胶囊与辅助控件</h2><Example title="轻量辅助，不争夺主操作" note="保持内容自适应与长名称省略。所有风格均不附加胶囊背景模糊；正式账本胶囊及它的专属动画继续保留。" code={'import { CapsuleButton } from "../components/ui/PurposeControls.js";\n<CapsuleButton icon={<BookIcon />} onClick={openPicker}>我的账本 ˅</CapsuleButton>'}>
        <div className="cg-row"><CapsuleButton icon="▤" appearance={appearance} onClick={() => setPanel("choice")}>日常生活 ˅</CapsuleButton><CapsuleButton disabled>不可用</CapsuleButton></div><CapsuleButton appearance={appearance} onClick={() => setPanel("choice")}>一个用于检查长名称省略的家庭日常共同账本 ˅</CapsuleButton>
      </Example></section>
      <section id="inputs"><h2><span>04</span> 输入与选择</h2><Example title="清晰度先于透明感" note="输入框使用清楚的实体内衬。选择面板复用 ChoiceSheet；分段复用已有滑动胶囊，只播放一次选中动画。" code={'<TextField label="名称" hint="给条目一个名字" />\n<SegmentedControl label="范围" value={value} options={options} onChange={setValue} />\n<Switch checked={enabled} onCheckedChange={setEnabled}>启用</Switch>'}>
        <TextField label="名称" placeholder="输入一个示例名称" hint="只保留在当前页面" /><TextField label="禁用输入" disabled defaultValue="不可编辑" /><TextField label="有待修正" aria-invalid="true" hint="示例：请填写名称" />
        <SegmentedControl label="示例范围" value={choice} options={[{ value: "daily", label: "日常" }, { value: "travel", label: "旅行" }, { value: "locked", label: "锁定", disabled: true }]} onChange={setChoice} /><Switch checked={enabled} onCheckedChange={setEnabled}>启用提醒（展示）</Switch><Button type="button" variant="secondary" onClick={() => setPanel("choice")}>打开选择面板 · {choice === "daily" ? "日常" : "旅行"}</Button>
      </Example></section>
      <section id="overlays"><h2><span>05</span> 弹窗与操作面板</h2><Example title="复用已有焦点、关闭与安全区处理" note="操作面使用现有工具玻璃与原生模糊，透光低于展示卡片。不要用旧页透出强度控制操作面。它们继续使用原来的进出协调器，不叠加 MotionPresence。" code={'<ConfirmDialog open={open} title="确认选择？" tone="default" onConfirm={confirm} onCancel={close} />\n<BottomSheet label="操作" onClose={close}>{closeWithAnimation => <Button onClick={closeWithAnimation}>完成</Button>}</BottomSheet>'}>
        <div className="cg-grid"><Button type="button" variant="secondary" onClick={() => setPanel("confirm")}>中央确认框</Button><Button type="button" variant="secondary" onClick={() => setPanel("sheet")}>底部操作面板</Button></div>
      </Example></section>
      <section id="motion"><h2><span>06</span> 动效与触发时机</h2><Example title="状态改变，才有对应反馈" note="初次挂载不入场；visible 不变时，即使重渲染也不播放。快速开关从当前位置反向。减少动态效果时即时到位，加载状态仍保留文字。" code={'<MotionPresence visible={show}><CapsuleButton>筛选</CapsuleButton></MotionPresence>\n// visible 不依赖每次路由渲染，不使用 pathname 作为 key\nuseComponentFeedback(statusRef, completedCount);\n<Button loading={busy}>保存</Button>'}>
        <div className="cg-row"><Button type="button" variant="secondary" fullWidth={false} data-toggle-presence onClick={() => setVisible(v => !v)}>{visible ? "收起" : "显示"}</Button><Button type="button" variant="ghost" fullWidth={false} data-rerender onClick={() => setRenderCount(v => v + 1)}>保持可见性 · 重渲染 {renderCount}</Button></div>
        <div className="cg-motion-stage"><MotionPresence visible={visible} data-motion-sample><CapsuleButton icon="✓">同一个胶囊</CapsuleButton></MotionPresence></div>
        <div className="cg-row"><Button type="button" motion fullWidth={false} data-feedback onClick={() => setSuccess(v => v + 1)}>完成反馈</Button><Switch checked={loading} onCheckedChange={setLoading}>加载状态</Switch></div><Button type="button" loading={loading} variant="secondary">{loading ? "处理中" : "准备就绪"}</Button><p ref={feedback} role="status" data-feedback-status>{success ? `已完成 ${success} 次示例操作` : "等待操作完成"}</p>
      </Example></section>
      <section id="states"><h2><span>07</span> 标签、搜索与状态反馈</h2><div className="cg-example"><StandardStatesExample /></div></section>
      <section id="layouts"><h2><span>08</span> 布局模式</h2><div className="cg-example"><LayoutPatterns style={style} preset={preset} /></div></section>
      <footer className="cg-footer">标准组件 → 共享材质 → 既有 Token。业务页面的布局、权限、导航由页面负责。<br />普通使用只声明用途；候选材质通过 appearance 显式开启。</footer>
    </div></div>
    <ConfirmDialog open={panel === "confirm"} title="确认这次示例选择？" description="这是组件展示，不会修改账目。" tone="default" onConfirm={() => { setSuccess(v => v + 1); setPanel("none"); }} onCancel={() => setPanel("none")} />
    <ChoiceSheet open={panel === "choice"} title="选择示例范围" options={[{ value: "daily", label: "日常生活" }, { value: "travel", label: "旅行计划" }, { value: "locked", label: "锁定示例", disabled: true }]} value={choice} onSelect={setChoice} onClose={() => setPanel("none")} />
    {panel === "sheet" ? <BottomSheet label="示例操作" onClose={() => setPanel("none")}>{close => <div className="cg-sheet"><h2>操作面板</h2><p>操作文字应比背后展示内容更容易辨认。</p><TextField label="示例标题" defaultValue="周末计划" /><Button type="button" motion onClick={close}>完成</Button><Button type="button" variant="secondary" onClick={close}>取消</Button></div>}</BottomSheet> : null}
  </main>;
}
const root = createRoot(document.getElementById("component-gallery")!); root.render(new URLSearchParams(location.search).get("layout") === "bottom" ? <StandaloneBottomPattern /> : <Gallery />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
