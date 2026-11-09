import { FramePace, STALL_MS, publishClockReport } from "../../lib/frameClock.js";
import { beginMotion } from "../../lib/motionIdle.js";
import { oceanEdge } from "../../lib/oceanGeometry.js";
import { LEDGER_TIDE, MOTION_CLOCK, easingFunction } from "../../lib/motionTokens.js";
import { LAYERS, LayerMotion, edgeCurve, edgeSamples, type EdgeSamples, type OceanSize } from "../oceanLayers.js";
import { OceanPainter, type PainterLook } from "../oceanPainter.js";
import { oceanPhase } from "../oceanPhase.js";
import { resolveColors } from "../OceanMaterial.js";
import "../ocean-material.css";
import "./tide.css";

export function tideLook(): PainterLook | null {
  if (typeof document === "undefined") return null;
  const data = document.documentElement.dataset;
  const look = data.visualStyle ?? "";
  return data.themeMode === "light" && (look === "a" || look === "b1" || look === "b2" || look === "c") ? look : null;
}

/**
 * 节奏试调（开发 / 测试构建的 S19 风格把手里，见 StyleLabDock）：只在本次会话里整体缩放时长，不写偏好。
 * 正式数值仍以 Motion Token 的 LEDGER_TIDE 为准。
 */
export const TIDE_RHYTHMS = [{ id: "brisk", scale: 0.85 }, { id: "standard", scale: 1 }, { id: "calm", scale: 1.2 }] as const;
export const tideRhythm = { scale: 1 };

export interface TideRequest {
  /** true：离开账本空间（海浪向下划过）；false：进入（海浪向上划过）。 */
  readonly exit: boolean;
  readonly look: PainterLook;
  readonly page: () => HTMLElement | null;
  /** 在完全遮挡时调用；可以是后台提交（transition），海浪会在露出新页面之前等它。 */
  readonly commit: () => void;
  /** 只预演节奏：像进入一样划过，但不交接页面，最后收成顶栏淡出。 */
  readonly preview?: boolean;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const lowest = (e: EdgeSamples): number => { let v = -Infinity; for (const y of e.y) v = Math.max(v, y); return v; };
const highest = (e: EdgeSamples): number => { let v = Infinity; for (const y of e.y) v = Math.min(v, y); return v; };
const shifted = (e: EdgeSamples, dy: number): EdgeSamples => dy === 0 ? e : { x: e.x, slope: e.slope, y: e.y.map(y => y + dy) };
const reversed = (e: EdgeSamples): EdgeSamples => ({ x: e.x.slice().reverse(), y: e.y.slice().reverse(), slope: e.slope.slice().reverse() });

/**
 * 海浪的上边界：与下边缘同一个 `oceanEdge`（展开态的形状），左右镜像、相位错开（浪背不是浪面的倒影），
 * 上下翻转——4 号最高、1 号最低，层间距与展开态的下边缘相同。offset 为 1 号上边界的基准位置。
 */
function upperSamples(layer: number, seconds: number, size: OceanSize, offset: number): EdgeSamples {
  const scale = size.height * 0.8;
  const y = (x: number): number => offset - (oceanEdge(layer, 1 - x, 0, seconds * 0.9 + 3.1) - 0.7) * scale;
  const n = 25, xs = new Float64Array(n), ys = new Float64Array(n), ss = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = 1.01 - i * 1.02 / (n - 1);
    xs[i] = x; ys[i] = y(x); ss[i] = (y(x + 0.0001) - y(x - 0.0001)) / 0.0002;
  }
  return { x: xs, y: ys, slope: ss };
}

/** 当前账本空间页面（若在）：主进度与海浪尺寸。 */
function ledgerSpace(): { p: number; size: OceanSize } | null {
  const root = document.querySelector<HTMLElement>(".ledger-space");
  if (!root) return null;
  const rect = root.getBoundingClientRect();
  const short = root.querySelector<HTMLElement>(".ocean-short-gauge")?.getBoundingClientRect().height || 116;
  return { p: Number(root.style.getPropertyValue("--p")) || 0, size: { width: rect.width || innerWidth, height: rect.height || innerHeight, short } };
}

