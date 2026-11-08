import { oceanEdge } from "../lib/oceanGeometry.js";
import { clamp01 } from "../lib/transitionPhysics.js";

/**
 * S19 开始页面四层海浪：每层自己的纵向进度 + 像素坐标几何。
 *
 * ⚠️ 只消费 `oceanEdge`（左右游动函数，一字不改）与 `--p`（主进度，仍由 useSpaceTransition 独占）。
 * 本模块不写 `--p`、不改主弹簧、不改手势；它只决定"四层各自晚多少、怎么落定"。
 *
 * 层号约定：layer 0 = 1 号（最深、最上、压在最上面），layer 3 = 4 号（最浅、最下沿）。
 * 进度约定：p = 0 欢迎态（海浪铺满），p = 1 列表态（海浪收成顶栏）。
 */

export const LAYERS = [0, 1, 2, 3] as const;

/**
 * 领头层先走：下行（p 变小，海浪向下覆盖）4→3→2→1；上行（p 变大，海浪退去）1→2→3→4。
 * 两个方向都满足"深一层的进度更接近欢迎态"，即 q[k+1] ≤ q[k]，层间距只会被拉开。
 */
export function layerRank(layer: number, direction: 1 | -1): number {
  return direction > 0 ? layer : 3 - layer;
}

/**
 * 分层节奏：每层的目标进度是主进度的一段重映射，再经过一个轻微欠阻尼的跟随。
 *
 * - 按"已走过的路程" d（上行 d = p，下行 d = 1 − p）计：rank r 的层在 d ∈ [start[r], arrive[r]] 内走完全程。
 *   领头层从 0 就走、最先到；最后一层晚一点才走、最后到 —— 依次启动、中途拉开、依次到位。
 * - 目标到位时会"停住"，跟随的小弹簧带着惯性略微越过再回来，这就是每层各自的轻微回弹；
 *   到位越快回弹越明显，最后一层到位最慢，所以最柔和。
 * - 目标只由主进度决定（不读时间），手指拖动时四层始终跟手、可逆，不会累积误差。
 * - 主进度到达两端时所有目标都恰好等于主进度，静止后四层一定回到正常层间距。
 */
export const LAYER_MOTION = {
  /** rank 0 = 领头层 */
  start: [0, 0.05, 0.1, 0.15],
  arrive: [0.84, 0.88, 0.92, 0.96],
  /** 跟随弹簧：角频率（rad/s）与阻尼比。 */
  omega: [30, 29, 28, 27],
  zeta: [0.66, 0.67, 0.68, 0.69],
  /** 允许的反向挤压，占当前静止层间距的比例（只在回弹交错时出现）。 */
  squeeze: 0.2,
  /** 判定方向反转所需的回退量（进度单位）。 */
  reverse: 0.012,
};

/** A 的独立悬浮 Logo：自己的节奏 —— 上行比 1 号稍晚、下行比 1 号先到，看得出不是印在海浪上。 */
export const LOGO_MOTION = { start: 0.02, arrive: 0.9, omega: 24, zeta: 0.66 };

interface Follower { q: number; v: number }

function springTo(f: Follower, target: number, omega: number, zeta: number, h: number): void {
  const a = omega * omega * (target - f.q) - 2 * zeta * omega * f.v;
  f.v += a * h;
  f.q += f.v * h;
}

/** 主进度 p 在 rank 这一层上的目标（方向决定从哪一端算路程）。 */
export function layerTarget(p: number, direction: 1 | -1, start: number, arrive: number): number {
  const travelled = direction > 0 ? p : 1 - p;
  const own = clamp01((travelled - start) / Math.max(arrive - start, 1e-3));
  return direction > 0 ? own : 1 - own;
}

/**
 * 四层（+ A 的 Logo）跟随主进度。纯计算、无 DOM，单测可逐帧驱动。
 *
 * ⚠️ 静止判定后直接对齐主进度，避免长尾细抖；减少动态效果时调用 reset 即可。
 */
export class LayerMotion {
  readonly layers: Follower[];
  readonly logo: Follower;
  private direction: 1 | -1 = 1;
  private extreme: number;
  private resting = true;

