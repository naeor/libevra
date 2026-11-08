/**
 * **帧锚定动画时钟（S19 1.19.43）。**
 *
 * iPhone Safari 把 transform / opacity 的 WAAPI 动画交给合成器，开始时间取自动画创建时的时间线；
 * 如果紧接着的一帧很重（React 刚提交整页、整页副本或几十块玻璃首次绘制），这一帧画出来时动画时钟早已
 * 走了一两百毫秒——第一帧就落在中后段，看起来像“先跳到终态再补一点动画”。Chromium 的合成器会在首帧
 * 真正显示时才定起点，所以桌面逐帧测试看不出来。
 *
 * 这里不再让浏览器自己计时：动画创建后立即暂停，由 rAF 写 `currentTime`。
 * - 第一帧固定是 t = 0：起始姿态（与点击前完全相同的画面）先被真正画出来；
 * - 之后每帧推进实际间隔；遇到明显长于近期正常帧的间隔（提交、首次绘制、长任务），只推进一个正常帧
 *   的时间（1.19.44 起；1.19.43 推进 34ms，停顿后会一下跳出一大段）。正常帧间隔取最近几帧的中位数，
 *   60 / 120Hz 与低电量 30Hz 都按各自的节奏走；`maxStep` 仍是单帧上限；
 * - 正常 60 / 120Hz 下与实时一致，总时长不变。
 *
 * 看门狗：连续 600ms 收不到任何 rAF（标签页被挂到后台、内嵌 WebView 停帧）时直接走到终点并完成，
 * 不让暂停中的动画、舞台与 inert 页面停在半路。
 *
 * 只负责时间，不创建 DOM、不提交路由；调用方在 `onProgress` 里做中途交接（例如 Object Expand 在 45% 时提交详情）。
 */
import { MOTION_CLOCK } from "./motionTokens.js";

export interface ClockReport {
  readonly name: string;
  /** 从创建到第一帧绘制前回调的间隔（点击后的准备与首帧成本）。 */
  readonly firstFrameMs: number;
  /** 动画期间实际绘制的帧数。 */
  readonly frames: number;
  /** 从第一帧到结束的墙钟时间。 */
  readonly wallMs: number;
  /** 最长的一帧间隔；大于 maxStep 时说明那一帧被放慢而不是跳过。 */
  readonly maxGapMs: number;
  readonly duration: number;
  readonly completed: boolean;
  /** 因 rAF 停止由看门狗直接收尾。 */
  readonly stalled: boolean;
}

/** 连续这么久没有 rAF 就认为帧已停止（后台、停帧的 WebView），直接收尾。 */
export const STALL_MS = MOTION_CLOCK.stallMs;

const listeners = new Set<(report: ClockReport) => void>();
/** 开发诊断（`?motion=1` 徽章）订阅每次动画的真实帧数与时间分布。 */
export function onClockReport(listener: (report: ClockReport) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 不经 runFrameClock 的呈现（账本空间海浪转场）用同一份报告格式发布自己的帧数与时间。 */
export function publishClockReport(report: ClockReport): void {
  for (const listener of listeners) listener(report);
}

/**
 * 正常帧间隔的估计：最近 5 个间隔的中位数（初值 60Hz）。明显更长（> 1.5 倍）的间隔视为卡顿，
 * 只按正常帧推进；单次卡顿不会改变中位数，持续的低帧率（30Hz）会被接受为新的正常节奏。
 */
export class FramePace {
  private readonly recent: number[] = [1000 / 60];
  get typical(): number { const sorted = [...this.recent].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]!; }
  step(gap: number): number {
    const typical = this.typical;
    this.recent.push(gap); if (this.recent.length > 5) this.recent.shift();
    return gap <= typical * 1.5 ? gap : typical;
  }
}

export interface FrameClock {
  readonly progress: number;
  /** 在运行中加入新动画（例如中途提交后才出现的详情页）；按当前时间对齐。 */
  add(animation: Animation): void;
  /** 动画已到终值时移出时钟并取消（例如淡入完成后不再让元素保持透明度动画，避免玻璃失去背景）。 */
  remove(animation: Animation): void;
  /** 立即停止；不调用 onDone。 */
  cancel(): void;
}

