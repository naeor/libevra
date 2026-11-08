// i18n-ignore-file 独立本机材质测试的中文诊断与报告，不进入正式产品。
import { DEFAULT_MAGNIFICATION, DEFAULT_OPTICS, DEFAULT_STAGE, GEOMETRY, OPTICS_LAB_VERSION, usesTexture, type BackgroundPattern, type GlassKind, type GlassShape, type Magnification, type OpticalSettings, type RenderMode, type RenderQuality, type SceneMotion, type StageConfig } from "./optics-model.js";
import type { OpticalStage, StageSnapshot } from "./stage.js";
export interface BenchCase { id: string; mode: RenderMode; motion: SceneMotion; count: 1 | 2 | 4; quality: RenderQuality; material: GlassKind; seconds: number; magnification?: Magnification; pattern?: BackgroundPattern; shape?: GlassShape }
export interface BenchOptions { plan: "defaults" | "standard" | "quick"; material: GlassKind; seconds: 10 | 15; allowMotion: boolean; pattern?: BackgroundPattern; shape?: GlassShape }
export const VISUAL_VARIANTS = ["baseline", "css", "magnify-1.05", "magnify-1.10", "webgl", "defaults-clear", "defaults-lens", "defaults-frosted"] as const;
export type VisualObservation = "unreviewed" | "clean" | "ghosted" | "seam" | "too-soft";
export interface FrameMetrics { samples: number; elapsedMs: number; fps: number; meanMs: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number; over50ms: number; jank: number; jankThresholdMs: number; missedEstimate: number }
export interface BenchRow { test: BenchCase; status: "complete" | "invalid" | "unsupported"; reason: string; metrics: FrameMetrics | null; intervals: number[]; stage: StageSnapshot; longTasks: number | null; submitP95Ms: number; draws: number }
export interface BenchReport { schema: 2; version: string; startedAt: string; finishedAt: string; status: "running" | "complete" | "interrupted"; reason: string; options: BenchOptions; optics: OpticalSettings; geometry: typeof GEOMETRY; observedRefreshMs: number | null; calibrationIntervals: number[]; device: { userAgent: string; viewport: number[]; screen: number[]; dpr: number; reducedMotion: boolean; secureContext: boolean }; rows: BenchRow[]; visualReview: Partial<Record<typeof VISUAL_VARIANTS[number], VisualObservation>>; visualNote: string; note: string }
export function buildBenchPlan(options: BenchOptions): BenchCase[] {
  // 仅复用现有测量器做三组短验收，不把已搁置的曲面折射混入默认候选。
  if (options.plan === "defaults") return (["clear", "lens", "frosted"] as const).map(material => ({
    id: `defaults-${material}`, mode: "magnify", motion: options.allowMotion ? "glass" : "static", count: 1,
    quality: "full", material, seconds: options.seconds, magnification: DEFAULT_MAGNIFICATION[material],
    pattern: options.pattern ?? "scene", shape: options.shape ?? "round",
  }));
  const scenes: SceneMotion[] = options.allowMotion ? ["static", "glass", "background"] : ["static"];
  const cases: BenchCase[] = [];
  const counts: (1 | 2 | 4)[] = options.plan === "quick" ? [1] : [1, 2, 4];
  for (const count of counts) for (const motion of options.plan === "quick" ? [scenes.at(-1)!] : scenes) {
    // 同一场景交替比较实现，降低所有 WebGL 总在测试末尾的顺序偏差；降采样先于全分辨率。
    const variants: [RenderMode, RenderQuality, Magnification][] = [["baseline", "full", 1], ["css", "full", 1], ["magnify", "full", 1.05], ["magnify", "full", 1.1], ["webgl", "half", 1], ["webgl", "full", 1]];
    for (const [mode, quality, magnification] of options.plan === "quick" ? variants.slice(0, 5) : variants) cases.push({ id: `${motion}-${count}-${mode}-${quality}-${magnification}`, mode, motion, count, quality, magnification, pattern: options.pattern ?? "scene", shape: options.shape ?? "round", material: mode === "baseline" || mode === "magnify" ? "clear" : options.material, seconds: options.seconds });
  }
  return cases;
}
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0; const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))]!;
}
export function summarizeFrames(intervals: readonly number[], refreshMs: number): FrameMetrics | null {
  const values = intervals.filter(v => Number.isFinite(v) && v > 0); if (!values.length) return null;
  const elapsedMs = values.reduce((a,b) => a+b,0), threshold = Math.max(50, refreshMs * 2.5);
  return { samples: values.length, elapsedMs, fps: values.length * 1000 / elapsedMs, meanMs: elapsedMs / values.length,
    p50Ms: percentile(values,.5), p95Ms: percentile(values,.95), p99Ms: percentile(values,.99), maxMs: Math.max(...values),
    over50ms: values.filter(v=>v>50).length, jank: values.filter(v=>v>threshold).length, jankThresholdMs: threshold,
    missedEstimate: values.reduce((n,dt)=>n+Math.max(0, Math.round(dt / refreshMs)-1),0) };
}
export const caseConfig = (test: BenchCase): StageConfig => ({ mode: test.mode, material: test.material, quality: test.quality, count: test.count, shape: test.shape ?? "round", pattern: test.pattern ?? "scene", magnification: test.magnification ?? 1, compare: false, position: .5, fixedFootprint: true, optics: { ...DEFAULT_OPTICS } });
export function newReport(options: BenchOptions): BenchReport {
  return { schema: 2, version: OPTICS_LAB_VERSION, startedAt: new Date().toISOString(), finishedAt: "", status: "running", reason: "", options, optics: {...DEFAULT_OPTICS}, geometry: {...GEOMETRY}, visualReview: {}, visualNote: "",
    observedRefreshMs: null, calibrationIntervals: [], device: { userAgent: navigator.userAgent, viewport: [innerWidth,innerHeight], screen: [screen.width,screen.height], dpr: devicePixelRatio, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, secureContext: isSecureContext }, rows: [],
    note: "FPS 为 rAF 回调节奏，不是 GPU 时间或已呈现帧数；静止阶段材质不持续重绘。空场节奏可能受省电 / 浏览器限频影响。预热 1 秒，性能保护不会静默改画质。1/2/4 片共用单片尺寸和运动幅度；形状、背景与参数见 options / optics。defaults 只测三种玻璃的已选简化放大：清晰 / 透镜 1.05×，磨砂 1.03×；均为单位置取样。磨砂复用 GPU 高斯预滤波，CSS 对照为原生模糊，画质并非完全等同。预滤波在预热前完成，prefilterPasses 记录次数，不混入稳定运行帧率；静止 / 平移不重复预滤波。visualReview / visualNote 为用户手动观察，缺失或 unreviewed 表示未评估，绝非自动通过。曲面折射仅供研究，不属于产品候选。" };
}
export interface BenchProgress { index: number; total: number; phase: "calibration" | "warmup" | "measure"; elapsed: number; test: BenchCase | null }
/** 仅测量 rAF 节奏；不使用 gl.finish/readPixels，不把强制同步成本混进测试。 */
export async function runBenchmark(stage: OpticalStage, report: BenchReport, signal: AbortSignal, progress: (state: BenchProgress) => void, onRow: (report: BenchReport) => void): Promise<BenchReport> {
  const plan = buildBenchPlan(report.options); let current: BenchCase | null = null, intervals: number[] = [], submissions: number[] = [], startDraws = 0, longTasks: number | null = null;
  let observer: PerformanceObserver | null = null;
  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")) { longTasks = 0; observer = new PerformanceObserver(list => { longTasks! += list.getEntries().length; }); observer.observe({ type: "longtask" }); }
  const frameWindow = (duration: number, phase: BenchProgress["phase"], index: number, test: BenchCase | null) => new Promise<void>((resolve,reject) => {
    let frame = 0, first: number | null = null, last: number | null = null, lastNotice = -1000, settled = false;
    const initial = stage.snapshot(); const guard: number[] = [];
    const finish = (error?: Error) => { if(settled)return;settled=true;cancelAnimationFrame(frame);signal.removeEventListener("abort",abort);error ? reject(error) : resolve(); };
    const abort = () => finish(new Error(typeof signal.reason === "string" ? signal.reason : "测试已取消"));
    const tick = (now: number) => { try {
      if(settled)return;
      if (signal.aborted) { abort(); return; }
      if (document.hidden) { finish(new Error("页面进入后台，本次测试中断；后台间隔未计入有效结果。")); return; }
      const snapshot = stage.snapshot();
      if (Math.abs(snapshot.width-initial.width)>.5 || Math.abs(snapshot.height-initial.height)>.5 || snapshot.dpr !== initial.dpr || Math.abs(snapshot.viewportScale-initial.viewportScale)>.001) { finish(new Error("测试区域、像素比或缩放变化，请保持方向后重新开始。")); return; }
      if (test && usesTexture(test.mode) && snapshot.mode !== test.mode) { finish(new Error(snapshot.failure || "纹理绘制已降级，本组结果无效。")); return; }
      first ??= now; const elapsed = now-first;
      if (last !== null && phase !== "warmup") { const dt=now-last; intervals.push(dt); guard.push(dt); while(guard.length>120)guard.shift(); }
      last = now;
      if (test && test.motion !== "static") { const begin=performance.now(); stage.frame(test.motion,elapsed+(phase==="measure"?1000:0)); if(phase==="measure")submissions.push(performance.now()-begin); }
      if (phase === "measure" && elapsed>2500 && guard.length>12) { const recent=guard.slice(-Math.min(60,guard.length)); const mean=recent.reduce((a,b)=>a+b,0)/recent.length; if(mean>Math.max(100,(report.observedRefreshMs ?? 16.7)*4)) { finish(new Error("触发低性能保护：持续帧间隔过长；已停止并保留数据，可改用降采样快速对照。")); return; } }
      if (elapsed-lastNotice>=250) { progress({index,total:plan.length,phase,elapsed,test}); lastNotice=elapsed; }
      if(settled)return;if(elapsed>=duration)finish();else frame=requestAnimationFrame(tick);
      } catch(error) { finish(error instanceof Error ? error : new Error(String(error))); }
    };
    signal.addEventListener("abort",abort,{once:true}); if(signal.aborted)abort();else frame=requestAnimationFrame(tick);
  });
  const makeRow = (status: BenchRow["status"], reason: string): BenchRow => ({ test: current!, status, reason, metrics: summarizeFrames(intervals,report.observedRefreshMs ?? 16.7), intervals: [...intervals], stage: stage.snapshot(), longTasks, submitP95Ms: percentile(submissions,.95), draws: Math.max(0,(stage.snapshot().renderer?.draws ?? 0)-startDraws) });
  try {
    stage.configure(caseConfig({ id:"calibration", mode:"baseline",motion:"static",count:1,quality:"full",material:"clear",seconds:10 }));
    await frameWindow(1800,"calibration",0,null); report.calibrationIntervals=[...intervals]; report.observedRefreshMs=percentile(intervals,.5) || 16.7;
    for(let index=0;index<plan.length;index++) {
      current=plan[index]!; intervals=[];submissions=[];if(longTasks!==null)longTasks=0;
      stage.configure(caseConfig(current));stage.frame("static",0);
      if(usesTexture(current.mode)&&stage.snapshot().mode!==current.mode) { report.rows.push(makeRow("unsupported",stage.snapshot().failure));onRow({...report,rows:[...report.rows]});current=null;continue; }
      await frameWindow(1000,"warmup",index,current); intervals=[];submissions=[];if(longTasks!==null)longTasks=0;
      startDraws=stage.snapshot().renderer?.draws ?? 0;
      await frameWindow(current.seconds*1000,"measure",index,current);
      report.rows.push(makeRow("complete",""));onRow({...report,rows:[...report.rows]});current=null;
    }
    report.status="complete";
  } catch(error) { report.status="interrupted";report.reason=error instanceof Error ? error.message : String(error);if(current)report.rows.push(makeRow("invalid",report.reason)); }
  finally { observer?.disconnect();report.finishedAt=new Date().toISOString();stage.configure({...DEFAULT_STAGE,mode:"baseline",compare:false}); }
  return {...report,rows:[...report.rows]};
}
