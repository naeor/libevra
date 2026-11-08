import { clamp01 } from "../lib/transitionPhysics.js";
import { facing, fromLeft, type EdgeSamples } from "./oceanLayers.js";

/**
 * S19 四层海浪的 Canvas 绘制（A / B1 / B2 / C）。
 *
 * 为什么是 Canvas 而不是 SVG：
 * - 每帧要画四层 + 每层的阴影 / 厚度 / 反光。SVG 要么用 filter（iOS 上逐帧 CPU 模糊，A/B1 卡顿的来源），
 *   要么堆很多描边（出现明显的色阶），而 `<use>` 引用的路径每帧变化会让 WebKit 重建所有实例。
 * - Canvas 里每帧只有几十次绘制调用，没有 DOM / 样式重算；柔和的阴影与光带用"沿浪沿剪切的渐变条"画出：
 *   一条预先渲染好的竖向渐变，按浪沿逐段（设备像素对齐）剪切贴上去，所以渐变始终垂直于浪沿、完全平滑，
 *   且只覆盖浪沿附近的像素。
 * - 不使用 ctx.filter / shadowBlur / 任何模糊。
 *
 * 坐标：CSS 像素，y 向下；画布与 `.ledger-space` 同宽、同高（100 lv-vh），不随进度改尺寸。
 */

export type PainterLook = "a" | "b1" | "b2" | "c";

/** 由 CSS 解析好的颜色（rgb/oklab 字符串，Canvas 可直接使用）。 */
export interface PainterColors {
  readonly fill: readonly string[];
  readonly deep: readonly string[];
  readonly shadow: string;
  readonly light: string;
  readonly caustic: string;
  readonly refract: readonly string[];
  /** 海浪下面的页面底色（B2 预合成用）。 */
  readonly base: string;
}

/** 竖向轮廓：相对浪沿的距离 d（px，负 = 浪沿上方 / 本层，正 = 下方 / 下一层）→ RGBA。 */
type Profile = (d: number) => readonly [rgb: string, alpha: number] | null;

interface Strip { readonly canvas: HTMLCanvasElement | OffscreenCanvas; readonly top: number; readonly height: number }

const COLUMN = 16; // CSS px，剪切条每段宽度（≈ 一个 Hermite 段）；段内按直线贴合，误差 < 0.1px
/** 画布密度上限：海浪是柔和的大面积图形，2 倍已看不出差别，像素量只有 3 倍的 44%。 */
const MAX_DENSITY = 2;
/** 相邻两带的重叠（px），避免抗锯齿接缝；被上一层盖住，看不见。 */
const OVERLAP = 2;

function parseRgb(color: string): [number, number, number] {
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

/** 把一组轮廓叠成一张 1×N 的竖向渐变条（预乘后逐行 source-over 合成），每种外观每层只做一次。 */
function bakeStrip(profiles: readonly Profile[], top: number, bottom: number, dpr: number): Strip {
  const height = Math.max(1, Math.ceil((bottom - top) * dpr));
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(1, height);
  const cache = new Map<string, [number, number, number]>();
  for (let row = 0; row < height; row++) {
    const d = top + (row + 0.5) / dpr;
    let r = 0, g = 0, b = 0, a = 0;
    for (const profile of profiles) {
      const hit = profile(d);
      if (!hit || hit[1] <= 0) continue;
      let rgb = cache.get(hit[0]);
      if (!rgb) { rgb = parseRgb(hit[0]); cache.set(hit[0], rgb); }
      const sa = Math.min(1, hit[1]);
      r = rgb[0] * sa + r * (1 - sa); g = rgb[1] * sa + g * (1 - sa); b = rgb[2] * sa + b * (1 - sa);
      a = sa + a * (1 - sa);
    }
    const o = row * 4;
    image.data[o] = a > 0 ? Math.round(r / a) : 0;
    image.data[o + 1] = a > 0 ? Math.round(g / a) : 0;
    image.data[o + 2] = a > 0 ? Math.round(b / a) : 0;
    image.data[o + 3] = Math.round(a * 255);
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, top, height };
}

const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
/** 从 d = from 处的峰值平滑衰减到 d = to（任一方向）。 */
const falloff = (d: number, from: number, to: number, power = 2) => {
  const t = (d - from) / (to - from);
  return t < 0 || t > 1 ? 0 : Math.pow(1 - t, power);
};
const bump = (d: number, centre: number, sigma: number) => Math.exp(-((d - centre) ** 2) / (2 * sigma * sigma));

/* ------------------------------------------------------------------ 曲线 */

/** 与 edgeCurve 相同的三次 Hermite：samples 从右到左。 */
function traceEdge(ctx: CanvasPath, e: EdgeSamples, W: number, offset: (i: number) => number, move: boolean): void {
  const n = e.x.length;
  const off = (i: number) => offset(i);
  const dOff = (i: number) => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    return (off(b) - off(a)) / (e.x[b]! - e.x[a]!);
  };
  if (move) ctx.moveTo(e.x[0]! * W, e.y[0]! + off(0)); else ctx.lineTo(e.x[0]! * W, e.y[0]! + off(0));
  for (let i = 0; i < n - 1; i++) {
    const a = e.x[i]!, b = e.x[i + 1]!, h = (b - a) / 3;
    const ya = e.y[i]! + off(i), yb = e.y[i + 1]! + off(i + 1);
    ctx.bezierCurveTo((a + h) * W, ya + (e.slope[i]! + dOff(i)) * h, (b - h) * W, yb - (e.slope[i + 1]! + dOff(i + 1)) * h, b * W, yb);
  }
}

