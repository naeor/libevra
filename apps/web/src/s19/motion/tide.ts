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
  /**
   * 整页重新载入（切换账本）：一盖满整屏、且 ready() 为真，就存下交接帧并调用 go()；没准备好时继续走到停留点等。
   * 不再露出旧页。转场被打断（取消、卡住）时也会调用 go(null)，调用方照常载入。hint：等待稍久时 1 号深色核心里的提示。
   */
  readonly reload?: { readonly ready: () => boolean; readonly go: (resume: TideResume | null) => void; readonly hint?: string };
  /** 新页面接着上一页的交接帧向下划过（离开账本空间的后半段）。 */
  readonly resume?: TideResume;
  /** 为真时停在原位（环境游动照常），直到返回假才开始划过（新页面的协调器挂载前）。 */
  readonly hold?: () => boolean;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const lowest = (e: EdgeSamples): number => { let v = -Infinity; for (const y of e.y) v = Math.max(v, y); return v; };
const highest = (e: EdgeSamples): number => { let v = Infinity; for (const y of e.y) v = Math.min(v, y); return v; };
const shifted = (e: EdgeSamples, dy: number): EdgeSamples => dy === 0 ? e : { x: e.x, slope: e.slope, y: e.y.map(y => y + dy) };
const smoothstep = (v: number): number => { const c = clamp01(v); return c * c * (3 - 2 * c); };

/**
 * 切换账本必须整页重新载入（LedgerSpacePage 的 activateAndReload）：转场先盖满整屏，把最后一帧存进
 * sessionStorage；新页面的 `public/tide-resume.js` 在第一次绘制前把这一帧铺满屏幕（不再白屏），
 * 协调器挂载后从同一帧接着向下划过、露出新页面。
 */
export interface TideResume {
  readonly at: number;
  readonly look: PainterLook;
  readonly seconds: number;
  readonly y: number;
  readonly c: number;
  readonly width: number;
  readonly height: number;
  readonly image: string;
  readonly color: string;
  /** 等待提示：文字、所在高度（1 号深色核心中线）、颜色与投影（新页面铺底在应用样式载入前就要画出同样的字）。 */
  readonly hint?: string;
  readonly hintY?: number;
  readonly hintColor?: string;
  readonly hintShadow?: string;
  /** 提示开始淡入的时刻（Date.now()，整屏第一次被盖住后 LEDGER_TIDE.hint.delay）与淡入时长：两页按同一时刻计时，淡入不重来。 */
  readonly hintAt?: number;
  readonly hintFade?: number;
}
const RESUME_KEY = "libevra.tide-resume";
const RESUME_COVER = "data-tide-resume";
const RESUME_VARS = ["--tide-resume-image", "--tide-resume-color", "--tide-resume-hint", "--tide-resume-hint-y", "--tide-resume-hint-color", "--tide-resume-hint-shadow", "--tide-resume-hint-fade", "--tide-resume-hint-delay"];
/** 交接帧的有效期：从存下到新页面开始播放（开发服务器经局域网载入可能要好几秒）。 */
const RESUME_MAX_AGE = 15_000;

function saveTideResume(resume: TideResume): boolean {
  try { sessionStorage.setItem(RESUME_KEY, JSON.stringify(resume)); return true; } catch { return false; }
}

/**
 * 读取上一页留下的交接帧；只有新页面的铺底帧仍在、风格与尺寸一致时才接着播放。真正播放出画面后才删除
 * （{@link forgetTideResume}）：开发模式的 StrictMode 会立刻卸载并重建协调器，第一次的转场一帧都没画。
 */
export function takeTideResume(look: PainterLook | null): TideResume | null {
  let resume: TideResume | null = null;
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    resume = raw ? JSON.parse(raw) as TideResume : null;
  } catch { resume = null; }
  const covered = document.documentElement.hasAttribute(RESUME_COVER);
  // 高度允许有出入（iOS 地址栏收起 / 展开会改变视口高度），按比例接着画；宽度变了（转屏）就不接。
  if (!resume || !covered || resume.look !== look || Date.now() - resume.at > RESUME_MAX_AGE || !(resume.height > 0)
    || Math.abs(resume.width - innerWidth) > 2 || Math.abs(resume.height - innerHeight) > Math.max(200, resume.height * 0.25)) {
    forgetTideResume(); fadeTideResumeCover(); return null;
  }
  return resume;
}
function forgetTideResume(): void { try { sessionStorage.removeItem(RESUME_KEY); } catch { /* 存储不可用 */ } }