  constructor(p: number, private readonly shortRatio = () => 0.19) {
    this.layers = LAYERS.map(() => ({ q: p, v: 0 }));
    this.logo = { q: p, v: 0 };
    this.extreme = p;
    this.direction = p >= 1 ? -1 : 1;
  }

  /** 立即对齐（减少动态效果、首帧）。 */
  reset(p: number): void {
    for (const f of [...this.layers, this.logo]) { f.q = p; f.v = 0; }
    this.extreme = p;
    this.resting = true;
  }

  get settled(): boolean { return this.resting; }
  get heading(): 1 | -1 { return this.direction; }

  /** 方向带回差：主进度从最远点回退超过 reverse 才算换向，手指的细小抖动不会让四层来回换领头。 */
  private track(p: number): void {
    if (this.direction > 0) {
      if (p > this.extreme) this.extreme = p;
      else if (p < this.extreme - LAYER_MOTION.reverse || p <= 0) { this.direction = -1; this.extreme = p; }
    } else {
      if (p < this.extreme) this.extreme = p;
      else if (p > this.extreme + LAYER_MOTION.reverse || p >= 1) { this.direction = 1; this.extreme = p; }
    }
  }

  /** 静止层间距换算成进度单位，用来限制回弹交错时的挤压。 */
  private squeezeLimit(q: number): number {
    const r = this.shortRatio();
    const c = clamp01(q);
    const settle = c * c * (3 - 2 * c);
    const restGap = (0.10 - 0.015 * settle) * ((1 - q) + r * q);
    return LAYER_MOTION.squeeze * restGap / Math.max(0.9 * (1 - r), 0.2);
  }

  /** 推进 `elapsedMs`（调用方已截断，页面隐藏回来不补跑）。 */
  step(p: number, elapsedMs: number): void {
    this.track(p);
    const dt = Math.min(Math.max(elapsedMs, 0), 50) / 1000;
    const steps = Math.max(1, Math.ceil(dt * 240));
    const h = dt / steps;
    const targets = this.layers.map((_, layer) => {
      const rank = layerRank(layer, this.direction);
      return layerTarget(p, this.direction, LAYER_MOTION.start[rank]!, LAYER_MOTION.arrive[rank]!);
    });
    const logoTarget = layerTarget(p, this.direction, LOGO_MOTION.start, LOGO_MOTION.arrive);
    for (let s = 0; s < steps; s++) {
      this.layers.forEach((f, layer) => {
        const rank = layerRank(layer, this.direction);
        springTo(f, targets[layer]!, LAYER_MOTION.omega[rank]!, LAYER_MOTION.zeta[rank]!, h);
      });
      springTo(this.logo, logoTarget, LOGO_MOTION.omega, LOGO_MOTION.zeta, h);
    }

    // 深一层不得比浅一层更靠列表态太多：允许回弹交错，但层间距最多被挤压 squeeze。
    for (let layer = 0; layer < 3; layer++) {
      const upper = this.layers[layer]!, lower = this.layers[layer + 1]!;
      const limit = upper.q + this.squeezeLimit(upper.q);
      if (lower.q > limit) { lower.q = limit; lower.v = Math.min(lower.v, upper.v); }
    }

    const all = [...this.layers, this.logo];
    this.resting = all.every(f => Math.abs(f.q - p) < 2e-4 && Math.abs(f.v) < 4e-3);
    if (this.resting) for (const f of all) { f.q = p; f.v = 0; }
  }
}

/**
 * 列表内容（新 UI）跟随 4 号层的实际进度：4 号落后（上行）或领先（下行）于主进度时，内容按这段落差再多让出一点，
 * 于是"稍晚出现、稍快到位"，整体时长不变，也不会被 4 号浪盖住。静止时 q4 = p，位移为 0。
 * 像素位移 = CONTENT_LAG_GAIN × (0.8H − 顶栏高) × max(0, p − q4)；CSS 用同一个 --p，不会与布局错帧。
 */
export const CONTENT_LAG_GAIN = 1.12;
export function contentLag(p: number, q4: number, size: { readonly height: number; readonly short: number }): number {
  return CONTENT_LAG_GAIN * Math.max(0, size.height * 0.8 - size.short) * Math.max(0, p - q4);
}

