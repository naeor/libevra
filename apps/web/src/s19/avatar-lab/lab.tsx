// i18n-ignore-file 独立开发实验的中文评审文案，不进入产品或正常生产构建；头像名称仍复用现有翻译。
import { SELECTABLE_AVATAR_IDS, type AvatarId } from "@libellum/shared";
import { useLayoutEffect, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { UserAvatar, avatarLabel } from "../../components/UserAvatar.js";
import { applyB2Glass, B2_GLASS_PRESETS, type B2GlassPreset } from "../b2Glass.js";
import "../../index.css";
import "../s19-lab-tokens.css";
import "./lab.css";

const STYLES = [
  { id: "a", name: "柔和薄片", description: "轻薄底座错开叠放，带一点柔和的空间深度。" },
  { id: "b1", name: "温润瓷片", description: "保留层叠，让瓷片的弧面、高光和边缘更温润。" },
  { id: "b2", name: "通透玻璃", description: "外围透色、亮边和轻高光，中央头像保持原来的清晰度。" },
  { id: "c", name: "经典原貌", description: "保留现有圆形头像与状态标记，不额外叠加底座。" },
] as const;
type LabStyle = typeof STYLES[number]["id"];
const STATES = [{ id: "normal", name: "普通" }, { id: "selected", name: "选中" }, { id: "locked", name: "锁定" }] as const;
type AvatarState = typeof STATES[number]["id"];
const SIZES = [{ value: 32, name: "账本成员" }, { value: 40, name: "成员列表" }, { value: 96, name: "我的 / 资料" }, { value: 112, name: "头像预览" }] as const;
const PRESET_NAMES = { clear: "清透", balanced: "均衡", soft: "柔和" } as const;

/** 复用现有图案组件；新层全部与 SVG 平级。状态只演示头像页已有的选中环 / 锁标。 */
function AvatarFrame({ avatarId, size, state = "normal", plain = false }: {
  readonly avatarId: AvatarId; readonly size: number; readonly state?: AvatarState; readonly plain?: boolean;
}): React.JSX.Element {
  return <span className="avlab-frame" data-state={state} data-plain={plain} style={{ "--av-size": `${size}px` } as CSSProperties}>
    <span className="avlab-plate avlab-plate-back" aria-hidden="true" />
    <span className="avlab-plate avlab-plate-middle" aria-hidden="true" />
    <span className="avlab-plate avlab-plate-front" aria-hidden="true" />
    <UserAvatar avatarId={avatarId} className="avlab-art" />
    {state === "locked" ? <span className="avlab-lock" aria-hidden="true">
      {/* AvatarPickerPage 的既有锁标；不提取或修改正式页面。 */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" /></svg>
    </span> : null}
  </span>;
}

function AvatarLab(): React.JSX.Element {
  const [style, setStyle] = useState<LabStyle>(() => STYLES.find(s => s.id === new URLSearchParams(location.search).get("style"))?.id ?? "a");
  const [avatarId, setAvatarId] = useState<AvatarId>("sprout");
  const [size, setSize] = useState<number>(112);
  const [state, setState] = useState<AvatarState>("normal");
  const [preset, setPreset] = useState<B2GlassPreset>("balanced");
  const selectedStyle = STYLES.find(s => s.id === style)!;
  useLayoutEffect(() => {
    // 只设置此实验文档。无外观控制器、认证、网络查询、存储写入或业务导航。
    const root = document.documentElement;
    root.dataset.avatarLab = "true";
    root.dataset.visualStyle = style;
    root.dataset.themeMode = "light";
    root.dataset.themePalette = "green";
    applyB2Glass(root.style, B2_GLASS_PRESETS[preset], preset);
  }, [style, preset]);

  return <main className="avlab-page">
    <header className="avlab-heading">
      <p className="avlab-eyebrow">Libevra · S19 · 材质实验</p>
      <h1>头像，轻轻多一层。</h1>
      <p>只比较外部材质，头像图案保持原样。此页不会保存头像或外观偏好。</p>
    </header>
    <div className="avlab-style-switch" role="group" aria-label="四种头像风格">
      {STYLES.map(s => <button type="button" key={s.id} data-style={s.id} aria-pressed={style === s.id} onClick={() => setStyle(s.id)}><b>{s.id.toUpperCase()}</b><span>{s.name}</span></button>)}
    </div>
    <section className="avlab-preview" aria-label="原图与材质对照">
      <div className="avlab-section-title"><h2>{style.toUpperCase()} · {selectedStyle.name}</h2><span>本机实验 · 01</span></div>
      <p className="avlab-description">{selectedStyle.description}</p>
      <div className="avlab-comparison">
        <figure><div className="avlab-display"><AvatarFrame avatarId={avatarId} size={size} state={state} plain /></div><figcaption>现有头像</figcaption></figure>
        <figure><div className="avlab-display"><AvatarFrame avatarId={avatarId} size={size} state={state} /></div><figcaption>{style === "c" ? "保持原貌" : "材质样例"}</figcaption></figure>
      </div>
      <div className="avlab-controls">
        <label htmlFor="avlab-art">头像图案<select id="avlab-art" className="rounded-field border border-line bg-surface" value={avatarId} onChange={event => setAvatarId(event.target.value as AvatarId)}>{SELECTABLE_AVATAR_IDS.map(id => <option key={id} value={id}>{avatarLabel(id)}</option>)}</select></label>
        <fieldset><legend>图案尺寸</legend><div className="avlab-options">{SIZES.map(s => <button type="button" key={s.value} data-size={s.value} aria-pressed={size === s.value} onClick={() => setSize(s.value)}>{s.value}</button>)}</div></fieldset>
        <fieldset><legend>已有状态</legend><div className="avlab-options">{STATES.map(s => <button type="button" key={s.id} data-state-option={s.id} aria-pressed={state === s.id} onClick={() => setState(s.id)}>{s.name}</button>)}</div></fieldset>
        {style === "b2" ? <fieldset><legend>B2 玻璃预设</legend><div className="avlab-options">{(Object.keys(PRESET_NAMES) as B2GlassPreset[]).map(key => <button type="button" key={key} data-preset={key} aria-pressed={preset === key} onClick={() => setPreset(key)}>{PRESET_NAMES[key]}</button>)}</div></fieldset> : null}
      </div>
    </section>
    <section className="avlab-samples" aria-labelledby="avlab-sizes">
      <div className="avlab-section-title"><h2 id="avlab-sizes">实际使用尺寸</h2><span>图案直径 / px</span></div>
      <div className="avlab-size-grid">{SIZES.map(s => <figure key={s.value}><div className="avlab-size-display"><AvatarFrame avatarId={avatarId} size={s.value} state={state} /></div><figcaption><b>{s.value}px</b><span>{s.name}</span></figcaption></figure>)}</div>
    </section>
    <section className="avlab-samples" aria-labelledby="avlab-states">
      <div className="avlab-section-title"><h2 id="avlab-states">状态对照</h2><span>相同图案 / 64px</span></div>
      <div className="avlab-state-grid">{STATES.map(s => <figure key={s.id}><div className="avlab-state-display"><AvatarFrame avatarId={avatarId} size={64} state={s.id} /></div><figcaption>{s.name}</figcaption></figure>)}</div>
      <p className="avlab-footnote">锁定只展示已有锁标；这里不模拟权限、解锁或保存操作。</p>
    </section>
    <footer className="avlab-footer">正式页面暂不接入 · 确认材质后再整合</footer>
  </main>;
}

const root = createRoot(document.getElementById("avatar-lab")!);
root.render(<AvatarLab />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