/** 撤掉新页面第一次绘制前铺上的交接帧（转场已画出同一帧时用）。 */
export function clearTideResumeCover(): void {
  const root = document.documentElement;
  root.removeAttribute(RESUME_COVER);
  for (const name of RESUME_VARS) root.style.removeProperty(name);
}

/** 不能接着播放时：铺底淡出（index.html 的 [data-tide-resume="fade"]），不硬切。 */
export function fadeTideResumeCover(): void {
  const root = document.documentElement;
  if (!root.hasAttribute(RESUME_COVER) || root.getAttribute(RESUME_COVER) === "fade") return;
  root.setAttribute(RESUME_COVER, "fade");
  setTimeout(() => { if (root.getAttribute(RESUME_COVER) === "fade") clearTideResumeCover(); }, 220);
}
const reversed = (e: EdgeSamples): EdgeSamples => ({ x: e.x.slice().reverse(), y: e.y.slice().reverse(), slope: e.slope.slice().reverse() });

/** 上边界的起伏：`oceanEdge` 展开态形状去掉层间距，左右镜像、相位错开（浪背不是浪面的倒影）。 */
function upperWave(layer: number, x: number, seconds: number, size: OceanSize): number {
  return (oceanEdge(layer, 1 - x, 0, seconds * 0.9 + 3.1) - 0.7 - 0.1 * layer) * size.height * 0.8;
}

/**
 * 海浪的上边界：上下翻转——4 号最高、1 号最低，层间距 gap（划过时比展开态更宽，见 LEDGER_TIDE.spacing）。
 * offset 为 1 号上边界的基准位置。
 */
function upperSamples(layer: number, seconds: number, size: OceanSize, offset: number, gap: number): EdgeSamples {
  const y = (x: number): number => offset - layer * gap - upperWave(layer, x, seconds, size);
  const n = 25, xs = new Float64Array(n), ys = new Float64Array(n), ss = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = 1.01 - i * 1.02 / (n - 1);
    xs[i] = x; ys[i] = y(x); ss[i] = (y(x + 0.0001) - y(x - 0.0001)) / 0.0002;
  }
  return { x: xs, y: ys, slope: ss };
}