function traceReverse(ctx: CanvasPath, e: EdgeSamples, W: number, offset: (i: number) => number): void {
  const n = e.x.length;
  const dOff = (i: number) => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    return (offset(b) - offset(a)) / (e.x[b]! - e.x[a]!);
  };
  ctx.lineTo(e.x[n - 1]! * W, e.y[n - 1]! + offset(n - 1));
  for (let i = n - 1; i > 0; i--) {
    const a = e.x[i]!, b = e.x[i - 1]!, h = (b - a) / 3;
    const ya = e.y[i]! + offset(i), yb = e.y[i - 1]! + offset(i - 1);
    ctx.bezierCurveTo((a + h) * W, ya + (e.slope[i]! + dOff(i)) * h, (b - h) * W, yb - (e.slope[i - 1]! + dOff(i - 1)) * h, b * W, yb);
  }
}

/** 浪沿在任意 x（CSS px）处的 y：与绘制用的 Hermite 一致。 */
function edgeAt(e: EdgeSamples, W: number, px: number): number {
  const x = px / W;
  const n = e.x.length;
  let i = Math.floor((1.01 - x) / (1.02 / (n - 1)));
  i = Math.max(0, Math.min(n - 2, i));
  const a = e.x[i]!, b = e.x[i + 1]!;
  const t = (x - a) / (b - a), dx = b - a;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * e.y[i]! + (t3 - 2 * t2 + t) * dx * e.slope[i]! + (-2 * t3 + 3 * t2) * e.y[i + 1]! + (t3 - t2) * dx * e.slope[i + 1]!;
}

/**
 * B2：浪沿局部弯曲对透过玻璃斜面的光的汇聚程度。浪沿向上拱起（屏幕坐标 y'' > 0）的地方，玻璃边缘内凹，
 * 光向下汇聚，内部导光与下方亮线略强；向下鼓出的地方光发散、略弱。范围 0.75–1.25，平均值不变。
 */
function focus(e: EdgeSamples, i: number, W: number): number {
  const n = e.x.length;
  const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
  const bend = (e.slope[b]! - e.slope[a]!) / ((e.x[b]! - e.x[a]!) * W * W);
  return 1 + 0.25 * Math.tanh(bend / 0.002);
}

/* ------------------------------------------------------------------ 依附在材质上的反射：缓慢左右移动的光照窗口 */

/**
 * B1 / B2 的浪沿反射（B1 肩部反光，B2 斜面导光、汇聚亮线、晶亮线）亮度沿 x 由一个很宽的"光照窗口"调制。
 * 窗口中心像海浪一样缓慢左右往返：一次往返 LIGHT_PERIOD 秒，中心在页宽 0.5 ± LIGHT_SWING 之间（总行程 40% 页宽），
 * 正弦运动，两端自然减速、没有折返的顿挫；纵向不动。移动的只是浪沿上已有反射的明暗分布，
 * 没有任何独立漂浮的光斑；浪沿在静止时都在 Logo 下方，所以没有强高光扫过 Logo。
 */
