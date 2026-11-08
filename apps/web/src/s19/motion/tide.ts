import { FramePace, STALL_MS, publishClockReport } from "../../lib/frameClock.js";
import { LEDGER_TIDE, MOTION_CLOCK, easingFunction } from "../../lib/motionTokens.js";
import { LAYERS, LayerMotion, edgeSamples, layerShape, type EdgeSamples, type OceanSize } from "../oceanLayers.js";
import { OceanPainter, type PainterLook } from "../oceanPainter.js";
import { oceanPhase } from "../oceanPhase.js";
import { resolveColors } from "../OceanMaterial.js";
import "../ocean-material.css";
import "./tide.css";

/**
 * 账本空间的专属海浪转场（品牌转场，1.19.45）。
 *
 * 进入：账本空间的四层海浪从屏幕上缘涌下，按既有“下行”节奏 4→3→2→1 接力覆盖当前页面（4 号最浅、领头），
 * 直到只剩 1、2 号深色海浪盖住整屏；在完全遮挡下提交账本空间页面；随后按既有“退去”节奏（上行 1→2→3→4）
 * 退到账本空间自己的海浪位置（顶栏态或首次的展开态），与页面海浪逐像素重合后淡出交接。约 1 秒。
 * 离开：反过来——账本空间自己的海浪涌下盖住它，提交目标页，再整体退出屏幕上缘。
 *
 * - **复用而不复制**：四层的分层节奏就是开始页的 `LayerMotion`（领头层先走、中途拉开、依次落定、轻微回弹），
 *   在“归一化进度”上驱动；浪沿形状、左右游动、材质绘制都是开始页的原函数（`edgeSamples` / `OceanPainter`）。
 *   环境相位与页面共享（`oceanPhase`），所以交接时没有错位。
 * - **时间**：主进度由帧锚定的步长推进（卡顿只放慢、不跳），层的弹簧也按这个步长积分；环境游动按真实时间。
 * - 只在浅色 A / B1 / B2 / C 下播放（开始页海浪也只有这四种材质）；Original、深色、减少动态效果时直接切换。
 */

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
  /** true：离开账本空间。 */
  readonly exit: boolean;
  readonly look: PainterLook;
  readonly page: () => HTMLElement | null;
  /** 在完全遮挡时调用；可以是后台提交（transition），转场会等新页面出现再退潮。 */
  readonly commit: () => void;
  /** 只预演节奏：涌下后不交接页面，直接整体退出屏幕上缘。 */
  readonly preview?: boolean;
}

type Phase = "cover" | "hold" | "recede" | "fade";
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 在 [lo, hi] 上二分出满足 test 的边界（test 单调：lo 一侧不满足、hi 一侧满足）。 */
function bisect(test: (q: number) => boolean, lo: number, hi: number): number {
  for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (test(mid)) hi = mid; else lo = mid; }
  return hi;
}
const lowest = (e: EdgeSamples): number => { let v = -Infinity; for (const y of e.y) v = Math.max(v, y); return v; };
const highest = (e: EdgeSamples): number => { let v = Infinity; for (const y of e.y) v = Math.min(v, y); return v; };

/** 当前账本空间页面（若在）：主进度与海浪尺寸。 */
function ledgerSpace(): { p: number; size: OceanSize } | null {
  const root = document.querySelector<HTMLElement>(".ledger-space");
  if (!root) return null;
  const rect = root.getBoundingClientRect();
  const short = root.querySelector<HTMLElement>(".ocean-short-gauge")?.getBoundingClientRect().height || 116;
  return { p: Number(root.style.getPropertyValue("--p")) || 0, size: { width: rect.width || innerWidth, height: rect.height || innerHeight, short } };
}

export class TidePresentation {
  private stop: (() => void) | null = null;
  get active(): boolean { return this.stop !== null; }

  /** 立即收尾：未提交的页面立即交付。 */
  cancel(): void { const stop = this.stop; this.stop = null; stop?.(); }