/**
 * 账本空间的专属海浪转场（品牌转场，1.19.45）：一道浪直接划过整个屏幕，不是先落下再升起的幕布。
 *
 * 离开账本空间（向下划过）：顶栏里被压缩的四道海浪按开始页既有节奏（4 号领头）向下展开，展开后不停，
 * 整体继续向下；走过一小段后，浪的上边界从屏幕上缘露出来，上边界之外就是目标页面。浪一直向下，上边界随之下移，
 * 直到整道浪从下缘离开。上边界与下边缘对称排列，所以消失的顺序与出现相反：出现时最靠上的 1 号，消失时最靠下、最先离开。
 * 进入账本空间（向上划过）：4、3、2、1 号的上边界依次从屏幕下缘升起，整道浪拂过屏幕；随后 1、2、3、4 号的下边缘
 * 依次露出，再按开始页既有的收起节奏（1 号领头）向上收成顶栏——下面已经是账本空间页面。
 *
 * - 交接只在整屏被浪盖住时发生（浪的上下边界都在屏幕外）；新页面没提交完时，浪在露出新页面前停住等它。
 * - 复用：展开 / 收起的分层节奏就是开始页的 `LayerMotion`；浪沿形状、游动与材质绘制是开始页原函数，
 *   绘制器只多了一组上边界；环境相位与页面共享（`oceanPhase`），收成顶栏时与页面海浪逐像素重合后淡出交接。
 * - 时间：一条按“走过的像素”排布的连续行程（展开 / 划过 / 收起之间速度连续，不停顿），由帧锚定步长推进；
 *   环境游动按真实时间。只在浅色 A / B1 / B2 / C 下播放。
 */
export class TidePresentation {
  private stop: (() => void) | null = null;
  get active(): boolean { return this.stop !== null; }

  /** 立即收尾：未提交的页面立即交付。 */
  cancel(): void { const stop = this.stop; this.stop = null; stop?.(); }