/** 采样点里最接近屏幕水平中线的那一点的高度。 */
function atMiddle(e: EdgeSamples): number {
  let best = 0, distance = Infinity;
  for (let i = 0; i < e.x.length; i++) { const d = Math.abs(e.x[i]! - 0.5); if (d < distance) { distance = d; best = i; } }
  return e.y[best]!;
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
    if (!old || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) {
      if (request.resume) { clearTideResumeCover(); forgetTideResume(); }
      request.reload?.go(null); request.commit(); return;
    }
    const exit = (request.exit && !request.preview) || !!request.resume;
    const resume = request.resume ?? null;

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
    if (exit && !resume) stage.style.opacity = "0";
    document.body.append(stage);

    const space = exit && !resume ? ledgerSpace() : null;
    const size: OceanSize = space?.size ?? { width: innerWidth, height: innerHeight, short: gauge.getBoundingClientRect().height || 116 };
    const painter = new OceanPainter(canvas, request.look);
    painter.resize(size.width, size.height, devicePixelRatio || 1);
    painter.setColors(resolveColors(probe));

    let seconds = resume ? resume.seconds : oceanPhase.seconds;
    if (resume) oceanPhase.seconds = seconds;
    const H = size.height;
    const travelOf = (p: number): number => Math.max(0, size.height * 0.8 - size.short) * p;

    // 划过时层间距加宽到 band（展开态是 0.1 × 0.8 屏高），1 号的深色核心变窄；浪只比屏幕高出 coverWindow，
    // 整屏被盖住的这段行程用来交接页面。下边缘的加宽随下移量渐入（展开 / 收起时与开始页完全一致）。
    const S = size.height * 0.8, margin = S * 0.03, band = LEDGER_TIDE.spacing * H, widen = Math.max(0, band - 0.1 * S);
    const spread = (y: number): number => smoothstep(y / (0.35 * H));
    let minW3 = Infinity, maxW3 = -Infinity;
    for (let i = 0; i <= 48; i++) { const w = upperWave(3, i / 48, seconds, size); minW3 = Math.min(minW3, w); maxW3 = Math.max(maxW3, w); }
    // 4 号下边缘越过屏幕下缘的下移量（加宽随下移渐入，单调，二分求解）。
    const edge4 = highest(edgeSamples(3, 0, seconds, size));
    let lo = 0, hi = 2 * H;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (edge4 + mid + 3 * widen * spread(mid) >= H + margin) hi = mid; else lo = mid; }
    const yCover = hi;                                // 下边缘（4 号）已在屏幕下缘之外的最小下移量
    // 再下移 coverWindow 屏高，4 号上边界才进入屏幕：这一段整屏被盖住。
    // 接着上一页时按视口高度的比例换算（iOS 地址栏可能让两页的视口高度不同；交接帧也是按比例铺满的）。
    const ratio = resume ? H / resume.height : 1;
    const C = resume ? resume.c * ratio : 3 * band + minW3 - yCover - LEDGER_TIDE.coverWindow * H - margin;
    // 离开（含接着上一页）会停在原位等待（新页面、账本切换、协调器挂载），等待时浪形还在游动：停留点与终点按
    // 之后一段时间里的最大起伏算。只按起点那一刻的形状算，久等时旧页面可能从上缘露出一条，或最后差几像素收不了尾。
    let lowW3 = minW3, reachW3 = maxW3;
    if (exit) {
      for (let j = 1; j <= 40; j++) for (let i = 0; i <= 48; i++) {
        const w = upperWave(3, i / 48, seconds + j * 0.5, size); lowW3 = Math.min(lowW3, w); reachW3 = Math.max(reachW3, w);
      }
    }
    const yHold = -(C - 3 * band - lowW3) - margin;    // 上边界（4 号）仍在屏幕上缘之外的最大下移量
    // 上边界全部在屏幕下缘之外（进入的起点、离开的终点）：只留 2px，进入时点击后最初几帧浪就从下缘冒出来。
    const yEnd = H + 2 - (C - 3 * band - reachW3);
    // 顶栏一侧只有 1 号：靠近顶栏（下移量不到 yCover）时，上边界额外上移 lift，在顶栏处（下移量 0）全部移出屏幕上缘。
    // 进入的最后一段，浅色的上边界随下边缘一起、更快地向上离开，收成顶栏前顶部只剩最深的 1 号；离开时反过来，
    // 从整片 1 号的顶栏开始，浅色上边界随后才从上缘落进来。整屏被盖住之后（≥ yCover）不受影响。
    let minW0 = Infinity;
    for (let i = 0; i <= 48; i++) minW0 = Math.min(minW0, upperWave(0, i / 48, seconds, size));
    const L0 = resume ? 0 : Math.max(0, C - minW0 + margin);
    const lift = (y: number): number => L0 * (1 - smoothstep(y / yCover));

    // 行程：离开 = 展开（dist）+ 下移 yEnd；进入 = 上移 yEnd + 收起（dist，到账本空间页面的顶栏或展开态）。
    const pageP = space ? space.p : resume ? 0 : 1;
    let dist = travelOf(exit ? pageP : 1);
    // 接着上一页：从交接帧的位置走完剩下的一段（自己的时长，起步平缓）。
    const start = resume ? resume.y * ratio : 0;
    let total = resume ? yEnd - start : exit ? dist + yEnd : yEnd + dist;
    let qRest = exit ? pageP : 1;
    const motion = new LayerMotion(exit ? 1 : 0, () => size.short / Math.max(size.height * 0.8, 1));
    const qOf = (n: number): number => qRest * n;
    const ease = easingFunction(LEDGER_TIDE.sweep.easing);
    const easeInv = (v: number): number => { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ease(m) < v) lo = m; else hi = m; } return hi; };
    const k = tideRhythm.scale;
    const D = LEDGER_TIDE.sweep.duration * k * (resume ? LEDGER_TIDE.resumeShare : 1), fadeOutMs = LEDGER_TIDE.fadeOut * k;

    const pace = new FramePace();
    let ys = resume ? start : exit ? 0 : yEnd;
    let t = 0, last: number | null = null, raf = 0, ended = false, fading = -1, doneAt = 0;
    let committed = !!resume, arrived = !!request.preview || !!resume, committedAt = 0, held = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    oceanPhase.covered = exit && !resume;
    const idle = beginMotion();
    const created = performance.now();
    let frames = 0, firstAt = 0, maxGap = 0;

    // 等待提示（只在整页重新载入时）：整屏第一次被盖住时开始计时，等待超过 LEDGER_TIDE.hint.delay 才淡入。
    const hintText = request.reload?.hint ?? resume?.hint ?? "";
    let hintAt = resume?.hintAt ?? 0, hint: HTMLElement | null = null, hintY = 0.5 * H;
    const hintFade = resume?.hintFade ?? LEDGER_TIDE.hint.fadeIn;
    const showHint = (): void => {
      if (hint || !hintText || !hintAt) return;
      hint = document.createElement("div"); hint.className = "tide-hint";
      const label = document.createElement("span"); label.className = "tide-hint-text"; label.textContent = hintText;
      label.style.animationDuration = `${hintFade}ms`;
      label.style.animationDelay = `${Math.round(hintAt - Date.now())}ms`;
      hint.append(label); ocean.append(hint);
    };
    if (resume) showHint();

    const finish = (stalled = false): void => {
      if (ended) return;
      ended = true; cancelAnimationFrame(raf); clearTimeout(watchdog); idle();
      publishClockReport({ name: exit ? "ledgerTideExit" : request.preview ? "ledgerTidePreview" : "ledgerTide", frames, firstFrameMs: Math.round((firstAt || created) - created),
        wallMs: Math.round(performance.now() - (firstAt || created)), maxGapMs: Math.round(maxGap), duration: Math.round(D), completed: !stalled, stalled });
      stage.remove(); oceanPhase.covered = false;
      if (resume) { clearTideResumeCover(); forgetTideResume(); }
      if (this.stop === stop) this.stop = null;
      if (!committed && !request.preview) { committed = true; request.commit(); }
      // 整页重新载入还没开始就被打断（取消、卡住）：照常载入，不让切换账本卡在这里。
      if (request.reload && !reloading) { reloading = true; request.reload.go(null); }
    };
    const stop = (): void => finish();
    this.stop = stop;
    this.fade = (): void => {
      // 整页重新载入失败：转场层淡出，露出原来的账本空间（不交付任何页面）。
      committed = true; arrived = true; fading = 0; stage.dataset.tidePhase = "fade"; oceanPhase.covered = false;
    };
    // 新页面启动时主线程常被首次渲染占满一阵：接着播放的这段放宽卡住判定，等过去后再接着走（步长有上限，不跳）。
    const stallMs = resume ? 4000 : STALL_MS;
    const arm = (): void => { clearTimeout(watchdog); watchdog = setTimeout(() => finish(true), stallMs); };

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
        if (!exit) motion.step(1, step);
        stage.style.opacity = String(1 - clamp01(fading / fadeOutMs));
        if (fading >= fadeOutMs) { finish(); return; }
      } else {
        const holding = !!request.hold?.();
        if (!holding) t = Math.min(D, t + step);
        if (resume && !holding && stage.dataset.tidePhase === "sweep") stage.dataset.tidePhase = "reveal";
        let travelled = ease(clamp01(t / D)) * total;
        // 新页面还没提交完：在露出新页面之前停住（离开：上边界不进屏幕；进入：下边缘不出屏幕）。
        const cap = arrived ? Infinity : exit ? dist + yHold : yEnd - yCover;
        if (travelled > cap) { travelled = cap; t = D * easeInv(clamp01(cap / total)); }
        if (resume) {
          motion.step(0, step);
          ys = start + travelled;
        } else if (exit) {
          motion.step(dist > 0 ? Math.max(0, 1 - travelled / dist) : 0, step);
          ys = Math.max(0, travelled - dist);
          held = !arrived && travelled >= cap;
        } else {
          motion.step(dist > 0 ? clamp01((travelled - yEnd) / dist) : 1, step);
          ys = Math.max(0, yEnd - travelled);
        }
        if (exit && !resume && now - firstAt <= LEDGER_TIDE.fadeIn + 34) stage.style.opacity = String(clamp01((now - firstAt) / LEDGER_TIDE.fadeIn));
      }

      const q = motion.layers.map(f => qOf(f.q));
      const open = spread(ys);
      const lower = LAYERS.map(layer => shifted(edgeSamples(layer, q[layer]!, seconds, size), ys + layer * widen * open));
      const upper = LAYERS.map(layer => upperSamples(layer, seconds, size, C + ys - lift(ys), band));
      painter.paint(lower, q.map(clamp01), seconds, 0, upper);
      backing.style.clipPath = `path("${edgeCurve(upper[3]!, size.width)} ${edgeCurve(reversed(lower[3]!), size.width).replace(/^M/, "L")} Z")`;
      // 接着上一页：第一帧画好后撤掉新页面铺底的交接帧（两者是同一帧）。
      if (resume && frames === 1) { clearTideResumeCover(); forgetTideResume(); }

      // 整屏被浪盖住（4 号上边界在屏幕上缘之外、下边缘在下缘之外）：在下方提交新页面。
      const covered = highest(upper[3]!) < -1 && lowest(upper[3]!) <= 0 && highest(lower[3]!) >= H;
      if (request.reload && (covered || held) && !hintAt) { hintAt = Date.now() + LEDGER_TIDE.hint.delay; showHint(); }
      if (hint) {
        // 提示在 1 号深色核心的中线上，随浪移动；新页面接着划过时随浪下移、很快淡出。
        hintY = Math.min(0.78 * H, Math.max(0.22 * H, (atMiddle(upper[0]!) + atMiddle(lower[0]!)) / 2));
        hint.style.transform = `translateY(${hintY.toFixed(1)}px)`;
        if (resume) hint.style.opacity = String(1 - clamp01((ys - start) / (0.08 * H)));
      }
      // 整页重新载入：一盖满整屏、且账本已切换好，就存下这一帧再载入（没切换好则继续走到停留点等）。
      if (request.reload && (covered || held) && !reloading && request.reload.ready()) {
        reloading = true;
        // 定格在存下的这一帧（新页面铺底的就是它），之后不再推进，直到页面卸载；8 秒仍未卸载则收起。
        const frame = snapshot();
        cancelAnimationFrame(raf); clearTimeout(watchdog);
        watchdog = setTimeout(() => finish(), 8000);
        request.reload.go(frame);
        return;
      }
      if (!committed && !request.preview && covered) {
        committed = true; committedAt = now; oceanPhase.covered = true; request.commit();
      }
      if (committed && !arrived && !request.reload) {
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
          // 保险：行程走完后最多再等 250ms（浪形意外超出估计时不让透明的转场层一直留着）。
          if (!doneAt) doneAt = now;
          if (highest(upper[3]!) >= H || now - doneAt > 250) { finish(); return; }
        } else if (motion.layers.every(f => Math.abs(qOf(f.q) - qRest) * Math.max(size.height * 0.8 - size.short, 1) < 1.5)) {
          // 收成与页面海浪重合的顶栏：页面恢复绘制，转场层淡出（品牌字样随之出现）。
          fading = 0; stage.dataset.tidePhase = "fade"; oceanPhase.covered = false;
        }
      }
      raf = requestAnimationFrame(tick); arm();
    };
    let reloading = false;
    /**
     * 存下交接帧：半透明的 B2 玻璃先铺在壁纸底色上，再存成 JPEG（新页面铺底用，与这一帧一致）。
     * 最多按 2 倍像素存（3 倍屏上编码更快、占用更少，只在载入的这一小会儿铺着）；临时画布用完立即释放
     * （iOS 对画布总内存有上限）。失败或存不下时降到 1 倍再试。
     */
    const snapshot = (): TideResume | null => {
      let color = "transparent", hintColor = "", hintShadow = "";
      try {
        probe.style.color = "var(--lv-wallpaper-base, var(--color-canvas))";
        color = getComputedStyle(probe).color;
        const label = hint?.firstElementChild;
        if (label) { const style = getComputedStyle(label); hintColor = style.color; hintShadow = style.textShadow; }
      } catch { /* 用默认值 */ }
      for (const scale of new Set([Math.min(devicePixelRatio || 1, 2), 1])) {
        const flat = document.createElement("canvas");
        try {
          flat.width = Math.max(1, Math.round(size.width * scale)); flat.height = Math.max(1, Math.round(size.height * scale));
          const g = flat.getContext("2d");
          if (!g) continue;
          g.fillStyle = color; g.fillRect(0, 0, flat.width, flat.height); g.drawImage(canvas, 0, 0, flat.width, flat.height);
          const image = flat.toDataURL("image/jpeg", 0.85);
          if (!image.startsWith("data:image/jpeg")) continue;
          const frame: TideResume = { at: Date.now(), look: request.look, seconds, y: ys, c: C, width: size.width, height: size.height, image, color,
            ...(hint ? { hint: hintText, hintY: hintY / H, hintColor, hintShadow, hintAt, hintFade } : {}) };
          if (saveTideResume(frame)) return frame;
        } catch { /* 换更小的尺寸再试 */ } finally { flat.width = 0; flat.height = 0; }
      }
      return null;
    };
    raf = requestAnimationFrame(tick); arm();
  }

  private fade: (() => void) | null = null;

  /** 整页重新载入失败时：转场层淡出，露出原来的页面。 */
  release(): void { const fade = this.fade; this.fade = null; if (fade && this.stop) fade(); }

  /**
   * 切换账本（整页重新载入）前：海浪向下展开盖满整屏，同时进行 work（服务器激活）；两者都完成后存下交接帧并返回，
   * 调用方随即重新载入。work 失败时海浪淡出、错误照常抛出。不能播放时（减少动态效果等）只等 work。
   */
  coverForReload(look: PainterLook, page: () => HTMLElement | null, work: () => Promise<void>, hint?: string): Promise<void> {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden || !page()) return work();
    return new Promise<void>((resolve, reject) => {
      // 两件事都完成才返回：账本已切换好（work），且海浪已存好交接帧（go；被打断时也会调用）。
      let done = false, gone = false, failed = false;
      const settle = (): void => { if (done && gone) resolve(); };
      work().then(() => { done = true; settle(); }, (caught: unknown) => { failed = true; this.release(); reject(caught); });
      this.run({ exit: true, look, page, commit: () => undefined, reload: { ready: () => done, go: () => { if (failed) return; gone = true; settle(); }, ...(hint ? { hint } : {}) } });
    });
  }
}

