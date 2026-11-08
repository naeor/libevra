// i18n-ignore-file 本机材质测量页面，不采集业务数据或上传报告。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { buildBenchPlan, newReport, runBenchmark, type BenchOptions, type BenchProgress, type BenchReport, VISUAL_VARIANTS, type VisualObservation } from "./benchmark.js";
import { GLASS_NAMES, PATTERN_NAMES } from "./OpticsDemo.js";
import { DEFAULT_MAGNIFICATION, DEFAULT_OPTICS, usesTexture, type GlassKind, type GlassShape, type BackgroundPattern } from "./optics-model.js";
import { createOpticalStage, type OpticalStage } from "./stage.js";
const MODE_NAMES={baseline:"普通基线",css:"CSS",magnify:"简单放大",webgl:"曲面折射（研究）"},MOTION_NAMES={static:"静止",glass:"镜片移动",background:"背景滚动"};
const VISUAL_NAMES={baseline:"普通基线",css:"CSS",webgl:"曲面折射（研究）","magnify-1.05":"简单放大 1.05×","magnify-1.10":"简单放大 1.10×","defaults-clear":"透明玻璃 · 默认","defaults-lens":"透镜玻璃 · 默认","defaults-frosted":"磨砂玻璃 · 默认"};
export function PerformanceLab({ active, onRunning }: { active: boolean; onRunning(running:boolean): void }): React.JSX.Element {
  const host=useRef<HTMLDivElement>(null),stage=useRef<OpticalStage|null>(null),abort=useRef<AbortController|null>(null),mounted=useRef(true);
  const downloads=useRef(new Map<string,ReturnType<typeof setTimeout>>());
  const [material,setMaterial]=useState<GlassKind>("clear"),[plan,setPlan]=useState<BenchOptions["plan"]>(()=>{const value=new URLSearchParams(location.search).get("plan");return value==="standard"||value==="quick"?value:"defaults"}),[seconds,setSeconds]=useState<10|15>(10),[reduced,setReduced]=useState(false),[allowReduced,setAllowReduced]=useState(false);
  const [pattern,setPattern]=useState<BackgroundPattern>("scene"),[shape,setShape]=useState<GlassShape>("round");
  const [running,setRunning]=useState(false),[progress,setProgress]=useState<BenchProgress|null>(null),[report,setReport]=useState<BenchReport|null>(null),[copyText,setCopyText]=useState("");
  const options:BenchOptions={plan,material,seconds,pattern,shape,allowMotion:!reduced||allowReduced},cases=buildBenchPlan(options),duration=Math.ceil(1.8+cases.length*(seconds+1));
  useLayoutEffect(()=>{
    if(!active||!host.current)return;const engine=createOpticalStage(host.current);stage.current=engine;
    return()=>{abort.current?.abort("离开性能实验，测试已停止。");engine.dispose();stage.current=null};
  },[active]);
  useEffect(()=>{
    mounted.current=true;
    const media=matchMedia("(prefers-reduced-motion: reduce)");const change=()=>{setReduced(media.matches);abort.current?.abort("系统动态效果偏好变化，请重新开始。")};setReduced(media.matches);media.addEventListener("change",change);
    const hidden=()=>{if(document.hidden)abort.current?.abort("Safari / 浏览器进入后台，本轮中断，后台间隔未计入有效结果。")};
    const pagehide=()=>abort.current?.abort("页面离开或锁屏，测试已中断。");document.addEventListener("visibilitychange",hidden);window.addEventListener("pagehide",pagehide);
    return()=>{mounted.current=false;abort.current?.abort("页面关闭，测试已停止。");media.removeEventListener("change",change);document.removeEventListener("visibilitychange",hidden);window.removeEventListener("pagehide",pagehide);for(const [url,timer] of downloads.current){clearTimeout(timer);URL.revokeObjectURL(url)}downloads.current.clear()};
  },[]);
  useEffect(()=>{onRunning(running);return()=>onRunning(false)},[running,onRunning]);
  const start=async()=>{
    if(!stage.current||running)return;const engine=stage.current,controller=new AbortController();abort.current=controller;setRunning(true);setCopyText("");setReport(null);
    // 先把测试区域摆稳，再校准；移动 Safari 工具栏造成的窗口变化不混入首组。
    host.current?.scrollIntoView({block:"center"});await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const visible=new IntersectionObserver(entries=>{if((entries[0]?.intersectionRatio??0)<.5)controller.abort("测试区域离开屏幕，本轮中断。")},{threshold:.5});if(host.current)visible.observe(host.current);
    const initial=newReport(options);setReport(initial);
    const result=await runBenchmark(engine,initial,controller.signal,state=>{if(mounted.current)setProgress(state)},value=>{if(mounted.current)setReport(value)});
    visible.disconnect();if(mounted.current){setReport(result);setRunning(false);setProgress(null)}abort.current=null;
  };
  const exportReport=()=>{
    if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=`libevra-material-${report.startedAt.replace(/[:.]/g,"-")}.json`;link.click();
    const timer=setTimeout(()=>{URL.revokeObjectURL(url);downloads.current.delete(url)},30000);downloads.current.set(url,timer);
  };
  const copyReport=async()=>{
    if(!report)return;const text=JSON.stringify(report,null,2);
    try{if(!navigator.clipboard?.writeText)throw new Error("clipboard");await navigator.clipboard.writeText(text);setCopyText("已复制报告。")}catch{setCopyText(text)}
  };
  return <section className="ol-performance" hidden={!active} data-running={running}>
    {!running?<><p className="ol-explanation">{plan==="defaults"?`已选默认短验收：透明 / 透镜 ${DEFAULT_MAGNIFICATION.clear.toFixed(2)}×、磨砂 ${DEFAULT_MAGNIFICATION.frosted.toFixed(2)}×，边缘 ${DEFAULT_OPTICS.strength*100}%，左上亮、右下暗。三组依次自动运行并结束；不运行曲面折射。`:"保留原比较矩阵：1 / 2 / 4 片、静止 / 移动 / 背景滚动。普通基线、CSS、两档清晰放大与曲面折射研究对照。此处研究数据不代表正式候选验收。"}</p>
      {plan!=="defaults"?<div className="ol-mode-switch ol-kind-switch" role="group" aria-label="测试玻璃种类">{(Object.keys(GLASS_NAMES) as GlassKind[]).map(value=><button type="button" key={value} aria-pressed={material===value} onClick={()=>setMaterial(value)}>{GLASS_NAMES[value]}</button>)}</div>:null}
      <div className="ol-bench-options"><label>测试范围<select className="rounded-field border border-line bg-surface text-section-title" aria-label="测试范围" value={plan} onChange={e=>setPlan(e.target.value as BenchOptions["plan"])}><option value="defaults">已选默认 · 3 组短验收</option><option value="standard">标准矩阵 · {reduced&&!allowReduced?18:54} 组</option><option value="quick">快速对照 · 5 组</option></select></label><label>每组记录<select className="rounded-field border border-line bg-surface text-section-title" aria-label="每组记录" value={seconds} onChange={e=>setSeconds(Number(e.target.value) as 10|15)}><option value={10}>10 秒</option><option value={15}>15 秒</option></select></label></div>
      <div className="ol-bench-options"><label>诊断背景<select className="rounded-field border border-line bg-surface text-section-title" aria-label="性能诊断背景" value={pattern} onChange={e=>setPattern(e.target.value as BackgroundPattern)}>{(Object.keys(PATTERN_NAMES) as BackgroundPattern[]).map(value=><option key={value} value={value}>{PATTERN_NAMES[value]}</option>)}</select></label><label>镜片轮廓<select className="rounded-field border border-line bg-surface text-section-title" aria-label="性能镜片轮廓" value={shape} onChange={e=>setShape(e.target.value as GlassShape)}><option value="round">圆片</option><option value="rect">圆角片</option></select></label></div>
      {reduced?<label className="ol-check"><input type="checkbox" checked={allowReduced} onChange={e=>setAllowReduced(e.target.checked)}/>系统已减少动态；本次允许移动测试（默认仅静态）</label>:null}
      <p className="ol-footnote">共 {cases.length} 组，约 {duration<60?`${duration} 秒`:`${Math.ceil(duration/60)} 分钟`}，每组另有 1 秒预热。测试固定单片尺寸与光学参数，具体值写入报告，不沿用手调预览。保持屏幕亮起、方向和缩放稳定；切到后台会中断。快速对照只测 1 个镜片，不替代完整矩阵。HTTP 局域网无法保证唤醒锁或自动复制。</p></>:null}
    <div className="ol-bench-toolbar"><button className="ol-play" type="button" data-benchmark-start disabled={running} onClick={()=>{void start()}}>开始自动测试</button><button className="ol-play" type="button" data-benchmark-stop disabled={!running} onClick={()=>abort.current?.abort("用户停止测试，已保留完成的组。")}>停止</button></div>
    <p className="ol-bench-progress" role="status">{running?progress?.test?`${progress.index+1}/${progress.total} · ${GLASS_NAMES[progress.test.material]} · ${MODE_NAMES[progress.test.mode]}${progress.test.mode==="magnify"?` ${progress.test.magnification?.toFixed(2)}×`:""} · ${progress.test.count} 片 · ${MOTION_NAMES[progress.test.motion]} · ${usesTexture(progress.test.mode)?(progress.test.quality==="half"?"降采样":"完整 DPR"):"原生分辨率"} · ${progress.phase==="warmup"?"预热":`${Math.min(progress.test.seconds,progress.elapsed/1000).toFixed(1)} 秒`}`:"正在校准空场帧节奏…":report?`${report.status==="complete"?"测试已结束":"测试已中断"} · ${report.rows.filter(row=>row.status==="complete").length} 组有效${report.reason?` · ${report.reason}`:""}`:"尚未在本设备开始测试"}</p>
    {active?<div ref={host} className="ol-optics-stage ol-bench-stage" role="img" aria-label="自动性能测试场景"/>:null}
    {report?<div className="ol-bench-results"><p className="ol-explanation">观察到的空场节奏：{report.observedRefreshMs?`${(1000/report.observedRefreshMs).toFixed(1)} Hz / ${report.observedRefreshMs.toFixed(2)} ms`:"校准中"}。这是浏览器回调节奏，不能当作 GPU 耗时或实际呈现帧数。</p>
      {!running?<fieldset className="ol-visual-review"><legend>视觉观察 · 手动填写</legend><p className="ol-footnote">没有观察的方案请保留“未评估”。高 FPS 不代表清晰，也不代表手机视觉验收通过。</p>{VISUAL_VARIANTS.filter(key=>key.startsWith("defaults-")===(report.options.plan==="defaults")).map(key=><label key={key}>{VISUAL_NAMES[key]}<select className="rounded-field border border-line bg-surface text-section-title" aria-label={`视觉观察 ${key}`} value={report.visualReview[key]??"unreviewed"} onChange={e=>{const value=e.target.value as VisualObservation;setReport(r=>r?{...r,visualReview:{...r.visualReview,[key]:value}}:r);setCopyText("")}}><option value="unreviewed">未评估</option><option value="clean">清晰，边缘自然</option><option value="ghosted">有多重影像</option><option value="seam">有明显内圈 / 接缝</option><option value="too-soft">过于模糊</option></select></label>)}<label>补充观察<textarea className="rounded-field border border-line bg-surface text-section-title" aria-label="补充视觉观察" value={report.visualNote} onChange={e=>{const value=e.target.value;setReport(r=>r?{...r,visualNote:value}:r);setCopyText("")}} placeholder="例如：完整 DPR 文字清晰，降采样偏软；只观察了圆片。" /></label></fieldset>:null}
      <div className="ol-bench-toolbar"><button type="button" className="ol-play" disabled={running} onClick={()=>{void copyReport()}}>复制报告</button><button type="button" className="ol-play" disabled={running} onClick={exportReport}>导出 JSON</button></div>
      {copyText==="已复制报告。"?<p role="status" className="ol-footnote">{copyText}</p>:copyText?<label className="ol-copy-fallback">浏览器未允许自动复制，可长按下方内容全选复制。<textarea aria-label="可复制的性能报告" readOnly value={copyText} onFocus={e=>e.target.select()}/></label>:null}
      <div className="ol-results-scroll" tabIndex={0} aria-label="测试结果，可横向滚动"><table><thead><tr><th>组合</th><th>FPS</th><th>均值 ms</th><th>P95 / P99 ms</th><th>卡顿 / &gt;50ms</th><th>状态</th></tr></thead><tbody>{report.rows.map(row=><tr key={row.test.id}><th>{MODE_NAMES[row.test.mode]} {row.test.mode==="magnify"?`${row.test.magnification?.toFixed(2)}×`:""} {usesTexture(row.test.mode)?(row.test.quality==="half"?"½":"1×"):""}<small>{GLASS_NAMES[row.test.material]} · {MOTION_NAMES[row.test.motion]} · {row.test.count} 片</small>{row.stage.renderer?<small>{row.stage.renderer.width} × {row.stage.renderer.height}</small>:null}</th><td>{row.metrics?.fps.toFixed(1)??"—"}</td><td>{row.metrics?.meanMs.toFixed(2)??"—"}</td><td>{row.metrics?`${row.metrics.p95Ms.toFixed(1)} / ${row.metrics.p99Ms.toFixed(1)}`:"—"}</td><td>{row.metrics?`${row.metrics.jank} / ${row.metrics.over50ms}`:"—"}</td><td>{row.status==="complete"?"有效":row.status==="unsupported"?"不支持":"中断"}{row.stage.contextLosses>0?` · 上下文丢失 ${row.stage.contextLosses}`:""}{row.stage.renderer?.capped?" · 已达像素上限":""}</td></tr>)}</tbody></table></div>
      <p className="ol-footnote">报告含原始帧间隔、P50 / P95 / P99、&gt;50ms 长帧、节奏遗漏估计、上下文异常和实际渲染尺寸。卡顿阈值 = max(50ms, 空场周期 × 2.5)。不支持 Long Task 的浏览器记为 null；不读取温度或功耗。完整 DPR 超过安全上限会明确标注，持续低性能会停止本次测试，不静默改画质。</p></div>:null}
  </section>;
}
