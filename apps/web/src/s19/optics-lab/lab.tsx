// i18n-ignore-file 仅本机独立材质评审，不进入正式产品或正常生产构建。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { applyB2Glass, B2_GLASS_PRESETS, type B2GlassPreset } from "../b2Glass.js";
import { DEFAULT_OPTICS, DEFAULT_PORCELAIN_REFLECTION, OPTICS_LAB_VERSION } from "./optics-model.js";
import { OpticsDemo, OpticalRange } from "./OpticsDemo.js";
import { PerformanceLab } from "./PerformanceLab.js";
import "../../index.css";
import "../s19-lab-tokens.css";
import "../material-effects.css";
import "./lab.css";

const VIEWS = [
  { id: "porcelain", name: "瓷面反射", note: "同形状 · 不同反光" },
  { id: "glass", name: "B2 外观", note: "保留上一轮对照" },
  { id: "lens", name: "三种玻璃", note: "曲面 · 真实位移" },
  { id: "performance", name: "手机性能", note: "一次启动 · 自动汇总" },
] as const;
type View = typeof VIEWS[number]["id"];
const PRESETS = { clear: "清透", balanced: "均衡", soft: "柔和" } as const;
function MaterialSample({ candidate, porcelain }: { candidate: boolean; porcelain: boolean }): React.JSX.Element {
  const [pressed, setPressed] = useState(false);
  const finish = porcelain ? candidate ? "glazed" : "satin" : "auto";
  return <figure className="ol-sample" data-candidate={candidate}>
    <figcaption><b>{porcelain ? candidate ? "Glazed" : "Satin" : candidate ? "光学边缘候选" : "现有 B2"}</b><span>{porcelain ? candidate ? "釉瓷 · 集中镜面反射" : "磨砂瓷 · 宽而柔和" : candidate ? "CSS 光学边界" : "原操作玻璃"}</span></figcaption>
    <div className="ol-scene"><div className="ol-scene-pattern" aria-hidden="true"><span>09 / HOME</span><i /><em /></div>
      <article className="ol-surface lv-material-effects ol-card" data-material-finish={finish}><span className="lv-porcelain-window" aria-hidden="true"/><div className="ol-content"><p className="ol-card-kicker">本月生活</p><p className="ol-amount">¥ 1,280</p><div className="ol-rule" /><p className="ol-card-detail">让日常，轻一点。</p><div className="ol-chart" aria-hidden="true"><i /><i /><i /><i /><i /></div></div></article>
      <div className="ol-action-row"><button type="button" className="ol-surface lv-material-effects ol-pill" data-material-finish={finish} aria-pressed={pressed} onClick={() => setPressed(!pressed)}><span className="lv-porcelain-window" aria-hidden="true"/><span className="ol-content">{pressed ? "已点按 ✓" : "查看明细"}</span></button><button type="button" aria-label="体验圆形按钮" className="ol-surface lv-material-effects ol-circle" data-material-finish={finish} onClick={() => setPressed(!pressed)}><span className="lv-porcelain-window" aria-hidden="true"/><span className="ol-content">＋</span></button></div>
    </div>
  </figure>;
}
function OpticsLab(): React.JSX.Element {
  const [view,setView]=useState<View>(()=>VIEWS.find(v=>v.id===new URLSearchParams(location.search).get("view"))?.id??"porcelain");
  const [edgeStrength,setEdgeStrength]=useState(DEFAULT_OPTICS.strength*100),[reflectionStrength,setReflectionStrength]=useState(DEFAULT_PORCELAIN_REFLECTION*100),[angle,setAngle]=useState(DEFAULT_OPTICS.angle),[preset,setPreset]=useState<B2GlassPreset>("balanced");
  const [lightMoving,setLightMoving]=useState(false),[reduced,setReduced]=useState(false),[benchmarkRunning,setBenchmarkRunning]=useState(false);
  const page=useRef<HTMLElement>(null),samples=useRef<HTMLDivElement>(null);
  const porcelain=view==="porcelain";
  const strength=porcelain?reflectionStrength:edgeStrength,setStrength=porcelain?setReflectionStrength:setEdgeStrength;
  useLayoutEffect(()=>{const root=document.documentElement;root.dataset.opticsLab="true";root.dataset.visualStyle=porcelain?"b1":"b2";applyB2Glass(root.style,B2_GLASS_PRESETS[preset],preset)},[porcelain,preset]);
  useEffect(()=>{
    const media=matchMedia("(prefers-reduced-motion: reduce)");const change=()=>{setReduced(media.matches);if(media.matches)setLightMoving(false)};change();media.addEventListener("change",change);
    const visibility=()=>{if(document.hidden)setLightMoving(false)};document.addEventListener("visibilitychange",visibility);
    return()=>{media.removeEventListener("change",change);document.removeEventListener("visibilitychange",visibility)};
  },[]);
  useEffect(()=>{
    const update=(degrees:number)=>{const radians=degrees*Math.PI/180;page.current?.style.setProperty("--ol-angle",degrees+"deg");page.current?.style.setProperty("--ol-light-x",(50+Math.cos(radians)*35)+"%");page.current?.style.setProperty("--ol-light-y",(40+Math.sin(radians)*30)+"%")};update(angle);
    if(!lightMoving||!porcelain||reduced)return;
    let frame=0;const start=performance.now();const tick=(now:number)=>{if(now-start>=8000){setLightMoving(false);return;}update(angle+(now-start)*.045);frame=requestAnimationFrame(tick)};frame=requestAnimationFrame(tick);
    const observer=new IntersectionObserver(entries=>{if(!entries[0]?.isIntersecting)setLightMoving(false)});if(samples.current)observer.observe(samples.current);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();update(angle)};
  },[angle,lightMoving,porcelain,reduced]);
  const labels=porcelain?{title:"同一片瓷，光怎样停留？",note:"两边都是完全不透明的瓷，共用底色、圆角、凸起边缘与基础阴影。磨砂反光宽而柔；釉面呈现集中亮斑，不透出后方图案。"}:view==="glass"?{title:"保留已经认可的光学边界。",note:"左右填充和模糊参数相同，原三档预设保持不变。本组继续保留 CSS 对照；背景真实形变请看「三种玻璃」。"}:view==="lens"?{title:"让背景，真正经过玻璃。",note:"使用已选定的三种玻璃默认值，优先比较简化放大。观察文字是否清晰、中央与边缘是否连续；曲面折射只留作研究。"}:{title:"在同一台手机上，比较真实代价。",note:"自动顺序测试，结果只留在本页，可复制或下载。不声称已替你完成 iPhone 真机测试。"};
  return <main ref={page} className="ol-page" data-view={view} data-benchmark-running={benchmarkRunning} style={{"--ol-strength":strength/100,"--ol-angle":angle+"deg"} as CSSProperties}>
    <header className="ol-heading"><p>Libevra · Material Lab <span>{OPTICS_LAB_VERSION}</span></p><h1>瓷与玻璃，光的实验。</h1><p>独立候选，不替换正式材质。参数只在本页生效。</p></header>
    <nav className="ol-tabs" aria-label="材质实验专题">{VIEWS.map(v=><button type="button" key={v.id} data-view-option={v.id} aria-pressed={view===v.id} onClick={()=>{setLightMoving(false);setView(v.id)}}><b>{v.name}</b><span>{v.note}</span></button>)}</nav>
    <section className="ol-intro"><h2>{labels.title}</h2><p>{labels.note}</p></section>
    {view==="glass"?<div className="ol-preset-row"><span>同一份 B2 预设</span><div className="ol-mode-switch" role="group" aria-label="B2 玻璃预设">{(Object.keys(PRESETS) as B2GlassPreset[]).map(key=><button type="button" key={key} data-preset={key} aria-pressed={preset===key} onClick={()=>setPreset(key)}>{PRESETS[key]}</button>)}</div></div>:null}
    {view==="porcelain"||view==="glass"?<div ref={samples} className="ol-samples"><MaterialSample key={view+"-base"} candidate={false} porcelain={porcelain}/><MaterialSample key={view+"-candidate"} candidate porcelain={porcelain}/></div>:null}
    {porcelain?<div className="ol-lens-actions"><button className="ol-play" type="button" data-light-play disabled={reduced} aria-pressed={lightMoving} onClick={()=>setLightMoving(!lightMoving)}>{lightMoving?"停止光源":"移动同一光源 · 8 秒"}</button><span className="ol-footnote">手动调方向也可比较</span></div>:null}
    {view==="lens"?<OpticsDemo strength={strength/100} angle={angle} onBenchmark={()=>setView("performance")}/>:null}
    <PerformanceLab active={view==="performance"} onRunning={setBenchmarkRunning}/>
    {view!=="performance"?<div className="ol-adjustments"><OpticalRange label={porcelain?"反射强度":"光学边缘强度"} value={strength} set={setStrength}/><OpticalRange label="光线方向" value={angle} max={360} set={setAngle} display={angle+"°"}/></div>:null}
    {view!=="performance"?<p className="ol-suggestion">{porcelain?"磨砂瓷适合安静的信息承载，釉瓷可先尝试少量强调卡片和按钮，两种继续保留。":view==="glass"?"上一轮高光与材质保留；真实折射另行实验，不覆盖正式 B2。":"本轮保留实验成果；手机验收通过后再安排集成，暂不继续扩展新材质。"}</p>:null}
    <details className="ol-research"><summary>光学模型、兼容性与测量边界</summary><div>
      <p><b>瓷面：</b>相同实体底座，用宽径向亮区近似漫散反射，用窄反光与虚拟面光源亮斑近似釉面反射。属于 CSS 外观模型，不是微表面光线追踪。</p>
      <p><b>玻璃方向：</b>距离场定义轮廓，平板倒角 / 凸面高度场的梯度给出法线。Shader 使用折射率和 Snell 公式进入玻璃，再从平背面出射，求射线与假定背景平面的交点。凸面是连续多项式曲面，不是简单加强边框，也没有采用偏振来模拟折射。<a href="https://pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission" target="_blank" rel="noreferrer">Snell 与 Fresnel 原理</a></p>
      <p><b>仍属近似：</b>两界面的法线 / 折射率参与实际计算，但背景深度、瓷与玻璃反光都是示意参数；Fresnel 使用 Schlick 近似，磨砂在自有纹理上做两遍 GPU 高斯预滤波，再单次查询，不再叠加稀疏的清晰副本。未模拟完整微表面分布、多次内部反射、色散或严格能量守恒。<a href="https://pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory" target="_blank" rel="noreferrer">表面粗糙度依据</a></p>
      <p><b>简单放大：</b>以镜片中心计算采样坐标，再用二阶连续函数向原背景过渡。中心与边缘共用一张纹理、一次查询，没有独立内圈遮罩；并非完整凸透镜模型。三种玻璃使用各自确认的默认倍率，边缘强度 {DEFAULT_OPTICS.strength*100}%、左上光照。瓷片反射 {DEFAULT_PORCELAIN_REFLECTION*100}%，底座完全不透明。真实曲面折射仅保留研究代码，不作为本轮产品候选。</p>
      <p><b>Safari：</b>不依赖 SVG 背景位移。WebGL 失效或丢失上下文时释放资源并退回普通玻璃；CSS 对照继续可用。镜片包围盒之外不执行折射 / 散射，静止不循环绘制，移动与测试均有结束条件。<a href="https://bugs.webkit.org/show_bug.cgi?id=245510" target="_blank" rel="noreferrer">WebKit 限制</a></p>
      <p><b>性能：</b>rAF 统计的是回调间隔，不能保证等于已显示帧数，尤其 GPU 排队时。空场节奏也可能受省电与浏览器限频影响；报告不推断 GPU 功耗或温度。正式结论要在同一 iPhone、相同设置下比较；后台 / 视口变化会中止。<a href="https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame" target="_blank" rel="noreferrer">测量能力边界</a></p>
    </div></details>
    <footer className="ol-footer">本机样例 · 不读取账本数据 · 不保存正式外观偏好 · 报告不上传</footer>
  </main>;
}
const root=createRoot(document.getElementById("optics-lab")!);root.render(<OpticsLab/>);
if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());