/**
 * 整页重新载入后接着播放的海浪：入口（main.tsx）在第一次渲染之前就开始画——铺底的交接帧立刻换成会动的浪，
 * 页面在浪下面渲染；协调器挂载后放行（{@link releaseTideResume}），浪从交接帧的位置接着向下划过。
 * 只此一段，与协调器的生命周期无关（开发模式 StrictMode 会重建协调器）。
 */
const resumeTide = new TidePresentation();
let resumeHeld = false, resumeReleased = false;
let resumeFallback: ReturnType<typeof setTimeout> | undefined;

export function beginTideResume(): void {
  if (typeof document === "undefined" || !document.documentElement.hasAttribute(RESUME_COVER)) return;
  const look = tideLook();
  const resume = takeTideResume(look);
  if (!resume || !look) return;
  resumeHeld = !resumeReleased;
  resumeTide.run({ exit: true, look, page: () => document.body, commit: () => undefined, resume, hold: () => resumeHeld });
  // 协调器没有挂载（例如换成了电脑版外壳）：最多停这么久，照常划过。
  resumeFallback = setTimeout(releaseTideResume, LEDGER_TIDE.resumeHoldMs);
}

/** 协调器挂载后调用：接着播放的海浪开始划过；没有在播放时撤掉残留的铺底。可重复调用。 */
export function releaseTideResume(): void {
  clearTimeout(resumeFallback);
  resumeHeld = false; resumeReleased = true;
  if (!resumeTide.active) fadeTideResumeCover();
}
