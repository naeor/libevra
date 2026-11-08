import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OPTICS, GEOMETRY, usesTexture, type StageConfig } from "./optics-model.js";
import { runBenchmark, type BenchProgress, type BenchReport } from "./benchmark.js";
import type { OpticalStage } from "./stage.js";
let now=0,step=1000/60;
beforeEach(()=>{
  now=0;step=1000/60;vi.useFakeTimers();vi.stubGlobal("document",{hidden:false});vi.stubGlobal("PerformanceObserver",undefined);
  vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback)=>setTimeout(()=>{now+=step;callback(now)},1));vi.stubGlobal("cancelAnimationFrame",(id:number)=>clearTimeout(id));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()});
const initial=(motion=true):BenchReport=>({schema:2,version:"test",startedAt:"test",finishedAt:"",status:"running",reason:"",options:{plan:"quick",seconds:10,material:"clear",allowMotion:motion},optics:DEFAULT_OPTICS,geometry:GEOMETRY,observedRefreshMs:null,calibrationIntervals:[],device:{userAgent:"test",viewport:[360,800],screen:[360,800],dpr:3,reducedMotion:false,secureContext:true},rows:[],visualReview:{},visualNote:"",note:"test"});
function fakeStage(){let mode:StageConfig["mode"]="baseline",draws=0,losses=0;return { lose:()=>{mode="baseline";losses++}, stage:{configure(config){mode=config.mode;draws=0},frame(){draws++},snapshot:()=>({mode,width:360,height:280,dpr:3,viewportScale:1,contextLosses:losses,failure:losses?"上下文丢失":"",renderer:usesTexture(mode)?{draws,width:1080,height:840,requestedScale:3,actualScale:3,capped:false,pixels:907200,precision:"highp"}:null}),dispose(){}} satisfies OpticalStage};}
async function run(progress:(state:BenchProgress,abort:AbortController,lose:()=>void)=>void=()=>{},motion=true){const control=new AbortController(),engine=fakeStage();const pending=runBenchmark(engine.stage,initial(motion),control.signal,state=>progress(state,control,engine.lose),()=>{});await vi.runAllTimersAsync();return pending;}
describe("手机自动测试的终止与有效性",()=>{
  it("自动完成且静态组不连续重绘",async()=>{const report=await run(()=>{},false);expect(report.status).toBe("complete");expect(report.rows).toHaveLength(5);expect(report.rows.every(row=>row.status==="complete")).toBe(true);expect(report.rows[4]?.draws).toBe(0);expect(report.rows[4]?.metrics?.fps).toBeCloseTo(60);expect(vi.getTimerCount()).toBe(0)});
  it("中途停止保留无效当前组，取消所有下一帧",async()=>{const report=await run((state,control)=>{if(state.phase==="measure"&&state.elapsed>250)control.abort("用户停止")});expect(report.status).toBe("interrupted");expect(report.rows[0]?.status).toBe("invalid");expect(report.reason).toBe("用户停止");expect(vi.getTimerCount()).toBe(0)});
  it("后台间隔不伪装为有效性能",async()=>{const report=await run(state=>{if(state.phase==="measure"&&state.elapsed>250)vi.stubGlobal("document",{hidden:true})});expect(report.status).toBe("interrupted");expect(report.reason).toContain("后台");expect(report.rows[0]?.status).toBe("invalid")});
  it("持续低性能会停止，不静默降低本组画质",async()=>{const report=await run(state=>{if(state.phase==="measure"&&state.test?.mode==="webgl")step=200});expect(report.status).toBe("interrupted");expect(report.reason).toContain("低性能保护");expect(report.rows.slice(0,4).every(row=>row.status==="complete")).toBe(true);expect(report.rows[4]?.status).toBe("invalid")});
  it("WebGL 丢失上下文不能继续记为 WebGL 有效成绩",async()=>{const report=await run((state,_control,lose)=>{if(state.phase==="measure"&&state.test?.mode==="webgl")lose()});expect(report.status).toBe("interrupted");expect(report.rows[4]?.stage.contextLosses).toBe(1);expect(report.rows[4]?.status).toBe("invalid");expect(report.reason).toContain("上下文丢失")});
  it("简单放大也必须中止失效的纹理测试，不能误记为原生成功",async()=>{const report=await run((state,_control,lose)=>{if(state.phase==="measure"&&state.test?.mode==="magnify")lose()});expect(report.status).toBe("interrupted");expect(report.rows[2]?.stage.contextLosses).toBe(1);expect(report.rows[2]?.status).toBe("invalid");expect(report.visualReview).toEqual({});expect(report.visualNote).toBe("")});
});
