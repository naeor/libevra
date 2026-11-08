import { describe, expect, it } from "vitest";
import { DEFAULT_MAGNIFICATION, DEFAULT_OPTICS, DEFAULT_PORCELAIN_REFLECTION, DEFAULT_STAGE, glassLayout, magnifiedOffset, refractedOffset, renderSize, roundedDistance, type GlassGeometry } from "./optics-model.js";
import { gaussianPairs } from "./scatter-texture.js";
import { buildBenchPlan, caseConfig, summarizeFrames } from "./benchmark.js";
const circle: GlassGeometry={x:0,y:0,halfWidth:80,halfHeight:80,radius:80,reference:false,panel:0};
describe("受控曲面光学的不变量",()=>{
  it("折射率相同或强度为零时不产生位移",()=>{
    for(const kind of ["clear","frosted","lens"] as const)for(const x of [0,20,60,75]){
      expect(refractedOffset(x,3,circle,kind,{...DEFAULT_OPTICS,ior:1})).toEqual([0,0]);
      expect(refractedOffset(x,3,circle,kind,{...DEFAULT_OPTICS,strength:0})).toEqual([0,0]);
    }
  });
  it("透明平板中心不变，倒角确实偏折，磨砂与透明共用折射场",()=>{
    expect(refractedOffset(20,0,circle,"clear",DEFAULT_OPTICS)).toEqual([0,0]);
    expect(refractedOffset(68,0,circle,"clear",DEFAULT_OPTICS)[0]).toBeLessThan(-.5);
    expect(refractedOffset(75,0,circle,"frosted",DEFAULT_OPTICS)).toEqual(refractedOffset(75,0,circle,"clear",DEFAULT_OPTICS));
  });
  it("凸面中心附近产生放大且保持径向对称",()=>{
    const positive=refractedOffset(20,0,circle,"lens",DEFAULT_OPTICS),negative=refractedOffset(-20,0,circle,"lens",DEFAULT_OPTICS),vertical=refractedOffset(0,20,circle,"lens",DEFAULT_OPTICS);
    expect(positive[0]).toBeLessThan(-.5);expect(positive[0]).toBeGreaterThan(-20);expect(positive[0]).toBeCloseTo(-negative[0],8);expect(vertical[1]).toBeCloseTo(positive[0],8);
    expect(refractedOffset(0,0,circle,"lens",DEFAULT_OPTICS)).toEqual([0,0]);
  });
  it("趋近边界时连续归零，玻璃外不采样位移",()=>{
    for(const kind of ["clear","lens"] as const){expect(Math.abs(refractedOffset(79.999,0,circle,kind,DEFAULT_OPTICS)[0])).toBeLessThan(.2);expect(refractedOffset(81,0,circle,kind,DEFAULT_OPTICS)).toEqual([0,0])}
  });
  it("预览参数范围内，圆片与圆角片不发生局部映射回折",()=>{
    // 旧版倒角在默认强度下 Jacobian 已为负：同一线条会映射到多个位置。
    const shapes:GlassGeometry[]=[circle,{...circle,halfWidth:60,halfHeight:40,radius:24},{...circle,halfWidth:40,halfHeight:40,radius:40}];
    for(const g of shapes)for(const kind of ["clear","frosted","lens"] as const)for(const strength of [.35,1]){
      const sample=(x:number,y:number)=>{const d=refractedOffset(x,y,g,kind,{...DEFAULT_OPTICS,ior:1.8,curvature:1,strength});return [x+d[0],y+d[1]]};
      for(let x=-g.halfWidth+1;x<g.halfWidth;x+=2)for(let y=-g.halfHeight+1;y<g.halfHeight;y+=2){
        if(roundedDistance(x,y,g.halfWidth,g.halfHeight,g.radius)>-.1)continue;
        const e=.02,x1=sample(x+e,y),x0=sample(x-e,y),y1=sample(x,y+e),y0=sample(x,y-e);
        const xx=(x1[0]!-x0[0]!)/(2*e),xy=(y1[0]!-y0[0]!)/(2*e),yx=(x1[1]!-x0[1]!)/(2*e),yy=(y1[1]!-y0[1]!)/(2*e);
        expect(xx*yy-xy*yx,`${kind}/${strength}/${x}/${y}`).toBeGreaterThan(.01);
      }
    }
  });
  it("简单放大固定镜片中心，并在轮廓上无缝回到原背景",()=>{
    for(const g of [circle,{...circle,halfWidth:90,halfHeight:54,radius:24}])for(const zoom of [1,1.03,1.05,1.1] as const){
      const offset=magnifiedOffset(10,0,g,zoom);expect(10+offset[0]).toBeCloseTo(10/zoom,8);
      expect(magnifiedOffset(0,0,g,zoom).map(Math.abs)).toEqual([0,0]);
      expect(Math.abs(magnifiedOffset(g.halfWidth-.001,0,g,zoom)[0])).toBeLessThan(1e-8);
      // 中央恒定倍率与过渡区的交界处也要平滑，不能只验证最外侧轮廓。
      const join=g.halfWidth-Math.min(g.halfWidth,g.halfHeight)*.45,sample=(x:number)=>x+magnifiedOffset(x,0,g,zoom)[0];
      const leftSlope=(sample(join)-sample(join-.01))/.01,rightSlope=(sample(join+.01)-sample(join))/.01;
      expect(leftSlope).toBeCloseTo(1/zoom,5);expect(rightSlope).toBeCloseTo(leftSlope,5);
      let previous=-Infinity;for(let x=-g.halfWidth-1;x<=g.halfWidth+1;x+=.1){const mapped=x+magnifiedOffset(x,0,g,zoom)[0];expect(mapped).toBeGreaterThan(previous);previous=mapped}
    }
  });
  it("磨砂核归一且稠密单峰，不把一条线变成分开的三条",()=>{
    for(const sigma of [.2,2,6.5,12]){const taps=gaussianPairs(sigma),weights=new Float64Array(33);weights[0]=taps[1]!;
      for(let i=1;i<17;i++){const offset=taps[i*2]!,weight=taps[i*2+1]!,left=Math.floor(offset),fraction=offset-left;weights[left]!+=weight*(1-fraction);if(left<32)weights[left+1]!+=weight*fraction}
      expect(weights[0]!+2*weights.slice(1).reduce((a,b)=>a+b,0)).toBeCloseTo(1,6);
      for(let i=1;i<33;i++)expect(weights[i]!).toBeLessThanOrEqual(weights[i-1]!+1e-7);
    }
  });
  it("运动中的四镜片保持各自区域，避免重叠复合假设",()=>{
    for(const time of [0,1000,4000,8000])for(const shape of ["round","rect"] as const){const items=glassLayout(320,280,{...DEFAULT_STAGE,compare:false,count:4,shape},"glass",time);expect(items).toHaveLength(4);for(const item of items){expect(item.x-item.halfWidth).toBeGreaterThanOrEqual(0);expect(item.x+item.halfWidth).toBeLessThanOrEqual(320);expect(item.y-item.halfHeight).toBeGreaterThanOrEqual(0);expect(item.y+item.halfHeight).toBeLessThanOrEqual(280)}}
  });
  it("完整分辨率与降采样有可解释的像素量，并保护极端 DPR",()=>{
    const full=renderSize(360,280,3,"full"),half=renderSize(360,280,3,"half");expect(full.capped).toBe(false);expect(full.pixels/half.pixels).toBe(4);
    const limited=renderSize(1280,900,4,"full");expect(limited.capped).toBe(true);expect(limited.pixels).toBeLessThanOrEqual(2_000_000);
  });
});
describe("性能矩阵与统计口径",()=>{
  it("短验收使用与预览同源的已选默认，不混入曲面折射",()=>{
    for(const allowMotion of [false,true]){
      const cases=buildBenchPlan({plan:"defaults",material:"clear",seconds:10,allowMotion,shape:"rect",pattern:"text"});
      expect(cases.map(item=>[item.material,item.magnification])).toEqual([["clear",1.05],["lens",1.05],["frosted",1.03]]);
      expect(cases.every(item=>item.mode==="magnify"&&item.motion===(allowMotion?"glass":"static")&&item.quality==="full")).toBe(true);
      for(const item of cases){const config=caseConfig(item);expect(config.magnification).toBe(DEFAULT_MAGNIFICATION[item.material]);expect(config.optics.strength).toBe(.45);expect(config.optics.angle).toBe(225);expect(config.pattern).toBe("text");expect(config.shape).toBe("rect")}
    }
    expect(DEFAULT_PORCELAIN_REFLECTION).toBe(.6);
  });
  it("1/2/4 片测试保持单片面积相同，避免数量与缩放混杂",()=>{
    const sizes=([1,2,4] as const).map(count=>glassLayout(360,280,caseConfig({id:"size",count,mode:"webgl",quality:"full",material:"clear",motion:"static",seconds:10}),"static",0).map(item=>[item.halfWidth,item.halfHeight]));
    for(const group of sizes)for(const size of group)expect(size).toEqual(sizes[0]![0]);
  });
  it("完整覆盖三种场景、三个数量和六种绘制配置",()=>{
    const plan=buildBenchPlan({plan:"standard",material:"frosted",seconds:10,allowMotion:true});expect(plan).toHaveLength(54);expect(new Set(plan.map(x=>x.id)).size).toBe(54);
    for(const count of [1,2,4])for(const motion of ["static","glass","background"]){const group=plan.filter(x=>x.count===count&&x.motion===motion);expect(group.map(x=>[x.mode,x.quality])).toEqual([["baseline","full"],["css","full"],["magnify","full"],["magnify","full"],["webgl","half"],["webgl","full"]]);expect(group[0]?.material).toBe("clear");expect(group[2]?.material).toBe("clear");expect(group[2]?.magnification).toBe(1.05);expect(group[3]?.magnification).toBe(1.1);expect(group[4]?.material).toBe("frosted")}
  });
  it("减少动态时明确只运行静态，快速入口不冒充完整矩阵",()=>{
    const standard=buildBenchPlan({plan:"standard",material:"lens",seconds:10,allowMotion:false});expect(standard).toHaveLength(18);expect(standard.every(x=>x.motion==="static")).toBe(true);
    expect(buildBenchPlan({plan:"quick",material:"clear",seconds:10,allowMotion:true})).toHaveLength(5);
  });
  it("FPS 使用总时长，长帧不能通过平均瞬时 FPS 被掩盖",()=>{
    const values=[...Array<number>(99).fill(10),110],metrics=summarizeFrames(values,10)!;expect(metrics.fps).toBeCloseTo(100_000/1100);expect(metrics.meanMs).toBe(11);expect(metrics.p95Ms).toBe(10);expect(metrics.p99Ms).toBe(10);expect(metrics.maxMs).toBe(110);expect(metrics.jank).toBe(1);expect(metrics.missedEstimate).toBe(10);
  });
  it("基准按实测节奏计算，空样本没有伪造的零帧率",()=>{
    expect(summarizeFrames([],1000/60)).toBeNull();expect(summarizeFrames([NaN,-1,0],16)).toBeNull();const metrics=summarizeFrames(Array<number>(120).fill(1000/120),1000/120)!;expect(metrics.fps).toBeCloseTo(120);expect(metrics.jank).toBe(0);
  });
});