export const LIGHT_PERIOD = 18;
export const LIGHT_SWING = 0.2;
const LIGHT_WIDTH = 0.3;
export function lightCentre(seconds: number): number {
  return 0.5 + LIGHT_SWING * Math.sin(seconds * Math.PI * 2 / LIGHT_PERIOD);
}
/** 停留增强：反射在移动 / 刚到达时为这个比例，静止约 1–1.5 秒后平滑升到 1（见 OceanMaterial 的 dwell）。 */
export const REST_BASE = 0.78;

/* ------------------------------------------------------------------ 绘制器 */

interface LookRecipe {
  /** 浪沿上下的柔和过渡（不随光照变化）：阴影、转折暗部。 */
  readonly shade: (k: number, c: PainterColors) => { profiles: Profile[]; top: number; bottom: number } | null;
  /** 受光部分（随左上光照与弧段朝向变化）。 */
  readonly light: (k: number, c: PainterColors) => { profiles: Profile[]; top: number; bottom: number } | null;
}

const RECIPES: Record<PainterLook, LookRecipe> = {
  c: { shade: () => null, light: () => null },
  /* A：浅、宽、柔的投影落在下一层；本层边缘只有很窄的受光与转折，像有一点厚度的软薄片。 */
  a: {
    shade: (_k, c) => ({
      top: -3, bottom: 36,
      profiles: [
        d => [c.shadow, 0.17 * falloff(d, 0.6, 36, 2.3)],
        d => [c.shadow, d < 0.6 ? 0.08 * smooth((d + 3) / 3.4) : 0],
      ],
    }),
    light: (_k, c) => ({
      top: -4, bottom: 0,
      profiles: [d => [c.light, 0.3 * bump(d, -1.5, 0.75)]],
    }),
  },
  /* B1：瓷体 + 透明釉层（clearcoat 的二维近似）。
     - 瓷体：主题色本色、完全不透明；近边缘曲面转开略暗，下一层上一道紧而淡的接触影（shade）。
     - 边缘高光（light）：釉面在掠射角反射率升高（Fresnel），圆润的边缘因此有一根 0.5–1.5px 的细亮边，负责轮廓与厚度。
     - 表面反射（glazeGlints）：圆润肩部只在"正好把左上方光源反射到眼睛"的弧段出现反光，是一段段随海浪滑动的
       局部高光，不是一条与浪沿平行的连续亮线；集中、边缘清楚、几乎没有拖尾。
       Glazed（1 号）粗糙度更低：更窄更亮；Satin（2–4 号）粗糙度略高：更宽更暗，总能量相近（能量守恒）。
       亮度另受缓慢左右移动的光照窗口调制（lightCentre），静止片刻后略微增强（REST_BASE → 1）。
     不使用大面积白色叠层、光晕或独立的柔光箱光斑：大面保持干净，反射只依附在浪沿肩部。 */
  b1: {
    shade: (_k, c) => ({
      top: -8, bottom: 16,
      profiles: [
        d => [c.shadow, 0.2 * falloff(d, 0.4, 16, 2.4)],
        d => [c.shadow, d < 0.4 ? 0.1 * Math.pow(smooth((d + 8) / 8.4), 1.6) : 0],
      ],
    }),
    light: (k, c) => ({
      top: -4, bottom: 0,
      profiles: [d => [c.light, (k === 0 ? 0.3 : 0.24) * bump(d, -1.05, 0.5)]],
    }),
  },
  /* B2：玻璃。上方：片内导光（越近下缘越亮）+ 一窄条被斜面折上来的浅色 + 稍深的一线吸收；
     下方：一道被斜面汇聚的亮线、一小片透射柔光和很淡的绿色投影。 */
  b2: {
    shade: (k, c) => ({
      top: -14, bottom: 22,
      profiles: [
        // 斜面内侧一线轻微的吸收（光在这里走过的玻璃最长），做宽做淡，与内部连续过渡。
        d => [c.deep[k]!, 0.075 * bump(d, -10.5, 2.6)],
        d => [c.deep[k]!, d > 4 ? 0.07 * falloff(d, 4, 22, 1.6) : 0],
      ],
    }),
    light: (k, c) => ({
      top: -60, bottom: 18,
      profiles: [
        // 玻璃内部：从左上方进入的光在片内传导，越靠近下缘越亮（玻璃边缘发光的那种"导光"），是带色的光，不是白雾。
        d => [c.refract[k]!, d <= 0 ? 0.15 * Math.pow(smooth((d + 58) / 56), 1.5) : 0],
        d => [c.refract[k]!, 0.2 * bump(d, -4.2, 2.0)],
        d => [c.caustic, 0.42 * bump(d, 2.8, 0.95)],
        // 透过斜面落到下一层上的一小片柔光。
        d => [c.caustic, 0.07 * bump(d, 8, 4.5)],
      ],
    }),
  },
};