  run(request: TideRequest): void {
    this.cancel();
    const old = request.page();
    if (!old || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) { request.commit(); return; }
    const exit = request.exit && !request.preview;

    const stage = document.createElement("div");
    stage.className = "tide-stage"; stage.dataset.tidePhase = "sweep";
    stage.setAttribute("aria-hidden", "true");
    const ocean = document.createElement("div");
    ocean.className = "space-ocean tide-ocean"; ocean.dataset.oceanLook = request.look;
    // 浪覆盖到的范围先铺一层与账本空间相同的底（统一壁纸）：B2 等半透明玻璃盖住旧页时不透出旧页。
    const backing = document.createElement("div"); backing.className = "tide-backing";
    const canvas = document.createElement("canvas"); canvas.className = "ocean-canvas";
    const probe = document.createElement("span"); probe.className = "ocean-probe";
    const gauge = document.createElement("span"); gauge.className = "ocean-short-gauge";
    ocean.append(canvas, probe, gauge); stage.append(backing, ocean);
    // 离开时先透明叠上（与页面海浪相同），很快显出，盖住页面上的品牌字样。
    if (exit) stage.style.opacity = "0";
    document.body.append(stage);

    const space = exit ? ledgerSpace() : null;
    const size: OceanSize = space?.size ?? { width: innerWidth, height: innerHeight, short: gauge.getBoundingClientRect().height || 116 };
    const painter = new OceanPainter(canvas, request.look);
    painter.resize(size.width, size.height, devicePixelRatio || 1);
    painter.setColors(resolveColors(probe));

    let seconds = oceanPhase.seconds;
    const H = size.height;
    const travelOf = (p: number): number => Math.max(0, size.height * 0.8 - size.short) * p;

    // 浪的厚度：4 号的上边界与下边缘之间比屏幕高出 coverWindow，整屏被盖住的这段行程用来交接页面。
    const S = size.height * 0.8, margin = S * 0.03;
    const depth = (k: number, x: number): number => (oceanEdge(k, 1 - x, 0, seconds * 0.9 + 3.1) - 0.7) * S;
    let minD3 = Infinity, maxD3 = -Infinity;
    for (let i = 0; i <= 48; i++) { const d = depth(3, i / 48); minD3 = Math.min(minD3, d); maxD3 = Math.max(maxD3, d); }
    const bottom4 = highest(edgeSamples(3, 0, seconds, size));
    const C = bottom4 - H - LEDGER_TIDE.coverWindow * H + minD3 - margin;
    const yHold = -(C - minD3) - margin;              // 上边界（4 号）仍在屏幕上缘之外的最大下移量
    const yCover = H - bottom4 + margin;              // 下边缘（4 号）已在屏幕下缘之外的最小下移量
    // 上边界全部在屏幕下缘之外（进入的起点、离开的终点）：只留 2px，进入时点击后最初几帧浪就从下缘冒出来。
    const yEnd = H + 2 - (C - maxD3);

    // 行程：离开 = 展开（dist）+ 下移 yEnd；进入 = 上移 yEnd + 收起（dist，到账本空间页面的顶栏或展开态）。
    const pageP = space ? space.p : 1;
    let dist = travelOf(exit ? pageP : 1);
    let total = exit ? dist + yEnd : yEnd + dist;
    let qRest = exit ? pageP : 1;
    const motion = new LayerMotion(exit ? 1 : 0, () => size.short / Math.max(size.height * 0.8, 1));
    const qOf = (n: number): number => qRest * n;
    const ease = easingFunction(LEDGER_TIDE.sweep.easing);
    const easeInv = (v: number): number => { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ease(m) < v) lo = m; else hi = m; } return hi; };
    const k = tideRhythm.scale;
    const D = LEDGER_TIDE.sweep.duration * k, fadeOutMs = LEDGER_TIDE.fadeOut * k;

    const pace = new FramePace();
    let ys = exit ? 0 : yEnd;
    let t = 0, last: number | null = null, raf = 0, ended = false, fading = -1;
    let committed = false, arrived = !!request.preview, committedAt = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    oceanPhase.covered = exit;
    const idle = beginMotion();
    const created = performance.now();
    let frames = 0, firstAt = 0, maxGap = 0;

    const finish = (stalled = false): void => {
      if (ended) return;
      ended = true; cancelAnimationFrame(raf); clearTimeout(watchdog); idle();
      publishClockReport({ name: exit ? "ledgerTideExit" : request.preview ? "ledgerTidePreview" : "ledgerTide", frames, firstFrameMs: Math.round((firstAt || created) - created),
        wallMs: Math.round(performance.now() - (firstAt || created)), maxGapMs: Math.round(maxGap), duration: Math.round(D), completed: !stalled, stalled });
      stage.remove(); oceanPhase.covered = false;
      if (this.stop === stop) this.stop = null;
      if (!committed && !request.preview) { committed = true; request.commit(); }
    };
    const stop = (): void => finish();
    this.stop = stop;
    const arm = (): void => { clearTimeout(watchdog); watchdog = setTimeout(() => finish(true), STALL_MS); };

    /** 进入：新页面到达后按它的实际状态（顶栏或首次展开态）重排剩余行程，已走过的位置不变。 */
    const replan = (): void => {
      const now = ledgerSpace();
      if (!now || exit || request.preview) return;
      if (now.size.width !== size.width || now.size.height !== size.height || now.size.short !== size.short) {
        Object.assign(size, now.size); painter.resize(size.width, size.height, devicePixelRatio || 1);
      }
      const done = ease(clamp01(t / D)) * total;
      qRest = now.p; dist = travelOf(qRest); total = yEnd + dist;
      t = D * easeInv(clamp01(done / total));
    };

    const tick = (now: number): void => {
      if (ended) return;
      const gap = last === null ? 0 : now - last;
      if (last === null) firstAt = now; else maxGap = Math.max(maxGap, gap);
      frames++;
      const step = last === null ? 0 : Math.min(pace.step(gap), MOTION_CLOCK.maxStep);
      last = now;
      seconds += Math.min(gap, 50) / 1000; oceanPhase.seconds = seconds;

      if (fading >= 0) {
        fading += step;
        motion.step(1, step);
        stage.style.opacity = String(1 - clamp01(fading / fadeOutMs));
        if (fading >= fadeOutMs) { finish(); return; }
      } else {
        t = Math.min(D, t + step);
        let travelled = ease(clamp01(t / D)) * total;
        // 新页面还没提交完：在露出新页面之前停住（离开：上边界不进屏幕；进入：下边缘不出屏幕）。
        const cap = arrived ? Infinity : exit ? dist + yHold : yEnd - yCover;
        if (travelled > cap) { travelled = cap; t = D * easeInv(clamp01(cap / total)); }
        if (exit) {
          motion.step(dist > 0 ? Math.max(0, 1 - travelled / dist) : 0, step);
          ys = Math.max(0, travelled - dist);
        } else {
          motion.step(dist > 0 ? clamp01((travelled - yEnd) / dist) : 1, step);
          ys = Math.max(0, yEnd - travelled);
        }
        if (exit && now - firstAt <= LEDGER_TIDE.fadeIn + 34) stage.style.opacity = String(clamp01((now - firstAt) / LEDGER_TIDE.fadeIn));
      }

      const q = motion.layers.map(f => qOf(f.q));
      const lower = LAYERS.map(layer => shifted(edgeSamples(layer, q[layer]!, seconds, size), ys));
      const upper = LAYERS.map(layer => upperSamples(layer, seconds, size, C + ys));
      painter.paint(lower, q.map(clamp01), seconds, 0, upper);
      backing.style.clipPath = `path("${edgeCurve(upper[3]!, size.width)} ${edgeCurve(reversed(lower[3]!), size.width).replace(/^M/, "L")} Z")`;

      // 整屏被浪盖住（4 号上边界在屏幕上缘之外、下边缘在下缘之外）：在下方提交新页面。
      const covered = highest(upper[3]!) < -1 && lowest(upper[3]!) <= 0 && highest(lower[3]!) >= H;
      if (!committed && !request.preview && covered) {
        committed = true; committedAt = now; oceanPhase.covered = true; request.commit();
      }
      if (committed && !arrived) {
        const current = request.page();
        if (current && current !== old) { arrived = true; replan(); stage.dataset.tidePhase = "reveal"; }
        else if (now - committedAt > LEDGER_TIDE.giveUpMs) arrived = true;
      }
      // 离开：整道浪（最高的 4 号上边界）一离开屏幕下缘就收尾，不等缓动的长尾。
      if (exit && fading < 0 && arrived && highest(upper[3]!) >= H) { finish(); return; }
      // 剩余行程不到 1px 就算走完（缓动的长尾看不见），再看各层是否已落定。
      const remaining = total - ease(clamp01(t / D)) * total;
      if (fading < 0 && arrived && (t >= D || remaining < 1)) {
        if (exit) {
          if (highest(upper[3]!) >= H) { finish(); return; }
        } else if (motion.layers.every(f => Math.abs(qOf(f.q) - qRest) * Math.max(size.height * 0.8 - size.short, 1) < 1.5)) {
          // 收成与页面海浪重合的顶栏：页面恢复绘制，转场层淡出（品牌字样随之出现）。
          fading = 0; stage.dataset.tidePhase = "fade"; oceanPhase.covered = false;
        }
      }
      raf = requestAnimationFrame(tick); arm();
    };
    raf = requestAnimationFrame(tick); arm();
  }
}