  run(request: TideRequest): void {
    this.cancel();
    const old = request.page();
    if (!old || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) { request.commit(); return; }

    const stage = document.createElement("div");
    stage.className = "tide-stage"; stage.dataset.tidePhase = "cover";
    stage.setAttribute("aria-hidden", "true");
    const ocean = document.createElement("div");
    ocean.className = "space-ocean tide-ocean"; ocean.dataset.oceanLook = request.look;
    // 海浪覆盖到的范围先铺一层与账本空间相同的底（统一壁纸）：B2 等半透明玻璃盖住旧页时不透出旧页，
    // 交接时与页面海浪下面的底色一致。
    const backing = document.createElement("div"); backing.className = "tide-backing";
    const canvas = document.createElement("canvas"); canvas.className = "ocean-canvas";
    const probe = document.createElement("span"); probe.className = "ocean-probe";
    const gauge = document.createElement("span"); gauge.className = "ocean-short-gauge";
    ocean.append(canvas, probe, gauge); stage.append(backing, ocean);
    // 离开时先透明叠上（与页面海浪相同），很快显出，盖住页面上的品牌字样。
    if (request.exit) stage.style.opacity = "0";
    document.body.append(stage);

    const space = request.exit ? ledgerSpace() : null;
    const size: OceanSize = space?.size ?? { width: innerWidth, height: innerHeight, short: gauge.getBoundingClientRect().height || 116 };
    const painter = new OceanPainter(canvas, request.look);
    painter.resize(size.width, size.height, devicePixelRatio || 1);
    painter.setColors(resolveColors(probe));

    let seconds = oceanPhase.seconds;
    const H = size.height;
    // 全部浪沿都在屏幕上缘之外（进入的起点、离开的终点）。
    const qTop = bisect(q => lowest(edgeSamples(3, q, seconds, size)) <= -16, 1, 4);
    // 3 号浪沿也已越过屏幕下缘：整屏只剩 1、2 号深色海浪（涌下的终点，退潮从这里开始）。
    const qFull = -bisect(q => highest(edgeSamples(2, -q, seconds, size)) >= H + 12, 0, 4);
    const qStart = space ? space.p : qTop;
    let qOther = qStart;
    const motion = new LayerMotion(1, () => size.short / Math.max(size.height * 0.8, 1));
    const actual = (n: number): number => qFull + (qOther - qFull) * n;

    const cover = easingFunction(LEDGER_TIDE.cover.easing), recede = easingFunction(LEDGER_TIDE.recede.easing);
    const pace = new FramePace();
    let phase: Phase = "cover", t = 0, last: number | null = null, raf = 0, ended = false;
    let committed = false, arrived = !!request.preview, committedAt = 0, deep = false;
    const k = tideRhythm.scale;
    const coverMs = LEDGER_TIDE.cover.duration * k, recedeMs = LEDGER_TIDE.recede.duration * k, fadeOutMs = LEDGER_TIDE.fadeOut * k;
    const leaving = request.exit || !!request.preview;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    oceanPhase.covered = request.exit;

    const created = performance.now();
    let frames = 0, firstAt = 0, maxGap = 0;
    const finish = (stalled = false): void => {
      if (ended) return;
      ended = true; cancelAnimationFrame(raf); clearTimeout(watchdog);
      publishClockReport({ name: request.exit ? "ledgerTideExit" : request.preview ? "ledgerTidePreview" : "ledgerTide", frames, firstFrameMs: Math.round((firstAt || created) - created),
        wallMs: Math.round(performance.now() - (firstAt || created)), maxGapMs: Math.round(maxGap), duration: Math.round(coverMs + recedeMs), completed: !stalled && phase !== "cover", stalled });
      stage.remove(); oceanPhase.covered = false;
      if (this.stop === stop) this.stop = null;
      if (!committed && !request.preview) { committed = true; request.commit(); }
    };
    const stop = (): void => finish();
    this.stop = stop;
    const arm = (): void => { clearTimeout(watchdog); watchdog = setTimeout(() => finish(true), STALL_MS); };

    const startRecede = (): void => {
      const target = leaving ? qTop : ledgerSpace()?.p ?? 1;
      // 进入：按账本空间页面实际的海浪尺寸退潮，落点与页面海浪一致（尺寸相同时不重建画布）。
      const now = leaving ? null : ledgerSpace();
      if (now && (now.size.width !== size.width || now.size.height !== size.height || now.size.short !== size.short)) {
        Object.assign(size, now.size); painter.resize(size.width, size.height, devicePixelRatio || 1);
      }
      // 换到退潮的映射：保持每层当前的真实位置与速度不变。
      const scale = (qOther - qFull) / ((target - qFull) || 1);
      for (const f of motion.layers) { f.q *= scale; f.v *= scale; }
      qOther = target;
      phase = "recede"; t = 0; stage.dataset.tidePhase = "recede";
    };

    const tick = (now: number): void => {
      if (ended) return;
      const gap = last === null ? 0 : now - last;
      if (last === null) firstAt = now; else maxGap = Math.max(maxGap, gap);
      frames++;
      const step = last === null ? 0 : Math.min(pace.step(gap), MOTION_CLOCK.maxStep);
      last = now;
      seconds += Math.min(gap, 50) / 1000; oceanPhase.seconds = seconds;
      if (phase === "cover") {
        t += step;
        if (request.exit) stage.style.opacity = String(clamp01(t / LEDGER_TIDE.fadeIn));
        motion.step(1 - cover(clamp01(t / coverMs)), step);
        // 1、2 号已盖满整屏且新页面已到位：不必等涌下的减速尾段走完，直接退潮（各层位置与速度原样接续）。
        if (t >= coverMs || (arrived && deep)) phase = "hold";
      } else if (phase === "hold") {
        motion.step(0, step);
        if (arrived) startRecede();
      } else if (phase === "recede") {
        t += step;
        motion.step(recede(clamp01(t / recedeMs)), step);
        // 可见的运动结束就交接，不等缓动的长尾：离开时四层都已退出屏幕上缘；进入时四层离落点都不到 1.5px。
        const gone = leaving && motion.layers.every(f => actual(f.q) >= qTop - 1e-3);
        const landed = !leaving && t >= recedeMs * 0.5
          && motion.layers.every(f => Math.abs(actual(f.q) - qOther) * Math.max(size.height * 0.8 - size.short, 1) < 1.5);
        if (gone || (leaving && t >= recedeMs && motion.settled)) { finish(); return; }
        if (landed) {
          // 与页面海浪重合：页面恢复绘制，转场层淡出（品牌字样随之出现）。
          phase = "fade"; t = 0; stage.dataset.tidePhase = "fade"; oceanPhase.covered = false;
        }
      } else {
        t += step;
        motion.step(1, step);
        stage.style.opacity = String(1 - clamp01(t / fadeOutMs));
        if (t >= fadeOutMs) { finish(); return; }
      }
      const q = motion.layers.map(f => actual(f.q));
      const edges = LAYERS.map(k => edgeSamples(k, q[k]!, seconds, size));
      painter.paint(edges, q.map(clamp01), seconds, 0);
      backing.style.clipPath = `path("${layerShape(edges[3]!, size.width)}")`;
      deep = highest(edges[2]!) >= H;
      // 4 号浪沿越过屏幕下缘 = 旧页已完全被盖住：此时开始在下方提交新页面（渲染时间藏在继续涌下的海浪后面）；
      // 退潮要等 1、2 号盖满整屏（hold）且新页面已经到位。
      if (!committed && !request.preview && phase !== "recede" && highest(edges[3]!) >= H) {
        committed = true; committedAt = now; oceanPhase.covered = true; request.commit();
      }
      if (committed && !arrived) {
        const current = request.page();
        if (current && current !== old) arrived = true;
        else if (now - committedAt > LEDGER_TIDE.giveUpMs) arrived = true;
      }
      raf = requestAnimationFrame(tick); arm();
    };
    raf = requestAnimationFrame(tick); arm();
  }
}