export function runFrameClock(animations: Animation[], duration: number, options: {
  readonly name: string;
  readonly onProgress?: (progress: number) => void;
  readonly onDone?: () => void;
  readonly maxStep?: number;
  /**
   * 允许走到的最远时间（毫秒）。用于“等内容就绪”：例如主 Tab 交换在新页面提交前只让旧页先走一小段，
   * 新页面到达后放开；时间只会停在这里，不会倒退。
   */
  readonly limit?: () => number;
}): FrameClock {
  const maxStep = options.maxStep ?? MOTION_CLOCK.maxStep;
  const list = [...animations];
  for (const animation of list) { animation.pause(); animation.currentTime = 0; }
  const created = performance.now();
  let time = 0, last: number | null = null, frames = 0, first = 0, firstAt = 0, maxGap = 0, raf = 0, ended = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const pace = new FramePace();
  const report = (completed: boolean, stalled = false): void => {
    const value: ClockReport = { name: options.name, firstFrameMs: Math.round(first), frames, wallMs: Math.round(performance.now() - (firstAt || created)), maxGapMs: Math.round(maxGap), duration, completed, stalled };
    for (const listener of listeners) listener(value);
  };
  const finish = (stalled: boolean): void => {
    ended = true; clearTimeout(watchdog);
    if (stalled) { cancelAnimationFrame(raf); time = duration; for (const animation of list) animation.currentTime = time; options.onProgress?.(1); }
    report(true, stalled); options.onDone?.();
  };
  const arm = (): void => { clearTimeout(watchdog); watchdog = setTimeout(() => { if (!ended) finish(true); }, STALL_MS); };
  const tick = (now: number): void => {
    if (ended) return;
    if (last === null) { first = now - created; firstAt = now; }
    else {
      const gap = now - last; maxGap = Math.max(maxGap, gap);
      const cap = Math.min(duration, options.limit?.() ?? duration);
      time = Math.max(time, Math.min(cap, time + Math.min(pace.step(gap), maxStep)));
    }
    last = now; frames++;
    for (const animation of list) animation.currentTime = time;
    options.onProgress?.(duration ? time / duration : 1);
    if (ended) return;
    if (time >= duration) { finish(false); return; }
    raf = requestAnimationFrame(tick); arm();
  };
  raf = requestAnimationFrame(tick); arm();
  return {
    get progress() { return duration ? time / duration : 1; },
    add(animation) { animation.pause(); animation.currentTime = time; list.push(animation); },
    remove(animation) { const index = list.indexOf(animation); if (index >= 0) list.splice(index, 1); animation.cancel(); },
    cancel() { if (ended) return; ended = true; clearTimeout(watchdog); cancelAnimationFrame(raf); report(false); },
  };
}

/** 不需要 WAAPI 的数值动画（例如明细顶部 `--p`）使用同一时钟语义。 */
export function runFrameValue(duration: number, onValue: (t: number) => void, onDone?: () => void, maxStep: number = MOTION_CLOCK.maxStep): () => void {
  let time = 0, last: number | null = null, raf = 0, ended = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const pace = new FramePace();
  const finish = (): void => { ended = true; clearTimeout(watchdog); onDone?.(); };
  const arm = (): void => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => { if (ended) return; cancelAnimationFrame(raf); onValue(1); finish(); }, STALL_MS);
  };
  const tick = (now: number): void => {
    if (ended) return;
    if (last !== null) time = Math.min(duration, time + Math.min(pace.step(now - last), maxStep));
    last = now;
    onValue(duration ? time / duration : 1);
    if (ended) return;
    if (time >= duration) { finish(); return; }
    raf = requestAnimationFrame(tick); arm();
  };
  raf = requestAnimationFrame(tick); arm();
  return () => { ended = true; clearTimeout(watchdog); cancelAnimationFrame(raf); };
}