export class OceanPainter {
  private readonly ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private colors: PainterColors | null = null;
  private strips: { shade: (Strip | null)[]; light: (Strip | null)[] } = { shade: [], light: [] };
  private dirtyBottom = 0;
  private glassBands: GlassBand[] | null = null;
  /** 当前帧的停留增强 0..1（paint 开头写入）。 */
  private dwell = 1;
  /**
   * B2：每一带的"玻璃外观"预渲染成一张静态图——左上径向透光 + 极低对比度的厚薄起伏（每带相位不同）。
   * 都固定在环境里，所以逐帧只需用这张图填本带：与一次渐变填充同样的开销，没有额外的裁切或叠层。
   */
  private glassFills: (CanvasPattern | null)[] = [];

  constructor(canvas: HTMLCanvasElement, private readonly look: PainterLook) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(width: number, height: number, dpr: number): void {
    const ratio = Math.min(Math.max(dpr, 1), MAX_DENSITY);
    const changedRatio = ratio !== this.dpr;
    this.W = width; this.H = height; this.dpr = ratio;
    const w = Math.round(width * ratio), h = Math.round(height * ratio);
    if (this.ctx.canvas.width !== w) this.ctx.canvas.width = w;
    if (this.ctx.canvas.height !== h) this.ctx.canvas.height = h;
    this.dirtyBottom = height;
    if (changedRatio && this.colors) this.setColors(this.colors);
    else this.bakeFills();
  }

  setColors(colors: PainterColors): void {
    this.colors = colors;
    this.glassBands = this.look === "b2" ? glassBands(colors) : null;
    const recipe = RECIPES[this.look];
    const bake = (spec: ReturnType<LookRecipe["shade"]>) => spec ? bakeStrip(spec.profiles, spec.top, spec.bottom, this.dpr) : null;
    this.strips = {
      shade: [0, 1, 2, 3].map(k => bake(recipe.shade(k, colors))),
      light: [0, 1, 2, 3].map(k => bake(recipe.light(k, colors))),
    };
    this.bakeFills();
  }

