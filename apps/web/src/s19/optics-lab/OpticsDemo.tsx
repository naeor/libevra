// i18n-ignore-file 独立材质实验。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_MAGNIFICATION, DEFAULT_OPTICS, DEFAULT_STAGE, usesTexture, type BackgroundPattern, type GlassKind, type GlassShape, type Magnification, type RenderMode, type RenderQuality, type SceneMotion } from "./optics-model.js";
import { createOpticalStage, type OpticalStage } from "./stage.js";
export const GLASS_NAMES = { frosted: "磨砂玻璃", clear: "透明玻璃", lens: "凸透镜" } as const;
export const PATTERN_NAMES = { scene: "彩色场景", line: "单条细线", circle: "单个圆形", text: "清晰文字", grid: "规则网格" } as const;
export function OpticalRange({ label, value, min = 0, max = 100, step = 1, set, display }: { label: string; value: number; min?: number; max?: number; step?: number; set(value: number): void; display?: string }): React.JSX.Element {
  return <label className="ol-range"><span>{label}<output>{display ?? `${value}%`}</output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={event=>set(Number(event.target.value))} /></label>;
}
export function OpticsDemo({ strength, angle, onBenchmark }: { strength: number; angle: number; onBenchmark(): void }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null), stage = useRef<OpticalStage | null>(null);
  const [kind,setKind]=useState<GlassKind>("clear"),[mode,setMode]=useState<RenderMode>("magnify"),[shape,setShape]=useState<GlassShape>("round"),[quality,setQuality]=useState<RenderQuality>("full");
  const [zooms,setZooms]=useState({...DEFAULT_MAGNIFICATION}),[pattern,setPattern]=useState<BackgroundPattern>("scene");
  const zoom=zooms[kind],setZoom=(value:Magnification)=>setZooms(previous=>({...previous,[kind]:value}));
  const [ior,setIor]=useState(DEFAULT_OPTICS.ior),[roughness,setRoughness]=useState(Math.round(DEFAULT_OPTICS.roughness*100)),[curvature,setCurvature]=useState(Math.round(DEFAULT_OPTICS.curvature*100)),[position,setPosition]=useState(50);
  const [motion,setMotion]=useState<SceneMotion>("static"),[error,setError]=useState(""),[reduced,setReduced]=useState(false);
  useLayoutEffect(()=>{ if(!host.current)return; const engine=createOpticalStage(host.current,message=>{setError(message);setMode("baseline");setMotion("static")});stage.current=engine;return()=>{engine.dispose();stage.current=null}; },[]);
  useEffect(()=>{ stage.current?.configure({...DEFAULT_STAGE,mode,material:kind,shape,quality,magnification:zoom,pattern,position:position/100,optics:{ior,roughness:roughness/100,curvature:curvature/100,strength,angle}}); },[mode,kind,shape,quality,zoom,pattern,position,ior,roughness,curvature,strength,angle]);
  useEffect(()=>{
    const media=matchMedia("(prefers-reduced-motion: reduce)");const changed=()=>{setReduced(media.matches);if(media.matches)setMotion("static")};changed();media.addEventListener("change",changed);
    const visibility=()=>{if(document.hidden)setMotion("static")};document.addEventListener("visibilitychange",visibility);
    const observer=new IntersectionObserver(entries=>{if(!entries[0]?.isIntersecting)setMotion("static")});if(host.current)observer.observe(host.current);
    return()=>{media.removeEventListener("change",changed);document.removeEventListener("visibilitychange",visibility);observer.disconnect()};
  },[]);
  useEffect(()=>{
    if(motion==="static"||reduced){stage.current?.frame("static",0);return;}
    const start=performance.now();let frame=0;
    const tick=(now:number)=>{if(now-start>=8000){setMotion("static");return;}stage.current?.frame(motion,now-start);frame=requestAnimationFrame(tick)};frame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame);stage.current?.frame("static",0)};
  },[motion,reduced]);
  return <section className="ol-optics-demo">
    <div className="ol-mode-switch ol-render-switch" role="group" aria-label="光学实现">{([['baseline','普通基线'],['css','CSS 近似'],['magnify','简单放大'],['webgl','曲面折射 · 研究']] as const).map(([value,name])=><button type="button" key={value} data-mode={value} aria-pressed={mode===value} onClick={()=>{setError("");setMode(value)}}>{name}</button>)}</div>
    <div className="ol-mode-switch ol-kind-switch" role="group" aria-label="玻璃种类">{(Object.keys(GLASS_NAMES) as GlassKind[]).map(value=><button type="button" data-kind={value} key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{GLASS_NAMES[value]}</button>)}</div>
    {mode==="magnify"?<><div className="ol-mode-switch ol-kind-switch" role="group" aria-label="背景放大倍数">{([1,1.03,1.05,1.1] as const).map(value=><button type="button" data-zoom={value} key={value} aria-pressed={zoom===value} onClick={()=>setZoom(value)}>{value.toFixed(2)}×</button>)}</div><p className="ol-footnote">{GLASS_NAMES[kind]}默认 {DEFAULT_MAGNIFICATION[kind].toFixed(2)}×，各材质的临时调节独立保留。</p></>:null}
    <p className="ol-explanation">{mode==="magnify"?`优先比较的简化方案：单次查询自有背景纹理，中央放大并连续过渡到轮廓上的 1.00×。${kind==="frosted"?"磨砂沿用已有 GPU 预滤波，移动时不重复模糊。":"背景保持清晰。"}不缩放控件或高光，不运行曲面折射，不抓取或复制网页背景。`:mode==="webgl"?"仅保留研究对照，暂不作为正式产品候选。沿用 Snell 两界面和连续曲面场；磨砂使用原有预滤波。":"原外观对照，不改变背景图像的几何位置。"}</p>
    <label className="ol-pattern-select">诊断背景<select className="rounded-field border border-line bg-surface text-section-title" aria-label="诊断背景" value={pattern} onChange={e=>setPattern(e.target.value as BackgroundPattern)}>{(Object.keys(PATTERN_NAMES) as BackgroundPattern[]).map(value=><option key={value} value={value}>{PATTERN_NAMES[value]}</option>)}</select></label>
    <div className="ol-lens-labels"><b>1.00× · 无位移参照</b><b>{mode==="magnify"?`${zoom.toFixed(2)}× · 单次采样`:mode==="webgl"?`${GLASS_NAMES[kind]} · 真位移`:mode==="css"?"光学外观 · 无位移":"普通玻璃 · 回退"}</b></div>
    <div ref={host} className="ol-optics-stage" role="img" aria-label="相同背景与几何，左侧不折射，右侧为所选材质" />
    <div className="ol-lens-actions"><div className="ol-mode-switch" role="group" aria-label="玻璃轮廓">{([['round','圆片'],['rect','圆角片']] as const).map(([value,name])=><button type="button" data-shape-option={value} key={value} aria-pressed={shape===value} onClick={()=>setShape(value)}>{name}</button>)}</div><div className="ol-mode-switch" role="group" aria-label="渲染分辨率">{([['half','降采样'],['full','完整 DPR']] as const).map(([value,name])=><button type="button" data-quality={value} key={value} aria-pressed={quality===value} disabled={!usesTexture(mode)} onClick={()=>setQuality(value)}>{name}</button>)}</div></div>
    <div className="ol-lens-actions"><button type="button" className="ol-play" data-move="glass" disabled={reduced} aria-pressed={motion==="glass"} onClick={()=>setMotion(motion==="glass"?"static":"glass")}>{motion==="glass"?"停止镜片":"移动镜片 · 8 秒"}</button><button type="button" className="ol-play" data-move="background" disabled={reduced} aria-pressed={motion==="background"} onClick={()=>setMotion(motion==="background"?"static":"background")}>{motion==="background"?"停止背景":"滚动背景 · 8 秒"}</button></div>
    {error?<p className="ol-explanation" role="alert">{error}</p>:null}
    <div className="ol-adjustments"><OpticalRange label="镜片位置" value={position} set={setPosition}/>{mode==="webgl"?<><OpticalRange label="折射率 · WebGL" value={ior} min={1} max={1.8} step={.01} set={setIor} display={ior.toFixed(2)}/><OpticalRange label="凸面曲率 · WebGL" value={curvature} set={setCurvature}/></>:null}{kind==="frosted"&&mode!=="baseline"?<OpticalRange label="磨砂散射" value={roughness} set={setRoughness}/>:null}</div>
    <p className="ol-footnote">请观察：细线是否只有一条连续轨迹、文字是否出现多份、圆片与圆角片有无内圈接缝。测试图中的文字属于背景，会随采样改变；页面按钮与文字不会放大。帧率不能替代这些视觉判断。</p>
    <p className="ol-footnote">相同自绘纹理，玻璃外保持原图；未采样网页 DOM。静止不循环绘制。{reduced?"系统减少动态效果已开启，可手动移动。":"动画离屏或进入后台即停。"}完整 DPR 仍有 200 万像素安全上限，实际尺寸会写入性能报告。</p>
    <button type="button" className="ol-text-link" onClick={onBenchmark}>进入手机性能对照 →</button>
  </section>;
}