/* ------------------------------------------------------------------ 几何 */

export interface OceanSize {
  /** `.ledger-space` 宽度（px） */
  readonly width: number;
  /** `.ledger-space` 高度（px）= 100 lv-vh */
  readonly height: number;
  /** `--sea-short`（px） */
  readonly short: number;
}

/** 与 index.css 的 `--sea-h` 同一公式；q 超出 [0,1] 时线性外推（只用于回弹的位移，不改形状）。 */
export function seaHeight(q: number, size: OceanSize): number {
  return size.height * 0.8 * (1 - q) + size.short * q;
}

const SEGMENTS = 24;

/** 一层浪沿：与 oceanPath 完全相同的取样点、斜率与三次 Hermite 分段，只是 y 用像素表示。 */
export interface EdgeSamples {
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** dy/dx，x 以宽度比例计（与 oceanPath 的 slope 同量纲：像素 / 比例） */
  readonly slope: Float64Array;
}

export function edgeSamples(layer: number, q: number, seconds: number, size: OceanSize): EdgeSamples {
  const shape = clamp01(q);
  const sea = seaHeight(q, size);
  const y = (x: number): number => oceanEdge(layer, x, shape, seconds) * sea;
  const xs = new Float64Array(SEGMENTS + 1), ys = new Float64Array(SEGMENTS + 1), ss = new Float64Array(SEGMENTS + 1);
  for (let i = 0; i <= SEGMENTS; i++) {
    const x = 1.01 - i * 1.02 / SEGMENTS;
    xs[i] = x;
    ys[i] = y(x);
    ss[i] = (y(x + 0.0001) - y(x - 0.0001)) / 0.0002;
  }
  return { x: xs, y: ys, slope: ss };
}

const f2 = (n: number): string => n.toFixed(2);

/** 浪沿开放曲线（右→左），可附加逐点偏移；用于描边。 */
export function edgeCurve(e: EdgeSamples, width: number, offset: (i: number) => number = () => 0): string {
  const off = Array.from({ length: SEGMENTS + 1 }, (_, i) => offset(i));
  const dOff = off.map((_, i) => {
    const a = Math.max(0, i - 1), b = Math.min(SEGMENTS, i + 1);
    return (off[b]! - off[a]!) / (e.x[b]! - e.x[a]!);
  });
  let d = `M${f2(e.x[0]! * width)},${f2(e.y[0]! + off[0]!)}`;
  for (let i = 0; i < SEGMENTS; i++) {
    const a = e.x[i]!, b = e.x[i + 1]!, h = (b - a) / 3;
    const ya = e.y[i]! + off[i]!, yb = e.y[i + 1]! + off[i + 1]!;
    const sa = e.slope[i]! + dOff[i]!, sb = e.slope[i + 1]! + dOff[i + 1]!;
    d += ` C${f2((a + h) * width)},${f2(ya + sa * h)} ${f2((b - h) * width)},${f2(yb - sb * h)} ${f2(b * width)},${f2(yb)}`;
  }
  return d;
}

/** 一整层：从视口上方一直到浪沿，闭合（等同原版的整块填充）。 */
export function layerShape(e: EdgeSamples, width: number): string {
  return `M${f2(-0.01 * width)},-40 H${f2(1.01 * width)} L` + edgeCurve(e, width).slice(1) + " Z";
}

/**
 * 局部朝向：浪沿向右下行的一段更朝向左上方的光，向右上行的一段背光。返回 0..1。
 * 只读斜率，不读进度，所以随海浪游动自然流动。
 */
export function facing(e: EdgeSamples, i: number, width: number): number {
  const s = e.slope[i]! / Math.max(width, 1);
  return 0.5 + 0.5 * Math.tanh(s * 7);
}

/** 光从左上方进入：左侧强、右侧弱。x 为宽度比例。 */
export function fromLeft(x: number, keep = 0.35): number {
  return keep + (1 - keep) * (1 - clamp01(x));
}

export const SAMPLE_COUNT = SEGMENTS + 1;