  /** B2 每带的玻璃外观只与画面尺寸、颜色有关（固定在环境里），尺寸或主题变化时重画一次。 */
  private bakeFills(): void {
    const { W, H, glassBands: bands } = this;
    this.glassFills = [];
    if (this.look !== "b2" || !bands || !W || !H) return;
    // 透光很柔：每 CSS px 一个像素足够，按画布密度放大绘制。
    this.glassFills = bands.map((band, k) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(W); canvas.height = Math.ceil(H);
      const g2 = canvas.getContext("2d")!;
      const g = g2.createRadialGradient(W * 0.08, H * 0.04, 0, W * 0.08, H * 0.04, Math.hypot(W, H) * 0.9);
      g.addColorStop(0, band.lit);
      g.addColorStop(1, band.deep);
      g2.globalAlpha = band.alpha;
      g2.fillStyle = g;
      g2.fillRect(0, 0, W, H);
      if (GLASS_UNDULATION > 0) {
        // 极低对比度的厚薄起伏：沿略斜的方向，两个不成倍数的低频分量叠成不重复的缓慢起伏（不是条纹或焦散图案）；
        // 厚处略向本带背光色、薄处略向受光色偏，每带方向与相位不同，相邻两片玻璃因此各有各的明暗。
        g2.globalAlpha = 1;
        g2.globalCompositeOperation = "source-atop";
        const angle = UNDULATION_ANGLE[k]!, phase = UNDULATION_PHASE[k]!;
        const ux = Math.cos(angle) * W * 0.6, uy = Math.sin(angle) * W * 0.6;
        const wave = g2.createLinearGradient(W / 2 - ux, H / 2 - uy, W / 2 + ux, H / 2 + uy);
        const [thick, thin] = [parseRgb(band.deep), parseRgb(band.lit)];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const s = 0.7 * Math.sin(Math.PI * 2 * 0.9 * t + phase) + 0.3 * Math.sin(Math.PI * 2 * 1.9 * t + 1.7 * phase);
          // 偏向"薄 / 透"：变薄处的提亮比变厚处的压暗多一点，不出现暗条。
          const [rgb, weight] = s > 0 ? [thick, 0.6] : [thin, 1];
          wave.addColorStop(t, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(GLASS_UNDULATION * weight * Math.abs(s)).toFixed(4)})`);
        }
        g2.fillStyle = wave;
        g2.fillRect(0, 0, W, H);
      }
      return this.ctx.createPattern(canvas, "no-repeat");
    });
  }

  /** 沿浪沿贴一条渐变：逐段（设备像素对齐）竖向剪切，段内跟随浪沿斜率。 */
  private stripAlong(e: EdgeSamples, strip: Strip, alpha: (x: number, i: number) => number, scale = 1): void {
    const W = this.W;
    this.stripOn(this.ctx, px => edgeAt(e, W, px), strip, xm => alpha(xm, Math.round((1.01 - xm) / (1.02 / (e.x.length - 1)))), scale);
  }

  /** 同上，但沿任意曲线 yAt（CSS px → CSS px），可画在任一画布上。 */
  private stripOn(ctx: CanvasRenderingContext2D, yAt: (px: number) => number, strip: Strip, alpha: (x: number) => number, scale = 1): void {
    const { dpr, W } = this;
    const step = Math.max(1, Math.round(COLUMN * dpr));
    const total = Math.ceil(W * dpr);
    for (let x0 = 0; x0 < total; x0 += step) {
      const x1 = Math.min(total, x0 + step);
      const ya = yAt(x0 / dpr), yb = yAt(x1 / dpr);
      const xm = (x0 + x1) / 2 / dpr / W;
      const a = alpha(xm);
      if (a <= 0.003) continue;
      ctx.globalAlpha = Math.min(1, a);
      const slope = (yb - ya) / ((x1 - x0) / dpr);
      ctx.setTransform(1, slope, 0, scale, x0, (ya + strip.top * scale) * dpr);
      ctx.drawImage(strip.canvas, 0, 0, 1, strip.height, 0, 0, x1 - x0, strip.height);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * 画一帧。E 为四层浪沿（layer 0 = 1 号），progress 为四层各自的进度（顶栏态的效果收窄用），
   * dwell 为停留增强 0..1（B1 / B2：移动中与刚到达时为 0，完全展开并静止约 1–1.5 秒后平滑升到 1，见 OceanMaterial）。
   */
  paint(E: readonly EdgeSamples[], progress: readonly number[], seconds = 0, dwell = 1): void {
    const { ctx, W, H, dpr, colors } = this;
    if (!colors || !W || !H) return;
    // B2：斜面导光、汇聚亮线与绿色投影的明暗随光照窗口缓慢左右移动；整体强度在停留后从 REST_BASE 略升到 1。
    const centre = lightCentre(seconds);
    const near = (x: number) => Math.exp(-(((x - centre) / LIGHT_WIDTH) ** 2));
    const strength = REST_BASE + (1 - REST_BASE) * dwell;
    const lit = (x: number) => this.look === "b2" ? strength * (0.78 + 0.5 * near(x)) : 1;
    this.dwell = dwell;
    let bottom = 0, top = Infinity;
    for (const y of E[3]!.y) { bottom = Math.max(bottom, y); top = Math.min(top, y); }
    for (const e of E) for (const y of e.y) bottom = Math.max(bottom, y);
    bottom = Math.min(H, bottom + 40);
    const clearTo = Math.min(H, Math.max(bottom, this.dirtyBottom));
    // 不透明外观：浪沿以上每个像素都会被本帧的色带重新覆盖，只需清浪沿以下；玻璃是半透明的，要整块清。
    const clearFrom = this.look === "b2" ? 0 : Math.max(0, top - 4);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, clearFrom, W, clearTo - clearFrom + 1);
    this.dirtyBottom = bottom;

    for (const k of [3, 2, 1, 0]) {
      const e = E[k]!;
      // 只画本层露出来的那一带（上一层浪沿到本层浪沿），上缘多 OVERLAP 像素藏在上一层下面。
      const band = new Path2D();
      if (k === 0) { band.moveTo(1.01 * W, -40); band.lineTo(-0.01 * W, -40); }
      else traceEdge(band, E[k - 1]!, W, () => this.look === "b2" ? 0 : -OVERLAP, true);
      traceReverse(band, e, W, () => 0);
      band.closePath();
      // B2：预渲染的玻璃外观（左上透光 + 本带透射光斑）；其他外观：主题色实填。
      ctx.fillStyle = this.glassFills[k] ?? colors.fill[k]!;
      ctx.fill(band);

      // 顶栏里层间距只有约 10px：阴影与光带按本层进度收窄、减淡，不让顶栏变成一排白线或一团灰。
      const settled = smooth(progress[k] ?? 0);
      const reach = 1 - 0.58 * settled;
      const shade = this.strips.shade[k];
      if (shade) this.stripAlong(e, shade, x => (1 - 0.3 * settled) * (this.look === "b2" ? 0.85 + 0.3 * strength * near(x) : 1), reach);
      const light = this.strips.light[k];
      if (light) this.stripAlong(e, light, (x, i) => (1 - 0.4 * settled) * (this.look === "a"
        ? fromLeft(x, 0.4)
        : this.look === "b1"
          ? fromLeft(x, 0.35) * (0.6 + 0.4 * facing(e, i, W))
          : fromLeft(x, 0.3) * (0.55 + 0.45 * facing(e, i, W)) * (this.look === "b2" ? focus(e, i, W) * lit(x) : 1)), Math.max(reach, 0.62));
      if (this.look === "b1") this.glazeGlints(e, k, settled, near);

      if (this.look === "b2") this.sparkRibbon(e, settled, near);
    }
  }

  /**
   * B1 表面反射：沿肩部的一条带，但亮度沿 x 由"该弧段是否朝向左上方光源"决定（渐变色标逐点给出，连续无台阶），
   * 所以只在朝光的弧段亮起、在别处完全消失，并随海浪游动滑动。Glazed（1 号）粗糙度低：窄而亮；
   * Satin（2–4 号）粗糙度略高：宽而暗，总能量相近。核心 + 很窄的外缘两层，没有大范围光晕。
   * 亮度再乘光照窗口（0.75–1.25，平均不变，随 lightCentre 缓慢左右移动）与停留增强（REST_BASE → 1）。
   */
  private glazeGlints(e: EdgeSamples, k: number, settled: number, near: (x: number) => number): void {
    const { ctx, W, colors } = this;
    const [r, g, b] = parseRgbCached(colors!.light);
    const glazed = k === 0;
    const centre = -9.5 + 3 * settled, peak = (glazed ? 0.36 : 0.17) * (1 - 0.55 * settled) * (REST_BASE + (1 - REST_BASE) * this.dwell);
    if (peak <= 0.003) return;
    for (const [half, scale] of glazed ? [[1.3, 1], [3, 0.3]] as const : [[2.1, 1], [4.4, 0.32]] as const) {
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      let any = false;
      for (let i = e.x.length - 1; i >= 0; i--) {
        const x = e.x[i]!;
        const a = peak * scale * fromLeft(x, 0.3) * (0.75 + 0.5 * near(x)) * Math.pow(smooth((facing(e, i, W) - 0.48) / 0.4), 1.3);
        if (a > 0.003) any = true;
        grad.addColorStop(clamp01(x), `rgba(${r},${g},${b},${a.toFixed(4)})`);
      }
      if (!any) return;
      const ribbon = new Path2D();
      traceEdge(ribbon, e, W, () => centre + half * (1 - 0.4 * settled), true);
      traceReverse(ribbon, e, W, () => centre - half * (1 - 0.4 * settled));
      ribbon.closePath();
      ctx.fillStyle = grad;
      ctx.fill(ribbon);
    }
  }

  /**
   * B2：玻璃浪沿内侧一根细而连续的晶亮线，粗细随弧段朝向变化。
   * 沿 x 的亮度：左亮右淡的基础分布 × 光照窗口（0.8–1.2，平均不变，缓慢左右移动）× 停留增强（REST_BASE → 1）。
   */
  private sparkRibbon(e: EdgeSamples, settled: number, near: (x: number) => number): void {
    const { ctx, W, colors } = this;
    const width = (i: number) => (0.5 + (1.4 - 0.6 * settled) * facing(e, i, W)) * fromLeft(e.x[i]!, 0.35);
    ctx.beginPath();
    traceEdge(ctx, e, W, () => -0.9, true);
    traceReverse(ctx, e, W, i => -0.9 - width(i));
    ctx.closePath();
    const [r, g, b] = parseRgbCached(colors!.light);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 10; i++) {
      const x = i / 10;
      const base = x < 0.55 ? 0.85 - 0.35 * x / 0.55 : 0.5 - 0.3 * (x - 0.55) / 0.45;
      grad.addColorStop(x, `rgba(${r},${g},${b},${Math.min(1, base * (0.8 + 0.4 * near(x))).toFixed(4)})`);
    }
    ctx.fillStyle = grad;
    ctx.globalAlpha = REST_BASE + (1 - REST_BASE) * this.dwell;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** B2 每层玻璃的不透明度（叠加后由浅到深，见 ocean-material.css 的色值说明）。 */
const GLASS_ALPHA = [0.55, 0.5, 0.5, 0.45] as const;

/**
 * B2 玻璃内部的厚薄起伏：叠加强度（0 = 关闭）。很弱：只在贴近细看时察觉，远看仍是干净的四层透明玻璃。
 * 每带方向（弧度）与相位不同。
 */
const GLASS_UNDULATION = 0.22;
const UNDULATION_ANGLE = [-0.07, 0.05, -0.04, 0.08] as const;
const UNDULATION_PHASE = [0.4, 2.5, 4.3, 5.6] as const;

interface GlassBand { readonly lit: string; readonly deep: string; readonly alpha: number }

/**
 * B2 预合成：第 k 带实际是"k..4 号玻璃叠在一起"。把这几片玻璃按 source-over 合成成一片等效玻璃
 * （总不透明度 A、等效颜色 C），在页面底色上与逐片叠加完全一致，盖在列表内容上时透出的比例也一样；
 * 但每个像素只画一次，而不是四次。
 */
function glassBands(c: PainterColors): GlassBand[] {
  const base = parseRgb(c.base);
  const band = (k: number, pick: readonly string[]) => {
    let rgb: number[] = [...base];
    let keep = 1;
    for (let j = 3; j >= k; j--) {
      const a = GLASS_ALPHA[j]!, col = parseRgb(pick[j]!);
      rgb = rgb.map((v, n) => col[n]! * a + v * (1 - a));
      keep *= 1 - a;
    }
    const alpha = 1 - keep;
    const eq = rgb.map((v, n) => Math.max(0, Math.min(255, Math.round((v - keep * base[n]!) / alpha))));
    return { color: `rgb(${eq[0]},${eq[1]},${eq[2]})`, alpha };
  };
  return [0, 1, 2, 3].map(k => {
    const lit = band(k, c.fill), deep = band(k, c.deep);
    return { lit: lit.color, deep: deep.color, alpha: lit.alpha };
  });
}

const rgbCache = new Map<string, [number, number, number]>();
function parseRgbCached(color: string): [number, number, number] {
  let rgb = rgbCache.get(color);
  if (!rgb) { rgb = parseRgb(color); if (rgbCache.size > 64) rgbCache.clear(); rgbCache.set(color, rgb); }
  return rgb;
}
